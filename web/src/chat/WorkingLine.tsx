/**
 * The working line: at the foot of the feed, the faces of the agents at work, side by side, for as long as they work,
 * and beside them what they do now, in words: what the running tool does ("Reading notes.md…"), "Thinking…", or
 * "Working…" when nothing says more. The words stay for the whole of the work, after what the agent showed and after
 * the owner answered an ask, and change as the work does. While the work waits on the owner's answer to an ask, the
 * line stays and says so: "Waiting on you", the faces still and dotted, the words still. A tap opens their activity.
 */
import { useRef } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Face } from "./Face.tsx";
import type { Who } from "./Row.tsx";

/** At most this many faces; past them, a count. */
const FACES = 3;

/** Who is working, in words: "Mara is working", "Mara and Sancho are working". */
export function workingLabel(names: readonly string[]): string {
	if (names.length <= 1) return `${names[0] ?? "Someone"} is working`;
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are working`;
}

/** Who waits on the owner, in words: "Mara is waiting on you", "Mara and Sancho are waiting on you". */
export function waitingLabel(names: readonly string[]): string {
	if (names.length <= 1) return `${names[0] ?? "Someone"} is waiting on you`;
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are waiting on you`;
}

export function WorkingLine({
	who,
	text = "Working…",
	waiting = false,
	onOpen,
}: {
	/** The agents at work, in the order they started; or, `waiting`, those whose ask waits on the owner. */
	who: readonly Who[];
	/** What they do now, as the feed's working segment says it; "Working…" when nothing says more. */
	text?: string;
	/** They wait on the owner's answer to an ask: nothing moves, and the words say so. */
	waiting?: boolean;
	/** A tap opens their activity; the line is handed over, for focus to come back to. */
	onOpen?: ((line: HTMLElement) => void) | undefined;
}) {
	const line = useRef<HTMLDivElement>(null);
	if (who.length === 0) return null;
	const names = who.map((each) => each.name);
	const label = waiting ? waitingLabel(names) : `${workingLabel(names)}: ${text}`;
	const shown = who.slice(0, FACES);
	const more = who.length - shown.length;
	const content = (
		<>
			<AvatarGroup aria-hidden="true" className="-space-x-1.5">
				{shown.map((each) => (
					<span key={each.id ?? each.name} data-slot="avatar" className="relative inline-flex rounded-full bg-paper">
						<Face face={each.face} name={each.name} size="message" state={waiting ? "waiting" : "working"} />
					</span>
				))}
				{more > 0 ? <AvatarGroupCount className="size-7 text-meta">+{more}</AvatarGroupCount> : null}
			</AvatarGroup>
			{/* one line however long a file's name: the words end in an ellipsis before they wrap */}
			{waiting ? (
				<span className="min-w-0 truncate text-meta text-ink-2">{text}</span>
			) : (
				<Shimmer as="span" duration={2.4} className="min-w-0 truncate text-meta">
					{text}
				</Shimmer>
			)}
		</>
	);
	return (
		// the line itself takes focus back when the sheet it opened closes
		<div
			ref={line}
			tabIndex={-1}
			data-working-line=""
			{...(waiting ? { "data-waiting": "" } : {})}
			className="flex min-w-0 rounded-full outline-none"
		>
			{onOpen === undefined ? (
				<div role="status" aria-label={label} className="flex min-w-0 items-center gap-2">
					{content}
				</div>
			) : (
				<button
					type="button"
					aria-label={label}
					aria-haspopup="dialog"
					className="-m-2 flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full p-2 text-left outline-none hover:bg-paper-2 focus-visible:ring-2 focus-visible:ring-ink"
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
