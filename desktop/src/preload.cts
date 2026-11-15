/**
 * What the desktop app adds to the daemon's page, and only that: the system's own folder dialog, for the code folder a
 * harness works in (a browser cannot hand an app a folder's path; the desktop app can), and the tray's dot, which the
 * page's own count of asks and unread messages draws. Sandboxed, so CommonJS and
 * nothing but electron's renderer side; the main process answers only the daemon's own page (see main.ts).
 */
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("bandaDesktop", {
	/** The folder the owner picked in the system's dialog, opened at `at`; undefined when they cancelled. */
	chooseFolder: (at?: string): Promise<string | undefined> => ipcRenderer.invoke("banda:choose-folder", at),
	/** What waits on the owner now, for the tray's dot: chats with an open ask, and unread messages. */
	attention: (attention: { asks: number; unread: number }): void => ipcRenderer.send("banda:attention", attention),
});
