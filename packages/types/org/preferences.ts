import { z } from "zod";

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
