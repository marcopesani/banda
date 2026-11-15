/**
 * What a home's runs took, from what its store already holds, against the launch budgets in docs/verification.md: per
 * kind of run, the requests, tokens, money and time to the first words; and banda's own time around the model. Pure
 * over rows, so the reading of the store stays in `scripts/turn-audit.ts`. Aggregates only; message text never reaches it.
 */
import { type AuditUsage, CACHE_WINDOW } from "./cache-audit.ts";

/** What began a run: the owner's message, another agent's, a routine's or a watch's wake, a group's, a coding agent's end. */
export type RunStart = "owner" | "agent" | "routine" | "watch" | "group" | "return";

/** One chat's history, oldest first, as numbers and names. */
export type TurnRow =
	| { readonly type: "start"; readonly chat: number; readonly start: RunStart; readonly at?: number }
	| {
			readonly type: "request";
			readonly chat: number;
			/** When the request started. */
			readonly at: number;
			/** How long the response took; absent when it was cut off before it ended. */
			readonly ms?: number;
			/** `provider/modelId`. */
			readonly model: string;
			/** The tools it called, by name. */
			readonly calls: readonly string[];
			/** Whether it ended the run with words of its own. */
			readonly answered: boolean;
			readonly usage?: AuditUsage;
	  }
	| { readonly type: "tool"; readonly chat: number; readonly name: string; readonly at: number; readonly ms?: number }
	/** An ask's end: when it was answered, and whether it asked to approve an effect. */
	| { readonly type: "wait"; readonly chat: number; readonly approval: boolean; readonly at?: number }
	/** The daemon's word to a run that left the owner unanswered. */
	| { readonly type: "nudge"; readonly chat: number }
	| { readonly type: "compaction"; readonly chat: number }
	/** The status line's new value: it comes between two entries without being a step of the run. */
	| { readonly type: "status"; readonly chat: number }
	| { readonly type: "other"; readonly chat: number };

/**
 * A run's kind, in the launch workflows' terms (docs/scope.md): what began it and, for the owner's, the most telling
 * tool it called, in this order.
 */
export type RunClass =
	| "answer"
	| "browser"
	| "coding agent"
	| "delegation"
	| "research"
	| "connection"
	| "work"
	| Exclude<RunStart, "owner">;

export type Spread = { readonly n: number; readonly p50?: number; readonly p90?: number };

export type ClassLine = {
	readonly class: RunClass;
	readonly runs: number;
	/** Runs the daemon nudged for leaving the owner unanswered. */
	readonly nudged: number;
	readonly requests: Spread;
	/** Tokens sent per run: uncached, read from the cache and written to it. */
	readonly sent: Spread;
	readonly written: Spread;
	readonly output: Spread;
	/** Dollars per run, by the catalog's prices. */
	readonly cost: Spread;
	/** Read over sent, all the class's requests together. */
	readonly hitRate?: number;
	/** Milliseconds from what began the run, in a chat nothing ran in, to its first words reaching the owner. */
	readonly firstWords: Spread;
	/** The part of `firstWords` no request accounts for: banda's own time and its tools'. */
	readonly firstWordsOwn: Spread;
};

export type TurnAudit = {
	readonly classes: readonly ClassLine[];
	/** banda's own time, in milliseconds per sample. */
	readonly own: {
		/** From the owner's message to the first request, with nothing between and nothing running. */
		readonly firstRequest: Spread;
		/** From a response's end to the start of the first tool it called. */
		readonly toolStart: Spread;
		/** From the last tool's result to the next request. */
		readonly nextRequest: Spread;
		/** From an approval's answer to its effect's result: the service's time is in it. */
		readonly approval: Spread;
		/** From a question's answer to the next request. */
		readonly question: Spread;
	};
	/** Requests under `window` after their chat's last one, on its model, no compaction between; and those that read under half. */
	readonly warm: { readonly requests: number; readonly missed: number };
	/** Per model, the owner's runs it began and those the daemon nudged. */
	readonly nudges: readonly { readonly model: string; readonly runs: number; readonly nudged: number }[];
};

