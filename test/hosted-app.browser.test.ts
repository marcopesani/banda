/**
 * The app on an origin of its own, as a device in a browser (web/src/lib/browser-shell.ts, hosted-shell.ts): the real
 * web app in Chrome, made as that origin's build is (`__BANDA_HOSTED__`), against a real daemon. A browser's Iroh
 * endpoint reaches a relay alone, and a test reaches no network, so the WebAssembly module is the one thing stood in
 * for: its place is taken by a module that hands each call to this test, which makes it over Iroh on loopback from a
 * device of its own (`./fixtures/iroh-client.ts`). Everything above the endpoint is the app's: the link an address
 * carries, the pairing screens, the key kept in the browser's storage, the framing of each request.
 * `BANDA_HOSTED_SHOTS=<dir>` saves screenshots.
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { Connection } from "@number0/iroh";
import { expect, it } from "vitest";
import { startDaemon } from "../src/daemon.ts";
import { readDaemonFile } from "../src/home.ts";
import type { DevicesView, InviteView } from "../src/server/api.ts";
import { streamSocket } from "../src/server/remote.ts";
import { fingerprint, NOTES } from "../web/src/lib/pairing.ts";
import { hostBox } from "./fixtures/host-box.ts";
import { type Device, testDevice } from "./fixtures/iroh-client.ts";
import { echoModels, skipShippedSkills, tempHome, webServer } from "./helpers.ts";
import { hasChrome, withPage } from "./smoke/chrome.ts";

const SHOTS = process.env.BANDA_HOSTED_SHOTS;

/**
 * The endpoint's calls, answered over Iroh on loopback. A browser's key is its device here too: the same key bound
 * again is the same endpoint, so a page that kept its key and reloads is the device it was.
 */
