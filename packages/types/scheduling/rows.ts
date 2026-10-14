import { z } from "zod";

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
// #endregion

// #region Vocabulary
/**
 * `scheduling.owner_type` — who owns a schedule. Mirrors the `finance.wallets.owner_type`
 * vocabulary so one mental model spans money and time.
 */
export const ScheduleOwnerType = z.enum(["user", "freelancer", "team", "business", "organisation"]);
export type ScheduleOwnerType = z.infer<typeof ScheduleOwnerType>;

/**
 * `scheduling.availability_kind` — what a weekly recurring band MEANS.
 *
 * `working_hours` is the broad "at my desk" overlay the calendar already renders. `call_window` is
 * the narrower subset during which the owner accepts a discovery call — the distinction that lets
 * the UI paint a call band as a visually distinct subset of working hours rather than conflating
 * "I am working" with "interrupt me".
 */
export const AvailabilityKind = z.enum(["working_hours", "call_window"]);
export type AvailabilityKind = z.infer<typeof AvailabilityKind>;
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
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type AvailabilityRuleRow = z.infer<typeof AvailabilityRuleRowSchema>;

/** Create/replace a weekly band. */
export const UpsertAvailabilityRuleSchema = z.object({
	id: uuid.optional(),
	scheduleId: uuid,
	kind: AvailabilityKind.default("working_hours"),
	weekday: z.number().int().min(0).max(6),
	startMinute: z.number().int().min(0).max(1440),
	endMinute: z.number().int().min(0).max(1440),
	label: z.string().max(80).optional(),
	isActive: z.boolean().default(true),
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
	/** A CSS custom-property NAME (e.g. `--primary`), never a literal colour. */
	accent: z.string().max(60).nullable(),
	location: z.string().max(160).nullable(),
	meta: z.string().max(160).nullable(),
	attendeeCount: z.number().int().min(0).nullable(),
	capacity: z.number().int().min(0).nullable(),
	href: z.string().max(400).nullable(),
	/** Set when mirrored in from a connected external calendar. */
	sourceConnectionId: uuid.nullable(),
	externalEventId: z.string().max(200).nullable(),
	/** Set when this row mirrors a delivered `projects.session_events` row. */
	sourceSessionEventId: uuid.nullable(),
	createdBy: uuid.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
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
	accent: z.string().max(60).optional(),
	location: z.string().max(160).optional(),
	meta: z.string().max(160).optional(),
	capacity: z.number().int().min(0).optional(),
	href: z.string().max(400).optional(),
});
export type CreateSchedulingEvent = z.infer<typeof CreateSchedulingEventSchema>;
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
	rrule: z.string().max(400).regex(/^FREQ=/, "A recurrence starts with FREQ=."),
	startsOn: civilDate,
	/** UNTIL, inclusive; `null` runs open-ended. */
	endsOn: civilDate.nullable(),
	priority: z.number().int().min(0).max(99),
	/** The authored "unless it is …" weekdays, 0 = Sunday … 6 = Saturday. */
	unlessWeekdays: z.array(z.number().int().min(0).max(6)).max(6),
	label: z.string().max(80),
	isActive: z.boolean(),
	position: z.number().int().min(0).max(63),
	createdAt: timestamp,
	updatedAt: timestamp,
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
