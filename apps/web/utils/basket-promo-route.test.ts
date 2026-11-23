import { assertEquals } from "@std/assert";
import type { UserContext } from "@projective/types/auth";
import { handler } from "../routes/api/basket/promo.ts";
import { PROMO_THROTTLE_RULES, promoThrottle } from "@server/services/finance/promo-throttle.ts";
import type { State } from "./state.ts";

/**
 * basket-promo-route_test — `POST /api/basket/promo` is throttled per account and per client address
 * (FINANCE_AUDIT CO22, MARKETPLACE CK2): a burst of code attempts draws 429s with `Retry-After`, and
 * clearing a code is never counted. Tokenless, so an admitted attempt stops at the service's sign-in
 * check and nothing reaches the database.
 */

type Handler = (ctx: unknown) => Response | Promise<Response>;

const BUYER = { userId: "u-buyer", contextType: "personal", contextId: "u-buyer" } as UserContext;

function post(body: unknown, hostname: string, state: State = { userContext: BUYER }) {
	const url = new URL("https://app.example.test/api/basket/promo");
	const req = new Request(url, { method: "POST", body: JSON.stringify(body) });
	return (handler as unknown as Record<string, Handler>).POST({
		req,
		url,
		params: {},
		state,
		info: { remoteAddr: { transport: "tcp", hostname, port: 40000 } },
	});
}

Deno.test("promo route: a 30-request burst of codes draws 429s with Retry-After", async () => {
	promoThrottle.reset();
	const statuses: number[] = [];
	let retryAfter: string | null = null;
	for (let i = 0; i < 30; i++) {
		const res = await post({ basketId: "bsk-1", code: `GUESS${i}` }, "10.1.0.1");
		statuses.push(res.status);
		if (res.status === 429) retryAfter ??= res.headers.get("retry-after");
		await res.body?.cancel();
	}
	const refused = statuses.filter((s) => s === 429).length;
	assertEquals(refused, 30 - PROMO_THROTTLE_RULES.account.max);
	assertEquals(statuses.slice(0, PROMO_THROTTLE_RULES.account.max).includes(429), false);
	assertEquals(Number(retryAfter) > 0, true);
	promoThrottle.reset();
});

Deno.test("promo route: clearing a code is never throttled", async () => {
	promoThrottle.reset();
	for (let i = 0; i < PROMO_THROTTLE_RULES.account.max; i++) {
		await (await post({ basketId: "bsk-1", code: `GUESS${i}` }, "10.1.0.2")).body?.cancel();
	}
	const guess = await post({ basketId: "bsk-1", code: "ONE-MORE" }, "10.1.0.2");
	const clear = await post({ basketId: "bsk-1", code: null }, "10.1.0.2");
	assertEquals(guess.status, 429);
	assertEquals(clear.status === 429, false);
	await guess.body?.cancel();
	await clear.body?.cancel();
	promoThrottle.reset();
});
