/**
 * The sweep of what boxes left behind, on the box `BANDA_TEST_BOX` names (fixtures/real-box.ts). In Docker a container
 * labelled with a home that is gone is removed with its networks and volumes; one whose home still exists stays, unless
 * the owner's own sweep finds it an idle throwaway. On the computer the machines of a home that is gone are removed with
 * their runtime cache, and those of a home that exists stay.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Box, openBox } from "../src/box/box.ts";
import { sweepBoxes } from "../src/box/container.ts";
import { homeComputers, sweepMicrovmBoxes } from "../src/box/microvm.ts";
import { context } from "../src/core/store.ts";
import { realBox } from "./fixtures/real-box.ts";
import { until } from "./helpers.ts";

const IMAGE = "mitmproxy/mitmproxy:12.2.3@sha256:00b77b5d8804c8ad18cb6caefbf9d5849e895e8986c5ce011f4ae30f4385962f";
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const exists = (name: string) => docker("ps", "--all", "--quiet", "--filter", `name=^${name}$`) !== "";

describe.skipIf(realBox.missing !== undefined || realBox.kind !== "container")("sweeping boxes (container)", () => {
	it("removes what a gone home left, keeps a home that exists, and an idle throwaway only when asked", async () => {
		const tag = Math.random().toString(36).slice(2, 8);
		const gone = mkdtempSync(join(tmpdir(), "banda-sweep-gone-"));
		const kept = mkdtempSync(join(tmpdir(), "banda-sweep-kept-"));
		const names = { gone: `banda-box-sweep${tag}g`, kept: `banda-box-sweep${tag}k` };
		try {
			docker("network", "create", `${names.gone}-in`);
			docker("volume", "create", `${names.gone}-workspace`);
			docker("create", "--name", names.gone, "--label", `banda.home=${gone}`, IMAGE);
			docker("create", "--name", `${names.gone}-proxy`, "--label", `banda.home=${gone}`, IMAGE);
			docker("create", "--name", names.kept, "--label", `banda.home=${kept}`, IMAGE);
			rmSync(gone, { recursive: true, force: true });

			expect(await sweepBoxes()).toContain(gone);
			expect([exists(names.gone), exists(`${names.gone}-proxy`)]).toEqual([false, false]);
			expect(docker("network", "ls", "--quiet", "--filter", `name=^${names.gone}-in$`)).toBe("");
			expect(docker("volume", "ls", "--quiet", "--filter", `name=^${names.gone}-workspace$`)).toBe("");
			// its home exists: only the owner's own sweep takes an idle throwaway
			expect(exists(names.kept)).toBe(true);
			expect(await sweepBoxes({ idle: true })).toContain(kept);
			expect(exists(names.kept)).toBe(false);
		} finally {
			for (const name of [names.gone, `${names.gone}-proxy`, names.kept]) {
				try {
					execFileSync("docker", ["rm", "--force", name], { stdio: "ignore" });
				} catch {}
			}
			rmSync(kept, { recursive: true, force: true });
		}
	}, 120_000);
});

/** The runtime cache of `home`'s computers, as microvm.ts names it. */
const cacheOf = (home: string) =>
	join(
		process.platform === "darwin" ? "/private/tmp" : "/tmp",
		`banda-msb-${process.getuid?.() ?? 0}-${createHash("sha256").update(home).digest("hex").slice(0, 16)}`,
	);

describe.skipIf(realBox.missing !== undefined || realBox.kind !== "microvm")("sweeping boxes (microvm)", () => {
	it("removes the machines and cache of a gone home, and keeps a home that exists", async () => {
		const gone = realpathSync(mkdtempSync(join(tmpdir(), "banda-sweep-gone-")));
		const kept = realpathSync(mkdtempSync(join(tmpdir(), "banda-sweep-kept-")));
		const boxes: Box[] = [];
		try {
			for (const home of [gone, kept]) {
				const box = openBox(realBox.setup(home), () => {});
				boxes.push(box);
				const ran = await box.env().exec("true", {}, context);
				expect(ran.ok && ran.value.exitCode).toBe(0);
			}
			// what a daemon killed before its close leaves: its machines running, its cache, a home then deleted
			const before = await (await homeComputers(gone)).list();
			expect(before.map((vm) => vm.status)).toEqual(["Running", "Running"]);
			rmSync(gone, { recursive: true, force: true });

			expect(await sweepMicrovmBoxes()).toBeGreaterThanOrEqual(1);
			expect(existsSync(cacheOf(gone))).toBe(false);
			// no process runs any of its machines, once they have stopped
			await until(() => {
				const processes = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" });
				return before.every((vm) => !processes.includes(vm.name));
			}, 200);
			// its home exists: what it runs stays, and so does its cache
			expect((await (await homeComputers(kept)).list()).map((vm) => vm.status)).toEqual(["Running", "Running"]);
			expect(existsSync(cacheOf(kept))).toBe(true);
		} finally {
			// the gone home's box object holds no machine any more; closing it removes nothing of the kept one's
			for (const box of boxes) await box.close().catch(() => undefined);
			// what the gone home's close may have made again, asking the runtime after its cache: this test's own
			rmSync(cacheOf(gone), { recursive: true, force: true });
			await realBox.remove(kept);
			rmSync(kept, { recursive: true, force: true });
		}
	}, 600_000);
});
