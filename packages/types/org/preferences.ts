import { z } from "zod";
import { DEFAULT_LOCALE, PLATFORM_BASE_CURRENCY } from "../finance/fx.ts";

/**
 * org.user_preferences — the Zod SSOT for per-user preferences, including the additive i18n /
 * localization columns (`preferred_display_currency`, `layout_direction`) from migration
 * 20260723090000. Mirrors the table column-for-column and backs `documentation/database/org/*` — the
 * three land together (root CLAUDE.md §1).
 *
 * NOTE: `locale` (BCP-47, default `en-GB`) already carries language + region, so no separate
 * `preferred_locale`/`language` column exists; `layoutDirection` is deliberately INDEPENDENT of it
 * (`auto` resolves to the locale's natural direction). See DESIGN_SYSTEM.md §A.6 (RtL/LtR contract).
 */

/** `org.layout_direction` — the document `dir` a user prefers, independent of language. */
export const LayoutDirection = z.enum(["ltr", "rtl", "auto"]);
export type LayoutDirection = z.infer<typeof LayoutDirection>;

/**
 * `org.user_preferences.date_format` — an explicit numeric date order. `null` (the column's
 * default) follows the locale, so a language change re-orders dates unless the person chose one.
 */
export const DateFormat = z.enum(["dmy", "mdy", "ymd"]);
export type DateFormat = z.infer<typeof DateFormat>;

// #region Direction
/** Languages written right to left (ISO 639 primary subtags). */
const RTL_LANGUAGES: ReadonlySet<string> = new Set([
	"ar",
	"arc",
	"ckb",
	"dv",
	"fa",
	"he",
	"iw",
	"ji",
	"ps",
	"sd",
	"syr",
	"ug",
	"ur",
	"yi",
]);

/** Scripts written right to left (ISO 15924, lower-cased), for an explicit `-Arab`-style subtag. */
const RTL_SCRIPTS: ReadonlySet<string> = new Set([
	"adlm",
	"arab",
	"hebr",
	"mand",
	"nkoo",
	"rohg",
	"samr",
	"syrc",
	"thaa",
]);

/** The natural direction of a BCP-47 locale's script. An explicit script subtag wins. */
export function localeDirection(locale: string): "ltr" | "rtl" {
	const parts = locale.trim().toLowerCase().replace(/_/g, "-").split("-").filter(Boolean);
	const script = parts.slice(1).find((part) => part.length === 4);
	if (script) return RTL_SCRIPTS.has(script) ? "rtl" : "ltr";
	return RTL_LANGUAGES.has(parts[0] ?? "") ? "rtl" : "ltr";
}

/** The direction to lay a document out in: an explicit choice, or `auto` resolved by the locale. */
export function resolveLayoutDirection(dir: LayoutDirection, locale: string): "ltr" | "rtl" {
	return dir === "auto" ? localeDirection(locale) : dir;
}
// #endregion

// #region Appearance & accessibility
/**
 * `org.user_preferences.theme` — the colour-scheme CHOICE. `system` follows `prefers-color-scheme`
 * live; the painted mode is derived on the client (DESIGN_SYSTEM.md §A.2, Decision #149(F)).
 */
export const ThemeChoice = z.enum(["system", "light", "dark"]);
export type ThemeChoice = z.infer<typeof ThemeChoice>;

/**
 * `org.user_preferences.contrast`. `standard` is NOT "force normal contrast": it adds no overlay, so
 * the reader's OS `prefers-contrast: more` still applies. `high` forces the AAA overlay.
 */
export const ContrastPreference = z.enum(["standard", "high"]);
export type ContrastPreference = z.infer<typeof ContrastPreference>;

/** `org.user_preferences.font` — `dyslexic` remaps every family to OpenDyslexic (§A.5). */
export const FontPreference = z.enum(["sans", "dyslexic"]);
export type FontPreference = z.infer<typeof FontPreference>;

/** `org.user_preferences.cvd` — the colour-vision shift; mirrors `@projective/ui/system` `CvdMode`. */
export const CvdPreference = z.enum(["none", "protan", "deutan", "tritan"]);
export type CvdPreference = z.infer<typeof CvdPreference>;

/**
 * `org.user_preferences.motion`. Like contrast, `standard` adds nothing — the OS
 * `prefers-reduced-motion` still collapses motion; `reduced` forces it on every device.
 */
export const MotionPreference = z.enum(["standard", "reduced"]);
export type MotionPreference = z.infer<typeof MotionPreference>;

/**
 * The appearance slice of `org.user_preferences` — the theme choice plus the four accessibility
 * overlays. The durable, cross-device copy; the `pj.a11y` cookie is its per-device mirror, which
 * is what server rendering reads so the overlays paint in the first byte.
 */
export const AppearancePreferencesSchema = z.object({
	theme: ThemeChoice,
	contrast: ContrastPreference,
	font: FontPreference,
	cvd: CvdPreference,
	motion: MotionPreference,
});
export type AppearancePreferences = z.infer<typeof AppearancePreferencesSchema>;

