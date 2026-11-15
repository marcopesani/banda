/**
 * The app's content security policy (DESIGN.md "The app"), here alone so the Vite config can import it. The daemon
 * serves the app with `APP_POLICY` as a header; the build also writes it into `index.html` as a `<meta>`, so the app
 * holds to it where no daemon serves it: the phone's shell loads the bundled files from its own local server. A meta
 * policy cannot say `frame-ancestors`, so the header adds it.
 *
 * What the app's frames may load is `FRAME_POLICY`: nothing. A page's frame is a sandboxed `srcdoc`, which no request
 * loads, so it still renders and its inline interactions work; a link that would navigate the frame elsewhere is
 * refused.
 */
export const FRAME_POLICY = "frame-src 'none'";

/** The policy the app holds to wherever it runs. */
export const APP_POLICY = [
	"default-src 'self'",
	"img-src 'self' data: blob: https:",
	// audio and video play from the bytes the page fetched with the token, as an object URL
	"media-src 'self' blob:",
	// the page reads back what it made itself (a file attached in the composer, as a blob: URL); nothing else
	"connect-src 'self' blob:",
	"style-src 'self' 'unsafe-inline'",
	"object-src 'none'",
	"base-uri 'none'",
	FRAME_POLICY,
].join("; ");

/** What the daemon sends: the app's policy, and that no other page may frame the app. */
export const SERVED_POLICY = `${APP_POLICY}; frame-ancestors 'none'`;

/**
 * The app's policy on an origin of its own (web/vercel.json), where it is a device through a browser's Iroh endpoint
 * (`web/src/lib/browser-shell.ts`): the app's policy, and no more than that endpoint needs. It is WebAssembly, so the
 * page may compile it; and it reaches n0's relays, and n0's lookup of where an endpoint is, which the page may connect
 * to. A daemon reached through a relay of the owner's own needs a build whose policy names that relay.
 */
export const HOSTED_POLICY = APP_POLICY.replace(
	"default-src 'self'",
	"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'",
).replace("connect-src 'self' blob:", "connect-src 'self' blob: https://*.iroh.link wss://*.iroh.link");

/** What the app's own origin sends: that policy, and that no other page may frame the app. */
export const HOSTED_SERVED_POLICY = `${HOSTED_POLICY}; frame-ancestors 'none'`;
