/**
 * The browser's shell (web/src/lib/browser-shell.ts) against a stand-in for its WebAssembly endpoint: what it keeps,
 * which daemon it asks, when it dials again, and that a request that may have been written is never sent twice. The
 * app itself as a device in a browser, against a daemon, is test/hosted-app.browser.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
	browserShell,
	carriedLink,
	type DaemonLink,
	type DeviceEndpoint,
	type Endpoints,
	type Kept,
	type KeptStore,
} from "../web/src/lib/browser-shell.ts";
import { fromBase64, toBase64 } from "../web/src/lib/bytes.ts";
import { NOTES, pairing, readPairingLink } from "../web/src/lib/pairing.ts";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (value: string) => new TextEncoder().encode(value);
const soon = () => new Promise((resolve) => setTimeout(resolve, 5));

/** A browser's storage and the endpoints it can bind, with what happened to them, in order. */
function world() {
	const log: string[] = [];
	let kept: Kept | undefined;
	let keys = 0;
	const store: KeptStore = {
		load: async () => {
			if (kept === undefined) {
				kept = { key: new Uint8Array(32).fill(++keys) };
				log.push(`kept a new key ${keys}`);
			}
			return kept;
		},
		keep: async (ticket) => {
			if (kept === undefined) return;
			kept = { key: kept.key, ticket };
			log.push(`kept ${ticket}`);
		},
		forget: async () => {
			kept = undefined;
			log.push("kept nothing");
		},
	};
	/** What the next `open` does, in turn; an `open` past the list succeeds. */
	const opens: ("gone" | "open")[] = [];
	/** How a dial of each ticket ends; one not named succeeds at once. `late` succeeds after the shell gave up. */
	const dials = new Map<string, "refused" | "never" | "late">();
	/** What a request written gets: the bytes of a response, in pieces, or a failure to write. */
	let answer: (request: string) => (string | Promise<string>)[] | "write fails" = () => [
		"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok",
	];
	/** Whether loading the endpoints fails: a browser that will not run them. */
	let broken = false;
	const connection = (ticket: string): DaemonLink => ({
		open: async () => {
			if (opens.shift() === "gone") {
				log.push("open: gone");
				throw new Error("connection lost");
			}
			return {
				send: async (request) => {
					log.push(`sent ${text(request).split("\r\n")[0]} to ${ticket}`);
					const pieces = answer(text(request));
					if (pieces === "write fails") throw new Error("the stream was reset");
					return new ReadableStream<Uint8Array>({
						async start(controller) {
							for (const piece of pieces) controller.enqueue(bytes(await piece));
							controller.close();
						},
						cancel: () => void log.push("the daemon's side was stopped"),
					});
				},
			};
		},
		close: () => void log.push(`closed the connection to ${ticket}`),
	});
	const endpoints: Endpoints = {
		bind: async (secret) => {
			const number = secret[0] as number;
			log.push(`bound ${number}`);
			const endpoint: DeviceEndpoint = {
				id: () => `device-${number}`,
				dial: async (ticket) => {
					log.push(`dial ${ticket}`);
					if (dials.get(ticket) === "refused") throw new Error("refused");
					if (dials.get(ticket) === "never") await new Promise(() => undefined);
					if (dials.get(ticket) === "late") await new Promise((resolve) => setTimeout(resolve, 60));
					return connection(ticket);
				},
				close: async () => void log.push(`closed ${number}`),
			};
			return endpoint;
		},
		computer: (ticket) => {
			if (!ticket.startsWith("ticket:")) throw new Error("not a ticket");
			return `daemon-${ticket.slice("ticket:".length)}`;
		},
	};
	const links: (string | undefined)[] = [];
	const shell = (link?: string) =>
		browserShell({
			load: async () => {
				if (broken) throw new Error("this browser will not run WebAssembly");
				return endpoints;
			},
			store,
			link,
			linked: (next) => void links.push(next),
			name: "A browser",
			dialMs: 30,
		});
	return {
		log,
		shell,
		opens,
		dials,
		links,
		kept: () => kept,
		answers: (next: typeof answer) => {
			answer = next;
		},
		breaks: (now: boolean) => {
			broken = now;
		},
	};
}

const get = { method: "GET", path: "/api/devices/pair", headers: {} };

