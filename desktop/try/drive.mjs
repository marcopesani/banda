/**
 * Use the packaged desktop app as its owner would, with no person at it: open it, look at its first screen at desktop
 * and phone width, open it a second time, quit, and open it again. What it saw goes to <out>/result.json, the screens
 * beside it. It has no dependencies, so the app's own bundled Node.js runs it.
 *
 *   node drive.mjs x11|wayland <out>            the installed Linux package, on a display started here (linux.sh),
 *                                               with the home an owner gets: ~/.banda of a fresh container
 *   node drive.mjs mac <out> <banda.app's executable>   on this Mac's own screen; BANDA_HOME names a throwaway home
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [session = "x11", out = "/out", given] = process.argv.slice(2);
const mac = session === "mac";
const executable = given ?? "/opt/banda/banda-desktop";
/** Where everything the app runs lives: the installed folder, or the bundle. */
const installed = mac ? executable.slice(0, executable.indexOf(".app/") + 5) : "/opt/banda/";
if (mac && (given === undefined || process.env.BANDA_HOME === undefined || !executable.includes(".app/")))
	throw new Error("On a Mac: BANDA_HOME=<a throwaway home> node drive.mjs mac <out> <banda.app/Contents/MacOS/banda>");
const home = mac ? process.env.BANDA_HOME : join(homedir(), ".banda");
/** Chromium writes the debugging port it was given here, in the shell's own profile. */
const debugFile = join(home, "desktop", "DevToolsActivePort");
const runtime = process.env.XDG_RUNTIME_DIR ?? "/tmp";
const slow = Number(process.env.BANDA_TRY_SLOW ?? 1);

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, probe, within = 60_000) {
	const deadline = Date.now() + within * slow;
	for (;;) {
		const found = await probe();
		if (found !== undefined && found !== false) return found;
		if (Date.now() > deadline) throw new Error(`${what}: not within ${(within * slow) / 1000}s`);
		await pause(250);
	}
}
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
const read = (path) => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
};

/** The display the app draws on: an X server, or a Wayland compositor with no X beside it. */
async function display() {
	if (mac) return {};
	const log = openSync(join(out, "display.log"), "w");
	if (session === "wayland") {
		const socket = "wayland-banda";
		for (const backend of ["headless", "headless-backend.so"]) {
			const child = spawn("weston", [`--backend=${backend}`, `--socket=${socket}`, "--width=1440", "--height=960"], {
				stdio: ["ignore", log, log],
			});
			const up = await until(
				"the Wayland compositor",
				() => existsSync(join(runtime, socket)) || (child.exitCode !== null ? "gone" : undefined),
			);
			if (up !== "gone") return { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: socket };
		}
		throw new Error("the Wayland compositor did not start; see display.log");
	}
	spawn("Xvfb", [":99", "-screen", "0", "1440x960x24", "-nolisten", "tcp"], { stdio: ["ignore", log, log] });
	await until("the X server", () => existsSync("/tmp/.X11-unix/X99"));
	return { XDG_SESSION_TYPE: "x11", DISPLAY: ":99" };
}

let launches = 0;
function launch(env, args = []) {
	launches += 1;
	const log = openSync(join(out, `shell-${launches}.log`), "w");
	if (args.length > 0) rmSync(debugFile, { force: true });
	return spawn(executable, args, { env, stdio: ["ignore", log, log] });
}

/** The window's page, once it shows the daemon; the failure page is an answer too, and a wrong one. */
async function page() {
	const target = await until(
		"the app's window",
		async () => {
			const debugPort = read(debugFile)?.split("\n")[0];
			if (debugPort === undefined) return undefined;
			const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
				.then((response) => response.json())
				.catch(() => []);
			return targets.find((each) => each.type === "page" && /^(http:\/\/127\.0\.0\.1:|data:)/.test(each.url));
		},
		180_000,
	);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve);
		socket.addEventListener("error", () => reject(new Error("the window's debugger refused the connection")));
	});
	let last = 0;
	const waiting = new Map();
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		const answer = waiting.get(message.id);
		if (answer === undefined) return;
		waiting.delete(message.id);
		if (message.error) answer.reject(new Error(message.error.message));
		else answer.resolve(message.result);
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			last += 1;
			const id = last;
			waiting.set(id, { resolve, reject });
			socket.send(JSON.stringify({ id, method, params }));
			// a window that never answers is a finding, not a wait without end
			setTimeout(() => {
				if (waiting.delete(id)) reject(new Error(`${method} did not answer`));
			}, 30_000 * slow).unref();
		});
	const evaluate = async (expression) =>
		(await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
	const shot = async (name) =>
		writeFileSync(
			join(out, name),
			Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"),
		);
	return { url: target.url, send, evaluate, shot, close: () => socket.close() };
}

