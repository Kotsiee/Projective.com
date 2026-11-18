import { assertEquals } from "@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "@std/testing/mock";
import { CAPTCHA_REFUSAL } from "@projective/types/auth";
import { fail, ok } from "@server/services/ServiceResult.ts";
import { NewsletterBackendService } from "@server/services/newsletter/NewsletterBackendService.ts";
import { handler as subscribeApi } from "../routes/api/newsletter/subscribe.ts";
import { handler as confirmApi } from "../routes/api/newsletter/confirm.ts";
import { handler as unsubscribeApi } from "../routes/api/newsletter/unsubscribe.ts";
import {
	confirmPageHandler,
	unsubscribePageHandler,
} from "../features/marketing/newsletter/routes/link-handlers.ts";
import apiGuard from "../routes/api/_middleware.ts";

/**
 * The newsletter's routes (PRD-E11): a subscribe passes the Turnstile check before anything is
 * written; opening a mailed link (a GET of either endpoint or page) writes nothing; Confirm is a
 * same-origin press; and a mail client's RFC 8058 one-click POST unsubscribes from another site with
 * no Origin. Spies stand in for the fat service, so no case needs a database or the network.
 */

// #region Harness
type Handler = (ctx: unknown) => unknown;

const BASE = "https://app.example.test";
const TOKEN = "0b0e7d5c-34a1-4b7a-9d61-2f1f5c2e9a10";

function context(req: Request, next?: () => unknown) {
	return {
		req,
		url: new URL(req.url),
		params: {},
		state: {} as Record<string, unknown>,
		info: { remoteAddr: { transport: "tcp", hostname: "203.0.113.9", port: 1 } },
		next: next ?? (() => new Response(null, { status: 599 })),
	};
}

/** Call a handler's `method` directly (no middleware). */
async function call(handlers: unknown, method: string, req: Request): Promise<Response> {
	return await (handlers as Record<string, Handler>)[method](context(req)) as Response;
}

/** POST through the real `/api` write guard, then the route, as Fresh chains them. */
async function guarded(handlers: unknown, req: Request): Promise<Response> {
	const post = (handlers as Record<string, Handler>).POST;
	const ctx = context(req, () => post(ctx));
	return await (apiGuard as unknown as Handler)(ctx) as Response;
}

/** Run `fn` with these variables set (an `undefined` one removed), and put them back. */
async function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	const before = Object.keys(vars).map((name) => [name, Deno.env.get(name)] as const);
	Object.entries(vars).forEach(([name, value]) => apply(name, value));
	try {
		await fn();
	} finally {
		before.forEach(([name, value]) => apply(name, value));
	}
}

function form(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
	return new Request(`${BASE}${path}`, {
		method: "POST",
		headers,
		body: new URLSearchParams(fields),
	});
}

const SAME_ORIGIN = { origin: BASE };
// #endregion

// #region Subscribe
Deno.test("subscribe: no Turnstile token is refused before any write", async () => {
	await withEnv(
		{
			DENO_ENV: "production",
			APP_URL: BASE,
			TURNSTILE_SITE_KEY: "0x4AAAAAAA-site",
			TURNSTILE_SECRET_KEY: "0x4AAAAAAA-secret",
			NEWSLETTER_BACKEND_LIVE: "false",
		},
		async () => {
			const res = await call(
				subscribeApi,
				"POST",
				new Request(`${BASE}/api/newsletter/subscribe`, {
					method: "POST",
					headers: { "content-type": "application/json", origin: BASE },
					body: JSON.stringify({ email: "reader@example.com" }),
				}),
			);
			assertEquals(res.status, 400);
			assertEquals((await res.json()).message, CAPTCHA_REFUSAL);
		},
	);
});
// #endregion

// #region Opening a link writes nothing
Deno.test("GET /api/newsletter/confirm 303s to the page with the same query and confirms nothing", async () => {
	const spy = stub(
		NewsletterBackendService,
		"confirm",
		() => Promise.resolve(ok({ outcome: "confirmed" as const, topics: [] })),
	);
	try {
		for (let opened = 0; opened < 2; opened++) {
			const res = await call(
				confirmApi,
				"GET",
				new Request(`${BASE}/api/newsletter/confirm?token=${TOKEN}`),
			);
			assertEquals(res.status, 303);
			assertEquals(res.headers.get("location"), `/newsletter/confirm?token=${TOKEN}`);
			assertEquals(res.headers.get("referrer-policy"), "no-referrer");
			assertEquals(res.headers.get("cache-control"), "private, no-store");
			assertEquals(res.headers.get("x-robots-tag"), "noindex, nofollow");
		}
		assertSpyCalls(spy, 0);
	} finally {
		spy.restore();
	}
});

Deno.test("GET of the List-Unsubscribe URL forwards to the page and unsubscribes nothing", async () => {
	const spy = stub(
		NewsletterBackendService,
		"unsubscribe",
		() => Promise.resolve(ok({ outcome: "unsubscribed" as const })),
	);
	try {
		const res = await call(
			unsubscribeApi,
			"GET",
			new Request(`${BASE}/api/newsletter/unsubscribe?token=${TOKEN}`),
		);
		assertEquals(res.status, 303);
		assertEquals(res.headers.get("location"), `/newsletter/unsubscribe?token=${TOKEN}`);
		assertSpyCalls(spy, 0);
	} finally {
		spy.restore();
	}
});

