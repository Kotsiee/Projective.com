import { assertEquals } from "@std/assert";
import type { BasketItem, CheckoutPayIn } from "../types/checkout-types.ts";
import {
	basketHref,
	buildCheckoutQuery,
	carriedParams,
	checkoutStepHref,
	detailsEditHref,
	fundingNote,
	payInHrefs,
	payInParamOf,
	payInRedirect,
	withCarry,
	withContext,
} from "./basket-model.ts";

/*
 * The write echo (Decision #70(k)): every basket write names the basket the caller is looking at and
 * whose money it is, so the basket it answers with is that one — not the line's own basket, and not
 * the acting context's default owner.
 */

const CTX = { basketId: "bk-wishlist", owner: "personal", display: "GBP" } as const;

Deno.test("a write carries the viewed basket and the owner, personal included", () => {
	assertEquals(withContext({ basketItemId: "line-1", savedForLater: true }, CTX), {
		basketId: "bk-wishlist",
		basketItemId: "line-1",
		savedForLater: true,
		owner: "personal",
		display: "GBP",
	});
});

Deno.test("a payload's own basketId wins over the context's", () => {
	const body = withContext({ basketId: null, itemType: "digital_product", itemId: "x" }, CTX);
	assertEquals(body.basketId, null);
	assertEquals(body.owner, "personal");
});

Deno.test("reads and links keep a personal owner", () => {
	assertEquals(new URLSearchParams(buildCheckoutQuery(CTX)).get("owner"), "personal");
	assertEquals(basketHref("bk-1", "personal"), "/checkout?basket=bk-1&owner=personal");
	assertEquals(basketHref(null, "team:t1"), "/checkout?owner=team%3At1");
});

function line(patch: Partial<BasketItem>): BasketItem {
	return {
		itemType: "project_ticket",
		title: "Hero section",
		ticketId: null,
		available: true,
		metadata: {},
		...patch,
	} as BasketItem;
}

Deno.test("funding note: a ticket funds its holder and is held in escrow", () => {
	assertEquals(
		fundingNote(line({ ticketId: "tkt-1", metadata: { payeeName: "Juno Park" } })),
		"Funds Juno Park to start Hero section. Held in escrow until you approve the work.",
	);
	assertEquals(fundingNote(line({ ticketId: "tkt-1", available: false })), null);
});

Deno.test("funding note: sessions are held in escrow, products say nothing", () => {
	assertEquals(
		fundingNote(line({ itemType: "service_session" })),
		"Held in escrow until after the session.",
	);
	assertEquals(fundingNote(line({ itemType: "digital_product" })), null);
});

Deno.test("a link back into the flow carries the display currency and dev axes, never one-shot params", () => {
	const sp = new URLSearchParams(
		"basket=bk-1&owner=personal&display=EUR&simCards=none&edit=1&order=o-9&redirect_status=succeeded&pay=p",
	);
	assertEquals(carriedParams(sp), { display: "EUR", simCards: "none" });
	assertEquals(carriedParams(new URLSearchParams("")), {});
});

Deno.test("withCarry appends the carry and never overwrites a param the href names", () => {
	assertEquals(withCarry("/checkout/payment", { display: "EUR" }), "/checkout/payment?display=EUR");
	assertEquals(
		withCarry("/checkout/payment?basket=bk-1&display=GBP", { display: "EUR", simCards: "none" }),
		"/checkout/payment?basket=bk-1&display=GBP&simCards=none",
	);
	assertEquals(withCarry("/checkout"), "/checkout");
});

Deno.test("the Details step is reopened with edit=1 and keeps the basket, owner, narrowing and carry", () => {
	const href = detailsEditHref("bk-1", "team:northwind", { ticketId: "tkt-abc" }, {
		display: "EUR",
	});
	const url = new URL(href, "http://localhost");
	assertEquals(url.pathname, "/checkout/details");
	assertEquals(url.searchParams.get("edit"), "1");
	assertEquals(url.searchParams.get("basket"), "bk-1");
	assertEquals(url.searchParams.get("owner"), "team:northwind");
	assertEquals(url.searchParams.get("ticket_id"), "tkt-abc");
	assertEquals(url.searchParams.get("display"), "EUR");
});

Deno.test("a forward step href never carries edit=1", () => {
	const href = checkoutStepHref("payment", "bk-1", "personal", { serviceId: "svc-1" });
	assertEquals(new URL(href, "http://localhost").searchParams.has("edit"), false);
});

const CONVERTING: CheckoutPayIn = {
	selected: "GBP",
	billing: "GBP",
	order: "EUR",
	conversion: true,
	reason: null,
};
const OPTED_OUT: CheckoutPayIn = { ...CONVERTING, selected: "EUR" };
const UNOFFERED: CheckoutPayIn = {
	...CONVERTING,
	selected: "EUR",
	conversion: false,
	reason: "Not now.",
};

Deno.test("#435: pay_in is carried only when the buyer chose the order's currency over a conversion", () => {
	assertEquals(payInParamOf(CONVERTING), null);
	assertEquals(payInParamOf(OPTED_OUT), "EUR");
	assertEquals(payInParamOf(UNOFFERED), null);
	assertEquals(payInParamOf({ ...CONVERTING, order: "GBP" }), null);
	assertEquals(payInParamOf(null), null);
	assertEquals(
		new URLSearchParams(buildCheckoutQuery({ ...CTX, payIn: "EUR" })).get("pay_in"),
		"EUR",
	);
	assertEquals(withContext({}, { ...CTX, payIn: "EUR" }).payIn, "EUR");
	assertEquals(carriedParams(new URLSearchParams("pay_in=EUR&edit=1")), { pay_in: "EUR" });
});

Deno.test("#435: each currency the order may be paid in has one payment-step address", () => {
	const hrefs = payInHrefs(CONVERTING, "bk-1", "personal", {}, { display: "USD", pay_in: "EUR" });
	assertEquals(hrefs, {
		GBP: "/checkout/payment?basket=bk-1&owner=personal&display=USD",
		EUR: "/checkout/payment?basket=bk-1&owner=personal&display=USD&pay_in=EUR",
	});
	assertEquals(payInHrefs(UNOFFERED, "bk-1", "personal", {}), {});
	assertEquals(payInHrefs(null, "bk-1", "personal", {}), {});
});

Deno.test("#435: a pay_in the checkout cannot honour is sent to its canonical address", () => {
	const at = (q: string) => new URL(`https://projective.test/checkout/payment?basket=bk-1&${q}`);
	assertEquals(payInRedirect(at("owner=personal"), CONVERTING), null);
	assertEquals(payInRedirect(at("pay_in=EUR"), OPTED_OUT), null);
	assertEquals(
		payInRedirect(at("pay_in=eur"), OPTED_OUT),
		"/checkout/payment?basket=bk-1&pay_in=EUR",
	);
	assertEquals(payInRedirect(at("pay_in=GBP"), CONVERTING), "/checkout/payment?basket=bk-1");
	assertEquals(payInRedirect(at("pay_in=XYZ"), CONVERTING), "/checkout/payment?basket=bk-1");
	assertEquals(payInRedirect(at("pay_in=EUR"), UNOFFERED), "/checkout/payment?basket=bk-1");
});
