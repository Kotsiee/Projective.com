import { assert, assertEquals } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";
import { fail, ok, type ServiceResult } from "@server/services/ServiceResult.ts";
import { AuthBackendService, type AuthPayload } from "@server/services/auth/AuthBackendService.ts";
import { authThrottle } from "@server/services/auth/auth-throttle.ts";
import { handler as confirmApi } from "@web/routes/api/auth/confirm.ts";
import apiGuard from "@web/routes/api/_middleware.ts";
import { handler as confirmPage } from "./confirm-handler.ts";
import { CONFIRM_FAILED_PATH } from "../core/confirm-link.ts";

/**
 * The email-confirmation link (Decision #445): a GET never spends the one-time token, so a mail
 * scanner that opens the link first leaves it for the person; only a same-origin POST, pressed on
 * `/verify/confirm`, exchanges it and mints the session cookies.
 */

// #region Harness
type Handler = (ctx: unknown) => unknown;
type PageAnswer = { data: Record<string, unknown>; headers?: Record<string, string> };

const BASE = "https://app.example.test";
const TOKEN = "a1b2c3d4e5".repeat(5) + "abcdef";
const QUERY = `?token_hash=${TOKEN}&type=email`;
const SESSION = { accessToken: "acc", refreshToken: "ref", expiresIn: 3600 };

function context(req: Request, host = "127.0.0.1", next?: () => unknown) {
	return {
		req,
		url: new URL(req.url),
		params: {},
		state: {} as Record<string, unknown>,
		info: { remoteAddr: { transport: "tcp", hostname: host, port: 1 } },
		next: next ?? (() => new Response(null, { status: 599 })),
	};
}

function get(handlers: unknown, path: string): Promise<unknown> {
	const fn = (handlers as Record<string, Handler>).GET;
	return Promise.resolve(fn(context(new Request(`${BASE}${path}`))));
}

function confirmPost(
	headers: Record<string, string>,
	fields: Record<string, string> = { token_hash: TOKEN, type: "email" },
): Request {
	return new Request(`${BASE}/api/auth/confirm`, {
		method: "POST",
		headers,
		body: new URLSearchParams(fields),
	});
}

/** POST through the real `/api` write guard, then the route, as Fresh chains them. */
async function press(req: Request, host = "127.0.0.1"): Promise<Response> {
	const post = (confirmApi as Record<string, Handler>).POST;
	const ctx = context(req, host, () => post(ctx));
	return await (apiGuard as unknown as Handler)(ctx) as Response;
}

function stubConfirm(result: ServiceResult<AuthPayload>) {
	return stub(AuthBackendService, "confirmEmailLink", () => Promise.resolve(result));
}

const SAME_ORIGIN = { origin: BASE };
const NO_REFERRER_FORM = { origin: "null", "sec-fetch-site": "same-origin" };
// #endregion

// #region GET never spends the token
Deno.test("GET /api/auth/confirm 303s to the confirm page with the same query and spends nothing", async () => {
	const spy = stubConfirm(ok({ redirectTo: "/home" }, { session: SESSION }));
	try {
		for (let opened = 0; opened < 2; opened++) {
			const res = await get(confirmApi, `/api/auth/confirm${QUERY}`) as Response;
			assertEquals(res.status, 303);
			assertEquals(res.headers.get("location"), `/verify/confirm${QUERY}`);
			assertEquals(res.headers.get("referrer-policy"), "no-referrer");
			assertEquals(res.headers.get("cache-control"), "private, no-store");
			assertEquals(res.headers.get("set-cookie"), null);
		}
		assertSpyCalls(spy, 0);
	} finally {
		spy.restore();
	}
});

Deno.test("GET /verify/confirm renders the button, never the exchange; noindex, no-store, no-referrer", async () => {
	const spy = stubConfirm(ok({ redirectTo: "/home" }, { session: SESSION }));
	try {
		const answer = await get(confirmPage, `/verify/confirm${QUERY}`) as PageAnswer;
		assertEquals(answer.data, { tokenHash: TOKEN, type: "email", throttled: false });
		assertEquals(answer.headers?.["x-robots-tag"], "noindex, nofollow");
		assertEquals(answer.headers?.["referrer-policy"], "no-referrer");
		assertEquals(answer.headers?.["cache-control"], "private, no-store");

		const again = await get(confirmPage, `/verify/confirm${QUERY}&notice=throttled`) as PageAnswer;
		assertEquals(again.data.throttled, true);
		assertSpyCalls(spy, 0);
	} finally {
		spy.restore();
	}
});

