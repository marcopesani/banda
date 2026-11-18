/** Delegated work and attention, derived only from the daemon's stored harness sessions. */

import type { HarnessSessionView } from "../../../src/server/api.ts";
import { harnessToolOf } from "../lib/segments/harness.ts";

/** An ask's kind in a few words, for a folded line or a notification: never the command or the path. */
export const askSummary = (kind: string): string => {
	// ACP names kinds in lowercase; a harness that shouts "EXECUTE" gets the same words, not the vaguest
	const k = kind.toLowerCase();
	return k === "execute"
		? "run a command"
		: k === "edit" || k === "delete" || k === "move"
			? "change a file"
			: k === "fetch"
				? "open a web page"
				: "do something";
};

/**
 * An ask's buttons, by its kind: the verb of what would happen, and a refusal naming what will not. The harness's
 * own option names ("Allow", "Reject") never label the buttons: the owner reads the same words whatever the harness.
 */
export const askWords = (kind: string): { what: string; verb: string; no: string } => {
	const k = kind.toLowerCase();
	const summary = askSummary(k);
	const what = summary.charAt(0).toUpperCase() + summary.slice(1);
	return k === "execute"
		? { what, verb: "Run", no: "Don't run" }
		: k === "edit" || k === "delete" || k === "move"
			? { what, verb: "Allow", no: "Don't change" }
			: k === "fetch"
				? { what, verb: "Allow", no: "Don't open" }
				: { what, verb: "Allow", no: "Don't allow" };
};

/**
 * Which asks show whole: every one the owner opened, by id, and always the oldest. What is open is what the owner
 * opened, never a count: an ask resolving elsewhere can fold nothing open and open nothing folded, so a button never
 * turns into another ask's primary button under the pointer.
 */
export function shownAsks<T extends { readonly id: string }>(
	asks: readonly T[],
	opened: ReadonlySet<string>,
): { visible: readonly T[]; folded: readonly T[] } {
	return {
		visible: asks.filter((ask, index) => index === 0 || opened.has(ask.id)),
		folded: asks.filter((ask, index) => index !== 0 && !opened.has(ask.id)),
	};
}

/**
 * The device notification's body for harness asks: the harness and what kind of thing it asks; never the command,
 * the path or the project's name, any of which would sit in a banner on a lock screen.
 */
export function askNotice(sessions: readonly HarnessSessionView[]): string | undefined {
	const waiting = sessions.filter((session) => (session.asks?.length ?? 0) > 0);
	const first = waiting[0];
	if (first === undefined) return undefined;
	if (waiting.length > 1) return `${first.service} and ${waiting.length - 1} more are waiting on you`;
	return `${first.service} asks to ${askSummary(first.asks?.[0]?.kind ?? "other")}`;
}

/** What Activity reads of the shell's harnesses: every session kept, and each coding agent by name when known. */
export type HarnessesSeen = {
	readonly sessions: readonly HarnessSessionView[];
	readonly harnesses?: readonly { readonly name: string; readonly service: string }[];
};

/** The coding agent the tool `tool` hands work to, as the owner knows it ("Claude Code"), when anything says. */
export function toolService(seen: HarnessesSeen | undefined, tool: string): string | undefined {
	const mine = (one: { readonly name: string }) => `harness__${one.name.replaceAll("-", "_")}` === tool;
	return seen?.harnesses?.find(mine)?.service ?? seen?.sessions.find((one) => mine({ name: one.harness }))?.service;
}

/**
 * The session a call of a tool over coding agents leads to: the one it started, found by the call and never by the
 * words of its result; else the one it named and reached (a note to a running session, a look at one, a stop).
 * "gone" when that session is no longer kept. Undefined when the call names none: it was refused, has no answer yet,
 * or listed every session.
 */
export function callSession(
	seen: HarnessesSeen | undefined,
	chat: number,
	call: { readonly id: string; readonly name: string; readonly args: Readonly<Record<string, unknown>> },
	result: { readonly error?: boolean } | undefined,
): HarnessSessionView | "gone" | undefined {
	const kind = harnessToolOf(call.name);
	if (kind === undefined || seen === undefined) return undefined;
	const started = kind === "work" ? seen.sessions.find((one) => one.chat === chat && one.call === call.id) : undefined;
	if (started !== undefined) return started;
	if (result === undefined || result.error === true) return undefined;
	const named = typeof call.args.session === "number" ? call.args.session : undefined;
	if (named === undefined) return kind === "work" ? "gone" : undefined;
	// Work that names a session and started none sent that session a note. A session it started and that is gone
	// cannot be mistaken for it: ended sessions go oldest first, so the one it followed went before it.
	return seen.sessions.find((one) => one.task === named) ?? "gone";
}

export function harnessActivity(sessions: readonly HarnessSessionView[], chats: readonly number[]) {
	const active = sessions.filter(
		(session) =>
			chats.includes(session.chat) &&
			session.ended === undefined &&
			["starting", "working", "waiting"].includes(session.state),
	);
	const waiting = active.some((session) => (session.asks?.length ?? 0) > 0);
	active.sort((a, b) => Number((b.asks?.length ?? 0) > 0) - Number((a.asks?.length ?? 0) > 0) || b.at - a.at);
	return { sessions: active, waiting };
}
