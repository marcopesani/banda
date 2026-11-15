/**
 * ai-elements Tool, adapted to banda's tokens: a tool call as a collapsible card, its name and what it acted on in the
 * header with how it went, its parameters and its result inside. The states are banda's own, not the AI SDK's.
 */
import {
	CheckIcon,
	ChevronDownIcon,
	CircleAlertIcon,
	CircleDashedIcon,
	HandIcon,
	LoaderIcon,
	SquareIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";

/** `waiting` is on the owner; `pending` ended with no recorded result. */
export type ToolState = "running" | "waiting" | "done" | "error" | "stopped" | "pending";

const WORDS: Record<ToolState, string> = {
	running: "Running",
	waiting: "Waiting on you",
	done: "Done",
	error: "Failed",
	stopped: "Stopped",
	pending: "No result",
};

export function Tool({ className, ...props }: ComponentProps<typeof Collapsible>) {
	return (
		<Collapsible
			data-tool=""
			className={cn(
				"not-prose group/tool w-full min-w-0 overflow-hidden rounded-field border border-line-soft bg-paper",
				className,
			)}
			{...props}
		/>
	);
}

export function ToolStatus({ state, children }: { state: ToolState; children?: ReactNode }) {
	const Icon =
		state === "running"
			? LoaderIcon
			: state === "waiting"
				? HandIcon
				: state === "done"
					? CheckIcon
					: state === "error"
						? CircleAlertIcon
						: state === "stopped"
							? SquareIcon
							: CircleDashedIcon;
	return (
		<span
			data-tool-state={state}
			className={cn(
				"flex shrink-0 items-center gap-1 text-meta tabular-nums",
				state === "error"
					? "text-danger"
					: state === "running"
						? "text-alive"
						: state === "waiting"
							? "text-ink"
							: "text-ink-2",
			)}
		>
			<Icon aria-hidden="true" className={cn("size-3.5", state === "running" && "motion-safe:animate-spin")} />
			{children ?? WORDS[state]}
		</span>
	);
}

export function ToolHeader({
	icon,
	title,
	summary,
	state,
	status,
	className,
	...props
}: Omit<ComponentProps<typeof CollapsibleTrigger>, "title"> & {
	icon: ReactNode;
	/** The tool by name, as the model called it. */
	title: string;
	/** What it acted on, in a line. */
	summary?: ReactNode;
	state: ToolState;
	/** Words in place of the state's own: "Done · 4.0s". */
	status?: ReactNode;
}) {
	return (
		<CollapsibleTrigger
			className={cn(
				"flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 px-3 py-2 text-left outline-none hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
				className,
			)}
			{...props}
		>
			<span className="shrink-0 text-ink-2">{icon}</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span data-raw-title="" className="truncate font-code text-meta font-medium text-ink">
					{title}
				</span>
				{summary === undefined || summary === "" ? null : (
					<span data-tool-preview="" className="flex min-w-0 text-meta text-ink-2">
						{summary}
					</span>
				)}
			</span>
			<ToolStatus state={state}>{status}</ToolStatus>
			<ChevronDownIcon
				aria-hidden="true"
				className="size-3.5 shrink-0 text-ink-3 transition-transform group-data-[state=open]/tool:rotate-180 motion-reduce:transition-none"
			/>
		</CollapsibleTrigger>
	);
}

export function ToolContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) {
	return (
		<CollapsibleContent
			className={cn("flex min-w-0 flex-col gap-3 border-t border-line-soft p-3", className)}
			{...props}
		/>
	);
}
