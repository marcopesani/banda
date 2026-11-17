/** A preview's line of markdown (web/src/chat/inline.tsx): formatting as such, never its marks. */
import { describe, expect, it } from "vitest";
import { type InlinePart, inlineParts } from "../web/src/chat/inline.tsx";

describe("a preview's markdown", () => {
	it("reads bold, italic and code as such, and a link as its words", () => {
		expect(inlineParts("Three **good** picks, *all* by `train`: see [Toledo](https://x.example/)")).toEqual([
			{ text: "Three " },
			{ text: "good", style: "bold" },
			{ text: " picks, " },
			{ text: "all", style: "italic" },
			{ text: " by " },
			{ text: "train", style: "code" },
			{ text: ": see Toledo" },
		]);
	});

	it("drops the marks of blocks and keeps one line", () => {
		expect(inlineParts("## Plan\n- **Toledo** first\n> quoted")).toEqual([
			{ text: "Plan " },
			{ text: "Toledo", style: "bold" },
			{ text: " first quoted" },
		]);
	});

	it("leaves a mark the cut left open as plain text", () => {
		expect(inlineParts("Madrid leads with **3.4 mill")).toEqual([{ text: "Madrid leads with **3.4 mill" }]);
		expect(inlineParts("snake_case and 2 * 3")).toEqual([{ text: "snake_case and 2 * 3" }]);
	});

	it("reads an underscore inside a word as the word's own, not as emphasis", () => {
		const asked =
			"does pi has a web_search and fetch_content tool or they wrote themselves? seen in https://github.com/n8n-io/nod/tree/main/evals";
		expect(inlineParts(asked)).toEqual([{ text: asked }]);
		expect(inlineParts("set MAX_RETRIES and __init__ helpers_v2 in my_module.py")).toEqual([
			{ text: "set MAX_RETRIES and " },
			{ text: "init", style: "bold" },
			{ text: " helpers_v2 in my_module.py" },
		]);
		expect(inlineParts("see https://x.example/a_b/c_d and snake__case__name")).toEqual([
			{ text: "see https://x.example/a_b/c_d and snake__case__name" },
		]);
	});

	it("lends a longer run's marks to emphasis and keeps the rest as text, as CommonMark does", () => {
		expect(inlineParts("_a__")).toEqual([{ text: "a", style: "italic" }, { text: "_" }]);
		expect(inlineParts("__é_")).toEqual([{ text: "_" }, { text: "é", style: "italic" }]);
		expect(inlineParts("(___a_")).toEqual([{ text: "(__" }, { text: "a", style: "italic" }]);
		expect(inlineParts("__a___ and ___b__")).toEqual([
			{ text: "a", style: "bold" },
			{ text: "_ and _" },
			{ text: "b", style: "bold" },
		]);
		// one run closes the italic and opens the bold
		expect(inlineParts("_.___(*__")).toEqual([
			{ text: ".", style: "italic" },
			{ text: "(*", style: "bold" },
		]);
		// one style per part: CommonMark's bold italic reads as bold between its extra marks
		expect(inlineParts("___x___")).toEqual([{ text: "_" }, { text: "x", style: "bold" }, { text: "_" }]);
	});

	it("keeps an underscore inside a word within emphasis, as CommonMark does", () => {
		expect(inlineParts("_foo_bar_ and __foo__bar__")).toEqual([
			{ text: "foo_bar", style: "italic" },
			{ text: " and " },
			{ text: "foo__bar", style: "bold" },
		]);
		expect(inlineParts("try _web_search_ or fetch_content_")).toEqual([
			{ text: "try " },
			{ text: "web_search", style: "italic" },
			{ text: " or fetch_content_" },
		]);
	});

	it("still reads underscores and asterisks at a word's edge as emphasis, and code as written", () => {
		expect(inlineParts("_really_ (__now__), *soon* and `web_search_tool`")).toEqual([
			{ text: "really", style: "italic" },
			{ text: " (" },
			{ text: "now", style: "bold" },
			{ text: "), " },
			{ text: "soon", style: "italic" },
			{ text: " and " },
			{ text: "web_search_tool", style: "code" },
		]);
		expect(inlineParts("read [the web_search docs](https://x.example/web_search_docs) first")).toEqual([
			{ text: "read the web_search docs first" },
		]);
	});

	it("reads a code span as code, not as the inside of underscore emphasis", () => {
		expect(inlineParts("__ `a_b__` x")).toEqual([{ text: "__ " }, { text: "a_b__", style: "code" }, { text: " x" }]);
	});

	it("reads a link's words from its last [ and an address with one level of parentheses", () => {
		expect(inlineParts("see [a [b](https://x.example/) now")).toEqual([{ text: "see [a b now" }]);
		expect(inlineParts("[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) next")).toEqual([{ text: "Foo next" }]);
		expect(inlineParts("[x](a(b)")).toEqual([{ text: "[x](a(b)" }]);
	});

	it("judges a word by its whole letter, and reads the line's own private-use characters as text", () => {
		expect(inlineParts("𝐀_x_ and _𝐀_")).toEqual([{ text: "𝐀_x_ and " }, { text: "𝐀", style: "italic" }]);
		expect(inlineParts("\uE001x\uE002 and \uE003y\uE003")).toEqual([{ text: "\uE001x\uE002 and \uE003y\uE003" }]);
	});

	// A quadratic reading takes seconds on these (a run of 100,000 underscores took 9 s); a linear one, milliseconds.
	it("reads a long line in time linear in its length, however its marks are arranged", () => {
		const n = 100_000;
		const run = "_".repeat(n);
		const fill = (unit: string) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
		const cases: [string, InlinePart[] | undefined][] = [
			[run, [{ text: run }]],
			[`see ${run} done`, [{ text: `see ${run} done` }]],
			[`a${run}a`, [{ text: `a${run}a` }]],
			[`${run}text`, [{ text: `${run}text` }]],
			[`(${run}a_`, [{ text: `(${run.slice(1)}` }, { text: "a", style: "italic" }]],
			[fill(" _a"), [{ text: fill(" _a").trim() }]],
			[fill(" __a"), [{ text: fill(" __a").trim() }]],
			[fill(" _a_b"), [{ text: fill(" _a_b").trim() }]],
			[fill("_`"), undefined],
			[fill("_*"), undefined],
			["[".repeat(n), [{ text: "[".repeat(n) }]],
			[fill("[a]("), [{ text: fill("[a](") }]],
			[fill("[a](("), [{ text: fill("[a]((") }]],
		];
		for (const [line, parts] of cases) {
			const start = performance.now();
			const read = inlineParts(line);
			expect(performance.now() - start, line.slice(0, 12)).toBeLessThan(500);
			if (parts !== undefined) expect(read).toEqual(parts);
			expect(read.some((part) => /[\uE000-\uE004]/.test(part.text))).toBe(false);
		}
	});
});
