import { assertEquals, assertStrictEquals } from "@std/assert";
import {
	bootstrapCurrency,
	convertMinorUnits as uiConvert,
	currencyExponent as uiExponent,
	type CurrencyRateTable,
	displayCurrency,
	displayLocale,
	formatMoney,
	fxTable,
	type MoneyValue,
	projectMoney,
	resolveRate as uiResolveRate,
	setDisplayCurrency,
} from "./currency-store.ts";
import {
	convertMinorUnits as typesConvert,
	DISPLAY_CURRENCIES,
	resolveRate as typesResolveRate,
} from "@projective/types/finance";
import { currencyExponent as typesExponent } from "@projective/types/finance";

/**
 * The presentation store's projection, plus the **drift guard**.
 *
 * `packages/ui` cannot import `@projective/types` (the portability contract), so the conversion maths
 * exists twice — once on each side of that boundary. That duplication is only safe if something
 * proves the two agree, which is what the final block here does: it runs both implementations over
 * the full currency matrix and asserts they return identical values. If either side is ever edited
 * alone, this fails rather than quietly producing two different prices for the same figure.
 */

const TABLE: CurrencyRateTable = {
	base: "GBP",
	rates: { GBP: 1, USD: 1.27, EUR: 1.17, JPY: 192, AED: 4.66 },
	asOf: "2026-08-01T00:00:00.000Z",
	provider: "seed",
	stale: false,
};

/** A server-resolved figure: £78.50, originally priced at €90.00. */
const CONVERTED: MoneyValue = {
	minor: 7850,
	currency: "GBP",
	display: "£78.50",
	origin: { minor: 9000, currency: "EUR", display: "€90.00", fxRate: 0.872 },
};

/** A plain same-currency figure. */
const PLAIN: MoneyValue = { minor: 1200, currency: "GBP", display: "£12.00", origin: null };

// #region projectMoney
Deno.test("projectMoney — the server's own answer is returned verbatim, not re-derived", () => {
	// The server converted using the authoritative snapshot rate (0.872). The client's table says
	// 1/1.17 ≈ 0.8547. Re-deriving would move a figure that was already correct, and would make SSR
	// and hydration disagree — so target === resolved must short-circuit.
	const out = projectMoney(CONVERTED, "GBP", "en-GB", TABLE);
	assertStrictEquals(out.display, "£78.50");
	assertStrictEquals(out.minor, 7850);
	assertStrictEquals(out.converted, true);
	assertStrictEquals(out.rate, 0.872);
	assertEquals(out.origin, { display: "€90.00", currency: "EUR", minor: 9000 });
});

Deno.test("projectMoney — asking for the origin currency yields the exact origin, with no marker", () => {
	const out = projectMoney(CONVERTED, "EUR", "en-GB", TABLE);
	assertStrictEquals(out.display, "€90.00");
	assertStrictEquals(out.minor, 9000);
	assertStrictEquals(out.converted, false);
	// No disclosure: nothing about this figure is approximate.
	assertStrictEquals(out.origin, null);
});

Deno.test("projectMoney — a third currency converts from the ORIGIN, never from the conversion", () => {
	// €90.00 → USD must go through the origin (EUR), not through the server's GBP figure. Converting a
	// conversion compounds two roundings and drifts on every switch.
	const out = projectMoney(CONVERTED, "USD", "en-GB", TABLE);
	const expected = uiConvert(9000, 1.27 / 1.17, 2, 2);
	assertStrictEquals(out.minor, expected);
	assertStrictEquals(out.currency, "USD");
	assertStrictEquals(out.converted, true);
	assertEquals(out.origin, { display: "€90.00", currency: "EUR", minor: 9000 });
});

Deno.test("projectMoney — a plain figure converts and discloses its origin", () => {
	const out = projectMoney(PLAIN, "EUR", "en-GB", TABLE);
	assertStrictEquals(out.display, "€14.04");
	assertStrictEquals(out.minor, 1404);
	assertStrictEquals(out.converted, true);
	assertEquals(out.origin, { display: "£12.00", currency: "GBP", minor: 1200 });
});

Deno.test("projectMoney — a same-currency figure renders the server string with no estimate", () => {
	const out = projectMoney(PLAIN, "GBP", "en-GB", TABLE);
	assertStrictEquals(out.display, "£12.00");
	assertStrictEquals(out.origin, null);
	assertStrictEquals(out.converted, false);
});

