/**
 * The real box the box suites run against, by `BANDA_TEST_BOX`: `microvm`, the computer banda ships (a dev bundle in
 * `computer/`, from `node scripts/microvm-bundle.ts --prepare`, and KVM on Linux), or `container`, the box in Docker
 * (`serve --box container`). Unset, it is the platform's default box. A box named must be there: the suite fails when it
 * is not, so a missing runtime is never a pass. Unset, a suite skips where there is none, as on a development machine.
 *
 * The computer's box image carries less than the container's (no git, python3 or procps: agents install into /tools),
 * so `BANDA_TEST_BOX_TOOLS` names a folder of software to put in a home's /tools (test/fixtures/box-git.sh makes git's).
 *
 * Each suite also gets a stand-in site for the internet beside the proxy, so no test needs the real network: in Docker a
 * container on a network of public addresses (11.x, routed nowhere) that the proxy joins; on the computer a server on
 * this machine at such an address, which CI gives a dummy interface and names in /etc/hosts (site-names.ts).
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { constants } from "node:fs";
import { access, copyFile, cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe } from "vitest";
import { type BoxKind, type BoxSetup, defaultBox } from "../../src/box/box.ts";
import { boxParts, containerBox, dockerAvailable, removeContainerBox } from "../../src/box/container.ts";
import { homeComputers, microvmBox } from "../../src/box/microvm.ts";
import { installedMicrovmAssets, microvmTarget } from "../../src/box/microvm-assets.ts";
import { until } from "../helpers.ts";
import { type SiteLabel, siteName } from "./site-names.ts";

type Kind = Exclude<BoxKind, "host">;
type Part = "box" | "proxy";

/** A stand-in site: a server on port 8080 started by `start` (sh), under each of its names. */
export type SiteSpec = {
	readonly labels: readonly SiteLabel[];
	/** The image the container runs it in: Python's (mitmproxy's) or the box's own (git). The computer's runs here. */
	readonly image: "python" | "box";
	/** Its environment, besides `BIND` (the address to listen on), `ROOT` and `SEED` (folders of its own). */
	readonly env: Readonly<Record<string, string>>;
	readonly start: string;
};

export type Site = {
	/** The name `label` reaches it by, through the proxy. */
	host(label: SiteLabel): string;
	/** Its address, which the box must not reach directly. */
	readonly address: string;
	/** What it printed, line by line. */
	output(): string[];
	/** `command` run with sh beside it, in its environment. */
	exec(command: string): string;
	close(): Promise<void>;
};

export type RealBox = {
	readonly kind: Kind;
	/** Why it cannot run here, or undefined when it can. */
	readonly missing: string | undefined;
	/** Whether `BANDA_TEST_BOX` named it: then no case may skip for want of something, it fails instead. */
	readonly named: boolean;
	setup(home: string): BoxSetup;
	/** Remove the home's box and what it keeps outside the home. */
	remove(home: string): Promise<void>;
	/** `command` run with sh in the box or its proxy, past pi-env, as their own user: what a command there could do. */
	exec(home: string, part: Part, command: string): Promise<string>;
	/** Whether that part of the home's box is up. */
	running(home: string, part: Part): Promise<boolean>;
	/** Destroy the box, its proxy left, as a crash would. */
	destroy(home: string): Promise<void>;
	/** The uid its commands run as. */
	readonly uid: number;
	/** The name a stand-in site of `label` answers to, known before it starts (a credential can name it). */
	host(label: SiteLabel): string;
	/** Bring up a stand-in site beside the proxy of the home's box, which is up, and wait until the proxy reaches it. */
	site(home: string, spec: SiteSpec): Promise<Site>;
	/**
	 * Put what `BANDA_TEST_BOX_TOOLS` names into /tools of the home's box, which is up, as software an agent installed
	 * there; whether it put any. Nothing for a box whose image carries what the suites run, or where it is unset.
	 */
	tools(home: string): Promise<boolean>;
	/** Give the home the browser's pinned archive, so starting the browser needs no network (the computer downloads it). */
	offlineBrowser(home: string): Promise<void>;
};

const requested = process.env.BANDA_TEST_BOX;
if (requested !== undefined && requested !== "microvm" && requested !== "container")
	throw new Error(`BANDA_TEST_BOX is microvm or container, not ${requested}`);
const kind: Kind = requested ?? (defaultBox() === "microvm" ? "microvm" : "container");

