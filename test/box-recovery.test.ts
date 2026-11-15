import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openBox } from "../src/box/box.ts";
import { guardedProxy, type ProxyTransport } from "../src/box/guarded-proxy.ts";
import type { HeldRequest } from "../src/core/egress.ts";
import { context } from "../src/core/store.ts";
import { hostBox } from "./fixtures/host-box.ts";
import { tempHome } from "./helpers.ts";

it("gives separate computers separate filesystem namespaces while views of one computer share one", async () => {
	const first = openBox({ ...hostBox(await tempHome()), kind: "microvm" }, () => {});
	const second = openBox({ ...hostBox(await tempHome()), kind: "microvm" }, () => {});
	try {
		expect(first.env().id).toBe(first.env("/workspace/other").id);
		expect(first.env().id).not.toBe(second.env().id);
	} finally {
		await first.close();
		await second.close();
	}
});

it("reports failed egress preparation as offline and not sent, preserving uncertainty after execution starts", async () => {
	const home = await tempHome();
	const setup = hostBox(home);
	let available = false;
	let attempts = 0;
	let interrupted = false;
	const transport: ProxyTransport = {
		exec: async () => {
			attempts++;
			if (interrupted) throw new Error("connection lost after start");
			return JSON.stringify({ status: 201, reason: "Created", headers: [], body: "" });
		},
		running: async () => true,
		halt: async () => {},
	};
	const proxy = guardedProxy({ home, endpoint: "127.0.0.1:80", transport });
	const box = openBox(
		{
			...setup,
			kind: "microvm",
			egress: proxy.egress,
			ensure: async () => {
				if (!available) throw new Error("computer offline");
				await setup.ensure();
			},
		},
		() => {},
	);
	const request: HeldRequest = {
		ticket: "t1",
		chat: 7,
		at: 1,
		method: "POST",
		scheme: "https",
		host: "example.com",
		port: 443,
		path: "/send",
		headers: [],
		body: "",
	};
	try {
		const egress = box.egress;
		if (egress === undefined) throw new Error("missing guarded egress");
		expect(await egress.replay(request, context)).toEqual({ failed: "computer offline", reached: false });
		expect(attempts).toBe(0);
		expect(box.state()).toMatchObject({ state: "offline" });
		available = true;
		expect(await egress.replay(request, context)).toMatchObject({ status: 201 });
		expect(attempts).toBe(1);
		expect(box.state()).toEqual({ state: "up" });
		interrupted = true;
		await expect(egress.replay(request, context)).rejects.toThrow("connection lost after start");
		expect(attempts).toBe(2);
	} finally {
		await box.close();
	}
});

it("repairs native dependencies before using an existing command connection and never replays a command", async () => {
	const home = await tempHome();
	const setup = hostBox(home);
	let available = true;
	let preparations = 0;
	const box = openBox(
		{
			...setup,
			kind: "microvm",
			ensure: async () => {
				preparations++;
				if (!available) throw new Error("network guard unavailable");
				await setup.ensure();
			},
		},
		() => {},
	);
	try {
		const env = box.env();
		expect(await env.exec("printf first >> effects", undefined, context)).toMatchObject({
			ok: true,
			value: { exitCode: 0 },
		});
		const prepared = preparations;
		available = false;
		await expect(env.exec("printf missed >> effects", undefined, context)).rejects.toThrow("network guard unavailable");
		expect(box.state()).toMatchObject({ state: "offline" });
		expect(await readFile(join(home, "workspace/effects"), "utf8")).toBe("first");
		available = true;
		expect(await env.exec("printf failed >> effects; exit 3", undefined, context)).toMatchObject({
			ok: true,
			value: { exitCode: 3 },
		});
		expect(await readFile(join(home, "workspace/effects"), "utf8")).toBe("firstfailed");
		expect(preparations).toBe(prepared + 2);
		expect(box.state()).toEqual({ state: "up" });
	} finally {
		await box.close();
	}
});

it("starts no waiting command when the computer closes during recovery", async () => {
	const home = await tempHome();
	const setup = hostBox(home);
	let repairing = false;
	let acquired = () => {};
	const acquiring = new Promise<void>((resolve) => {
		acquired = resolve;
	});
	let release = () => {};
	const recovery = new Promise<void>((resolve) => {
		release = resolve;
	});
	const box = openBox(
		{
			...setup,
			kind: "microvm",
			ensure: async () => {
				if (repairing) {
					acquired();
					await recovery;
				}
				await setup.ensure();
			},
		},
		() => {},
	);
	try {
		const env = box.env();
		expect(await env.exec("printf kept > effects", undefined, context)).toMatchObject({
			ok: true,
			value: { exitCode: 0 },
		});
		repairing = true;
		const waiting = Promise.allSettled([
			env.exec("printf first >> effects", undefined, context),
			env.exec("printf second >> effects", undefined, context),
		]);
		try {
			await acquiring;
			expect(await readFile(join(home, "workspace/effects"), "utf8")).toBe("kept");
			const closing = box.close();
			release();
			await closing;
			expect(await waiting).toEqual([
				{ status: "rejected", reason: expect.objectContaining({ message: "The computer is closed" }) },
				{ status: "rejected", reason: expect.objectContaining({ message: "The computer is closed" }) },
			]);
			expect(await readFile(join(home, "workspace/effects"), "utf8")).toBe("kept");
		} finally {
			release();
			await waiting;
		}
	} finally {
		release();
		await box.close();
	}
});

