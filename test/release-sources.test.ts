import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, expect, it } from "vitest";
import { INDEX_FILE, tarHeader, tarPadding } from "../scripts/release-materials.ts";
import { imageNotices, verifyReleaseFolder } from "../scripts/release-sources.ts";

let folder: string;
beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "banda-release-sources-"));
});
afterAll(async () => {
	await rm(folder, { recursive: true, force: true });
});

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function tar(members: readonly { path: string; data?: string | Buffer; link?: string }[]): Buffer {
	const parts: Buffer[] = [];
	for (const { path, data = "", link } of members) {
		const bytes = Buffer.from(data);
		const header = tarHeader(path, bytes.length);
		if (link !== undefined) {
			header.write("2", 156, 1, "ascii");
			header.write(link, 157, 100, "utf8");
			header.write("        ", 148, 8, "ascii");
			const sum = [...header].reduce((total, byte) => total + byte, 0);
			header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
		}
		parts.push(header, bytes, Buffer.alloc(tarPadding(bytes.length)));
	}
	return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

const status = (packages: readonly string[]) =>
	packages.map((name) => `Package: ${name}\nStatus: install ok installed\nVersion: 1.0-1\n`).join("\n");

/** An image export as Docker writes it: a configuration, and layers by digest, compressed or not. */
async function exported(arch: "arm64" | "amd64"): Promise<{ archive: string; digest: string }> {
	const config = Buffer.from(JSON.stringify({ architecture: arch, os: "linux" }));
	const first = gzipSync(
		tar([
			{ path: "var/lib/dpkg/status", data: status(["bash", "curl", "libgcc-s1"]) },
			{ path: "usr/share/doc/bash/copyright", data: "bash: GPL-3+" },
			{ path: "usr/share/doc/bash/changelog.gz", data: "not a notice" },
			{ path: "usr/share/doc/curl/copyright", data: "curl license" },
			{ path: "usr/share/doc/gcc-12-base/copyright", data: "GCC runtime exception" },
			{ path: "usr/share/doc/libgcc-s1", link: "gcc-12-base" },
			{ path: "usr/bin/bash", data: "\x7fELF" },
			{ path: "srv/app/pkg-1.0.dist-info/METADATA", data: "Name: pkg\nVersion: 1.0\n\nText" },
			{ path: "srv/app/pkg-1.0.dist-info/licenses/LICENSE", data: "MIT" },
		]),
	);
	const second = tar([
		{ path: "var/lib/dpkg/status", data: status(["bash", "libgcc-s1"]) },
		{ path: "usr/share/doc/.wh.curl" },
		{ path: "srv/app/.wh..wh..opq" },
	]);
	const blob = (bytes: Buffer) => `blobs/sha256/${sha(bytes)}`;
	const manifest = [
		{ Config: blob(config), RepoTags: ["banda-box:0123456789ab"], Layers: [blob(first), blob(second)] },
	];
	const archive = join(folder, `${arch}.tar`);
	await writeFile(
		archive,
		tar([
			{ path: blob(first), data: first },
			{ path: blob(config), data: config },
			{ path: blob(second), data: second },
			{ path: "manifest.json", data: JSON.stringify(manifest) },
		]),
	);
	return { archive, digest: `sha256:${sha(config)}` };
}

it("reads an image's final package database and notices through its layers", async () => {
	const { archive, digest } = await exported("amd64");
	const contents = await imageNotices(archive, "banda-box:0123456789ab", "x64");
	expect(contents.digest).toBe(digest);
	expect([...contents.files.keys()].sort()).toEqual([
		"usr/share/doc/bash/copyright",
		"usr/share/doc/gcc-12-base/copyright",
		"usr/share/doc/libgcc-s1",
		"var/lib/dpkg/status",
	]);
	const database = contents.files.get("var/lib/dpkg/status");
	expect(database?.kind === "file" && database.data.toString("utf8")).toBe(status(["bash", "libgcc-s1"]));
	expect(contents.files.get("usr/share/doc/libgcc-s1")).toEqual({ kind: "link", target: "gcc-12-base", hard: false });
});

it("refuses an archive that is another image or another CPU's", async () => {
	const { archive } = await exported("arm64");
	await expect(imageNotices(archive, "banda-box:ffffffffffff", "arm64")).rejects.toThrow(/does not contain/);
	await expect(imageNotices(archive, "banda-box:0123456789ab", "x64")).rejects.toThrow(/not a Linux x64 image/);
	expect((await imageNotices(archive, "banda-box:0123456789ab", "arm64")).files.size).toBe(4);
});

it("refuses a release folder without a valid index", async () => {
	const empty = await mkdtemp(join(folder, "release-"));
	expect(await verifyReleaseFolder([empty], true)).toEqual(["The release materials index is invalid."]);
	await writeFile(join(empty, INDEX_FILE), JSON.stringify({ schemaVersion: 1, review: { status: "reviewed" } }));
	expect(await verifyReleaseFolder([empty])).toEqual(["The release materials index is invalid."]);
});
