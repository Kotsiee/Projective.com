import { assertEquals, assertStrictEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { handler as callback } from "../routes/api/integrations/callback.ts";
import { handler as channels } from "../routes/api/integrations/cron/channels.ts";
import { handler as refresh } from "../routes/api/integrations/cron/refresh.ts";
import { handler as webhook } from "../routes/api/integrations/webhooks/[provider].ts";
import { handler as oldWebhook } from "../routes/api/sessions/webhooks/[provider].ts";

/**
 * integrations-routes_test — the HTTP contract of the connector routes: what goes over the wire, which
 * the fat service's own tests cannot see (`packages/backend/services/integrations`).
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const SECRET = "c".repeat(32);
const ALICE = { userId: "u-alice", contextType: "personal", contextId: "u-alice" } as UserContext;

function call(
	handlers: unknown,
	method: string,
	path: string,
	init: {
		headers?: HeadersInit;
		body?: string;
		params?: Record<string, string>;
		state?: Record<string, unknown>;
	} = {},
): Response | Promise<Response> {
	const url = new URL(`https://app.example.test${path}`);
	const req = new Request(url, { method, headers: init.headers, body: init.body });
	const fn = (handlers as Record<string, Handler>)[method];
	return fn({ req, url, params: init.params ?? {}, state: init.state ?? {} });
}

/** Run `body` with an environment, restoring it after. */
async function withEnv(env: Record<string, string | undefined>, body: () => Promise<void>) {
	const saved = Object.keys(env).map((name) => [name, Deno.env.get(name)] as const);
	const apply = (name: string, value: string | undefined) =>
		value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
	for (const [name, value] of Object.entries(env)) apply(name, value);
	try {
		await body();
	} finally {
		for (const [name, value] of saved) apply(name, value);
	}
}
// #endregion

// #region Cron
Deno.test("cron: a wrong or missing bearer is a 404 on both routes, with no body", () =>
	withEnv({ INTEGRATIONS_CRON_SECRET: SECRET }, async () => {
		for (const [route, path] of [[refresh, "refresh"], [channels, "channels"]] as const) {
			const attempts: HeadersInit[] = [{}, { authorization: `Bearer ${"d".repeat(32)}` }];
			for (const headers of attempts) {
				const res = await call(route, "POST", `/api/integrations/cron/${path}`, { headers });
				assertEquals(res.status, 404, path);
				assertEquals(await res.text(), "");
			}
		}
	}));

Deno.test("cron: an unset secret closes both routes, even to an empty bearer", () =>
	withEnv({ INTEGRATIONS_CRON_SECRET: undefined }, async () => {
		const headers = { authorization: "Bearer " };
		assertEquals(
			(await call(refresh, "POST", "/api/integrations/cron/refresh", { headers })).status,
			404,
		);
		assertEquals(
			(await call(channels, "POST", "/api/integrations/cron/channels", { headers })).status,
			404,
		);
	}));

Deno.test("cron: the right bearer reaches the service, which refuses while the gate is off", () =>
	withEnv({ INTEGRATIONS_CRON_SECRET: SECRET, INTEGRATIONS_BACKEND_LIVE: "false" }, async () => {
		const headers = { authorization: `Bearer ${SECRET}` };
		const res = await call(refresh, "POST", "/api/integrations/cron/refresh?limit=5", { headers });
		assertEquals(res.status, 503);
		assertEquals((await res.json()).ok, false);
	}));
// #endregion

// #region Webhook
Deno.test("webhook: the old presence path is the same handler", () => {
	assertStrictEquals(oldWebhook, webhook);
});

Deno.test("webhook: Graph's handshake comes back as text/plain, with sniffing off", async () => {
	const res = await call(
		webhook,
		"POST",
		"/api/integrations/webhooks/outlook?validationToken=abc",
		{
			params: { provider: "outlook" },
		},
	);
	assertEquals(res.status, 200);
	assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
	assertEquals(res.headers.get("x-content-type-options"), "nosniff");
	assertEquals(res.headers.get("cache-control"), "no-store");
	assertEquals(await res.text(), "abc");
});

Deno.test("webhook: a bad signature is refused as a JSON body, an unknown provider as a 404", () =>
	withEnv({ ZOOM_WEBHOOK_SECRET: "zoom-webhook-secret" }, async () => {
		const forged = await call(webhook, "POST", "/api/sessions/webhooks/zoom", {
			params: { provider: "zoom" },
			body: "{}",
			headers: { "x-zm-request-timestamp": "1", "x-zm-signature": "v0=00" },
		});
		assertEquals(forged.status, 400);
		assertEquals((await forged.json()).received, false);
		const unknown = await call(webhook, "POST", "/api/integrations/webhooks/nope", {
			params: { provider: "nope" },
			body: "{}",
		});
		assertEquals(unknown.status, 404);
		await unknown.body?.cancel();
	}));

Deno.test("webhook: a body over the cap is a 413, on the header and on the bytes", async () => {
	const big = "x".repeat(262_145);
	const res = await call(webhook, "POST", "/api/integrations/webhooks/zoom", {
		params: { provider: "zoom" },
		body: big,
	});
	assertEquals(res.status, 413);
	await res.body?.cancel();
});
// #endregion

// #region Callback
Deno.test("callback: no state lands on Settings with only a coarse marker", async () => {
	const res = await call(callback, "GET", "/api/integrations/callback?code=abc");
	assertEquals(res.status, 302);
	assertEquals(res.headers.get("location"), "https://app.example.test/settings?connect=failed");
});

Deno.test("callback: a declined consent returns to the stored path, never one from the request", () =>
	withEnv({
		USE_MOCKS: undefined,
		VITE_USE_MOCKS: undefined,
		INTEGRATIONS_BACKEND_LIVE: "true",
		SUPABASE_URL: "http://postgrest.fake",
		SUPABASE_ANON_KEY: "XXXX-XXXX",
		SUPABASE_SERVICE_ROLE_KEY: "XXXX-XXXX",
		ENCRYPTION_KEY: "ab".repeat(32),
	}, async () => {
		const realFetch = globalThis.fetch;
		const row = {
			user_id: ALICE.userId,
			provider_slug: "google",
			code_verifier: null,
			requested_kinds: [],
			return_to: "/calendar",
		};
		globalThis.fetch = () => Promise.resolve(Response.json(row));
		try {
			const path = `/api/integrations/callback?state=${
				"s".repeat(43)
			}&error=access_denied&returnTo=//evil.example`;
			const res = await call(callback, "GET", path, { state: { userContext: ALICE } });
			assertEquals(res.status, 302);
			assertEquals(res.headers.get("location"), "https://app.example.test/calendar?connect=failed");
			const stranger = await call(callback, "GET", path);
			assertEquals(
				stranger.headers.get("location"),
				"https://app.example.test/settings?connect=failed",
			);
		} finally {
			globalThis.fetch = realFetch;
		}
	}));
// #endregion
