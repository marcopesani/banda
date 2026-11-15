/**
 * The fault workers' setups, with no fault: what each sets up does what its sweep assumes. A fault suite runs at night
 * and a worker stops describing the product without anything saying so; this is the ordinary suite saying so on every
 * push. It kills nothing and checks only the run with no fault; what holds under kills is `test/*.faults.test.ts`'s.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Faults } from "./fault/faults.ts";
import { runWorker, unlanded } from "./fault/kill.ts";
import { objectProblems, objectScenario } from "./fault/object-scenario.ts";
import { SCENARIOS as WATCH_SCENARIOS, type WatchSummary } from "./fault/watch-scenario.ts";
import { type FakeMcp, startFakeMcp } from "./fixtures/mcp-server.ts";
import { tempHome } from "./helpers.ts";

const fakes: FakeMcp[] = [];
afterEach(async () => {
	for (const fake of fakes.splice(0)) await fake.close();
});

describe("a fault worker's setup, run with no fault", () => {
	for (const scenario of [
		{ count: 2, failed: true, revoke: true },
		{ count: 2, failed: false, revoke: false },
	])
		it(`the object readings are kept: ${JSON.stringify(scenario)}`, async () => {
			const summary = await objectScenario(await tempHome(), scenario, new Faults());
			expect(objectProblems(summary, scenario)).toEqual([]);
			expect(summary.calls.length).toBeGreaterThan(0);
		});

	for (const mode of ["callback", "code", "rule", "carry", "carry-deny"] as const)
		it(`a connection's run reads and writes as approved: ${mode}`, async () => {
			const fake = await startFakeMcp(
				mode === "code" || mode === "carry" || mode === "carry-deny"
					? { auth: "oauth", registeredClient: "banda-app", device: true }
					: { auth: "oauth" },
			);
			fakes.push(fake);
			const home = await tempHome();
			const { last } = await runWorker("test/fault/connection-worker.ts", [home, fake.url, mode], []);
			if (mode === "carry") {
				const replayed = await runWorker("test/fault/connection-worker.ts", [home, fake.url, mode], []);
				expect(replayed.last).toMatchObject({
					outcome: { status: "completed" },
					oldOutcome: { status: "completed" },
					answers: ["refused", "deny", "approve"],
					permissions: [],
					open: 0,
					parked: [],
				});
			}
			const denied = mode === "carry-deny";
			expect(last).toMatchObject({
				outcome: { status: "completed" },
				answers: mode === "carry" ? ["refused", "deny", "approve"] : denied ? ["refused", "deny"] : ["approve"],
				open: 0,
				parked: [],
			});
			expect(fake.calls.filter((call) => call.tool === "create_event")).toHaveLength(denied ? 0 : 1);
			// The old draft cannot borrow the new read definition; only the fresh, approved request can send.
			if (mode.startsWith("carry")) {
				expect(last).toMatchObject({ oldOutcome: { status: "completed" }, permissions: [] });
				expect(fake.calls.filter((call) => call.tool === "create_event")).toEqual(
					denied ? [] : [{ tool: "create_event", args: { title: "Fresh tea", day: "mon" } }],
				);
				const { due, points } = last as { due: boolean; points: Record<string, number> };
				expect(due).toBe(false);
				expect(points["connection:stays-write"]).toBeGreaterThan(0);
			}
		});

	// a hit's number is not the same commit in every run (`PAST` in fault/kill.ts): a sweep schedules kills by the
	// counts of one run, and the run it kills may end a commit sooner
	it("a kill scheduled past where a watch's run ends does not land, and its sweep tells that from a kill that misfired", async () => {
		const fault = { point: "commit:before", hit: 1000, kind: "kill" } as const;
		const { last, kills } = await runWorker("test/fault/watch-worker.ts", [await tempHome(), "life"], [[fault]]);
		const summary = last as WatchSummary;
		expect(kills).toBe(0);
		expect(WATCH_SCENARIOS.life?.problems(summary)).toEqual([]);
		// its own count of the point, and what each commit it counted wrote
		expect(summary.reached["commit:before"]).toBe(summary.commits);
		expect(summary.trace).toHaveLength(summary.commits);
		expect(summary.trace.some((wrote) => wrote.includes("entry banda.watch-wake"))).toBe(true);
		const run = { kills, reached: summary.reached };
		expect(unlanded(fault, run)).toBeUndefined();
		// the same run under a kill it passed: the injection did not fire, which no sweep lets by
		expect(unlanded({ ...fault, hit: summary.commits }, run)).toMatch(/was not killed at #/);
		expect(unlanded({ ...fault, hit: 1 }, run)).toMatch(/was not killed at #1/);
		expect(unlanded(fault, { kills: 1, reached: {} })).toBeUndefined();
		expect(unlanded(fault, { kills: 2, reached: {} })).toMatch(/2 processes were killed/);
	});
});
