import { type ReactNode, useContext, useState } from "react";
import type { BackupsView, KeptBackup } from "../../../../src/server/api.ts";
import { BackupsSettings } from "../../chat/Backups.tsx";
import { SettingsPage } from "../../chat/Settings.tsx";
import { Section, StageContext } from "../stage.tsx";

const FOLDER = "/Users/ana/.banda-backups";
const GB = 1024 * 1024 * 1024;
const TAKEN = "2026-11-14T09:12:40.512Z";
const WHOLE: KeptBackup = {
	name: "2026-11-14T09-12-40Z",
	kind: "backup",
	created: TAKEN,
	bytes: 3.4 * GB,
	banda: "0.1.0",
	without: [],
};
const NO_BROWSER: KeptBackup = {
	name: "2026-11-09T18-03-02Z",
	kind: "backup",
	created: "2026-11-09T18:03:02.100Z",
	bytes: 2.1 * GB,
	banda: "0.1.0",
	without: ["browser"],
};
const UPGRADE: KeptBackup = {
	name: "before-format-4",
	kind: "upgrade",
	created: "2026-11-02T08:30:00.000Z",
	bytes: 48 * 1024 * 1024,
	banda: "0.1.0-alpha.14",
	without: ["computer"],
};
const REPLACED: KeptBackup = {
	name: "replaced-2026-11-15T10-02-33Z",
	kind: "replaced",
	created: "2026-11-15T10:02:33Z",
};
const UNREADABLE: KeptBackup = { name: "2026-10-01T07-00-00Z", kind: "unreadable" };

const NONE: BackupsView = { folder: FOLDER, computer: "held", backups: [] };
const SOME: BackupsView = { folder: FOLDER, computer: "held", backups: [WHOLE, NO_BROWSER, UPGRADE] };

/** Backing up as the owner sees it: the steps pass, the backup joins the list; it restores and deletes. */
function Example({ desktop }: { desktop: boolean }) {
	const [view, setView] = useState<BackupsView>(SOME);
	return (
		<BackupsSettings
			backups={view}
			fileManager={desktop ? "Finder" : undefined}
			onBackUp={(leave) => {
				const steps = 6;
				const name = "2026-11-15T10-00-00Z";
				for (let step = 0; step < steps; step++)
					setTimeout(() => setView((was) => ({ ...was, working: { kind: "backup", name, step, steps } })), step * 900);
				setTimeout(
					() =>
						setView(({ working: _done, ...was }) => ({
							...was,
							backups: [
								{
									name,
									kind: "backup",
									created: new Date().toISOString(),
									bytes: leave.computer === false ? 52 * 1024 * 1024 : 3.5 * GB,
									banda: "0.1.0",
									without: leave.computer === false ? ["computer"] : leave.browser === false ? ["browser"] : [],
								},
								...was.backups.filter((each) => each.name !== name),
							],
						})),
					steps * 900,
				);
			}}
			onRestore={(name) => {
				const created = view.backups.find((each) => each.name === name);
				setView((was) => ({
					...was,
					ready: { from: name, ...(created !== undefined && "created" in created ? { created: created.created } : {}) },
				}));
			}}
			onCancelRestore={() => setView(({ ready: _gone, ...was }) => was)}
			onDelete={(name) => setView((was) => ({ ...was, backups: was.backups.filter((each) => each.name !== name) }))}
			{...(desktop ? { onReveal: () => {}, onRestart: () => {} } : { onCopyPath: () => {} })}
		/>
	);
}

export function BackupsSection() {
	const phone = useContext(StageContext).width === "phone";
	const frame = (children: ReactNode) => (
		<div className="overflow-hidden rounded-tile border border-line-soft">
			<SettingsPage title="Settings" phone={phone}>
				{children}
			</SettingsPage>
		</div>
	);
	const desktop = { onReveal: () => {}, onRestart: () => {} };
	return (
		<>
			<Section
				id="backups"
				note="Back up now, watch it copy, restore or delete a backup. In the desktop app a backup shows in the file manager and banda restarts itself to finish a restore."
			>
				{frame(<Example desktop />)}
			</Section>
			<Section
				id="backups-states"
				note="Backups, each state: none yet, copying, failed, a restore being made ready, ready (desktop, then a browser), a restore a start could not finish, the home from before a restore, Docker's computer, not read yet."
			>
				{frame(<BackupsSettings backups={NONE} />)}
				{frame(
					<BackupsSettings
						backups={{ ...SOME, working: { kind: "backup", name: "2026-11-15T10-00-00Z", step: 4, steps: 6 } }}
					/>,
				)}
				{frame(
					<BackupsSettings
						backups={{
							...SOME,
							failed: { kind: "backup", why: "This computer's disk is full. Free some space and try again." },
						}}
					/>,
				)}
				{frame(
					<BackupsSettings
						backups={{ ...SOME, working: { kind: "restore", name: WHOLE.name, step: 1, steps: 3 } }}
						{...desktop}
					/>,
				)}
				{frame(
					<BackupsSettings
						backups={{ ...SOME, ready: { from: WHOLE.name, created: TAKEN } }}
						fileManager="Finder"
						{...desktop}
					/>,
				)}
				{frame(<BackupsSettings backups={{ ...SOME, ready: { from: WHOLE.name, created: TAKEN } }} />)}
				{frame(
					<BackupsSettings
						backups={{
							...SOME,
							ready: {
								from: WHOLE.name,
								created: TAKEN,
								failed:
									"The backup could not take the home's place (EXDEV: cross-device link not permitted). Nothing was changed.",
							},
						}}
					/>,
				)}
				{frame(
					<BackupsSettings
						backups={{ ...SOME, backups: [REPLACED, WHOLE, UNREADABLE] }}
						fileManager="Finder"
						{...desktop}
					/>,
				)}
				{frame(<BackupsSettings backups={{ ...SOME, computer: "elsewhere", backups: [UPGRADE] }} />)}
				{frame(<BackupsSettings backups={undefined} />)}
			</Section>
		</>
	);
}
