import { assert, assertEquals, assertFalse } from "@std/assert";
import { stub } from "@std/testing/mock";
import { ok, type ServiceResult } from "@server/services/ServiceResult.ts";
import {
	AuthBackendService,
	type AuthenticateInput,
	type AuthPayload,
} from "@server/services/auth/AuthBackendService.ts";
import { handler as loginRoute } from "../routes/api/auth/login.ts";
import { handler as refreshRoute } from "../routes/api/auth/refresh.ts";
import { handler as logoutRoute } from "../routes/api/auth/logout.ts";
import {
	isSecureRequest,
	oauthStoreCookies,
	pendingVerificationSetCookie,
	SB_REFRESH_COOKIE,
	SESSION_TRANSIENT_COOKIE,
	sessionClearCookies,
	sessionSetCookies,
} from "./auth-cookies.ts";
import { ensureSession } from "./session.ts";

/**
 * auth-cookies_test — the `Secure` attribute follows the scheme the browser used (Decision #201), and
 * "Keep me signed in" decides whether the refresh cookie outlives the browser session, through
 * sign-in, every renewal and sign-out.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const TOKENS = { accessToken: "acc", refreshToken: "ref", expiresIn: 3600 };
const THIRTY_DAYS = "Max-Age=2592000";

function withDenoEnv(value: string | undefined, fn: () => void | Promise<void>) {
	return async () => {
		const prior = Deno.env.get("DENO_ENV");
		if (value === undefined) Deno.env.delete("DENO_ENV");
		else Deno.env.set("DENO_ENV", value);
		try {
			await fn();
		} finally {
			if (prior === undefined) Deno.env.delete("DENO_ENV");
			else Deno.env.set("DENO_ENV", prior);
		}
	};
}

function request(url: string, headers: Record<string, string> = {}, body?: unknown): Request {
	return new Request(url, {
		method: "POST",
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function call(handlers: unknown, req: Request): Promise<string[]> {
	const fn = (handlers as Record<string, Handler>)[req.method];
	const res = await fn({
		req,
		url: new URL(req.url),
		params: {},
		state: {},
		info: { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 } },
	});
	return res.headers.getSetCookie();
}

function cookie(cookies: string[], name: string): string | undefined {
	return cookies.find((c) => c.startsWith(`${name}=`));
}

const LOCAL = "http://localhost:5373/api/auth/login";
const STAGING = "https://staging.example.test/api/auth/login";
const TRANSIENT = { cookie: `${SESSION_TRANSIENT_COOKIE}=1` };
// #endregion

// #region Secure
Deno.test(
	"secure: plain http on localhost stays insecure in development",
	withDenoEnv("development", () => {
		const req = request(LOCAL);
		assertFalse(isSecureRequest(req));
		assert(sessionSetCookies(req, TOKENS).every((c) => !c.includes("Secure")));
	}),
);

Deno.test(
	"secure: an https request is Secure without DENO_ENV",
	withDenoEnv("staging", () => {
		const req = request(STAGING);
		assert(isSecureRequest(req));
		assert(sessionSetCookies(req, TOKENS).every((c) => c.endsWith("; Secure")));
		assert(sessionClearCookies(req).every((c) => c.endsWith("; Secure")));
		assert(pendingVerificationSetCookie(req, "t", 60).endsWith("; Secure"));
		assert(oauthStoreCookies(req, [{ key: "v", value: "x" }], 600)[0].endsWith("; Secure"));
	}),
);

Deno.test(
	"secure: X-Forwarded-Proto https behind a TLS-terminating proxy, first hop wins",
	withDenoEnv("development", () => {
		const internal = "http://10.0.0.4:8000/api/auth/login";
		assert(isSecureRequest(request(internal, { "x-forwarded-proto": "https" })));
		assert(isSecureRequest(request(internal, { "x-forwarded-proto": " HTTPS , http" })));
		assertFalse(isSecureRequest(request(internal, { "x-forwarded-proto": "http" })));
		assertFalse(isSecureRequest(request(internal, { "x-forwarded-proto": "http, https" })));
	}),
);

Deno.test(
	"secure: an unset DENO_ENV is production, so always Secure (IW-M1)",
	withDenoEnv(undefined, () => {
		assert(isSecureRequest(request(LOCAL)));
	}),
);

Deno.test(
	"secure: production is always Secure",
	withDenoEnv("production", () => {
		assert(isSecureRequest(request(LOCAL)));
	}),
);
// #endregion

// #region Lifetime
Deno.test(
	"lifetime: remember=true keeps a 30-day refresh cookie and no transient flag",
	withDenoEnv("development", () => {
		const cookies = sessionSetCookies(request(LOCAL), { ...TOKENS, remember: true });
		assert(cookie(cookies, SB_REFRESH_COOKIE)?.includes(THIRTY_DAYS));
		assertEquals(cookie(cookies, SESSION_TRANSIENT_COOKIE), undefined);
	}),
);

Deno.test(
	"lifetime: remember=false makes the refresh cookie a session cookie and sets the flag",
	withDenoEnv("development", () => {
		const cookies = sessionSetCookies(request(LOCAL), { ...TOKENS, remember: false });
		assertFalse(cookie(cookies, SB_REFRESH_COOKIE)?.includes("Max-Age"));
		assertEquals(
			cookie(cookies, SESSION_TRANSIENT_COOKIE),
			`${SESSION_TRANSIENT_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax`,
		);
		assert(cookie(cookies, "sb-access-token")?.includes("Max-Age=3600"));
	}),
);

Deno.test(
	"lifetime: a renewal inherits the request's choice",
	withDenoEnv("development", () => {
		const transient = sessionSetCookies(request(LOCAL, TRANSIENT), TOKENS);
		assertFalse(cookie(transient, SB_REFRESH_COOKIE)?.includes("Max-Age"));
		assert(
			cookie(transient, SESSION_TRANSIENT_COOKIE)?.startsWith(`${SESSION_TRANSIENT_COOKIE}=1;`),
		);

		const remembered = sessionSetCookies(request(LOCAL), TOKENS);
		assert(cookie(remembered, SB_REFRESH_COOKIE)?.includes(THIRTY_DAYS));
		assertEquals(cookie(remembered, SESSION_TRANSIENT_COOKIE), undefined);
	}),
);

Deno.test(
	"lifetime: signing in with remember=true over a transient session clears the flag",
	withDenoEnv("development", () => {
		const cookies = sessionSetCookies(request(LOCAL, TRANSIENT), { ...TOKENS, remember: true });
		assert(cookie(cookies, SB_REFRESH_COOKIE)?.includes(THIRTY_DAYS));
		assert(cookie(cookies, SESSION_TRANSIENT_COOKIE)?.includes("Max-Age=0"));
	}),
);

Deno.test(
	"lifetime: sign-out clears the flag only when the browser holds it",
	withDenoEnv("development", () => {
		assertEquals(sessionClearCookies(request(LOCAL)).length, 2);
		const cleared = sessionClearCookies(request(LOCAL, TRANSIENT));
		assertEquals(cleared.length, 3);
		assert(cleared.every((c) => c.includes("Max-Age=0")));
	}),
);
// #endregion

// #region Routes
for (const remember of [false, true]) {
	Deno.test(
		`login: remember=${remember} reaches the service and sets the matching refresh lifetime over https`,
		withDenoEnv("development", async () => {
			let seen: AuthenticateInput | undefined;
			const s = stub(AuthBackendService, "authenticate", (input: AuthenticateInput) => {
				seen = input;
				return Promise.resolve(
					ok({ redirectTo: "/home" }, { session: { ...TOKENS, remember: input.remember } }),
				);
			});
			try {
				const cookies = await call(
					loginRoute,
					request(STAGING, {}, { identifier: "a@b.co", password: "pw", remember }),
				);
				assertEquals(seen?.remember, remember);
				assert(cookies.every((c) => c.endsWith("; Secure")), cookies.join(" | "));
				assertEquals(cookie(cookies, SB_REFRESH_COOKIE)?.includes(THIRTY_DAYS), remember);
				assertEquals(cookie(cookies, SESSION_TRANSIENT_COOKIE) !== undefined, !remember);
			} finally {
				s.restore();
			}
		}),
	);
}

const RENEWED: ServiceResult<AuthPayload> = ok({}, {
	session: { accessToken: "new-acc", refreshToken: "new-ref", expiresIn: 3600 },
});

Deno.test(
	"refresh: a transient session stays transient across the renewal",
	withDenoEnv("development", async () => {
		const s = stub(AuthBackendService, "refreshSession", () => Promise.resolve(RENEWED));
		try {
			const cookies = await call(
				refreshRoute,
				request("https://staging.example.test/api/auth/refresh", {
					cookie: `sb-refresh-token=old; ${SESSION_TRANSIENT_COOKIE}=1`,
				}),
			);
			const refresh = cookie(cookies, SB_REFRESH_COOKIE) ?? "";
			assert(refresh.startsWith("sb-refresh-token=new-ref;"));
			assertFalse(refresh.includes("Max-Age"));
			assert(refresh.endsWith("; Secure"));
			assert(
				cookie(cookies, SESSION_TRANSIENT_COOKIE)?.startsWith(`${SESSION_TRANSIENT_COOKIE}=1;`),
			);
		} finally {
			s.restore();
		}
	}),
);

Deno.test(
	"refresh: a remembered session keeps its 30 days",
	withDenoEnv("development", async () => {
		const s = stub(AuthBackendService, "refreshSession", () => Promise.resolve(RENEWED));
		try {
			const cookies = await call(
				refreshRoute,
				request("http://localhost:5373/api/auth/refresh", { cookie: "sb-refresh-token=old" }),
			);
			const refresh = cookie(cookies, SB_REFRESH_COOKIE) ?? "";
			assert(refresh.includes(THIRTY_DAYS));
			assertFalse(refresh.includes("Secure"));
			assertEquals(cookie(cookies, SESSION_TRANSIENT_COOKIE), undefined);
		} finally {
			s.restore();
		}
	}),
);

Deno.test(
	"ensureSession: the dashboard guard's silent renewal keeps a transient session transient",
	withDenoEnv("development", async () => {
		const s = stub(AuthBackendService, "refreshSession", () => Promise.resolve(RENEWED));
		try {
			const session = await ensureSession(
				request("https://staging.example.test/home", {
					cookie: `sb-refresh-token=old; ${SESSION_TRANSIENT_COOKIE}=1`,
				}),
			);
			assert(session.refreshed);
			assertFalse(cookie(session.setCookies, SB_REFRESH_COOKIE)?.includes("Max-Age"));
			assert(session.setCookies.every((c) => c.endsWith("; Secure")));
		} finally {
			s.restore();
		}
	}),
);

Deno.test(
	"logout: clears the session and its transient flag",
	withDenoEnv("development", async () => {
		const s = stub(AuthBackendService, "signOut", () => Promise.resolve(ok({})));
		try {
			const cookies = await call(
				logoutRoute,
				request("https://staging.example.test/api/auth/logout", {
					cookie: `sb-access-token=a; sb-refresh-token=r; ${SESSION_TRANSIENT_COOKIE}=1`,
				}),
			);
			assertEquals(cookies.length, 3);
			assert(cookies.every((c) => c.includes("Max-Age=0") && c.endsWith("; Secure")));
		} finally {
			s.restore();
		}
	}),
);
// #endregion
