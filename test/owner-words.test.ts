/**
 * The owner never reads "harness" (DESIGN.md "Words"): the word is the code's and the docs', and the app says the
 * harness's own name or "coding agent". Every string and every run of JSX text in the web app and the daemon is read
 * as the compiler parses it; one that holds the word as prose (among other words, or as a title of its own) fails
 * here unless it is listed below as text the owner never reads. Identifiers, routes, ids and kinds are one token and
 * pass. The specimen is a developer's page and is not read.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const WORD = /\bharness(es)?\b/i;

/** Text only a model, a log or a harness file's author reads, by file and by how it starts. */
const NEVER_READ_BY_THE_OWNER: Record<string, readonly string[]> = {
	// the daemon's log
	"src/core/acp.ts": ["acp: a message over the limit"],
	// what a harness file's author is told is wrong with it
	"src/core/harness-files.ts": [
		'" is not a harness name',
		"a harness file starts with",
		'add "service:", the harness as the owner calls it',
		"\" names a harness's mark",
	],
	// what the model reads: a tool's result and the tags around a session's
	"src/core/harness.ts": ["<harness-result from=", "You have started no harness sessions", "<harness-session from="],
	// a route's own description of its body
	"src/server/http.ts": ["skills and agents are lists of { harness, name }"],
	// tool descriptions, which the model reads
	"src/server/routes/harnesses.ts": ["Your harness sessions.", "Stop one of your harness sessions"],
};

function* sources(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "specimen" && entry.name !== "node_modules") yield* sources(path);
		} else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
	}
}

/** Each piece of prose in a file that holds the word: its line and its text, on one line. */
function prose(path: string): { line: number; text: string }[] {
	const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
	const found: { line: number; text: string }[] = [];
	const visit = (node: ts.Node): void => {
		const literal =
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node);
		const code = literal && (ts.isImportDeclaration(node.parent) || ts.isLiteralTypeNode(node.parent));
		if ((ts.isJsxText(node) || (literal && !code)) && WORD.test(node.text)) {
			const text = node.text.trim().replace(/\s+/g, " ");
			if (ts.isJsxText(node) || /\s/.test(text) || /^Harness(es)?$/.test(text))
				found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

it('no text the owner reads says "harness"', () => {
	const read: string[] = [];
	const unused = new Set(
		Object.entries(NEVER_READ_BY_THE_OWNER).flatMap(([file, each]) => each.map((text) => `${file}: ${text}`)),
	);
	for (const root of ["web/src", "src"])
		for (const path of sources(join(ROOT, root))) {
			const file = relative(ROOT, path);
			for (const { line, text } of prose(path)) {
				const listed = NEVER_READ_BY_THE_OWNER[file]?.find((start) => text.startsWith(start));
				if (listed === undefined) read.push(`${file}:${line}: ${text}`);
				else unused.delete(`${file}: ${listed}`);
			}
		}
	expect(read).toEqual([]);
	// an exception whose text is gone goes with it
	expect([...unused]).toEqual([]);
});
