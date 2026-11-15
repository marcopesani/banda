/**
 * The camera's view as a page that scans shows it: the browser's camera, read by `lib/qr-reader.ts`. Only the build for
 * the app's own origin loads this, so only it carries the decoder (`App.tsx`).
 */
import { ScanCode } from "../chat/ScanCode.tsx";
import { openCamera, qrReader } from "../lib/qr-reader.ts";

export function PageScan(props: { onCode: (text: string) => void; onClose: () => void }) {
	return <ScanCode {...props} camera={openCamera} reader={qrReader} />;
}
