import { describe, expect, it } from "vitest";
import { begin, discover, exchange, refresh, scopesOfSignIn, startDevice } from "../src/core/oauth.ts";

function discovery({
	issuer = "https://auth.example/issuer",
	declared = issuer,
	metadata = "https://service.example/meta",
	token = "https://auth.example/token",
	resourceScopes = ["mcp"],
	authScopes,
}: {
	issuer?: string;
	declared?: string;
	metadata?: string;
	token?: string;
	/** The resource's `scopes_supported` (RFC 9728); unsaid when null. */
	resourceScopes?: string[] | null;
	/** The authorization server's `scopes_supported` (RFC 8414); unsaid when undefined. */
	authScopes?: unknown;
} = {}) {
	const requests: string[] = [];
	const fetcher: typeof fetch = async (input, init) => {
		const url = String(input);
		requests.push(url);
		if (init?.method === "POST")
			return new Response(null, {
				status: 401,
				headers: { "www-authenticate": `Bearer resource_metadata="${metadata}"` },
			});
		const body =
			url === metadata
				? {
						authorization_servers: [issuer],
						...(resourceScopes === null ? {} : { scopes_supported: resourceScopes }),
					}
				: {
						issuer: declared,
						authorization_endpoint: "https://auth.example/authorize",
						token_endpoint: token,
						registration_endpoint: "https://auth.example/register",
						code_challenge_methods_supported: ["S256"],
						authorization_response_iss_parameter_supported: true,
						device_authorization_endpoint: "https://auth.example/device",
						...(authScopes === undefined ? {} : { scopes_supported: authScopes }),
					};
		return Response.json(body);
	};
	return { run: () => discover("https://service.example/mcp", fetcher), requests };
}
it("retains the discovered issuer's RFC 9207 promise, resource scopes, and PKCE endpoints", async () => {
	expect(await discovery().run()).toMatchObject({
		issuer: "https://auth.example/issuer",
		issuerParameter: true,
		scopes: ["mcp"],
		token: "https://auth.example/token",
	});
});
it("refuses issuer substitution in discovery", async () => {
	await expect(discovery({ declared: "https://another.example" }).run()).rejects.toThrow(/issuer/);
});
for (const issuer of [
	"http://outside.example",
	"https://user:password@auth.example",
	"https://auth.example?query=1",
	"https://auth.example#fragment",
])
	it("refuses unsafe authorization-server addresses before fetching their discovery", async () => {
		const probe = discovery({ issuer });
		await expect(probe.run()).rejects.toThrow();
		expect(probe.requests).toHaveLength(2);
	});
it("does not fetch insecure metadata named in a challenge", async () => {
	const probe = discovery({ metadata: "http://outside.example/meta" });
	await expect(probe.run()).rejects.toThrow();
	expect(probe.requests).toEqual(["https://service.example/mcp"]);
});
it("shows a safe OAuth error code without exposing the provider response description", async () => {
	const pending = {
		connection: "gmail",
		state: "state",
		verifier: "verifier",
		redirect: "http://127.0.0.1:7788/oauth/callback",
		resource: "https://gmail.googleapis.com/gmail/v1/users/me",
		server: {
			issuer: "https://accounts.google.com",
			authorize: "https://accounts.google.com/o/oauth2/v2/auth",
			token: "https://oauth2.googleapis.com/token",
			resourceParameter: false as const,
		},
		client: { id: "client" },
		at: 0,
	};
	const fetcher: typeof fetch = async () =>
		Response.json({ error: "invalid_grant", error_description: "do not show sensitive details" }, { status: 400 });
	await expect(exchange(pending, "one-use-code", 0, fetcher)).rejects.toThrow(
		"oauth2.googleapis.com answered 400 (invalid_grant)",
	);
	await expect(exchange(pending, "one-use-code", 0, fetcher)).rejects.not.toThrow("sensitive details");
});
for (const token of ["https://user:password@auth.example/token", "https://auth.example/token#fragment"])
	it("refuses embedded credentials and fragments in OAuth endpoints", async () => {
		await expect(discovery({ token }).run()).rejects.toThrow(/credentials or a fragment/);
	});

