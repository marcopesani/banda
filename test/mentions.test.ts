import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { defaultAvatarFace } from "../src/core/avatar-face.ts";
import { linkMentions, mentionQuery, mentionsIn } from "../web/src/lib/mentions.ts";
import type { ChatAgent } from "../web/src/lib/navigation.ts";
import { pbtRuns } from "./pbt.ts";

const face = defaultAvatarFace();
const writer: ChatAgent = { id: "writer", name: "Writer", face };
const researcher: ChatAgent = { id: "researcher", name: "Researcher", face };

describe("mentions in the composer", () => {
	it("offers agents only for an @ word just before the caret", () => {
		expect(mentionQuery("@", 1)).toEqual({ start: 0, query: "" });
		expect(mentionQuery("hi @Wr", 6)).toEqual({ start: 3, query: "Wr" });
		expect(mentionQuery("hi @Wr there", 12)).toBeUndefined();
		expect(mentionQuery("mail@example", 12)).toBeUndefined();
	});

	it("asks only agents picked whose mention is still in the text, each once", () => {
		expect(mentionsIn("@Writer and @Researcher", [writer, researcher])).toEqual(["writer", "researcher"]);
		expect(mentionsIn("@Writer then @Writer", [writer, writer])).toEqual(["writer"]);
		// typed by hand, never picked: not a mention
		expect(mentionsIn("@Researcher", [writer])).toEqual([]);
		// picked, then deleted from the text
		expect(mentionsIn("never mind", [writer])).toEqual([]);
	});

	it("never asks an agent that was not picked, whatever the text", () => {
		fc.assert(
			fc.property(fc.string(), fc.subarray([writer, researcher]), (text, picked) => {
				const asked = mentionsIn(text, picked);
				expect(asked.every((id) => picked.some((agent) => agent.id === id))).toBe(true);
			}),
			{ numRuns: pbtRuns(100) },
		);
	});

	it("draws as chips only the agents a message asked, longest name first; other @s stay words", () => {
		const ana: ChatAgent = { id: "ana", name: "Ana", face };
		const analu: ChatAgent = { id: "analu", name: "Ana Lu", face };
		const agents = [writer, researcher, ana, analu];
		expect(linkMentions("@Writer go", ["writer"], agents)).toBe("[@Writer](#/a/writer) go");
		// named, but not asked: words
		expect(linkMentions("@Researcher no", ["writer"], agents)).toBe("@Researcher no");
		expect(linkMentions("hi @Ana Lu!", ["ana", "analu"], agents)).toBe("hi [@Ana Lu](#/a/analu)!");
		expect(linkMentions("mail@Writer", ["writer"], agents)).toBe("mail@Writer");
		expect(linkMentions("@Writers", ["writer"], agents)).toBe("@Writers");
		// whatever the case it was typed in, under the agent's own name
		expect(linkMentions("@writer go", ["writer"], agents)).toBe("[@Writer](#/a/writer) go");
	});

	it("leaves a name in code as written, a span or a fence, and links it after", () => {
		const ids = ["writer"];
		expect(linkMentions("run `say @Writer` then @Writer", ids, [writer])).toBe(
			"run `say @Writer` then [@Writer](#/a/writer)",
		);
		expect(linkMentions("a ``x @Writer`` b", ids, [writer])).toBe("a ``x @Writer`` b");
		expect(linkMentions("Try:\n```sh\nping @Writer\n```\n@Writer, did it work?", ids, [writer])).toBe(
			"Try:\n```sh\nping @Writer\n```\n[@Writer](#/a/writer), did it work?",
		);
		// a fence never closed runs to the end, as markdown draws it
		expect(linkMentions("~~~\n@Writer", ids, [writer])).toBe("~~~\n@Writer");
		// a lone backtick opens nothing
		expect(linkMentions("it's ` @Writer", ids, [writer])).toBe("it's ` [@Writer](#/a/writer)");
	});

	it("keeps code as written and takes nothing else from the words but a linked name's case, whatever the text", () => {
		const piece = fc.constantFrom("@Writer", "@writer", " ", "\n", "`", "``", "```", "~~~", "go", "\n```\n");
		const words = fc.array(piece, { maxLength: 12 }).map((pieces) => pieces.join(""));
		const inner = fc.array(fc.constantFrom("@Writer", "@writer", " ", "go"), { maxLength: 6 }).map((p) => p.join(""));
		fc.assert(
			fc.property(words, inner, words, (before, said, after) => {
				const span = ` \`${said}x\` `;
				const text = before + span + after;
				const linked = linkMentions(text, ["writer"], [writer]);
				expect(linked.replaceAll("[@Writer](#/a/writer)", "@Writer").toLowerCase()).toBe(text.toLowerCase());
				// a span after words with no backtick or fence in them is code, and stays as typed
				if (!/[`~]/.test(before)) expect(linked).toContain(span);
			}),
			{ numRuns: pbtRuns(200) },
		);
	});
});

describe("mentions whatever the case", () => {
	it("asks the agent named in any case, as a whole name only", () => {
		const mara = { id: "mara", name: "Mara", face: { ...face, color: "#c79267" } };
		expect(mentionsIn("@mara how unoriginal", [mara])).toEqual(["mara"]);
		expect(mentionsIn("@MARA go", [mara])).toEqual(["mara"]);
		expect(mentionsIn("@marathon", [mara])).toEqual([]);
	});
});

describe("a group message's mentions, shown", () => {
	const agents = [
		{ id: "sancho", name: "Sancho" },
		{ id: "rosa", name: "Rosa" },
	];
	it("stand at the @Name, else at the name as a word, else before the words; once, whatever the case", async () => {
		const { mentionParts } = await import("../web/src/lib/mentions.ts");
		expect(mentionParts("@rosa I checked it", ["rosa"], agents)).toEqual([
			{ mention: "rosa" },
			{ text: " I checked it" },
		]);
		expect(mentionParts("Sancho, send me the forecast", ["sancho"], agents)).toEqual([
			{ mention: "sancho" },
			{ text: ", send me the forecast" },
		]);
		expect(mentionParts("Can you do it?", ["rosa"], agents)).toEqual([
			{ mention: "rosa" },
			{ text: " " },
			{ text: "Can you do it?" },
		]);
		// a name inside another word is no mention, and one not asked is left as words
		expect(mentionParts("Rosalind and Sancho", ["rosa"], agents)).toEqual([
			{ mention: "rosa" },
			{ text: " " },
			{ text: "Rosalind and Sancho" },
		]);
		// a name in code is shown as written: the mention stands where it is next named outside, else before the words
		expect(mentionParts("`@rosa` or @Rosa", ["rosa"], agents)).toEqual([{ text: "`@rosa` or " }, { mention: "rosa" }]);
		expect(mentionParts("```\nRosa\n```", ["rosa"], agents)).toEqual([
			{ mention: "rosa" },
			{ text: " " },
			{ text: "```\nRosa\n```" },
		]);
	});

	it("never stands inside a link, its words or its destination, a reference or a definition: a link in a link breaks it", async () => {
		const { mentionParts } = await import("../web/src/lib/mentions.ts");
		const id = "0123456789abcdef";
		// named only inside the link: the link stays whole and the mention goes before the words
		expect(mentionParts(`[@Sancho see](artifact:${id})`, ["sancho"], agents)).toEqual([
			{ mention: "sancho" },
			{ text: " " },
			{ text: `[@Sancho see](artifact:${id})` },
		]);
		expect(mentionParts(`[Sancho's plan](artifact:${id}) is ready`, ["sancho"], agents)).toEqual([
			{ mention: "sancho" },
			{ text: " " },
			{ text: `[Sancho's plan](artifact:${id}) is ready` },
		]);
		expect(mentionParts("See https://example.com/Rosa/x", ["rosa"], agents)).toEqual([
			{ mention: "rosa" },
			{ text: " " },
			{ text: "See https://example.com/Rosa/x" },
		]);
		expect(mentionParts(`[@Rosa][r]\n\n[r]: artifact:${id}`, ["rosa"], agents)).toEqual([
			{ mention: "rosa" },
			{ text: " " },
			{ text: `[@Rosa][r]\n\n[r]: artifact:${id}` },
		]);
		// named outside the link too: the mention stands there, the link untouched
		expect(mentionParts(`[@Sancho see](artifact:${id}), @Sancho`, ["sancho"], agents)).toEqual([
			{ text: `[@Sancho see](artifact:${id}), ` },
			{ mention: "sancho" },
		]);
	});
});

describe("an owner's mentions, linked", () => {
	it("links an @Name outside links only, so a link the words hold stays one", () => {
		const id = "0123456789abcdef";
		expect(linkMentions(`[@Writer see](artifact:${id}) and @Writer`, ["writer"], [writer])).toBe(
			`[@Writer see](artifact:${id}) and [@Writer](#/a/writer)`,
		);
		// a link's title is the link's too; words that are no link (a space in the destination) are linked as words
		expect(linkMentions('[x](https://e.com "by @Writer")', ["writer"], [writer])).toBe(
			'[x](https://e.com "by @Writer")',
		);
		expect(linkMentions("[x](https://e.com/ @Writer)", ["writer"], [writer])).toBe(
			"[x](https://e.com/ [@Writer](#/a/writer))",
		);
	});
});