/** This file's run, in the names of what Docker holds for it: each test file loads the fixture anew. */
const tag = randomUUID().slice(0, 8);
const containerHost = (label: SiteLabel) => `${label}-${tag}.example`;
const MITMPROXY = "mitmproxy/mitmproxy:12.2.3@sha256:00b77b5d8804c8ad18cb6caefbf9d5849e895e8986c5ce011f4ae30f4385962f";
const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", timeout: 120_000 }).trim();
const gitIdentity = {
	GIT_AUTHOR_NAME: "forge",
	GIT_AUTHOR_EMAIL: "forge@site",
	GIT_COMMITTER_NAME: "forge",
	GIT_COMMITTER_EMAIL: "forge@site",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
};
const reaches = (host: string) =>
	`/usr/local/bin/python3 -c 'import socket; socket.create_connection(("${host}", 8080), 2)'`;

async function why(): Promise<string | undefined> {
	if (kind === "container") return (await dockerAvailable()) ? undefined : "Docker is not available";
	if (microvmTarget(process) === undefined) return `the computer is not built for ${process.platform}-${process.arch}`;
	if (process.platform === "linux") {
		const kvm = await access("/dev/kvm", constants.R_OK | constants.W_OK).then(
			() => undefined,
			() => "this account cannot open /dev/kvm",
		);
		if (kvm !== undefined) return kvm;
	}
	return installedMicrovmAssets().then(
		() => undefined,
		(error: unknown) => `no computer bundle (node scripts/microvm-bundle.ts --prepare): ${String(error)}`,
	);
}

const missing = await why();
if (requested !== undefined && missing !== undefined)
	throw new Error(`BANDA_TEST_BOX=${requested} names a box that cannot run here: ${missing}`);

