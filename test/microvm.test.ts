import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openBox } from "../src/box/box.ts";
import { launchMicrovm, microvmBox } from "../src/box/microvm.ts";
import * as assets from "../src/box/microvm-assets.ts";
import { context } from "../src/core/store.ts";

const kvmAccess = vi.hoisted(() => vi.fn<(mode?: number) => Promise<void>>());
vi.mock("node:fs/promises", async (original) => {
	const files = await original<typeof import("node:fs/promises")>();
	return {
		...files,
		access: (path: Parameters<typeof files.access>[0], mode?: number) =>
			path === "/dev/kvm" ? kvmAccess(mode) : files.access(path, mode),
	};
});

const platform = Object.getOwnPropertyDescriptor(process, "platform");
const homes: string[] = [];
beforeEach(() => {
	Object.defineProperty(process, "platform", { value: "linux" });
	kvmAccess.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	if (platform !== undefined) Object.defineProperty(process, "platform", platform);
	for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function home() {
	const path = await mkdtemp(join(tmpdir(), "banda-microvm-unit-"));
	homes.push(path);
	return path;
}

describe("the guarded microVM backend", () => {
	it("keeps a missing bundled runtime offline without opening host execution", async () => {
		const root = await home();
		const bundle = vi
			.spyOn(assets, "installedMicrovmAssets")
			.mockRejectedValue(new Error("The bundled computer is missing."));
		const setup = microvmBox(root);
		const box = openBox(setup, () => {});
		try {
			expect(setup.egress?.env(7).https_proxy).toMatch(/^http:\/\/c7:[a-f0-9]+@127\.0\.0\.1:80$/);
			await expect(box.ensure()).rejects.toThrow("The bundled computer is missing.");
			expect(kvmAccess).toHaveBeenCalledExactlyOnceWith(constants.R_OK | constants.W_OK);
			expect(bundle).toHaveBeenCalledExactlyOnceWith();
			expect(box.state()).toMatchObject({ state: "offline" });
			expect(box.kind).toBe("microvm");
			await expect(access(join(root, "computer"))).rejects.toMatchObject({ code: "ENOENT" });
			expect((await readFile(join(root, "auth/egress.key"), "utf8")).trim()).toMatch(/^[a-f0-9]{64}$/);
		} finally {
			await box.close();
		}
	});

	it("keeps unavailable KVM offline before loading a bundle or opening host execution", async () => {
		const root = await home();
		kvmAccess.mockRejectedValue(new Error("KVM is unavailable in this fixture."));
		const bundle = vi.spyOn(assets, "installedMicrovmAssets").mockRejectedValue(new Error("Unexpected bundle access."));
		const box = openBox(microvmBox(root), () => {});
		try {
			await expect(box.ensure()).rejects.toThrow("The computer needs access to /dev/kvm.");
			expect(kvmAccess).toHaveBeenCalledExactlyOnceWith(constants.R_OK | constants.W_OK);
			expect(box.state()).toMatchObject({ state: "offline", why: expect.stringContaining("/dev/kvm") });
			expect(box.kind).toBe("microvm");
			await expect(box.env(root).exec("printf host-execution > host-fallback", undefined, context)).rejects.toThrow(
				"The computer needs access to /dev/kvm.",
			);
			expect(bundle).not.toHaveBeenCalled();
			await expect(access(join(root, "host-fallback"))).rejects.toMatchObject({ code: "ENOENT" });
			await expect(access(join(root, "computer"))).rejects.toMatchObject({ code: "ENOENT" });
		} finally {
			await box.close();
		}
	});

	it("closing before first use prevents later startup and does not need a bundle", async () => {
		const root = await home();
		const setup = microvmBox(root);
		await setup.close?.();
		await setup.close?.();
		await expect(setup.ensure()).rejects.toThrow("This computer is closed");
		await expect(access(join(root, "computer"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects a launch naming arbitrary runtime paths before looking for assets", async () => {
		await expect(launchMicrovm(["env", "/not-a-home", "../../another-process"])).rejects.toThrow(
			"Invalid computer command identifiers",
		);
	});
});
