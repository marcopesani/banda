/**
 * Release acceptance (.github/workflows/release-acceptance.yml): what a published release does on a machine that never
 * saw a checkout's dependencies. Node.js alone runs this file: it imports nothing that `npm ci` would bring.
 *
 *   assets --tag <v…> --asset <linux|mac> --downloads <dir> --out <dir>
 *       `gh release download` of that asset and the release's SHA256SUMS, then the asset's own SHA-256 against the
 *       line that names it, and against the digest GitHub keeps for the upload. Writes <out>/assets.json. This proves
 *       the bytes are the ones the release lists, not who made the release: the sums come from the same place.
 *   linux-install --package <deb> --out <dir>
 *       on a CI runner: `apt-get install` the package as an owner would, over an earlier one when there is one.
 *       Writes <out>/install.json and install.log.
 *   mac-install --dmg <dmg> --out <dir> [--applications <dir>]
 *       mark the image as a browser's download, open it, copy banda.app into Applications over an earlier one, record
 *       what Gatekeeper and codesign say, then clear the quarantine as the owner's "Open Anyway" does. Writes
 *       <out>/install.json. See `macInstall` for what this does not prove.
 *   summary --tag <v…> --previous <v…> --evidence <dir> --out <dir> [--expect <artifact> ...]
 *       every job's evidence (one folder per uploaded artifact) as one acceptance.json and a summary.md table.
 *       Exits 1 when anything failed, or when an expected job left no evidence.
 *
 * The app itself is used by desktop/try/drive.mjs, run by the installed app's own Node.js.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)$/;

/** The version a tag names; a tag of any other shape is refused before it reaches a command. */
export function versionOf(tag: string): string {
	const version = TAG.exec(tag)?.[1];
	if (version === undefined) throw new Error(`${JSON.stringify(tag)} is not a release tag (v0.1.0, v0.1.0-alpha.15)`);
	return version;
}

/** The download of each kind, by the name release.yml publishes it under. */
export const ASSETS = {
	linux: (version: string) => `banda-${version}-linux-amd64.deb`,
	mac: (version: string) => `banda-${version}-mac-arm64.dmg`,
} as const;

/** SHA256SUMS as `sha256sum` writes it: a hash, two spaces (or a space and `*`), a name. Anything else is refused. */
export function parseSums(text: string): Map<string, string> {
	const sums = new Map<string, string>();
	for (const line of text.split("\n")) {
		if (line === "") continue;
		const read = /^([0-9a-f]{64}) [ *]([^/\\]+)$/.exec(line);
		if (read === null) throw new Error(`SHA256SUMS has a line that names no file: ${JSON.stringify(line)}`);
		const [, sha, name] = read as unknown as [string, string, string];
		if (sums.has(name)) throw new Error(`SHA256SUMS names ${name} twice`);
		sums.set(name, sha);
	}
	return sums;
}

const sha256 = (path: string) =>
	new Promise<string>((done, failed) => {
		const hash = createHash("sha256");
		createReadStream(path)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", failed)
			.on("end", () => done(hash.digest("hex")));
	});

const save = (folder: string, name: string, value: unknown) => {
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, name), `${JSON.stringify(value, null, "\t")}\n`);
};

/** A command's outcome and what it printed, never thrown: what it said is the evidence. */
function ran(command: string, args: readonly string[]) {
	const child = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 << 20 });
	return {
		command: [command, ...args].join(" "),
		status: child.status,
		output: `${child.stdout ?? ""}${child.stderr ?? ""}${child.error === undefined ? "" : String(child.error)}`.trim(),
	};
}

export type AssetsEvidence = {
	readonly tag: string;
	readonly repository: string;
	/** SHA256SUMS itself, so two jobs can be seen to have checked against the same list. */
	readonly sums: string;
	readonly assets: readonly {
		readonly name: string;
		readonly bytes: number;
		readonly sha256: string;
		/** The line in SHA256SUMS; undefined when the release does not list the file. */
		readonly listed: string | undefined;
		/** The digest GitHub keeps for the upload, where its API gives one. */
		readonly github: string | undefined;
	}[];
	readonly passed: boolean;
};

