import { expect, it } from "vitest";
import { assertLinuxLoaderOutput, parseLinuxPackageResult } from "../scripts/verify-linux-package.ts";

it("rejects loader dependency errors even when the loader exits zero", () => {
	const stdout = "\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f0000000000)\n";
	expect(() => assertLinuxLoaderOutput({ stdout, stderr: "" })).not.toThrow();
	for (const output of [
		{ stdout: "", stderr: "" },
		{ stdout: "\tlibnss3.so => not found\n", stderr: "" },
		{ stdout, stderr: "/opt/banda/banda-desktop: /lib/libc.so.6: version `GLIBC_2.38' not found\n" },
		{ stdout, stderr: "error while loading shared libraries: libnss3.so: cannot open shared object file\n" },
	])
		expect(() => assertLinuxLoaderOutput(output)).toThrow();
});

const identity = {
	sourceCommit: "a".repeat(40),
	packageName: "banda-0.1.0-alpha.13-linux-amd64.deb",
	packageSha256: "b".repeat(64),
	baseImage: `debian:bookworm-slim@sha256:${"c".repeat(64)}`,
};
function proof() {
	return {
		...identity,
		container: "banda-dependency-smoke-12345678-1234-1234-1234-123456789abc",
		dependencySmokePassed: true,
		desktopQualified: false,
		publicDelivery: false,
		nativeQualified: false,
		commands: [
			"pull",
			"create",
			"start",
			"inventory",
			"update",
			"plan",
			"install",
			"installed",
			"node",
			"electron",
			"cleanup-remove",
			"cleanup-confirm",
		].map((role) => ({
			role,
			status: 0,
			signal: null,
			error: null,
			stdout: `${role}.stdout.log`,
			stderr: `${role}.stderr.log`,
		})),
		cleanup: "removed",
		originalFailure: null,
		cleanupFailure: null,
		interrupted: null,
	};
}

it("admits narrow dependency evidence with exact package and source identity", () => {
	const result = proof();
	expect(parseLinuxPackageResult(result, identity)).toBe(result);
});

it("rejects a pass after failed APT, loader, or container cleanup commands", () => {
	for (const role of [
		"update",
		"plan",
		"install",
		"installed",
		"node",
		"electron",
		"cleanup-remove",
		"cleanup-confirm",
	]) {
		for (const failure of [{ status: 1 }, { status: null, signal: "SIGKILL" }, { error: "spawn failed" }]) {
			const result = proof();
			const commands = result.commands.map((command) => (command.role === role ? { ...command, ...failure } : command));
			expect(() => parseLinuxPackageResult({ ...result, commands }, identity)).toThrow();
			expect(
				parseLinuxPackageResult({ ...result, commands, dependencySmokePassed: false }, identity).dependencySmokePassed,
			).toBe(false);
		}
	}
});

it("rejects incomplete, reordered, or duplicated steps and failed observations", () => {
	for (const changed of [
		{ commands: proof().commands.slice(1) },
		{ commands: [...proof().commands].reverse() },
		{ commands: [...proof().commands, proof().commands[0]] },
		{ cleanup: "absent" },
		{ cleanup: "failed", cleanupFailure: "Docker unavailable" },
		{ originalFailure: "Version output was not recognized" },
		{ interrupted: "SIGTERM" },
	])
		expect(() => parseLinuxPackageResult({ ...proof(), ...changed }, identity)).toThrow();
});

it("rejects unknown or mismatched source, package, hash, or base image", () => {
	for (const changed of [
		{ sourceCommit: "unknown" },
		{ sourceCommit: "d".repeat(40) },
		{ packageName: "banda-0.1.0-alpha.12-linux-amd64.deb" },
		{ packageSha256: "e".repeat(64) },
		{ baseImage: "debian:bookworm-slim" },
		{ baseImage: `debian:bookworm-slim@sha256:${"f".repeat(64)}` },
	])
		expect(() => parseLinuxPackageResult({ ...proof(), ...changed }, identity)).toThrow();
	expect(() => parseLinuxPackageResult(proof(), { ...identity, sourceCommit: "unknown" })).toThrow();
});

it("never admits desktop, native, or public-delivery qualification", () => {
	for (const field of ["desktopQualified", "nativeQualified", "publicDelivery"])
		expect(() => parseLinuxPackageResult({ ...proof(), [field]: true }, identity)).toThrow();
});
