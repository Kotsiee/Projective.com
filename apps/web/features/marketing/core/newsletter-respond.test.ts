import { assertEquals } from "@std/assert";
import { fail, ok } from "@server/services/ServiceResult.ts";
import { retryAfterSeconds, toNewsletterResponse } from "./newsletter-respond.ts";

/**
 * The newsletter transport: a refusal's `details` reach the HTTP body (the contract P5 builds on —
 * a rate-limited subscribe is a 429 carrying `details.retryAt`), and the 429 also says
 * `Retry-After`.
 */

Deno.test("a 429 carries details.retryAt in the body and a Retry-After header", async () => {
	const retryAt = new Date(Date.now() + 90_000).toISOString();
	const res = toNewsletterResponse(
		fail(429, { message: "Too many attempts.", details: { retryAt } }),
	);
	assertEquals(res.status, 429);
	const seconds = Number(res.headers.get("retry-after"));
	assertEquals(seconds >= 89 && seconds <= 90, true, `retry-after ${seconds}`);
	const body = await res.json();
	assertEquals(body, { ok: false, message: "Too many attempts.", details: { retryAt } });
});

Deno.test("a 503 keeps its details.code; a success carries no details and no Retry-After", async () => {
	const down = toNewsletterResponse(
		fail(503, { message: "Try again.", details: { code: "PGRST106" } }),
	);
	assertEquals((await down.json()).details, { code: "PGRST106" });
	assertEquals(down.headers.get("retry-after"), null);

	const done = toNewsletterResponse(
		ok({ email: "a@b.co", topic: "general", alreadySubscribed: false }, { message: "Thanks." }),
	);
	assertEquals(done.status, 200);
	assertEquals(done.headers.get("retry-after"), null);
	assertEquals(await done.json(), {
		ok: true,
		message: "Thanks.",
		data: { email: "a@b.co", topic: "general", alreadySubscribed: false },
	});
});

Deno.test("retryAfterSeconds rounds up, floors at one second, and ignores a non-instant", () => {
	const now = Date.parse("2026-10-17T12:00:00Z");
	assertEquals(retryAfterSeconds("2026-10-17T12:00:01.200Z", now), 2);
	assertEquals(retryAfterSeconds("2026-10-17T11:59:00Z", now), 1);
	assertEquals(retryAfterSeconds("soon", now), null);
	assertEquals(retryAfterSeconds(undefined, now), null);
});
