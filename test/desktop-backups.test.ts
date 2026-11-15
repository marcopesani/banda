/**
 * What the desktop app decides for the home's backups (desktop/src/backups.ts): which folder a name the page gave is,
 * whether a restore waits to be finished at its start, and whether another desktop app has the home's profile open.
 */
import { spawn } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupFolder, backupsOf, profileHeld, restoreWaits } from "../desktop/src/backups.ts";
import { backupsOf as daemonBackupsOf } from "../src/core/backup.ts";
import { READY } from "../src/core/backups.ts";
import { tempHome } from "./helpers.ts";

describe("the desktop app and the home's backups", () => {
	it("shows only a real folder among the home's backups, named plainly", async () => {
		const area = await tempHome();
		const home = join(area, "home");
		// the same place the daemon keeps them
		expect(backupsOf(home)).toBe(daemonBackupsOf(home));
		mkdirSync(join(backupsOf(home), "2026-11-15T10-00-00Z"), { recursive: true });
		mkdirSync(join(area, "elsewhere"));
		symlinkSync(join(area, "elsewhere"), join(backupsOf(home), "linked"));
		writeFileSync(join(backupsOf(home), "file"), "");
		expect(backupFolder(home, "2026-11-15T10-00-00Z")).toBe(join(backupsOf(home), "2026-11-15T10-00-00Z"));
		for (const name of ["..", "../home", "a/b", "/etc", ".hidden", "linked", "file", "none", "", 7, undefined, null])
			expect(backupFolder(home, name), String(name)).toBeUndefined();
	});

	it("knows a restore waits by its note, as the daemon writes it", async () => {
		const home = join(await tempHome(), "home");
		expect(restoreWaits(home)).toBe(false);
		mkdirSync(backupsOf(home), { recursive: true });
		writeFileSync(join(backupsOf(home), READY), "{}");
		expect(restoreWaits(home)).toBe(true);
	});

	it("leaves the home alone while another desktop app holds its profile", async () => {
		const profile = join(await tempHome(), "desktop");
		mkdirSync(profile);
		expect(profileHeld(profile)).toBe(false);
		// Chromium's lock: a link named for the host and the process that holds it
		const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
		try {
			symlinkSync(`host.local-${other.pid}`, join(profile, "SingletonLock"));
			expect(profileHeld(profile)).toBe(true);
		} finally {
			other.kill("SIGKILL");
			await new Promise((done) => other.once("exit", done));
		}
		// a lock a dead process left holds nothing, and neither does this process's own
		expect(profileHeld(join(profile))).toBe(false);
	});
});
