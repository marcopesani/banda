/**
 * How the app reaches the daemon. Served by the daemon, the page's own origin: `fetch`, with the owner's token. In the
 * phone's native shell (Capacitor), through its `Banda` plugin, which speaks the same HTTP API to the daemon over an
 * Iroh stream: the shell's endpoint is a paired device, and that identity is what lets a request in, so no token is
 * sent. On the app's own origin, the same through the browser's shell (`browser-shell.ts`), which keeps that plugin's
 * contract. Every way the app reads a `Response`, so nothing above this file knows which.
 */

import { fromBase64, toBase64 } from "./bytes.ts";
import type { BandaPlugin, HeaderMap, ScannerPlugin } from "./device-shell.ts";
import { hostedShell } from "./hosted-shell.ts";

export type { BandaPlugin, HeaderMap, ScannerPlugin, ShellState, StreamChunk, StreamEnd } from "./device-shell.ts";

/** What `api.ts` sends its requests through. */
export type Transport = {
	/** The transport itself says who asks (a paired device): no token is kept or sent. */
	readonly identified: boolean;
	request(path: string, init?: RequestInit): Promise<Response>;
	/** The same, for a response read as it comes. */
	stream(path: string, init?: RequestInit): Promise<Response>;
};

/** The page's own origin: what a browser opened from the daemon's link uses. */
export const sameOrigin: Transport = {
	identified: false,
	request: (path, init) => fetch(path, init),
	stream: (path, init) => fetch(path, init),
};

export { toBase64 };

const headersOf = (init: RequestInit | undefined): HeaderMap =>
	Object.fromEntries(new Headers(init?.headers).entries());

/** A status that carries no body: a `Response` refuses one. */
const bodiless = (status: number) => status === 204 || status === 205 || status === 304;

const aborted = (signal: AbortSignal) =>
	signal.reason instanceof Error ? signal.reason : new DOMException("The request was aborted", "AbortError");

/** Requests and streams through the native shell's plugin. */
export function nativeTransport(plugin: BandaPlugin, newId: () => string = () => crypto.randomUUID()): Transport {
	// one listener of each kind for every stream, routed by id
	const streams = new Map<string, { chunk: (data: Uint8Array) => void; end: (error?: string) => void }>();
	let listening: Promise<unknown> | undefined;
	const listen = () => {
		listening ??= Promise.all([
			plugin.addListener("chunk", ({ id, data }) => streams.get(id)?.chunk(fromBase64(data))),
			plugin.addListener("end", ({ id, error }) => streams.get(id)?.end(error)),
		]);
		return listening;
	};

	return {
		identified: true,
		async request(path, init) {
			const signal = init?.signal ?? undefined;
			if (signal?.aborted) throw aborted(signal);
			const bytes = init?.body == null ? undefined : new Uint8Array(await new Response(init.body).arrayBuffer());
			const asked = plugin.request({
				method: init?.method ?? "GET",
				path,
				headers: headersOf(init),
				...(bytes === undefined ? {} : { body: toBase64(bytes) }),
			});
			// the plugin has no way to stop a request: an abort leaves its answer unread
			const answer = await (signal === undefined
				? asked
				: Promise.race([
						asked,
						new Promise<never>((_, reject) =>
							signal.addEventListener("abort", () => reject(aborted(signal)), { once: true }),
						),
					]));
			return new Response(bodiless(answer.status) ? null : fromBase64(answer.body), {
				status: answer.status,
				headers: answer.headers,
			});
		},
		async stream(path, init) {
			const signal = init?.signal ?? undefined;
			if (signal?.aborted) throw aborted(signal);
			await listen();
			const id = newId();
			let control: ReadableStreamDefaultController<Uint8Array> | undefined;
			let over = false;
			const finish = () => {
				over = true;
				streams.delete(id);
			};
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					control = controller;
				},
				cancel() {
					if (over) return;
					finish();
					void plugin.cancel({ id }).catch(() => {});
				},
			});
			streams.set(id, {
				chunk: (data) => control?.enqueue(data),
				end: (error) => {
					finish();
					if (error === undefined) control?.close();
					else control?.error(new Error(error));
				},
			});
			const stop = () => {
				if (over) return;
				finish();
				void plugin.cancel({ id }).catch(() => {});
				control?.error(aborted(signal as AbortSignal));
			};
			signal?.addEventListener("abort", stop, { once: true });
			try {
				const head = await plugin.stream({ id, path, headers: headersOf(init) });
				if (signal?.aborted) throw aborted(signal);
				return new Response(bodiless(head.status) ? null : body, { status: head.status, headers: head.headers });
			} catch (error) {
				signal?.removeEventListener("abort", stop);
				if (!over) {
					finish();
					void plugin.cancel({ id }).catch(() => {});
				}
				throw error;
			}
		},
	};
}

/** What the page sees of a Capacitor shell: enough to find the plugin, nothing more. */
export type CapacitorGlobal = {
	readonly Capacitor?: {
		readonly isNativePlatform?: () => boolean;
		readonly Plugins?: { readonly Banda?: BandaPlugin; readonly CapacitorBarcodeScanner?: ScannerPlugin };
	};
};

/** The native shell's plugins, when the page runs in it. */
export function nativeShell(
	global: CapacitorGlobal = globalThis as CapacitorGlobal,
): { readonly banda: BandaPlugin; readonly scanner?: ScannerPlugin } | undefined {
	const capacitor = global.Capacitor;
	const banda = capacitor?.Plugins?.Banda;
	if (banda === undefined || capacitor?.isNativePlatform?.() !== true) return undefined;
	const scanner = capacitor.Plugins?.CapacitorBarcodeScanner;
	return scanner === undefined ? { banda } : { banda, scanner };
}

/** Whether this is the build the app's own origin serves, set by web/vite.config.ts; no other build defines it true. */
declare const __BANDA_HOSTED__: boolean | undefined;

/**
 * The shell the app is a device through: the phone's native one, or, in the build its own origin serves, the
 * browser's (`browser-shell.ts`). A build the daemon serves has neither, and is made without the browser's.
 */
export function deviceShell(
	global: CapacitorGlobal = globalThis as CapacitorGlobal,
): { readonly banda: BandaPlugin; readonly scanner?: ScannerPlugin } | undefined {
	const native = nativeShell(global);
	if (native !== undefined) return native;
	return typeof __BANDA_HOSTED__ !== "undefined" && __BANDA_HOSTED__ ? { banda: hostedShell() } : undefined;
}

/** The shell's plugin when the app is a device through one; otherwise the page's own origin. */
export function pickTransport(global: CapacitorGlobal = globalThis as CapacitorGlobal): Transport {
	const shell = deviceShell(global);
	return shell === undefined ? sameOrigin : nativeTransport(shell.banda);
}
