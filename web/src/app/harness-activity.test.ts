import { expect, it } from "vitest";
import type { HarnessSessionView } from "../../../src/server/api.ts";
import {
	askNotice,
	askSummary,
	askWords,
	callSession,
	harnessActivity,
	shownAsks,
	toolService,
} from "./harness-activity.ts";

const one: HarnessSessionView = {
	task: 1,
	chat: 3,
	agent: "sancho",
	harness: "claude-code",
	service: "Claude Code",
	folder: "~/code/app",
	state: "working",
	at: 1,
	steps: [],
	dropped: 0,
};
it("finds the session a coding agent's call led to by the call, and says when it is no longer kept", () => {
	const started = { ...one, task: 7, call: "c1" };
	const seen = { sessions: [started, { ...one, task: 5, call: "c0" }] };
	const work = (id: string, args: Record<string, unknown> = {}) => ({
		id,
		name: "harness__claude_code",
		args: { prompt: "Fix it.", ...args },
	});
	const ok = { error: false };
	// by the call that started it, in this chat only, and before any answer came
	expect(callSession(seen, 3, work("c1"), ok)).toBe(started);
	expect(callSession(seen, 3, work("c1"), undefined)).toBe(started);
	expect(callSession(seen, 4, work("c1"), ok)).toBe("gone");
	// a follow-up that started a session of its own leads there, not to the one it follows
	expect(callSession(seen, 3, work("c1", { session: 5 }), ok)).toBe(started);
	// a note to a running session started none: it leads to the session it named
	expect(callSession(seen, 3, work("c9", { session: 5 }), ok)).toMatchObject({ task: 5 });
	// started, and no longer kept
	expect(callSession(seen, 3, work("c9"), ok)).toBe("gone");
	expect(callSession(seen, 3, work("c9", { session: 99 }), ok)).toBe("gone");
	// refused, or not answered yet: there is no session to speak of
	expect(callSession(seen, 3, work("c9"), { error: true })).toBeUndefined();
	expect(callSession(seen, 3, work("c9"), undefined)).toBeUndefined();
	// the two tools over sessions lead to the one they name and reached, and to none when they name none
	const over = (name: string, args: Record<string, unknown>) => ({ id: "c1", name, args });
	expect(callSession(seen, 3, over("harness__stop", { session: 7 }), ok)).toBe(started);
	expect(callSession(seen, 3, over("harness__sessions", { session: 7 }), ok)).toBe(started);
	expect(callSession(seen, 3, over("harness__sessions", {}), ok)).toBeUndefined();
	expect(callSession(seen, 3, over("harness__stop", { session: 7 }), { error: true })).toBeUndefined();
	expect(callSession(seen, 3, over("harness__stop", { session: 99 }), ok)).toBe("gone");
	// another tool, or a shell that has not said its sessions yet
	expect(callSession(seen, 3, { id: "c1", name: "bash", args: {} }, ok)).toBeUndefined();
	expect(callSession(undefined, 3, work("c1"), ok)).toBeUndefined();
});
it("names a coding agent's tool by its service, from what is installed or from a session kept", () => {
	expect(toolService({ sessions: [one] }, "harness__claude_code")).toBe("Claude Code");
	expect(
		toolService({ sessions: [], harnesses: [{ name: "open-code", service: "OpenCode" }] }, "harness__open_code"),
	).toBe("OpenCode");
	expect(toolService({ sessions: [one] }, "harness__codex")).toBeUndefined();
	expect(toolService(undefined, "harness__claude_code")).toBeUndefined();
});
it("tracks recorded working, permission, completed and interrupted states in the relevant chat only", () => {
	expect(harnessActivity([one], [3])).toMatchObject({ waiting: false, sessions: [one] });
	const asking = { ...one, state: "waiting" as const, asks: [{ id: "ask", kind: "execute", command: "npm test" }] };
	expect(harnessActivity([asking], [3])).toMatchObject({ waiting: true, sessions: [asking] });
	for (const state of ["done", "stopped", "interrupted", "failed"] as const)
		expect(harnessActivity([{ ...one, state, ended: 2 }], [3]).sessions).toEqual([]);
	expect(harnessActivity([one], [4]).sessions).toEqual([]);
});
it("counts simultaneous sessions and keeps an approval first in the picker", () => {
	const asking = { ...one, task: 2, asks: [{ id: "ask", kind: "execute", command: "npm test" }] };
	expect(harnessActivity([one, { ...one, task: 3 }], [3]).sessions).toHaveLength(2);
	const active = harnessActivity([one, asking], [3]);
	expect(active.waiting).toBe(true);
	expect(active.sessions.map((session) => session.task)).toEqual([2, 1]);
});
it("labels an ask's buttons by its kind, never by the harness's own option names", () => {
	expect(askWords("execute")).toEqual({ what: "Run a command", verb: "Run", no: "Don't run" });
	expect(askWords("edit")).toEqual({ what: "Change a file", verb: "Allow", no: "Don't change" });
	expect(askWords("delete").no).toBe("Don't change");
	expect(askWords("fetch")).toEqual({ what: "Open a web page", verb: "Allow", no: "Don't open" });
	expect(askWords("other")).toEqual({ what: "Do something", verb: "Allow", no: "Don't allow" });
});
it("summarises an ask's kind in a few words: what a folded line or a notification says instead of the command", () => {
	expect(askSummary("execute")).toBe("run a command");
	expect(askSummary("edit")).toBe("change a file");
	expect(askSummary("delete")).toBe("change a file");
	expect(askSummary("move")).toBe("change a file");
	expect(askSummary("fetch")).toBe("open a web page");
	expect(askSummary("other")).toBe("do something");
	expect(askSummary("read")).toBe("do something");
});
it("reads an ask's kind case-blind: a harness that shouts gets the same words, not the vaguest", () => {
	expect(askWords("EXECUTE")).toEqual(askWords("execute"));
	expect(askWords("Edit")).toEqual(askWords("edit"));
	expect(askSummary("EXECUTE")).toBe("run a command");
});
it("shows the asks the owner opened, by id, and always the oldest: a resolved ask moves no button", () => {
	const a = { id: "a" };
	const b = { id: "b" };
	const c = { id: "c" };
	expect(shownAsks([a, b, c], new Set())).toEqual({ visible: [a], folded: [b, c] });
	expect(shownAsks([a, b, c], new Set(["b"]))).toEqual({ visible: [a, b], folded: [c] });
	// the first ask resolves while the owner opens the next: what they opened stays open, nothing else unfolds
	expect(shownAsks([b, c], new Set(["b"]))).toEqual({ visible: [b], folded: [c] });
	expect(shownAsks([b, c], new Set())).toEqual({ visible: [b], folded: [c] });
	// an opened ask that resolved leaves a stale id behind, harmlessly
	expect(shownAsks([c], new Set(["b"]))).toEqual({ visible: [c], folded: [] });
	expect(shownAsks([], new Set(["b"]))).toEqual({ visible: [], folded: [] });
});
it("notifies with the harness and the kind, never the command, the path or the project's name", () => {
	expect(askNotice([one])).toBeUndefined();
	const asking = {
		...one,
		service: "pi",
		folder: "~/code/banda",
		asks: [{ id: "ask", kind: "execute", command: "rm -rf node_modules" }],
	};
	expect(askNotice([asking])).toBe("pi asks to run a command");
	expect(askNotice([{ ...asking, asks: [{ id: "a", kind: "edit", command: "src/x.ts" }] }])).toBe(
		"pi asks to change a file",
	);
	expect(askNotice([asking, { ...asking, task: 2 }])).toBe("pi and 1 more are waiting on you");
	expect(askNotice([asking])).not.toContain("rm -rf");
	expect(askNotice([asking])).not.toContain("~/code");
	// the project's name can itself be a secret on a lock screen
	expect(askNotice([asking])).not.toContain("banda");
});
