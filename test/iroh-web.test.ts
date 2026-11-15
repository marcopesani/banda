import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { sourceFiles, stamp } from "../scripts/iroh-web-source.ts";

it("the committed build of the browser's Iroh endpoint is the one its stamp names, of the sources as they are", async () => {
	expect(await sourceFiles()).toContain("src/lib.rs");
	// a change under web/iroh without `sh web/iroh/build.sh`, or a built file changed by hand, shows here. That the
	// build came from these sources it does not show: nothing here can rebuild it
	expect(
		await readFile(new URL("../web/iroh/pkg/SOURCE", import.meta.url), "utf8"),
		"run sh web/iroh/build.sh and commit web/iroh/pkg",
	).toBe(await stamp());
	const wasm = await readFile(new URL("../web/iroh/pkg/banda_iroh_web_bg.wasm", import.meta.url));
	expect(wasm.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
});
