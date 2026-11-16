import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultAvatarFace } from "../../../src/core/avatar-face.ts";
import { WorkingLine, waitingLabel } from "./WorkingLine.tsx";

const face = defaultAvatarFace();

it("names who waits on the owner, one or several", () => {
	expect(waitingLabel(["Mara"])).toBe("Mara is waiting on you");
	expect(waitingLabel(["Mara", "Sancho"])).toBe("Mara and Sancho are waiting on you");
});

it("a group's members waiting on the owner: their faces still, the words still, its status named for them", () => {
	const html = renderToStaticMarkup(
		createElement(WorkingLine, {
			who: [
				{ name: "Mara", face },
				{ name: "Sancho", face },
			],
			text: "Waiting on you",
			waiting: true,
		}),
	);
	expect(html).toContain('role="status" aria-label="Mara and Sancho are waiting on you"');
	expect(html.match(/data-state="waiting"/g)).toHaveLength(2);
	expect(html).not.toContain("sa-shimmer");
});
