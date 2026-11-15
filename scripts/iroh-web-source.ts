/**
 * The stamp of a build of the browser's Iroh endpoint (web/iroh): the hash of what it is built from (its sources, its
 * locked dependencies and its build script) and the hashes of what the build made. `web/iroh/build.sh` writes it beside
 * the build as `pkg/SOURCE`, and test/iroh-web.test.ts compares. It catches a source changed without a rebuild, and a
 * built file changed without one. It does not prove the build came from those sources: only a build someone else can
 * repeat does, and this one is not yet made in CI (docs/operations.md).
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const crate = join(import.meta.dirname, "../web/iroh");

/** What the build makes that the app loads. */
export const BUILT = ["banda_iroh_web_bg.wasm", "banda_iroh_web.js"] as const;

/** The files the build reads, by their path in the crate, in a fixed order. */
export async function sourceFiles(): Promise<string[]> {
	const sources = (await readdir(join(crate, "src"), { recursive: true }))
		.filter((name) => name.endsWith(".rs"))
		.map((name) => `src/${name}`);
	return ["Cargo.toml", "Cargo.lock", ".cargo/config.toml", "build.sh", ...sources.sort()];
}

export async function sourceHash(): Promise<string> {
	const hash = createHash("sha256");
	for (const name of await sourceFiles()) hash.update(`${name}\0`).update(await readFile(join(crate, name)));
	return hash.digest("hex");
}

/** The stamp of the build as it is on disk now: one line a name and its hash. */
export async function stamp(): Promise<string> {
	const lines = [`source ${await sourceHash()}`];
	for (const name of BUILT)
		lines.push(
			`${name} ${createHash("sha256")
				.update(await readFile(join(crate, "pkg", name)))
				.digest("hex")}`,
		);
	return `${lines.join("\n")}\n`;
}

if (import.meta.main) process.stdout.write(await stamp());
