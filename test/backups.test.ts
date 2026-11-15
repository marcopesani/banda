/**
 * The home's backups as the app keeps them (src/core/backups.ts) and through the API against a daemon
 * (src/server/routes/backups.ts): a backup is addressed by its name and never a path; the list tells a backup, the
 * one an upgrade took, a home kept from before a restore and a manifest nobody reads apart; a restore is made ready
 * with the home untouched and finished by the next start, the home as it was kept beside the backups; and a kill
 * between its renames is finished by the start after. The kill at every boundary is the fault suite's
 * (test/backups.faults.test.ts).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { BackupRefused, backupHome, backupsOf, MANIFEST, restoreHome } from "../src/core/backup.ts";
import {
	backupAt,
	cancelRestore,
	deleteBackup,
	finishRestore,
	listBackups,
	prepareRestore,
	READY,
	readReady,
	sweepBackups,
} from "../src/core/backups.ts";
import { HOME_FORMAT } from "../src/core/format.ts";
import { startDaemon } from "../src/daemon.ts";
import { readDaemonFile } from "../src/home.ts";
import type { BackupsView } from "../src/server/api.ts";
import { BadRequest } from "../src/server/http.ts";
import { backups as backupsArea } from "../src/server/routes/backups.ts";
import { chatOf, reading, seed } from "./fault/backup-scenario.ts";
import { BACKUP, found, seedWithBackup, stampOf } from "./fault/backups-scenario.ts";
import { runWorker } from "./fault/kill.ts";
import { hostBox } from "./fixtures/host-box.ts";
import { echoModels, tempHome, until } from "./helpers.ts";

const run = promisify(execFile);
const format = HOME_FORMAT;

/** A home with the backup `one` beside it, taken before the home was stamped `later`. */
async function place() {
	const area = await tempHome();
	const home = join(area, "home");
	await seedWithBackup(home);
	return { area, home, folder: backupsOf(home), backup: join(backupsOf(home), BACKUP) };
}

