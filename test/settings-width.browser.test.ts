/**
 * Settings keeps its column where it is from tab to tab: a tab tall enough to scroll must not narrow or shift the
 * column against one that fits (the pane reserves the scrollbar's gutter whether or not a bar shows), at every width.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { type WebServer, webServer } from "./helpers.ts";
import { hasChrome, type Page, withPage } from "./smoke/chrome.ts";

let server: WebServer;
beforeAll(async () => {
	if (!hasChrome()) return;
	server = await webServer();
});
afterAll(async () => {
	await server?.close();
});

const tab = (text: string) =>
	`[...document.querySelectorAll('[role="tab"]')].find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
/** The settings column: what the tabs sit in, centred under the page's header. */
const column = `document.querySelector('[data-slot="tabs"]').parentElement`;
/** A tab opens on the mouse going down, as Radix has it. */
async function open(page: Page, name: string) {
	await page.run(`(() => {
		const el = ${tab(name)};
		el.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'}));
		el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
		el.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, button: 0, pointerType: 'mouse'}));
		el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0}));
		el.click();
	})()`);
	await page.until(`${tab(name)}.getAttribute('aria-selected') === 'true'`);
}
/** The column's place once the page's fonts are in and the frame is laid out. */
const box = (page: Page, name: string) =>
	page.run<{ name: string; x: number; width: number; scrolls: boolean; wide: boolean }>(`document.fonts.ready
	.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
	.then(() => {
		const column = ${column};
		const pane = column.parentElement;
		const { x, width } = column.getBoundingClientRect();
		return { name: ${JSON.stringify(name)}, x, width, scrolls: pane.scrollHeight > pane.clientHeight, wide: pane.scrollWidth > pane.clientWidth };
	})`);

for (const width of [390, 820, 1440]) {
	it.skipIf(!hasChrome())(`the settings column holds its place from tab to tab at ${width}px`, async () => {
		// the specimen's settings section at the stage of this width: the band beside it on the desktop, alone on a phone
		const url = `${server.origin}/#/specimen?section=settings&only=1&scheme=light&width=${width < 768 ? "phone" : "desktop"}`;
		await withPage(url, { width, height: 900 }, async (page) => {
			await page.until(tab("Model"));
			await open(page, "General");
			const general = await box(page, "General");
			// a tab that fits beside one that scrolls is where the two could part
			const tabs = ["Model", "Connections", "Agents"];
			const seen = [general];
			for (const name of tabs) {
				await open(page, name);
				seen.push(await box(page, name));
			}
			expect(seen.map((one) => one.scrolls)).toContain(true);
			expect(seen.map((one) => one.scrolls)).toContain(false);
			for (const one of seen) {
				expect(one, one.name).toMatchObject({ x: general.x, width: general.width, wide: false });
			}
			expect(page.errors()).toEqual([]);
		});
	});
}
