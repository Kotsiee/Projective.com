import { assertEquals } from "@std/assert";
import {
	QUOTE_LINE_CLOSED,
	type QuoteOfferFact,
	quoteOfferIdOf,
	quoteOfferPurchase,
} from "./live-basket.ts";

/**
 * A basket line that buys a quote offer is priced and judged by the offer, the twin of
 * `finance.place_wallet_order`'s offer branch (CK7; probe `quote_checkout.sql`): the offer's own price
 * while it is the buyer's own, accepted, current and for this listing, and closed past its expiry.
 */

const BUYER = "1fee216e-a637-4619-a90a-4ae03bb1ed8b";
const LISTING = "871a653c-93a9-45f9-a35f-8d3a3a0d3457";
const NOW = Date.parse("2026-11-18T12:00:00Z");
const line = { item_type: "one_off_service" as const, item_id: LISTING };
const owner = { ownerType: "user" as const, ownerId: BUYER };

function offer(extra: Partial<QuoteOfferFact> = {}): QuoteOfferFact {
	return {
		id: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
		status: "accepted",
		priceCents: 90_000,
		currency: "USD",
		expiresAt: "2026-11-30T12:00:00Z",
		supersededBy: null,
		requestStatus: "accepted",
		requesterId: BUYER,
		blueprintId: LISTING,
		...extra,
	};
}

Deno.test("quoteOfferPurchase — an accepted offer is charged its own price, not the listing's", () => {
	assertEquals(quoteOfferPurchase(offer(), line, owner, NOW), {
		price: { minor: 90_000, currency: "USD" },
		closed: null,
	});
	assertEquals(
		quoteOfferPurchase(offer(), line, { ...owner, ownerType: "freelancer" }, NOW).closed,
		null,
	);
});

Deno.test("quoteOfferPurchase — past the seller's expiry the line shows its price and cannot be paid", () => {
	const lapsed = quoteOfferPurchase(offer({ expiresAt: "2026-11-18T11:59:59Z" }), line, owner, NOW);
	assertEquals(lapsed.price, { minor: 90_000, currency: "USD" });
	assertEquals(lapsed.closed, QUOTE_LINE_CLOSED.expired);
});

Deno.test("quoteOfferPurchase — not accepted, superseded, someone else's or another listing's: gone", () => {
	for (
		const fact of [
			null,
			offer({ status: "pending" }),
			offer({ status: "withdrawn", supersededBy: "aa2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }),
			offer({ requestStatus: "withdrawn" }),
			offer({ requesterId: "0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb" }),
			offer({ blueprintId: "bccc7920-ca19-4f5f-aa0e-f572e1e8b029" }),
		]
	) {
		assertEquals(quoteOfferPurchase(fact, line, owner, NOW), {
			price: null,
			closed: QUOTE_LINE_CLOSED.gone,
		});
	}
	assertEquals(
		quoteOfferPurchase(offer(), { ...line, item_type: "single_service_task" }, owner, NOW).closed,
		QUOTE_LINE_CLOSED.gone,
	);
	assertEquals(
		quoteOfferPurchase(offer(), line, { ownerType: "business", ownerId: BUYER }, NOW).closed,
		QUOTE_LINE_CLOSED.personal,
	);
});

Deno.test("quoteOfferIdOf — only a non-empty string id names an offer", () => {
	assertEquals(quoteOfferIdOf({ quoteOfferId: "abc" }), "abc");
	assertEquals(quoteOfferIdOf({ quoteOfferId: "" }), null);
	assertEquals(quoteOfferIdOf({ quoteOfferId: 7 }), null);
	assertEquals(quoteOfferIdOf(null), null);
});
