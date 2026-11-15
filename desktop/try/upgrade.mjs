/**
 * An owner's home across an upgrade, as steps of drive.mjs (`BANDA_TRY_STEPS`), which opens the installed app, runs
 * these while it is open, and then quits and reopens it as it always does. Two runs, one home, an install between them:
 *
 *   BANDA_UPGRADE=seed    on the release upgraded from: make what an owner can make with no model provider, through
 *                         the daemon's API as the web UI calls it, and write what was made to seeded.json
 *   BANDA_UPGRADE=check   on the release upgraded to: the home's format moved forward or stayed, the home as it was is
 *                         kept beside it when the format moved, what was made is still there, and `banda backup` then
 *                         `banda restore` give a second home that holds it too
 *
 *   BANDA_UPGRADE_STATE=<folder>     where seeded.json waits between the two runs
 *   BANDA_UPGRADE_VERSION=<version>  the version the installed app must be in this run (the release's tag, without v)
 *
 * With no provider nothing answers, so a chat here is the owner's message and the daemon's "no provider" after it.
 * What cannot be made on a release (its API refuses, or the feature came later) is recorded as not made, and its
 * assertion after the upgrade says "not applicable": never passed, never failed. Each assertion's outcome goes to
 * <out>/upgrade.json. It has no dependencies, like drive.mjs.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CHAT = { message: "0b8f5e0c-56a1-4d0e-9a61-0d7f5a3c1e01", thread: "5f0c9a52-1c0e-4b63-8a51-2f6f1f0a7c01" };
const FILE = { message: "0b8f5e0c-56a1-4d0e-9a61-0d7f5a3c1e02", thread: "5f0c9a52-1c0e-4b63-8a51-2f6f1f0a7c02" };
const ATTACHED = { name: "acceptance.txt", text: "What an owner attached before the upgrade.\n" };
const FACT = "The owner made this fact before the upgrade.";
const NAME = "Rocinante";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The daemon's API with the owner's token, as the web UI and the CLI call it. */
function api(daemon) {
	const send = async (method, path, body, headers = {}) => {
		const response = await fetch(`http://127.0.0.1:${daemon.port}/api${path}`, {
			method,
			headers: { authorization: `Bearer ${daemon.token}`, ...headers },
			...(body === undefined ? {} : { body }),
			signal: AbortSignal.timeout(60_000),
		});
		if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
		return response;
	};
	return {
		get: async (path) => (await send("GET", path)).json(),
		bytes: async (path) => Buffer.from(await (await send("GET", path)).arrayBuffer()),
		send: async (method, path, body) =>
			(await send(method, path, JSON.stringify(body), { "content-type": "application/json" })).json(),
		upload: async (name, bytes) =>
			(await send("POST", "/blobs", bytes, { "x-file-name": encodeURIComponent(name) })).json(),
	};
}

/** The owner's own lines in a chat, by what must not change: the item, the message it came as, its text, its files. */
const said = (items) =>
	items
		.filter((item) => item.role === "user")
		.map(({ id, message, text, files = [] }) => ({
			id,
			message,
			text,
			files: files.map(({ sha, name }) => ({ sha, name })),
		}));

