import { assertEquals } from "@std/assert";
import {
	disputeOfferSplit,
	offerOutcome,
	ticketDisputeSideLabel,
	ticketDisputeSideOf,
} from "./disputes.ts";

// The probe `ticket_dispute.sql` pins the SQL side (finance.fn_dispute_offer_split over
// fn_fair_exit_split); these pin the TS mirror on the same arithmetic.

Deno.test("an offer splits each escrow by Fair Exit's arithmetic: share floored, fee on the share", () => {
	// 2,250,000 at 40 % with a 5 % fee: share 900,000, fee 45,000, payout 855,000, back 1,350,000.
	assertEquals(disputeOfferSplit([2_250_000], 4000, 500), {
		payeeMinor: 855_000,
		feeMinor: 45_000,
		refundMinor: 1_350_000,
	});
});

Deno.test("a release and a refund are the ends of the same split", () => {
	assertEquals(disputeOfferSplit([10_000], 10000, 500), {
		payeeMinor: 9_500,
		feeMinor: 500,
		refundMinor: 0,
	});
	assertEquals(disputeOfferSplit([10_000], 0, 500), {
		payeeMinor: 0,
		feeMinor: 0,
		refundMinor: 10_000,
	});
});

Deno.test("each escrow floors on its own, so two escrows never earn a shared rounding unit", () => {
	// 333 at 33.33 %: share 110 (110.9889 floored), fee 5 (5.5 floored), payout 105, back 223 — twice.
	assertEquals(disputeOfferSplit([333, 333], 3333, 500), {
		payeeMinor: 210,
		feeMinor: 10,
		refundMinor: 446,
	});
});

Deno.test("an out-of-range share is clamped, never extrapolated", () => {
	assertEquals(disputeOfferSplit([1_000], 12_000, 0), {
		payeeMinor: 1_000,
		feeMinor: 0,
		refundMinor: 0,
	});
	assertEquals(disputeOfferSplit([1_000], -5, 0), {
		payeeMinor: 0,
		feeMinor: 0,
		refundMinor: 1_000,
	});
});

Deno.test("a share settles as a release, a refund or a split", () => {
	assertEquals(offerOutcome(10000), "release");
	assertEquals(offerOutcome(0), "refund");
	assertEquals(offerOutcome(1), "split");
	assertEquals(offerOutcome(9999), "split");
});

Deno.test("a ticket case's sides follow who raised it", () => {
	assertEquals(ticketDisputeSideOf("claimant", "payer"), "payer");
	assertEquals(ticketDisputeSideOf("respondent", "payer"), "payee");
	assertEquals(ticketDisputeSideOf("respondent", "payee"), "payer");
	assertEquals(ticketDisputeSideLabel("payer"), "The client");
	assertEquals(ticketDisputeSideLabel("payee"), "The freelancer");
});
