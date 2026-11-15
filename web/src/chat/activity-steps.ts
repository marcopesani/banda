/**
 * Words for a chat's activity: each tool call as a verb and what it acted on, in the owner's words, said as going on
 * or as done; how long a step took; a request's model and cost in a line. Presentation only, never a new summary: the
 * object is the call's own argument. Pure.
 */
import type { Item, ToolCall, TurnUsage } from "../../../src/server/api.ts";
import { capEnds, type Ends, pathEnds } from "../lib/ends.ts";
import { harnessToolOf } from "../lib/segments/harness.ts";
import { cached, dollars, sent, tokens } from "../lib/usage.ts";
import { runHeadline } from "./Harness.tsx";
import { toolPreviewEnds } from "./tool-presentation.tsx";

/** A step's one line: `verb` then `object`; `code` draws the object mono; `ends` says what stays short of room. */
export type StepHead = {
	readonly verb: string;
	readonly object: string;
	readonly code: boolean;
	readonly ends?: Ends;
};

/** A tool's verb while it runs and once it ran. A tool with none reads "Using"/"Used" and its name. */
const VERBS: Readonly<Record<string, readonly [doing: string, done: string]>> = {
	message_user: ["Messaging you", "Messaged you"],
	message_group: ["Posting to the group", "Posted to the group"],
	ask_user: ["Asking you", "Asked you"],
	react: ["Reacting", "Reacted"],
	publish: ["Publishing", "Published"],
	connect: ["Asking to connect", "Asked to connect"],
	propose_avatar: ["Drawing a face", "Drew a face"],
	propose_key: ["Asking for a credential", "Asked for a credential"],
	schedule: ["Setting a routine", "Set a routine"],
	watch: ["Setting a watch", "Set a watch"],
	skill: ["Loading", "Loaded"],
	read: ["Reading", "Read"],
	write: ["Writing", "Wrote"],
	edit: ["Editing", "Edited"],
	web_fetch: ["Reading", "Read"],
	browser_navigate: ["Opening", "Opened"],
	browser_snapshot: ["Reading the page", "Read the page"],
	browser_click: ["Clicking", "Clicked"],
	browser_type: ["Typing", "Typed"],
	browser_select: ["Selecting", "Selected"],
	browser_scroll: ["Scrolling", "Scrolled"],
	browser_wait: ["Waiting for", "Waited for"],
	browser_screenshot: ["Taking a screenshot", "Took a screenshot"],
	browser_send: ["Sending from the browser", "Sent from the browser"],
	browser_hand_over: ["Handing you the browser", "Handed you the browser"],
	remember: ["Remembering", "Remembered"],
	recall: ["Recalling", "Recalled"],
	forget: ["Forgetting", "Forgot"],
	search: ["Searching for", "Searched for"],
	read_search_result: ["Reading a result", "Read a result"],
};

/** Tools whose object is code: a path, a command. */
const CODE = new Set(["read", "write", "edit"]);
/** Tools whose preview says nothing the verb did not. */
const BARE = new Set(["browser_snapshot", "browser_screenshot"]);

/** An address as a person says it: no scheme, no `www.`, no trailing slash. Not an address, it stays itself. */
export function prettyUrl(url: string): string {
	return url
		.trim()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
		.replace(/^www\./, "")
		.replace(/\/$/, "");
}

/**
 * A call as a step's one line. `done` says it ran: "Opened" for "Opening". `service` is the coding agent a harness's
 * tool hands work to, as the owner knows it ("Claude Code"); unknown, the line says "a coding agent".
 */
