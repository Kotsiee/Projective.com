import { z } from "zod";
import { AssetItemSchema } from "../files/assets.ts";
import { PublicCallOfferSchema } from "./calls.ts";
import { EventMeetingSchema } from "./meeting.ts";
import { SchedulingSimSchema } from "./sim.ts";
import {
	EventAttendeeSchema,
	EventHistoryEntrySchema,
	EventPricingSchema,
	EventRescheduleSchema,
	RescheduleAction,
	RsvpResponse,
	SchedulingPartySchema,
} from "./coordination.ts";

/**
 * scheduling — the Zod SSOT for the Calendar & Schedule domain shared across every surface: the
 * project / channel calendar (task deadlines · review milestones · stage syncs), a `@handle`'s
 * availability (weekly working hours · timezone · blackout dates), and a session-based service's
 * schedule (recurring session slots · attendee counts). One vocabulary, rendered by the ONE
 * `@projective/ui/calendar` engine — the projection field names match that engine's presentational
 * contract exactly, so a page payload flows straight into it.
 *
 * This is a READ projection, not a table row (like `projects/detail`, `projects/messages`): it flattens
 * the parts of the `scheduling.events` / `scheduling.availability_rules` / `scheduling.blackout_dates`
 * tables a calendar view needs. Those tables EXIST — see {@link ./rows.ts} for their row shapes and the
 * consolidated `supabase/migrations/00000022_tables_scheduling.sql` for the DDL — so the live path fills
 * in behind each surface's existing backend gate with zero shape churn.
 *
 * ⚠️ The COORDINATION fields below (`roster` · `meeting` · `pricing` · `reschedule` · `history`) do NOT
 * yet have tables: `scheduling.events` stores only `attendee_count integer`, and there is no attendee,
 * proposal, vote or per-event history table anywhere in the schema. They are derived by the fat service
 * and mutated in a per-process store until that layer lands — see `./mod.ts` for what persisting them
 * would need.
 *
 * Only enum/array/string/number/boolean primitives are used, so the schema is stable across Zod majors.
 *
 * Times are epoch **milliseconds (UTC)**; the display timezone is a separate, explicit field so SSR and
 * the hydrated island resolve identical positions.
 */

