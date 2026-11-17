/**
 * A remote connection's sign-in lasting past its access token, whatever the server (DESIGN.md "Connections"): against
 * fake MCP servers on loopback that differ in what their authorization server says and when it gives a refresh token.
 * banda asks for `offline_access` only where the authorization server lists it, beside the resource's own scopes; it
 * keeps rotated refresh tokens, never sends a spent one, and says plainly when a sign-in ran out with nothing to renew it.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { connectionDefinition, define, signInAsOwner } from "./fixtures/connected.ts";
import { closeAll, fakes, open } from "./fixtures/connections-world.ts";
import { type FakeMcp, startFakeMcp } from "./fixtures/mcp-server.ts";

afterEach(closeAll);

type Opened = Awaited<ReturnType<typeof open>>;
type Stored = {
	readonly server: { readonly scopes?: readonly string[]; readonly offline?: true };
	readonly tokens: { readonly access: string; readonly refresh?: string; readonly expires?: number };
};

/** A connection that names no scopes, as one the owner adds by its address: its sign-in asks what the server says. */
const fileOf = (fake: FakeMcp, scopes?: readonly string[]) =>
	connectionDefinition({
		url: fake.url,
		auth: "oauth",
		account: "get_me.login",
		reads: ["list_events"],
		...(scopes === undefined ? {} : { scopes }),
	});

async function signedIn(options: Parameters<typeof startFakeMcp>[0], scopes?: readonly string[]) {
	const fake = await startFakeMcp({ auth: "oauth", ...options });
	fakes.push(fake);
	const s = await open(fake);
	await define(s, "cal", fileOf(fake, scopes));
	expect(await signInAsOwner(s.capabilities, "cal")).toMatchObject({ ok: true });
	return { fake, s };
}

/** The one account's sign-in as kept in this test's own temporary home. */
function stored(s: Opened, name = "cal"): Stored {
	const dir = join(s.home, "auth", "connections", name);
	const [account] = readdirSync(dir);
	return (JSON.parse(readFileSync(join(dir, account as string, "credentials.json"), "utf8")) as { oauth: Stored })
		.oauth;
}

/** The model reads `tool` once; its result. */
async function read(s: Opened, tool = "cal__list_events") {
	s.model.plan([{ tool, args: { day: "mon" } }]);
	const ran = await s.say("what is on monday");
	await s.done(ran.turn);
	const result = (await s.results(ran.chat)).at(-1);
	if (result === undefined) throw new Error("no tool result");
	return result;
}

const shownAccount = async (s: Opened, name = "cal") =>
	(await s.capabilities.view()).connections.find((c) => c.name === name)?.accounts?.[0];

