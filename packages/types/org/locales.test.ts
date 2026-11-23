import { assertEquals } from "@std/assert";
import { displayCurrencyForRegion } from "../finance/fx.ts";
import {
	acceptLanguageTags,
	firstWeekdayOf,
	preferenceHints,
	SUPPORTED_LOCALES,
	toSupportedLocale,
} from "./locales.ts";

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
	assertEquals(preferenceHints(["en-US", "en"]), {
		locale: "en-US",
		country: "US",
		displayCurrency: "USD",
	});
	assertEquals(
		preferenceHints(["en-NZ", "de-AT"]),
		{ country: "NZ" },
		"only the first stated region is suggested, and NZ has no display currency",
	);
});

Deno.test("preferenceHints: the time zone suggests the country before the language does", () => {
	assertEquals(preferenceHints(["en-US"], "Europe/Berlin"), {
		locale: "en-US",
		country: "DE",
		displayCurrency: "EUR",
	});
	assertEquals(
		preferenceHints(["en-GB"], "Antarctica/Troll").country,
		"GB",
		"an unmapped zone falls back",
	);
	assertEquals(preferenceHints(["en"], "Asia/Tokyo"), {
		locale: "en-US",
		country: "JP",
		displayCurrency: "JPY",
	});
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

Deno.test("acceptLanguageTags: weights order the tags, equal weights keep their written order", () => {
	assertEquals(acceptLanguageTags("fr;q=0.5, en-US, de-DE;q=0.8, en"), [
		"en-US",
		"en",
		"de-DE",
		"fr",
	]);
	assertEquals(acceptLanguageTags("en-GB,en;q=0.9"), ["en-GB", "en"]);
});

Deno.test("acceptLanguageTags: q=0, the wildcard and junk weights are dropped", () => {
	assertEquals(acceptLanguageTags("*, ar-AE;q=0, en-IN;q=abc, ja-JP;q=0.1"), ["ja-JP"]);
	assertEquals(acceptLanguageTags(""), []);
	assertEquals(acceptLanguageTags(null), []);
});

Deno.test("a guest's Accept-Language region prices them in its currency; a bare language does not", () => {
	assertEquals(preferenceHints(acceptLanguageTags("en-US,en;q=0.9")).displayCurrency, "USD");
	assertEquals(preferenceHints(acceptLanguageTags("de-DE,de;q=0.9")).displayCurrency, "EUR");
	assertEquals(preferenceHints(acceptLanguageTags("en;q=0.9")).displayCurrency, undefined);
});

Deno.test("firstWeekdayOf: the region decides, numbered as availability_rules.weekday (0 = Sunday)", () => {
	assertEquals(firstWeekdayOf("en-GB"), 1);
	assertEquals(firstWeekdayOf("en-US"), 0);
	assertEquals(firstWeekdayOf("pt-BR"), 0);
	assertEquals(firstWeekdayOf("ar-EG"), 6);
	assertEquals(firstWeekdayOf("dv-MV"), 5);
	assertEquals(firstWeekdayOf("ar-AE"), 1);
});

Deno.test("firstWeekdayOf: an explicit -u-fw- keyword wins; a bare language uses its likely region", () => {
	assertEquals(firstWeekdayOf("en-GB-u-fw-sun"), 0);
	assertEquals(firstWeekdayOf("en-US-u-ca-gregory-fw-mon"), 1);
	assertEquals(firstWeekdayOf("ja"), 0);
	assertEquals(firstWeekdayOf("de"), 1);
});

Deno.test("firstWeekdayOf: an unreadable or missing locale starts on Monday", () => {
	assertEquals(firstWeekdayOf("not a locale!"), 1);
	assertEquals(firstWeekdayOf(""), 1);
	assertEquals(firstWeekdayOf(null), 1);
	assertEquals(firstWeekdayOf(undefined), 1);
});

Deno.test("firstWeekdayOf: agrees with the engine's CLDR week data for every offered locale", () => {
	for (const tag of SUPPORTED_LOCALES) {
		const info =
			(new Intl.Locale(tag) as Intl.Locale & { getWeekInfo?: () => { firstDay: number } })
				.getWeekInfo?.();
		if (!info) continue;
		assertEquals(firstWeekdayOf(tag), info.firstDay % 7, tag);
	}
});
