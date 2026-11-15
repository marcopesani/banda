/**
 * The app: the shell (`app/Shell.tsx`) once the page holds the owner's token; without one, or with one the daemon no
 * longer takes, the page says where its link is. In the phone's native shell, and in a browser on the app's own origin,
 * there is no token: the app opens once this is a paired device (`app/PairDevice.tsx`). `#/specimen` shows every
 * component, with no token needed.
 */

/** The shell the app is a device through, when it has one (the phone's, or the browser's on the app's own origin): read once, as the transport is. */
const native = deviceShell();

import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { PairDevice } from "./app/PairDevice.tsx";
import { Shell } from "./app/Shell.tsx";
import { hasToken, onToken, onUnauthorized } from "./lib/api.ts";
import { deviceShell } from "./lib/transport.ts";

/** Whether this is the build the app's own origin serves, set by web/vite.config.ts; no other build defines it true. */
declare const __BANDA_HOSTED__: boolean | undefined;

/**
 * The camera's view for a page that scans a pairing code itself, loaded when the owner asks to scan. Only the build
 * the app's own origin serves is such a page (the phone's app has a scanner of its own), so only it carries the view
 * and the decoder behind it.
 */
const ScanCode =
	typeof __BANDA_HOSTED__ !== "undefined" && __BANDA_HOSTED__
		? lazy(() => import("./app/PageScan.tsx").then((module) => ({ default: module.PageScan })))
		: undefined;

/** The specimen, loaded when its hash is opened: the app does not carry it. */
const Specimen = lazy(() => import("./routes/Specimen.tsx").then((module) => ({ default: module.Specimen })));

function useSpecimen(): boolean {
	const [hash, setHash] = useState(location.hash);
	useEffect(() => {
		const changed = () => setHash(location.hash);
		addEventListener("hashchange", changed);
		return () => removeEventListener("hashchange", changed);
	}, []);
	return hash.startsWith("#/specimen");
}

export function App() {
	const specimen = useSpecimen();
	const [refused, setRefused] = useState(!hasToken());
	useEffect(() => {
		return onUnauthorized(() => setRefused(true));
	}, []);
	useEffect(() => {
		return onToken(() => setRefused(!hasToken()));
	}, []);
	if (specimen)
		return (
			<Suspense fallback={null}>
				<Specimen />
			</Suspense>
		);
	if (native !== undefined)
		return (
			<PairDevice shell={native} {...(ScanCode === undefined ? {} : { ScanCode })}>
				<Shell />
				<Toaster />
			</PairDevice>
		);
	if (refused) return <Connect />;
	return (
		<>
			<Shell />
			<Toaster />
		</>
	);
}

function Connect() {
	return (
		<main className="flex h-svh items-center justify-center bg-paper p-6 text-ink">
			<div className="flex max-w-sm flex-col gap-3 text-body">
				<h1 className="text-heading font-semibold">Connect to banda</h1>
				<p className="text-ink-2">
					This page needs your link. Open the one <code className="font-code">banda serve</code> printed when it
					started, or the one this prints:
				</p>
				<pre className="rounded-tile bg-paper-2 px-4 py-3 font-code text-ui">banda status</pre>
				<p className="text-ui text-ink-2">
					The link survives restarts; this page shows again only in a new browser or after the link is renewed.
				</p>
			</div>
		</main>
	);
}
