import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { type Evidence, hashes, markdown, parseSums, rows, versionOf } from "../scripts/release-acceptance.ts";

const SHA = "a".repeat(64);
const check = (name: string, ok = true, detail?: unknown) => ({
	name,
	ok,
	...(detail === undefined ? {} : { detail }),
});
const driven = (...extra: ReturnType<typeof check>[]) => ({
	os: "Ubuntu 24.04",
	passed: extra.every((each) => each.ok),
	checks: [check("opens its window on the daemon"), check("quit stops the shell and the daemon"), ...extra],
});
const assets = (tag: string, name: string, passed = true) => ({
	tag,
	repository: "purrgrammer/banda",
	sums: SHA,
	assets: [{ name, bytes: 1, sha256: SHA, listed: SHA, github: SHA }],
	passed,
});
const install = (platform: "linux" | "mac", passed = true) => ({ platform, os: "the runner", passed });
const upgrade = (
	roundTrip: { status: string; detail: unknown },
	before = { status: "passed", detail: "beside it" },
) => ({
	from: { version: "0.1.0-alpha.14", format: "3" },
	to: { version: "0.1.0-alpha.15", format: "4" },
	assertions: {
		homeOpens: { status: "passed", detail: "opened" },
		format: { status: "passed", detail: "format 3 before, 4 after" },
		backupBeforeUpgrade: before,
		stateKept: { status: "passed", detail: { chat: "kept" } },
		backupRoundTrip: roundTrip,
	},
});
const evidence = (name: string, files: Record<string, unknown>): Evidence => ({ name, read: (path) => files[path] });
const outcome = (made: ReturnType<typeof rows>, what: string, where: string) =>
	made.find((row) => row.what === what && row.where === where)?.status;

const linux = evidence("acceptance-linux-ubuntu-latest", {
	"assets.json": assets("v0.1.0-alpha.15", "banda-0.1.0-alpha.15-linux-amd64.deb"),
	"install.json": install("linux"),
	"app/result.json": driven(check("starts its computer", true, { box: "microvm" })),
});
const mac = evidence("acceptance-mac", {
	"assets.json": assets("v0.1.0-alpha.15", "banda-0.1.0-alpha.15-mac-arm64.dmg"),
	"install.json": install("mac"),
	// even a Mac run that somehow reported the computer up is not what this workflow accepts
	"app/result.json": driven(check("starts its computer", true)),
});
const upgraded = (
	name: string,
	platform: "linux" | "mac",
	report: unknown,
	checked = driven(check("starts its computer")),
) =>
	evidence(name, {
		"previous/assets.json": assets("v0.1.0-alpha.14", `previous-${platform}`),
		"tag/assets.json": assets("v0.1.0-alpha.15", `tag-${platform}`),
		"previous/install.json": install(platform),
		"tag/install.json": install(platform),
		"seed/result.json": driven(),
		"check/result.json": checked,
		"check/upgrade.json": report,
	});

