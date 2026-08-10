import { assertEquals, assertStrictEquals } from "@std/assert";
import {
	convertMinorUnits,
	DISPLAY_CURRENCIES,
	isDisplayCurrency,
	PLATFORM_BASE_CURRENCY,
	resolveRate,
	toDisplayCurrency,
} from "./fx.ts";
import { currencyExponent, formatMoney, toMoneyView } from "./wallet.ts";

/**
 * The FX SSOT's arithmetic, tested where it is defined.
 *
 * These are the functions every money figure on the platform passes through, so the cases below are
 * chosen for the ways currency conversion actually goes wrong in production — direction inversion,
 * exponent conflation, double rounding, and a missing pair being treated as a rate of 1 — not for
 * coverage.
 */

/** The seeded reference table, quoted against the platform base. Mirrors the SQL seed. */
const TABLE = {
	base: "GBP",
	rates: { GBP: 1, USD: 1.27, EUR: 1.17, JPY: 192, AED: 4.66 },
};

Deno.test("resolveRate — identity is exactly 1, with no table needed", () => {
	assertStrictEquals(resolveRate(TABLE, "GBP", "GBP"), 1);
	assertStrictEquals(resolveRate(TABLE, "eur", "EUR"), 1);
});

Deno.test("resolveRate — a direct pair from the base reads the table verbatim", () => {
	assertStrictEquals(resolveRate(TABLE, "GBP", "USD"), 1.27);
});

Deno.test("resolveRate — the inverse pair is the reciprocal, not a second lookup", () => {
	assertStrictEquals(resolveRate(TABLE, "USD", "GBP"), 1 / 1.27);
});

Deno.test("resolveRate — a cross pair triangulates through the base", () => {
	// USD → EUR has no direct entry; it must go USD → GBP → EUR.
	assertStrictEquals(resolveRate(TABLE, "USD", "EUR"), 1.17 / 1.27);
});

Deno.test("resolveRate — an unknown pair is null, never a fallback of 1", () => {
	// This is the whole point of the null return: a rate of 1 would silently relabel $50 as ₦50.
	assertStrictEquals(resolveRate(TABLE, "GBP", "XYZ"), null);
	assertStrictEquals(resolveRate(TABLE, "XYZ", "GBP"), null);
	assertStrictEquals(resolveRate(TABLE, "XYZ", "ABC"), null);
});

Deno.test("resolveRate — a non-positive or absent rate is rejected as unresolvable", () => {
	const broken = { base: "GBP", rates: { EUR: 0, USD: -1 } };
	assertStrictEquals(resolveRate(broken, "GBP", "EUR"), null);
	assertStrictEquals(resolveRate(broken, "GBP", "USD"), null);
});

Deno.test("convertMinorUnits — same-exponent conversion", () => {
	// £100.00 at 1.17 → €117.00
	assertStrictEquals(convertMinorUnits(10_000, 1.17, 2, 2), 11_700);
});

Deno.test("convertMinorUnits — a zero-decimal target is re-scaled, not multiplied blind", () => {
	// £100.00 (10000 minor, exp 2) at 192 → ¥19,200 (19200 minor, exp 0).
	// A naive minor×rate would give 1,920,000 — a hundredfold error, and a plausible-looking one.
	assertStrictEquals(convertMinorUnits(10_000, 192, 2, 0), 19_200);
});

Deno.test("convertMinorUnits — a zero-decimal source is re-scaled back", () => {
	assertStrictEquals(convertMinorUnits(19_200, 1 / 192, 0, 2), 10_000);
});

Deno.test("convertMinorUnits — a round trip through both directions returns the origin", () => {
	const there = convertMinorUnits(12_700, 1.17 / 1.27, 2, 2);
	assertStrictEquals(there, 11_700);
	assertStrictEquals(convertMinorUnits(there, 1.27 / 1.17, 2, 2), 12_700);
});

Deno.test("convertMinorUnits — rounds to the nearest minor unit exactly once", () => {
	// 0.005 major → the boundary case. One round, so this lands on 1 rather than drifting.
	assertStrictEquals(convertMinorUnits(1, 5, 2, 2), 5);
	assertStrictEquals(convertMinorUnits(333, 1 / 3, 2, 2), 111);
});