/** The app's own processes: as /proc has them, or on a Mac as ps does. */
function processes() {
	const found = [];
	if (mac) {
		for (const line of execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n")) {
			const [, pid, command] = /^\s*(\d+)\s+(.*)$/.exec(line) ?? [];
			if (command?.startsWith(installed)) found.push({ pid: Number(pid), command: [command] });
		}
		return found;
	}
	for (const entry of readdirSync("/proc")) {
		if (!/^\d+$/.test(entry)) continue;
		const command = read(`/proc/${entry}/cmdline`)?.split("\0").filter(Boolean);
		if (command === undefined || command.length === 0) continue;
		if (!command[0].startsWith(installed)) continue;
		const namespace = (name) => {
			try {
				return readlinkSync(`/proc/${entry}/ns/${name}`);
			} catch {
				return undefined;
			}
		};
		found.push({
			pid: Number(entry),
			command,
			// a sandboxed renderer rewrites its command line into one title, spaces between its arguments
			type: /(?:^| )--type=([a-z-]+)/.exec(command.join(" "))?.[1],
			seccomp: /^Seccomp:\s+(\d)/m.exec(read(`/proc/${entry}/status`) ?? "")?.[1],
			user: namespace("user"),
			pidNamespace: namespace("pid"),
		});
	}
	return found;
}

const os = mac
	? `macOS ${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()}`
	: /^PRETTY_NAME="?([^"\n]*)/m.exec(read("/etc/os-release") ?? "")?.[1];
const result = { session, os, checks: [] };
async function check(name, run) {
	try {
		const detail = await run();
		result.checks.push({ name, ok: true, ...(detail === undefined ? {} : { detail }) });
		console.log(
			`ok    ${name}${detail === undefined ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`,
		);
		return true;
	} catch (error) {
		result.checks.push({ name, ok: false, detail: String(error?.message ?? error) });
		console.log(`FAIL  ${name}: ${error?.message ?? error}`);
		return false;
	}
}

async function quit(shell, daemon) {
	shell.kill("SIGTERM");
	await until("the shell's exit", () => shell.exitCode !== null || shell.signalCode !== null, 45_000);
	await until("the daemon's exit", () => !alive(daemon.pid), 20_000);
	if (existsSync(join(home, "daemon.json"))) throw new Error("daemon.json outlived the daemon");
	const left = processes().filter((each) => each.pid !== process.pid);
	if (left.length > 0) throw new Error(`still running: ${left.map((each) => each.command[0]).join(", ")}`);
}