async function bridge(daemon: string) {
	const bound = new Map<string, Device>();
	/** The connections dialed, each its dial's own. */
	const links = new Map<string, Connection>();
	const streams = new Map<string, Duplex>();
	const body = async (req: http.IncomingMessage) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks);
	};
	const server = http.createServer((req, res) => {
		void (async () => {
			res.setHeader("access-control-allow-origin", "*");
			const url = new URL(req.url ?? "/", "http://bridge");
			const asked = await body(req);
			const json = (value: unknown) =>
				void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
			if (url.pathname === "/bind") {
				const secret = asked.toString();
				const device = bound.get(secret) ?? (await testDevice());
				bound.set(secret, device);
				return json({ id: device.id });
			}
			const device = [...bound.values()].find(({ id }) => id === url.searchParams.get("device"));
			if (url.pathname === "/dial" && device !== undefined) {
				const link = randomBytes(8).toString("hex");
				links.set(link, await device.dial(asked.toString()));
				return json({ link });
			}
			const connection = links.get(url.searchParams.get("link") ?? "");
			if (url.pathname === "/close" && connection !== undefined) {
				connection.close(0n, []);
				return json({});
			}
			if (url.pathname === "/open" && connection !== undefined) {
				// a connection that has gone fails here, before anything is written
				const socket = streamSocket(await connection.openBi());
				const id = randomBytes(8).toString("hex");
				streams.set(id, socket);
				return json({ stream: id });
			}
			if (url.pathname === "/send") {
				const socket = streams.get(url.searchParams.get("stream") ?? "");
				if (socket === undefined) return void res.writeHead(404).end();
				streams.delete(url.searchParams.get("stream") ?? "");
				res.writeHead(200, { "content-type": "application/octet-stream" });
				socket.pipe(res);
				socket.on("error", () => res.destroy());
				res.on("close", () => socket.destroy());
				return void socket.end(asked);
			}
			res.writeHead(502).end();
		})().catch((error: unknown) => {
			if (!res.headersSent) res.writeHead(502);
			res.end(String(error));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	/** The module that stands where the WebAssembly one would be: the same names, each call made of the bridge. */
	const module = `
		const bridge = ${JSON.stringify(origin)};
		const ask = async (path, body) => {
			const response = await fetch(bridge + path, { method: "POST", body });
			if (!response.ok) throw new Error(await response.text());
			return response;
		};
		const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
		export default async function init() {}
		export const computer = (ticket) => {
			if (!ticket.startsWith("endpoint")) throw new Error("not a ticket");
			return ${JSON.stringify(daemon)};
		};
		export const Device = {
			create: async (secret) => {
				const made = await (await ask("/bind", hex(secret))).json();
				return {
					id: () => made.id,
					dial: async (ticket) => {
						const { link } = await (await ask("/dial?device=" + made.id, ticket)).json();
						return {
							open: async () => {
								const { stream } = await (await ask("/open?link=" + link, "")).json();
								return { send: async (request) => (await ask("/send?stream=" + stream, request)).body };
							},
							close: () => void ask("/close?link=" + link, "").catch(() => {}),
						};
					},
					close: async () => {},
				};
			},
		};`;
	return {
		module,
		close: async () => {
			server.closeAllConnections();
			server.close();
			for (const device of bound.values()) await device.close().catch(() => undefined);
		},
	};
}

for (const width of [390, 1280])
	it.skipIf(!hasChrome())(
		`a browser pairs from a link, is the same device after a reload, and is sent back to pairing once revoked at ${width}px`,
		async () => {
			const home = await tempHome();
			if (SHOTS !== undefined) await mkdir(SHOTS, { recursive: true });
			await writeFile(join(home, "config.json"), JSON.stringify({ model: { provider: "faux", modelId: "faux-1" } }));
			const daemon = await startDaemon({
				home,
				port: 0,
				models: echoModels().models,
				log: () => {},
				box: hostBox(home),
				remote: { reach: "loopback" },
			});
			const token = (await readDaemonFile(home))!.token!;
			await skipShippedSkills(daemon.port, token);
			const owner = async <T>(path: string, method = "GET", body?: object): Promise<T> => {
				const response = await fetch(`http://127.0.0.1:${daemon.port}/api${path}`, {
					method,
					headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				});
				if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
				return response.json() as Promise<T>;
			};
			// the invite binds the daemon's endpoint; its id is what the phone's screen shows for this computer
			const invite = await owner<InviteView>("/devices/invites", "POST");
			const computer = (await owner<DevicesView>("/devices")).endpoint!.id;
			const endpoint = await bridge(computer);
			const server = await webServer({
				define: { __BANDA_HOSTED__: "true" },
				plugins: [
					{
						name: "bridged-endpoint",
						enforce: "pre",
						// the build's own stand-in for a build that is no device, or the module itself: both are this one here
						resolveId: (id) => (/(no-endpoint\.ts|banda_iroh_web\.js)$/.test(id) ? "\0bridged-endpoint" : undefined),
						load: (id) => (id === "\0bridged-endpoint" ? endpoint.module : undefined),
					},
				],
			});
			const text = "document.body.innerText";
			const button = (label: string) =>
				`[...document.querySelectorAll('button')].find((el) => el.getClientRects().length > 0 && el.textContent.trim() === ${JSON.stringify(label)})`;
			const shoot = async (page: { shoot(file: string): Promise<void> }, name: string) => {
				if (SHOTS !== undefined) await page.shoot(join(SHOTS, `hosted-${width}-${name}.png`));
			};
			try {
				// the link the desktop's code carries for a browser, opened here on the test's origin
				const link = `${server.origin}/${new URL(invite.browser).hash}`;
				await withPage(link, { width, height: 844 }, async (page) => {
					await page.until(button("Pair with this code"));
					// the invite is out of the address as soon as it is read, and no token is kept: the device is the key
					expect(await page.run("location.hash")).toBe("");
					expect(await page.run("Object.keys(localStorage).length")).toBe(0);
					expect(await page.run<string>(text)).toContain("You opened a pairing code");
					await shoot(page, "1-code");

					await page.click(button("Pair with this code"));
					await page.until(button("The codes match · Pair"));
					expect(await page.run<string>(text)).toContain(fingerprint(computer));
					await shoot(page, "2-computer");
					// nothing was asked of the daemon yet: the owner compares first
					expect((await owner<DevicesView>("/devices")).requests).toEqual([]);

					await page.click(button("The codes match · Pair"));
					await page.until(`${text}.includes('Waiting for approval')`);
					const [request] = (await owner<DevicesView>("/devices")).requests;
					expect(request).toBeDefined();
					expect(await page.run<string>(text)).toContain(fingerprint(request!.id));
					await shoot(page, "3-waiting");

					// the browser drops the page while its owner walks to the computer (a phone does, to a tab left behind):
					// opened again it is the same device and still has the code, which is out of the address all the same
					await page.reload();
					await page.until(button("Pair with this code"));
					expect(await page.run("location.hash")).toBe("");
					await page.click(button("Pair with this code"));
					await page.until(button("The codes match · Pair"));
					await page.click(button("The codes match · Pair"));
					await page.until(`${text}.includes('Waiting for approval')`);
					expect((await owner<DevicesView>("/devices")).requests.map(({ id }) => id)).toEqual([request!.id]);

					await owner(`/devices/requests/${request!.id}/approve`, "POST", { name: "A browser" });
					await page.until(`${text}.includes('Sancho') && !${text}.includes('Waiting for')`);
					await shoot(page, "4-app");
					const paired = (await owner<DevicesView>("/devices")).devices;
					expect(paired).toEqual([expect.objectContaining({ id: request!.id, name: "A browser", connected: true })]);

					// what the browser keeps: the device's key and the daemon that approved it; the code it paired with is gone
					const kept = await page.run<{ key: number; ticket: boolean; code: string | null }>(
						`new Promise((resolve) => { const open = indexedDB.open("banda"); open.onsuccess = () => { const asked = open.result.transaction("device").objectStore("device").get("kept"); asked.onsuccess = () => resolve({ key: asked.result.key.byteLength, ticket: asked.result.ticket === ${JSON.stringify(invite.ticket)}, code: sessionStorage.getItem("banda.pairing") }); }; })`,
					);
					expect(kept).toEqual({ key: 32, ticket: true, code: null });

					// the app works as on a phone: a message goes up and its answer streams back
					if (width >= 768) {
						await page.until("document.querySelector('textarea') !== null");
						await page.run("document.querySelector('textarea').focus()");
						await page.input("Input.insertText", { text: "hello from a browser" });
						await page.input("Input.dispatchKeyEvent", {
							type: "keyDown",
							key: "Enter",
							code: "Enter",
							windowsVirtualKeyCode: 13,
						});
						await page.input("Input.dispatchKeyEvent", {
							type: "keyUp",
							key: "Enter",
							code: "Enter",
							windowsVirtualKeyCode: 13,
						});
						await page.until(`${text}.includes('re: hello from a browser')`);
						await shoot(page, "5-chat");
					}

					// opened again, it is the device it was: no code, no request, the same endpoint
					await page.reload();
					await page.until(`${text}.includes('Sancho') && !${text}.includes('Reaching your computer')`);
					expect(await page.run<string>(text)).not.toContain("Pair this phone");
					expect((await owner<DevicesView>("/devices")).devices.map(({ id }) => id)).toEqual([request!.id]);
					expect((await owner<DevicesView>("/devices")).requests).toEqual([]);

					// revoked on the computer: the daemon says so, the browser forgets its key, and pairing starts over
					await owner(`/devices/${request!.id}/revoke`, "POST");
					await page.until(`${text}.includes('Pair this phone with banda')`, 40_000);
					expect(await page.run<string>(text)).toContain(NOTES.revoked);
					await shoot(page, "6-revoked");
					expect(
						await page.run(
							`new Promise((resolve) => { const open = indexedDB.open("banda"); open.onsuccess = () => { const asked = open.result.transaction("device").objectStore("device").get("kept"); asked.onsuccess = () => resolve(asked.result?.ticket ?? null); }; })`,
						),
					).toBeNull();
					expect(page.errors()).toEqual([]);
				});
			} finally {
				await server.close();
				await endpoint.close();
				await daemon.close();
			}
		},
		120_000,
	);
