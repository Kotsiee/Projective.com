/**
 * @projective/ui/gantt — the TIME SCALE: the pure arithmetic that turns an instant into a pixel and a
 * pixel back into an instant, the tiered header vocabulary (Years → Quarters/Months → Weeks → Days →
 * Hours) a zoom moves through, and the tick generators the DOM header draws from.
 *
 * THE AXIS IS LINEAR TIME. `x = (ms − origin) / DAY × pxPerDay`, with no per-day correction — so a
 * 25-hour fall-back day is genuinely 25/24 wider than its neighbours, which is the honest shape of a
 * continuous axis. What makes the header DST-correct is that every tick is placed at a REAL zoned
 * boundary through the calendar engine's own matrix (`startOfDay`, `addZonedDays`, `zonedTimeToMs`)
 * rather than by adding a fixed number of milliseconds; a fixed step lands inside the same day twice
 * a year, and one of those days duplicates a tick key.
 *
 * Everything here is pure — no DOM, no signals, no clock — because a scale whose rounding is subtly
 * wrong does not throw and does not look broken: it looks like a zoom that drifts. The tests pin the
 * round trips and the anchor invariance directly.
 */
import {
	addZonedDays,
	addZonedMonths,
	DAY,
	fmtDayLabel,
	fmtHourLabel,
	HOUR,
	MIN,
	startOfDay,
	startOfWeek,
	zonedParts,
	zonedTimeToMs,
	zonedWeekday,
} from "../../calendar/core/time.ts";

// #region Zoom bounds
/**
 * The shallowest zoom (px per day). At 0.6 a year is ~219px — a decade fits a laptop, which is as
 * far out as a delivery timeline ever needs to read.
 */
export const PX_PER_DAY_MIN = 0.6;
/** The deepest zoom (px per day). At 2400 an hour is 100px — a sitting reads as a sitting. */
export const PX_PER_DAY_MAX = 2400;
/** The zoom a fresh timeline opens at: a fortnight across a ~700px viewport, days labelled. */
export const PX_PER_DAY_DEFAULT = 44;
/** One wheel notch's scale factor. Small enough that a trackpad burst reads as continuous. */
export const ZOOM_STEP = 1.12;
/** The default zoom bounds, as a pair the store and the pinch clamp into. */
export const ZOOM_RANGE_DEFAULT: readonly [number, number] = [PX_PER_DAY_MIN, PX_PER_DAY_MAX];
/**
 * How far (days) the axis may be scrolled either side of its origin — two centuries each way. A
 * bound only so a runaway fling cannot walk the offset out of the range a double keeps exact; a
 * reader never reaches it.
 */
export const AXIS_LIMIT_DAYS = 200 * 366;
// #endregion

// #region Tiers
/** A calendar unit the header labels and the grid rules on. */
export type TimeUnit = "hour" | "day" | "week" | "month" | "quarter" | "year";

/** The two header rows at one zoom, plus the hour stride the bottom row uses when it is hours. */
export interface TimeTier {
	/** The coarse row — the context a bottom cell sits in. */
	top: TimeUnit;
	/** The fine row — what the grid's minor rules are drawn on. */
	bottom: TimeUnit;
	/** Hours between bottom ticks when `bottom === "hour"`; `0` otherwise. */
	hourStep: number;
}

/**
 * The tier for a zoom. Thresholds are chosen so a bottom cell is never narrower than ~26px (the
 * width a two-character label needs) and never wider than the top cell it sits in.
 */
export function tierFor(pxPerDay: number): TimeTier {
	const ppd = Number.isFinite(pxPerDay) ? pxPerDay : PX_PER_DAY_DEFAULT;
	if (ppd >= 1600) return { top: "day", bottom: "hour", hourStep: 1 };
	if (ppd >= 800) return { top: "day", bottom: "hour", hourStep: 2 };
	if (ppd >= 300) return { top: "day", bottom: "hour", hourStep: 6 };
	if (ppd >= 26) return { top: "month", bottom: "day", hourStep: 0 };
	if (ppd >= 6) return { top: "month", bottom: "week", hourStep: 0 };
	if (ppd >= 1.5) return { top: "year", bottom: "month", hourStep: 0 };
	return { top: "year", bottom: "quarter", hourStep: 0 };
}

