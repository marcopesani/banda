/**
 * A manual run of the hosted app (web/vercel.json): the app built as Vercel builds it, its files on a loopback port,
 * each sent with the headers Vercel is told to send, opened in headless Chrome at desktop and phone width. It checks
 * what the origin owes before any daemon is reached: the page opens on pairing and holds to its policy while its
 * endpoint loads and reaches for a relay, Chrome takes its manifest as one it can install, its worker takes the page,
 * and the shell it kept opens with the origin gone. And that the build any other place serves carries no endpoint.
 * `node test/smoke/hosted.ts [a folder for the screenshots]`. It reaches n0's relays, so it is never a test; what
 * Vercel itself makes of the file is not tried.
 */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, relative } from "node:path";
import { promisify } from "node:util";
import { withPage } from "./chrome.ts";

const root = join(import.meta.dirname, "../..");
const web = join(root, "web");
const shots = process.argv[2] ?? join(tmpdir(), "banda-hosted");

const { headers: rules, buildCommand } = JSON.parse(await readFile(join(web, "vercel.json"), "utf8")) as {
	buildCommand: string;
	headers: { source: string; headers: { key: string; value: string }[] }[];
};

/** The app built into a folder of its own, with what the environment names: never over web/dist, which a daemon serves. */
const builds = await mkdtemp(join(tmpdir(), "banda-hosted-build-"));
async function build(name: string, env: Record<string, string>): Promise<string> {
	const dir = join(builds, name);
	// the build's own plugins find its folder from the app's: named from there, as `dist` is
	await promisify(execFile)(
		join(root, "node_modules/.bin/vite"),
		["build", "web", "--outDir", relative(web, dir), "--emptyOutDir"],
		{ cwd: root, env: { ...process.env, ...env } },
	);
	return dir;
}
/** What Vercel's build command sets before it builds: `NAME=value` words ahead of the command. */
const flags = Object.fromEntries(
	buildCommand
		.split(" ")
		.filter((word) => /^[A-Z_]+=/.test(word))
		.map((word) => word.split("=") as [string, string]),
);
const [dist, plain] = await Promise.all([build("hosted", flags), build("plain", {})]);

/** The files of a build that are, or name, the browser's endpoint. */
const endpointIn = async (dir: string) => {
	const found: string[] = [];
	for (const name of await readdir(join(dir, "assets"))) {
		if (name.endsWith(".wasm")) found.push(name);
		else if (name.endsWith(".js") && (await readFile(join(dir, "assets", name), "utf8")).includes("banda_iroh_web"))
			found.push(name);
	}
	return found;
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
	".wasm": "application/wasm",
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
// localhost: a secure context, as the hosted origin is, so the worker registers and the key can be sealed
const url = `http://localhost:${(origin.address() as AddressInfo).port}/`;

await mkdir(shots, { recursive: true });
let failed = false;
const check = (where: number | string, what: string, ok: boolean, detail: unknown = "") => {
	if (!ok) failed = true;
	const place = typeof where === "number" ? `${where}px` : where;
	console.log(`${ok ? "ok  " : "FAIL"} ${place}  ${what}${ok ? "" : `  ${JSON.stringify(detail)}`}`);
};

try {
	const carried = await endpointIn(dist);
	check(
		"build",
		"the hosted build carries the browser's endpoint",
		carried.some((name) => name.endsWith(".wasm")),
		carried,
	);
	check(
		"build",
		"the build any other place serves carries none of it",
		(await endpointIn(plain)).length === 0,
		await endpointIn(plain),
	);

	const shows = "document.querySelector('h1')?.textContent === 'Pair this phone with banda'";
	for (const size of [
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 },
	]) {
		up = true;
		await withPage(url, size, async (page) => {
			// pairing shows once the endpoint is bound: its WebAssembly compiled under the page's policy
			await page.until(shows, 40_000);
			check(size.width, "the page opens on pairing, its endpoint bound", true);

			const policy = await page.run<string | null>(
				`fetch("/").then((response) => response.headers.get("content-security-policy"))`,
			);
			check(
				size.width,
				"the page is sent the hosted policy",
				policy?.includes("'wasm-unsafe-eval'") === true && policy.includes("frame-ancestors 'none'"),
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
			await page.until(shows, 40_000);
			// long enough for the endpoint to reach for its relay under the policy
			await new Promise((resolve) => setTimeout(resolve, 3000));
			check(
				size.width,
				"nothing the page loads or reaches breaks its policy",
				page.errors().length === 0,
				page.errors(),
			);
			await page.shoot(join(shots, `hosted-${size.width}.png`));

			up = false;
			await page.reload();
			await page.until(shows, 40_000);
			check(size.width, "the shell opens with the origin gone, its endpoint from the worker's cache", true);
			await page.shoot(join(shots, `hosted-${size.width}-offline.png`));
		});
	}
} finally {
	origin.closeAllConnections();
	origin.close();
	await rm(builds, { recursive: true, force: true });
}
console.log(`screenshots: ${shots}`);
if (failed) process.exitCode = 1;
