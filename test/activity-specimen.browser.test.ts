import { afterAll, beforeAll, expect, it } from "vitest";
import { type WebServer, webServer } from "./helpers.ts";
import { hasChrome, type Page, withPage } from "./smoke/chrome.ts";
import { chooseMessageAction } from "./smoke/message-actions.ts";

let server: WebServer;
let url: string;
beforeAll(async () => {
	if (!hasChrome()) return;
	server = await webServer();
	url = `${server.origin}/#/specimen/activity`;
});
afterAll(async () => {
	await server?.close();
});

async function press(page: Page, selector: string) {
	await page.run(`(() => {
		const el = ${selector};
		if (!el) throw new Error('Missing control: ' + ${JSON.stringify(selector)});
		el.scrollIntoView({block:'nearest'});
		if (typeof el.focus === 'function') el.focus();
		el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerType:'mouse'}));
		el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0}));
		el.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, button:0, pointerType:'mouse'}));
		el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, button:0}));
		el.click();
	})()`);
}
/** A message's activity control, as the app has it: the first message's, or the newest's. */
const first = `document.querySelector('[data-message-transcript]')`;
const newest = `[...document.querySelectorAll('[data-message-transcript]')].at(-1)`;
/** The step of the activity whose line reads `text`: its button, which opens it in place. */
const step = (text: string, n = 0) =>
	`[...document.querySelectorAll('[role="dialog"] [data-step] button[aria-expanded]')].filter(el => el.textContent.includes(${JSON.stringify(text)}))[${n}]`;
/** A tool call's card in the transcript, by the tool's name: closed cards hold nothing, so a test opens one first. */
const row = (title: string, n = 0) =>
	`[...document.querySelectorAll('[data-raw-content] [data-tool] [data-raw-title]')].filter(el => el.textContent === ${JSON.stringify(title)})[${n}]?.closest('button')`;
