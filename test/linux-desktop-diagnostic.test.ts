import { expect, it } from "vitest";
import { parseLinuxDesktopResult } from "../scripts/diagnose-linux-desktop.ts";

type Result = ReturnType<typeof parseLinuxDesktopResult>;
const status = `State:\tS (sleeping)
Uid:\t1001\t1001\t1001\t1001
Gid:\t1001\t1001\t1001\t1001
Groups:\t4 1001
CapInh:\t0000000000000000
CapPrm:\t0000000000000000
CapEff:\t0000000000000000
CapBnd:\t000001ffffffffff
CapAmb:\t0000000000000000
NoNewPrivs:\t0
Seccomp:\t0
`;
const completion = { status: 0, signal: null, error: null, stdout: "", stderr: "" };
function fixture(): Result {
	const name = `banda-shell-${"a".repeat(24)}.service`;
	const unit = {
		Type: "exec",
		ExitType: "cgroup",
		RemainAfterExit: "yes",
		Restart: "no",
		KillMode: "control-group",
		TimeoutStopUSec: "5s",
		SendSIGKILL: "yes",
		Delegate: "no",
		WorkingDirectory: "/",
		RuntimeMaxUSec: "infinity",
		WatchdogUSec: "0",
		StopWhenUnneeded: "no",
		PAMName: "",
		AmbientCapabilities: "",
		DropInPaths: "",
		NRestarts: "0",
		OnFailure: "",
		OnSuccess: "",
		FailureAction: "none",
		SuccessAction: "none",
		SuccessExitStatus: "",
		RestartForceExitStatus: "",
		RestartPreventExitStatus: "",
		User: "1001",
		Group: "1001",
		SupplementaryGroups: "108",
		Id: name,
		LoadState: "loaded",
		ActiveState: "active",
		SubState: "running",
		Result: "success",
		Job: "",
		ControlGroup: `/system.slice/${name}`,
		InvocationID: "b".repeat(32),
		ExecMainPID: "2000",
		ExecMainCode: "0",
		ExecMainStatus: "0",
		ExecMainExitTimestampMonotonic: "0",
		...Object.fromEntries(
			["ExecStartPre", "ExecStartPost", "ExecStop", "ExecStopPost"].map((field) => [field, "a(sasbttttuii) 0"]),
		),
	};
	const process = (pid: number, executable: string) => ({
		pid,
		executable,
		command: executable,
		startTicks: String(pid + 100),
		status: status.replace("4 1001", "4 108 1001"),
		cgroup: `0::${unit.ControlGroup}\n`,
		userns: "user:[100]",
		pidns: "pid:[200]",
		uidMap: "0 0 4294967295\n",
		gidMap: "0 0 4294967295\n",
	});
	const shell = process(2000, "/opt/banda/banda-desktop");
	return {
		qualification: false,
		desktopQualified: false,
		publicDelivery: false,
		state: "shell-observed",
		unit: name,
		kvmGid: 108,
		identity: {
			sourceCommit: "c".repeat(40),
			verifierSha256: "b".repeat(64),
			version: "0.1.0-alpha.13",
			debSha256: "d".repeat(64),
			asarSha256: "e".repeat(64),
			executableSha256: "f".repeat(64),
			runtimeManifestSha256: "a".repeat(64),
		},
		original: { ...process(1000, "/usr/bin/node"), status, cgroup: "0::/observer.service\n" },
		started: {
			shell,
			daemon: process(2001, "/opt/banda/resources/banda/node/node"),
			unit,
			daemonPort: 10000,
			home: "/tmp/installed-shell/home/.banda",
			computer: {
				atNs: "100",
				value: { state: "building", box: "microvm", network: "guarded", browser: { state: "idle" } },
			},
			inventoryList: { kind: "absent" },
			inventory: [],
			renderers: [
				{
					...process(2002, shell.executable),
					command: "--type=renderer\0",
					userns: "user:[101]",
					pidns: "pid:[201]",
					status: status
						.replace("NoNewPrivs:\t0", "NoNewPrivs:\t1")
						.replace("Seccomp:\t0", "Seccomp:\t2")
						.replace("000001ffffffffff", "0000000000000000")
						.replace("Groups:\t4 1001", "Groups:\t"),
				},
			],
			pages: [1440, 390].map((width) => ({
				width,
				height: 900,
				origin: "http://127.0.0.1:10000",
				heading: "Sancho",
				firstRun: true,
				requireType: "undefined",
				processType: "undefined",
				bridgeType: "function",
				bridgeFrozen: true,
				screenshotSha256: "e".repeat(64),
			})),
		},
		beforeRescue: {
			kind: "observed",
			atNs: "300",
			unit: { ...unit, SubState: "exited", ExecMainCode: "1", ExecMainExitTimestampMonotonic: "250" },
			populated: 0,
			cgroup: "empty",
			members: [],
			inventory: [],
			mainAbsent: true,
			daemonAbsent: true,
			vmBirthsAbsent: true,
			listenerClosed: true,
			action: "native-ctrl-q",
			input: completion,
		},
		cleanup: {
			atNs: "400",
			stop: completion,
			empty: true,
			fixtures: [{ ...completion, status: null, signal: "SIGTERM" }, completion],
			errors: [],
		},
	};
}