// #region Event vocabulary
/** The kind of a calendar entry — drives the default accent + glyph in the engine. */
export const CalendarEventKind = z.enum([
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
export type CalendarEventKind = z.infer<typeof CalendarEventKind>;

/** The privacy-safe status label an external / availability block is allowed to expose (§Part 1.4). */
export const CalendarEventStatus = z.enum([
	"confirmed",
	"tentative",
	"busy",
	"available",
	"cancelled",
]);
export type CalendarEventStatus = z.infer<typeof CalendarEventStatus>;

/** A single positioned calendar entry. Times are epoch ms (UTC). */
export const CalendarEventSchema = z.object({
	id: z.string().min(1).max(120),
	title: z.string().max(200),
	kind: CalendarEventKind,
	status: CalendarEventStatus.optional(),
	/** Epoch ms (UTC) of the start. */
	start: z.number().int(),
	/**
	 * Epoch ms (UTC) of the end. `>= start`.
	 *
	 * **`end === start` is a POINT IN TIME — a deadline — and is deliberate data, not a degenerate
	 * row.** A due date has no duration to encode: it is the instant the work is owed, and giving it a
	 * synthetic half-hour states something nobody agreed to, then draws a box whose height a reader is
	 * entitled to read as a span. The engine's own contract
	 * (`packages/ui/calendar/core/types.ts` `CalendarEvent.end`) has always said so — it admits an
	 * instant to layout and draws it as a pin rather than a box — and this schema said the opposite
	 * (`> start` for timed events), which is why every deadline fixture on the platform was minted with
	 * an invented 30- or 45-minute slot and the pin path had no data to exercise it. The engine wins:
	 * it is the thing that has to draw the mark, and the alternative reading forces the lie upstream.
	 *
	 * The bound is a DOC contract rather than a `.refine`, matching the rest of this file — every
	 * schema here stays primitive-only so it survives a Zod major — and nothing enforced `> start` at
	 * runtime before, so relaxing it removes no check. A reader that treats an instant as a span
	 * therefore has to say what it does about zero: {@link CalendarEvent} carries the fact, and the
	 * SURFACE decides the mark.
	 *
	 * ⚠️ **Flagged, not resolved: the live path cannot store one yet.**
	 * `supabase/migrations/00000022_tables_scheduling.sql` carries
	 * `CONSTRAINT ck_event_span CHECK (ends_at > starts_at)` on `scheduling.events`, so a persisted
	 * deadline would be refused by the database the moment the backend gate is switched on. Relaxing
	 * that CHECK to `>=` is a schema decision on a table this projection reads, and it is recorded here
	 * rather than made in passing.
	 */
	end: z.number().int(),
	allDay: z.boolean().optional(),
	/** Only the privacy-safe status label renders — the real title is withheld (§Part 1.4). */
	masked: z.boolean().optional(),
	/** A CSS custom-property NAME (e.g. "--primary") accenting the block; defaults per kind. */
	accent: z.string().max(60).optional(),
	location: z.string().max(160).optional(),
	meta: z.string().max(160).optional(),
	/** Live attendee count — rendered on public group sessions only. */
	attendees: z.number().int().min(0).optional(),
	capacity: z.number().int().min(0).optional(),
	/**
	 * Every calendar this occurrence appears on, as provider slugs (`google` · `outlook` · `apple` ·
	 * `samsung` · `notion` · `ics`, and `projective` for the platform's own copy).
	 *
	 * An ARRAY rather than the single `source` it replaces, because one occurrence genuinely is on
	 * several calendars at once — an interview that came in from Google and was then mirrored into the
	 * engagement is one meeting, not two — and the grid stacks a mark per source to say so. A single
	 * field could only ever name one of them, which meant the other syncs were invisible and a reader
	 * had no way to tell a platform-only entry from one that will also fire a reminder on their phone.
	 */
	sources: z.array(z.string().max(40)).max(8).optional(),
	href: z.string().max(400).optional(),

	// #region Discovery-call projection (additive, all optional)
	/**
	 * A discovery call is projected as a `booking`, deliberately NOT a tenth `CalendarEventKind` —
	 * a new kind would break the shipped engine's exhaustive `Record<CalendarEventKind, …>` label
	 * and accent maps, turning a data change into a design-system change (root CLAUDE.md §3). These
	 * optional fields carry the call-specific detail instead. See `./calls.ts`.
	 */
	callId: z.string().max(120).optional(),
	/** True on a synthetic block a visitor may CLICK to request a call (a free call-window slot). */
	bookable: z.boolean().optional(),
	/** `courtesy` (free) or `paid` — drives whether the booking flow asks for payment. */
	callType: z.enum(["courtesy", "paid"]).optional(),
	/** The conferencing provider that minted (or will mint) the room. */
	conferenceProvider: z.string().max(40).optional(),
	/** The generated meeting room. Present only to the call's own parties. */
	meetingUrl: z.string().max(600).optional(),
	/**
	 * Price of a paid call, in integer minor units + its ISO-4217 currency — the raw
	 * `scheduling.discovery_calls.fee_amount_minor` / `fee_currency` columns, carried verbatim.
	 *
	 * ⚠️ A payload sets these OR {@link pricing}, never both. `pricing` is the RENDERED projection (a
	 * server-formatted, display-currency {@link MoneyViewSchema}); these are the stored origin. Two
	 * money figures on one object is how a rendered total comes to disagree with the ledger it was
	 * drawn from, so a surface reads `pricing` when it is present and never adds the two.
	 */
	feeAmountMinor: z.number().int().min(0).optional(),
	feeCurrency: z.string().min(3).max(8).optional(),
	// #endregion

	// #region Coordination projection (additive, all optional — see ./coordination.ts)
	/**
	 * Who is coming, and what each of them said. Distinct from the {@link attendees} COUNT above,
	 * which survives on a privacy-masked block where the roster does not: a public schedule may say
	 * "8 going" without naming eight people. A surface that has no roster has not been given one.
	 */
	roster: z.array(EventAttendeeSchema).max(200).optional(),
	/** The event's host/organiser — the party a reschedule is negotiated with. */
	organiser: SchedulingPartySchema.optional(),
	/**
	 * Whether the acting viewer hosts this event. Server-derived, because the host-only affordances
	 * (approving a client's proposed slot, opening a vote) must not be decided from a handle
	 * comparison the client could get wrong on a team-owned engagement.
	 */
	viewerIsHost: z.boolean().optional(),
	/** Where it happens online, and how to get in. Never present on a masked block. */
	meeting: EventMeetingSchema.optional(),
	/** What the occurrence is worth — paid group sessions, recurring classes, paid calls. */
	pricing: EventPricingSchema.optional(),
	/** The open (or most recent) attempt to move it. */
	reschedule: EventRescheduleSchema.optional(),
	/** The append-only audit log: edits, proposals, votes, responses, attachments. */
	history: z.array(EventHistoryEntrySchema).max(100).optional(),
	/**
	 * The agenda pack — briefs, slides, recordings hung on the occurrence.
	 *
	 * Deliberately the files domain's own {@link AssetItemSchema} rather than a scheduling-local file
	 * shape: an event attachment IS an asset, it is drawn by the same `FileCard`/`FileTable` the `/files`
	 * hub and the ticket modal mount, and a second file projection is how two surfaces come to disagree
	 * about the same object (the widening recorded in root CLAUDE.md §8 Decision #67). `AssetItem` keeps
	 * its channel/message provenance NULLABLE, which is exactly right here — an event is not a channel
	 * and nothing was posted in a message.
	 */
	attachments: z.array(AssetItemSchema).max(50).optional(),
	/**
	 * The rich-text agenda / description. The event's own body, distinct from the ≤160-char
	 * {@link meta} strapline the grid block renders — a block on a week grid has room for a phrase, and
	 * a modal has room for the brief.
	 */
	description: z.string().max(8000).optional(),
	// #endregion
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
// #endregion

// #region Availability (weekly recurring working hours + blackout dates)
/** One weekly-recurring working-hours window, expressed in the schedule's own timezone. */
export const AvailabilityRuleSchema = z.object({
	/** 0 = Sunday … 6 = Saturday. */
	weekday: z.number().int().min(0).max(6),
	/** Minutes from local midnight the window opens. */
	startMinute: z.number().int().min(0).max(1440),
	/** Minutes from local midnight the window closes (> startMinute). */
	endMinute: z.number().int().min(0).max(1440),
	label: z.string().max(80).optional(),
	/**
	 * What the band MEANS (`scheduling.availability_kind`). `working_hours` is the broad "at my
	 * desk" overlay; `call_window` is the narrower subset during which the owner accepts a
	 * discovery call — so the UI can paint a call band as a visually distinct subset rather than
	 * conflating "I am working" with "interrupt me". Optional and defaulting to `working_hours`, so
	 * every pre-existing payload stays valid.
	 */
	kind: z.enum(["working_hours", "call_window"]).optional(),
});
export type AvailabilityRule = z.infer<typeof AvailabilityRuleSchema>;

/** A holiday / blackout / time-off span the schedule is unavailable. */
export const BlackoutDateSchema = z.object({
	start: z.number().int(),
	end: z.number().int(),
	label: z.string().max(120),
});
export type BlackoutDate = z.infer<typeof BlackoutDateSchema>;

/** The full availability overlay a schedule surface renders behind its events. */
export const CalendarAvailabilitySchema = z.object({
	/** IANA timezone id the rules are expressed in (e.g. "Europe/London"). */
	timezone: z.string().max(60).optional(),
	rules: z.array(AvailabilityRuleSchema),
	blackouts: z.array(BlackoutDateSchema),
});
export type CalendarAvailability = z.infer<typeof CalendarAvailabilitySchema>;
// #endregion

// #region Page envelopes + params
/**
 * Which surface produced a page (drives the default view + which panels render).
 *
 * `personal` is the viewer's OWN agenda at `/calendar` — every engagement they are on, their working
 * hours, and whatever their connected external calendars contribute — as opposed to the three
 * surfaces that are a view onto somebody or something else.
 */
export const CalendarScope = z.enum([
	"project",
	"channel",
	"availability",
	"schedule",
	"personal",
]);
export type CalendarScope = z.infer<typeof CalendarScope>;

/**
 * The project / channel calendar page (`/projects/[id]/calendar`, `/projects/[id]/[channel]/calendar`):
 * task deadlines, review milestones, and scheduled stage syncs derived from the engagement.
 */
export const CalendarPageSchema = z.object({
	scope: CalendarScope,
	projectId: z.string().min(1).max(120),
	channelId: z.string().max(120).nullable(),
	title: z.string().max(160),
	/** IANA display timezone. */
	timezone: z.string().max(60),
	/** Whether the viewer is the client — gates create-milestone / schedule-sync affordances. */
	viewerIsClient: z.boolean(),
	/** Whether the viewer may create entries by clicking / dragging the grid. */
	canCreate: z.boolean(),
	events: z.array(CalendarEventSchema),
});
export type CalendarPage = z.infer<typeof CalendarPageSchema>;

/**
 * The availability / session-schedule page (`/[handle]/availability`, `/view/[entity]/schedule`):
 * weekly working hours + timezone + blackout dates + recurring session slots, plus whether the viewer
 * may book.
 */
export const SchedulePageSchema = z.object({
	scope: CalendarScope,
	title: z.string().max(160),
	subtitle: z.string().max(200).nullable(),
	timezone: z.string().max(60),
	/** The schedule owner's `@handle` (for booking attribution), or null. */
	ownerHandle: z.string().max(64).nullable(),
	/** Whether the viewer may open the booking flow from a slot. */
	viewerCanBook: z.boolean(),
	availability: CalendarAvailabilitySchema,
	events: z.array(CalendarEventSchema),
	/**
	 * What this owner offers by way of discovery calls — the public slice of
	 * `scheduling.call_settings` (never the caps, cooldowns, or buffers). Absent when the owner
	 * takes no calls, which is also the default for every pre-existing payload.
	 */
	callOffer: PublicCallOfferSchema.optional(),
});
export type SchedulePage = z.infer<typeof SchedulePageSchema>;

/** Params for the project / channel calendar read. */
export const CalendarParamsSchema = z.object({
	projectId: z.string().min(1).max(120),
	channelId: z.string().min(1).max(120).nullable().optional(),
});
export type CalendarParams = z.infer<typeof CalendarParamsSchema>;

/** Params for a `@handle`'s availability read. */
export const AvailabilityParamsSchema = z.object({
	handle: z.string().min(1).max(64),
});
export type AvailabilityParams = z.infer<typeof AvailabilityParamsSchema>;

/** Params for a session-based entity's schedule read. */
export const ScheduleParamsSchema = z.object({
	entityId: z.string().min(1).max(120),
});
export type ScheduleParams = z.infer<typeof ScheduleParamsSchema>;
// #endregion

// #region Write payloads (RSVP + the reschedule negotiation)
/**
 * Which surface, and which event on it, a write targets.
 *
 * A calendar event id is only unique WITHIN the page that derived it (`sync-{stageId}`, `av-{week}`),
 * so a mutation carries its scope and the server re-resolves the event through the very same reader
 * the page was drawn from. That is deliberate: the alternative — trusting a bare id — would let a
 * caller address an event the reader would never have shown them, and every rule below is evaluated
 * against the event's own start time.
 */
export const SchedulingTargetSchema = z.object({
	scope: CalendarScope,
	/** Required for `project` / `channel`. */
	projectId: z.string().max(120).optional(),
	channelId: z.string().max(120).nullable().optional(),
	/** Required for `availability`. */
	handle: z.string().max(64).optional(),
	/** Required for `schedule`. */
	entityId: z.string().max(120).optional(),
	eventId: z.string().min(1).max(120),
	/**
	 * The developer simulation overlay the surface was reading under, echoed back on the write.
	 *
	 * A write re-resolves its event through the very same reader that drew the page (see the doc note
	 * above), so it has to be handed the same overlay — otherwise a viewer simulating an `attendee`
	 * seat votes against an event the server re-derives with nobody seated on it, and every action
	 * refuses for a reason the developer cannot see. Ignored entirely on the live path.
	 */
	sim: SchedulingSimSchema.optional(),
});
export type SchedulingTarget = z.infer<typeof SchedulingTargetSchema>;

/** Set the viewer's own RSVP. A viewer may only ever answer for themselves. */
export const RsvpInputSchema = SchedulingTargetSchema.extend({
	response: RsvpResponse,
	note: z.string().max(280).optional(),
});
export type RsvpInput = z.infer<typeof RsvpInputSchema>;

/**
 * One move on a reschedule negotiation. Which fields are required follows from `action`:
 * `propose` needs `start`/`end`; `approve` / `vote` / `confirm` need `proposalId`; `open` and
 * `withdraw` need neither. Left as optionals rather than a discriminated union so the shape stays on
 * the primitive-only footing the sibling scheduling schemas hold to — the fat service returns a
 * `RescheduleRefusalReason` for a payload that does not carry what its action needs.
 */
export const RescheduleInputSchema = SchedulingTargetSchema.extend({
	action: RescheduleAction,
	/** Epoch ms (UTC) of a proposed alternative slot. */
	start: z.number().int().optional(),
	end: z.number().int().optional(),
	proposalId: z.string().max(80).optional(),
	note: z.string().max(280).optional(),
});
export type RescheduleInput = z.infer<typeof RescheduleInputSchema>;
// #endregion

// #region Shared helpers
/**
 * The external CALENDAR-SYNC vocabulary — the `capabilities @> {calendar}` rows of
 * `integrations.providers`, and the values {@link CalendarEvent.sources} carries.
 *
 * This is a VOCABULARY, not a gate. The provider catalogue is data (`integrations.providers`), so a
 * connector nobody has heard of arrives as an ordinary row and its slug travels on `sources`
 * unchanged; this list names the ones the product draws a brand mark for. Two synthetic members sit
 * alongside the real vendors because an occurrence's provenance is a closed question only if every
 * answer is expressible: `projective` is the platform's own copy, and `ics` is a one-off file import
 * that has no live connection behind it at all.
 *
 * ⚠️ Calendar sync and CONFERENCING are two separate axes and must not be collapsed into one set —
 * the room-minting axis lives in `./meeting.ts` and has a file of its own for exactly that reason.
 * Google appears on both because it is genuinely capable of both, not because the axes are the same.
 */
export const INTEGRATION_SOURCES = [
	"projective",
	"google",
	"outlook",
	"apple",
	"samsung",
	"notion",
	"calendly",
	"ics",
] as const;
export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number];

/** Human labels for the integration sources. */
export const INTEGRATION_LABEL: Record<IntegrationSource, string> = {
	projective: "Projective",
	google: "Google",
	outlook: "Outlook",
	apple: "Apple",
	samsung: "Samsung",
	notion: "Notion",
	calendly: "Calendly",
	ics: "Imported file",
};

/** Whether a slug is one the product carries a brand mark for. */
export function isIntegrationSource(slug: string): slug is IntegrationSource {
	return (INTEGRATION_SOURCES as readonly string[]).includes(slug);
}

/** The label for any source slug — the catalogue's own for a known one, the slug itself otherwise. */
export function integrationLabel(slug: string): string {
	return isIntegrationSource(slug) ? INTEGRATION_LABEL[slug] : slug;
}
// #endregion
