import childProcess, { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { symlinkSync, writeFileSync } from "node:fs";
import fs, { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { constants as osConstants, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as diagnostics from "../scripts/native-diagnostics.ts";
import { parseDiagnosticIdentity } from "../scripts/native-diagnostics.ts";
import {
	activated,
	launch,
	parseLinuxComputerResult,
	parseLinuxRunnerAccount,
} from "../scripts/verify-linux-computer.ts";
import {
	MICROSANDBOX_VERSION,
	MICROVM_PLATFORMS,
	MICROVM_SOURCE,
	type MicrovmManifest,
} from "../src/box/microvm-assets.ts";

const expected = {
	sourceCommit: "a".repeat(40),
	runtimeManifestSha256: "b".repeat(64),
	target: "linux-x64" as const,
	releaseRoot: "/staged/banda",
};
const completed = { status: 0, signal: null, launchError: null };
const completion = { appCompletion: completed, wrapperCompletion: completed };
function proof() {
	return {
		...expected,
		widths: [1440, 390],
		proxyRestarts: 2,
		declinedPosts: 2,
		browserDownloads: 1,
		localArchiveDelivery: true,
		publicBrowserDelivery: false,
		passed: true,
		cleaned: true,
		persistence: {
			state: "passed",
			daemonRestarts: 1,
			folders: ["/workspace", "/work", "/tools"],
			readOnlyCheck: true,
			historyRetained: true,
			browserDownloadsAfterRestart: 1,
		},
	};
}

it("admits complete local staged-app evidence only after both processes succeed", () => {
	const value = proof();
	expect(parseLinuxComputerResult(value, { expected, ...completion })).toBe(value);
	const arm = { ...expected, target: "linux-arm64" as const };
	expect(parseLinuxComputerResult({ ...value, target: arm.target }, { expected: arm, ...completion })).toEqual({
		...value,
		target: arm.target,
	});
});

it("rejects mismatched source, installed manifest, target, and staged path", () => {
	for (const changed of [
		{ sourceCommit: "c".repeat(40) },
		{ sourceCommit: null },
		{ runtimeManifestSha256: "d".repeat(64) },
		{ target: "linux-arm64" },
		{ target: "darwin-arm64" },
		{ releaseRoot: "/other/banda" },
	])
		expect(() => parseLinuxComputerResult({ ...proof(), ...changed }, { expected, ...completion })).toThrow();
});

it("requires both widths, guarded scenarios, local delivery, and completed cleanup", () => {
	for (const changed of [
		{ widths: [1440] },
		{ widths: [1440, 390, 768] },
		{ proxyRestarts: 1 },
		{ declinedPosts: 1 },
		{ browserDownloads: 2 },
		{ localArchiveDelivery: false },
		{ publicBrowserDelivery: true },
		{ passed: false },
		{ cleaned: false },
		{ cleaned: undefined },
	])
		expect(() => parseLinuxComputerResult({ ...proof(), ...changed }, { expected, ...completion })).toThrow();
	for (const missing of [null, {}, "truncated JSON", { ...proof(), persistence: undefined }])
		expect(() => parseLinuxComputerResult(missing, { expected, ...completion })).toThrow();
});

it("requires read-only persistence in all three folders, history, and the original browser delivery", () => {
	for (const changed of [
		{ state: "pending" },
		{ daemonRestarts: 0 },
		{ folders: ["/workspace", "/work"] },
		{ folders: ["/workspace", "/work", "/tmp"] },
		{ readOnlyCheck: false },
		{ historyRetained: false },
		{ browserDownloadsAfterRestart: 2 },
	]) {
		const value = proof();
		expect(() =>
			parseLinuxComputerResult(
				{ ...value, persistence: { ...value.persistence, ...changed } },
				{ expected, ...completion },
			),
		).toThrow();
	}
});

it("cannot turn a signalled, failed, missing, or unlaunched process into a pass using valid proof JSON", () => {
	for (const failed of [
		{ status: 1, signal: null, launchError: null },
		{ status: null, signal: "SIGKILL", launchError: null },
		{ status: 0, signal: "SIGTERM", launchError: null },
		{ status: null, signal: null, launchError: "spawn ENOENT" },
		{ status: 0, signal: null, launchError: "spawn failed" },
		{ status: null, signal: null, launchError: null },
		{ status: 0 },
		null,
		undefined,
	]) {
		expect(() =>
			parseLinuxComputerResult(proof(), { expected, appCompletion: failed, wrapperCompletion: completed }),
		).toThrow();
		expect(() =>
			parseLinuxComputerResult(proof(), { expected, appCompletion: completed, wrapperCompletion: failed }),
		).toThrow();
	}
});

it("maps the account to the original UID and primary GID and refuses ambiguous account output", () => {
	const identity = parseDiagnosticIdentity(`Uid:\t1001\t1001\t1001\t1001
Gid:\t118\t118\t118\t118
Groups:\t118 1001
CapInh:\t0000000000000000
CapPrm:\t0000000000000000
CapEff:\t0000000000000000
CapBnd:\t000001ffffffffff
CapAmb:\t0000000000000000
`);
	const account = "runner:x:1001:118:CI runner:/home/runner:/bin/bash\n";
	expect(parseLinuxRunnerAccount(account, identity)).toEqual({ name: "runner", home: "/home/runner" });
	for (const changed of [
		account.replace(":1001:", ":0:"),
		account.replace(":118:", ":991:"),
		account.replace("runner:x:", "-runner:x:"),
		account.replace("/home/runner", "relative/home"),
		account.replace("/home/runner", "/home/runner\n/injected"),
		account + account,
		null,
	])
		expect(() => parseLinuxRunnerAccount(changed, identity)).toThrow();
});

it.skipIf(process.platform === "win32")(
	"preserves real process signals and exit codes through completion handling",
	() => {
		const module = new URL("../scripts/verify-linux-computer.ts", import.meta.url).href;
		for (const [value, expectedStatus, expectedSignal] of [
			[completed, 0, null],
			[{ status: 7, signal: null, launchError: null }, 7, null],
			[{ status: null, signal: "SIGTERM", launchError: null }, null, "SIGTERM"],
			[{ status: null, signal: "SIGKILL", launchError: null }, null, "SIGKILL"],
			[{ status: 0, signal: null, launchError: "spawn failed" }, 1, null],
		] as const) {
			const child = spawnSync(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					`import { finishLinuxComputer } from ${JSON.stringify(module)}; finishLinuxComputer(${JSON.stringify(value)});`,
				],
				{ timeout: 5_000, killSignal: "SIGKILL" },
			);
			expect(child.error).toBeUndefined();
			expect({ status: child.status, signal: child.signal }).toEqual({
				status: expectedStatus,
				signal: expectedSignal,
			});
		}
	},
);

describe.skipIf(process.platform === "win32")("Linux launcher process boundaries", () => {
	const platform = process.platform;
	const exitCode = process.exitCode;
	const homes: string[] = [];
	afterEach(async () => {
		vi.restoreAllMocks();
		syncBuiltinESMExports();
		vi.unstubAllEnvs();
		Object.defineProperty(process, "platform", { value: platform });
		process.exitCode = exitCode;
		for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
	});

	const runnerStatus = `Uid:\t1001\t1001\t1001\t1001
Gid:\t118\t118\t118\t118
Groups:\t118 1001
CapInh:\t0000000000000000
CapPrm:\t0000000000000000
CapEff:\t0000000000000000
CapBnd:\t000001ffffffffff
CapAmb:\t0000000000000000
`;
	type Host = Awaited<ReturnType<typeof diagnostics.hostDiagnostics>>;
	function hostFixture(active: boolean): Host {
		const status = active ? runnerStatus.replace("118 1001", "108 118 1001") : runnerStatus;
		const unavailable = { state: "unavailable", error: "outside fixture scope" } as const;
		return {
			at: "2026-11-14T14:02:25.419Z",
			cpus: 2,
			files: { meminfo: unavailable, limits: unavailable, membership: unavailable },
			memory: unavailable,
			kvm: {
				at: "2026-11-14T14:02:25.419Z",
				status: { state: "read", text: status },
				identity: { state: "read", value: parseDiagnosticIdentity(status) },
				device: { state: "read", kind: "character", uid: 0, gid: 108, mode: 0o20660, inode: 9, dev: 6, rdev: 10 },
				acl: { state: "read", text: "user::rw-\ngroup::rw-\nmask::rw-\nother::---\n" },
				open: active
					? { state: "opened-and-closed" }
					: { state: "failed", code: "EACCES", error: "Original group set cannot open KVM" },
			},
		};
	}

	async function launcherFixture(mode: "activated" | "parent") {
		const home = await realpath(await mkdtemp(join(tmpdir(), "banda-linux-launcher-")));
		homes.push(home);
		const root = join(home, "package");
		const output = join(home, "evidence");
		await mkdir(join(root, "app/computer"), { recursive: true });
		await mkdir(join(root, "node"));
		await symlink(process.execPath, join(root, "node/node"));
		const target = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
		const native = MICROVM_PLATFORMS[target];
		const hash = "b".repeat(64);
		const file = <T extends string>(path: T) => ({ path, sha256: hash });
		const manifest: MicrovmManifest = {
			...(target === "linux-arm64"
				? { target, vendorArchiveSha256: MICROVM_PLATFORMS["linux-arm64"].sha256 }
				: { target, vendorArchiveSha256: MICROVM_PLATFORMS["linux-x64"].sha256 }),
			version: MICROSANDBOX_VERSION,
			runtimeBuild: {
				execution: "require-running",
				source: { commit: MICROVM_SOURCE.commit, sha256: MICROVM_SOURCE.archiveSha256 },
				patchSha256: hash,
				lockSha256: MICROVM_SOURCE.lockSha256,
				recipeSha256: hash,
				compiler: { version: MICROVM_SOURCE.rust, target: native.rustTarget, rustc: hash, cargo: hash, std: hash },
				agentdSha256: native.agentd.sha256,
				features: MICROVM_SOURCE.features,
				environment: { platform: "linux", image: native.manylinux, glibc: "2.28" },
			},
			msb: file("msb"),
			firmware: file("libkrunfw.so.5.6.1"),
			box: { archive: "box.tar", sha256: hash, ref: `banda-box:${"a".repeat(12)}`, digest: `sha256:${hash}` },
			proxy: { archive: "proxy.tar", sha256: hash, ref: `banda-proxy:${"a".repeat(12)}`, digest: `sha256:${hash}` },
			browser: {
				sha256: hash,
				bytes: 1,
				ref: `banda-browser:${"a".repeat(12)}`,
				digest: `sha256:${hash}`,
				url: `https://github.com/purrgrammer/banda/releases/download/v0.1.0-test/banda-browser-${hash}.tar`,
			},
			notices: {
				microsandbox: file("notices/MICROSANDBOX-LICENSE"),
				firmwareGpl: file("notices/LIBKRUNFW-GPL-2.0"),
				firmwareLgpl: file("notices/LIBKRUNFW-LGPL-2.1"),
				inventory: file("notices/INVENTORY.md"),
			},
			redistribution: "review-required",
		};
		const bytes = JSON.stringify(manifest);
		await writeFile(join(root, "app/computer/manifest.json"), bytes);
		const build = {
			...expected,
			target,
			releaseRoot: root,
			runtimeManifestSha256: createHash("sha256").update(bytes).digest("hex"),
		};
		const chrome = await realpath(process.execPath);
		if (mode === "activated") {
			await mkdir(output, { mode: 0o700 });
			await writeFile(
				join(output, "activation.json"),
				JSON.stringify({
					expected: build,
					runner: { name: "runner", home },
					status: runnerStatus,
					kvmGid: 108,
					chrome,
				}),
			);
		}
		const appOutput = join(home, "app-evidence");
		await mkdir(appOutput);
		await writeFile(join(appOutput, "result.json"), JSON.stringify({ ...proof(), ...build }));
		Object.defineProperty(process, "platform", { value: "linux" });
		for (const [name, value] of Object.entries({
			HOME: home,
			CHROME: chrome,
			CI: "true",
			GITHUB_ACTIONS: "true",
			GITHUB_SHA: build.sourceCommit,
			BANDA_RELEASE_ROOT: root,
			BANDA_VERIFY_SOURCE_COMMIT: build.sourceCommit,
		}))
			vi.stubEnv(name, value);
		vi.stubEnv("BANDA_VERIFY_PUBLIC_BROWSER", undefined);
		process.exitCode = undefined;
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		const before = hostFixture(mode === "activated");
		const after = hostFixture(mode === "activated");
		const host = vi.spyOn(diagnostics, "hostDiagnostics").mockResolvedValueOnce(before).mockResolvedValue(after);
		vi.spyOn(childProcess, "execFileSync").mockImplementation((file, args) => {
			if (file === "/usr/bin/getent" && args?.[0] === "passwd")
				return `runner:x:1001:118:CI runner:${home}:/bin/bash\n`;
			if (file === "/usr/bin/getent" && args?.[0] === "group") return "kvm:x:108:runner\n";
			if (file === "/usr/bin/git") return build.sourceCommit;
			if (file === "/usr/bin/id" && args?.[0] === "-un") return "runner";
			if (file === "/usr/bin/id" && args?.[0] === "-u") return "1001";
			if (file === "/usr/bin/id" && args?.[0] === "-g") return "118";
			if (file === "/usr/bin/sudo" && JSON.stringify(args) === '["-n","/usr/sbin/usermod","-aG","kvm","runner"]')
				return "";
			throw new Error(`Unexpected command: ${file} ${JSON.stringify(args)}`);
		});
		const child = {
			status: 0 as number | null,
			signal: null as NodeJS.Signals | null,
			launchError: null as string | null,
		};
		const app = { ...child };
		const spawn = vi.spyOn(childProcess, "spawnSync").mockImplementation(() => {
			if (mode === "parent") {
				symlinkSync(appOutput, join(output, "app"));
				writeFileSync(join(output, "app-completion.json"), JSON.stringify(app));
				writeFileSync(join(output, "activation-failure.json"), JSON.stringify({ error: "original activation error" }));
			}
			return {
				pid: 42,
				output: [],
				stdout: Buffer.alloc(0),
				stderr: Buffer.alloc(0),
				status: child.status,
				signal: child.signal,
				...(child.launchError === null ? {} : { error: new Error(child.launchError) }),
			};
		});
		const failures = new Set<string>();
		const originalWrite = fs.writeFile;
		const writes: string[] = [];
		vi.spyOn(fs, "writeFile").mockImplementation(async (path, ...args) => {
			const name = basename(String(path));
			writes.push(name);
			if (failures.has(name)) throw Object.assign(new Error(`ENOSPC ${name}`), { code: "ENOSPC" });
			await originalWrite(path, ...args);
		});
		syncBuiltinESMExports();
		return {
			output,
			after,
			host,
			child,
			app,
			kill,
			error,
			log,
			spawn,
			failures,
			writes,
			async run() {
				await (mode === "activated" ? activated(output) : launch(output));
			},
			async json(name: string): Promise<unknown> {
				return JSON.parse(await readFile(join(output, name), "utf8"));
			},
		};
	}

	it("finishes the real activated path only after a successful child and intact final KVM policy", async () => {
		const fixture = await launcherFixture("activated");
		await fixture.run();
		expect(fixture.spawn).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(0);
		expect(fixture.kill).not.toHaveBeenCalled();
		expect(await fixture.json("app-completion.json")).toEqual(completed);
		expect(await fixture.json("activated-after.json")).toEqual(fixture.after);
	});

	it.each([
		"open",
		"unavailable-open",
		"acl",
		"identity",
		"uid",
		"groups",
		"bounding",
		"capabilities",
		"device",
	] as const)("rejects a successful app when activated final %s policy fails", async (changed) => {
		const fixture = await launcherFixture("activated");
		const kvm = fixture.after.kvm;
		if (changed === "open") kvm.open = { state: "failed", code: "EACCES", error: "KVM access lost" };
		if (changed === "unavailable-open") kvm.open = { state: "unavailable", error: "KVM missing" };
		if (changed === "acl") kvm.acl = { state: "unavailable", error: "ACL missing" };
		if (changed === "identity") kvm.identity = { state: "unavailable", error: "identity missing" };
		if (changed === "device" && kvm.device.state === "read") kvm.device.uid = 1001;
		if (kvm.identity.state === "read") {
			if (changed === "uid") kvm.identity.value.savedUid = 0;
			if (changed === "groups") kvm.identity.value.groups.push(999);
			if (changed === "bounding") kvm.identity.value.capabilities.bounding = "0000000000000000";
			if (changed === "capabilities") kvm.identity.value.capabilities.effective = "0000000000000001";
		}
		await fixture.run();
		expect(fixture.spawn).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBe(1);
		expect(await fixture.json("app-completion.json")).toEqual(completed);
		expect(await fixture.json("activated-after.json")).toEqual(fixture.after);
	});

	it.each(["app-completion.json", "activated-after.json", "activation-failure.json"])(
		"retains a killed app and attempts other evidence when writing %s fails",
		async (name) => {
			const fixture = await launcherFixture("activated");
			fixture.child.status = null;
			fixture.child.signal = "SIGTERM";
			fixture.failures.add(name);
			fixture.after.kvm.open = { state: "failed", code: "EACCES", error: "KVM access lost" };
			await fixture.run();
			expect(fixture.kill).toHaveBeenCalledWith(process.pid, osConstants.signals.SIGTERM);
			expect(fixture.writes).toEqual(
				expect.arrayContaining(["app-completion.json", "activated-after.json", "activation-failure.json"]),
			);
			if (name !== "activation-failure.json")
				expect(await fixture.json("activation-failure.json")).toMatchObject({ appCompletion: fixture.child });
		},
	);

	it("retains an app exit status even when every final record fails", async () => {
		const fixture = await launcherFixture("activated");
		fixture.child.status = 7;
		for (const name of ["app-completion.json", "activated-after.json", "activation-failure.json"])
			fixture.failures.add(name);
		await fixture.run();
		expect(process.exitCode).toBe(7);
		expect(fixture.kill).not.toHaveBeenCalled();
		expect(fixture.writes).toEqual(expect.arrayContaining([...fixture.failures]));
	});

	it.each(["app-completion.json", "activated-after.json"])(
		"fails a successful app when writing %s fails",
		async (name) => {
			const fixture = await launcherFixture("activated");
			fixture.failures.add(name);
			await fixture.run();
			expect(process.exitCode).toBe(1);
			expect(await fixture.json("activation-failure.json")).toMatchObject({
				error: null,
				appCompletion: completed,
				finalizationFailures: [{ operation: name, error: expect.stringContaining(`ENOSPC ${name}`) }],
			});
		},
	);

	it.each(["activated", "parent"] as const)(
		"preserves %s completion when final host observation throws",
		async (mode) => {
			const fixture = await launcherFixture(mode);
			fixture.child.status = 7;
			fixture.host.mockRejectedValue(new Error("host observation failed"));
			await fixture.run();
			expect(process.exitCode).toBe(7);
			const result = await fixture.json(mode === "activated" ? "activation-failure.json" : "result.json");
			expect(result).toMatchObject({
				finalizationFailures: [
					{
						operation: mode === "activated" ? "activated-after" : "runner-after",
						error: expect.stringContaining("host observation failed"),
					},
				],
			});
		},
	);

	it("retains the primary validation error separately from final recording and policy failures", async () => {
		const fixture = await launcherFixture("activated");
		vi.stubEnv("BANDA_RELEASE_ROOT", "/wrong/package");
		fixture.failures.add("activated-after.json");
		fixture.after.kvm.open = { state: "failed", code: "EACCES", error: "KVM access lost" };
		fixture.host.mockReset().mockResolvedValue(fixture.after);
		await fixture.run();
		expect(process.exitCode).toBe(1);
		expect(fixture.spawn).not.toHaveBeenCalled();
		expect(await fixture.json("activation-failure.json")).toMatchObject({
			error: expect.stringContaining("/wrong/package"),
			appCompletion: null,
			finalizationFailures: [
				{ operation: "activated-after.json", error: expect.stringContaining("ENOSPC") },
				{ operation: "activated-after", error: expect.stringContaining("cannot open KVM") },
			],
		});
	});

	it("still attempts final host evidence when the activation failure record cannot be written", async () => {
		const fixture = await launcherFixture("activated");
		vi.stubEnv("BANDA_RELEASE_ROOT", "/wrong/package");
		fixture.failures.add("activation-failure.json");
		await fixture.run();
		expect(process.exitCode).toBe(1);
		expect(await fixture.json("activated-after.json")).toEqual(fixture.after);
		expect(fixture.error).toHaveBeenCalledWith("activation-failure.json:", expect.objectContaining({ code: "ENOSPC" }));
	});

	it("qualifies the parent with its original groups and unsuccessful parent KVM open", async () => {
		const fixture = await launcherFixture("parent");
		await fixture.run();
		expect(process.exitCode ?? 0).toBe(0);
		expect(await fixture.json("result.json")).toMatchObject({ qualification: "staged-native-app" });
	});

	it.each(["wrapper-completion.json", "runner-after.json", "result.json"])(
		"preserves the failed direct wrapper even when writing %s fails",
		async (name) => {
			const fixture = await launcherFixture("parent");
			fixture.child.status = null;
			fixture.child.signal = "SIGKILL";
			fixture.failures.add(name);
			await fixture.run();
			expect(fixture.kill).toHaveBeenCalledWith(process.pid, osConstants.signals.SIGKILL);
			expect(fixture.writes).toEqual(
				expect.arrayContaining(["wrapper-completion.json", "runner-after.json", "result.json"]),
			);
			if (name !== "result.json")
				expect(await fixture.json("result.json")).toMatchObject({
					qualification: false,
					wrapperCompletion: fixture.child,
				});
		},
	);

	it("retains the app's nonzero status over wrapper and aggregate failures", async () => {
		const fixture = await launcherFixture("parent");
		fixture.app.status = 7;
		fixture.child.status = 1;
		for (const name of ["wrapper-completion.json", "runner-after.json", "result.json"]) fixture.failures.add(name);
		await fixture.run();
		expect(process.exitCode).toBe(7);
		expect(fixture.writes).toEqual(expect.arrayContaining([...fixture.failures]));
	});

	it.each(["wrapper-completion.json", "runner-after.json", "result.json"])(
		"refuses qualification for successful children when writing %s fails",
		async (name) => {
			const fixture = await launcherFixture("parent");
			fixture.failures.add(name);
			await fixture.run();
			expect(process.exitCode).toBe(1);
			expect(fixture.log).not.toHaveBeenCalled();
			if (name !== "result.json") expect(await fixture.json("result.json")).toMatchObject({ qualification: false });
		},
	);
});
