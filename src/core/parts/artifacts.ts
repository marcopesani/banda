/**
 * Artifacts in a message (DESIGN.md "Messages"), by the id `publish` returned, two ways:
 * - `artifacts`: each drawn as its card after the message, at the version current then, kept in the call's receipt, so
 *   an old message keeps showing what it showed; a card a publish of the same run already drew at that version is not
 *   drawn again (once per run), and the result says so;
 * - a link in the text, `[words](artifact:<id>)`: the app draws it inline as the artifact's icon and its title in the
 *   Library (never the words written), and it opens the artifact. It draws no card.
 * The links are read as the app reads the text (`markdown-links.ts`), so what is checked is what is drawn. Every id is
 * checked against the Library before anything is sent; the call's result says what the owner sees, naming by title
 * only the artifacts of this chat, as the refusal lists them: an id from elsewhere is named by its id.
 */
import { Type } from "@earendil-works/pi-ai";
import type { JsonObject } from "@earendil-works/pi-durable";
import { ARTIFACT_ID, ARTIFACT_SCHEME, type Artifact, Artifacts, quoted } from "../artifacts.ts";
import { markdownLinks } from "../markdown-links.ts";
import type { MessagePart } from "./part.ts";

/** At most this many cards in one message. */
const MAX_SHOWN = 5;

const ids = (args: JsonObject): string[] =>
	Array.isArray(args.artifacts) ? args.artifacts.filter((id): id is string => typeof id === "string") : [];

/** In the artifact scheme, as the app's sanitizer and `Link` take it: any case, so another case is refused, not missed. */
const SCHEME = /^artifact:/i;
const ARTIFACT_LINK = new RegExp(`^${ARTIFACT_SCHEME}(${ARTIFACT_ID.source.slice(1, -1)})$`);

/** What the text draws in the artifact scheme: its links' targets, and why it cannot be sent as written. */
function artifactLinks(args: JsonObject): { readonly ids: readonly string[]; readonly refused?: string } {
	if (typeof args.text !== "string") return { ids: [] };
	const drawn = markdownLinks(args.text);
	const links = drawn.links.filter((href) => SCHEME.test(href));
	const bad = links.find((href) => !ARTIFACT_LINK.test(href));
	if (bad !== undefined)
		return {
			ids: [],
			refused: `${quoted(bad)} is no artifact link: link one as [words](artifact:<id>), its id as \`publish\` returned it`,
		};
	if (drawn.images.some((src) => SCHEME.test(src)))
		return { ids: [], refused: "an artifact is linked, [words](artifact:<id>), never shown as an image" };
	if (drawn.html.some((html) => /artifact\s*:/i.test(html)))
		return { ids: [], refused: "link an artifact in markdown, [words](artifact:<id>), not in HTML" };
	return { ids: [...new Set(links.map((href) => href.slice(ARTIFACT_SCHEME.length)))] };
}

export const artifacts: MessagePart = {
	parameters: {
		artifacts: Type.Optional(
			Type.Array(Type.String({ pattern: ARTIFACT_ID.source }), {
				minItems: 1,
				maxItems: MAX_SHOWN,
				description: "Artifacts in the owner's Library to show as cards, by the id `publish` returned.",
			}),
		),
	},
	describe:
		"`artifacts` shows published artifacts as cards, by the id `publish` returned; in `text`, " +
		"`[words](artifact:<id>)` links one inline by its own title, not your words, with no card. A path or file " +
		"name in words shows the owner nothing.",
	present: (args) => ids(args).length > 0,
	refuse: (args) => {
		const refused = artifactLinks(args).refused;
		if (refused !== undefined) return refused;
		if (args.artifacts === undefined) return undefined;
		const given = ids(args);
		if (!Array.isArray(args.artifacts) || given.length !== args.artifacts.length)
			return "artifacts is a list of artifact ids";
		return new Set(given).size === given.length ? undefined : "each artifact once";
	},
	prepare: async (args, api, ctx, { to }) => {
		const given = ids(args);
		const links = artifactLinks(args).ids;
		if (given.length === 0 && links.length === 0) return undefined;
		const chat = Number(api.conversationId);
		const library = (await api.snapshot(Artifacts, ctx))?.artifacts ?? {};
		const missing = [...new Set([...given, ...links])].filter((id) => library[id] === undefined);
		if (missing.length > 0) {
			const known = Object.entries(library)
				.filter(([, artifact]) => artifact.chat === chat)
				.map(([id, artifact]) => `${id} (${artifact.title})`);
			return (
				`no artifact ${missing.join(", ")} in the Library` +
				(known.length === 0 ? "; publish it first" : `; this chat's are ${known.join(", ")}`)
			);
		}
		const shown = given.map((id) => ({ id, n: library[id]?.versions.length ?? 0 }));
		// the cards a publish of this run already drew at that very version: the app draws them once (`once` in
		// web/src/lib/segments/artifacts.ts, `groupView` in a room), so the result says so, never a second card
		const drawn = await drawnThisRun(api, ctx, chat, to, library, shown);
		const named = (id: string, artifact: Artifact | undefined) =>
			artifact?.chat === chat ? `“${artifact.title}”` : `the artifact ${id}`;
		const seen = [
			...shown.map(({ id, n }) =>
				drawn.has(`${id}:${n}`)
					? `${named(id, library[id])} at version ${n} as the card your publish drew in this run, not a second one`
					: `${named(id, library[id])} as its card, at version ${n}`,
			),
			...links.map((id) => `${named(id, library[id])} as a link in your words`),
		].join("; ");
		return {
			...(shown.length === 0 ? {} : { receipt: { kind: "artifacts", artifacts: shown } }),
			seen: `the owner sees ${seen}`,
		};
	},
};

/**
 * Of `shown`, each `<id>:<n>` a publish of this chat drew in the run this call is in, counted as the app counts runs:
 * from the items it draws in a chat (`callRuns`), from the room's turns in a group member's (`runsOf`). Read only when
 * one of this chat's publishes made a shown version.
 */
async function drawnThisRun(
	api: Parameters<NonNullable<MessagePart["prepare"]>>[1],
	ctx: Parameters<NonNullable<MessagePart["prepare"]>>[2],
	chat: number,
	to: "owner" | "group",
	library: Readonly<Record<string, Artifact>>,
	shown: readonly { readonly id: string; readonly n: number }[],
): Promise<Set<string>> {
	const publishes = shown.flatMap(({ id, n }) =>
		Object.entries(library[id]?.published ?? {}).flatMap(([key, made]) =>
			made === n && key.startsWith(`${chat}:`) ? [{ version: `${id}:${n}`, call: key.slice(`${chat}:`.length) }] : [],
		),
	);
	if (publishes.length === 0) return new Set();
	// read lazily: the transcript and the groups import the speaking tools that import this part
	const runs = await api.commit(async (tx) => {
		if (to === "group") {
			const { runsOf } = await import("../groups.ts");
			const calls = await runsOf(tx, chat);
			return { runs: calls, last: Math.max(0, ...calls.values()) };
		}
		const { callRuns } = await import("../../server/transcript.ts");
		return callRuns(tx, chat);
	}, ctx);
	const now = runs.runs.get(api.callId) ?? runs.last;
	return new Set(
		publishes.flatMap(({ version, call }) => (call !== api.callId && runs.runs.get(call) === now ? [version] : [])),
	);
}
