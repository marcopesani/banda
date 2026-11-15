/**
 * The backups beside a home (`<home>-backups/`), as the app lists, deletes and restores them (DESIGN.md "Home").
 *
 * A backup is addressed by its folder's name alone, never by a path: a name is plain (no separator, no leading dot),
 * and what it names must be a real folder there, not a link.
 *
 * A running daemon cannot restore over its own home, and a restore never writes over one. So the app's restore has
 * two halves. The daemon makes it ready: `restoreHome` copies the backup beside the others and checks the copy
 * against the manifest, the home untouched, and a note (`restore.json`) names the copy. The next start, before
 * anything opens the home and with no daemon on it, finishes: the home moves aside under the name the note chose, and
 * the copy takes the home's name. Each is one rename, and the three folders (the copy, the home, the home moved aside)
 * say alone which comes next, so a start after a kill goes on from wherever the last one stopped. The home as it was
 * is kept until the owner deletes it, and can be restored the same way, with no copy: it is a home already.
 *
 * No import of the daemon or the store: the CLI and the desktop app call `finishRestore` before either is loaded.
 */
import { randomBytes } from "node:crypto";
import { lstat, open, readdir, readFile, realpath, rename, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import {
	type BackupPoint,
	BackupRefused,
	backupName,
	backupsOf,
	daemonRuns,
	MANIFEST,
	type Manifest,
	readManifest,
	remove,
	removeWhole,
	restoreHome,
	sweepStages,
} from "./backup.ts";
import { FORMAT_FLOOR } from "./format.ts";

/** A backup's name: its folder's, in `<home>-backups/`. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** The home as it was before a restore, kept beside the backups: named by when it was moved aside. */
const REPLACED = /^replaced-(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)Z(?:-\d{1,3})?$/;
/** A backup's copy, checked and waiting for the next start. */
const COPY = /^\.restored-[0-9a-f]{8}$/;
/** The backup an upgrade takes before its first step (format.ts). */
const UPGRADE = /^before-format-\d+$/;

/** The note that a restore is ready: `<home>-backups/restore.json`. */
export const READY = "restore.json";

export const ReadyRestore = Type.Object(
	{
		from: Type.String({ description: "The backup's name" }),
		staged: Type.String({ description: "The folder that takes the home's name: the backup's checked copy" }),
		replaced: Type.String({ description: "The name the home as it is takes, beside the backups" }),
		at: Type.String({ description: "When it was made ready, ISO 8601" }),
		created: Type.Optional(Type.String({ description: "When the backup was taken" })),
		failed: Type.Optional(Type.String({ description: "Why a start could not finish it; it is not tried again" })),
	},
	{ additionalProperties: false },
);
export type ReadyRestore = Static<typeof ReadyRestore>;

/** One folder beside the home that the app lists. */
export type KeptBackup =
	| {
			readonly name: string;
			/** `upgrade`: the home as it was before an upgrade's first step. */
			readonly kind: "backup" | "upgrade";
			readonly created: string;
			readonly bytes: number;
			/** The version of banda that took it. */
			readonly banda: string;
			/** What the owner left out of it. */
			readonly without: readonly ("computer" | "browser")[];
	  }
	/** The home as it was before a restore: a home, not a copy of one. */
	| { readonly name: string; readonly kind: "replaced"; readonly created?: string }
	/** A folder with a manifest the build cannot read. */
	| { readonly name: string; readonly kind: "unreadable" };

const exists = (path: string) =>
	lstat(path).then(
		() => true,
		() => false,
	);

/** Whether `path` is a folder with anything in it. */
const holds = async (path: string) =>
	(await lstat(path).catch(() => undefined))?.isDirectory() === true && (await readdir(path)).length > 0;

/** The folder the name `name` is a backup's, or a refusal: the name is the client's, the path never is. */
export async function backupAt(home: string, name: string): Promise<string> {
	const none = new BackupRefused("There is no backup by that name.");
	if (!NAME.test(name)) throw none;
	const folder = backupsOf(home);
	const path = join(folder, name);
	if (!(await lstat(path).catch(() => undefined))?.isDirectory()) throw none;
	// the folder of backups may be a link to another disk, the owner's choice; a backup in it is never one
	if ((await realpath(path)) !== join(await realpath(folder), name)) throw none;
	return path;
}

/** A home's format, when `path` is a home this build opens: a store, and a format between the floor and `format`. */
async function homeFormat(path: string, format: number): Promise<number | undefined> {
	if (!(await lstat(join(path, "durable.db")).catch(() => undefined))?.isFile()) return undefined;
	const mark = /^(\d+)\s*$/.exec(await readFile(join(path, "format"), "utf8").catch(() => ""));
	const found = mark === null ? undefined : Number(mark[1]);
	return found !== undefined && found >= FORMAT_FLOOR && found <= format ? found : undefined;
}

const sizeOf = (manifest: Manifest) =>
	[...Object.values(manifest.files), ...Object.values(manifest.trees)].reduce((sum, each) => sum + each.bytes, 0);

/** What a manifest's `excluded` says was left out, in the two choices the owner has. */
function without(manifest: Manifest): ("computer" | "browser")[] {
	const out = new Set(manifest.excluded);
	if (out.has("computer/workspace") || out.has("workspace")) return ["computer"];
	return out.has("computer/browser") ? ["browser"] : [];
}

async function kept(home: string, name: string): Promise<KeptBackup | undefined> {
	const path = await backupAt(home, name).catch(() => undefined);
	if (path === undefined) return undefined;
	if (await exists(join(path, MANIFEST))) {
		const manifest = await readManifest(path).catch(() => undefined);
		if (manifest === undefined) return { name, kind: "unreadable" };
		return {
			name,
			kind: UPGRADE.test(name) ? "upgrade" : "backup",
			created: manifest.created,
			bytes: sizeOf(manifest),
			banda: manifest.banda,
			without: without(manifest),
		};
	}
	const moved = REPLACED.exec(name);
	if (moved === null || !(await exists(join(path, "durable.db")))) return undefined;
	return { name, kind: "replaced", created: `${moved[1]}:${moved[2]}:${moved[3]}Z` };
}

/** The backups beside `home`, the newest first; what is there and is no backup is not listed. */
export async function listBackups(home: string): Promise<KeptBackup[]> {
	const names = await readdir(backupsOf(home)).catch(() => [] as string[]);
	const found = (await Promise.all(names.map((name) => kept(home, name)))).filter((each) => each !== undefined);
	const when = (each: KeptBackup) => ("created" in each ? (each.created ?? "") : "");
	return found.sort((a, b) => when(b).localeCompare(when(a)) || b.name.localeCompare(a.name));
}

/**
 * Delete the backup `name`, or the home kept from before a restore. Only what the app lists goes: a folder that is
 * neither stays. One a ready restore is about to put in the home's place is refused until that is cancelled.
 */
export async function deleteBackup(
	home: string,
	name: string,
	hit: (point: BackupPoint) => void = () => {},
): Promise<void> {
	const path = await backupAt(home, name);
	if ((await kept(home, name)) === undefined) throw new BackupRefused("There is no backup by that name.");
	if ((await readReady(home))?.staged === name)
		throw new BackupRefused("It is about to be restored. Cancel the restore first.");
	await removeWhole(path, () => hit("backup:deleting"));
}

/** The note that a restore is ready, checked against its schema and its names; one that is neither is no note. */
export async function readReady(home: string): Promise<ReadyRestore | undefined> {
	let value: unknown;
	try {
		value = JSON.parse(await readFile(join(backupsOf(home), READY), "utf8"));
	} catch {
		return undefined;
	}
	if (!Value.Check(ReadyRestore, value)) return undefined;
	const copy = COPY.test(value.staged);
	// what takes the home's name is a checked copy, or the kept home the note says it restores
	if (!copy && !(REPLACED.test(value.staged) && value.staged === value.from)) return undefined;
	if (!NAME.test(value.from) || !REPLACED.test(value.replaced) || value.replaced === value.staged) return undefined;
	return value;
}

/** Flush a folder's entries to the disk, where the platform lets a folder be opened. */
async function flush(folder: string): Promise<void> {
	if (process.platform === "win32") return;
	const handle = await open(folder, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/** Write the note whole and rename it into place, on disk before returning. */
async function writeReady(home: string, ready: ReadyRestore): Promise<void> {
	const folder = backupsOf(home);
	const temporary = join(folder, `.${READY}.${process.pid}.tmp`);
	const file = await open(temporary, "w", 0o600);
	try {
		await file.writeFile(`${JSON.stringify(ready, null, "\t")}\n`);
		await file.sync();
	} finally {
		await file.close();
	}
	await rename(temporary, join(folder, READY));
	await flush(folder);
}

export type PrepareOptions = {
	/** The home format this build reads (`HOME_FORMAT`). */
	readonly format: number;
	readonly signal?: AbortSignal | undefined;
	readonly hit?: (point: BackupPoint) => void;
};

/**
 * Make the restore of backup `name` ready, while the daemon runs: copy it beside the others and check the copy against
 * its manifest (`restoreHome`, which refuses a damaged, incomplete or newer one), then note it. The home is not
 * touched. A restore made ready before is let go first: there is one at a time.
 */
export async function prepareRestore(home: string, name: string, options: PrepareOptions): Promise<ReadyRestore> {
	const hit = options.hit ?? (() => {});
	const path = await backupAt(home, name);
	const folder = backupsOf(home);
	await cancelRestore(home);
	// a name nothing has: two restores within a second (there and back) are told apart by a number
	const moment = `replaced-${backupName()}`;
	let replaced = moment;
	for (let again = 2; await exists(join(folder, replaced)); again++) replaced = `${moment}-${again}`;
	let ready: ReadyRestore;
	if (await exists(join(path, MANIFEST))) {
		const staged = `.restored-${randomBytes(4).toString("hex")}`;
		const manifest = await restoreHome(path, join(folder, staged), options);
		ready = { from: name, staged, replaced, at: new Date().toISOString(), created: manifest.created };
	} else {
		// the home as it was before a restore: a home already, which takes its place back as it is
		if (!REPLACED.test(name) || (await homeFormat(path, options.format)) === undefined)
			throw new BackupRefused("That folder is not a backup, or a home this version of banda opens.");
		ready = { from: name, staged: name, replaced, at: new Date().toISOString() };
	}
	try {
		await writeReady(home, ready);
	} catch (error) {
		if (ready.staged !== name) await remove(join(folder, ready.staged));
		throw error;
	}
	hit("restore:ready");
	return ready;
}

/** Let a ready restore go: its note first, then the copy it named. A kept home it named stays where it is. */
export async function cancelRestore(home: string): Promise<void> {
	const folder = backupsOf(home);
	const ready = await readReady(home);
	await rm(join(folder, READY), { force: true });
	if (ready !== undefined && COPY.test(ready.staged)) await remove(join(folder, ready.staged));
}

/** Remove what dead processes left beside the backups: their stages, and a checked copy no note names. */
export async function sweepBackups(home: string): Promise<void> {
	const folder = backupsOf(home);
	await sweepStages(folder);
	const staged = (await readReady(home))?.staged;
	for (const name of await readdir(folder).catch(() => [] as string[]))
		if (COPY.test(name) && name !== staged) await remove(join(folder, name));
}

const BUSY = new Set(["EBUSY", "EPERM", "EACCES"]);

/**
 * At a start, before anything opens `home`: put a ready restore in the home's place. `restored` when the home is now
 * the backup's, `kept` when it could not be and the home is the one it was (the note then says why, and is not tried
 * again), `waiting` while a daemon runs on the home, `none` when no restore was ready.
 *
 * It reads which of the three folders exist and makes the one rename that state calls for, until the home is in
 * place: the home moved aside, then the copy given its name. A kill between any two leaves a state this reads again.
 * Two starts at once converge: a rename the other already made fails, and the state is read anew.
 */
export async function finishRestore(
	home: string,
	options: { readonly hit?: (point: BackupPoint) => void; readonly log?: (line: string) => void } = {},
): Promise<"none" | "waiting" | "restored" | "kept"> {
	const { hit = () => {}, log = () => {} } = options;
	home = resolve(home);
	const folder = backupsOf(home);
	const ready = await readReady(home);
	if (ready === undefined) return "none";
	if (ready.failed !== undefined) return "kept";
	if (daemonRuns(home)) return "waiting";
	const [staged, aside] = [join(folder, ready.staged), join(folder, ready.replaced)];
	const state = async () => [await holds(staged), await holds(home), await holds(aside)] as const;
	const failed = async (why: string) => {
		log(`restore: ${why}`);
		await writeReady(home, { ...ready, failed: why });
		return "kept" as const;
	};
	for (let turn = 0; turn < 20; turn++) {
		const [copy, here, moved] = await state();
		if (copy && here && moved)
			return failed(
				`A home appeared at ${home} while the restore was finishing, and was left as it is. The home from before is in ${aside}.`,
			);
		if (!copy) {
			if (!here && moved) {
				// the copy went missing after the home moved aside: the home comes back
				await rename(aside, home);
				return failed("The backup's copy was gone before it could take the home's place. Nothing was changed.");
			}
			await rm(join(folder, READY), { force: true });
			await flush(folder).catch(() => undefined);
			hit("restore:settled");
			if (here && moved) log(`restore: ${home} is the backup ${ready.from}; the home from before is ${aside}`);
			return here && moved ? "restored" : "none";
		}
		try {
			if (here) await rename(home, aside);
			else {
				// an empty folder under the home's name is no home
				await rmdir(home).catch(() => undefined);
				await rename(staged, home);
			}
		} catch (error) {
			const now = await state();
			// another start made the move: read on from where it left things
			if (now[0] !== copy || now[1] !== here || now[2] !== moved) continue;
			// Windows: a file of the home is still open for a moment after its daemon went
			if (BUSY.has((error as NodeJS.ErrnoException).code ?? "") && turn < 12) {
				await new Promise((done) => setTimeout(done, 250));
				continue;
			}
			// with the home moved aside and the copy not placed, the home comes back
			if (!here && moved) await rename(aside, home);
			return failed(
				`The backup could not take the home's place (${error instanceof Error ? error.message : String(error)}). Nothing was changed.`,
			);
		}
		await flush(folder).catch(() => undefined);
		hit(here ? "restore:aside" : "restore:placed");
	}
	return failed("The restore could not finish. Nothing was changed.");
}
