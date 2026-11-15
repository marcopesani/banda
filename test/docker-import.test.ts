/**
 * A home that comes from the Docker computer brings its files into the native computer's folder (src/box/docker-import.ts),
 * through a docker that is told what it holds: the folder appears whole or not at all, whatever step fails.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { containerName } from "../src/box/container.ts";
import { type Docker, IMPORTED, importDockerComputer } from "../src/box/docker-import.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const next of dirs.splice(0)) rmSync(next, { recursive: true, force: true });
});
function home(): { home: string; storage: string } {
	const made = mkdtempSync(join(tmpdir(), "banda-import-"));
	dirs.push(made);
	return { home: made, storage: join(made, "computer") };
}

/** A docker holding `folders` of `home` as volumes, one file in each; `failAt` names the command that fails. */
function holding(home: string, folders: readonly string[], failAt?: string) {
	const box = containerName(home);
	const calls: string[][] = [];
	const containers = new Set<string>();
	const docker: Docker = async (args) => {
		calls.push([...args]);
		const [command] = args;
		if (command === failAt) throw new Error(`docker ${command} failed`);
		if (command === "volume") return [...folders.map((folder) => `${box}-${folder}`), `${box}-browser`].join("\n");
		if (command === "image") return "sha256:feed\nsha256:beef";
		if (command === "create") containers.add(args[2] as string);
		if (command === "rm") containers.delete(args.at(-1) as string);
		if (command === "cp") {
			const folder = /\/from\/([a-z]+)\/\.$/.exec(args[1] as string)?.[1] as string;
			writeFileSync(join(args[2] as string, "kept.txt"), `from ${folder}`);
		}
		return "";
	};
	return { docker, calls, containers };
}

describe("a Docker computer's files in the native computer", () => {
	it("brings each volume as its folder, reading the volumes only, and leaves no container", async () => {
		const at = home();
		const { docker, calls, containers } = holding(at.home, IMPORTED);
		expect(await importDockerComputer(at.home, at.storage, docker)).toEqual([...IMPORTED]);
		for (const folder of IMPORTED)
			expect(readFileSync(join(at.storage, folder, "kept.txt"), "utf8")).toBe(`from ${folder}`);
		const create = calls.find((call) => call[0] === "create") ?? [];
		expect(create.filter((part) => part.startsWith("type=volume")).every((part) => part.endsWith(",readonly"))).toBe(
			true,
		);
		expect(create).toContain("none");
		expect(calls.some((call) => call[0] === "start" || call[0] === "run")).toBe(false);
		expect(containers.size).toBe(0);
		expect(readdirSync(at.home)).toEqual(["computer"]);
	});

	it("brings only the volumes there are", async () => {
		const at = home();
		const { docker } = holding(at.home, ["workspace"]);
		expect(await importDockerComputer(at.home, at.storage, docker)).toEqual(["workspace"]);
		expect(readdirSync(at.storage)).toEqual(["workspace"]);
	});

	it("brings nothing, and makes nothing, without Docker or without this home's volumes", async () => {
		const at = home();
		expect(await importDockerComputer(at.home, at.storage, holding(at.home, IMPORTED, "volume").docker)).toEqual([]);
		expect(await importDockerComputer(at.home, at.storage, holding(at.home, []).docker)).toEqual([]);
		expect(readdirSync(at.home)).toEqual([]);
	});

	it.each(["image", "create", "cp"])(
		"leaves no computer folder when docker %s fails, so the next start tries again",
		async (step) => {
			const at = home();
			const failing = holding(at.home, IMPORTED, step);
			await expect(importDockerComputer(at.home, at.storage, failing.docker)).rejects.toThrow(/Docker/);
			expect(readdirSync(at.home)).toEqual([]);
			expect(failing.containers.size).toBe(0);
			expect(await importDockerComputer(at.home, at.storage, holding(at.home, IMPORTED).docker)).toEqual([...IMPORTED]);
			expect(existsSync(join(at.storage, "workspace", "kept.txt"))).toBe(true);
		},
	);

	it("clears what a killed import left before copying again", async () => {
		const at = home();
		mkdirSync(join(at.home, "computer.importing-0123456789ab", "workspace"), { recursive: true });
		writeFileSync(join(at.home, "computer.importing-0123456789ab", "workspace", "half.txt"), "half");
		expect(await importDockerComputer(at.home, at.storage, holding(at.home, IMPORTED).docker)).toEqual([...IMPORTED]);
		expect(readdirSync(at.home)).toEqual(["computer"]);
		expect(existsSync(join(at.storage, "workspace", "half.txt"))).toBe(false);
	});
});
