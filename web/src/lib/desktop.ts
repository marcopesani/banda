/**
 * What the desktop app adds to the page (desktop/src/preload.cts), when the page runs in it: the system's own folder
 * dialog, and the tray's dot. Undefined in a browser.
 */
type Desktop = {
	/** The folder the owner picked, opened at `at`; undefined when they cancelled. */
	readonly chooseFolder: (at?: string) => Promise<string | undefined>;
	/** What waits on the owner now, which the tray shows as a dot: chats with an open ask, and unread messages. */
	readonly attention: (attention: { asks: number; unread: number }) => void;
};

export const desktop = (globalThis as { bandaDesktop?: Desktop }).bandaDesktop;

/** What the system's file manager is called here: Finder on a Mac, else none in particular. */
export const fileManager = /Mac/i.test(globalThis.navigator?.userAgent ?? "") ? "Finder" : undefined;
