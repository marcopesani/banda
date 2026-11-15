import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Item, ShownWait } from "../src/server/api.ts";
import { view } from "../web/src/lib/chat.ts";
import { type WebServer, webServer } from "./helpers.ts";
import { hasChrome, withPage } from "./smoke/chrome.ts";

const first: ShownWait = {
	key: "kfirst23",
	chat: 1,
	call: "requests",
	deadline: 4_102_444_800_000,
	ask: {
		type: "approval",
		tool: "propose_send",
		args: { method: "POST", address: "https://example.test/first", body: "First request" },
		label: "Send first request",
		details: ["body"],
		scopes: [{ scope: "task", words: "Allow first requests for this task" }],
	},
};
const second: ShownWait = {
	...first,
	key: "ksecond45",
	ask: {
		...first.ask,
		type: "approval",
		tool: "propose_send",
		args: { method: "POST", address: "https://example.test/second", body: "Second request" },
		label: "Send second request",
		details: ["body"],
		scopes: [{ scope: "task", words: "Allow second requests for this task" }],
	},
};
const question: ShownWait = {
	key: "kquestion67",
	chat: 1,
	call: "question",
	deadline: first.deadline,
	ask: { type: "question", question: "Which request matters?", options: ["First", "Second"] },
};
const history: Item[] = [
	{
		id: 41,
		role: "assistant",
		text: "",
		calls: [
			{ id: "message", name: "message_user", args: { text: "Two requests need your review." } },
			{ id: "requests", name: "bash", args: { command: "node requests.js" } },
			{ id: "question", name: "ask_user", args: { question: "Which request matters?" } },
		],
	},
];
const live = { busy: false, thinking: false, running: [] };
const phases = [
	view([], [first, second, question], live),
	view(history, [first, second, question], live),
	view(history, [second, question], live),
	view(history, [{ ...second, key: "kreplacement89" }, question], live),
];
const fixturePath = fileURLToPath(new URL("../web/feed-waits-fixture.tsx", import.meta.url));
const facePath = fileURLToPath(new URL("../src/core/avatar-face.ts", import.meta.url));
let server: WebServer;

beforeAll(async () => {
	if (!hasChrome()) return;
	server = await webServer({
		plugins: [
			{
				name: "feed-waits-fixture",
				resolveId(id) {
					if (id === "/feed-waits-fixture.tsx") return fixturePath;
				},
				load(id) {
					if (id !== fixturePath) return;
					return `import React, { useState } from 'react';
				import { createRoot } from 'react-dom/client';
				import { FeedView } from '/src/app/Feed.tsx';
				import { defaultAvatarFace } from '/@fs${facePath}';
				import '/src/styles/globals.css';
				const phases = ${JSON.stringify(phases)};
				function Fixture() {
				 const [phase, setPhase] = useState(0);
				 window.showPhase = setPhase;
				 return <main data-phase={phase} style={{maxWidth:720,margin:'auto',padding:16,display:'flex',flexDirection:'column',gap:16}}>
				  <FeedView chat={1} who={{name:'Sancho',face:defaultAvatarFace()}} compact
				   segments={phases[phase]} onActivity={entry => { window.activityEntry = entry; }} />
				 </main>;
				}
				createRoot(document.getElementById('root')).render(<Fixture />);`;
				},
				configureServer(vite) {
					vite.middlewares.use((req, res, next) => {
						if (req.url?.split("?")[0] !== "/feed-waits-fixture") return next();
						void vite
							.transformIndexHtml(
								req.url,
								'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/feed-waits-fixture.tsx"></script></body></html>',
							)
							.then((html) => {
								res.setHeader("content-type", "text/html");
								res.end(html);
							});
					});
				},
			},
		],
	});
});
afterAll(async () => {
	await server?.close();
});

const card = (name: string) =>
	`([...document.querySelectorAll('[data-open-ask]')].find(el => el.textContent.includes(${JSON.stringify(name)})))`;
const checkbox = (name: string) => `${card(name)}.querySelector('[role="checkbox"]')`;

for (const width of [1440, 390])
	it.skipIf(!hasChrome())(
		`open waits retain distinct controls through history and wait replacement, at ${width}px`,
		async () => {
			await withPage(`${server.origin}/feed-waits-fixture`, { width, height: 1000 }, async (page) => {
				await page.until(`document.querySelectorAll('[data-open-ask]').length === 3`);
				await page.click(checkbox("Send first request"));
				await page.click(`${card("Send second request")}.querySelector('[data-slot="collapsible-trigger"]')`);
				await page.run(
					`window.firstScope = ${checkbox("Send first request")}; window.secondScope = ${checkbox("Send second request")}; window.questionChoice = ${card("Which request matters?")}.querySelector('button'); window.questionChoice.focus()`,
				);
				await page.run(`window.showPhase(1)`);
				await page.until(`document.querySelector('main').dataset.phase === '1'`);
				expect(await page.run(`document.querySelectorAll('[data-open-ask]').length`)).toBe(3);
				expect(await page.run(`${checkbox("Send first request")} === window.firstScope`)).toBe(true);
				expect(await page.run(`${checkbox("Send second request")} === window.secondScope`)).toBe(true);
				expect(await page.run(`window.firstScope.getAttribute('aria-checked')`)).toBe("true");
				expect(await page.run(`window.secondScope.getAttribute('aria-checked')`)).toBe("false");
				expect(
					await page.run(
						`${card("Send second request")}.querySelector('[data-slot="collapsible-trigger"]').getAttribute('aria-expanded')`,
					),
				).toBe("true");
				expect(
					await page.run(
						`${card("Which request matters?")}.querySelector('button') === window.questionChoice && document.activeElement === window.questionChoice`,
					),
				).toBe(true);
				expect(await page.run(`[...document.querySelectorAll('[data-open-ask]')].map(el => el.dataset.entry)`)).toEqual(
					["41", "41", "41"],
				);
				await page.click(`document.querySelector('[data-message-transcript]')`);
				await page.click(
					`[...document.querySelectorAll('[role="menuitem"]')].find(el => el.textContent.includes('Activity'))`,
				);
				await page.until(`window.activityEntry === 41`);
				await page.run(`window.showPhase(2)`);
				await page.until(`document.querySelector('main').dataset.phase === '2'`);
				expect(await page.run(`window.firstScope.isConnected`)).toBe(false);
				expect(await page.run(`${checkbox("Send second request")} === window.secondScope`)).toBe(true);
				await page.click(checkbox("Send second request"));
				await page.run(`window.showPhase(3)`);
				await page.until(`document.querySelector('main').dataset.phase === '3'`);
				expect(await page.run(`window.secondScope.isConnected`)).toBe(false);
				expect(await page.run(`${checkbox("Send second request")}.getAttribute('aria-checked')`)).toBe("false");
				expect(
					await page.run(
						`${card("Send second request")}.querySelector('[data-slot="collapsible-trigger"]').getAttribute('aria-expanded')`,
					),
				).toBe("false");
				expect(page.errors()).toEqual([]);
			});
		},
	);
