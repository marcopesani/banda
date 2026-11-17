/**
 * A mixed group in the actual app against a temporary daemon with a held faux model and a scripted coding agent
 * (test/fixtures/fake-acp-agent.ts, which runs nothing): Sancho starts a coding session that asks to run a command and
 * works on, held; Mara asks the owner a question. Each member is said as it is: Sancho on the working line, never as
 * waiting though his coding session waits; Mara on a waiting line beneath it, never as working; the coding-session
 * count carries its still dot for Sancho's session's ask. Choosing an answer on Mara's card moves her onto the working
 * line, and the dot stays; answering the session's ask takes the dot away while the session works on; their work ending
 * takes the lines away. The header holds the group's name alone throughout, at desktop and phone width.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { readDaemonFile } from "../src/home.ts";
import type { GroupView, HarnessSessionView } from "../src/server/api.ts";
import { hostBox } from "./fixtures/host-box.ts";
import { skipShippedSkills, tempHome, until, type WebServer, webServer } from "./helpers.ts";
import { hasChrome, type Page, withPage } from "./smoke/chrome.ts";

let daemon: Daemon;
let web: WebServer;
let base = "";
let token = "";
let room = 0;
let api: <T>(path: string, body?: unknown, method?: string) => Promise<T>;

const FAKE = join(import.meta.dirname, "fixtures/fake-acp-agent.ts");
const NAME = "Mixed group";

/** A hold on a run: what reaches it waits while it is closed, and `held` counts what waits or waited there. */
type Gate = { promise: Promise<void>; open: () => void; held: number };
const gate = (): Gate => {
	let open: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open, held: 0 };
};
/** `sancho`: his run once his session started and he said so; `mara`: hers once her question was answered. */
const gates = new Map<"sancho" | "mara", Gate>([
	["sancho", gate()],
	["mara", gate()],
]);
const reach = async (who: "sancho" | "mara") => {
	const held = gates.get(who);
	if (held === undefined) return;
	held.held++;
	await held.promise;
};
const letAllGo = () => {
	for (const each of gates.values()) each.open();
};

/**
 * The model, in the group: Sancho finds his coding tool, starts a session that asks once and works on, says so, and is
 * held; Mara asks a question with two choices, and once it is answered she is held. Then each says it is done.
 */
function scripted() {
	const faux = fauxProvider({ tokensPerSecond: 4000 });
	const models = createModels();
	models.setProvider(faux.provider);
	type Said = { role: string; content: unknown };
	const respond = async (context: { messages: readonly Said[] }) => {
		const agent = JSON.stringify(context).includes("MARA_INSTRUCTIONS") ? "mara" : "sancho";
		const said = context.messages.filter((message) => message.role !== "system");
		const last = said.at(-1);
		const tools = (...calls: [string, object][]) =>
			fauxAssistantMessage(
				calls.map(([name, args]) => fauxToolCall(name, args as never)),
				{ stopReason: "toolUse" },
			);
		if (last?.role === "user") {
			if (!JSON.stringify(last.content).includes("MIXED_GROUP")) return fauxAssistantMessage("Done.");
			return agent === "mara"
				? tools(["message_group", { question: "Which train?", options: ["Morning", "Evening"] }])
				: tools(["tool_search", { query: "harness__fake" }]);
		}
		if (last?.role !== "toolResult") return fauxAssistantMessage("Done.");
		const call = (
			said.filter((message) => message.role === "assistant").at(-1)?.content as
				| readonly { type: string; name?: string }[]
				| undefined
		)?.find((block) => block.type === "toolCall")?.name;
		if (call === "tool_search")
			return tools(["harness__fake", { prompt: "ask npm test\nsleep 600000\nsay done", project: "app" }]);
		if (call === "harness__fake") return tools(["message_group", { text: "Started a coding session." }]);
		if (call === "message_group") await reach(agent);
		return fauxAssistantMessage("Done.");
	};
	faux.setResponses(Array.from({ length: 200 }, () => respond as never));
	return models;
}

const sessions = async () => (await api<{ sessions: readonly HarnessSessionView[] }>("/harnesses")).sessions;
const group = () => api<GroupView>(`/groups/${room}`);

