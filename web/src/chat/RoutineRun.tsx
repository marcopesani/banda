/**
 * A routine's run in the chat's feed: its line, and beneath it, once the owner opens it, the run's own conversation in a
 * box. Nothing of the run is read until then: the caller reads it when `onOpenChange` says open, and says how far that
 * got in `run`. The box holds the same parts the chat draws, the caller's children, and scrolls within its height, so
 * a long run never pushes the chat away.
 */
import { CalendarClockIcon, ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { Line } from "./Line.tsx";

/** How far reading the run got: on its way, here, or failed with why. */
export type RunRead = "reading" | "read" | { readonly failed: string };

export function RoutineRun({
	words,
	time,
	working = false,
	open,
	onOpenChange,
	run,
	onTryAgain,
	children,
}: {
	/** The line's words: "Morning brief ran", "You ran Morning brief", "Running Morning brief…". */
	words: string;
	time?: string | undefined;
	/** The run still goes: its words shimmer, as a working line's do. */
	working?: boolean;
	open: boolean;
	/** The owner opened or closed it; open is when the caller reads the run, if it has not. */
	onOpenChange: (open: boolean) => void;
	run: RunRead;
	/** Read it again, after it failed. */
	onTryAgain?: (() => void) | undefined;
	/** The run's conversation, as the chat draws one. Drawn only once open and read. */
	children?: ReactNode;
}) {
	return (
		<Collapsible
			open={open}
			onOpenChange={onOpenChange}
			className="mx-auto flex w-full max-w-[var(--measure)] flex-col items-center gap-2 px-4"
		>
			<CollapsibleTrigger
				className={cn(
					"group/run min-w-0 cursor-pointer rounded-field px-1 text-center text-ui text-ink-2 [overflow-wrap:anywhere]",
					"hover:bg-paper-3 focus-visible:bg-paper-3 focus-visible:outline-none",
				)}
			>
				<CalendarClockIcon aria-hidden="true" className="mr-1.5 inline-block size-3.5 shrink-0 align-[-0.1875rem]" />
				{working ? <Shimmer as="span">{words}</Shimmer> : words}
				{time === undefined ? null : <span className="ml-1.5 whitespace-nowrap text-meta text-ink-2">{time}</span>}
				<ChevronDownIcon
					aria-hidden="true"
					className="ml-1 inline-block size-3.5 shrink-0 align-[-0.1875rem] transition-transform duration-150 group-data-[state=open]/run:rotate-180 motion-reduce:transition-none"
				/>
			</CollapsibleTrigger>
			<CollapsibleContent className="w-full">
				<section
					aria-label={`${words}: what it did`}
					className="flex flex-col overflow-hidden rounded-tile border border-line-soft bg-paper"
				>
					<div
						data-routine-run=""
						// reachable by keyboard: a box that scrolls has to take focus to be scrolled without a pointer
						// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region is focusable so its keys scroll it
						tabIndex={0}
						className="flex max-h-[min(24rem,60svh)] flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-3 outline-none focus-visible:bg-paper-2"
					>
						{run === "reading" ? (
							<RunReading />
						) : run === "read" ? (
							children
						) : (
							<Line
								tone="danger"
								className="px-0"
								action={onTryAgain === undefined ? undefined : { label: "Try again", onClick: onTryAgain }}
							>
								{run.failed}
							</Line>
						)}
					</div>
				</section>
			</CollapsibleContent>
		</Collapsible>
	);
}

/** The run on its way: the shape of a short conversation, at the box's width. */
function RunReading() {
	const bone = "bg-paper-3 motion-reduce:animate-none";
	return (
		<div role="status" aria-label="Loading the run" className="flex flex-col gap-3 py-1">
			<Skeleton className={cn(bone, "h-3 w-2/5 self-center rounded-full")} />
			<Skeleton className={cn(bone, "h-3 w-1/3 rounded-full")} />
			<Skeleton className={cn(bone, "h-12 w-3/4 rounded-bubble")} />
		</div>
	);
}