describe("a sign-in asks for a refresh token as its server allows", () => {
	const servers: readonly {
		readonly server: string;
		readonly options: Parameters<typeof startFakeMcp>[0];
		/** The `scope` the sign-in sent, "" for none. */
		readonly asked: string;
		readonly renews: boolean;
	}[] = [
		{
			// as Vercel's is published: the resource wants openid, its authorization server lists offline_access
			server: "lists offline_access and renews only a sign-in that asked for it",
			options: { scopes: ["openid"], authScopes: ["openid", "email", "offline_access"], refreshes: "offline" },
			asked: "openid offline_access",
			renews: true,
		},
		{
			server: "renews without being asked, saying nothing of its scopes",
			options: { refreshes: "always" },
			asked: "calendar",
			renews: true,
		},
		{
			server: "renews without being asked, listing scopes without offline_access",
			options: { authScopes: ["calendar", "profile"], refreshes: "always" },
			asked: "calendar",
			renews: true,
		},
		{
			server: "would renew only with offline_access, but does not say it takes it",
			options: { refreshes: "offline" },
			asked: "calendar",
			renews: false,
		},
		{
			server: "lists offline_access and gives no refresh token anyway",
			options: { authScopes: ["offline_access"], refreshes: "never" },
			asked: "calendar offline_access",
			renews: false,
		},
		{
			server: "names no scopes for its resource and renews unasked: no scope is sent, so its default grant stands",
			options: { scopes: [], authScopes: ["offline_access"], refreshes: "always" },
			asked: "",
			renews: true,
		},
		{
			// RFC 6749 §3.3 applies the server's default only when scope is left out: offline_access alone could narrow it to
			// nothing of the resource's, so it is not sent, and a server that renews only with it gives no refresh token
			server: "names no scopes anywhere and renews only with offline_access: none is asked, so none is given",
			options: { scopes: [], authScopes: ["offline_access"], refreshes: "offline" },
			asked: "",
			renews: false,
		},
		{
			server: "serves no resource metadata and names no scope anywhere: none is asked, so none is given",
			options: { resourceMetadata: false, authScopes: ["offline_access"], refreshes: "offline" },
			asked: "",
			renews: false,
		},
		{
			// banda reads no 401 scope: the challenged one alone could narrow the default grant, with no step-up to widen it
			server: "lists no scopes but challenges with one: no scope is asked, so its default grant stands",
			options: { scopes: [], challengeScope: "calendar", authScopes: ["offline_access"], refreshes: "always" },
			asked: "",
			renews: true,
		},
		{
			server: "serves no resource metadata but challenges with a scope: none is asked, so none is given",
			options: {
				resourceMetadata: false,
				challengeScope: "calendar",
				authScopes: ["offline_access"],
				refreshes: "offline",
			},
			asked: "",
			renews: false,
		},
		{
			server: "names offline_access among its own scopes: asked once, beside them, and never an account's scope",
			options: { scopes: ["calendar", "offline_access"], refreshes: "offline" },
			asked: "calendar offline_access",
			renews: true,
		},
	];
	for (const { server, options, asked, renews } of servers)
		it(`a server that ${server}`, async () => {
			const { fake, s } = await signedIn(options);
			expect(fake.scopesAsked).toEqual([asked]);
			const kept = stored(s);
			// what the account is checked against stays the resource's: offline_access asks for no access to it
			expect(kept.server.scopes ?? []).not.toContain("offline_access");
			expect(kept.tokens.refresh !== undefined).toBe(renews);
			expect(await shownAccount(s)).not.toHaveProperty("stale");
			// the server lets every access token go
			fake.tokens.clear();
			const result = await read(s);
			expect(result.error).toBe(!renews);
			expect(fake.refreshed).toHaveLength(renews ? 1 : 0);
			if (renews) expect(fake.calls).toEqual([{ tool: "list_events", args: { day: "mon" } }]);
			else expect(result.text).toContain("Calendar is not signed in");
		});

	it("a file that names scopes asks for offline_access beside them, and its account still fits it", async () => {
		const { fake, s } = await signedIn({ authScopes: ["calendar", "offline_access"], refreshes: "offline" }, [
			"calendar",
		]);
		expect(fake.scopesAsked).toEqual(["calendar offline_access"]);
		expect(stored(s).server.scopes).toEqual(["calendar"]);
		expect(await shownAccount(s)).toMatchObject({ scopes: ["calendar", "offline_access"] });
		expect(await shownAccount(s)).not.toHaveProperty("stale");
		fake.tokens.clear();
		expect((await read(s)).error).toBe(false);
		expect(fake.refreshed).toHaveLength(1);
	});

	it("an account an earlier build kept with offline_access among its scopes still fits and renews", async () => {
		const { fake, s } = await signedIn({ scopes: ["calendar", "offline_access"], refreshes: "offline" });
		expect(stored(s).server.scopes).toEqual(["calendar"]);
		// as a build before offline_access was told apart wrote it: one of the account's scopes, no `offline`
		const dir = join(s.home, "auth", "connections", "cal");
		const [account] = readdirSync(dir);
		const file = join(dir, account as string, "credentials.json");
		const kept = JSON.parse(readFileSync(file, "utf8")) as { oauth: { server: Record<string, unknown> } };
		const { offline: _, ...server } = kept.oauth.server;
		kept.oauth.server = { ...server, scopes: ["calendar", "offline_access"] };
		writeFileSync(file, JSON.stringify(kept), { mode: 0o600 });
		expect(await shownAccount(s)).not.toHaveProperty("stale");
		fake.tokens.clear();
		expect((await read(s)).error).toBe(false);
		expect(fake.refreshed).toHaveLength(1);
	});

	it("a server that never renews: an account with time left fits, is used and is not refreshed", async () => {
		const { fake, s } = await signedIn({ refreshes: "never" });
		expect(stored(s).server).not.toHaveProperty("offline");
		expect(await shownAccount(s)).not.toHaveProperty("stale");
		expect((await read(s)).error).toBe(false);
		expect(fake.refreshed).toHaveLength(0);
	});
});

