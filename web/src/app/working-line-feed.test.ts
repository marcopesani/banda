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
const working: Segment = { kind: "working", key: "working", text: "working…" };
const render = (segments: readonly Segment[], outgoing: Parameters<typeof FeedView>[0]["outgoing"] = []) =>
	renderToStaticMarkup(
		createElement(FeedView, { chat: 1, who, compact: true, segments, outgoing, onWorkingLine: () => {} }),
	);
const line = (html: string) => html.includes("data-working-line");
/** The line as the faces alone: its words are kept for less motion only, and its label still names who works. */
const quiet = (html: string) =>
	line(html) && html.includes('data-quiet=""') && html.includes("motion-safe:hidden") && html.includes("is working");
/** The line with its words. */
const saying = (html: string) => line(html) && !html.includes("data-quiet") && !html.includes("motion-safe:hidden");

it("while the agent works and has shown nothing, its face and Working… stand at the foot, named for who works", () => {
	const html = render([asked, working]);
	expect(line(html)).toBe(true);
	expect(html).toContain('aria-label="Mara is working"');
	expect(html).toContain("Working…");
	expect(html.indexOf("Find me a train")).toBeLessThan(html.indexOf("data-working-line"));
});

it("stays while the turn runs, quiet from the agent's first content: the face alone, still naming who works", () => {
	expect(saying(render([asked, working]))).toBe(true);
	expect(quiet(render([asked, reply, working]))).toBe(true);
	expect(render([asked, reply, working])).toContain('aria-label="Mara is working"');
	// anything it shows counts, not only words: a line in the feed too
	const effect: Segment = {
		kind: "effect",
		key: "41:effect",
		label: "Read your calendar",
		permission: { scope: "always" },
	};
	expect(quiet(render([asked, effect, working]))).toBe(true);
	// below what it showed: the line is the last thing in the feed
	const html = render([asked, reply, working]);
	expect(html.indexOf("The 09:00 is direct")).toBeLessThan(html.indexOf("data-working-line"));
});

it("says Working… again when work begins anew: the owner's words, a routine's wake, a watch's wake", () => {
	const again: Segment = { kind: "owner", key: "42", text: "And back on Sunday?", files: [] };
	expect(saying(render([asked, reply, again, working]))).toBe(true);
	const wake: Segment = { kind: "wake", key: "43", text: "Trains ran", routine: "trains" };
	expect(saying(render([asked, reply, wake, working]))).toBe(true);
	expect(quiet(render([wake, reply, working]))).toBe(true);
	const object = { key: "github:acme/banda#142", kind: "pull request", name: "acme/banda #142" } as never;
	const woke: Segment = { kind: "watch", key: "44", text: "lint failed", watch: "pr", object, changes: [], at: 1 };
	expect(saying(render([asked, reply, woke, working]))).toBe(true);
	// what a watch only tells starts no run: nothing begins anew
	expect(quiet(render([asked, reply, { ...woke, tell: true }, working]))).toBe(true);
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

it("an ask the owner answered begins the agent's work anew, on its card as in the chat, a refusal too", () => {
	// before the ask it had said something: the line was quiet
	const allowed = approval({ outcome: "answered", answer: "approve", said: "Approved" });
	expect(saying(render([asked, reply, allowed, working]))).toBe(true);
	const declined = approval({ outcome: "answered", answer: "deny", said: "Declined" });
	expect(saying(render([asked, reply, declined, working]))).toBe(true);
	const picked = question({ outcome: "answered", answer: "Evening", said: "Evening" });
	expect(saying(render([asked, reply, picked, working]))).toBe(true);
	const skipped = question({ outcome: "dismissed", said: "Dismissed" });
	expect(saying(render([asked, reply, skipped, working]))).toBe(true);
	// answered by typing: the question, then the owner's words beneath it, as the feed draws it
	const typed = question({ outcome: "answered", answer: "Evening", said: "Answered below", inChat: true });
	const words: Segment = { kind: "owner", key: "answer:45", text: "Evening", files: [] };
	expect(saying(render([asked, reply, typed, words, working]))).toBe(true);
	// and it goes quiet again at what the agent shows after the answer
	const after: Segment = {
		kind: "companion",
		key: "46",
		text: "Booked the evening one",
		files: [],
		undelivered: false,
	};
	expect(quiet(render([asked, reply, allowed, after, working]))).toBe(true);
});

it("an ask nobody answered is the agent's own content: expired or stopped, the line stays quiet", () => {
	const expired = approval({ outcome: "expired", said: "No answer in time; it did not run" });
	expect(quiet(render([asked, expired, working]))).toBe(true);
	const stopped = question({ outcome: "cancelled", said: "Stopped before an answer" });
	expect(quiet(render([asked, stopped, working]))).toBe(true);
});

it("work beside an open ask shows both: the card to answer, and the line beneath it", () => {
	const html = render([asked, approval(undefined, true), working]);
	expect(html).toContain("data-open-ask");
	expect(quiet(html)).toBe(true);
	// with nothing at work, the open ask stands alone
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

it("says nothing of the work when nobody is working", () => {
	const html = render([asked, reply]);
	expect(line(html)).toBe(false);
	expect(html).not.toContain("is working");
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