const header = `document.querySelector('header')`;
/** The header's title holds the group's name alone: nothing beneath it says who works or waits. */
const nameAlone = `(${header}.querySelector('h1')?.parentElement?.children.length === 1 && ${header}.querySelector('h1').parentElement.innerText.trim() === ${JSON.stringify(NAME)})`;
const count = `${header}.querySelector('button[aria-label$="1 coding session"]')`;
/** The count with its dot: its name says it waits, a still dot marks it, and it still reads 1. */
const dotted = `(${count}?.getAttribute('aria-label') === 'Waiting on you: 1 coding session' && ${count}.hasAttribute('data-waiting') && ${count}.querySelector('span[aria-hidden="true"].rounded-full') !== null && !/animate-/.test(${count}.innerHTML) && ${count}.innerText.trim() === '1')`;
/** The count without: no session's ask is open, and the session still works. */
const plain = `(${count}?.getAttribute('aria-label') === '1 coding session' && !${count}.hasAttribute('data-waiting') && ${count}.querySelector('span[aria-hidden="true"].rounded-full') === null && ${count}.innerText.trim() === '1')`;
/** Mara's question's first choice, on its card in the feed. */
const morning = `[...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Morning').at(-1)`;
const workLine = `document.querySelector('[data-working-line]:not([data-waiting])')`;
const waitLine = `document.querySelector('[data-working-line][data-waiting]')`;
const nameOf = (line: string) => `${line}?.querySelector('[aria-label]')?.getAttribute('aria-label')`;
const faces = (line: string) =>
	`[...${line}.querySelectorAll('[role="img"][data-state]')].map((face) => face.dataset.state)`;
/** Sancho works, his session's ask open; Mara waits on her question: each on a line of their own. */
const mixed = `(${nameOf(workLine)} === 'Sancho is working: Working…' && ${nameOf(waitLine)} === 'Mara is waiting on you' && ${waitLine}.innerText.trim() === 'Waiting on you' && document.querySelectorAll('[data-working-line]').length === 2)`;
/** Both at work, in either order, on one line: nobody waits. */
const bothWork = `(['Sancho and Mara are working: Working…', 'Mara and Sancho are working: Working…'].includes(${nameOf(workLine)}) && !${waitLine} && document.querySelectorAll('[data-working-line]').length === 1)`;

async function shot(page: Page, name: string, width: number) {
	const shots = process.env.BANDA_STATE_SHOTS;
	if (shots === undefined) return;
	await mkdir(shots, { recursive: true });
	await page.shoot(join(shots, `${name}-${width}.png`));
}
const withGroupPage = (width: number, use: (page: Page) => Promise<void>) =>
	withPage(`${base}/#token=${token}`, { width, height: 900 }, async (raw) => {
		const page: Page = { ...raw, until: (expression, ms = 20_000) => raw.until(expression, ms) };
		await page.until(`localStorage.getItem('banda.token')`);
		await page.run(`location.hash='#/g/${room}'`);
		await page.until(`document.querySelector('textarea[name="message"]')`);
		await use(page);
	});

