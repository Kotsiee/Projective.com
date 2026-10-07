import {
	DigestFrequency,
	NotificationCategory,
	type NotificationCenter,
	type NotificationCenterCategory,
	type NotificationCenterPrefs,
	type NotificationCenterUpdate,
	PERSONAL_CHANNELS,
	type PersonalChannel,
	type RequiredAlerts,
} from "@projective/types/comms";
import { fail, type ServiceResult } from "../ServiceResult.ts";

/**
 * notification-center — the pure half of {@link NotificationCenterBackendService}: turning the three
 * `comms` reads (the global `notification_prefs` row, the sparse `notification_category_prefs` rows
 * and the enabled `notification_types` catalog) into the settings console's
 * {@link NotificationCenter}, and turning a {@link NotificationCenterUpdate} into column patches.
 *
 * Kept apart from the service so it is testable without a Supabase client. Every rule here mirrors
 * `comms.fn_resolve_channels` rather than restating a policy of its own:
 *
 *  - a category column that is `NULL` — or a category with no row at all — follows the channel's
 *    master toggle, so both read back as `null`;
 *  - an explicit category value outranks the master (`COALESCE(category, global)`), which is why a
 *    master toggle travels with a `resetChannels` entry;
 *  - mandatory catalog types ignore every preference, which is what {@link RequiredAlerts}
 *    summarises.
 */

// #region Columns
/** The `comms.notification_prefs` columns the console reads. */
export const PREFS_COLUMNS = [
	"in_app",
	"push",
	"email",
	"sms",
	"timezone",
	"quiet_hours_enabled",
	"quiet_hours_start",
	"quiet_hours_end",
	"muted_until",
	"digest_frequency",
].join(",");

/** The `comms.notification_category_prefs` columns the console reads. */
export const CATEGORY_COLUMNS = "category,in_app,push,email,sms";

/** The `comms.notification_types` columns the required-alerts summary needs. */
export const CATALOG_COLUMNS = "category,mandatory,default_channels";

/** Each {@link PersonalChannel} and the column that stores it, on both preference tables. */
export const CHANNEL_COLUMN: Readonly<Record<PersonalChannel, string>> = {
	in_app: "in_app",
	push: "push",
	email: "email",
	sms: "sms",
};

/** The CHECK constraint that keeps an enabled quiet-hours window complete. */
export const QUIET_HOURS_CONSTRAINT = "notification_prefs_quiet_hours_complete";
// #endregion

// #region Row shapes
/** One `comms.notification_prefs` row as selected by {@link PREFS_COLUMNS}. */
export interface PrefsRow {
	in_app: boolean | null;
	push: boolean | null;
	email: boolean | null;
	sms: boolean | null;
	timezone: string | null;
	quiet_hours_enabled: boolean | null;
	/** A Postgres `time`, rendered by PostgREST as `HH:MM:SS`. */
	quiet_hours_start: string | null;
	quiet_hours_end: string | null;
	muted_until: string | null;
	digest_frequency: string | null;
}

/** One `comms.notification_category_prefs` row as selected by {@link CATEGORY_COLUMNS}. */
export interface CategoryRow {
	category: string;
	in_app: boolean | null;
	push: boolean | null;
	email: boolean | null;
	sms: boolean | null;
}

/** One enabled `comms.notification_types` row as selected by {@link CATALOG_COLUMNS}. */
export interface CatalogRow {
	category: string;
	mandatory: boolean | null;
	/** A `comms.notification_channel[]`, rendered by PostgREST as a JSON array of strings. */
	default_channels: string[] | null;
}
// #endregion

// #region Defaults
/**
 * The values a `comms.notification_prefs` row holds when nothing has been chosen — the column
 * DEFAULTs in `00000016_tables_comms.sql`, not invented preferences.
 */
export const DEFAULT_CENTER_PREFS: Readonly<NotificationCenterPrefs> = Object.freeze({
	inApp: true,
	push: false,
	email: true,
	sms: false,
	timezone: "UTC",
	quietHoursEnabled: false,
	quietHoursStart: null,
	quietHoursEnd: null,
	mutedUntil: null,
	digestFrequency: "off",
});

