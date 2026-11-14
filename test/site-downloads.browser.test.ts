import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Release, updateDownloads } from "../scripts/site-downloads.ts";
import { type WebServer, webServer } from "./helpers.ts";
import { hasChrome, type Page, withPage } from "./smoke/chrome.ts";

let web: WebServer | undefined;
let base: string;
let releases: Release[] | undefined;
const release = (tag: string, date: string, names: string[]): Release => ({
	tag_name: tag,
	published_at: date,
	assets: [...names, "SHA256SUMS"].map((name) => ({
		name,
		browser_download_url: `https://github.com/purrgrammer/banda/releases/download/${tag}/${name}`,
	})),
});
const older = release("old", "2026-11-01", [
	"banda-1-mac-arm64.dmg",
	"banda-1-win-x64.exe",
	"banda-cli-1-mac-arm64.tar.gz",
	"banda-cli-1-win-x64.zip",
	"banda-cli-1-linux-x64.tar.gz",
	"banda-cli-1-linux-arm64.tar.gz",
	"banda-1-android-arm64.apk",
	"banda-1-linux-x86_64.AppImage",
	"banda-1-linux-arm64.AppImage",
	"banda-1-linux-amd64.deb",
	"banda-1-linux-arm64.deb",
]);

beforeAll(async () => {
	if (!hasChrome()) return;
	web = await webServer({
		configFile: fileURLToPath(new URL("../site/vite.config.ts", import.meta.url)),
		plugins: [
			{
				name: "release-downloads",
				transformIndexHtml: (html) => (releases ? updateDownloads(updateDownloads(html, [older]), releases) : html),
			},
		],
	});
	base = `${web.origin}/site/`;
});
afterAll(async () => {
	await web?.close();
});

async function visit(page: Page, platform: string, system: string) {
	await page.input("Network.enable", {});
	await page.input("Network.setBlockedURLs", {
		urls: ["*api.github.com*", "*fonts.googleapis.com*", "*fonts.gstatic.com*"],
	});
	await page.input("Network.setUserAgentOverride", {
		userAgent: `Mozilla/5.0 (${system}) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36`,
		platform,
	});
	await page.goto(base);
	await page.until(`document.querySelector('#download-label').textContent !== 'Download banda'`);
}

async function proof(page: Page, name: string, width: number) {
	const dir = process.env.BANDA_SITE_PROOF;
	if (!dir) return;
	await mkdir(dir, { recursive: true });
	await page.shoot(`${dir}/${name}-${width}.png`);
}

