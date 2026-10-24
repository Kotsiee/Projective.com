import { signal } from "@preact/signals";
import {
	CALENDAR_ZOOM_DEFAULT,
	calendarStateAt,
	calendarTime,
	calendarZoomFor,
	DEFAULT_PPH,
	MONTH_WEEKS_DEFAULT,
} from "@projective/ui/calendar";
import type { CalendarViewMode, CalendarZoomMode } from "@projective/ui/calendar";
import { PX_PER_DAY_DEFAULT } from "@projective/ui/gantt";
import type { CalendarEvent, CalendarEventKind, SchedulePage } from "@projective/types/scheduling";
import { LocalKeys } from "@web/utils/storage-keys.ts";
import {
	contextPanelDocked,
	contextPanelInflow,
} from "@web/features/shell/core/context-panel-state.ts";
import { eventStack } from "./event-view.ts";

/**
 * calendar-state — the cross-island bridge for the `/calendar` hub.
 *
 * The surface is FOUR hydration roots, not one: the shell resolves the lane, the header band and the
 * footer band above the route (they render in the frame, outside the page body), so the mini-month,
 * the period trail, the view switch and the grid are four separate Preact trees that cannot pass
 * props to each other. A module-level signal is the seam the rest of the codebase already uses for
 * exactly this — the board's footer↔body bridge, the submissions review bridge, the wallet's
 * `wallet-state`.
 *
 * Everything here is CLIENT view state. Nothing in this module fetches, decides access, or holds a
 * figure the server computed: the page payload itself travels as an SSR prop and is republished into
 * {@link calendarPage} by the body island so the lane and the bands can read the same data the grid
 * is drawing, rather than fetching it a second time and drifting.
 */

// #region The page
/**
 * The agenda every region reads.
 *
 * Published by the BODY island, which owns the fetch: one reader, one refetch, one answer. A lane
 * that fetched its own copy would show an upcoming list built from a different response than the
 * grid beside it, and the two would disagree the moment a write landed.
 */
export const calendarPage = signal<SchedulePage | null>(null);
// #endregion

// #region Navigation
/** Day · Week · Month · Timeline. Driven by the footer rig's view control, at every width. */
export const calendarView = signal<CalendarViewMode>("week");

/**
 * Where the calendar axis sits: 0 is Month at its widest, 1 is Day at its deepest (`@projective/ui/
 * calendar` `core/zoom.ts`). The footer's slider and the grid's Ctrl+wheel move it; the engine
 * writes every zoom it makes back here, so the two never disagree.
 */
export const calendarZoom = signal<number>(CALENDAR_ZOOM_DEFAULT);

/** The timeline's scale, px per day — the slider's axis while the Timeline is showing. */
export const timelineZoom = signal<number>(PX_PER_DAY_DEFAULT);

/**
 * Restore the reader's last view and zoom.
 *
 * The APP owns these, not the engine: `/calendar` drives the engine through its `view` and `zoom`
 * props, and an engine that also restored them from its own `storageKey` would be a second owner
 * writing over the first on the very next effect. A calendar view is re-derived from the zoom, so
 * the two stored values can never name different views.
 *
 * Client only, and deliberately not read at module scope: this module is imported during SSR, where
 * `localStorage` does not exist and where module state is shared across every request in the
 * process — seeding a shared signal from one reader's storage would hand it to the next.
 */
export function restoreCalendarView(): void {
	if (typeof localStorage === "undefined") return;
	try {
		const stored = localStorage.getItem(LocalKeys.CALENDAR_VIEW);
		const zoom = localStorage.getItem(LocalKeys.CALENDAR_ZOOM);
		const timeline = Number(localStorage.getItem(LocalKeys.CALENDAR_TIMELINE_ZOOM));
		const u = zoom === null ? NaN : Number(zoom);
		if (Number.isFinite(u) && u >= 0 && u <= 1) {
			calendarZoom.value = u;
		} else if (stored === "day" || stored === "week" || stored === "month") {
			calendarZoom.value = calendarZoomFor({
				view: stored,
				pph: DEFAULT_PPH,
				weeks: MONTH_WEEKS_DEFAULT,
			});
		}
		if (timeline > 0) timelineZoom.value = timeline;
		calendarView.value = stored === "timeline"
			? "timeline"
			: calendarStateAt(calendarZoom.value).view;
	} catch { /* storage unavailable — the default view is a fine answer */ }
}

