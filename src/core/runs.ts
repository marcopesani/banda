/**
 * A chat's runs (DESIGN.md "Messages"): a run is what a chat does since its last input. The app counts them from the
 * items it draws, and the daemon from the same items when it says what a message showed, so both count one way.
 */
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
