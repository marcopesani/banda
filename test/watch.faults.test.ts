import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Fault, FaultPoint } from "./fault/faults.ts";
import { PAST, pool, runWorker, unlanded } from "./fault/kill.ts";
import { SLACK_SCENARIOS } from "./fault/slack-world.ts";
import { SCENARIOS as WATCH_SCENARIOS, type WatchSummary } from "./fault/watch-scenario.ts";

/** The pull request's scenarios and Slack's paged ones, by the name the worker runs them by. */
const SCENARIOS = { ...WATCH_SCENARIOS, ...SLACK_SCENARIOS };

import { tempHome } from "./helpers.ts";
import { pbtFaultRuns } from "./pbt.ts";

const run = async (scenario: string, schedules: readonly (readonly Fault[])[]) => {
	const { last, kills } = await runWorker("test/fault/watch-worker.ts", [await tempHome(), scenario], schedules);
	return { ...(last as WatchSummary), kills };
};

/**
 * A failed run in full: where the kill was scheduled and whether it landed, what the last process reached beside the
 * run without faults, what the store holds of the watches and their wakes, and what each of the last process's commits
 * wrote. A sweep fails once in many runs, on a machine nobody can ask again.
 */
const told = (scenario: string, fault: Fault, killed: Awaited<ReturnType<typeof run>>, clean: WatchSummary) =>
	[
		`scenario ${scenario}, kill at ${fault.point} #${fault.hit}: ${killed.kills} killed`,
		`the last process reached ${JSON.stringify(killed.reached)}; the run without faults ${JSON.stringify(clean.reached)}`,
		`watches ${JSON.stringify(killed.records)}`,
		`readings ${JSON.stringify(killed.versions)}, task ${JSON.stringify(killed.task ?? null)}`,
		`wakes ${JSON.stringify(killed.wakes)}`,
		`tells ${JSON.stringify(killed.tells)}, troubles ${JSON.stringify(killed.troubles)}`,
		`runs ${JSON.stringify(killed.turns)}, sent ${JSON.stringify(killed.sent)}, parked ${JSON.stringify(killed.parked)}`,
		"the last process's commits:",
		...killed.trace.map((wrote, i) => `  #${i + 1} ${wrote}`),
	].join("\n");

const POINTS: FaultPoint[] = ["commit:before", "commit:after", "model", "watch:read", "send:before", "send:after"];

describe.each(Object.keys(SCENARIOS))("a watch under faults: %s", (scenario) => {
	const problems = (SCENARIOS[scenario] as (typeof SCENARIOS)[string]).problems;

	it("sweep: one kill at every commit, read, model request and send; what must hold holds", async () => {
		const clean = await run(scenario, []);
		expect(clean.kills).toBe(0);
		expect(problems(clean)).toEqual([]);
		const faults: Fault[] = [
			{ point: "send:before", hit: 1, kind: "kill" },
			{ point: "send:after", hit: 1, kind: "kill" },
		];
		// past the run without faults' counts too: another run of the same scenario is a commit longer (`PAST`)
		for (let hit = 1; hit <= clean.looks + PAST; hit++) faults.push({ point: "watch:read", hit, kind: "kill" });
		for (let hit = 1; hit <= clean.commits + PAST; hit++)
			faults.push({ point: "commit:before", hit, kind: "kill" }, { point: "commit:after", hit, kind: "kill" });
		for (let hit = 1; hit <= clean.models + PAST; hit++) faults.push({ point: "model", hit, kind: "kill" });
		await pool(
			2,
			faults.map((fault) => async () => {
				const killed = await run(scenario, [[fault]]);
				try {
					// the kill landed, or the run ended before its hit and is a run without faults: never passed and not killed
					expect(unlanded(fault, killed)).toBeUndefined();
					expect(problems(killed)).toEqual([]);
				} catch (error) {
					throw new Error(
						`killed at ${fault.point} #${fault.hit}: ${(error as Error).message}\n${told(scenario, fault, killed, clean)}`,
					);
				}
			}),
		);
	}, 900_000);

	it("property: under any few kills, what must hold holds", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(
					fc.record({
						point: fc.constantFrom(...POINTS),
						hit: fc.integer({ min: 1, max: 40 }),
						kind: fc.constant("kill" as const),
					}),
					{ minLength: 1, maxLength: 3 },
				),
				async (kills) => {
					expect(
						problems(
							await run(
								scenario,
								kills.map((kill) => [kill]),
							),
						),
					).toEqual([]);
				},
			),
			{ numRuns: pbtFaultRuns(3) },
		);
	}, 600_000);
});