async function containerSite(home: string, spec: SiteSpec): Promise<Site> {
	const pub = `banda-test-${tag}-pub`;
	const name = `banda-test-${tag}-site`;
	const { box, proxy } = boxParts(home);
	const host = containerHost;
	const env = { ...spec.env, ...gitIdentity, BIND: "0.0.0.0", ROOT: "/srv", SEED: "/tmp/seed" };
	const close = async () => {
		for (const args of [
			["rm", "--force", name],
			["network", "disconnect", "--force", pub, proxy],
			["network", "rm", pub],
		])
			try {
				docker(args);
			} catch {
				// not made
			}
	};
	try {
		const image = spec.image === "box" ? docker(["inspect", "--format", "{{.Config.Image}}", box]) : MITMPROXY;
		const octet = 16 + Math.floor(Math.random() * 200);
		docker(["network", "create", "--subnet", `11.${octet}.${Math.floor(Math.random() * 250)}.0/24`, pub]);
		docker(["network", "connect", pub, proxy]);
		docker([
			"run",
			"--detach",
			"--name",
			name,
			// swept with the home if the test dies before its own teardown
			"--label",
			`banda.home=${home}`,
			"--network",
			pub,
			...spec.labels.flatMap((label) => ["--network-alias", host(label)]),
			// root, so the box's own image can make its folders
			"--user",
			"0",
			...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
			"--entrypoint",
			"sh",
			image,
			"-c",
			spec.start,
		]);
		const first = host(spec.labels[0]!);
		await until(() => {
			try {
				return docker(["exec", proxy, "sh", "-c", reaches(first)]) === "";
			} catch {
				return false;
			}
		}, 200);
		return {
			host,
			address: docker(["inspect", "--format", `{{(index .NetworkSettings.Networks "${pub}").IPAddress}}`, name]),
			output: () => docker(["logs", name]).split("\n").filter(Boolean),
			exec: (command) =>
				docker(["exec", ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), name, "sh", "-c", command]),
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
}

/** The home's computer of `part`, the one running where an earlier generation is still being retired. */
async function computer(home: string, part: Part | "browser") {
	const computers = await homeComputers(home);
	const named = (await computers.list()).filter((vm) =>
		part === "box" ? !vm.name.endsWith("-proxy") && !vm.name.endsWith("-browser") : vm.name.endsWith(`-${part}`),
	);
	const running = named.filter((vm) => vm.status === "Running");
	const chosen = running.length === 1 ? running[0] : named.length === 1 ? named[0] : undefined;
	return chosen === undefined ? undefined : { computers, name: chosen.name, status: chosen.status };
}

async function computerSite(spec: SiteSpec): Promise<Site> {
	const address = process.env.BANDA_TEST_SITE;
	if (address === undefined || !/^11\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address))
		throw new Error(
			"The computer's stand-in site needs BANDA_TEST_SITE, a 11.x address on a dummy interface whose names " +
				"(node test/fixtures/site-names.ts <address>) are in /etc/hosts, as CI's computer job provisions.",
		);
	for (const label of spec.labels) {
		const found = await lookup(siteName(label), { family: 4 }).catch(() => undefined);
		if (found?.address !== address)
			throw new Error(
				`${siteName(label)} must resolve to ${address} in /etc/hosts, not ${found?.address ?? "nothing"}`,
			);
	}
	const root = await mkdtemp(join(tmpdir(), "banda-site-"));
	await mkdir(join(root, "srv"));
	const env = {
		PATH: "/usr/local/bin:/usr/bin:/bin",
		HOME: root,
		LANG: "C.UTF-8",
		...spec.env,
		...gitIdentity,
		BIND: address,
		ROOT: join(root, "srv"),
		SEED: join(root, "seed"),
	};
	const server = spawn("sh", ["-c", spec.start], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
	let out = "";
	let err = "";
	server.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("latin1")));
	server.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
	const exited = new Promise<void>((done) => server.once("exit", () => done()));
	const close = async () => {
		if (server.exitCode === null && server.signalCode === null) {
			server.kill("SIGTERM");
			const killing = setTimeout(() => server.kill("SIGKILL"), 2_000);
			await exited;
			clearTimeout(killing);
		}
		await rm(root, { recursive: true, force: true });
	};
	try {
		await until(() => {
			if (server.exitCode !== null || server.signalCode !== null)
				throw new Error(`The stand-in site exited: ${err.slice(-2000)}`);
			try {
				execFileSync("python3", ["-c", `import socket; socket.create_connection(("${address}", 8080), 1)`]);
				return true;
			} catch {
				return false;
			}
		}, 100);
		return {
			host: siteName,
			address,
			output: () => out.split("\n").filter(Boolean),
			exec: (command) => execFileSync("sh", ["-c", command], { cwd: root, env, encoding: "utf8" }).trim(),
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
}

const container: RealBox = {
	kind: "container",
	missing,
	named: requested !== undefined,
	setup: containerBox,
	remove: removeContainerBox,
	exec: async (home, part, command) => docker(["exec", boxParts(home)[part], "sh", "-c", command]),
	running: async (home, part) => {
		try {
			return docker(["inspect", "--format", "{{.State.Running}}", boxParts(home)[part]]) === "true";
		} catch {
			return false;
		}
	},
	destroy: async (home) => void docker(["rm", "--force", boxParts(home).box]),
	uid: process.getuid?.() ?? 0,
	host: containerHost,
	site: containerSite,
	// its image carries git and the rest the suites run
	tools: async () => false,
	// the container's browser is a target of the box's image, built on this machine
	offlineBrowser: async () => {},
};

const computerBox: RealBox = {
	kind: "microvm",
	missing,
	named: requested !== undefined,
	setup: microvmBox,
	remove: async (home) => {
		await (await homeComputers(home)).removeAll();
	},
	exec: async (home, part, command) => {
		const found = await computer(home, part);
		if (found === undefined) throw new Error(`The home has no ${part} computer up.`);
		return (await found.computers.exec(found.name, ["/bin/sh", "-c", command])).trim();
	},
	// not yet listed, as before its first bring-up made the runtime's cache, is not up
	running: async (home, part) => (await computer(home, part).catch(() => undefined))?.status === "Running",
	destroy: async (home) => {
		const found = await computer(home, "box");
		if (found === undefined) throw new Error("The home has no box computer to destroy.");
		await found.computers.remove(found.name);
	},
	// every computer runs its commands as the image's ordinary user, whoever runs banda
	uid: 1000,
	host: siteName,
	site: async (home, spec) => {
		const site = await computerSite(spec);
		try {
			const first = site.host(spec.labels[0]!);
			await until(async () => {
				try {
					return (await computerBox.exec(home, "proxy", reaches(first))) === "";
				} catch {
					return false;
				}
			}, 200);
			return site;
		} catch (error) {
			await site.close();
			throw error;
		}
	},
	tools: async (home) => {
		const staged = process.env.BANDA_TEST_BOX_TOOLS;
		if (staged === undefined || staged === "") return false;
		// /tools is this folder of the home, mounted in (DESIGN.md "The box")
		await cp(staged, join(await realpath(home), "computer", "tools"), { recursive: true, verbatimSymlinks: true });
		return true;
	},
	offlineBrowser: async (home) => {
		const { browser } = await installedMicrovmAssets();
		const archive = resolve(import.meta.dirname, "../../release", new URL(browser.url).pathname.split("/").at(-1)!);
		let directory = home;
		for (const part of ["cache", "computer", "browser"]) {
			directory = join(directory, part);
			await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "EEXIST") throw error;
			});
		}
		await copyFile(archive, join(directory, `${browser.sha256}.tar`)).catch((error: unknown) => {
			throw new Error(
				`The browser's archive is not at ${archive} (microvm-bundle.ts --prepare puts it there): ${error}`,
			);
		});
	},
};

export const realBox: RealBox = kind === "container" ? container : computerBox;

/** A suite of the real box: skipped where there is none, unless one was named (then it failed above). */
export const boxSuite = describe.skipIf(missing !== undefined);
