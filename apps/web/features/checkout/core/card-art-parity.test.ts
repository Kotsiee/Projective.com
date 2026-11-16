import { assertEquals } from "@std/assert";
import { CardBrand, resolveCardArt } from "@projective/types/finance";
import { paymentCardArt } from "@ui/display/core/payment-card.ts";

const BINS = [null, "424242", "555555", "222100", "378282", "601100", "650000", "620000", "999999"];

Deno.test("the package's local art fallback is byte-identical to the SSOT's resolveCardArt", () => {
	for (const brand of [...CardBrand.options, null]) {
		for (const binNumber of BINS) {
			for (const isBusinessCard of [false, true]) {
				assertEquals(
					paymentCardArt({ brand, binNumber, isBusinessCard }),
					resolveCardArt({ brand, binNumber, isBusinessCard }),
					`${brand} / ${binNumber} / ${isBusinessCard}`,
				);
			}
		}
	}
});
