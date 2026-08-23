import { signal } from "@preact/signals";
import { calendarTime } from "@projective/ui/calendar";
import type { CalendarViewMode } from "@projective/ui/calendar";
import type { CalendarEvent, CalendarEventKind, SchedulePage } from "@projective/types/scheduling";
import { LocalKeys } from "@web/utils/storage-keys.ts";

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
/**
 * The instant this surface treats as "now" — the week it opens on, and the clock the event modal
 * measures "Upcoming in 3 hours" / "Passed" and the reschedule lockout against.
 *
 * ⚠️ It is the SERVER's reference clock, hardcoded, because the payload has no field to carry it.
 * `ScheduleBackendService` derives every live-status and negotiation state against the fixtures'
 * fixed clock (`derive.ts` `NOW`), so the client's "now" has to be the same instant or the surface
 * contradicts itself: `Date.now()` here would put "Passed" beside an open ballot the server had just
 * attached, which is worse than a stale week. One clock for the whole temporal frame, or none.
 *
 * The honest fix is a server-stamped field on the payload — `SchedulePage.now` (or `generatedAt`) —
 * at which point this constant is deleted and every reader takes the server's instant, on the
 * fixtures AND on the live path. That is a `@projective/types/scheduling` change and is recorded
 * rather than half-applied here. The two older calendar surfaces hold the same constant for the
 * same reason (`ProjectCalendar.island.tsx`, `ScheduleView.island.tsx`).
 */
export const CALENDAR_REFERENCE = Date.parse("2026-07-17T16:20:00Z");

/** Day · Week · Month. Owned by the middle-nav FOOTER rig, which renders at every width. */
export const calendarView = signal<CalendarViewMode>("week");

/**
 * The three view modes and the words for them.
 *
 * Shared rather than declared twice because the switch and its collapsed-rail equivalent now live in
 * two REGIONS — the footer band owns the control, the lane's icon rail still offers the same three —
 * and two hydration roots naming one vocabulary in two places is how a label drifts. Only the words
 * are shared; each region keeps whatever glyph it draws them with.
 */
export const CALENDAR_VIEWS: readonly { value: CalendarViewMode; label: string }[] = [
	{ value: "day", label: "Day" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
];

/**
 * Restore the reader's last view choice, and remember the current one.
 *
 * The APP owns this, not the engine. `/calendar` hoists the view switch into the lane footer and the
 * header band, so it drives the engine through its `view` prop — and an engine that also restored a
 * view from its own `storageKey` would be a second owner writing over the first on the very next
 * effect. So the engine persists only the zoom it still owns, and the choice lives here.
 *
 * Client only, and deliberately not read at module scope: this module is imported during SSR, where
 * `localStorage` does not exist and where module state is shared across every request in the
 * process — seeding a shared signal from one reader's storage would hand it to the next.
 */
export function restoreCalendarView(): void {
	if (typeof localStorage === "undefined") return;
	try {
		const stored = localStorage.getItem(LocalKeys.CALENDAR_VIEW);
		if (stored === "day" || stored === "week" || stored === "month") calendarView.value = stored;
	} catch { /* storage unavailable — the default view is a fine answer */ }
}

/** Remember the current view for the next visit. Never throws: a full quota is not an error here. */
export function persistCalendarView(view: CalendarViewMode): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(LocalKeys.CALENDAR_VIEW, view);
	} catch { /* no-op */ }
}

/** The focused instant. Written by the mini-month, the header's trail, and the grid's own scroll. */
export const calendarFocus = signal<number>(CALENDAR_REFERENCE);

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
	if (view === "month") return calendarTime.fmtMonthYear(focusMs, tz);
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

/** Whether any narrowing is engaged — drives the filter control's engaged state. */
export function filtersEngaged(): boolean {
	return hiddenSources.value.length > 0 || hiddenKinds.value.length > 0;
}

/**
 * The events a surface should draw, after search and both deny lists.
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
	return events.filter((e) => {
		if (kinds.includes(e.kind)) return false;
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

// #region Overlays the bands open
/** The unified Connect-a-calendar consent modal. */
export const connectOpen = signal(false);

/** The `.ics` import modal. */
export const importOpen = signal(false);

/** The availability configuration modal (working hours · call windows · booked leave). */
export const availabilityOpen = signal(false);

/**
 * A create request raised by a BAND.
 *
 * The event modal is mounted by the body island — it is the only region that holds the page's
 * timezone, the viewer's access and the modal stack — so "＋ New event" in the footer rig (and its
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
 * Entries read out of an uploaded `.ics`, held CLIENT-SIDE only.
 *
 * They are not posted anywhere: persisting an import needs the `scheduling.*` write path, which is
 * still behind the backend gate. Keeping them in a signal beside the fetched page means the grid can
 * draw them immediately and honestly — they carry the `ics` source mark, so nothing on screen claims
 * they are synced with anything.
 */
export const importedEvents = signal<readonly CalendarEvent[]>([]);
// #endregion
