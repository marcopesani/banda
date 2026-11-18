import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createModels,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	type Context as ModelContext,
} from "@earendil-works/pi-ai";
import { type ConversationId, createRegistry, defineExtension, type TaskId } from "@earendil-works/pi-durable";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { LEAD } from "../src/core/agent-id.ts";
import { Accepted, AgentChats, shaOf } from "../src/core/agents.ts";
import { OWNER } from "../src/core/gateway.ts";
import { connectHarness, defineHarnesses, HARNESS_ENDED, Harnesses } from "../src/core/harness.ts";
import { RoutineRuns, Routines, routinePath } from "../src/core/routines.ts";
import { Search } from "../src/core/search.ts";
import { searchService } from "../src/core/search-service.ts";
import { context, openStore } from "../src/core/store.ts";
import { defineCore } from "../src/core/turn.ts";
import { harnessesArea } from "../src/server/routes/harnesses.ts";
import { FAUX_MODEL } from "./fixtures/models.ts";
import { blobStore, FakeGateway, tempHome, until } from "./helpers.ts";

const FAKE = join(import.meta.dirname, "fixtures/fake-acp-agent.ts");
const ROUTINE = "---\ndescription: Tea\ncron: 0 16 * * *\n---\nSay tea.\n";

/** The core and the coding agents wired as the daemon wires them: a session's end wakes its agent through the core. */
async function setup() {
	const home = await tempHome();
	const folder = await mkdtemp(join(homedir(), ".banda-test-folder-"));
	onTestFinished(() => rm(folder, { recursive: true, force: true }));
	const gateway = new FakeGateway();
	const logged: string[] = [];
	/** Called with the newest input's words each time the model is asked. */
	const asked: { model?: (input: string) => Promise<void> } = {};
	const core = defineCore({
		blobs: blobStore(),
		gateway: () => gateway,
		model: () => FAUX_MODEL,
		retryDelay: () => 5,
		agentOrigin: (agent) => ({ gateway: "fake", peer: OWNER, thread: `agent:${agent}` }),
	});
	const made = defineHarnesses({
		home,
		definitions: () =>
			new Map([
				["fake", { name: "fake", service: "Fake Code", command: process.execPath, args: [FAKE], mode: "acceptEdits" }],
			]),
		followUp: (tx, chat, input) => core.wake(tx, chat, input),
		log: (line) => logged.push(line),
		openMs: 20_000,
	});
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	// the agent tells the owner what a coding agent's session did when it hears of its end; anything else it just ends
	const answer = async (ctx: { messages: readonly { role: string; content?: unknown }[] }) => {
		await asked.model?.(JSON.stringify([...ctx.messages].reverse().find((one) => one.role === "user")?.content ?? ""));
		const heard = ctx.messages.some((one) => JSON.stringify(one.content ?? "").includes("harness-result"));
		if (heard && ctx.messages.at(-1)?.role !== "toolResult")
			return fauxAssistantMessage([fauxToolCall("message_user", { text: "Fake Code fixed it." })], {
				stopReason: "toolUse",
			});
		return fauxAssistantMessage("done");
	};
	faux.setResponses(Array.from({ length: 1000 }, () => answer as never));
	const registry = createRegistry();
	registry.install(core.extension);
	registry.install(defineExtension({ name: "test.harness", tasks: [made.Session] }));
	const harness = await openStore(home, { models, registry });
	onTestFinished(() => harness.close(context));
	harness.resume();
	await harness.commit(async (tx) => {
		(await tx.doc(Accepted)).files[routinePath("tea")] = { sha: shaOf(ROUTINE), text: ROUTINE, at: Date.now() };
		(await tx.doc(Routines)).routines.tea = { since: Date.now() };
	}, context);
	await core.reconcile(harness);
	expect(await core.runRoutine(harness, "tea", "a")).toBe("ran");
	const [run, ran] = Object.entries((await harness.snapshot(RoutineRuns, context))?.runs ?? {})[0] ?? [];
	if (run === undefined || ran === undefined) throw new Error("the routine made no run");
	const session = async (task: number) => (await harness.snapshot(Harnesses, context))?.sessions[task];
	const outcome = (task: number) =>
		harness.commit(async (tx) => {
			const found = await tx.task(task as TaskId);
			return found?.state.status === "terminal" ? found.state.outcome : undefined;
		}, context);
	return {
		harness,
		core,
		made,
		gateway,
		logged,
		asked,
		folder,
		run: Number(run),
		agent: ran.agent,
		agentChat: ran.chat,
		session,
		outcome,
	};
}

