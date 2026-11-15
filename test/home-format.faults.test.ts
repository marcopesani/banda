/**
 * A home's migration under kills (`src/core/format.ts`, on the test-only steps of `fault/format-scenario.ts`): a
 * SIGKILL at every boundary of the runner and of each step, then generated runs of kills and thrown faults. Each
 * process checks what the one before left, and the last one that every step was applied once.
 */
import fc from "fast-check";
import { expect, it } from "vitest";
import type { Fault } from "./fault/faults.ts";
import { FORMAT_POINTS, STEP_POINTS, seed } from "./fault/format-scenario.ts";
import { pool, runWorker } from "./fault/kill.ts";
import { tempHome } from "./helpers.ts";
import { pbtFaultRuns } from "./pbt.ts";

const STEPS = 2;
const points = [...FORMAT_POINTS, ...STEP_POINTS];
/** Points a run of two steps passes once, and those it passes once per step. */
const hitsOf = (point: (typeof points)[number]) =>
	point === "format:before" || point === "format:settled" ? 1 : STEPS;

const run = async (schedules: Fault[][]) => {
	const home = await tempHome();
	await seed(home);
	const result = await runWorker("test/fault/format-worker.ts", [home, String(STEPS)], schedules);
	// settled, a later start changes nothing and asks for no backup
	expect((await runWorker("test/fault/format-worker.ts", [home, String(STEPS)], [])).last).toEqual({ attempts: 1 });
	return result;
};

it("sweeps a kill at every boundary of the runner and of each step", async () => {
	const kills = points.flatMap((point) =>
		Array.from({ length: hitsOf(point) }, (_, i): Fault => ({ point, hit: i + 1, kind: "kill" })),
	);
	await pool(
		2,
		kills.map((kill) => async () => expect((await run([[kill]])).kills, `${kill.point} #${kill.hit}`).toBe(1)),
	);
}, 120_000);

it("settles across generated kills and thrown faults, one process after another", async () => {
	const fault = fc.record({
		point: fc.constantFrom(...points),
		hit: fc.integer({ min: 1, max: STEPS }),
		kind: fc.constantFrom("kill" as const, "error" as const),
	});
	await fc.assert(
		fc.asyncProperty(fc.array(fc.array(fault, { minLength: 1, maxLength: 2 }), { maxLength: 4 }), async (schedules) => {
			await run(schedules);
		}),
		{ numRuns: pbtFaultRuns(15) },
	);
}, 120_000);
