/**
 * Contextual disclosure over the chat's existing entries and stream. Opening it never submits work. Two depths: the
 * activity, a chain of thought with one line a step; and the transcript, the same work as a conversation, its messages
 * whole and each tool call a card to open.
 */
import {
	BookOpenIcon,
	BrainIcon,
	CheckIcon,
	CircleAlertIcon,
	ClockIcon,
	CodeXmlIcon,
	MessagesSquareIcon,
	PenLineIcon,
	SquareIcon,
} from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { AvatarFace } from "../../../src/core/avatar-face.ts";
import { ModelContext, RawRow, RawValue } from "../chat/ActivityDetail.tsx";
import { modelName, requestWords, span, took, toolHead, totalWords } from "../chat/activity-steps.ts";
import { Face } from "../chat/Face.tsx";
import { toggledStep } from "../chat/Harness.tsx";
import { KeepEnd } from "../chat/KeepEnd.tsx";
import { ProviderMark } from "../chat/ProviderMark.tsx";
import { SkillToolPreview } from "../chat/Skill.tsx";
import { Step, type StepStatus, StepWords, WorkingIcon } from "../chat/Steps.tsx";
import { shortPreview, ToolIcon, toolIcon, toolPreviewEnds } from "../chat/tool-presentation.tsx";
import { ChainOfThought, ChainOfThoughtContent } from "../components/ai-elements/chain-of-thought.tsx";
import { CodeBlock } from "../components/ai-elements/code-block.tsx";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "../components/ai-elements/conversation.tsx";
import { Message, MessageContent, MessageResponse } from "../components/ai-elements/message.tsx";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "../components/ai-elements/reasoning.tsx";
import { Terminal } from "../components/ai-elements/terminal.tsx";
import { Tool, ToolContent, ToolHeader, type ToolState } from "../components/ai-elements/tool.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { Button } from "../components/ui/button.tsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../components/ui/sheet.tsx";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.tsx";
import {
	type ActivityAnchor,
	type ActivityWork,
	activityCalls,
	activityEnd,
	activityWork,
	findActivity,
} from "../lib/activity.ts";
import {
	type Block,
	type ChatPrompt,
	chatPrompt,
	type HarnessSessionView,
	type Item,
	type RunningTool,
	type ShownWait,
	type ToolCall,
} from "../lib/api.ts";
import { userFiles } from "../lib/chat.ts";
import { cn } from "../lib/cn.ts";
import { useReturnFocus } from "../lib/return-focus.ts";
import { harnessToolOf } from "../lib/segments/harness.ts";
import { useShell } from "../lib/shell.ts";
import { type Transcript, useTranscript } from "../lib/transcript.ts";
import { FilePart } from "./FilePart.tsx";
import { HarnessActivitySheet } from "./HarnessSession.tsx";
import { callSession, type HarnessesSeen, toolService } from "./harness-activity.ts";

export type ActivityTarget = {
	readonly chat: number;
	readonly name: string;
	/** The agent's face, beside its name over the transcript. */
	readonly face?: AvatarFace | undefined;
	readonly anchor?: ActivityAnchor;
	readonly heading?: string;
};
/**
 * A transcript given instead of read from the daemon (the specimen's), with the model context it was prompted with and
 * the coding sessions its calls led to.
 */
type Source = {
	readonly chat: number;
	readonly transcript: Transcript;
	readonly prompt?: ChatPrompt;
	readonly harnesses?: HarnessesSeen;
};
export type ActivityDepth = "activity" | "transcript";

