import { assertEquals } from "@std/assert";
import { EscrowAgeKind, LedgerSectionId } from "@projective/types/finance";
import type { ConservationCurrency } from "@projective/types/finance";
import {
	alertChannelLabel,
	alertGroup,
	alertStatus,
	AML_KIND_LABEL,
	amlFactsText,
	amlSubject,
	conservationGroups,
	conservationStatus,
	daysText,
	ESCROW_AGE_KIND_COPY,
	LEDGER_SECTION_COPY,
	shortId,
} from "./ledger-health.ts";

/*
 * The ledger page's model (FBP DB16). An operator reads the identity from these groups, so a term in
 * the wrong group, or a total that is not the sum of its terms, would misreport the books.
 */

function usd(): ConservationCurrency {
	return {
		currency: "USD",
		inCashMinor: 17801000,
		inOnAccountMinor: 0,
		inFxMinor: 0,
		outPayoutsMinor: 1700000,
		outCardRefundsMinor: 3800,
		outChargebacksMinor: 0,
		outInvoicesMinor: 0,
		outFxMinor: 0,
		heldWalletsMinor: 5173105,
		heldEscrowsMinor: 10700000,
		heldPendingMinor: 2280,
		taxPayableMinor: 0,
		feesEscrowsMinor: 220000,
		feesOrdersMinor: 1815,
		feesFxMinor: 0,
		lossesChargebacksMinor: 0,
		lossesCardRefundsMinor: 0,
		lossesPromosMinor: 0,
		externalMinor: 16097200,
		accountedMinor: 16097200,
		imbalanceMinor: 0,
	};
}

Deno.test("conservationGroups: the five sides in equation order, each total the sum of its terms", () => {
	const groups = conservationGroups(usd());
	assertEquals(groups.map((g) => g.label), ["In", "Out", "Held", "Fees kept", "Losses"]);
	const [inG, outG, held, fees, losses] = groups;
	assertEquals(inG.totalMinor - outG.totalMinor, usd().externalMinor);
	assertEquals(held.totalMinor + fees.totalMinor - losses.totalMinor, usd().accountedMinor);
	assertEquals(outG.terms.map((t) => t.label), ["payouts", "card refunds"]);
	assertEquals(losses.terms, []);
});

Deno.test("conservationStatus: zero is balanced, either sign is out of balance", () => {
	assertEquals(conservationStatus({ imbalanceMinor: 0 }).tone, "success");
	assertEquals(conservationStatus({ imbalanceMinor: 4321 }).label, "Out of balance");
	assertEquals(conservationStatus({ imbalanceMinor: -1 }).tone, "danger");
});

Deno.test("every section and every escrow-age kind has copy", () => {
	for (const id of LedgerSectionId.options) {
		assertEquals(Boolean(LEDGER_SECTION_COPY[id].title), true);
	}
	for (const kind of EscrowAgeKind.options) {
		assertEquals(Boolean(ESCROW_AGE_KIND_COPY[kind].label), true);
	}
});

Deno.test("an alert's status and group read as a person would say them", () => {
	assertEquals(alertStatus({ status: "sent", attempts: 1 }).label, "Sent");
	assertEquals(alertStatus({ status: "pending", attempts: 0 }).tone, "warning");
	assertEquals(alertStatus({ status: "pending", attempts: 2 }).label, "Retrying");
	assertEquals(alertGroup({ fingerprint: "silence" }), "Dead-man switch");
	assertEquals(alertGroup({ fingerprint: "2f6a0b0e" }), "2f6a0b0e");
	assertEquals(alertGroup({ fingerprint: "stripe:failing" }), "stripe:failing");
	assertEquals(
		["webhook", "email", "in_app"].map((c) =>
			alertChannelLabel(c as "webhook" | "email" | "in_app")
		),
		["Webhook", "Email digest", "Operator notice"],
	);
});

Deno.test("daysText and shortId", () => {
	assertEquals(daysText(9.9), "9.9 d");
	assertEquals(daysText(12), "12.0 d");
	assertEquals(shortId("2f6a0b0e-6d43-4ad0-9a54-6b0a6f9d1c11"), "2f6a0b0e");
	assertEquals(shortId(null), "—");
});

Deno.test("an AML signal's facts read as one plain line, and its person by handle", () => {
	const base = {
		id: "a1000000-0000-4000-8000-000000000001",
		subjectUserId: "1fee216e-a637-4619-a90a-4ae03bb1ed8b",
		subjectUsername: "riley",
		walletId: null,
		escrowId: null,
		payoutId: null,
		amountMinor: 100000,
		currency: "USD",
		createdAt: "2026-11-23T15:57:00+00:00",
	};
	assertEquals(
		amlFactsText({
			...base,
			kind: "round_trip",
			facts: {
				event: "funding",
				relation: "same_account",
				ticketId: null,
				cohortMembershipId: null,
			},
		}),
		"At funding: the same account pays and is paid",
	);
	assertEquals(
		amlFactsText({
			...base,
			kind: "rapid_churn",
			facts: {
				inMinor: 150000,
				payments: 2,
				lastInAt: "2026-11-23T14:05:00Z",
				minMinor: 100000,
				windowHours: 72,
			},
		}),
		"2 card payments inside 72 h, the newest 23 Nov, 14:05 UTC",
	);
	assertEquals(
		amlFactsText({
			...base,
			kind: "safety_hold",
			facts: { heldUntil: "2026-11-26T14:05:00Z", triggers: ["rapid_churn", "sign_in_change"] },
		}),
		"Held until 26 Nov, 14:05 UTC: rapid churn, sign-in change",
	);
	assertEquals(amlSubject(base), "@riley");
	assertEquals(amlSubject({ ...base, subjectUsername: null }), "1fee216e");
	for (const kind of ["round_trip", "rapid_churn", "safety_hold"] as const) {
		assertEquals(Boolean(AML_KIND_LABEL[kind]), true);
	}
});
