import { assert, assertEquals, assertRejects } from "@std/assert";
import Stripe from "stripe";
import { parseStripeSettings, stripeIdempotencyKey, verifyStripeEvent } from "./stripe.ts";

// Shape-valid fakes: long enough to pass the key-shape rules, never real credentials.
const SK_TEST = "sk_test_" + "a".repeat(24);
const RK_LIVE = "rk_live_" + "b".repeat(24);
const PK_TEST = "pk_test_" + "c".repeat(24);
const PK_LIVE = "pk_live_" + "d".repeat(24);
const WHSEC = "whsec_" + "e".repeat(32);

Deno.test("a placeholder or a missing secret key is NOT a configured Stripe", () => {
	assertEquals(parseStripeSettings({}), null);
	assertEquals(parseStripeSettings({ secretKey: "XXXX-XXXX" }), null);
	assertEquals(parseStripeSettings({ secretKey: "sk_test_" }), null);
	assertEquals(parseStripeSettings({ secretKey: "pk_test_" + "a".repeat(24) }), null);
	// A webhook secret on its own configures nothing.
	assertEquals(parseStripeSettings({ webhookSecret: WHSEC }), null);
});

Deno.test("the mode and key kind come from the secret key's prefix", () => {
	const test = parseStripeSettings({ secretKey: SK_TEST });
	assertEquals(test?.mode, "test");
	assertEquals(test?.restricted, false);
	const live = parseStripeSettings({ secretKey: RK_LIVE });
	assertEquals(live?.mode, "live");
	assertEquals(live?.restricted, true);
});

Deno.test("a publishable key from the OTHER mode is dropped, never handed to a browser", () => {
	assertEquals(
		parseStripeSettings({ secretKey: SK_TEST, publishableKey: PK_TEST })?.publishableKey,
		PK_TEST,
	);
	assertEquals(
		parseStripeSettings({ secretKey: SK_TEST, publishableKey: PK_LIVE })?.publishableKey,
		null,
	);
	assertEquals(
		parseStripeSettings({ secretKey: SK_TEST, publishableKey: "XXXX-XXXX" })?.publishableKey,
		null,
	);
});

Deno.test("only a whsec_-shaped value counts as a webhook secret", () => {
	assertEquals(
		parseStripeSettings({ secretKey: SK_TEST, webhookSecret: WHSEC })?.webhookSecret,
		WHSEC,
	);
	assertEquals(
		parseStripeSettings({ secretKey: SK_TEST, webhookSecret: "XXXX-XXXX" })?.webhookSecret,
		null,
	);
	assertEquals(
		parseStripeSettings({ secretKey: ` ${SK_TEST} `, webhookSecret: ` ${WHSEC}\n` })?.webhookSecret,
		WHSEC,
	);
});

Deno.test("a mock API origin is honoured only for a TEST key outside production", () => {
	const mock = "http://localhost:12111";
	assertEquals(
		parseStripeSettings({ secretKey: SK_TEST, apiBase: mock, appEnv: "development" })?.apiBase,
		{ host: "localhost", port: "12111", protocol: "http" },
	);
	// A live key pointed at a mock would record charges that never happened.
	assertEquals(
		parseStripeSettings({ secretKey: RK_LIVE, apiBase: mock, appEnv: "development" })?.apiBase,
		null,
	);
	assertEquals(
		parseStripeSettings({ secretKey: SK_TEST, apiBase: mock, appEnv: "production" })?.apiBase,
		null,
	);
	assertEquals(
		parseStripeSettings({ secretKey: SK_TEST, apiBase: "ftp://x", appEnv: "development" })?.apiBase,
		null,
	);
	assertEquals(parseStripeSettings({ secretKey: SK_TEST, appEnv: "development" })?.apiBase, null);
});

Deno.test("idempotency keys are namespaced by operation and capped at Stripe's 255 characters", () => {
	assertEquals(stripeIdempotencyKey("payment_intent", "abc"), "projective:payment_intent:abc");
	assert(
		stripeIdempotencyKey("payment_intent", "abc") !==
			stripeIdempotencyKey("identity_session", "abc"),
	);
	assertEquals(stripeIdempotencyKey("x", "k".repeat(400)).length, 255);
});

// #region Signature verification
const PAYLOAD = JSON.stringify({
	id: "evt_test_1",
	object: "event",
	type: "payment_intent.succeeded",
	data: { object: {} },
});
const crypto = Stripe.createSubtleCryptoProvider();

function sign(payload: string, secret = WHSEC, timestamp?: number): Promise<string> {
	return Stripe.webhooks.generateTestHeaderStringAsync({
		payload,
		secret,
		cryptoProvider: crypto,
		timestamp,
	});
}

Deno.test("a correctly signed delivery verifies and parses", async () => {
	const event = await verifyStripeEvent(PAYLOAD, await sign(PAYLOAD), WHSEC);
	assertEquals(event.id, "evt_test_1");
	assertEquals(event.type, "payment_intent.succeeded");
});

Deno.test("a tampered body, a wrong secret or a stale timestamp is refused", async () => {
	const header = await sign(PAYLOAD);
	await assertRejects(() =>
		verifyStripeEvent(PAYLOAD.replace("evt_test_1", "evt_test_2"), header, WHSEC)
	);
	await assertRejects(() => verifyStripeEvent(PAYLOAD, header, "whsec_" + "f".repeat(32)));
	// A delivery captured an hour ago and replayed now is outside the 300 s tolerance.
	const stale = await sign(PAYLOAD, WHSEC, Math.floor(Date.now() / 1000) - 3600);
	await assertRejects(() => verifyStripeEvent(PAYLOAD, stale, WHSEC));
});

Deno.test("a re-serialised body fails even when it means the same thing — the raw bytes are signed", async () => {
	const header = await sign(PAYLOAD);
	const reserialised = JSON.stringify(JSON.parse(PAYLOAD), null, 2);
	await assertRejects(() => verifyStripeEvent(reserialised, header, WHSEC));
});
// #endregion