const button = (text: string) =>
	`[...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
const tab = (text: string) =>
	`[...document.querySelectorAll('[role="tab"]')].find(el => el.textContent.trim() === ${JSON.stringify(text)})`;
const dialogText = `document.querySelector('[role="dialog"]')?.textContent`;

for (const width of [320, 390, 1440]) {
	it.skipIf(!hasChrome())(`activity has two depths, completion and failure at ${width}px`, async () => {
		await withPage(url, { width, height: 900 }, async (page) => {
			await page.until(first);
			expect(await page.run(`document.body.textContent.includes('browser_navigate')`)).toBe(false);
			await press(page, tab("Dark"));
			await chooseMessageAction(page, first, "Activity");
			// the activity says the work in words, never in tool names
			await page.until(`${dialogText}?.includes('Messaged you')`);
			expect(await page.run(`getComputedStyle(document.querySelector('[role="dialog"]')).colorScheme`)).toBe("dark");
			expect(await page.run(`${dialogText}.includes('browser_navigate')`)).toBe(false);
			expect(await page.run(`${dialogText}.includes('renfe.com')`)).toBe(true);
			// a step opens in place, to what it brought back
			await press(page, step("thetrainline"));
			await page.until(`${dialogText}?.includes('08:00')`);
			expect(await page.run(`${step("thetrainline")}.getAttribute('aria-expanded')`)).toBe("true");
			// and leads to itself in the transcript, where its call arrives open
			await press(page, button("In the transcript"));
			await page.until(`${dialogText}?.includes('browser_navigate')`);
			expect(await page.run(`document.querySelectorAll('[role="dialog"]').length`)).toBe(1);
			expect(await page.run(`${tab("Transcript")}.getAttribute('aria-selected')`)).toBe("true");
			await page.until(`document.querySelector('[data-code-block="json"] span[style*="--code-"]')`);
			expect(
				await page.run(`document.querySelector('[data-code-block="json"] pre').innerText.includes('  "url"')`),
			).toBe(true);
			expect(await page.run(`${row("browser_navigate", 1)}.getAttribute('aria-expanded')`)).toBe("true");
			expect(
				await page.run(
					`(() => {const el=document.querySelector('[role="dialog"]'); return el.scrollWidth <= el.clientWidth;})()`,
				),
			).toBe(true);
			await press(page, tab("Activity"));
			await page.until(`${dialogText}?.includes('Messaged you')`);
			await press(page, button("Close"));
			await page.until(`!document.querySelector('[role="dialog"]')`);
			await page.until(`document.activeElement?.getAttribute('aria-label') === 'Message actions'`);

			await press(page, tab("Failure"));
			await page.until(`document.querySelectorAll('[data-message-transcript]').length === 2`);
			await chooseMessageAction(page, newest, "Activity");
			await page.until(`${dialogText}?.includes('Failed')`);
			// the step that failed says why, in place
			await press(page, step("Failed"));
			await page.until(`${dialogText}?.includes('ERR_CONNECTION_RESET')`);
			await press(page, tab("Transcript"));
			await page.until(`document.querySelector('[data-tool-state="error"]')`);
			await press(page, button("Close"));
			await page.until(`!document.querySelector('[role="dialog"]')`);

			await press(page, tab("Finished"));
			await page.until(`document.querySelector('[data-message-transcript]')`);
			await chooseMessageAction(page, newest, "Activity");
			await page.until(`${dialogText}?.includes('Finished')`);
			await press(page, tab("Transcript"));
			await page.until(`document.querySelector('[aria-label="Tools"]')`);
			// the model's context first, folded; then the conversation, the owner's words first
			expect(
				await page.run(
					`[...document.querySelector('[data-model-context]').children].map(el=>el.querySelector('button,h3')?.textContent.trim())`,
				),
			).toEqual(["System prompt", "Tools3"]);
			expect(
				await page.run(`document.querySelector('[data-raw-content] [data-message-bubble]').textContent.trim()`),
			).toContain("Find me a direct train");
			expect(await page.run(`${button("System prompt")}.getAttribute('aria-expanded')`)).toBe("false");
			expect(await page.run(`${button("Tools3")}.getAttribute('aria-expanded')`)).toBe("false");
			await press(page, button("Tools3"));
			expect(await page.run(`document.querySelector('[aria-label="Tools"]').querySelectorAll('button').length`)).toBe(
				4,
			);
			await press(page, button("System prompt"));
			await page.until(`${dialogText}?.includes('You are Mara')`);
			await press(page, button("System prompt"));
			expect(await page.run(`${dialogText}.includes('browser_navigate')`)).toBe(true);
			// what it told the owner reads as a message, and what the request took follows it
			expect(
				await page.run(
					`[...document.querySelectorAll('[data-raw-content] [data-tool] [data-raw-title]')].some(el => el.textContent === 'message_user')`,
				),
			).toBe(false);
			expect(await page.run(`document.querySelector('[data-request-meta]').textContent`)).toContain(
				"claude-sonnet-5-5",
			);
			expect(await page.run(`document.querySelector('[data-request-meta]').textContent`)).toContain("% cached");
			expect(await page.run(`document.querySelector('[data-work-total]').textContent`)).toContain("7 requests");
			await press(page, row("bash"));
			await page.until(`document.querySelector('[data-terminal] code span[style*="--code-"]')`);
			expect(
				await page.run(
					`document.querySelector('[data-terminal-output]').textContent.includes('2 trains arrive before noon')`,
				),
			).toBe(true);
			expect(
				await page.run(
					`[...document.querySelectorAll('[role="dialog"] pre')].every(el => el.scrollWidth <= el.clientWidth)`,
				),
			).toBe(true);
			expect(await page.run(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
			expect(page.errors()).toEqual([]);
		});
	});
}

for (const width of [390, 1440]) {
	it.skipIf(!hasChrome())(`a coding agent's step opens its session over the activity at ${width}px`, async () => {
		await withPage(url, { width, height: 900 }, async (page) => {
			const dialogs = `document.querySelectorAll('[role="dialog"]').length`;
			const open = `document.querySelector('[data-open-session="7"]')`;
			const over = `[...document.querySelectorAll('[role="dialog"]')].at(-1)`;
			await page.until(first);
			await press(page, tab("Coding agent"));
			await page.until(`document.body.textContent.includes('Claude Code fixed it')`);
			await chooseMessageAction(page, first, "Activity");
			// the step is named by the coding agent and what it was asked, never by its tool
			await page.until(`${dialogText}?.includes('Asked Claude Code')`);
			expect(await page.run(`${dialogText}.includes('harness__')`)).toBe(false);
			expect(await page.run(`${dialogText}.includes('Checked')`)).toBe(true);
			// a session no longer kept: the step says so and offers nothing to open
			await press(page, step("Asked Claude Code", 1));
			await page.until(`document.querySelector('[data-session-gone]')`);
			expect(await page.run(`document.querySelectorAll('[data-open-session]').length`)).toBe(0);
			// the one it started opens over the activity, from a button beside the way to the transcript
			await press(page, step("Asked Claude Code"));
			await page.until(open);
			expect(
				await page.run(`${open}.closest('[data-step]').querySelector('button[aria-expanded]').contains(${open})`),
			).toBe(false);
			await press(page, open);
			await page.until(`${dialogs} === 2`);
			await page.until(`${over}.textContent.includes('alert.py')`);
			await page.until(`${over}.contains(document.activeElement)`);
			expect(await page.run(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
			// closed, the activity is still there, as it was, and focus is on the button that opened the session
			await press(page, `[...${over}.querySelectorAll('button')].find(el => el.textContent.trim() === 'Close')`);
			await page.until(`${dialogs} === 1`);
			await page.until(`document.activeElement === ${open}`);
			expect(await page.run(`${step("Asked Claude Code")}.getAttribute('aria-expanded')`)).toBe("true");
			// the look at that session leads to it too
			await press(page, step("Checked"));
			await page.until(`document.querySelectorAll('[data-open-session="7"]').length === 2`);
			// and the step still leads to itself in the transcript
			await press(page, button("In the transcript"));
			await page.until(`${tab("Transcript")}.getAttribute('aria-selected') === 'true'`);
			await page.until(`${row("harness__claude_code")}?.getAttribute('aria-expanded') === 'true'`);
			expect(page.errors()).toEqual([]);
		});
	});
}

