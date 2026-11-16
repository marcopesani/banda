import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultAvatarFace } from "../../../src/core/avatar-face.ts";
import { Header } from "./Header.tsx";

const text = (html: string) => html.replace(/<[^>]*>/g, " ").trim();

// what an agent does or waits on is said in the feed and the band's row: beneath the name the header says nothing,
// so the name never moves as a turn starts waiting and is answered
it("a chat's header holds its name and nothing beneath it", () => {
	const html = renderToStaticMarkup(
		createElement(Header, { name: "Mara", face: defaultAvatarFace(), onPanel: () => {} }),
	);
	expect(text(html)).toBe("Mara");
	expect(html).toMatch(/<h1[^>]*><button[^>]*>Mara<\/button><\/h1><\/div>/);
	expect(html).not.toMatch(/<p[\s>]/);
	expect(html).toContain('role="img" aria-label="Mara" data-state="idle"');
});

it("a group's header holds its name and nothing beneath it either", () => {
	const html = renderToStaticMarkup(createElement(Header, { name: "Trip" }));
	expect(text(html)).toBe("Trip");
	expect(html).toMatch(/<h1[^>]*>Trip<\/h1><\/div>/);
	expect(html).toContain("lucide-users");
});

it("delegated work keeps its own control, and says there that it waits", () => {
	const html = renderToStaticMarkup(
		createElement(Header, {
			name: "Mara",
			delegated: createElement("button", { type: "button", "aria-label": "Waiting on you: 1 coding session" }, "1"),
		}),
	);
	expect(html).toContain('aria-label="Waiting on you: 1 coding session"');
	expect(html).toMatch(/<h1[^>]*>Mara<\/h1><\/div>/);
});
