/**
 * One step of work, as Activity and a coding session's steps both draw it: an icon on the rail, a verb and what it
 * acted on in one line, how it went at the right, and what it opens to in place. Built on ai-elements' ChainOfThought.
 */
import { ChevronDownIcon, ChevronRightIcon, LoaderIcon, type LucideIcon, type LucideProps } from "lucide-react";
import type { ReactNode } from "react";
import { ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/cn";
import { commandEnds, type Ends } from "@/lib/ends";
import { KeepEnd } from "./KeepEnd.tsx";

/** How a step stands: `waiting` is on the owner, `pending` never got a result. */
export type StepStatus = "done" | "active" | "waiting" | "failed" | "pending";

/** The icon of work with no step of its own yet: it turns, and stands still for reduced motion. */
export const WorkingIcon = ((props: LucideProps) => (
	<LoaderIcon {...props} className={cn(props.className, "motion-safe:animate-spin")} />
)) as LucideIcon;

/** A verb and what it acted on. Code (a path, a command) is mono and keeps its end; words truncate at theirs. */
export function StepWords({
	verb,
	object = "",
	code = false,
	ends,
	active = false,
}: {
	verb: string;
	object?: string;
	code?: boolean;
	/** Where the object is cut short of room; by default as a command or a path is. */
	ends?: Ends | undefined;
	/** At work: a light sweeps across the verb. */
	active?: boolean;
}) {
	return (
		<>
			{active ? (
				<Shimmer as="span" className="shrink-0 max-sm:order-1">
					{verb}
				</Shimmer>
			) : (
				<span className="shrink-0 text-ink-2 max-sm:order-1">{verb}</span>
			)}
			{object === "" ? null : code ? (
				<KeepEnd
					ends={ends ?? commandEnds(object)}
					whole={object}
					className="max-w-full font-code text-meta text-ink max-sm:order-4 max-sm:basis-full"
				/>
			) : ends !== undefined && ends.end !== "" ? (
				<KeepEnd ends={ends} whole={object} className="max-w-full text-ui text-ink max-sm:order-2 max-sm:flex-1" />
			) : (
				<span data-step-object="" className="max-w-full min-w-0 truncate text-ui text-ink max-sm:order-2 max-sm:flex-1">
					{object}
				</span>
			)}
		</>
	);
}

/**
 * The line and its words. On a narrow screen the words join the line's own flow (`contents`), so a path or a command
 * takes a second line, whole width, under its verb and how it went: its last step and its file name read at 320px.
 */
const LINE = "items-baseline gap-x-1.5 gap-y-0.5 max-sm:flex-wrap";
const WORDS = "flex min-w-0 flex-1 items-baseline gap-1.5 max-sm:contents";
const END = "max-sm:order-3 max-sm:ml-auto";

const RAIL: Record<StepStatus, "complete" | "active" | "pending" | "failed"> = {
	done: "complete",
	active: "active",
	waiting: "active",
	failed: "failed",
	pending: "pending",
};

/**
 * A step folded to its one line. With `detail` the line is a real button (44px tall on a touch screen) that opens it in
 * place; `always` shows folded or not.
 */
export function Step({
	icon,
	status = "done",
	words,
	meta,
	detail,
	always,
	open = false,
	onToggle,
	onOpen,
	name,
}: {
	icon: LucideIcon;
	status?: StepStatus;
	words: ReactNode;
	/** How it went, at the line's end: how long it took, or "Failed", "Waiting on you". */
	meta?: ReactNode;
	detail?: ReactNode;
	always?: ReactNode;
	open?: boolean;
	onToggle?: (() => void) | undefined;
	/** In place of opening here: the line leads somewhere else (the transcript, at this step). */
	onOpen?: (() => void) | undefined;
	/** What the step is, for a test or a script to find it by. */
	name?: string | undefined;
}) {
	const folds = detail !== undefined && onToggle !== undefined;
	const end =
		meta === undefined || meta === "" ? null : (
			<span
				data-step-meta=""
				className={cn(
					"shrink-0 text-meta tabular-nums",
					folds || onOpen !== undefined ? "" : END,
					status === "failed" ? "text-danger" : status === "waiting" ? "text-ink" : "text-ink-3",
				)}
			>
				{meta}
			</span>
		);
	if (!folds && onOpen === undefined)
		return (
			<ChainOfThoughtStep
				icon={icon}
				status={RAIL[status]}
				data-step={name}
				label={
					<span className={cn("flex min-w-0", LINE)}>
						<span className={WORDS}>{words}</span>
						{end}
					</span>
				}
			>
				{always}
			</ChainOfThoughtStep>
		);
	return (
		<ChainOfThoughtStep
			icon={icon}
			status={RAIL[status]}
			data-step={name}
			label={
				// the touch target grows by an invisible halo (±13px: 44px on an 18px row), never by moving the text off
				// the icon's line; expanded content stays in this text column, aligned with the words, not the icon
				<button
					type="button"
					{...(folds ? { "aria-expanded": open } : {})}
					onClick={folds ? onToggle : onOpen}
					className="group/row relative -mx-1 flex w-[calc(100%+0.5rem)] min-w-0 cursor-pointer items-start gap-x-1.5 gap-y-0.5 rounded-field px-1 text-left max-sm:flex-wrap outline-none before:absolute before:inset-x-0 before:-inset-y-1 before:rounded-field hover:before:bg-paper-2 focus-visible:outline-[1.5px] focus-visible:outline-offset-2 focus-visible:outline-focus pointer-coarse:before:-inset-y-[13px] max-sm:before:-inset-y-[13px]"
				>
					<span className={cn("relative", WORDS)}>{words}</span>
					<span className={cn("relative flex shrink-0 items-baseline gap-1.5", END)}>
						{end}
						<span aria-hidden="true" className="flex h-[1.125rem] items-center self-start">
							{folds ? (
								<ChevronDownIcon
									className={cn(
										"size-3.5 shrink-0 text-ink-3 transition-transform motion-reduce:transition-none",
										open && "rotate-180",
									)}
								/>
							) : (
								<ChevronRightIcon className="size-3.5 shrink-0 text-ink-3" />
							)}
						</span>
					</span>
				</button>
			}
		>
			{always}
			{folds && open ? detail : null}
		</ChainOfThoughtStep>
	);
}
