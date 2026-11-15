/**
 * The contract between the app and a shell it is a device through (`transport.ts`): the phone's native one, a Capacitor
 * plugin, and the browser's on the app's own origin (`browser-shell.ts`). Only shapes: who implements them is not
 * this file's to know.
 */

/** A request's or a response's headers, as plain names (lower case) and values. */
export type HeaderMap = { readonly [name: string]: string };

/**
 * The contract the native shell implements, registered as the Capacitor plugin `Banda`
 * (`window.Capacitor.Plugins.Banda`). Bodies are base64 of their bytes, both ways, so files cross intact. `path` is
 * the request's whole path and query, `/api/...`, as the daemon routes it; the plugin sends it as one HTTP/1.1 request
 * on a bi-stream of its connection to the daemon (ALPN `banda/0`), and answers with what the daemon answered.
 */
export interface BandaPlugin {
	/** One request, answered whole. Rejects only when the daemon could not be reached; any status resolves. */
	request(options: {
		readonly method: string;
		readonly path: string;
		readonly headers: HeaderMap;
		/** Base64 of the body's bytes; absent for none. */
		readonly body?: string;
	}): Promise<{ readonly status: number; readonly headers: HeaderMap; readonly body: string }>;
	/**
	 * A request whose response is read as it comes (server-sent events): resolves with the response's head once it
	 * arrives, then delivers its body as `chunk` events for `id`, and one `end` when it is over. `id` is the app's.
	 */
	stream(options: {
		readonly id: string;
		readonly path: string;
		readonly headers: HeaderMap;
	}): Promise<{ readonly status: number; readonly headers: HeaderMap }>;
	/** Stop reading stream `id`: the plugin closes its Iroh stream and sends no more events for it. */
	cancel(options: { readonly id: string }): Promise<void>;
	addListener(event: "chunk", listener: (chunk: StreamChunk) => void): Promise<{ remove(): Promise<void> }>;
	addListener(event: "end", listener: (end: StreamEnd) => void): Promise<{ remove(): Promise<void> }>;
	/** A `banda://pair` link opened the shell while it ran (a camera app read the code). */
	addListener(event: "link", listener: (link: { readonly url: string }) => void): Promise<{ remove(): Promise<void> }>;
	/** Where the shell stands: the daemon it reaches, this device, and a pairing link it was opened with. */
	state(): Promise<ShellState>;
	/**
	 * Try the daemon a pairing link's ticket names: requests go to it, and the daemon the shell had is kept aside until
	 * `keepDaemon` or `revertDaemon`. Rejects (`TICKET`) when it is not a ticket.
	 */
	setDaemon(options: { readonly ticket: string }): Promise<void>;
	/** Keep the daemon being tried: it approved this phone. */
	keepDaemon(): Promise<void>;
	/** Stop trying a daemon: requests go to the one the shell had before, if any. */
	revertDaemon(): Promise<void>;
	/** Forget the daemon and this device's key: the next pairing is a new device (a revoked one cannot pair again). */
	forget(): Promise<void>;
	/**
	 * Save a file where the owner chooses, in the device's own save sheet: the shell's web view downloads nothing by
	 * itself. `body` is base64 of the bytes. Resolves `saved: false` when the owner closed the sheet; rejects (`SAVE`)
	 * when the place chosen refused the bytes.
	 */
	saveFile(options: {
		readonly name: string;
		readonly mimeType: string;
		readonly body: string;
	}): Promise<{ readonly saved: boolean }>;
}

/**
 * What the shell knows of itself. A request the plugin rejects carries a `code`: `UNREACHABLE` (the daemon could not
 * be reached) or `BROKEN`. Neither says what this device is: only the daemon's answer does (`GET /api/devices/pair`).
 */
export type ShellState = {
	/** The daemon's endpoint id; absent before a pairing link chose one. */
	readonly daemon?: string;
	/** This device's endpoint id, what the daemon's Settings → Devices lists it by. */
	readonly device: string;
	/** A name to suggest for this device: the phone's own. */
	readonly name: string;
	/** A `banda://pair` link the shell was opened with and has not paired with yet. */
	readonly link?: string;
};

/** The native shell's barcode scanner (`@capacitor/barcode-scanner`, registered as `CapacitorBarcodeScanner`). */
export interface ScannerPlugin {
	scanBarcode(options: {
		/** 0: a QR code. */
		readonly hint: number;
		readonly scanInstructions: string;
		readonly scanButton: boolean;
		readonly scanText: string;
		/** 1: the back camera. */
		readonly cameraDirection: number;
		/** 3: either way up. */
		readonly scanOrientation: number;
	}): Promise<{ readonly ScanResult: string }>;
}

/** Some of stream `id`'s body: base64 of its bytes, in order. */
export type StreamChunk = { readonly id: string; readonly data: string };
/** Stream `id` is over: the daemon ended it, or `error` says why it broke. */
export type StreamEnd = { readonly id: string; readonly error?: string };