describe("a refresh token", () => {
	it("rotated, is kept in place of the one spent, which the server no longer takes", async () => {
		const { fake, s } = await signedIn({ refreshes: "always" });
		const before = stored(s).tokens;
		fake.tokens.clear();
		expect((await read(s)).error).toBe(false);
		const after = stored(s).tokens;
		expect(after.refresh).toBeDefined();
		expect(after.refresh === before.refresh).toBe(false);
		expect(after.access === before.access).toBe(false);
		expect(after.expires).toBeGreaterThanOrEqual(before.expires ?? 0);
		// again: the new one renews it
		fake.tokens.clear();
		expect((await read(s)).error).toBe(false);
		expect(fake.refreshed).toHaveLength(2);
	});

	it("not given again on a refresh, the one held goes on renewing it", async () => {
		const { fake, s } = await signedIn({ refreshes: "always", rotate: false });
		const before = stored(s).tokens;
		fake.tokens.clear();
		expect((await read(s)).error).toBe(false);
		expect(stored(s).tokens.refresh === before.refresh).toBe(true);
		expect(stored(s).tokens.access === before.access).toBe(false);
		fake.tokens.clear();
		expect((await read(s)).error).toBe(false);
		expect(fake.refreshed).toHaveLength(2);
	});

	it("about to run out, renews it before the call, never sending the old token to be refused", async () => {
		const { fake, s } = await signedIn({ refreshes: "always", expiresIn: 30 });
		const before = stored(s).tokens;
		let refusals = 0;
		fake.onUnauthorized = async () => {
			refusals += 1;
		};
		const refreshedBefore = fake.refreshed.length;
		expect((await read(s)).error).toBe(false);
		expect(fake.refreshed.length).toBeGreaterThan(refreshedBefore);
		expect(refusals).toBe(0);
		expect(stored(s).tokens.access === before.access).toBe(false);
	});

	it("spent by another call's refresh is never sent again: that call's tokens stand", async () => {
		const { fake, s } = await signedIn({ refreshes: "always" });
		fake.tokens.clear();
		// The order is forced, whichever call's request arrives first. The first refusal waits for the second request, so
		// both calls hold the same version of the sign-in; the second refusal waits until the other call has refreshed,
		// kept the new tokens and finished, so it lands after the refresh it lost to.
		let refusals = 0;
		let secondArrived: () => void = () => {};
		const second = new Promise<void>((resolve) => {
			secondArrived = resolve;
		});
		let otherFinished: () => void = () => {};
		const finished = new Promise<void>((resolve) => {
			otherFinished = resolve;
		});
		fake.onUnauthorized = async () => {
			refusals += 1;
			if (refusals === 1) await second;
			else if (refusals === 2) {
				secondArrived();
				await finished;
			}
		};
		const calls = [s.capabilities.refresh("cal"), s.capabilities.refresh("cal")];
		// the held call cannot finish before it is let go: the first to finish is the other one
		await Promise.race(calls);
		otherFinished();
		await Promise.all(calls);
		expect(refusals).toBe(2);
		// one refresh, by the first; the second retried with the tokens it kept, never the spent refresh token
		expect(fake.refreshed).toHaveLength(1);
		expect((await s.capabilities.view()).connections.find((c) => c.name === "cal")?.state).toBe("connected");
		fake.onUnauthorized = undefined;
		expect((await read(s)).error).toBe(false);
	});

	it("revoked, makes that account sign in again and leaves every other sign-in be", async () => {
		const { fake, s } = await signedIn({ refreshes: "always" });
		const other = await startFakeMcp({ auth: "oauth", refreshes: "always" });
		fakes.push(other);
		await define(s, "work", fileOf(other));
		expect(await signInAsOwner(s.capabilities, "work")).toMatchObject({ ok: true });
		const kept = stored(s);
		const otherKept = stored(s, "work");
		fake.revokeRefresh();
		fake.tokens.clear();
		const refused = await read(s);
		expect(refused.error).toBe(true);
		expect(refused.text).toContain("the sign-in ran out: the owner signs in again");
		expect(fake.refreshed).toHaveLength(1);
		// what it held stays as it was, for the owner to sign in again; the other connection's account is untouched
		expect(stored(s)).toEqual(kept);
		expect(stored(s, "work")).toEqual(otherKept);
		expect((await read(s, "work__list_events")).error).toBe(false);
		expect(other.refreshed).toHaveLength(0);
	});
});

