import { assertEquals } from "@std/assert";
import { effectiveDateFormat, formatDateValue, localeDateOrder } from "./date-format.ts";
import { localeDirection, resolveLayoutDirection } from "./preferences.ts";

const OCT_8 = new Date(Date.UTC(2026, 9, 8, 12));

Deno.test("localeDateOrder — reads each locale's order from Intl", () => {
	assertEquals(localeDateOrder("en-GB"), "dmy");
	assertEquals(localeDateOrder("en-US"), "mdy");
	assertEquals(localeDateOrder("ja-JP"), "ymd");
	assertEquals(localeDateOrder("de-DE"), "dmy");
});

Deno.test("effectiveDateFormat — an explicit choice survives a language change", () => {
	assertEquals(effectiveDateFormat(null, "en-US"), "mdy");
	assertEquals(effectiveDateFormat(null, "en-GB"), "dmy");
	assertEquals(effectiveDateFormat("ymd", "en-US"), "ymd");
	assertEquals(effectiveDateFormat("ymd", "en-GB"), "ymd");
});

Deno.test("formatDateValue — explicit orders are zero-padded patterns", () => {
	const base = { locale: "en-US", timeZone: "UTC" };
	assertEquals(formatDateValue(OCT_8, { ...base, dateFormat: "dmy" }), "08/10/2026");
	assertEquals(formatDateValue(OCT_8, { ...base, dateFormat: "mdy" }), "10/08/2026");
	assertEquals(formatDateValue(OCT_8, { ...base, dateFormat: "ymd" }), "2026-10-08");
});

Deno.test("formatDateValue — null follows the locale's own form", () => {
	assertEquals(
		formatDateValue(OCT_8, { locale: "en-GB", dateFormat: null, timeZone: "UTC" }),
		"08/10/2026",
	);
	assertEquals(
		formatDateValue(OCT_8, { locale: "en-US", dateFormat: null, timeZone: "UTC" }),
		"10/08/2026",
	);
	assertEquals(formatDateValue(new Date(Number.NaN), { locale: "en-GB", dateFormat: null }), "");
});

Deno.test("localeDirection — the script decides, an explicit script subtag first", () => {
	assertEquals(localeDirection("ar-AE"), "rtl");
	assertEquals(localeDirection("he-IL"), "rtl");
	assertEquals(localeDirection("ur-PK"), "rtl");
	assertEquals(localeDirection("en-GB"), "ltr");
	assertEquals(localeDirection("az-Arab"), "rtl");
	assertEquals(localeDirection("pa-Arab-PK"), "rtl");
	assertEquals(localeDirection("ar-Latn"), "ltr");
	assertEquals(localeDirection("fa_IR"), "rtl");
});

Deno.test("resolveLayoutDirection — auto follows the locale, a choice wins", () => {
	assertEquals(resolveLayoutDirection("auto", "ar-AE"), "rtl");
	assertEquals(resolveLayoutDirection("auto", "en-GB"), "ltr");
	assertEquals(resolveLayoutDirection("ltr", "ar-AE"), "ltr");
	assertEquals(resolveLayoutDirection("rtl", "en-GB"), "rtl");
});
