import { z } from "zod";
import { slugPattern } from "../slugs/slug.ts";
import { EntryRemindersSchema } from "./reminders.ts";

/**
 * `scheduling` schema ROW shapes — the persisted counterpart to the read projections in
 * {@link ./scheduling.ts}.
 *
 * `scheduling.ts` describes what a calendar SURFACE renders (epoch-ms positions flattened for the
 * `@projective/ui/calendar` engine). This file describes what the DATABASE stores: ISO timestamps,
 * uuid keys, and the `schedule_id` graph. Mirrors the consolidated
 * `supabase/migrations/00000022_tables_scheduling.sql` — the timestamped
 * `2026072410xxxx_scheduling_*.sql` files those columns were first authored in were folded into it
 * (root CLAUDE.md §1) and no longer exist, so read the SQL, not a filename, for column truth.
 *
 * The `scheduling` schema is new — `0001_init_schemas.sql` never created it, even though the
 * scheduling projections have described themselves as reads "over the eventual `scheduling.*`
 * tables" since Decision #37. This is that layer.
 *
 * **What is NOT here:** `projects.session_events` / `projects.cohorts` (migration 0007) remain the
 * SSOT for a paid Session Service's delivered sessions. `scheduling.events` may mirror one for
 * calendar rendering via `sourceSessionEventId`; it never replaces it.
 */

// #region Scalars
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
export const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST (contrast the epoch-ms projections). */
export const timestamp = z.string();
/** An IANA timezone id, e.g. `Europe/London`. */
export const ianaTimezone = z.string().min(1).max(60);
/**
 * An RFC 5545 RRULE value (no `RRULE:` prefix) as the database stores it: the same shape-only CHECK
 * as `recurrence_rules.rrule` and `events.recurrence_rule`. `rrule.ts` owns the meaning (for an event
 * series through `ics-recurrence.ts`, which also reads `COUNT`).
 */
export const RRuleText = z.string().max(400).regex(/^FREQ=/, "A recurrence starts with FREQ=.");
// #endregion

// #region Vocabulary
/**
 * `scheduling.owner_type` — who owns a schedule. Mirrors the `finance.wallets.owner_type`
 * vocabulary so one mental model spans money and time.
 */
export const ScheduleOwnerType = z.enum(["user", "freelancer", "team", "business", "enterprise"]);
export type ScheduleOwnerType = z.infer<typeof ScheduleOwnerType>;

/**
 * `scheduling.availability_kind` — what a weekly recurring band MEANS, as the column stores it.
 *
 * Availability is one layer (Decision #408): every band is `working_hours`, and a discovery call is
 * booked inside them. `call_window`, the narrower "interrupt me" subset it replaced, stays in the
 * enum only because stored rows predate the ruling; nothing reads one and no door writes one.
 */
export const AvailabilityKind = z.enum(["working_hours", "call_window"]);
export type AvailabilityKind = z.infer<typeof AvailabilityKind>;

/** A custom-property NAME (`--primary`, `--swatch-teal`), never a literal colour (root CLAUDE.md §3). */
export const CssTokenName = z.string().max(60).regex(
	/^--[a-z][a-z0-9-]{0,58}$/,
	"Expected a token name such as --primary.",
);

/** A paid call's price as the columns hold it: positive minor units with an upper-case ISO currency. */
const feeAmount = z.number().int().min(1).max(999_999_999_999_999);
const feeCurrency = z.string().regex(/^[A-Z]{3}$/, "Expected an ISO currency such as GBP.");

/**
 * Whether an entry holds its time against bookings (`scheduling.events.availability_behavior`,
 * `scheduling.routines.behavior`; Decision #389). `disruptive` blocks discovery calls and session
 * bookings. `passive` leaves the time free to be booked over: every busy reader skips the row, and
 * its copy at a provider goes out as transparent.
 */
export const AvailabilityBehavior = z.enum(["disruptive", "passive"]);
export type AvailabilityBehavior = z.infer<typeof AvailabilityBehavior>;
// #endregion

