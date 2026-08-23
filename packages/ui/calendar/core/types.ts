import type { FrameStats } from "./scene-paint.ts";
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
import type { ComponentChildren, VNode } from "preact";
import type { Signal } from "@preact/signals";

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

/**
 * A request to (re)open the lightweight composer on a given range.
 *
 * The payload of `CalendarProps.compose`. `title` is what the reader had already typed somewhere else
 * — the whole point of the round trip is that nothing they wrote is lost on the way back.
 */
export interface CalendarComposeRequest {
	range: CalendarRange;
	title?: string;
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
	/**
	 * Epoch ms (UTC) of the end.
	 *
	 * `=== start` is a POINT IN TIME — a deadline — and is drawn as a pin rather than as a box, because
	 * a zero-duration entry has no height that could honestly encode a span. It survives layout as an
	 * instant instead of being filtered out or given a synthetic minimum duration; the view decides
	 * the mark, and nothing downstream invents a length for it.
	 */
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
	/**
	 * Every calendar this occurrence appears on, as opaque source keys the CONSUMER understands.
	 *
	 * Where an event is a DOM card — the all-day lane, the Day timeline, a month chip — the engine
	 * draws one small mark per source, stacked, and asks {@link CalendarProps.renderSource} for each:
	 * it holds no provider vocabulary and no brand artwork of its own, exactly as the lane chrome takes
	 * its glyphs as slots. That keeps the package portable and keeps brand marks, which cannot be
	 * re-weighted or recoloured without ceasing to be the mark, out of the icon system.
	 *
	 * Where an event is PIXELS — the Week grid's canvas — a consumer-supplied VNode cannot be drawn, so
	 * the channel becomes the COUNT: one neutral dot each, and "on N calendars" in the card's
	 * accessible name. That is the same fact the DOM card announces, from the same threshold; only the
	 * brand marks are lost, and a brand mark was never the half a listener could use.
	 *
	 * A MASKED block draws and announces none of it in either presentation (§Part 1.4).
	 */
	sources?: string[];
	/**
	 * Host + participant faces (§Part 2 Avatars). Generic — a photo-or-initials circle, drawn by the
	 * engine itself (DOM and canvas alike) — unlike {@link sources}, whose BRAND marks are inherently
	 * consumer-owned artwork and stay behind {@link CalendarProps.renderSource}.
	 *
	 * The viewer's OWN face is expected to already be filtered out by the consumer (`isViewer: true` on
	 * a row this array still carries — a card doesn't gain a slot back by removing it, since the count
	 * badge and the accessible name both read `attendees`/`capacity`, not this array's length) — "who
	 * else is here" is the useful question a card answers at a glance, not "am I on it" (the reader
	 * already knows). A masked block carries none of them, for the same §Part 1.4 reason it carries no
	 * kind glyph or provenance dots.
	 */
	attendeeFaces?: CalendarAttendee[];
	/** Where opening the block navigates (optional — otherwise {@link CalendarProps.onOpenEvent}). */
	href?: string;
}

