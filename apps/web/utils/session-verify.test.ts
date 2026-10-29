import { assert, assertEquals, assertRejects } from "@std/assert";
import { stub } from "@std/testing/mock";
import { HttpError } from "fresh";
import { create } from "djwt";
import { fail, ok, type ServiceResult } from "@server/services/ServiceResult.ts";
import { AuthBackendService, type AuthPayload } from "@server/services/auth/AuthBackendService.ts";
import dashboardGuard from "../routes/(dashboard)/_middleware.ts";
import authScreenGuard from "../routes/(public)/(auth)/_middleware.ts";
import { resolveRequestViewer } from "./session.ts";
import type { State } from "./state.ts";

/**
 * session-verify_test — the `sb-access-token` cookie is verified, not trusted by presence (Decision
 * #205). Runs the real middlewares with the auth backend live: the project JWKS is served through a
 * stubbed `fetch`, tokens are signed with a throwaway ES256 key, and GoTrue's refresh grant is
 * replaced by stubbing {@link AuthBackendService.refreshSession}.
 */

// #region Harness
type Middleware = (ctx: unknown) => Response | Promise<Response>;

const KID = "test-kid";
const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
	"sign",
	"verify",
]);
const JWKS = {
	keys: [{
		...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
		kid: KID,
		alg: "ES256",
		use: "sig",
	}],
};

let project = 0;

function sign(claims: Record<string, unknown>): Promise<string> {
	return create({ alg: "ES256", typ: "JWT", kid: KID }, claims, keys.privateKey);
}

function userToken(expiresIn: number): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return sign({
		sub: "u-alice",
		aud: "authenticated",
		role: "authenticated",
		exp: now + expiresIn,
	});
}

