import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { withAbortSignal } from "@earendil-works/chord/context";
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
import { Accepted, AgentChats, acceptedAgent, agentPath, agentText, shaOf } from "../src/core/agents.ts";
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
	const asked: { model?: (input: string) => Promise<void>; system?: (words: string) => Promise<void> } = {};
	/** Sessions (by task) whose wake fails, as a fault at that boundary: thrown before the core is asked. */
	const faulty = new Set<number>();
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
		followUp: (tx, chat, input) => {
			if (faulty.has(Number(input.key.replace("harness:", "")))) throw new Error(`the wake for ${input.key} failed`);
			return core.wake(tx, chat, input);
		},
		log: (line) => logged.push(line),
		openMs: 20_000,
	});
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	// the agent tells the owner what a coding agent's session did when it hears of its end; anything else it just ends
	const answer = async (ctx: { messages: readonly { role: string; content?: unknown }[] }) => {
		await asked.model?.(JSON.stringify([...ctx.messages].reverse().find((one) => one.role === "user")?.content ?? ""));
		await asked.system?.(
			JSON.stringify([
				(ctx as { systemPrompt?: unknown }).systemPrompt,
				ctx.messages.filter((one) => one.role === "system"),
			]),
		);
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
		faulty,
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
		// the run's first turn is over before the session ends, as the tool answers at once: it left its agent's chats
		await until(async () => (await harness.snapshot(AgentChats, context))?.chats[run] === undefined);
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

describe("a session's end in a run its agent no longer runs", () => {
	it("ends the session and wakes nobody: the run takes no turn as an agent that is not its own", async () => {
		const { harness, made, logged, gateway, folder, run, agent, agentChat, session, outcome } = await setup();
		await until(async () => (await harness.snapshot(AgentChats, context))?.chats[run] === undefined);
		// the chat the run came from runs another agent now: the run has lost its principal
		await harness.commit(async (tx) => {
			(await tx.doc(AgentChats)).chats[agentChat] = "someone-else";
		}, context);
		const task = await harness.commit(
			(tx) => made.begin(tx, { chat: run, call: "c1", agent, harness: "fake", folder, ask: "say fixed" }),
			context,
		);
		expect(await until(() => outcome(task))).toMatchObject({ status: "completed" });
		expect(await session(task)).toMatchObject({ state: "done" });
		expect(logged).toEqual([`coding agents: session ${task} ended with nobody to tell in chat ${run}`]);
		// no turn was queued for it, and it is not one of anybody's chats
		const turns = await harness.commit(
			async (tx) =>
				(
					await Promise.all(
						(["pending", "running", "waiting", "sleeping", "completing"] as const).map((status) =>
							tx.scanTasks({ kind: "banda.turn", status, conversationId: run as ConversationId }, 10, undefined),
						),
					)
				).flatMap((page) => page.items),
			context,
		);
		expect(turns).toEqual([]);
		expect((await harness.snapshot(AgentChats, context))?.chats[run]).toBeUndefined();
		expect(gateway.sent).toEqual([]);
	});
});

describe("a run woken after its agent's definition changed", () => {
	it("takes its turn as the agent is now, not as it was when the run began", async () => {
		const { harness, core, asked, run, agent } = await setup();
		await until(async () => (await harness.snapshot(AgentChats, context))?.chats[run] === undefined);
		const WORDS = "Answer in exactly seven words, always.";
		await harness.commit(async (tx) => {
			const now = await acceptedAgent(tx, agent);
			if (now === undefined) throw new Error("the run's agent has no file");
			const text = agentText({ ...now, instructions: WORDS });
			(await tx.doc(Accepted)).files[agentPath(agent)] = { sha: shaOf(text), text, at: Date.now() };
			await core.agentChanged(tx, agent);
		}, context);
		let system = "";
		asked.system = async (words) => {
			system = words;
		};
		const turn = await harness.commit(
			(tx) => core.followUp(tx, run, { key: "one", text: "note one", entry: { kind: "test.note", data: {} } }),
			context,
		);
		await harness.waitForTask(turn as TaskId, context);
		expect(system).toContain(WORDS);
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

describe("a start after a daemon died, one of the sessions it left failing to end", () => {
	/** What a killed daemon leaves: a session recorded as running, its task gone. */
	const left = (chat: number, agent: string, folder: string) => ({
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
	const endedIn = async (harness: Awaited<ReturnType<typeof setup>>["harness"], chat: number) =>
		(
			await (await harness.conversation(chat as ConversationId, context))!.entries(
				{ order: "ascending" },
				1000,
				undefined,
				context,
			)
		).items
			.filter((entry) => entry.kind === HARNESS_ENDED)
			.map((entry) => (entry.data as { task: number }).task);

	it("ends the others, says which one it could not, and ends that one at the next start, each waking its agent once", async () => {
		const { harness, made, logged, faulty, folder, run, agent, agentChat, session } = await setup();
		await until(async () => (await harness.snapshot(AgentChats, context))?.chats[run] === undefined);
		// four left sessions; the second one's end fails, as a wake that throws does
		const LEFT = { first: 999_996, failing: 999_997, run: 999_998, last: 999_999 };
		await harness.commit(async (tx) => {
			const doc = await tx.doc(Harnesses);
			doc.sessions[LEFT.first] = left(agentChat, agent, folder);
			doc.sessions[LEFT.failing] = left(agentChat, agent, folder);
			doc.sessions[LEFT.run] = left(run, agent, folder);
			doc.sessions[LEFT.last] = left(agentChat, agent, folder);
		}, context);
		faulty.add(LEFT.failing);
		expect(await made.reconcile(harness, context)).toBe(3);
		expect(await session(LEFT.first)).toMatchObject({ state: "failed" });
		expect(await session(LEFT.run)).toMatchObject({ state: "failed" });
		expect(await session(LEFT.last)).toMatchObject({ state: "failed" });
		// the one that failed is as it was: still to end, in its chat
		expect(await session(LEFT.failing)).toMatchObject({ state: "working", chat: agentChat });
		expect((await session(LEFT.failing))?.ended).toBeUndefined();
		expect(logged).toEqual([
			`coding agents: session ${LEFT.failing} could not end: the wake for harness:${LEFT.failing} failed; it ends at the next start`,
		]);
		// the next start ends it, and only it: nothing already ended wakes its agent again
		faulty.clear();
		expect(await made.reconcile(harness, context)).toBe(1);
		expect(await session(LEFT.failing)).toMatchObject({ state: "failed" });
		expect(await made.reconcile(harness, context)).toBe(0);
		await until(async () => (await endedIn(harness, agentChat)).length === 3);
		expect((await endedIn(harness, agentChat)).sort()).toEqual([LEFT.first, LEFT.failing, LEFT.last]);
		expect(await endedIn(harness, run)).toEqual([LEFT.run]);
	});

	it("ends none and says so when the daemon is stopping: what is left ends at the next start", async () => {
		const { harness, made, logged, folder, agent, agentChat, session } = await setup();
		await harness.commit(async (tx) => {
			(await tx.doc(Harnesses)).sessions[999_998] = left(agentChat, agent, folder);
			(await tx.doc(Harnesses)).sessions[999_999] = left(agentChat, agent, folder);
		}, context);
		const stopping = withAbortSignal(AbortSignal.abort(new Error("banda is stopping")), context);
		await expect(made.reconcile(harness, stopping)).rejects.toThrow();
		expect(await session(999_998)).toMatchObject({ state: "working" });
		expect(await session(999_999)).toMatchObject({ state: "working" });
		expect(logged).toEqual([]);
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
