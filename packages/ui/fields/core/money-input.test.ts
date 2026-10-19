import { assert, assertEquals } from "@std/assert";
import { formatMoney } from "../../display/core/currency-store.ts";
import {
	clampMinor,
	currencyAdornment,
	formatMoneyInput,
	numberSeparators,
	parseMoneyInput,
} from "./money-input.ts";

const CASES = [
	{ locale: "en-GB", currency: "GBP" },
	{ locale: "de-DE", currency: "EUR" },
	{ locale: "ja-JP", currency: "JPY" },
	{ locale: "pt-PT", currency: "USD" },
	{ locale: "fr-FR", currency: "EUR" },
] as const;

const AMOUNTS = [0, 1, 5, 99, 100, 1_234, 123_456, 1_234_567_89, 9_007_199_254];

for (const { locale, currency } of CASES) {
	Deno.test(`${locale} ${currency}: format then parse returns the same minor units`, () => {
		for (const minor of AMOUNTS) {
			const text = formatMoneyInput(minor, currency, locale);
			assertEquals(parseMoneyInput(text, currency, locale), minor, `${minor} → "${text}"`);
		}
	});
}

Deno.test("each locale reads its own separators", () => {
	assertEquals(numberSeparators("en-GB"), { group: ",", decimal: "." });
	assertEquals(numberSeparators("de-DE"), { group: ".", decimal: "," });
	assertEquals(parseMoneyInput("1,234.56", "GBP", "en-GB"), 123_456);
	assertEquals(parseMoneyInput("1.234,56", "EUR", "de-DE"), 123_456);
	assertEquals(parseMoneyInput("1,234", "JPY", "ja-JP"), 1_234);
});

Deno.test("formatting groups and keeps the currency's decimals", () => {
	assertEquals(formatMoneyInput(123_456, "GBP", "en-GB"), "1,234.56");
	assertEquals(formatMoneyInput(123_456, "EUR", "de-DE"), "1.234,56");
	assertEquals(formatMoneyInput(1_234, "JPY", "ja-JP"), "1,234");
	assertEquals(formatMoneyInput(500, "GBP", "en-GB"), "5.00");
});

/** Locales whose grouping rules differ: always, from five integer digits, a thin space, a dot. */
const FIGURE_LOCALES = [
	"en-GB",
	"en-US",
	"de-DE",
	"fr-FR",
	"pt-PT",
	"pt-BR",
	"es-ES",
	"pl-PL",
	"ja-JP",
];

Deno.test("the box prints the digits a MoneyView of the same amount prints, in every locale", () => {
	// pt-PT, es-ES and pl-PL group only from five integer digits; forcing grouping printed "1 000,00".
	assertEquals(formatMoneyInput(100_000, "USD", "pt-PT"), "1000,00");
	assertEquals(formatMoneyInput(100_000, "EUR", "es-ES"), "1000,00");
	for (const locale of FIGURE_LOCALES) {
		for (const currency of ["USD", "EUR", "JPY"]) {
			for (const minor of AMOUNTS) {
				const box = formatMoneyInput(minor, currency, locale);
				const figure = formatMoney(minor, currency, locale);
				assert(figure.includes(box), `${locale} ${currency} ${minor}: "${box}" not in "${figure}"`);
			}
		}
	}
});

Deno.test("typing is forgiving: marks, spaces, partial and extra decimals", () => {
	assertEquals(parseMoneyInput("£12", "GBP", "en-GB"), 1_200);
	assertEquals(parseMoneyInput(" 12.5 ", "GBP", "en-GB"), 1_250);
	assertEquals(parseMoneyInput(".5", "GBP", "en-GB"), 50);
	assertEquals(parseMoneyInput("12.", "GBP", "en-GB"), 1_200);
	assertEquals(parseMoneyInput("1.005", "GBP", "en-GB"), 101);
	assertEquals(parseMoneyInput("1.004", "GBP", "en-GB"), 100);
	assertEquals(parseMoneyInput("12,5 €", "EUR", "de-DE"), 1_250);
	assertEquals(parseMoneyInput("−3.50", "GBP", "en-GB"), -350);
	assertEquals(parseMoneyInput("12.4", "JPY", "ja-JP"), 12);
});

Deno.test("nothing readable is null, not zero", () => {
	assertEquals(parseMoneyInput("", "GBP", "en-GB"), null);
	assertEquals(parseMoneyInput("abc", "GBP", "en-GB"), null);
	assertEquals(parseMoneyInput("1.2.3", "GBP", "en-GB"), null);
	assertEquals(parseMoneyInput("-", "GBP", "en-GB"), null);
});

Deno.test("the currency mark sits on its locale's side", () => {
	assertEquals(currencyAdornment("GBP", "en-GB"), { symbol: "£", position: "start" });
	assertEquals(currencyAdornment("EUR", "de-DE"), { symbol: "€", position: "end" });
	assertEquals(currencyAdornment("JPY", "ja-JP").position, "start");
});

Deno.test("blur clamps into the bounds", () => {
	assertEquals(clampMinor(-5, 0), 0);
	assertEquals(clampMinor(50_000, 0, 10_000), 10_000);
	assertEquals(clampMinor(500, 0, 10_000), 500);
});