Deno.test("the pages only read: an unknown token is a calm 404, and no write door is called", async () => {
	const view = stub(
		NewsletterBackendService,
		"linkView",
		() => Promise.resolve(fail(404, { message: "We couldn't find this link." })),
	);
	const confirm = stub(NewsletterBackendService, "confirm");
	const unsubscribe = stub(NewsletterBackendService, "unsubscribe");
	try {
		for (
			const [handlers, mode] of [[confirmPageHandler, "confirm"], [
				unsubscribePageHandler,
				"unsubscribe",
			]] as const
		) {
			const ctx = context(new Request(`${BASE}/newsletter/${mode}?token=${TOKEN}`));
			const answer = await (handlers as unknown as Record<string, Handler>).GET(ctx) as {
				data: Record<string, unknown>;
				status?: number;
				headers?: Record<string, string>;
			};
			assertEquals(answer.status, 404);
			assertEquals(answer.data.failure, "not_found");
			assertEquals(answer.data.token, null, "an unknown token is not handed to a button");
			assertEquals(answer.headers?.["referrer-policy"], "no-referrer");
		}
		assertSpyCalls(view, 2);
		assertSpyCalls(confirm, 0);
		assertSpyCalls(unsubscribe, 0);
	} finally {
		view.restore();
		confirm.restore();
		unsubscribe.restore();
	}
});
// #endregion

// #region Confirm
Deno.test("POST /api/newsletter/confirm: a same-origin form press confirms and returns to the page", async () => {
	const spy = stub(
		NewsletterBackendService,
		"confirm",
		() => Promise.resolve(ok({ outcome: "confirmed" as const, topics: ["general" as const] })),
	);
	try {
		const res = await guarded(
			confirmApi,
			form("/api/newsletter/confirm", { token: TOKEN }, SAME_ORIGIN),
		);
		assertEquals(res.status, 303);
		assertEquals(res.headers.get("location"), `/newsletter/confirm?token=${TOKEN}`);
		assertSpyCalls(spy, 1);
		assertEquals(spy.calls[0].args[0], TOKEN);
	} finally {
		spy.restore();
	}
});

Deno.test("POST /api/newsletter/confirm from another site is refused before the route", async () => {
	const spy = stub(NewsletterBackendService, "confirm");
	try {
		const res = await guarded(
			confirmApi,
			form("/api/newsletter/confirm", { token: TOKEN }, { origin: "https://evil.example" }),
		);
		assertEquals(res.status, 403);
		const bare = await guarded(confirmApi, form("/api/newsletter/confirm", { token: TOKEN }));
		assertEquals(bare.status, 403, "no Origin and no Sec-Fetch-Site is a non-browser caller");
		assertSpyCalls(spy, 0);
	} finally {
		spy.restore();
	}
});

Deno.test("a throttled press returns to the page with the notice and the token unspent", async () => {
	const spy = stub(
		NewsletterBackendService,
		"confirm",
		() => Promise.resolve(fail(429, { message: "Too many" })),
	);
	try {
		const res = await guarded(
			confirmApi,
			form("/api/newsletter/confirm", { token: TOKEN }, SAME_ORIGIN),
		);
		assertEquals(
			res.headers.get("location"),
			`/newsletter/confirm?token=${TOKEN}&notice=throttled`,
		);
	} finally {
		spy.restore();
	}
});
// #endregion

// #region Unsubscribe
Deno.test("an RFC 8058 one-click POST unsubscribes at once, cross-site and with no Origin", async () => {
	const spy = stub(
		NewsletterBackendService,
		"unsubscribe",
		() => Promise.resolve(ok({ outcome: "unsubscribed" as const })),
	);
	try {
		const res = await guarded(
			unsubscribeApi,
			form(`/api/newsletter/unsubscribe?token=${TOKEN}`, { "List-Unsubscribe": "One-Click" }, {
				"content-type": "application/x-www-form-urlencoded",
			}),
		);
		assertEquals(res.status, 200);
		assertEquals(await res.text(), "Unsubscribed.");
		assertSpyCallArgs(spy, 0, [TOKEN, "one_click"]);
	} finally {
		spy.restore();
	}
});

Deno.test("the unsubscribe page's button unsubscribes and returns to the page", async () => {
	const spy = stub(
		NewsletterBackendService,
		"unsubscribe",
		() => Promise.resolve(ok({ outcome: "unsubscribed" as const })),
	);
	try {
		const res = await guarded(
			unsubscribeApi,
			form("/api/newsletter/unsubscribe", { token: TOKEN }, SAME_ORIGIN),
		);
		assertEquals(res.status, 303);
		assertEquals(res.headers.get("location"), `/newsletter/unsubscribe?token=${TOKEN}`);
		assertSpyCallArgs(spy, 0, [TOKEN, "link"]);
	} finally {
		spy.restore();
	}
});

Deno.test("the one-click endpoint takes a form or nothing: a JSON or text body is a 415", async () => {
	const spy = stub(NewsletterBackendService, "unsubscribe");
	try {
		for (const type of ["application/json", "text/plain"]) {
			const res = await guarded(
				unsubscribeApi,
				new Request(`${BASE}/api/newsletter/unsubscribe?token=${TOKEN}`, {
					method: "POST",
					headers: { "content-type": type },
					body: "List-Unsubscribe=One-Click",
				}),
			);
			assertEquals(res.status, 415, type);
		}
		assertSpyCalls(spy, 0);
	} finally {
		spy.restore();
	}
});
// #endregion