Deno.test("GET /verify/confirm with a malformed link goes to the failure notice", async () => {
	for (const query of ["", "?token_hash=nothex&type=email", `?token_hash=${TOKEN}&type=recovery`]) {
		const res = await get(confirmPage, `/verify/confirm${query}`) as Response;
		assertEquals(res.status, 303, query);
		assertEquals(res.headers.get("location"), CONFIRM_FAILED_PATH, query);
	}
});
// #endregion

// #region POST is the person's press
Deno.test("POST /api/auth/confirm from another site is refused before the token is read", async () => {
	const spy = stubConfirm(ok({ redirectTo: "/home" }, { session: SESSION }));
	try {
		assertEquals((await press(confirmPost({ origin: "https://evil.test" }))).status, 403);
		const opaque = { origin: "null", "sec-fetch-site": "cross-site" };
		assertEquals((await press(confirmPost(opaque))).status, 403);
		assertEquals((await press(confirmPost({}))).status, 403);
		assertSpyCalls(spy, 0);
	} finally {
		spy.restore();
	}
});

Deno.test("a scanner's two GETs, then the person's POST: signed in with session cookies, on /home", async () => {
	const spy = stubConfirm(ok({ redirectTo: "/home" }, { session: SESSION }));
	try {
		await get(confirmApi, `/api/auth/confirm${QUERY}`);
		await get(confirmApi, `/api/auth/confirm${QUERY}`);
		assertSpyCalls(spy, 0);

		for (const headers of [SAME_ORIGIN, NO_REFERRER_FORM]) {
			const res = await press(confirmPost(headers));
			assertEquals(res.status, 303);
			assertEquals(res.headers.get("location"), "/home");
			assertEquals(res.headers.get("cache-control"), "private, no-store");
			const cookies = res.headers.getSetCookie();
			assert(cookies.some((c) => c.startsWith("sb-access-token=acc")), cookies.join("\n"));
			assert(cookies.some((c) => c.startsWith("sb-refresh-token=ref")), cookies.join("\n"));
		}
		assertEquals(spy.calls[0].args[0], { tokenHash: TOKEN, redirectTo: "/home" });
	} finally {
		spy.restore();
	}
});

Deno.test("POST with an expired or spent token lands on the failure notice without cookies", async () => {
	const spy = stubConfirm(fail(422, { message: "That confirmation link has expired." }));
	try {
		const res = await press(confirmPost(SAME_ORIGIN));
		assertEquals(res.status, 303);
		assertEquals(res.headers.get("location"), CONFIRM_FAILED_PATH);
		assertEquals(res.headers.getSetCookie(), []);
	} finally {
		spy.restore();
	}
});

Deno.test("POST with a malformed body never reaches the service", async () => {
	const spy = stubConfirm(ok({ redirectTo: "/home" }, { session: SESSION }));
	try {
		const bad = await press(confirmPost(SAME_ORIGIN, { token_hash: "zz", type: "email" }));
		assertEquals(bad.headers.get("location"), CONFIRM_FAILED_PATH);
		const json = new Request(`${BASE}/api/auth/confirm`, {
			method: "POST",
			headers: { ...SAME_ORIGIN, "content-type": "application/json" },
			body: JSON.stringify({ token_hash: TOKEN, type: "email" }),
		});
		assertEquals((await press(json)).headers.get("location"), CONFIRM_FAILED_PATH);
		assertSpyCalls(spy, 0);
	} finally {
		spy.restore();
	}
});

Deno.test("a throttled press returns to the page with the token unspent", async () => {
	const spy = stubConfirm(fail(422, { message: "Spent." }));
	const host = "203.0.113.45";
	try {
		let res = await press(confirmPost(SAME_ORIGIN), host);
		for (let i = 0; i < 40 && res.headers.get("location") === CONFIRM_FAILED_PATH; i++) {
			res = await press(confirmPost(SAME_ORIGIN), host);
		}
		assertEquals(res.status, 303);
		assertEquals(res.headers.get("location"), `/verify/confirm${QUERY}&notice=throttled`);
		const spent = spy.calls.length;
		await press(confirmPost(SAME_ORIGIN), host);
		assertSpyCalls(spy, spent);
	} finally {
		spy.restore();
		authThrottle.reset();
	}
});
// #endregion
