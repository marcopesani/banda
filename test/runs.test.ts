/**
 * A call's run (src/core/runs.ts): read back from a chat's newest entry only as far as that run's start, so saying
 * what a message showed costs the run's length, not the chat's.
 */
import type { EntryRecord, Tx } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { callsOfRun, type RunEntry } from "../src/core/runs.ts";

type Fake = { readonly id: number; readonly starts?: true; readonly calls?: readonly string[] };

/** A store holding `entries` (oldest first) for one chat, as `scanEntries` pages them newest first. */
function store(entries: readonly Fake[]) {
	let read = 0;
	const tx = {
		scanEntries: async (_query: unknown, limit: number, cursor?: number) => {
			const from = cursor ?? entries.length;
			const page = entries.slice(Math.max(0, from - limit), from).reverse();
			read += page.length;
			const next = from - limit > 0 ? from - limit : undefined;
			return { items: page as unknown as EntryRecord[], ...(next === undefined ? {} : { next }) };
		},
	} as unknown as Tx;
	const said = (entry: EntryRecord): RunEntry => {
		const fake = entry as unknown as Fake;
		return { starts: fake.starts === true, calls: fake.calls ?? [] };
	};
	return { tx, said, read: () => read };
}

/** A chat of `runs` earlier runs, each an input and a call, then the run under test. */
const history = (runs: number): Fake[] =>
	Array.from({ length: runs }, (_, i) => [
		{ id: 2 * i, starts: true as const },
		{ id: 2 * i + 1, calls: [`old-${i}`] },
	]).flat();

describe("a call's run", () => {
	it("reads back only to its run's start, however long the chat", async () => {
		const run: Fake[] = [
			{ id: 9000, starts: true },
			{ id: 9001, calls: ["publish"] },
			{ id: 9002, calls: ["show"] },
		];
		const { tx, said, read } = store([...history(2000), ...run]);
		const found = await callsOfRun(tx, 1, "show", said);
		expect([...found.calls].sort()).toEqual(["publish", "show"]);
		expect(found.scanned).toBe(3);
		// one page of the store, never the 4000 entries before
		expect(read()).toBe(50);
	});

	it("passes over a run that started after it (an input that came while it worked)", async () => {
		const { tx, said } = store([
			...history(3),
			{ id: 100, starts: true },
			{ id: 101, calls: ["publish", "show"] },
			{ id: 102, starts: true },
			{ id: 103, calls: ["later"] },
		]);
		const found = await callsOfRun(tx, 1, "show", said);
		expect([...found.calls].sort()).toEqual(["publish", "show"]);
	});

	it("takes the newest run when the call is not written yet", async () => {
		const { tx, said } = store([...history(3), { id: 100, starts: true }, { id: 101, calls: ["publish"] }]);
		expect([...(await callsOfRun(tx, 1, "unwritten", said)).calls]).toEqual(["publish"]);
	});

	it("a publish of an earlier run is not this run's", async () => {
		const { tx, said } = store([
			{ id: 1, starts: true },
			{ id: 2, calls: ["publish"] },
			{ id: 3, starts: true },
			{ id: 4, calls: ["show"] },
		]);
		expect((await callsOfRun(tx, 1, "show", said)).calls.has("publish")).toBe(false);
	});
});