for (const width of [390, 1440]) {
	for (const [platform, system, extension] of [
		["MacIntel", "Macintosh; Intel Mac OS X 14_0", ".dmg"],
		["Win32", "Windows NT 10.0; Win64; x64", ".exe"],
		["Linux armv8l", "Linux; Android 14; Pixel 8", ".apk"],
	]) {
		it.skipIf(!hasChrome())(`offers ${extension} with GitHub API blocked at ${width}px`, async () => {
			releases = undefined;
			await withPage("about:blank", { width, height: 900 }, async (page) => {
				await visit(page, platform, system);
				expect(await page.run(`document.querySelector('#download').href.endsWith('${extension}')`)).toBe(true);
				expect(
					await page.run(`new Set([...document.querySelectorAll('a[data-file][href]')].map(a => a.dataset.file)).size`),
				).toBe(7);
				expect(await page.run(`document.querySelectorAll('a[data-file*="/mac/x64/"]').length`)).toBe(0);
				expect(
					await page.run(
						`[...document.querySelectorAll('a[data-file][href]')].every(a => a.href.includes('/releases/download/') && a.getBoundingClientRect().height > 0)`,
					),
				).toBe(true);
				expect(await page.run(`document.querySelectorAll('a[data-file^="desktop/linux/"]').length`)).toBe(0);
				expect(await page.run(`document.querySelectorAll('span[data-file="desktop/linux/x64/deb"]').length`)).toBe(2);
				expect(await page.run(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
			});
		});
	}

	for (const arch of ["amd64", "x64"]) {
		it.skipIf(!hasChrome())(
			`selects the published ${arch} Debian desktop instead of an older AppImage at ${width}px`,
			async () => {
				releases = [older, release("new", "2026-11-02", [`banda-2-linux-${arch}.deb`])];
				await withPage("about:blank", { width, height: 900 }, async (page) => {
					await visit(page, "Linux x86_64", "X11; Linux x86_64");
					expect(await page.run(`document.querySelector('#download').getAttribute('href')`)).toBe(
						`https://github.com/purrgrammer/banda/releases/download/new/banda-2-linux-${arch}.deb`,
					);
					expect(await page.run(`document.querySelector('#download-label').textContent`)).toBe(
						"Download for Linux (Debian, x64)",
					);
					expect(
						await page.run(
							`[...document.querySelectorAll('[data-file="desktop/linux/x64/deb"]')].every(a => a.tagName === 'A' && a.href === document.querySelector('#download').href)`,
						),
					).toBe(true);
					expect(
						await page.run(
							`document.querySelectorAll('a[href$=".AppImage"], a[data-file^="desktop/linux/arm64"]').length`,
						),
					).toBe(0);
					expect(await page.run(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
					await proof(page, `linux-deb-${arch}`, width);
				});
			},
		);
	}

	for (const [name, files] of [
		["AppImage only", ["banda-2-linux-x86_64.AppImage"]],
		["ARM Debian only", ["banda-2-linux-arm64.deb"]],
		["no Linux desktop", ["banda-2-mac-arm64.dmg", "banda-2-win-x64.exe"]],
	] as const) {
		it.skipIf(!hasChrome())(`does not offer a stale Linux desktop with ${name} at ${width}px`, async () => {
			releases = [older, release("new", "2026-11-02", [...files])];
			await withPage("about:blank", { width, height: 900 }, async (page) => {
				await visit(page, "Linux x86_64", "X11; Linux x86_64");
				expect(await page.run(`document.querySelector('#download').href`)).toBe(
					"https://github.com/purrgrammer/banda/releases",
				);
				expect(await page.run(`document.querySelector('#download-label').textContent`)).toBe("View releases");
				expect(await page.run(`document.querySelectorAll('a[data-file^="desktop/linux/"]').length`)).toBe(0);
				expect(await page.run(`document.querySelectorAll('span[data-file="desktop/linux/x64/deb"]').length`)).toBe(2);
				expect(
					await page.run(
						`[...document.querySelectorAll('[data-file="desktop/linux/x64/deb"]')].every(el => el.tagName === 'SPAN' && el.textContent.includes('Linux unavailable') && !el.hasAttribute('href') && !el.hasAttribute('role') && !el.hasAttribute('tabindex'))`,
					),
				).toBe(true);
				expect(await page.run(`document.querySelectorAll('a[href$=".AppImage"]').length`)).toBe(0);
				expect(await page.run(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
				if (name === "no Linux desktop") {
					await proof(page, "linux-unavailable", width);
					await page.click(`document.querySelector('#download-sub a[href="#downloads"]')`);
					await page.until(`location.hash === '#downloads'`);
					await proof(page, "downloads-unavailable", width);
				}
			});
		});
	}

	it.skipIf(!hasChrome())(`does not select the x64 Debian desktop on Linux ARM at ${width}px`, async () => {
		releases = [older, release("new", "2026-11-02", ["banda-2-linux-amd64.deb", "banda-2-linux-arm64.deb"])];
		await withPage("about:blank", { width, height: 900 }, async (page) => {
			await visit(page, "Linux aarch64", "X11; Linux");
			expect(await page.run(`document.querySelector('#download').href`)).toBe(
				"https://github.com/purrgrammer/banda/releases",
			);
			expect(await page.run(`document.querySelector('#download-label').textContent`)).toBe("View releases");
			expect(await page.run(`document.querySelectorAll('a[data-file^="desktop/linux/arm64"]').length`)).toBe(0);
		});
	});
}