Deno.test("projectMoney — an unpriceable target falls back to the ORIGIN, not a relabel", () => {
	// The failure that matters: NGN is absent from this table. The figure must stay £12.00, not
	// become "₦12.00", which would be a wrong number wearing a confident symbol.
	const out = projectMoney(PLAIN, "NGN", "en-GB", TABLE);
	assertStrictEquals(out.display, "£12.00");
	assertStrictEquals(out.currency, "GBP");
	assertStrictEquals(out.converted, false);
	assertStrictEquals(out.rate, 1);
});

Deno.test("projectMoney — no table at all degrades to the origin rather than throwing", () => {
	const out = projectMoney(PLAIN, "EUR", "en-GB", null);
	assertStrictEquals(out.display, "£12.00");
	assertStrictEquals(out.currency, "GBP");
	assertStrictEquals(out.converted, false);
});

Deno.test("projectMoney — a zero-decimal target formats without phantom minor units", () => {
	const out = projectMoney(
		{ minor: 10_000, currency: "GBP", display: "£100.00", origin: null },
		"JPY",
		"en-GB",
		TABLE,
	);
	assertStrictEquals(out.minor, 19_200);
	// The amount, not the symbol: ICU renders yen as "JP¥" in en-GB and "￥" in ja-JP, so pinning the
	// glyph would make an ICU upgrade read as a conversion bug.
	assertStrictEquals(out.display.includes("19,200"), true, out.display);
	assertStrictEquals(/[.,]\d{2}\b/.test(out.display), false, out.display);
});
// #endregion

// #region The store
Deno.test("store — bootstrap seeds the signals, and setDisplayCurrency moves them", () => {
	bootstrapCurrency({ displayCurrency: "eur", locale: "de-DE", table: TABLE });
	assertStrictEquals(displayCurrency.value, "EUR");
	assertStrictEquals(displayLocale.value, "de-DE");
	assertStrictEquals(fxTable.value, TABLE);

	setDisplayCurrency("usd");
	assertStrictEquals(displayCurrency.value, "USD");

	// A malformed code is ignored rather than written — the store must never hold a code that cannot
	// be formatted or priced.
	setDisplayCurrency("US");
	assertStrictEquals(displayCurrency.value, "USD");

	// Restore, so ordering between test files cannot matter.
	bootstrapCurrency({ displayCurrency: "GBP", locale: "en-GB", table: TABLE });
});

Deno.test("formatMoney — locale drives grouping and symbol placement", () => {
	assertStrictEquals(formatMoney(123_456, "GBP", "en-GB"), "£1,234.56");
	// A locale that suffixes the symbol still round-trips through the same call.
	assertStrictEquals(formatMoney(123_456, "EUR", "de-DE").includes("€"), true);
});
// #endregion

// #region Drift guard — the two implementations of the same maths must agree
Deno.test("drift — resolveRate agrees across the packages/ui ⇄ @projective/types boundary", () => {
	const codes = ["GBP", "USD", "EUR", "JPY", "AED", "XYZ"];
	for (const from of codes) {
		for (const to of codes) {
			assertStrictEquals(
				uiResolveRate(TABLE, from, to),
				typesResolveRate(TABLE, from, to),
				`resolveRate(${from} → ${to}) diverged between packages/ui and @projective/types`,
			);
		}
	}
});

Deno.test("drift — convertMinorUnits agrees across the boundary", () => {
	const amounts = [0, 1, 99, 1200, 7850, 19_200, 123_456_789];
	const rates = [1, 1.17, 1 / 1.27, 192, 1 / 192, 4.66];
	for (const minor of amounts) {
		for (const rate of rates) {
			for (const [fromExp, toExp] of [[2, 2], [2, 0], [0, 2], [2, 3]]) {
				assertStrictEquals(
					uiConvert(minor, rate, fromExp, toExp),
					typesConvert(minor, rate, fromExp, toExp),
					`convertMinorUnits(${minor}, ${rate}, ${fromExp}→${toExp}) diverged`,
				);
			}
		}
	}
});

Deno.test("drift — the exponent tables agree for every offerable display currency", () => {
	for (const { code } of DISPLAY_CURRENCIES) {
		assertStrictEquals(
			uiExponent(code),
			typesExponent(code),
			`currencyExponent(${code}) diverged between packages/ui and @projective/types`,
		);
	}
});
// #endregion
