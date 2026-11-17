/**
 * Artifacts in a message (DESIGN.md "Messages"), by the id `publish` returned, two ways:
 * - `artifacts`: each drawn as its card after the message, at the version current then, kept in the call's receipt, so
 *   an old message keeps showing what it showed;
 * - a link in the text, `[words](artifact:<id>)`: the app draws it inline as the artifact's icon and its title in the
 *   Library (never the words written), and it opens the artifact. It draws no card.
 * Either id is checked against the Library before anything is sent; the call's result says what the owner sees.
 */
import { Type } from "@earendil-works/pi-ai";
import type { JsonObject } from "@earendil-works/pi-durable";
import { ARTIFACT_ID, ARTIFACT_SCHEME, type Artifact, Artifacts, artifactLinks, quoted } from "../artifacts.ts";
import type { MessagePart } from "./part.ts";

/** At most this many cards in one message. */
const MAX_SHOWN = 5;

const ids = (args: JsonObject): string[] =>
	Array.isArray(args.artifacts) ? args.artifacts.filter((id): id is string => typeof id === "string") : [];

/** The ids the text links, each once, in order; a link that names no id is refused before (`refuse`). */
const linked = (args: JsonObject): string[] =>
	typeof args.text === "string"
		? [...new Set(artifactLinks(args.text).map((href) => href.slice(ARTIFACT_SCHEME.length)))]
		: [];

const named = (id: string, artifact: Artifact | undefined) => `“${artifact?.title ?? id}”`;

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
		const links = typeof args.text === "string" ? artifactLinks(args.text) : [];
		const bad = links.find(
			(href) => !href.startsWith(ARTIFACT_SCHEME) || !ARTIFACT_ID.test(href.slice(ARTIFACT_SCHEME.length)),
		);
		if (bad !== undefined)
			return `${quoted(bad)} is no artifact link: link one as [words](artifact:<id>), its id as \`publish\` returned it`;
		if (args.artifacts === undefined) return undefined;
		const given = ids(args);
		if (!Array.isArray(args.artifacts) || given.length !== args.artifacts.length)
			return "artifacts is a list of artifact ids";
		return new Set(given).size === given.length ? undefined : "each artifact once";
	},
	prepare: async (args, api, ctx) => {
		const given = ids(args);
		const links = linked(args);
		if (given.length === 0 && links.length === 0) return undefined;
		const library = (await api.snapshot(Artifacts, ctx))?.artifacts ?? {};
		const missing = [...new Set([...given, ...links])].filter((id) => library[id] === undefined);
		if (missing.length > 0) {
			const known = Object.entries(library)
				.filter(([, artifact]) => artifact.chat === Number(api.conversationId))
				.map(([id, artifact]) => `${id} (${artifact.title})`);
			return (
				`no artifact ${missing.join(", ")} in the Library` +
				(known.length === 0 ? "; publish it first" : `; this chat's are ${known.join(", ")}`)
			);
		}
		const shown = given.map((id) => ({ id, n: library[id]?.versions.length ?? 0 }));
		const seen = [
			...shown.map(({ id, n }) => `${named(id, library[id])} as its card, at version ${n}`),
			...links.map((id) => `${named(id, library[id])} as a link in your words`),
		].join("; ");
		return {
			...(shown.length === 0 ? {} : { receipt: { kind: "artifacts", artifacts: shown } }),
			seen: `the owner sees ${seen}`,
		};
	},
};