/** The rank of a unit's grain — smaller is finer. Used to assert the tiers only ever get finer. */
export const UNIT_RANK: Record<TimeUnit, number> = {
	hour: 0,
	day: 1,
	week: 2,
	month: 3,
	quarter: 4,
	year: 5,
};

/** The approximate width of one unit, in days — what the header sizes a cell's label budget from. */
export function unitDays(unit: TimeUnit, hourStep = 1): number {
	switch (unit) {
		case "hour":
			return Math.max(1, hourStep) / 24;
		case "day":
			return 1;
		case "week":
			return 7;
		case "month":
			return 30.44;
		case "quarter":
			return 91.31;
		case "year":
			return 365.25;
	}
}
// #endregion

// #region Time ⇄ pixels
/** Content-space x (px) of an instant, at an explicit origin and zoom. */
export function xOfMs(ms: number, originMs: number, pxPerDay: number): number {
	return ((ms - originMs) / DAY) * pxPerDay;
}

/** The instant at content-space x, at an explicit origin and zoom. */
export function msAtX(x: number, originMs: number, pxPerDay: number): number {
	return originMs + (x / pxPerDay) * DAY;
}

/** Hold a zoom inside its bounds; a non-finite request lands on the default. */
export function clampZoom(
	pxPerDay: number,
	range: readonly [number, number] = ZOOM_RANGE_DEFAULT,
): number {
	if (!Number.isFinite(pxPerDay)) return PX_PER_DAY_DEFAULT;
	return Math.min(range[1], Math.max(range[0], pxPerDay));
}

/**
 * The scroll offset that keeps `anchorMs` under viewport x `anchorViewX` at a NEW zoom.
 *
 * Solved in closed form from the instant captured when the gesture began, never re-derived from the
 * offset the previous step produced: re-deriving feeds each step's rounding into the next, and a
 * ten-notch wheel burst walks the timestamp out from under the cursor a fraction at a time.
 */
export function zoomedScrollX(
	anchorMs: number,
	anchorViewX: number,
	originMs: number,
	nextPxPerDay: number,
): number {
	return xOfMs(anchorMs, originMs, nextPxPerDay) - anchorViewX;
}

/** How many days a viewport of `viewportW` px shows at a zoom. */
export function daysVisible(viewportW: number, pxPerDay: number): number {
	return pxPerDay > 0 ? viewportW / pxPerDay : 0;
}

/**
 * The zoom at which `range` fills `viewportW` less `padFrac` of it each side — the "fit to project"
 * control. A zero-length range fits as if it were one day, so a lone milestone still lands.
 */
export function fitZoom(
	range: { start: number; end: number },
	viewportW: number,
	padFrac = 0.08,
	zoomRange: readonly [number, number] = ZOOM_RANGE_DEFAULT,
): number {
	const spanDays = Math.max(1, (range.end - range.start) / DAY);
	const usable = Math.max(1, viewportW * (1 - 2 * Math.max(0, Math.min(0.45, padFrac))));
	return clampZoom(usable / spanDays, zoomRange);
}
// #endregion

// #region Snapping
/**
 * The grain a create/move gesture snaps to at a tier: quarter-hours when hours are labelled, whole
 * days everywhere coarser. A day is snapped to a ZONED midnight (see {@link snapTo}), which is why the
 * value here is a unit rather than a millisecond count.
 */
export function snapUnitFor(tier: TimeTier): { unit: "minute" | "day"; minutes: number } {
	if (tier.bottom !== "hour") return { unit: "day", minutes: 0 };
	if (tier.hourStep <= 1) return { unit: "minute", minutes: 15 };
	if (tier.hourStep <= 2) return { unit: "minute", minutes: 30 };
	return { unit: "minute", minutes: 60 };
}

/**
 * Snap an instant to the tier's grain, in `tz`.
 *
 * Sub-day grains round the raw epoch — every zone's offset is a multiple of fifteen minutes, so a
 * quarter-hour lattice is the same lattice in every zone. A day grain rounds to the NEARER of the two
 * zoned midnights around the instant, which is the only day snap that survives a 23- or 25-hour day.
 */