async function assets(tag: string, kind: keyof typeof ASSETS, downloads: string, out: string): Promise<boolean> {
	const repository = process.env.GH_REPO;
	if (repository === undefined) throw new Error("GH_REPO names the repository whose release is downloaded");
	const name = ASSETS[kind](versionOf(tag));
	mkdirSync(downloads, { recursive: true });
	execFileSync(
		"gh",
		[
			"release",
			"download",
			tag,
			"--repo",
			repository,
			"--dir",
			downloads,
			"--skip-existing",
			"--pattern",
			"SHA256SUMS",
			"--pattern",
			name,
		],
		{ stdio: "inherit" },
	);
	const listed = parseSums(readFileSync(join(downloads, "SHA256SUMS"), "utf8"));
	const kept = JSON.parse(
		execFileSync("gh", ["release", "view", tag, "--repo", repository, "--json", "assets"], { encoding: "utf8" }),
	) as { assets: { name: string; digest?: string | null }[] };
	const digest = kept.assets.find((each) => each.name === name)?.digest ?? undefined;
	const sha = await sha256(join(downloads, name));
	const github = digest?.startsWith("sha256:") ? digest.slice("sha256:".length) : undefined;
	const passed = listed.get(name) === sha && (github === undefined || github === sha);
	const evidence: AssetsEvidence = {
		tag,
		repository,
		sums: await sha256(join(downloads, "SHA256SUMS")),
		assets: [{ name, bytes: statSync(join(downloads, name)).size, sha256: sha, listed: listed.get(name), github }],
		passed,
	};
	save(out, "assets.json", evidence);
	console.log(`${passed ? "ok   " : "FAIL "} ${name} ${sha} (SHA256SUMS: ${listed.get(name) ?? "not listed"})`);
	return passed;
}

/**
 * The package on a CI runner, installed as the release notes say (`sudo apt install ./banda-*.deb`). An earlier
 * banda stays installed, so this is the upgrade too. Before it: the display and session bus the run needs (no part of
 * the package, so installed apart from it), and the runner's /opt, world-writable where an owner's is not, made as an
 * owner has it (scripts/diagnose-linux-desktop.ts does the same).
 */
function linuxInstall(deb: string, out: string): boolean {
	const log: ReturnType<typeof ran>[] = [];
	const step = (command: string, args: readonly string[]) => {
		const done = ran(command, args);
		log.push(done);
		return done;
	};
	const installedVersion = () => {
		const query = ran("dpkg-query", ["-W", `-f=${["$", "{Status}\n", "$", "{Version}"].join("")}`, "banda-desktop"]);
		const [status, version] = query.output.split("\n");
		return query.status === 0 && status === "install ok installed" ? version : undefined;
	};
	const before = installedVersion();
	const opt = statSync("/opt").mode & 0o7777;
	if (opt === 0o777) step("sudo", ["-n", "chmod", "0755", "/opt"]);
	step("sudo", ["-n", "apt-get", "update"]);
	const fixtures = step("sudo", [
		"-n",
		"env",
		"DEBIAN_FRONTEND=noninteractive",
		"apt-get",
		"install",
		"--yes",
		"--no-install-recommends",
		"xvfb",
		"dbus",
		"dbus-x11",
	]);
	const install = step("sudo", [
		"-n",
		"env",
		"DEBIAN_FRONTEND=noninteractive",
		"apt-get",
		"install",
		"--yes",
		"--no-install-recommends",
		resolve(deb),
	]);
	const expected = ran("dpkg-deb", ["-f", resolve(deb), "Version"]).output;
	const after = installedVersion();
	const passed =
		fixtures.status === 0 &&
		install.status === 0 &&
		after !== undefined &&
		after === expected &&
		existsSync("/opt/banda/banda-desktop");
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, "install.log"), log.map((each) => `$ ${each.command}\n${each.output}\n`).join("\n"));
	save(out, "install.json", {
		platform: "linux",
		os: /^PRETTY_NAME="?([^"\n]*)/m.exec(readFileSync("/etc/os-release", "utf8"))?.[1],
		package: deb.slice(deb.lastIndexOf("/") + 1),
		packageVersion: expected,
		installedBefore: before ?? null,
		installedAfter: after ?? null,
		optModeBefore: opt.toString(8),
		passed,
	});
	console.log(
		`${passed ? "ok   " : "FAIL "} apt installed banda-desktop ${after ?? "(nothing)"}${before === undefined ? "" : ` over ${before}`}`,
	);
	if (!passed) console.log(install.output.split("\n").slice(-40).join("\n"));
	return passed;
}

