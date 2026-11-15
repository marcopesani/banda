import { createHash } from "node:crypto";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
	debianFolder,
	downloadKind,
	dpkgPackages,
	dscFiles,
	FIRMWARE_SOURCE,
	type FileIdentity,
	LIMITS,
	lockCrates,
	planShards,
	pythonDistribution,
	ReleaseMaterials,
	tarEntries,
	tarHeader,
	tarPadding,
	verifyReleaseMaterials,
} from "../scripts/release-materials.ts";
import { MICROVM_SOURCE } from "../src/box/microvm-assets.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const VERSION = "0.1.0-test.1";

/** A whole, bound set: two targets, one shard, and the files a release folder would hold. */
function fixture(): { index: ReleaseMaterials; files: Map<string, FileIdentity> } {
	const files = new Map<string, FileIdentity>();
	const file = (name: string) => {
		const identity = { bytes: name.length, sha256: sha(name) };
		files.set(name, identity);
		return { file: name, ...identity };
	};
	const shard = `banda-${VERSION}-sources-01.tar`;
	const materials: ReleaseMaterials["materials"] = [];
	const material = (path: string, sha256 = sha(path)) => {
		materials.push({ path, bytes: 1, sha256, asset: shard });
		return path;
	};
	const image = (role: "box" | "proxy" | "browser", target: string) => ({
		role,
		sha256: sha(`${target} ${role}`),
		digest: `sha256:${sha(`${target} ${role} config`)}`,
		packages: [
			{ name: "bash", version: "5.2.15-2+b7", source: "bash", sourceVersion: "5.2.15-2" },
			{ name: "libattr1:amd64", version: "1:2.5.1-4", source: "attr", sourceVersion: "1:2.5.1-4" },
		],
		python: role === "proxy" ? [{ name: "urwid", version: "2.6.16" }] : [],
	});
	const target = (name: "darwin-arm64" | "linux-x64", downloads: [string, "desktop" | "cli" | "browser"][]) => ({
		target: name,
		manifestSha256: sha(`${name} manifest`),
		msbSha256: sha(`${name} msb`),
		firmwareSha256: sha(`${name} firmware`),
		patchSha256: sha("patch"),
		downloads: downloads.map(([name, kind]) => ({ ...file(name), kind })),
		images: [image("box", name), image("proxy", name), image("browser", name)],
	});
	const index: ReleaseMaterials = {
		schemaVersion: 1,
		version: VERSION,
		sourceCommit: "a".repeat(40),
		review: { status: "unreviewed", statement: LIMITS[0] },
		cargo: { lockSha256: MICROVM_SOURCE.lockSha256, registryPackages: 2 },
		targets: [
			target("darwin-arm64", [
				[`banda-${VERSION}-mac-arm64.dmg`, "desktop"],
				[`banda-${VERSION}-mac-arm64.zip`, "desktop"],
				[`banda-cli-${VERSION}-mac-arm64.tar.gz`, "cli"],
				[`banda-browser-${"1".repeat(64)}.tar`, "browser"],
			]),
			target("linux-x64", [
				[`banda-${VERSION}-linux-amd64.deb`, "desktop"],
				[`banda-cli-${VERSION}-linux-x64.tar.gz`, "cli"],
				[`banda-browser-${"2".repeat(64)}.tar`, "browser"],
			]),
		],
		sources: [
			{ kind: "application", name: "banda", version: VERSION, files: [material("materials/application/banda.tar")] },
			{
				kind: "runtime-patch",
				name: "microvm-runtime.patch",
				version: "1",
				files: [material("materials/native/microvm-runtime.patch", sha("patch"))],
			},
			{
				kind: "microsandbox",
				name: "microsandbox",
				version: MICROVM_SOURCE.commit,
				files: [material("materials/native/microsandbox.tar.gz", MICROVM_SOURCE.archiveSha256)],
			},
			{
				kind: "firmware",
				name: "libkrunfw",
				version: FIRMWARE_SOURCE.commit,
				files: [material("materials/native/libkrunfw.tar.gz", FIRMWARE_SOURCE.archiveSha256)],
			},
			{
				kind: "kernel",
				name: "linux",
				version: FIRMWARE_SOURCE.kernel.version,
				files: [material("materials/native/linux.tar.gz", FIRMWARE_SOURCE.kernel.sha256)],
			},
			{ kind: "crate", name: "a", version: "1.0.0", files: [material("materials/crates/a-1.0.0.crate")] },
			{ kind: "crate", name: "b", version: "2.0.0", files: [material("materials/crates/b-2.0.0.crate")] },
			{
				kind: "debian",
				name: "bash",
				version: "5.2.15-2",
				files: [
					material("materials/debian/bash_5.2.15-2/bash_5.2.15-2.dsc"),
					material("materials/debian/bash_5.2.15-2/bash_5.2.15.orig.tar.xz"),
				],
			},
			{
				kind: "debian",
				name: "attr",
				version: "1:2.5.1-4",
				files: [material("materials/debian/attr_1_2.5.1-4/attr_2.5.1-4.dsc")],
			},
			{ kind: "python", name: "urwid", version: "2.6.16", files: [material("materials/python/urwid-2.6.16.tar.gz")] },
		],
		materials,
		assets: [
			{ ...file(shard), kind: "source-shard" },
			{ ...file(`banda-${VERSION}-notices.tar`), kind: "notices" },
			{ ...file("RELEASE-SOURCES.md"), kind: "instructions" },
		],
		limits: [...LIMITS],
	};
	files.set(`banda-${VERSION}-android-arm64.apk`, { bytes: 1, sha256: sha("apk") });
	return { index, files };
}

