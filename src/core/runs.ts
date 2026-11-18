/**
 * A chat's runs (DESIGN.md "Messages"): a run is what a chat does since its last input. The app counts them from the
 * items it draws, and the daemon from the same items when it says what a message showed, so both count one way.
 */
import type { ConversationId, EntryRecord, Tx } from "@earendil-works/pi-durable";
import type { Item } from "../server/api.ts";

/**
 * Whether `item` starts a run: the owner's message, another agent's (DESIGN.md: it gets a turn), a routine's wake, or a
 * watch's (not what it only tells).
 */
export const startsRun = (item: Item): item is Extract<Item, { role: "user" | "agentMessage" | "wake" | "watch" }> =>
	item.role === "user" ||
	item.role === "agentMessage" ||
	item.role === "wake" ||
	(item.role === "watch" && item.tell === undefined);

/** What one entry says of runs: whether it starts one, and the tool calls it makes. */
export type RunEntry = { readonly starts: boolean; readonly calls: readonly string[] };

/**
 * The calls made in the run of `call` in chat `chat` (`call` among them), and how many entries were read to find them:
 * the chat is read back from its newest entry, a page at a time, only as far as the start of that run, so the read is
 * as long as the run, never the whole chat. A run that started after `call`'s (an input that came while it worked) is
 * passed over. `read` says what an entry is, as the app draws it in a chat and as the room counts turns in a group's.
 * When `call` is not found, the newest run's calls.
 */
export async function callsOfRun(
	tx: Tx,
	chat: number,
	call: string,
	read: (entry: EntryRecord) => RunEntry | undefined,
): Promise<{ readonly calls: ReadonlySet<string>; readonly scanned: number }> {
	let current = new Set<string>();
	let newest: Set<string> | undefined;
	let scanned = 0;
	let cursor: Parameters<Tx["scanEntries"]>[2];
	do {
		const page = await tx.scanEntries({ conversationId: chat as ConversationId, order: "descending" }, 50, cursor);
		for (const entry of page.items) {
			scanned++;
			const said = read(entry);
			if (said === undefined) continue;
			for (const made of said.calls) current.add(made);
			if (!said.starts) continue;
			if (current.has(call)) return { calls: current, scanned };
			newest ??= current;
			current = new Set();
		}
		cursor = page.next;
	} while (cursor !== undefined);
	return { calls: current.has(call) ? current : (newest ?? current), scanned };
}
