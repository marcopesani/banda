import { describe, expect, it } from "vitest";
import { type SaveWays, saveAndSay, saveFailureWords, saveFile } from "./save-file.ts";
import type { BandaPlugin } from "./transport.ts";

const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => i % 251);

/** The ways a page has, scripted: the anchor and the bytes are logged, and the shell answers `answer`. */
function ways(answer?: (options: { name: string; mimeType: string; body: string }) => Promise<{ saved: boolean }>) {
	const clicked: [string, string][] = [];
	const asked: string[] = [];
	const saved: { name: string; mimeType: string; body: string }[] = [];
	const plugin =
		answer === undefined
			? undefined
			: ({
					saveFile: async (options: { name: string; mimeType: string; body: string }) => {
						saved.push(options);
						return answer(options);
					},
				} as unknown as BandaPlugin);
	const given: SaveWays = {
		plugin,
		anchor: (url, name) => void clicked.push([url, name]),
		bytes: async (url) => {
			asked.push(url);
			return { bytes: bytes(70_000), type: "application/pdf" };
		},
	};
	return { given, clicked, asked, saved };
}

describe("saving a file", () => {
	it("in a browser is the page's own download: the anchor, and the bytes are never fetched", async () => {
		const { given, clicked, asked } = ways();
		expect(await saveFile({ name: "report.pdf", url: "blob:1" }, given)).toBe("saved");
		expect(clicked).toEqual([["blob:1", "report.pdf"]]);
		expect(asked).toEqual([]);
	});

	it("in the shell hands the bytes to its save sheet, base64 whole, typed as served", async () => {
		const { given, clicked, saved } = ways(async () => ({ saved: true }));
		expect(await saveFile({ name: "report.pdf", url: "blob:2" }, given)).toBe("saved");
		expect(clicked).toEqual([]);
		expect(saved).toHaveLength(1);
		expect(saved[0]?.name).toBe("report.pdf");
		expect(saved[0]?.mimeType).toBe("application/pdf");
		// 70,000 bytes cross the bridge whole, past the 32 KiB the encoder takes at a time
		expect(Buffer.from(saved[0]?.body ?? "", "base64")).toEqual(Buffer.from(bytes(70_000)));
	});

	it("takes the file's own type over the bytes', and falls back to octets", async () => {
		const typed = ways(async () => ({ saved: true }));
		await saveFile({ name: "a.bin", url: "blob:3", mimeType: "image/png" }, typed.given);
		expect(typed.saved[0]?.mimeType).toBe("image/png");
		const untyped = ways(async () => ({ saved: true }));
		await saveFile(
			{ name: "a.bin", url: "blob:3" },
			{ ...untyped.given, bytes: async () => ({ bytes: bytes(3), type: "" }) },
		);
		expect(untyped.saved[0]?.mimeType).toBe("application/octet-stream");
	});

	it("is cancelled when the owner closes the sheet", async () => {
		const { given } = ways(async () => ({ saved: false }));
		expect(await saveFile({ name: "report.pdf", url: "blob:4" }, given)).toBe("cancelled");
	});

	it("fails as the shell said when the chosen place refused it", async () => {
		const { given } = ways(async () => {
			throw Object.assign(new Error("Couldn't write the file there: no space left."), { code: "SAVE" });
		});
		await expect(saveFile({ name: "report.pdf", url: "blob:5" }, given)).rejects.toThrow("no space left");
	});
});

describe("what a save says", () => {
	const said = () => {
		const success: string[] = [];
		const failure: { title: string; words: string; retry: () => void }[] = [];
		return {
			success,
			failure,
			say: {
				success: (text: string) => void success.push(text),
				failure: (title: string, words: string, retry: () => void) => void failure.push({ title, words, retry }),
			},
		};
	};

	it("says Saved in the shell, and nothing in a browser, whose download speaks for itself", async () => {
		const shell = ways(async () => ({ saved: true }));
		const inShell = said();
		await saveAndSay({ name: "report.pdf", url: async () => "blob:6" }, shell.given, inShell.say);
		expect(inShell.success).toEqual(["Saved report.pdf"]);
		const browser = ways();
		const inBrowser = said();
		await saveAndSay({ name: "report.pdf", url: async () => "blob:6" }, browser.given, inBrowser.say);
		expect(inBrowser.success).toEqual([]);
		expect(inBrowser.failure).toEqual([]);
	});

	it("says nothing when the owner closed the sheet", async () => {
		const shell = ways(async () => ({ saved: false }));
		const words = said();
		await saveAndSay({ name: "report.pdf", url: async () => "blob:7" }, shell.given, words.say);
		expect(words.success).toEqual([]);
		expect(words.failure).toEqual([]);
	});

	it("says what failed, why, and offers Try again, which saves again", async () => {
		let attempts = 0;
		const shell = ways(async () => {
			attempts++;
			if (attempts === 1)
				throw Object.assign(new Error("Couldn't write the file there: it is read only."), { code: "SAVE" });
			return { saved: true };
		});
		const words = said();
		await saveAndSay({ name: "report.pdf", url: async () => "blob:8" }, shell.given, words.say);
		expect(words.failure.map((one) => [one.title, one.words])).toEqual([
			["Couldn't save report.pdf", "Couldn't write the file there: it is read only."],
		]);
		words.failure[0]?.retry();
		await new Promise((done) => setTimeout(done, 0));
		expect(attempts).toBe(2);
		expect(words.success).toEqual(["Saved report.pdf"]);
	});

	it("names the fetch of the bytes as the failure when it is", async () => {
		const shell = ways(async () => ({ saved: true }));
		const words = said();
		await saveAndSay(
			{ name: "report.pdf", url: async () => "blob:9" },
			{ ...shell.given, bytes: async () => Promise.reject(new Error("HTTP 500")) },
			words.say,
		);
		expect(words.failure[0]?.words).toBe("The phone couldn't save it. Try again, or open the file in another app.");
	});

	it("keeps the shell's reason only when it is the shell's", () => {
		expect(saveFailureWords(Object.assign(new Error("No space left."), { code: "SAVE" }))).toBe("No space left.");
		expect(saveFailureWords(new Error("TypeError: fetch failed"))).toMatch(/couldn't save it/);
		expect(saveFailureWords("x")).toMatch(/couldn't save it/);
	});
});
