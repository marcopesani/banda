import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultAvatarFace } from "../../../src/core/avatar-face.ts";
import { Header } from "./Header.tsx";

const text = (html: string) => html.replace(/<[^>]*>/g, " ");

// work and waits are said in the feed and the band's row: the header holds the name alone and never moves for them
it("a chat's header holds its name alone, with a resting face and nothing beneath", () => {
	const html = renderToStaticMarkup(createElement(Header, { name: "Mara", face: defaultAvatarFace() }));
	expect(html).toMatch(/<h1[^>]*>Mara<\/h1>/);
	expect(html).toContain('role="img" aria-label="Mara" data-state="idle"');
	expect(text(html).replace(/\s+/g, " ").trim()).toBe("Mara");
	expect(html).not.toMatch(/Waiting on you|Routines paused|working/i);
	expect(html).not.toContain('aria-label="Activity');
});

it("a group's header holds its name alone too", () => {
	const html = renderToStaticMarkup(createElement(Header, { name: "Trip" }));
	expect(html).toMatch(/<h1[^>]*>Trip<\/h1>/);
	expect(html).toContain("lucide-users");
	expect(text(html).replace(/\s+/g, " ").trim()).toBe("Trip");
});
