/**
 * The companion's defaults and Identity choices: name, avatar face and personality. A new home starts with these
 * defaults, without a setup screen.
 */

import { type AvatarFace, defaultAvatarFace } from "./avatar-face.ts";
import { hiddenError, nfc } from "./visible.ts";

export const DEFAULT_NAME = "Sancho";
export const NAME_SUGGESTIONS = ["Sancho", "Rucio", "Dulcinea", "Teresa"] as const;

/** The chat bubble, copied into each new agent's definition. */
export const DEFAULT_FACE = defaultAvatarFace();

// The library uses interfaces; mapped objects make the same shape satisfy pi-durable's JSON document constraint.
type Stored<T> = { -readonly [K in keyof T]: T[K] extends object ? Stored<T[K]> : T[K] };
export type StoredAvatarFace = Stored<AvatarFace>;

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/** `text` as one emoji (trimmed), or undefined when it is not exactly one. */
export function oneEmoji(text: string): string | undefined {
	const trimmed = text.trim();
	if (trimmed === "" || trimmed.length > 32) return undefined;
	const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(trimmed)];
	if (graphemes.length !== 1 || !PICTOGRAPH.test(trimmed)) return undefined;
	return trimmed;
}

/** The first emoji in `text`, for a field the owner types or pastes into; undefined when there is none. */
export function firstEmoji(text: string): string | undefined {
	for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
		const emoji = oneEmoji(segment);
		if (emoji !== undefined) return emoji;
	}
	return undefined;
}

/**
 * The personality: how the companion speaks, in the owner's own words (no presets), the body of the lead's agent file,
 * as every agent's body is its personality (DESIGN.md "Agents"). The default is where a new companion starts, after
 * its role; the owner rewrites the whole body on About, and the companion may propose new words.
 */
export const DEFAULT_PERSONALITY =
	"Speak warmly and plainly, like a trusted friend: kind and encouraging, never gushing.";

/** The longest name the owner can give an account. */
export const ACCOUNT_LABEL_MAX = 60;

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * `text` as a personality, or why it cannot be one: a few words, as the body of an agent file (the file's own size
 * limit bounds it). A heading is fine: the body is the owner's to shape.
 */
export function personalityWords(text: string): string | { refused: string } {
	// checked before trimming: trim() removes some invisible characters (U+FEFF) rather than let them be refused
	const hidden = hiddenError(text, { lines: true });
	if (hidden !== undefined) return { refused: `a personality ${hidden.replace(/^it /, "")}` };
	const words = nfc(text.replace(/\r\n?/g, "\n").trim());
	if (words === "") return { refused: "a personality needs a few words" };
	return words;
}

/**
 * An agent file with its body replaced by `words`, its frontmatter as it was; the file itself, byte for byte, when its
 * body is those words already (the daemon then saves nothing, and the app expects exactly that file back).
 */
export function withPersonality(text: string, words: string): string {
	if (personalityOf(text) === words.trim()) return text;
	const head = FRONTMATTER.exec(text)?.[0] ?? "";
	return `${head.trimEnd()}\n${words.trim()}\n`;
}

/** The words of an agent file's body, its personality; undefined when it has none. */
export function personalityOf(text: string): string | undefined {
	const body = text.slice(FRONTMATTER.exec(text)?.[0].length ?? 0).trim();
	return body === "" ? undefined : body;
}