beforeAll(async () => {
	if (!hasChrome()) return;
	const home = await tempHome();
	const code = join(home, "code");
	await mkdir(join(code, "app", ".git"), { recursive: true });
	vi.stubEnv("BANDA_HARNESSES", JSON.stringify({ fake: `${process.execPath} ${FAKE}` }));
	vi.stubEnv("FAKE_ACP_LOG", join(home, "acp.jsonl"));
	await writeFile(join(home, "config.json"), JSON.stringify({ model: { provider: "faux", modelId: "faux-1" } }));
	daemon = await startDaemon({ home, port: 0, models: scripted(), box: hostBox(home), log: () => {} });
	token = (await readDaemonFile(home))?.token ?? "";
	await skipShippedSkills(daemon.port, token);
	api = async <T>(path: string, body?: unknown, method?: string): Promise<T> => {
		const res = await fetch(`http://127.0.0.1:${daemon.port}/api${path}`, {
			method: method ?? (body === undefined ? "GET" : "POST"),
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
		return (await res.json()) as T;
	};
	await api("/companion", { name: "Sancho", personality: "Brief." }, "PUT");
	await api(
		"/agents/mara",
		{ text: "---\nname: Mara\ndescription: Helps\ntools: [read]\n---\nMARA_INSTRUCTIONS.\n", base: null },
		"PUT",
	);
	await api("/harnesses/fake/connect", { folder: code, agent: "sancho" });
	room = (await api<{ room: number }>("/groups", { members: ["sancho", "mara"], name: NAME })).room;
	web = await webServer({
		server: {
			proxy: {
				"/api": {
					target: `http://127.0.0.1:${daemon.port}`,
					changeOrigin: true,
					headers: { origin: `http://127.0.0.1:${daemon.port}` },
				},
			},
		},
	});
	base = web.origin;
}, 60_000);
afterAll(async () => {
	letAllGo();
	for (const one of (await sessions().catch(() => [])) ?? [])
		if (one.ended === undefined) await api(`/harnesses/sessions/${one.task}/stop`, {}).catch(() => {});
	await web?.close();
	await daemon?.close();
	vi.unstubAllEnvs();
});

it.skipIf(!hasChrome())(
	"a mixed group: one member works while its coding session asks, another waits on its question; each line and the count's dot say so",
	async () => {
		await api(`/groups/${room}/messages`, { key: randomUUID(), text: "MIXED_GROUP", mentions: ["sancho", "mara"] });
		// the real group state: Sancho at work, held, his session's ask open; Mara's question open
		await until(() => Promise.resolve(gates.get("sancho")?.held === 1), 100);
		await until(async () => (await group()).asks.some((ask) => ask.agent === "mara"), 100);
		const sanchoChat = (await group()).executions.sancho;
		const asking = async () =>
			(await sessions()).filter((one) => one.chat === sanchoChat && (one.asks?.length ?? 0) > 0);
		await until(async () => (await asking()).length === 1, 100);
		const view = await group();
		expect(view.working).toContain("sancho");
		expect(view.asks.map((ask) => ask.agent)).toEqual(["mara"]);

		for (const width of [390, 1440])
			await withGroupPage(width, async (page) => {
				await page.until(`${mixed} && ${dotted}`);
				// Sancho's face moves on the working line; Mara's rests with its dot on the waiting line, beneath it
				expect(await page.run(faces(workLine))).toEqual(["working"]);
				expect(await page.run(faces(waitLine))).toEqual(["waiting"]);
				expect(
					await page.run(`${workLine}.getBoundingClientRect().bottom <= ${waitLine}.getBoundingClientRect().top`),
				).toBe(true);
				expect(await page.run(nameAlone), "the header holds the name alone").toBe(true);
				expect(await page.run(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
				await shot(page, "group-1-mixed", width);
				expect(page.errors()).toEqual([]);
			});

		await withGroupPage(1440, async (page) => {
			await page.until(`${mixed} && ${dotted}`);
			// Mara's question answered on its card: she works on, held, and joins Sancho's line; his session still asks, so
			// the dot stays
			await page.until(morning);
			await page.run(`${morning}.click()`);
			await until(() => Promise.resolve(gates.get("mara")?.held === 1));
			expect((await group()).asks).toEqual([]);
			await page.until(`${bothWork} && ${dotted}`);
			expect(await page.run(faces(workLine))).toEqual(["working", "working"]);
			expect(await page.run(nameAlone), "the header holds the name alone").toBe(true);
			await shot(page, "group-2-answered", 1440);
			// the session's ask allowed: nothing waits on the owner, the session works on, and the dot goes
			const [session] = await asking();
			await api(`/harnesses/sessions/${session?.task}/answer`, { ask: session?.asks?.[0]?.id, allow: true });
			await until(async () => (await asking()).length === 0);
			await page.until(`${bothWork} && ${plain}`);
			expect(await page.run(nameAlone), "the header holds the name alone").toBe(true);
			await shot(page, "group-3-allowed", 1440);
			// their work ends, and the lines with it; the session goes on, so the count stays, without its dot
			letAllGo();
			await until(async () => (await group()).working.length === 0);
			await page.until(`!document.querySelector('[data-working-line]') && ${plain}`);
			expect(await page.run(nameAlone), "the header holds the name alone").toBe(true);
			expect(page.errors()).toEqual([]);
		});
	},
	120_000,
);
