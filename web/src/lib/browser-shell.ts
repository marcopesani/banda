/**
 * The phone shell's plugin (`BandaPlugin`, `device-shell.ts`) where no native shell runs: the app on an origin of its
 * own, in a browser (DESIGN.md "Clients"). It is the device the Android shell is (`mobile/.../Daemon.kt`,
 * `BandaPlugin.kt`), by the same rules, over a WebAssembly endpoint (`web/iroh`). A browser sends no UDP, so that
 * endpoint reaches the daemon through a relay alone. These are the rules; what binds them to a page is
 * `hosted-shell.ts`.
 *
 * A new code's daemon is tried before it is kept: `setDaemon` points requests at it in memory, `keepDaemon` saves it
 * once it approved this device, and `revertDaemon` goes back to the saved one. A code never replaces the saved daemon
 * by itself. A connection that closed is only dialed again, and only when the stream for a request could not be
 * opened: a request that may have been written is never sent twice. A connection belongs to the ticket it was dialed
 * with and is never used for another: one that comes late, after its dial was given up on, is closed unused.
 */
import { fromBase64, toBase64 } from "./bytes.ts";
import type { BandaPlugin, HeaderMap, ShellState, StreamChunk, StreamEnd } from "./device-shell.ts";
import { frameRequest, readResponse } from "./iroh-http.ts";

/** A connection to one daemon, authenticated as the endpoint its ticket named. */
export type DaemonLink = {
	/** A stream of its own with nothing sent yet: it fails when the connection has gone. */
	open(): Promise<{ send(request: Uint8Array): Promise<ReadableStream<Uint8Array>> }>;
	/** Close the connection: every stream on it ends. */
	close(): void;
};

/** A browser's Iroh endpoint, bound with the device's key: what the WebAssembly module gives. */
export type DeviceEndpoint = {
	/** This device's endpoint id: what the daemon lists it by. */
	id(): string;
	/** Dial the daemon a ticket names. The connection is the caller's: the endpoint keeps none. */
	dial(ticket: string): Promise<DaemonLink>;
	close(): Promise<void>;
};

export type Endpoints = {
	/** Bind an endpoint with `secret`, the device's key. */
	bind(secret: Uint8Array): Promise<DeviceEndpoint>;
	/** The endpoint id of the daemon a ticket names; throws when the text is not a ticket. */
	computer(ticket: string): string;
};

/** What a browser keeps as a device: its key, and the ticket of the daemon that approved it. */
export type Kept = { readonly key: Uint8Array; readonly ticket?: string };

export type KeptStore = {
	/** What is kept. A browser that kept nothing is given a new key here, kept before it is answered. */
	load(): Promise<Kept>;
	/** Keep `ticket` as the daemon that approved this device. */
	keep(ticket: string): Promise<void>;
	/** Keep nothing: the next `load` is a new device. */
	forget(): Promise<void>;
};

/** A plugin's rejection, with the code the app reads (`ShellState` in `device-shell.ts`). */
const failed = (code: "UNREACHABLE" | "BROKEN" | "TICKET", message: string) =>
	Object.assign(new Error(message), { code });

const headersOf = (response: Response): HeaderMap => Object.fromEntries(response.headers.entries());

/** How long a dial may take before the daemon counts as not reached. */
const DIAL_MS = 30_000;

export type BrowserShell = Omit<BandaPlugin, "saveFile"> & {
	/** A pairing link reached the page while it ran. */
	opened(link: string): void;
};

