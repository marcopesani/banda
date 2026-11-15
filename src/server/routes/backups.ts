/**
 * The home's backups in Settings (DESIGN.md "Home"): `GET /api/backups` lists the backups beside the home, the one
 * being taken and a restore made ready; `POST /api/backups` takes one; `DELETE /api/backups/kept/<name>` deletes one;
 * `POST /api/backups/kept/<name>/restore` makes its restore ready, for the next start to finish (core/backups.ts);
 * `DELETE /api/backups/restore` lets that go, and `DELETE /api/backups/failure` the last failure's words.
 *
 * A backup or a restore is many gigabytes of copying: it runs in the daemon, one at a time, on the event loop's
 * threads (copies, hashes and SQLite's backup are all asynchronous), so other requests are answered while it runs and
 * the page that started it may close. It is the daemon's work in flight and nothing durable: a daemon that stops
 * abandons it, the stage is removed, and neither a backup nor a ready restore exists. A backup is addressed by its
 * folder's name, never a path, and only on the computer banda runs on: a paired device is refused.
 */
import { BackupRefused, backupHome, backupName, backupsOf } from "../../core/backup.ts";
import {
	cancelRestore,
	deleteBackup,
	listBackups,
	prepareRestore,
	readReady,
	sweepBackups,
} from "../../core/backups.ts";
import { HOME_FORMAT } from "../../core/format.ts";
import type { BackupsView, BackupWork } from "../api/backups.ts";
import { BadRequest } from "../http.ts";
import type { AreaModule } from "./area.ts";

const HERE = "Backups are taken and restored in banda on the computer it runs on.";
const BUSY = "A backup or a restore is under way. Wait for it to finish.";

/** The boundaries a backup passes, in order, and a restore's while it is made ready: a step each. */
const STEPS = {
	backup: ["backup:staged", "backup:blobs", "backup:store", "backup:files", "backup:computer", "backup:manifest"],
	restore: ["restore:staged", "restore:copied", "restore:verified"],
} as const;

/** Why it failed, for the owner: the refusal's own words, the disk's, or what the system said. */
function words(error: unknown): string {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (code === "ENOSPC") return "This computer's disk is full. Free some space and try again.";
	if (code === "EACCES" || code === "EPERM")
		return `banda may not write there (${(error as Error).message}). Check the folder's permissions and try again.`;
	const said = error instanceof Error ? error.message : String(error);
	return error instanceof BackupRefused ? said.replace(/^./, (first) => first.toUpperCase()) : `It stopped: ${said}`;
}

export const backups: AreaModule = {
	start: ({ home, box, log }) => {
		let working: BackupWork | undefined;
		let failed: BackupsView["failed"];
		let job: Promise<void> | undefined;
		const stop = new AbortController();
		// what a daemon killed in the middle left: nothing reads it, and it is many gigabytes
		const swept = sweepBackups(home).catch((error: unknown) => log(`backups: ${(error as Error).message}`));

		const view = async (): Promise<BackupsView> => {
			const ready = await readReady(home);
			return {
				folder: backupsOf(home),
				backups: await listBackups(home),
				computer: box === "container" ? "elsewhere" : "held",
				...(working === undefined ? {} : { working }),
				...(failed === undefined ? {} : { failed }),
				...(ready === undefined
					? {}
					: {
							ready: {
								from: ready.from,
								...(ready.created === undefined ? {} : { created: ready.created }),
								...(ready.failed === undefined ? {} : { failed: ready.failed }),
							},
						}),
			};
		};

		/** Start the one job: it is told each boundary it passes, and its failure is kept in words. */
		const run = (
			kind: BackupWork["kind"],
			name: string,
			work: (hit: (point: string) => void) => Promise<unknown>,
		): void => {
			if (working !== undefined) throw new BadRequest(BUSY, 409);
			const steps: readonly string[] = STEPS[kind];
			working = { kind, name, step: 0, steps: steps.length };
			failed = undefined;
			job = (async () => {
				try {
					await swept;
					await work((point) => {
						const at = steps.indexOf(point);
						if (at >= 0) working = { kind, name, step: Math.min(at + 1, steps.length - 1), steps: steps.length };
					});
					log(`backups: ${kind === "backup" ? "took" : "made the restore ready of"} ${name}`);
				} catch (error) {
					if (!stop.signal.aborted) {
						failed = { kind, why: words(error) };
						log(`backups: ${kind} of ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
					}
				} finally {
					working = undefined;
				}
			})();
		};

		return {
			route: async ({ method, path, json, device }) => {
				if (path !== "/backups" && !path.startsWith("/backups/")) return undefined;
				if (device !== undefined) throw new BadRequest(HERE, 403);
				try {
					if (path === "/backups") {
						if (method === "GET") return { body: await view() };
						if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
						const { computer, browser } = await json();
						if ((computer !== undefined && computer !== false) || (browser !== undefined && browser !== false))
							throw new BadRequest("computer and browser are false to leave them out, or absent");
						const name = backupName();
						run("backup", name, (hit) =>
							backupHome(home, `${backupsOf(home)}/${name}`, {
								...(computer === false ? { computer } : {}),
								...(browser === false ? { browser } : {}),
								signal: stop.signal,
								hit,
							}),
						);
						return { status: 202, body: await view() };
					}
					if (path === "/backups/failure" && method === "DELETE") {
						failed = undefined;
						return { body: await view() };
					}
					if (path === "/backups/restore" && method === "DELETE") {
						if (working !== undefined) throw new BadRequest(BUSY, 409);
						await cancelRestore(home);
						return { body: await view() };
					}
					const kept = /^\/backups\/kept\/([^/]+)(\/restore)?$/.exec(path);
					if (kept === null) return undefined;
					const none = new BadRequest("There is no backup by that name.", 404);
					let name: string;
					try {
						name = decodeURIComponent(kept[1] as string);
					} catch {
						throw none;
					}
					// only what the list shows is deleted or restored: the name is looked up there before anything is done
					const listed = (await listBackups(home)).find((each) => each.name === name);
					if (listed === undefined) throw none;
					if (kept[2] === undefined) {
						if (method !== "DELETE") return { status: 405, body: { error: "method not allowed" } };
						if (working !== undefined) throw new BadRequest(BUSY, 409);
						await deleteBackup(home, name);
						return { body: await view() };
					}
					if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
					if (box === "container")
						throw new BadRequest(
							"The computer's files are kept by Docker here, outside a backup, so a backup can't be restored from the app yet.",
							409,
						);
					if (listed.kind === "unreadable") throw new BadRequest("banda can't read that backup's manifest.", 409);
					run("restore", name, (hit) => prepareRestore(home, name, { format: HOME_FORMAT, signal: stop.signal, hit }));
					return { status: 202, body: await view() };
				} catch (error) {
					if (error instanceof BackupRefused) throw new BadRequest(error.message, 409);
					throw error;
				}
			},
			stop: async () => {
				stop.abort();
				await job;
			},
		};
	},
};
