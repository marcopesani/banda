/**
 * A routine's run opened in its line when reading it goes wrong, against a stub of the daemon's API that fails on
 * cue: a read that got no answer says so in the box, with Try again, and the next read shows the run; the daemon's
 * own "no such chat" is gone for good, with nothing to try; an earlier page that could not be read says so in its
 * place, with Try again, while what was read stays, and the page read again joins it once. No failure leaves the page
 * an unhandled rejection. At phone and desktop width. `BANDA_RUN_ERROR_SHOTS=<dir>` saves a screenshot of each failure.
 */
import { mkdir } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type WebServer, webServer } from "./helpers.ts";
import { hasChrome, withPage } from "./smoke/chrome.ts";

const SHOTS = process.env.BANDA_RUN_ERROR_SHOTS;
const ASK = "Tell me which pull requests need me, in a line each.";
const SAID = "2 pull requests need you: #34 has red checks, #35 waits on a review.";
const EARLIER = "Reading the pull requests now.";

const fixturePath = fileURLToPath(new URL("../web/routine-run-errors-fixture.tsx", import.meta.url));
const facePath = fileURLToPath(new URL("../src/core/avatar-face.ts", import.meta.url));

/** The lines on the page: each line's entry in chat 1, the run it stands for, and the run's items by page. */
const LINES = { "Flaky brief ran": 10, "Gone brief ran": 11, "Long brief ran": 12 } as const;
const RUNS: Record<number, number> = { 10: 101, 11: 102, 12: 103 };
const wake = (id: number) => ({ id, role: "wake", routine: "morning-brief", text: "Morning brief", ask: ASK, at: 1 });
/** The agent's message: a `message_user` call and its result, as the daemon records them. */
const said = (id: number, text: string, at: number) => [
	{ id, role: "assistant", text: "", calls: [{ id: `m${id}`, name: "message_user", args: { text } }], at },
	{ id: id + 1, role: "tool", call: `m${id}`, name: "message_user", text: "Sent.", error: false, at },
];
const PAGES: Record<string, { items: object[]; next?: number }> = {
	"/chats/101/items": { items: [wake(5), ...said(6, SAID, 2)] },
	"/chats/103/items": { items: said(21, SAID, 3), next: 11 },
	"/chats/103/items?before=11": { items: [wake(10), ...said(11, EARLIER, 2)] },
};

/** The requests (paths under /api) that fail with 503 while they are here: the test puts them in and takes them out. */
const failing = new Set<string>();
/** Every request made, as paths under /api. */
const asked: string[] = [];

let server: WebServer;

function json(res: ServerResponse, status: number, body: unknown) {
	res.statusCode = status;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify(body));
}

beforeAll(async () => {
	if (!hasChrome()) return;
	server = await webServer({
		plugins: [
			{
				name: "routine-run-errors-fixture",
				resolveId(id) {
					if (id === "/routine-run-errors-fixture.tsx") return fixturePath;
				},
				load(id) {
					if (id !== fixturePath) return;
					return `import React, { StrictMode } from 'react';
					import { createRoot } from 'react-dom/client';
					import { RunLine } from '/src/app/RunLine.tsx';
					import { defaultAvatarFace } from '/@fs${facePath}';
					import '/src/styles/globals.css';
					const who = { name: 'Sancho', face: defaultAvatarFace() };
					const lines = ${JSON.stringify(LINES)};
					function Fixture() {
					 return <main style={{maxWidth:720,margin:'auto',padding:16,display:'flex',flexDirection:'column',gap:12}}>
					  {Object.entries(lines).map(([words, entry]) =>
					   <RunLine key={entry} chat={1} entry={entry} words={words} who={who} agent="sancho" />)}
					 </main>;
					}
					createRoot(document.getElementById('root')).render(<StrictMode><Fixture /></StrictMode>);`;
				},
				configureServer(vite) {
					vite.middlewares.use((req, res, next) => {
						const url = req.url ?? "";
						const path = url.split("?")[0] ?? "";
						if (path === "/routine-run-errors-fixture") {
							void vite
								.transformIndexHtml(
									url,
									'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/routine-run-errors-fixture.tsx"></script></body></html>',
								)
								.then((html) => {
									res.setHeader("content-type", "text/html");
									res.end(html);
								});
							return;
						}
						if (!path.startsWith("/api/")) return next();
						const under = url.slice("/api".length);
						const route = path.slice("/api".length);
						asked.push(under);
						if (path === "/api/events") {
							res.setHeader("content-type", "text/event-stream");
							res.write(": fixture\n\n");
							return;
						}
						if (failing.has(under)) return json(res, 503, { error: "boom" });
						const run = /^\/chats\/1\/items\/(\d+)\/run$/.exec(route);
						if (run !== null) return json(res, 200, { run: RUNS[Number(run[1])] });
						const page = PAGES[under];
						if (page !== undefined) return json(res, 200, page);
						// the daemon's own word for a chat it does not have (src/server/http.ts)
						if (/^\/chats\/\d+\/items/.test(route)) return json(res, 404, { error: "no such chat" });
						json(res, 200, {});
					});
				},
			},
		],
	});
});
afterAll(async () => {
	await server?.close();
});

