/**
 * The app's restore and delete under kills (src/core/backups.ts): one SIGKILL at every boundary, then the process
 * run again, as banda started again would. Whatever the kill left, the next process finds a whole home or the
 * means to finish (test/fault/backups-scenario.ts fails on anything else), ends with the backup as the home, and the
 * home as it was kept beside the backups, once.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backupsOf } from "../src/core/backup.ts";
import { READY } from "../src/core/backups.ts";
import { chatOf, reading } from "./fault/backup-scenario.ts";
import { APP_RESTORE_POINTS, BACKUP, found, seedWithBackup } from "./fault/backups-scenario.ts";
import { pool, runWorker } from "./fault/kill.ts";
import { tempHome } from "./helpers.ts";

describe("the app's restore and delete under kills", () => {
	it("sweep: a kill at every boundary of a restore ends with the backup as the home and the earlier home kept", async () => {
		await pool(
			2,
			APP_RESTORE_POINTS.map((point) => async () => {
				const home = join(await tempHome(), "home");
				await seedWithBackup(home);
				const backup = join(backupsOf(home), BACKUP);
				const held = reading(backup);
				const { kills } = await runWorker(
					"test/fault/backups-worker.ts",
					[home, "restore"],
					[[{ point, hit: 1, kind: "kill" }]],
				);
				expect(kills, point).toBe(1);
				expect(found(home), point).toEqual({ home: "backup", aside: 1 });
				expect(await chatOf(home), point).toBe(7);
				// the backup was only read, and nothing but it and the home moved aside is left beside the home
				expect(reading(backup), point).toEqual(held);
				const left = readdirSync(backupsOf(home)).filter((name) => name !== BACKUP && !name.startsWith("replaced-"));
				expect(left, point).toEqual([]);
				expect(existsSync(join(backupsOf(home), READY)), point).toBe(false);
			}),
		);
	}, 300_000);

	it("a kill while a backup is deleted leaves it gone, and the next run removes what was left of it", async () => {
		const home = join(await tempHome(), "home");
		await seedWithBackup(home);
		const { kills } = await runWorker(
			"test/fault/backups-worker.ts",
			[home, "delete"],
			[[{ point: "backup:deleting", hit: 1, kind: "kill" }]],
		);
		expect(kills).toBe(1);
		expect(readdirSync(backupsOf(home))).toEqual([]);
	}, 120_000);
});
