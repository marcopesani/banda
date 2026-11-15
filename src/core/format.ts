/**
 * The home's format: the number in `<home>/format` names the shape of everything stored there, and a build brings an
 * earlier home to its own by running the migrations between them, in order, before anything reads the home.
 */
import { existsSync } from "node:fs";
import { open, readFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { backupHome, MANIFEST } from "./backup.ts";

/** The earliest format a build still migrates from: 0.1.0-alpha.14's. A home below it is refused. */
export const FORMAT_FLOOR = 3;

/**
 * One step, from a format to the next. `run` is given a home in the earlier format, or one that a killed run of this
 * same step left anywhere in between, and returns once the home is in the next format and that is on disk: the runner
 * can only repeat a step that did not finish, so the step makes repeating it safe (one transaction in the store, a file
 * written whole and renamed). Once released a step never changes: a home may be anywhere along the list.
 */
export type Migration = {
	/** What it changes, in a few words, for the error when it fails. */
	readonly what: string;
	readonly run: (home: string) => Promise<void>;
};

/** Every step since the floor: the one at index `i` takes format `FORMAT_FLOOR + i` to the next. */
export const MIGRATIONS: readonly Migration[] = [];

/** The format this build reads and writes. */
export const HOME_FORMAT = FORMAT_FLOOR + MIGRATIONS.length;

/** A home from before the floor, which no build migrates. */
export class OldHome extends Error {}

/** A home a later build made or began migrating, which this one leaves as it is. */
export class NewerHome extends Error {}

/** The runner's effect boundaries, for fault injection. */
export type FormatPoint =
	/** `before` returned; the home is untouched. */
	| "format:before"
	/** The mark says which step is about to run. */
	| "format:marked"
	/** A step returned; the mark still names it. */
	| "format:migrated"
	/** The mark says the build's format alone. */
	| "format:settled";

export type MigrateOptions = {
	/** The steps since the floor; default the build's. Tests pass their own. */
	readonly migrations?: readonly Migration[];
	/**
	 * Runs before the first step touches a home in format `from`, on its way to `to`: where the home is backed up. A
	 * failure stops the migration with the home untouched. It runs again for the same home only while no step has begun
	 * (a kill before the mark below is written), never once one has: a later start goes on from the mark instead.
	 */
	readonly before?: (from: number, to: number) => Promise<void>;
	readonly hit?: (point: FormatPoint) => void;
};

/**
 * Bring `home` to the build's format, or refuse it. A new home is marked with the build's format. While steps are
 * pending the mark reads `<format> to <target>`: the step from `<format>` may have begun, so an earlier build refuses
 * the home (the mark is no number to it) and a start after a kill runs that step again. The mark moves only after its
 * step returned, each time written whole and renamed into place, so a kill leaves the mark before or the one after.
 */
export async function migrateHome(home: string, options: MigrateOptions = {}): Promise<void> {
	const { migrations = MIGRATIONS, before, hit = () => {} } = options;
	const build = FORMAT_FLOOR + migrations.length;
	const stored = await readFile(join(home, "format"), "utf8").catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return undefined;
		throw error;
	});
	const old = `${home} was made by a build of banda from before 0.1.0-alpha.14, which this one cannot read. Start a fresh home (BANDA_HOME=<a new folder>), or use the build that made it.`;
	if (stored === undefined) {
		if (existsSync(join(home, "durable.db"))) throw new OldHome(old);
		await mark(home, `${build}`);
		return;
	}
	const read = /^(\d+)(?: to (\d+))?\s*$/.exec(stored);
	if (read === null) throw new Error(`${home}/format does not name a format of banda's: ${JSON.stringify(stored)}`);
	const from = Number(read[1]);
	const target = read[2] === undefined ? undefined : Number(read[2]);
	if (from < FORMAT_FLOOR) throw new OldHome(old);
	if (Math.max(from, target ?? from) > build)
		throw new NewerHome(
			`${home} is in format ${stored.trim()}, from a newer build of banda than this one, which reads up to format ${build}. Use that build or a later one; this one left the home as it was.`,
		);
	if (from === build && target === undefined) return;
	if (target === undefined) {
		await before?.(from, build);
		hit("format:before");
	}
	for (let at = from; at < build; at++) {
		await mark(home, `${at} to ${build}`);
		hit("format:marked");
		const step = migrations[at - FORMAT_FLOOR] as Migration;
		try {
			await step.run(home);
		} catch (error) {
			throw new Error(
				`${home} could not be brought from format ${at} to ${at + 1} (${step.what}): ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
		hit("format:migrated");
	}
	await mark(home, `${build}`);
	hit("format:settled");
}

/** Write the mark whole and rename it into place, on disk before returning. */
async function mark(home: string, text: string): Promise<void> {
	const path = join(home, "format");
	// one name, written over: the only writer is the process that holds the home, and a killed one leaves no litter
	const temporary = `${path}.tmp`;
	const file = await open(temporary, "w");
	try {
		await file.writeFile(`${text}\n`);
		await file.sync();
	} finally {
		await file.close();
	}
	await rename(temporary, path);
	// Windows does not expose directory fsync through Node; the file itself is flushed before the rename.
	if (process.platform === "win32") return;
	const directory = await open(home, "r");
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

/**
 * The home as it was, kept beside it before an upgrade's first step: the way back to the earlier build. The computer's
 * files are no stored shape and stay out. A backup already there is whole (a start killed before a step took it).
 */
export async function backupBeforeUpgrade(
	home: string,
	from: number,
	log: (line: string) => void = () => {},
): Promise<string> {
	const to = `${resolve(home)}-backups/before-format-${from + 1}`;
	if (!existsSync(join(to, MANIFEST))) await backupHome(home, to, { computer: false });
	log(`home: backed up to ${to} before its upgrade`);
	return to;
}
