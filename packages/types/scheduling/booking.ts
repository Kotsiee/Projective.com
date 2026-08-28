import { z } from "zod";
import { CallRefusalReason } from "./calls.ts";

/**
 * scheduling.booking — the **bookable slot grid**: the projection behind the date rail and the slot
 * picker on a session listing's Book modal, and behind the discovery-call handshake.
 *
 * It is the read side of `scheduling.availability_rules` (`kind = 'call_window'`) filtered through
 * `scheduling.fn_slot_is_free()`, flattened for a picker rather than for a calendar grid: the engine
 * in `@projective/ui/calendar` draws a continuous time axis, while a booker is choosing from a short
 * enumerated list, and forcing one into the other's shape would mean the picker had to re-derive
 * which of the drawn minutes were actually offerable.
 *
 * # Timezones
 *
 * **Every instant here is absolute epoch milliseconds, and the grid carries both zone names.** That
 * is the whole timezone strategy, and it is deliberate: an absolute instant is unambiguous, so the
 * client formats it with `Intl.DateTimeFormat(..., { timeZone })` in the VIEWER's zone and the server
 * never ships a wall-clock string that has to be re-interpreted. The one thing the server must be
 * told is which zone to group DAYS by — a buyer picks "Tuesday the 3rd" in their own calendar, and a
 * slot at 23:30 in the provider's zone may be the next morning in theirs — so
 * {@link SlotQuerySchema} carries the viewer's IANA id and the days come back already bucketed in it.
 *
 * Pure and client-safe: no clock, no DOM, no `Date.now()`. Every function takes the instant it needs.
 */

// #region Slot
/**
 * Why a slot in the grid cannot be taken.
 *
 * The grid returns unavailable slots rather than omitting them, so the rail can show a day as HAVING
 * times that are all spoken for — which is a different fact from a day the provider does not work,
 * and a picker that silently drops both teaches a buyer that the provider is simply never free.
 *
 * Re-uses {@link CallRefusalReason} verbatim for the rules the in-DB gate already names, so the
 * picker's pre-flight check and `scheduling.fn_call_request_refusal` cannot drift into two
 * vocabularies for one refusal. `taken` / `blackout` / `past` are grid-only additions: that function
 * answers about ONE proposed slot, and none of the three is a reason it can return.
 */
export const SlotUnavailableReason = z.union([
	CallRefusalReason,
	z.enum(["taken", "blackout", "past"]),
]);
export type SlotUnavailableReason = z.infer<typeof SlotUnavailableReason>;

/** One offerable start time. */
export const BookableSlotSchema = z.object({
	/** Stable id, unique within the grid — what a selection sends back. */
	id: z.string().min(1).max(80),
	/** Absolute start, epoch ms. */
	startsAt: z.number().int(),
	/** Absolute end, epoch ms. Always `startsAt + durationMinutes * 60_000`. */
	endsAt: z.number().int(),
	/** Whether it can be taken right now. */
	available: z.boolean(),
	/** Why not. `null` whenever `available` is true. */
	reason: SlotUnavailableReason.nullable(),
	/**
	 * Seats left, for a cohort occurrence. `null` for a 1-on-1 slot, which is binary — and `null`
	 * rather than `1`, because "one seat" and "not a seated thing" render differently and a picker
	 * that conflated them would print "1 spot left" on every private booking.
	 */
	seatsRemaining: z.number().int().min(0).nullable(),
});
export type BookableSlot = z.infer<typeof BookableSlotSchema>;
// #endregion

// #region Rail
/**
 * One day on the horizontal date rail.
 *
 * The labels are NOT pre-formatted here. `dayOfMonth` / `weekday` / `month` are the numeric facts and
 * the client formats them, because the rail's labels are the one part of this projection that must
 * follow the viewer's LOCALE as well as their zone, and a locale is a browser fact the server is only
 * ever guessing at. The day BUCKET is server-decided (it needs the zone); its rendering is not.
 */
export const RailDaySchema = z.object({
	/** `YYYY-MM-DD` in the viewer's zone — the key {@link SlotGridSchema} buckets slots by. */
	key: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	/** Midnight of this day in the viewer's zone, epoch ms — what the client formats from. */
	startsAt: z.number().int(),
	/** 1–31. */
	dayOfMonth: z.number().int().min(1).max(31),
	/** 0 = Sunday … 6 = Saturday, in the viewer's zone. */
	weekday: z.number().int().min(0).max(6),
	/** 0 = January … 11 = December, in the viewer's zone. Drives the sticky month label. */
	month: z.number().int().min(0).max(11),
	year: z.number().int(),
	/** Today in the viewer's zone. */
	isToday: z.boolean(),
	/** How many of this day's slots can actually be taken. `0` renders the day as unselectable. */
	openCount: z.number().int().min(0),
	/** How many slots exist at all — `openCount < totalCount` means "offered, but spoken for". */
	totalCount: z.number().int().min(0),
});
export type RailDay = z.infer<typeof RailDaySchema>;
// #endregion