const toggle = (words: string) =>
	`document.querySelector('button[data-run-toggle][aria-label^=${JSON.stringify(words)}]')`;
const box = (words: string) => `${toggle(words)}.parentElement.parentElement.querySelector('[data-routine-run]')`;
const text = (words: string) => `(${box(words)}?.innerText ?? '')`;
const button = (words: string, label: string) =>
	`[...(${box(words)}?.querySelectorAll('button') ?? [])].find((el) => el.innerText.trim() === ${JSON.stringify(label)})`;
const count = (words: string, said: string) => `${text(words)}.split(${JSON.stringify(said)}).length - 1`;

for (const width of [390, 1440])
	it.skipIf(!hasChrome())(
		`a run's line says what could not be read and reads again on Try again, at ${width}`,
		async () => {
			if (SHOTS !== undefined) await mkdir(SHOTS, { recursive: true });
			failing.clear();
			asked.length = 0;
			await withPage(
				`${server.origin}/routine-run-errors-fixture#token=run-test`,
				{ width, height: 900 },
				async (page) => {
					const shot = async (name: string) => {
						expect(
							await page.run("document.documentElement.scrollWidth <= innerWidth"),
							`${name}: no sideways scroll`,
						).toBe(true);
						if (SHOTS !== undefined) await page.shoot(join(SHOTS, `${width}-${name}.png`));
					};
					await page.until(`${toggle("Long brief ran")} !== null`);

					// the read got no answer: said in the box, with Try again; the next read shows the run
					failing.add("/chats/101/items");
					await page.click(toggle("Flaky brief ran"));
					await page.until(`${text("Flaky brief ran")}.includes('The run could not be read')`);
					expect(await page.run(text("Flaky brief ran"))).toContain("hit a problem");
					expect(await page.run(`${button("Flaky brief ran", "Try again")} !== undefined`)).toBe(true);
					await shot("1-read-failed");
					const failed = asked.filter((path) => path === "/chats/101/items").length;
					expect(failed).toBeGreaterThanOrEqual(1);
					failing.delete("/chats/101/items");
					await page.click(button("Flaky brief ran", "Try again"));
					await page.until(`${text("Flaky brief ran")}.includes(${JSON.stringify(SAID)})`);
					expect(await page.run(text("Flaky brief ran"))).not.toContain("could not be read");
					// Try again read it again, once
					expect(asked.filter((path) => path === "/chats/101/items")).toHaveLength(failed + 1);
					// the line itself was asked which run it stands for once: the run was known, only its read failed
					expect(asked.filter((path) => path === "/chats/1/items/10/run")).toHaveLength(1);

					// the daemon said there is no such chat: gone, and nothing to try
					await page.click(toggle("Gone brief ran"));
					await page.until(`${text("Gone brief ran")}.includes("This run's conversation is gone")`);
					expect(await page.run(`${button("Gone brief ran", "Try again")} === undefined`)).toBe(true);
					expect(await page.run(text("Gone brief ran"))).not.toContain("could not be read");

					// an earlier page that could not be read: said in its place with Try again, and what was read stays
					await page.click(toggle("Long brief ran"));
					await page.until(`${button("Long brief ran", "Show earlier")} !== undefined`);
					expect(await page.run(count("Long brief ran", SAID))).toBe(1);
					failing.add("/chats/103/items?before=11");
					await page.click(button("Long brief ran", "Show earlier"));
					await page.until(`${text("Long brief ran")}.includes('Earlier messages could not be read')`);
					expect(await page.run(count("Long brief ran", SAID))).toBe(1);
					expect(await page.run(`${button("Long brief ran", "Show earlier")} === undefined`)).toBe(true);
					await shot("2-earlier-failed");
					// read again: the page joins what was read, once, and there is no earlier page to show
					failing.delete("/chats/103/items?before=11");
					await page.click(button("Long brief ran", "Try again"));
					await page.until(`${text("Long brief ran")}.includes(${JSON.stringify(EARLIER)})`);
					expect(await page.run(text("Long brief ran"))).not.toContain("could not be read");
					expect(await page.run(count("Long brief ran", SAID))).toBe(1);
					expect(await page.run(count("Long brief ran", EARLIER))).toBe(1);
					expect(await page.run(count("Long brief ran", ASK))).toBe(1);
					expect(await page.run(`${button("Long brief ran", "Show earlier")} === undefined`)).toBe(true);
					expect(await page.run(`${button("Long brief ran", "Try again")} === undefined`)).toBe(true);
					expect(asked.filter((path) => path === "/chats/103/items?before=11")).toHaveLength(2);
					await shot("3-earlier-read");

					// no failure left the page an unhandled rejection or an error
					expect(page.errors()).toEqual([]);
				},
			);
		},
	);