describe("the backups beside a home", () => {
	it("addresses a backup by a plain name of a real folder there, and nothing else", async () => {
		const { area, home, folder, backup } = await place();
		expect(await backupAt(home, BACKUP)).toBe(backup);
		mkdirSync(join(area, "elsewhere"));
		writeFileSync(join(area, "elsewhere", MANIFEST), "{}");
		symlinkSync(join(area, "elsewhere"), join(folder, "linked"));
		mkdirSync(join(folder, ".hidden"));
		writeFileSync(join(folder, "file"), "");
		for (const name of ["..", "../home", "one/../../home", "one/", "/etc", ".hidden", "linked", "file", "none", ""])
			await expect(backupAt(home, name), name).rejects.toThrow(BackupRefused);
		// a link is neither listed nor deleted: what it points at stays
		expect((await listBackups(home)).map((each) => each.name)).toEqual([BACKUP]);
		await expect(deleteBackup(home, "linked")).rejects.toThrow(BackupRefused);
		expect(existsSync(join(area, "elsewhere", MANIFEST))).toBe(true);
	});

	it("lists what a backup holds, the one an upgrade took, a home kept from a restore, and a manifest it cannot read", async () => {
		const { home, folder } = await place();
		await backupHome(home, join(folder, "before-format-4"), { computer: false });
		await backupHome(home, join(folder, "no-browser"), { browser: false });
		mkdirSync(join(folder, "broken"));
		writeFileSync(join(folder, "broken", MANIFEST), "{ not json");
		mkdirSync(join(folder, "notes"));
		writeFileSync(join(folder, "notes", "mine.txt"), "the owner's own folder");
		await seed(join(folder, "replaced-2026-11-15T10-02-33Z"));
		const listed = await listBackups(home);
		const by = (name: string) => listed.find((each) => each.name === name);
		expect(listed.map((each) => each.name).sort()).toEqual(
			[BACKUP, "before-format-4", "broken", "no-browser", "replaced-2026-11-15T10-02-33Z"].sort(),
		);
		expect(by(BACKUP)).toMatchObject({ kind: "backup", without: [] });
		expect((by(BACKUP) as { bytes: number }).bytes).toBeGreaterThan(4096);
		expect(by("before-format-4")).toMatchObject({ kind: "upgrade", without: ["computer"] });
		expect(by("no-browser")).toMatchObject({ kind: "backup", without: ["browser"] });
		expect(by("broken")).toEqual({ name: "broken", kind: "unreadable" });
		expect(by("replaced-2026-11-15T10-02-33Z")).toEqual({
			name: "replaced-2026-11-15T10-02-33Z",
			kind: "replaced",
			created: "2026-11-15T10:02:33Z",
		});
		// what is no backup is the owner's, and stays
		await expect(deleteBackup(home, "notes")).rejects.toThrow(BackupRefused);
		expect(readdirSync(join(folder, "notes"))).toEqual(["mine.txt"]);
	});

	it("deletes a backup whole, and sweeps the stages and copies dead processes left", async () => {
		const { home, folder } = await place();
		await deleteBackup(home, BACKUP);
		expect(readdirSync(folder)).toEqual([]);
		// a dead process's stages, and one of a process that lives (this one)
		for (const name of [".x.partial-999999-0a0b0c0d", ".x.deleting-999999-0a0b0c0d", ".restored-0a0b0c0d"])
			mkdirSync(join(folder, name));
		mkdirSync(join(folder, `.y.partial-${process.pid}-0a0b0c0d`));
		await sweepBackups(home);
		expect(readdirSync(folder)).toEqual([`.y.partial-${process.pid}-0a0b0c0d`]);
	});

	it("carries the workspace of a home with no box, and leaves it out with the computer's files", async () => {
		const { area, home, folder } = await place();
		mkdirSync(join(home, "workspace/agents"), { recursive: true });
		writeFileSync(join(home, "workspace/agents/sancho.md"), "# Sancho\n");
		const whole = await backupHome(home, join(folder, "host"));
		expect(whole.manifest.trees.workspace).toMatchObject({ files: 1 });
		await restoreHome(join(folder, "host"), join(area, "restored"), { format });
		expect(readFileSync(join(area, "restored/workspace/agents/sancho.md"), "utf8")).toBe("# Sancho\n");
		const without = await backupHome(home, join(folder, "bare"), { computer: false });
		expect(without.manifest.excluded).toContain("workspace");
		expect(without.manifest.trees.workspace).toBeUndefined();
		expect((await listBackups(home)).find((each) => each.name === "bare")).toMatchObject({ without: ["computer"] });
	});
});