describe("a sign-in that ran out with nothing to renew it", () => {
	it("kept by v0.1.0 (no offline, no refresh token, its time past) shows expired; signing in again asks to renew", async () => {
		const { fake, s } = await signedIn({
			scopes: ["openid"],
			authScopes: ["openid", "offline_access"],
			refreshes: "offline",
		});
		// the account as banda v0.1.0 wrote it: what it asked for the resource alone, and a token given no refresh
		const dir = join(s.home, "auth", "connections", "cal");
		const [account] = readdirSync(dir);
		const file = join(dir, account as string, "credentials.json");
		const now = JSON.parse(readFileSync(file, "utf8")) as {
			url: string;
			revision: string;
			generation: string;
			oauth: { server: Record<string, unknown>; client: { id: string }; tokens: { access: string } };
		};
		const { offline: _, ...server } = now.oauth.server;
		const old = {
			url: now.url,
			oauth: {
				server: { ...server, scopes: ["openid"] },
				client: now.oauth.client,
				tokens: { access: now.oauth.tokens.access, expires: Date.now() - 60_000, scopes: ["openid"] },
			},
			revision: now.revision,
			generation: now.generation,
		};
		writeFileSync(file, JSON.stringify(old), { mode: 0o600 });
		fake.tokens.clear();
		// it fits as it was; only its time says it ran out, and nothing renews it on its own
		expect(await shownAccount(s)).toMatchObject({ stale: true, expired: true });
		const result = await read(s);
		expect(result.text).toContain("its sign-in expired, and the server gave no refresh token to renew it");
		expect(fake.refreshed).toHaveLength(0);
		expect(fake.scopesAsked).toHaveLength(1);
		// the owner signs that account in again: this time it asks for offline_access and is given a refresh token
		expect(await signInAsOwner(s.capabilities, "cal", { choice: { account: account as string } })).toMatchObject({
			ok: true,
		});
		expect(fake.scopesAsked.at(-1)).toBe("openid offline_access");
		expect(stored(s).tokens.refresh).toBeDefined();
		expect(await shownAccount(s)).not.toHaveProperty("stale");
		fake.tokens.clear();
		expect((await read(s)).error).toBe(false);
		expect(fake.refreshed).toHaveLength(1);
	});

	it("from a server that names no scope and renews only with offline_access, runs out and says so", async () => {
		const { fake, s } = await signedIn({
			scopes: [],
			authScopes: ["offline_access"],
			refreshes: "offline",
			expiresIn: 0,
		});
		expect(fake.scopesAsked).toEqual([""]);
		expect(await shownAccount(s)).toMatchObject({ stale: true, expired: true });
		fake.tokens.clear();
		expect((await read(s)).text).toContain("its sign-in expired, and the server gave no refresh token to renew it");
		expect(fake.refreshed).toHaveLength(0);
	});

	it("shows as expired, to sign in again, and a call says why, with no token in its words", async () => {
		const { fake, s } = await signedIn({ refreshes: "never", expiresIn: 0 });
		expect(stored(s).tokens.refresh).toBeUndefined();
		expect(await shownAccount(s)).toMatchObject({ stale: true, expired: true });
		expect((await s.capabilities.view()).connections.find((c) => c.name === "cal")?.state).toBe("sign-in");
		const issued = [...fake.tokens];
		fake.tokens.clear();
		const result = await read(s);
		expect(result.error).toBe(true);
		expect(result.text).toContain(
			"Calendar is not signed in: its sign-in expired, and the server gave no refresh token to renew it",
		);
		for (const token of issued) expect(result.text).not.toContain(token);
		// nothing is tried on the owner's behalf: no refresh, no new sign-in, and what it held stays for them to replace
		expect(fake.refreshed).toHaveLength(0);
		expect(fake.scopesAsked).toHaveLength(1);
		expect(stored(s).tokens.refresh).toBeUndefined();
	});
});
