#!/usr/bin/env node
/**
 * What a home's runs took, to hold against the launch budgets in docs/verification.md, from a fork of it
 * (`npm run home:fork -- --no-volumes`), never the live home: per kind of run and for banda's own time, as counts,
 * medians and 90th percentiles, and no message text.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createModels, type Message } from "@earendil-works/pi-ai";
import { CompactionEntry, type ConversationId, createRegistry, SystemEntry, type Tx } from "@earendil-works/pi-durable";
import { CACHE_WINDOW } from "../src/core/cache-audit.ts";
import { GROUP_INPUT } from "../src/core/groups.ts";
import { HARNESS_ENDED } from "../src/core/harness.ts";
import { WAKE as ROUTINE_WAKE } from "../src/core/routines.ts";
import { context, openStore } from "../src/core/store.ts";
import { AGENT_MESSAGE, NUDGE } from "../src/core/turn.ts";
import { auditTurns, type RunStart, type Spread, type TurnAudit, type TurnRow } from "../src/core/turn-audit.ts";
import { WAIT, type WaitEnded } from "../src/core/wait.ts";
import { WAKE as WATCH_WAKE } from "../src/core/watches.ts";
import { conversations, refuseLive } from "./cache-audit.ts";

const STARTS: { readonly [kind: string]: RunStart } = {
	"banda.inbound": "owner",
	[AGENT_MESSAGE]: "agent",
	[ROUTINE_WAKE]: "routine",
	[WATCH_WAKE]: "watch",
	[GROUP_INPUT]: "group",
	[HARNESS_ENDED]: "return",
};

async function rowsOf(harness: Awaited<ReturnType<typeof openStore>>, id: ConversationId): Promise<TurnRow[]> {
	const rows: TurnRow[] = [];
	const chat = Number(id);
	let cursor: Parameters<Tx["scanEntries"]>[2];
	do {
		const page = await harness.commit(
			(tx) => tx.scanEntries({ conversationId: id, order: "ascending" }, 200, cursor),
			context,
		);
		for (const entry of page.items) {
			// a fork's scan includes what it inherited
			if (entry.conversationId !== id) continue;
			const message: Message | undefined = entry.kind === "banda.skill-load" ? entry.model?.[1] : entry.model?.[0];
			const start = STARTS[entry.kind];
			if (start !== undefined) rows.push({ type: "start", chat, start, ...(message ? { at: message.timestamp } : {}) });
			else if (entry.kind === WAIT) {
				const ended = entry.data as unknown as WaitEnded;
				rows.push({
					type: "wait",
					chat,
					approval: ended.ask.type === "approval",
					...(ended.outcome === "answered" ? { at: ended.at } : {}),
				});
			} else if (entry.kind === NUDGE) rows.push({ type: "nudge", chat });
			else if (entry.kind === CompactionEntry.kind) rows.push({ type: "compaction", chat });
			else if (entry.kind === SystemEntry.kind) rows.push({ type: "status", chat });
			else if (message?.role === "assistant")
				rows.push({
					type: "request",
					chat,
					at: message.timestamp,
					...(message.durationMs === undefined ? {} : { ms: message.durationMs }),
					model: `${message.provider}/${message.model}`,
					calls: message.content.flatMap((block) => (block.type === "toolCall" ? [block.name] : [])),
					answered:
						message.stopReason === "stop" &&
						message.content.some((block) => block.type === "text" && block.text.trim() !== ""),
					usage: {
						input: message.usage.input,
						output: message.usage.output,
						cacheRead: message.usage.cacheRead,
						cacheWrite: message.usage.cacheWrite,
						cost: message.usage.cost.total,
					},
				});
			else if (message?.role === "toolResult")
				rows.push({
					type: "tool",
					chat,
					name: message.toolName,
					at: message.timestamp,
					...(message.durationMs === undefined ? {} : { ms: message.durationMs }),
				});
			else rows.push({ type: "other", chat });
		}
		cursor = page.next;
	} while (cursor !== undefined);
	return rows;
}

/** The audit of the store at `home`, which must be a fork, not the live home. */
export async function auditHome(
	home: string,
	between: { readonly from?: number; readonly to?: number } = {},
	window: number = CACHE_WINDOW,
): Promise<TurnAudit> {
	await refuseLive(home);
	if (!existsSync(join(home, "durable.db"))) throw new Error(`${home} holds no store`);
	const harness = await openStore(home, { models: createModels(), registry: createRegistry() });
	try {
		const rows: TurnRow[] = [];
		for (const chat of await conversations(harness)) rows.push(...(await rowsOf(harness, chat)));
		return auditTurns({ rows, between, window });
	} finally {
		await harness.close(context);
	}
}

