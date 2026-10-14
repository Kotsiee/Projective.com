import { assertEquals } from "@std/assert";
import type { ListingPricing } from "@projective/types/catalogue";
import {
	askedPrice,
	minorOf,
	priceAsk,
	ticketRange,
	wholeOf,
	withAskedPrice,
	withRevisionsDeclared,
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
	assertEquals(wholeOf(1250, "GBP"), 12.5);
	assertEquals(wholeOf(null, "GBP"), null);
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

Deno.test("the pipeline range is half to double the ticket", () => {
	assertEquals(ticketRange(40_000), { low: 20_000, high: 80_000 });
});

Deno.test("declaring revisions keeps null apart from zero", () => {
	assertEquals(withRevisionsDeclared(PRICING, true).freeRevisions, 2);
	assertEquals(withRevisionsDeclared({ ...PRICING, freeRevisions: 0 }, true).freeRevisions, 0);
	assertEquals(withRevisionsDeclared({ ...PRICING, freeRevisions: 3 }, false).freeRevisions, null);
});
