/**
 * The process the harness fault suite kills for a session in a run: a routine's run, in a conversation of its own, in which a coding
 * agent's session (the scripted fake harness) begins and ends, waking the run's agent through the core as the daemon
 * wires it (`core.wake`: the run is one of its agent's chats again until its last turn ends); and, at every start, the
 * sessions a dead daemon left (two in the agent's chat, one in the run) ended by `reconcile`, each in a commit of its
 * own, as the daemon's start does. Each process does what is not yet done. The echo model answers every wake by
 * telling the owner. The fake logs every prompt it received to `<home>/fake.jsonl`, so what happened survives a killed
 * process. Prints a summary as its last line.
 *
 * argv: home, fault schedule JSON (Fault[])
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type ConversationId, createRegistry, defineExtension } from "@earendil-works/pi-durable";
import { Accepted, AgentChats, shaOf } from "../../src/core/agents.ts";
import { BlobStore } from "../../src/core/blobs.ts";
import { type Gateway, OWNER } from "../../src/core/gateway.ts";
import { defineHarnesses, HARNESS_ENDED, Harnesses } from "../../src/core/harness.ts";
import { RoutineRuns, Routines, routinePath } from "../../src/core/routines.ts";
import { status } from "../../src/core/status.ts";
import { context, openStore } from "../../src/core/store.ts";
import { defineCore } from "../../src/core/turn.ts";
import { echoModels, FAUX_MODEL } from "../fixtures/models.ts";
import { type Fault, Faults } from "./faults.ts";

const [home, scheduleJson] = process.argv.slice(2) as [string, string];
const faults = new Faults(JSON.parse(scheduleJson) as Fault[]);
const FAKE = join(import.meta.dirname, "../fixtures/fake-acp-agent.ts");
const folder = join(home, "work");
mkdirSync(folder, { recursive: true });
process.env.FAKE_ACP_LOG = join(home, "fake.jsonl");
const ROUTINE = "---\ndescription: Tea\ncron: 0 16 * * *\n---\nSay tea.\n";
const ASK = "edit src/a.ts +1 -0\nsay fixed";
/** The sessions a dead daemon left, by task: ids no task of this store has, recorded as running. */
const LEFT = { first: 999_997, second: 999_998, run: 999_999 };

let sends = 0;
const gateway: Gateway = {
	name: "fake",
	strength: "bearer",
	can: { buttons: false, files: false, threads: true },
	start() {},
	async send(_to, out) {
		faults.hit("send:before");
		appendFileSync(join(home, "sent.jsonl"), `${JSON.stringify(out.text ?? "")}\n`);
		faults.hit("send:after");
		return `out-${process.pid}-${++sends}`;
	},
};

const core = defineCore({
	blobs: new BlobStore(join(home, "blobs")),
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
	log: () => {},
	fault: (point) => faults.hit(point as never),
});
const { models } = echoModels(faults);
const registry = createRegistry();
registry.install(core.extension);
registry.install(defineExtension({ name: "test.harness", tasks: [made.Session] }));
const harness = await openStore(home, { models, registry, wrapStorage: (storage) => faults.storage(storage) });
harness.resume();

// the routine, allowed once
if ((await harness.snapshot(Accepted, context))?.files[routinePath("tea")] === undefined)
	await harness.commit(async (tx) => {
		(await tx.doc(Accepted)).files[routinePath("tea")] = { sha: shaOf(ROUTINE), text: ROUTINE, at: Date.now() };
		(await tx.doc(Routines)).routines.tea = { since: Date.now() };
	}, context);
await core.reconcile(harness);
// the owner runs it now: the same click, sent again after a kill
await core.runRoutine(harness, "tea", "k1");
const [run, ran] = Object.entries((await harness.snapshot(RoutineRuns, context))?.runs ?? {})[0] ?? [];
if (run === undefined || ran === undefined) throw new Error("the routine made no run");
const chat = ran.chat;
const agent = ran.agent;

// what a killed daemon left, as its store holds it: seeded once, ended by `reconcile` at this start or a later one
const left = (where: number) => ({
	chat: where,
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
await harness.commit(async (tx) => {
	const doc = await tx.doc(Harnesses);
	doc.sessions[LEFT.first] ??= left(chat);
	doc.sessions[LEFT.second] ??= left(chat);
	doc.sessions[LEFT.run] ??= left(Number(run));
}, context);
await made.reconcile(harness, context);

// the coding agent's session in the run, begun once
const seeded = new Set(Object.values(LEFT));
await harness.commit(async (tx) => {
	const doc = await tx.doc(Harnesses);
	if (Object.entries(doc.sessions).some(([id, one]) => !seeded.has(Number(id)) && one.chat === Number(run))) return;
	await made.begin(tx, { chat: Number(run), call: "c1", agent, harness: "fake", folder, ask: ASK });
}, context);

// until every session ended and every turn its end woke is over: nothing but the routine's own task runs
const idle = async () => {
	const graph = await harness.taskGraph(context);
	const busy = Object.values(graph.value.tasks).some((task) => task.kind !== "banda.routine");
	graph.dispose();
	return !busy;
};
while (!(await idle())) await new Promise((resolve) => setTimeout(resolve, 10));

const sessions = Object.fromEntries(
	Object.entries((await harness.snapshot(Harnesses, context))?.sessions ?? {}).map(([id, one]) => [
		id,
		{ chat: one.chat, state: one.state, ended: one.ended !== undefined },
	]),
);
/** The sessions each chat was told ended, in order: one entry per wake, the Turn its end made. */
const woke: { [chat: string]: number[] } = {};
for (const where of [chat, Number(run)]) {
	const page = await (await harness.conversation(where as ConversationId, context))!.entries(
		{ order: "ascending" },
		1000,
		undefined,
		context,
	);
	woke[where] = page.items
		.filter((entry) => entry.kind === HARNESS_ENDED)
		.map((entry) => (entry.data as { task: number }).task);
}
const turns = await harness.commit(async (tx) => {
	const found: { chat: number; status: string }[] = [];
	let cursor: Parameters<typeof tx.scanTasks>[2];
	do {
		const page = await tx.scanTasks({ kind: "banda.turn" }, 100, cursor);
		for (const task of page.items)
			found.push({
				chat: Number((task.input as { chat: number }).chat),
				status: (task.state as { outcome?: { status: string } }).outcome?.status ?? task.state.status,
			});
		cursor = page.next;
	} while (cursor !== undefined);
	return found;
}, context);
const log = existsSync(join(home, "fake.jsonl"))
	? readFileSync(join(home, "fake.jsonl"), "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { prompt?: string })
	: [];
console.log(
	JSON.stringify({
		run: Number(run),
		chat,
		sessions,
		woke,
		registered: (await harness.snapshot(AgentChats, context))?.chats[Number(run)] !== undefined,
		turns,
		prompts: log.filter((entry) => entry.prompt === ASK).length,
		sent: readFileSync(join(home, "sent.jsonl"), { encoding: "utf8", flag: "a+" }).split("\n").filter(Boolean),
		parked: (await status(harness)).parked,
		commits: faults.hits("commit:after"),
		models: faults.hits("model"),
		reached: faults.counts(),
		trace: faults.commits(),
	}),
);
await harness.close(context);
