import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { downloadFiles, type Release, updateDownloads } from "../scripts/site-downloads.ts";

const release = (tag: string, date: string, names: string[], draft = false): Release => ({
	tag_name: tag,
	published_at: date,
	draft,
	assets: [...names, "SHA256SUMS"].map((name) => ({
		name,
		browser_download_url: `https://github.com/purrgrammer/banda/releases/download/${tag}/${name}`,
	})),
});

describe("landing downloads", () => {
	it("keeps desktop downloads when the newest release updates only Android, sorted by publication", () => {
		const files = downloadFiles([
			release("old-android", "2026-11-01", ["banda-1-android-arm64.apk"]),
			release("desktop", "2026-11-02", ["banda-1-mac-arm64.dmg", "banda-cli-1-linux-x64.tar.gz"]),
			release("new-android", "2026-11-03", ["banda-2-android-arm64.apk"]),
			release("draft", "2026-11-04", ["banda-3-mac-arm64.dmg"], true),
		]);
		expect(files.get("desktop/mac/arm64/dmg")?.release.tag_name).toBe("desktop");
		expect(files.get("cli/linux/x64/tar.gz")?.release.tag_name).toBe("desktop");
		expect(files.get("phone/android/arm64/apk")?.release.tag_name).toBe("new-android");
	});

	it("offers only x64 Debian desktop assets and excludes unsigned APKs", () => {
		const files = downloadFiles([
			release("v1", "2026-11-01", [
				"banda-1-linux-x86_64.AppImage",
				"banda-1-linux-amd64.deb",
				"banda-1-linux-aarch64.AppImage",
				"banda-1-android-arm64-unsigned.apk",
			]),
		]);
		expect([...files.keys()]).toEqual(["desktop/linux/x64/deb"]);
	});

	it("does not offer unsupported downloads even when old releases contain them", () => {
		const files = downloadFiles([
			release("old", "2026-11-01", [
				"banda-1-win-x64.exe",
				"banda-cli-1-win-x64.zip",
				"banda-1-mac-x64.dmg",
				"banda-cli-1-mac-x64.tar.gz",
				"banda-1-linux-arm64.deb",
				"banda-cli-1-linux-arm64.tar.gz",
			]),
			release("new", "2026-11-02", ["banda-2-mac-arm64.dmg", "banda-2-linux-amd64.deb"]),
		]);
		expect([...files.keys()]).toEqual(["desktop/mac/arm64/dmg", "desktop/linux/x64/deb"]);
	});

	it("bakes direct links and the matching checksums into HTML, without browser API access", async () => {
		const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
		const names = [...html.matchAll(/data-file="([^"]+)"/g)].map(([, key]) => {
			const [kind, os, arch, ext] = key.split("/");
			return `banda-${kind === "cli" ? "cli-" : ""}2-${os}-${arch}.${ext}`;
		});
		const releases = [
			release(
				"v2",
				"2026-11-03",
				names.filter((name) => !name.includes("android")),
			),
			release("phone2", "2026-11-02", ["banda-2-android-arm64.apk"]),
			release("old-intel", "2026-10-01", ["banda-1-mac-x64.dmg", "banda-cli-1-mac-x64.tar.gz"]),
		];
		const result = updateDownloads(html, releases);
		const links = [...result.matchAll(/data-file="([^"]+)" href="([^"]+)"/g)];
		// every file once in the list, and each shortcut to one (the hero's) follows the release too
		expect(new Set(links.map(([, key]) => key)).size).toBe(5);
		expect(result).not.toContain("mac-x64");
		for (const [, key, url] of links)
			expect(url).toContain(`/releases/download/${key.startsWith("phone") ? "phone2" : "v2"}/`);
		expect(result).toContain("/v2/SHA256SUMS");
		expect(result).toContain("/phone2/SHA256SUMS");
		expect(result).not.toContain("api.github.com");
		expect(updateDownloads(result, releases)).toBe(result);
		expect(() => updateDownloads(html, [])).toThrow("No published download");
	});
});

for (const arch of ["x64", "amd64"]) {
	it(`selects ${arch} Debian from the latest published release without reviving older Linux packages`, () => {
		const files = downloadFiles([
			release("old", "2026-11-01", ["banda-1-linux-amd64.deb", "banda-1-linux-x86_64.AppImage"]),
			release("new", "2026-11-02", [
				`banda-2-linux-${arch}.deb`,
				"banda-2-linux-arm64.deb",
				"banda-2-linux-x86_64.AppImage",
			]),
			release("draft", "2026-11-03", ["banda-3-linux-amd64.deb"], true),
		]);
		expect([...files.keys()]).toEqual(["desktop/linux/x64/deb"]);
		expect(files.get("desktop/linux/x64/deb")?.release.tag_name).toBe("new");
	});
}

it("removes a previously published Debian link when the latest release has no suitable Linux desktop", () => {
	const old = release("old", "2026-11-01", ["banda-1-linux-amd64.deb", "banda-1-mac-arm64.dmg", "banda-1-win-x64.exe"]);
	const html =
		'<span data-file="desktop/linux/x64/deb"><i aria-hidden="true"></i>Linux (Debian, x64) unavailable</span><a data-file="desktop/mac/arm64/dmg" href="old">macOS</a><!-- checksums:start --><!-- checksums:end -->';
	const available = updateDownloads(html, [old]);
	expect(available).toContain(
		'<a data-file="desktop/linux/x64/deb" href="https://github.com/purrgrammer/banda/releases/download/old/banda-1-linux-amd64.deb">',
	);
	expect(updateDownloads(available, [old])).toBe(available);
	for (const names of [
		["banda-2-linux-x86_64.AppImage"],
		["banda-2-linux-arm64.deb"],
		["banda-2-android-arm64.apk"],
		[],
	]) {
		const current = [old, release("new", "2026-11-02", names)];
		const unavailable = updateDownloads(available, current);
		expect(unavailable).toContain(
			'<span data-file="desktop/linux/x64/deb"><i aria-hidden="true"></i>Linux (Debian, x64) unavailable</span>',
		);
		expect(unavailable).not.toContain(".deb");
		expect(unavailable).not.toContain(".AppImage");
		expect(unavailable).toContain("/old/banda-1-mac-arm64.dmg");
		expect(unavailable).not.toContain("/old/banda-1-win-x64.exe");
		expect(updateDownloads(unavailable, current)).toBe(unavailable);
		expect(updateDownloads(unavailable, [old])).toBe(available);
	}
});
