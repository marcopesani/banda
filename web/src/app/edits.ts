/**
 * The owner's edits to an agent from its panel, in effect at once: its face, its name and its personality (the body
 * of its file, whole). The first agent's go through the companion's picks (its name is stored, not in its file); any
 * other's rewrite its file as the owner's own.
 */
import { type AgentView, type CompanionView, changeCompanion, saveAgent } from "../lib/api.ts";
import { type Edit, edited, withState } from "./edit-file.ts";

export type { Edit } from "./edit-file.ts";

export async function saveEdit(
	agent: string,
	edit: Edit,
	agents: readonly AgentView[],
	_companion: CompanionView | undefined,
	onSaved?: (agents: readonly AgentView[]) => void,
): Promise<void> {
	const file = agents.find((each) => each.name === agent || each.accepted?.agent?.id === agent)?.accepted;
	if (agent === "sancho") {
		const editsFile = edit.face !== undefined || edit.personality !== undefined;
		const base = editsFile ? file?.sha : undefined;
		if (editsFile && base === undefined) throw new Error("This agent's file is not in effect yet.");
		const picks = {
			...(base === undefined ? {} : { base }),
			...(edit.name === undefined ? {} : { name: edit.name }),
			...(edit.face === undefined ? {} : { face: edit.face }),
			...(edit.personality === undefined ? {} : { personality: edit.personality }),
		};
		await changeCompanion(picks);
		return;
	}
	if (file === undefined) throw new Error("This agent's file is not in effect yet.");
	const saved = await saveAgent(agent, edited(file.text, edit), file.sha);
	onSaved?.(saved);
}

/**
 * Archive agent `agent` or restore it: the owner's own write to its file, the first agent's included, in effect at
 * once. The daemon refuses archiving the last active agent, and says why.
 */
export async function setAgentState(
	agent: string,
	state: "active" | "archived",
	agents: readonly AgentView[],
): Promise<readonly AgentView[]> {
	const file = agents.find((each) => each.name === agent || each.accepted?.agent?.id === agent)?.accepted;
	if (file === undefined) throw new Error("This agent's file is not in effect yet.");
	return saveAgent(agent, withState(file.text, state), file.sha);
}
