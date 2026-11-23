import { assertEquals } from "@std/assert";
import { LedgerHealthSchema, LedgerSectionId } from "@projective/types/finance";
import { type RawLedgerHealth, toLedgerHealth } from "./LedgerHealthService.ts";

/*
 * finance.get_ledger_health → LedgerHealth (FBP DB16). The operator reads these figures to decide
 * whether money is missing, so a dropped term, a flipped sign or a lost night would mislead them.
 */

// #region Fixtures
/** The shape `finance.get_ledger_health()` returned on the seeded database (2026-11-18), plus drift. */
function raw(): RawLedgerHealth {
	return {
		as_of: "2026-11-18T22:10:04.120771+00:00",
		currencies: [
			{
				currency: "EUR",
				in_cash_minor: 0,
				in_on_account_minor: 0,
				in_fx_minor: 0,
				out_payouts_minor: 0,
				out_card_refunds_minor: 0,
				out_chargebacks_minor: 0,
				out_invoices_minor: 0,
				out_fx_minor: 0,
				held_wallets_minor: 4321,
				held_escrows_minor: 0,
				held_pending_minor: 0,
				tax_payable_minor: 0,
				fees_escrows_minor: 0,
				fees_orders_minor: 0,
				fees_fx_minor: 0,
				losses_chargebacks_minor: 0,
				losses_card_refunds_minor: 0,
				losses_promos_minor: 0,
				external_minor: 0,
				accounted_minor: 4321,
				imbalance_minor: 4321,
			},
			{
				currency: "USD",
				in_cash_minor: 17801000,
				in_on_account_minor: 0,
				in_fx_minor: 0,
				out_payouts_minor: 1700000,
				out_card_refunds_minor: 3800,
				out_chargebacks_minor: 0,
				out_invoices_minor: 0,
				out_fx_minor: 0,
				held_wallets_minor: 5173105,
				held_escrows_minor: 10700000,
				held_pending_minor: 2280,
				tax_payable_minor: 0,
				fees_escrows_minor: 220000,
				fees_orders_minor: 1815,
				fees_fx_minor: 0,
				losses_chargebacks_minor: 0,
				losses_card_refunds_minor: 0,
				losses_promos_minor: 0,
				external_minor: 16097200,
				accounted_minor: 16097200,
				imbalance_minor: 0,
			},
		],
		nights: [
			{
				run_id: "b295f91f-3143-4e96-b4e2-20f762a01d9e",
				checked_at: "2026-11-18T03:50:00.0+00:00",
				currency: "EUR",
				balanced: false,
				external_minor: 0,
				accounted_minor: 4321,
				imbalance_minor: 4321,
			},
			{
				run_id: null,
				checked_at: "2026-11-17T03:50:00.0+00:00",
				currency: "USD",
				balanced: true,
				external_minor: null,
				accounted_minor: null,
				imbalance_minor: null,
			},
		],
		drift: {
			wallets: [{
				wallet_id: "2f6a0b0e-6d43-4ad0-9a54-6b0a6f9d1c11",
				owner_type: "freelancer",
				currency: "USD",
				balance_minor: 120001,
				ledger_sum_minor: 120000,
				latest_balance_after_minor: 120000,
				earmarked_minor: 0,
				pot_drift_minor: 0,
			}],
			conversions: [{
				conversion_id: null,
				escrow_id: "8a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
				kind: "unwind",
				problem: "unwind_credit",
				expected_minor: 900,
				ledger_minor: 0,
			}],
			logged_30d: 3,
			last_logged_at: "2026-11-18T03:40:00.0+00:00",
		},
	};
}
// #endregion

Deno.test("toLedgerHealth keeps every term, sign and currency, A–Z", () => {
	const health = toLedgerHealth(raw());
	assertEquals(LedgerHealthSchema.safeParse(health).success, true);
	assertEquals(health.conservation.currencies.map((c) => c.currency), ["EUR", "USD"]);
	const usd = health.conservation.currencies[1];
	assertEquals(usd.inCashMinor, 17801000);
	assertEquals(usd.outCardRefundsMinor, 3800);
	assertEquals(usd.heldPendingMinor, 2280);
	assertEquals(usd.feesOrdersMinor, 1815);
	assertEquals(usd.externalMinor, usd.accountedMinor);
	assertEquals(usd.imbalanceMinor, 0);
	assertEquals(health.conservation.currencies[0].imbalanceMinor, 4321);
});

Deno.test("toLedgerHealth keeps a night with its figures and drops one without", () => {
	const nights = toLedgerHealth(raw()).conservation.nights;
	assertEquals(nights.length, 1);
	assertEquals(nights[0], {
		runId: "b295f91f-3143-4e96-b4e2-20f762a01d9e",
		checkedAt: "2026-11-18T03:50:00.0+00:00",
		currency: "EUR",
		balanced: false,
		externalMinor: 0,
		accountedMinor: 4321,
		imbalanceMinor: 4321,
	});
});

Deno.test("toLedgerHealth maps the open drift and the 30-day log", () => {
	const drift = toLedgerHealth(raw()).drift;
	assertEquals(drift.wallets[0].balanceMinor - drift.wallets[0].ledgerSumMinor, 1);
	assertEquals(drift.conversions[0], {
		conversionId: null,
		escrowId: "8a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
		kind: "unwind",
		problem: "unwind_credit",
		expectedMinor: 900,
		ledgerMinor: 0,
	});
	assertEquals(drift.logged30d, 3);
	assertEquals(drift.asOf, "2026-11-18T22:10:04.120771+00:00");
});

Deno.test("toLedgerHealth of nothing is an empty, valid read", () => {
	const health = toLedgerHealth(null);
	assertEquals(LedgerHealthSchema.safeParse(health).success, true);
	assertEquals(health.conservation.currencies, []);
	assertEquals(health.drift.wallets, []);
	assertEquals(health.drift.logged30d, 0);
	assertEquals(health.drift.lastLoggedAt, null);
});

Deno.test("the page's sections are conservation, drift, escrow age, alerts and AML signals, in that order", () => {
	assertEquals(LedgerSectionId.options, [
		"conservation",
		"drift",
		"escrow_age",
		"alerts",
		"aml_signals",
	]);
});
