/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

/**
 * A connection to one daemon, authenticated as the endpoint its ticket named.
 */
export class Daemon {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Close the connection: every stream on it ends.
     */
    close(): void;
    /**
     * The endpoint id of the daemon at the other end.
     */
    id(): string;
    /**
     * A bi-stream of its own on the connection, with nothing sent yet. It fails when the connection has gone, which
     * is the one failure that is safe to dial again for: no request was written.
     */
    open(): Promise<Exchange>;
}

/**
 * This browser as a device: its endpoint, bound with the device's key.
 */
export class Device {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Close the endpoint, and every connection with it.
     */
    close(): Promise<void>;
    /**
     * Bind an endpoint with `secret`, the device's key: 32 bytes the app made and keeps.
     */
    static create(secret: Uint8Array | number[]): Promise<Device>;
    /**
     * Dial the daemon a ticket names. The connection is the caller's to keep and to close: the endpoint keeps
     * none, so a dial that ends late can never take the place of the one the app is using.
     */
    dial(ticket: string): Promise<Daemon>;
    /**
     * This device's endpoint id: what the daemon knows it by.
     */
    id(): string;
}

/**
 * One exchange with the daemon: a stream opened, its request not yet written.
 */
export class Exchange {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Write `request` whole and finish, then the response's bytes as they come, until the daemon ends the stream.
     * Cancelling the stream stops the daemon's side.
     */
    send(request: Uint8Array | number[]): Promise<ReadableStream>;
}

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

/**
 * The endpoint id of the daemon a ticket names.
 */
export function computer(ticket: string): string;

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_daemon_free: (a: number, b: number) => void;
    readonly __wbg_device_free: (a: number, b: number) => void;
    readonly __wbg_exchange_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly computer: (a: number, b: number, c: number) => void;
    readonly daemon_close: (a: number) => void;
    readonly daemon_id: (a: number, b: number) => void;
    readonly daemon_open: (a: number) => any;
    readonly device_close: (a: number) => any;
    readonly device_create: (a: number, b: number) => any;
    readonly device_dial: (a: number, b: number, c: number) => any;
    readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly device_id: (a: number, b: number) => void;
    readonly exchange_send: (a: number, b: number, c: number) => any;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
    readonly intounderlyingbytesource_start: (a: number, b: any) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsink_abort: (a: number, b: any) => any;
    readonly intounderlyingsink_close: (a: number) => any;
    readonly intounderlyingsink_write: (a: number, b: any) => any;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: any) => any;
    readonly start: () => void;
    readonly __wasm_bindgen_func_elem_4062: (a: number, b: number, c: number, d: any) => void;
    readonly __wasm_bindgen_func_elem_4138: (a: number, b: number, c: any, d: any) => void;
    readonly __wasm_bindgen_func_elem_2007: (a: number, b: number, c: any) => void;
    readonly __wasm_bindgen_func_elem_7988: (a: number, b: number, c: any) => void;
    readonly __wasm_bindgen_func_elem_8551: (a: number, b: number, c: any) => void;
    readonly __wasm_bindgen_func_elem_5382: (a: number, b: number) => void;
    readonly __wasm_bindgen_func_elem_5400: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export4: (a: number) => void;
    readonly __wbindgen_export5: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_export6: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export7: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
