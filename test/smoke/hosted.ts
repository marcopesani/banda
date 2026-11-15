/**
 * A manual run of the hosted app (web/vercel.json): the built app's files on a loopback port, each sent with the
 * headers Vercel is told to send, opened in headless Chrome at desktop and phone width. It checks what the origin owes
 * before any daemon is reached: the page holds to its policy, Chrome takes its manifest as one it can install, its
 * worker takes the page, and the shell it kept opens with the origin gone. Build the app first: `npm run build:web`;
 * then `node test/smoke/hosted.ts [a folder for the screenshots]`. What Vercel itself makes of the file is not tried.
 */
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { withPage } from "./chrome.ts";

const web = join(import.meta.dirname, "../../web");
const dist = join(web, "dist");
const shots = process.argv[2] ?? join(tmpdir(), "banda-hosted");

const { headers: rules } = JSON.parse(await readFile(join(web, "vercel.json"), "utf8")) as {
	headers: { source: string; headers: { key: string; value: string }[] }[];
};

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
};

/** Whether the origin answers: turned off to open the app as a phone with no network would. */
let up = true;

const origin = createServer((req, res) => {
	if (!up) return void req.socket.destroy();
	const path = normalize(new URL(req.url ?? "/", "http://local").pathname);
	const file = join(dist, path === "/" ? "index.html" : path);
	// a source matches a whole path; the two written in vercel.json mean the same as regular expressions
	for (const rule of rules)
		if (new RegExp(`^${rule.source}$`).test(path)) for (const { key, value } of rule.headers) res.setHeader(key, value);
	stat(file).then(
		(found) => {
			if (!file.startsWith(dist) || !found.isFile()) return void res.writeHead(404).end();
			res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
			createReadStream(file).pipe(res);
		},
		() => void res.writeHead(404).end(),
	);
});
await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
// localhost: a secure context, as the hosted origin is, so the worker registers
const url = `http://localhost:${(origin.address() as AddressInfo).port}/`;

await mkdir(shots, { recursive: true });
let failed = false;
const check = (width: number, what: string, ok: boolean, detail: unknown = "") => {
	if (!ok) failed = true;
	console.log(`${ok ? "ok  " : "FAIL"} ${width}px  ${what}${ok ? "" : `  ${JSON.stringify(detail)}`}`);
};

try {
	for (const size of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 },
	]) {
		up = true;
		await withPage(url, size, async (page) => {
			const shows = "document.querySelector('h1')?.textContent === 'Connect to banda'";
			await page.until(shows);
			check(size.width, "the page opens", true);

			const policy = await page.run<string | null>(
				`fetch("/").then((response) => response.headers.get("content-security-policy"))`,
			);
			check(
				size.width,
				"the page is sent the app's policy",
				policy?.includes("frame-ancestors 'none'") === true,
				policy,
			);

			const manifest = (await page.input("Page.getAppManifest", {})) as { url: string; errors: unknown[] };
			check(size.width, "Chrome reads the manifest without errors", manifest.errors.length === 0, manifest.errors);
			const { installabilityErrors } = (await page.input("Page.getInstallabilityErrors", {})) as {
				installabilityErrors: { errorId: string }[];
			};
			check(size.width, "Chrome finds the app installable", installabilityErrors.length === 0, installabilityErrors);

			await page.until("navigator.serviceWorker.ready.then(() => true)");
			await page.reload();
			await page.until("navigator.serviceWorker.controller !== null");
			check(size.width, "the worker takes the page", true);
			await page.until(shows);
			check(size.width, "nothing the page loads breaks its policy", page.errors().length === 0, page.errors());
			await page.shoot(join(shots, `hosted-${size.width}.png`));

			up = false;
			await page.reload();
			await page.until(shows);
			check(size.width, "the shell opens with the origin gone", true);
			await page.shoot(join(shots, `hosted-${size.width}-offline.png`));
		});
	}
} finally {
	origin.closeAllConnections();
	origin.close();
}
console.log(`screenshots: ${shots}`);
if (failed) process.exitCode = 1;