export function snapTo(ms: number, tier: TimeTier, tz: string): number {
	const grain = snapUnitFor(tier);
	if (grain.unit === "minute") {
		const step = grain.minutes * MIN;
		return Math.round(ms / step) * step;
	}
	const dayStart = startOfDay(ms, tz);
	const nextStart = addZonedDays(dayStart, 1, tz);
	return ms - dayStart < nextStart - ms ? dayStart : nextStart;
}
// #endregion

// #region Ticks
/** One header cell / grid rule. */
export interface TimeTick {
	/** Epoch ms (UTC) of the boundary. */
	ms: number;
	unit: TimeUnit;
	/** The full label ("Thursday, Jul 17" · "July 2026"). */
	label: string;
	/** A shorter form ("Thu 17" · "Jul"). */
	short: string;
	/** The narrowest form ("17" · "J"). */
	narrow: string;
	/** A boundary that is also a boundary of the next unit up (midnight, a month's first, January). */
	major: boolean;
}

/** Hard ceiling on ticks resolved for one call — a degenerate range must not build a million cells. */
export const MAX_TICKS = 600;

const MONTHS_SHORT = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
const MONTHS_LONG = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The zoned boundary of `unit` at or before `ms`. */
export function unitStart(ms: number, unit: TimeUnit, tz: string, hourStep = 1): number {
	const p = zonedParts(ms, tz);
	switch (unit) {
		case "hour": {
			const step = Math.max(1, hourStep);
			const h = Math.floor(p.hour / step) * step;
			return zonedTimeToMs(p.year, p.month, p.day, h, 0, tz);
		}
		case "day":
			return startOfDay(ms, tz);
		case "week":
			return startOfWeek(ms, tz);
		case "month":
			return zonedTimeToMs(p.year, p.month, 1, 0, 0, tz);
		case "quarter":
			return zonedTimeToMs(p.year, Math.floor((p.month - 1) / 3) * 3 + 1, 1, 0, 0, tz);
		case "year":
			return zonedTimeToMs(p.year, 1, 1, 0, 0, tz);
	}
}

/**
 * The boundary AFTER a boundary. Hours step by elapsed time inside a day and re-anchor at midnight,
 * so a stride of six lands on 0/6/12/18 across a DST day rather than drifting an hour.
 */
export function unitNext(boundaryMs: number, unit: TimeUnit, tz: string, hourStep = 1): number {
	switch (unit) {
		case "hour": {
			const step = Math.max(1, hourStep);
			const dayStart = startOfDay(boundaryMs, tz);
			const nextDay = addZonedDays(dayStart, 1, tz);
			const p = zonedParts(boundaryMs, tz);
			const nextHour = p.hour + step;
			const next = nextHour >= 24
				? nextDay
				: zonedTimeToMs(p.year, p.month, p.day, nextHour, 0, tz);
			// A repeated wall-clock hour (fall-back) can resolve to the same instant; move on.
			return next > boundaryMs ? next : nextDay;
		}
		case "day":
			return addZonedDays(boundaryMs, 1, tz);
		case "week":
			return addZonedDays(boundaryMs, 7, tz);
		case "month":
			return addZonedMonths(boundaryMs, 1, tz);
		case "quarter":
			return addZonedMonths(boundaryMs, 3, tz);
		case "year":
			return addZonedMonths(boundaryMs, 12, tz);
	}
}

