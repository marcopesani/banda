import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { defaultAvatarFace } from "../../../src/core/avatar-face.ts";
import type { Segment } from "../lib/chat.ts";

// the feed's modules read the page's address as they load; only the drawing is under test here
vi.hoisted(() => {
	Object.assign(globalThis, { location: { hash: "", origin: "http://localhost", href: "http://localhost/" } });
});
const { FeedView } = await import("./Feed.tsx");

const who = { name: "Mara", face: defaultAvatarFace() };
const asked: Segment = { kind: "owner", key: "40", text: "Find me a train", files: [] };
const reply: Segment = { kind: "companion", key: "41", text: "The 09:00 is direct", files: [], undelivered: false };
const working: Segment = { kind: "working", key: "working", text: "Working…" };
const reading: Segment = { kind: "working", key: "working", text: "Reading notes.md…" };
const thinking: Segment = { kind: "working", key: "working", text: "Thinking…" };
const render = (segments: readonly Segment[], outgoing: Parameters<typeof FeedView>[0]["outgoing"] = []) =>
	renderToStaticMarkup(
		createElement(FeedView, { chat: 1, who, compact: true, segments, outgoing, onWorkingLine: () => {} }),
	);
const line = (html: string) => html.includes("data-working-line");
/** The words of the line: what stands beside the face. */
const words = (html: string) => {
	const from = html.indexOf("data-working-line");
	return from < 0 ? undefined : /<span[^>]*>([^<]*)<\/span><\/button>/.exec(html.slice(from))?.[1];
};

it("while the agent works, its face and the words of its work stand at the foot, named for who works", () => {
	const html = render([asked, working]);
	expect(line(html)).toBe(true);
	expect(html).toContain('aria-label="Mara is working: Working…"');
	expect(words(html)).toBe("Working…");
	expect(html.indexOf("Find me a train")).toBeLessThan(html.indexOf("data-working-line"));
});

it("says what the running tool does, and that it thinks, as the segment says it", () => {
	expect(words(render([asked, reading]))).toBe("Reading notes.md…");
	expect(words(render([asked, thinking]))).toBe("Thinking…");
	expect(words(render([asked, working]))).toBe("Working…");
});

it("names the current work for assistive technology after the agent has said something", () => {
	for (const state of [working, reading, thinking]) {
		expect(render([asked, reply, state])).toContain(`aria-label="Mara is working: ${state.text}"`);
	}
});

it("keeps its words after the agent's first content, for as long as the turn runs, below what it showed", () => {
	expect(words(render([asked, reply, working]))).toBe("Working…");
	expect(words(render([asked, reply, reading]))).toBe("Reading notes.md…");
	expect(render([asked, reply, working])).toContain('aria-label="Mara is working: Working…"');
	// a line in the feed is content too, and quiets nothing
	const effect: Segment = {
		kind: "effect",
		key: "41:effect",
		label: "Read your calendar",
		permission: { scope: "always" },
	};
	expect(words(render([asked, effect, working]))).toBe("Working…");
	// below what it showed: the line is the last thing in the feed
	const html = render([asked, reply, working]);
	expect(html.indexOf("The 09:00 is direct")).toBeLessThan(html.indexOf("data-working-line"));
	// the words are never hidden for motion: a moving face does not stand in for them
	expect(html).not.toContain("motion-safe:hidden");
	expect(html).not.toContain("data-quiet");
});

it("says the work again when it begins anew: the owner's words, a routine's wake, a watch's wake", () => {
	const again: Segment = { kind: "owner", key: "42", text: "And back on Sunday?", files: [] };
	expect(words(render([asked, reply, again, working]))).toBe("Working…");
	const wake: Segment = { kind: "wake", key: "43", text: "Trains ran", routine: "trains" };
	expect(words(render([asked, reply, wake, reading]))).toBe("Reading notes.md…");
	const object = { key: "github:acme/banda#142", kind: "pull request", name: "acme/banda #142" } as never;
	const woke: Segment = { kind: "watch", key: "44", text: "lint failed", watch: "pr", object, changes: [], at: 1 };
	expect(words(render([asked, reply, woke, working]))).toBe("Working…");
});

