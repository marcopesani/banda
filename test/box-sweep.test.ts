/** A daemon at start sweeps what homes since deleted left running, whichever kind of box it uses (AGENTS.md). */
import { describe, expect, it, vi } from "vitest";

const swept = vi.hoisted(() => ({ microvm: 0, container: 0 }));
vi.mock("../src/box/microvm.ts", async (original) => ({
	...(await original<typeof import("../src/box/microvm.ts")>()),
	microvmBox: () => ({ kind: "microvm" }),
	sweepMicrovmBoxes: async () => {
		swept.microvm += 1;
		return 2;
	},
}));
vi.mock("../src/box/container.ts", async (original) => ({
	...(await original<typeof import("../src/box/container.ts")>()),
	containerBox: () => ({ kind: "container" }),
	dockerReady: async () => {},
	sweepBoxes: async () => {
		swept.container += 1;
		return ["a"];
	},
}));

const { chooseBox } = await import("../src/box/box.ts");

describe("boxes left behind", () => {
	it.each(["microvm", "container"] as const)("a daemon choosing a %s box sweeps them at start", async (kind) => {
		const lines: string[] = [];
		const before = swept[kind];
		await chooseBox("/nowhere/home", (line) => lines.push(line), kind);
		await vi.waitFor(() => expect(lines).toHaveLength(1));
		expect(swept[kind]).toBe(before + 1);
		expect(lines[0]).toMatch(/^box: removed \d left behind by homes that are gone$/);
	});
});