/** One host/participant face on a card's avatar stack. */
export interface CalendarAttendee {
	id: string;
	/** Display name — the initials-fallback source and the accessible label. */
	name: string;
	/** A photo URL. Drawn where given and it loads; degrades to initials otherwise (never a broken box). */
	avatarUrl?: string;
	/** Hosting, not merely attending — drawn first in the stack, with its own ring treatment. */
	isHost?: boolean;
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

/**
 * One working-hours window resolved for a SPECIFIC day — an {@link AvailabilityRule} with its
 * weekday already answered.
 *
 * It lives here rather than beside a component because it is now a shared vocabulary: the timed
 * views resolve the day's windows and hand them to the canvas backdrop's scene, which is where the
 * band is actually drawn.
 */
export interface WorkingWindow {
	/** Minutes from local midnight the window opens. */
	startMinute: number;
	/** Minutes from local midnight the window closes (> startMinute). */
	endMinute: number;
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

// #region Popover slot
/**
 * What a consumer's popover action header is handed.
 *
 * It is declared HERE rather than beside the layer component that renders it because
 * {@link CalendarProps.renderEventActions} is part of the engine's public contract, and a props
 * interface may not reach forward into a component to describe its own slot. `EventPopoverLayer`
 * re-exports the name so a consumer can import it from either end.
 */
export interface EventPopoverActionContext {
	event: CalendarEvent;
	/** Dismiss the layer. */
	close: () => void;
}
// #endregion

// #region Props / callbacks
/**
 * The controlled props for the {@link Calendar} island. The consumer owns the data (events +
 * availability) and reacts to the selection/open/create callbacks; the engine owns view state
 * (mode, focus date, zoom, scroll, gestures).
 */
export interface CalendarProps {
	/**
	 * Optional per-frame cost report from the canvas renderer (Week view only — the Day timeline is
	 * still hybrid). Absent by default, and free when absent: no clock is read and no counting is
	 * done unless somebody is listening.
	 *
	 * It exists so the renderer TIER can be chosen from a measurement rather than an intuition. This
	 * repo's policy is tiered (root CLAUDE.md §8 Decision #1 — "auto-selected on a performance
	 * metric"), and Canvas2D versus WebGL is a question about frame cost at real density, which is
	 * exactly what this reports.
	 */
	onFrame?: (stats: FrameStats) => void;
	/** All entries to render. Times are epoch ms (UTC). */
	events: CalendarEvent[];
	/** Optional working-hours + blackout overlay (schedule surfaces). */
	availability?: CalendarAvailability;
	/** IANA display timezone. Defaults to `availability.timezone`, then the viewer's resolved zone. */
	timezone?: string;
	/**
	 * The view mode. Seeds the engine on mount and is TRACKED afterwards, so a host that owns the
	 * switch elsewhere can drive it; a host passing a constant is unaffected, because a value that
	 * never changes never re-fires the sync.
	 */
	view?: CalendarViewMode;
	/** The focus instant, epoch ms (UTC). Seeded and tracked exactly like {@link view}. */
	focus?: number;
	/** A heading shown in the header (e.g. the project title / "Availability"). */
	title?: string;
	/**
	 * Consumer-owned controls for the header's trailing cluster (connect a calendar, import a file,
	 * filter by provider). A SLOT rather than a prop set: what a surface offers here is an application
	 * decision, and the engine holding a list of providers would tie a portable package to one
	 * product's connector catalogue.
	 */
	headerActions?: ComponentChildren;
	/**
	 * Draw the mark for one of an event's {@link CalendarEvent.sources}. Returning `null` omits that
	 * source's mark, which is how a consumer suppresses its own platform's copy from the stack.
	 */
	renderSource?: (source: string) => VNode | null;
	/** When true, empty-cell click + drag-to-select open the creation flow. */
	canCreate?: boolean;
	/** Hide the left panel (mini-map + availability) — e.g. inside a compact booking modal. */
	hideSidePanel?: boolean;
	/**
	 * Hide the engine's own header row.
	 *
	 * For a host that has already given the period trail, the view switch and the search a home of
	 * their own — a surface built on the shell's region contract puts them in the frame's header and
	 * footer bands. Drawing them twice would be two controls for one fact. The host then drives the
	 * engine through {@link view} / {@link focus} and hears back through {@link onViewChange} /
	 * {@link onFocusChange}.
	 */
	hideHeader?: boolean;
	/**
	 * localStorage key prefix for the density the engine persists across sessions (`:zoom`).
	 *
	 * It also carries `:view` — but ONLY while the engine owns the view. A host that passes
	 * {@link view} owns it, and the engine then neither restores nor writes it, because restoring a
	 * value the host's own tracking is about to overwrite is two owners for one piece of state with
	 * one of them losing silently. Such a host persists its own view alongside its own switch.
	 */
	storageKey?: string;
	/**
	 * Draw the popover's action header for one event. Absent -> the popover draws no actions.
	 *
	 * A SLOT rather than a prop set, for the same reason {@link headerActions} is: what an event links
	 * out to is an application decision, and a portable package holding a route table would tie it to
	 * one product's sitemap. Absent means the header is not drawn AT ALL — a capability the host
	 * cannot honour is absent, never offered and then refused.
	 */
	renderEventActions?: (ctx: EventPopoverActionContext) => VNode | null;
	/** Called when an empty range is selected (click or drag) and {@link canCreate}. */
	onSelectRange?: (range: CalendarRange) => void;
	/**
	 * Commit a quick-create from the drag popover.
	 *
	 * Absent -> the popover offers no submit, and a drag still calls {@link onSelectRange}. The two are
	 * layered deliberately: a host that only wants to be TOLD about a range keeps working unchanged,
	 * and a host that can actually create one opts into the inline path.
	 */
	onQuickCreate?: (range: CalendarRange, title: string) => void;
	/**
	 * Open the host's FULL creation surface, carrying whatever the quick composer already holds.
	 *
	 * Absent -> the composer offers no expand control at all, rather than a disabled one: a capability
	 * the host cannot honour is absent, never offered and then refused. The `title` argument is the
	 * whole point — the two surfaces are one flow with two levels of detail, and a handoff that lost
	 * what the reader had already typed would make the second level a punishment for using the first.
	 *
	 * The reverse trip is the host's own: it re-publishes a `create` popover state carrying the title
	 * back, and the composer seeds itself from it. See `EventPopoverState`.
	 */
	onExpandCreate?: (range: CalendarRange, title: string) => void;
	/**
	 * The host's way BACK into the quick composer — the return leg of {@link onExpandCreate}.
	 *
	 * Writing a request opens the create popover on that range, seeds its title, and puts the dashed
	 * draft block back on the grid; the engine then CLEARS the signal, so it is a one-shot message
	 * rather than a second copy of the composer's state. That direction of ownership matters: the
	 * composer's contents belong to the composer while it is open, and a host that kept writing into
	 * it would type over the reader.
	 *
	 * It is a signal rather than an imperative handle because the host that needs it — a full modal
	 * being minimised — is a sibling of this island, not a parent holding a ref to it.
	 */
	compose?: Signal<CalendarComposeRequest | null>;
	/** Called when the reader unfolds or refolds an overlap cluster. Chrome-only; purely optional. */
	onUnfoldChange?: (expanded: ReadonlySet<string>) => void;
	/** Called when an existing event is opened. */
	onOpenEvent?: (event: CalendarEvent) => void;
	/**
	 * Called when an event is DRAGGED to a new slot in the Week grid.
	 *
	 * Supplying it is what ENABLES the gesture. Without a handler a plain drag on a card would offer a
	 * rearrangement the host has no way to keep, so the engine does not offer it at all rather than
	 * offering it and silently discarding the result — the press stays a click, and the card opens.
	 * The engine is controlled here as it is everywhere else: it reports the new range and redraws
	 * only once the host's own data comes back changed.
	 */
	onMoveEvent?: (event: CalendarEvent, range: CalendarRange) => void;
	/** Called whenever the view mode changes (persisted by the consumer if desired). */
	onViewChange?: (view: CalendarViewMode) => void;
	/**
	 * Called whenever the focused instant moves — a nav step, Today, a mini-map pick, or the scroll
	 * centre crossing into a new day. A host that renders the period label outside the engine has no
	 * other way to keep it truthful.
	 */
	onFocusChange?: (focusMs: number) => void;
	class?: string;
}
// #endregion
