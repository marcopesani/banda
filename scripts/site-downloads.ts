import { readFile, writeFile } from "node:fs/promises";

export type Release = {
	tag_name: string;
	published_at: string | null;
	draft?: boolean;
	assets: { name: string; browser_download_url: string }[];
};

const supportedFiles = new Set([
	"desktop/mac/arm64/dmg",
	"desktop/linux/x64/deb",
	"cli/mac/arm64/tar.gz",
	"cli/linux/x64/tar.gz",
	"phone/android/arm64/apk",
]);

/** Newest published asset per platform; Linux desktop is offered only by the latest release. */
export function downloadFiles(releases: Release[]) {
	const files = new Map<string, { url: string; release: Release }>();
	const aliases: Record<string, string> = { x86_64: "x64", amd64: "x64", aarch64: "arm64" };
	const published = releases
		.filter((release) => !release.draft && release.published_at)
		.sort((a, b) => Date.parse(b.published_at ?? "") - Date.parse(a.published_at ?? ""));
	for (const release of published) {
		for (const asset of release.assets) {
			const match = /^banda-(cli-)?.+-(mac|win|linux|android)-([a-z0-9_]+)\.(tar\.gz|[A-Za-z]+)$/.exec(asset.name);
			if (!match) continue;
			const [, cli, os, arch, ext] = match;
			const kind = cli ? "cli" : os === "android" ? "phone" : "desktop";
			if (
				kind === "desktop" &&
				os === "linux" &&
				(release !== published[0] || !["x64", "amd64"].includes(arch) || ext !== "deb")
			)
				continue;
			const key = `${kind}/${os}/${aliases[arch] ?? arch}/${ext}`;
			if (!supportedFiles.has(key)) continue;
			if (!files.has(key)) files.set(key, { url: asset.browser_download_url, release });
		}
	}
	return files;
}

const escapeHtml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function updateDownloads(html: string, releases: Release[]) {
	const files = downloadFiles(releases);
	let count = 0;
	const updated = html.replace(
		/<(a|span) data-file="([^"]+)"[^>]*>(.*?)<\/\1>/gs,
		(_match, _tag: string, key: string, content: string) => {
			const file = files.get(key);
			const linux = key.startsWith("desktop/linux/");
			// the hero's shortcut names the platform alone; the downloads list says which package it is
			const name = /Linux \(/.test(content) ? "Linux (Debian, Ubuntu, x64)" : "Linux";
			const label = linux ? content.replace(/Linux[^<]*$/, name) : content;
			if (!file) {
				// what the latest release lacks stays in its place, disabled: the page dims a span that names a file
				if (linux) return `<span data-file="${key}" title="Not in the latest release">${label}</span>`;
				throw new Error(`No published download for ${key}`);
			}
			const url = new URL(file.url);
			if (url.origin !== "https://github.com" || !url.pathname.startsWith("/purrgrammer/banda/releases/download/")) {
				throw new Error(`Not a banda release download: ${file.url}`);
			}
			count++;
			return `<a data-file="${key}" href="${escapeHtml(file.url)}">${label}</a>`;
		},
	);
	if (!count) throw new Error("No download links found in landing page");
	return updated;
}

if (import.meta.main) {
	const input = process.argv[2];
	if (!input) throw new Error("Usage: node scripts/site-downloads.ts <releases.json>");
	// gh api --paginate --slurp emits an array of pages; a single page works too.
	const releases: Release[] = JSON.parse(await readFile(input, "utf8")).flat();
	const path = new URL("../site/index.html", import.meta.url);
	await writeFile(path, updateDownloads(await readFile(path, "utf8"), releases));
}
