import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { HarnessSessionView, Item } from "../lib/api.ts";
import type { Transcript } from "../lib/transcript.ts";

// the activity's modules read the page's address as they load; only the drawing is under test here
vi.hoisted(() => {
	Object.assign(globalThis, { location: { hash: "", origin: "http://localhost", href: "http://localhost/" } });
});
const { ActivityView, StepLinks } = await import("./Activity.tsx");

const session: HarnessSessionView = {
	task: 7,
	chat: 1,
	call: "h1",
	agent: "mara",
	harness: "claude-code",
	service: "Claude Code",
	folder: "~/code/trains",
	state: "done",
	at: 1,
	ended: 2,
	steps: [],
	dropped: 0,
};

it("an opened step leads to its coding session beside the way to the transcript, each a button of its own", () => {
	const html = renderToStaticMarkup(createElement(StepLinks, { onTranscript: () => {}, session, onSession: () => {} }));
	expect(html).toContain("In the transcript");
	expect(html).toContain('data-open-session="7"');
	expect(html).toContain("Open session");
	expect(html.match(/<button/g)).toHaveLength(2);
	// siblings: no button holds another
	expect(/<button[^>]*>(?:(?!<\/button>).)*<button/s.test(html)).toBe(false);
});

it("a step whose coding session is no longer kept says so and offers nothing to open", () => {
	const html = renderToStaticMarkup(createElement(StepLinks, { onTranscript: () => {}, session: "gone" }));
	expect(html).toContain("This coding session is no longer kept.");
	expect(html).not.toContain("data-open-session");
	expect(html).toContain("In the transcript");
});

it("a step with no coding session keeps only the way to the transcript, and nothing without one", () => {
	const html = renderToStaticMarkup(createElement(StepLinks, { onTranscript: () => {} }));
	expect(html).toContain("In the transcript");
	expect(html).not.toContain("session");
	expect(renderToStaticMarkup(createElement(StepLinks, {}))).toBe("");
});

it("the activity names a coding agent's call by the coding agent, and its line opens", () => {
	const items: Item[] = [
		{ id: 1, role: "user", text: "Fix the fare alert.", at: 1 },
		{
			id: 2,
			role: "assistant",
			stop: "toolUse",
			text: "",
			at: 2,
			calls: [
				{ id: "h1", name: "harness__claude_code", args: { prompt: "Skip sold-out trains." } },
				{ id: "h2", name: "harness__stop", args: { session: 7 } },
			],
		},
		{ id: 3, role: "tool", call: "h1", name: "harness__claude_code", text: "Started session 7.", error: false, at: 3 },
		{ id: 4, role: "tool", call: "h2", name: "harness__stop", text: "Session 7 is stopping.", error: false, at: 4 },
		{ id: 5, role: "assistant", stop: "stop", text: "", at: 5 },
	];
	const transcript: Transcript = {
		items,
		waits: [],
		queued: [],
		busy: false,
		input: undefined,
		running: [],
		partial: [],
		thinking: false,
		older: false,
		loadOlder: async () => {},
		loaded: true,
		missing: false,
	};
	const view = (harnesses?: { sessions: readonly HarnessSessionView[] }) =>
		renderToStaticMarkup(
			createElement(ActivityView, { target: { chat: 1, name: "Mara" }, depth: "activity", transcript, harnesses }),
		);
	const html = view({ sessions: [session] });
	expect(html).toContain("Asked Claude Code");
	expect(html).toContain("Skip sold-out trains.");
	expect(html).toContain("coding session 7");
	expect(html).not.toContain("harness__");
	// the shell has not said its sessions: plain words, still no tool name
	const bare = view();
	expect(bare).toContain("Asked a coding agent");
	expect(bare).not.toContain("harness__");
});