const number = (value: number | undefined, digits = 0) => (value === undefined ? "n/a" : value.toFixed(digits));
const pair = (spread: Spread, digits = 0) => `${number(spread.p50, digits)} / ${number(spread.p90, digits)}`;

function table(rows: readonly (readonly string[])[]): string {
	const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]?.length ?? 0))) ?? [];
	return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ")).join("\n");
}

function report(audit: TurnAudit): string {
	return [
		"Runs by kind: median / 90th percentile per run",
		table([
			[
				"kind",
				"runs",
				"nudged",
				"requests",
				"sent",
				"written",
				"output",
				"cost $",
				"hit rate",
				"first words ms",
				"of it not the model's",
			],
			...audit.classes.map((line) => [
				line.class,
				String(line.runs),
				String(line.nudged),
				pair(line.requests),
				pair(line.sent),
				pair(line.written),
				pair(line.output),
				pair(line.cost, 4),
				line.hitRate === undefined ? "n/a" : `${(line.hitRate * 100).toFixed(1)}%`,
				`${pair(line.firstWords)} (${line.firstWords.n})`,
				pair(line.firstWordsOwn),
			]),
		]),
		"banda's own time, ms: median / 90th percentile",
		table([
			["step", "samples", "ms"],
			["the owner's message to the first request", String(audit.own.firstRequest.n), pair(audit.own.firstRequest)],
			["a response's end to its first tool's start", String(audit.own.toolStart.n), pair(audit.own.toolStart)],
			["the last tool's result to the next request", String(audit.own.nextRequest.n), pair(audit.own.nextRequest)],
			["a question's answer to the next request", String(audit.own.question.n), pair(audit.own.question)],
			["an approval's answer to its effect's result", String(audit.own.approval.n), pair(audit.own.approval)],
		]),
		`Warm requests that read under half of what they sent: ${audit.warm.missed} of ${audit.warm.requests}`,
		"The owner's runs the daemon nudged, by the model that began them",
		table([
			["model", "runs", "nudged"],
			...audit.nudges.map((line) => [line.model, String(line.runs), String(line.nudged)]),
		]),
	].join("\n\n");
}

const usage = `Audit what a forked home's runs took, against the launch budgets (Node 26)
  npm run turn:audit -- --home <dir> [--since <date>] [--until <date>] [--window <minutes>] [--json]
--home is required and must be a fork: npm run home:fork -- --no-volumes
--since and --until take any date Date.parse reads, and count only what happened between them.
--window is how long a prompt stays cached after its last use: 5 minutes unless given.`;

function dateOf(text: string | undefined): number | undefined {
	if (text === undefined) return undefined;
	const at = Date.parse(text);
	if (Number.isNaN(at)) throw new Error(`${text} is not a date`);
	return at;
}

async function main() {
	const { values } = parseArgs({
		options: {
			home: { type: "string" },
			since: { type: "string" },
			until: { type: "string" },
			window: { type: "string" },
			json: { type: "boolean" },
			help: { type: "boolean" },
		},
	});
	if (values.help) return console.log(usage);
	if (values.home === undefined) throw new Error(usage);
	const minutes = values.window === undefined ? undefined : Number(values.window);
	if (minutes !== undefined && !(minutes > 0)) throw new Error(`--window takes minutes, not ${values.window}`);
	const from = dateOf(values.since);
	const to = dateOf(values.until);
	const audit = await auditHome(
		values.home,
		{ ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) },
		minutes === undefined ? CACHE_WINDOW : minutes * 60_000,
	);
	console.log(values.json ? JSON.stringify(audit, null, 2) : report(audit));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
