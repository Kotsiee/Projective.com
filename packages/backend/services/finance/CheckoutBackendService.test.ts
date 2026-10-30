import { assert, assertEquals } from "@std/assert";
import { availableProviders, formatMoney, type MoneyView } from "@projective/types/finance";
import { payingWalletOf, walletStandingOf } from "./CheckoutBackendService.ts";
import { projectorFor } from "./commerce-money.ts";
import { payingWallets } from "./commerce-owner.ts";

/**
 * "Wallet covers" counts only the wallet that pays (FCA N7): an order is paid from the account's
 * wallet in the charge currency, so the wallet route and the session's standing are that wallet's
 * balance against the charge, in that currency, never a total converted across currencies.
 */

// #region Fixtures
/** An owner holding GBP 50 and EUR 100, reading the checkout in EUR. */
const WALLETS = payingWallets([
	{ owner_type: "user", currency: "GBP", balance_cents: 5_000 },
	{ owner_type: "user", currency: "EUR", balance_cents: 10_000 },
], "user");

const MONEY = projectorFor("EUR", {
	base: "EUR",
	rates: { EUR: 1, GBP: 1.15 },
	asOf: "2026-10-31T00:00:00.000Z",
	provider: "seed",
	stale: false,
});

/** A charge in the listing's own currency, as `chargeFor` answers it. */
function gbp(minor: number): MoneyView {
	return { minor, currency: "GBP", display: formatMoney(minor, "GBP"), origin: null };
}

function walletRoute(charge: MoneyView | null) {
	return availableProviders({
		ownerType: "user",
		actingIsMember: true,
		wallet: payingWalletOf(WALLETS, charge),
		totalMinor: 0, // only the invoice route reads it
		currency: MONEY.display,
		savedCards: [],
		kybStatus: null,
		verificationTier: null,
	}).find((entry) => entry.provider === "wallet");
}
// #endregion

Deno.test("a GBP 80 item is not offered the wallet: the GBP wallet holds 50, and the EUR 100 never counts", () => {
	const route = walletRoute(gbp(8_000));
	assertEquals(route?.available, false);
	assert(route?.reason?.includes("GBP wallet") && !route.reason.includes("€"));
	const standing = walletStandingOf(payingWalletOf(WALLETS, gbp(8_000)), WALLETS, MONEY);
	assertEquals(
		[
			standing.available.minor,
			standing.shortfall.minor,
			standing.shortfall.currency,
			standing.covers,
		],
		[5_000, 3_000, "GBP", false],
	);
});

Deno.test("a GBP 40 item is offered the wallet, and the standing covers it", () => {
	assertEquals(walletRoute(gbp(4_000))?.available, true);
	const standing = walletStandingOf(payingWalletOf(WALLETS, gbp(4_000)), WALLETS, MONEY);
	assertEquals([standing.available.currency, standing.shortfall.minor, standing.covers], [
		"GBP",
		0,
		true,
	]);
});

Deno.test("an item in a currency with no wallet has nothing to pay from", () => {
	assertEquals(payingWalletOf(WALLETS, { ...gbp(100), currency: "USD" })?.availableMinor, 0);
});

Deno.test("lines in two currencies have no paying wallet: refused, and never read as covering", () => {
	assertEquals(payingWalletOf(WALLETS, null), null);
	assertEquals(walletRoute(null)?.available, false);
	const standing = walletStandingOf(null, WALLETS, MONEY);
	assertEquals([standing.available.minor, standing.available.currency, standing.covers], [
		10_000,
		"EUR",
		false,
	]);
});
