/**
 * A page's write belongs to the page that made it (DESIGN.md "The box", The browser), whatever order DevTools reports
 * it in, against a scripted DevTools. Chromium pauses a request in its browser process (`Fetch.requestPaused`) while the
 * page's own news (`Page.frameNavigated`, `Network.requestWillBeSent`) comes from its renderer, so a new page's write
 * can be paused before the browser says the page changed: it is that new page's, held and listed, never dropped as the
 * page left behind. A write of a page that is left behind goes with it: failed in Chromium, never kept paused there.
 */
import { describe, expect, it } from "vitest";
import { type Browser, openBrowser } from "../src/box/browser.ts";
import type { Cdp, CdpEvent } from "../src/box/cdp.ts";

/** A DevTools that answers every command, keeps what it was sent, and lets the test send events in any order. */
class ScriptedCdp {
	readonly sent: { readonly method: string; readonly params: Record<string, unknown> }[] = [];
	readonly #listeners = new Set<(event: CdpEvent) => void>();
	readonly ended = new Promise<string>(() => {});
	url = "about:blank";
	on(listener: (event: CdpEvent) => void) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	async send(method: string, params: Record<string, unknown> = {}) {
		this.sent.push({ method, params });
		if (method === "Target.createTarget") return { targetId: "T" };
		if (method === "Target.attachToTarget") return { sessionId: "S" };
		if (method === "Storage.getCookies" || method === "Network.getCookies") return { cookies: [] };
		// enough of a page for an action to read once it settled: its address, and nothing on it
		if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", url: this.url } } };
		if (method === "Accessibility.getFullAXTree") return { nodes: [] };
		if (method === "Target.getTargetInfo") return { targetInfo: { title: "Page", url: this.url } };
		return {};
	}
	emit(method: string, params: Record<string, unknown>) {
		for (const listener of this.#listeners) listener({ method, params, sessionId: "S" });
	}
	close() {}
	/** What was done with paused request `id` so far: continued, failed, or nothing. */
	answers(id: string) {
		return this.sent
			.filter((one) => one.params.requestId === id && one.method.startsWith("Fetch."))
			.map((one) => one.method);
	}
}

/** Every event and decision run to its end: a guard's awaits, the browser's own commands. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

async function setup() {
	const cdp = new ScriptedCdp();
	const browser: Browser = openBrowser({
		setup: { command: async () => [], login: { username: "u", password: "p" } },
		ensure: async () => {},
		tell: async () => {},
		log: () => {},
		process: async () => ({ cdp: cdp as unknown as Cdp, release() {} }),
		// the owner signed in nowhere: every write acts as nobody
		sessionAt: async () => undefined,
	});
	// a sign-out of nothing starts the tab without driving it
	await browser.forget("nothing.example");
	const committed = (url: string, loader: string) => {
		cdp.url = url;
		cdp.emit("Page.frameNavigated", { frame: { id: "top", loaderId: loader, url } });
	};
	const willSend = (network: string, url: string, method: string, type: string, loader: string, page: string) =>
		cdp.emit("Network.requestWillBeSent", {
			requestId: network,
			loaderId: loader,
			documentURL: page,
			frameId: "top",
			type,
			request: { url, method, headers: {} },
		});
	const paused = (id: string, network: string, url: string, method: string, type: string) =>
		cdp.emit("Fetch.requestPaused", {
			requestId: id,
			networkId: network,
			resourceType: type,
			frameId: "top",
			request: { method, url, headers: { "Content-Type": "text/plain" }, postDataEntries: [] },
		});
	return { cdp, browser, committed, willSend, paused };
}

const BLOG = "http://blog.example";

describe("a page's write, as DevTools reports it", () => {
	it("paused before its page is said to have opened, is the new page's: held and listed, never dropped", async () => {
		const s = await setup();
		s.committed(`${BLOG}/`, "L1");
		// the agent opens the challenge: its document goes on
		s.willSend("N0", `${BLOG}/challenge`, "GET", "Document", "L2", `${BLOG}/challenge`);
		s.paused("d0", "N0", `${BLOG}/challenge`, "GET", "Document");
		await flush();
		expect(s.cdp.answers("d0")).toEqual(["Fetch.continueRequest"]);
		// its script's write, paused by the browser process before the renderer's news of the page arrives
		s.paused("w0", "N1", `${BLOG}/bootstrap`, "POST", "XHR");
		await flush();
		s.committed(`${BLOG}/challenge`, "L2");
		s.willSend("N1", `${BLOG}/bootstrap`, "POST", "Fetch", "L2", `${BLOG}/challenge`);
		await flush();
		const writes = await s.browser.writes(0);
		// its page and frame are the challenge's, as whose write it is is weighed by them (`ownersOf`)
		expect(writes.map((write) => [write.method, write.url, write.page, write.origin])).toEqual([
			["POST", `${BLOG}/bootstrap`, `${BLOG}/challenge`, `${BLOG}/challenge`],
		]);
		// held, as a write the agent's page made is: neither sent nor failed
		expect(s.cdp.answers("w0")).toEqual([]);
	});

	it("of a page left behind goes with it: failed in the browser, never kept paused there", async () => {
		const s = await setup();
		s.committed(`${BLOG}/form`, "L1");
		s.willSend("N1", `${BLOG}/save`, "POST", "Fetch", "L1", `${BLOG}/form`);
		s.paused("w0", "N1", `${BLOG}/save`, "POST", "XHR");
		await flush();
		expect((await s.browser.writes(0)).map((write) => write.page)).toEqual([`${BLOG}/form`]);
		// the page goes elsewhere: its write is gone, and so is the request Chromium held for it
		s.willSend("N2", `${BLOG}/next`, "GET", "Document", "L2", `${BLOG}/next`);
		s.paused("d1", "N2", `${BLOG}/next`, "GET", "Document");
		await flush();
		s.committed(`${BLOG}/next`, "L2");
		await flush();
		expect(await s.browser.writes(0)).toEqual([]);
		expect(s.cdp.answers("w0")).toEqual(["Fetch.failRequest"]);
	});

	it("made by a page left while it waited to be heard of goes with that page", async () => {
		const s = await setup();
		s.committed(`${BLOG}/form`, "L1");
		s.paused("w0", "N1", `${BLOG}/save`, "POST", "XHR");
		await flush();
		// the renderer tells of it as the form's, and of the next page, before the pause is decided
		s.willSend("N1", `${BLOG}/save`, "POST", "Fetch", "L1", `${BLOG}/form`);
		s.committed(`${BLOG}/next`, "L2");
		await flush();
		expect(await s.browser.writes(0)).toEqual([]);
		expect(s.cdp.answers("w0")).toEqual(["Fetch.failRequest"]);
	});

	it("the renderer never tells of is decided all the same, as the page that stands: no request waits for ever", async () => {
		const s = await setup();
		s.committed(`${BLOG}/challenge`, "L1");
		s.paused("w0", "N1", `${BLOG}/bootstrap`, "POST", "XHR");
		await flush();
		expect(await s.browser.writes(0)).toEqual([]);
		await new Promise((resolve) => setTimeout(resolve, 2_200));
		expect((await s.browser.writes(0)).map((write) => write.page)).toEqual([`${BLOG}/challenge`]);
	});

	it("an action is not over while a write its page made is still being decided: what it says lists the write", async () => {
		const s = await setup();
		s.committed(`${BLOG}/`, "L1");
		const said = s.browser.act(0, { type: "navigate", url: `${BLOG}/challenge` });
		await flush();
		s.willSend("N0", `${BLOG}/challenge`, "GET", "Document", "L2", `${BLOG}/challenge`);
		s.paused("d0", "N0", `${BLOG}/challenge`, "GET", "Document");
		s.committed(`${BLOG}/challenge`, "L2");
		s.cdp.emit("Network.loadingFinished", { requestId: "N0" });
		s.cdp.emit("Page.frameStoppedLoading", { frameId: "top" });
		// the script's write is paused, and the renderer tells of it only after the page would have looked quiet
		s.paused("w0", "N1", `${BLOG}/bootstrap`, "POST", "XHR");
		await new Promise((resolve) => setTimeout(resolve, 800));
		s.willSend("N1", `${BLOG}/bootstrap`, "POST", "Fetch", "L2", `${BLOG}/challenge`);
		expect(await said).toContain(`[banda] The page tried to send POST ${BLOG}/bootstrap (write w1)`);
	});
});