async function seed({ check, until, computer, daemon, out }, about, state) {
	const call = api(daemon);
	const made = {};
	const make = async (name, run) => {
		try {
			made[name] = { made: true, ...(await run()) };
		} catch (error) {
			made[name] = { made: false, why: String(error?.message ?? error) };
		}
	};
	/** A message as the owner, then the chat at rest: with no provider the turn ends with the daemon saying so. */
	const post = async (body) => {
		const { chat } = await call.send("POST", "/messages", body);
		// a chat just made can be listed at rest before its message shows in it and its turn starts
		return until("the chat at rest, with the message in it", async () => {
			const { chats } = await call.get("/status");
			if (!chats.some((each) => each.chat === chat && each.state !== "running")) return undefined;
			const lines = said((await call.get(`/chats/${chat}/items`)).items);
			return lines.some((line) => line.message === body.id) ? { chat, said: lines } : undefined;
		});
	};
	await check("makes what an owner can with no provider", async () => {
		// memory and the companion's file live in the computer's workspace: give it its time to come up, and go on
		// without it where it cannot (a Mac runner), since what then cannot be made is recorded as not made
		const up = await computer(daemon, 120_000, 0).then(
			() => "up",
			(error) => String(error?.message ?? error).split("\n")[0],
		);
		await make("chat", () => post({ id: CHAT.message, thread: CHAT.thread, text: "Said before the upgrade." }));
		await make("file", async () => {
			const bytes = Buffer.from(ATTACHED.text);
			const { sha } = await call.upload(ATTACHED.name, bytes);
			if (sha !== sha256(bytes)) throw new Error(`the daemon named the file ${sha}, not by its SHA-256`);
			const posted = await post({
				id: FILE.message,
				thread: FILE.thread,
				text: "A file, before the upgrade.",
				files: [{ sha, name: ATTACHED.name }],
			});
			return { ...posted, sha };
		});
		await make("memory", async () => {
			const { facts } = await call.send("POST", "/memory", { text: FACT, scope: "global" });
			const fact = facts.find((each) => each.text === FACT);
			if (fact === undefined) throw new Error("the fact is not in the memory the daemon answered with");
			return { id: fact.id, text: fact.text };
		});
		await make("name", async () => ({ name: (await call.send("PUT", "/companion", { name: NAME })).name }));
		const seeded = { ...about, computer: up, made };
		mkdirSync(state, { recursive: true });
		for (const folder of [state, out])
			writeFileSync(join(folder, "seeded.json"), `${JSON.stringify(seeded, null, "\t")}\n`);
		// a home with no chat in it would prove nothing about the store
		if (!made.chat.made) throw new Error(`no chat could be made: ${made.chat.why}`);
		return Object.fromEntries(Object.entries(made).map(([name, each]) => [name, each.made ? "made" : each.why]));
	});
}

/** What was made before, read back from a daemon: every difference at once, or what was kept. */
async function kept(call, made) {
	const differences = [];
	const outcome = {};
	const look = async (name, run) => {
		if (!made[name].made) {
			outcome[name] = `not applicable: not made before (${made[name].why})`;
			return;
		}
		try {
			await run(made[name]);
			outcome[name] = "kept";
		} catch (error) {
			differences.push(`${name}: ${error?.message ?? error}`);
		}
	};
	const same = (was, now, what) => {
		if (JSON.stringify(was) !== JSON.stringify(now))
			throw new Error(`${what} was ${JSON.stringify(was)} and is ${JSON.stringify(now)}`);
	};
	const chat = async (was) =>
		same(was.said, said((await call.get(`/chats/${was.chat}/items`)).items), "what the owner said");
	await look("chat", chat);
	await look("file", async (was) => {
		await chat(was);
		same(sha256(Buffer.from(ATTACHED.text)), sha256(await call.bytes(`/blobs/${was.sha}`)), "the file's SHA-256");
	});
	await look("memory", async (was) => {
		const fact = (await call.get("/memory")).facts.find((each) => each.id === was.id);
		same(was.text, fact?.text, "the fact");
	});
	await look("name", async (was) => same(was.name, (await call.get("/companion")).name, "the companion's name"));
	if (differences.length > 0) throw new Error(differences.join("; "));
	return outcome;
}

/** The home as it was, beside it (`backupBeforeUpgrade`): there when the format moved, and of the format it left. */
function before(home, from, to) {
	if (to === from) return { status: "not applicable", detail: `the format did not move (${from})` };
	const folder = `${resolve(home)}-backups/before-format-${from + 1}`;
	if (!existsSync(join(folder, "manifest.json")))
		throw new Error(`the format moved from ${from} to ${to} and ${folder} holds no finished backup`);
	const manifest = json(join(folder, "manifest.json"));
	if (manifest.format !== from) throw new Error(`${folder} is of format ${manifest.format}, not ${from}`);
	const store = manifest.files?.["durable.db"];
	if (store === undefined || sha256(readFileSync(join(folder, "durable.db"))) !== store.sha256)
		throw new Error(`${folder}: its store is not the one its manifest names`);
	return { status: "passed", detail: `${folder}, format ${manifest.format}, written by banda ${manifest.banda}` };
}

