/** Status (DESIGN.md "Flows"), derived from the task graph and the tasks' own inputs: nothing records it. */

import type { Context } from "@earendil-works/chord";
import type { Harness, TaskGraphNode, TaskId } from "@earendil-works/pi-durable";
import { LEAD } from "./agents.ts";

import type { Origin } from "./gateway.ts";
import { Groups } from "./groups.ts";
import { agentOfChat } from "./permissions.ts";
import { RoutineRuns } from "./routines.ts";
import { context } from "./store.ts";
import { Routes } from "./turn.ts";
import { type Ask, WAIT, type WaitInput } from "./wait.ts";

export type State = "running" | "waiting" | "idle";

export type ChatStatus = {
	readonly origin: Origin;
	readonly chat: number;
	/** The agent it runs. */
	readonly agent: string;
	readonly state: State;
	/** Inputs whose run has not settled yet. */
	readonly unanswered: number;
};

/** An open Wait, as whoever may answer it sees it. */
export type OpenWait = {
	/** The ask's id: what answers it. */
	readonly key: string;
	readonly chat: number;
	/** A routine approval's visible parent; `chat` still owns the Wait and its task scope. */
	readonly displayChat?: number;
	readonly ask: Ask;
	readonly deadline: number;
	/** The tool call that opened it. */
	readonly call?: string;
};

/** A task that cannot run, and why: the restart limit parked it (`retryTask` runs it again), or nothing takes it. */
export type Parked = {
	readonly task: number;
	readonly kind: string;
	readonly chat: number;
	readonly reason: string;
};

export type Status = {
	readonly chats: readonly ChatStatus[];
	readonly waits: readonly OpenWait[];
	/**
	 * Tasks that cannot run, and why: the restart limit parked them (`retryTask` runs one again), or no registered
	 * definition takes them, which is a bug in the daemon.
	 */
	readonly parked: readonly Parked[];
};

/**
 * `waiting`: a live Wait, and no other work in the chat but the tasks waiting on it; `running`: other work;
 * `idle`: nothing but background tasks (Turns sending, asks being sent).
 */
export function stateOf(nodes: readonly TaskGraphNode[], chat: number): State {
	const live = nodes.filter((node) => Number(node.conversationId) === chat && !node.background);
	const waits = live.filter((node) => node.kind === WAIT);
	if (waits.length === 0) return live.length > 0 ? "running" : "idle";
	const byId = new Map(live.map((node) => [Number(node.id), node]));
	const waitingOnOne = new Set<number>();
	for (const wait of waits) {
		for (let owner = wait.owner; owner !== undefined; owner = byId.get(Number(owner))?.owner)
			waitingOnOne.add(Number(owner));
	}
	return live.every((node) => node.kind === WAIT || waitingOnOne.has(Number(node.id))) ? "waiting" : "running";
}

async function nodes(harness: Harness, ctx: Context): Promise<TaskGraphNode[]> {
	const graph = await harness.taskGraph(ctx);
	try {
		return Object.values(graph.value.tasks);
	} finally {
		graph.dispose();
	}
}

/** Open Waits, oldest first; a chat filter includes its routines' approvals without changing their ownership. */
export async function openWaits(
	harness: Harness,
	chat?: number,
	ctx: Context = context,
	live?: readonly TaskGraphNode[],
): Promise<OpenWait[]> {
	const waits = (live ?? (await nodes(harness, ctx))).filter(
		(node) => node.kind === WAIT && node.state.status !== "completing",
	);
	if (waits.length === 0) return [];
	const open = await Promise.all(
		waits.map(async (node) => {
			const input = (await harness.getTask(node.id as TaskId, ctx))?.input as WaitInput | undefined;
			return input === undefined
				? []
				: [
						{
							key: input.key,
							chat: Number(node.conversationId),
							ask: input.ask,
							deadline: input.deadline,
							...(input.call === undefined ? {} : { call: input.call }),
							id: Number(node.id),
						},
					];
		}),
	);
	const shown = await harness.commit(async (tx) => {
		const runs = (await tx.doc(RoutineRuns)).runs;
		const routes = (await tx.doc(Routes)).chats;
		const groups = (await tx.doc(Groups)).byExecution;
		const shown: (OpenWait & { id: number })[] = [];
		for (const wait of open.flat()) {
			const run = runs[wait.chat];
			const displayChat =
				wait.ask.type === "approval" &&
				run !== undefined &&
				routes[run.chat]?.agent === run.agent &&
				routes[wait.chat] === undefined &&
				groups[wait.chat] === undefined &&
				groups[run.chat] === undefined &&
				(await agentOfChat(tx, wait.chat)) === run.agent
					? run.chat
					: undefined;
			shown.push({ ...wait, ...(displayChat === undefined ? {} : { displayChat }) });
		}
		return shown;
	}, ctx);
	return shown
		.filter((wait) => chat === undefined || wait.chat === chat || wait.displayChat === chat)
		.sort((a, b) => a.id - b.id)
		.map(({ id: _, ...wait }) => wait);
}

export async function status(harness: Harness, ctx: Context = context): Promise<Status> {
	const live = await nodes(harness, ctx);
	const waits = await openWaits(harness, undefined, ctx, live);
	const homes = (await harness.snapshot(Routes, ctx))?.chats ?? {};
	const chats: ChatStatus[] = Object.entries(homes).map(([id, { origin, agent }]) => {
		const chat = Number(id);
		const state = stateOf(live, chat);
		return {
			origin,
			chat,
			// a chat from before agents had files ran the lead
			agent: (agent as string | undefined) ?? LEAD,
			state: state === "idle" && waits.some((wait) => wait.displayChat === chat) ? "waiting" : state,
			unanswered: live.filter((node) => Number(node.conversationId) === chat && node.kind === "banda.turn").length,
		};
	});
	const parked = live.flatMap((node) =>
		node.blocked === undefined
			? []
			: [{ task: Number(node.id), kind: node.kind, chat: Number(node.conversationId), reason: node.blocked }],
	);
	return { chats, waits, parked };
}
