/**
 * What a row's face says of its agent: whether it works and whether something of its waits on the owner, told apart so
 * neither hides the other. An open ask, a coding session's, or a change waiting to be allowed is the dot and the row's
 * words; work is the face's motion.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { defaultAvatarFace } from "../../../src/core/avatar-face.ts";
import { PinnedTile, Row } from "./Row.tsx";
import type { RowView } from "./types.ts";

vi.mock("../avatar/Renderer.tsx", () => ({
	AvatarRenderer: ({ animated, mood }: { animated: boolean; mood?: string }) =>
		createElement("span", { "data-animated": String(animated), "data-mood": mood }),
}));

const mara = (more: Partial<RowView> = {}): RowView => ({
	id: "a:mara",
	name: "Mara",
	faces: [{ id: "mara", name: "Mara", face: defaultAvatarFace() }],
	excerpt: "Three fit.",
	time: "10:41",
	...more,
});
const row = (more: Partial<RowView> = {}) => renderToStaticMarkup(createElement(Row, { row: mara(more) }));
const tile = (more: Partial<RowView> = {}) => renderToStaticMarkup(createElement(PinnedTile, { row: mara(more) }));
const moves = (html: string) => html.includes('data-mood="thinking"') && html.includes('data-animated="true"');
/** The dot of something waiting on the owner: on the face in a row, at the face's foot on a tile. */
const dots = (html: string) => (html.match(/rounded-full bg-ink ring-2/g) ?? []).length;

it("an agent at work moves its face; at rest it is still, with no dot", () => {
	expect(moves(row({ state: "working" }))).toBe(true);
	expect(row({ state: "working" })).toContain('aria-label="Mara, working"');
	expect(dots(row({ state: "working" }))).toBe(0);
	expect(moves(row({ state: "idle" }))).toBe(false);
	expect(dots(row({ state: "idle" }))).toBe(0);
});

it("an agent that waits on the owner is still, with the dot and the ask in its words", () => {
	const html = row({ state: "waiting", ask: "Book the 9:15?" });
	expect(moves(html)).toBe(false);
	expect(dots(html)).toBe(1);
	expect(html).toContain('aria-label="Mara, waiting on you"');
	expect(html).toContain("Waiting: Book the 9:15?");
});

it("an agent at work with something waiting on the owner says both: the face moves and keeps the dot", () => {
	// an ask open beside its work, a coding session's ask, or a change of its own waiting to be allowed
	const html = row({ state: "working", ask: "a change to its routines" });
	expect(moves(html)).toBe(true);
	expect(dots(html)).toBe(1);
	expect(html).toContain('aria-label="Mara, working, waiting on you"');
	expect(html).toContain("Waiting: a change to its routines");
	expect(html).toContain('aria-label="Mara, waiting on you: a change to its routines"');
});

it("a change waiting to be allowed while its agent rests is the dot alone", () => {
	const html = row({ state: "idle", ask: "a change to its routines" });
	expect(moves(html)).toBe(false);
	expect(dots(html)).toBe(1);
});

it("a pinned tile says the same: the face moves for work, and the dot stands for what waits", () => {
	expect(moves(tile({ state: "working" }))).toBe(true);
	expect(dots(tile({ state: "working" }))).toBe(0);
	const both = tile({ state: "working", ask: "Book the 9:15?" });
	expect(moves(both)).toBe(true);
	expect(dots(both)).toBe(1);
	const waiting = tile({ state: "waiting", ask: "Book the 9:15?" });
	expect(moves(waiting)).toBe(false);
	expect(dots(waiting)).toBe(1);
	// unread takes the dot's place, as before
	expect(dots(tile({ state: "working", ask: "Book the 9:15?", unread: 2 }))).toBe(0);
});