/** Remember the current view for the next visit. Never throws: a full quota is not an error here. */
export function persistCalendarView(view: CalendarViewMode): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(LocalKeys.CALENDAR_VIEW, view);
	} catch { /* no-op */ }
}

let zoomPersist: ReturnType<typeof setTimeout> | null = null;

/** Remember both zoom axes, on a trailing debounce: a drag or a wheel burst writes dozens a second. */
export function persistCalendarZoom(): void {
	if (typeof localStorage === "undefined") return;
	if (zoomPersist !== null) clearTimeout(zoomPersist);
	zoomPersist = setTimeout(() => {
		zoomPersist = null;
		try {
			localStorage.setItem(LocalKeys.CALENDAR_ZOOM, String(calendarZoom.peek()));
			localStorage.setItem(LocalKeys.CALENDAR_TIMELINE_ZOOM, String(timelineZoom.peek()));
		} catch { /* no-op */ }
	}, 200);
}

/** Switch between the calendar and the timeline; the calendar returns at the view its zoom names. */
export function setCalendarMode(mode: CalendarZoomMode): void {
	calendarView.value = mode === "timeline" ? "timeline" : calendarStateAt(calendarZoom.peek()).view;
}

/**
 * The focused instant the reader has MOVED to — written by the mini-month, the header's trail and the
 * grid's own scroll — or `0` until they have moved at all. Read it through {@link focusedAt}.
 *
 * It starts at zero rather than at a clock reading because this module is also imported during SSR,
 * where module state is shared by every request the process renders: a signal seeded from one
 * request's clock would open the next reader on the previous reader's week.
 */
export const calendarFocus = signal<number>(0);

/**
 * The instant the surface is focused on: the reader's own position once they have moved it, else the
 * page's own `now` — the server's clock at the moment it read the agenda.
 *
 * Every region reads this with the page it was handed, so the lane, both bands and the grid open on
 * the SAME instant in the first byte and again on hydration (the page is the same object on both
 * sides), and the event modal measures "Upcoming in 3 hours" against the same clock the server used
 * to decide what is open. `Date.now()` is reached only when there is no page at all.
 */
export function focusedAt(page: SchedulePage | null | undefined): number {
	return calendarFocus.value || page?.now || Date.now();
}

/**
 * Which period the header band prints.
 *
 * A pure function over the engine's OWN zoned-time matrix (`calendarTime`), not a value the grid
 * publishes. It was a published signal first, and that was wrong twice: the band and the grid are
 * separate hydration roots, so the label was empty at SSR and flipped to the real week on hydration —
 * a visible flash on the one control that says which week you are looking at — and the "single
 * implementation" it was protecting is `calendarTime` itself, which the band can simply call.
 */
export function periodLabelFor(view: CalendarViewMode, focusMs: number, tz: string): string {
	if (view === "day") return calendarTime.fmtFullDate(focusMs, tz);
	// The Gantt's axis has no fixed period; the trail names the month the viewport is centred in.
	if (view === "month" || view === "timeline") return calendarTime.fmtMonthYear(focusMs, tz);
	const days = calendarTime.weekDays(focusMs, tz);
	return `${calendarTime.fmtDayLabel(days[0], tz)} – ${calendarTime.fmtDayLabel(days[6], tz)}`;
}
// #endregion

// #region Narrowing
/** Find-in-calendar. Narrows the lane's upcoming list AND the grid — one control, one effect. */
export const calendarQuery = signal("");

/**
 * Source slugs the reader has switched OFF.
 *
 * A DENY list rather than an allow list, deliberately: a newly connected calendar must appear
 * without the reader having to go and tick it, and an allow list seeded from today's connections
 * would hide tomorrow's.
 *
 * **What a checkbox means, and why it is not "hide anything Google touches".** An occurrence is on
 * SEVERAL calendars at once — a stage sync lives here and is mirrored to Google — so each checkbox
 * is a LAYER switch, not an origin filter. Unticking one withdraws that calendar entirely: an entry
 * that is on no other surviving calendar disappears ({@link visibleEvents}), and an entry that is
 * also somewhere still ticked stays but stops claiming the withdrawn one ({@link sourceIsVisible},
 * which the grid's `renderSource` and the lane's rows both go through).
 *
 * The two alternatives were both wrong. Hiding an event when ANY of its calendars is off would
 * delete the reader's own work meetings the moment they quietened a noisy Google account, because
 * those meetings happen to be mirrored there. And the shipped behaviour — hide only when EVERY
 * calendar is off, and draw the marks regardless — made the control inert for every real provider:
 * `sourcesFor` puts `projective` on every derived event, so unticking Google hid 14 of 79
 * Google-marked entries and left the other 65 wearing the mark of a calendar the reader had just
 * switched off. The rule below is unchanged; suppressing the mark is what makes it legible.
 */
