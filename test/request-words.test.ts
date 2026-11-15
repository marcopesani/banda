/**
 * A request as a person reads it: credentials masked by their name or their shape, everything else as it is, and a
 * body's readable fields.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	addressWords,
	bodyFields,
	headersWords,
	headerWords,
	isSecret,
	masked,
	responseWords,
	secretLooking,
} from "../src/core/request-words.ts";
import { pbtRuns } from "./pbt.ts";

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("masking", () => {
	it("shows a long value's first four characters and its length, a short one's length alone", () => {
		expect(masked("ca3923e41d3c424fa3d09ce0ef8fd5c6")).toBe("ca39… (32 characters)");
		expect(masked("hunter2")).toBe("hidden (7 characters)");
	});

	it("masks a header by a credential's name, whatever its case", () => {
		for (const name of [
			"Authorization",
			"X-API-KEY",
			"x-cp-connect-secret",
			"X-Auth-Token",
			"x-session-id",
			"X-Csrf-Token",
			"Proxy-Authorization",
		])
			expect(headerWords(name, "abc", "command")).toBe(`${name}: hidden (3 characters)`);
		// a cookie is named by whose it is, never shown: a command's is not the browser's session
		expect(headerWords("Cookie", "session=s1", "browser")).toBe("Cookie: (the browser's session, hidden)");
		expect(headerWords("cookie", "VISITOR=abc", "command")).toBe("cookie: (set by the command, hidden)");
	});

	it("masks a value shaped like a key, whatever its header's name", () => {
		expect(headerWords("x-cp-connect-id", "5f0e7c1a-9b2d-4e3f-8a6b-1c2d3e4f5a6b", "browser")).toBe(
			"x-cp-connect-id: 5f0e… (36 characters)",
		);
		expect(secretLooking("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dGVzdHNpZw")).toBe(true);
		expect(secretLooking("sk_live_51HxQ2aBcDeFgHiJkLmNoP")).toBe(true);
	});

	it("leaves the headers a browser sends on its own as they are", () => {
		const plain: [string, string][] = [
			["Origin", "https://www.cp.pt"],
			["Referer", "https://www.cp.pt/passageiros/pt/consultar-horarios?x=1"],
			["User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139.0.0.0"],
			["sec-ch-ua", '"Chromium";v="139", "Not;A=Brand";v="99"'],
			["sec-ch-ua-platform", '"macOS"'],
			["sec-fetch-mode", "cors"],
			["Accept", "application/json, text/plain, */*"],
			["Accept-Language", "pt-PT,pt;q=0.9,en-US;q=0.8"],
			["Content-Type", "application/x-www-form-urlencoded; charset=UTF-8"],
			["Content-Length", "1234567890123456"],
			["Date", "Thu, 05 Nov 2026 10:00:00 GMT"],
			["Cache-Control", "no-cache"],
		];
		expect(headersWords(plain, "browser")).toBe(plain.map(([k, v]) => `${k}: ${v}`).join("\n"));
	});

	it("never shows a credential's value whole", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("Authorization", "x-api-key", "X-Secret", "session", "x-token", "Cookie"),
				fc.string({ minLength: 1, maxLength: 200 }),
				fc.constantFrom<"browser" | "command">("browser", "command"),
				(name, value, from) => {
					const shown = headerWords(name, value, from).slice(name.length + 2);
					expect(value.length < 5 || !shown.includes(value)).toBe(true);
				},
			),
			{ numRuns: pbtRuns(100) },
		);
		fc.assert(
			fc.property(fc.stringMatching(/^[A-Za-z0-9_-]{24,64}$/), (key) => {
				fc.pre(/[0-9]/.test(key) && /[A-Za-z]/.test(key) && isSecret("x-id", key));
				expect(headerWords("x-id", key, "command")).not.toContain(key);
			}),
			{ numRuns: pbtRuns(100) },
		);
	});

	it("masks a credential in an address's query, and nothing else of it", () => {
		expect(addressWords("https://api.example/v1/items?q=lisbon&page=2#top")).toBe(
			"https://api.example/v1/items?q=lisbon&page=2#top",
		);
		expect(addressWords("https://api.example/v1?access_token=abcdefgh12345678xyz&q=x")).toBe(
			`https://api.example/v1?access_token=${encodeURIComponent("abcd… (19 characters)")}&q=x`,
		);
	});
});

