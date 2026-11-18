import { createModels } from "@earendil-works/pi-ai";
import { createRegistry } from "@earendil-works/pi-durable";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseRoutine, RoutineRuns, wakeAsk, wakeText } from "../src/core/routines.ts";
import { context, openStore } from "../src/core/store.ts";
import type { Item } from "../src/server/api.ts";
import { lineRun } from "../src/server/routine-runs.ts";
import { view } from "../web/src/lib/chat.ts";
import { tempHome } from "./helpers.ts";
import { pbtRuns } from "./pbt.ts";

describe("a wake's text", () => {
	const routine = (ask: string) => {
		const parsed = parseRoutine("tea", `---\ndescription: Tea\ncron: 0 16 * * *\n---\n${ask}\n`);
		if ("errors" in parsed) throw new Error(parsed.errors.join("; "));
		return parsed.routine;
	};

	it("gives back the routine's own words, whatever they hold, for a due run and the owner's own", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.string({ minLength: 1 }).map((line) => line.replace(/\s+/g, " ").trim() || "x"),
					{
						minLength: 1,
						maxLength: 6,
					},
				),
				fc.boolean(),
				(paragraphs, owner) => {
					const { ask } = routine(paragraphs.join("\n\n"));
					expect(wakeAsk(wakeText(routine(ask), Date.UTC(2026, 10, 18, 8), owner))).toBe(ask);
				},
			),
			{ numRuns: pbtRuns(100) },
		);
	});

	it("is not found in words that are no wake's", () => {
		expect(wakeAsk("Tea, please.")).toBeUndefined();
		expect(wakeAsk("Your routine was due.\n\nSay tea.")).toBeUndefined();
	});
});

describe("a routine's line in its agent's chat", () => {
	it("names the run it stands for, by the chat and the line's entry alone", async () => {
		const harness = await openStore(await tempHome(), { models: createModels(), registry: createRegistry() });
		try {
			const wake = { routine: "tea", due: 1, description: "Tea" };
			await harness.commit(async (tx) => {
				const runs = (await tx.doc(RoutineRuns)).runs;
				runs[7] = { agent: "mara", routine: "tea", chat: 3, wake, line: 12 };
				// a quiet run drew no line
				runs[8] = { agent: "mara", routine: "tea", chat: 3, wake };
			}, context);
			expect(await lineRun(harness, 3, 12)).toBe(7);
			expect(await lineRun(harness, 3, 13)).toBeUndefined();
			expect(await lineRun(harness, 4, 12)).toBeUndefined();
		} finally {
			await harness.close(context);
		}
	});
});

describe("a run's own wake in the feed", () => {
	const wake: Item = { id: 5, role: "wake", routine: "tea", text: "Tea", ask: "Say tea.", at: 1 };

	const live = { busy: false, running: [], thinking: false };

	it("is the routine's words as the owner's message in the run's conversation, and never in a chat", () => {
		const inRun = view([wake], [], live, { run: true });
		expect(inRun.map((segment) => segment.kind)).toEqual(["owner-message"]);
		expect(JSON.stringify(inRun)).toContain("Say tea.");
		// in a chat it stays a routine's event: a line, or nothing for a quiet run; the words are never the owner's
		const inChat = view([wake], [], live, {});
		expect(inChat.map((segment) => segment.kind)).not.toContain("owner-message");
		expect(JSON.stringify(inChat)).not.toContain("Say tea.");
	});
});
