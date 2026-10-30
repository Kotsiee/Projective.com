import { assertEquals } from "@std/assert";
import { payingWallets } from "./commerce-owner.ts";

/**
 * Which wallet pays a charge (`payingWallets`, FCA N7): per currency, the one wallet
 * `finance.place_wallet_order` debits, never a total across currencies or across wallets.
 */

// #region Fixtures
function wallet(owner_type: string, currency: string, balance_cents: number | string) {
	return { owner_type, currency, balance_cents };
}
// #endregion

Deno.test("payingWallets: each currency keeps its own balance, unconverted and never summed", () => {
	const balances = payingWallets(
		[wallet("user", "GBP", 5_000), wallet("user", "EUR", 10_000)],
		"user",
	);
	assertEquals(balances.get("GBP"), 5_000);
	assertEquals(balances.get("EUR"), 10_000);
	assertEquals(balances.get("USD"), undefined);
});

Deno.test("payingWallets: a person's user wallet pays before their freelancer wallet, in either order", () => {
	const rows = [wallet("freelancer", "GBP", 90_000), wallet("user", "gbp", "1200")];
	assertEquals(payingWallets(rows, "user").get("GBP"), 1_200);
	assertEquals(payingWallets([...rows].reverse(), "user").get("GBP"), 1_200);
});

Deno.test("payingWallets: a freelancer wallet pays when it is the person's only one in that currency", () => {
	assertEquals(payingWallets([wallet("freelancer", "EUR", 700)], "user").get("EUR"), 700);
});
