import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { failurePage, trouble } from "../desktop/src/trouble.ts";
import { FORMAT_FLOOR, HOME_FORMAT, NewerHome, OldHome } from "../src/core/format.ts";
import { openStore } from "../src/core/store.ts";

const at = { home: "/Users/o/.banda", port: 7787, log: "/Users/o/.banda/daemon.log" };

describe("what the desktop app says when the daemon can't start", () => {
	// the store's own refusal, so rewording it breaks this test rather than the app's advice
	const refusal = async (format: number) => {
		const home = await mkdtemp(join(tmpdir(), "banda-trouble-"));
		await writeFile(join(home, "format"), `${format}\n`);
		const refused = await openStore(home, {} as Parameters<typeof openStore>[1]).then(
			() => undefined,
			(error: unknown) => error,
		);
		await rm(home, { recursive: true, force: true });
		return refused;
	};

	it("tells a home from before the first release apart, by the words the store refuses it with", async () => {
		const refused = await refusal(FORMAT_FLOOR - 1);
		expect(refused).toBeInstanceOf(OldHome);
		const shown = trouble(`banda failed: ${(refused as Error).message}`, at);
		expect(shown.title).toBe("This version can't open your home");
		expect(shown.fix).toContain(at.home);
	});

	it("tells a home a newer version opened apart, and asks for that version, not a fresh home", async () => {
		const refused = await refusal(HOME_FORMAT + 1);
		expect(refused).toBeInstanceOf(NewerHome);
		const shown = trouble(`banda failed: ${(refused as Error).message}`, at);
		expect(shown.title).toBe("Your home needs a newer version");
		expect(shown.fix).toBe("Quit and install the latest version of banda.");
	});

	it("names a taken port, and points a generic failure at its log", () => {
		expect(trouble("Error: listen EADDRINUSE: address already in use 127.0.0.1:7787", at).title).toBe(
			"Port 7787 is taken",
		);
		const generic = trouble("something else\nentirely", at);
		expect(generic.title).toBe("banda didn't start");
		expect(generic.fix).toContain(at.log);
		expect(generic.details).toBe("something else\nentirely");
	});

	it("draws a page that runs nothing and escapes what the daemon said", () => {
		const page = failurePage({ title: "t", said: "s", fix: "f", details: "<script>alert(1)</script>" });
		expect(page).toContain("default-src 'none'");
		expect(page).not.toContain("<script>");
		expect(page).toContain("&lt;script&gt;");
	});
});