it("accepts an installed shell observation with renderer privilege reductions and leaves qualification false", () => {
	const result = parseLinuxDesktopResult(fixture());
	expect(result.state).toBe("shell-observed");
	expect([result.qualification, result.desktopQualified, result.publicDelivery]).toEqual([false, false, false]);
});

it.each([
	[
		"missing original completion",
		(value: Result) => ({ ...value, beforeRescue: { kind: "failed", error: "observer lost", lastUnit: null } }),
	],
	["completion after manager rescue", (value: Result) => ({ ...value, cleanup: { ...value.cleanup, atNs: "200" } })],
	[
		"nonempty cgroup",
		(value: Result) => ({ ...value, beforeRescue: { ...value.beforeRescue, populated: 1, members: [2001] } }),
	],
	[
		"remaining VM",
		(value: Result) => ({ ...value, beforeRescue: { ...value.beforeRescue, inventory: [{ name: "owned-vm" }] } }),
	],
	[
		"failed exact-unit stop",
		(value: Result) => ({ ...value, cleanup: { ...value.cleanup, stop: { ...completion, status: 1 } } }),
	],
	[
		"cleanup failure",
		(value: Result) => ({ ...value, cleanup: { ...value.cleanup, errors: ["fixture still alive"] } }),
	],
	["claimed desktop qualification", (value: Result) => ({ ...value, desktopQualified: true })],
] satisfies [string, (value: Result) => unknown][])("rejects %s", (_name, change) => {
	expect(() => parseLinuxDesktopResult(change(fixture()))).toThrow();
});

it.each([
	["signalled shell", "ExecMainCode", "2"],
	["nonzero shell", "ExecMainStatus", "23"],
	["replacement service", "InvocationID", "f".repeat(32)],
	["missing typed command array", "ExecStop", ""],
])("rejects %s", (_name, field, replacement) => {
	const result = fixture();
	if (result.beforeRescue.kind !== "observed") throw new Error("Bad test fixture.");
	result.beforeRescue.unit[field] = replacement;
	expect(() => parseLinuxDesktopResult(result)).toThrow();
});

it.each(["capability", "group", "namespace", "seccomp", "node"])(
	"rejects a renderer with weak %s confinement",
	(change) => {
		const result = fixture();
		const renderer = result.started?.renderers[0];
		if (!renderer || !result.started) throw new Error("Bad test fixture.");
		if (change === "capability")
			renderer.status = renderer.status.replace("CapEff:\t0000000000000000", "CapEff:\t0000000000000001");
		if (change === "group") renderer.status = renderer.status.replace("Groups:\t", "Groups:\t0");
		if (change === "namespace") renderer.userns = result.started.shell.userns;
		if (change === "seccomp") renderer.status = renderer.status.replace("Seccomp:\t2", "Seccomp:\t0");
		if (change === "node") result.started.pages[0]!.processType = "object";
		expect(() => parseLinuxDesktopResult(result)).toThrow();
	},
);

it("retains failure evidence without upgrading manager rescue to natural Quit", () => {
	const value = fixture();
	const result = parseLinuxDesktopResult({
		...value,
		state: "failed",
		beforeRescue: { kind: "failed", error: "Quit did not finish", lastUnit: value.started?.unit },
		cleanup: { ...value.cleanup, empty: true },
	});
	expect(result.state).toBe("failed");
	expect(result.beforeRescue.kind).toBe("failed");
});

it("accepts an exact owned cgroup pruned by systemd after natural completion", () => {
	const result = fixture();
	if (result.beforeRescue.kind !== "observed") throw new Error("Bad test fixture.");
	result.beforeRescue.cgroup = "absent";
	result.beforeRescue.populated = null;
	result.beforeRescue.unit.ControlGroup = "";
	expect(parseLinuxDesktopResult(result).state).toBe("shell-observed");
	result.beforeRescue.unit.ControlGroup = "/unrelated.service";
	expect(() => parseLinuxDesktopResult(result)).toThrow();
});

it("retains missing-renderer evidence only as a failure", () => {
	const result = fixture();
	if (!result.started) throw new Error("Bad test fixture.");
	result.started.renderers = [];
	expect(() => parseLinuxDesktopResult(result)).toThrow();
	result.state = "failed";
	expect(parseLinuxDesktopResult(result).started?.renderers).toEqual([]);
});