export function ActivitySheet({
	targets,
	source,
	onClose,
	returnTo,
	style,
}: {
	targets: readonly ActivityTarget[];
	source?: Source;
	onClose: () => void;
	/** Opened from the working line: focus goes back to it while it is on the page. */
	returnTo?: HTMLElement | undefined;
	/** The specimen's frame passes its colour scheme to the sheet, which opens outside the frame. */
	style?: CSSProperties;
}) {
	const [index, setIndex] = useState(0);
	const [depth, setDepth] = useState<ActivityDepth>("activity");
	// the step the transcript was opened from: it arrives open, in view
	const [at, setAt] = useState<string>();
	// mounted open, from state, with no Radix trigger: closed, focus returns to what opened it
	const returnFocus = useReturnFocus(true);
	const heading = useRef<HTMLHeadingElement>(null);
	const target = targets[index];
	if (!target) return null;
	const drill = (next: ActivityDepth, step?: string) => {
		setDepth(next);
		setAt(step);
	};
	const props = { target, depth, at, onDrill: (step?: string) => drill("transcript", step) };
	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent
				className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]"
				{...(style === undefined ? {} : { style })}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					heading.current?.focus();
				}}
				onCloseAutoFocus={(event) => {
					// the face's slot went with the run when no reply came to take it: back to what opened the sheet, as anywhere
					if (returnTo === undefined || !returnTo.isConnected) {
						returnFocus(event);
						return;
					}
					event.preventDefault();
					(returnTo.querySelector("button") ?? returnTo).focus();
				}}
			>
				<SheetHeader className="gap-0 border-b border-line-soft p-0">
					{/* whose work it is, as the chat's own header says it: the face and the name */}
					<SheetTitle
						ref={heading}
						tabIndex={-1}
						className="flex min-w-0 items-center gap-2 px-5 pt-4 pr-12 pb-2 outline-none"
					>
						{target.face === undefined ? null : <Face face={target.face} name={target.name} size="message" />}
						<span className="min-w-0 truncate">{target.name}</span>
					</SheetTitle>
					<SheetDescription className="sr-only">
						{depth === "activity" ? "Activity: what it did, step by step" : "Transcript: the work as a conversation"}
					</SheetDescription>
					{targets.length > 1 ? (
						<Tabs
							value={String(index)}
							onValueChange={(value) => {
								setIndex(Number(value));
								setDepth("activity");
								setAt(undefined);
							}}
						>
							<TabsList aria-label="Agent activity" className="h-auto max-w-full flex-wrap border-b-0 px-5">
								{targets.map((member, n) => (
									<TabsTrigger key={member.chat} value={String(n)}>
										{member.name}
									</TabsTrigger>
								))}
							</TabsList>
						</Tabs>
					) : null}
					{/* the two depths side by side: the steps, and the same work as a conversation */}
					<Tabs value={depth} onValueChange={(value) => drill(value as ActivityDepth)}>
						<TabsList aria-label="Depth" className="border-b-0 px-5">
							<TabsTrigger value="activity">Activity</TabsTrigger>
							<TabsTrigger value="transcript">Transcript</TabsTrigger>
						</TabsList>
					</Tabs>
				</SheetHeader>
				{source?.chat === target.chat ? (
					<ActivityView
						key={index}
						{...props}
						transcript={source.transcript}
						given={source.prompt}
						harnesses={source.harnesses}
					/>
				) : (
					<FetchedActivity key={index} {...props} />
				)}
			</SheetContent>
		</Sheet>
	);
}

type ViewProps = {
	target: ActivityTarget;
	depth: ActivityDepth;
	/** A step of the activity opens the transcript at it. */
	onDrill?: ((step?: string) => void) | undefined;
	/** The step the transcript opens at. */
	at?: string | undefined;
	transcript: Transcript;
	/** The model context, when it came with the transcript instead of being fetched. */
	given?: ChatPrompt | undefined;
	/** The coding agents and their sessions, as the shell holds them: what a coding agent's step is named by and opens. */
	harnesses?: HarnessesSeen | undefined;
};
function FetchedActivity(props: Omit<ViewProps, "transcript" | "given" | "harnesses">) {
	const transcript = useTranscript(props.target.chat);
	const { harnesses } = useShell();
	return <ActivityView {...props} transcript={transcript} harnesses={harnesses} />;
}

