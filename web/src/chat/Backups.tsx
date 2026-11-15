/**
 * Settings' backups (DESIGN.md "Home"): take one now, with the choice to leave out the computer's files or the
 * browser's signed-in sites; see it copy, step by step, in the daemon (the page may close); and the backups there are,
 * each to restore, to show in the file manager (the desktop app) or copy the path of (a browser), and to delete,
 * asked first. A restore is made ready here and finished by banda's next start, since a running banda does not
 * replace its own home: the desktop app offers to start again, a browser says how. The home as it was before a restore
 * is listed with the backups, to go back to or delete.
 */
import { ArchiveIcon, EllipsisIcon, HistoryIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react";
import { useId, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import type { BackupsView, BackupWork, KeptBackup } from "../../../src/server/api.ts";
import { sizeOf } from "../lib/size.ts";
import { Confirm } from "./Confirm.tsx";
import { CopyText } from "./Devices.tsx";
import { Block, RowOf, Rows } from "./Settings.tsx";

export type BackupsActions = {
	/** Take a backup, leaving out what is false. */
	readonly onBackUp?: ((leave: { computer?: false; browser?: false }) => void) | undefined;
	readonly onRestore?: ((name: string) => void) | undefined;
	readonly onDelete?: ((name: string) => void) | undefined;
	readonly onCancelRestore?: (() => void) | undefined;
	readonly onDismiss?: (() => void) | undefined;
	/** In the desktop app: show the backup in the system's file manager. */
	readonly onReveal?: ((name: string) => void) | undefined;
	/** In a browser, which cannot open a folder: copy the backup's path. */
	readonly onCopyPath?: ((path: string) => void) | undefined;
	/** In the desktop app: quit banda and start it again, which finishes a restore. */
	readonly onRestart?: (() => void) | undefined;
};

/** What the daemon is doing at each step of a backup, and of a restore being made ready. */
const DOING: { readonly [K in BackupWork["kind"]]: readonly string[] } = {
	backup: [
		"Starting",
		"Copying files and images",
		"Copying your chats",
		"Copying settings and sign-ins",
		"Copying the computer's files",
		"Checking what was copied",
	],
	restore: ["Starting", "Copying the backup", "Checking the copy against the backup"],
};

/** When a backup was taken, as the owner's own clock and language say it. */
export const when = (iso: string | undefined) => {
	const at = iso === undefined ? Number.NaN : Date.parse(iso);
	return Number.isNaN(at)
		? "an unknown time"
		: new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

/** A backup named as the owner would: by what it is and when. */
const called = (backup: KeptBackup) =>
	backup.kind === "replaced"
		? `your home from before the restore of ${when(backup.created)}`
		: backup.kind === "unreadable"
			? backup.name
			: `the backup of ${when(backup.created)}`;

export function BackupsSettings({
	backups,
	fileManager,
	...act
}: {
	/** As the daemon last said; undefined until read. */
	backups: BackupsView | undefined;
	/** What the system's file manager is called, where it has a name: "Finder". */
	fileManager?: string | undefined;
} & BackupsActions) {
	const [computer, setComputer] = useState(true);
	const [browser, setBrowser] = useState(true);
	const ids = { computer: useId(), browser: useId() };
	const working = backups?.working;
	const held = backups?.computer !== "elsewhere";
	return (
		<Block
			title="Backups"
			note="A copy of everything banda keeps on this computer: your chats, your agents, what they made, your sign-ins."
		>
			{backups?.failed === undefined ? null : (
				<Alert variant="destructive">
					<TriangleAlertIcon />
					<AlertTitle>
						{backups.failed.kind === "backup" ? "The backup didn't finish" : "The restore didn't start"}
					</AlertTitle>
					<AlertDescription>
						<p className="break-words">{backups.failed.why}</p>
						<Button variant="outline" size="xs" onClick={act.onDismiss}>
							Dismiss
						</Button>
					</AlertDescription>
				</Alert>
			)}
			{backups?.ready === undefined ? null : (
				<Ready ready={backups.ready} folder={backups.folder} busy={working !== undefined} act={act} />
			)}
			<Rows>
				{working !== undefined ? (
					<Working work={working} />
				) : (
					<div className="flex flex-col gap-3 px-3.5 py-3">
						{held ? (
							<div className="flex flex-col gap-2.5">
								<div className="flex items-start gap-2.5">
									<Checkbox
										id={ids.computer}
										className="mt-0.5"
										checked={computer}
										onCheckedChange={(checked) => setComputer(checked === true)}
									/>
									<label htmlFor={ids.computer} className="flex flex-col text-ui text-ink">
										The computer's files
										<span className="text-meta text-ink-2">
											The agents' workspace and memory, what they made and installed. The largest part.
										</span>
									</label>
								</div>
								<div className="flex items-start gap-2.5">
									<Checkbox
										id={ids.browser}
										className="mt-0.5"
										checked={computer && browser}
										disabled={!computer}
										onCheckedChange={(checked) => setBrowser(checked === true)}
									/>
									<label htmlFor={ids.browser} className="flex flex-col text-ui text-ink peer-disabled:text-ink-2">
										The browser's signed-in sites
										<span className="text-meta text-ink-2">Left out, a restored browser signs in again.</span>
									</label>
								</div>
							</div>
						) : (
							<p className="text-ui text-ink-2">
								The computer's files are kept by Docker here, and are not part of a backup: it holds your chats,
								settings and sign-ins.
							</p>
						)}
						<Button
							size="sm"
							className="self-start"
							disabled={backups === undefined}
							onClick={() =>
								act.onBackUp?.(!held ? {} : !computer ? { computer: false } : !browser ? { browser: false } : {})
							}
						>
							Back up now
						</Button>
					</div>
				)}
				{backups === undefined ? (
					<RowOf title={<span className="text-ink-2">Looking…</span>} />
				) : backups.backups.length === 0 ? (
					<RowOf title={<span className="text-ink-2">No backups yet</span>} />
				) : (
					backups.backups.map((backup) => (
						<BackupRow
							key={backup.name}
							backup={backup}
							folder={backups.folder}
							fileManager={fileManager}
							busy={working !== undefined}
							restorable={held}
							act={act}
						/>
					))
				)}
			</Rows>
			{backups === undefined ? null : (
				<div className="flex items-start gap-1">
					<p className="min-w-0 flex-1 text-meta text-ink-2">
						Kept in <span className="font-mono break-all text-ink">{backups.folder}</span>, not encrypted, with your
						keys and sign-ins inside: keep that folder to yourself.
					</p>
					<CopyText text={backups.folder} label="Copy the folder's path" icon />
				</div>
			)}
		</Block>
	);
}

/** A backup being taken, or a restore being made ready: what the daemon is on, and how far along. */
function Working({ work }: { work: BackupWork }) {
	const doing = DOING[work.kind][work.step] ?? "Working";
	return (
		<div role="status" className="flex flex-col gap-2 px-3.5 py-3">
			<div className="flex items-baseline justify-between gap-3">
				<span className="text-ui font-medium text-ink">
					{work.kind === "backup" ? "Backing up…" : "Getting the restore ready…"}
				</span>
				<span className="shrink-0 text-meta text-ink-2 tabular-nums">
					Step {work.step + 1} of {work.steps}
				</span>
			</div>
			<Progress value={((work.step + 0.5) / work.steps) * 100} aria-label={doing} />
			<span className="text-meta text-ink-2">{doing}. It goes on if you close this page.</span>
		</div>
	);
}

/** A restore made ready, waiting for banda to start again; or why a start could not finish it. */
function Ready({
	ready,
	folder,
	busy,
	act,
}: {
	ready: NonNullable<BackupsView["ready"]>;
	folder: string;
	busy: boolean;
	act: BackupsActions;
}) {
	if (ready.failed !== undefined)
		return (
			<Alert variant="destructive">
				<TriangleAlertIcon />
				<AlertTitle>The restore didn't finish</AlertTitle>
				<AlertDescription>
					<p className="break-words">{ready.failed}</p>
					<Button variant="outline" size="xs" onClick={act.onCancelRestore}>
						Dismiss
					</Button>
				</AlertDescription>
			</Alert>
		);
	const what = ready.created === undefined ? "your earlier home" : `the backup of ${when(ready.created)}`;
	return (
		<div className="flex flex-col gap-3 rounded-tile border border-line-soft bg-paper-2 p-3.5">
			<div className="flex flex-col gap-1">
				<p className="text-ui font-medium text-ink">Ready to restore {what}</p>
				<p className="text-ui text-ink-2">
					{act.onRestart === undefined ? (
						<>
							It was copied and checked. To finish, stop banda and start it again: in its terminal, press Ctrl+C, then
							run <span className="font-mono text-ink">banda serve</span>.
						</>
					) : (
						"It was copied and checked. To finish, banda starts again: it takes a moment, and anything the agents are doing stops."
					)}{" "}
					Your home as it is now is kept in <span className="font-mono break-all">{folder}</span> until you delete it.
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				{act.onRestart === undefined ? null : (
					<Button size="sm" disabled={busy} onClick={act.onRestart}>
						Restart banda to finish
					</Button>
				)}
				<Button variant="outline" size="sm" disabled={busy} onClick={act.onCancelRestore}>
					Don't restore
				</Button>
			</div>
		</div>
	);
}

function BackupRow({
	backup,
	folder,
	fileManager,
	busy,
	restorable,
	act,
}: {
	backup: KeptBackup;
	folder: string;
	fileManager: string | undefined;
	busy: boolean;
	restorable: boolean;
	act: BackupsActions;
}) {
	const [asking, setAsking] = useState<"restore" | "delete" | undefined>(undefined);
	const name = called(backup);
	const Icon = backup.kind === "replaced" ? Undo2Icon : backup.kind === "upgrade" ? HistoryIcon : ArchiveIcon;
	const title =
		backup.kind === "replaced"
			? "Your home before a restore"
			: backup.kind === "unreadable"
				? "A backup banda can't read"
				: backup.kind === "upgrade"
					? `Before an upgrade, ${when(backup.created)}`
					: when(backup.created);
	const detail =
		backup.kind === "replaced"
			? `Kept whole from the restore of ${when(backup.created)}`
			: backup.kind === "unreadable"
				? backup.name
				: [
						sizeOf(backup.bytes),
						backup.without.includes("computer")
							? "without the computer's files"
							: backup.without.includes("browser")
								? "without the browser's signed-in sites"
								: "everything",
						...(backup.kind === "upgrade" ? [`taken by banda ${backup.banda}`] : []),
					].join(" · ");
	const path = `${folder}/${backup.name}`;
	return (
		<>
			<RowOf
				lead={
					<span className="flex size-8 shrink-0 items-center justify-center rounded-field bg-paper-3">
						<Icon className="size-4 text-ink-2" />
					</span>
				}
				title={title}
				detail={detail}
				end={
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								className="shrink-0 pointer-coarse:size-11"
								aria-label={`More for ${name}`}
							>
								<EllipsisIcon />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{backup.kind === "unreadable" || !restorable ? null : (
								<DropdownMenuItem disabled={busy} onSelect={() => setAsking("restore")}>
									Restore…
								</DropdownMenuItem>
							)}
							{act.onReveal === undefined ? (
								<DropdownMenuItem onSelect={() => act.onCopyPath?.(path)}>Copy its path</DropdownMenuItem>
							) : (
								<DropdownMenuItem onSelect={() => act.onReveal?.(backup.name)}>
									Show in {fileManager ?? "its folder"}
								</DropdownMenuItem>
							)}
							<DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => setAsking("delete")}>
								Delete…
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			/>
			<Confirm
				open={asking === "restore"}
				onOpenChange={(open) => setAsking(open ? "restore" : undefined)}
				title={backup.kind === "replaced" ? "Go back to this home?" : `Restore ${name}?`}
				body={
					backup.kind === "replaced"
						? "banda starts again with the home as it was before the restore. The home as it is now is set aside beside the backups, so nothing is lost."
						: "banda copies and checks it first, then starts again with it. What happened since it was taken is not in it: the home as it is now is set aside beside the backups, so nothing is lost."
				}
				action="Restore"
				onConfirm={() => act.onRestore?.(backup.name)}
			/>
			<Confirm
				open={asking === "delete"}
				onOpenChange={(open) => setAsking(open ? "delete" : undefined)}
				title={backup.kind === "replaced" ? "Delete your home from before the restore?" : `Delete ${name}?`}
				body={
					backup.kind === "replaced"
						? "It is the only copy of the home as it was before the restore. It can't be brought back."
						: backup.kind === "upgrade"
							? "It is the way back to the version of banda you had before the upgrade. It can't be brought back."
							: "It can't be brought back."
				}
				action="Delete"
				keep="Keep it"
				onConfirm={() => act.onDelete?.(backup.name)}
			/>
		</>
	);
}
