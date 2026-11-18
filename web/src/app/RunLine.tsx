/**
 * A routine's line in its agent's chat, wired: opened, it asks the daemon which run the line stands for and reads that
 * run's own conversation once, as it is then (opened again, it is read again). Closed, it reads nothing: the run's
 * transcript is mounted only while the line is open.
 */
import { useMemo, useState } from "react";
import type { RoutineLineRun } from "../../../src/server/api.ts";
import { Line } from "../chat/Line.tsx";
import { RoutineRun, type RunRead, RunReading } from "../chat/RoutineRun.tsx";
import type { Who } from "../chat/Row.tsx";
import { api, Refused } from "../lib/api.ts";
import { failureWords } from "../lib/attempt.ts";
import { view } from "../lib/chat.ts";
import { useReadTranscript } from "../lib/transcript.ts";
import { ActivitySheet } from "./Activity.tsx";
import { FeedView } from "./Feed.tsx";
import { useViewContext } from "./view-context.ts";

export function RunLine({
	chat,
	entry,
	words,
	name,
	onRoutine,
	time,
	who,
	agent,
}: {
	/** The chat the line is in, and the line's entry there. */
	chat: number;
	entry: number;
	words: string;
	/** The routine's name within the words, and what opens the routine itself. */
	name?: string | undefined;
	onRoutine?: (() => void) | undefined;
	time?: string | undefined;
	/** The agent whose routine it is: the run's conversation is its own. */
	who: Who;
	agent?: string | undefined;
}) {
	const [open, setOpen] = useState(false);
	const [run, setRun] = useState<number>();
	const [trouble, setTrouble] = useState<Exclude<RunRead, string>>();
	const [asked, setAsked] = useState(false);
	const ask = () => {
		setAsked(true);
		setTrouble(undefined);
		api<RoutineLineRun>(`/chats/${chat}/items/${entry}/run`).then(
			(found) => setRun(found.run),
			(error: unknown) =>
				setTrouble(
					// a run from before runs had conversations of their own: what it did is in this chat, around its line
					error instanceof Refused && error.status === 404
						? { none: "This run worked here in the chat: what it did is around this line" }
						: { failed: "The run could not be read" },
				),
		);
	};
	const read: RunRead = trouble ?? (run === undefined ? "reading" : "read");
	return (
		<RoutineRun
			words={words}
			name={name}
			onRoutine={onRoutine}
			time={time}
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next && !asked) ask();
			}}
			run={read}
			onTryAgain={ask}
		>
			{run === undefined ? null : <RunConversation run={run} who={who} agent={agent} />}
		</RoutineRun>
	);
}

/** A run's own conversation, drawn as a chat's feed is; its activity opens as a chat's does. */
function RunConversation({ run, who, agent }: { run: number; who: Who; agent?: string | undefined }) {
	// read once: the page's one live stream stays with the chat on screen
	const transcript = useReadTranscript(run);
	const shell = useViewContext(run);
	// a run's own wake is the routine's words, said as the owner's: only here, never in the agent's chat
	const context = useMemo(() => ({ ...shell, run: true as const }), [shell]);
	const segments = useMemo(
		() =>
			view(
				transcript.items,
				transcript.waits,
				{
					busy: transcript.busy,
					running: transcript.running,
					thinking: transcript.thinking,
					queued: transcript.queued,
				},
				context,
			),
		[
			transcript.items,
			transcript.waits,
			transcript.busy,
			transcript.running,
			transcript.thinking,
			transcript.queued,
			context,
		],
	);
	const [activity, setActivity] = useState<{ anchor?: number }>();
	const [from, setFrom] = useState<HTMLElement>();
	// an earlier page that could not be read: said in its place, with Try again; what was read stays
	const [olderFailed, setOlderFailed] = useState<Error>();
	const earlier = () => {
		void transcript.loadOlder().then(
			() => setOlderFailed(undefined),
			(error: unknown) => setOlderFailed(error instanceof Error ? error : new Error(String(error))),
		);
	};
	if (transcript.missing) return <Line className="px-0">This run's conversation is gone</Line>;
	if (transcript.failed !== undefined)
		return (
			<Line tone="danger" className="px-0" action={{ label: "Try again", onClick: transcript.retry }}>
				The run could not be read: {failureWords(transcript.failed)}
			</Line>
		);
	if (!transcript.loaded) return <RunReading />;
	return (
		<>
			{olderFailed !== undefined ? (
				<Line tone="danger" className="px-0" action={{ label: "Try again", onClick: earlier }}>
					Earlier messages could not be read: {failureWords(olderFailed)}
				</Line>
			) : transcript.older ? (
				<Line className="px-0" action={{ label: "Show earlier", onClick: earlier }}>
					This is the end of a long run
				</Line>
			) : null}
			<FeedView
				chat={run}
				who={who}
				agent={agent}
				segments={segments}
				compact
				onActivity={(anchor) => {
					setFrom(undefined);
					setActivity({ anchor });
				}}
				onWorkingLine={(line) => {
					setFrom(line);
					setActivity({});
				}}
			/>
			{segments.length === 0 ? <Line className="px-0">Nothing to show yet</Line> : null}
			{activity === undefined ? null : (
				<ActivitySheet
					targets={[{ chat: run, name: who.name, face: who.face, ...activity }]}
					source={{ chat: run, transcript }}
					returnTo={from}
					onClose={() => setActivity(undefined)}
				/>
			)}
		</>
	);
}
