import { assert, assertEquals } from "@std/assert";
import { fail, ok } from "../ServiceResult.ts";
import {
	AUTH_THROTTLED_MESSAGE,
	type AuthAction,
	AuthThrottle,
	type AuthThrottleRule,
} from "./auth-throttle.ts";

/**
 * The auth throttle (IW-H3): per client address and per identifier, failures-only for credential
 * guesses, every attempt for mail senders, and a uniform 429.
 */

const RULES: Record<AuthAction, AuthThrottleRule> = {
	login: {
		client: { max: 5, windowMs: 1_000 },
		identifier: { max: 2, windowMs: 1_000, counts: "failure" },
	},
	verify: { client: { max: 5, windowMs: 1_000 } },
	reset: { client: { max: 5, windowMs: 1_000 } },
	join: {
		client: { max: 5, windowMs: 1_000 },
		identifier: { max: 2, windowMs: 1_000, counts: "every" },
	},
	resend: { client: { max: 5, windowMs: 1_000 } },
	forgot: { client: { max: 5, windowMs: 1_000 } },
	sso: { client: { max: 5, windowMs: 1_000 } },
	refresh: { client: { max: 2, windowMs: 1_000 } },
	logout: { client: { max: 5, windowMs: 1_000 } },
};

const WRONG = fail(401, { message: "Invalid credentials." });

Deno.test("login: a correct sign-in is never slowed by its identifier's history", () => {
	const throttle = new AuthThrottle(RULES);
	for (let i = 0; i < 5; i++) {
		const subject = { clientKey: `ip-${i}`, identifier: "ada@example.com" };
		assertEquals(throttle.admit("login", subject, i), null);
		throttle.record("login", subject, ok({}), i);
	}
});

Deno.test("login: failed guesses close the identifier from every client address", () => {
	const throttle = new AuthThrottle(RULES);
	for (let i = 0; i < 2; i++) {
		const subject = { clientKey: `ip-${i}`, identifier: "Ada@Example.com " };
		assertEquals(throttle.admit("login", subject, i), null);
		throttle.record("login", subject, WRONG, i);
	}
	const refused = throttle.admit("login", { clientKey: "ip-9", identifier: "ada@example.com" }, 10);
	assert(refused);
	assertEquals(refused.status, 429);
	assertEquals(refused.message, AUTH_THROTTLED_MESSAGE);
	assertEquals(refused.details?.retryAt, new Date(1_000).toISOString());
	// Another account from the same address is unaffected.
	assertEquals(
		throttle.admit("login", { clientKey: "ip-9", identifier: "bo@example.com" }, 10),
		null,
	);
});

Deno.test("login: the client bucket counts every attempt, whatever the identifier", () => {
	const throttle = new AuthThrottle(RULES);
	for (let i = 0; i < 5; i++) {
		assertEquals(throttle.admit("login", { clientKey: "ip", identifier: `u${i}` }, i), null);
	}
	assertEquals(throttle.admit("login", { clientKey: "ip", identifier: "u9" }, 6)?.status, 429);
});

Deno.test("join: every attempt counts per identifier, so one address cannot be mail-bombed", () => {
	const throttle = new AuthThrottle(RULES);
	assertEquals(throttle.admit("join", { clientKey: "a", identifier: "x@y.z" }, 0), null);
	assertEquals(throttle.admit("join", { clientKey: "b", identifier: "x@y.z" }, 1), null);
	assertEquals(throttle.admit("join", { clientKey: "c", identifier: "x@y.z" }, 2)?.status, 429);
	// The refusal on the identifier did not spend client c's allowance.
	for (let i = 0; i < 5; i++) {
		assertEquals(throttle.admit("join", { clientKey: "c", identifier: `n${i}@y.z` }, 3), null);
	}
});

Deno.test("record ignores outages: only a wrong credential counts against the identifier", () => {
	const throttle = new AuthThrottle(RULES);
	const subject = { clientKey: "ip", identifier: "ada@example.com" };
	for (let i = 0; i < 4; i++) throttle.record("login", subject, fail(503, {}), i);
	assertEquals(throttle.admit("login", subject, 5), null);
});

Deno.test("actions without an identifier rule count per client address only", () => {
	const throttle = new AuthThrottle(RULES);
	assertEquals(throttle.admit("refresh", { clientKey: "ip" }, 0), null);
	assertEquals(throttle.admit("refresh", { clientKey: "ip" }, 1), null);
	assertEquals(throttle.admit("refresh", { clientKey: "ip" }, 2)?.status, 429);
	assertEquals(throttle.admit("refresh", { clientKey: "other" }, 2), null);
	throttle.reset();
	assertEquals(throttle.admit("refresh", { clientKey: "ip" }, 3), null);
});
