/**
 * A home's backup and its restore under kills (src/core/backup.ts): one SIGKILL at every boundary of either, then the
 * command run again. Whatever the kill left, the next process reads no half of a backup or of a home as whole
 * (test/fault/backup-worker.ts fails on one), finishes both, and removes the dead process's stage.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKUP_POINTS, chatOf, RESTORE_POINTS, reading, seed, stages, whole } from "./fault/backup-scenario.ts";
import { pool, runWorker } from "./fault/kill.ts";
import { tempHome } from "./helpers.ts";

describe("a backup and a restore under kills", () => {
	it("sweep: a kill at every boundary leaves nothing half, and the next run ends with the home restored", async () => {
		await pool(
			2,
			[...BACKUP_POINTS, ...RESTORE_POINTS].map((point) => async () => {
				const area = await tempHome();
				const [home, to, restored] = [join(area, "home"), join(area, "backups", "one"), join(area, "restored")];
				await seed(home);
				const { kills } = await runWorker(
					"test/fault/backup-worker.ts",
					[home, to, restored],
					[[{ point, hit: 1, kind: "kill" }]],
				);
				expect(kills, point).toBe(1);
				expect(whole(to, restored), point).toEqual({ backup: true, home: true });
				expect(reading(restored), point).toEqual(reading(home));
				expect(await chatOf(restored), point).toBe(7);
				// a stage is removed by the next run of the step that left it; a step already whole is not run again
				expect([...stages(to), ...stages(restored)], point).toEqual([]);
			}),
		);
	}, 300_000);
});
