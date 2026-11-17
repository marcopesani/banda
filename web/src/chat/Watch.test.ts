/**
 * A watch's card says who asks and whom it wakes, each, and whether it is the agent's own or shared: what the owner
 * allows is what runs, so the card never names the asking agent as the one it wakes when another's folder, or a shared
 * watch's record, says otherwise. Two watches of one agent on one object as one account each say so.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WatchProposal } from "./Watch.tsx";

const watch = {
	agent: "Curro",
	title: "#general",
	kind: "new" as const,
	until: "you stop it",
	ask: "Tell me what is asked of me.",
};
const text = (props: Parameters<typeof WatchProposal>[0]) =>
	renderToStaticMarkup(createElement(WatchProposal, props))
		.replace(/<[^>]+>/g, " ")
		.replace(/&#x27;/g, "'")
		.replace(/\s+/g, " ");

describe("a watch's card", () => {
	it("asked for in one agent's chat for another: says both, and wakes the one it runs as", () => {
		const card = text({ watch: { ...watch, runsAs: "Sancho" }, onAllow: () => {} });
		expect(card).toContain("Curro asks to follow for Sancho");
		expect(card).toContain("Sancho's own watch");
		expect(card).toContain("wakes Sancho with what changed, in Sancho's chat, not here");
		expect(card).not.toContain("wakes Curro");
	});

	it("its own: names one agent, and says it is its own", () => {
		const card = text({ watch: { ...watch, runsAs: "Curro" }, onAllow: () => {} });
		expect(card).toContain("Curro asks to follow #general");
		expect(card).toContain("Curro's own watch");
		expect(card).not.toContain("not here");
	});

	it("shared, and followed twice: says whom it wakes and that each wakes", () => {
		const card = text({ watch: { ...watch, runsAs: "Sancho", shared: true, twin: true }, onAllow: () => {} });
		expect(card).toContain("Shared watch · wakes Sancho");
		expect(card).toContain("Another watch of Sancho's follows this too, as the same account: each wakes on its own");
		expect(text({ watch: { ...watch, kind: "removed", twin: true } })).not.toContain("Another watch");
	});
});
