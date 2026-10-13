import { assertEquals } from "@std/assert";
import { displayCurrencyForRegion } from "../finance/fx.ts";
import { preferenceHints, toSupportedLocale } from "./locales.ts";

Deno.test("toSupportedLocale: an offered tag is kept in its canonical form", () => {
	assertEquals(toSupportedLocale("en-US"), "en-US");
	assertEquals(toSupportedLocale(" fr_fr "), "fr-FR");
	assertEquals(toSupportedLocale("PT-br"), "pt-BR");
});

Deno.test("toSupportedLocale: a bare language or a script subtag resolves through its likely region", () => {
	assertEquals(toSupportedLocale("fr"), "fr-FR");
	assertEquals(toSupportedLocale("ja"), "ja-JP");
	assertEquals(toSupportedLocale("zh-Hans-CN"), "zh-CN");
});

Deno.test("toSupportedLocale: an unoffered, malformed or empty tag is undefined", () => {
	assertEquals(toSupportedLocale("en-NZ"), undefined);
	assertEquals(toSupportedLocale("xx-YY"), undefined);
	assertEquals(toSupportedLocale("not a locale!"), undefined);
	assertEquals(toSupportedLocale(""), undefined);
	assertEquals(toSupportedLocale(undefined), undefined);
});

Deno.test("displayCurrencyForRegion: an offered currency by its territory, the euro across its area", () => {
	assertEquals(displayCurrencyForRegion("GB"), "GBP");
	assertEquals(displayCurrencyForRegion("us"), "USD");
	assertEquals(displayCurrencyForRegion("DE"), "EUR");
	assertEquals(displayCurrencyForRegion("BG"), "EUR");
	assertEquals(displayCurrencyForRegion("AE"), "AED");
	assertEquals(displayCurrencyForRegion("NZ"), undefined, "NZD is not offered");
	assertEquals(displayCurrencyForRegion(undefined), undefined);
});

Deno.test("preferenceHints: the first offered locale and the first stated region", () => {
	assertEquals(preferenceHints(["en-US", "en"]), { locale: "en-US", displayCurrency: "USD" });
	assertEquals(
		preferenceHints(["en-NZ", "de-AT"]),
		{},
		"only the first stated region picks a currency",
	);
});

Deno.test("preferenceHints: an unsupported region leaves the currency to the default", () => {
	const hints = preferenceHints(["en-NZ", "fr-FR"]);
	assertEquals(hints.locale, "fr-FR");
	assertEquals("displayCurrency" in hints, false);
});

Deno.test("preferenceHints: a bare language never picks a currency", () => {
	assertEquals(preferenceHints(["en"]), { locale: "en-US" });
	assertEquals(preferenceHints([]), {});
	assertEquals(preferenceHints(["???"]), {});
});
