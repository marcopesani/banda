import { expect, it } from "vitest";
import { lineMembers, noneWorking, workingMembers } from "./working-members.ts";

const log = (latest: number, asking: string[] = []) => ({ latest, asking });

it("draws nobody before the log is read, and each member at work after, in the order they started", () => {
	const since = noneWorking();
	expect(workingMembers(since, undefined, ["mara"], 3)).toEqual([]);
	expect(workingMembers(since, log(3), ["mara"], 3)).toEqual(["mara"]);
	expect(workingMembers(since, log(3), ["sancho", "mara"], 3)).toEqual(["mara", "sancho"]);
});

it("keeps a member for as long as it works, whatever it showed meanwhile", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara", "sancho"], 3);
	expect(workingMembers(since, log(4), ["mara", "sancho"], 4)).toEqual(["mara", "sancho"]);
	expect(workingMembers(since, log(5), ["mara", "sancho"], 5)).toEqual(["mara", "sancho"]);
	// its work ended, and the log holds what it said: it goes, the other stays
	expect(workingMembers(since, log(5), ["sancho"], 5)).toEqual(["sancho"]);
});

it("a member whose ask is open waits on the owner: off the line, though its turn has not ended", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara", "sancho"], 3);
	expect(workingMembers(since, log(3, ["mara"]), ["mara", "sancho"], 3)).toEqual(["sancho"]);
});

it("once its ask ended it is back on the line", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara"], 3);
	expect(workingMembers(since, log(5, ["mara"]), ["mara"], 5)).toEqual([]);
	// the owner answered: it works on
	expect(workingMembers(since, log(6), ["mara"], 6)).toEqual(["mara"]);
});

it("holds a member whose work ended until the log caught up with the row, then lets it go", () => {
	const since = noneWorking();
	workingMembers(since, log(3), ["mara"], 3);
	expect(workingMembers(since, log(3), [], 4)).toEqual(["mara"]);
	expect(workingMembers(since, log(4), [], 4)).toEqual([]);
	expect(since.size).toBe(0);
});

it("says each member as it is: those at work work, those whose ask is open wait, never the others", () => {
	expect(lineMembers([], [])).toEqual({ working: [], waiting: [] });
	expect(lineMembers([], ["mara"])).toEqual({ working: [], waiting: ["mara"] });
	// two asks of one member: one face
	expect(lineMembers([], ["mara", "sancho", "mara"])).toEqual({ working: [], waiting: ["mara", "sancho"] });
	// one at work, another asking: each on its own line, the one at work never said to wait
	expect(lineMembers(["sancho"], ["mara"])).toEqual({ working: ["sancho"], waiting: ["mara"] });
	// the ask answered and the member back at work: work again, and no one waits
	expect(lineMembers(["mara", "sancho"], [])).toEqual({ working: ["mara", "sancho"], waiting: [] });
});