it.skipIf(!hasChrome())("streaming preserves inspection and keeps the sheet open when work completes", async () => {
	await withPage(url, { width: 390, height: 740 }, async (page) => {
		await page.until(first);
		await chooseMessageAction(page, first, "Activity");
		await page.until(step("Thinking"));
		await press(page, tab("Transcript"));
		// a thought being written is open, as it comes
		await page.until(`document.querySelector('[data-thinking]')`);
		await press(page, row("browser_navigate"));
		// Fonts and async highlighting can resize the transcript after the sheet first opens.
		await page.run(
			`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`,
		);
		await page.until(`document.querySelector('[data-code-block="json"] span[style*="--code-"]')`);
		// the transcript opens at its start and stays where the reader is while the run streams on
		await page.until(`[...document.querySelectorAll('button')].some(el => el.textContent.trim() === 'Latest')`);
		expect(await page.run(`document.querySelector('[data-raw-content]').parentElement.scrollTop`)).toBe(0);
		const before = await page.run<number>(`document.querySelector('[data-thinking]').textContent.length`);
		// the control sits in the chat behind the sheet: a pointer there would dismiss it, a click alone does not
		await page.run(`${button("Play stream")}.click()`);
		await page.until(`document.querySelector('[data-thinking]').textContent.length > ${before}`);
		expect(await page.run(`document.querySelector('[data-raw-content]').parentElement.scrollTop`)).toBe(0);
		// the run ends: the transcript is the recorded one, in the same open sheet, what was open still open
		await page.until(
			`document.querySelector('[data-work-total]') && !document.querySelector('[data-tool-state="running"]')`,
			30_000,
		);
		expect(await page.run(`document.querySelectorAll('[role="dialog"]').length`)).toBe(1);
		expect(await page.run(`${row("browser_navigate")}.getAttribute('aria-expanded')`)).toBe("true");
		expect(await page.run(`document.querySelector('[data-raw-content]').parentElement.scrollTop`)).toBe(0);
		await press(page, button("Latest"));
		await page.until(
			`(() => { const el=document.querySelector('[data-raw-content]').parentElement; return el.scrollHeight - el.clientHeight - el.scrollTop < 5; })()`,
		);
		expect(page.errors()).toEqual([]);
	});
});
