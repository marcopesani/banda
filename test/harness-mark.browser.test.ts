import { afterAll, beforeAll, expect, it } from "vitest";
import { type WebServer, webServer } from "./helpers.ts";
import { hasChrome, withPage } from "./smoke/chrome.ts";

// A harness's mark is named by the daemon and carried by the app's own files, which need not be the same build: the
// phone's app is installed apart from the daemon it pairs with. A mark the app lacks must give way, never show a blank.
let server: WebServer;
let url: string;

beforeAll(async () => {
	if (!hasChrome()) return;
	server = await webServer({
		plugins: [
			{
				name: "harness-mark:no-daemon",
				configResolved(config) {
					delete config.server.proxy;
				},
			},
		],
	});
	url = `${server.origin}/#/specimen?section=harness-states&only=1`;
});

afterAll(async () => {
	await server?.close();
});

const marks = `[...document.querySelectorAll('#harness-states img')]`;
/** Each mark's path and whether it drew: loaded with a size of its own. */
const drawn = `${marks}.map((img) => ({ src: new URL(img.src).pathname, drew: img.complete && img.naturalWidth > 0 }))`;

for (const width of [390, 1440])
	it.skipIf(!hasChrome())(
		`every harness mark draws, a missing one giving way to its provider's, at ${width}px`,
		async () => {
			await withPage(url, { width, height: 900 }, async (page) => {
				await page.until(`${marks}.length > 0 && ${marks}.every((img) => img.complete && img.naturalWidth > 0)`);
				const seen = await page.run<{ src: string; drew: boolean }[]>(drawn);
				expect(seen.filter((one) => !one.drew)).toEqual([]);
				// Claude's own mark, which banda ships, draws as itself
				expect(seen.some((one) => one.src === "/harnesses/claude-code.svg")).toBe(true);
				// a mark this build lacks is not asked for again: its provider's stands in
				expect(seen.some((one) => one.src === "/harnesses/not-in-this-build.svg")).toBe(false);
				const standIn = await page.run<string | undefined>(
					`(() => {
					let el = [...document.querySelectorAll('#harness-states span')].find((one) => one.textContent.startsWith("Its mark is one this app's files lack"));
					while (el && !el.querySelector('img')) el = el.parentElement;
					const img = el?.querySelector('img');
					return img ? new URL(img.src).pathname : undefined;
				})()`,
				);
				expect(standIn).toBe("/providers/anthropic.svg");
			});
		},
	);
