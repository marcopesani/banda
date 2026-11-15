/**
 * Reading a QR code off the camera's picture, in a page: the browser's own detector where it has one that reads QR
 * codes (Chrome on a phone), and a decoder the page carries where it has none (Safari, on every iPhone). The decoder
 * is loaded only when it is needed.
 */

/** The text of a QR code in the picture `video` shows now, if there is one. */
export type ReadCode = (video: HTMLVideoElement) => Promise<string | undefined>;

/** The browser's barcode detector, as far as this file uses it: not every browser has one, and TypeScript names none. */
type Detector = { detect(source: HTMLVideoElement): Promise<readonly { readonly rawValue: string }[]> };
type DetectorClass = {
	new (options: { formats: string[] }): Detector;
	getSupportedFormats(): Promise<readonly string[]>;
};

/** The longest side a picture is read at by the page's own decoder: enough for a dense code, small enough to be quick. */
const SIDE = 1024;

export async function qrReader(): Promise<ReadCode> {
	const detector = await browsers();
	if (detector === undefined) return carried();
	let instead: Promise<ReadCode> | undefined;
	return async (video) => {
		if (instead === undefined) {
			try {
				return (await detector.detect(video))[0]?.rawValue || undefined;
			} catch {
				// it said it reads QR codes and then could not (the service behind it is not on every phone that names
				// it): the page's own decoder reads from here on, where asking it again would never read anything
				instead = carried();
			}
		}
		return (await instead)(video);
	};
}

/** The browser's detector, if it has one that says it reads QR codes. */
async function browsers(): Promise<Detector | undefined> {
	const Native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
	if (Native === undefined) return undefined;
	try {
		if ((await Native.getSupportedFormats()).includes("qr_code")) return new Native({ formats: ["qr_code"] });
	} catch {
		// a detector that will not say what it reads is not relied on
	}
	return undefined;
}

/** The decoder the page carries, fetched when it is first needed. */
async function carried(): Promise<ReadCode> {
	const { default: decode } = await import("jsqr");
	const canvas = document.createElement("canvas");
	const context = canvas.getContext("2d", { willReadFrequently: true });
	return async (video) => {
		const scale = Math.min(1, SIDE / Math.max(video.videoWidth, video.videoHeight, 1));
		const width = Math.round(video.videoWidth * scale);
		const height = Math.round(video.videoHeight * scale);
		if (context === null || width === 0 || height === 0) return undefined;
		canvas.width = width;
		canvas.height = height;
		context.drawImage(video, 0, 0, width, height);
		const picture = context.getImageData(0, 0, width, height);
		return decode(picture.data, width, height, { inversionAttempts: "dontInvert" })?.data || undefined;
	};
}

/** The camera that faces away from the owner, where the device has one. */
export const openCamera = () =>
	navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