describe("a restore from the app", () => {
	it("is made ready with the home untouched, and the next start puts the backup in its place and keeps the home", async () => {
		const { home, folder, backup } = await place();
		const [held, was] = [reading(backup), reading(home)];
		const ready = await prepareRestore(home, BACKUP, { format });
		expect(ready).toMatchObject({ from: BACKUP });
		expect(await readReady(home)).toEqual(ready);
		expect(reading(home)).toEqual(was);
		expect(stampOf(home)).toBe("later");

		expect(await finishRestore(home)).toBe("restored");
		expect(found(home)).toEqual({ home: "backup", aside: 1 });
		expect(await chatOf(home)).toBe(7);
		expect(reading(home)).toEqual(held);
		expect(reading(backup)).toEqual(held);
		expect(reading(join(folder, ready.replaced))).toEqual(was);
		expect(existsSync(join(folder, READY))).toBe(false);
		expect(await finishRestore(home)).toBe("none");

		// the home from before is listed, and goes back in place the same way, with no copy
		expect((await listBackups(home)).map((each) => each.kind)).toContain("replaced");
		const back = await prepareRestore(home, ready.replaced, { format });
		expect(back.staged).toBe(ready.replaced);
		await expect(deleteBackup(home, ready.replaced)).rejects.toThrow(/about to be restored/);
		expect(await finishRestore(home)).toBe("restored");
		expect(stampOf(home)).toBe("later");
		expect(reading(home)).toEqual(was);
		expect(readdirSync(folder).sort()).toEqual([BACKUP, back.replaced].sort());
	});

	it("refuses a damaged backup before the home is touched, and leaves no note and no copy", async () => {
		const { home, folder, backup } = await place();
		const was = reading(home);
		writeFileSync(join(backup, "config.json"), "{}");
		await expect(prepareRestore(home, BACKUP, { format })).rejects.toThrow(/does not match its manifest/);
		expect(readdirSync(folder)).toEqual([BACKUP]);
		expect(await finishRestore(home)).toBe("none");
		expect(reading(home)).toEqual(was);
	});

	it("waits while a daemon runs on the home, and is let go by the owner", async () => {
		const { home, folder } = await place();
		await prepareRestore(home, BACKUP, { format });
		const lock = new DatabaseSync(join(home, "daemon.lock"));
		lock.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;");
		try {
			expect(await finishRestore(home)).toBe("waiting");
			expect(stampOf(home)).toBe("later");
		} finally {
			lock.close();
		}
		await cancelRestore(home);
		expect(readdirSync(folder)).toEqual([BACKUP]);
		expect(await finishRestore(home)).toBe("none");
		expect(stampOf(home)).toBe("later");
	});

	it("ignores a note that names anything but a checked copy or a kept home", async () => {
		const { area, home, folder } = await place();
		const was = reading(home);
		mkdirSync(join(area, "evil"));
		for (const staged of ["../evil", "one", "..", ".restored-zz"]) {
			writeFileSync(
				join(folder, READY),
				JSON.stringify({ from: BACKUP, staged, replaced: "replaced-2026-11-15T10-02-33Z", at: "now" }),
			);
			expect(await readReady(home), staged).toBeUndefined();
			expect(await finishRestore(home), staged).toBe("none");
		}
		writeFileSync(join(folder, READY), "{ not json");
		expect(await finishRestore(home)).toBe("none");
		expect(reading(home)).toEqual(was);
	});

	it("says why when the home cannot be moved aside, keeps the home, and does not try again by itself", async () => {
		const { home, folder } = await place();
		const ready = await prepareRestore(home, BACKUP, { format });
		// the name the home would take is taken by something else
		mkdirSync(join(folder, ready.replaced));
		writeFileSync(join(folder, ready.replaced, "in-the-way"), "");
		rmSync(join(folder, ready.staged), { recursive: true });
		mkdirSync(join(folder, ready.staged));
		writeFileSync(join(folder, ready.staged, "durable.db"), "");
		expect(await finishRestore(home)).toBe("kept");
		expect((await readReady(home))?.failed).toMatch(/A home appeared|could not take the home's place/);
		expect(stampOf(home)).toBe("later");
		expect(await finishRestore(home)).toBe("kept");
		await cancelRestore(home);
		expect(existsSync(join(folder, READY))).toBe(false);
	});

	for (const point of ["restore:aside", "restore:placed"] as const) {
		it(`a kill at ${point} is finished by the next start`, async () => {
			const { home } = await place();
			const killed = await run(
				process.execPath,
				["test/fault/backups-worker.ts", home, "restore", JSON.stringify([{ point, hit: 1, kind: "kill" }])],
				{ timeout: 60_000 },
			).catch((error: { signal?: string }) => error);
			expect(killed).toMatchObject({ signal: "SIGKILL" });
			// between the renames there is no home, and everything to go on with; after them the home is the backup's
			expect(found(home)).toEqual({ home: point === "restore:aside" ? undefined : "backup", aside: 1 });
			const { kills } = await runWorker("test/fault/backups-worker.ts", [home, "restore"], []);
			expect(kills).toBe(0);
			expect(found(home)).toEqual({ home: "backup", aside: 1 });
			expect(await chatOf(home)).toBe(7);
		});
	}

	it("banda restore --finish does what a start does, and says what it found", async () => {
		const { home } = await place();
		const cli = (...args: string[]) => run(process.execPath, ["src/cli/index.ts", ...args]);
		expect((await cli("restore", "--finish", "--home", home)).stdout).toContain("no restore was ready");
		await prepareRestore(home, BACKUP, { format });
		expect((await cli("restore", "--finish", "--home", home)).stdout).toContain(`restored ${home}`);
		expect(found(home)).toEqual({ home: "backup", aside: 1 });
	});
});

describe("backups through the API", () => {
	async function start(home: string) {
		const web = join(home, "..", "web");
		await mkdir(web, { recursive: true });
		await writeFile(join(web, "index.html"), "<!doctype html><title>banda</title>");
		const lines: string[] = [];
		const daemon = await startDaemon({
			home,
			port: 0,
			models: echoModels().models,
			log: (line) => lines.push(line),
			box: hostBox(home),
			web,
		});
		const token = (await readDaemonFile(home))!.token!;
		const call = (path: string, init: RequestInit = {}, as: string | null = token) =>
			fetch(`http://127.0.0.1:${daemon.port}/api${path}`, {
				...init,
				headers: { ...(as === null ? {} : { authorization: `Bearer ${as}` }), ...init.headers },
			});
		const view = async () => (await (await call("/backups")).json()) as BackupsView;
		/** The view once the daemon's work has ended. */
		const settled = () => until(async () => ((await view()).working === undefined ? await view() : undefined));
		return { daemon, call, view, settled, lines, token };
	}
	const post = (body: object = {}) => ({ method: "POST", body: JSON.stringify(body) });

	it("takes a backup, lists it, restores it over a restart and deletes it; and never follows a path", async () => {
		const area = await tempHome();
		const home = join(area, "home");
		await mkdir(home);
		await writeFile(join(home, "config.json"), JSON.stringify({ model: { provider: "faux", modelId: "faux-1" } }));
		let s = await start(home);
		const folder = backupsOf(home);
		try {
			expect((await s.call("/backups", {}, null)).status).toBe(401);
			expect((await s.call("/backups", {}, "x".repeat(43))).status).toBe(401);
			expect(await s.view()).toEqual({ folder, backups: [], computer: "held" });

			// what the agents made, in the home with no box: in the backup
			writeFileSync(join(home, "workspace/note.md"), "as backed up");
			const started = await s.call("/backups", post({ browser: false }));
			expect(started.status).toBe(202);
			const taken = await s.settled();
			expect(taken.failed).toBeUndefined();
			expect(taken.backups).toHaveLength(1);
			const [backup] = taken.backups;
			if (backup?.kind !== "backup") throw new Error(`not a backup: ${JSON.stringify(backup)}`);
			expect(backup.without).toEqual(["browser"]);
			expect(backup.name).toMatch(/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ$/);
			expect(readFileSync(join(folder, backup.name, "workspace/note.md"), "utf8")).toBe("as backed up");
			expect(readdirSync(folder)).toEqual([backup.name]);
			expect((await s.call("/backups", post({ computer: true }))).status).toBe(400);

			// a name is all a request gives: nothing outside the backups is reached, by any spelling
			for (const name of ["..%2Fhome", "%2E%2E", "..%2F..%2Fweb", ".hidden", "none", "%ZZ"]) {
				expect((await s.call(`/backups/kept/${name}`, { method: "DELETE" })).status, name).toBe(404);
				expect((await s.call(`/backups/kept/${name}/restore`, post())).status, name).toBe(404);
			}
			expect(existsSync(join(home, "durable.db"))).toBe(true);
			expect(existsSync(join(area, "web/index.html"))).toBe(true);

			// since the backup: a change the restore takes back, and the home as it is keeps
			writeFileSync(join(home, "workspace/note.md"), "since the backup");
			expect((await s.call(`/backups/kept/${backup.name}/restore`, post())).status).toBe(202);
			const ready = await s.settled();
			expect(ready.failed).toBeUndefined();
			expect(ready.ready).toEqual({ from: backup.name, created: backup.created });
			expect(readFileSync(join(home, "workspace/note.md"), "utf8")).toBe("since the backup");
		} finally {
			await s.daemon.close();
		}

		s = await start(home);
		try {
			expect(s.lines.join("\n")).toContain("is the backup");
			expect(readFileSync(join(home, "workspace/note.md"), "utf8")).toBe("as backed up");
			const after = await s.view();
			expect(after.ready).toBeUndefined();
			expect(after.backups.map((each) => each.kind).sort()).toEqual(["backup", "replaced"]);
			const replaced = after.backups.find((each) => each.kind === "replaced")!;
			expect(readFileSync(join(folder, replaced.name, "workspace/note.md"), "utf8")).toBe("since the backup");
			// the owner's token came back with the home, so the page that asked is still signed in
			expect((await s.call("/backups", {}, s.token)).status).toBe(200);

			for (const each of after.backups)
				expect((await s.call(`/backups/kept/${each.name}`, { method: "DELETE" })).status).toBe(200);
			expect((await s.view()).backups).toEqual([]);
			expect(readdirSync(folder)).toEqual([]);
		} finally {
			await s.daemon.close();
		}
	}, 120_000);

	it("says in plain words why a backup failed, and lets a ready restore go", async () => {
		const area = await tempHome();
		const home = join(area, "home");
		await mkdir(home);
		await writeFile(join(home, "config.json"), JSON.stringify({ model: { provider: "faux", modelId: "faux-1" } }));
		// where the backups go is a file: nothing can be written there
		await writeFile(backupsOf(home), "in the way");
		const s = await start(home);
		try {
			expect((await s.call("/backups", post())).status).toBe(202);
			const failed = await s.settled();
			expect(failed.failed?.kind).toBe("backup");
			expect(failed.failed?.why).toMatch(/^It stopped: /);
			expect(failed.backups).toEqual([]);
			expect((await (await s.call("/backups/failure", { method: "DELETE" })).json()) as BackupsView).not.toHaveProperty(
				"failed",
			);

			rmSync(backupsOf(home));
			await s.call("/backups", post({ computer: false }));
			const [backup] = (await s.settled()).backups;
			await s.call(`/backups/kept/${backup!.name}/restore`, post());
			expect((await s.settled()).ready?.from).toBe(backup!.name);
			expect((await s.call("/backups/restore", { method: "DELETE" })).status).toBe(200);
			expect((await s.view()).ready).toBeUndefined();
			expect(readdirSync(backupsOf(home))).toEqual([backup!.name]);
		} finally {
			await s.daemon.close();
		}
	}, 120_000);

	it("refuses a paired device, and a restore where Docker keeps the computer's files", async () => {
		const { home } = await place();
		const request = (method: string, path: string, device?: string) => ({
			method,
			path,
			url: new URL(`http://x/api${path}`),
			json: async () => ({}),
			signal: new AbortController().signal,
			...(device === undefined ? {} : { device }),
		});
		const area = (box: "host" | "container") => backupsArea.start!({ home, box, log: () => {} } as never);
		const refused = async (run: Promise<unknown>) =>
			run.then(
				() => undefined,
				(error: unknown) => (error instanceof BadRequest ? error.status : error),
			);
		for (const [method, path] of [
			["GET", "/backups"],
			["POST", "/backups"],
			["DELETE", `/backups/kept/${BACKUP}`],
			["POST", `/backups/kept/${BACKUP}/restore`],
		] as const)
			expect(await refused(area("host").route!(request(method, path, "a".repeat(64)))), `${method} ${path}`).toBe(403);
		const docker = area("container");
		expect(((await docker.route!(request("GET", "/backups"))) as { body: BackupsView }).body.computer).toBe(
			"elsewhere",
		);
		expect(await refused(docker.route!(request("POST", `/backups/kept/${BACKUP}/restore`)))).toBe(409);
		expect(await readReady(home)).toBeUndefined();
		expect(await docker.route!(request("GET", "/other"))).toBeUndefined();
	});
});
