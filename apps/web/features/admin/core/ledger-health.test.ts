import { assertEquals } from "@std/assert";
import { EscrowAgeKind, LedgerSectionId } from "@projective/types/finance";
import type { ConservationCurrency } from "@projective/types/finance";
import {
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
		feesEscrowsMinor: 220000,
		feesOrdersMinor: 1815,
		feesFxMinor: 0,
		lossesChargebacksMinor: 0,
		lossesCardRefundsMinor: 0,
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

Deno.test("daysText and shortId", () => {
	assertEquals(daysText(9.9), "9.9 d");
	assertEquals(daysText(12), "12.0 d");
	assertEquals(shortId("2f6a0b0e-6d43-4ad0-9a54-6b0a6f9d1c11"), "2f6a0b0e");
	assertEquals(shortId(null), "—");
});
