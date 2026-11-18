import { mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { type ConversationId, createRegistry, defineExtension, type TaskId } from "@earendil-works/pi-durable";
import { describe, expect, it, onTestFinished } from "vitest";
import { Accepted, shaOf } from "../src/core/agents.ts";
import { OWNER } from "../src/core/gateway.ts";
import { defineHarnesses, HARNESS_ENDED, Harnesses } from "../src/core/harness.ts";
import { RoutineRuns, Routines, routinePath } from "../src/core/routines.ts";
import { context, openStore } from "../src/core/store.ts";
import { defineCore } from "../src/core/turn.ts";
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
		made,
		gateway,
		logged,
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

describe("a start after a daemon died", () => {
	it("ends every session it left, one in a chat nobody answers any more among them", async () => {
		const { harness, made, logged, folder, agent, agentChat, session } = await setup();
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
		await harness.commit(async (tx) => {
			const doc = await tx.doc(Harnesses);
			doc.sessions[999_998] = left(gone);
			doc.sessions[999_999] = left(agentChat);
		}, context);
		expect(await made.reconcile(harness, context)).toBe(2);
		expect(await session(999_998)).toMatchObject({ state: "failed" });
		expect(await session(999_999)).toMatchObject({ state: "failed" });
		expect(logged).toEqual([`coding agents: session 999998 ended with nobody to tell in chat ${gone}`]);
	});
});