export const hiddenSources = signal<readonly string[]>([]);

/** Event kinds the reader has switched off (deadlines, sessions, …). Same deny-list reasoning. */
export const hiddenKinds = signal<readonly CalendarEventKind[]>([]);

/** Toggle one member of a deny list, returning the new list. */
function toggle<T>(list: readonly T[], key: T): readonly T[] {
	return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

/** Show/hide one calendar's layer. */
export function toggleSource(slug: string): void {
	hiddenSources.value = toggle(hiddenSources.value, slug);
}

/**
 * Whether one calendar's provenance mark should still be drawn.
 *
 * The visible half of a layer switch: an entry held up by another calendar survives the filter, but
 * it must stop advertising the one the reader withdrew, or the control looks inert on every entry it
 * did not remove. Read by the grid's `renderSource` and by the lane's upcoming rows, so the two
 * stacks can never disagree about which marks belong on screen.
 */
export function sourceIsVisible(slug: string): boolean {
	return !hiddenSources.value.includes(slug);
}

/** Show/hide one event kind. */
export function toggleKind(kind: CalendarEventKind): void {
	hiddenKinds.value = toggle(hiddenKinds.value, kind);
}

/**
 * Narrow to ONE kind, or clear when it is already the only one shown.
 *
 * The lane's quick row and the header's checkboxes are two entry points onto ONE axis — the same
 * `hiddenKinds` deny list — rather than two competing filters, which is how `/messages` ended up
 * with two Starred controls 160px apart that behaved differently. The row is single-select because
 * the shared lane chrome names each toggle "Show {label} only", and a control whose accessible name
 * says `only` must actually mean it.
 */
export function showOnlyKind(
	kind: CalendarEventKind,
	present: readonly CalendarEventKind[],
): void {
	const others = present.filter((k) => k !== kind);
	const hidden = hiddenKinds.value;
	const alreadySolo = others.length === hidden.length && others.every((k) => hidden.includes(k));
	hiddenKinds.value = alreadySolo ? [] : others;
}

/** The one kind currently shown alone, or `null` when several are. */
export function soleVisibleKind(
	present: readonly CalendarEventKind[],
): CalendarEventKind | null {
	const visible = present.filter((k) => !hiddenKinds.value.includes(k));
	return visible.length === 1 ? visible[0] : null;
}

/**
 * Toggle one kind in the lane filter's Event type facet, read the `/projects` way: no chip pressed
 * means every kind is shown, and pressing chips narrows to exactly the pressed set. Written onto the
 * same {@link hiddenKinds} deny list, so the quick row and this facet stay one axis.
 */
export function toggleShownKind(
	kind: CalendarEventKind,
	present: readonly CalendarEventKind[],
): void {
	const shown = shownKinds(present);
	const next = shown.includes(kind) ? shown.filter((k) => k !== kind) : [...shown, kind];
	hiddenKinds.value = next.length === 0 || next.length === present.length
		? []
		: present.filter((k) => !next.includes(k));
}

/** The kinds the Event type facet shows as pressed — none while nothing is narrowed. */
export function shownKinds(present: readonly CalendarEventKind[]): CalendarEventKind[] {
	const hidden = hiddenKinds.value;
	return hidden.length === 0 ? [] : present.filter((k) => !hidden.includes(k));
}

/**
 * Owner keys the reader has narrowed to — an ALLOW list, empty for everyone. Unlike the two deny
 * lists above, an owner is a person rather than a layer, and "only mine" is the question asked.
 */
export const shownOwners = signal<readonly string[]>([]);

/** The owner key of the entries the reader hosts. */
export const OWNER_SELF = "self";
/** The owner key of entries with no organiser on the payload (deadlines, external busy blocks). */
export const OWNER_NONE = "none";

/** Whose entry this is: the reader's own, an organiser's handle or name, or nobody named. */
export function ownerKeyOf(e: CalendarEvent): string {
	if (e.viewerIsHost === true) return OWNER_SELF;
	return e.organiser ? e.organiser.handle ?? e.organiser.name : OWNER_NONE;
}

/** Every owner on the page, the reader first, in first-seen order — the Owner facet's options. */
export function ownersOnPage(events: readonly CalendarEvent[]): { value: string; label: string }[] {
	const seen = new Map<string, string>();
	for (const e of events) {
		const key = ownerKeyOf(e);
		if (seen.has(key)) continue;
		seen.set(
			key,
			key === OWNER_SELF ? "You" : key === OWNER_NONE ? "No organiser" : e.organiser?.name ?? key,
		);
	}
	return [...seen].map(([value, label]) => ({ value, label }))
		.sort((a, b) => Number(b.value === OWNER_SELF) - Number(a.value === OWNER_SELF));
}

/** Toggle one owner in the allow list. */
export function toggleOwner(key: string): void {
	shownOwners.value = toggle(shownOwners.value, key);
}

/** The start · end date window as `[fromMs, toMs)`, or `null` for all time. */
export const dateRange = signal<readonly [number, number] | null>(null);

/**
 * The display preset the footer's left control picks: everything, only the open slots, only what is
 * scheduled (availability hidden, working-hours shading included), or only booked leave. A lens over
 * the agenda rather than a filter the reader assembles, so the Filter trigger does not count it.
 */
export type CalendarPreset = "all" | "availability" | "events" | "holidays";
export const calendarPreset = signal<CalendarPreset>("all");

/** The preset menu's options, in the order they are offered. */
export const PRESET_OPTIONS: readonly { value: CalendarPreset; label: string }[] = [
	{ value: "all", label: "Everything" },
	{ value: "availability", label: "Availability only" },
	{ value: "events", label: "Hide availability" },
	{ value: "holidays", label: "Booked holidays only" },
];

/** How many filter facets are narrowing — the Filter trigger's count. */
export function activeFilterCount(): number {
	return Number(hiddenSources.value.length > 0) + Number(hiddenKinds.value.length > 0) +
		Number(shownOwners.value.length > 0) + Number(dateRange.value !== null);
}

/** Whether any narrowing is engaged — drives the filter control's engaged state. */
export function filtersEngaged(): boolean {
	return activeFilterCount() > 0;
}

/** Clear every filter facet. The search and the display preset are their own controls and stay. */
export function resetFilters(): void {
	hiddenSources.value = [];
	hiddenKinds.value = [];
	shownOwners.value = [];
	dateRange.value = null;
}

/**
 * The events a surface should draw, after search, every filter facet and the display preset.
 *
 * Pure and exported so the grid and the lane's upcoming list narrow IDENTICALLY. When they each held
 * their own predicate, a search term that matched a location narrowed one and not the other.
 *
 * An event survives the Calendars filter while ANY calendar it is on is still ticked — the layer
 * model {@link hiddenSources} sets out. An event with no `sources` at all is never hidden by it:
 * absence is "we do not know where this came from", and hiding it would make a legitimate entry
 * vanish for a reason the reader cannot see or undo.
 */
export function visibleEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
	const q = calendarQuery.value.trim().toLowerCase();
	const kinds = hiddenKinds.value;
	const sources = hiddenSources.value;
	const owners = shownOwners.value;
	const range = dateRange.value;
	const preset = calendarPreset.value;
	return events.filter((e) => {
		if (kinds.includes(e.kind)) return false;
		if (preset === "availability" && e.kind !== "availability") return false;
		if (preset === "events" && e.kind === "availability") return false;
		if (preset === "holidays" && e.kind !== "holiday") return false;
		if (owners.length > 0 && !owners.includes(ownerKeyOf(e))) return false;
		if (range && (e.end < range[0] || e.start >= range[1])) return false;
		if (sources.length > 0 && e.sources && e.sources.length > 0) {
			if (e.sources.every((s) => sources.includes(s))) return false;
		}
		if (!q) return true;
		// A masked block has no title to search — matching on the one it is hiding would leak it
		// through the filter, so only its privacy-safe status and kind are searchable.
		const hay = e.masked
			? `${e.status ?? ""} ${e.kind}`
			: `${e.title} ${e.meta ?? ""} ${e.location ?? ""}`;
		return hay.toLowerCase().includes(q);
	});
}

