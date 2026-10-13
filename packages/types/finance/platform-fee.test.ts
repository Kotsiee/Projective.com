import { assertEquals, assertExists } from "@std/assert";
import type { BasketItem } from "./basket.ts";
import { checkoutTotals, PLATFORM_FEE_BP, platformFeeFor } from "./checkout.ts";

const SEED = new URL(
	"../../../supabase/migrations/00005001_seed_platform_params.sql",
	import.meta.url,
);

Deno.test("PLATFORM_FEE_BP is the seeded security.platform_params.platform_fee_bp", () => {
	const sql = Deno.readTextFileSync(SEED);
	const seeded = sql.match(/\('platform_fee_bp',\s*'(\d+)'::jsonb/);
	assertExists(seeded, "platform_fee_bp is no longer seeded in 00005001");
	assertEquals(PLATFORM_FEE_BP, Number(seeded[1]));
});

Deno.test("an odd-cent fee truncates, as SQL integer division does", () => {
	assertEquals(platformFeeFor(1050), 52);
	assertEquals(platformFeeFor(1050, 300), 31);
	assertEquals(platformFeeFor(1999), 99);
	assertEquals(platformFeeFor(19), 0);
	for (const amount of [1, 7, 1010, 1050, 33_333, 3_200_000]) {
		assertEquals(platformFeeFor(amount, 500), Math.trunc((amount * 500) / 10_000));
		assertEquals(platformFeeFor(amount, 275), Math.trunc((amount * 275) / 10_000));
	}
});

Deno.test("no fee on nothing, or at a zero rate", () => {
	assertEquals(platformFeeFor(0), 0);
	assertEquals(platformFeeFor(-500), 0);
	assertEquals(platformFeeFor(1050, 0), 0);
});

function product(unitMinor: number): BasketItem {
	return {
		itemType: "digital_product",
		quantity: 1,
		unitPrice: { minor: unitMinor },
		discountAmount: { minor: 0 },
		isSelectedForCheckout: true,
		savedForLater: false,
		available: true,
	} as BasketItem;
}

Deno.test("a negotiated rate drives the checkout fee; the display fallback only fills a gap", () => {
	const items = [product(1050)];
	const negotiated = checkoutTotals({ items, platformFeeBp: 300 });
	assertEquals(negotiated.platformFeeBp, 300);
	assertEquals(negotiated.platformFeeMinor, 31);
	assertEquals(negotiated.totalMinor, 1050);

	const fallback = checkoutTotals({ items });
	assertEquals(fallback.platformFeeBp, PLATFORM_FEE_BP);
	assertEquals(fallback.platformFeeMinor, 52);
});

Deno.test("buyer_added adds the truncated fee to the total", () => {
	const t = checkoutTotals({ items: [product(1050)], platformFeeBp: 300, feeMode: "buyer_added" });
	assertEquals(t.totalMinor, 1050 + 31);
});
