import { expect, it } from "vitest";
import { parseLinuxLifetimeResult } from "../scripts/diagnose-linux-desktop-lifetime.ts";

type Result = ReturnType<typeof parseLinuxLifetimeResult>;
type Case = Result["cases"][number];
const status = `Uid:\t1001\t1001\t1001\t1001
Gid:\t1001\t1001\t1001\t1001
Groups:\t4 27 1001
CapInh:\t0000000000000000
CapPrm:\t0000000000000000
CapEff:\t0000000000000000
CapBnd:\t000001ffffffffff
CapAmb:\t0000000000000000
NoNewPrivs:\t0
`;
const completion = { status: 0, signal: null, error: null, stdout: "", stderr: "" };
const commandFields = ["ExecStartPre", "ExecStartPost", "ExecStop", "ExecStopPost"] as const;
const commandArrays = () =>
	Object.fromEntries(commandFields.map((field) => [field, { ...completion, stdout: "a(sasbttttuii) 0\n" }]));
function fixture(): Result {
	const cases = (["exit-0", "exit-23", "observation-failure"] as const).map((name, index): Case => {
		const unit = `banda-lifetime-${"a".repeat(24)}-${name}.service`;
		const main = {
			pid: 2000 + index * 10,
			startTicks: "1000",
			state: "S",
			group: 2000 + index * 10,
			session: 2000 + index * 10,
			status,
			cgroup: `0::/system.slice/${unit}\n`,
		};
		const descendant = { ...main, pid: main.pid + 2, startTicks: "1001", group: main.pid + 2, session: main.pid + 2 };
		const properties = {
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
			SuccessExitStatus: "",
			RestartForceExitStatus: "",
			RestartPreventExitStatus: "",
			PAMName: "",
			SupplementaryGroups: "",
			AmbientCapabilities: "",
			ExecStartPre: "",
			ExecStartPost: "",
			ExecStop: "",
			ExecStopPost: "",
			OnFailure: "",
			OnSuccess: "",
			FailureAction: "none",
			SuccessAction: "none",
			NRestarts: "0",
			DropInPaths: "",
			User: "1001",
			Group: "1001",
			Id: unit,
			LoadState: "loaded",
			ActiveState: "active",
			SubState: "running",
			Result: "success",
			InvocationID: String(index + 1).repeat(32),
			ControlGroup: `/system.slice/${unit}`,
			ExecMainPID: String(main.pid),
			ExecMainCode: "0",
			ExecMainStatus: "0",
			ExecMainExitTimestampMonotonic: "0",
			Job: "",
		};
		const ready = {
			main,
			descendant,
			environment: {
				ownerHomeAbsent: true,
				githubTokenAbsent: true,
				sshAgentAbsent: true,
				desktopSessionAbsent: true,
				pythonPathAbsent: true,
			} as const,
			unit: { atNs: "100", properties, commandArrays: commandArrays() },
			observedAtNs: "200",
		};
		const originalExit = {
			atNs: "300",
			commandArrays: commandArrays(),
			properties: {
				...properties,
				ExecMainCode: "1",
				ExecMainStatus: name === "exit-23" ? "23" : "0",
				ExecMainExitTimestampMonotonic: "250",
			},
		};
		const stopped = {
			atNs: "600",
			commandArrays: commandArrays(),
			properties: {
				...originalExit.properties,
				ActiveState: "inactive",
				SubState: "dead",
				ExecMainCode: index === 2 ? "2" : "1",
				ExecMainStatus: index === 2 ? "15" : originalExit.properties.ExecMainStatus,
			},
		};
		return {
			name,
			unit,
			startup: { ...completion },
			ready,
			beforeRescue:
				index === 2
					? {
							kind: "failed",
							error: "Injected observer failure after readiness and before release.",
							injected: true,
							lastUnit: ready.unit,
						}
					: {
							kind: "observed",
							atNs: "400",
							unit: originalExit,
							descendant: { ...descendant },
							mainAbsent: true,
							populated: 1,
							members: [{ pid: descendant.pid, startTicks: descendant.startTicks }],
						},
			cleanup: {
				rescueAtNs: "500",
				stop: { ...completion },
				kill: null,
				empty: { atNs: "700", unit: stopped, cgroup: "absent", populated: null, members: [] },
				afterRescueMain: stopped,
				errors: [],
			},
		};
	});
	return {
		qualification: false,
		desktopQualified: false,
		publicDelivery: false,
		state: "inert-passed",
		sourceCommit: "c481e4aba81d48ae179fffc8d288d743dab667d0",
		initial: {
			observer: {
				pid: 1234,
				startTicks: "900",
				state: "R",
				group: 1234,
				session: 1234,
				status,
				cgroup: "0::/user.slice/runner.scope\n",
			},
			account: { name: "runner", home: "/home/runner" },
		},
		metadata: {
			systemdVersion: "systemd 255",
			cgroupMount: "31 22 0:27 / /sys/fs/cgroup rw - cgroup2 cgroup rw",
			paths: [],
		},
		cases,
		errors: [],
	};
}
function normal(result: Result, index = 0) {
	const value = result.cases[index]?.beforeRescue;
	if (value?.kind !== "observed") throw new Error("Expected fixture's original completion.");
	return value;
}

