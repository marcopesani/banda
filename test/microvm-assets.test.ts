import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	archiveImageDigest,
	microvmTarget,
	publishedBrowser,
	stageMicrovmBundle,
	verifiedMicrovmImages,
} from "../scripts/microvm-bundle.ts";
import { imageSpecs } from "../src/box/container.ts";
import {
	fileSha256,
	installedMicrovmAssets,
	MICROSANDBOX_ARCHIVE_SHA256,
	MICROSANDBOX_VERSION,
	MICROVM_PLATFORMS,
	MICROVM_SOURCE,
	type MicrovmManifest,
	type MicrovmRuntimeBuild,
	type MicrovmTarget,
	readMicrovmAssets,
} from "../src/box/microvm-assets.ts";

const homes: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
const sum = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const browser = {
	sha256: sum("browser"),
	bytes: 7,
	ref: `banda-browser:${"a".repeat(12)}`,
	digest: `sha256:${"b".repeat(64)}`,
	url: `https://github.com/purrgrammer/banda/releases/download/v0.1.0-test/banda-browser-${sum("browser")}.tar`,
};
const image = (role: "box" | "proxy"): MicrovmManifest["box"] => ({
	archive: role === "box" ? "box.tar" : "proxy.tar",
	sha256: sum(role),
	ref: `banda-${role}:${"a".repeat(12)}`,
	digest: `sha256:${"b".repeat(64)}`,
});
function runtimeBuild(target: MicrovmTarget = "darwin-arm64"): MicrovmRuntimeBuild {
	const platform = MICROVM_PLATFORMS[target];
	return {
		execution: "require-running",
		source: { commit: MICROVM_SOURCE.commit, sha256: MICROVM_SOURCE.archiveSha256 },
		patchSha256: sum("patch"),
		lockSha256: MICROVM_SOURCE.lockSha256,
		recipeSha256: sum("recipe"),
		compiler: {
			version: MICROVM_SOURCE.rust,
			target: platform.rustTarget,
			rustc: sum("rustc"),
			cargo: sum("cargo"),
			std: sum("std"),
		},
		agentdSha256: platform.agentd.sha256,
		features: MICROVM_SOURCE.features,
		environment:
			"manylinux" in platform
				? { platform: "linux", image: platform.manylinux, glibc: "2.28" }
				: { platform: "darwin", minimumVersion: "14.0" },
	};
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "banda-computer-assets-"));
	homes.push(root);
	await mkdir(join(root, "notices"));
	const file = async <T extends string>(path: T) => {
		await writeFile(join(root, path), path);
		return { path, sha256: sum(path) };
	};
	const manifest: MicrovmManifest = {
		target: "darwin-arm64",
		version: MICROSANDBOX_VERSION,
		runtimeBuild: runtimeBuild(),
		vendorArchiveSha256: MICROSANDBOX_ARCHIVE_SHA256,
		msb: await file("msb"),
		firmware: await file("libkrunfw.5.dylib"),
		entitlements: { hypervisor: true, disableLibraryValidation: true },
		box: image("box"),
		proxy: image("proxy"),
		browser,
		notices: {
			microsandbox: await file("notices/MICROSANDBOX-LICENSE"),
			firmwareGpl: await file("notices/LIBKRUNFW-GPL-2.0"),
			firmwareLgpl: await file("notices/LIBKRUNFW-LGPL-2.1"),
			inventory: await file("notices/INVENTORY.md"),
		},
		redistribution: "reviewed",
	};
	await writeFile(join(root, "box.tar"), "box");
	await writeFile(join(root, "proxy.tar"), "proxy");
	await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
	return { root, manifest };
}

