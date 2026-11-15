import type { Harness } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { context } from "../src/core/store.ts";
import { Watches } from "../src/core/watches.ts";
import { Faults } from "./fault/faults.ts";
import { failure, GITHUB, watchScenario } from "./fault/watch-scenario.ts";
import { githubObjectTools } from "./fixtures/github-objects.ts";
import { tempHome } from "./helpers.ts";

/**
 * A connection there and signed in whose server lists no tool a kind must read with (GitHub's hosted server at its
 * default URL lists no discussion tools): the watch says that, not "not connected".
 */
const OBJECT = "https://github.com/github/github-mcp-server/discussions/1257";

const record = async (harness: Harness) => (await harness.snapshot(Watches, context))?.watches["banda-142"];

describe("a watch on a kind whose required read the connection's server does not list", () => {
	it("says which tool the connection has none of, not that it is not connected", async () => {
		let looked: Awaited<ReturnType<typeof record>>;
		const summary = await watchScenario(await tempHome(), new Faults(), {
			tasks: false,
			connection: {
				...GITHUB,
				account: "Wolfe-Jam",
				// the comments read alone: `get_discussion`, the kind's required read, is not listed
				tools: (await githubObjectTools()).filter((tool) => tool.name === "get_discussion_comments"),
			},
			object: OBJECT,
			answer: () => failure("never read"),
			clicks: [undefined],
			act: async (_step, { harness, core }) => {
				await core.lookWatch(harness, "banda-142");
				looked = await record(harness);
			},
		});
		expect(looked?.failed?.why).toBe(
			'GitHub here has no "get discussion" tool, so a discussion cannot be followed through it',
		);
		expect(looked?.done).toBeUndefined();
		expect(summary.reads).toBe(0);
		expect(summary.wakes).toEqual([]);
	}, 60_000);
});
