/**
 * ai-elements Reasoning, adapted to banda's tokens: what the model thought, folded behind "Thought for 4s". It opens
 * while it streams and then stays as the reader left it: a transcript is read, and nothing in it folds by itself. The
 * time comes from the daemon's record, not a clock here; the text is the app's Markdown, not a second Streamdown.
 */
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext } from "react";
import { Markdown } from "@/components/Markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/cn";
import { Shimmer } from "./shimmer";

const ReasoningContext = createContext<{ isStreaming: boolean; duration: number | undefined }>({
	isStreaming: false,
	duration: undefined,
});

export function Reasoning({
	className,
	isStreaming = false,
	duration,
	defaultOpen = isStreaming,
	...props
}: ComponentProps<typeof Collapsible> & {
	isStreaming?: boolean;
	/** How long it thought, in milliseconds, when it was timed. */
	duration?: number | undefined;
}) {
	return (
		<ReasoningContext.Provider value={{ isStreaming, duration }}>
			<Collapsible
				data-reasoning=""
				defaultOpen={defaultOpen}
				className={cn("not-prose group/reasoning flex w-full min-w-0 flex-col", className)}
				{...props}
			/>
		</ReasoningContext.Provider>
	);
}

const thoughtFor = (ms: number) => {
	const seconds = Math.max(1, Math.round(ms / 1000));
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export function ReasoningTrigger({
	className,
	children,
	...props
}: ComponentProps<typeof CollapsibleTrigger> & { children?: ReactNode }) {
	const { isStreaming, duration } = useContext(ReasoningContext);
	return (
		<CollapsibleTrigger
			className={cn(
				"flex min-h-8 w-fit max-w-full cursor-pointer items-center gap-2 rounded-field text-left text-ui text-ink-2 outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
				className,
			)}
			{...props}
		>
			<BrainIcon aria-hidden="true" className="size-4 shrink-0" />
			{children ??
				(isStreaming ? (
					<Shimmer as="span" duration={1.6}>
						Thinking…
					</Shimmer>
				) : (
					<span data-raw-title="">{duration === undefined ? "Thought" : `Thought for ${thoughtFor(duration)}`}</span>
				))}
			<ChevronDownIcon
				aria-hidden="true"
				className="size-3.5 shrink-0 text-ink-3 transition-transform group-data-[state=open]/reasoning:rotate-180 motion-reduce:transition-none"
			/>
		</CollapsibleTrigger>
	);
}

export function ReasoningContent({
	className,
	children,
	...props
}: Omit<ComponentProps<typeof CollapsibleContent>, "children"> & { children: string }) {
	return (
		<CollapsibleContent
			className={cn("mt-2 min-w-0 border-l border-line-soft pl-3 text-ui text-ink-2", className)}
			{...props}
		>
			<div data-thinking="" className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
				<Markdown>{children}</Markdown>
			</div>
		</CollapsibleContent>
	);
}
