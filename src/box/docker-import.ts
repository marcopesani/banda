/**
 * A home whose computer ran in Docker keeps the computer's files in Docker's volumes, named after the home. The first
 * time the native computer opens such a home, before its folder exists, the workspace, the work folder and the
 * installed tools are copied out of those volumes, so the agents' definitions, memory and files come along. The volumes
 * are only read and stay where they are. The browser's signed-in sites and the proxy's own state are not brought: the
 * native computer makes its own.
 *
 * The copy lands in a folder beside the computer's and takes its name in one rename: a daemon killed halfway leaves no
 * computer folder, so the next start copies again rather than opening half of one. No Docker, or no such volumes,
 * brings nothing and is no error; a copy that fails is one, and the computer stays offline until it works.
 */
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { containerName } from "./container.ts";

/** The volumes brought, by the folder each becomes. */
export const IMPORTED = ["workspace", "work", "tools"] as const;

/** Run docker and give what it printed; rejects when it fails or does not answer in time. */
export type Docker = (args: readonly string[], timeoutMs: number) => Promise<string>;

const run: Docker = (args, timeoutMs) =>
	new Promise((resolve, reject) => {
		execFile("docker", args, { timeout: timeoutMs, maxBuffer: 16 << 20 }, (error, stdout, stderr) => {
			if (error === null) resolve(stdout.trim());
			else reject(new Error(stderr.trim().split("\n").at(-1) || error.message));
		});
	});

const lines = (text: string) => text.split("\n").filter((line) => line !== "");

/**
 * Copy `home`'s Docker volumes into `storage`, which must not exist yet. Returns the folders brought: none when Docker
 * does not answer or holds nothing of this home, and then `storage` is left for the caller to make.
 */
export async function importDockerComputer(home: string, storage: string, docker: Docker = run): Promise<string[]> {
	const parent = dirname(storage);
	const prefix = `${basename(storage)}.importing-`;
	// what a killed import left: never the computer's folder, so never anything of the owner's
	for (const entry of await readdir(parent))
		if (entry.startsWith(prefix)) await rm(join(parent, entry), { recursive: true, force: true });
	const box = containerName(home);
	const listed = await docker(["volume", "ls", "--quiet", "--filter", `name=${box}-`], 5_000).catch(() => "");
	const volumes = new Set(lines(listed));
	const folders = IMPORTED.filter((folder) => volumes.has(`${box}-${folder}`));
	if (folders.length === 0) return [];
	const token = randomBytes(6).toString("hex");
	const holder = `${box}-import-${token}`;
	const staging = join(parent, `${prefix}${token}`);
	await mkdir(staging, { mode: 0o700 });
	try {
		// a container that is never started: a name through which docker reads the volumes, and nothing runs
		const image = lines(await docker(["image", "ls", "--quiet"], 15_000))[0];
		if (image === undefined) throw new Error("Docker has no image left to read them through");
		await docker(
			[
				"create",
				"--name",
				holder,
				"--network",
				"none",
				...folders.flatMap((folder) => ["--mount", `type=volume,src=${box}-${folder},dst=/from/${folder},readonly`]),
				image,
				"true",
			],
			60_000,
		);
		for (const folder of folders) {
			await mkdir(join(staging, folder), { mode: 0o700 });
			await docker(["cp", `${holder}:/from/${folder}/.`, join(staging, folder)], 30 * 60_000);
		}
		await rename(staging, storage);
		return [...folders];
	} catch (error) {
		await rm(staging, { recursive: true, force: true });
		throw new Error(
			`The computer could not bring its earlier files from Docker: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	} finally {
		await docker(["rm", "--force", holder], 60_000).catch(() => {});
	}
}
