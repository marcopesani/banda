/** The band's rows from the daemon's chats and groups: one per agent and group, newest first; the tab counts asks first. */
import { describe, expect, it } from "vitest";
import { defaultAvatarFace } from "../src/core/avatar-face.ts";
import type { ChatRow, GroupRow, HarnessSessionView } from "../src/server/api.ts";
import { attentionOf, bandRows, titleOf } from "../web/src/app/band.ts";

const NOW = Date.parse("2026-11-03T12:00:00");
const agents = [
	{ id: "sancho", name: "Sancho", face: defaultAvatarFace() },
	{ id: "mara", name: "Mara", face: { ...defaultAvatarFace(), color: "#c79267" } },
];
const chat = (agent: string, at: number, more: Partial<ChatRow> = {}): ChatRow => ({
	chat: agent === "mara" ? 2 : 1,
	origin: { gateway: "web", peer: "owner", thread: agent === "sancho" ? "main" : `agent:${agent}` },
	agent,
	title: "",
	state: "idle",
	unanswered: 0,
	unread: 0,
	read: 0,
	at,
	...more,
});

describe("band rows", () => {
	it("lists every agent, its newest words, an open ask and unread, newest first", () => {
		const rows = bandRows(
			agents,
			[
				chat("mara", NOW - 60_000, {
					excerpt: "Three fit.",
					by: "agent",
					said: NOW - 60_000,
					unread: 2,
					ask: "Book the 9:15?",
					state: "waiting",
				}),
			],
			[],
			false,
			NOW,
		);
		expect(rows.map((row) => row.name)).toEqual(["Mara", "Sancho"]);
		expect(rows[0]).toMatchObject({ excerpt: "Three fit.", unread: 2, ask: "Book the 9:15?", state: "waiting" });
		expect(rows[1]).toMatchObject({
			excerpt:
				"Hi, I'm Sancho. Ask me anything: I can read the web, write, plan and keep track of things for you, and wake up on a schedule to check on something.",
			time: "",
		});
		expect(titleOf(rows)).toBe("(1 waiting, 2 unread) banda");
		expect(attentionOf(rows)).toEqual({ asks: 1, unread: 2 });
	});

	it("greets with what an agent's tools can do: the web only when it has the web or a browser", () => {
		const made = [
			{ id: "sancho", name: "Sancho", face: defaultAvatarFace() },
			{ id: "otto", name: "Otto", face: defaultAvatarFace(), tools: ["bash"] },
			{ id: "iris", name: "Iris", face: defaultAvatarFace(), tools: ["web_fetch"] },
		];
		const excerpts = Object.fromEntries(bandRows(made, [], [], false, NOW).map((row) => [row.name, row.excerpt]));
		expect(excerpts.Sancho).toContain("I can read the web, write");
		expect(excerpts.Iris).toContain("I can read the web, write");
		expect(excerpts.Otto).toBe(
			"Hi, I'm Otto. Ask me anything: I can write, plan and keep track of things for you, and wake up on a schedule to check on something.",
		);
	});

	it("moves a row only when something reached the owner, never on a run's own steps", () => {
		const rows = bandRows(
			agents,
			[
				// Mara worked a moment ago, but the last thing that reached the owner is older than Sancho's
				chat("mara", NOW - 1000, { excerpt: "Three fit.", by: "agent", said: NOW - 600_000 }),
				chat("sancho", NOW - 300_000, { excerpt: "Done.", by: "agent", said: NOW - 300_000 }),
			],
			[],
			false,
			NOW,
		);
		expect(rows.map((row) => row.name)).toEqual(["Sancho", "Mara"]);
	});

	it("puts an agent the owner just made, which has said nothing yet, before older chats", () => {
		const made = [
			...agents,
			{ id: "rosa", name: "Rosa", face: { ...defaultAvatarFace(), color: "#67a98c" }, since: NOW - 5_000 },
		];
		const rows = bandRows(
			made,
			[chat("mara", NOW - 60_000, { excerpt: "Three fit.", by: "agent", said: NOW - 60_000 })],
			[],
			false,
			NOW,
		);
		expect(rows.map((row) => row.name)).toEqual(["Rosa", "Mara", "Sancho"]);
		expect(rows[0]?.excerpt).toMatch(/^Hi, I'm Rosa\./);
	});

	it("lists a group with its members' faces, who spoke last and its unread", () => {
		const group: GroupRow = {
			room: 7,
			name: "Trip",
			members: ["sancho", "mara"],
			working: ["mara"],
			at: NOW - 3_600_000,
			latest: 9,
			last: { entry: 9, author: { agent: "sancho" }, text: "Saturday works", mentions: [], at: NOW - 1000 },
			executions: {},
			asking: [],
			read: 0,
			unread: 1,
		};
		const [row] = bandRows(agents, [], [group], false, NOW);
		expect(row).toMatchObject({
			name: "Trip",
			by: "Sancho",
			excerpt: "Saturday works",
			unread: 1,
			to: { name: "group", room: 7 },
		});
		expect(row?.faces).toEqual([
			{ ...agents[0], paused: false },
			{ ...agents[1], paused: false, state: "working" },
		]);
		// archived, it leaves the band; Settings lists it
		expect(bandRows(agents, [], [{ ...group, archived: NOW }], false, NOW).some((each) => each.id === "g:7")).toBe(
			false,
		);
	});

	it("says what the agent's own turn does: a coding session at work is not the agent working", () => {
		const session: HarnessSessionView = {
			task: 1,
			chat: 2,
			agent: "mara",
			harness: "claude-code",
			service: "Claude Code",
			folder: "~/code/app",
			state: "working",
			at: 1,
			steps: [],
			dropped: 0,
		};
		const asking: HarnessSessionView = {
			...session,
			state: "waiting",
			asks: [{ id: "a", kind: "execute", command: "npm test" }],
		};
		const mara = (state: ChatRow["state"], sessions: readonly HarnessSessionView[], more: Partial<ChatRow> = {}) =>
			bandRows(agents, [chat("mara", NOW, { state, ...more })], [], false, NOW, [], [], sessions).find(
				(row) => row.name === "Mara",
			);
		// the session works and the agent's turn ended: the face rests
		expect(mara("idle", [session])).toMatchObject({ state: "idle" });
		expect(mara("idle", [session])?.ask).toBeUndefined();
		// the agent's own turn works: its face does, whatever its sessions do
		expect(mara("running", [session])).toMatchObject({ state: "working" });
		expect(mara("running", [])).toMatchObject({ state: "working" });
		// a session asks: that waits on the owner, and the row says so, while the agent's own work still shows
		expect(mara("idle", [asking])).toMatchObject({ state: "waiting", ask: "1 coding session" });
		expect(mara("running", [asking])).toMatchObject({ state: "working", ask: "1 coding session" });
		// the agent's own ask: waiting, or working when something else of its goes on beside the ask
		expect(mara("waiting", [], { ask: "Book the 9:15?" })).toMatchObject({ state: "waiting", ask: "Book the 9:15?" });
		expect(mara("running", [], { ask: "Book the 9:15?" })).toMatchObject({ state: "working", ask: "Book the 9:15?" });
	});

	it("a change waiting to be allowed is said on the row, and never hides that its agent works", () => {
		const change = [{ agent: "mara", words: "a change to its routines" }];
		const mara = (state: ChatRow["state"]) =>
			bandRows(agents, [chat("mara", NOW, { state })], [], false, NOW, change).find((row) => row.name === "Mara");
		expect(mara("idle")).toMatchObject({ state: "idle", ask: "a change to its routines" });
		expect(mara("running")).toMatchObject({ state: "working", ask: "a change to its routines" });
	});
});
