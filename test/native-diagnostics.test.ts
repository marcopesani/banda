import childProcess from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
	assertDiagnosticIdentity,
	assertKvmGroup,
	deliverCreateResult,
	diagnosticAcl,
	diagnosticFile,
	diagnosticImage,
	diagnosticInspection,
	failedCreateObserver,
	hostDiagnostics,
	kvmDiagnostics,
	parseDiagnosticIdentity,
	parseDiagnosticResult,
} from "../scripts/native-diagnostics.ts";

const homes: string[] = [];
afterEach(async () => {
	for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function home() {
	const path = await mkdtemp(join(tmpdir(), "banda-native-diagnostics-test-"));
	homes.push(path);
	return path;
}
const owner = {
	binary: "/staged/msb",
	cache: "/tmp/owned-msb",
	home: "/tmp/owned-home",
	name: "banda-microvm-0123456789-0123456789ab",
	generation: "0123456789ab",
	imageRef: "banda-box:fixture",
	configDigest: "sha256:config",
};
const labels = { "banda.home": owner.home, "banda.runtime": "microvm", "banda.generation": owner.generation };
const inspected = {
	name: owner.name,
	status: "Crashed",
	config: { labels, manifest_digest: "sha256:manifest", network: { ports: [] }, cpus: 2, memory: 4096 },
};
const args = [
	"create",
	"--name",
	owner.name,
	...Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
	"--memory",
	"4GiB",
	"--pull",
	"never",
	owner.imageRef,
];
const options = { env: { MSB_HOME: owner.cache } };

it("retains full effective config while refusing another owner, image, or active VM", () => {
	expect(diagnosticInspection(owner, inspected, "sha256:manifest")).toEqual({ canStart: true, inspection: inspected });
	for (const status of ["Running", "Starting", "Draining"])
		expect(diagnosticInspection(owner, { ...inspected, status }, "sha256:manifest").canStart).toBe(false);
	for (const value of [
		{ ...inspected, name: `${owner.name}-proxy` },
		{ ...inspected, config: { ...inspected.config, labels: { ...labels, "banda.home": "/other" } } },
		{ ...inspected, config: { ...inspected.config, labels: { ...labels, "banda.generation": "other" } } },
		{ ...inspected, config: { ...inspected.config, manifest_digest: "other" } },
		{ ...inspected, config: { ...inspected.config, network: { ports: [80] } } },
	])
		expect(() => diagnosticInspection(owner, value, "sha256:manifest")).toThrow(/exact owned/);
});

it("admits one diagnostic only for the failed exact owned command create", async () => {
	const diagnose = vi.fn(async () => {});
	const observe = failedCreateObserver(owner, diagnose);
	const failure = new Error("original startup abort");
	for (const invocation of [
		["/other/msb", args, options, failure],
		[owner.binary, args, { env: { MSB_HOME: "/other" } }, failure],
		[owner.binary, args.map((part) => (part === owner.name ? `${owner.name}-proxy` : part)), options, failure],
		[owner.binary, args.map((part) => (part === owner.imageRef ? "other-image" : part)), options, failure],
		[owner.binary, args, options, null],
		[owner.binary, args, options, undefined],
		[owner.binary, args, options, "not an exec error"],
		[owner.binary, ["start", owner.name], options, failure],
		[owner.binary, ["create", "--name", owner.name, owner.imageRef], options, failure],
	])
		await observe(invocation[0], invocation[1], invocation[2], invocation[3]);
	expect(diagnose).not.toHaveBeenCalled();
	await observe(owner.binary, args, options, failure);
	await observe(owner.binary, args, options, failure);
	expect(diagnose).toHaveBeenCalledTimes(1);
});

it("never retries a refused or failed diagnostic", async () => {
	const refusal = new Error("ownership changed before diagnostic");
	const diagnose = vi.fn(async () => {
		throw refusal;
	});
	const observe = failedCreateObserver(owner, diagnose);
	await expect(observe(owner.binary, args, options, new Error("original"))).rejects.toBe(refusal);
	await observe(owner.binary, args, options, new Error("original"));
	expect(diagnose).toHaveBeenCalledTimes(1);
});

it("bounds each host file and records unavailable paths", async () => {
	const root = await home();
	const path = join(root, "large");
	await writeFile(path, "a".repeat(70_000));
	const result = await diagnosticFile(path);
	expect(result.state).toBe("truncated");
	if (result.state === "unavailable") throw new Error(result.error);
	expect(Buffer.byteLength(result.text)).toBe(64 << 10);
	expect((await diagnosticFile(join(root, "missing"))).state).toBe("unavailable");
	expect((await readFile(path)).length).toBe(70_000);
});

it("reads only the current cgroup beneath the verified mount", async () => {
	const root = await home();
	const proc = join(root, "proc"),
		cgroup = join(root, "cgroup");
	await mkdir(join(proc, "self"), { recursive: true });
	await mkdir(join(cgroup, "current"), { recursive: true });
	await writeFile(join(proc, "self/cgroup"), "0::/current\n");
	await writeFile(join(cgroup, "current/memory.max"), "4294967296\n");
	const result = await hostDiagnostics({ proc, cgroup, dev: join(root, "dev") });
	expect(result.memory).toMatchObject({ state: "located", maximum: { text: "4294967296\n" } });
	await symlink(root, join(cgroup, "escape"));
	await writeFile(join(proc, "self/cgroup"), "0::/escape\n");
	expect((await hostDiagnostics({ proc, cgroup, dev: join(root, "dev") })).memory).toMatchObject({
		state: "unavailable",
		error: expect.stringContaining("escapes"),
	});
});

it("distinguishes the loaded manifest identity from the verified image config", () => {
	const image = {
		digest: "sha256:manifest",
		config: { digest: owner.configDigest },
		architecture: "amd64",
		os: "linux",
	};
	expect(diagnosticImage(owner, image)).toBe(image);
	expect(() => diagnosticImage(owner, { ...image, config: { digest: "other" } })).toThrow(/verified bundle/);
	expect(() => diagnosticInspection(owner, inspected, owner.configDigest)).toThrow(/exact owned/);
});

it("delivers the original callback result after diagnostics, including when recording fails", async () => {
	const original = new Error("original VM abort"),
		stdout = Buffer.from("stdout"),
		stderr = Buffer.from("stderr");
	const callback = vi.fn();
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const held = deliverCreateResult({
		diagnose: () => gate,
		recordFailure: async () => {},
		deliver: () => callback(original, stdout, stderr),
	});
	expect(callback).not.toHaveBeenCalled();
	release?.();
	await held;
	expect(callback).toHaveBeenLastCalledWith(original, stdout, stderr);
	await deliverCreateResult({
		diagnose: async () => {
			throw new Error("probe failed");
		},
		recordFailure: async () => {
			throw new Error("disk failed");
		},
		deliver: () => callback(original, stdout, stderr),
	});
	expect(callback).toHaveBeenCalledTimes(2);
	expect(callback.mock.calls[1]?.[0]).toBe(original);
	expect(callback.mock.calls[1]?.[1]).toBe(stdout);
	expect(callback.mock.calls[1]?.[2]).toBe(stderr);
});

const sourceCommit = "a".repeat(40);
const runtimeManifestSha256 = "b".repeat(64);
const expectedBuild = { sourceCommit, runtimeManifestSha256 };
const status = `Uid:\t1001\t1001\t1001\t1001
Gid:\t118\t118\t118\t118
Groups:\t118 1001
CapInh:\t0000000000000000
CapPrm:\t0000000000000000
CapEff:\t0000000000000000
CapBnd:\t000001ffffffffff
CapAmb:\t0000000000000000
NoNewPrivs:\t0
Seccomp:\t0
`;
const identity = {
	uid: 1001,
	euid: 1001,
	savedUid: 1001,
	fsuid: 1001,
	gid: 118,
	egid: 118,
	savedGid: 118,
	fsgid: 118,
	groups: [118, 1001],
	capabilities: {
		inherited: "0000000000000000",
		permitted: "0000000000000000",
		effective: "0000000000000000",
		bounding: "000001ffffffffff",
		ambient: "0000000000000000",
	},
};
function hostFixture() {
	return {
		at: "2026-11-14T14:02:25.419Z",
		kvm: {
			at: "2026-11-14T14:02:25.419Z",
			status: { state: "read", text: status },
			identity: { state: "read", value: structuredClone(identity) },
			device: { state: "read", kind: "character", uid: 0, gid: 108, mode: 0o20660, inode: 9, dev: 6, rdev: 10 },
			acl: {
				state: "read",
				text: "# owner: 0\n# group: 108\nuser::rw-\nuser:1001:rw-\ngroup::rw-\nmask::rw-\nother::---\n",
			},
			open: { state: "opened-and-closed" },
		},
	};
}
function resultFixture() {
	return {
		qualification: false,
		...expectedBuild,
		home: owner.home,
		cache: owner.cache,
		owner,
		hostBefore: hostFixture(),
		hostAfter: hostFixture(),
		originalFailure: "Error: sandbox process exited (SIGABRT)",
		probe: {
			state: "captured",
			hostAtFailure: hostFixture(),
			before: inspected,
			capture: {
				closed: true,
				reason: "closed",
				bytesObserved: 500,
				bytesRetained: 500,
				code: 1,
				signal: null,
				stderr: "Error creating the Kvm object: Error(13)",
			},
		},
		cleanup: {
			verified: true,
			inventory: [],
			remaining: [],
			children: [
				{ pid: 42, closed: true },
				{ pid: 43, closed: true },
			],
		},
	};
}

it("admits the complete diagnostic result and preserves the original error and full evidence", () => {
	const fixture = resultFixture();
	const parsed = parseDiagnosticResult(fixture, expectedBuild);
	expect(parsed.result).toBe(fixture);
	expect(parsed.startup).toBe("failed");
	expect(parsed.evidenceComplete).toBe(true);
	expect(parsed.result.originalFailure).toBe(fixture.originalFailure);
});

it("requires exact build identities and every cleanup fact before admitting another arm", () => {
	const fixture = resultFixture();
	for (const value of [
		null,
		{},
		{ ...fixture, sourceCommit: "c".repeat(40) },
		{ ...fixture, runtimeManifestSha256: "d".repeat(64) },
		{ ...fixture, cleanup: undefined },
		{ ...fixture, cleanup: { ...fixture.cleanup, verified: false } },
		{ ...fixture, cleanup: { ...fixture.cleanup, inventory: [{}] } },
		{ ...fixture, cleanup: { ...fixture.cleanup, remaining: ["42 msb"] } },
		{
			...fixture,
			cleanup: {
				...fixture.cleanup,
				children: [
					{ pid: 42, closed: true },
					{ pid: 43, closed: false },
				],
			},
		},
		{ ...fixture, cleanup: { ...fixture.cleanup, children: [{ pid: 42 }] } },
		{ ...fixture, hostAfter: undefined },
	])
		expect(() => parseDiagnosticResult(value, expectedBuild)).toThrow();
});

it("classifies limited startup from evidence even though both diagnostic processes exit one", () => {
	const failure = resultFixture();
	const success = { ...resultFixture(), originalFailure: null, probe: { state: "not-triggered" } };
	expect(
		[failure, success]
			.map((result) => ({ exit: 1, ...parseDiagnosticResult(result, expectedBuild) }))
			.map(({ startup, exit }) => ({ startup, exit })),
	).toEqual([
		{ startup: "failed", exit: 1 },
		{ startup: "started", exit: 1 },
	]);
	expect(parseDiagnosticResult({ ...failure, originalFailure: null }, expectedBuild).startup).toBe("unknown");
});

it("marks unavailable, truncated, or failed probe evidence inconclusive without losing the startup error", () => {
	const fixture = resultFixture();
	for (const partial of [
		{
			...fixture,
			hostBefore: { ...hostFixture(), kvm: { ...hostFixture().kvm, acl: { state: "truncated", text: "partial" } } },
		},
		{
			...fixture,
			hostAfter: {
				...hostFixture(),
				kvm: { ...hostFixture().kvm, identity: { state: "unavailable", error: "denied" } },
			},
		},
		{ ...fixture, probe: { state: "refused-or-failed", error: "inspect failed" } },
		{
			...fixture,
			probe: {
				...fixture.probe,
				capture: { ...fixture.probe.capture, reason: "output-limit", bytesObserved: 1048577, bytesRetained: 1048576 },
			},
		},
	]) {
		const parsed = parseDiagnosticResult(partial, expectedBuild);
		expect(parsed.evidenceComplete).toBe(false);
		expect(parsed.result.originalFailure).toBe(fixture.originalFailure);
	}
});

it("requires the same ordinary runner IDs, supplementary KVM group, and no effective capability grant", () => {
	const parsed = parseDiagnosticIdentity(status);
	expect(parsed).toEqual(identity);
	for (const retained of [
		{ ...parsed, savedUid: 0 },
		{ ...parsed, fsuid: 0 },
		{ ...parsed, savedGid: 0 },
		{ ...parsed, fsgid: 0 },
	])
		expect(() => assertDiagnosticIdentity(retained, retained)).toThrow();
	const groupIdentity = { ...parsed, groups: [...parsed.groups, 108] };
	expect(() => assertDiagnosticIdentity(groupIdentity, parsed, 108)).not.toThrow();
	for (const changed of [
		{ ...groupIdentity, uid: 0, euid: 0 },
		{ ...groupIdentity, euid: 1002 },
		{ ...groupIdentity, gid: 108, egid: 108 },
		{ ...groupIdentity, groups: [118] },
		...(["effective", "permitted", "inherited", "ambient"] as const).map((key) => ({
			...groupIdentity,
			capabilities: { ...groupIdentity.capabilities, [key]: "0000000000000001" },
		})),
	])
		expect(() => assertDiagnosticIdentity(changed, parsed, 108)).toThrow();
	for (const malformed of [
		"",
		status.replace("CapAmb:", "Missing:"),
		status.replace("1001\t1001\t1001\t1001", "1001\t1001"),
		`${status}Uid:\t0\t0\t0\t0\n`,
	])
		expect(() => parseDiagnosticIdentity(malformed)).toThrow();
});

it("admits only the root-owned canonical KVM character device with effective group read/write and no world access", () => {
	const kvm = hostFixture().kvm;
	expect(assertKvmGroup(kvm, "kvm:x:108:runner\n")).toBe(108);
	for (const changed of [
		{ ...kvm, device: { ...kvm.device, kind: "symlink" } },
		{ ...kvm, device: { ...kvm.device, uid: 1001 } },
		{ ...kvm, device: { ...kvm.device, gid: 0 } },
		{ ...kvm, device: { ...kvm.device, mode: 0o20666 } },
		{ ...kvm, acl: { state: "read", text: kvm.acl.text.replace("group::rw-", "group::r--") } },
		{ ...kvm, acl: { state: "read", text: kvm.acl.text.replace("mask::rw-", "mask::r--") } },
	])
		expect(() => assertKvmGroup(changed, "kvm:x:108:runner\n")).toThrow();
	for (const group of ["root:x:0:", "kvm:x:0:", "other:x:108:", "kvm:x:109:", "kvm:x:108:\nkvm:x:109:"])
		expect(() => assertKvmGroup(kvm, group)).toThrow();
});

it("records inaccessible device and status observations without opening the host device", async () => {
	const root = await home();
	const result = await kvmDiagnostics({ proc: join(root, "proc"), dev: join(root, "dev") });
	expect(result.identity.state).toBe("unavailable");
	expect(result.device.state).toBe("unavailable");
	expect(result.open.state).toBe("unavailable");
});

it("refuses regular and symlink device fixtures before attempting a read/write open", async () => {
	const root = await home();
	await mkdir(join(root, "proc/self"), { recursive: true });
	await mkdir(join(root, "dev"));
	await writeFile(join(root, "proc/self/status"), status);
	const device = join(root, "dev/kvm");
	await writeFile(device, "unchanged");
	const regular = await kvmDiagnostics({ proc: join(root, "proc"), dev: join(root, "dev") });
	expect(regular).toMatchObject({
		identity: { state: "read", value: identity },
		device: { kind: "other" },
		open: { state: "unavailable" },
	});
	expect(await readFile(device, "utf8")).toBe("unchanged");
	await rm(device);
	await symlink("/dev/kvm", device);
	const linked = await kvmDiagnostics({ proc: join(root, "proc"), dev: join(root, "dev") });
	expect(linked).toMatchObject({ device: { kind: "symlink" }, open: { state: "unavailable" } });
});

it("keeps unavailable ACL diagnostics bounded", () => {
	const result = diagnosticAcl("/a/device/which/does/not/exist");
	expect(result.state).toBe("unavailable");
	expect(JSON.stringify(result).length).toBeLessThan(64 << 10);
});

it("bounds numeric ACL output and reports command failures as unavailable telemetry", () => {
	const command = vi.spyOn(childProcess, "execFileSync");
	syncBuiltinESMExports();
	try {
		command.mockReturnValue(Buffer.from("a".repeat(70_000)));
		const large = diagnosticAcl("/fixture/dev/kvm");
		expect(large.state).toBe("truncated");
		if (large.state === "unavailable") throw new Error(large.error);
		expect(Buffer.byteLength(large.text)).toBe(64 << 10);
		expect(command).toHaveBeenCalledWith(
			"/usr/bin/getfacl",
			["--numeric", "--absolute-names", "--", "/fixture/dev/kvm"],
			expect.objectContaining({ timeout: 5000, killSignal: "SIGKILL", maxBuffer: 64 << 10 }),
		);
		command.mockImplementation(() => {
			throw new Error("failure".repeat(10_000));
		});
		const failed = diagnosticAcl("/fixture/dev/kvm");
		expect(failed.state).toBe("unavailable");
		expect(JSON.stringify(failed).length).toBeLessThan(5000);
	} finally {
		command.mockRestore();
		syncBuiltinESMExports();
	}
});
