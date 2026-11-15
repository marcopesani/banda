/**
 * Who a group's working line shows: the members at work, and whether each has shown anything in the feed since its
 * work began. What was seen lives here, between renders of one open group; nothing of it is stored.
 */

/** Each member on the line or held there: the newest entry of the log when its work was first seen, or last asked. */
export type WorkingSince = Map<string, number>;

export const noneWorking = (): WorkingSince => new Map();

type Log = {
	readonly latest: number;
	/** What each member showed in the feed: its messages and the daemon's notices about it, by entry. */
	readonly shown: readonly { readonly entry: number; readonly agent: string }[];
	/** Members whose ask is open in the feed now. */
	readonly asking: readonly string[];
};

/** A member on the line, and whether something of its own showed since its work began: the line is quiet once all did. */
export type OnLine = { readonly member: string; readonly shown: boolean };

/**
 * The members to draw, in the order they started, updating `since`. A member stays for as long as it works, whatever
 * it showed meanwhile. One whose ask is open waits on the owner: it is off the line until the ask ends, and what it
 * does after counts from there, as work begun anew. One whose work ended stays until the log caught up with the row:
 * the end and what it said reach the page in two steps, and the line must not lose it in between.
 */
export function workingMembers(
	since: WorkingSince,
	log: Log | undefined,
	working: readonly string[],
	rowLatest: number | undefined,
): readonly OnLine[] {
	if (log === undefined) return [];
	for (const member of working) if (!since.has(member) || log.asking.includes(member)) since.set(member, log.latest);
	const behind = rowLatest !== undefined && rowLatest > log.latest;
	if (!behind) for (const member of since.keys()) if (!working.includes(member)) since.delete(member);
	return [...since].flatMap(([member, start]) =>
		log.asking.includes(member)
			? []
			: [{ member, shown: log.shown.some((each) => each.agent === member && each.entry > start) }],
	);
}
