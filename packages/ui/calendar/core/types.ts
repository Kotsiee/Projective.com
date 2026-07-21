/**
 * @projective/ui/calendar — the generic, presentational contract for the Calendar & Schedule engine
 * (DESIGN_SYSTEM.md §C.1). Plain TypeScript, NO Zod (the package stays copy-paste-portable and
 * depends only on the token contract). Every consuming surface — the project/channel calendar, the
 * handle availability page, a session-service schedule, a booking modal — maps its own domain data
 * (a Zod projection from `@projective/types/*`) into these shapes, so the ONE engine renders them all.
 *
 * Time is always **epoch milliseconds (UTC)**; the display timezone is a separate, explicit concern
 * (see {@link CalendarProps.timezone} + `core/time.ts`) so SSR and the hydrated island agree.
 */

// #region View + selection
/** The three primary view modes the header switches between (and Ctrl+wheel zooms across). */
export type CalendarViewMode = "day" | "week" | "month";

/** A time range the user selected (drag-to-select) or clicked (an empty cell → a zero/slot range). */
export interface CalendarRange {
	/** Epoch ms (UTC) of the range start. */
	start: number;
	/** Epoch ms (UTC) of the range end (>= start). */
	end: number;
	/** Whether the range was made in an all-day lane / month cell. */
	allDay?: boolean;
}
// #endregion

// #region Events
/**
 * The kind of a calendar entry — drives the default accent + glyph. Privacy-masked external/busy and
 * availability blocks (`busy`/`available`/`tentative` on {@link CalendarEvent.status}) never leak a
 * real title (§Part 1.4 Privacy Masking).
 */
export type CalendarEventKind =
	| "deadline" // a task/ticket due date
	| "milestone" // a review milestone
	| "sync" // a scheduled stage sync / meeting
	| "session" // a scheduled session / class / workshop
	| "booking" // a confirmed booking on the viewer's own schedule
	| "availability" // a bookable open slot
	| "busy" // an external/private busy block (privacy-masked)
	| "holiday" // a blackout / holiday / time-off block
	| "general";

/** Privacy-safe status label an external / availability block is allowed to expose. */
export type CalendarEventStatus = "confirmed" | "tentative" | "busy" | "available" | "cancelled";

/** A single, positioned calendar entry. Times are epoch ms (UTC). */
export interface CalendarEvent {
	id: string;
	/** Display title. Ignored when {@link masked} — the {@link status} label renders instead. */
	title: string;
	kind: CalendarEventKind;
	status?: CalendarEventStatus;
	/** Epoch ms (UTC) of the start. */
	start: number;
	/** Epoch ms (UTC) of the end (> start for timed events). */
	end: number;
	/** Rendered in the all-day lane (day/week) or spanning a month cell instead of the time column. */
	allDay?: boolean;
	/**
	 * Only a privacy-safe {@link status} label is shown (Available / Busy / Tentative) — the real title
	 * is withheld. Set for external-integration and general-availability blocks (§Part 1.4).
	 */
	masked?: boolean;
	/** A CSS custom-property NAME (e.g. `"--primary"`) to accent the block; defaults per {@link kind}. */
	accent?: string;
	location?: string;
	/** A small secondary line (time range, host, etc.). */
	meta?: string;
	/** Current attendee count — rendered as a counter on public group sessions only. */
	attendees?: number;
	/** Maximum capacity (pairs with {@link attendees} for the `n / N` counter). */
	capacity?: number;
	/** The external source this block came from (`google` | `outlook` | `apple` | `samsung` | `notion`). */
	source?: string;
	/** Where opening the block navigates (optional — otherwise {@link CalendarProps.onOpenEvent}). */
	href?: string;
}
// #endregion

// #region Availability (weekly recurring working hours + blackout dates)
/** One weekly-recurring working-hours window, expressed in the schedule's own timezone. */
export interface AvailabilityRule {
	/** 0 = Sunday … 6 = Saturday. */
	weekday: number;
	/** Minutes from local midnight the window opens. */
	startMinute: number;
	/** Minutes from local midnight the window closes (> startMinute). */
	endMinute: number;
	/** Optional human label (e.g. "Core hours"). */
	label?: string;
}

/** A holiday / blackout / time-off span the schedule is unavailable. */
export interface BlackoutDate {
	/** Epoch ms (UTC) of the span start. */
	start: number;
	/** Epoch ms (UTC) of the span end. */
	end: number;
	label: string;
}

/** The full availability overlay a schedule surface renders behind its events. */
export interface CalendarAvailability {
	/** IANA timezone id the rules are expressed in (e.g. `Europe/London`). */
	timezone?: string;
	/** Weekly working-hours windows. */
	rules: AvailabilityRule[];
	/** Holiday / blackout spans. */
	blackouts: BlackoutDate[];
}
// #endregion

// #region Header integrations
/** An external-calendar integration chip shown in the header (privacy note: only status leaks). */
export interface CalendarIntegration {
	id: string;
	label: string;
	connected: boolean;
	/** A CSS custom-property name for the chip dot (optional). */
	accent?: string;
}
// #endregion

// #region Props / callbacks
/**
 * The controlled props for the {@link Calendar} island. The consumer owns the data (events +
 * availability) and reacts to the selection/open/create callbacks; the engine owns view state
 * (mode, focus date, zoom, scroll, gestures).
 */
export interface CalendarProps {
	/** All entries to render. Times are epoch ms (UTC). */
	events: CalendarEvent[];
	/** Optional working-hours + blackout overlay (schedule surfaces). */
	availability?: CalendarAvailability;
	/** IANA display timezone. Defaults to `availability.timezone`, then the viewer's resolved zone. */
	timezone?: string;
	/** Initial view mode (default `"week"`). */
	view?: CalendarViewMode;
	/** Initial focus instant, epoch ms (UTC). Defaults to the engine's reference "now". */
	focus?: number;
	/** A heading shown in the header (e.g. the project title / "Availability"). */
	title?: string;
	/** External-integration chips for the header. */
	integrations?: CalendarIntegration[];
	/** When true, empty-cell click + drag-to-select open the creation flow. */
	canCreate?: boolean;
	/** Hide the left panel (mini-map + availability) — e.g. inside a compact booking modal. */
	hideSidePanel?: boolean;
	/** localStorage key to persist the zoom/view density across sessions. */
	storageKey?: string;
	/** Called when an empty range is selected (click or drag) and {@link canCreate}. */
	onSelectRange?: (range: CalendarRange) => void;
	/** Called when an existing event is opened. */
	onOpenEvent?: (event: CalendarEvent) => void;
	/** Called whenever the view mode changes (persisted by the consumer if desired). */
	onViewChange?: (view: CalendarViewMode) => void;
	class?: string;
}
// #endregion
