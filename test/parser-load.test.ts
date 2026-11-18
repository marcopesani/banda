/**
 * The markdown parser (`src/core/markdown-links.ts`) is loaded by a daemon the first time a message may name an
 * artifact, never as it starts: a daemon and every worker a fault sweep starts would otherwise pay for it each time.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

/** In a fresh process: import `module`, then report whether micromark was ever resolved. */
const probe = (module: string) => `
	const loaded = [];
	(await import("node:module")).registerHooks({
		resolve: (specifier, context, next) => { const found = next(specifier, context); loaded.push(found.url); return found; },
	});
	await import(${JSON.stringify(new URL(module, import.meta.url).href)});
	console.log(JSON.stringify(loaded.some((url) => url.includes("/micromark"))));
`;

it("a daemon's modules load no markdown parser until a message needs it", async () => {
	const daemon = await run(process.execPath, ["--input-type=module", "-e", probe("../src/daemon.ts")]);
	expect(daemon.stdout.trim()).toBe("false");
	// and the parser is what it would load: the probe sees it when it is imported
	const parser = await run(process.execPath, ["--input-type=module", "-e", probe("../src/core/markdown-links.ts")]);
	expect(parser.stdout.trim()).toBe("true");
}, 30_000);
