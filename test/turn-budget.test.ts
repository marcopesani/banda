/**
 * The time banda itself adds to a turn (AGENTS.md principle 14; docs/verification.md "Launch budgets"): from the owner's
 * message to the first request reaching the provider, and from a response that calls a tool to the next request. The
 * provider's own time is not here: pi-ai's faux provider answers at once, so what is left is admission, the prompt's
 * assembly, the commits, the speaking tool and the stream between them. A real daemon on the host box takes `WARM` turns
 * no one counts, then `TURNS` counted ones in the lead's chat, each one message answered through `message_user`.
 *
 * These are caps on the median, not the equality test/prompt-budget.test.ts holds a prompt to: a clock on a machine many
 * runs share is noisy, so each cap is about ten times what was measured when it was set, and guards a step that
 * blocks (a scan, a synchronous read, a wait that crept in), not a millisecond. The tail is not capped here: a real
 * home's 90th percentile is checked on its history, as docs/verification.md says. To raise a cap on purpose: run this
 * file with `BANDA_TURN_BUDGET=print` and vitest's `--disable-console-intercept`, which prints what it measured, change
 * the cap here, and say the measured medians and why in the commit message.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Context, createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { MAIN_THREAD } from "../src/core/gateway.ts";
import { MESSAGE_USER } from "../src/core/toolsets.ts";
import { startDaemon } from "../src/daemon.ts";
import { readDaemonFile } from "../src/home.ts";
import type { ChatRow } from "../src/server/api.ts";
import { hostBox } from "./fixtures/host-box.ts";
import { tempHome, until } from "./helpers.ts";

/** Turns before the counted ones: the chat's first requests pay for what later ones find loaded. */
const WARM = 3;
const TURNS = 20;
/** The most milliseconds the median turn may take from the owner's message to the provider's first request. */
const FIRST_REQUEST_CAP = 100;
/** The most milliseconds the median turn may take from a response calling `message_user` to the next request. */
const TOOL_ROUND_CAP = 100;

const median = (values: readonly number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

describe("the time banda adds to a turn", () => {
	it("stays under its caps from a message to the first request and around a tool", async () => {
		const home = await tempHome();
		await writeFile(join(home, "config.json"), JSON.stringify({ model: { provider: "faux", modelId: "faux-1" } }));
		const web = join(home, "web");
		await mkdir(web, { recursive: true });
		await writeFile(join(web, "index.html"), "<!doctype html><title>banda</title>");
		const faux = fauxProvider();
		const models = createModels();
		models.setProvider(faux.provider);
		// when each request reached the provider: a turn's first, then the one after its tool
		let first: number | undefined;
		let called: number | undefined;
		let next: number | undefined;
		faux.setResponses(
			Array.from({ length: 4 * (WARM + TURNS) }, () => (context: Context) => {
				if (context.messages.at(-1)?.role === "toolResult") {
					next ??= performance.now();
					return fauxAssistantMessage("");
				}
				first ??= performance.now();
				called = performance.now();
				return fauxAssistantMessage([fauxToolCall(MESSAGE_USER, { text: "ok" })], { stopReason: "toolUse" });
			}),
		);
		const daemon = await startDaemon({ home, port: 0, models, log: () => {}, box: hostBox(home), web });
		try {
			const token = (await readDaemonFile(home))!.token!;
			const base = `http://127.0.0.1:${daemon.port}/api`;
			const headers = { authorization: `Bearer ${token}` };
			const chats = async () => (await (await fetch(`${base}/chats`, { headers })).json()) as ChatRow[];
			await until(async () => existsSync(join(home, "workspace", "agents", "sancho.md")));
			const firstRequest: number[] = [];
			const toolRound: number[] = [];
			for (let n = 0; n < WARM + TURNS; n++) {
				first = called = next = undefined;
				const sent = performance.now();
				const response = await fetch(`${base}/messages`, {
					method: "POST",
					headers,
					body: JSON.stringify({ id: randomUUID(), text: `${n}. What needs me this morning?`, thread: MAIN_THREAD }),
				});
				expect(response.ok).toBe(true);
				// the run ended and nothing runs in the chat, so the next message starts a turn of its own
				await until(async () => next !== undefined && (await chats())[0]?.state === "idle");
				if (n < WARM) continue;
				firstRequest.push((first as unknown as number) - sent);
				toolRound.push((next as unknown as number) - (called as unknown as number));
			}
			const measured = { firstRequest: median(firstRequest), toolRound: median(toolRound) };
			if (process.env.BANDA_TURN_BUDGET === "print")
				console.log(
					`turn budget, ms over ${TURNS} turns: first request median ${measured.firstRequest.toFixed(1)} max ${Math.max(...firstRequest).toFixed(1)}; tool round median ${measured.toolRound.toFixed(1)} max ${Math.max(...toolRound).toFixed(1)}`,
				);
			expect(measured.firstRequest, "a message waits longer for its first request").toBeLessThan(FIRST_REQUEST_CAP);
			expect(measured.toolRound, "a tool's round trip takes longer").toBeLessThan(TOOL_ROUND_CAP);
		} finally {
			await daemon.close();
		}
	});
});
