/**
 * The camera, over the whole screen, until it reads a code: what "Scan the code" opens where the page itself scans (a
 * phone's browser; the phone's app has a scanner of its own). It reads any QR code and hands its text on: whether that
 * is a pairing code is pairing's to say (`lib/pairing.ts`). The camera is let go of when this closes. The camera and
 * what reads its picture are given (`app/PageScan.tsx` gives the browser's), so this view carries no decoder.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import type { ReadCode } from "../lib/qr-reader.ts";

/** How often the picture is read, in milliseconds: a code held still is read within a few of these. */
const EVERY = 150;

export function ScanCode({
	onCode,
	onClose,
	camera,
	reader,
	className,
}: {
	/** A code was read: its text. The view is the caller's to close. */
	onCode: (text: string) => void;
	onClose: () => void;
	/** Opens the camera: its stream is this view's to stop. */
	camera: () => Promise<MediaStream>;
	reader: () => Promise<ReadCode>;
	/** Where it sits when it is not over the whole screen (the specimen). */
	className?: string;
}) {
	const video = useRef<HTMLVideoElement>(null);
	const [state, setState] = useState<"starting" | "reading" | "refused">("starting");
	// the latest callbacks, without restarting the camera when a parent renders again
	const told = useRef({ onCode, onClose });
	told.current = { onCode, onClose };

	useEffect(() => {
		let over = false;
		let stream: MediaStream | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		void (async () => {
			try {
				const [opened, read] = await Promise.all([camera(), reader()]);
				stream = opened;
				const view = video.current;
				if (over || view === null) return;
				view.srcObject = opened;
				await view.play();
				if (over) return;
				setState("reading");
				const look = async () => {
					if (over) return;
					const text = await read(view).catch(() => undefined);
					if (over) return;
					if (text !== undefined) return told.current.onCode(text);
					timer = setTimeout(() => void look(), EVERY);
				};
				void look();
			} catch {
				// the owner said no, the browser has no camera to give, or another page holds it
				if (!over) setState("refused");
			} finally {
				if (over) for (const track of stream?.getTracks() ?? []) track.stop();
			}
		})();
		return () => {
			over = true;
			clearTimeout(timer);
			for (const track of stream?.getTracks() ?? []) track.stop();
		};
	}, [camera, reader]);

	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") told.current.onClose();
		};
		addEventListener("keydown", key);
		return () => removeEventListener("keydown", key);
	}, []);

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Scan the code"
			className={cn("fixed inset-0 z-50 flex flex-col bg-black text-white", className)}
		>
			<video ref={video} playsInline muted className="absolute inset-0 size-full object-cover" />
			<div className="relative flex flex-1 flex-col items-center justify-between gap-4 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
				<p className="rounded-tile bg-black/60 px-3.5 py-2 text-center text-ui" aria-live="polite">
					{state === "refused"
						? "banda cannot use this phone’s camera. Allow it in your browser, or paste the pairing link instead."
						: "Point at the code on your computer"}
				</p>
				{state === "refused" ? null : (
					<div className="flex aspect-square w-full max-w-64 items-center justify-center rounded-tile border-2 border-white/80">
						{state === "starting" ? <Spinner className="size-6 text-white" /> : null}
					</div>
				)}
				<Button size="lg" variant="secondary" className="w-full max-w-sm" onClick={onClose}>
					{state === "refused" ? "Close" : "Cancel"}
				</Button>
			</div>
		</div>
	);
}