function labelsFor(
	ms: number,
	unit: TimeUnit,
	tz: string,
	hour12: boolean,
): Pick<TimeTick, "label" | "short" | "narrow" | "major"> {
	const p = zonedParts(ms, tz);
	switch (unit) {
		case "hour": {
			const full = fmtHourLabel(p.hour, hour12);
			const h12 = p.hour % 12 || 12;
			return {
				label: full,
				short: hour12 ? `${h12}${p.hour < 12 ? "a" : "p"}` : `${p.hour}`,
				narrow: hour12 ? `${h12}` : `${p.hour}`,
				major: p.hour === 0,
			};
		}
		case "day":
			return {
				label: fmtDayLabel(ms, tz),
				short: `${WEEKDAYS_SHORT[zonedWeekday(ms, tz)]} ${p.day}`,
				narrow: `${p.day}`,
				major: p.day === 1,
			};
		case "week": {
			// The week HOLDING a month's first day opens that month's context: either it starts on the
			// 1st, or the month changes somewhere inside its seven days.
			const weekEnd = zonedParts(addZonedDays(ms, 6, tz), tz);
			return {
				label: `${MONTHS_SHORT[p.month - 1]} ${p.day}`,
				short: `${p.day}`,
				narrow: `${p.day}`,
				major: p.day === 1 || weekEnd.month !== p.month,
			};
		}
		case "month":
			return {
				label: `${MONTHS_LONG[p.month - 1]} ${p.year}`,
				short: MONTHS_SHORT[p.month - 1],
				narrow: MONTHS_SHORT[p.month - 1].charAt(0),
				major: p.month === 1,
			};
		case "quarter": {
			const q = Math.floor((p.month - 1) / 3) + 1;
			return { label: `Q${q} ${p.year}`, short: `Q${q}`, narrow: `Q${q}`, major: q === 1 };
		}
		case "year":
			return {
				label: `${p.year}`,
				short: `${p.year}`,
				narrow: `'${String(p.year).slice(-2)}`,
				major: true,
			};
	}
}

/**
 * Every `unit` boundary from the one at or before `startMs` up to and including the first one past
 * `endMs` — the extra trailing tick is what lets the header size the last visible cell.
 */
export function ticksFor(
	unit: TimeUnit,
	startMs: number,
	endMs: number,
	tz: string,
	opts: { hourStep?: number; hour12?: boolean } = {},
): TimeTick[] {
	const out: TimeTick[] = [];
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return out;
	const step = opts.hourStep ?? 1;
	let cursor = unitStart(startMs, unit, tz, step);
	while (out.length < MAX_TICKS) {
		out.push({ ms: cursor, unit, ...labelsFor(cursor, unit, tz, opts.hour12 ?? true) });
		if (cursor > endMs) break;
		const next = unitNext(cursor, unit, tz, step);
		if (next <= cursor) break;
		cursor = next;
	}
	return out;
}

/** The Saturday+Sunday spans inside a range, for the weekend wash. Empty when the range is huge. */
export function weekendSpans(
	startMs: number,
	endMs: number,
	tz: string,
): { start: number; end: number }[] {
	const out: { start: number; end: number }[] = [];
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return out;
	// A weekend wash on a five-year axis is thousands of slivers nobody can see; skip past ~a year.
	if (endMs - startMs > 400 * DAY) return out;
	let day = startOfDay(startMs, tz);
	let guard = 0;
	while (day <= endMs && guard++ < MAX_TICKS) {
		const wd = zonedWeekday(day, tz);
		const next = addZonedDays(day, 1, tz);
		if (wd === 0 || wd === 6) {
			const last = out[out.length - 1];
			if (last && last.end === day) last.end = next;
			else out.push({ start: day, end: next });
		}
		day = next;
	}
	return out;
}
// #endregion

// #region Labels
/** A human duration: "45 min" · "3 h 30 min" · "1 day" · "12 days" · "6 wk". */
export function durationLabel(startMs: number, endMs: number): string {
	const span = Math.max(0, endMs - startMs);
	if (span === 0) return "Instant";
	if (span < HOUR) return `${Math.max(1, Math.round(span / MIN))} min`;
	if (span < DAY) {
		const h = Math.floor(span / HOUR);
		const m = Math.round((span - h * HOUR) / MIN);
		return m > 0 ? `${h} h ${m} min` : `${h} h`;
	}
	const days = span / DAY;
	if (days < 14) {
		const rounded = Math.round(days * 2) / 2;
		return rounded === 1 ? "1 day" : `${rounded} days`;
	}
	if (days < 90) return `${Math.round(days / 7)} wk`;
	return `${Math.round(days / 30.44)} mo`;
}
// #endregion
