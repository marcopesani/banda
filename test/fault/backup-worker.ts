/**
 * The process the backup suites kill: it backs `home` up into `to` and restores that as `restored`, each step skipped
 * when a process before it finished it, as a person who runs the command again would find. Before it does anything
 * it reads what the last process left, and fails on a half of either.
 *
 * argv: home, to, restored, fault schedule JSON (Fault[])
 */
import { backupHome, restoreHome } from "../../src/core/backup.ts";
import { HOME_FORMAT } from "../../src/core/format.ts";
import { whole } from "./backup-scenario.ts";
import { type Fault, Faults } from "./faults.ts";

const [home, to, restored, scheduleJson] = process.argv.slice(2) as [string, string, string, string];
const faults = new Faults(JSON.parse(scheduleJson) as Fault[]);
const hit = (point: Parameters<Faults["hit"]>[0]) => faults.hit(point);

const found = whole(to, restored);
if (!found.backup) await backupHome(home, to, { hit });
if (!found.home) await restoreHome(to, restored, { format: HOME_FORMAT, hit });
console.log(JSON.stringify({ found }));