it("only a native computer is repaired before an effect on something already open", async () => {
	const native = openBox({ ...hostBox(await tempHome()), kind: "microvm" }, () => {});
	const container = openBox({ ...hostBox(await tempHome()), kind: "container" }, () => {});
	try {
		expect(native.recover).toBeDefined();
		expect(container.recover).toBeUndefined();
	} finally {
		await native.close();
		await container.close();
	}
});

/** A native computer whose bring-ups are counted and held, and which says whether it is intact as the test sets it. */
async function repairable() {
	const setup = hostBox(await tempHome());
	const computer = { intact: undefined as boolean | undefined, asked: 0, preparations: 0, failing: false };
	let release = () => {};
	let held: Promise<void> | undefined;
	const box = openBox(
		{
			...setup,
			kind: "microvm",
			ensure: async () => {
				computer.preparations++;
				await held;
				if (computer.failing) throw new Error("network guard unavailable");
				await setup.ensure();
			},
			intact: () => {
				computer.asked++;
				if (computer.intact === undefined) throw new Error("not asked in this test");
				return computer.intact;
			},
		},
		() => {},
	);
	const recover = () => {
		if (box.recover === undefined) throw new Error("a native computer is repaired");
		return box.recover();
	};
	return {
		box,
		computer,
		recover,
		hold: () => {
			held = new Promise<void>((resolve) => {
				release = resolve;
			});
		},
		release: () => {
			held = undefined;
			release();
		},
	};
}

it("a computer that is up and intact is not brought up again before an effect, and is asked every time", async () => {
	const { box, computer, recover } = await repairable();
	try {
		computer.intact = true;
		// never brought up: what it says of itself is not asked
		await recover();
		expect(computer.preparations).toBe(1);
		expect(computer.asked).toBe(0);
		expect(box.state()).toEqual({ state: "up" });
		await recover();
		await recover();
		await Promise.all([recover(), recover(), recover()]);
		expect(computer.preparations).toBe(1);
		expect(computer.asked).toBe(5);
	} finally {
		await box.close();
	}
});

it("a computer that is not intact is brought up whole, once for the effects that wait together", async () => {
	const { box, computer, recover, hold, release } = await repairable();
	try {
		computer.intact = false;
		await recover();
		expect(computer.preparations).toBe(1);
		expect(box.state()).toEqual({ state: "up" });
		// the answer of a moment ago is never reused: each effect asks, and each that hears no brings it up
		await recover();
		expect(computer.preparations).toBe(2);
		hold();
		const waiting = [recover(), recover(), recover()];
		expect(computer.preparations).toBe(3);
		release();
		await Promise.all(waiting);
		expect(computer.preparations).toBe(3);
		computer.intact = true;
		await recover();
		expect(computer.preparations).toBe(3);
		expect(box.state()).toEqual({ state: "up" });
	} finally {
		release();
		await box.close();
	}
});

it("an effect that finds the computer not intact fails with its bring-up, and the next one tries again", async () => {
	const { box, computer, recover } = await repairable();
	try {
		computer.intact = false;
		computer.failing = true;
		await expect(recover()).rejects.toThrow("network guard unavailable");
		expect(box.state()).toMatchObject({ state: "offline" });
		// offline as its last bring-up went: brought up again whatever it says of itself
		computer.intact = true;
		const asked = computer.asked;
		await expect(recover()).rejects.toThrow("network guard unavailable");
		expect(computer.asked).toBe(asked);
		computer.failing = false;
		await recover();
		expect(computer.preparations).toBe(3);
		expect(box.state()).toEqual({ state: "up" });
		await recover();
		expect(computer.preparations).toBe(3);
	} finally {
		await box.close();
	}
});

it("an effect that comes while the computer is brought up for another waits only if it is not intact", async () => {
	const { box, computer, recover, hold, release } = await repairable();
	try {
		await box.ensure();
		computer.intact = false;
		hold();
		const first = recover();
		let second = false;
		const waiting = recover().then(() => {
			second = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(second).toBe(false);
		// intact while the rest of the bring-up goes on (the command VM's part): nothing to wait for
		computer.intact = true;
		await recover();
		expect(computer.preparations).toBe(2);
		release();
		await Promise.all([first, waiting]);
		expect(computer.preparations).toBe(2);
	} finally {
		release();
		await box.close();
	}
});

it("a closed computer is never taken for intact", async () => {
	const { box, computer, recover } = await repairable();
	computer.intact = true;
	await recover();
	await recover();
	expect(computer.asked).toBe(1);
	await box.close();
	await expect(recover()).rejects.toThrow("The computer is closed");
	expect(computer.asked).toBe(1);
	expect(computer.preparations).toBe(1);
});

it("a native computer that cannot say whether it is intact is brought up before every effect", async () => {
	const setup = hostBox(await tempHome());
	let preparations = 0;
	const box = openBox(
		{
			...setup,
			kind: "microvm",
			ensure: async () => {
				preparations++;
				await setup.ensure();
			},
		},
		() => {},
	);
	try {
		await box.recover?.();
		await box.recover?.();
		expect(preparations).toBe(2);
	} finally {
		await box.close();
	}
});
