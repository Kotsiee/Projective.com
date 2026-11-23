import { assertEquals } from "@std/assert";
import type { ListingPricing } from "@projective/types/catalogue";
import {
	askedPrice,
	currencyOf,
	minorOf,
	priceAsk,
	signedMajorOf,
	signedMinorOf,
	ticketRange,
	withAskedPrice,
	withRevisionCap,
	withUnlimitedRevisions,
} from "./pricing-model.ts";

const PRICING: ListingPricing = {
	amount: 0,
	ticketPrice: 400,
	sessionPrice: null,
	seatsPerSession: null,
	freeRevisions: null,
	extraRevisionPrice: null,
};

Deno.test("units convert at the currency's exponent", () => {
	assertEquals(minorOf(12.5, "GBP"), 1250);
	assertEquals(minorOf(5000, "JPY"), 5000);
	assertEquals(minorOf(null, "GBP"), null);
});

Deno.test("a signed guide price converts both ways, a discount included", () => {
	assertEquals(signedMajorOf(-250, "GBP"), -2.5);
	assertEquals(signedMinorOf(-2.5, "GBP"), -250);
	assertEquals(signedMinorOf(signedMajorOf(1999, "GBP"), "GBP"), 1999);
	assertEquals(signedMajorOf(500, "JPY"), 500);
	assertEquals(signedMinorOf(null, "GBP"), null);
});

Deno.test("each archetype asks for its own price", () => {
	assertEquals(priceAsk("product").field, "amount");
	assertEquals(priceAsk("one_off").field, "amount");
	assertEquals(priceAsk("pipeline").field, "ticketPrice");
	assertEquals(priceAsk("session").label, "Price per session");
	assertEquals(priceAsk("cohort").label, "Price per seat");
});

Deno.test("the fixed fee reads 0 as unpriced and clears back to 0", () => {
	assertEquals(askedPrice(PRICING, "amount"), null);
	assertEquals(askedPrice(PRICING, "ticketPrice"), 400);
	assertEquals(withAskedPrice(PRICING, "amount", null).amount, 0);
	assertEquals(withAskedPrice(PRICING, "sessionPrice", 80).sessionPrice, 80);
});

Deno.test("the pipeline range runs from the Low to the High price multiplier of the ticket", () => {
	assertEquals(ticketRange(40_000), { low: 30_000, high: 60_000 });
});

Deno.test("a picked currency is stored as its upper-case ISO code, or refused", () => {
	assertEquals(currencyOf("jpy"), "JPY");
	assertEquals(currencyOf(" EUR "), "EUR");
	assertEquals(currencyOf("EURO"), null);
	assertEquals(currencyOf(null), null);
});

Deno.test("unlimited revisions are a free extra round, and switching off unprices it", () => {
	const counted = { ...PRICING, freeRevisions: 3, extraRevisionPrice: 40 };
	const on = withUnlimitedRevisions(counted, true);
	assertEquals([on.freeRevisions, on.extraRevisionPrice], [3, 0]);
	const off = withUnlimitedRevisions(on, false);
	assertEquals([off.freeRevisions, off.extraRevisionPrice], [3, null]);
	assertEquals(withUnlimitedRevisions(counted, false), counted);
});

Deno.test("a lowered price lowers the extra-round price to half of it", () => {
	const priced = { ...PRICING, ticketPrice: 400, extraRevisionPrice: 150 };
	assertEquals(withRevisionCap(priced, "pipeline", "GBP"), priced);
	const cheaper = withRevisionCap({ ...priced, ticketPrice: 199.99 }, "pipeline", "GBP");
	assertEquals(cheaper.extraRevisionPrice, 99.99);
	const unpriced = withRevisionCap({ ...priced, ticketPrice: null }, "pipeline", "GBP");
	assertEquals(unpriced.extraRevisionPrice, null);
	const free = { ...priced, ticketPrice: 10, extraRevisionPrice: 0 };
	assertEquals(withRevisionCap(free, "pipeline", "GBP"), free);
	const session = { ...PRICING, sessionPrice: 50, extraRevisionPrice: 30 };
	assertEquals(withRevisionCap(session, "session", "GBP"), session);
});
