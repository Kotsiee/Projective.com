import { assert, assertEquals, assertFalse } from "@std/assert";
import type { MoneyProjector } from "./commerce-money.ts";
import {
	decidableBy,
	pendingByState,
	type SmootherRow,
	smootherRowFor,
	smootherState,
	statementRowOf,
	walletParamsOf,
} from "./live-wallet.ts";
import type { TxnRow } from "./wallet-ledger.ts";
import { expandCapabilities } from "./wallet-scope.ts";

/** A projector that prices every amount in its own currency, so a test reads the stored figures. */
function projector(): MoneyProjector {
	return {
		display: "GBP",
		canConvert: () => true,
		convertMinor: (minor: number) => minor,
		price: (minor: number, currency: string) => ({
			minor,
			currency,
			display: `${minor}`,
			origin: null,
		}),
		derived: (minor: number) => ({ minor, currency: "GBP", display: `${minor}`, origin: null }),
	} as unknown as MoneyProjector;
}

const DAY = 86_400_000;
const PARAMS = walletParamsOf([]);

function earning(currency: string, daysAgo: number): TxnRow {
	return {
		id: `t-${currency}-${daysAgo}`,
		wallet_id: "w1",
		direction: "credit",
		amount_cents: 50_000,
		currency,
		reason: "escrow_release",
		ref_table: null,
		ref_id: null,
		fund_state: null,
		created_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
	};
}

function smoother(currency: string, enrolled: boolean, target: number | null = null): SmootherRow {
	return {
		enrolled,
		target_monthly_cents: target,
		currency,
		fee_bp: 50,
		eligibility_met: enrolled,
	};
}

// #region V6: decidable
Deno.test("decidable: an approver decides a colleague's pending request, and no one else does", () => {
	const viewer = "u-viewer";
	const request = { requested_by: "u-hannah", status: "pending" };
	assert(decidableBy(viewer, ["view", "approve_spend"], request), "a pure approver");
	assertFalse(
		decidableBy(viewer, ["view", "spend", "distribute"], request),
		"distribute is not approve_spend",
	);
	assertFalse(
		decidableBy(viewer, ["view", "approve_spend"], { ...request, requested_by: viewer }),
		"never one's own request",
	);
	assertFalse(
		decidableBy(viewer, ["view", "approve_spend"], { ...request, status: "approved" }),
		"decided is final",
	);
	assert(
		decidableBy(viewer, expandCapabilities(["manage_members"]), request),
		"manage_members implies it",
	);
});
// #endregion

// #region A7 + N20: the smoother per currency, in minor units
Deno.test("smoother: with a row per currency the read picks one and never hides an enrolment", () => {
	const usd = smoother("USD", true, 600_000);
	const eur = smoother("EUR", false);
	assertEquals(
		smootherRowFor([eur, usd], "EUR"),
		usd,
		"an enrolment elsewhere beats a bare row here",
	);
	assertEquals(smootherRowFor([eur, usd], "USD"), usd);
	const eurEnrolled = smoother("EUR", true, 400_000);
	assertEquals(
		smootherRowFor([usd, eurEnrolled], "EUR"),
		eurEnrolled,
		"the wallet's own enrolment first",
	);
	assertEquals(smootherRowFor([eur], "usd"), null);
	assertEquals(smootherRowFor([], "USD"), null);
});

Deno.test("smoother: the smoothed figure floors its fee in minor units, at the fee the row captured", () => {
	const state = smootherState(projector(), smoother("USD", true, 333_333), "USD", [], PARAMS);
	assertEquals(state.status, "enrolled");
	assertEquals(state.feeBp, 50);
	assertEquals(state.targetMonthly?.minor, 333_333);
	// 333,333 × 50 / 10,000 = 1,666.66 → a fee of 1,666, so 331,667 (a float product rounded to 331,666).
	assertEquals([state.projected?.minor, state.projected?.currency], [331_667, "USD"]);
});

