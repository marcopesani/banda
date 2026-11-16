/**
 * A line of markdown as a preview reads it (the band's rows): bold, italic and code as such, a link as its words, and
 * the marks that only shape a block (a heading's #, a list's -, a quote's >) dropped; one line, whatever was cut.
 * `inlineParts` is pure, for the tests; a mark left open by the cut reads as plain text.
 */
import type { ReactNode } from "react";

export type InlinePart = { readonly text: string; readonly style?: "bold" | "italic" | "code" };

/**
 * Underscores follow CommonMark's word rule, judged at the outer edges of the whole run of them: a run with a letter or
 * digit outside opens or closes nothing (`web_search and fetch_content` stays text); a longer run lends one or two of its
 * marks and keeps the rest as text (`_a__` is italic a, then `_`); a run inside a word may sit within emphasis
 * (`_foo_bar_` is italic foo_bar). Not CommonMark, as before: one style per part (`___x___` reads `_`, bold x, `_`, not
 * bold italic), a mark may open before or close after a space (`_foo _`, `__ x__`), and the rule of three for runs that
 * both open and close is not applied (`_)1)__(` reads italic `)1)`).
 */
const TOKEN =
	/(?<code>`[^`]+`)|\*\*(?<starBold>[^*]+)\*\*|(?<![\p{L}\p{N}]_*)__(?<bold>(?:[^_]|(?<=[\p{L}\p{N}])_+(?=[\p{L}\p{N}]))+)__(?!_*[\p{L}\p{N}])|\*(?<starItalic>[^*\s][^*]*)\*|(?<![\p{L}\p{N}]_*)_(?<italic>[^_\s](?:[^_]|(?<=[\p{L}\p{N}])_+(?=[\p{L}\p{N}]))*)_(?!_*[\p{L}\p{N}])|(?<link>!?\[(?<words>[^\]]*)\]\([^)]*\))/gu;

export function inlineParts(markdown: string): InlinePart[] {
	const line = markdown
		.split("\n")
		.map((one) => one.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "").trim())
		.filter((one) => one !== "")
		.join(" ");
	const parts: InlinePart[] = [];
	const plain = (text: string) => {
		if (text === "") return;
		const last = parts.at(-1);
		if (last !== undefined && last.style === undefined) parts[parts.length - 1] = { text: last.text + text };
		else parts.push({ text });
	};
	let at = 0;
	for (const match of line.matchAll(TOKEN)) {
		plain(line.slice(at, match.index));
		const [whole] = match;
		const found = match.groups ?? {};
		const bold = found.starBold ?? found.bold;
		const italic = found.starItalic ?? found.italic;
		if (found.code !== undefined) parts.push({ text: found.code.slice(1, -1), style: "code" });
		else if (bold !== undefined) parts.push({ text: bold, style: "bold" });
		else if (italic !== undefined) parts.push({ text: italic, style: "italic" });
		else if (found.link !== undefined) plain(found.words ?? "");
		else plain(whole);
		at = match.index + whole.length;
	}
	plain(line.slice(at));
	return parts;
}

export function Inline({ children }: { children: string }) {
	return inlineParts(children).map((part, n): ReactNode => {
		const key = `${n}:${part.style ?? ""}`;
		switch (part.style) {
			case "bold":
				return (
					<strong key={key} className="font-semibold">
						{part.text}
					</strong>
				);
			case "italic":
				return <em key={key}>{part.text}</em>;
			case "code":
				return (
					<code key={key} className="font-code text-[0.92em]">
						{part.text}
					</code>
				);
			default:
				return part.text;
		}
	});
}