function warmingFixture(): Result {
	const value = fixture();
	if (!value.started) throw new Error("Bad test fixture.");
	const home = "/tmp/installed-shell/home/.banda";
	const name = "banda-microvm-688508f338-aaaaaaaaaaaa-proxy";
	const listed = { name, status: "Running" as const };
	const inspected = {
		...listed,
		config: { labels: { "banda.home": home, "banda.runtime": "microvm" as const, "banda.generation": "aaaaaaaaaaaa" } },
	};
	return {
		...value,
		started: {
			...value.started,
			home,
			computer: {
				atNs: "100",
				value: { state: "starting", box: "microvm", network: "guarded", browser: { state: "idle" } },
			},
			inventoryList: { kind: "listed", completion: { ...completion, stdout: JSON.stringify([listed]) } },
			inventory: [
				{
					listed,
					inspected,
					inspection: { ...completion, stdout: JSON.stringify(inspected) },
					process: {
						...value.started.daemon,
						pid: 2003,
						startTicks: "2103",
						executable: "/opt/banda/resources/banda/app/computer/msb",
						command: `/opt/banda/resources/banda/app/computer/msb\0machine\0--name\0${name}\0`,
					},
				},
			],
		},
		beforeRescue: value.beforeRescue,
	};
}

it("accepts an owned proxy while the computer is warming without qualifying native execution", () => {
	const result = parseLinuxDesktopResult(warmingFixture());
	expect(result.state).toBe("shell-observed");
	expect(result.qualification).toBe(false);
});

it.each(["starting", "building", "up", "offline"] as const)(
	"records %s independently of an empty or owned inventory",
	(state) => {
		for (const result of [fixture(), warmingFixture()]) {
			if (!result.started) throw new Error("Bad test fixture.");
			result.started.computer.value.state = state;
			if (state === "offline") result.started.computer.value.why = "Guard startup failed.";
			const parsed = parseLinuxDesktopResult(result);
			expect(parsed.started?.computer.value.state).toBe(state);
			expect([parsed.qualification, parsed.desktopQualified, parsed.publicDelivery]).toEqual([false, false, false]);
		}
	},
);

it.each([
	"wrong-home",
	"wrong-generation",
	"escaped",
	"missing-birth",
	"old-birth",
	"wrong-command",
	"failed-inspect",
	"malformed-inspect",
	"unlisted",
])("rejects %s startup VM evidence", (change) => {
	const result = warmingFixture();
	const started = result.started;
	const vm = started?.inventory[0];
	if (!started || !vm?.process || started.inventoryList.kind !== "listed") throw new Error("Bad test fixture.");
	if (change === "wrong-home") vm.inspected.config.labels["banda.home"] = "/tmp/another/home/.banda";
	if (change === "wrong-generation") vm.inspected.config.labels["banda.generation"] = "bbbbbbbbbbbb";
	if (change === "escaped") vm.process.cgroup = "0::/escaped.service\n";
	if (change === "old-birth") vm.process.startTicks = "1";
	if (change === "wrong-command") vm.process.command = "/opt/banda/resources/banda/app/computer/msb\0list\0";
	if (change === "missing-birth") vm.process = null;
	vm.inspection.stdout = JSON.stringify(vm.inspected);
	if (change === "failed-inspect") vm.inspection.status = 1;
	if (change === "malformed-inspect") vm.inspection.stdout = "{}";
	if (change === "unlisted") started.inventoryList.completion.stdout = "[]";
	expect(() => parseLinuxDesktopResult(result)).toThrow();
});

it("accepts a starting VM before its process is spawned", () => {
	const result = warmingFixture();
	const started = result.started;
	const vm = started?.inventory[0];
	if (!started || !vm || started.inventoryList.kind !== "listed") throw new Error("Bad test fixture.");
	vm.listed.status = "Starting";
	vm.inspected.status = "Starting";
	vm.process = null;
	vm.inspection.stdout = JSON.stringify(vm.inspected);
	started.inventoryList.completion.stdout = JSON.stringify([vm.listed]);
	expect(parseLinuxDesktopResult(result).state).toBe("shell-observed");
});

it("requires pre-rescue VM birth absence even when the final inventory is empty", () => {
	const result = warmingFixture();
	expect(() =>
		parseLinuxDesktopResult({ ...result, beforeRescue: { ...result.beforeRescue, vmBirthsAbsent: false } }),
	).toThrow();
});

it("bounds the startup inventory and retained command output", () => {
	const result = warmingFixture();
	if (!result.started) throw new Error("Bad test fixture.");
	const started = result.started;
	expect(() =>
		parseLinuxDesktopResult({ ...result, started: { ...started, inventory: Array(4).fill(started.inventory[0]) } }),
	).toThrow();
	expect(() =>
		parseLinuxDesktopResult({
			...result,
			started: {
				...started,
				inventoryList: { kind: "listed", completion: { ...completion, stdout: " ".repeat((1 << 20) + 1) } },
			},
		}),
	).toThrow();
});

it("accepts a present runtime cache with no VMs yet", () => {
	const result = fixture();
	if (!result.started) throw new Error("Bad test fixture.");
	result.started.inventoryList = { kind: "listed", completion: { ...completion, stdout: "[]" } };
	expect(parseLinuxDesktopResult(result).state).toBe("shell-observed");
});