/**
 * The centre drawn when the live read cannot be made — the column defaults, every category following
 * its master, and no required-alerts summary (the catalog was not read, so nothing is claimed about
 * it). `live: false` is what keeps the console from presenting it as saved.
 */
export function defaultCenter(): NotificationCenter {
	return {
		prefs: { ...DEFAULT_CENTER_PREFS },
		categories: categoriesFromRows([]),
		required: [],
		live: false,
	};
}
// #endregion

// #region Row → centre
/**
 * Trim a stored `time` to the `HH:MM` the console edits. `22:00:00` → `22:00`; anything that is not a
 * clock time reads as `null` rather than as a value the person never chose.
 */
export function clockTime(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value.trim());
	return match ? `${match[1]}:${match[2]}` : null;
}

/**
 * A snooze deadline that is still ahead of `now`, else `null`.
 *
 * The router only honours `muted_until > now()`; a lapsed deadline is kept on the row but silences
 * nothing, so reporting it would have the console say "paused until" a moment already past.
 */
export function activeSnooze(value: string | null | undefined, now: Date): string | null {
	if (typeof value !== "string" || value.length === 0) return null;
	const at = Date.parse(value);
	if (Number.isNaN(at)) return null;
	return at > now.getTime() ? value : null;
}

/**
 * Map the global row (or its absence) to {@link NotificationCenterPrefs}. A `NULL` the schema forbids
 * falls back to the column default, never to a guess.
 */
export function prefsFromRow(
	row: PrefsRow | null,
	now: Date = new Date(),
): NotificationCenterPrefs {
	if (!row) return { ...DEFAULT_CENTER_PREFS };
	const digest = DigestFrequency.safeParse(row.digest_frequency);
	const timezone = typeof row.timezone === "string" ? row.timezone.trim() : "";
	return {
		inApp: row.in_app ?? DEFAULT_CENTER_PREFS.inApp,
		push: row.push ?? DEFAULT_CENTER_PREFS.push,
		email: row.email ?? DEFAULT_CENTER_PREFS.email,
		sms: row.sms ?? DEFAULT_CENTER_PREFS.sms,
		timezone: timezone.length > 0 ? timezone : DEFAULT_CENTER_PREFS.timezone,
		quietHoursEnabled: row.quiet_hours_enabled ?? DEFAULT_CENTER_PREFS.quietHoursEnabled,
		quietHoursStart: clockTime(row.quiet_hours_start),
		quietHoursEnd: clockTime(row.quiet_hours_end),
		mutedUntil: activeSnooze(row.muted_until, now),
		digestFrequency: digest.success ? digest.data : DEFAULT_CENTER_PREFS.digestFrequency,
	};
}

/**
 * Expand the sparse category rows to all eight categories, in `NotificationCategory` order. An absent
 * row and a `NULL` column both read back as `null` (follow the master); a row for a category the
 * contract does not know is dropped.
 */
export function categoriesFromRows(rows: readonly CategoryRow[]): NotificationCenterCategory[] {
	const byCategory = new Map(rows.map((row) => [row.category, row]));
	return NotificationCategory.options.map((category) => {
		const row = byCategory.get(category);
		return {
			category,
			inApp: row?.in_app ?? null,
			push: row?.push ?? null,
			email: row?.email ?? null,
			sms: row?.sms ?? null,
		};
	});
}

/** Narrow a catalog channel to a {@link PersonalChannel}; `webhook` is an integration, not a person. */
function isPersonalChannel(value: string): value is PersonalChannel {
	return (PERSONAL_CHANNELS as readonly string[]).includes(value);
}