async function entries(bytes: Buffer) {
	const found: { path: string; type: string; text: string; offset: number }[] = [];
	for await (const entry of tarEntries([bytes.subarray(0, 700), bytes.subarray(700)]))
		found.push({
			path: entry.path,
			type: entry.type,
			offset: entry.offset,
			text: entry.type === "file" && !entry.path.endsWith("skipped") ? (await entry.bytes()).toString("utf8") : "",
		});
	return found;
}

const member = (path: string, text: string) =>
	Buffer.concat([
		tarHeader(path, Buffer.byteLength(text)),
		Buffer.from(text),
		Buffer.alloc(tarPadding(Buffer.byteLength(text))),
	]);

describe("a release's sources and notices", () => {
	it("accepts a set that binds every download and holds every source", () => {
		const { index, files } = fixture();
		expect(Value.Check(ReleaseMaterials, index)).toBe(true);
		expect(verifyReleaseMaterials(index, files)).toEqual([]);
	});

	it("can only say that no person reviewed the set", () => {
		const { index, files } = fixture();
		for (const status of ["reviewed", "accepted", "review-required"])
			expect(verifyReleaseMaterials({ ...index, review: { ...index.review, status } }, files)).toEqual([
				"The release materials index is invalid.",
			]);
		expect(verifyReleaseMaterials(null, files)).toEqual(["The release materials index is invalid."]);
		expect(verifyReleaseMaterials({ ...index, extra: true }, files)).toEqual([
			"The release materials index is invalid.",
		]);
	});

	it("refuses a missing or changed material", () => {
		const { index, files } = fixture();
		const shard = `banda-${VERSION}-sources-01.tar`;
		for (const name of [shard, `banda-${VERSION}-notices.tar`, "RELEASE-SOURCES.md"]) {
			const without = new Map(files);
			without.delete(name);
			expect(verifyReleaseMaterials(index, without)).toEqual([`Material ${name} is missing.`]);
			for (const changed of [
				{ bytes: name.length, sha256: sha("other") },
				{ bytes: name.length + 1, sha256: sha(name) },
			])
				expect(verifyReleaseMaterials(index, new Map(files).set(name, changed))).toEqual([
					`Material ${name} differs from the index.`,
				]);
		}
		const stray = `banda-${VERSION}-sources-02.tar`;
		expect(verifyReleaseMaterials(index, new Map(files).set(stray, { bytes: 1, sha256: sha("x") }))).toEqual([
			`${stray} is not named by the index.`,
		]);
	});

	it("refuses a download the index does not bind by its exact bytes", () => {
		const { index, files } = fixture();
		const dmg = `banda-${VERSION}-mac-arm64.dmg`;
		expect(
			verifyReleaseMaterials(index, new Map(files).set(dmg, { bytes: dmg.length, sha256: sha("rebuilt") })),
		).toEqual([`Download ${dmg} differs from the index.`]);
		const without = new Map(files);
		without.delete(dmg);
		expect(verifyReleaseMaterials(index, without)).toEqual([`Download ${dmg} is missing.`]);
		for (const unbound of [
			"banda-0.1.0-test.2-mac-arm64.dmg",
			`banda-browser-${"3".repeat(64)}.tar`,
			"banda-cli-0.1.0-test.2-linux-x64.tar.gz",
		])
			expect(verifyReleaseMaterials(index, new Map(files).set(unbound, { bytes: 1, sha256: sha("x") }))).toEqual([
				`${unbound} carries a computer and no target in the index names it.`,
			]);
		const one = structuredClone(index);
		one.targets.pop();
		expect(verifyReleaseMaterials(one, files)).toContain("The index has no linux-x64 target.");
		const swapped = structuredClone(index);
		for (const download of swapped.targets[1]?.downloads ?? []) if (download.kind === "cli") download.kind = "desktop";
		expect(verifyReleaseMaterials(swapped, files)).toContain("linux-x64 has no cli download.");
	});

	it("refuses a set without the pinned native sources", () => {
		const { index, files } = fixture();
		for (const kind of ["microsandbox", "firmware", "kernel"] as const) {
			const changed = structuredClone(index);
			const path = changed.sources.find((source) => source.kind === kind)?.files[0];
			for (const material of changed.materials) if (material.path === path) material.sha256 = sha("another tree");
			expect(verifyReleaseMaterials(changed, files)).toEqual([`The ${kind} source differs from its pinned SHA-256.`]);
			const missing = structuredClone(index);
			missing.sources = missing.sources.filter((source) => source.kind !== kind);
			expect(verifyReleaseMaterials(missing, files)).toContain(`The index must name exactly one ${kind} source file.`);
		}
		const patched = structuredClone(index);
		for (const target of patched.targets) if (target.target === "linux-x64") target.patchSha256 = sha("another patch");
		expect(verifyReleaseMaterials(patched, files)).toEqual(["linux-x64's runtime patch is not in the set."]);
		const fewer = structuredClone(index);
		fewer.cargo.registryPackages = 3;
		expect(verifyReleaseMaterials(fewer, files)).toEqual([
			"The set does not hold every registry package of the Cargo.lock.",
		]);
		const lock = structuredClone(index);
		lock.cargo.lockSha256 = sha("another lock");
		expect(verifyReleaseMaterials(lock, files)).toEqual(["The crates were collected for a different Cargo.lock."]);
	});

	it("refuses an installed package or distribution without its source", () => {
		const { index, files } = fixture();
		const newer = structuredClone(index);
		const bash = newer.targets[0]?.images[2]?.packages[0];
		if (bash) bash.sourceVersion = "5.2.15-3";
		expect(verifyReleaseMaterials(newer, files)).toEqual([
			"darwin-arm64 browser: bash 5.2.15-2+b7 has no Debian source bash 5.2.15-3.",
		]);
		const controlless = structuredClone(index);
		for (const source of controlless.sources)
			if (source.kind === "debian" && source.name === "bash")
				source.files = source.files.filter((path) => !path.endsWith(".dsc"));
		expect(verifyReleaseMaterials(controlless, files)).toHaveLength(7);
		const python = structuredClone(index);
		python.sources = python.sources.filter((source) => source.kind !== "python");
		expect(verifyReleaseMaterials(python, files)).toEqual([
			"materials/python/urwid-2.6.16.tar.gz belongs to no source in the index.",
			"darwin-arm64 proxy: Python urwid 2.6.16 has no source.",
			"linux-x64 proxy: Python urwid 2.6.16 has no source.",
		]);
		const dangling = structuredClone(index);
		dangling.materials = dangling.materials.filter((material) => !material.path.includes("attr"));
		expect(verifyReleaseMaterials(dangling, files)).toEqual([
			"debian attr 1:2.5.1-4 lacks materials/debian/attr_1_2.5.1-4/attr_2.5.1-4.dsc.",
		]);
		const elsewhere = structuredClone(index);
		for (const material of elsewhere.materials) if (material.path.includes("urwid")) material.asset = "another.tar";
		expect(verifyReleaseMaterials(elsewhere, files)).toEqual([
			"materials/python/urwid-2.6.16.tar.gz is in no source shard of the index.",
		]);
	});

	it("names the downloads that carry a computer", () => {
		expect(downloadKind("banda-0.1.0-alpha.14-mac-arm64.dmg")).toEqual({ kind: "desktop", target: "darwin-arm64" });
		expect(downloadKind("banda-0.1.0-alpha.14-mac-arm64.zip")).toEqual({ kind: "desktop", target: "darwin-arm64" });
		expect(downloadKind("banda-0.1.0-alpha.14-linux-amd64.deb")).toEqual({ kind: "desktop", target: "linux-x64" });
		expect(downloadKind("banda-cli-0.1.0-alpha.14-mac-arm64.tar.gz")).toEqual({ kind: "cli", target: "darwin-arm64" });
		expect(downloadKind("banda-cli-0.1.0-alpha.14-linux-x64.tar.gz")).toEqual({ kind: "cli", target: "linux-x64" });
		expect(downloadKind(`banda-browser-${"a".repeat(64)}.tar`)).toEqual({ kind: "browser" });
		for (const other of ["banda-0.1.0-alpha.14-android-arm64.apk", "SHA256SUMS", "banda-0.1.0-sources-01.tar"])
			expect(downloadKind(other)).toBeUndefined();
	});

	it("pins the kernel the accepted alpha.12 sources carried", () => {
		expect(FIRMWARE_SOURCE.kernel.sha256).toBe("2ec6ffc2120e6892ec6cb94142aafe218054eee5ebc6b5283deda2e74bae22df");
		expect(FIRMWARE_SOURCE.kernel.url.endsWith(`/${FIRMWARE_SOURCE.kernel.version}.tar.gz`)).toBe(true);
	});
});

