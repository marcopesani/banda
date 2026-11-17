/**
 * A watch's file name, whichever path writes it: its connection and kind, then a hash of what it follows, so always a
 * name the parser takes, whatever the object's id or words. Found once when an agent's `watch` call on a Drive file
 * was refused for the name the tool itself had made from the file's id; names no longer come from words at all.
 */
import { describe, expect, it } from "vitest";
import { identityName, WATCH_NAME } from "../src/core/watches.ts";

describe("a watch's name", () => {
	it("is always a name, whatever the identity holds", () => {
		for (const key of [
			"drive/a-1f2e/file:drive/1e0DrWx78-yd70xjBA1H_LB-45SrxCrDIkq-PSRJ328Y",
			"gmail/ana@example.com/search:gmail/search/newer_than:7d",
			"slack//channel:slack/C0TESTAAA01",
			"github/bandarra/pull_request:acme/banda#142",
			"9weird/x/0kind:🏠",
			"",
		])
			expect(WATCH_NAME.test(identityName(key)), key).toBe(true);
	});
});
