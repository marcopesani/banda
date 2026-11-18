/**
 * The app's one way to open and close what a line holds: a row's card, a routine's run. Whatever folds open beneath
 * its own line uses this, so they all move alike: the same curve, the same time, the same answer to reduced motion.
 */
import { useReducedMotion } from "motion/react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

/** The design's ease-out (tokens.css `--ease-out`): quick to start, long to settle. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_OUT_CSS = `cubic-bezier(${EASE_OUT.join(", ")})`;

/** How long it takes to open or close, which what turns with it (a chevron) takes too. */
export const REVEAL_MS = 240;

/**
 * Height is layout: it cannot reach the compositor, and the content below has to move with it. So it runs as a native
 * Web Animation (the browser ticks it, no JavaScript each frame), only for as long as it moves, clipped only while it
 * moves; and what it holds is contained, so its insides are not laid out again on every frame.
 */
export function resize(element: HTMLElement, from: number, to: number, duration: number): Animation {
	element.style.overflow = "hidden";
	const animation = element.animate([{ height: `${from}px` }, { height: `${to}px` }], {
		duration,
		easing: EASE_OUT_CSS,
		fill: "both",
	});
	return animation;
}

/**
 * What a line opens: grows from nothing as it fades in, and shrinks back as it fades out before it leaves. Reversing
 * midway starts from where it is. While open it follows what it holds: content that grows or shrinks (a run read,
 * after its skeleton) takes the frame there the same way, never in a jump. Reduced motion: the height snaps and only
 * the fade remains.
 */
export function Reveal({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
	const reduced = useReducedMotion() === true;
	const [mounted, setMounted] = useState(open);
	if (open && !mounted) setMounted(true);
	const frame = useRef<HTMLDivElement>(null);
	const inner = useRef<HTMLDivElement>(null);
	const sizing = useRef<Animation | undefined>(undefined);
	const fading = useRef<Animation | undefined>(undefined);
	const shown = useRef(open);
	/** The height the frame is at, or on its way to: what its content measured last. */
	const target = useRef<number | undefined>(undefined);
	const slow = useRef(REVEAL_MS);
	slow.current = reduced ? 0 : REVEAL_MS;

	/** Take the frame from `from` to `to`; there, it is its content's own height again, or gone when it closed. */
	const size = useRef((element: HTMLElement, from: number, to: number) => {
		sizing.current?.cancel();
		const animation = resize(element, from, to, slow.current);
		sizing.current = animation;
		target.current = to;
		animation.finished.then(
			() => {
				if (sizing.current !== animation) return;
				sizing.current = undefined;
				if (!shown.current) {
					setMounted(false);
					return;
				}
				animation.cancel();
				fading.current?.cancel();
				fading.current = undefined;
				element.style.overflow = "";
			},
			() => {
				// Cancelled by a reversal or by its content changing, which took over from here.
			},
		);
	}).current;

	useLayoutEffect(() => {
		const element = frame.current;
		if (element === null || shown.current === open) return;
		shown.current = open;
		const moving = sizing.current !== undefined;
		const height = element.getBoundingClientRect().height;
		const opacity = Number(getComputedStyle(element).opacity);
		fading.current?.cancel();
		fading.current = element.animate([{ opacity: moving ? opacity : open ? 0 : 1 }, { opacity: open ? 1 : 0 }], {
			duration: reduced ? 150 : open ? REVEAL_MS : 160,
			easing: EASE_OUT_CSS,
			fill: "both",
		});
		size(element, open && !moving ? 0 : height, open ? (inner.current?.offsetHeight ?? element.scrollHeight) : 0);
	}, [open, reduced, size]);

	useLayoutEffect(() => {
		const element = frame.current;
		const content = inner.current;
		if (!mounted || element === null || content === null || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			if (!shown.current) return;
			const to = content.offsetHeight;
			const from = sizing.current === undefined ? target.current : element.getBoundingClientRect().height;
			if (from === undefined || Math.abs(to - (target.current ?? to)) < 1) {
				target.current = to;
				return;
			}
			size(element, from, to);
		});
		observer.observe(content);
		return () => observer.disconnect();
	}, [mounted, size]);

	return mounted ? (
		<div ref={frame} id={id} className="w-full">
			<div ref={inner} className="[contain:layout_style]">
				{children}
			</div>
		</div>
	) : null;
}