describe("the browser's shell", () => {
	it("is a new device once, and the same one when the page opens again", async () => {
		const browser = world();
		expect(await browser.shell().state()).toEqual({ device: "device-1", name: "A browser" });
		// the key is kept before the endpoint is bound with it
		expect(browser.log).toEqual(["kept a new key 1", "bound 1"]);
		expect(await browser.shell().state()).toEqual({ device: "device-1", name: "A browser" });
		expect(browser.log.slice(2)).toEqual(["bound 1"]);
	});

	it("tries a code's daemon without keeping it: only an approval saves it, and anything else goes back", async () => {
		const browser = world();
		const shell = browser.shell();
		await expect(shell.request(get)).rejects.toMatchObject({ code: "UNREACHABLE" });
		await shell.setDaemon({ ticket: "ticket:a" });
		expect((await shell.state()).daemon).toBe("daemon-a");
		await shell.request(get);
		await shell.keepDaemon();
		expect(browser.kept()?.ticket).toBe("ticket:a");

		// another code: tried, asked, and let go of; the saved daemon is the one asked again, and still the one kept
		await shell.setDaemon({ ticket: "ticket:b" });
		expect((await shell.state()).daemon).toBe("daemon-b");
		await shell.request(get);
		await shell.revertDaemon();
		expect((await shell.state()).daemon).toBe("daemon-a");
		await shell.request(get);
		expect(browser.kept()?.ticket).toBe("ticket:a");
		// each daemon is asked on a connection of its own, and one let go of is closed
		expect(browser.log.filter((line) => /^(dial|sent|closed the)/.test(line))).toEqual([
			"dial ticket:a",
			"sent GET /api/devices/pair HTTP/1.1 to ticket:a",
			"closed the connection to ticket:a",
			"dial ticket:b",
			"sent GET /api/devices/pair HTTP/1.1 to ticket:b",
			"closed the connection to ticket:b",
			"dial ticket:a",
			"sent GET /api/devices/pair HTTP/1.1 to ticket:a",
		]);

		// the page opened again is that device, of that daemon
		expect(await browser.shell().state()).toEqual({ daemon: "daemon-a", device: "device-1", name: "A browser" });
	});

	it("refuses what is not a ticket, and changes nothing for it", async () => {
		const browser = world();
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		await expect(shell.setDaemon({ ticket: "https://example.com" })).rejects.toMatchObject({ code: "TICKET" });
		expect((await shell.state()).daemon).toBe("daemon-a");
	});

	it("sends a request as the daemon reads it, and gives its answer whole", async () => {
		const browser = world();
		const seen: string[] = [];
		browser.answers((request) => {
			seen.push(request);
			return [
				"HTTP/1.1 202 Accepted\r\ncontent-type: application/json\r\ntransfer-encoding: chunked\r\n\r\n",
				'13\r\n{"state":"pending"}\r\n',
				"0\r\n\r\n",
			];
		});
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		const answered = await shell.request({
			method: "POST",
			path: "/api/devices/pair",
			headers: { "content-type": "application/json", authorization: "Bearer never-sent" },
			body: toBase64(bytes('{"invite":"s","name":"A browser"}')),
		});
		expect(answered.status).toBe(202);
		expect(answered.headers).toEqual({ "content-type": "application/json" });
		expect(text(fromBase64(answered.body))).toBe('{"state":"pending"}');
		expect(seen).toEqual([
			'POST /api/devices/pair HTTP/1.1\r\nhost: banda\r\nconnection: close\r\ncontent-type: application/json\r\ncontent-length: 33\r\n\r\n{"invite":"s","name":"A browser"}',
		]);
	});

	it("dials once however many ask at once, and again only for a stream that could not be opened", async () => {
		const browser = world();
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		await Promise.all([shell.request(get), shell.request(get), shell.request(get)]);
		expect(browser.log.filter((line) => line.startsWith("dial"))).toEqual(["dial ticket:a"]);

		// the connection went away under it: nothing was written, so it is dialed once more and the request sent once
		browser.log.length = 0;
		browser.opens.push("gone");
		await shell.request(get);
		expect(browser.log).toEqual([
			"open: gone",
			"closed the connection to ticket:a",
			"dial ticket:a",
			"sent GET /api/devices/pair HTTP/1.1 to ticket:a",
		]);

		// gone again after the second dial: the daemon is not reached, and nothing was sent
		browser.log.length = 0;
		browser.opens.push("gone", "gone");
		await expect(shell.request(get)).rejects.toMatchObject({ code: "UNREACHABLE" });
		expect(browser.log.filter((line) => line.startsWith("sent"))).toEqual([]);
		expect(browser.log.filter((line) => line.startsWith("dial"))).toEqual(["dial ticket:a"]);
	});

	it("never sends a request twice: what breaks after the stream opened is told, not tried again", async () => {
		const browser = world();
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		browser.answers(() => "write fails");
		await expect(shell.request({ ...get, method: "POST" })).rejects.toMatchObject({ code: "BROKEN" });
		browser.answers(() => ["HTTP/1.1 200 OK\r\ncontent-length: 9\r\n\r\nshort"]);
		await expect(shell.request({ ...get, method: "POST" })).rejects.toMatchObject({ code: "BROKEN" });
		expect(browser.log.filter((line) => line.startsWith("sent"))).toHaveLength(2);
		expect(browser.log.filter((line) => line.startsWith("dial"))).toHaveLength(1);
	});

	it("says the daemon was not reached when a dial is refused or takes too long, and dials again the next time", async () => {
		const browser = world();
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		browser.dials.set("ticket:a", "refused");
		await expect(shell.request(get)).rejects.toMatchObject({ code: "UNREACHABLE" });
		browser.dials.set("ticket:a", "never");
		await expect(shell.request(get)).rejects.toMatchObject({ code: "UNREACHABLE" });
		browser.dials.delete("ticket:a");
		expect((await shell.request(get)).status).toBe(200);
		expect(browser.log.filter((line) => line.startsWith("dial"))).toHaveLength(3);
	});

	it("never uses a connection that came after its dial was given up on: it is closed, and requests go where they are meant", async () => {
		const browser = world();
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		await shell.request(get);
		await shell.keepDaemon();
		// a code whose daemon answers the dial only after the shell stopped waiting
		browser.dials.set("ticket:slow", "late");
		await shell.setDaemon({ ticket: "ticket:slow" });
		await expect(shell.request(get)).rejects.toMatchObject({ code: "UNREACHABLE" });
		await shell.revertDaemon();
		browser.log.length = 0;
		await shell.request(get);
		// the slow daemon's connection arrives now, and is closed unused
		await new Promise((resolve) => setTimeout(resolve, 80));
		await shell.request({ ...get, method: "POST" });
		expect(browser.log).toEqual([
			"dial ticket:a",
			"sent GET /api/devices/pair HTTP/1.1 to ticket:a",
			"closed the connection to ticket:slow",
			"sent POST /api/devices/pair HTTP/1.1 to ticket:a",
		]);
	});

	it("gives a stream's body as it comes, then its end; one the app stopped says nothing more", async () => {
		const browser = world();
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		const heard: string[] = [];
		await shell.addListener("chunk", ({ id, data }) => void heard.push(`${id} ${text(fromBase64(data))}`));
		const ended = shell.addListener(
			"end",
			({ id, error }) => void heard.push(`${id} ended${error === undefined ? "" : ` (${error})`}`),
		);
		browser.answers(() => ["HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\n", "data: 1\n\n", "data: 2\n\n"]);
		expect(await shell.stream({ id: "one", path: "/api/events", headers: {} })).toEqual({
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
		await soon();
		expect(heard).toEqual(["one data: 1\n\n", "one data: 2\n\n", "one ended"]);

		// stopped once its head has come: neither the rest of its body nor its end is told
		heard.length = 0;
		await shell.stream({ id: "two", path: "/api/events", headers: {} });
		await shell.cancel({ id: "two" });
		await soon();
		expect(heard.filter((line) => line.includes("ended"))).toEqual([]);

		// a listener taken away hears no more
		await (await ended).remove();
		await shell.stream({ id: "three", path: "/api/events", headers: {} });
		await soon();
		expect(heard.some((line) => line.startsWith("three ended"))).toBe(false);
	});

	it("stops a stream the app gave up on before its head came: the daemon's side is stopped and nothing is told", async () => {
		const browser = world();
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		const heard: string[] = [];
		await shell.addListener("chunk", ({ id }) => void heard.push(`${id} chunk`));
		await shell.addListener("end", ({ id }) => void heard.push(`${id} ended`));
		// the head is on its way for a while, as over a relay
		let arrive: (head: string) => void = () => {};
		const head = new Promise<string>((resolve) => {
			arrive = resolve;
		});
		browser.answers(() => [head, "data: 1\n\n", "data: 2\n\n"]);
		const asked = shell.stream({ id: "early", path: "/api/events", headers: {} });
		await soon();
		// what the app does when a view that opened the stream goes away at once
		await shell.cancel({ id: "early" });
		arrive("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\n\r\n");
		await asked;
		await soon();
		expect(heard).toEqual([]);
		expect(browser.log).toContain("the daemon's side was stopped");
	});

	it("forgets: the key and the daemon go, and the next device is a new one", async () => {
		const browser = world();
		const shell = browser.shell();
		await shell.setDaemon({ ticket: "ticket:a" });
		await shell.request(get);
		await shell.keepDaemon();
		await shell.forget();
		expect(browser.kept()).toBeUndefined();
		expect(browser.log).toContain("closed the connection to ticket:a");
		expect(browser.log).toContain("closed 1");
		expect(await shell.state()).toEqual({ device: "device-2", name: "A browser" });
		await expect(shell.request(get)).rejects.toMatchObject({ code: "UNREACHABLE" });
	});

	it("offers a pairing link until its daemon is tried, keeps it across a reload meanwhile, and lets go of it when the trial ends", async () => {
		const browser = world();
		const link = "banda://pair?ticket=ticket%3Aa&invite=s";
		const shell = browser.shell(link);
		expect((await shell.state()).link).toBe(link);
		// tried: the link is not offered a second time, its invite is asked once
		await shell.setDaemon({ ticket: "ticket:a" });
		expect((await shell.state()).link).toBeUndefined();
		// the page reloads while its owner walks to the computer: the link was not let go of, so the new page offers it
		expect(browser.links).toEqual([]);
		expect((await browser.shell(link).state()).link).toBe(link);
		// approved: finished with
		await shell.keepDaemon();
		expect(browser.links).toEqual([undefined]);
		expect((await shell.state()).link).toBeUndefined();

		// a link that comes while the page is open is told, kept, and let go of when its trial is given up
		const told: string[] = [];
		await shell.addListener("link", ({ url }) => void told.push(url));
		const next = "banda://pair?ticket=ticket%3Ab&invite=t";
		shell.opened(next);
		expect(told).toEqual([next]);
		expect((await shell.state()).link).toBe(next);
		await shell.setDaemon({ ticket: "ticket:b" });
		await shell.revertDaemon();
		expect(browser.links).toEqual([undefined, next, undefined]);
		expect((await shell.state()).link).toBeUndefined();
	});

	it("tries again to load its endpoint after a failure, and pairing offers that instead of waiting for ever", async () => {
		const browser = world();
		browser.breaks(true);
		const shell = browser.shell();
		const flow = pairing({
			shell: { ...shell, saveFile: async () => ({ saved: false }) },
			ask: async () => "pending",
			check: async () => "unpaired",
		});
		await flow.start();
		expect(flow.get()).toEqual({ step: "unreachable" });
		browser.breaks(false);
		await flow.start();
		expect(flow.get()).toEqual({ step: "scan", name: "A browser" });
		flow.stop();
	});

	it("reads a pairing an address carries after its # as the link the app's pairing reads, and nothing else as one", () => {
		const link = carriedLink("#pair?ticket=endpointabc&invite=s3cr-et_");
		expect(link).toBe("banda://pair?ticket=endpointabc&invite=s3cr-et_");
		expect(readPairingLink(link as string)).toEqual({ ticket: "endpointabc", invite: "s3cr-et_" });
		for (const hash of [
			"",
			"#",
			"#/c/12",
			"#pair?ticket=a",
			"#pair?invite=b",
			"#pair?ticket=&invite=b",
			"#token=abc",
			"#/pair?ticket=a&invite=b",
		])
			expect(carriedLink(hash), hash).toBeUndefined();
	});

	it("pairs from a link its owner pasted, in the form the app reads or the one a browser opens, and says so of other text", async () => {
		const flow = () =>
			pairing({
				shell: { ...world().shell(), saveFile: async () => ({ saved: false }) },
				ask: async () => "pending",
				check: async () => "unpaired",
			});
		for (const pasted of [
			"banda://pair?ticket=ticket%3Ahome&invite=s3cr-et_",
			// as it is copied on the computer, whatever came along with it
			"  https://app.banda.rocks/#pair?ticket=ticket%3Ahome&invite=s3cr-et_\n",
		]) {
			const pairs = flow();
			await pairs.start();
			await pairs.paste(pasted, " A laptop ");
			// the computer the link names is shown before anything is asked of it
			expect(pairs.get(), pasted).toEqual({
				step: "confirm",
				name: "A laptop",
				device: expect.any(String),
				computer: "daemon-home",
				link: { ticket: "ticket:home", invite: "s3cr-et_" },
			});
			pairs.stop();
		}
		for (const pasted of [
			"",
			"hello",
			"https://app.banda.rocks/",
			"https://app.banda.rocks/#/c/12",
			"https://app.banda.rocks/#pair?ticket=ticket%3Ahome",
			"http://app.banda.rocks/#pair?ticket=ticket%3Ahome&invite=s3cr-et_",
		]) {
			const pairs = flow();
			await pairs.start();
			await pairs.paste(pasted, "A laptop");
			expect(pairs.get(), pasted).toEqual({ step: "scan", name: "A laptop", note: NOTES.notALink });
			pairs.stop();
		}
	});
});