it("accepts both original main exits and the separate observer injection with cleanup", () => {
	const value = fixture();
	expect(parseLinuxLifetimeResult(value)).toBe(value);
	expect(normal(value, 1).unit.properties.ExecMainStatus).toBe("23");
	expect(value.cases[2]?.cleanup.afterRescueMain?.properties.ExecMainStatus).toBe("15");
	expect(value.qualification || value.desktopQualified || value.publicDelivery).toBe(false);
});

it("does not use volatile scheduler state as process birth identity", () => {
	const value = fixture();
	normal(value).descendant.state = "R";
	expect(parseLinuxLifetimeResult(value)).toBe(value);
});

it.each([
	"missing observation",
	"missing descendant",
	"changed birth",
	"dead descendant",
	"proof after rescue",
	"empty before rescue",
])("rejects pre-rescue evidence with %s", (fault) => {
	const value = fixture();
	const proof = normal(value);
	if (fault === "missing observation")
		value.cases[0]!.beforeRescue = { kind: "failed", error: "Observation lost", injected: false, lastUnit: null };
	if (fault === "missing descendant") proof.members = [];
	if (fault === "changed birth") proof.descendant.startTicks = "9999";
	if (fault === "dead descendant") proof.descendant.state = "Z";
	if (fault === "proof after rescue") proof.atNs = "501";
	if (fault === "empty before rescue") Object.assign(proof, { populated: 0 });
	expect(() => parseLinuxLifetimeResult(value)).toThrow();
});

it.each(["wrong status", "signal completion", "missing exit timestamp", "wrong main", "other invocation"])(
	"rejects raw original completion with %s",
	(fault) => {
		const value = fixture();
		const properties = normal(value, 1).unit.properties;
		if (fault === "wrong status") properties.ExecMainStatus = "0";
		if (fault === "signal completion") properties.ExecMainCode = "2";
		if (fault === "missing exit timestamp") properties.ExecMainExitTimestampMonotonic = "0";
		if (fault === "wrong main") properties.ExecMainPID = "9999";
		if (fault === "other invocation") properties.InvocationID = "f".repeat(32);
		expect(() => parseLinuxLifetimeResult(value)).toThrow();
	},
);

it.each(["unverified", "pending stop", "failed stop", "populated", "missing captured path"])(
	"rejects cleanup with %s",
	(fault) => {
		const value = fixture();
		const item = value.cases[0]!;
		if (fault === "unverified") item.cleanup.empty = null;
		if (fault === "pending stop") item.cleanup.empty!.unit.properties.Job = "42";
		if (fault === "failed stop") item.cleanup.stop = { ...completion, status: 1, error: "Stop denied" };
		if (fault === "populated") Object.assign(item.cleanup.empty!, { populated: 1 });
		if (fault === "missing captured path") {
			item.ready = null;
			item.beforeRescue = { kind: "failed", error: "Capture failed", injected: false, lastUnit: null };
		}
		expect(() => parseLinuxLifetimeResult(value)).toThrow();
	},
);

it("refuses to excuse a failed normal case with the expected observer-injection label", () => {
	const value = fixture();
	value.cases[0]!.beforeRescue = {
		kind: "failed",
		error: "Injected observer failure after readiness and before release.",
		injected: true,
		lastUnit: value.cases[0]!.ready!.unit,
	};
	expect(() => parseLinuxLifetimeResult(value)).toThrow(/Normal failure/);
});