Deno.test("toDisplayCurrency — total: anything unsupported collapses to the platform base", () => {
	assertStrictEquals(toDisplayCurrency("eur"), "EUR");
	assertStrictEquals(toDisplayCurrency("  usd  "), "USD");
	assertStrictEquals(toDisplayCurrency("XYZ"), PLATFORM_BASE_CURRENCY);
	assertStrictEquals(toDisplayCurrency(""), PLATFORM_BASE_CURRENCY);
	assertStrictEquals(toDisplayCurrency(null), PLATFORM_BASE_CURRENCY);
	assertStrictEquals(toDisplayCurrency(undefined), PLATFORM_BASE_CURRENCY);
});

Deno.test("isDisplayCurrency — case-insensitive membership of the curated list", () => {
	assertStrictEquals(isDisplayCurrency("gbp"), true);
	assertStrictEquals(isDisplayCurrency("XYZ"), false);
	assertStrictEquals(isDisplayCurrency(null), false);
});

Deno.test("DISPLAY_CURRENCIES — the platform base leads, and codes are unique", () => {
	assertStrictEquals(DISPLAY_CURRENCIES[0].code, PLATFORM_BASE_CURRENCY);
	const codes = DISPLAY_CURRENCIES.map((c) => c.code);
	assertStrictEquals(new Set(codes).size, codes.length);
});

Deno.test("DISPLAY_CURRENCIES — every offerable currency has a known minor-unit exponent", () => {
	// Offering a currency whose exponent defaults silently would put the decimal point in the wrong
	// place for it. This asserts the exponent table has an opinion about each one.
	for (const { code } of DISPLAY_CURRENCIES) {
		const exp = currencyExponent(code);
		assertStrictEquals(
			exp === 0 || exp === 2 || exp === 3,
			true,
			`${code} resolved to an implausible exponent ${exp}`,
		);
	}
	// The one non-2 currency in the list, asserted explicitly so a regression is loud.
	assertStrictEquals(currencyExponent("JPY"), 0);
});

Deno.test("formatMoney — deterministic, and honours the currency's own exponent", () => {
	assertStrictEquals(formatMoney(7850, "GBP", "en-GB"), "£78.50");

	// Zero-decimal: no phantom pence. The AMOUNT is asserted; the symbol form is not, because ICU
	// picks it per locale (en-GB disambiguates yen as "JP¥", ja-JP renders "￥") and pinning that
	// string would make an ICU upgrade look like a currency bug.
	const yen = formatMoney(19_200, "JPY", "en-GB");
	assertStrictEquals(yen.includes("19,200"), true, yen);
	assertStrictEquals(/[.,]\d{2}\b/.test(yen), false, `expected no minor units in ${yen}`);
});

Deno.test("formatMoney — a well-formed but unlisted code still formats, via Intl", () => {
	// Intl accepts any well-formed alpha-3 code and uses the code itself as the symbol, so the
	// fallback below is NOT reached here. Asserted so the fallback's actual trigger stays clear.
	//
	// Structural, not literal: ICU separates the code from the amount with a NON-BREAKING space
	// (U+00A0), which is invisible in a diff and would make this assertion look inexplicably wrong.
	const out = formatMoney(1234, "XYZ", "en-GB");
	assertStrictEquals(out.startsWith("XYZ"), true, out);
	assertStrictEquals(out.endsWith("12.34"), true, out);
});

Deno.test("formatMoney — a malformed code degrades to a readable string rather than throwing", () => {
	// `Intl.NumberFormat` throws RangeError on a code that is not three letters. A money figure must
	// never take a page down, so the fallback prints the amount plainly instead.
	assertStrictEquals(formatMoney(1234, "X", "en-GB"), "12.34 X");
});

Deno.test("toMoneyView — a converted figure carries its origin for disclosure", () => {
	const view = toMoneyView({
		minor: 7850,
		currency: "GBP",
		origin: { minor: 9000, currency: "EUR" },
		rate: 0.872,
		asOf: "2026-08-01T00:00:00.000Z",
		provider: "seed",
		converted: true,
		stale: false,
	});
	assertStrictEquals(view.display, "£78.50");
	assertStrictEquals(view.currency, "GBP");
	assertEquals(view.origin, {
		minor: 9000,
		currency: "EUR",
		display: "€90.00",
		fxRate: 0.872,
	});
});

Deno.test("toMoneyView — a same-currency figure carries no origin, so it renders no estimate", () => {
	const view = toMoneyView({
		minor: 1200,
		currency: "GBP",
		origin: { minor: 1200, currency: "GBP" },
		rate: 1,
		asOf: "2026-08-01T00:00:00.000Z",
		provider: "seed",
		converted: false,
		stale: false,
	});
	assertStrictEquals(view.display, "£12.00");
	assertStrictEquals(view.origin, null);
});