/**
 * Summarise the enabled catalog per category: how many event types it has, how many of them are
 * mandatory, and the union of the mandatory types' default channels — where those events always land
 * whatever the matrix says. One entry per category, in `NotificationCategory` order (a category with
 * no enabled types reads `0 / 0`); channels in {@link PERSONAL_CHANNELS} order.
 *
 * Pass only ENABLED rows: a disabled type is never delivered (`fn_resolve_channels` returns `{}`), so
 * counting it would overstate both totals.
 */
export function summariseCatalog(rows: readonly CatalogRow[]): RequiredAlerts[] {
	return NotificationCategory.options.map((category) => {
		const inCategory = rows.filter((row) => row.category === category);
		const mandatory = inCategory.filter((row) => row.mandatory === true);
		const reached = new Set(
			mandatory.flatMap((row) => (row.default_channels ?? []).filter(isPersonalChannel)),
		);
		return {
			category,
			mandatory: mandatory.length,
			total: inCategory.length,
			channels: PERSONAL_CHANNELS.filter((channel) => reached.has(channel)),
		};
	});
}

/** Compose the full live {@link NotificationCenter} from the three reads. */
export function buildCenter(
	input: {
		prefs: PrefsRow | null;
		categories: readonly CategoryRow[];
		catalog: readonly CatalogRow[];
	},
	now: Date = new Date(),
): NotificationCenter {
	return {
		prefs: prefsFromRow(input.prefs, now),
		categories: categoriesFromRows(input.categories),
		required: summariseCatalog(input.catalog),
		live: true,
	};
}
// #endregion

// #region Update → column patches
/** One category's upsert: the key, and ONLY the columns the client sent (`null` = follow master). */
export interface CategoryPatch {
	category: NotificationCategory;
	columns: Record<string, boolean | null>;
}

/** The writes one {@link NotificationCenterUpdate} expands to, in the order they are applied. */
export interface CenterWritePlan {
	/** `comms.notification_prefs` columns to set; empty = the global row is not touched. */
	prefs: Record<string, unknown>;
	/** Category columns to set `NULL` on every own row; empty = no reset. */
	reset: Record<string, null>;
	/** Per-category upserts; a row that names no channel is dropped. */
	categories: CategoryPatch[];
}

/** Map the `prefs` half of an update to snake_case columns, omitting what the client did not send. */
export function prefsPatch(prefs: NotificationCenterUpdate["prefs"]): Record<string, unknown> {
	const columns: Record<string, unknown> = {};
	if (!prefs) return columns;
	if (prefs.inApp !== undefined) columns.in_app = prefs.inApp;
	if (prefs.push !== undefined) columns.push = prefs.push;
	if (prefs.email !== undefined) columns.email = prefs.email;
	if (prefs.sms !== undefined) columns.sms = prefs.sms;
	if (prefs.timezone !== undefined) columns.timezone = prefs.timezone.trim();
	if (prefs.quietHoursEnabled !== undefined) columns.quiet_hours_enabled = prefs.quietHoursEnabled;
	// `null` is a real value for the three below (clear the bound / end the snooze).
	if (prefs.quietHoursStart !== undefined) columns.quiet_hours_start = prefs.quietHoursStart;
	if (prefs.quietHoursEnd !== undefined) columns.quiet_hours_end = prefs.quietHoursEnd;
	if (prefs.mutedUntil !== undefined) columns.muted_until = prefs.mutedUntil;
	return columns;
}

/** Map `resetChannels` to the `{ column: null }` patch applied to every own category row. */
export function resetPatch(
	channels: NotificationCenterUpdate["resetChannels"],
): Record<string, null> {
	const columns: Record<string, null> = {};
	for (const channel of channels ?? []) columns[CHANNEL_COLUMN[channel]] = null;
	return columns;
}

/**
 * Map the `categories` half of an update to one patch per category. Only keys the client SENT become
 * columns — an omitted channel is left exactly as stored, an explicit `null` writes `NULL`. Two
 * entries for the same category merge, the later key winning; an entry naming no channel is dropped.
 */
