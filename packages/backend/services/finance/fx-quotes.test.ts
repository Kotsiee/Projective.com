import { assertEquals } from "@std/assert";
import { lockQuote } from "./fx-quotes.ts";

Deno.test("#436: a development off override answers no conversion before any read", async () => {
	const lock = await lockQuote(
		{
			userId: "u-1",
			accessToken: "token",
			contextId: "u-1",
			contextType: "personal",
			fxCheckoutOverride: "off",
		},
		{
			ownerType: "user",
			ownerId: "u-1",
			fromCurrency: "GBP",
			toCurrency: "EUR",
			toMinor: 9_000,
			purpose: "checkout",
			refTable: "baskets",
			refId: "0f0e0d0c-0b0a-4908-8706-050403020100",
		},
		{ availableMinor: 100_000 },
	);
	assertEquals(lock, { ok: false, reason: null });
});
