/**
 * What the desktop app does for the home's backups (DESIGN.md "Home"): it shows one in the system's file manager, and
 * as it starts it lets a restore the app made ready take the home's place, before it opens anything in the home (its
 * own profile is a folder of the home). The daemon's release does the restore itself (`banda restore --finish`); here
 * is only what decides whether to ask it, and which folder a name is.
 */
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";

/** Where a home's backups are: beside it (src/core/backup.ts). */
export const backupsOf = (home: string) => `${home}-backups`;

/** Whether a restore was made ready for `home` (src/core/backups.ts): its note is there. */
export const restoreWaits = (home: string) => existsSync(join(backupsOf(home), "restore.json"));

/**
 * The folder of the backup `name`, or undefined: the page gives a name, never a path, and what it names must be a real
 * folder among the home's backups, not a link out of them.
 */
export function backupFolder(home: string, name: unknown): string | undefined {
	if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) return undefined;
	const path = join(backupsOf(home), name);
	try {
		if (!lstatSync(path).isDirectory()) return undefined;
		return realpathSync(path) === join(realpathSync(backupsOf(home)), name) ? path : undefined;
	} catch {
		return undefined;
	}
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Whether another desktop app has `profile` open: Chromium's lock there is a link named for the process that holds it
 * (macOS and Linux). While one does, the home is not moved from under it; its own launch finishes the restore.
 */
export function profileHeld(profile: string): boolean {
	try {
		const pid = Number(/-(\d+)$/.exec(readlinkSync(join(profile, "SingletonLock")))?.[1]);
		return Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid && alive(pid);
	} catch {
		return false;
	}
}
