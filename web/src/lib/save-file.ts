/**
 * Saving a file to the device (Download in a file's sheet, a file's chip, an image's download, an artifact's
 * Download). In a browser, the page's own download: an anchor with `download` on the file's object URL, and the browser
 * says the rest. In the phone's native shell its web view downloads nothing by itself, so the shell's save sheet takes
 * the bytes instead (`saveFile`, `BandaPlugin`): the owner picks where, or closes it, and the app says how it went.
 */
import { toast } from "sonner";
import { type BandaPlugin, nativeShell, toBase64 } from "./transport.ts";

/** How a save went: saved where the owner chose, or the sheet closed without a place. */
export type Saved = "saved" | "cancelled";

/** A file to save: its name, its bytes as an object URL, and its media type where known (else the bytes' own). */
export type FileToSave = {
	readonly name: string;
	readonly url: string;
	readonly mimeType?: string | undefined;
};

/** The ways a save can go, given so a test needs no page. */
export type SaveWays = {
	/** The shell's plugin, when the page runs in it; absent in a browser. */
	readonly plugin?: BandaPlugin | undefined;
	/** The page's own download: an anchor with `download` clicked. */
	readonly anchor: (url: string, name: string) => void;
	/** The bytes at an object URL, and the type they were served as. */
	readonly bytes: (url: string) => Promise<{ readonly bytes: Uint8Array; readonly type: string }>;
};

const clickAnchor = (url: string, name: string) => {
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
};

const fetchBytes = async (url: string) => {
	const blob = await (await fetch(url)).blob();
	return { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type };
};

/** The page's ways: the shell's plugin when it runs there, the page's anchor otherwise. */
export const pageWays = (): SaveWays => ({ plugin: nativeShell()?.banda, anchor: clickAnchor, bytes: fetchBytes });

/** Whether the page runs in the native shell, where an anchor's download does nothing. */
export const inNativeShell = () => nativeShell() !== undefined;

/** Save `file` the way this page can; throws when the shell could not write it where the owner chose. */
export async function saveFile(file: FileToSave, ways: SaveWays = pageWays()): Promise<Saved> {
	if (ways.plugin === undefined) {
		ways.anchor(file.url, file.name);
		return "saved";
	}
	const { bytes, type } = await ways.bytes(file.url);
	const mimeType = file.mimeType || type || "application/octet-stream";
	const { saved } = await ways.plugin.saveFile({ name: file.name, mimeType, body: toBase64(bytes) });
	return saved ? "saved" : "cancelled";
}

/** Why a save failed, in the owner's words: the shell's own reason where it gave one. */
export function saveFailureWords(error: unknown): string {
	if (error instanceof Error && (error as { code?: string }).code === "SAVE" && error.message !== "")
		return error.message;
	return "The phone couldn't save it. Try again, or open the file in another app.";
}

/**
 * Save `file` and say how it went: "Saved <name>" quietly in the shell (a browser shows its own download), nothing
 * when the owner closed the sheet, and a failure with Try again. `url` is asked only once the save starts, so a file
 * whose bytes have not come yet is fetched then.
 */
export async function saveAndSay(
	file: { readonly name: string; readonly url: () => Promise<string>; readonly mimeType?: string | undefined },
	ways: SaveWays = pageWays(),
	say: { success: (text: string) => void; failure: (title: string, words: string, retry: () => void) => void } = {
		success: (text) => void toast.success(text),
		failure: (title, words, retry) =>
			void toast.error(title, { description: words, action: { label: "Try again", onClick: retry } }),
	},
): Promise<void> {
	try {
		const went = await saveFile({ name: file.name, url: await file.url(), mimeType: file.mimeType }, ways);
		if (went === "saved" && ways.plugin !== undefined) say.success(`Saved ${file.name}`);
	} catch (error) {
		say.failure(`Couldn't save ${file.name}`, saveFailureWords(error), () => void saveAndSay(file, ways, say));
	}
}
