import { assertEquals } from "@std/assert";
import type { WebhookOutcomeClass } from "@projective/types/ops";
import { useWebhookFailureDoor } from "../ops/OpsHealthService.ts";
import { PaymentBackendService } from "./PaymentBackendService.ts";

/*
 * OPS5: both Stripe endpoints report every non-2xx to the ops record, facts only, so a burst alerts
 * (ops.fn_watch_webhooks). A forged signature is a `signature` refusal; a delivery the ledger could not
 * record (a handler that throws, here because the database is unreachable) is a `failure` carrying the
 * event's id and type; an acknowledged delivery reports nothing.
 */

// #region Fixtures
const WEBHOOK_SECRET = "whsec_ops5FixtureNotASecret";
const THIN_SECRET = "whsec_ops5ThinFixtureNotASecret";

/** Live finance, Stripe in test mode, and a database and Stripe API that refuse every connection. */
const ENV: Record<string, string | undefined> = {
	DENO_ENV: "development",
	USE_MOCKS: "false",
	VITE_USE_MOCKS: undefined,
	FINANCE_BACKEND_LIVE: "true",
	SUPABASE_URL: "http://127.0.0.1:9",
	SUPABASE_ANON_KEY: "anon-fixture",
	SUPABASE_SERVICE_ROLE_KEY: "service-fixture",
	STRIPE_SECRET_KEY: "sk_test_ops5FixtureNotAKey",
	STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
	STRIPE_THIN_WEBHOOK_SECRET: THIN_SECRET,
	STRIPE_CONNECT_WEBHOOK_SECRET: undefined,
	STRIPE_API_BASE: "http://127.0.0.1:9",
};

async function withEnv(
	vars: Record<string, string | undefined>,
	fn: () => Promise<void>,
): Promise<void> {
	const prior = new Map<string, string | undefined>();
	for (const key of Object.keys(vars)) prior.set(key, Deno.env.get(key));
	try {
		for (const [key, value] of Object.entries(vars)) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
		await fn();
	} finally {
		for (const [key, value] of prior) {
			if (value === undefined) Deno.env.delete(key);
			else Deno.env.set(key, value);
		}
	}
}

/** Stripe's signature header: `t=<seconds>,v1=<hex HMAC-SHA256 of "<t>.<payload>">`. */
async function signed(payload: string, secret: string): Promise<string> {
	const t = Math.floor(Date.now() / 1000);
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)),
	);
	return `t=${t},v1=${Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

interface Seen {
	provider: string;
	outcome: WebhookOutcomeClass;
	status: number;
	reason: string;
	eventId?: string;
	eventType?: string;
}

async function watching(fn: (seen: Seen[]) => Promise<void>): Promise<void> {
	const seen: Seen[] = [];
	const restore = useWebhookFailureDoor((failure, outcome) => {
		seen.push({ ...failure, outcome });
		return Promise.resolve();
	});
	try {
		await withEnv(ENV, () => fn(seen));
	} finally {
		restore();
	}
}

const SETTLED = JSON.stringify({
	id: "evt_ops5settled",
	object: "event",
	api_version: "2025-03-31.basil",
	created: 1763517600,
	livemode: false,
	type: "payment_intent.succeeded",
	data: {
		object: {
			id: "pi_ops5fixture",
			object: "payment_intent",
			amount_received: 1500,
			currency: "usd",
			metadata: { projective_payment_id: "6f1b2a3c-4d5e-4f60-8a7b-9c0d1e2f3a4b" },
		},
	},
});
// #endregion

Deno.test("stripe: a forged or missing signature is a signature refusal, facts only", () =>
	watching(async (seen) => {
		const forged = await PaymentBackendService.handleStripeWebhook(SETTLED, "t=1,v1=00ff");
		const missing = await PaymentBackendService.handleStripeWebhook(SETTLED, null);
		assertEquals([forged.status, missing.status], [400, 400]);
		assertEquals(seen, [
			{ provider: "stripe", outcome: "signature", status: 400, reason: "signature_invalid" },
			{ provider: "stripe", outcome: "signature", status: 400, reason: "signature_missing" },
		]);
	}));

Deno.test("stripe: a delivery the ledger cannot record is a failure naming the event", () =>
	watching(async (seen) => {
		const res = await PaymentBackendService.handleStripeWebhook(
			SETTLED,
			await signed(SETTLED, WEBHOOK_SECRET),
		);
		assertEquals(res.status, 500);
		assertEquals(seen, [{
			provider: "stripe",
			outcome: "failure",
			status: 500,
			reason: "handler_failed",
			eventId: "evt_ops5settled",
			eventType: "payment_intent.succeeded",
		}]);
	}));

Deno.test("stripe: an acknowledged delivery reports nothing", () =>
	watching(async (seen) => {
		const ignored = JSON.stringify({
			...JSON.parse(SETTLED),
			id: "evt_ops5ignored",
			type: "customer.created",
		});
		const res = await PaymentBackendService.handleStripeWebhook(
			ignored,
			await signed(ignored, WEBHOOK_SECRET),
		);
		assertEquals(res.status, 200);
		assertEquals(seen, []);
	}));

Deno.test("stripe: an endpoint with no secret is a failure (not_configured), so a silent misconfiguration alerts", () =>
	watching(async (seen) => {
		await withEnv({ STRIPE_WEBHOOK_SECRET: undefined }, async () => {
			const res = await PaymentBackendService.handleStripeWebhook(SETTLED, "t=1,v1=00ff");
			assertEquals(res.status, 503);
		});
		assertEquals(seen, [{
			provider: "stripe",
			outcome: "failure",
			status: 503,
			reason: "not_configured",
		}]);
	}));

const THIN = JSON.stringify({
	id: "evt_ops5thin",
	object: "v2.core.event",
	type: "v2.core.account.updated",
	livemode: false,
	created: "2026-11-19T02:00:00.000Z",
	related_object: {
		id: "acct_ops5fixture",
		type: "v2.core.account",
		url: "/v2/core/accounts/acct_ops5fixture",
	},
});

Deno.test("stripe-v2: a forged signature is a signature refusal on its own provider code", () =>
	watching(async (seen) => {
		const res = await PaymentBackendService.handleStripeThinWebhook(THIN, "t=1,v1=00ff");
		assertEquals(res.status, 400);
		assertEquals(seen, [{
			provider: "stripe-v2",
			outcome: "signature",
			status: 400,
			reason: "signature_invalid",
		}]);
	}));

Deno.test("stripe-v2: an account sync that throws is a failure naming the event", () =>
	watching(async (seen) => {
		const res = await PaymentBackendService.handleStripeThinWebhook(
			THIN,
			await signed(THIN, THIN_SECRET),
		);
		assertEquals(res.status, 500);
		assertEquals(seen, [{
			provider: "stripe-v2",
			outcome: "failure",
			status: 500,
			reason: "handler_failed",
			eventId: "evt_ops5thin",
			eventType: "v2.core.account.updated",
		}]);
	}));
