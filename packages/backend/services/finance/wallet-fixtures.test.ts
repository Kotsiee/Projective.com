import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
	convertMinorUnits,
	currencyExponent,
	DISPLAY_CURRENCIES,
	resolveRate,
} from "@projective/types/finance";
import { FX_FIXTURE_BASE, FX_FIXTURE_RATES } from "./fx-fixtures.ts";
import { toMoney } from "./wallet-fixtures.ts";

/**
 * Regression tests for the fixture money projection every finance surface renders through.
 *
 * These exist because `toMoney` shipped two compounding conversion bugs that were invisible in
 * review, and both had the same shape: a plausible number produced with full confidence.
 *
 * 1. The FX table was a private three-entry map (`GBP`/`USD`/`EUR`) with a `?? 1` fallback, so the
 *    other **nine** offerable display currencies silently converted at a rate of exactly 1.
 * 2. The converter multiplied minor units by the rate directly, asserting the fixture set was "2dp".
 *    JPY has exponent 0, so yen figures were wrong by a further factor of 100 on top of the rate.
 *
 * The invariant they now protect is the one the whole money contract rests on: **the server's figure
 * and the client's re-projection of it derive from ONE table.** A test that only checked GBP → USD
 * would have passed throughout the entire period both bugs were live, which is precisely why the
 * first case below iterates the full offerable set rather than a sample.
 */

const LOCALE = "en-GB";

Deno.test("toMoney — every offerable display currency converts at a real rate, not the 1 fallback", () => {
	// £100.00 in the platform base. Any currency whose rate is not 1 must move the figure.
	const originMinor = 100_00;

	for (const option of DISPLAY_CURRENCIES) {
		const code = option.code;
		const rate = FX_FIXTURE_RATES[code];
		assert(
			typeof rate === "number" && rate > 0,
			`${code} is offerable in the switcher but has no seeded rate — the switcher would render an unconverted amount under the wrong symbol.`,
		);

		const money = toMoney(originMinor, FX_FIXTURE_BASE, code, LOCALE);
		const expected = convertMinorUnits(
			originMinor,
			rate,
			currencyExponent(FX_FIXTURE_BASE),
			currencyExponent(code),
		);
		assertEquals(
			money.minor,
			expected,
			`${code} converted to ${money.minor} but the seeded table says ${expected}.`,
		);
	}
});

Deno.test("toMoney — a zero-decimal currency is exponent-corrected, not multiplied as if it were 2dp", () => {
	// The exact defect: £100.00 (10000 minor, exponent 2) into JPY (exponent 0) at 192.
	// Correct: 100 × 192 = ¥19,200 → 19200 minor.
	// The old code returned 10000 × 192 = 1,920,000 minor, which formats as ¥1,920,000.
	const money = toMoney(100_00, "GBP", "JPY", LOCALE);

	assertEquals(currencyExponent("JPY"), 0, "JPY must be a zero-decimal currency.");
	assertEquals(money.minor, 19_200);
	assert(
		!money.display.includes("."),
		`A zero-decimal currency must format without phantom minor units, got "${money.display}".`,
	);
});

Deno.test("toMoney — the rate it discloses is the rate it actually applied", () => {
	// An invoice reprints this rate as the record of its own conversion, so a disclosed rate that
	// differs from the applied one would make the document unable to reproduce its own arithmetic.
	const money = toMoney(95_00, "USD", "AED", LOCALE);
	const disclosed = money.origin?.fxRate;
	assert(disclosed !== undefined, "A cross-currency figure must disclose its origin and rate.");

	const resolved = resolveRate({ base: FX_FIXTURE_BASE, rates: FX_FIXTURE_RATES }, "USD", "AED");
	assert(resolved !== null, "USD → AED must be resolvable by triangulation through the base.");
	assertAlmostEquals(disclosed, Math.round(resolved * 10000) / 10000, 1e-9);

	// And the applied figure agrees with that same rate.
	assertEquals(
		money.minor,
		convertMinorUnits(95_00, resolved, currencyExponent("USD"), currencyExponent("AED")),
	);
});

Deno.test("toMoney — a same-currency figure carries no origin and is not re-derived", () => {
	// A "(~£12.00 GBP)" tail beside £12.00 would manufacture doubt about an exact number.
	const money = toMoney(12_00, "GBP", "GBP", LOCALE);
	assertEquals(money.origin, null);
	assertEquals(money.minor, 12_00);
});

Deno.test("toMoney — a pair with neither side as the base triangulates through it", () => {
	// USD → EUR touches the base on neither leg. The client resolves it by triangulation, so the
	// server must too, or the two answers diverge on exactly the pairs nobody tests.
	const money = toMoney(200_00, "USD", "EUR", LOCALE);
	const rate = resolveRate({ base: FX_FIXTURE_BASE, rates: FX_FIXTURE_RATES }, "USD", "EUR");
	assert(rate !== null);
	assertEquals(
		money.minor,
		convertMinorUnits(200_00, rate, currencyExponent("USD"), currencyExponent("EUR")),
	);
});
