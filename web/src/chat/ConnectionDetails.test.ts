/**
 * A connection's accounts: each is a row that says who uses it, what acts on one is in its row's menu, what adds one is
 * under the list, and signing out says who loses the account.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConnectionView } from "../../../src/server/api.ts";
import { MARA, SANCHO } from "../specimen/fixtures.ts";
import { ConnectionDetailsView, signOutWords } from "./ConnectionDetails.tsx";

const AGENTS = [
	{ id: "mara", ...MARA },
	{ id: "sancho", ...SANCHO },
];
const account = (label: string, agents: readonly string[]) => ({ account: label, id: label, label, at: 0, agents });
const VIEW: ConnectionView = {
	name: "github",
	state: "connected",
	accepted: {
		version: "test",
		connection: {
			service: "GitHub",
			url: "https://example.com/mcp",
			where: "example.com",
			auth: "oauth",
			reads: [],
			floors: {},
		},
	},
	tools: [],
	groups: [],
	draws: [],
	accounts: [account("@bandarra", ["mara", "sancho"]), account("@purrgrammer", [])],
};
const html = (props: Partial<Parameters<typeof ConnectionDetailsView>[0]> = {}) =>
	renderToStaticMarkup(
		createElement(ConnectionDetailsView, {
			view: VIEW,
			service: "GitHub",
			mode: "details",
			agents: AGENTS,
			agentsFor: [],
			...props,
		}),
	);

describe("a connection's accounts", () => {
	it("says who loses an account signed out of, by name", () => {
		expect(signOutWords(account("@bandarra", ["mara", "sancho"]), AGENTS)).toBe(
			"Mara and Sancho lose access to @bandarra. You can sign in again.",
		);
		expect(signOutWords(account("@bandarra", ["sancho"]), AGENTS)).toBe(
			"Sancho loses access to @bandarra. You can sign in again.",
		);
		expect(signOutWords(account("Work", ["mara", "sancho", "gone"]), AGENTS)).toBe(
			"Mara, Sancho, and gone lose access to Work. You can sign in again.",
		);
		expect(signOutWords(account("Work", []), AGENTS)).toBe("No agent uses Work. You can sign in again.");
	});

	it("keeps what acts on an account in its row's menu, and what adds one under the list", () => {
		const page = html({ onSignOut: () => {}, onAddAccount: () => {} });
		expect(page).toContain('aria-label="More for @bandarra"');
		expect(page).toContain('aria-label="More for @purrgrammer"');
		expect(page).toContain("Used by Mara and Sancho");
		// signing out is behind the menu and asks first: nothing on the page signs out at a tap
		expect(page).not.toContain("Sign out");
		expect(page.indexOf("Add account")).toBeGreaterThan(page.lastIndexOf("</ul>"));
		expect(page.match(/Add account/g)?.length).toBe(1);
	});

	it("offers neither where the caller has none to offer, nor in the review", () => {
		const plain = html();
		expect(plain).not.toContain("More for");
		expect(plain).not.toContain("Add account");
		expect(html({ mode: "review", onSignOut: () => {}, onAddAccount: () => {} })).not.toContain("Add account");
	});
});
