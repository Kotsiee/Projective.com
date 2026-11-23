import { assertEquals } from "@std/assert";
import { PROMO_THROTTLE_RULES, PromoThrottle, retryAfterSeconds } from "./promo-throttle.ts";

Deno.test("promo throttle: a 30-attempt burst from one account draws 429s after its ceiling", () => {
	const throttle = new PromoThrottle();
	const now = Date.UTC(2026, 10, 23, 12);
	const answers = Array.from(
		{ length: 30 },
		(_, i) => throttle.admit({ account: "u1", clientKey: "10.0.0.1" }, now + i),
	);
	const admitted = answers.filter((a) => a === null).length;
	assertEquals(admitted, PROMO_THROTTLE_RULES.account.max);
	const refused = answers.find((a) => a !== null)!;
	assertEquals(refused.status, 429);
	assertEquals(retryAfterSeconds(refused, now + 29) > 0, true);
});

Deno.test("promo throttle: one client address cannot spread a burst across accounts", () => {
	const throttle = new PromoThrottle();
	const now = Date.UTC(2026, 10, 23, 12);
	const answers = Array.from(
		{ length: 30 },
		(_, i) => throttle.admit({ account: `u${i}`, clientKey: "10.0.0.2" }, now + i),
	);
	assertEquals(answers.filter((a) => a === null).length, PROMO_THROTTLE_RULES.client.max);
});

Deno.test("promo throttle: the window slides open again", () => {
	const throttle = new PromoThrottle({
		account: { max: 1, windowMs: 1000 },
		client: { max: 5, windowMs: 1000 },
	});
	const subject = { account: "u1", clientKey: "10.0.0.3" };
	assertEquals(throttle.admit(subject, 0), null);
	assertEquals(throttle.admit(subject, 10)?.status, 429);
	assertEquals(throttle.admit(subject, 1001), null);
});
