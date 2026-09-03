import { assertEquals } from "@std/assert";
import { currencyExponent, toMajorUnits, toMinorUnits } from "./wallet.ts";

/**
 * The major/minor boundary conversion, pinned.
 *
 * Every one of these is a figure a person typed into a price field, and getting a conversion wrong
 * here is not a layout bug — it is a project priced at a hundred times what its owner meant, with
 * both sides `number` and both plausible to a type-checker.
 */

Deno.test("a zero-exponent currency does not gain two decimal places", () => {
	// The failure this exists to catch: a hardcoded x100 turns JP¥5,000 into 500,000 minor units.
	assertEquals(currencyExponent("JPY"), 0);
	assertEquals(toMinorUnits(5000, "JPY"), 5000);
	assertEquals(toMinorUnits(5000, "GBP"), 500_000);
});

Deno.test("a three-exponent currency gets all three", () => {
	assertEquals(toMinorUnits(1.5, "KWD"), 1500);
	assertEquals(toMinorUnits(1.5, "BHD"), 1500);
});

Deno.test("an unknown currency defaults to two, never to zero", () => {
	// Defaulting to zero would under-price by 100x, which is the direction that loses a seller money.
	assertEquals(toMinorUnits(10, "ZZZ"), 1000);
});

Deno.test("null is preserved — unpriced is not free", () => {
	// The distinction the setup ladder counts: `null` means nobody has priced this, `0` means it costs
	// nothing. A `??` that folded them would tick the pricing step off against a decision not taken.
	assertEquals(toMinorUnits(null, "GBP"), null);
	assertEquals(toMajorUnits(null, "GBP"), null);
	assertEquals(toMinorUnits(0, "GBP"), 0);
});

Deno.test("a negative figure clamps to zero rather than storing a negative price", () => {
	// `budget_amount_cents` carries `CHECK (>= 0)`, so an unclamped negative is a 500 from a column
	// constraint rather than a field the owner can correct.
	assertEquals(toMinorUnits(-50, "GBP"), 0);
});

Deno.test("a non-finite figure is null, not NaN", () => {
	// An empty or mid-typing `InputNumber` can yield NaN; `Math.round(NaN)` is NaN, and NaN in a money
	// column is a write that fails at the database with nothing to point the owner at.
	assertEquals(toMinorUnits(Number.NaN, "GBP"), null);
	assertEquals(toMinorUnits(Number.POSITIVE_INFINITY, "GBP"), null);
});

Deno.test("major and minor round-trip at each exponent", () => {
	for (const [code, major] of [["GBP", 12.34], ["JPY", 1234], ["KWD", 1.234]] as const) {
		assertEquals(toMajorUnits(toMinorUnits(major, code), code), major);
	}
});

Deno.test("a sub-unit fraction rounds rather than truncating", () => {
	assertEquals(toMinorUnits(0.005, "GBP"), 1);
	assertEquals(toMinorUnits(0.004, "GBP"), 0);
});
