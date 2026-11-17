/**
 * The links a message's markdown draws, read as the app draws them: `web/src/components/Markdown.tsx` renders with
 * Streamdown, whose remark-parse and remark-gfm are this same micromark and mdast. What a link points at is what
 * remark-rehype writes as its `href`: an inline link's or autolink's destination, or the destination of the definition
 * a reference uses (the first of that label), normalized as `normalizeUri` does. A definition no reference uses
 * draws nothing, and code spans, fenced code and escaped brackets draw no link, so none of them is a link here.
 * Raw HTML is drawn too (the app parses it): it is returned whole, its character references decoded, for a caller to
 * refuse what it may not hold.
 */
import { decodeNamedCharacterReference } from "decode-named-character-reference";
import type { Definition, Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { decodeNumericCharacterReference } from "micromark-util-decode-numeric-character-reference";
import { normalizeUri } from "micromark-util-sanitize-uri";

export type MarkdownLinks = {
	/** Each link's `href` as the app's renderer writes it, in order, a repeated one each time. */
	readonly links: readonly string[];
	/** Each image's `src`, likewise: drawn as an image, never a link. */
	readonly images: readonly string[];
	/** Each piece of raw HTML, its character references decoded. */
	readonly html: readonly string[];
};

/** `text` with its HTML character references decoded, with or without their `;`, as a browser reads an attribute. */
export const decodeReferences = (text: string) =>
	text.replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));?/g, (whole, hex, dec, name) => {
		if (hex !== undefined) return decodeNumericCharacterReference(hex, 16);
		if (dec !== undefined) return decodeNumericCharacterReference(dec, 10);
		const named = decodeNamedCharacterReference(name);
		return named === false ? whole : named;
	});

const children = (node: Nodes): readonly Nodes[] => ("children" in node ? (node.children as readonly Nodes[]) : []);

export function markdownLinks(text: string): MarkdownLinks {
	const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
	// a reference's definition by its label, the first one of it, as remark-rehype finds it
	const definitions = new Map<string, Definition>();
	const walk = (node: Nodes, visit: (node: Nodes) => void) => {
		visit(node);
		for (const child of children(node)) walk(child, visit);
	};
	walk(tree, (node) => {
		const label = node.type === "definition" ? node.identifier.toUpperCase() : undefined;
		if (node.type === "definition" && label !== undefined && !definitions.has(label)) definitions.set(label, node);
	});
	const links: string[] = [];
	const images: string[] = [];
	const html: string[] = [];
	walk(tree, (node) => {
		if (node.type === "link") links.push(normalizeUri(node.url));
		if (node.type === "image") images.push(normalizeUri(node.url));
		if (node.type === "linkReference" || node.type === "imageReference") {
			const used = definitions.get(node.identifier.toUpperCase());
			// a reference with no definition is its words
			if (used !== undefined) (node.type === "linkReference" ? links : images).push(normalizeUri(used.url));
		}
		if (node.type === "html") html.push(decodeReferences(node.value));
	});
	return { links, images, html };
}

/** What the app draws as written or already as a link: never words to make a link of (a mention). */
const LITERAL = new Set([
	"link",
	"linkReference",
	"definition",
	"image",
	"imageReference",
	"inlineCode",
	"code",
	"html",
]);

/**
 * Where `text` holds what the app draws as written or already as a link (code, raw HTML, a link with its words and
 * its destination, a reference, a definition, an image): `[start, end)` offsets into `text`, read with the same parser.
 * A link made inside one would nest a link in a link, which markdown draws as neither.
 */
export function literalRanges(text: string): readonly (readonly [number, number])[] {
	const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
	const ranges: [number, number][] = [];
	const walk = (node: Nodes) => {
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		if (LITERAL.has(node.type) && start !== undefined && end !== undefined) ranges.push([start, end]);
		else for (const child of children(node)) walk(child);
	};
	walk(tree);
	return ranges;
}
