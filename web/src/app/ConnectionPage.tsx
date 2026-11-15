/**
 * A connection's page, on the daemon's data: its details, to check and to change, reached from Settings → Connections
 * and from an agent's Access. Each change is sent with the version the owner saw, so a stale view changes nothing.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { AccountView } from "../../../src/server/api.ts";
import { type AgentsFor, ConnectionDetailsView } from "../chat/ConnectionDetails.tsx";
import {
	actOnCapability,
	setConnectionTools,
	signOutAccount,
	switchAccount,
	switchPublicConnection,
} from "../lib/api.ts";
import { scopeChoicesOf } from "../lib/connect.ts";
import { chatAgents } from "../lib/navigation.ts";
import { showCapabilities, useShell } from "../lib/shell.ts";
import { ConnectFlow } from "./ConnectFlow.tsx";
import { McpSetup } from "./McpSetup.tsx";

const wordsOf = (failed: unknown) => (failed instanceof Error ? failed.message : "Couldn't save it. Try again.");

/** A `?connection=` that names nothing, or a connection since removed: says so, with the way back. */
export function ConnectionGone({ onConnections }: { onConnections: () => void }) {
	return (
		<div className="flex flex-col gap-3" data-connection-gone="">
			<p className="text-ui text-ink">This connection isn't here. It may have been removed.</p>
			<Button variant="outline" className="self-start" onClick={onConnections}>
				Connections
			</Button>
		</div>
	);
}

export function ConnectionPage({
	connection,
	onClose,
	onRemoved,
}: {
	connection: string;
	onClose: () => void;
	onRemoved: () => void;
}) {
	const shell = useShell();
	const view = shell.capabilities?.connections.find((each) => each.name === connection);
	const shipped = shell.capabilities?.shipped?.find((each) => each.name === connection);
	const [busy, setBusy] = useState(false);
	const [changing, setChanging] = useState<AccountView>();
	const [adding, setAdding] = useState(false);
	const [setup, setSetup] = useState(false);
	const version = useRef(view?.accepted?.version);
	version.current = view?.accepted?.version ?? version.current;
	const summary = view?.accepted?.connection;
	if (shell.capabilities === undefined) return <p className="text-ui text-ink-2">Loading connection…</p>;
	if (view === undefined || summary === undefined) return <ConnectionGone onConnections={onClose} />;
	// a server the owner added and has not connected yet is still being set up
	if (setup || (shipped === undefined && view.state !== "connected"))
		return <McpSetup connection={connection} onClose={setup ? () => setSetup(false) : onClose} />;
	const service = summary.service;
	const anonymous = summary.auth === "none";
	const agents = shell.companion === undefined ? [] : chatAgents(shell.agents, shell.companion);
	const access = scopeChoicesOf(shipped?.access, shipped?.connection.required);
	const run = async (work: () => Promise<void>) => {
		setBusy(true);
		try {
			await work();
		} catch (failed) {
			// a toast, so a change made in any part of the page is told where the owner is looking
			toast.error(wordsOf(failed));
		} finally {
			setBusy(false);
		}
	};
	const agentsFor: AgentsFor[] = anonymous
		? [
				{
					key: "public",
					selected: view.agents ?? [],
					onSwitch: (agent, on) =>
						void run(async () =>
							showCapabilities(await switchPublicConnection(connection, agent, on, version.current)),
						),
				},
			]
		: (view.accounts ?? []).map((account) => ({
				key: account.account,
				label: (view.accounts?.length ?? 0) > 1 ? account.label : undefined,
				selected: account.agents,
				onSwitch: (agent, on) =>
					void run(async () =>
						showCapabilities(await switchAccount(connection, account.account, agent, on, version.current)),
					),
			}));
	return (
		<div className="flex min-w-0 flex-col gap-6">
			{/* what the owner added by its address; a connection banda ships says what it is for instead */}
			{shipped === undefined && summary.url ? <p className="break-all text-meta text-ink-2">{summary.url}</p> : null}
			<ConnectionDetailsView
				view={view}
				service={service}
				about={shipped?.about}
				mode="details"
				agents={agents}
				agentsFor={agentsFor}
				access={access}
				busy={busy}
				onSetTools={(settings, group) => {
					const sha = version.current;
					if (sha === undefined) return;
					void run(async () => showCapabilities(await setConnectionTools(connection, settings, sha, group)));
				}}
				onChangeAccess={(account) => {
					// a key has no sign-in page to come back from: the setup takes a new one
					if (summary.auth === "key") setSetup(true);
					else setChanging(account);
				}}
				onSignOut={(account) =>
					void run(async () => showCapabilities(await signOutAccount(connection, account.account)))
				}
				onAddAccount={
					anonymous
						? undefined
						: () => {
								// a key has no sign-in page to come back from: the setup takes one more
								if (summary.auth === "key") setSetup(true);
								else setAdding(true);
							}
				}
				onRemove={() =>
					void run(async () => {
						const next = await actOnCapability({ action: "remove", name: connection });
						// the page goes first: without its connection in the shell's view, it has nothing to draw
						onRemoved();
						showCapabilities(next);
					})
				}
			/>
			{changing !== undefined ? (
				<ConnectFlow connection={connection} account={changing} onClose={() => setChanging(undefined)} />
			) : null}
			{adding ? <ConnectFlow connection={connection} onClose={() => setAdding(false)} /> : null}
		</div>
	);
}
