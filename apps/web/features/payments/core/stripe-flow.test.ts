import { assertEquals } from "@std/assert";
import { CARD_SETUP_PAYMENT_METHOD_TYPES } from "@projective/types/finance";
import {
	cardSetupElementsOptions,
	returnPathOf,
	stripeReturnOf,
	withoutStripeReturn,
} from "./stripe-flow.ts";

Deno.test("the deferred card form is setup mode, card-only and lowercases its currency", () => {
	assertEquals(cardSetupElementsOptions(" GBP "), {
		mode: "setup",
		currency: "gbp",
		allowedPaymentMethodTypes: [...CARD_SETUP_PAYMENT_METHOD_TYPES],
	});
	assertEquals(cardSetupElementsOptions("usd").allowedPaymentMethodTypes, ["card"]);
});

Deno.test("a setup return is read off the address; a malformed or status-less one is ignored", () => {
	const setup = new URLSearchParams(
		"w=team%3Aabc&setup_intent=seti_123&setup_intent_client_secret=seti_123_secret_x&redirect_status=succeeded",
	);
	assertEquals(stripeReturnOf(setup), {
		kind: "setup",
		intentId: "seti_123",
		status: "succeeded",
	});
	assertEquals(
		stripeReturnOf(new URLSearchParams("payment_intent=pi_9&redirect_status=failed")),
		{ kind: "payment", intentId: "pi_9", status: "failed" },
	);
	assertEquals(stripeReturnOf(new URLSearchParams("setup_intent=seti_123")), null);
	assertEquals(
		stripeReturnOf(new URLSearchParams("setup_intent=evil%27&redirect_status=succeeded")),
		null,
	);
	assertEquals(stripeReturnOf(new URLSearchParams("w=personal")), null);
});

Deno.test("stripping a return removes ONLY Stripe's params and keeps the wallet scope", () => {
	const url = new URL(
		"https://app.test/wallet/transactions?w=team%3Aabc&display=GBP&setup_intent=seti_1&setup_intent_client_secret=s&redirect_status=succeeded&flow=90d#methods",
	);
	const clean = withoutStripeReturn(url);
	assertEquals(clean.pathname, "/wallet/transactions");
	assertEquals(clean.hash, "#methods");
	assertEquals(
		[...clean.searchParams.entries()],
		[["w", "team:abc"], ["display", "GBP"], ["flow", "90d"]],
	);
	const untouched = new URL("https://app.test/wallet?w=personal");
	assertEquals(withoutStripeReturn(untouched).href, untouched.href);
});

Deno.test("the return path is the page in view with its query, never a bare /wallet", () => {
	assertEquals(
		returnPathOf({ pathname: "/wallet", search: "?w=team:abc&display=GBP" }),
		"/wallet?w=team:abc&display=GBP",
	);
	assertEquals(returnPathOf({ pathname: "/checkout/pay", search: "" }), "/checkout/pay");
	assertEquals(
		returnPathOf({
			pathname: "/wallet",
			search: "?w=personal&payment_intent=pi_1&redirect_status=failed",
		}),
		"/wallet?w=personal",
	);
	assertEquals(
		returnPathOf({ pathname: "/wallet", search: "?setup_intent=seti_1&redirect_status=failed" }),
		"/wallet",
	);
});