/**
 * The image on a Mac, installed as the release notes say: open the DMG, drag banda to Applications, Open Anyway.
 *
 * What is done: the DMG gets the quarantine a browser's download carries (`gh` sets none), is mounted read-only, and
 * banda.app is copied over whatever /Applications holds. Recorded as information: whether the copy carries the
 * quarantine, `spctl --assess` (the build is signed ad hoc and not notarized, so "rejected" is what it says, and
 * that is not a failure here), and the signature's own description. Required: `codesign --verify --deep --strict`,
 * the seal being whole, which is what separates Gatekeeper's "Open Anyway" from its "damaged, move to the Trash".
 * Then the quarantine is removed from the app, which is what a granted Open Anyway amounts to for every later launch.
 *
 * What this does not prove: that Gatekeeper's dialog appears and offers Open Anyway on a person's Mac, that System
 * Settings shows the button, or anything about notarization. No Gatekeeper prompt is seen or answered here, and the
 * app is then started by its executable, not through Finder.
 */
async function macInstall(dmg: string, out: string, applications: string): Promise<boolean> {
	const app = join(applications, "banda.app");
	const replaced = existsSync(app);
	const stamp = Math.floor(Date.now() / 1000).toString(16);
	const marked = ran("xattr", ["-w", "com.apple.quarantine", `0083;${stamp};Safari;`, dmg]);
	const mount = await mkdtemp(join(tmpdir(), "banda-dmg-"));
	const attached = ran("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmg]);
	let copied = { command: "ditto", status: null as number | null, output: "the image did not mount" };
	try {
		if (attached.status === 0) {
			// Finder's "Replace" leaves nothing of the earlier app behind
			if (replaced) await rm(app, { recursive: true, force: true });
			copied = ran("ditto", [join(mount, "banda.app"), app]);
		}
	} finally {
		if (attached.status === 0) ran("hdiutil", ["detach", mount]);
		await rm(mount, { recursive: true, force: true });
	}
	const quarantine = ran("xattr", ["-p", "com.apple.quarantine", app]);
	const gatekeeper = ran("spctl", ["--assess", "--type", "execute", "-vv", app]);
	const signature = ran("codesign", ["-dv", "--verbose=2", app]);
	const seal = ran("codesign", ["--verify", "--deep", "--strict", app]);
	const cleared = ran("xattr", ["-dr", "com.apple.quarantine", app]);
	const executable = join(app, "Contents", "MacOS", "banda");
	const passed = marked.status === 0 && copied.status === 0 && seal.status === 0 && existsSync(executable);
	save(out, "install.json", {
		platform: "mac",
		os: `macOS ${ran("sw_vers", ["-productVersion"]).output}`,
		package: dmg.slice(dmg.lastIndexOf("/") + 1),
		app,
		replacedAnEarlierApp: replaced,
		mounted: attached.status === 0,
		copied: copied.status === 0 ? true : copied.output,
		quarantineOnTheCopy: quarantine.status === 0 ? quarantine.output : null,
		information: {
			"spctl --assess --type execute": { status: gatekeeper.status, said: gatekeeper.output },
			"codesign -dv": signature.output,
		},
		sealWhole: seal.status === 0 ? true : seal.output,
		quarantineCleared: cleared.status === 0,
		notProven:
			"Gatekeeper's own dialog and Open Anyway were not seen or answered: the quarantine was removed with xattr, and the app is started by its executable. The build is signed ad hoc and not notarized.",
		passed,
	});
	console.log(
		`${passed ? "ok   " : "FAIL "} ${app} ${replaced ? "replaced" : "installed"}; spctl: ${gatekeeper.output}`,
	);
	return passed;
}

export type Status = "passed" | "failed" | "not exercised" | "not applicable";
export type Row = { readonly what: string; readonly where: string; readonly status: Status; readonly detail: string };

type Check = { readonly name: string; readonly ok: boolean; readonly detail?: unknown };
type Driven = { readonly os?: string; readonly passed: boolean; readonly checks: readonly Check[] };
type Assertion = { readonly status: Status; readonly detail: unknown };
type Upgrade = {
	readonly from: { readonly version: string; readonly format: string };
	readonly to: { readonly version: string; readonly format: string };
	readonly assertions: Readonly<Record<string, Assertion>>;
};
type Install = { readonly platform: "linux" | "mac"; readonly os?: string; readonly passed: boolean };

/** One uploaded artifact's folder, as a job left it: any file may be missing when the job died before writing it. */
export type Evidence = {
	readonly name: string;
	readonly read: (path: string) => unknown;
};

const COMPUTER = "starts its computer";
const say = (value: unknown) => (typeof value === "string" ? value : (JSON.stringify(value) ?? ""));
const failedChecks = (driven: Driven) =>
	driven.checks
		.filter((check) => !check.ok)
		.map((check) => `${check.name}: ${say(check.detail).split("\n")[0]}`)
		.join("; ");

/** The app's own run without its computer check: opened, first screen, second launch, quit, reopened. */
function app(driven: Driven | undefined, install: Install | undefined): Pick<Row, "status" | "detail"> {
	if (install === undefined) return { status: "failed", detail: "no evidence: the install left no record" };
	if (!install.passed) return { status: "failed", detail: "the package did not install; see install.json" };
	if (driven === undefined) return { status: "failed", detail: "no evidence: the app's run left no result.json" };
	const rest = { ...driven, checks: driven.checks.filter((check) => check.name !== COMPUTER) };
	const failed = failedChecks(rest);
	if (failed !== "" || rest.checks.length === 0) return { status: "failed", detail: failed || "no check ran" };
	return { status: "passed", detail: `${rest.checks.length} checks on ${driven.os ?? install.os ?? "the runner"}` };
}

function computer(driven: Driven | undefined): Pick<Row, "status" | "detail"> {
	const check = driven?.checks.find((each) => each.name === COMPUTER);
	if (check === undefined) return { status: "failed", detail: "no evidence: the computer's check did not run" };
	return { status: check.ok ? "passed" : "failed", detail: say(check.detail).split("\n")[0] ?? "" };
}

/**
 * Every row of the acceptance, from the evidence each job uploaded. A job that left nothing failed: only what a job
 * says it did not do is "not exercised", and only what its release cannot do is "not applicable".
 */
export function rows(evidence: readonly Evidence[]): Row[] {
	const made: Row[] = [];
	const sums: { where: string; record: AssetsEvidence | undefined }[] = [];
	for (const { name, read } of evidence) {
		const where = name.replace(/^acceptance-/, "");
		const upgrade = name.startsWith("acceptance-upgrade-");
		for (const folder of upgrade ? ["previous", "tag"] : ["."])
			sums.push({
				where: upgrade ? `${where} (${folder})` : where,
				record: read(join(folder, "assets.json")) as AssetsEvidence | undefined,
			});
		const mac = where.endsWith("mac");
		if (!upgrade) {
			const driven = read("app/result.json") as Driven | undefined;
			made.push({
				what: `${mac ? "mac" : "linux"} install`,
				where,
				...app(driven, read("install.json") as Install | undefined),
			});
			made.push(
				mac
					? {
							what: "mac computer",
							where,
							status: "not exercised",
							detail:
								"GitHub's Apple silicon runners have no nested virtualization, so the computer's virtual machine cannot start there",
						}
					: { what: "linux computer", where, ...computer(driven) },
			);
			continue;
		}
		const seeded = read("seed/result.json") as Driven | undefined;
		const checked = read("check/result.json") as Driven | undefined;
		const report = read("check/upgrade.json") as Upgrade | undefined;
		const installs = [read("previous/install.json"), read("tag/install.json")] as (Install | undefined)[];
		const kept = (): Pick<Row, "status" | "detail"> => {
			if (installs.some((install) => install?.passed !== true))
				return { status: "failed", detail: "a release did not install; see install.json" };
			if (seeded?.passed !== true)
				return {
					status: "failed",
					detail: `the release upgraded from: ${seeded === undefined ? "no evidence" : failedChecks(seeded)}`,
				};
			if (checked === undefined || report === undefined)
				return { status: "failed", detail: "no evidence: the upgraded app left no result" };
			const { homeOpens, format, stateKept, backupBeforeUpgrade } = report.assertions;
			const bad = Object.entries({ homeOpens, format, stateKept, backupBeforeUpgrade })
				.filter(
					([key, each]) =>
						each === undefined ||
						each.status === "failed" ||
						(key !== "backupBeforeUpgrade" && each.status !== "passed"),
				)
				.map(([key, each]) => `${key}: ${say(each?.detail ?? "not reported")}`);
			// the app's own checks after the upgrade, the computer's aside: it has a row of its own
			const failed = failedChecks({ ...checked, checks: checked.checks.filter((check) => check.name !== COMPUTER) });
			if (bad.length > 0 || failed !== "")
				return { status: "failed", detail: [...bad, failed].filter(Boolean).join("; ") };
			return {
				status: "passed",
				detail: `${report.from.version} (format ${report.from.format}) to ${report.to.version} (format ${report.to.format}); kept ${say(stateKept?.detail)}; the home before: ${backupBeforeUpgrade?.status === "passed" ? say(backupBeforeUpgrade.detail) : `not applicable, ${say(backupBeforeUpgrade?.detail)}`}`,
			};
		};
		made.push({ what: "upgrade home kept", where, ...kept() });
		const trip = report?.assertions.backupRoundTrip;
		made.push({
			what: "backup round trip",
			where,
			status: trip === undefined ? "failed" : trip.status,
			detail: trip === undefined ? "no evidence: the upgraded app did not reach it" : say(trip.detail),
		});
		made.push(
			mac
				? {
						what: "mac computer after the upgrade",
						where,
						status: "not exercised",
						detail: "no nested virtualization on the runner",
					}
				: { what: "linux computer after the upgrade", where, ...computer(checked) },
		);
	}
	const missing = sums.filter((each) => each.record === undefined).map((each) => each.where);
	const wrong = sums.filter((each) => each.record?.passed === false).map((each) => each.where);
	made.unshift({
		what: "published checksums",
		where: "every job",
		status: sums.length > 0 && missing.length === 0 && wrong.length === 0 ? "passed" : "failed",
		detail:
			sums.length === 0
				? "no evidence: no job reported"
				: [
						missing.length > 0 ? `no record from ${missing.join(", ")}` : "",
						wrong.length > 0 ? `mismatch in ${wrong.join(", ")}` : "",
					]
						.filter(Boolean)
						.join("; ") || `${sums.length} downloads matched SHA256SUMS`,
	});
	return made;
}

/** The SHA-256 of each asset any job downloaded, by release: one line a file, whichever job said it. */
export function hashes(evidence: readonly Evidence[]): { tag: string; name: string; sha256: string }[] {
	const seen = new Map<string, { tag: string; name: string; sha256: string }>();
	for (const { read } of evidence)
		for (const folder of [".", "previous", "tag"]) {
			const record = read(join(folder, "assets.json")) as AssetsEvidence | undefined;
			for (const asset of record?.assets ?? [])
				seen.set(`${record?.tag}/${asset.name}/${asset.sha256}`, {
					tag: record?.tag ?? "",
					name: asset.name,
					sha256: asset.sha256,
				});
		}
	return [...seen.values()].sort((a, b) => `${a.tag}/${a.name}`.localeCompare(`${b.tag}/${b.name}`));
}

export function markdown(
	tag: string,
	previous: string,
	made: readonly Row[],
	assets: ReturnType<typeof hashes>,
): string {
	const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ").slice(0, 600);
	return [
		`## Release acceptance: ${tag}, upgraded from ${previous}`,
		"",
		made.some((row) => row.status === "failed")
			? "**Not accepted: something failed.**"
			: "Nothing failed. What was not exercised is not accepted by this run.",
		"",
		"| What | Where | Outcome | Detail |",
		"| --- | --- | --- | --- |",
		...made.map((row) => `| ${row.what} | ${cell(row.where)} | **${row.status}** | ${cell(row.detail)} |`),
		"",
		"| Release | Asset | SHA-256 |",
		"| --- | --- | --- |",
		...assets.map((asset) => `| ${asset.tag} | ${asset.name} | \`${asset.sha256}\` |`),
		"",
	].join("\n");
}

function summary(tag: string, previous: string, folder: string, out: string, expected: readonly string[]): boolean {
	versionOf(tag);
	versionOf(previous);
	const found = (() => {
		try {
			return readdirSync(folder, { withFileTypes: true })
				.filter((entry) => entry.isDirectory() && entry.name.startsWith("acceptance-"))
				.map((entry) => entry.name);
		} catch {
			return [];
		}
	})();
	// a job named here that uploaded nothing is still a row, and a failed one
	const evidence: Evidence[] = [...new Set([...expected, ...found])].sort().map((name) => ({
		name,
		read: (path: string) => {
			try {
				return JSON.parse(readFileSync(join(folder, name, path), "utf8")) as unknown;
			} catch {
				return undefined;
			}
		},
	}));
	const made = rows(evidence);
	const assets = hashes(evidence);
	const passed = made.length > 1 && made.every((row) => row.status !== "failed");
	save(out, "acceptance.json", {
		tag,
		previous,
		repository: process.env.GITHUB_REPOSITORY ?? null,
		run: process.env.GITHUB_RUN_ID ?? null,
		workflowCommit: process.env.GITHUB_SHA ?? null,
		passed,
		rows: made,
		assets,
	});
	const text = markdown(tag, previous, made, assets);
	writeFileSync(join(out, "summary.md"), text);
	console.log(text);
	return passed;
}

if (import.meta.main) {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			tag: { type: "string" },
			previous: { type: "string" },
			asset: { type: "string" },
			downloads: { type: "string" },
			package: { type: "string" },
			dmg: { type: "string" },
			applications: { type: "string", default: "/Applications" },
			evidence: { type: "string" },
			expect: { type: "string", multiple: true, default: [] },
			out: { type: "string" },
		},
	});
	const need = (name: Exclude<keyof typeof values, "expect">) => {
		const value = values[name];
		if (value === undefined) throw new Error(`--${name} is required`);
		return value;
	};
	const [command] = positionals;
	let passed: boolean;
	if (command === "assets") {
		const kind = need("asset");
		if (kind !== "linux" && kind !== "mac") throw new Error("--asset is linux or mac");
		passed = await assets(need("tag"), kind, need("downloads"), need("out"));
	} else if (command === "linux-install") passed = linuxInstall(need("package"), need("out"));
	else if (command === "mac-install") passed = await macInstall(need("dmg"), need("out"), need("applications"));
	else if (command === "summary")
		passed = summary(need("tag"), need("previous"), need("evidence"), need("out"), values.expect);
	else throw new Error("the command is assets, linux-install, mac-install or summary");
	process.exitCode = passed ? 0 : 1;
}