describe("installed computer assets", () => {
	it("rejects a configured self-hashed bundle in a writable computer export", async () => {
		const { root } = await fixture();
		const home = await mkdtemp(join(tmpdir(), "banda-computer-home-"));
		homes.push(home);
		const exported = join(home, "computer", "workspace", "computer");
		await mkdir(join(home, "computer", "workspace"), { recursive: true });
		await rename(root, exported);
		vi.stubEnv("BANDA_COMPUTER_BUNDLE", exported);
		await expect(installedMicrovmAssets()).rejects.toThrow(/BANDA_COMPUTER_BUNDLE is not supported/);
	});
	it("rejects an old runtime without borrowed-execution build provenance", async () => {
		const { root, manifest } = await fixture();
		const { runtimeBuild: omitted, ...old } = manifest;
		expect(omitted.execution).toBe("require-running");
		await writeFile(join(root, "manifest.json"), JSON.stringify(old));
		await expect(readMicrovmAssets(root)).rejects.toThrow(/manifest/);
	});
	it("loads a Mac candidate before its distribution inputs have been reviewed", async () => {
		const { root, manifest } = await fixture();
		await writeFile(join(root, "manifest.json"), JSON.stringify({ ...manifest, redistribution: "review-required" }));
		await expect(readMicrovmAssets(root)).resolves.toHaveProperty("target", "darwin-arm64");
	});
	it("rejects mismatched compiler, agent and baseline provenance before execution", async () => {
		const { root, manifest } = await fixture();
		for (const runtimeBuild of [
			{ ...manifest.runtimeBuild, compiler: { ...manifest.runtimeBuild.compiler, version: "latest" } },
			{ ...manifest.runtimeBuild, agentdSha256: sum("wrong agent") },
			{
				...manifest.runtimeBuild,
				environment: { platform: "linux", image: MICROVM_PLATFORMS["linux-x64"].manylinux, glibc: "2.28" },
			},
		]) {
			await writeFile(join(root, "manifest.json"), JSON.stringify({ ...manifest, runtimeBuild }));
			await expect(readMicrovmAssets(root)).rejects.toThrow(/manifest|native inputs|baseline/);
		}
	});
	it("loads a relocated self-contained bundle without its original directory", async () => {
		const { root } = await fixture();
		const moved = `${root}-moved`;
		homes.push(moved);
		await rename(root, moved);
		const assets = await readMicrovmAssets(moved);
		expect(assets.msb).toBe(join(await realpath(moved), "msb"));
		expect(assets.box.archive).toBe(join(await realpath(moved), "box.tar"));
		expect(assets.proxy.digest).toMatch(/^sha256:/);
		expect(assets.browser.url).toBe(browser.url);
	});
	it.each(["msb", "libkrunfw.5.dylib", "box.tar", "proxy.tar", "notices/INVENTORY.md"])(
		"refuses altered %s before any runtime is executed",
		async (path) => {
			const { root } = await fixture();
			await writeFile(join(root, path), "altered");
			await expect(readMicrovmAssets(root)).rejects.toThrow(/SHA-256/);
		},
	);
	it("rejects traversal and unpinned versions in the manifest", async () => {
		const { root, manifest } = await fixture();
		await writeFile(
			join(root, "manifest.json"),
			JSON.stringify({ ...manifest, msb: { ...manifest.msb, path: "../msb" } }),
		);
		await expect(readMicrovmAssets(root)).rejects.toThrow(/manifest/);
		await writeFile(join(root, "manifest.json"), JSON.stringify({ ...manifest, version: "latest" }));
		await expect(readMicrovmAssets(root)).rejects.toThrow(/manifest/);
	});
	it("rejects a symlink outside the bundle even when its bytes match", async () => {
		const { root } = await fixture();
		const outside = `${root}-msb`;
		await rename(join(root, "msb"), outside);
		homes.push(outside);
		await symlink(outside, join(root, "msb"));
		await expect(readMicrovmAssets(root)).rejects.toThrow(/outside/);
	});
	it("rejects a browser descriptor outside the fixed publisher or with a mismatched content filename", async () => {
		const { root, manifest } = await fixture();
		for (const url of ["http://127.0.0.1/browser.tar", browser.url.replace(browser.sha256, "0".repeat(64))]) {
			await writeFile(join(root, "manifest.json"), JSON.stringify({ ...manifest, browser: { ...browser, url } }));
			await expect(readMicrovmAssets(root)).rejects.toThrow(/manifest|filename/);
		}
	});
	it("leaves other release targets operational without microVM inputs", async () => {
		for (const platform of ["freebsd", "win32"] as const) {
			expect(microvmTarget({ platform, arch: "arm64" })).toBeUndefined();
			await stageMicrovmBundle({
				root: "/missing-source",
				out: "/missing-output",
				target: { platform, arch: "arm64" },
			});
		}
		expect(microvmTarget({ platform: "darwin", arch: "x64" })).toBeUndefined();
	});
	it.each(["arm64", "x64"] as const)(
		"accepts %s archives and refuses wrong CPUs and source identities",
		async (arch) => {
			const { root } = await fixture();
			const specs = [
				...(await imageSpecs({ arch, boxTarget: "boot" })),
				...(await imageSpecs({ arch, boxTarget: "browser" })),
			];
			const tagged = async (role: "box" | "proxy" | "browser") => {
				const ref = specs.find((spec) => spec.tag.startsWith(`banda-${role}:`))?.tag;
				const context = join(root, `${role}-export`);
				await mkdir(context);
				const config = JSON.stringify({ architecture: arch === "arm64" ? "arm64" : "amd64", os: "linux" });
				const digest = sum(config);
				await writeFile(join(context, `${digest}.json`), config);
				await writeFile(
					join(context, "manifest.json"),
					JSON.stringify([{ Config: `${digest}.json`, RepoTags: [ref] }]),
				);
				execFileSync("tar", ["-cf", join(root, `${role}.tar`), "-C", context, "manifest.json", `${digest}.json`]);
				const sha256 = await fileSha256(join(root, `${role}.tar`));
				if (role === "browser") {
					const archive = `banda-browser-${sha256}.tar`;
					await rename(join(root, "browser.tar"), join(root, archive));
					return { archive, ref, sha256, digest: `sha256:${digest}`, bytes: (await stat(join(root, archive))).size };
				}
				return { ...image(role), ref, sha256, digest: `sha256:${digest}` };
			};
			await writeFile(
				join(root, "images.json"),
				JSON.stringify({
					target: `linux-${arch}`,
					box: await tagged("box"),
					proxy: await tagged("proxy"),
					browser: await tagged("browser"),
				}),
			);
			await expect(verifiedMicrovmImages(root)).resolves.toHaveProperty("target", `linux-${arch}`);
			const value = await verifiedMicrovmImages(root);
			expect(() =>
				archiveImageDigest(join(root, "box.tar"), value.box.ref, arch === "arm64" ? "x64" : "arm64"),
			).toThrow(/not a Linux/);
			await writeFile(
				join(root, "images.json"),
				JSON.stringify({ ...value, box: { ...value.box, ref: `banda-box:${"0".repeat(12)}` } }),
			);
			await expect(verifiedMicrovmImages(root)).rejects.toThrow(/different sources/);
		},
	);
	it.each(["linux-arm64", "linux-x64"] as const)(
		"loads a relocated %s bundle and refuses it on another host",
		async (target) => {
			const { root, manifest } = await fixture();
			if (manifest.target !== "darwin-arm64") throw new Error("Expected a Mac fixture");
			const { entitlements, ...common } = manifest;
			expect(entitlements.hypervisor).toBe(true);
			const vendor = MICROVM_PLATFORMS[target];
			await writeFile(join(root, vendor.firmware), vendor.firmware);
			const linux = {
				...common,
				target,
				redistribution: "review-required",
				vendorArchiveSha256: vendor.sha256,
				runtimeBuild: runtimeBuild(target),
				firmware: { path: vendor.firmware, sha256: sum(vendor.firmware) },
			};
			await writeFile(join(root, "manifest.json"), JSON.stringify(linux));
			const loaded = await readMicrovmAssets(root, target);
			expect(loaded.target).toBe(target);
			expect(loaded.firmware).toBe(join(await realpath(root), vendor.firmware));
			await expect(readMicrovmAssets(root, "darwin-arm64")).rejects.toThrow(/different operating system or CPU/);
			await writeFile(join(root, "manifest.json"), JSON.stringify({ ...linux, redistribution: "reviewed" }));
			if (target === "linux-x64")
				await expect(readMicrovmAssets(root, target)).resolves.toHaveProperty("target", target);
			else await expect(readMicrovmAssets(root, target)).rejects.toThrow(/manifest/);
		},
	);
});

