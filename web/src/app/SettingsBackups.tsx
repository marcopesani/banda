/**
 * Settings' backups, live: the backups and the work under way, from the daemon; the owner's calls; and what only the
 * desktop app can do (show a backup in the file manager, start banda again to finish a restore). In a browser a
 * backup's path is copied instead, and the page says how to start banda again.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { backUp, cancelRestore, deleteBackup, dismissFailure, restoreBackup, useBackups } from "../areas/backups.ts";
import { BackupsSettings } from "../chat/Backups.tsx";
import { attempt } from "../lib/attempt.ts";
import { desktop, fileManager } from "../lib/desktop.ts";

export function SettingsBackups() {
	const backups = useBackups();
	// a backup that ended well says so once, quietly; one that failed stays on the page in words
	const was = useRef(backups?.working?.kind);
	useEffect(() => {
		const kind = backups?.working?.kind;
		if (was.current === "backup" && kind === undefined && backups?.failed === undefined) toast.success("Backed up");
		was.current = kind;
	}, [backups]);
	const reveal = desktop?.revealBackup;
	const restart = desktop?.restart;
	return (
		<BackupsSettings
			backups={backups}
			fileManager={fileManager}
			onBackUp={(leave) => void attempt("start the backup", () => backUp(leave))}
			onRestore={(name) => void attempt("get the restore ready", () => restoreBackup(name))}
			onDelete={(name) =>
				void attempt("delete the backup", () => deleteBackup(name)).then((view) => {
					if (view !== undefined) toast.success("Deleted");
				})
			}
			onCancelRestore={() => void attempt("let the restore go", cancelRestore)}
			onDismiss={() => void attempt("dismiss it", dismissFailure)}
			onCopyPath={(path) =>
				void navigator.clipboard.writeText(path).then(
					() => toast.success("Path copied"),
					() => toast.error("Couldn't copy the path", { description: path }),
				)
			}
			{...(reveal === undefined
				? {}
				: {
						onReveal: (name: string) =>
							void attempt("show the backup", async () => {
								if (!(await reveal(name))) throw new Error("gone");
							}),
					})}
			{...(restart === undefined ? {} : { onRestart: () => void attempt("start banda again", restart) })}
		/>
	);
}
