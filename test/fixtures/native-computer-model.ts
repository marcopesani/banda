import assert from "node:assert/strict";
import {
	type AssistantMessage,
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentTools,
	type Message,
} from "@earendil-works/pi-ai";

export type NativeComputerCommands = {
	readonly check: string;
	readonly persistence: { readonly command: string; readonly output: string };
};

export function nativeComputerReply(messages: readonly Message[], commands: NativeComputerCommands): AssistantMessage {
	const previous = messages.at(-1);
	const input = messages.filter((message) => message.role === "user").at(-1)?.content;
	if (previous?.role === "toolResult" && previous.toolName === "message_user") return fauxAssistantMessage("Done.");
	if (previous?.role === "toolResult" && previous.toolName !== "tool_search") {
		assert.ok(!previous.isError, JSON.stringify(previous.content));
		if (input === "Read the files after restart.") {
			assert.equal(previous.toolName, "bash");
			const output = previous.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
			assert.equal(
				output.trim(),
				commands.persistence.output,
				"The read-only command must return every retained marker.",
			);
		}
		return fauxAssistantMessage([fauxToolCall("message_user", { text: JSON.stringify(previous.content) })], {
			stopReason: "toolUse",
		});
	}
	if (
		input !== "Check the computer." &&
		input !== "Read the files after restart." &&
		input !== "Browse the example page."
	)
		return fauxAssistantMessage([fauxToolCall("message_user", { text: "Noted the test follow-up." })], {
			stopReason: "toolUse",
		});
	const browse = input === "Browse the example page.";
	const command = input === "Read the files after restart." ? commands.persistence.command : commands.check;
	const tool = browse ? "browser_navigate" : "bash";
	const next = getCurrentTools(messages).some((offered) => offered.name === tool)
		? fauxToolCall(tool, browse ? { url: "https://example.com/" } : { command })
		: fauxToolCall("tool_search", { query: tool, limit: 1 });
	return fauxAssistantMessage([next], { stopReason: "toolUse" });
}
