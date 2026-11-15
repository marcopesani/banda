import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type Component,
	crateComponent,
	imageListing,
	NPM_WITHOUT_LICENSE_FILE,
	noticesIndex,
	noticeText,
	npmComponents,
	npmLicense,
	stageNotices,
} from "../scripts/notices.ts";
import { ELECTRON_SOURCE, tarHeader, tarPadding } from "../scripts/release-materials.ts";
import type { ImageFile } from "../scripts/release-sources.ts";

let folder: string;
beforeAll(async () => {
	folder = await mkdtemp(join(tmpdir(), "banda-notices-"));
});
afterAll(async () => {
	await rm(folder, { recursive: true, force: true });
});

async function tree(name: string, files: Readonly<Record<string, string>>): Promise<string> {
	const root = await mkdtemp(join(folder, `${name}-`));
	for (const [path, text] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), text);
	}
	return root;
}

const manifest = (name: string, version: string, license?: unknown) => JSON.stringify({ name, version, license });
const MIT = "MIT License\n\nCopyright (c) someone\n\nPermission is hereby granted.";

describe("the notices of the staged npm packages", () => {
	it("lists every package once, nested ones included, with the license files at its top", async () => {
		const modules = await tree("modules", {
			".package-lock.json": "{}",
			".bin/tool": "#!/bin/sh",
			"plain/package.json": manifest("plain", "1.0.0", "MIT"),
			"plain/LICENSE": MIT,
			"plain/dist/package.json": '{"type":"commonjs"}',
			"plain/dist/LICENSE": "a build's copy, not the package's",
			"plain/README.md": "not a notice",
			"@scope/pkg/package.json": manifest("@scope/pkg", "2.0.0", "Apache-2.0"),
			"@scope/pkg/license.md": "Apache License\r\nVersion 2.0   \r\n",
			"@scope/pkg/NOTICE": "Copyright a company",
			"@scope/pkg/node_modules/plain/package.json": manifest("plain", "1.0.0", "MIT"),
			"@scope/pkg/node_modules/plain/LICENSE": MIT,
			"@scope/pkg/node_modules/inner/package.json": manifest("inner", "0.1.0", "ISC"),
			"@scope/pkg/node_modules/inner/LICENCE.txt": "ISC License",
			"textonly/package.json": manifest("textonly", "3.0.0"),
			"textonly/COPYING": "terms of its own",
		});
		expect(await npmComponents(modules)).toEqual([
			{
				name: "@scope/pkg",
				version: "2.0.0",
				license: "Apache-2.0",
				texts: [
					{ file: "NOTICE", text: "Copyright a company" },
					{ file: "license.md", text: "Apache License\nVersion 2.0" },
				],
			},
			{ name: "inner", version: "0.1.0", license: "ISC", texts: [{ file: "LICENCE.txt", text: "ISC License" }] },
			{ name: "plain", version: "1.0.0", license: "MIT", texts: [{ file: "LICENSE", text: MIT }] },
			{ name: "textonly", version: "3.0.0", license: "", texts: [{ file: "COPYING", text: "terms of its own" }] },
		]);
	});

	it("stops at a package with no license at all, and at one without a text that nobody looked at", async () => {
		const nothing = await tree("nothing", { "bare/package.json": manifest("bare", "1.0.0") });
		await expect(npmComponents(nothing)).rejects.toThrow(
			/npm package bare 1.0.0 declares no license and carries no license file/,
		);
		const fileless = await tree("fileless", { "newcomer/package.json": manifest("newcomer", "1.0.0", "MIT") });
		await expect(npmComponents(fileless)).rejects.toThrow(
			/newcomer 1.0.0 \(MIT\) carries no license file.*notices\.ts/,
		);
		const unnamed = await tree("unnamed", { "odd/package.json": '{"version":"1.0.0"}' });
		await expect(npmComponents(unnamed)).rejects.toThrow(/not a package with a name and a version/);
		const empty = await tree("empty", { ".package-lock.json": "{}" });
		await expect(npmComponents(empty)).rejects.toThrow(/holds no package/);
	});

	it("lists a known package without a license file by what it declares", async () => {
		const known = await tree("known", {
			"standardwebhooks/package.json": manifest("standardwebhooks", "1.1.1", "MIT"),
			"@number0/iroh-linux-x64-gnu/package.json": manifest("@number0/iroh-linux-x64-gnu", "1.2.0", "MIT"),
			"@resvg/resvg-js-win32-x64-msvc/package.json": manifest("@resvg/resvg-js-win32-x64-msvc", "2.6.2", "MPL-2.0"),
		});
		expect(
			(await npmComponents(known)).map((component) => [component.name, component.license, component.texts]),
		).toEqual([
			["@number0/iroh-linux-x64-gnu", "MIT", []],
			["@resvg/resvg-js-win32-x64-msvc", "MPL-2.0", []],
			["standardwebhooks", "MIT", []],
		]);
		// a name on the list is one package, never a prefix that lets its neighbours through
		const neighbour = await tree("neighbour", {
			"standardwebhooks-extra/package.json": manifest("standardwebhooks-extra", "1.0.0", "MIT"),
		});
		await expect(npmComponents(neighbour)).rejects.toThrow(/carries no license file/);
		expect(NPM_WITHOUT_LICENSE_FILE.every((entry) => typeof entry === "string" || entry.source.startsWith("^"))).toBe(
			true,
		);
	});

	it("reads the license a package.json declares in its current and retired forms", () => {
		expect(npmLicense({ license: "MIT" })).toBe("MIT");
		expect(npmLicense({ license: { type: "BSD-3-Clause", url: "https://example.com" } })).toBe("BSD-3-Clause");
		expect(npmLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe("MIT OR Apache-2.0");
		expect(npmLicense({ licenses: "MIT" })).toBe("");
		expect(npmLicense({})).toBe("");
	});
});

function crate(top: string, members: Readonly<Record<string, string>>): Buffer {
	const parts: Buffer[] = [];
	for (const [path, text] of Object.entries(members)) {
		const data = Buffer.from(text);
		parts.push(tarHeader(`${top}/${path}`, data.length), data, Buffer.alloc(tarPadding(data.length)));
	}
	return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}

describe("the notices of the runtime's Rust crates", () => {
	it("reads a crate's declared license and the license files at its top", async () => {
		const archive = join(folder, "libc-0.2.1.crate");
		await writeFile(
			archive,
			crate("libc-0.2.1", {
				"Cargo.toml": '[package]\nname = "libc"\nversion = "0.2.1"\nlicense = "MIT OR Apache-2.0"\n',
				"LICENSE-MIT": MIT,
				"LICENSE-APACHE": "Apache License",
				"src/LICENSE": "a vendored file's terms, not the crate's",
				"README.md": "not a notice",
			}),
		);
		expect(await crateComponent(archive, "libc", "0.2.1")).toEqual({
			name: "libc",
			version: "0.2.1",
			license: "MIT OR Apache-2.0",
			texts: [
				{ file: "LICENSE-APACHE", text: "Apache License" },
				{ file: "LICENSE-MIT", text: MIT },
			],
		});
		// an archive is read only as the crate it was asked for
		await expect(crateComponent(archive, "libc", "0.2.2")).rejects.toThrow(/is not the crate libc-0.2.2/);
	});

	it("reads the file a crate names as its license, whatever it is called", async () => {
		const archive = join(folder, "odd-1.0.0.crate");
		await writeFile(
			archive,
			crate("odd-1.0.0", {
				"Cargo.toml": '[package]\nname = "odd"\nversion = "1.0.0"\nlicense-file = "TERMS.txt"\n',
				"TERMS.txt": "terms of its own",
			}),
		);
		expect(await crateComponent(archive, "odd", "1.0.0")).toEqual({
			name: "odd",
			version: "1.0.0",
			license: "see TERMS.txt",
			texts: [{ file: "TERMS.txt", text: "terms of its own" }],
		});
	});

	it("lists a crate without a license file by what it declares, and stops at one that declares nothing", async () => {
		const fileless = join(folder, "fileless-1.0.0.crate");
		await writeFile(fileless, crate("fileless-1.0.0", { "Cargo.toml": '[package]\nlicense = "Apache-2.0"\n' }));
		expect(await crateComponent(fileless, "fileless", "1.0.0")).toEqual({
			name: "fileless",
			version: "1.0.0",
			license: "Apache-2.0",
			texts: [],
		});
		const bare = join(folder, "bare-1.0.0.crate");
		await writeFile(bare, crate("bare-1.0.0", { "Cargo.toml": '[package]\nname = "bare"\n' }));
		await expect(crateComponent(bare, "bare", "1.0.0")).rejects.toThrow(
			/Rust crate bare 1.0.0 declares no license and carries no license file/,
		);
	});
});

describe("the notice files a release carries", () => {
	const components: Component[] = [
		{ name: "b", version: "2.0.0", license: "MIT", texts: [{ file: "LICENSE", text: MIT }] },
		{
			name: "a",
			version: "1.0.0",
			license: "MIT OR Apache-2.0",
			texts: [
				{ file: "LICENSE-APACHE", text: "Apache License" },
				{ file: "LICENSE-MIT", text: MIT },
			],
		},
		{ name: "c", version: "0.1.0", license: "ISC", texts: [] },
		{ name: "d", version: "0.1.0", license: "", texts: [{ file: "COPYING", text: "terms of its own" }] },
	];

	it("prints each distinct text once, under the packages that ship it", () => {
		const text = noticeText("Things", "What these are.", components);
		expect(text).toContain("Things\n======\n\nWhat these are.\n\nPackages (4)\n");
		expect(text).toContain("a 1.0.0\n  License: MIT OR Apache-2.0\n  Text: [1] LICENSE-APACHE, [2] LICENSE-MIT\n");
		expect(text).toContain("b 2.0.0\n  License: MIT\n  Text: [2] LICENSE\n");
		expect(text).toContain("c 0.1.0\n  License: ISC\n  Text: the package ships no license file\n");
		expect(text).toContain("d 0.1.0\n  License: see its text\n  Text: [3] COPYING\n");
		expect(text).toContain("License texts (3)\n");
		expect(text).toContain("[2] LICENSE-MIT, as shipped by: a 1.0.0, b 2.0.0\n");
		expect(text.split(MIT)).toHaveLength(2);
		expect(text.endsWith("terms of its own\n\n")).toBe(true);
	});

	it("writes the same bytes whatever order the packages were read in", () => {
		const text = noticeText("Things", "What these are.", components);
		expect(noticeText("Things", "What these are.", [...components].reverse())).toBe(text);
		expect(noticeText("Things", "What these are.", components)).toBe(text);
	});

	it("lists an image's packages with where each copyright file is inside it", () => {
		const status = ["bash", "libgcc-s1:arm64", "stripped"]
			.map((name) => `Package: ${name}\nStatus: install ok installed\nVersion: 1.0-1\n`)
			.join("\n");
		const file = (text: string): ImageFile => ({ kind: "file", data: Buffer.from(text) });
		const files = new Map<string, ImageFile>([
			["var/lib/dpkg/status", file(status)],
			["usr/share/doc/bash/copyright", file("GPL-3+")],
			["usr/share/doc/gcc-12-base/copyright", file("GCC runtime exception")],
			["usr/share/doc/libgcc-s1", { kind: "link", target: "gcc-12-base", hard: false }],
			[
				"srv/site-packages/urwid-3.0.5.dist-info/METADATA",
				file("Name: urwid\nVersion: 3.0.5\nLicense: LGPL-2.1-only\n\nText"),
			],
			["srv/site-packages/urwid-3.0.5.dist-info/licenses/COPYING", file("LGPL")],
			["srv/site-packages/bare-1.0.dist-info/METADATA", file("Name: bare\nVersion: 1.0\n\nText")],
		]);
		const image = {
			archive: "app/computer/box.tar",
			ref: "banda-box:0123456789ab",
			digest: `sha256:${"a".repeat(64)}`,
		};
		expect(imageListing("box", image, files)).toBe(
			[
				"The box image: app/computer/box.tar",
				`  banda-box:0123456789ab, configuration sha256:${"a".repeat(64)}`,
				"",
				"  Debian packages (3), each with its copyright file inside the image:",
				"    bash 1.0-1: /usr/share/doc/bash/copyright",
				"    libgcc-s1:arm64 1.0-1: /usr/share/doc/gcc-12-base/copyright",
				"    stripped 1.0-1: the image holds no copyright file for it",
				"",
				"  Python distributions (2), each with its license files inside the image:",
				"    bare 1.0: /srv/site-packages/bare-1.0.dist-info/METADATA",
				"    urwid 3.0.5 (LGPL-2.1-only): /srv/site-packages/urwid-3.0.5.dist-info/licenses/COPYING",
				"",
			].join("\n"),
		);
		expect(() => imageListing("box", image, new Map())).toThrow(/no package database/);
	});

	it("says where every notice is, and that FFmpeg is LGPL with its source beside the downloads", () => {
		const full = noticesIndex({
			version: "0.1.0-test.1",
			target: "darwin-arm64",
			node: "26.13.0",
			npm: 188,
			crates: 822,
			images: ["box", "proxy"],
		});
		for (const path of [
			"app/LICENSE",
			"app/licenses/npm-packages.txt",
			"app/licenses/rust-crates.txt",
			"app/licenses/guest-images.txt",
			"app/THIRD_PARTY_NOTICES.md",
			"node/LICENSE",
			"app/computer/notices/MICROSANDBOX-LICENSE",
			"app/computer/notices/LIBKRUNFW-LGPL-2.1",
			"app/computer/notices/LIBKRUNFW-GPL-2.0",
			"LICENSE.electron.txt",
			"LICENSES.chromium.html",
			"/usr/share/doc/<package>/copyright",
			"banda-0.1.0-test.1-notices.tar",
		])
			expect(full, path).toContain(path);
		expect(full).toContain(`Electron ${ELECTRON_SOURCE.version}`);
		expect(full).toContain(ELECTRON_SOURCE.ffmpeg.commit);
		expect(full).toMatch(
			/libffmpeg\.dylib[\s\S]*libffmpeg\.so[\s\S]*GNU Lesser General Public\s+License, version 2\.1 or later/,
		);
		expect(full).toMatch(
			/Its source code is published with every release of banda, in the same place as the downloads/,
		);
		// a target without the computer names none of its files
		const bare = noticesIndex({ version: "0.1.0-test.1", target: "win32-x64", node: "26.13.0", npm: 188 });
		expect(bare).not.toMatch(/rust-crates|guest-images|app\/computer/);
		expect(bare).toContain("app/licenses/npm-packages.txt");
		expect(bare).toContain("libffmpeg");
	});
});

describe("staging the notices", () => {
	const checkout = (electron: string) => ({
		"package.json": JSON.stringify({ version: "0.1.0-test.1" }),
		"desktop/package.json": JSON.stringify({ devDependencies: { electron } }),
	});
	const staged = {
		"app/licenses/open-bot-avatar-MIT.txt": "kept",
		"app/node_modules/plain/package.json": manifest("plain", "1.0.0", "MIT"),
		"app/node_modules/plain/LICENSE": MIT,
	};

	it("writes the index and the npm notices beside what the checkout already ships", async () => {
		const root = await tree("root", checkout(ELECTRON_SOURCE.version));
		const out = await tree("out", staged);
		// Windows carries no computer, so nothing here needs a built runtime, an image or the network
		const index = await stageNotices({ root, out, target: { platform: "win32", arch: "x64" }, node: "26.13.0" });
		expect((await readdir(join(out, "app", "licenses"))).sort()).toEqual([
			"README.txt",
			"npm-packages.txt",
			"open-bot-avatar-MIT.txt",
		]);
		expect(await readFile(join(out, "app", "licenses", "README.txt"), "utf8")).toBe(index);
		expect(index).toContain("Third-party notices for banda 0.1.0-test.1 (win32-x64)");
		expect(index).toContain("The 1 npm packages in app/node_modules");
		const npm = await readFile(join(out, "app", "licenses", "npm-packages.txt"), "utf8");
		expect(npm).toContain("plain 1.0.0\n  License: MIT\n  Text: [1] LICENSE\n");
		expect(npm).toContain(MIT);
		const first = await readFile(join(out, "app", "licenses", "npm-packages.txt"));
		await stageNotices({ root, out, target: { platform: "win32", arch: "x64" }, node: "26.13.0" });
		expect((await readFile(join(out, "app", "licenses", "npm-packages.txt"))).equals(first)).toBe(true);
	});

	it("stops when the desktop app moved to an Electron whose FFmpeg source is not pinned", async () => {
		const root = await tree("root", checkout("46.0.0"));
		const out = await tree("out", staged);
		await expect(
			stageNotices({ root, out, target: { platform: "win32", arch: "x64" }, node: "26.13.0" }),
		).rejects.toThrow(/built on Electron 46.0.0.*Pin its FFmpeg source/);
	});

	it("stops when a staged package has no license to show", async () => {
		const root = await tree("root", checkout(ELECTRON_SOURCE.version));
		const out = await tree("out", { ...staged, "app/node_modules/bare/package.json": manifest("bare", "1.0.0") });
		await expect(
			stageNotices({ root, out, target: { platform: "win32", arch: "x64" }, node: "26.13.0" }),
		).rejects.toThrow(/bare 1.0.0 declares no license/);
	});
});
