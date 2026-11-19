import { assertEquals } from "@std/assert";
import type { QuoteView } from "@projective/types/services";
import { cardWaitsOnViewer, offerMoneyNote, quoteMoveLabel, waitsOnViewer } from "./quote-labels.ts";

/**
 * The money sentence and the attention tone under an offer, pinned to the payment deadline (CK7,
 * owner ruling A): an accepted offer is paid before the seller's expiry, and past it nothing is payable.
 */

function view(
	extra: Partial<QuoteView> = {},
	state: NonNullable<QuoteView["offer"]>["state"] = "accepted",
): QuoteView {
	return {
		id: "6b1f0d2e-0c4a-4f8e-9a51-2a6c3f0e9d11",
		role: "buyer",
		status: "accepted",
		origin: "buyer",
		scope: "Rebuild our checkout.",
		answerLines: [],
		budgetMinor: null,
		budgetCurrency: null,
		timeline: null,
		declineReason: null,
		requestedAt: "2026-11-01T10:00:00Z",
		listing: {
			slug: "svc-23456789ab",
			title: "Checkout redesign",
			href: "/view/svc-23456789ab",
			privateCohort: false,
			currency: "USD",
		},
		freeRevisions: 2,
		offersSent: 1,
		offer: {
			id: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
			state,
			scope: "Map, redesign, test.",
			deliverables: ["Journey map"],
			priceMinor: 450000,
			currency: "USD",
			turnaroundDays: 21,
			expiresAt: "2026-11-16T10:00:00Z",
			sentAt: "2026-11-02T10:00:00Z",
			termsHash: "3f2a9c1e".repeat(8),
			termsIntact: true,
		},
		history: [],
		ordered: false,
		actions: [],
		...extra,
	};
}

Deno.test("offerMoneyNote — an accepted offer is paid into escrow at checkout until it lapses", () => {
	assertEquals(
		offerMoneyNote(view()),
		"Paid into escrow at checkout, and released when the delivery is approved.",
	);
	assertEquals(
		offerMoneyNote(view({}, "expired")),
		"This offer lapsed before it was paid. Withdraw the request, then ask again from the listing.",
	);
	assertEquals(
		offerMoneyNote(view({ role: "host" }, "expired")),
		"This offer lapsed before the buyer paid for it.",
	);
	assertEquals(offerMoneyNote(view({ ordered: true })), "Paid for. The engagement is in Projects.");
	assertEquals(offerMoneyNote(view({ status: "answered" }, "expired")), null);
	assertEquals(offerMoneyNote(view({ status: "answered" }, "declined")), null);
});

Deno.test("waitsOnViewer — a lapsed accepted offer no longer waits on its buyer", () => {
	assertEquals(waitsOnViewer(view()), true);
	assertEquals(waitsOnViewer(view({}, "expired")), false);
	assertEquals(waitsOnViewer(view({ ordered: true })), false);
	assertEquals(waitsOnViewer(view({ status: "answered" }, "pending")), true);
});


Deno.test("quoteMoveLabel — a card names its move from the viewer's side", () => {
	assertEquals(quoteMoveLabel("issued", false), "Quote received");
	assertEquals(quoteMoveLabel("issued", true), "You sent a quote");
	assertEquals(quoteMoveLabel("paid", false), "Offer paid");
	assertEquals(quoteMoveLabel("offer_revised", false), "Revised offer");
});

Deno.test("cardWaitsOnViewer — only a buyer's open or unpaid accepted offer takes the attention tone", () => {
	assertEquals(cardWaitsOnViewer("pending", "buyer"), true);
	assertEquals(cardWaitsOnViewer("accepted", "buyer"), true);
	assertEquals(cardWaitsOnViewer("pending", "host"), false);
	assertEquals(cardWaitsOnViewer("paid", "buyer"), false);
	assertEquals(cardWaitsOnViewer(null, "buyer"), false);
});
