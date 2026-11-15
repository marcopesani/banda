/**
 * The tray's dot: what the band wants of the owner (open asks, unread messages), as the page counts them, drawn on
 * the tray's icon as a dot in its top right corner. Pure, so it is tested without Electron: main.ts hands it the
 * icon's pixels and puts back what it returns.
 */

/** What waits on the owner: chats with an open ask, and unread messages. */
export type Attention = { readonly asks: number; readonly unread: number };

export const NOTHING: Attention = { asks: 0, unread: 0 };

const count = (value: unknown): number =>
	typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;

/** What the page said, as counts: anything else counts as nothing. */
export function attentionFrom(said: unknown): Attention {
	const given = (typeof said === "object" && said !== null ? said : {}) as Record<string, unknown>;
	return { asks: count(given.asks), unread: count(given.unread) };
}

export const wantsOwner = (attention: Attention): boolean => attention.asks + attention.unread > 0;

/** The tray's tooltip, in the tab title's words: asks first, then unread. */
export function tooltipOf(attention: Attention): string {
	const counts = [
		attention.asks === 0 ? undefined : `${attention.asks} waiting`,
		attention.unread === 0 ? undefined : `${attention.unread} unread`,
	].filter(Boolean);
	return counts.length === 0 ? "banda" : `banda: ${counts.join(", ")}`;
}

/** The dot on an 18pt icon, in points: its centre from the right and top edges, its radius, and the ring around it. */
const RIGHT = 3;
const TOP = 3.75;
const RADIUS = 2.75;
const RING = 1;
const ICON = 18;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

type Color = readonly [blue: number, green: number, red: number];

/**
 * The icon's pixels with the dot drawn on: premultiplied BGRA, as Electron's `toBitmap` gives them, `width` wide.
 * A ring of `ring` holds the dot, so it reads on any icon and off its edge. Without a `dot` colour the dot is a hole:
 * whatever is behind the icon shows through, which on a macOS template image (one colour, painted by the menu bar)
 * is the icon's opposite, dark in a light icon and light in a dark one.
 */
export function withDot(pixels: Uint8Array, width: number, ring: Color, dot?: Color): Uint8Array {
	const height = pixels.length / 4 / width;
	const unit = width / ICON;
	const centerX = width - RIGHT * unit;
	const centerY = TOP * unit;
	const out = Uint8Array.from(pixels);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
			// how much of this pixel the ring's disc and the dot inside it cover, edges softened
			const disc = clamp((RADIUS + RING) * unit - distance + 0.5);
			const inside = clamp(RADIUS * unit - distance + 0.5);
			if (disc === 0) continue;
			const at = (y * width + x) * 4;
			for (let channel = 0; channel < 4; channel++) {
				const alpha = channel === 3;
				const ringed = (out[at + channel] ?? 0) * (1 - disc) + (alpha ? 255 : (ring[channel] ?? 0)) * disc;
				const filled = dot === undefined ? 0 : alpha ? 255 : (dot[channel] ?? 0);
				out[at + channel] = Math.round(ringed * (1 - inside) + filled * inside);
			}
		}
	}
	return out;
}
