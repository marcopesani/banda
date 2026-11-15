/**
 * The working line: at the foot of the feed, the faces of the agents at work, side by side, for as long as they work.
 * "Working…" stands beside them until what they do shows in the feed; from then on the line is quiet, the faces
 * alone, since what they showed says the rest. Where the owner asked for less motion a still face says nothing, so
 * the words stay, still too. A tap opens their activity.
 */
import { useRef } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { Face } from "./Face.tsx";
import type { Who } from "./Row.tsx";

/** At most this many faces; past them, a count. */
const FACES = 3;

/** Who is working, in words: "Mara is working", "Mara and Sancho are working". */
export function workingLabel(names: readonly string[]): string {
	if (names.length <= 1) return `${names[0] ?? "Someone"} is working`;
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are working`;
}

export function WorkingLine({
	who,
	quiet = false,
	onOpen,
}: {
	/** The agents at work, in the order they started. */
	who: readonly Who[];
	/** Every one of them has shown something since its work began: the faces alone. */
	quiet?: boolean;
	/** A tap opens their activity; the line is handed over, for focus to come back to. */
	onOpen?: ((line: HTMLElement) => void) | undefined;
}) {
	const line = useRef<HTMLDivElement>(null);
	if (who.length === 0) return null;
	const label = workingLabel(who.map((each) => each.name));
	const shown = who.slice(0, FACES);
	const more = who.length - shown.length;
	const content = (
		<>
			<AvatarGroup aria-hidden="true" className="-space-x-1.5">
				{shown.map((each) => (
					<span key={each.id ?? each.name} data-slot="avatar" className="relative inline-flex rounded-full bg-paper">
						<Face face={each.face} name={each.name} size="message" state="working" />
					</span>
				))}
				{more > 0 ? <AvatarGroupCount className="size-7 text-meta">+{more}</AvatarGroupCount> : null}
			</AvatarGroup>
			{/* quiet, the moving faces say it; with less motion they are still, and the words say it instead */}
			<Shimmer as="span" duration={2.4} className={cn("text-meta", quiet && "motion-safe:hidden")}>
				Working…
			</Shimmer>
		</>
	);
	return (
		// the line itself takes focus back when the sheet it opened closes
		<div
			ref={line}
			tabIndex={-1}
			data-working-line=""
			data-quiet={quiet ? "" : undefined}
			className="flex rounded-full outline-none"
		>
			{onOpen === undefined ? (
				<div role="status" aria-label={label} className="flex items-center gap-2">
					{content}
				</div>
			) : (
				<button
					type="button"
					aria-label={label}
					aria-haspopup="dialog"
					className="-m-2 flex min-h-11 items-center gap-2 rounded-full p-2 outline-none hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-ink"
					onClick={() => {
						if (line.current !== null) onOpen(line.current);
					}}
				>
					{content}
				</button>
			)}
		</div>
	);
}
