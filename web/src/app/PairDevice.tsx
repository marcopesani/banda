/**
 * A shell's first screen until this phone is a paired device (`lib/pairing.ts`): it reads where the shell stands, pairs
 * when it must, and opens the app once the owner approved this phone. The page the daemon serves never shows it.
 *
 * The phone's app scans with a scanner of its own. Where the page itself must (`ScanCode`: a browser on the app's own
 * origin), "Scan the code" opens the camera in the page when the device has one to point at a screen, and a link the
 * owner copied on the computer can be pasted, which is how a browser on a computer pairs.
 */
import { type ComponentType, type ReactNode, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { PairPhone } from "../chat/PairPhone.tsx";
import { api, onDeviceRefused, type PairingView } from "../lib/api.ts";
import { type Pairing, pairing } from "../lib/pairing.ts";
import type { BandaPlugin, ScannerPlugin } from "../lib/transport.ts";

/** The camera's view, as the page shows it while it scans (`chat/ScanCode.tsx`). */
export type ScanView = ComponentType<{ onCode: (text: string) => void; onClose: () => void }>;

/** Whether this page has a camera to point at a screen: a phone's or a tablet's browser, on an origin it trusts with one. */
const hasCamera = () =>
	navigator.mediaDevices?.getUserMedia !== undefined &&
	(navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches);

export function PairDevice({
	shell,
	ScanCode,
	children,
}: {
	shell: { readonly banda: BandaPlugin; readonly scanner?: ScannerPlugin };
	/** Given where the page itself scans and takes a pasted link: the browser's shell, which has no scanner of its own. */
	ScanCode?: ScanView;
	/** The app, once paired. */
	children: ReactNode;
}) {
	/** The owner asked to scan and the page's camera is open: how its answer, or its closing, reaches the flow. */
	const [scanning, setScanning] = useState<{ read(text: string): void; closed(): void } | undefined>(undefined);
	const [inPage] = useState(() => ScanCode !== undefined && shell.scanner === undefined);
	const [camera] = useState(() => inPage && hasCamera());
	const [flow] = useState<Pairing>(() => {
		/** The page's own scanner, by the contract of the phone's: its answer is a code's text, its closing a refusal. */
		const page: ScannerPlugin = {
			scanBarcode: () =>
				new Promise((resolve, reject) =>
					setScanning({
						read: (text) => {
							setScanning(undefined);
							resolve({ ScanResult: text });
						},
						closed: () => {
							setScanning(undefined);
							reject(new Error("closed without a code"));
						},
					}),
				),
		};
		return pairing({
			shell: shell.banda,
			scanner: shell.scanner ?? (camera ? page : undefined),
			ask: async (invite, name) =>
				(await api<PairingView>("/devices/pair", { method: "POST", body: JSON.stringify({ invite, name }) })).state,
			check: async () => (await api<PairingView>("/devices/pair")).state,
		});
	});
	const step = useSyncExternalStore(flow.subscribe, flow.get);
	useEffect(() => {
		void flow.start().catch(() => undefined);
		const listening = shell.banda.addListener("link", ({ url }) => flow.opened(url));
		return () => {
			flow.stop();
			void listening.then((handle) => handle.remove()).catch(() => undefined);
		};
	}, [flow, shell]);
	useEffect(() => {
		const stopListening = onDeviceRefused(() => void flow.refused());
		return () => {
			stopListening();
		};
	}, [flow]);
	if (step.step === "paired") return children;
	return (
		<>
			<PairPhone
				step={step}
				// a page with no camera to point offers no scan: the phone's app always has its scanner to ask
				{...(inPage && !camera ? {} : { onScan: (name: string) => void flow.scan(name) })}
				{...(inPage ? { onPaste: (link: string, name: string) => void flow.paste(link, name) } : {})}
				onPairLink={(name) => {
					if (step.step === "scan" && step.link !== undefined) void flow.pair(step.link, name);
				}}
				onConfirm={() => void flow.confirm()}
				onAgain={flow.again}
				onRetry={() => void flow.start().catch(() => undefined)}
			/>
			{scanning === undefined || ScanCode === undefined ? null : (
				<Suspense fallback={null}>
					<ScanCode onCode={scanning.read} onClose={scanning.closed} />
				</Suspense>
			)}
		</>
	);
}
