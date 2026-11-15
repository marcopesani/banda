/**
 * The process the suites of the app's backups kill. `restore`: as a daemon's life goes, it first finishes a restore
 * that was ready (a start), then, while the home is not the backup's yet, makes the restore ready (the owner's
 * Restore) and finishes it (the next start). `delete`: it deletes the backup, then sweeps what dead processes left.
 * Before anything it reads what the last process left, and fails on what a kill must never leave.
 *
 * argv: home, restore | delete, fault schedule JSON (Fault[])
 */
import { BackupRefused } from "../../src/core/backup.ts";
import { deleteBackup, finishRestore, prepareRestore, sweepBackups } from "../../src/core/backups.ts";
import { HOME_FORMAT } from "../../src/core/format.ts";
import { BACKUP, found, stampOf } from "./backups-scenario.ts";
import { type Fault, Faults } from "./faults.ts";

const [home, action, scheduleJson] = process.argv.slice(2) as [string, "restore" | "delete", string];
const faults = new Faults(JSON.parse(scheduleJson) as Fault[]);
const hit = (point: Parameters<Faults["hit"]>[0]) => faults.hit(point);

if (action === "delete") {
	await deleteBackup(home, BACKUP, hit).catch((error: unknown) => {
		// a process before this one took it out of the list already
		if (!(error instanceof BackupRefused)) throw error;
	});
	await sweepBackups(home);
	console.log(JSON.stringify({ deleted: true }));
} else {
	const before = found(home);
	await finishRestore(home, { hit });
	if (stampOf(home) !== "backup") {
		await sweepBackups(home);
		await prepareRestore(home, BACKUP, { format: HOME_FORMAT, hit });
		await finishRestore(home, { hit });
	}
	console.log(JSON.stringify({ before, after: found(home) }));
}
