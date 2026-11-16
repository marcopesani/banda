/**
 * Who a group's working line shows: the members at work. When each was first seen lives here, between renders of one
 * open group; nothing of it is stored.
 */

/** Each member on the line or held there: the newest entry of the log when its work was first seen, or last asked. */
export type WorkingSince = Map<string, number>;

export const noneWorking = (): WorkingSince => new Map();

type Log = {
	readonly latest: number;
	/** Members whose ask is open in the feed now. */
	readonly asking: readonly string[];
};

/**
 * The members to draw, in the order they started, updating `since`. A member stays for as long as it works, whatever
 * it showed meanwhile. One whose ask is open waits on the owner: it is off the line until the ask ends, and back as
 * soon as it works on. One whose work ended stays until the log caught up with the row: the end and what it said
 * reach the page in two steps, and the line must not lose it in between.
 */
export function workingMembers(
	since: WorkingSince,
	log: Log | undefined,
	working: readonly string[],
	rowLatest: number | undefined,
): readonly string[] {
	if (log === undefined) return [];
	for (const member of working) if (!since.has(member) || log.asking.includes(member)) since.set(member, log.latest);
	const behind = rowLatest !== undefined && rowLatest > log.latest;
	if (!behind) for (const member of since.keys()) if (!working.includes(member)) since.delete(member);
	return [...since.keys()].filter((member) => !log.asking.includes(member));
}

/**
 * Who the group's lines show: the members at work on one, saying their work; the members whose ask is open on another,
 * saying they wait on the owner. Each member is said as it is: one asking never makes the others wait, and one at work
 * is never said to wait. Members at work come first, so a lone waiting line stands where the working line would.
 */
export function lineMembers(
	atWork: readonly string[],
	asking: readonly string[],
): { readonly working: readonly string[]; readonly waiting: readonly string[] } {
	return { working: atWork, waiting: [...new Set(asking)].filter((member) => !atWork.includes(member)) };
}
