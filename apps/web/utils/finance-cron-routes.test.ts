import { assertEquals } from "@std/assert";
import { handler as payoutSchedules } from "../routes/api/finance/cron/payout-schedules.ts";
import { handler as fxFeed } from "../routes/api/finance/cron/fx.ts";

/**
 * finance-cron-routes_test — the HTTP contract of two scheduler doors: the payout schedules
 * (`POST /api/finance/cron/payout-schedules`, Decision #337, ruling M6) and the daily FX feed
 * (`POST /api/finance/cron/fx`, ruling M5 (f), FBP DB17). Each answers 404 to anything but the right
 * bearer, so an endpoint that moves money or prices it never advertises that it exists.
 */

// #region Harness
type Handler = (ctx: unknown) => Response | Promise<Response>;

const HANDLERS: unknown = payoutSchedules;
const SECRET = "f".repeat(32);
const PATH = "/api/finance/cron/payout-schedules";

function post(
	headers: HeadersInit,
	handlers: unknown = HANDLERS,
	path = PATH,
): Response | Promise<Response> {
	const url = new URL(`https://app.example.test${path}?limit=5`);
	const req = new Request(url, { method: "POST", headers });
	return (handlers as Record<string, Handler>).POST({
		req,
		url,
		params: {},
		state: {},
	});
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

Deno.test("payout schedules cron: a wrong or missing bearer is a 404 with no body", () =>
	withEnv({ FINANCE_CRON_SECRET: SECRET }, async () => {
		const attempts: HeadersInit[] = [
			{},
			{ authorization: `Bearer ${"e".repeat(32)}` },
			{ authorization: SECRET },
			{ authorization: `Basic ${SECRET}` },
		];
		for (const headers of attempts) {
			const res = await post(headers);
			assertEquals(res.status, 404, JSON.stringify(headers));
			assertEquals(await res.text(), "");
		}
	}));

Deno.test("payout schedules cron: an unset or short secret closes the route, even to its own value", () =>
	withEnv({ FINANCE_CRON_SECRET: undefined }, async () => {
		assertEquals((await post({ authorization: "Bearer " })).status, 404);
		await withEnv({ FINANCE_CRON_SECRET: "short" }, async () => {
			assertEquals((await post({ authorization: "Bearer short" })).status, 404);
		});
	}));

Deno.test("payout schedules cron: the right bearer reaches the service, which refuses while the processor is off", () =>
	withEnv({ FINANCE_CRON_SECRET: SECRET, FINANCE_BACKEND_LIVE: "false" }, async () => {
		const res = await post({ authorization: `Bearer ${SECRET}` });
		assertEquals(res.status, 503);
		assertEquals((await res.json()).ok, false);
	}));

const FX_PATH = "/api/finance/cron/fx";

Deno.test("fx feed cron: a wrong, missing or short bearer is a 404 with no body", () =>
	withEnv({ FINANCE_CRON_SECRET: SECRET }, async () => {
		const attempts: HeadersInit[] = [
			{},
			{ authorization: `Bearer ${"e".repeat(32)}` },
			{ authorization: SECRET },
			{ authorization: `Basic ${SECRET}` },
		];
		for (const headers of attempts) {
			const res = await post(headers, fxFeed, FX_PATH);
			assertEquals(res.status, 404, JSON.stringify(headers));
			assertEquals(await res.text(), "");
		}
		await withEnv({ FINANCE_CRON_SECRET: "short" }, async () => {
			assertEquals((await post({ authorization: "Bearer short" }, fxFeed, FX_PATH)).status, 404);
		});
	}));

Deno.test("fx feed cron: the right bearer reaches the service, which refuses with no database", () =>
	withEnv({ FINANCE_CRON_SECRET: SECRET, USE_MOCKS: "true" }, async () => {
		const res = await post({ authorization: `Bearer ${SECRET}` }, fxFeed, FX_PATH);
		assertEquals(res.status, 503);
		assertEquals((await res.json()).ok, false);
	}));