describe("a coding agent's session begun in its agent's chat", () => {
	it("ends as done and tells its agent", async () => {
		const { harness, made, folder, agent, agentChat, session, outcome } = await setup();
		const task = await harness.commit(
			(tx) => made.begin(tx, { chat: agentChat, call: "c1", agent, harness: "fake", folder, ask: "say fixed" }),
			context,
		);
		expect(await until(() => outcome(task))).toMatchObject({ status: "completed" });
		expect(await session(task)).toMatchObject({ state: "done" });
		expect((await session(task))?.ended).toBeTypeOf("number");
	});
});

describe("a coding agent's session begun in a routine's run", () => {
	it("ends as done and wakes its agent in the run, which tells the owner in the agent's chat", async () => {
		const { harness, made, gateway, folder, run, agent, session, outcome } = await setup();
		// the run's first turn is over before the session ends, as the tool answers at once
		await until(async () => (await harness.snapshot(RoutineRuns, context))?.runs[run] !== undefined);
		// the coding agent's tool begins a session in the conversation its call runs in (routes/harnesses.ts): the run's
		const task = await harness.commit(
			(tx) => made.begin(tx, { chat: run, call: "c1", agent, harness: "fake", folder, ask: "say fixed" }),
			context,
		);
		expect(await until(() => outcome(task))).toMatchObject({ status: "completed" });
		expect(await session(task)).toMatchObject({ state: "done" });
		expect((await session(task))?.ended).toBeTypeOf("number");
		await until(() => gateway.sent.length === 1);
		expect(gateway.sent[0]).toMatchObject({
			to: { gateway: "fake", thread: `agent:${agent}` },
			out: { text: "Fake Code fixed it." },
		});
		const page = await (await harness.conversation(run as ConversationId, context))!.entries(
			{ order: "ascending" },
			1000,
			undefined,
			context,
		);
		expect(page.items.filter((entry) => entry.kind === HARNESS_ENDED)).toHaveLength(1);
	});
});

describe("a routine's run woken twice", () => {
	it("stays one of its agent's chats until its last turn ends", async () => {
		const { harness, core, asked, run, agent } = await setup();
		const registered = async () => (await harness.snapshot(AgentChats, context))?.chats[run];
		// its first turn is over: the run left its agent's chats
		await until(async () => (await registered()) === undefined);
		const seen: { [input: string]: string | undefined } = {};
		asked.model = async (input) => {
			const note = /note (one|two)/.exec(input)?.[1];
			if (note !== undefined) seen[note] = await registered();
		};
		const entry = { kind: "test.note", data: {} };
		const turns = [
			await harness.commit((tx) => core.followUp(tx, run, { key: "one", text: "note one", entry }), context),
			await harness.commit((tx) => core.followUp(tx, run, { key: "two", text: "note two", entry }), context),
		];
		for (const turn of turns) await harness.waitForTask(turn as TaskId, context);
		expect(seen).toEqual({ one: agent, two: agent });
		expect(await registered()).toBeUndefined();
	});
});