// #region Grid
/** What the grid is being drawn for — the picker adjusts its copy, never its mechanics. */
export const SlotPurpose = z.enum(["session", "set_session", "cohort", "discovery_call"]);
export type SlotPurpose = z.infer<typeof SlotPurpose>;

/**
 * The complete picker projection: a window of days, and the slots inside each.
 *
 * `slots` is keyed by the day's own `key` rather than parallel-indexed to `days`, so a rail paged
 * forward without refetching cannot silently address the wrong day's times.
 */
export const SlotGridSchema = z.object({
	purpose: SlotPurpose,
	/** The listing (or `@handle`, for a discovery call) the grid belongs to. */
	subjectId: z.string().min(1).max(160),
	/** The provider's own IANA zone — the zone their availability rules are written in. */
	providerTimezone: z.string().max(60),
	/** The zone days are bucketed in and times should be rendered in. Echoed from the query. */
	viewerTimezone: z.string().max(60),
	/** Each slot's length, derived from the provider's service settings — never buyer-chosen. */
	durationMinutes: z.number().int().min(5).max(600),
	/**
	 * How many sessions this booking commits to. `1` for everything except a set-session block, where
	 * it is the block size and the picker schedules only the FIRST.
	 */
	sessionCount: z.number().int().min(1).max(52),
	/** The rail, ascending. Contiguous — a day with no slots is present with `openCount: 0`. */
	days: z.array(RailDaySchema),
	/** Day key → that day's slots, ascending. A day with none is absent rather than an empty array. */
	slots: z.record(z.string(), z.array(BookableSlotSchema)),
	/** The first instant the rail can page BACK to (the minimum-notice floor). */
	windowStart: z.number().int(),
	/** The last instant the rail can page FORWARD to (the booking horizon). */
	windowEnd: z.number().int(),
	/** True when the provider takes no bookings at all — the picker renders a reason, not an empty rail. */
	closed: z.boolean(),
	/** Why it is closed, when it is. */
	closedReason: z.string().max(200).nullable(),
});
export type SlotGrid = z.infer<typeof SlotGridSchema>;
// #endregion

// #region Query
/** Params for a slot read. */
export const SlotQuerySchema = z.object({
	/** The listing id, or the `@handle` (without the `@`) for a discovery call. */
	subjectId: z.string().min(1).max(160),
	purpose: SlotPurpose,
	/**
	 * The viewer's IANA zone. Optional, and the server falls back to the provider's — which is honest
	 * rather than convenient: a grid bucketed in the provider's zone and LABELLED as such is usable,
	 * where one bucketed in a guessed zone is wrong in a way nobody can see.
	 */
	timezone: z.string().max(60).optional(),
	/** The first day to draw, epoch ms. Defaults to the minimum-notice floor. */
	from: z.number().int().optional(),
	/** How many days the rail spans. The rail is infinite by paging, not by one enormous read. */
	days: z.number().int().min(1).max(60).default(14),
});
export type SlotQuery = z.infer<typeof SlotQuerySchema>;
// #endregion

// #region Pure helpers
/**
 * The `YYYY-MM-DD` key an instant falls on in a given zone.
 *
 * Uses `en-CA`, whose short date format IS ISO `YYYY-MM-DD`, rather than assembling parts by hand —
 * fewer places for a month to go zero-based. A zone the runtime rejects throws `RangeError`, so this
 * falls back to UTC rather than propagating: a grid drawn in the wrong zone is a bug, and a grid that
 * throws inside a render body removes the picker and everything under it.
 */
export function dayKeyInZone(instant: number, timeZone: string): string {
	try {
		return new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(new Date(instant));
	} catch {
		return new Date(instant).toISOString().slice(0, 10);
	}
}

/** The calendar parts of an instant in a zone — the numeric facts a rail day carries. */
export interface ZonedDayParts {
	year: number;
	/** 0-based, matching `Date#getMonth`. */
	month: number;
	dayOfMonth: number;
	/** 0 = Sunday, matching `Date#getDay`. */
	weekday: number;
	hour: number;
	minute: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
};

/**
 * Decompose an instant into its calendar parts in a zone.
 *
 * `formatToParts` rather than arithmetic on a shifted `Date`: the shift trick is off by an hour twice
 * a year in every zone that observes DST, which on a booking surface means the wrong DAY for one slot
 * per transition — rare enough to survive testing and expensive enough to matter.
 *
 * Total: an unknown zone falls back to UTC parts rather than throwing, for the same reason as above.
 */
