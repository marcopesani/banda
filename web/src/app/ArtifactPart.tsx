/**
 * An artifact in a message, at the version the message shows: its card, or, when it is an image, the image itself as
 * an attached one shows, captioned. The version's bytes and how many versions there are now come from the Library the
 * shell holds; until it names the version, or when its bytes cannot be read, the card stands in, and still opens it.
 */
import type { ReactNode } from "react";
import { ArtifactCard, ArtifactImage, ArtifactLink } from "../chat/Cards.tsx";
import { ImageLoading } from "../chat/Files.tsx";
import { blobFile } from "../lib/api.ts";
import { useShellPick } from "../lib/shell.ts";
import { kindWords } from "./ArtifactPage.tsx";
import { useLoad } from "./FilePart.tsx";
import { hrefOf } from "./where.ts";

/**
 * An artifact a message's words link, `[words](artifact:<id>)` (DESIGN.md "Messages"): drawn by what the Library holds,
 * its title and kind there, never the words, which only the model wrote; a link that opens it as its card does. Until
 * the shell has the Library, the words; once it has, an id it does not hold (removed since, or never one) is the words,
 * marked unavailable.
 */
export function ArtifactReference({ id, words }: { id: string | undefined; words: ReactNode }) {
	const held = useShellPick((shell) => {
		if (shell.artifacts === undefined) return "";
		const artifact = id === undefined ? undefined : shell.artifacts.find((one) => one.id === id);
		return JSON.stringify(artifact === undefined ? null : [artifact.title, artifact.kind]);
	});
	if (held === "") return <span data-artifact-link="loading">{words}</span>;
	const found = JSON.parse(held) as [string, string] | null;
	if (found === null || id === undefined) return <ArtifactLink title={words} kind="Artifact" unavailable />;
	return <ArtifactLink title={found[0]} kind={kindWords(found[1])} href={hrefOf({ name: "artifact", id })} />;
}

export function ArtifactPart({
	id,
	n,
	title,
	kind,
	change,
	onOpen,
}: {
	id: string;
	/** The version the message shows; the newest when it does not say. */
	n?: number | undefined;
	title: string;
	kind: string;
	change?: string | undefined;
	onOpen?: (() => void) | undefined;
}) {
	// one string, so a message draws again only when its own artifact changed
	const [versions = "", sha = ""] = useShellPick((shell) => {
		const artifact = kind === "image" ? shell.artifacts?.find((one) => one.id === id) : undefined;
		const version = artifact?.versions[(n ?? artifact.versions.length) - 1];
		return artifact === undefined || version === undefined ? "" : `${artifact.versions.length}:${version.sha}`;
	}).split(":");
	const bytes = useLoad(sha === "" ? undefined : sha, () => blobFile(sha));
	if (sha !== "" && bytes.state === "ready")
		return <ArtifactImage src={bytes.value} title={title} versions={Number(versions)} onOpen={onOpen} />;
	if (sha !== "" && bytes.state === "loading") return <ImageLoading name={title} />;
	return (
		<ArtifactCard
			title={title}
			kind={kindWords(kind)}
			version={`Version ${n ?? 1}${change === undefined ? "" : ` · ${change}`}`}
			{...(onOpen === undefined ? {} : { onOpen })}
		/>
	);
}