describe("a browser a release published", () => {
	/** A browser archive tagged `ref`, served at a release's address; what is fetched is counted. */
	async function published(ref: string) {
		const root = await mkdtemp(join(tmpdir(), "banda-published-browser-"));
		homes.push(root);
		const context = join(root, "export");
		await mkdir(context);
		const config = JSON.stringify({ architecture: "arm64", os: "linux" });
		await writeFile(join(context, `${sum(config)}.json`), config);
		await writeFile(
			join(context, "manifest.json"),
			JSON.stringify([{ Config: `${sum(config)}.json`, RepoTags: [ref] }]),
		);
		const tar = join(root, "served.tar");
		execFileSync("tar", ["-cf", tar, "-C", context, "manifest.json", `${sum(config)}.json`]);
		const bytes = execFileSync("cat", [tar]);
		const sha256 = await fileSha256(tar);
		const url = `https://github.com/purrgrammer/banda/releases/download/v0.1.0-test/banda-browser-${sha256}.tar`;
		let fetched = 0;
		vi.stubGlobal("fetch", async () => {
			fetched++;
			return new Response(bytes);
		});
		const out = join(root, "out");
		await mkdir(out);
		return {
			out,
			sha256,
			digest: `sha256:${sum(config)}`,
			pins: { arm64: { url, sha256, bytes: bytes.length } },
			fetched: () => fetched,
		};
	}
	const tag = `banda-browser:${"c".repeat(12)}`;

	it("is used while the browser's sources are the ones it was built from, and fetched once", async () => {
		const at = await published(tag);
		const reused = await publishedBrowser(at.out, "arm64", tag, at.pins);
		expect(reused).toEqual({
			archive: `banda-browser-${at.sha256}.tar`,
			sha256: at.sha256,
			ref: tag,
			digest: at.digest,
			bytes: at.pins.arm64.bytes,
		});
		await publishedBrowser(at.out, "arm64", tag, at.pins);
		expect(at.fetched()).toBe(1);
		vi.unstubAllGlobals();
	});

	it("is not used once the sources changed, and is not left behind", async () => {
		const at = await published(tag);
		await expect(
			publishedBrowser(at.out, "arm64", `banda-browser:${"d".repeat(12)}`, at.pins),
		).resolves.toBeUndefined();
		await expect(stat(join(at.out, `banda-browser-${at.sha256}.tar`))).rejects.toThrow();
		vi.unstubAllGlobals();
	});

	it("is none for a CPU nothing was published for, and refuses bytes that are not the ones named", async () => {
		const at = await published(tag);
		await expect(publishedBrowser(at.out, "x64", tag, at.pins)).resolves.toBeUndefined();
		const wrong = { arm64: { ...at.pins.arm64, sha256: "0".repeat(64) } };
		await expect(publishedBrowser(at.out, "arm64", tag, wrong)).rejects.toThrow(/SHA-256/);
		vi.unstubAllGlobals();
	});

	it("names, for each CPU, an archive of a banda release", async () => {
		const pins: { [arch: string]: { url: string; sha256: string } } = JSON.parse(
			await import("node:fs/promises").then((fs) =>
				fs.readFile(new URL("../scripts/browser-images.json", import.meta.url), "utf8"),
			),
		);
		for (const pin of Object.values(pins))
			expect(pin.url).toMatch(
				new RegExp(
					`^https://github\\.com/purrgrammer/banda/releases/download/v[^/]+/banda-browser-${pin.sha256}\\.tar$`,
				),
			);
	});
});
