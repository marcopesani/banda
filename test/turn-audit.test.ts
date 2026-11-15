import { describe, expect, it } from "vitest";
import { auditTurns, spread, type TurnRow } from "../src/core/turn-audit.ts";

const usage = (cacheRead: number, cacheWrite: number, cost: number) => ({
	input: 10,
	output: 50,
	cacheRead,
	cacheWrite,
	cost,
});
const request = (
	at: number,
	calls: readonly string[],
	read: number,
	written: number,
	cost: number,
	answered = false,
): TurnRow => ({
	type: "request",
	chat: 1,
	at,
	ms: 1_000,
	model: "faux/faux-1",
	calls,
	answered,
	usage: usage(read, written, cost),
});

describe("what a home's runs took", () => {
	it("gives the median and the 90th percentile of what it is handed", () => {
		expect(spread([])).toEqual({ n: 0 });
		expect(spread([5, 1, 3, 2, 4, 6, 7, 8, 9, 10])).toEqual({ n: 10, p50: 5, p90: 9 });
	});

	it("times an answer from the owner's message to its words, and banda's part of it", () => {
		const audit = auditTurns({
			rows: [
				{ type: "start", chat: 1, start: "owner", at: 1_000 },
				{ type: "status", chat: 1 },
				request(1_020, ["message_user"], 0, 9_000, 0.01),
				{ type: "tool", chat: 1, name: "message_user", at: 2_032, ms: 7 },
				request(2_050, [], 9_000, 100, 0.002),
			],
		});
		expect(audit.classes).toEqual([
			{
				class: "answer",
				runs: 1,
				nudged: 0,
				requests: { n: 1, p50: 2, p90: 2 },
				sent: { n: 1, p50: 18_120, p90: 18_120 },
				written: { n: 1, p50: 9_100, p90: 9_100 },
				output: { n: 1, p50: 100, p90: 100 },
				cost: { n: 1, p50: 0.012, p90: 0.012 },
				hitRate: 9_000 / 18_120,
				firstWords: { n: 1, p50: 1_032, p90: 1_032 },
				firstWordsOwn: { n: 1, p50: 32, p90: 32 },
			},
		]);
		expect(audit.own.firstRequest).toEqual({ n: 1, p50: 20, p90: 20 });
		expect(audit.own.toolStart).toEqual({ n: 1, p50: 5, p90: 5 });
		expect(audit.own.nextRequest).toEqual({ n: 1, p50: 18, p90: 18 });
		// the second request came warm and read nearly all it sent
		expect(audit.warm).toEqual({ requests: 1, missed: 0 });
	});

	it("names a run by what began it and the most telling tool it called, and counts the nudged", () => {
		const audit = auditTurns({
			rows: [
				{ type: "start", chat: 1, start: "owner", at: 0 },
				request(10, ["bash", "browser_navigate"], 0, 100, 0.1),
				{ type: "start", chat: 1, start: "owner", at: 5_000 },
				request(5_010, ["github__get_me"], 100, 0, 0.1),
				{ type: "wait", chat: 1, approval: true, at: 9_000 },
				{ type: "tool", chat: 1, name: "github__get_me", at: 11_000, ms: 1_500 },
				{ type: "start", chat: 1, start: "owner", at: 20_000 },
				request(20_010, [], 100, 0, 0.1, true),
				{ type: "nudge", chat: 1 },
				request(21_500, ["message_user"], 100, 0, 0.1),
				{ type: "start", chat: 1, start: "routine", at: 30_000 },
				request(30_010, ["web_fetch"], 100, 0, 0.1),
			],
		});
		expect(audit.classes.map((line) => [line.class, line.runs, line.nudged])).toEqual([
			["answer", 1, 1],
			["connection", 1, 0],
			["browser", 1, 0],
			["routine", 1, 0],
		]);
		expect(audit.own.approval).toEqual({ n: 1, p50: 2_000, p90: 2_000 });
		expect(audit.nudges).toEqual([{ model: "faux/faux-1", runs: 3, nudged: 1 }]);
	});

	it("counts only what happened in the range it is given", () => {
		const rows: TurnRow[] = [
			{ type: "start", chat: 1, start: "owner", at: 0 },
			request(10, [], 0, 100, 0.1, true),
			{ type: "start", chat: 1, start: "owner", at: 10_000 },
			request(10_010, [], 100, 0, 0.1, true),
		];
		expect(auditTurns({ rows, between: { from: 5_000 } }).classes.map((line) => line.runs)).toEqual([1]);
		expect(auditTurns({ rows }).classes.map((line) => line.runs)).toEqual([2]);
	});
});