const SPEAKING = new Set(["message_user", "message_group", "react"]);
const RESEARCH = new Set(["web_fetch", "search", "read_search_result"]);
const ORDER: readonly RunClass[] = [
	"answer",
	"research",
	"work",
	"delegation",
	"coding agent",
	"connection",
	"browser",
	"routine",
	"watch",
	"agent",
	"group",
	"return",
];

function quantile(sorted: readonly number[], p: number): number | undefined {
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function spread(values: readonly number[]): Spread {
	const sorted = [...values].sort((a, b) => a - b);
	const p50 = quantile(sorted, 0.5);
	const p90 = quantile(sorted, 0.9);
	return { n: sorted.length, ...(p50 === undefined ? {} : { p50 }), ...(p90 === undefined ? {} : { p90 }) };
}

type Request = Extract<TurnRow, { type: "request" }> & { readonly usage: AuditUsage };
type Run = { readonly start: Extract<TurnRow, { type: "start" }>; readonly rows: TurnRow[]; readonly idle: boolean };

const reported = (row: TurnRow): row is Request =>
	row.type === "request" &&
	row.usage !== undefined &&
	row.usage.input + row.usage.output + row.usage.cacheRead + row.usage.cacheWrite > 0;
const sentOf = (usage: AuditUsage) => usage.input + usage.cacheRead + usage.cacheWrite;
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function classOf(run: Run): RunClass {
	if (run.start.start !== "owner") return run.start.start;
	const calls = run.rows.flatMap((row) => (row.type === "request" ? row.calls : []));
	if (calls.some((name) => name.startsWith("browser_"))) return "browser";
	if (calls.some((name) => name.startsWith("harness__"))) return "coding agent";
	if (calls.includes("message_agent")) return "delegation";
	if (calls.some((name) => RESEARCH.has(name))) return "research";
	// a connection's tools carry its name before two underscores
	if (calls.some((name) => name.includes("__"))) return "connection";
	return calls.some((name) => !SPEAKING.has(name)) ? "work" : "answer";
}

/** The audit of `rows`, each chat's in order. */
export function auditTurns({
	rows,
	between = {},
	window = CACHE_WINDOW,
}: {
	rows: readonly TurnRow[];
	/** Count only what happened in this range; a row with no time of its own takes its chat's last. */
	between?: { readonly from?: number; readonly to?: number };
	window?: number;
}): TurnAudit {
	const chats = new Map<number, TurnRow[]>();
	const clock = new Map<number, number>();
	for (const row of rows) {
		const at = ("at" in row ? row.at : undefined) ?? clock.get(row.chat) ?? 0;
		clock.set(row.chat, at);
		if (at < (between.from ?? Number.NEGATIVE_INFINITY) || at >= (between.to ?? Number.POSITIVE_INFINITY)) continue;
		const list = chats.get(row.chat) ?? [];
		chats.set(row.chat, list);
		list.push(row);
	}

	const runs: Run[] = [];
	const firstRequest: number[] = [];
	const toolStart: number[] = [];
	const nextRequest: number[] = [];
	const approval: number[] = [];
	const question: number[] = [];
	const warm = { requests: 0, missed: 0 };
	for (const list of chats.values()) {
		let run: Run | undefined;
		let busy = 0;
		let last: Request | undefined;
		let compacted = false;
		for (const [index, row] of list.entries()) {
			if (row.type === "start") {
				run = { start: row, rows: [], idle: (row.at ?? 0) >= busy };
				runs.push(run);
				const next = list.slice(index + 1).find((each) => each.type !== "status");
				if (row.start === "owner" && run.idle && row.at !== undefined && next?.type === "request")
					firstRequest.push(next.at - row.at);
				continue;
			}
			run?.rows.push(row);
			if (row.type === "compaction") compacted = true;
			if (row.type === "tool") busy = Math.max(busy, row.at);
			if (row.type === "wait" && row.at !== undefined) {
				const rest = list.slice(index + 1, index + 8);
				const result = rest.find((each) => each.type === "tool");
				const request = rest.find((each) => each.type === "request");
				if (row.approval && result?.type === "tool") approval.push(result.at - row.at);
				if (!row.approval && request?.type === "request") question.push(request.at - row.at);
			}
			if (row.type !== "request") continue;
			busy = Math.max(busy, row.at + (row.ms ?? 0));
			if (reported(row)) {
				if (
					last !== undefined &&
					last.model === row.model &&
					!compacted &&
					row.at - (last.at + (last.ms ?? 0)) < window
				) {
					warm.requests++;
					if (row.usage.cacheRead / sentOf(row.usage) < 0.5) warm.missed++;
				}
				last = row;
				compacted = false;
			}
			// the tools it called and the request after them, when nothing else came between
			if (row.ms === undefined || row.calls.length === 0) continue;
			const tools: Extract<TurnRow, { type: "tool" }>[] = [];
			let after = index + 1;
			for (; after < list.length; after++) {
				const each = list[after] as TurnRow;
				if (each.type === "tool") tools.push(each);
				else if (each.type !== "status") break;
			}
			if (tools.length !== row.calls.length) continue;
			if (tools.every((tool) => tool.ms !== undefined))
				toolStart.push(Math.min(...tools.map((tool) => tool.at - (tool.ms ?? 0))) - (row.at + row.ms));
			const next = list[after];
			if (next?.type === "request") nextRequest.push(next.at - Math.max(...tools.map((tool) => tool.at)));
		}
	}

	const byClass = new Map<RunClass, Run[]>();
	const nudges = new Map<string, { model: string; runs: number; nudged: number }>();
	for (const run of runs) {
		const requests = run.rows.filter(reported);
		if (requests.length === 0) continue;
		const name = classOf(run);
		byClass.set(name, [...(byClass.get(name) ?? []), run]);
		if (run.start.start !== "owner") continue;
		const model = (requests[0] as Request).model;
		const line = nudges.get(model) ?? { model, runs: 0, nudged: 0 };
		nudges.set(model, line);
		line.runs++;
		if (run.rows.some((row) => row.type === "nudge")) line.nudged++;
	}

	const classes = ORDER.flatMap((name): ClassLine[] => {
		const list = byClass.get(name);
		if (list === undefined) return [];
		const per = (value: (usage: AuditUsage) => number) =>
			list.map((run) => sum(run.rows.filter(reported).map((row) => value(row.usage))));
		const firstWords: number[] = [];
		const firstWordsOwn: number[] = [];
		for (const run of list) {
			if (!run.idle || run.start.at === undefined) continue;
			let model = 0;
			for (const row of run.rows) {
				// an ask stops the clock: the owner's time to answer is not the run's
				if (row.type === "wait") break;
				if (row.type === "request") model += row.ms ?? 0;
				const spoke = row.type === "tool" && (row.name === "message_user" || row.name === "message_group");
				const ended = row.type === "request" && row.answered && row.ms !== undefined;
				if (!spoke && !ended) continue;
				const at = row.type === "request" ? row.at + (row.ms ?? 0) : (row as { at: number }).at;
				firstWords.push(at - run.start.at);
				firstWordsOwn.push(at - run.start.at - model);
				break;
			}
		}
		const read = sum(per((usage) => usage.cacheRead));
		const sent = sum(per(sentOf));
		return [
			{
				class: name,
				runs: list.length,
				nudged: list.filter((run) => run.rows.some((row) => row.type === "nudge")).length,
				requests: spread(list.map((run) => run.rows.filter(reported).length)),
				sent: spread(per(sentOf)),
				written: spread(per((usage) => usage.cacheWrite)),
				output: spread(per((usage) => usage.output)),
				cost: spread(per((usage) => usage.cost)),
				...(sent === 0 ? {} : { hitRate: read / sent }),
				firstWords: spread(firstWords),
				firstWordsOwn: spread(firstWordsOwn),
			},
		];
	});

	return {
		classes,
		own: {
			firstRequest: spread(firstRequest),
			toolStart: spread(toolStart),
			nextRequest: spread(nextRequest),
			approval: spread(approval),
			question: spread(question),
		},
		warm,
		nudges: [...nudges.values()].sort((a, b) => a.model.localeCompare(b.model)),
	};
}