/** One depth of a work's activity, with no sheet around it: the sheet's body, and what the specimen shows open. */
export function ActivityView({ target, depth, onDrill, at, transcript, given, harnesses }: ViewProps) {
	const { items, input, busy, older, loaded, missing, loadOlder, partial, running } = transcript;
	const works = useMemo(() => activityWork(items, input), [items, input]);
	// Pin the first selected work: a new owner input must not retarget an open sheet.
	const pinned = useRef<ActivityAnchor | undefined>(target.anchor);
	const work = findActivity(works, pinned.current);
	useEffect(() => {
		if (pinned.current === undefined && work) pinned.current = work.items[0]?.id;
	}, [work]);
	const [loadingOlder, setLoadingOlder] = useState(false);
	const [historyError, setHistoryError] = useState(false);
	const needOlder = loaded && older && (!work || work === works[0]);
	useEffect(() => {
		if (!needOlder || loadingOlder || historyError) return;
		setLoadingOlder(true);
		void loadOlder()
			.catch(() => setHistoryError(true))
			.finally(() => setLoadingOlder(false));
	}, [needOlder, loadingOlder, historyError, loadOlder]);
	const live = work?.active === true && busy;
	const selectedRequest = work?.items.find((item) => item.role === "assistant" && item.id === target.anchor);
	const lastAssistant = [...(work?.items ?? [])].reverse().find((item) => item.role === "assistant")?.id;
	const contextAt = live ? undefined : (selectedRequest?.id ?? lastAssistant);
	const requestAvailable = live || contextAt !== undefined;
	const [fetched, setFetched] = useState<ChatPrompt>();
	const prompt = given ?? fetched;
	const [promptError, setPromptError] = useState(false);
	const [retry, setRetry] = useState(0);
	const enabled = depth === "transcript" && requestAvailable && !needOlder && given === undefined;
	// A newly committed model request invalidates the live context; streamed text does not.
	const promptRequest = useMemo(
		() => ({ chat: target.chat, at: contextAt, lastAssistant, retry }),
		[target.chat, contextAt, lastAssistant, retry],
	);
	useEffect(() => {
		if (!enabled) return;
		let stale = false;
		// Keep disclosure state and focus while a newer request's recorded context is fetched.
		setPromptError(false);
		void chatPrompt(promptRequest.chat, promptRequest.at)
			.then((value) => {
				if (!stale) setFetched(value);
			})
			.catch(() => {
				if (!stale) setPromptError(true);
			});
		return () => {
			stale = true;
		};
	}, [enabled, promptRequest]);
	const timelineScroll = useRef(0);
	if (missing) return <Empty>This chat is no longer available.</Empty>;
	if (historyError)
		return (
			<Empty>
				Couldn’t load the earlier activity.
				<Button variant="ghost" onClick={() => setHistoryError(false)}>
					Try again
				</Button>
			</Empty>
		);
	if (!loaded || needOlder) return <Empty>Loading activity…</Empty>;
	if (!work) return <Empty>No recorded activity for this message.</Empty>;
	if (depth === "activity")
		return (
			<div
				data-activity-timeline=""
				className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
				ref={(node) => {
					if (node) node.scrollTop = timelineScroll.current;
				}}
				onScroll={(event) => {
					timelineScroll.current = event.currentTarget.scrollTop;
				}}
			>
				<p className="mb-6 line-clamp-3 whitespace-pre-wrap break-words text-body font-medium [overflow-wrap:anywhere]">
					{target.heading ?? work.title}
				</p>
				<ActivityTimeline
					chat={target.chat}
					agent={target.name}
					harnesses={harnesses}
					running={live ? running : []}
					work={work}
					live={live}
					partial={partial}
					waits={live ? transcript.waits : []}
					onDrill={onDrill}
				/>
			</div>
		);
	return (
		<Conversation aria-label="Full transcript" aria-live="off" initial={false}>
			<ConversationContent className="gap-5 px-5 py-5" scrollClassName="overflow-y-auto" data-raw-content="">
				<div className="flex min-w-0 flex-col" data-model-context="">
					{!requestAvailable ? (
						<p className="text-ui text-ink-2">No model request recorded for this work.</p>
					) : prompt ? (
						<ModelContext prompt={prompt} />
					) : promptError ? null : (
						<p className="text-ui text-ink-2">Loading model context…</p>
					)}
					{promptError ? (
						<div className="text-ui text-danger">
							Couldn’t load the model context.
							<Button variant="ghost" onClick={() => setRetry((n) => n + 1)}>
								Try again
							</Button>
						</div>
					) : null}
				</div>
				<ActivityTranscript
					chat={target.chat}
					work={work}
					live={live}
					at={at}
					partial={live ? partial : []}
					running={live ? running : []}
					waits={live ? transcript.waits : []}
				/>
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
}
function Empty({ children }: { children: React.ReactNode }) {
	return <div className="flex flex-col gap-3 p-5 text-ui text-ink-2">{children}</div>;
}

/** A step's place in its work, the same in the activity and the transcript, and from a streamed request to its record. */
const stepKey = (request: number, part: string) => `r${request}:${part}`;
const aborted = (result: Extract<Item, { role: "tool" }>) => result.notes?.some((note) => note.code === "aborted");
const MESSAGES = new Set(["message_user", "message_group"]);

type Row = {
	key: string;
	icon: Parameters<typeof Step>[0]["icon"];
	verb: string;
	object?: string;
	code?: boolean;
	ends?: Parameters<typeof StepWords>[0]["ends"];
	status: StepStatus;
	meta?: string;
	/** What the line opens to, in place. */
	detail?: ReactNode;
	/** The coding session its call led to, or "gone" when that session is no longer kept. */
	session?: HarnessSessionView | "gone";
};

/**
 * Where an opened step leads, under what it opened to: itself in the transcript, and the coding session its call led
 * to. Beside the step's line, never inside it: the line is a button of its own.
 */
export function StepLinks({
	onTranscript,
	session,
	onSession,
}: {
	onTranscript?: (() => void) | undefined;
	session?: HarnessSessionView | "gone" | undefined;
	/** Open that session; `from` is the control pressed, where focus returns once it closes. */
	onSession?: ((task: number, from: HTMLElement) => void) | undefined;
}) {
	if (onTranscript === undefined && session === undefined) return null;
	return (
		<div className="-ml-2 flex min-w-0 flex-wrap items-center gap-x-1">
			{onTranscript === undefined ? null : (
				<Button variant="ghost" size="xs" className="text-ink-2" onClick={onTranscript}>
					<MessagesSquareIcon data-icon="inline-start" />
					In the transcript
				</Button>
			)}
			{session === undefined ? null : session === "gone" ? (
				<span data-session-gone="" className="px-2 text-meta text-ink-2">
					This coding session is no longer kept.
				</span>
			) : (
				<Button
					variant="ghost"
					size="xs"
					className="text-ink-2"
					data-open-session={session.task}
					onClick={(event) => onSession?.(session.task, event.currentTarget)}
				>
					<CodeXmlIcon data-icon="inline-start" />
					Open session
				</Button>
			)}
		</div>
	);
}

/** A step's text, whole, under its line. */
function StepText({ children, muted = false }: { children: string; muted?: boolean }) {
	return (
		<div
			className={cn(
				"max-h-80 min-w-0 overflow-y-auto overscroll-contain rounded-field bg-paper-2 px-3 py-2 text-ui [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				muted ? "text-ink-2" : "text-ink",
			)}
		>
			<Markdown>{children}</Markdown>
		</div>
	);
}

/** What a call's line opens to: the command and its output, the change, what came back. The arguments are the transcript's. */
function callDetail(
	chat: number,
	call: ToolCall,
	result: Extract<Item, { role: "tool" }> | undefined,
	running: RunningTool | undefined,
): ReactNode {
	const output = result?.text ?? running?.output ?? "";
	const parts: ReactNode[] = [];
	if (MESSAGES.has(call.name) && typeof call.args.text === "string")
		parts.push(<StepText key="text">{call.args.text}</StepText>);
	else if (harnessToolOf(call.name) === "work" && typeof call.args.prompt === "string") {
		// what the coding agent was asked, whole; its answer to the agent only when it says why nothing started
		parts.push(<StepText key="text">{call.args.prompt}</StepText>);
		if (result?.error && output !== "")
			parts.push(
				<RawValue key="out" label="Error">
					{output}
				</RawValue>,
			);
	} else if (result?.receipt?.kind === "skill")
		parts.push(
			<SkillToolPreview
				key="skill"
				skill={{
					name: result.receipt.name,
					description: result.receipt.description,
					path: `skills/${result.receipt.name}/SKILL.md`,
					body: result.text,
					files: result.receipt.files,
				}}
			/>,
		);
	else if (call.name === "bash" && typeof call.args.command === "string")
		parts.push(
			<Terminal
				key="run"
				command={call.args.command}
				output={output}
				isStreaming={result === undefined && running !== undefined}
			/>,
		);
	else if (output !== "" && !result?.patch)
		parts.push(
			<RawValue key="out" label={result?.error ? "Error" : result ? "Result" : "Output"}>
				{output}
			</RawValue>,
		);
	if (result?.patch) parts.push(<CodeBlock key="patch" title="Change" language="diff" code={result.patch} />);
	if (result !== undefined)
		for (let n = 0; n < (result.images ?? 0); n++)
			parts.push(
				<FilePart
					key={`image:${n}`}
					chat={chat}
					file={{ kind: "item", item: result.id, n, image: true, name: `Image ${n + 1}` }}
				/>,
			);
	return parts.length === 0 ? undefined : <div className="flex min-w-0 flex-col gap-2">{parts}</div>;
}

/**
 * The work as a chain of thought: one line a step, in the owner's words, each opening in place to what it did, as a
 * coding session's steps do. The transcript is one step further, from the foot.
 */
function ActivityTimeline({
	chat,
	agent,
	harnesses,
	work,
	live,
	partial,
	running,
	onDrill,
	waits,
}: {
	chat: number;
	/** Whose work it is, by name: a coding session it started says so. */
	agent: string;
	harnesses: HarnessesSeen | undefined;
	work: ActivityWork;
	live: boolean;
	partial: readonly Block[];
	running: readonly RunningTool[];
	waits: readonly ShownWait[];
	onDrill?: ((step?: string) => void) | undefined;
}) {
	const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
	// the coding session open over the activity, by its task, and the control it opened from
	const [shown, setShown] = useState<number>();
	const opener = useRef<HTMLElement | null>(null);
	const showing = shown === undefined ? undefined : harnesses?.sessions.find((one) => one.task === shown);
	const output = new Map(running.map((tool) => [tool.call, tool]));
	const called = new Map(activityCalls(work).map((call) => [`${call.entry}:${call.call.id}`, call]));
	const end = activityEnd(work);
	const waiting = new Set(waits.flatMap((wait) => (wait.call === undefined ? [] : [wait.call])));
	const rows: Row[] = [];
	const callRow = (key: string, call: ToolCall, result: Extract<Item, { role: "tool" }> | undefined): Row => {
		const session = callSession(harnesses, chat, call, result);
		const service = typeof session === "object" ? session.service : toolService(harnesses, call.name);
		const head = toolHead(call, result !== undefined, service);
		const state: Pick<Row, "status" | "meta"> =
			result === undefined
				? live
					? waiting.has(call.id)
						? { status: "waiting", meta: "Waiting on you" }
						: { status: "active" }
					: { status: "pending", meta: "No result" }
				: aborted(result)
					? { status: "pending", meta: "Stopped" }
					: result.error
						? { status: "failed", meta: "Failed" }
						: { status: "done", ...(result.durationMs === undefined ? {} : { meta: took(result.durationMs) }) };
		const detail = callDetail(chat, call, result, output.get(call.id));
		return {
			key,
			icon: toolIcon(call.name),
			...head,
			...state,
			...(detail === undefined ? {} : { detail }),
			...(session === undefined ? {} : { session }),
		};
	};
	let request = 0;
	for (const item of work.items) {
		if (item.role === "assistant") {
			const r = request++;
			if (item.thinking)
				rows.push({
					key: stepKey(r, "think"),
					icon: BrainIcon,
					verb: "Thought",
					object: shortPreview(item.thinking),
					status: "done",
					detail: <StepText muted>{item.thinking}</StepText>,
					...(item.thinkingMs === undefined ? {} : { meta: took(item.thinkingMs) }),
				});
			if (item.text)
				rows.push({
					key: stepKey(r, "note"),
					icon: PenLineIcon,
					verb: "Wrote",
					object: shortPreview(item.text),
					status: "done",
					detail: <StepText>{item.text}</StepText>,
				});
			for (const call of item.calls ?? [])
				rows.push(callRow(stepKey(r, `call:${call.id}`), call, called.get(`${item.id}:${call.id}`)?.result));
			if (item.error)
				rows.push({
					key: stepKey(r, "error"),
					icon: item.stop === "aborted" ? SquareIcon : CircleAlertIcon,
					verb: item.stop === "aborted" ? "Stopped" : "Model error",
					object: shortPreview(item.error),
					status: item.stop === "aborted" ? "pending" : "failed",
					detail: <p className="whitespace-pre-wrap text-ui text-danger">{item.error}</p>,
				});
		} else if (item.role === "tool" && item.receipt?.kind === "skill")
			rows.push({
				key: `e${item.id}`,
				icon: BookOpenIcon,
				verb: "Loaded",
				object: `/${item.receipt.name}`,
				code: true,
				status: "done",
			});
		else if (item.role === "notice")
			rows.push({
				key: `e${item.id}`,
				icon: CircleAlertIcon,
				verb: "Notice",
				object: shortPreview(item.text),
				status: "done",
				detail: <StepText muted>{item.text}</StepText>,
			});
	}
	if (live)
		for (const block of partial) {
			if (block.call) rows.push(callRow(stepKey(request, `call:${block.call.id}`), block.call, undefined));
			else if (block.type === "thinking")
				rows.push({
					key: stepKey(request, "think"),
					icon: BrainIcon,
					verb: block.endedAt === undefined ? "Thinking" : "Thought",
					object: shortPreview(block.text),
					status: block.endedAt === undefined ? "active" : "done",
					detail: <StepText muted>{block.text}</StepText>,
					...(block.endedAt === undefined || block.startedAt === undefined
						? {}
						: { meta: took(block.endedAt - block.startedAt) }),
				});
			else if (block.text)
				rows.push({
					key: stepKey(request, "note"),
					icon: PenLineIcon,
					verb: "Writing",
					object: shortPreview(block.text),
					status: "active",
					detail: <StepText>{block.text}</StepText>,
				});
		}
	const total = span(work.items);
	const failed = end === "Failed" || end === "Cut off";
	// a step at work says so itself: the last line says "Working…" only while none does
	const busy = rows.some((row) => row.status === "active" || row.status === "waiting");
	return (
		<>
			<ChainOfThought open>
				<ChainOfThoughtContent>
					{rows.map((row) => (
						<Step
							key={row.key}
							name={row.key}
							icon={row.icon}
							status={row.status}
							meta={row.meta}
							words={
								<StepWords
									verb={row.verb}
									object={row.object ?? ""}
									code={row.code ?? false}
									ends={row.ends}
									active={row.status === "active"}
								/>
							}
							detail={
								// a coding agent's step opens even with nothing of its own to show: its session is what it leads to
								row.detail === undefined && row.session === undefined ? undefined : (
									<div className="flex min-w-0 flex-col items-start gap-1">
										{row.detail === undefined ? null : <div className="w-full min-w-0">{row.detail}</div>}
										<StepLinks
											onTranscript={onDrill === undefined ? undefined : () => onDrill(row.key)}
											session={row.session}
											onSession={(task, from) => {
												opener.current = from;
												setShown(task);
											}}
										/>
									</div>
								)
							}
							open={open.has(row.key)}
							onToggle={() => setOpen((prior) => toggledStep(prior, row.key))}
						/>
					))}
					{live ? (
						busy ? null : (
							<Step name="end" icon={WorkingIcon} status="active" words={<StepWords verb="Working…" active />} />
						)
					) : (
						<Step
							name="end"
							icon={failed ? CircleAlertIcon : end === "Stopped" ? SquareIcon : CheckIcon}
							status={failed ? "failed" : "done"}
							words={<span className={failed ? "text-danger" : "text-ink"}>{end}</span>}
							meta={total === undefined ? undefined : took(total)}
						/>
					)}
				</ChainOfThoughtContent>
			</ChainOfThought>
			{/* over the activity, as a file's preview is: closed, the activity is still there and the control has focus */}
			{showing === undefined ? null : (
				<HarnessActivitySheet
					session={showing}
					agent={agent}
					onClose={() => setShown(undefined)}
					returnFocus={() => opener.current?.focus()}
				/>
			)}
		</>
	);
}

/** A message as the chat draws one: the owner's at the right on its tint, an agent's outlined. */
function Said({ from, children }: { from: "user" | "assistant"; children: ReactNode }) {
	return (
		<Message from={from} className="max-w-full">
			<MessageContent
				data-message-bubble=""
				className={
					from === "user"
						? "text-body group-[.is-user]:max-w-[85%] group-[.is-user]:rounded-2xl group-[.is-user]:bg-paper-2 group-[.is-user]:px-3 group-[.is-user]:pt-1.5 group-[.is-user]:pb-2.5 group-[.is-user]:text-ink"
						: "max-w-[85%] rounded-2xl border border-line-soft bg-paper px-3 pt-1.5 pb-2.5 text-body text-ink"
				}
			>
				{children}
			</MessageContent>
		</Message>
	);
}

/** Who a message that is not the owner's own came from, above it. */
function Caption({ children }: { children: ReactNode }) {
	return <span className="text-meta text-ink-3">{children}</span>;
}

const clock = (at: number) =>
	new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** A tool call as a card: what it was called with, and what came back, once opened. */
function ToolCard({
	chat,
	entry,
	call,
	result,
	running,
	state,
	defaultOpen,
}: {
	chat: number;
	entry: string;
	call: ToolCall;
	result?: Extract<Item, { role: "tool" }> | undefined;
	running?: RunningTool | undefined;
	state: ToolState;
	defaultOpen: boolean;
}) {
	const preview = toolPreviewEnds(call.name, call.args);
	const command = typeof call.args.command === "string" ? call.args.command : undefined;
	const output = result?.text ?? running?.output ?? "";
	return (
		<Tool defaultOpen={defaultOpen} data-entry={entry} className="scroll-mt-4">
			<ToolHeader
				icon={<ToolIcon name={call.name} />}
				title={call.name}
				summary={preview === undefined ? undefined : <KeepEnd ends={preview} />}
				state={state}
				status={state === "done" && result?.durationMs !== undefined ? took(result.durationMs) : undefined}
			/>
			<ToolContent>
				{result?.receipt?.kind === "skill" ? (
					<SkillToolPreview
						skill={{
							name: result.receipt.name,
							description: result.receipt.description,
							path: `skills/${result.receipt.name}/SKILL.md`,
							body: result.text,
							files: result.receipt.files,
						}}
					/>
				) : call.name === "bash" && command !== undefined ? (
					<Terminal command={command} output={output} isStreaming={state === "running"} />
				) : (
					<>
						<RawValue label="Arguments">{JSON.stringify(call.args)}</RawValue>
						{output === "" ? null : (
							<RawValue label={result?.error ? "Error" : result ? "Result" : "Output"}>{output}</RawValue>
						)}
					</>
				)}
				{result?.patch ? <CodeBlock title="Change" language="diff" code={result.patch} /> : null}
				{result === undefined
					? null
					: Array.from({ length: result.images ?? 0 }, (_, n) => (
							<FilePart
								// biome-ignore lint/suspicious/noArrayIndexKey: immutable result image indices are their API identity.
								key={`${result.id}:image:${n}`}
								chat={chat}
								file={{ kind: "item", item: result.id, n, image: true, name: `Image ${n + 1}` }}
							/>
						))}
				{result?.notes?.length ? <RawValue label="Notes">{JSON.stringify(result.notes)}</RawValue> : null}
				{running?.dropped ? (
					<p className="text-meta text-ink-2">Earlier live output is outside the retained window.</p>
				) : null}
				{state === "pending" ? <p className="text-meta text-ink-2">No result was recorded.</p> : null}
			</ToolContent>
		</Tool>
	);
}

/** What a request took, in a line under what it said: when, the model and whose it is, what it read and wrote, its cost. */
function RequestMeta({ request }: { request: Extract<Item, { role: "assistant" }> }) {
	const { model, usage, at } = request;
	const provider = model?.includes("/") ? model.slice(0, model.indexOf("/")) : undefined;
	const words = requestWords({ ...(usage === undefined ? {} : { usage }) });
	if (model === undefined && words.length === 0 && at === undefined) return null;
	return (
		<p data-request-meta="" className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-meta text-ink-3 tabular-nums">
			{at === undefined ? null : <span>{clock(at)}</span>}
			{model === undefined ? null : (
				<span className="flex min-w-0 items-center gap-1 before:mr-0.5 before:content-['·'] first:before:hidden">
					{provider === undefined ? null : <ProviderMark provider={provider} className="size-3.5 opacity-70" />}
					<span className="truncate">{modelName(model)}</span>
				</span>
			)}
			{words.map((word) => (
				<span key={word} className="before:mr-1.5 before:content-['·'] first:before:hidden">
					{word}
				</span>
			))}
		</p>
	);
}

/** One model request as the agent's turn: what it thought, what it wrote, each call, and what the request took. */
function ModelTurn({
	chat,
	request,
	item,
	partial = [],
	live,
	at,
	results,
	running,
	waiting,
}: {
	chat: number;
	request: number;
	item?: Extract<Item, { role: "assistant" }>;
	partial?: readonly Block[];
	live: boolean;
	at: string | undefined;
	results: ReadonlyMap<string, Extract<Item, { role: "tool" }>>;
	running: ReadonlyMap<string, RunningTool>;
	waiting: ReadonlySet<string>;
}) {
	const block = partial.find((one) => one.type === "thinking");
	const thinking =
		item?.thinking ??
		partial
			.filter((one) => one.type === "thinking")
			.map((one) => one.text)
			.join("");
	const text =
		item?.text ??
		partial
			.filter((one) => one.type === "text" || one.type === "other")
			.map((one) => one.text)
			.join("");
	const calls = item?.calls ?? partial.flatMap((one) => (one.call ? [one.call] : []));
	const streaming = item === undefined;
	// what a request took follows what it said to the owner; a request of calls alone counts in the work's total
	const spoke = text !== "" || calls.some((call) => MESSAGES.has(call.name)) || item?.error !== undefined;
	const meta = item === undefined || !spoke ? undefined : item;
	const key = (part: string) => stepKey(request, part);
	// a request that only ended the run (no words, no calls) has nothing to read
	if (!thinking && !text && calls.length === 0 && item?.error === undefined) return null;
	return (
		<Message from="assistant" className="max-w-full gap-3" data-request={request}>
			{thinking ? (
				<Reasoning
					isStreaming={streaming && block?.endedAt === undefined}
					duration={
						item?.thinkingMs ??
						(block?.startedAt === undefined || block.endedAt === undefined
							? undefined
							: block.endedAt - block.startedAt)
					}
					defaultOpen={streaming || at === key("think")}
					data-entry={key("think")}
					className="scroll-mt-4"
				>
					<ReasoningTrigger />
					<ReasoningContent>{thinking}</ReasoningContent>
				</Reasoning>
			) : null}
			{text ? (
				<div data-entry={key("note")} className="min-w-0 scroll-mt-4 text-body text-ink">
					<MessageResponse>{text}</MessageResponse>
				</div>
			) : null}
			{calls.map((call) => {
				const result = item === undefined ? undefined : results.get(`${item.id}:${call.id}`);
				const state: ToolState =
					result === undefined
						? live
							? waiting.has(call.id)
								? "waiting"
								: "running"
							: "pending"
						: aborted(result)
							? "stopped"
							: result.error
								? "error"
								: "done";
				const entry = key(`call:${call.id}`);
				// what it told the owner or the group reads as the message it was, not as a call
				if (MESSAGES.has(call.name) && typeof call.args.text === "string" && (state === "done" || state === "running"))
					return (
						<div key={call.id} data-entry={entry} className="flex min-w-0 scroll-mt-4 flex-col gap-1">
							<Caption>{call.name === "message_group" ? "To the group" : "To you"}</Caption>
							<Said from="assistant">
								<MessageResponse>{call.args.text}</MessageResponse>
							</Said>
						</div>
					);
				return (
					<ToolCard
						key={call.id}
						chat={chat}
						entry={entry}
						call={call}
						result={result}
						running={running.get(call.id)}
						state={state}
						defaultOpen={at === entry || (streaming && call.name === "bash")}
					/>
				);
			})}
			{item?.error ? (
				<p data-entry={key("error")} className="scroll-mt-4 whitespace-pre-wrap text-ui text-danger">
					{item.error}
				</p>
			) : null}
			{meta === undefined ? null : <RequestMeta request={meta} />}
		</Message>
	);
}

/** The work as a conversation: the owner's words, each of the agent's turns, and what the daemon said in between. */
function ActivityTranscript({
	chat,
	work,
	live,
	at,
	partial,
	running,
	waits,
}: {
	chat: number;
	work: ActivityWork;
	live: boolean;
	at: string | undefined;
	partial: readonly Block[];
	running: readonly RunningTool[];
	waits: readonly ShownWait[];
}) {
	const occurrences = activityCalls(work);
	const results = new Map(
		occurrences.flatMap((value) => (value.result ? [[`${value.entry}:${value.call.id}`, value.result] as const] : [])),
	);
	const answered = new Set(occurrences.flatMap((value) => (value.result ? [value.result.id] : [])));
	const output = new Map(running.map((tool) => [tool.call, tool]));
	const waiting = new Set(waits.flatMap((wait) => (wait.call === undefined ? [] : [wait.call])));
	const root = useRef<HTMLDivElement>(null);
	// opened from a step: that step is what the reader came for, so it is in view, once
	useEffect(() => {
		if (at === undefined) return;
		const step = root.current?.querySelector(`[data-entry="${CSS.escape(at)}"]`);
		// only the transcript scrolls: the page around it (the specimen's) stays where it is
		const scroller = root.current?.closest("[data-raw-content]")?.parentElement;
		if (!step || !scroller) return;
		scroller.scrollTop += step.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
	}, [at]);
	// One model request keeps its React identity from partial to committed, including open cards and focus.
	let request = 0;
	const rows = work.items.map((item) => {
		if (item.role === "user" || item.role === "wake" || (item.role === "watch" && item.tell === undefined))
			return (
				<div key={item.id} className="flex min-w-0 flex-col items-end gap-1" data-entry={`e${item.id}`}>
					{item.role === "user" ? null : <Caption>{item.role === "wake" ? "Routine" : "Watch"}</Caption>}
					<Said from="user">
						<p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.text}</p>
						{item.role === "user"
							? userFiles(item).map((file) => (
									<FilePart
										key={
											file.kind === "blob"
												? file.sha
												: file.kind === "sent"
													? `${file.call}:${file.n}`
													: `${file.item}:${file.n}`
										}
										chat={chat}
										file={file}
									/>
								))
							: null}
					</Said>
				</div>
			);
		if (item.role === "assistant") {
			const r = request++;
			return (
				<ModelTurn
					key={`model:${r}`}
					chat={chat}
					request={r}
					item={item}
					live={live}
					at={at}
					results={results}
					running={output}
					waiting={waiting}
				/>
			);
		}
		if (item.role === "tool") {
			// a result reads inside the call that asked for it; one with no call here (a skill the owner loaded) alone
			if (answered.has(item.id)) return null;
			return (
				<ToolCard
					key={item.id}
					chat={chat}
					entry={`e${item.id}`}
					call={{ id: item.call, name: item.name, args: {} }}
					result={item}
					state={aborted(item) ? "stopped" : item.error ? "error" : "done"}
					defaultOpen={at === `e${item.id}`}
				/>
			);
		}
		if (item.role === "instruction")
			return (
				<div key={item.id} className="flex min-w-0 flex-col gap-1 border-l border-line-soft pl-3">
					<Caption>From banda</Caption>
					<p className="whitespace-pre-wrap text-ui text-ink-2">{item.text}</p>
				</div>
			);
		const title =
			item.role === "compaction"
				? "Compaction"
				: item.role === "effect"
					? "Effect"
					: item.role === "wait"
						? "Question or approval"
						: "Notice";
		return (
			<RawRow key={item.id} title={title} icon={<CircleAlertIcon className="size-4" />} defaultOpen>
				<RawValue label={title}>{JSON.stringify(item)}</RawValue>
			</RawRow>
		);
	});
	if (partial.length)
		rows.push(
			<ModelTurn
				key={`model:${request}`}
				chat={chat}
				request={request}
				partial={partial}
				live={live}
				at={at}
				results={results}
				running={output}
				waiting={waiting}
			/>,
		);
	const requests = work.items.filter((item) => item.role === "assistant");
	const total = totalWords(requests);
	const lasted = span(work.items);
	return (
		<div ref={root} className="flex min-w-0 flex-col gap-5">
			{rows}
			{waits.map((wait) => (
				<RawRow
					key={wait.key}
					title={wait.label ?? (wait.ask.type === "question" ? "Question" : "Approval")}
					icon={<ClockIcon className="size-4" />}
					state="Waiting on you"
					defaultOpen
				>
					<RawValue label="Ask">{JSON.stringify(wait)}</RawValue>
				</RawRow>
			))}
			{live || requests.length < 2 ? null : (
				<p data-work-total="" className="border-t border-line-soft pt-3 text-meta text-ink-3 tabular-nums">
					{[`${requests.length} requests`, ...total, ...(lasted === undefined ? [] : [`took ${took(lasted)}`])].join(
						" · ",
					)}
				</p>
			)}
		</div>
	);
}