describe("a start after a daemon died", () => {
	it("ends every session it left: in its agent's chat, in a routine's run, in a chat nobody answers any more", async () => {
		const { harness, made, logged, folder, run, agent, agentChat, session } = await setup();
		// a conversation routed nowhere and no routine's run: nobody is there to wake
		const gone = await harness.commit(
			async (tx) => Number((await tx.createConversation({ ownership: { kind: "ownerless" } })).id),
			context,
		);
		const left = (chat: number) => ({
			chat,
			agent,
			harness: "fake",
			folder,
			prompt: "say first",
			state: "working" as const,
			at: Date.now(),
			steps: [{ kind: "asked" as const, text: "say first" }],
			dropped: 0,
			notes: [],
		});
		// what a killed daemon leaves: sessions recorded as running, their tasks gone
		const LEFT = { chat: 999_996, again: 999_997, run: 999_998, gone: 999_999 };
		await harness.commit(async (tx) => {
			const doc = await tx.doc(Harnesses);
			doc.sessions[LEFT.chat] = left(agentChat);
			doc.sessions[LEFT.again] = left(agentChat);
			doc.sessions[LEFT.run] = left(run);
			doc.sessions[LEFT.gone] = left(gone);
		}, context);
		expect(await made.reconcile(harness, context)).toBe(4);
		for (const task of Object.values(LEFT)) expect(await session(task)).toMatchObject({ state: "failed" });
		expect(logged).toEqual([`coding agents: session ${LEFT.gone} ended with nobody to tell in chat ${gone}`]);
	});
});

describe("the agent a session's end woke in a routine's run", () => {
	it("follows up on that session with its tool, as the wake offers", async () => {
		const home = await tempHome();
		const root = join(home, "code");
		await mkdir(join(root, "app", ".git"), { recursive: true });
		vi.stubEnv("BANDA_HARNESSES", JSON.stringify({ fake: `${process.execPath} ${FAKE}` }));
		onTestFinished(() => {
			vi.unstubAllEnvs();
		});
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		const answers: string[] = [];
		// the run starts a session; woken by its end, it follows up on it once; then it only listens
		const respond = (request: ModelContext) => {
			const last = [...request.messages].reverse().find((message) => message.role !== "system");
			if (last?.role === "toolResult" && last.toolName === "harness__fake") {
				answers.push(JSON.stringify(last.content));
				return fauxAssistantMessage("Started.");
			}
			const text = last?.role === "user" ? JSON.stringify(last.content) : "";
			if (text.includes("Say tea."))
				return fauxAssistantMessage([fauxToolCall("harness__fake", { prompt: "say done", project: "app" })], {
					stopReason: "toolUse",
				});
			const ended = /session (\d+)\), asked to work/.exec(text)?.[1];
			if (ended !== undefined && answers.length === 1)
				return fauxAssistantMessage([fauxToolCall("harness__fake", { prompt: "say more", session: Number(ended) })], {
					stopReason: "toolUse",
				});
			return fauxAssistantMessage("Done.");
		};
		faux.setResponses(Array.from({ length: 100 }, () => respond as never));
		const registry = createRegistry();
		const blobs = blobStore();
		const core = defineCore({
			blobs,
			gateway: () => new FakeGateway(),
			model: () => FAUX_MODEL,
			agentOrigin: (agent) => ({ gateway: "fake", peer: OWNER, thread: `agent:${agent}` }),
		});
		registry.install(core.extension);
		for (const extension of harnessesArea.install!({
			core,
			blobs,
			config: { model: FAUX_MODEL },
			home,
			box: "host",
			retrieval: searchService({
				index: new Search(join(home, "search.db")),
				blobs,
				groups: core.groups,
				harness: () => harness,
			}),
			root: home,
			log: () => {},
		}))
			registry.install(extension);
		const harness = await openStore(home, { models, registry });
		onTestFinished(() => harness.close(context));
		await harness.commit(async (tx) => {
			await connectHarness(tx, "fake", root, LEAD);
			(await tx.doc(Accepted)).files[routinePath("tea")] = { sha: shaOf(ROUTINE), text: ROUTINE, at: Date.now() };
			(await tx.doc(Routines)).routines.tea = { since: Date.now() };
		}, context);
		harness.resume();
		await core.reconcile(harness);
		expect(await core.runRoutine(harness, "tea", "a")).toBe("ran");
		await until(() => answers.length === 2);
		expect(answers[0]).toContain("Started session");
		expect(answers[1]).not.toContain("It did not start");
		// the follow-up went on from the first session, as one asked from the agent's chat does
		await until(async () => Object.keys((await harness.snapshot(Harnesses, context))?.sessions ?? {}).length === 2);
	});
});
