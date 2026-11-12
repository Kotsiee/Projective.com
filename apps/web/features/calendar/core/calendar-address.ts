import { z } from "zod";
import { dateInZone, EntryClass, IsoDate, zonedSpan } from "@projective/types/scheduling";
import { viewSpan } from "@ui/calendar/core/coverage.ts";
import type { CalendarViewMode } from "@ui/calendar/core/types.ts";
import {
	stopAt,
	TIMELINE_STOPS,
	timelinePxPerDayAt,
	timelineZoomFor,
	type ZoomStop,
} from "@ui/calendar/core/zoom.ts";
import { VIEW_PARAM } from "./availability-view.ts";

/**
 * calendar-address — what a calendar is looking at, as an address (Decision #338 ruling P7, #413):
 * `?view=&date=&zoom=&kind=`, read by the SSR controller so the first byte paints the asked-for
 * period, and written back by the island with `replaceState` so a reload or a shared link lands on
 * it. `localStorage` stays the reader's own default, used only where the address names nothing.
 *
 * - `view` — `day · week · month · timeline` (`CalendarViewMode`). On `/calendar` the same parameter
 *   also names the hub's page (#376): `availability` is the templates page, and `events` is accepted
 *   as the bare agenda.
 * - `date` — the day the calendar opens on, `YYYY-MM-DD`, in the page's own zone.
 * - `zoom` — the Timeline's stop, `year · quarter · month · week · day` (`ZoomStop`), beside
 *   `view=timeline` only: on Day, Week and Month the view IS the stop.
 * - `kind` — `event · reminder` (`EntryClass`, Decision #388), on `/calendar` only, where that filter
 *   lives.
 *
 * A value the calendar does not answer is dropped by a 303 to the canonical address, never read as a
 * default (#413). Pure: no DOM, no signals, no clock.
 */

// #region Vocabulary
export const DATE_PARAM = "date";
export const ZOOM_PARAM = "zoom";
export const KIND_PARAM = "kind";

/** The parameters this module owns; every other one passes through untouched. */
const OWNED = [VIEW_PARAM, DATE_PARAM, ZOOM_PARAM, KIND_PARAM] as const;

/** Which calendar an address belongs to. Each answers a different set of values. */
export type CalendarAddressSurface = "personal" | "project" | "schedule";

/** The grid views, as an address spells them. */
export const CalendarViewParam = z.enum(["day", "week", "month", "timeline"]);

/** The Timeline's stops, as an address spells them (`TIMELINE_STOPS`, pinned by the test). */
export const TimelineStopParam = z.enum(
	["year", "quarter", "month", "week", "day"] as const satisfies readonly ZoomStop[],
);

/**
 * The day an address opens on: a real date with a four-digit year after the epoch. The axis itself is
 * anchored wherever it mounts, so the bound is only what an instant can name without a sign or a
 * fifth digit.
 */
export const CalendarDateParam = IsoDate.refine(
	(d) => d >= "1970-01-01" && d <= "9999-12-31",
	"That date is outside the calendar.",
);

/** What an address asks a calendar to show. A field it does not name is the reader's default. */
export interface CalendarAddress {
	view?: CalendarViewMode;
	date?: IsoDate;
	/** The Timeline's stop; only ever set beside `view: "timeline"`. */
	zoom?: ZoomStop;
	/** Only what is shown of Event · Reminder; only on `/calendar`. */
	kind?: EntryClass;
}

/** The `/calendar` page values that share `view` with the grid views (Decision #376). */
const HUB_PAGE_VIEWS = { events: "events", availability: "availability" } as const;
// #endregion

// #region Reading
/** An address read from a request, and where to send it when it was not canonical. */
export interface CalendarAddressRead {
	address: CalendarAddress;
	/**
	 * The canonical `pathname?search` to answer 303 with, when the request named a value this
	 * calendar does not answer or named a parameter twice; `null` when it is already canonical.
	 */
	redirect: string | null;
}

/**
 * Read the address a request names on one calendar.
 *
 * Every owned parameter is read once. A value that does not parse, a parameter given twice, a `zoom`
 * beside anything but the Timeline, a `kind` off `/calendar`, and any grid parameter on the
 * availability page are each DROPPED — the request is answered with {@link CalendarAddressRead.redirect}
 * rather than read as a default, so an address only ever means one thing.
 */
export function readCalendarAddress(
	url: URL,
	surface: CalendarAddressSurface,
): CalendarAddressRead {
	const params = url.searchParams;
	const address: CalendarAddress = {};
	let dropped = false;
	const one = (key: string): string | null => {
		const all = params.getAll(key);
		if (all.length > 1) dropped = true;
		return all[0] ?? null;
	};

	const view = one(VIEW_PARAM);
	const studio = surface === "personal" && view === HUB_PAGE_VIEWS.availability;
	const bare = surface === "personal" && view === HUB_PAGE_VIEWS.events;
	let keptView: string | null = studio || bare ? view : null;
	if (view !== null && !studio && !bare) {
		const parsed = CalendarViewParam.safeParse(view);
		if (parsed.success) {
			address.view = parsed.data;
			keptView = parsed.data;
		} else dropped = true;
	}

	const date = one(DATE_PARAM);
	if (date !== null) {
		const parsed = CalendarDateParam.safeParse(date);
		if (parsed.success && !studio) address.date = parsed.data;
		else dropped = true;
	}

	const zoom = one(ZOOM_PARAM);
	if (zoom !== null) {
		const parsed = TimelineStopParam.safeParse(zoom);
		if (parsed.success && address.view === "timeline") address.zoom = parsed.data;
		else dropped = true;
	}

	const kind = one(KIND_PARAM);
	if (kind !== null) {
		const parsed = EntryClass.safeParse(kind);
		if (parsed.success && surface === "personal" && !studio) address.kind = parsed.data;
		else dropped = true;
	}

	if (!dropped) return { address, redirect: null };
	const canonicalView = keptView && keptView !== HUB_PAGE_VIEWS.events ? keptView : undefined;
	return {
		address,
		redirect: rewrite(url.pathname, url.search, { ...valuesOf(address), view: canonicalView }),
	};
}
// #endregion

