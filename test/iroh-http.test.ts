import http from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { frameRequest, readResponse } from "../web/src/lib/iroh-http.ts";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A stream of `pieces`, each as one read: how the bytes happen to arrive must not matter. */
const streamOf = (...pieces: (string | Uint8Array)[]) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (const piece of pieces)
				controller.enqueue(typeof piece === "string" ? new TextEncoder().encode(piece) : piece);
			controller.close();
		},
	});

/** Every way of cutting `whole` in two: a head or a chunk's size may be split anywhere. */
const cuts = (whole: string) =>
	Array.from({ length: whole.length - 1 }, (_, at) => [whole.slice(0, at + 1), whole.slice(at + 1)]);

describe("HTTP over an Iroh stream, as the browser's shell frames it", () => {
	it("frames a request the daemon's own server reads: its head, the app's headers but not the shell's, its body", async () => {
		// node:http, the server the daemon hands each stream to
		const seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
		const server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				seen.push({ method: req.method, url: req.url, headers: req.headers, body });
				res.end("ok");
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const bytes = frameRequest(
				"POST",
				"/api/devices/pair?x=1",
				{
					"Content-Type": "application/json",
					Authorization: "Bearer app",
					Host: "evil",
					"x-bad\r\nname": "v",
					"x-ok": "a\r\nb",
				},
				new TextEncoder().encode('{"invite":"ü"}'),
			);
			const answered = await new Promise<string>((resolve, reject) => {
				const socket = connect((server.address() as AddressInfo).port, "127.0.0.1", () => socket.write(bytes));
				let all = "";
				socket.on("data", (chunk) => {
					all += chunk;
				});
				socket.on("end", () => resolve(all));
				socket.on("error", reject);
			});
			expect(answered).toContain("200 OK");
			expect(seen).toEqual([
				{
					method: "POST",
					url: "/api/devices/pair?x=1",
					headers: {
						host: "banda",
						connection: "close",
						"accept-encoding": "gzip",
						"content-type": "application/json",
						"content-length": "15",
					},
					body: '{"invite":"ü"}',
				},
			]);
		} finally {
			server.close();
		}
	});

	it("refuses a path or a method that would write a second request", () => {
		expect(() => frameRequest("GET", "/a b", {})).toThrow("not a path");
		expect(() => frameRequest("GET", "/a\r\nx: y", {})).toThrow("not a path");
		expect(() => frameRequest("GET", "api", {})).toThrow("not a path");
		expect(() => frameRequest("GET /x HTTP/1.1\r\n", "/", {})).toThrow("not a method");
		expect(text(frameRequest("GET", "/", {}))).toBe(
			"GET / HTTP/1.1\r\nhost: banda\r\nconnection: close\r\naccept-encoding: gzip\r\n\r\n",
		);
	});

	it("reads a body by its length, in chunks, or to the stream's end, however the bytes are cut", async () => {
		const answers = {
			length: "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 11\r\n\r\nhello world",
			chunked:
				"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6;ext=1\r\n world\r\n0\r\nx-trailer: 1\r\n\r\n",
			toEnd: "HTTP/1.1 200 OK\r\n\r\nhello world",
		};
		for (const [kind, whole] of Object.entries(answers))
			for (const pieces of [[whole], ...cuts(whole)]) {
				const response = await readResponse(streamOf(...pieces));
				expect(response.status, kind).toBe(200);
				expect(response.headers.has("transfer-encoding"), kind).toBe(false);
				expect(await response.text(), `${kind} cut at ${pieces[0]?.length}`).toBe("hello world");
			}
	});

	it("reads a stream of events as they come, and stops the daemon's side when the app stops reading", async () => {
		let cancelled = false;
		let push: (text: string) => void = () => {};
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				push = (piece) => controller.enqueue(new TextEncoder().encode(piece));
			},
			cancel() {
				cancelled = true;
			},
		});
		push("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n");
		const response = await readResponse(source);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		push("7\r\ndata: 1\r\n");
		expect(text((await reader.read()).value as Uint8Array)).toBe("data: 1");
		push("8\r\ndata: 22\r\n");
		expect(text((await reader.read()).value as Uint8Array)).toBe("data: 22");
		await reader.cancel();
		expect(cancelled).toBe(true);
	});

	it("says it unpacks gzip whatever the app asked for, and hands the app a packed body unpacked", async () => {
		const head = text(
			frameRequest("GET", "/api/chats/1/items", { "accept-encoding": "br", accept: "application/json" }),
		);
		expect(head).toContain("\r\naccept-encoding: gzip\r\n");
		expect(head).not.toContain("br");
		const body = JSON.stringify({ items: Array.from({ length: 400 }, (_, id) => ({ id, text: `entry ${id}` })) });
		const packed = gzipSync(body);
		expect(packed.length).toBeLessThan(body.length / 3);
		const answers = {
			chunked: [
				"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nContent-Encoding: gzip\r\ntransfer-encoding: chunked\r\n\r\n",
				`${packed.length.toString(16)}\r\n`,
				packed.subarray(0, 7),
				packed.subarray(7),
				"\r\n0\r\n\r\n",
			],
			length: [
				`HTTP/1.1 200 OK\r\ncontent-encoding: gzip\r\ncontent-length: ${packed.length}\r\n\r\n`,
				packed.subarray(0, packed.length - 3),
				packed.subarray(packed.length - 3),
			],
		};
		for (const [kind, pieces] of Object.entries(answers)) {
			const response = await readResponse(streamOf(...pieces));
			// the body the app reads is the one the daemon made: nothing of how it travelled is left on it
			expect(response.headers.get("content-encoding"), kind).toBeNull();
			expect(response.headers.get("content-length"), kind).toBeNull();
			expect(await response.text(), kind).toBe(body);
		}
		// an answer that is not packed is read as it is
		const plain = await readResponse(streamOf("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok"));
		expect(await plain.text()).toBe("ok");
	});

	it("gives a status that carries no body none, and says what a broken answer broke on", async () => {
		const none = await readResponse(streamOf("HTTP/1.1 204 No Content\r\n\r\n"));
		expect(none.status).toBe(204);
		expect(none.body).toBeNull();
		await expect(readResponse(streamOf("SSH-2.0-nope\r\n\r\n"))).rejects.toThrow("not an HTTP response");
		await expect(readResponse(streamOf("HTTP/1.1 200 OK\r\ncontent-le"))).rejects.toThrow("ended inside the head");
		const short = await readResponse(streamOf("HTTP/1.1 200 OK\r\ncontent-length: 9\r\n\r\nshort"));
		await expect(short.text()).rejects.toThrow("ended inside the body");
		const cut = await readResponse(streamOf("HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n5\r\nhel"));
		await expect(cut.text()).rejects.toThrow("ended inside a chunk");
	});

	it("refuses a length or a chunk's size that is not a plain number, and never reads for ever by one", async () => {
		// a daemon that answers these is hostile or broken: each must end as an error, not as a read that never ends
		for (const length of ["-1", "5, 5", "five", "1e3", "0x10", "", " "])
			await expect(
				readResponse(streamOf(`HTTP/1.1 200 OK\r\ncontent-length: ${length}\r\n\r\nhello`)),
				JSON.stringify(length),
			).rejects.toThrow("not a length");
		for (const size of ["-5", "ffzz", "", "0x5", "5 5", "+5"]) {
			const response = await readResponse(
				streamOf(`HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n${size}\r\nhello\r\n0\r\n\r\n`),
			);
			await expect(
				Promise.race([
					response.text(),
					new Promise((_, reject) => setTimeout(() => reject(new Error("still reading")), 500)),
				]),
				JSON.stringify(size),
			).rejects.toThrow("no chunk size");
		}
		// a chunked answer's own length header is the framing's, and is not read by
		const both = await readResponse(
			streamOf("HTTP/1.1 200 OK\r\ncontent-length: -1\r\ntransfer-encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n"),
		);
		expect(await both.text()).toBe("hello");
	});
});