/** Every source slug present on the page, in first-seen order — the filter's own option list. */
export function sourcesOnPage(events: readonly CalendarEvent[]): string[] {
	const seen: string[] = [];
	for (const e of events) {
		for (const s of e.sources ?? []) if (!seen.includes(s)) seen.push(s);
	}
	return seen;
}

/** Every event kind present on the page, in first-seen order. */
export function kindsOnPage(events: readonly CalendarEvent[]): CalendarEventKind[] {
	const seen: CalendarEventKind[] = [];
	for (const e of events) if (!seen.includes(e.kind)) seen.push(e.kind);
	return seen;
}
// #endregion

// #region Selection and the cross-view flash
/**
 * The entry the reader picked — from the grid or from the lane's list. The right panel's Event tab
 * describes it, and the lane marks its row.
 */
export const selectedEventId = signal<string | null>(null);

/** One flash pulse aimed at the GRID: the engine centres and rings this entry while it is set. */
export const gridSpotlight = signal<string | null>(null);
/** One flash pulse aimed at the LANE: the list centres this row and glows it once. */
export const laneSpotlight = signal<string | null>(null);

/** How long a flash holds — the platform's `--dur-highlight`, so both views pulse for one beat. */
const FLASH_MS = 1800;

function pulse(target: typeof gridSpotlight, id: string): void {
	// Cleared first so the same entry picked twice still re-fires its subscribers.
	target.value = null;
	target.value = id;
	setTimeout(() => {
		if (target.peek() === id) target.value = null;
	}, FLASH_MS);
}

