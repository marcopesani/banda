/**
 * `npm run desktop:linux`: build the Linux desktop app with Docker, from any computer, and use it on each distribution
 * banda supports. It never touches ~/.banda: every run is a fresh container, with its own home.
 *
 *   build  a copy of the checkout (release/linux/src, so Linux's node_modules never replace this computer's) is
 *          packaged inside desktop/try/builder.Dockerfile exactly as `npm run desktop:pack` does it. The copy sits at
 *          the same path inside the builder as outside it, and the engine's socket is mounted in: the computer's images
 *          and its runtime are built by sibling containers, which mount folders by the engine's own paths.
 *   try    on each distribution (DISTRIBUTIONS), under X11 and under Wayland: a clean root installs the package with
 *          only the dependencies it declares and every bundled binary must find its libraries; then
 *          desktop/try/drive.mjs uses the app as an ordinary user. Evidence lands in release/linux/try/.
 *
 *   --skip-build         try the package the last build left
 *   --only <name,...>    some distributions only, by the names in DISTRIBUTIONS
 *   --session <x11|wayland>
 *   --mac                `npm run desktop:try`: the same use of the app `npm run desktop:pack` left on this Mac, on
 *                        its own screen, a throwaway home and a port of its own
 *
 * The package is for the Docker engine's CPU. The engine has no KVM on a Mac, so the computer itself is not started
 * here: `scripts/verify-linux-computer.ts` does that in CI. Chromium's sandbox stays on, as installed: the containers
 * only lift Docker's seccomp filter, which otherwise refuses the user namespaces an ordinary desktop allows.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

/** The distributions a release is tried on: the Debian and Ubuntu releases still supported whose glibc the package asks for. */
export const DISTRIBUTIONS = {
	"debian-12": "debian:bookworm-slim",
	"debian-13": "debian:trixie-slim",
	"ubuntu-22.04": "ubuntu:22.04",
	"ubuntu-24.04": "ubuntu:24.04",
	"ubuntu-26.04": "ubuntu:26.04",
} as const;
export type Distribution = keyof typeof DISTRIBUTIONS;
const SESSIONS = ["x11", "wayland"] as const;

/** What the copy keeps of its own between builds: installed dependencies, build output, and the release with its caches. */
const KEPT = new Set(["node_modules", "dist", "release", "computer"]);

const root = join(import.meta.dirname, "..");
const out = join(root, "release", "linux");
const tree = join(out, "src");
const docker = (args: string[], options: { quiet?: boolean } = {}) =>
	spawnSync("docker", args, { stdio: options.quiet ? ["ignore", "ignore", "inherit"] : "inherit" }).status ?? 1;

/** Make release/linux/src the checkout as it is now (tracked files and new ones, never ignored ones). */
async function copyCheckout(): Promise<void> {
	const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 64 << 20,
	});
	const files = new Set(listed.split("\0").filter((file) => file !== ""));
	const stale = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
			const path = join(directory, entry.name);
			if (KEPT.has(entry.name)) continue;
			if (entry.isDirectory()) await stale(path);
			else if (!files.has(relative(tree, path))) await rm(path);
		}
	};
	await stale(tree);
	for (const file of files) {
		const from = await stat(join(root, file)).catch(() => undefined);
		if (from === undefined || !from.isFile()) continue; // deleted in the working tree, or a submodule
		const to = await stat(join(tree, file)).catch(() => undefined);
		if (to !== undefined && to.size === from.size && to.mtimeMs === from.mtimeMs) continue;
		await mkdir(dirname(join(tree, file)), { recursive: true });
		await cp(join(root, file), join(tree, file), { preserveTimestamps: true });
	}
}

async function build(): Promise<void> {
	await copyCheckout();
	const context = join(root, "desktop", "try");
	if (
		docker(
			["build", "--quiet", "--tag", "banda-linux-builder", "--file", join(context, "builder.Dockerfile"), context],
			{ quiet: true },
		) !== 0
	)
		throw new Error("The builder image did not build.");
	await rm(join(tree, "release", "desktop"), { recursive: true, force: true });
	const status = docker([
		"run",
		"--rm",
		"--volume",
		"/var/run/docker.sock:/var/run/docker.sock",
		"--volume",
		`${tree}:${tree}`,
		"--workdir",
		tree,
		"banda-linux-builder",
		"bash",
		"desktop/try/build.sh",
	]);
	if (status !== 0) throw new Error(`The Linux build failed (exit ${status}).`);
}

/** The one package the last build left. */
async function builtPackage(): Promise<string> {
	const directory = join(tree, "release", "desktop");
	const packages = (await readdir(directory).catch(() => [])).filter((name) => /^banda-.*-linux-.*\.deb$/.test(name));
	if (packages.length !== 1) throw new Error(`Expected one package in ${directory}; run without --skip-build.`);
	return join(directory, packages[0] as string);
}

