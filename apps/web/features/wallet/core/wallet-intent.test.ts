import { assertEquals } from "@std/assert";
import { backLabelFor, safeBack, walletIntentHref, walletIntentOf } from "./wallet-intent.ts";

/**
 * A wallet intent link opens one action on one wallet and returns to the checkout that sent it
 * (Decision #243). `back` arrives in a URL, so only a same-origin `/checkout` path survives.
 */

const BUSINESS = "business:edb582e0-25d2-48a3-a0db-4a96f1d1a8d1";
const BACK =
	"/checkout/payment?basket=55ed9bd6-ec5d-4937-a473-6140d634d1e9&owner=business:edb582e0";

Deno.test("walletIntentHref → walletIntentOf round-trips the wallet, the action and the way back", () => {
	const href = walletIntentHref(BUSINESS, "top_up", BACK);
	const url = new URL(href, "https://projective.test");
	assertEquals(url.pathname, "/wallet");
	assertEquals(url.searchParams.get("w"), BUSINESS);
	assertEquals(walletIntentOf(url.searchParams), { action: "top_up", back: BACK });
});

Deno.test("safeBack refuses anything that could leave the checkout", () => {
	for (
		const raw of [
			"//evil.com",
			"https://evil.com/checkout",
			"/\\evil.com",
			"/settings",
			"/checkouts",
			"javascript:alert(1)",
			"checkout",
			"/checkout\u0000",
			"",
			null,
		]
	) {
		assertEquals(safeBack(raw), null, String(raw));
	}
	assertEquals(safeBack("/checkout"), "/checkout");
	assertEquals(safeBack("/checkout/payment?basket=x"), "/checkout/payment?basket=x");
});

Deno.test("an unsafe back is dropped from the link, and an unknown action is no intent", () => {
	const href = walletIntentHref(BUSINESS, "top_up", "https://evil.com");
	assertEquals(new URL(href, "https://projective.test").searchParams.has("back"), false);
	assertEquals(walletIntentOf(new URLSearchParams("do=drain_everything")).action, null);
	assertEquals(walletIntentOf(new URLSearchParams("do=request_spend")).action, null);
	assertEquals(walletIntentOf(new URLSearchParams("")), { action: null, back: null });
});

Deno.test("a business's Billing module is a way back — exactly that page, nothing beside it (BU3, #247)", () => {
	assertEquals(safeBack("/businesses/heliafinance/billing"), "/businesses/heliafinance/billing");
	assertEquals(
		safeBack("/businesses/helia-finance/billing?x=1"),
		"/businesses/helia-finance/billing?x=1",
	);
	assertEquals(safeBack("/businesses/abc/billing#pay"), "/businesses/abc/billing#pay");
	for (
		const raw of [
			"/businesses/heliafinance/spend",
			"/businesses/heliafinance/billing/more",
			"/businesses/heliafinance/billingx",
			"/businesses//billing",
			"/businesses/ab/billing",
			"/businesses/Helia/billing",
			"/businesses/helia finance/billing",
			"/businesses/-helia/billing",
			"/businesses/heliafinance",
			"https://evil.com/businesses/heliafinance/billing",
			"//evil.com/businesses/heliafinance/billing",
			"/teams/heliafinance/billing",
		]
	) {
		assertEquals(safeBack(raw), null, raw);
	}
});

Deno.test("the way back is named for where it returns", () => {
	assertEquals(backLabelFor("/checkout/payment?basket=x"), "Back to checkout");
	assertEquals(backLabelFor("/businesses/heliafinance/billing"), "Back to billing");
});

Deno.test("the Billing module's Top up round-trips the business wallet, top_up and its way back", () => {
	const back = "/businesses/heliafinance/billing";
	const url = new URL(walletIntentHref(BUSINESS, "top_up", back), "https://projective.test");
	assertEquals(url.searchParams.get("w"), BUSINESS);
	assertEquals(walletIntentOf(url.searchParams), { action: "top_up", back });
});