describe("asking for a refresh token, whatever the server", () => {
	const client = { id: "client" };
	const redirect = "http://127.0.0.1:7788/oauth/callback";
	const scopeAsked = (server: Awaited<ReturnType<typeof discover>>) =>
		new URL(begin("svc", "https://service.example/mcp", server, client, redirect, 0).url).searchParams.get("scope");

	it("asks for offline_access beside the resource's scopes when the authorization server lists it", async () => {
		// as Vercel's MCP server is published: the resource wants openid, its authorization server offers offline_access
		const server = await discovery({
			resourceScopes: ["openid"],
			authScopes: ["openid", "email", "profile", "offline_access", "admin:manage"],
		}).run();
		expect(server).toMatchObject({ scopes: ["openid"], offline: true });
		// the resource's scopes stay what an account is checked against; nothing else the server offers is asked
		expect(scopeAsked(server)).toBe("openid offline_access");
	});

	it("asks for no offline_access when the authorization server does not list it, or says nothing of its scopes", async () => {
		for (const authScopes of [["mcp", "profile"], undefined, "offline_access", [], [7]]) {
			const server = await discovery({ authScopes }).run();
			expect(server.offline).toBeUndefined();
			expect(scopeAsked(server)).toBe("mcp");
		}
	});

	it("leaves scope out when the resource names none, so the server's default grant is not narrowed", async () => {
		const server = await discovery({ resourceScopes: null, authScopes: ["offline_access"] }).run();
		expect(server.scopes).toBeUndefined();
		expect(scopesOfSignIn(server)).toBeUndefined();
		expect(scopeAsked(server)).toBeNull();
	});

	it("asks for offline_access once when the resource names it too", async () => {
		const server = await discovery({ resourceScopes: ["mcp", "offline_access"], authScopes: ["offline_access"] }).run();
		expect(scopeAsked(server)).toBe("mcp offline_access");
	});

	it("asks the same for a sign-in by code", async () => {
		const server = await discovery({ authScopes: ["mcp", "offline_access"] }).run();
		let sent: URLSearchParams | undefined;
		const fetcher: typeof fetch = async (_input, init) => {
			sent = new URLSearchParams(String(init?.body));
			return Response.json({ device_code: "d", user_code: "U", verification_uri: "https://auth.example/type" });
		};
		await startDevice(server, client, "https://service.example/mcp", 0, fetcher);
		expect(sent?.get("scope")).toBe("mcp offline_access");
	});

	it("leaves a shipped client's row to ask for renewal its own way", () => {
		expect(
			scopesOfSignIn({
				issuer: "https://accounts.google.com",
				authorize: "https://accounts.google.com/o/oauth2/v2/auth",
				token: "https://oauth2.googleapis.com/token",
				scopes: ["https://www.googleapis.com/auth/calendar"],
				offline: true,
			}),
		).toEqual(["https://www.googleapis.com/auth/calendar"]);
	});
});

describe("a refresh", () => {
	const server = {
		issuer: "https://auth.example",
		authorize: "https://auth.example/a",
		token: "https://auth.example/t",
	};
	const held = { access: "old-access", refresh: "old-refresh", expires: 1000, scopes: ["mcp", "offline_access"] };
	const answering =
		(body: Record<string, unknown>, sent: URLSearchParams[] = []): typeof fetch =>
		async (_input, init) => {
			sent.push(new URLSearchParams(String(init?.body)));
			return Response.json(body);
		};

	it("takes a rotated refresh token and the new expiry, and asks for no scope beyond the grant", async () => {
		const sent: URLSearchParams[] = [];
		const fresh = await refresh(
			server,
			{ id: "client" },
			held,
			"https://service.example/mcp",
			5000,
			answering({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 60 }, sent),
		);
		expect(fresh).toEqual({ access: "new-access", refresh: "new-refresh", expires: 65_000, scopes: held.scopes });
		expect(sent[0]?.get("grant_type")).toBe("refresh_token");
		// RFC 6749 §6: an omitted scope keeps the original grant, so the refresh never widens or narrows it
		expect(sent[0]?.has("scope")).toBe(false);
	});

	it("keeps the refresh token it holds when the server gives no new one", async () => {
		const fresh = await refresh(
			server,
			{ id: "client" },
			held,
			"https://service.example/mcp",
			5000,
			answering({ access_token: "new-access", expires_in: 60 }),
		);
		expect(fresh).toEqual({ access: "new-access", refresh: "old-refresh", expires: 65_000, scopes: held.scopes });
	});

	it("says a refused refresh by its safe code alone", async () => {
		const fetcher: typeof fetch = async () =>
			Response.json({ error: "invalid_grant", error_description: "token old-refresh revoked" }, { status: 400 });
		const refused = refresh(server, { id: "client" }, held, "https://service.example/mcp", 5000, fetcher);
		await expect(refused).rejects.toThrow("auth.example answered 400 (invalid_grant)");
		await expect(refused).rejects.not.toThrow(/old-refresh/);
	});

	it("is not tried without a refresh token", async () => {
		const { refresh: _, ...without } = held;
		await expect(refresh(server, { id: "client" }, without, "https://service.example/mcp", 5000)).rejects.toThrow(
			/no refresh token/,
		);
	});
});