describe("reading what a computer contains", () => {
	it("takes registry packages from a Cargo.lock by their checksums", () => {
		const registry = 'source = "registry+https://github.com/rust-lang/crates.io-index"';
		const lock = `version = 4\n\n[[package]]\nname = "microsandbox-cli"\nversion = "0.7.14"\ndependencies = [\n "libc",\n]\n\n[[package]]\nname = "libc"\nversion = "0.2.1"\n${registry}\nchecksum = "${"a".repeat(64)}"\n`;
		expect(lockCrates(lock)).toEqual([{ name: "libc", version: "0.2.1", sha256: "a".repeat(64) }]);
		expect(() => lockCrates(lock.replace(/checksum = .*\n/, ""))).toThrow(/no checksum/);
		expect(() => lockCrates(lock.replace(registry, 'source = "git+https://example.com/libc#abc"'))).toThrow(
			/no pinned checksum/,
		);
		expect(() => lockCrates("version = 4\n")).toThrow(/no registry package/);
	});

	it("reads installed packages and the source each was built from", () => {
		const status = [
			"Package: bash\nStatus: install ok installed\nArchitecture: amd64\nVersion: 5.2.15-2+b7\nSource: bash (5.2.15-2)\nDescription: shell\n continued: line",
			"Package: libattr1\nStatus: install ok installed\nSource: attr\nVersion: 1:2.5.1-4",
			"Package: curl\nStatus: install ok installed\nVersion: 7.88.1-10+deb12u15",
			"Package: gone\nStatus: deinstall ok config-files\nVersion: 1",
		].join("\n\n");
		expect(dpkgPackages(`${status}\n`)).toEqual([
			{ name: "bash", version: "5.2.15-2+b7", source: "bash", sourceVersion: "5.2.15-2" },
			{ name: "libattr1", version: "1:2.5.1-4", source: "attr", sourceVersion: "1:2.5.1-4" },
			{ name: "curl", version: "7.88.1-10+deb12u15", source: "curl", sourceVersion: "7.88.1-10+deb12u15" },
		]);
		expect(() => dpkgPackages("Package: gone\nStatus: deinstall ok config-files\nVersion: 1\n")).toThrow(
			/no installed/,
		);
		expect(() => dpkgPackages("Package: odd\nStatus: install ok installed\n")).toThrow(/without a name, version/);
		expect(debianFolder("attr", "1:2.5.1-4")).toBe("attr_1_2.5.1-4");
	});

	it("reads the files a signed Debian source control file binds", () => {
		const dsc = `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nFormat: 3.0 (quilt)\nSource: attr\nChecksums-Sha1:\n ${"1".repeat(40)} 318188 attr_2.5.1.orig.tar.xz\nChecksums-Sha256:\n ${"a".repeat(64)} 318188 attr_2.5.1.orig.tar.xz\n ${"b".repeat(64)} 32152 attr_2.5.1-4.debian.tar.xz\nFiles:\n ${"2".repeat(32)} 318188 attr_2.5.1.orig.tar.xz\n\n-----BEGIN PGP SIGNATURE-----\n`;
		expect(dscFiles(dsc)).toEqual([
			{ name: "attr_2.5.1.orig.tar.xz", bytes: 318188, sha256: "a".repeat(64) },
			{ name: "attr_2.5.1-4.debian.tar.xz", bytes: 32152, sha256: "b".repeat(64) },
		]);
		expect(() => dscFiles("Format: 1.0\nFiles:\n abc 1 x.tar.gz\n")).toThrow(/no SHA-256/);
		expect(() => dscFiles(`Checksums-Sha256:\n ${"a".repeat(64)} 1 ../escape\n`)).toThrow(/no SHA-256/);
	});

	it("reads a Python distribution's name and version", () => {
		const metadata =
			"Metadata-Version: 2.4\r\nName: urwid\r\nVersion: 2.6.16\r\nLicense-Expression: LGPL-2.1-only\r\n\r\nName: body\n";
		expect(pythonDistribution(metadata)).toEqual({ name: "urwid", version: "2.6.16", license: "LGPL-2.1-only" });
		expect(() => pythonDistribution("Name: ../x\nVersion: 1\n")).toThrow(/plain name/);
	});
});

