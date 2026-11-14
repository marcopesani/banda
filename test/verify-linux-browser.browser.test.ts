import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import { afterEach, expect, it } from "vitest";
import { LinuxBrowserResult } from "../scripts/verify-linux-browser.ts";

const homes: string[] = [];
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
afterEach(async () => {
	await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function fixture() {
	const home = await mkdtemp(join(tmpdir(), "banda-browser-preflight-"));
	homes.push(home);
	return { home, output: join(home, "evidence") };
}

async function run(binary: string, output: string) {
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`
		import { verifyLinuxBrowser } from './scripts/verify-linux-browser.ts';
		const result = await verifyLinuxBrowser({ chrome: process.argv[1], output: process.argv[2] });
		process.exitCode = result.passed ? 0 : 1;
	`,
			binary,
			output,
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let log = "";
	child.stdout.on("data", (bytes: Buffer) => {
		log += bytes.toString();
	});
	child.stderr.on("data", (bytes: Buffer) => {
		log += bytes.toString();
	});
	const status = await new Promise<number | null>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", resolve);
	});
	const value: unknown = JSON.parse(await readFile(join(output, "result.json"), "utf8"));
	if (!Value.Check(LinuxBrowserResult, value)) throw new Error(`Invalid preflight result: ${log}`);
	return { status, result: value, log };
}

it.skipIf(!existsSync(chrome) || process.platform === "win32")(
	"preserves the shared helper's CDP descriptors through a regular Chrome renderer and removes its profile",
	async () => {
		const { output } = await fixture();
		const { status, result, log } = await run(chrome, output);
		expect(status, log).toBe(0);
		expect(result.qualification).toBe(false);
		expect(result.readiness).toMatchObject({ kind: "ready", constant: 2 });
		expect(result.helperExit).toBe("it ended (code 0)");
		expect(result.cleanup.kind).toBe("complete");
		expect(result.process.profile).not.toBeNull();
		expect(existsSync(result.process.profile ?? "")).toBe(false);
		expect(result.process.profileMetadata.kind).toBe("read");
		expect(result.process.arguments).toContain("--remote-debugging-pipe");
		if (process.platform === "linux") {
			expect(result.process.browserObservation).toBe("observed");
			expect(result.process.browser?.exe).toEqual({ kind: "read", value: result.binary.path });
		}
	},
);

it.skipIf(process.platform === "win32")(
	"keeps the fatal first bytes and actual abort after a long stack trace",
	async () => {
		const { home, output } = await fixture();
		const binary = join(home, "owned-fatal-child");
		await writeFile(
			binary,
			`#!/bin/sh
if [ "$1" = --version ]; then printf 'owned fatal fixture\\n'; exit 0; fi
printf 'FATAL first diagnostic\\n' >&2
i=0
while [ "$i" -lt 400 ]; do printf 'stack frame without original fatal reason\\n' >&2; i=$((i+1)); done
printf '[end of stack trace]\\n' >&2
kill -ABRT $$
`,
			{ mode: 0o700 },
		);
		const { status, result } = await run(binary, output);
		expect(status).toBe(1);
		expect(result.primaryFailure).toContain("SIGABRT");
		expect(result.helperExit).toContain("SIGABRT");
		expect(result.cleanup.kind).toBe("complete");
		expect(result.stderr.complete).toBe(true);
		expect(result.process.browserObservation).toBe("unobserved");
		const raw = await readFile(join(output, "chrome.stderr"), "utf8");
		expect(raw.startsWith("FATAL first diagnostic\n")).toBe(true);
		expect(raw.endsWith("[end of stack trace]\n")).toBe(true);
		expect(raw.length).toBeGreaterThan(2000);
		expect(existsSync(result.process.profile ?? "")).toBe(false);
	},
);

it.skipIf(process.platform === "win32")(
	"fails overflow while retaining a bounded beginning and the original byte count",
	async () => {
		const { home, output } = await fixture();
		const binary = join(home, "owned-noisy-child");
		await writeFile(
			binary,
			`#!/bin/sh
if [ "$1" = --version ]; then printf 'owned noisy fixture\\n'; exit 0; fi
printf 'FATAL first diagnostic\\n' >&2
dd if=/dev/zero bs=1048576 count=3 >&2 2>/dev/null
exit 7
`,
			{ mode: 0o700 },
		);
		const { status, result, log } = await run(binary, output);
		expect(status).toBe(1);
		expect(result.stderr.complete).toBe(false);
		expect(result.stderr.bytesBeforeRetention).toBeGreaterThan(2 << 20);
		expect(result.stderr.retainedBytes).toBe(2 << 20);
		expect((await stat(join(output, "chrome.stderr"))).size).toBe(2 << 20);
		expect((await readFile(join(output, "chrome.stderr"), "utf8")).startsWith("FATAL first diagnostic\n")).toBe(true);
		expect(log.length).toBeLessThan(4096);
		expect(result.cleanup.kind).toBe("complete");
	},
);

it.skipIf(process.platform === "win32")(
	"preserves the command timeout before the helper's forced cleanup and leaves no owned child",
	async () => {
		const { home, output } = await fixture();
		const binary = join(home, "owned-unresponsive-child");
		const node = `'${process.execPath.replaceAll("'", "'\\''")}'`;
		await writeFile(
			binary,
			`#!/bin/sh
if [ "$1" = --version ]; then printf 'owned unresponsive fixture\\n'; exit 0; fi
exec ${node} -e 'setInterval(() => {}, 1000)'
`,
			{ mode: 0o700 },
		);
		const { status, result } = await run(binary, output);
		expect(status).toBe(1);
		expect(result.primaryFailure).toContain("did not answer Browser.getVersion in time");
		expect(result.helperExit).toContain("SIGKILL");
		expect(result.cleanup.kind).toBe("complete");
		const pid = Number((await readFile(join(output, "wrapper.pid"), "utf8")).trim());
		expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
		expect(() => process.kill(pid, 0)).toThrow();
		expect(existsSync(result.process.profile ?? "")).toBe(false);
	},
);
