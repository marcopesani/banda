import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { renderAvatarSvg } from "open-bot-avatar";
import { type AvatarFace, readAvatarFace, writeAvatarFace } from "./avatar-face.ts";

export const ICON_FILES = {
	"/icon.svg": { size: 512, maskable: false, svg: true },
	"/icon-maskable.svg": { size: 512, maskable: true, svg: true },
	"/icon-192.png": { size: 192, maskable: false, svg: false },
	"/icon-512.png": { size: 512, maskable: false, svg: false },
	"/icon-maskable-512.png": { size: 512, maskable: true, svg: false },
	// A phone's home screen paints black behind a transparent icon (iOS), so it is given the opaque drawing.
	"/apple-touch-icon.png": { size: 180, maskable: true, svg: false },
} as const;
export type IconPath = keyof typeof ICON_FILES;

/**
 * What every mask keeps of a maskable icon is its central circle, of radius 40% of the icon (204.8 of 512). The face
 * is fitted to `FIT` and nothing is drawn past `KEPT`, so an edge's soft pixels stay inside the circle too.
 */
const KEPT = 203;
const FIT = 200;

/** Only validated geometry enters the renderer; never caller-supplied SVG, URLs or markup. */
export function avatarIcon(face: AvatarFace, maskable = false): string {
	const checked = readAvatarFace(writeAvatarFace(face));
	if (!checked.ok) throw new Error("Invalid avatar face");
	// Names and ids are not public identity data. A fixed id also gives every icon the same still pose.
	const definition = { ...checked.face.definition, name: "Avatar", id: "icon" };
	const open =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Avatar">';
	if (maskable) {
		// The face as large as the circle allows: what is fitted is what the face draws, not its drawing's square, so
		// a face on a home screen is near the size the phone's app gives it (scripts/mobile-icons.ts). The circle
		// clips what the measure did not see, so even extreme accepted geometry cannot leave it.
		const drawing = renderAvatarSvg(definition, { color: checked.face.color, size: DRAWN, reducedMotion: true });
		const { x, y, reach } = drawn(drawing);
		const fitted = `translate(256 256) scale(${hundredth(FIT / reach)}) translate(${-x} ${-y})`;
		return `${open}<rect width="512" height="512" fill="#fcfcfc"/><clipPath id="kept"><circle cx="256" cy="256" r="${KEPT}"/></clipPath><g clip-path="url(#kept)"><g transform="${fitted}">${drawing}</g></g></svg>`;
	}
	const inset = 32;
	const extent = 512 - 2 * inset;
	const drawing = renderAvatarSvg(definition, { color: checked.face.color, size: extent, reducedMotion: true });
	return `${open}<g transform="translate(${inset} ${inset})"><svg width="${extent}" height="${extent}" viewBox="0 0 ${extent} ${extent}" overflow="hidden" role="img" aria-label="Avatar">${drawing}</svg></g></svg>`;
}

/** The side a face is drawn at to be measured, and the unit its measures are in. */
const DRAWN = 256;

/** To a hundredth: a measure is the same text on every computer. */
const hundredth = (value: number) => Math.round(value * 100) / 100;

/**
 * Where a face's drawing has anything in it: the middle of that, and how far from the middle it reaches. Read off
 * its pixels, since a rounded shape reaches less far than the corners of the box around it.
 */
function drawn(drawing: string): { x: number; y: number; reach: number } {
	const { pixels } = new Resvg(drawing, { font: { loadSystemFonts: false } }).render();
	const inked: [number, number][] = [];
	for (let y = 0; y < DRAWN; y++)
		for (let x = 0; x < DRAWN; x++) if ((pixels[(y * DRAWN + x) * 4 + 3] ?? 0) > 0) inked.push([x, y]);
	// a face that draws nothing is fitted as its whole square would be
	if (inked.length === 0) return { x: DRAWN / 2, y: DRAWN / 2, reach: DRAWN / Math.SQRT2 };
	const span = (at: 0 | 1) => {
		const along = inked.map((pixel) => pixel[at]);
		return (Math.min(...along) + Math.max(...along) + 1) / 2;
	};
	const [x, y] = [span(0), span(1)];
	// to each pixel's far corner, so the reach is never short of the drawing's
	const reach = Math.max(
		...inked.map(([px, py]) => Math.hypot(Math.abs(px + 0.5 - x) + 0.5, Math.abs(py + 0.5 - y) + 0.5)),
	);
	return { x, y, reach };
}

export function avatarIconPng(face: AvatarFace, size: 180 | 192 | 512, maskable = false): Buffer {
	return png(avatarIcon(face, maskable), size);
}

function png(svg: string, size: number): Buffer {
	// No fonts, resource directory or image resolver: this renderer only sees our own self-contained paths.
	return new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: false } }).render().asPng();
}

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export type IconResponse = { readonly bytes: Buffer; readonly type: string; readonly etag: string };

/** One current face per HTTP server, at most six images. Derived bytes are discarded on identity change. */
export function avatarIcons() {
	let current = "";
	let standard = "";
	let maskable = "";
	let revision = "";
	const images = new Map<IconPath, IconResponse>();
	return (face: AvatarFace) => {
		const key = writeAvatarFace(face);
		if (key !== current) {
			standard = avatarIcon(face);
			maskable = avatarIcon(face, true);
			revision = hash(standard + maskable);
			images.clear();
			current = key;
		}
		return {
			revision,
			image(path: IconPath): IconResponse {
				const hit = images.get(path);
				if (hit) return hit;
				const spec = ICON_FILES[path];
				const svg = spec.maskable ? maskable : standard;
				const bytes = spec.svg ? Buffer.from(svg) : png(svg, spec.size);
				const image = { bytes, type: spec.svg ? "image/svg+xml" : "image/png", etag: `"${hash(bytes)}"` };
				images.set(path, image);
				return image;
			},
		};
	};
}

/** Stable manifest identity, but versioned icon URLs make changed faces visible to install clients. */
export function avatarManifest(revision?: string): string {
	const suffix = revision === undefined ? "" : `?v=${revision}`;
	return JSON.stringify({
		id: "/",
		name: "banda",
		short_name: "banda",
		description: "Your companion, on your own computer.",
		start_url: "/#/",
		scope: "/",
		display: "standalone",
		background_color: "#fcfcfc",
		theme_color: "#fcfcfc",
		icons: Object.entries(ICON_FILES)
			.filter(([path]) => path !== "/apple-touch-icon.png")
			.map(([path, spec]) => ({
				src: path + suffix,
				sizes: spec.svg ? "any" : `${spec.size}x${spec.size}`,
				type: spec.svg ? "image/svg+xml" : "image/png",
				purpose: spec.maskable ? "maskable" : "any",
			})),
	});
}
