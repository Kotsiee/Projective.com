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
	theme: z.string().max(20).optional(),
	notificationEmail: z.boolean().optional(),
	notificationPush: z.boolean().optional(),
	locale: z.string().max(20).optional(),
	preferredDisplayCurrency: z.string().min(3).max(3).nullable().optional(),
	layoutDirection: LayoutDirection.optional(),
});
export type UserPreferencesUpdate = z.infer<typeof UserPreferencesUpdateSchema>;

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
});
export type DisplayPreferences = z.infer<typeof DisplayPreferencesSchema>;
