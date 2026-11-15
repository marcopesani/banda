import { createServer } from "node:http";
import { expect, it } from "vitest";
import { linuxDesktopPageExpression, parseLinuxDesktopPage } from "../scripts/diagnose-linux-desktop.ts";
import { hasChrome, openChrome } from "./smoke/chrome.ts";

it.skipIf(!hasChrome())(
	"observes a loading document before its body arrives, then first run at both widths",
	async () => {
		const chrome = await openChrome();
		let finish = () => {};
		const server = createServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html" });
			response.write("<!doctype html><html><head><title>Loading</title>");
			finish = () => response.end("</head><body><h1>Sancho</h1>Pick the model I think with</body></html>");
		});
		try {
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing HTTP listener.");
			const url = `http://127.0.0.1:${address.port}/`;
			const { targetId } = await chrome.cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
			const { sessionId } = await chrome.cdp.send<{ sessionId: string }>("Target.attachToTarget", {
				targetId,
				flatten: true,
			});
			await chrome.cdp.send("Page.navigate", { url }, sessionId);
			const evaluate = (expression: string) =>
				chrome.cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
			expect(await evaluate("({ loading: document.readyState === 'loading', body: document.body })")).toMatchObject({
				result: { value: { loading: true, body: null } },
			});
			expect(parseLinuxDesktopPage(await evaluate(linuxDesktopPageExpression))).toMatchObject({
				origin: url.slice(0, -1),
				heading: "",
				firstRun: false,
			});
			finish();
			await chrome.cdp.send(
				"Runtime.evaluate",
				{
					expression:
						"new Promise(resolve => { if (document.readyState === 'complete') resolve(); else addEventListener('load', () => resolve(), { once: true }); })",
					awaitPromise: true,
				},
				sessionId,
			);
			for (const width of [1440, 390]) {
				await chrome.cdp.send(
					"Emulation.setDeviceMetricsOverride",
					{ width, height: 900, deviceScaleFactor: 1, mobile: false },
					sessionId,
				);
				expect(parseLinuxDesktopPage(await evaluate(linuxDesktopPageExpression))).toMatchObject({
					width,
					height: 900,
					heading: "Sancho",
					firstRun: true,
				});
			}
			const malformed = await evaluate(`({ ...${linuxDesktopPageExpression}, width: "wide" })`);
			expect(() => parseLinuxDesktopPage(malformed)).toThrow(/Invalid Runtime.evaluate page:.*\/width/);
			const exception = await evaluate("(() => { throw new Error('diagnostic page failure'); })()");
			expect(() => parseLinuxDesktopPage(exception)).toThrow(/Runtime.evaluate.*diagnostic page failure/s);
		} finally {
			finish();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await chrome.stop();
		}
	},
);
