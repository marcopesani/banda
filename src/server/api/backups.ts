/** The API's shapes for the home's backups, as Settings shows them. Re-exported by `../api.ts`. */
import type { KeptBackup } from "../../core/backups.ts";

export type { KeptBackup };

/** A backup being taken, or a restore being made ready: which of its `steps` it is on, from 0. */
export type BackupWork = {
	readonly kind: "backup" | "restore";
	/** The backup's name. */
	readonly name: string;
	readonly step: number;
	readonly steps: number;
};

export type BackupsView = {
	/** The folder the backups are in, beside the home: shown to copy, never taken back from the page. */
	readonly folder: string;
	/** The newest first. */
	readonly backups: readonly KeptBackup[];
	/**
	 * Whether a backup taken here holds the computer's files: `held`, they are folders of the home; `elsewhere`, Docker
	 * keeps them in volumes a backup does not reach, so a backup cannot bring the band back whole and none is restored
	 * here.
	 */
	readonly computer: "held" | "elsewhere";
	readonly working?: BackupWork;
	/** The last backup or restore that failed, in plain words, until the next one starts or the owner dismisses it. */
	readonly failed?: { readonly kind: "backup" | "restore"; readonly why: string };
	/**
	 * A restore made ready: the backup `from` takes the home's place the next time banda starts. `failed` says why a
	 * start could not finish it; the home is then the one it was.
	 */
	readonly ready?: { readonly from: string; readonly created?: string; readonly failed?: string };
};
