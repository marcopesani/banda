/**
 * The home's backups in the app: the backups beside the home, the one being taken and a restore made ready. Read when
 * a page that shows them opens, and again every second while the daemon works on one: the work is the daemon's, so a
 * page opened later finds it under way. Each of the owner's calls answers the backups as they are after.
 */
import { useSyncExternalStore } from "react";
import { api, type BackupsView } from "../lib/api.ts";

let backups: BackupsView | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

const read = () => api<BackupsView>("/backups").then(show, () => again());

/** Look again in a moment, while something shows the backups and the daemon was last seen at work. */
function again(): void {
	clearTimeout(timer);
	if (listeners.size > 0 && backups?.working !== undefined) timer = setTimeout(() => void read(), 1000);
}

function show(next: BackupsView): BackupsView {
	backups = next;
	for (const listener of listeners) listener();
	again();
	return next;
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	if (listeners.size === 1) void read();
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) clearTimeout(timer);
	};
}

/** The backups, once read. */
export function useBackups(): BackupsView | undefined {
	return useSyncExternalStore(subscribe, () => backups);
}

const call = (path: string, method: string, body?: unknown) =>
	api<BackupsView>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).then(show);

const one = (name: string) => `/backups/kept/${encodeURIComponent(name)}`;

/** Take a backup now, leaving out what `leave` names. */
export const backUp = (leave: { computer?: false; browser?: false }) => call("/backups", "POST", leave);

export const deleteBackup = (name: string) => call(one(name), "DELETE");

/** Make the restore of a backup ready: the next start of banda finishes it. */
export const restoreBackup = (name: string) => call(`${one(name)}/restore`, "POST");

/** Let a restore made ready go. */
export const cancelRestore = () => call("/backups/restore", "DELETE");

/** Put away the words of the last failure. */
export const dismissFailure = () => call("/backups/failure", "DELETE");
