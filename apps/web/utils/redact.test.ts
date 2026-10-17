import { assertEquals } from "@std/assert";
import { isSecretKey, REDACTED, redactFormString, redactSecrets, redactUrl } from "./redact.ts";

Deno.test("redact: a login body keeps the email and loses the password", () => {
	const body = { email: "chloe@projective.dev", password: "hunter2" };
	assertEquals(redactSecrets(body), { email: "chloe@projective.dev", password: REDACTED });
	// The input is never mutated — the live request body still carries the real value.
	assertEquals(body.password, "hunter2");
});

Deno.test("redact: secrets are found at any depth, inside arrays too", () => {
	const response = {
		ok: true,
		session: { access_token: "a", refresh_token: "r", user: { id: "u1", email: "x@y.z" } },
		intents: [{ id: "pi_1", client_secret: "pi_1_secret_abc", amount: 500 }],
	};
	assertEquals(redactSecrets(response), {
		ok: true,
		session: {
			access_token: REDACTED,
			refresh_token: REDACTED,
			user: { id: "u1", email: "x@y.z" },
		},
		intents: [{ id: "pi_1", client_secret: REDACTED, amount: 500 }],
	});
});

Deno.test("redact: secret key names across casing conventions", () => {
	for (
		const key of [
			"password",
			"newPassword",
			"current_password",
			"passcode",
			"secret",
			"clientSecret",
			"client_secret",
			"token",
			"idToken",
			"otp",
			"OTP",
			"code",
			"otpCode",
			"verification_code",
			"authCode",
			"reset-code",
		]
	) {
		assertEquals(isSecretKey(key), true, key);
	}
});

Deno.test("redact: ordinary data that merely ends in `code` stays readable", () => {
	for (
		const key of [
			"currencyCode",
			"currency_code",
			"postcode",
			"planCode",
			"promoCode",
			"statusCode",
			"email",
			"id",
		]
	) {
		assertEquals(isSecretKey(key), false, key);
	}
	const body = { amount: 1200, currencyCode: "GBP", address: { postcode: "EC1A 1AA" } };
	assertEquals(redactSecrets(body), body);
});

Deno.test("redact: a whole secret subtree is replaced, not walked", () => {
	assertEquals(redactSecrets({ tokens: { access: "a", refresh: "r" } }), { tokens: REDACTED });
});

Deno.test("redact: primitives, null and undefined pass through", () => {
	assertEquals(redactSecrets(undefined), undefined);
	assertEquals(redactSecrets(null), null);
	assertEquals(redactSecrets(42), 42);
	assertEquals(redactSecrets("plain text"), "plain text");
});

Deno.test("redact: cycles are cut, shared references are not mistaken for cycles", () => {
	const shared = { id: "s" };
	const cyclic: Record<string, unknown> = { name: "root", a: shared, b: shared };
	cyclic.self = cyclic;
	assertEquals(redactSecrets(cyclic), {
		name: "root",
		a: { id: "s" },
		b: { id: "s" },
		self: "[circular]",
	});
});

Deno.test("redact: form-encoded bodies have their secret params redacted", () => {
	assertEquals(
		redactFormString("email=a%40b.c&password=hunter2"),
		"email=a%40b.c&password=%5Bredacted%5D",
	);
	assertEquals(redactFormString("email=a%40b.c&remember=1"), "email=a%40b.c&remember=1");
	// Prose that happens to contain `=` is left alone.
	assertEquals(redactFormString("a = b and password = c"), "a = b and password = c");
	assertEquals(redactSecrets({ raw: "password=x" }), { raw: "password=%5Bredacted%5D" });
});

Deno.test("redact: secret query params are redacted, the rest of the URL is kept", () => {
	assertEquals(
		redactUrl("/api/settings/email/confirm?token=abc&next=%2Fsettings#top"),
		"/api/settings/email/confirm?token=%5Bredacted%5D&next=%2Fsettings#top",
	);
	assertEquals(
		redactUrl("https://app.test/auth/callback?code=xyz"),
		"https://app.test/auth/callback?code=%5Bredacted%5D",
	);
	assertEquals(redactUrl("/api/wallet?currency_code=GBP"), "/api/wallet?currency_code=GBP");
	assertEquals(redactUrl("/api/wallet"), "/api/wallet");
});