// #region scheduling.schedules
/** A row of `scheduling.schedules` — one owner-level schedule header. */
export const ScheduleRowSchema = z.object({
	id: uuid,
	ownerType: ScheduleOwnerType,
	ownerId: uuid,
	/** Every minute-of-day column in this domain is interpreted in THIS zone. */
	timezone: ianaTimezone,
	/** Whether `/[handle]/availability` renders anything to a visitor at all. */
	isPublished: z.boolean(),
	/** When true a synced external block shows only its status label, never its title. */
	maskExternalEvents: z.boolean(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type ScheduleRow = z.infer<typeof ScheduleRowSchema>;

/** The owner-editable slice of a schedule header. */
export const UpdateScheduleSchema = z.object({
	timezone: ianaTimezone.optional(),
	isPublished: z.boolean().optional(),
	maskExternalEvents: z.boolean().optional(),
});
export type UpdateSchedule = z.infer<typeof UpdateScheduleSchema>;
// #endregion

// #region scheduling.availability_rules
/**
 * A row of `scheduling.availability_rules`. The persisted counterpart of
 * {@link AvailabilityRuleSchema} in `scheduling.ts`, which is its projection.
 *
 * ⚠️ `endMinute > startMinute` is a table constraint, so a band cannot cross local midnight. A
 * provider who takes calls 23:00–01:00 expresses it as two bands. Deliberate — see the migration.
 * Bands of a day that touch are read as one span by the booking gate, because the default
 * template's mirror splits a working day where its price changes (Decision #408).
 */
export const AvailabilityRuleRowSchema = z.object({
	id: uuid,
	scheduleId: uuid,
	kind: AvailabilityKind,
	/** 0 = Sunday … 6 = Saturday (matches JS `Date#getDay`). */
	weekday: z.number().int().min(0).max(6),
	startMinute: z.number().int().min(0).max(1440),
	endMinute: z.number().int().min(0).max(1440),
	label: z.string().max(80).nullable(),
	isActive: z.boolean(),
	/** A paid call's price for a call starting in this band; `null` charges the call settings' fee. */
	feeAmountMinor: feeAmount.nullable(),
	feeCurrency: feeCurrency.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
}).refine((r) => (r.feeAmountMinor === null) === (r.feeCurrency === null), {
	message: "A price needs both an amount and a currency.",
	path: ["feeAmountMinor"],
});
export type AvailabilityRuleRow = z.infer<typeof AvailabilityRuleRowSchema>;

/** Create/replace a weekly band. Always working hours (Decision #408). */
export const UpsertAvailabilityRuleSchema = z.object({
	id: uuid.optional(),
	scheduleId: uuid,
	kind: z.literal("working_hours").default("working_hours"),
	weekday: z.number().int().min(0).max(6),
	startMinute: z.number().int().min(0).max(1440),
	endMinute: z.number().int().min(0).max(1440),
	label: z.string().max(80).optional(),
	isActive: z.boolean().default(true),
	feeAmountMinor: feeAmount.nullable().default(null),
	feeCurrency: feeCurrency.nullable().default(null),
}).refine((r) => (r.feeAmountMinor === null) === (r.feeCurrency === null), {
	message: "A price needs both an amount and a currency.",
	path: ["feeAmountMinor"],
});
export type UpsertAvailabilityRule = z.infer<typeof UpsertAvailabilityRuleSchema>;
// #endregion

// #region scheduling.blackout_dates
/** A row of `scheduling.blackout_dates` — an absolute span overriding every weekly band. */
export const BlackoutDateRowSchema = z.object({
	id: uuid,
	scheduleId: uuid,
	startsAt: timestamp,
	endsAt: timestamp,
	label: z.string().max(120),
	/**
	 * A blackout label is owner-authored and can be intimate ("Surgery"). A published schedule's
	 * blackout SPANS are world-readable so a visitor avoids dead slots, but the label is withheld
	 * unless the owner opts in — a reader without `fn_can_view_schedule` must render the generic
	 * "Unavailable" string whenever this is false.
	 */
	labelIsPublic: z.boolean(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type BlackoutDateRow = z.infer<typeof BlackoutDateRowSchema>;

/** Create/replace a blackout span. */
export const UpsertBlackoutDateSchema = z.object({
	id: uuid.optional(),
	scheduleId: uuid,
	startsAt: timestamp,
	endsAt: timestamp,
	label: z.string().max(120).default("Unavailable"),
	labelIsPublic: z.boolean().default(false),
});
export type UpsertBlackoutDate = z.infer<typeof UpsertBlackoutDateSchema>;
// #endregion

// #region scheduling.events
/**
 * `scheduling.event_kind` / `scheduling.event_status` mirror `CalendarEventKind` /
 * `CalendarEventStatus` in `scheduling.ts` value-for-value.
 *
 * ⚠️ A discovery call is deliberately NOT a new kind — it is a `booking`. Adding a tenth kind
 * would break the shipped calendar engine's exhaustive `Record<CalendarEventKind, …>` label and
 * accent maps, turning a database change into a design-system change (root CLAUDE.md §3).
 */
export const EventKind = z.enum([
	"deadline",
	"milestone",
	"sync",
	"session",
	"booking",
	"availability",
	"busy",
	"holiday",
	"general",
]);
export type EventKind = z.infer<typeof EventKind>;

/** `scheduling.event_status` — the privacy-safe status label. */
export const EventStatus = z.enum(["confirmed", "tentative", "busy", "available", "cancelled"]);
export type EventStatus = z.infer<typeof EventStatus>;

/**
 * A row of `scheduling.events`. Anchored to a schedule (an owner's own block) or a project (an
 * engagement milestone) — at least one is always present, enforced in-DB.
 */
export const SchedulingEventRowSchema = z.object({
	id: uuid,
	scheduleId: uuid.nullable(),
	projectId: uuid.nullable(),
	channelId: uuid.nullable(),
	kind: EventKind,
	status: EventStatus.nullable(),
	title: z.string().max(200),
	startsAt: timestamp,
	endsAt: timestamp,
	allDay: z.boolean(),
	/** When true the reader renders only `status`, never `title`. */
	isMasked: z.boolean(),
	/**
	 * The colour the entry is drawn in: a custom-property NAME (`--primary`, or the swatch its host
	 * picked, `--swatch-teal` — `./swatches.ts`), never a literal colour. `null` takes the kind's.
	 */
	accent: CssTokenName.nullable(),
	location: z.string().max(160).nullable(),
	/** The agenda, as `sanitizeRichText` (`@projective/types/richtext`) left it. */
	description: z.string().max(8000).nullable(),
	meta: z.string().max(160).nullable(),
	attendeeCount: z.number().int().min(0).nullable(),
	capacity: z.number().int().min(0).nullable(),
	href: z.string().max(400).nullable(),
	/** Set when mirrored in from a connected external calendar. */
	sourceConnectionId: uuid.nullable(),
	externalEventId: z.string().max(1024).nullable(),
	/** False keeps this event off every person's separate Projective calendar (Decision #383, R3). */
	externalSync: z.boolean(),
	/** Set when this row mirrors a delivered `projects.session_events` row. */
	sourceSessionEventId: uuid.nullable(),
	/** Set on a series MASTER, which is itself the first occurrence (its `startsAt` is DTSTART). */
	recurrenceRule: RRuleText.nullable(),
	/** Set on every later occurrence: the master it belongs to. Never set alongside a rule. */
	recurrenceParentId: uuid.nullable(),
	/** The routine this entry is organised under, on the same schedule. Never an engagement's meeting. */
	routineId: uuid.nullable(),
	/** What every busy reader reads. A commitment is `disruptive` for good (`fn_event_holds_time`). */
	availabilityBehavior: AvailabilityBehavior,
	createdBy: uuid.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
	/** Taken off the calendar by its host (never deleted); `status` is `cancelled` alongside it. */
	archivedAt: timestamp.nullable(),
}).refine((e) => e.recurrenceRule === null || e.recurrenceParentId === null, {
	message: "An occurrence belongs to a series; it never heads one.",
	path: ["recurrenceRule"],
});
export type SchedulingEventRow = z.infer<typeof SchedulingEventRowSchema>;

/** Create a calendar entry. */
export const CreateSchedulingEventSchema = z.object({
	scheduleId: uuid.optional(),
	projectId: uuid.optional(),
	channelId: uuid.optional(),
	kind: EventKind.default("general"),
	status: EventStatus.optional(),
	title: z.string().max(200).default(""),
	startsAt: timestamp,
	endsAt: timestamp,
	allDay: z.boolean().default(false),
	isMasked: z.boolean().default(false),
	accent: CssTokenName.optional(),
	location: z.string().max(160).optional(),
	description: z.string().max(8000).optional(),
	meta: z.string().max(160).optional(),
	capacity: z.number().int().min(0).optional(),
	href: z.string().max(400).optional(),
	routineId: uuid.optional(),
	availabilityBehavior: AvailabilityBehavior.default("disruptive"),
});
export type CreateSchedulingEvent = z.infer<typeof CreateSchedulingEventSchema>;
// #endregion

// #region scheduling.event_reminders
/**
 * A row of `scheduling.event_reminders` — one person's own alerts for one entry, overriding their
 * default (Decision #388). Read and written by that person alone, under RLS. `[]` switches the entry's
 * alerts off for them, which is a different answer from having no row.
 */
export const EventReminderRowSchema = z.object({
	eventId: uuid,
	userId: uuid,
	reminders: EntryRemindersSchema,
});
export type EventReminderRow = z.infer<typeof EventReminderRowSchema>;
// #endregion

// #region scheduling.event_mirrors
/**
 * A row of `scheduling.event_mirrors` — one copy of an event or a discovery call on a person's separate
 * Projective calendar at a provider, and the queue that keeps it right (Decision #383, ruling R3).
 * Definer-only: this shape documents the row, and no client ever receives one.
 */
export const EventMirrorRowSchema = z.object({
	id: uuid,
	/** A row has at most one anchor. Null once the event is deleted, until its copy has been removed. */
	eventId: uuid.nullable(),
	/** The same, for a call. */
	callId: uuid.nullable(),
	connectionId: uuid,
	externalEventId: z.string().max(1024).nullable(),
	/** Google's etag or Graph's changeKey. Stored, never compared: the next change overwrites. */
	version: z.string().nullable(),
	/** Set while the copy is due to be written or removed. */
	dirtyAt: timestamp.nullable(),
	claimedAt: timestamp.nullable(),
	attempts: z.number().int().min(0),
	lastError: z.string().max(200).nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type EventMirrorRow = z.infer<typeof EventMirrorRowSchema>;
// #endregion

// #region scheduling.connected_event_details
/**
 * A row of `scheduling.connected_event_details` — what an entry mirrored in from a connected calendar
 * says (Decision #387). Definer-only: its owner reads it through `get_own_event_details`, which folds
 * it into their {@link CalendarEvent}, and nobody else ever receives one.
 */
export const ConnectedEventDetailsRowSchema = z.object({
	eventId: uuid,
	title: z.string().max(200).nullable(),
	location: z.string().max(160).nullable(),
	/** Can hold HTML, so it reaches the DOM only through `sanitizeRichText`. */
	description: z.string().max(8000).nullable(),
	/** The provider's id for the series this is one occurrence of. */
	seriesId: z.string().max(1024).nullable(),
	/** The series' repeat. The provider expands it, so nothing here does. */
	recurrenceRule: RRuleText.nullable(),
	/** The entry's own meeting at the provider. */
	joinUrl: z.string().max(600).nullable(),
});
export type ConnectedEventDetailsRow = z.infer<typeof ConnectedEventDetailsRowSchema>;
// #endregion

// #region Availability presets & recurrence (Decision #217)
/** `scheduling.rule_effect` — what a rule does to its day: add bands, replace the day's, or remove. */
export const RuleEffect = z.enum(["add", "replace", "subtract"]);
export type RuleEffect = z.infer<typeof RuleEffect>;

/** `scheduling.preset_scope` — a schedule's shared `library` preset, or one service's fork. */
export const PresetScope = z.enum(["library", "service"]);
export type PresetScope = z.infer<typeof PresetScope>;

/** A preset-local civil date as PostgREST returns a `date` column. */
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date as YYYY-MM-DD.");

/**
 * A row of `scheduling.availability_presets` — a named rule set under the owner's schedule. It has
 * no zone of its own: its rules are evaluated in the schedule's. `compiledFrom` / `compiledThrough`
 * are the local dates `availabilityOccurrences` covers; both `null` means not compiled, and the
 * booking gate reads the weekly bands instead.
 */
export const AvailabilityPresetRowSchema = z.object({
	id: uuid,
	scheduleId: uuid,
	scope: PresetScope,
	/** The service a `service` fork belongs to; `null` for a library preset. */
	blueprintId: uuid.nullable(),
	/** The opaque `avp-` address, minted on insert and frozen (Decision #88). */
	slug: z.string().regex(slugPattern("preset")),
	name: z.string().min(1).max(60),
	description: z.string().max(200),
	/** At most one live default per schedule (a partial unique index). */
	isDefault: z.boolean(),
	compiledFrom: civilDate.nullable(),
	compiledThrough: civilDate.nullable(),
	archivedAt: timestamp.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
}).refine((p) => (p.scope === "service") === (p.blueprintId !== null), {
	message: "A service preset belongs to exactly one service; a library preset to none.",
	path: ["blueprintId"],
});
export type AvailabilityPresetRow = z.infer<typeof AvailabilityPresetRowSchema>;

/**
 * A row of `scheduling.recurrence_rules`. `rrule` is the normalised RFC 5545 rule (DTSTART carried
 * as `startsOn`); the database checks only its shape, `recurrence.ts` is the authority on its meaning.
 */
export const RecurrenceRuleRowSchema = z.object({
	id: uuid,
	presetId: uuid,
	kind: AvailabilityKind,
	effect: RuleEffect,
	rrule: RRuleText,
	startsOn: civilDate,
	/** UNTIL, inclusive; `null` runs open-ended. */
	endsOn: civilDate.nullable(),
	priority: z.number().int().min(0).max(99),
	/** The authored "unless it is …" weekdays, 0 = Sunday … 6 = Saturday. */
	unlessWeekdays: z.array(z.number().int().min(0).max(6)).max(6),
	label: z.string().max(80),
	isActive: z.boolean(),
	position: z.number().int().min(0).max(63),
	/**
	 * A paid call's price inside this rule's bands, overriding the call settings' fee; `null`
	 * inherits it (Decision #408).
	 */
	feeAmountMinor: feeAmount.nullable(),
	feeCurrency: feeCurrency.nullable(),
	/** The swatch the rule is drawn in, as its token name (`./swatches.ts`); `null` is the default. */
	colorToken: CssTokenName.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
}).refine((r) => (r.feeAmountMinor === null) === (r.feeCurrency === null), {
	message: "A price needs both an amount and a currency.",
	path: ["feeAmountMinor"],
});
export type RecurrenceRuleRow = z.infer<typeof RecurrenceRuleRowSchema>;

/** A row of `scheduling.recurrence_rule_bands` — up to six per rule; never crosses local midnight. */
export const RecurrenceRuleBandRowSchema = z.object({
	ruleId: uuid,
	position: z.number().int().min(0).max(5),
	startMinute: z.number().int().min(0).max(1440),
	endMinute: z.number().int().min(0).max(1440),
}).refine((b) => b.endMinute > b.startMinute, {
	message: "A band must end after it starts.",
	path: ["endMinute"],
});
export type RecurrenceRuleBandRow = z.infer<typeof RecurrenceRuleBandRowSchema>;

/**
 * A row of `scheduling.availability_occurrences` — one compiled span of a preset's layer, written
 * only by the service-role door `scheduling.replace_preset_occurrences`.
 */
export const AvailabilityOccurrenceRowSchema = z.object({
	presetId: uuid,
	kind: AvailabilityKind,
	startsAt: timestamp,
	endsAt: timestamp,
	ruleIds: z.array(uuid),
});
export type AvailabilityOccurrenceRow = z.infer<typeof AvailabilityOccurrenceRowSchema>;
// #endregion