/** Which tab the right panel shows. */
export const panelTab = signal<"event" | "month">("month");

/**
 * Pick an entry, from either view, and show it in the OTHER one.
 *
 * A pick in the list moves the grid onto the entry and flashes it there; a pick on the grid scrolls
 * the list to its row and flashes that. Neither view's scroll is otherwise driven by the other. The
 * details then open where there is room for them: the docked right panel from 1280px, the event modal
 * below it, where the panel would only arrive as a drawer over the grid the reader just used.
 */
export function selectEvent(event: CalendarEvent, from: "grid" | "list"): void {
	selectedEventId.value = event.id;
	if (from === "list") {
		calendarFocus.value = event.start;
		pulse(gridSpotlight, event.id);
	} else {
		pulse(laneSpotlight, event.id);
	}
	if (contextPanelInflow()) {
		panelTab.value = "event";
		contextPanelDocked.value = true;
	} else {
		openEventModal(event.id);
	}
}

/** Open an entry in the event modal (`.evm__panel`), where reading turns into editing. */
export function openEventModal(id: string): void {
	eventStack.open("event", id, { mode: "view" });
}

/**
 * A delete raised outside the body island — the right panel's Delete. The body owns the session's
 * entries and answers it: the same band↔body handshake as {@link createRequest}.
 */
export const removeRequest = signal<string | null>(null);

/** Ask the body to take an entry off the calendar. */
export function requestRemove(id: string): void {
	removeRequest.value = id;
}
// #endregion

// #region Overlays the bands open
/** The id of the middle-nav panel's month navigator — the header band's toggle controls it. */
export const CALENDAR_PANEL_ID = "cal-panel";

/** The unified Connect-a-calendar consent modal. */
export const connectOpen = signal(false);

/**
 * The export modal. Opened by the footer rig's Export and mounted once, by the rig. Import needs no
 * counterpart: its popover is anchored to the trigger that opened it, so the trigger owns it.
 */
export const exportOpen = signal(false);

/**
 * A create request raised by a BAND.
 *
 * The event modal is mounted by the body island — it is the only region that holds the page's
 * timezone, the viewer's access and the modal stack — so New event in the footer rig (and its
 * counterpart on the lane's collapsed rail) cannot open it directly. It raises this instead and the
 * body answers, which is the same footer↔body handshake the board's Create Ticket uses.
 */
export const createRequest = signal(0);

/** Ask the body to open a blank entry. */
export function requestCreate(): void {
	createRequest.value++;
}
// #endregion

// #region Imported entries
/**
 * Entries read out of an imported `.ics`, `.ical` or `.vcs`, held CLIENT-SIDE only.
 *
 * They are not posted anywhere: persisting an import needs the `scheduling.*` write path, which is
 * still behind the backend gate. Keeping them in a signal beside the fetched page means the grid can
 * draw them immediately and honestly — they carry the `ics` source mark, so nothing on screen claims
 * they are synced with anything. A second import of the same file replaces the first
 * (`mergeImported`).
 */
export const importedEvents = signal<readonly CalendarEvent[]>([]);
// #endregion
