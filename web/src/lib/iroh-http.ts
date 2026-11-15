/**
 * HTTP/1.1 over one Iroh bi-stream, as the daemon serves it (`src/server/remote.ts`): one request a stream, the response
 * ended by the daemon (`connection: close`). The same framing as the phone's shell (`mobile/.../Http.kt`), for the
 * browser's (`browser-shell.ts`): a head, then a body that is chunked, has a length, or runs to the stream's end.
 */

/** Headers the shell sets itself: the app's would contradict the framing. */
const OWN = new Set(["host", "connection", "content-length", "transfer-encoding", "authorization", "accept-encoding"]);

const encoder = new TextEncoder();

/** A request's bytes: its head, then `body` when there is one. */
export function frameRequest(
	method: string,
	path: string,
	headers: Readonly<Record<string, string>>,
	body?: Uint8Array,
): Uint8Array {
	if (!path.startsWith("/") || /[\r\n ]/.test(path)) throw new Error(`not a path: ${path}`);
	if (!/^[A-Z]+$/.test(method)) throw new Error(`not a method: ${method}`);
	// the daemon ignores Host over Iroh; HTTP/1.1 needs one
	// a body may come through a relay that carries little: the daemon packs what it sends a device that says it unpacks
	let head = `${method} ${path} HTTP/1.1\r\nhost: banda\r\nconnection: close\r\naccept-encoding: gzip\r\n`;
	for (const [name, value] of Object.entries(headers)) {
		const key = name.toLowerCase();
		if (OWN.has(key) || !/^[a-z0-9-]+$/.test(key) || /[\r\n]/.test(value)) continue;
		head += `${key}: ${value}\r\n`;
	}
	if (body !== undefined) head += `content-length: ${body.length}\r\n`;
	const bytes = encoder.encode(`${head}\r\n`);
	if (body === undefined) return bytes;
	const whole = new Uint8Array(bytes.length + body.length);
	whole.set(bytes);
	whole.set(body, bytes.length);
	return whole;
}

/** A status that carries no body: a `Response` refuses one. */
const bodiless = (status: number) => status === 204 || status === 205 || status === 304;

/** The longest line a head or a chunk's size may be. */
const LINE = 64 * 1024;

/** The response a stream of the daemon's bytes carries: resolves once its head has come, its body read as it comes. */
export async function readResponse(stream: ReadableStream<Uint8Array>): Promise<Response> {
	const reader = stream.getReader();
	let buffer: Uint8Array = new Uint8Array(0);
	let at = 0;
	let ended = false;

	const more = async () => {
		if (ended) return false;
		const { value, done } = await reader.read();
		if (done) {
			ended = true;
			return false;
		}
		if (at === buffer.length) buffer = value;
		else {
			const joined = new Uint8Array(buffer.length - at + value.length);
			joined.set(buffer.subarray(at));
			joined.set(value, buffer.length - at);
			buffer = joined;
		}
		at = 0;
		return true;
	};
	const line = async () => {
		let text = "";
		for (;;) {
			while (at < buffer.length) {
				const byte = buffer[at++] as number;
				if (byte === 10) return text.endsWith("\r") ? text.slice(0, -1) : text;
				text += String.fromCharCode(byte);
				if (text.length > LINE) throw new Error("a line too long");
			}
			if (!(await more())) throw new Error("the stream ended inside the head");
		}
	};
	const take = (count: number) => {
		const piece = buffer.slice(at, at + count);
		at += count;
		return piece;
	};

	let status: number;
	const headers = new Headers();
	try {
		const first = (await line()).split(" ");
		if (first.length < 2 || !first[0]?.startsWith("HTTP/1.")) throw new Error("not an HTTP response");
		status = Number(first[1]);
		if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error("no status");
		for (;;) {
			const header = await line();
			if (header === "") break;
			const colon = header.indexOf(":");
			if (colon > 0) headers.append(header.slice(0, colon).trim(), header.slice(colon + 1).trim());
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	}
	const chunked = (headers.get("transfer-encoding") ?? "").toLowerCase().includes("chunked");
	// a length is digits and nothing else: one that is not (negative, two of them, words) is no answer to read by
	const stated = headers.get("content-length");
	if (!chunked && stated !== null && !/^\d{1,15}$/.test(stated)) {
		await reader.cancel().catch(() => {});
		throw new Error("not a length");
	}
	const length = stated === null ? undefined : Number(stated);
	/** What is left of the body, or of the chunk being read; undefined when it runs to the stream's end. */
	let left = chunked ? 0 : (length ?? (bodiless(status) ? 0 : undefined));
	// what the shell framed is its own business: the app reads a body, whole
	headers.delete("transfer-encoding");

	/** The next of the body's bytes as they come; undefined once it is over. */
	const next = async (): Promise<Uint8Array | undefined> => {
		if (chunked) {
			if (left === 0) {
				// a size is hex digits and nothing else: `parseInt` would read past a sign or stop at the first stray letter
				const written = (await line()).split(";")[0]?.trim() ?? "";
				if (!/^[0-9a-fA-F]{1,12}$/.test(written)) throw new Error("no chunk size");
				const size = Number.parseInt(written, 16);
				if (size === 0) {
					// trailers, then the end
					while ((await line()) !== "") {}
					return undefined;
				}
				left = size;
			}
			if (at === buffer.length && !(await more())) throw new Error("the stream ended inside a chunk");
			const piece = take(Math.min(left as number, buffer.length - at));
			left = (left as number) - piece.length;
			if (left === 0 && (await line()) !== "") throw new Error("a chunk without its end");
			return piece;
		}
		if (left === undefined) return at === buffer.length && !(await more()) ? undefined : take(buffer.length - at);
		if (left === 0) return undefined;
		if (at === buffer.length && !(await more())) throw new Error("the stream ended inside the body");
		const piece = take(Math.min(left, buffer.length - at));
		left -= piece.length;
		return piece;
	};

	if (bodiless(status)) {
		await reader.cancel().catch(() => {});
		return new Response(null, { status, headers });
	}
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const piece = await next();
				if (piece === undefined) {
					controller.close();
					await reader.cancel().catch(() => {});
				} else controller.enqueue(piece);
			} catch (error) {
				controller.error(error);
				await reader.cancel().catch(() => {});
			}
		},
		// the app stopped reading: the daemon's side of the Iroh stream is stopped
		cancel: (reason) => reader.cancel(reason),
	});
	// packed by the daemon for the way here: the app reads the body it would have read on the daemon's own page
	if ((headers.get("content-encoding") ?? "").toLowerCase() === "gzip") {
		headers.delete("content-encoding");
		headers.delete("content-length");
		const unpacked = body.pipeThrough(new DecompressionStream("gzip") as ReadableWritablePair<Uint8Array, Uint8Array>);
		return new Response(unpacked, { status, headers });
	}
	return new Response(body, { status, headers });
}
