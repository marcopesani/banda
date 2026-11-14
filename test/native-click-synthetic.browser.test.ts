import { expect, it } from "vitest";
import { hasChrome, withPage } from "./smoke/chrome.ts";

const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>button {margin:40px;width:160px;height:44px} input {position:absolute;pointer-events:none;opacity:0}</style>
</head><body><form>
<button id="switch" type="button" role="switch" aria-checked="false">Requires an API key</button>
<input id="checkbox" type="checkbox" aria-hidden="true" tabindex="-1">
</form><script>
window.clicks = [];
const control = document.querySelector('#switch');
const checkbox = document.querySelector('#checkbox');
control.addEventListener('click', () => {
  control.setAttribute('aria-checked', 'true');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(checkbox, true);
  checkbox.dispatchEvent(new Event('click', {bubbles: true}));
});
document.querySelector('form').addEventListener('click', event => {
  clicks.push({target: event.target.id, trusted: event.isTrusted});
});
</script></body></html>`;
const url = `data:text/html,${encodeURIComponent(fixture)}`;

for (const width of [1440, 390]) {
	it.skipIf(!hasChrome())(`native click permits a switch's synthetic checkbox event at ${width}px`, async () => {
		await withPage(url, { width, height: 900 }, async (page) => {
			await page.click("document.querySelector('#switch')");
			expect(await page.run("document.querySelector('#switch').getAttribute('aria-checked')")).toBe("true");
			expect(await page.run("document.querySelector('#checkbox').checked")).toBe(true);
			expect(await page.run("clicks")).toEqual([
				{ target: "checkbox", trusted: false },
				{ target: "switch", trusted: true },
			]);
			expect(page.errors()).toEqual([]);
		});
	});
}
