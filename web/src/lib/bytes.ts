/** Bytes as base64 and back: how a body crosses a shell's bridge (`transport.ts`). */
export const toBase64 = (bytes: Uint8Array) => {
	let text = "";
	for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
	return btoa(text);
};

export const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