Deno.test("smoother: the gate counts earnings in its own currency, at today's params", () => {
	const params = walletParamsOf([
		{ key: "income_smoother_fee_bp", value: 75 },
		{ key: "income_smoother_min_months", value: 3 },
	]);
	const rows = [earning("USD", 130), earning("EUR", 40)];
	const eur = smootherState(projector(), null, "EUR", rows, params);
	assertEquals([eur.status, eur.monthsElapsed, eur.monthsRequired, eur.feeBp], [
		"ineligible",
		1,
		3,
		75,
	]);
	assert(eur.weeksToGo > 0);
	const usd = smootherState(projector(), null, "USD", rows, params);
	assertEquals([usd.status, usd.monthsElapsed, usd.weeksToGo], ["eligible", 4, 0]);
	assertEquals([usd.targetMonthly, usd.projected], [null, null]);
});
// #endregion

// #region N21: the params the server applies
Deno.test("params: each reads its row, else the database's own fallback", () => {
	assertEquals(walletParamsOf([]), {
		pendingReleaseDays: 7,
		smootherFeeBp: 50,
		smootherMinMonths: 3,
	});
	assertEquals(walletParamsOf([{ key: "pending_release_days", value: 5 }]).pendingReleaseDays, 5);
	assertEquals(walletParamsOf([{ key: "pending_release_days", value: "4" }]).pendingReleaseDays, 4);
	assertEquals(walletParamsOf([{ key: "pending_release_days", value: -2 }]).pendingReleaseDays, 0);
	for (const value of [null, 7.5, "", "seven", { days: 3 }]) {
		assertEquals(
			walletParamsOf([{ key: "pending_release_days", value }]).pendingReleaseDays,
			7,
			String(value),
		);
	}
});
// #endregion

// #region N22: on hold is read and kept apart
Deno.test("pending: on-hold rows are read as their own figure, net of what a chargeback took", () => {
	const row = (id: string, state: string, amount: number, recovered = 0) => ({
		id,
		escrow_id: `e-${id}`,
		order_id: null,
		wallet_id: "w1",
		amount_cents: amount,
		recovered_cents: recovered,
		currency: "USD",
		released_at: "2026-10-25T00:00:00Z",
		available_at: "2026-11-01T00:00:00Z",
		state,
	});
	const { pending, onHold } = pendingByState([
		row("a", "pending", 5_000),
		row("b", "on_hold", 3_000, 1_000),
		row("c", "on_hold", 2_000, 2_000),
		row("d", "available", 9_000),
	]);
	assertEquals(pending.map((p) => [p.id, p.amount_cents]), [["a", 5_000]]);
	assertEquals(
		onHold.map((p) => [p.id, p.amount_cents]),
		[["b", 2_000]],
		"an emptied row holds nothing",
	);
});
// #endregion

// #region R10: a statement is a document with a PDF
Deno.test("statements: an issued statement carries its own figures and its PDF", () => {
	const issued = {
		id: "5d0c2a1e-7b3f-4c8d-9e0f-1a2b3c4d5e6f",
		period_start: "2026-09-01T00:00:00+00:00",
		currency: "EUR",
		total_in_cents: "120000",
		total_out_cents: 4_000,
		total_fees_cents: 600,
		status: "issued" as const,
	};
	const row = statementRowOf(projector(), issued, false);
	assertEquals(row.pdfHref, `/api/finance/statements/${issued.id}/pdf`);
	assertEquals([row.id, row.periodLabel, row.status], [issued.id, "September 2026", "issued"]);
	assertEquals(
		[row.totalIn.minor, row.totalOut.minor, row.totalFees.minor, row.totalIn.currency],
		[120_000, 4_000, 600, "EUR"],
	);
	assertEquals(statementRowOf(projector(), issued, true).periodLabel, "September 2026 · EUR");
});
// #endregion
