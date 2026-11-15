import { expect, it } from "vitest";
import { noneWorking, workingMembers } from "./working-members.ts";

const said = (entry: number, agent: string) => ({ entry, agent });
const log = (latest: number, shown: ReturnType<typeof said>[] = [], asking: string[] = []) => ({
	latest,
	shown,
	asking,
});
const loud = (member: string) => ({ member, shown: false });
const quiet = (member: string) => ({ member, shown: true });

it("draws nobody before the log is read, and each member at work after, in the order they started", () => {
	const since = noneWorking();
	expect(workingMembers(since, undefined, ["mara"], 3)).toEqual([]);
	expect(workingMembers(since, log(3), ["mara"], 3)).toEqual([loud("mara")]);
	expect(workingMembers(since, log(3), ["sancho", "mara"], 3)).toEqual([loud("mara"), loud("sancho")]);
});

it("keeps a member whose own content arrived for as long as it works, as one that has shown something", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara", "sancho"], 3);
	expect(workingMembers(since, log(4, [said(4, "mara")]), ["mara", "sancho"], 4)).toEqual([
		quiet("mara"),
		loud("sancho"),
	]);
	expect(workingMembers(since, log(5, [said(4, "mara"), said(5, "sancho")]), ["mara", "sancho"], 5)).toEqual([
		quiet("mara"),
		quiet("sancho"),
	]);
	// its work ended, and the log holds what it said: it goes, the other stays
	expect(workingMembers(since, log(5, [said(4, "mara"), said(5, "sancho")]), ["sancho"], 5)).toEqual([quiet("sancho")]);
});

it("what a member said before it began is not its content now", () => {
	const since = noneWorking();
	expect(workingMembers(since, log(3, [said(2, "mara")]), ["mara"], 3)).toEqual([loud("mara")]);
});

it("a member whose ask is open waits on the owner: off the line, though its turn has not ended", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara", "sancho"], 3);
	expect(workingMembers(since, log(3, [], ["mara"]), ["mara", "sancho"], 3)).toEqual([loud("sancho")]);
});

it("once its ask ended it is back on the line, its work begun anew: what it said before the ask does not quiet it", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara"], 3);
	// it said something, then asked
	expect(workingMembers(since, log(4, [said(4, "mara")]), ["mara"], 4)).toEqual([quiet("mara")]);
	expect(workingMembers(since, log(5, [said(4, "mara")], ["mara"]), ["mara"], 5)).toEqual([]);
	// the owner answered: it works on, having shown nothing since
	expect(workingMembers(since, log(6, [said(4, "mara")]), ["mara"], 6)).toEqual([loud("mara")]);
	expect(workingMembers(since, log(7, [said(4, "mara"), said(7, "mara")]), ["mara"], 7)).toEqual([quiet("mara")]);
});

it("holds a member whose work ended until the log caught up with the row, then lets it go", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara"], 3);
	expect(workingMembers(since, log(3), [], 4)).toEqual([loud("mara")]);
	expect(workingMembers(since, log(4, [said(4, "mara")]), [], 4)).toEqual([]);
	expect(since.size).toBe(0);
});

it("a member that works again begins again: what it said last time does not quiet it", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara"], 3);
	workingMembers(since, log(4, [said(4, "mara")]), [], 4);
	expect(workingMembers(since, log(5, [said(4, "mara")]), ["mara"], 5)).toEqual([loud("mara")]);
});