const approval = (ended?: Extract<Segment, { kind: "approval" }>["ended"], open = false): Segment => ({
	kind: "approval",
	key: "41:send",
	call: "send",
	ask: { type: "approval", tool: "send_message", args: { to: "ana@example.test" } },
	label: "send a message to ana@example.test",
	args: [["to", "ana@example.test"]],
	...(open ? { open: { wait: "k1", deadline: 4_102_444_800_000 } } : {}),
	...(ended === undefined ? {} : { ended }),
});
const question = (ended?: Extract<Segment, { kind: "question" }>["ended"]): Segment => ({
	kind: "question",
	key: "41:ask",
	ask: { type: "question", question: "Morning or evening?", options: ["Morning", "Evening"] },
	...(ended === undefined ? { open: { wait: "k2", deadline: 4_102_444_800_000 } } : { ended }),
});

it("after an ask the owner answered, the line says what the agent does next, a refusal too", () => {
	const allowed = approval({ outcome: "answered", answer: "approve", said: "Approved" });
	expect(words(render([asked, reply, allowed, reading]))).toBe("Reading notes.md…");
	const declined = approval({ outcome: "answered", answer: "deny", said: "Declined" });
	expect(words(render([asked, reply, declined, working]))).toBe("Working…");
	const picked = question({ outcome: "answered", answer: "Evening", said: "Evening" });
	expect(words(render([asked, reply, picked, thinking]))).toBe("Thinking…");
	const skipped = question({ outcome: "dismissed", said: "Dismissed" });
	expect(words(render([asked, reply, skipped, working]))).toBe("Working…");
	// answered by typing: the question, then the owner's words beneath it, as the feed draws it
	const typed = question({ outcome: "answered", answer: "Evening", said: "Answered below", inChat: true });
	const typedWords: Segment = { kind: "owner", key: "answer:45", text: "Evening", files: [] };
	expect(words(render([asked, reply, typed, typedWords, working]))).toBe("Working…");
	// and keeps saying it after what the agent shows after the answer
	const after: Segment = {
		kind: "companion",
		key: "46",
		text: "Booked the evening one",
		files: [],
		undelivered: false,
	};
	expect(words(render([asked, reply, allowed, after, reading]))).toBe("Reading notes.md…");
});

it("work beside an open ask shows both: the card to answer, and the line with its words beneath it", () => {
	const html = render([asked, approval(undefined, true), reading]);
	expect(html).toContain("data-open-ask");
	expect(words(html)).toBe("Reading notes.md…");
	// with nothing at work, the open ask stands alone: the agent waits on the owner
	expect(line(render([asked, approval(undefined, true)]))).toBe(false);
});

it("stays below the owner's message both while sending and once queued", () => {
	const waiting: Segment = { kind: "owner", key: "queued:q1", text: "Before noon", files: [], queued: true };
	const sending = { id: "q1", text: waiting.text, files: [], state: "sending" } as const;
	for (const html of [render([asked, working], [sending]), render([asked, working, waiting])]) {
		expect(html).toContain(waiting.text);
		expect(html.indexOf("data-working-line")).toBeGreaterThan(html.indexOf(waiting.text));
	}
});

it("says nothing of the work when nobody is working: the turn ended, was stopped, or failed", () => {
	const html = render([asked, reply]);
	expect(line(html)).toBe(false);
	expect(html).not.toContain("is working");
	const failed: Segment = { kind: "notice", key: "41:error", text: "The model provider is busy" };
	expect(line(render([asked, failed]))).toBe(false);
});

// a direct chat's reply never had a face: the line's face is the line's alone, and goes with it
it("puts no face on a reply in a direct chat", () => {
	const faces = (html: string) => (html.match(/role="img"/g) ?? []).length;
	expect(faces(render([asked, working]))).toBe(1);
	expect(faces(render([asked, reply]))).toBe(0);
	const html = render([asked, reply, working]);
	expect(faces(html)).toBe(1);
	expect(html.indexOf('role="img"')).toBeGreaterThan(html.indexOf("data-working-line"));
});
