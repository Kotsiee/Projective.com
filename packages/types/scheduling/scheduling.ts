import { z } from "zod";

/**
 * scheduling — the Zod SSOT for the Calendar & Schedule domain shared across every surface: the
 * project / channel calendar (task deadlines · review milestones · stage syncs), a `@handle`'s
 * availability (weekly working hours · timezone · blackout dates), and a session-based service's
 * schedule (recurring session slots · attendee counts). One vocabulary, rendered by the ONE
 * `@projective/ui/calendar` engine — the projection field names match that engine's presentational
 * contract exactly, so a page payload flows straight into it.
 *
 * This is a READ projection, not a table row (like `projects/detail`, `projects/messages`): it flattens
 * the parts of the eventual `scheduling.events` / `scheduling.availability_rules` / `scheduling.blackouts`
 * tables a calendar view needs. No DB migration lands with it — the live path (RLS-scoped reads +
 * external-integration sync) fills in behind each surface's existing backend gate with zero shape churn.
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
	/** Epoch ms (UTC) of the end (> start for timed events). */
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
	/** External source of a privacy-masked block (`google`|`outlook`|`apple`|`samsung`|`notion`). */
	source: z.string().max(40).optional(),
	href: z.string().max(400).optional(),
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

// #region Integrations
/** A privacy-safe external-calendar integration chip (only the connection status ever leaks). */
export const CalendarIntegrationSchema = z.object({
	id: z.string().max(40),
	label: z.string().max(40),
	connected: z.boolean(),
	accent: z.string().max(60).optional(),
});
export type CalendarIntegration = z.infer<typeof CalendarIntegrationSchema>;
// #endregion

// #region Page envelopes + params
/** Which surface produced a page (drives the default view + which panels render). */
export const CalendarScope = z.enum(["project", "channel", "availability", "schedule"]);
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
	integrations: z.array(CalendarIntegrationSchema),
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
	integrations: z.array(CalendarIntegrationSchema),
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

// #region Shared helpers
/** The standard set of external integrations a surface can advertise (privacy-safe chips). */
export const INTEGRATION_SOURCES = ["google", "outlook", "apple", "samsung", "notion"] as const;
export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number];

/** Human labels for the integration sources. */
export const INTEGRATION_LABEL: Record<IntegrationSource, string> = {
	google: "Google",
	outlook: "Outlook",
	apple: "Apple",
	samsung: "Samsung",
	notion: "Notion",
};
// #endregion