it.each(["uid", "groups", "bounding", "effective", "membership"])("rejects changed actual process %s", (fault) => {
	const value = fixture();
	const process = normal(value).descendant;
	if (fault === "uid") process.status = status.replace("1001\t1001\t1001\t1001", "0\t0\t0\t0");
	if (fault === "groups") process.status = status.replace("4 27 1001", "4 27 108 1001");
	if (fault === "bounding") process.status = status.replace("000001ffffffffff", "0000000000000000");
	if (fault === "effective") process.status = status.replace("CapEff:\t0000000000000000", "CapEff:\t0000000000000001");
	if (fault === "membership") process.cgroup = "0::/user.slice/runner.scope\n";
	expect(() => parseLinuxLifetimeResult(value)).toThrow();
});

it("retains a failed record without turning cleanup into original completion", () => {
	const value = fixture();
	value.state = "failed";
	value.cases = [value.cases[0]!];
	value.cases[0]!.beforeRescue = {
		kind: "failed",
		error: "Observer failed",
		injected: false,
		lastUnit: value.cases[0]!.ready!.unit,
	};
	value.errors = ["Missing pre-rescue live proof."];
	expect(parseLinuxLifetimeResult(value)).toBe(value);
});

it("rejects cleanup snapshots substituted for the original completion", () => {
	const value = fixture();
	normal(value).unit = value.cases[0]!.cleanup.afterRescueMain!;
	expect(() => parseLinuxLifetimeResult(value)).toThrow();
});

it("rejects a missing unit when no exact owned cgroup was captured", () => {
	const value = fixture();
	value.state = "failed";
	const item = value.cases[0]!;
	item.ready = null;
	item.beforeRescue = {
		kind: "failed",
		error: "Capture failed",
		injected: false,
		lastUnit: { atNs: "100", properties: { Id: item.unit }, commandArrays: {} },
	};
	item.cleanup.empty!.unit.properties.LoadState = "not-found";
	expect(() => parseLinuxLifetimeResult(value)).toThrow();
});

it.each(["Type", "ExitType", "KillMode", "Delegate", "RuntimeMaxUSec", "SuccessExitStatus"])(
	"refuses an effective %s outside the fixed lifetime experiment",
	(property) => {
		const value = fixture();
		normal(value).unit.properties[property] = "unexpected";
		expect(() => parseLinuxLifetimeResult(value)).toThrow();
	},
);

it.each(commandFields)("requires successful typed empty-array evidence for %s", (field) => {
	for (const receipt of [
		undefined,
		{ ...completion, stdout: "" },
		{ ...completion, stdout: "as 0\n" },
		{ ...completion, stdout: "a(sasbttttuii)" },
		{ ...completion, stdout: "a(sasbttttuii) 00\n" },
		{ ...completion, stdout: "a(sasbttttuii) 0 unexpected\n" },
		{ ...completion, stdout: 'a(sasbttttuii) 1 "/usr/bin/true" 1 "/usr/bin/true" false 0 0 0 0 0 0 0\n' },
		{ ...completion, status: 1, stdout: "a(sasbttttuii) 0\n" },
		{ ...completion, signal: "SIGKILL", stdout: "a(sasbttttuii) 0\n" },
		{ ...completion, error: "Query failed", stdout: "a(sasbttttuii) 0\n" },
	]) {
		const value = fixture();
		const unit = normal(value).unit;
		if (receipt) unit.commandArrays[field] = receipt;
		else delete unit.commandArrays[field];
		expect(unit.properties[field]).toBe("");
		expect(() => parseLinuxLifetimeResult(value)).toThrow();
	}
});

it("rejects omitted command properties captured by systemctl show without typed readback", () => {
	const value = fixture();
	const unit = normal(value).unit;
	for (const field of commandFields) delete unit.properties[field];
	unit.commandArrays = {};
	expect(() => parseLinuxLifetimeResult(value)).toThrow();
});

it.each(["readiness", "cleanup", "failed observation"])("requires typed command evidence in %s", (snapshot) => {
	const value = fixture();
	const item = value.cases[0]!;
	const unit = snapshot === "cleanup" ? item.cleanup.empty!.unit : item.ready!.unit;
	unit.commandArrays = {};
	if (snapshot === "failed observation") {
		value.state = "failed";
		item.ready = null;
		item.beforeRescue = { kind: "failed", error: "Query failed", injected: false, lastUnit: unit };
	}
	expect(() => parseLinuxLifetimeResult(value)).toThrow();
});

it("does not require command readback for a removed unit after cleanup", () => {
	const value = fixture();
	const unit = value.cases[0]!.cleanup.empty!.unit;
	unit.properties.LoadState = "not-found";
	unit.commandArrays = {};
	for (const field of commandFields) delete unit.properties[field];
	expect(parseLinuxLifetimeResult(value)).toBe(value);
});
