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
 * (`_foo_bar_` is italic foo_bar), though not past a code mark, so that a code span still reads as code. Not
 * CommonMark, as before: one style per part (`___x___` reads `_`, bold x, `_`, not bold italic), a mark may open before
 * or close after a space (`_foo _`, `__ x__`), the rule of three for runs that both open and close is not applied
 * (`_)1)__(` reads italic `)1)`), and a mark is not read inside a code span or a link (`_a `b_`` reads italic).
 *
 * What a run can do is found once, in `scanned`, so the pattern never looks across a run again: each underscore stands
 * as INNER (a letter or digit on both sides), OPENS, CLOSES or BOTH. Every part of the pattern stops at the next mark
 * that could end it (a link's words at the next `[`, its address at a second `(`), so a line is read in time linear in its
 * length, however its marks are arranged.
 */
const INNER = "\uE000";
const OPENS = "\uE001";
const CLOSES = "\uE002";
const BOTH = "\uE003";
const TOKEN =
	/(?<code>`[^`]+`)|\*\*(?<starBold>[^*]+)\*\*|[\uE001\uE003]{2}(?<bold>(?=[^\uE000-\uE003])[^\uE001-\uE003`]*(?:`[^\uE000-\uE003]*)?)[\uE002\uE003]{2}|\*(?<starItalic>[^*\s][^*]*)\*|[\uE001\uE003](?<italic>(?=[^\uE000-\uE003\s])[^\uE001-\uE003`]*(?:`[^\uE000-\uE003]*)?)[\uE002\uE003]|(?<link>!?\[(?<words>[^[\]]*)\]\((?:[^()]|\([^()]*\))*\))/dg;

/** One letter or digit, a whole code point: Node 26's V8 misses a trailing astral letter in `/[\p{L}]$/u`. */
const WORD = /^[\p{L}\p{N}]$/u;

/** The line with each underscore standing for what its run can do; the same length, so a match's indices read `line`. */
function scanned(line: string): string {
	return line.replace(/[\uE000-\uE003]/g, "\uE004").replace(/_+/g, (run: string, at: number) => {
		const end = at + run.length;
		const opens = !WORD.test([...line.slice(Math.max(0, at - 2), at)].at(-1) ?? "");
		const closes = !WORD.test([...line.slice(end, end + 2)][0] ?? "");
		return (opens ? (closes ? BOTH : OPENS) : closes ? CLOSES : INNER).repeat(run.length);
	});
}

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
	const text = (span: [number, number] | undefined) => (span === undefined ? undefined : line.slice(...span));
	let at = 0;
	for (const match of scanned(line).matchAll(TOKEN)) {
		plain(line.slice(at, match.index));
		const found = match.indices?.groups ?? {};
		const bold = text(found.starBold ?? found.bold);
		const italic = text(found.starItalic ?? found.italic);
		const code = text(found.code);
		if (code !== undefined) parts.push({ text: code.slice(1, -1), style: "code" });
		else if (bold !== undefined) parts.push({ text: bold, style: "bold" });
		else if (italic !== undefined) parts.push({ text: italic, style: "italic" });
		else if (found.link !== undefined) plain(text(found.words) ?? "");
		at = match.index + match[0].length;
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