export function browserShell({
	load,
	store,
	link: carried,
	linked = () => {},
	name,
	dialMs = DIAL_MS,
}: {
	/** The WebAssembly module, loaded when first needed. */
	readonly load: () => Promise<Endpoints>;
	readonly store: KeptStore;
	/** A `banda://pair` link the page was opened with, or had when it was last open and had not finished with. */
	readonly link?: string | undefined;
	/** Told the link whenever it changes, to keep it across a reload; undefined once it is finished with. */
	readonly linked?: (link: string | undefined) => void;
	/** A name to suggest for this device. */
	readonly name: string;
	readonly dialMs?: number;
}): BrowserShell {
	/**
	 * The pairing link, from when it arrives until the trial it starts ends, approved or not. It outlives a reload, so a
	 * page the browser dropped while its owner walked to the computer still knows what it was asking.
	 */
	let link = carried;
	const setLink = (next: string | undefined) => {
		if (next === link) return;
		link = next;
		linked(next);
	};

	let endpoints: Promise<Endpoints> | undefined;
	const loaded = () => {
		endpoints ??= load();
		const loading = endpoints;
		// a load that failed is tried again by the next call, not remembered
		loading.catch(() => {
			if (endpoints === loading) endpoints = undefined;
		});
		return loading;
	};
	/** The endpoint, bound once with the key kept. */
	let bound: Promise<DeviceEndpoint> | undefined;
	let saved: string | undefined;
	/** The ticket of a daemon being tried, not saved. */
	let trial: string | undefined;
	/** The live connection, and the ticket it was dialed with: it is that daemon's and no other's. */
	let live: { readonly ticket: string; readonly link: DaemonLink } | undefined;

	const endpoint = () => {
		bound ??= (async () => {
			const kept = await store.load();
			const made = await (await loaded()).bind(kept.key);
			saved = kept.ticket;
			return made;
		})();
		const binding = bound;
		binding.catch(() => {
			if (bound === binding) bound = undefined;
		});
		return binding;
	};

	// one change of daemon or connection at a time, as the phone's shell holds a lock for
	let turn: Promise<unknown> = Promise.resolve();
	const alone = <T>(run: () => Promise<T>): Promise<T> => {
		const next = turn.then(run, run);
		turn = next.catch(() => undefined);
		return next;
	};

	/** The streams the app asked for and has not stopped, by its id for each; the reader once the head has come. */
	const streams = new Map<string, { reader?: ReadableStreamDefaultReader<Uint8Array> }>();
	const listeners = {
		chunk: new Set<(chunk: StreamChunk) => void>(),
		end: new Set<(end: StreamEnd) => void>(),
		link: new Set<(link: { readonly url: string }) => void>(),
	};

	/**
	 * Let go of the connection. Every stream on it ends with it, and each one the app still reads is told so (`end`,
	 * with why), as when a connection is lost: the app opens what it still wants again.
	 */
	const drop = () => {
		live?.link.close();
		live = undefined;
	};

	/** The connection to the daemon, dialed first when the live one is another daemon's, or gone. */
	const connected = () =>
		alone(async () => {
			const device = await endpoint();
			const ticket = trial ?? saved;
			if (ticket === undefined) throw failed("UNREACHABLE", "this phone is not paired with a computer yet");
			if (live?.ticket === ticket) return live;
			drop();
			const dialing = device.dial(ticket);
			let late: ReturnType<typeof setTimeout> | undefined;
			try {
				const link = await Promise.race([
					dialing,
					new Promise<never>((_, reject) => {
						late = setTimeout(() => reject(new Error("timed out")), dialMs);
					}),
				]);
				live = { ticket, link };
				return live;
			} catch {
				// given up on: should it still connect, that connection is closed and never used
				dialing.then(
					(unused) => unused.close(),
					() => undefined,
				);
				throw failed("UNREACHABLE", "could not reach your computer");
			} finally {
				clearTimeout(late);
			}
		});

	/** A new stream to the daemon. A connection that went away under it is dialed once more: nothing was written yet. */
	const open = async () => {
		const first = await connected();
		try {
			return await first.link.open();
		} catch {
			await alone(async () => {
				if (live === first) drop();
			});
			const second = await connected();
			try {
				return await second.link.open();
			} catch {
				throw failed("UNREACHABLE", "lost the connection to your computer");
			}
		}
	};

	/** One request written and its answer's head read; what breaks after the stream opened is not tried again. */
	const exchange = async (method: string, path: string, headers: HeaderMap, body?: Uint8Array) => {
		const request = frameRequest(method, path, headers, body);
		const stream = await open();
		try {
			return await readResponse(await stream.send(request));
		} catch (error) {
			throw failed("BROKEN", error instanceof Error ? error.message : String(error));
		}
	};

	const shell: BrowserShell = {
		async request({ method, path, headers, body }) {
			const response = await exchange(method, path, headers, body === undefined ? undefined : fromBase64(body));
			try {
				return {
					status: response.status,
					headers: headersOf(response),
					body: toBase64(new Uint8Array(await response.arrayBuffer())),
				};
			} catch (error) {
				throw failed("BROKEN", error instanceof Error ? error.message : String(error));
			}
		},
		async stream({ id, path, headers }) {
			// known from before its head comes: the app may stop it at any moment, as it may the phone's
			const asked: { reader?: ReadableStreamDefaultReader<Uint8Array> } = {};
			streams.set(id, asked);
			let response: Response;
			try {
				response = await exchange("GET", path, headers);
			} catch (error) {
				if (streams.get(id) === asked) streams.delete(id);
				throw error;
			}
			const head = { status: response.status, headers: headersOf(response) };
			if (streams.get(id) !== asked) {
				// stopped while its head was on the way: the daemon's side is stopped, and nothing is told
				await response.body?.cancel().catch(() => undefined);
				return head;
			}
			const reader = response.body?.getReader();
			const end = (error?: string) => {
				if (streams.get(id) !== asked) return;
				streams.delete(id);
				for (const listener of listeners.end) listener(error === undefined ? { id } : { id, error });
			};
			if (reader === undefined) queueMicrotask(() => end());
			else {
				asked.reader = reader;
				void (async () => {
					try {
						for (;;) {
							const { value, done } = await reader.read();
							if (done) break;
							if (streams.get(id) !== asked) return;
							for (const listener of listeners.chunk) listener({ id, data: toBase64(value) });
						}
						end();
					} catch (error) {
						end(String(error));
					}
				})();
			}
			return head;
		},
		async cancel({ id }) {
			const stream = streams.get(id);
			// forgotten first: a stream the app stopped says nothing more, whether or not its head has come
			streams.delete(id);
			await stream?.reader?.cancel().catch(() => undefined);
		},
		// one implementation for the three events: each listener is kept by the kind it asked for
		addListener: (async (event: keyof typeof listeners, listener: (value: never) => void) => {
			(listeners[event] as Set<(value: never) => void>).add(listener);
			return { remove: async () => void (listeners[event] as Set<(value: never) => void>).delete(listener) };
		}) as BandaPlugin["addListener"],
		async state(): Promise<ShellState> {
			const device = await endpoint();
			const ticket = trial ?? saved;
			return {
				...(ticket === undefined ? {} : { daemon: (await loaded()).computer(ticket) }),
				device: device.id(),
				name,
				// a link whose daemon is being tried is not offered again: its invite is asked once
				...(link === undefined || trial !== undefined ? {} : { link }),
			};
		},
		async setDaemon({ ticket }) {
			try {
				(await loaded()).computer(ticket);
			} catch {
				throw failed("TICKET", "not a ticket");
			}
			await alone(async () => {
				await endpoint();
				drop();
				trial = ticket;
			});
		},
		keepDaemon: () =>
			alone(async () => {
				if (trial === undefined) return;
				await endpoint();
				await store.keep(trial);
				saved = trial;
				trial = undefined;
				setLink(undefined);
			}),
		revertDaemon: () =>
			alone(async () => {
				if (trial === undefined) return;
				trial = undefined;
				drop();
				// the trial ended without an approval: its invite is spent, denied or let go of
				setLink(undefined);
			}),
		forget: () =>
			alone(async () => {
				drop();
				const device = await bound?.catch(() => undefined);
				await device?.close().catch(() => undefined);
				await store.forget();
				bound = undefined;
				saved = undefined;
				trial = undefined;
				setLink(undefined);
			}),
		opened(url) {
			setLink(url);
			for (const listener of listeners.link) listener({ url });
		},
	};
	return shell;
}

/** A pairing an address carries after its `#`, as the link the app reads (`readPairingLink`); undefined when none. */
export function carriedLink(hash: string): string | undefined {
	if (!hash.startsWith("#pair?")) return undefined;
	const carried = new URLSearchParams(hash.slice("#pair?".length));
	const ticket = carried.get("ticket");
	const invite = carried.get("invite");
	if (ticket === null || invite === null || ticket === "" || invite === "") return undefined;
	return `banda://pair?ticket=${encodeURIComponent(ticket)}&invite=${encodeURIComponent(invite)}`;
}
