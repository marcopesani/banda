import { createServer, type ServerResponse } from "node:http";
import { expect, it } from "vitest";
import { until } from "./helpers.ts";
import { hasChrome, withPage } from "./smoke/chrome.ts";

it.skipIf(!hasChrome())("reload waits for the replacement main document and its resources", async () => {
	const documents: ServerResponse[] = [];
	const images: ServerResponse[] = [];
	const server = createServer((request, response) => {
		if (request.url === "/") {
			documents.push(response);
			if (documents.length === 1)
				response
					.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
					.end("<body>old document</body>");
		} else if (request.url === "/held-image") images.push(response);
		else if (request.url === "/frame")
			response.writeHead(200, { "content-type": "text/html" }).end("<body>frame loaded</body>");
		else response.writeHead(204).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error("HTTP fixture did not bind a port");
		await withPage(`http://127.0.0.1:${address.port}`, { width: 1440, height: 900 }, async (page) => {
			let outcome: PromiseSettledResult<void> | undefined;
			const reload = page.reload().then(
				() => {
					outcome = { status: "fulfilled", value: undefined };
				},
				(reason: unknown) => {
					outcome = { status: "rejected", reason };
				},
			);
			await until(() => documents.length === 2);
			await page.input("Browser.getVersion", {});
			expect(outcome).toBeUndefined();
			const incoming = documents[1];
			if (incoming === undefined) throw new Error("reload did not request its document");
			incoming
				.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" })
				.end('<body>new document<iframe src="/frame"></iframe><img src="/held-image"></body>');
			await until(() => images.length === 1);
			await page.until("document.querySelector('iframe')?.contentDocument?.body?.innerText === 'frame loaded'");
			await page.input("Browser.getVersion", {});
			expect(outcome).toBeUndefined();
			const image = images[0];
			if (image === undefined) throw new Error("reload did not request its image");
			image.writeHead(200, { "content-type": "image/svg+xml" }).end('<svg xmlns="http://www.w3.org/2000/svg"/>');
			await reload;
			expect(outcome).toEqual({ status: "fulfilled", value: undefined });
			expect(await page.run("document.readyState")).toBe("complete");
			expect(await page.run("document.body.innerText")).toBe("new document");
			await expect(page.run("throw new Error('evaluation must fail')")).rejects.toThrow("evaluation must fail");
			expect(page.errors()).toEqual([]);
		});
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error === undefined ? resolve() : reject(error))),
		);
	}
});