/** `banda backup` of the open home, `banda restore` into a new one, and a daemon on that one to read it back. */
async function roundTrip({ until, home, out }, resources, made) {
	const cli = join(resources, "bin", "banda");
	if (!/^\s*banda backup\b/m.test(execFileSync(cli, ["--help"], { encoding: "utf8" })))
		return { status: "not applicable", detail: "this release's banda has no backup command" };
	const work = mkdtempSync(join(tmpdir(), "banda-acceptance-"));
	// the commands name their home themselves: never the one this run was given, never the owner's
	const env = { ...process.env };
	delete env.BANDA_HOME;
	delete env.BANDA_PORT;
	const backup = join(work, "backup");
	const restored = join(work, "home");
	let serving;
	try {
		const log = [execFileSync(cli, ["backup", "--home", home, "--to", backup], { encoding: "utf8", env })];
		log.push(execFileSync(cli, ["restore", backup, "--home", restored], { encoding: "utf8", env }));
		writeFileSync(join(out, "backup-restore.log"), log.join("\n"));
		const format = readFileSync(join(restored, "format"), "utf8");
		if (format !== readFileSync(join(home, "format"), "utf8"))
			throw new Error(`the restored home is in format ${format}`);
		// the bundled Node.js itself, so the signal that ends it reaches the daemon and not a launcher's shell
		const served = openSync(join(out, "restored-daemon.log"), "w");
		serving = spawn(
			join(resources, "node", "node"),
			[join(resources, "app", "dist", "cli", "index.js"), "serve", "--home", restored, "--port", "0"],
			{ env, stdio: ["ignore", served, served] },
		);
		const daemon = await until("the restored home's daemon", () => {
			if (serving.exitCode !== null) throw new Error("the restored home's daemon exited; see restored-daemon.log");
			if (!existsSync(join(restored, "daemon.json"))) return undefined;
			const now = json(join(restored, "daemon.json"));
			return now.port !== undefined && now.token !== undefined ? now : undefined;
		});
		const outcome = await kept(api(daemon), made);
		return { status: "passed", detail: { ...outcome, manifest: json(join(backup, "manifest.json")).trees } };
	} finally {
		if (serving !== undefined && serving.exitCode === null) {
			serving.kill("SIGTERM");
			await until("the restored home's daemon to stop", () => serving.exitCode !== null, 45_000).catch(() =>
				serving.kill("SIGKILL"),
			);
		}
		rmSync(work, { recursive: true, force: true, maxRetries: 5 });
	}
}

async function verify(run, about, state, resources) {
	const { check, daemon, home, out } = run;
	const seeded = json(join(state, "seeded.json"));
	const report = { from: { version: seeded.version, format: seeded.format }, to: about, assertions: {} };
	const save = () => writeFileSync(join(out, "upgrade.json"), `${JSON.stringify(report, null, "\t")}\n`);
	/** One assertion: passed, not applicable (with why), or failed with what was thrown. */
	const assertion = async (key, name, body) => {
		report.assertions[key] = { status: "failed", detail: "did not finish" };
		save();
		await check(name, async () => {
			try {
				report.assertions[key] = await body();
			} catch (error) {
				report.assertions[key] = { status: "failed", detail: String(error?.message ?? error) };
				throw error;
			} finally {
				save();
			}
			const { status, detail } = report.assertions[key];
			return status === "passed" ? detail : `${status}: ${detail}`;
		});
	};
	// drive.mjs called these steps, so the window is on the daemon and not on the failure page
	report.assertions.homeOpens = {
		status: "passed",
		detail: `banda ${about.version} opened the home of ${seeded.version}`,
	};
	const from = Number(seeded.format);
	const to = Number(about.format);
	await assertion("format", "reads the home in its own format", async () => {
		if (!Number.isInteger(from) || !Number.isInteger(to) || to < from)
			throw new Error(`the home was in format ${seeded.format} and is in ${about.format}`);
		return { status: "passed", detail: `format ${from} before, ${to} after` };
	});
	await assertion("backupBeforeUpgrade", "kept the home as it was before its format moved", async () =>
		before(home, from, to),
	);
	await assertion("stateKept", "still holds what the owner made before", async () => ({
		status: "passed",
		detail: await kept(api(daemon), seeded.made),
	}));
	await assertion("backupRoundTrip", "backs up, and restores into a second home that holds it too", () =>
		roundTrip(run, resources, seeded.made),
	);
}

export default async function steps(run) {
	const { installed, mac, home } = run;
	const phase = process.env.BANDA_UPGRADE;
	const state = process.env.BANDA_UPGRADE_STATE;
	if ((phase !== "seed" && phase !== "check") || state === undefined)
		throw new Error("BANDA_UPGRADE is seed or check, and BANDA_UPGRADE_STATE names the folder between them");
	const resources = join(installed, mac ? "Contents/Resources/banda" : "resources/banda");
	const about = {
		version: json(join(resources, "app", "package.json")).version,
		format: readFileSync(join(home, "format"), "utf8").trim(),
	};
	const expected = process.env.BANDA_UPGRADE_VERSION;
	if (expected !== undefined && expected !== about.version)
		throw new Error(`the installed app is banda ${about.version}, and this run is of ${expected}`);
	if (phase === "seed") await seed(run, about, state);
	else await verify(run, about, state, resources);
}
