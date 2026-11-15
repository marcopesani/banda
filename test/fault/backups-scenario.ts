/**
 * What the suites of the app's backups share (test/backups.test.ts, test/backups.faults.test.ts): a home with a
 * backup beside it and then a later state, so the two are told apart; and the invariant no kill may break while the
 * app restores: the home is whole, or absent with its restore still noted and both the home moved aside and the copy
 * there; and the home as it was is always somewhere, whole.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BackupPoint, backupHome, backupsOf } from "../../src/core/backup.ts";
import { READY } from "../../src/core/backups.ts";
import { RESTORE_POINTS, seed } from "./backup-scenario.ts";

/** Every boundary of a restore from the app: made ready (the copy, then its note), then finished by a start. */
export const APP_RESTORE_POINTS: readonly BackupPoint[] = [
	...RESTORE_POINTS,
	"restore:ready",
	"restore:aside",
	"restore:placed",
	"restore:settled",
];

/** A file of the workspace that says which home this is: `backup` as the backup holds it, `later` since. */
const STAMP = "computer/workspace/stamp";
export const BACKUP = "one";

export const stampOf = (home: string): string | undefined =>
	existsSync(join(home, STAMP)) ? readFileSync(join(home, STAMP), "utf8") : undefined;

/** A seeded home stamped `backup`, its backup `one` beside it, and the home then stamped `later`. */
export async function seedWithBackup(home: string): Promise<void> {
	await seed(home);
	writeFileSync(join(home, STAMP), "backup");
	await backupHome(home, join(backupsOf(home), BACKUP));
	writeFileSync(join(home, STAMP), "later");
}

const HOME = ["durable.db", "format", "auth/token", STAMP] as const;

/**
 * What a process finds: which home is in place (`backup`, `later`, or none while a restore is between its two
 * renames), and how many homes were moved aside. Throws on what a kill must never leave.
 */
export function found(home: string): { home: string | undefined; aside: number } {
	const folder = backupsOf(home);
	const names = existsSync(folder) ? readdirSync(folder) : [];
	const aside = names.filter((name) => name.startsWith("replaced-"));
	const inPlace = existsSync(home) && readdirSync(home).length > 0;
	if (inPlace) for (const part of HOME) if (!existsSync(join(home, part))) throw new Error(`half a home: no ${part}`);
	for (const name of aside)
		for (const part of HOME)
			if (!existsSync(join(folder, name, part))) throw new Error(`half a home moved aside: ${name} has no ${part}`);
	const stamp = inPlace ? stampOf(home) : undefined;
	if (!inPlace) {
		// only between the two renames, and then everything to go on with is there
		if (!names.includes(READY)) throw new Error("no home, and no restore noted to bring one");
		if (aside.length !== 1) throw new Error("no home, and the home from before is not beside the backups");
		if (!names.some((name) => name.startsWith(".restored-"))) throw new Error("no home, and no copy to place");
	}
	// the home as it was before the restore is never lost: it is in place, or moved aside whole
	const later = stamp === "later" || aside.some((name) => stampOf(join(folder, name)) === "later");
	if (!later) throw new Error("the home as it was before the restore is gone");
	if (!existsSync(join(folder, BACKUP, "manifest.json"))) throw new Error("the backup is gone");
	return { home: stamp, aside: aside.length };
}