export function categoryPatches(
	categories: NotificationCenterUpdate["categories"],
): CategoryPatch[] {
	const merged = new Map<NotificationCategory, Record<string, boolean | null>>();
	for (const entry of categories ?? []) {
		const columns = merged.get(entry.category) ?? {};
		if (entry.inApp !== undefined) columns.in_app = entry.inApp;
		if (entry.push !== undefined) columns.push = entry.push;
		if (entry.email !== undefined) columns.email = entry.email;
		if (entry.sms !== undefined) columns.sms = entry.sms;
		merged.set(entry.category, columns);
	}
	return [...merged]
		.filter(([, columns]) => Object.keys(columns).length > 0)
		.map(([category, columns]) => ({ category, columns }));
}

/** Expand a whole update into its {@link CenterWritePlan}. */
export function planUpdate(update: NotificationCenterUpdate): CenterWritePlan {
	return {
		prefs: prefsPatch(update.prefs),
		reset: resetPatch(update.resetChannels),
		categories: categoryPatches(update.categories),
	};
}

/** Whether a plan writes nothing at all. */
export function isEmptyPlan(plan: CenterWritePlan): boolean {
	return Object.keys(plan.prefs).length === 0 && Object.keys(plan.reset).length === 0 &&
		plan.categories.length === 0;
}
// #endregion

// #region Validation the schema cannot express
/**
 * Whether `zone` is a NAMED time zone this runtime can evaluate.
 *
 * A bare offset (`+05:00`) is refused even though `Intl` accepts it: Postgres reads a numeric zone in
 * POSIX convention, where `+05:00` means five hours WEST of Greenwich, so the quiet-hours window would
 * land ten hours away from where the person put it.
 */
export function isKnownTimeZone(zone: string): boolean {
	if (!/^[A-Za-z]/.test(zone)) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/**
 * Field errors for values the Zod contract accepts as strings but Postgres or the router would not
 * honour: a time zone `fn_is_quiet_hours` would silently evaluate as UTC, and a snooze deadline that
 * is not an instant. Keys are the request paths the console binds errors to.
 */
export function prefsFieldErrors(
	prefs: NotificationCenterUpdate["prefs"],
): Record<string, string> {
	const errors: Record<string, string> = {};
	if (prefs?.timezone !== undefined && !isKnownTimeZone(prefs.timezone.trim())) {
		errors["prefs.timezone"] = "Choose a time zone from the list.";
	}
	if (
		typeof prefs?.mutedUntil === "string" && Number.isNaN(Date.parse(prefs.mutedUntil))
	) {
		errors["prefs.mutedUntil"] = "Choose when notifications should resume.";
	}
	return errors;
}
// #endregion

// #region Write errors
/** The parts of a PostgREST error the mapping reads. */
export interface WriteError {
	code?: string;
	message?: string;
	details?: string | null;
}

/**
 * Map a failed `comms` preference write to the refusal the person sees. The quiet-hours CHECK (an
 * enabled window missing a bound) is a 422 with a sentence keyed to the start field; a malformed
 * instant is a 422 on the snooze; an expired or refused session is a 401; anything else is an outage,
 * never a success.
 */
export function writeFailure(error: WriteError): ServiceResult<never> {
	const text = `${error.message ?? ""} ${error.details ?? ""}`;
	if (error.code === "23514" && text.includes(QUIET_HOURS_CONSTRAINT)) {
		const sentence = "Quiet hours need a start and an end.";
		return fail(422, { message: sentence, errors: { "prefs.quietHoursStart": sentence } });
	}
	if (error.code === "23514") {
		return fail(422, { message: "Those notification settings can't be saved together." });
	}
	if (error.code === "22007" || error.code === "22008") {
		const sentence = "Choose when notifications should resume.";
		return fail(422, { message: sentence, errors: { "prefs.mutedUntil": sentence } });
	}
	if (error.code === "42501" || error.code === "PGRST301" || error.code === "PGRST303") {
		return fail(401, { message: "Your session has expired. Please sign in again." });
	}
	return fail(503, {
		message: "We couldn't save your notification settings. Try again in a moment.",
	});
}
// #endregion