describe("a body's fields", () => {
	it("reads a JSON object's top-level fields, nested ones by their size, credentials masked", () => {
		expect(
			bodyFields(
				b64(
					JSON.stringify({
						departureStationCode: "94-31039",
						travelDate: "2026-12-12",
						adults: 1,
						flexible: false,
						return: null,
						filters: { class: 2, adults: 1 },
						legs: [1, 2, 3],
						password: "correct horse",
					}),
				),
				"application/json",
			),
		).toEqual({
			departureStationCode: "94-31039",
			travelDate: "2026-12-12",
			adults: "1",
			flexible: "false",
			return: "—",
			filters: "(2 fields)",
			legs: "(3 items)",
			password: "hidden (13 characters)",
		});
	});

	it("reads a form's fields", () => {
		expect(bodyFields(b64("label=banda&note=hello+there"), "application/x-www-form-urlencoded")).toEqual({
			label: "banda",
			note: "hello there",
		});
	});

	it("reads none from a body that is no object of fields", () => {
		expect(bodyFields("")).toBeUndefined();
		expect(bodyFields(b64("[1,2]"), "application/json")).toBeUndefined();
		expect(bodyFields(b64("just words"), "text/plain")).toBeUndefined();
		expect(bodyFields(Buffer.from([0, 1, 2, 255]).toString("base64"))).toBeUndefined();
	});

	it("keeps a dozen, and counts the rest; a page's odd names stay its own fields", () => {
		const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, i]));
		const fields = bodyFields(b64(JSON.stringify(many)), "application/json")!;
		expect(Object.keys(fields)).toHaveLength(13);
		expect(fields["and more"]).toBe("3 more fields");
		const odd = bodyFields(b64('{"__proto__":"x","constructor":"y"}'), "application/json")!;
		expect(Object.getPrototypeOf(odd)).toBe(Object.prototype);
		expect(Object.keys(odd)).toEqual(["__proto__", "constructor"]);
	});
});

describe("a response's body", () => {
	const json: [string, string][] = [["Content-Type", "application/json"]];

	it("is its text in the charset its type names, and by its type though some byte is not text", () => {
		const latin: [string, string][] = [["content-type", "application/json; charset=ISO-8859-1"]];
		expect(responseWords(Buffer.from('{"name":"café"}', "latin1").toString("base64"), latin)).toBe('{"name":"café"}');
		expect(responseWords(Buffer.from('{"name":"café"}', "latin1").toString("base64"), json)).toBe('{"name":"caf�"}');
		expect(responseWords(b64('{"ok":true}'), [["Content-Type", 'text/plain; charset="no-such"']])).toBe('{"ok":true}');
		// no type: text when its bytes read as text
		expect(responseWords(b64("plain"), [])).toBe("plain");
		expect(responseWords(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]).toString("base64"), [])).toBe(
			"(7 bytes of binary data)",
		);
		expect(responseWords(Buffer.from([0xff, 0xd8, 0xff, 0]).toString("base64"), [["Content-Type", "image/jpeg"]])).toBe(
			"(4 bytes of binary data)",
		);
		expect(responseWords("", json)).toBe("(empty)");
		// a type that only has a text format's name inside it is judged by its bytes
		const docx: [string, string][] = [
			["Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
		];
		expect(responseWords(Buffer.from([0x50, 0x4b, 3, 4]).toString("base64"), docx)).toBe("(4 bytes of binary data)");
		for (const type of ["application/problem+json; charset=utf-8", "image/svg+xml", "Application/JSON"])
			expect(responseWords(Buffer.from('{"a":"\u0001"}').toString("base64"), [["content-type", type]])).toBe(
				'{"a":"\u0001"}',
			);
	});

	it("cut inside a character is still text: the broken character is dropped", () => {
		const whole = Buffer.from("ação");
		const broken = whole.subarray(0, whole.length - 2).toString("base64");
		expect(responseWords(broken, [], true)).toBe("aç");
		expect(responseWords(broken, json, true)).toBe("aç");
	});

	it("is never shown still encoded: its bytes are not what it says, and nothing in them was scrubbed", () => {
		const gzip = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0]).toString("base64");
		for (const encoding of ["gzip", "br", "GZIP, br"])
			expect(responseWords(gzip, [...json, ["Content-Encoding", encoding]])).toBe(
				`(not shown: it came encoded as ${encoding.toLowerCase()}, which could not be undone)`,
			);
		expect(responseWords(b64("{}"), [...json, ["Content-Encoding", "identity"]])).toBe("{}");
	});
});