// #region Writing
/**
 * The address of `address` on the page at `pathname`. Every parameter it does not own (`?event=`,
 * `?routine=`, `?filter=` …) is kept, and every one it does keeps its place; a field left out is
 * dropped, so the reader's default answers it.
 */
export function calendarAddressHref(
	pathname: string,
	search: string,
	address: CalendarAddress,
): string {
	return rewrite(pathname, search, valuesOf(address));
}

type OwnedParam = typeof OWNED[number];

function isOwned(key: string): key is OwnedParam {
	return (OWNED as readonly string[]).includes(key);
}

function valuesOf(address: CalendarAddress): Partial<Record<OwnedParam, string>> {
	return {
		[VIEW_PARAM]: address.view,
		[DATE_PARAM]: address.date,
		[ZOOM_PARAM]: address.view === "timeline" ? address.zoom : undefined,
		[KIND_PARAM]: address.kind,
	};
}

/** `search` with each owned parameter set to `values` in its first place, or appended, or dropped. */
function rewrite(
	pathname: string,
	search: string,
	values: Partial<Record<OwnedParam, string>>,
): string {
	const out = new URLSearchParams();
	const written = new Set<string>();
	for (const [key, value] of new URLSearchParams(search)) {
		if (!isOwned(key)) {
			out.append(key, value);
			continue;
		}
		const next = values[key];
		if (next && !written.has(key)) out.append(key, next);
		written.add(key);
	}
	for (const key of OWNED) {
		const next = values[key];
		if (next && !written.has(key)) out.append(key, next);
	}
	const qs = out.toString();
	return qs ? `${pathname}?${qs}` : pathname;
}
// #endregion

// #region Translating
/** The instant a `date` opens on: its midday in `tz`, so no zone offset carries it into a neighbour. */
export function dateFocus(date: IsoDate, tz: string): number {
	return zonedSpan(date, 12 * 60, 12 * 60, tz).startsAt;
}

/** The day `ms` falls on in `tz`, as an address spells it. */
export function focusDate(ms: number, tz: string): IsoDate {
	return dateInZone(ms, tz);
}

/** The Timeline scale (px per day) a stop opens at: the middle of its zone on the ruler. */
export function timelineScaleOf(stop: ZoomStop): number {
	const i = Math.max(0, TIMELINE_STOPS.indexOf(stop));
	return timelinePxPerDayAt((i + 0.5) / TIMELINE_STOPS.length);
}

/** The stop a Timeline scale sits in. */
export function timelineStopOf(pxPerDay: number): ZoomStop {
	return stopAt("timeline", timelineZoomFor(pxPerDay));
}

/** The Event · Reminder deny list `kind` stands for: the other one hidden, or nothing. */
export function hiddenClassesFor(kind: EntryClass | undefined): EntryClass[] {
	if (!kind) return [];
	return EntryClass.options.filter((c) => c !== kind);
}

/** The `kind` a deny list stands for: the one left shown, when exactly one is. */
export function kindOfHidden(hidden: readonly EntryClass[]): EntryClass | undefined {
	const shown = EntryClass.options.filter((c) => !hidden.includes(c));
	return shown.length === 1 ? shown[0] : undefined;
}
// #endregion

// #region Following the reader
/** What a calendar is showing right now. */
export interface CalendarViewState {
	view: CalendarViewMode;
	/** The focused instant. */
	focus: number;
	/** The Timeline's scale, px per day. */
	timelineScale: number;
	/** What is shown of Event · Reminder, on `/calendar`; `undefined` elsewhere and when both are. */
	kind?: EntryClass;
}

/** What the calendar opened on, after the reader's stored defaults were applied. */
export interface CalendarOpening {
	view: CalendarViewMode;
	/** The instant it opened focused on: the address's day, else the page's `now`. */
	focus: number;
	timelineStop: ZoomStop;
}

/**
 * The address to write for `state`, given the one the URL holds now.
 *
 * Nothing is written until the reader moves: a parameter the URL lacks is added only once the state
 * differs from what the calendar opened on, so arriving on the bare `/calendar` leaves it bare. The
 * day is compared by PERIOD rather than by instant, because a view reports its own idea of the focus
 * as it settles (a Week reports its Monday) and that is not the reader going anywhere.
 */
export function nextCalendarAddress(
	current: CalendarAddress,
	state: CalendarViewState,
	opened: CalendarOpening,
	tz: string,
): CalendarAddress {
	const span = viewSpan(state.view, state.focus, tz);
	const held = current.date ? dateFocus(current.date, tz) : opened.focus;
	const stayed = span.start <= held && held < span.end;
	const stop = timelineStopOf(state.timelineScale);
	const timeline = state.view === "timeline";
	return {
		view: current.view || state.view !== opened.view ? state.view : undefined,
		date: stayed ? current.date : focusDate(state.focus, tz),
		zoom: timeline && (current.zoom || stop !== opened.timelineStop) ? stop : undefined,
		kind: state.kind,
	};
}
// #endregion
