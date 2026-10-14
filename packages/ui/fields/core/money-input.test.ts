import { assertEquals } from "@std/assert";
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
