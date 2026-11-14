/**
 * The fault workers' setups, with no fault: what each sets up does what its sweep assumes. A fault suite runs at night
 * and a worker stops describing the product without anything saying so; this is the ordinary suite saying so on every
 * push. It kills nothing and checks only the run with no fault; what holds under kills is `test/*.faults.test.ts`'s.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Faults } from "./fault/faults.ts";
import { runWorker } from "./fault/kill.ts";
import { objectProblems, objectScenario } from "./fault/object-scenario.ts";
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
});
