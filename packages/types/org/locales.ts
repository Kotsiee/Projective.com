import { displayCurrencyForRegion } from "../finance/fx.ts";

/**
 * org/locales — the formatting locales the platform offers (Settings → Language & region), and the
 * sign-up hints read from a browser's language list.
 *
 * `org.supported_locales` (seeded in `00005050_seed_reference_data.sql`) holds the same tags; the
 * sign-up seeders keep a locale only when it is listed there (Decision #207).
 */

// #region Supported locales
/** Every offered locale tag, in the Settings menu's order. */
export const SUPPORTED_LOCALES = [
	"en-GB",
	"en-US",
	"en-CA",
	"en-AU",
	"en-IN",
	"fr-FR",
	"de-DE",
	"es-ES",
	"es-MX",
	"it-IT",
	"nl-NL",
	"pl-PL",
	"pt-PT",
	"pt-BR",
	"sv-SE",
	"tr-TR",
	"ar-AE",
	"he-IL",
	"ur-PK",
	"hi-IN",
	"zh-CN",
	"ja-JP",
	"ko-KR",
] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

function exactLocale(tag: string): SupportedLocale | undefined {
	const wanted = tag.toLowerCase();
	return SUPPORTED_LOCALES.find((supported) => supported.toLowerCase() === wanted);
}

function parseLocale(tag: string): Intl.Locale | undefined {
	try {
		return new Intl.Locale(tag);
	} catch (error) {
		if (error instanceof RangeError) return undefined;
		throw error;
	}
}

/**
 * The offered locale a BCP-47 tag names, else `undefined`. Case and `_` / `-` are ignored; a tag
 * with a script or without a region resolves through its likely region (`fr` → `fr-FR`,
 * `zh-Hans-CN` → `zh-CN`).
 */
export function toSupportedLocale(tag: string | null | undefined): SupportedLocale | undefined {
	const cleaned = tag?.trim().replace(/_/g, "-");
	if (!cleaned) return undefined;
	const exact = exactLocale(cleaned);
	if (exact) return exact;
	const likely = parseLocale(cleaned)?.maximize();
	return likely?.region ? exactLocale(`${likely.language}-${likely.region}`) : undefined;
}
// #endregion

// #region Sign-up hints
/** What a browser suggests for a new account's preferences; each key is absent when unsupported. */
export interface PreferenceHints {
	locale?: SupportedLocale;
	/** An offerable display currency (ISO-4217). */
	displayCurrency?: string;
}

/**
 * The preference hints in a browser's language list (`navigator.languages`, most preferred first):
 * the first offered locale, and the display currency of the first tag that names a region. A bare
 * language says nothing about where someone lives, so it never picks a currency.
 */
export function preferenceHints(languages: readonly string[]): PreferenceHints {
	const hints: PreferenceHints = {};
	const locale = languages.map(toSupportedLocale).find((match) => match !== undefined);
	if (locale) hints.locale = locale;
	const region = languages
		.map((tag) => parseLocale(tag.trim().replace(/_/g, "-"))?.region)
		.find((match) => match !== undefined);
	const currency = displayCurrencyForRegion(region);
	if (currency) hints.displayCurrency = currency;
	return hints;
}
// #endregion