/** The column DEFAULTs — what a row nobody has touched behaves as. */
export const DEFAULT_APPEARANCE: AppearancePreferences = {
	theme: "system",
	contrast: "standard",
	font: "sans",
	cvd: "none",
	motion: "standard",
};
// #endregion

/**
 * The `preferred_display_currency` / `locale` column DEFAULTs, re-exported from the finance FX SSOT
 * rather than restated. The currency vocabulary is a finance concern and there is exactly one of it;
 * a second literal `"GBP"` here would be a value that could silently disagree with the rate table.
 * (Cross-domain import within `@projective/types`, matching `user/current-user.ts` → `auth`;
 * `finance` imports nothing outside itself, so the graph stays acyclic.)
 */
export {
	DEFAULT_LOCALE as DEFAULT_USER_LOCALE,
	PLATFORM_BASE_CURRENCY as DEFAULT_DISPLAY_CURRENCY,
};

/** A row of `org.user_preferences`. */
export const UserPreferencesSchema = z.object({
	userId: z.string(),
	theme: z.string().max(20),
	notificationEmail: z.boolean(),
	notificationPush: z.boolean(),
	/** BCP-47 locale (language + region), e.g. `en-GB`. */
	locale: z.string().max(20),
	/** Presentational display-conversion target (ISO-4217); `null` = follow the origin/locale default. */
	preferredDisplayCurrency: z.string().min(3).max(3).nullable(),
	layoutDirection: LayoutDirection,
	uiSettings: z.record(z.string(), z.unknown()),
	contrast: ContrastPreference,
	font: FontPreference,
	cvd: CvdPreference,
	motion: MotionPreference,
	/** `null` = follow the locale's date order. */
	dateFormat: DateFormat.nullable(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/**
 * The `PATCH /api/user/preferences` payload — a **partial** update, so a caller changing only the
 * display currency cannot accidentally clear a locale or a notification toggle it never sent. Every
 * field is optional and validated independently; the fat service applies exactly what is present.
 *
 * `preferredDisplayCurrency` accepts `null` explicitly (the "follow the origin currency" state), so
 * clearing the preference is expressible and is not the same message as omitting the field.
 */
export const UserPreferencesUpdateSchema = z.object({
	theme: ThemeChoice.optional(),
	notificationEmail: z.boolean().optional(),
	notificationPush: z.boolean().optional(),
	locale: z.string().max(20).optional(),
	preferredDisplayCurrency: z.string().min(3).max(3).nullable().optional(),
	layoutDirection: LayoutDirection.optional(),
	contrast: ContrastPreference.optional(),
	font: FontPreference.optional(),
	cvd: CvdPreference.optional(),
	motion: MotionPreference.optional(),
	/** `null` returns dates to the locale's own order. */
	dateFormat: DateFormat.nullable().optional(),
}).strict();
export type UserPreferencesUpdate = z.infer<typeof UserPreferencesUpdateSchema>;

/** The appearance keys of a {@link UserPreferencesUpdate} — the half a settings save splits off. */
export const APPEARANCE_KEYS = ["theme", "contrast", "font", "cvd", "motion"] as const;

/**
 * Split a preferences patch into its appearance half and its display half (currency · locale ·
 * direction · the legacy notification toggles). Pure; an empty half comes back as `{}`.
 */
export function splitPreferencesPatch(
	patch: UserPreferencesUpdate,
): { appearance: Partial<AppearancePreferences>; display: UserPreferencesUpdate } {
	const appearance: Partial<AppearancePreferences> = {};
	const display: UserPreferencesUpdate = {};
	for (const [key, value] of Object.entries(patch) as [keyof UserPreferencesUpdate, unknown][]) {
		if (value === undefined) continue;
		if ((APPEARANCE_KEYS as readonly string[]).includes(key)) {
			(appearance as Record<string, unknown>)[key] = value;
		} else {
			(display as Record<string, unknown>)[key] = value;
		}
	}
	return { appearance, display };
}

/**
 * The presentation slice of a user's preferences — the pair every money figure on the platform is
 * formatted with. Resolved server-side (JWT claim → preferences row → platform defaults) and shipped
 * into SSR so the first byte is already correct; also the shape the currency switcher PATCHes.
 *
 * Both fields are non-null here even though the column is nullable: this is the RESOLVED view, so
 * "follow the origin" has already been collapsed to a concrete currency by the resolver. A consumer
 * of this shape never has to decide what `null` meant.
 */
export const DisplayPreferencesSchema = z.object({
	/** The ISO-4217 currency every figure is formatted in for this viewer. */
	displayCurrency: z.string().min(3).max(3),
	/** The BCP-47 locale `Intl.NumberFormat` is given. */
	locale: z.string().max(20),
	/** The resolved document direction (`auto` already collapsed by the caller when it needs to be). */
	layoutDirection: LayoutDirection,
	/** The explicit date order, or `null` to follow {@link locale}. */
	dateFormat: DateFormat.nullable(),
});
export type DisplayPreferences = z.infer<typeof DisplayPreferencesSchema>;
