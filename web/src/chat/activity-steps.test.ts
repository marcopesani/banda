import { expect, it } from "vitest";
import { prettyUrl, requestWords, span, took, toolHead, totalWords } from "./activity-steps.ts";

const call = (name: string, args: Record<string, unknown>) => ({ id: "c", name, args });

it("says a call as going on, then as done, in the owner's words", () => {
	expect(toolHead(call("browser_navigate", { url: "https://www.renfe.com/es/en/" }), false)).toMatchObject({
		verb: "Opening",
		object: "renfe.com/es/en",
		code: false,
	});
	expect(toolHead(call("browser_navigate", { url: "https://www.renfe.com/es/en/" }), true).verb).toBe("Opened");
	expect(toolHead(call("message_user", { text: "On it." }), true)).toMatchObject({
		verb: "Messaged you",
		object: "On it.",
	});
	expect(toolHead(call("edit", { path: "src/auth.ts" }), true)).toMatchObject({
		verb: "Edited",
		object: "src/auth.ts",
		code: true,
	});
	expect(toolHead(call("skill", { name: "research" }), true)).toMatchObject({ verb: "Loaded", object: "/research" });
	expect(toolHead(call("browser_snapshot", {}), true)).toMatchObject({ verb: "Read the page", object: "" });
});

it("names a coding agent's call by the coding agent, never by its tool", () => {
	const work = call("harness__claude_code", { prompt: "Fix the login test.", project: "auth" });
	expect(toolHead(work, false, "Claude Code")).toMatchObject({
		verb: "Asking Claude Code",
		object: "Fix the login test.",
		code: false,
	});
	expect(toolHead(work, true, "Claude Code").verb).toBe("Asked Claude Code");
	// which coding agent is not known: plain words
	expect(toolHead(work, true).verb).toBe("Asked a coding agent");
	expect(toolHead(call("harness__sessions", {}), true)).toMatchObject({ verb: "Checked", object: "coding sessions" });
	expect(toolHead(call("harness__sessions", { session: 4 }), false)).toMatchObject({
		verb: "Checking",
		object: "coding session 4",
	});
	expect(toolHead(call("harness__stop", { session: 4 }), true)).toMatchObject({
		verb: "Stopped",
		object: "coding session 4",
		code: false,
	});
	for (const name of ["harness__claude_code", "harness__sessions", "harness__stop"]) {
		const head = toolHead(call(name, { prompt: "x", session: 1 }), true, "Claude Code");
		expect(`${head.verb} ${head.object}`).not.toContain("harness__");
	}
});

it("keeps a path's file name and an address's last part when the line runs out", () => {
	expect(toolHead(call("read", { path: "web/src/app/Activity.tsx" }), true).ends).toEqual({
		head: "web/src/app/",
		end: "Activity.tsx",
	});
	expect(toolHead(call("web_fetch", { url: "https://example.com/docs/guide" }), true).ends).toEqual({
		head: "example.com/docs/",
		end: "guide",
	});
});

it("says a command as a coding session's step does, and a here-document by its first line", () => {
	expect(toolHead(call("bash", { command: "rg refresh src" }), true)).toMatchObject({
		verb: "Searched for",
		object: '"refresh"',
	});
	expect(toolHead(call("bash", { command: "npm test -- auth.spec.ts" }), false).verb).toBe("Running tests");
	const script = toolHead(call("bash", { command: "python3 - <<'PY'\nprint(1)\nPY" }), true);
	expect(script).toMatchObject({ verb: "Ran", object: "python3 - <<'PY' …", code: true });
	// a chain is never cut to its first step: what it ends on is what it does
	expect(toolHead(call("bash", { command: "npm test\ngit push" }), true).object).toContain("git push");
});

it("names a tool it has no words for, with what it was called on", () => {
	expect(toolHead(call("github_list_prs", { query: "is:open" }), true)).toMatchObject({
		verb: "Used",
		object: "github_list_prs · is:open",
		code: true,
	});
	expect(toolHead(call("github_list_prs", {}), false)).toMatchObject({ verb: "Using", object: "github_list_prs" });
});

it("says how long in the fewest words that are still exact enough", () => {
	expect(took(400)).toBe("0.4s");
	expect(took(4000)).toBe("4.0s");
	expect(took(32_000)).toBe("32s");
	expect(took(108_000)).toBe("1m 48s");
	expect(
		span([
			{ id: 1, role: "user", text: "", at: 1000 },
			{ id: 2, role: "assistant", text: "", at: 5000 },
		]),
	).toBe(4000);
	expect(span([{ id: 1, role: "user", text: "" }])).toBeUndefined();
});

it("says what a request took, and what a work's requests took together", () => {
	const usage = { input: 200, output: 80, cacheRead: 7000, cacheWrite: 300, cost: 0.0042 };
	expect(requestWords({ model: "anthropic/claude-sonnet-5-5", usage })).toEqual([
		"claude-sonnet-5-5",
		"7.5k in",
		"80 out",
		"93% cached",
		"$0.0042",
	]);
	expect(requestWords({})).toEqual([]);
	expect(totalWords([{ usage }, { usage }, {}])).toEqual(["15k in", "160 out", "93% cached", "$0.0084"]);
	expect(prettyUrl("https://www.example.com/a/")).toBe("example.com/a");
});
