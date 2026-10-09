/**
 * locales — the formatting locales Settings → Language & region offers. The interface itself is in
 * English for now; a locale sets how numbers, prices and dates are written, and (with the direction
 * on Automatic) which way the page is laid out.
 */

// #region Shapes
/** One offered locale. */
export interface LocaleOption {
	/** BCP-47 tag (`en-GB`). */
	value: string;
	/** The language in itself (`Deutsch (Deutschland)`). */
	label: string;
	/** The same in English (`German (Germany)`) — searchable, and read under the native name. */
	english: string;
	/** ISO 3166-1 alpha-2 of the region, for its flag. */
	country: string;
}
// #endregion

/** Every offered locale, by language then region. */
export const LOCALES: readonly LocaleOption[] = [
	{ value: "en-GB", label: "English (United Kingdom)", english: "English (UK)", country: "GB" },
	{ value: "en-US", label: "English (United States)", english: "English (US)", country: "US" },
	{ value: "en-CA", label: "English (Canada)", english: "English (Canada)", country: "CA" },
	{ value: "en-AU", label: "English (Australia)", english: "English (Australia)", country: "AU" },
	{ value: "en-IN", label: "English (India)", english: "English (India)", country: "IN" },
	{ value: "fr-FR", label: "Français (France)", english: "French (France)", country: "FR" },
	{ value: "de-DE", label: "Deutsch (Deutschland)", english: "German (Germany)", country: "DE" },
	{ value: "es-ES", label: "Español (España)", english: "Spanish (Spain)", country: "ES" },
	{ value: "es-MX", label: "Español (México)", english: "Spanish (Mexico)", country: "MX" },
	{ value: "it-IT", label: "Italiano (Italia)", english: "Italian (Italy)", country: "IT" },
	{
		value: "nl-NL",
		label: "Nederlands (Nederland)",
		english: "Dutch (Netherlands)",
		country: "NL",
	},
	{ value: "pl-PL", label: "Polski (Polska)", english: "Polish (Poland)", country: "PL" },
	{
		value: "pt-PT",
		label: "Português (Portugal)",
		english: "Portuguese (Portugal)",
		country: "PT",
	},
	{ value: "pt-BR", label: "Português (Brasil)", english: "Portuguese (Brazil)", country: "BR" },
	{ value: "sv-SE", label: "Svenska (Sverige)", english: "Swedish (Sweden)", country: "SE" },
	{ value: "tr-TR", label: "Türkçe (Türkiye)", english: "Turkish (Türkiye)", country: "TR" },
	{ value: "ar-AE", label: "العربية (الإمارات)", english: "Arabic (UAE)", country: "AE" },
	{ value: "he-IL", label: "עברית (ישראל)", english: "Hebrew (Israel)", country: "IL" },
	{ value: "ur-PK", label: "اردو (پاکستان)", english: "Urdu (Pakistan)", country: "PK" },
	{ value: "hi-IN", label: "हिन्दी (भारत)", english: "Hindi (India)", country: "IN" },
	{ value: "zh-CN", label: "中文（中国）", english: "Chinese (China)", country: "CN" },
	{ value: "ja-JP", label: "日本語 (日本)", english: "Japanese (Japan)", country: "JP" },
	{ value: "ko-KR", label: "한국어 (대한민국)", english: "Korean (South Korea)", country: "KR" },
];

/** The offered locale for a tag, if it is one. */
export function localeOption(value: string): LocaleOption | undefined {
	return LOCALES.find((option) => option.value === value);
}