function base64Url(text: string): string {
	return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A valid token whose payload was rewritten to another user, keeping the original signature. */
async function tamperedToken(): Promise<string> {
	const [header, , signature] = (await userToken(3600)).split(".");
	const exp = Math.floor(Date.now() / 1000) + 3600;
	const forged = base64Url(JSON.stringify({ sub: "u-mallory", aud: "authenticated", exp }));
	return `${header}.${forged}.${signature}`;
}

const RENEWED: ServiceResult<AuthPayload> = ok({}, {
	session: { accessToken: "renewed-access", refreshToken: "renewed-refresh", expiresIn: 3600 },
});
const REJECTED: ServiceResult<AuthPayload> = fail(401, { message: "Your session has expired." });

/**
 * Run `body` against a live auth backend on a fresh project URL (so no JWKS is cached from another
 * test), serving the JWKS — or failing to, when `jwksDown`.
 */
async function live<T>(
	body: (refreshes: () => number) => Promise<T>,
	{ refresh = RENEWED, jwksDown = false }: {
		refresh?: ServiceResult<AuthPayload>;
		jwksDown?: boolean;
	} = {},
): Promise<T> {
	const env = {
		AUTH_BACKEND_LIVE: "true",
		SUPABASE_URL: `https://p${++project}.example.test`,
		SUPABASE_ANON_KEY: "anon",
	};
	const previous = Object.fromEntries(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
	for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
	const fetchStub = stub(globalThis, "fetch", (input: string | URL | Request) => {
		const url = input instanceof Request ? input.url : String(input);
		if (url.endsWith("/auth/v1/.well-known/jwks.json") && !jwksDown) {
			return Promise.resolve(Response.json(JWKS));
		}
		return Promise.reject(new TypeError(`network unavailable: ${url}`));
	});
	const refreshStub = stub(AuthBackendService, "refreshSession", () => Promise.resolve(refresh));
	try {
		return await body(() => refreshStub.calls.length);
	} finally {
		refreshStub.restore();
		fetchStub.restore();
		for (const [k, v] of Object.entries(previous)) {
			if (v === undefined) Deno.env.delete(k);
			else Deno.env.set(k, v);
		}
	}
}

function request(path: string, cookies: Record<string, string>): Request {
	const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
	return new Request(`https://app.example.test${path}`, { headers: cookie ? { cookie } : {} });
}

/**
 * Stamp the viewer as the global middleware does (its own module pulls UI CSS a unit test cannot
 * load), then run `guard`.
 */
async function chain(
	guard: unknown,
	req: Request,
): Promise<{ res: Response; state: State; reached: boolean }> {
	const state: State = { ...(await resolveRequestViewer(req)) };
	let reached = false;
	const url = new URL(req.url);
	const page = () => {
		reached = true;
		return Promise.resolve(new Response("page"));
	};
	const res = await (guard as Middleware)({ req, url, params: {}, state, next: page });
	return { res, state, reached };
}

function clears(cookies: string[]): boolean {
	return cookies.some((c) => c.startsWith("sb-access-token=;") && c.includes("Max-Age=0")) &&
		cookies.some((c) => c.startsWith("sb-refresh-token=;") && c.includes("Max-Age=0"));
}
// #endregion

// #region Dashboard guard
Deno.test("dashboard guard: a valid token is admitted with no renewal", async () => {
	await live(async (refreshes) => {
		const req = request("/projects", { "sb-access-token": await userToken(3600) });
		const { res, state, reached } = await chain(dashboardGuard, req);
		assert(reached);
		assertEquals(res.status, 200);
		assertEquals(state.isAuthenticated, true);
		assertEquals(state.userContext?.userId, "u-alice");
		assertEquals(refreshes(), 0);
		assertEquals(res.headers.getSetCookie().filter((c) => c.startsWith("sb-")), []);
	});
});

Deno.test("dashboard guard: a tampered token without a refresh cookie is cleared and sent to sign-in", async () => {
	await live(async (refreshes) => {
		const req = request("/projects?tab=board", { "sb-access-token": await tamperedToken() });
		const { res, reached } = await chain(dashboardGuard, req);
		assert(!reached);
		assertEquals(res.status, 302);
		assertEquals(
			new URL(res.headers.get("location")!).search,
			`?redirectTo=${encodeURIComponent("/projects?tab=board")}`,
		);
		assert(clears(res.headers.getSetCookie()));
		assertEquals(refreshes(), 0);
	});
});

Deno.test("dashboard guard: a tampered token with a refresh cookie renews instead", async () => {
	await live(async (refreshes) => {
		const req = request("/projects", {
			"sb-access-token": await tamperedToken(),
			"sb-refresh-token": "old-refresh",
		});
		const { res, reached } = await chain(dashboardGuard, req);
		assert(reached);
		assertEquals(refreshes(), 1);
		assert(res.headers.getSetCookie().some((c) => c.startsWith("sb-access-token=renewed-access;")));
	});
});

Deno.test("dashboard guard: an expired token with a refresh cookie renews in place", async () => {
	await live(async (refreshes) => {
		const req = request("/projects", {
			"sb-access-token": await userToken(-3600),
			"sb-refresh-token": "old-refresh",
		});
		const { res, state, reached } = await chain(dashboardGuard, req);
		assert(reached);
		assertEquals(res.status, 200);
		assertEquals(refreshes(), 1);
		assertEquals(state.isAuthenticated, true);
		assert(
			res.headers.getSetCookie().some((c) => c.startsWith("sb-refresh-token=renewed-refresh;")),
		);
	});
});

Deno.test("dashboard guard: an expired token whose refresh is refused is cleared and sent to sign-in", async () => {
	await live(async (refreshes) => {
		const req = request("/projects", {
			"sb-access-token": await userToken(-3600),
			"sb-refresh-token": "spent-refresh",
		});
		const { res, reached } = await chain(dashboardGuard, req);
		assert(!reached);
		assertEquals(res.status, 302);
		assertEquals(refreshes(), 1);
		assert(clears(res.headers.getSetCookie()));
	}, { refresh: REJECTED });
});

Deno.test("dashboard guard: an expired token without a refresh cookie is cleared and sent to sign-in", async () => {
	await live(async (refreshes) => {
		const req = request("/projects", { "sb-access-token": await userToken(-3600) });
		const { res, reached } = await chain(dashboardGuard, req);
		assert(!reached);
		assertEquals(res.status, 302);
		assert(res.headers.get("location")?.includes("/login?redirectTo="));
		assert(clears(res.headers.getSetCookie()));
		assertEquals(refreshes(), 0);
	});
});

Deno.test("dashboard guard: unobtainable signing keys answer 503 and keep the cookies", async () => {
	await live(async (refreshes) => {
		const req = request("/projects", {
			"sb-access-token": await userToken(3600),
			"sb-refresh-token": "old-refresh",
		});
		const error = await assertRejects(() => chain(dashboardGuard, req), HttpError);
		assertEquals(error.status, 503);
		assertEquals(refreshes(), 0);
	}, { jwksDown: true });
});
// #endregion

// #region Auth-screen guard
Deno.test("auth-screen guard: a valid token is bounced off /login", async () => {
	await live(async () => {
		const req = request("/login", { "sb-access-token": await userToken(3600) });
		const { res, reached } = await chain(authScreenGuard, req);
		assert(!reached);
		assertEquals(res.status, 302);
		assertEquals(new URL(res.headers.get("location")!).pathname, "/home");
	});
});

Deno.test("auth-screen guard: a tampered or expired token reaches /login as a guest", async () => {
	await live(async () => {
		for (const token of [await tamperedToken(), await userToken(-3600)]) {
			const req = request("/login", {
				"sb-access-token": token,
				"sb-refresh-token": "old-refresh",
			});
			const { res, state, reached } = await chain(authScreenGuard, req);
			assert(reached);
			assertEquals(res.status, 200);
			assertEquals(state.isAuthenticated, false);
			assertEquals(state.userContext?.userId ?? null, null);
		}
	});
});
// #endregion

// #region Stub mode
Deno.test("stub auth in development: an opaque dev session is still admitted by presence", async () => {
	const prior = Deno.env.get("DENO_ENV");
	Deno.env.set("DENO_ENV", "development");
	try {
		const req = request("/projects", { "sb-access-token": "opaque-dev-session" });
		const { res, state, reached } = await chain(dashboardGuard, req);
		assert(reached);
		assertEquals(res.status, 200);
		assertEquals(state.isAuthenticated, true);
	} finally {
		if (prior === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", prior);
	}
});

Deno.test("stub auth with DENO_ENV unset: production, so an opaque session is not trusted", async () => {
	const prior = Deno.env.get("DENO_ENV");
	Deno.env.delete("DENO_ENV");
	try {
		const req = request("/projects", { "sb-access-token": "opaque-dev-session" });
		const { reached } = await chain(dashboardGuard, req);
		assertEquals(reached, false);
	} finally {
		if (prior !== undefined) Deno.env.set("DENO_ENV", prior);
	}
});
// #endregion