async function main() {
	const env = { ...process.env, ...(await display()) };
	// a Mac's own home and port belong to the banda its owner runs; a fresh container's are the app's defaults
	if (mac) env.BANDA_PORT = "0";
	else delete env.BANDA_HOME;
	delete env.BANDA_BOX;
	const debug = ["--remote-debugging-port=0", "--remote-allow-origins=*"];
	let shell = launch(env, debug);
	let window;
	let daemon;
	const opened = await check("opens its window on the daemon", async () => {
		window = await page();
		if (!window.url.startsWith("http://")) {
			const said = await window.evaluate("document.body?.innerText ?? ''");
			throw new Error(`the app showed its failure page: ${said.slice(0, 600)}`);
		}
		daemon = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8"));
		const status = await fetch(`http://127.0.0.1:${daemon.port}/api/status`, {
			headers: { authorization: `Bearer ${daemon.token}` },
		});
		if (!status.ok) throw new Error(`the daemon's API answered ${status.status}`);
		const environment = mac
			? execFileSync("ps", ["-Eww", "-o", "command=", "-p", String(daemon.pid)], { encoding: "utf8" })
			: (read(`/proc/${daemon.pid}/environ`) ?? "");
		const box = /(?:^|[\0 ])BANDA_BOX=([^\0 \n]*)/.exec(environment)?.[1];
		return { port: daemon.port, box };
	});
	if (opened) {
		await check("shows its first screen at desktop and phone width", async () => {
			const text = await until("the first screen", async () => {
				const said = (await window.evaluate("document.body?.innerText ?? ''")).trim();
				return said.length > 20 ? said : undefined;
			});
			const said = text.replace(/\s+/g, " ").slice(0, 120);
			writeFileSync(join(out, "first-screen.txt"), `${await window.evaluate("document.body?.innerText ?? ''")}\n`);
			try {
				await pause(1500);
				await window.shot("desktop.png");
				await window.send("Emulation.setDeviceMetricsOverride", {
					width: 390,
					height: 844,
					deviceScaleFactor: 2,
					mobile: true,
				});
				await pause(1500);
				await window.shot("phone.png");
				await window.send("Emulation.clearDeviceMetricsOverride");
			} catch (error) {
				// a Wayland compositor with no screen behind it draws no frames, so there is nothing to capture; the page's
				// own text above still says what it shows
				if (session !== "wayland") throw error;
				return `${said} (no screenshot: ${error.message})`;
			}
			return said;
		});
		if (!mac)
			await check("confines its renderers", () => {
				const all = processes();
				const main = all.find((each) => each.pid === shell.pid);
				const renderers = all.filter((each) => each.type === "renderer");
				if (main === undefined || renderers.length === 0) throw new Error("no renderer is running");
				const open = all.find((each) =>
					/(?:^| )--(no-sandbox|disable-setuid-sandbox)(?: |$)/.test(each.command.join(" ")),
				);
				if (open !== undefined) throw new Error(`${open.command.join(" ")} runs without the sandbox`);
				for (const renderer of renderers) {
					if (renderer.seccomp !== "2") throw new Error(`renderer ${renderer.pid} has no seccomp filter`);
					if (renderer.pidNamespace === main.pidNamespace)
						throw new Error(`renderer ${renderer.pid} shares the shell's process namespace`);
				}
				return renderers[0].user === main.user ? "setuid sandbox" : "user namespace sandbox";
			});
		await check("a second launch hands over to the first", async () => {
			const second = launch(env);
			await until("the second launch's exit", () => second.exitCode !== null || second.signalCode !== null, 30_000);
			if (shell.exitCode !== null) throw new Error("the first shell exited");
			if (!alive(daemon.pid)) throw new Error("the daemon exited");
		});
		window.close();
		await check("quit stops the shell and the daemon", () => quit(shell, daemon));
		await check("opens again on the same home", async () => {
			shell = launch(env, debug);
			window = await page();
			if (!window.url.startsWith("http://")) throw new Error("the app showed its failure page");
			const again = JSON.parse(readFileSync(join(home, "daemon.json"), "utf8"));
			if (again.pid === daemon.pid) throw new Error("the daemon is the one that was stopped");
			if (again.token !== daemon.token) throw new Error("the home's token changed");
			await until(
				"the first screen",
				async () => (await window.evaluate("document.body?.innerText ?? ''")).trim().length > 20,
			);
			window.close();
			await quit(shell, again);
		});
	} else if (shell.exitCode === null) shell.kill("SIGKILL");
	const log = read(join(home, "daemon.log"));
	if (log !== undefined) writeFileSync(join(out, "daemon.log"), log);
}

await main().catch((error) => {
	result.checks.push({ name: "the run itself", ok: false, detail: String(error?.stack ?? error) });
	console.log(`FAIL  ${error?.stack ?? error}`);
});
result.passed = result.checks.length > 0 && result.checks.every((each) => each.ok);
writeFileSync(join(out, "result.json"), `${JSON.stringify(result, null, "\t")}\n`);
process.exit(result.passed ? 0 : 1);