export function zonedParts(instant: number, timeZone: string): ZonedDayParts {
	let parts: Record<string, string> = {};
	try {
		const fmt = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		for (const p of fmt.formatToParts(new Date(instant))) parts[p.type] = p.value;
	} catch {
		parts = {};
	}
	if (!parts.year) {
		const d = new Date(instant);
		return {
			year: d.getUTCFullYear(),
			month: d.getUTCMonth(),
			dayOfMonth: d.getUTCDate(),
			weekday: d.getUTCDay(),
			hour: d.getUTCHours(),
			minute: d.getUTCMinutes(),
		};
	}
	return {
		year: Number(parts.year),
		month: Number(parts.month) - 1,
		dayOfMonth: Number(parts.day),
		weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
		hour: Number(parts.hour),
		minute: Number(parts.minute),
	};
}

/**
 * The UTC offset of a zone at an instant, in minutes (positive east of Greenwich).
 *
 * Derived by formatting the instant in the target zone, re-reading those wall-clock parts AS UTC, and
 * differencing. That is exact at any instant, including inside a DST transition, because both sides
 * are computed from the same instant rather than from a nominal rule.
 */
export function zoneOffsetMinutes(instant: number, timeZone: string): number {
	const p = zonedParts(instant, timeZone);
	const asUtc = Date.UTC(p.year, p.month, p.dayOfMonth, p.hour, p.minute);
	// Floor the source to the minute: the parts above discarded its seconds, so differencing the raw
	// instant would report an offset a fraction of a minute off and round unpredictably.
	return Math.round((asUtc - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

/**
 * The instant local midnight falls at, for the day containing `instant` in `timeZone`.
 *
 * Solved by subtracting the zone's offset from the UTC midnight of its local date, then correcting
 * once using the offset AT that result. The second pass is what makes DST-transition days right: on a
 * spring-forward date the first estimate lands an hour before local midnight, and a rail whose day
 * started an hour early would silently attribute the previous day's last slot to it.
 */
export function zonedMidnight(instant: number, timeZone: string): number {
	const p = zonedParts(instant, timeZone);
	const naive = Date.UTC(p.year, p.month, p.dayOfMonth, 0, 0, 0, 0);
	const firstPass = naive - zoneOffsetMinutes(instant, timeZone) * 60_000;
	return naive - zoneOffsetMinutes(firstPass, timeZone) * 60_000;
}

/**
 * Local midnight `n` calendar days from the day containing `instant`, in `timeZone`.
 *
 * **Not `instant + n * 86_400_000`, and that distinction is the whole reason this exists.** A calendar
 * day is not always 24 hours: on a fall-back date it is 25, so adding a fixed day from local midnight
 * lands back inside the SAME day — which on a date rail renders that day twice, collides its key in
 * the slot map, and silently drops the last day of the window. (A spring-forward day is 23 hours and
 * happens to survive the naive version, which is exactly why the bug ships: half the transitions look
 * fine.)
 *
 * Resolved on the CALENDAR instead — increment the day number and re-resolve local midnight — so the
 * step is one day by definition rather than by arithmetic that is right most of the year.
 */
export function addDaysInZone(instant: number, n: number, timeZone: string): number {
	const p = zonedParts(instant, timeZone);
	// `Date.UTC` normalises an out-of-range day into the next month or year, so no rollover logic here.
	const naive = Date.UTC(p.year, p.month, p.dayOfMonth + n, 0, 0, 0, 0);
	const firstPass = naive - zoneOffsetMinutes(instant, timeZone) * 60_000;
	return naive - zoneOffsetMinutes(firstPass, timeZone) * 60_000;
}

/** Whether two instants land on the same calendar day in a zone. */
export function sameDayInZone(a: number, b: number, timeZone: string): boolean {
	return dayKeyInZone(a, timeZone) === dayKeyInZone(b, timeZone);
}

/**
 * The slots of one day, or an empty array.
 *
 * A helper rather than an inline `grid.slots[key] ?? []` at each call site: a `Record` lookup that
 * forgets the fallback is a runtime `undefined.map`, and this is a surface where that takes out the
 * picker rather than degrading it.
 */
export function slotsForDay(grid: SlotGrid, key: string): readonly BookableSlot[] {
	return grid.slots[key] ?? [];
}

/** The first day on the rail carrying an available slot, or `null` when none does. */
export function firstOpenDay(grid: SlotGrid): RailDay | null {
	return grid.days.find((d) => d.openCount > 0) ?? null;
}

/** Find a slot anywhere in the grid by id. `null` when the id is not on the current window. */
export function findSlot(grid: SlotGrid, slotId: string): BookableSlot | null {
	for (const day of grid.days) {
		const hit = slotsForDay(grid, day.key).find((s) => s.id === slotId);
		if (hit) return hit;
	}
	return null;
}
// #endregion
