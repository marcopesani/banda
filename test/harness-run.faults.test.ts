import { describe, expect, it } from "vitest";
import type { Fault } from "./fault/faults.ts";
import { PAST, pool, runWorker, unlanded } from "./fault/kill.ts";
import { tempHome } from "./helpers.ts";

/** The sessions the worker seeds as a dead daemon's leftovers (test/fault/harness-run-worker.ts). */
const LEFT = { first: 999_997, second: 999_998, run: 999_999 };

type Summary = {
	run: number;
	chat: number;
	sessions: { [task: string]: { chat: number; state: string; ended: boolean } };
	woke: { [chat: string]: number[] };
	registered: boolean;
	turns: { chat: number; status: string }[];
	prompts: number;
	sent: string[];
	parked: unknown[];
	commits: number;
	models: number;
	reached: { [point: string]: number };
	trace: string[];
};

const run = async (schedules: readonly (readonly Fault[])[]) => {
	const { last, kills } = await runWorker("test/fault/harness-run-worker.ts", [await tempHome()], schedules);
	return { ...(last as Summary), kills };
};

/**
 * A coding agent's session begun in a routine's run, and the sessions a dead daemon left, under kills: every session
 * ends once, each waking its agent exactly once in the chat it ran in (a left one as failed; the live one as done,
 * interrupted past its ask, or failed); the live one's ask reaches the harness at most once, and exactly once when it
 * finished; the run is one of its agent's chats only while a turn of it goes, so none at the end; every turn ended
 * completed; what each wake said reached the owner; nothing is parked.
 */
function check(summary: Summary) {
	const { run, chat, sessions } = summary;
	const live = Object.keys(sessions)
		.map(Number)
		.filter((task) => !Object.values(LEFT).includes(task));
	expect(live, "the session begun in the run").toHaveLength(1);
	const session = sessions[String(live[0])]!;
	expect(session.chat).toBe(run);
	expect(["done", "interrupted", "failed"]).toContain(session.state);
	for (const task of Object.values(LEFT))
		expect(sessions[String(task)], `left session ${task}`).toMatchObject({ state: "failed", ended: true });
	expect(session.ended).toBe(true);
	expect(summary.prompts).toBeLessThanOrEqual(1);
	if (session.state === "done") expect(summary.prompts).toBe(1);
	// one wake per session, in the chat it ran in, however many processes ended them
	expect([...(summary.woke[String(chat)] ?? [])].sort(), "the agent's chat was told of").toEqual(
		[LEFT.first, LEFT.second].sort(),
	);
	expect([...(summary.woke[String(run)] ?? [])].sort(), "the run was told of").toEqual([LEFT.run, live[0]!].sort());
	expect(summary.registered, "the run among its agent's chats after its last turn").toBe(false);
	for (const turn of summary.turns) expect(turn.status, `a turn of chat ${turn.chat}`).toBe("completed");
	// the run's first turn, and one per wake there; one per wake in the agent's chat
	expect(summary.turns.filter((turn) => turn.chat === run)).toHaveLength(3);
	expect(summary.turns.filter((turn) => turn.chat === chat)).toHaveLength(2);
	// each wake told the owner (a send may repeat after a kill between it and its record: the turn suites own that)
	expect(summary.sent.filter((text) => text.includes("harness-result")).length).toBeGreaterThanOrEqual(4);
	expect(summary.parked).toEqual([]);
}

const told = (fault: Fault, killed: Summary & { kills: number }, clean: Summary) =>
	[
		`kills ${killed.kills}; the last process reached ${JSON.stringify(killed.reached)}; the run without faults ${JSON.stringify(clean.reached)}`,
		`sessions ${JSON.stringify(killed.sessions)}`,
		`woke ${JSON.stringify(killed.woke)}, registered ${killed.registered}, turns ${JSON.stringify(killed.turns)}`,
		`prompts ${killed.prompts}, parked ${JSON.stringify(killed.parked)}`,
		`scheduled ${fault.kind} at ${fault.point} #${fault.hit}; the last process's commits:`,
		...killed.trace.map((wrote, i) => `  #${i + 1} ${wrote}`),
	].join("\n");

describe("a coding agent's session in a routine's run, and a dead daemon's left sessions, under faults", () => {
	it("sweep: one kill at every commit, model request and harness boundary; every session ends once, waking its agent once", async () => {
		const clean = await run([]);
		expect(clean.kills).toBe(0);
		check(clean);
		expect(
			clean.sessions[
				String(
					Object.keys(clean.sessions)
						.map(Number)
						.find((task) => !Object.values(LEFT).includes(task)),
				)
			]?.state,
		).toBe("done");
		const faults: Fault[] = [
			{ point: "harness:spawn", hit: 1, kind: "kill" },
			{ point: "harness:prompted", hit: 1, kind: "kill" },
			{ point: "harness:update", hit: 1, kind: "kill" },
			{ point: "harness:spawn", hit: 1, kind: "error" },
			{ point: "harness:update", hit: 1, kind: "error" },
		];
		// past the run without faults' counts too: another run of the same scenario is a commit longer (`PAST`)
		for (let hit = 1; hit <= clean.commits + PAST; hit++)
			faults.push({ point: "commit:before", hit, kind: "kill" }, { point: "commit:after", hit, kind: "kill" });
		for (let hit = 1; hit <= clean.models + PAST; hit++) faults.push({ point: "model", hit, kind: "kill" });
		await pool(
			2,
			faults.map((fault) => async () => {
				const killed = await run([[fault]]);
				try {
					// the kill landed, or the run ended before its hit and is a run without faults: never passed and not killed
					if (fault.kind === "kill") expect(unlanded(fault, killed)).toBeUndefined();
					check(killed);
					// past the ask, a restart never sends it again
					if (fault.point === "harness:update" && fault.kind === "kill")
						expect(
							killed.sessions[
								String(
									Object.keys(killed.sessions)
										.map(Number)
										.find((task) => !Object.values(LEFT).includes(task)),
								)
							]?.state,
						).toBe("interrupted");
				} catch (error) {
					throw new Error(
						`${fault.kind} at ${fault.point} #${fault.hit}: ${(error as Error).message}\n${told(fault, killed, clean)}`,
					);
				}
			}),
		);
	}, 900_000);
});
