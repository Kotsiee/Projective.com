import { assertEquals } from "@std/assert";
import { SlidingWindowLimiter } from "../../core/rate-limit.ts";
import {
	mintPendingVerification,
	pendingVerificationKey,
} from "../../core/pending-verification.ts";
import {
	resolveVerificationStatus,
	VERIFICATION_POLL_RULE,
	type VerificationPollDeps,
	type VerificationPollInput,
} from "./verification-status.ts";

/**
 * `/verify`'s confirmation poll (Decision #185). The endpoint used to take a bare `email` and answer
 * from a service-role read, so anyone could ask whether an address had a (confirmed) account. These
 * pin the replacement: only the signed pending cookie names a subject, everything else gets one
 * uniform body, and polling is rate-limited.
 */

const USER = "6f1c2a7e-3b4d-4c5e-8f90-a1b2c3d4e5f6";
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0);
const UNIFORM = { verified: false, redirectTo: "/home" };

interface Harness {
	deps: VerificationPollDeps;
	lookups: string[];
}

async function harness(confirmed: Set<string>, rootSecret = "server-root"): Promise<Harness> {
	const lookups: string[] = [];
	return {
		lookups,
		deps: {
			key: await pendingVerificationKey(rootSecret),
			limiter: new SlidingWindowLimiter(VERIFICATION_POLL_RULE),
			isConfirmed: (userId) => {
				lookups.push(userId);
				return Promise.resolve(confirmed.has(userId));
			},
			now: () => NOW,
		},
	};
}

function poll(overrides: Partial<VerificationPollInput> = {}): VerificationPollInput {
	return { clientKey: "203.0.113.7", hasSession: false, redirectTo: "/home", ...overrides };
}

// #region Unknown email
Deno.test("a caller with only an email (known or unknown) gets the uniform answer and no lookup", async () => {
	const h = await harness(new Set([USER]));
	// The input has no email field at all: whatever address a caller puts in the query string never
	// reaches the service, so a registered address and an unregistered one cannot answer differently.
	const result = await resolveVerificationStatus(poll(), h.deps);
	assertEquals(result.ok, true);
	assertEquals(result.status, 200);
	assertEquals(result.data, UNIFORM);
	assertEquals(h.lookups, []);
});

Deno.test("an unbound caller's body is identical to a still-pending account's", async () => {
	const h = await harness(new Set());
	const token = await mintPendingVerification(USER, h.deps.key!, NOW);
	const pending = await resolveVerificationStatus(poll({ pendingToken: token }), h.deps);
	const unbound = await resolveVerificationStatus(poll({ clientKey: "198.51.100.1" }), h.deps);
	assertEquals(pending, unbound);
	assertEquals(h.lookups, [USER]);
});
// #endregion

// #region Mismatched cookie
Deno.test("a cookie minted under another key earns the uniform answer and no lookup", async () => {
	const h = await harness(new Set([USER]));
	const foreign = await mintPendingVerification(
		USER,
		await pendingVerificationKey("someone-else"),
		NOW,
	);
	const result = await resolveVerificationStatus(poll({ pendingToken: foreign }), h.deps);
	assertEquals(result.data, UNIFORM);
	assertEquals(h.lookups, []);
});

Deno.test("a cookie whose user id was swapped earns the uniform answer and no lookup", async () => {
	const h = await harness(new Set([USER, "0a0b0c0d-1e1f-4a2b-8c3d-4e5f60718293"]));
	const token = await mintPendingVerification(USER, h.deps.key!, NOW);
	const swapped = token.replace(USER, "0a0b0c0d-1e1f-4a2b-8c3d-4e5f60718293");
	const result = await resolveVerificationStatus(poll({ pendingToken: swapped }), h.deps);
	assertEquals(result.data, UNIFORM);
	assertEquals(h.lookups, []);
});

Deno.test("an expired cookie earns the uniform answer and no lookup", async () => {
	const h = await harness(new Set([USER]));
	const stale = await mintPendingVerification(USER, h.deps.key!, NOW - 2 * 60 * 60 * 1000);
	const result = await resolveVerificationStatus(poll({ pendingToken: stale }), h.deps);
	assertEquals(result.data, UNIFORM);
	assertEquals(h.lookups, []);
});

Deno.test("with no server key every cookie is ignored", async () => {
	const h = await harness(new Set([USER]));
	const token = await mintPendingVerification(USER, h.deps.key!, NOW);
	const result = await resolveVerificationStatus(poll({ pendingToken: token }), {
		...h.deps,
		key: null,
	});
	assertEquals(result.data, UNIFORM);
	assertEquals(h.lookups, []);
});
// #endregion

// #region Rate limit
Deno.test("polls past the ceiling are refused with 429 and a retry time, per pending account", async () => {
	const h = await harness(new Set());
	const token = await mintPendingVerification(USER, h.deps.key!, NOW);
	for (let i = 0; i < VERIFICATION_POLL_RULE.max; i++) {
		// A cookie holder moving between addresses still spends one allowance.
		const ok = await resolveVerificationStatus(
			poll({ pendingToken: token, clientKey: `10.0.0.${i}` }),
			h.deps,
		);
		assertEquals(ok.status, 200);
	}
	const refused = await resolveVerificationStatus(poll({ pendingToken: token }), h.deps);
	assertEquals(refused.ok, false);
	assertEquals(refused.status, 429);
	assertEquals(
		refused.details?.retryAt,
		new Date(NOW + VERIFICATION_POLL_RULE.windowMs).toISOString(),
	);
	assertEquals(h.lookups.length, VERIFICATION_POLL_RULE.max);
});

Deno.test("unbound polls are limited per client address", async () => {
	const h = await harness(new Set());
	for (let i = 0; i < VERIFICATION_POLL_RULE.max; i++) {
		assertEquals((await resolveVerificationStatus(poll(), h.deps)).status, 200);
	}
	assertEquals((await resolveVerificationStatus(poll(), h.deps)).status, 429);
	assertEquals(
		(await resolveVerificationStatus(poll({ clientKey: "198.51.100.1" }), h.deps)).status,
		200,
	);
});
// #endregion

// #region Success path
Deno.test("a confirmed account polled from a signed-in browser continues in", async () => {
	const h = await harness(new Set([USER]));
	const token = await mintPendingVerification(USER, h.deps.key!, NOW);
	const result = await resolveVerificationStatus(
		poll({ pendingToken: token, hasSession: true }),
		h.deps,
	);
	assertEquals(result.ok, true);
	assertEquals(result.data, { verified: true, signedIn: true, redirectTo: "/home" });
	assertEquals(h.lookups, [USER]);
});

Deno.test("a confirmed account polled from a browser without a session is told to sign in", async () => {
	const h = await harness(new Set([USER]));
	const token = await mintPendingVerification(USER, h.deps.key!, NOW);
	const result = await resolveVerificationStatus(poll({ pendingToken: token }), h.deps);
	assertEquals(result.data, { verified: true, signedIn: false, redirectTo: "/home" });
});

Deno.test("a failed confirmation lookup is a 503, not a false 'pending'", async () => {
	const h = await harness(new Set());
	const token = await mintPendingVerification(USER, h.deps.key!, NOW);
	const result = await resolveVerificationStatus(poll({ pendingToken: token }), {
		...h.deps,
		isConfirmed: () => Promise.reject(new Error("GoTrue unreachable")),
	});
	assertEquals(result.ok, false);
	assertEquals(result.status, 503);
});
// #endregion
