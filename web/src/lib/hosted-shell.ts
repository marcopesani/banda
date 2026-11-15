/**
 * The browser's shell as the page on the app's own origin has it (`browser-shell.ts` is its rules): the WebAssembly
 * endpoint (`web/iroh`), the browser's storage for what the device keeps, and the pairing an address carries. Only the
 * build that origin serves reaches this file (`deviceShell` in `transport.ts`).
 */
import { browserShell, carriedLink, type Kept, type KeptStore } from "./browser-shell.ts";
import type { BandaPlugin } from "./device-shell.ts";

const DB = "banda";
const STORE = "device";
const ID = "kept";

const database = () =>
	new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(DB, 1);
		opening.onupgradeneeded = () => void opening.result.createObjectStore(STORE);
		opening.onsuccess = () => resolve(opening.result);
		opening.onerror = () => reject(opening.error ?? new Error("the browser refused its storage"));
	});

/**
 * One transaction on what the device keeps: `change` is given what is kept and answers what to keep in its place
 * (undefined for nothing; the same value to leave it). It resolves, with what is then kept, once the browser says
 * the transaction is complete, so what it answers is what a reload finds.
 */
async function kept(change: (now: Kept | undefined) => Kept | undefined): Promise<Kept | undefined> {
	const db = await database();
	try {
		return await new Promise<Kept | undefined>((resolve, reject) => {
			const transaction = db.transaction(STORE, "readwrite");
			const store = transaction.objectStore(STORE);
			let after: Kept | undefined;
			const read = store.get(ID) as IDBRequest<Kept | undefined>;
			read.onsuccess = () => {
				after = change(read.result);
				if (after === undefined) store.delete(ID);
				else if (after !== read.result) store.put(after, ID);
			};
			transaction.oncomplete = () => resolve(after);
			transaction.onerror = () => reject(transaction.error ?? new Error("the browser refused its storage"));
			transaction.onabort = () => reject(transaction.error ?? new Error("the browser gave up on its storage"));
		});
	} finally {
		db.close();
	}
}

/**
 * The device's key and its daemon's ticket, in the browser's own storage for this origin. Nothing seals the key: a
 * script this origin serves could ask the browser to open any seal, and a copy of the browser's files would carry the
 * seal's key beside it. So the key is as safe as this origin's files and this browser's profile are, and no safer
 * (SECURITY.md); the phone's shell, with a keystore outside its files, does better.
 */
export function browserStore(): KeptStore {
	return {
		// read and, for a browser that kept nothing, made in one transaction: two tabs opened at once are one device
		load: async () => (await kept((now) => now ?? { key: crypto.getRandomValues(new Uint8Array(32)) })) as Kept,
		// a key another tab forgot meanwhile is not brought back: there is then nothing to keep a daemon for
		keep: async (ticket) => void (await kept((now) => (now === undefined ? undefined : { key: now.key, ticket }))),
		forget: async () => void (await kept(() => undefined)),
	};
}

/** A name to suggest for this device: what the browser says it runs on. */
function suggestedName(): string {
	const agent = navigator.userAgent;
	for (const [name, mark] of [
		["iPhone", /iPhone/],
		["iPad", /iPad/],
		["Android phone", /Android/],
		["Mac", /Macintosh|Mac OS X/],
		["Windows computer", /Windows/],
		["Linux computer", /Linux/],
	] as const)
		if (mark.test(agent)) return name;
	return "Browser";
}

/** Where a pairing link waits out a reload: this tab's own storage, gone with the tab. */
const LINK = "banda.pairing";

/** This tab's storage, when the browser gives one: private windows of some browsers refuse. */
const tab = {
	get: () => {
		try {
			return sessionStorage.getItem(LINK) ?? undefined;
		} catch {
			return undefined;
		}
	},
	set: (link: string | undefined) => {
		try {
			if (link === undefined) sessionStorage.removeItem(LINK);
			else sessionStorage.setItem(LINK, link);
		} catch {
			// no storage: a reload while pairing starts over from a new code
		}
	},
};

let hosted: BandaPlugin | undefined;

/** The shell of the app on its own origin: one for the page, read once as the transport is. */
export function hostedShell(): BandaPlugin {
	hosted ??= (() => {
		/**
		 * A pairing the address carries, taken out of the address bar at once: it holds the invite. Whatever follows
		 * `#pair?` goes, a pairing or not. The browser's history may still have the address as it was opened; an invite
		 * works once, for ten minutes.
		 */
		const take = () => {
			if (!location.hash.startsWith("#pair?")) return undefined;
			const link = carriedLink(location.hash);
			history.replaceState(null, "", location.pathname + location.search);
			return link;
		};
		const carried = take();
		if (carried !== undefined) tab.set(carried);
		const shell = browserShell({
			load: async () => {
				const module = await import("../../iroh/pkg/banda_iroh_web.js");
				await module.default();
				return { bind: (secret) => module.Device.create(secret), computer: module.computer };
			},
			store: browserStore(),
			link: carried ?? tab.get(),
			linked: tab.set,
			name: suggestedName(),
		});
		addEventListener("hashchange", () => {
			const link = take();
			if (link !== undefined) shell.opened(link);
		});
		return {
			...shell,
			keepDaemon: async () => {
				await shell.keepDaemon();
				// a paired device asks the browser not to clear its storage under pressure; the browser may say no
				void navigator.storage?.persist?.().catch(() => undefined);
			},
			// a browser saves a file itself: the app never asks its shell to here (`save-file.ts`)
			saveFile: async () => ({ saved: false }),
		};
	})();
	return hosted;
}