describe("release acceptance", () => {
	it("reads SHA256SUMS as sha256sum writes it, and refuses anything else", () => {
		expect(parseSums(`${SHA}  banda.deb\n${"b".repeat(64)} *banda.dmg\n`)).toEqual(
			new Map([
				["banda.deb", SHA],
				["banda.dmg", "b".repeat(64)],
			]),
		);
		expect(() => parseSums(`${SHA}  ../banda.deb\n`)).toThrow(/names no file/);
		expect(() => parseSums(`${SHA}  banda.deb\n${SHA}  banda.deb\n`)).toThrow(/twice/);
		expect(() => parseSums("not a sum\n")).toThrow(/names no file/);
	});

	it("takes a version only from a release tag", () => {
		expect(versionOf("v0.1.0-alpha.15")).toBe("0.1.0-alpha.15");
		expect(versionOf("v0.1.0")).toBe("0.1.0");
		for (const tag of ["0.1.0", "v0.1", "v0.1.0 --repo x", "v0.1.0/../x", ""])
			expect(() => versionOf(tag)).toThrow(/not a release tag/);
	});

	it("passes what every job proved, and never the Mac's computer", () => {
		const made = rows([
			linux,
			mac,
			upgraded("acceptance-upgrade-linux", "linux", upgrade({ status: "passed", detail: { chat: "kept" } })),
			upgraded("acceptance-upgrade-mac", "mac", upgrade({ status: "passed", detail: { chat: "kept" } })),
		]);
		expect(made.filter((row) => row.status === "failed")).toEqual([]);
		expect(outcome(made, "published checksums", "every job")).toBe("passed");
		expect(outcome(made, "linux install", "linux-ubuntu-latest")).toBe("passed");
		expect(outcome(made, "linux computer", "linux-ubuntu-latest")).toBe("passed");
		expect(outcome(made, "mac install", "mac")).toBe("passed");
		expect(outcome(made, "mac computer", "mac")).toBe("not exercised");
		expect(outcome(made, "upgrade home kept", "upgrade-linux")).toBe("passed");
		expect(outcome(made, "linux computer after the upgrade", "upgrade-linux")).toBe("passed");
		expect(outcome(made, "mac computer after the upgrade", "upgrade-mac")).toBe("not exercised");
		expect(made.filter((row) => row.what.startsWith("mac computer")).some((row) => row.status === "passed")).toBe(
			false,
		);
	});

	it("fails a job that left no evidence, a sum that differs and a computer that stayed offline", () => {
		const made = rows([
			evidence("acceptance-linux-ubuntu-22.04", {}),
			evidence("acceptance-linux-ubuntu-latest", {
				"assets.json": assets("v0.1.0-alpha.15", "banda.deb", false),
				"install.json": install("linux"),
				"app/result.json": driven(check("starts its computer", false, "the computer is offline: no KVM\nlog")),
			}),
			evidence("acceptance-upgrade-mac", {}),
		]);
		expect(outcome(made, "published checksums", "every job")).toBe("failed");
		expect(outcome(made, "linux install", "linux-ubuntu-22.04")).toBe("failed");
		expect(outcome(made, "linux computer", "linux-ubuntu-22.04")).toBe("failed");
		// the app's own checks passed there: the install is not failed by its computer
		expect(outcome(made, "linux install", "linux-ubuntu-latest")).toBe("passed");
		expect(made.find((row) => row.what === "linux computer" && row.where === "linux-ubuntu-latest")).toMatchObject({
			status: "failed",
			detail: "the computer is offline: no KVM",
		});
		expect(outcome(made, "upgrade home kept", "upgrade-mac")).toBe("failed");
		expect(outcome(made, "backup round trip", "upgrade-mac")).toBe("failed");
	});

	it("says not applicable for what the earlier release cannot do, without failing or passing it", () => {
		const none = { status: "not applicable", detail: "this release's banda has no backup command" };
		const made = rows([
			upgraded(
				"acceptance-upgrade-linux",
				"linux",
				upgrade(none, { status: "not applicable", detail: "the format did not move (3)" }),
			),
		]);
		expect(outcome(made, "backup round trip", "upgrade-linux")).toBe("not applicable");
		expect(outcome(made, "upgrade home kept", "upgrade-linux")).toBe("passed");
		const lost = rows([
			upgraded("acceptance-upgrade-linux", "linux", {
				...upgrade(none),
				assertions: { ...upgrade(none).assertions, stateKept: { status: "failed", detail: "chat: gone" } },
			}),
		]);
		expect(lost.find((row) => row.what === "upgrade home kept")).toMatchObject({
			status: "failed",
			detail: "stateKept: chat: gone",
		});
		const moved = rows([
			upgraded(
				"acceptance-upgrade-linux",
				"linux",
				upgrade(none, { status: "failed", detail: "holds no finished backup" }),
			),
		]);
		expect(outcome(moved, "upgrade home kept", "upgrade-linux")).toBe("failed");
	});

	it("lists each downloaded asset once, and writes the table", () => {
		const all = [linux, mac, upgraded("acceptance-upgrade-linux", "linux", upgrade({ status: "passed", detail: "" }))];
		const listed = hashes([...all, linux]);
		expect(listed.map((each) => `${each.tag} ${each.name}`)).toEqual([
			"v0.1.0-alpha.14 previous-linux",
			"v0.1.0-alpha.15 banda-0.1.0-alpha.15-linux-amd64.deb",
			"v0.1.0-alpha.15 banda-0.1.0-alpha.15-mac-arm64.dmg",
			"v0.1.0-alpha.15 tag-linux",
		]);
		const text = markdown("v0.1.0-alpha.15", "v0.1.0-alpha.14", rows(all), listed);
		expect(text).toContain("| mac computer | mac | **not exercised** |");
		expect(text).toContain(`| v0.1.0-alpha.14 | previous-linux | \`${SHA}\` |`);
		expect(text).toContain("Nothing failed.");
	});

	it("expects in its summary exactly the artifacts its jobs upload", async () => {
		const workflow = await readFile(new URL("../.github/workflows/release-acceptance.yml", import.meta.url), "utf8");
		const runners =
			/runner: \[([^\]]+)\]/
				.exec(workflow)?.[1]
				?.split(",")
				.map((each) => each.trim()) ?? [];
		const each = ["$", "{{ matrix.runner }}"].join("");
		const uploaded = [...workflow.matchAll(/^ {10}name: (acceptance-.+)$/gm)].flatMap(([, name = ""]) =>
			name.includes(each) ? runners.map((runner) => name.replace(each, runner)) : [name],
		);
		const expected = [...workflow.matchAll(/--expect (acceptance-\S+)/g)].map(([, name]) => name);
		expect(uploaded.length).toBe(5);
		expect(expected.sort()).toEqual(uploaded.sort());
	});
});
