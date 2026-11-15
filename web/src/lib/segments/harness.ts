/**
 * A harness at work in the chat: an agent's call of a harness's tool (`harness__claude_code`) that started a session is
 * drawn as that session, live, in the call's place. A call refused, not answered yet, or that only sent a running
 * session a follow-up (shown in that session's card) draws nothing: the agent says so in its own words.
 */
import type { Segmenter } from "./types.ts";

declare module "./types.ts" {
	interface AreaSegments {
		harness: {
			readonly kind: "harness";
			readonly key: string;
			/** The call that started it: how the session is found in the shell. */
			readonly call: string;
		};
	}
}

/**
 * A tool over harnesses, by its name: `work` hands one work (`harness__claude_code`, a tool per harness, and the only
 * kind that starts a session), `sessions` reads the agent's sessions and `stop` stops one.
 */
export type HarnessTool = "work" | "sessions" | "stop";
export function harnessToolOf(name: string): HarnessTool | undefined {
	if (!name.startsWith("harness__")) return undefined;
	return name === "harness__sessions" ? "sessions" : name === "harness__stop" ? "stop" : "work";
}

export const harness: Segmenter = {
	call: (call, key, { result, asks }) => {
		// a harness's own tool, not the two over sessions, which draw as any tool
		if (harnessToolOf(call.name) !== "work") return undefined;
		if (result === undefined || result.error === true) return asks();
		return [...asks(), { kind: "harness", key: `${key}:harness`, call: call.id }];
	},
	shown: (segment) => (segment.kind === "harness" ? [] : undefined),
};