/** A clean root, the package's declared dependencies alone, and every bundled binary's libraries found. */
function dependencies(base: string, packageDirectory: string): boolean {
	const script = `
set -eu
apt-get update >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends /package/*.deb >/dev/null
for binary in /opt/banda/banda-desktop /opt/banda/chrome_crashpad_handler /opt/banda/resources/banda/node/node /opt/banda/resources/banda/app/computer/msb; do
	test -x "$binary"
	if ldd "$binary" | grep 'not found'; then echo "$binary misses a library"; exit 1; fi
done
/opt/banda/resources/banda/node/node --version >/dev/null
`;
	return docker(["run", "--rm", "--volume", `${packageDirectory}:/package:ro`, base, "sh", "-c", script]) === 0;
}

type Tried = { name: string; passed: boolean; failed: string[] };

async function tryOn(name: Distribution, session: (typeof SESSIONS)[number], packageDirectory: string): Promise<Tried> {
	const context = join(root, "desktop", "try");
	const image = `banda-linux-try:${name}`;
	const evidence = join(out, "try", `${name}-${session}`);
	await rm(evidence, { recursive: true, force: true });
	await mkdir(evidence, { recursive: true });
	if (
		docker(
			[
				"build",
				"--quiet",
				"--tag",
				image,
				"--build-arg",
				`BASE=${DISTRIBUTIONS[name]}`,
				"--file",
				join(context, "linux.Dockerfile"),
				context,
			],
			{ quiet: true },
		) !== 0
	)
		return { name: `${name} ${session}`, passed: false, failed: ["the desktop image did not build"] };
	docker([
		"run",
		"--rm",
		"--security-opt",
		"seccomp=unconfined",
		"--shm-size",
		"1g",
		"--volume",
		`${packageDirectory}:/package:ro`,
		"--volume",
		`${evidence}:/out`,
		image,
		session,
	]);
	const text = await readFile(join(evidence, "result.json"), "utf8").catch(() => undefined);
	if (text === undefined) return { name: `${name} ${session}`, passed: false, failed: ["no result; see install.log"] };
	const result = JSON.parse(text) as { passed: boolean; checks: { name: string; ok: boolean }[] };
	return {
		name: `${name} ${session}`,
		passed: result.passed,
		failed: result.checks.filter((check) => !check.ok).map((check) => check.name),
	};
}

/** The app `npm run desktop:pack` left on this Mac, on a throwaway home and a port of its own. */
async function tryMac(): Promise<boolean> {
	const bundle = join(root, "release", "desktop", "mac-arm64", "banda.app", "Contents");
	const evidence = join(root, "release", "mac", "try");
	await rm(evidence, { recursive: true, force: true });
	await mkdir(evidence, { recursive: true });
	const home = await mkdtemp(join(tmpdir(), "banda-try-"));
	try {
		const status = spawnSync(
			join(bundle, "Resources", "banda", "node", "node"),
			[join(root, "desktop", "try", "drive.mjs"), "mac", evidence, join(bundle, "MacOS", "banda")],
			{ stdio: "inherit", env: { ...process.env, BANDA_HOME: home } },
		).status;
		console.log(`Evidence: ${evidence}`);
		return status === 0;
	} finally {
		await rm(home, { recursive: true, force: true, maxRetries: 5 });
	}
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			"skip-build": { type: "boolean" },
			only: { type: "string" },
			session: { type: "string" },
			mac: { type: "boolean" },
		},
	});
	if (values.mac) process.exit((await tryMac()) ? 0 : 1);
	const names = (values.only?.split(",") ?? Object.keys(DISTRIBUTIONS)) as Distribution[];
	for (const name of names) if (!(name in DISTRIBUTIONS)) throw new Error(`Unknown distribution ${name}.`);
	const sessions = SESSIONS.filter((session) => values.session === undefined || values.session === session);
	if (sessions.length === 0) throw new Error("--session is x11 or wayland.");
	if (!values["skip-build"]) await build();
	const built = await builtPackage();
	// one folder with the package alone, so a container mounts nothing else of the release
	const packageDirectory = join(out, "package");
	await rm(packageDirectory, { recursive: true, force: true });
	await mkdir(packageDirectory, { recursive: true });
	await cp(built, join(packageDirectory, built.slice(dirname(built).length + 1)));
	const tried: Tried[] = [];
	for (const name of names) {
		console.log(`\n== ${name}: the package's dependencies in a clean root`);
		const loads = dependencies(DISTRIBUTIONS[name], packageDirectory);
		tried.push({ name: `${name} dependencies`, passed: loads, failed: loads ? [] : ["a binary misses a library"] });
		if (!loads) continue;
		for (const session of sessions) {
			console.log(`\n== ${name}: the app under ${session}`);
			tried.push(await tryOn(name, session, packageDirectory));
		}
	}
	console.log(`\n${built}`);
	for (const each of tried)
		console.log(
			`${each.passed ? "passed" : "FAILED"}  ${each.name}${each.failed.length === 0 ? "" : `: ${each.failed.join("; ")}`}`,
		);
	console.log(`Evidence: ${join(out, "try")}`);
	if (tried.some((each) => !each.passed)) process.exitCode = 1;
}
