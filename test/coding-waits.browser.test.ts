/**
 * The coding-session count while sessions wait on the owner, in the actual app against a temporary daemon: the agent
 * starts two sessions of a scripted coding agent (test/fixtures/fake-acp-agent.ts) that each ask to run a command. The
 * count carries a still dot, and its name says it waits, while either ask is open; answering one leaves the dot for the
 * other; answering both takes it away while the sessions work on. The header holds the name alone throughout. Nothing
 * runs: the scripted agent only says it ran what was allowed.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { agentMainThread } from "../src/core/gateway.ts";
import { type Daemon, startDaemon } from "../src/daemon.ts";
import { readDaemonFile } from "../src/home.ts";
import type { HarnessSessionView, Posted } from "../src/server/api.ts";
import { hostBox } from "./fixtures/host-box.ts";
import { skipShippedSkills, tempHome, until, type WebServer, webServer } from "./helpers.ts";
import { hasChrome, type Page, withPage } from "./smoke/chrome.ts";

let daemon: Daemon;
let web: WebServer;
let base = "";
let token = "";
let api: <T>(path: string, body?: unknown, method?: string) => Promise<T>;

const FAKE = join(import.meta.dirname, "fixtures/fake-acp-agent.ts");
/** Each session asks once, and works on, held, once answered. */
const SCRIPT = (command: string) => `ask ${command}\nsleep 600000\nsay done`;

/** The model: `CODE_TWO` starts two sessions at once, one per project; then it says so and ends its turn. */
function scripted() {
	const faux = fauxProvider({ tokensPerSecond: 4000 });
	const models = createModels();
	models.setProvider(faux.provider);
	type Said = { role: string; content: unknown };
	const respond = (context: { messages: readonly Said[] }) => {
		const said = context.messages.filter((message) => message.role !== "system");
		const last = said.at(-1);
		const words = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
		const tools = (...calls: [string, object][]) =>
			fauxAssistantMessage(
				calls.map(([name, args]) => fauxToolCall(name, args as never)),
				{ stopReason: "toolUse" },
			);
		if (last?.role === "user")
			return words.includes("CODE_TWO")
				? tools(["tool_search", { query: "harness__fake" }])
				: tools(["message_user", { text: "ok" }]);
		if (last?.role !== "toolResult") return fauxAssistantMessage("Done.");
		const call = (
			said.filter((message) => message.role === "assistant").at(-1)?.content as
				| readonly { type: string; name?: string }[]
				| undefined
		)?.find((block) => block.type === "toolCall")?.name;
		if (call === "tool_search")
			return tools(
				["harness__fake", { prompt: SCRIPT("npm test"), project: "app" }],
				["harness__fake", { prompt: SCRIPT("npm run lint"), project: "web" }],
			);
		if (call === "harness__fake") return tools(["message_user", { text: "Two sessions started." }]);
		return fauxAssistantMessage("Done.");
	};
	faux.setResponses(Array.from({ length: 200 }, () => respond as never));
	return models;
}

const sessions = async () => (await api<{ sessions: readonly HarnessSessionView[] }>("/harnesses")).sessions;
const header = `document.querySelector('header')`;
const count = `${header}.querySelector('button[aria-label$="coding sessions"]')`;
const nameAlone = `(${header}.querySelector('h1')?.parentElement?.children.length === 1 && ${header}.querySelector('h1').parentElement.innerText.trim() === 'Sancho')`;
/** The count with its dot: its name says it waits, a still dot marks it, and it still reads 2. */
const dotted = `(${count}?.getAttribute('aria-label') === 'Waiting on you: 2 coding sessions' && ${count}.hasAttribute('data-waiting') && ${count}.querySelector('span[aria-hidden="true"].rounded-full') !== null && !/animate-/.test(${count}.innerHTML) && ${count}.innerText.trim() === '2')`;
/** The count without: no ask is open, and two sessions still work. */
const plain = `(${count}?.getAttribute('aria-label') === '2 coding sessions' && !${count}.hasAttribute('data-waiting') && ${count}.querySelector('span[aria-hidden="true"].rounded-full') === null && ${count}.innerText.trim() === '2')`;

async function shot(page: Page, name: string, width: number) {
	const shots = process.env.BANDA_STATE_SHOTS;
	if (shots === undefined) return;
	await mkdir(shots, { recursive: true });
	await page.shoot(join(shots, `${name}-${width}.png`));
}

beforeAll(async () => {
	if (!hasChrome()) return;
	const home = await tempHome();
	const code = join(home, "code");
	for (const project of ["app", "web"]) await mkdir(join(code, project, ".git"), { recursive: true });
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
	await api("/harnesses/fake/connect", { folder: code, agent: "sancho" });
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
	for (const one of (await sessions().catch(() => [])) ?? [])
		if (one.ended === undefined) await api(`/harnesses/sessions/${one.task}/stop`, {}).catch(() => {});
	await web?.close();
	await daemon?.close();
	vi.unstubAllEnvs();
});

it.skipIf(!hasChrome())(
	"two coding sessions ask: the count's dot stays while either waits, and goes once both are answered",
	async () => {
		const posted = await api<Extract<Posted, { turn: number }>>("/messages", {
			id: randomUUID(),
			thread: agentMainThread("sancho"),
			text: "CODE_TWO",
		});
		const asking = async () =>
			(await sessions()).filter((one) => one.chat === posted.chat && (one.asks?.length ?? 0) > 0);
		await until(async () => (await asking()).length === 2, 100);
		const [first, second] = await asking();
		for (const width of [390, 1440])
			await withPage(`${base}/#token=${token}`, { width, height: 900 }, async (raw) => {
				const page: Page = { ...raw, until: (expression, ms = 20_000) => raw.until(expression, ms) };
				await page.until(`localStorage.getItem('banda.token')`);
				await page.run(`location.hash='#/a/sancho'`);
				await page.until(dotted);
				expect(await page.run(nameAlone), "the header holds the name alone").toBe(true);
				await shot(page, "coding-1-both-ask", width);
				if (width === 390) return;
				// one answered: the other still waits, and the dot stays
				await api(`/harnesses/sessions/${first?.task}/answer`, { ask: first?.asks?.[0]?.id, allow: true });
				await until(async () => (await asking()).length === 1);
				await page.until(dotted);
				await shot(page, "coding-2-one-asks", width);
				// both answered: nothing waits, both work on, and the dot goes
				await api(`/harnesses/sessions/${second?.task}/answer`, { ask: second?.asks?.[0]?.id, allow: true });
				await until(async () => (await asking()).length === 0);
				await page.until(plain);
				expect(await page.run(nameAlone), "the header holds the name alone").toBe(true);
				await shot(page, "coding-3-none-asks", width);
				expect(page.errors()).toEqual([]);
			});
		// and at phone width once nothing waits
		await withPage(`${base}/#token=${token}`, { width: 390, height: 900 }, async (raw) => {
			const page: Page = { ...raw, until: (expression, ms = 20_000) => raw.until(expression, ms) };
			await page.until(`localStorage.getItem('banda.token')`);
			await page.run(`location.hash='#/a/sancho'`);
			await page.until(plain);
			await shot(page, "coding-3-none-asks", 390);
			expect(page.errors()).toEqual([]);
		});
	},
	120_000,
);