describe("deterministic tar archives", () => {
	it("writes members that read back, long paths included", async () => {
		const long = `materials/debian/${"d".repeat(60)}/${"f".repeat(80)}.orig.tar.xz`;
		const bytes = Buffer.concat([
			member("materials/a.txt", "alpha"),
			member("materials/skipped", "x".repeat(1500)),
			member(long, ""),
			member("materials/z.txt", "omega"),
			Buffer.alloc(1024),
		]);
		expect(await entries(bytes)).toEqual([
			{ path: "materials/a.txt", type: "file", text: "alpha", offset: 512 },
			{ path: "materials/skipped", type: "file", text: "", offset: 1536 },
			{ path: long, type: "file", text: "", offset: 3584 },
			{ path: "materials/z.txt", type: "file", text: "omega", offset: 4096 },
		]);
		expect(tarHeader("materials/a.txt", 5).equals(tarHeader("materials/a.txt", 5))).toBe(true);
		expect(() => tarHeader("x".repeat(120), 1)).toThrow(/too long/);
	});

	it("reads pax paths, links and whiteouts as an image layer stores them", async () => {
		const path = `usr/local/lib/python3.14/site-packages/${"p".repeat(90)}.dist-info/licenses/LICENSE`;
		const record = (key: string, value: string) => {
			let length = key.length + value.length + 3;
			while (`${length} ${key}=${value}\n`.length !== length) length = `${length} ${key}=${value}\n`.length;
			return `${length} ${key}=${value}\n`;
		};
		const pax = Buffer.from(record("path", path));
		const extended = tarHeader("PaxHeaders/x", pax.length);
		extended.write("x", 156, 1, "ascii");
		extended.write("        ", 148, 8, "ascii");
		extended.write(
			`${[...extended]
				.reduce((sum, byte) => sum + byte, 0)
				.toString(8)
				.padStart(6, "0")}\0 `,
			148,
			8,
			"ascii",
		);
		const link = tarHeader("usr/share/doc/libgcc-s1", 0);
		link.write("2", 156, 1, "ascii");
		link.write("gcc-12-base", 157, 100, "utf8");
		link.write("        ", 148, 8, "ascii");
		link.write(
			`${[...link]
				.reduce((sum, byte) => sum + byte, 0)
				.toString(8)
				.padStart(6, "0")}\0 `,
			148,
			8,
			"ascii",
		);
		const found: { path: string; type: string; linkname: string }[] = [];
		const bytes = Buffer.concat([
			extended,
			pax,
			Buffer.alloc(tarPadding(pax.length)),
			member("short", "MIT"),
			link,
			member("etc/.wh.gone", ""),
		]);
		for await (const entry of tarEntries([bytes]))
			found.push({ path: entry.path, type: entry.type, linkname: entry.linkname });
		expect(found).toEqual([
			{ path, type: "file", linkname: "" },
			{ path: "usr/share/doc/libgcc-s1", type: "symlink", linkname: "gcc-12-base" },
			{ path: "etc/.wh.gone", type: "file", linkname: "" },
		]);
	});

	it("refuses a damaged or truncated archive", async () => {
		const bytes = member("materials/a.txt", "alpha");
		const damaged = Buffer.from(bytes);
		damaged[0] = 0x58;
		await expect(entries(damaged)).rejects.toThrow(/checksum/);
		await expect(entries(bytes.subarray(0, 600))).rejects.toThrow(/truncated/);
	});

	it("cuts members into shards in path order, each under the limit", () => {
		const members = ["c", "a", "b", "d"].map((path) => ({ path, bytes: 1000 }));
		const each = 512 + 1000 + tarPadding(1000);
		expect(planShards(members, 2 * each + 1024).map((shard) => shard.map((entry) => entry.path))).toEqual([
			["a", "b"],
			["c", "d"],
		]);
		expect(planShards(members, 4 * each + 1024)).toHaveLength(1);
		expect(() => planShards(members, each + 1023)).toThrow(/does not fit/);
		expect(planShards([])).toEqual([]);
	});
});
