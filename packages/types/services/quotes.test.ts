import { assertEquals } from "@std/assert";
import {
	QuoteActInputSchema,
	quoteActionsOf,
	quoteViewOf,
	type QuoteWithRow,
	QuoteWithRowSchema,
} from "./quotes.ts";

/**
 * The acts a quote view offers, pinned against the doors in 00001177: a control renders only when its
 * door would accept it (root CLAUDE.md §3.11), so each case below is one door's state guard read from
 * the viewer's side.
 */

function row(extra: Partial<QuoteWithRow> = {}): QuoteWithRow {
	return QuoteWithRowSchema.parse({
		id: "6b1f0d2e-0c4a-4f8e-9a51-2a6c3f0e9d11",
		role: "buyer",
		status: "answered",
		scope: "Rebuild our checkout.",
		budget_cents: 300000,
		currency: "USD",
		timeline: null,
		decline_reason: null,
		created_at: "2026-11-01T10:00:00Z",
		answered_at: "2026-11-02T10:00:00Z",
		closed_at: null,
		blueprint_id: "0f9a2c4e-3b1d-4e6f-8a7b-9c0d1e2f3a4b",
		listing_slug: "svc-23456789ab",
		listing_title: "Checkout redesign",
		listing_currency: "USD",
		listing_delivery_model: "one_off",
		free_revisions: 2,
		offers_sent: 1,
		offer: {
			id: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
			status: "pending",
			expired: false,
			scope: "Map, redesign, test.",
			deliverables: ["Journey map"],
			price_cents: 450000,
			currency: "USD",
			turnaround_days: 21,
			expires_at: "2026-11-16T10:00:00Z",
			created_at: "2026-11-02T10:00:00Z",
			decided_at: null,
		},
		basket_item_id: null,
		ordered: false,
		...extra,
	});
}

Deno.test("quoteActionsOf — the buyer answers a pending offer, and only a live one", () => {
	assertEquals(quoteActionsOf(row()), ["accept_offer", "decline_offer", "withdraw_request"]);
	const expired = row({ offer: { ...row().offer!, expired: true } });
	assertEquals(quoteActionsOf(expired), ["withdraw_request"]);
	assertEquals(quoteViewOf(expired).offer?.state, "expired");
	assertEquals(quoteActionsOf(row({ status: "sent", offer: null })), ["withdraw_request"]);
});

Deno.test("quoteActionsOf — an accepted offer goes to checkout until it is paid for", () => {
	const accepted = row({ status: "accepted", offer: { ...row().offer!, status: "accepted" } });
	assertEquals(quoteActionsOf(accepted), ["checkout", "withdraw_request"]);
	assertEquals(quoteActionsOf({ ...accepted, ordered: true }), []);
});

Deno.test("quoteActionsOf — an accepted offer past its expiry is not payable: withdraw, then ask again", () => {
	const lapsed = row({
		status: "accepted",
		offer: { ...row().offer!, status: "accepted", expired: true },
	});
	assertEquals(quoteActionsOf(lapsed), ["withdraw_request"]);
	assertEquals(quoteViewOf(lapsed).offer?.state, "expired");
	assertEquals(quoteActionsOf({ ...lapsed, role: "host" }), []);
	assertEquals(
		quoteViewOf({ ...lapsed, offer: { ...lapsed.offer!, status: "declined" } }).offer?.state,
		"declined",
	);
});

Deno.test("quoteActionsOf — the host prices, revises, withdraws and declines an open request", () => {
	assertEquals(quoteActionsOf(row({ role: "host" })), [
		"send_offer",
		"withdraw_offer",
		"decline_request",
	]);
	assertEquals(quoteActionsOf(row({ role: "host", status: "sent", offer: null })), [
		"send_offer",
		"decline_request",
	]);
	const declined = row({ role: "host", offer: { ...row().offer!, status: "declined" } });
	assertEquals(quoteActionsOf(declined), ["send_offer", "decline_request"]);
	for (const status of ["accepted", "declined", "withdrawn"] as const) {
		assertEquals(quoteActionsOf(row({ role: "host", status })), []);
	}
});

Deno.test("quoteViewOf — a group-session listing is a private cohort; the listing links to /view", () => {
	const view = quoteViewOf(row({ listing_delivery_model: "group_session" }));
	assertEquals(view.listing.privateCohort, true);
	assertEquals(view.listing.href, "/view/svc-23456789ab");
	assertEquals(view.offer?.priceMinor, 450000);
});

Deno.test("QuoteActInputSchema — the expiry defaults to 14 days and stays within 3 to 30", () => {
	const base = {
		action: "send_offer",
		scope: "Scope",
		deliverables: [],
		priceMinor: 100,
		turnaroundDays: 5,
	};
	const parsed = QuoteActInputSchema.parse(base);
	assertEquals(parsed.action === "send_offer" && parsed.expiresInDays, 14);
	assertEquals(QuoteActInputSchema.safeParse({ ...base, expiresInDays: 2 }).success, false);
	assertEquals(QuoteActInputSchema.safeParse({ ...base, expiresInDays: 31 }).success, false);
	assertEquals(QuoteActInputSchema.safeParse({ ...base, priceMinor: 0 }).success, false);
});