export function toolHead(call: ToolCall, done: boolean, service?: string): StepHead {
	const { name, args } = call;
	const harness = harnessToolOf(name);
	if (harness === "work") {
		const preview = toolPreviewEnds(name, args);
		return {
			verb: `${done ? "Asked" : "Asking"} ${service ?? "a coding agent"}`,
			object: preview === undefined ? "" : preview.head + preview.end,
			code: false,
		};
	}
	if (harness !== undefined) {
		const verb = harness === "stop" ? (done ? "Stopped" : "Stopping") : done ? "Checked" : "Checking";
		const one = typeof args.session === "number" ? `coding session ${args.session}` : undefined;
		return { verb, object: one ?? (harness === "stop" ? "a coding session" : "coding sessions"), code: false };
	}
	if (name === "bash" && typeof args.command === "string" && args.command.trim() !== "") {
		// a here-document's body is what the command reads, not more of the command: its first line says what ran
		const [first = "", ...body] = args.command.trim().split("\n");
		if (body.length > 0 && /<<-?\s*['"]?\w/.test(first)) {
			const object = `${first.trim()} …`;
			return { verb: done ? "Ran" : "Running", object, code: true, ends: { head: object, end: "" } };
		}
		return runHeadline(args.command, undefined, done);
	}
	const verbs = Object.hasOwn(VERBS, name) ? VERBS[name] : undefined;
	const verb = verbs === undefined ? (done ? "Used" : "Using") : verbs[done ? 1 : 0];
	if (verbs === undefined) {
		const preview = toolPreviewEnds(name, args);
		const what = preview === undefined ? "" : ` · ${preview.head}${preview.end}`;
		return { verb, object: `${name}${what}`, code: true, ends: { head: `${name}${what}`, end: "" } };
	}
	if (BARE.has(name)) return { verb, object: "", code: false };
	if ((name === "web_fetch" || name === "browser_navigate") && typeof args.url === "string" && args.url !== "") {
		const ends = capEnds(pathEnds(prettyUrl(args.url)), 180);
		return { verb, object: ends.head + ends.end, code: false, ends };
	}
	if (name === "skill" && typeof args.name === "string") return { verb, object: `/${args.name}`, code: true };
	if (name === "search" && typeof args.query === "string")
		return { verb, object: `“${args.query.replace(/\s+/g, " ").trim()}”`, code: false };
	const preview = toolPreviewEnds(name, args);
	if (preview === undefined) return { verb, object: "", code: false };
	return { verb, object: preview.head + preview.end, code: CODE.has(name), ends: preview };
}

/** How long something took, short: 0.4s, 4.0s, 32s, 1m 48s. */
export function took(ms: number): string {
	if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
	const seconds = Math.round(ms / 1000);
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** From a work's first timed entry to its last, when two are timed. */
export function span(items: readonly Item[]): number | undefined {
	const times = items.flatMap((item) => ("at" in item && typeof item.at === "number" ? [item.at] : []));
	if (times.length < 2) return undefined;
	return Math.max(...times) - Math.min(...times);
}

/** A model as its request names it, without its provider: "anthropic/claude-sonnet-5-5" reads "claude-sonnet-5-5". */
export const modelName = (model: string) => model.slice(model.indexOf("/") + 1);

/** What one request took, as the parts of a line: its model, what it was sent and said, what it cost. */
export function requestWords(request: { readonly model?: string; readonly usage?: TurnUsage }): readonly string[] {
	const { model, usage } = request;
	return [
		...(model === undefined ? [] : [modelName(model)]),
		...(usage === undefined || sent(usage) + usage.output === 0
			? []
			: [`${tokens(sent(usage))} in`, `${tokens(usage.output)} out`]),
		...(usage === undefined ? [] : cacheWords(cached(usage))),
		...(usage === undefined || usage.cost === 0 ? [] : [dollars(usage.cost)]),
	];
}

/** The share of what was sent that came from the provider's cache, when anything was sent. */
const cacheWords = (rate: number | undefined) => (rate === undefined ? [] : [`${Math.round(rate * 100)}% cached`]);

/** What a work's requests took together: what they were sent and said, and what they cost. */
export function totalWords(requests: readonly { readonly usage?: TurnUsage }[]): readonly string[] {
	let input = 0;
	let output = 0;
	let cost = 0;
	let read = 0;
	for (const { usage } of requests) {
		if (usage === undefined) continue;
		input += sent(usage);
		output += usage.output;
		cost += usage.cost;
		read += usage.cacheRead;
	}
	return [
		...(input + output === 0 ? [] : [`${tokens(input)} in`, `${tokens(output)} out`]),
		...cacheWords(input === 0 ? undefined : read / input),
		...(cost === 0 ? [] : [dollars(cost)]),
	];
}
