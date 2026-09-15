import type { AvailabilityRule } from "@projective/types/scheduling";
import type { ProfileHours } from "../types/profile-types.ts";

/**
 * hours — the pure, clock-injected derivations behind the profile's availability block: the weekly
 * schedule summary ("Mon–Fri · 9:00 AM – 5:30 PM"), the live "Available now ⁄ Away" state with its
 * next boundary, and the local-time readout in the seller's own timezone.
 *
 * Every function takes `now` as a parameter rather than reading the clock, so a test can pin a
 * Tuesday afternoon and a Sunday night, and every string is formatted in ONE fixed locale
 * (`en-US`, 12-hour) so the server's first byte and the island's first client render agree
 * character for character — a locale read from the environment would differ between the two and
 * hand Preact a text mismatch on every profile.
 *
 * Timezone maths goes through `Intl` wall-clock PARTS only (weekday · hour · minute in the seller's
 * zone) — no offset arithmetic, so DST is the engine's problem and not this module's.
 */

// #region Formatting
const LOCALE = "en-US";
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
	hour: "numeric",
	minute: "2-digit",
	hour12: true,
	timeZone: "UTC",
});

/** A minutes-from-midnight value as `9:00 AM` / `5:30 PM` (formatted on a fixed UTC anchor). */
export function minuteLabel(minute: number): string {
	const clamped = Math.max(0, Math.min(1440, Math.round(minute)));
	// 24:00 is the closing edge of the last band; print it as the top of the next day would read.
	const ms = Date.UTC(2026, 0, 4, 0, clamped % 1440);
	return timeFmt.format(new Date(ms));
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(timezone: string): Intl.DateTimeFormat {
	let fmt = partsCache.get(timezone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat(LOCALE, {
			weekday: "short",
			hour: "numeric",
			minute: "2-digit",
			hourCycle: "h23",
			timeZone: timezone,
		});
		partsCache.set(timezone, fmt);
	}
	return fmt;
}

/** The seller-zone wall clock for an instant: weekday index (0 = Sunday) + minutes from midnight. */
export interface WallClock {
	weekday: number;
	minute: number;
}

/**
 * Resolve an instant to the seller's wall clock. An unknown timezone falls back to UTC rather than
 * throwing — a profile with a mistyped zone should render a slightly wrong clock, not no page.
 */
export function wallClockAt(timezone: string, now: number): WallClock {
	let fmt: Intl.DateTimeFormat;
	try {
		fmt = partsFmt(timezone);
	} catch {
		fmt = partsFmt("UTC");
	}
	const parts = fmt.formatToParts(new Date(now));
	const get = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? "";
	const weekday = Math.max(
		0,
		WEEKDAY_SHORT.indexOf(get("weekday") as typeof WEEKDAY_SHORT[number]),
	);
	const hour = Number(get("hour")) % 24;
	const minute = Number(get("minute"));
	return { weekday, minute: hour * 60 + (Number.isFinite(minute) ? minute : 0) };
}

/** `3:45 PM` — the seller's current local time. */
export function localTimeLabel(timezone: string, now: number): string {
	const { minute } = wallClockAt(timezone, now);
	return minuteLabel(minute);
}
// #endregion

// #region Weekly summary
/** One line of the schedule summary: a run of days that share a window, and that window. */
export interface HoursLine {
	/** `Mon–Fri`, `Sat`, or `Mon, Wed, Fri` for a non-contiguous run. */
	days: string;
	/** `9:00 AM – 5:30 PM` — the outer span of that day's bands. */
	times: string;
}

interface DaySpan {
	weekday: number;
	start: number;
	end: number;
}

/** The outer working span per weekday (a lunch gap between two bands is folded into one span). */
function daySpans(rules: readonly AvailabilityRule[]): DaySpan[] {
	const byDay = new Map<number, DaySpan>();
	for (const rule of rules) {
		if ((rule.kind ?? "working_hours") !== "working_hours") continue;
		if (rule.endMinute <= rule.startMinute) continue;
		const span = byDay.get(rule.weekday);
		if (!span) {
			byDay.set(rule.weekday, {
				weekday: rule.weekday,
				start: rule.startMinute,
				end: rule.endMinute,
			});
		} else {
			span.start = Math.min(span.start, rule.startMinute);
			span.end = Math.max(span.end, rule.endMinute);
		}
	}
	// Monday-first, so the summary reads the way a working week is said.
	return [...byDay.values()].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
}

/** `Mon–Fri` for a contiguous run, `Mon, Wed` otherwise, `Sat` alone. */
function dayRunLabel(weekdays: readonly number[]): string {
	if (weekdays.length === 0) return "";
	const names = weekdays.map((d) => WEEKDAY_SHORT[d]);
	if (weekdays.length === 1) return names[0];
	const contiguous = weekdays.every((d, i) => i === 0 || ((weekdays[i - 1] + 1) % 7) === d);
	return contiguous && weekdays.length > 2
		? `${names[0]}–${names[names.length - 1]}`
		: names.join(", ");
}

/**
 * The schedule summary: consecutive days sharing the same outer span collapse into one line, so a
 * standard week prints as `Mon–Fri · 9:00 AM – 5:30 PM` plus `Sat · 10:00 AM – 1:00 PM`. An empty
 * rule set yields no lines — the caller renders nothing rather than "no hours".
 */
export function hoursSummary(rules: readonly AvailabilityRule[]): HoursLine[] {
	const spans = daySpans(rules);
	const lines: HoursLine[] = [];
	let run: number[] = [];
	let current: DaySpan | null = null;
	const flush = () => {
		if (current && run.length) {
			lines.push({
				days: dayRunLabel(run),
				times: `${minuteLabel(current.start)} – ${minuteLabel(current.end)}`,
			});
		}
		run = [];
		current = null;
	};
	for (const span of spans) {
		const same = current && current.start === span.start && current.end === span.end;
		if (!same) flush();
		if (!current) current = span;
		run.push(span.weekday);
	}
	flush();
	return lines;
}
// #endregion

// #region Live state
/** The availability badge: inside a working band right now, or not — and where the next edge is. */
export interface AvailabilityNow {
	available: boolean;
	/**
	 * The next boundary, as a short phrase: `Until 5:30 PM` while available, `Back 9:00 AM` (same
	 * day) or `Back Mon 9:00 AM` while away. `null` when the schedule has no bands at all.
	 */
	nextLabel: string | null;
}

/**
 * Whether the seller is inside a published working band at `now`, in THEIR zone, and the next edge
 * of that state. Looks up to a week ahead for the next opening, so a Saturday-night visitor is told
 * "Back Mon 9:00 AM" rather than nothing.
 */
export function availabilityAt(hours: ProfileHours, now: number): AvailabilityNow {
	const rules = hours.rules.filter((r) => (r.kind ?? "working_hours") === "working_hours");
	if (rules.length === 0) return { available: false, nextLabel: null };
	const clock = wallClockAt(hours.timezone, now);

	const open = rules.filter((r) =>
		r.weekday === clock.weekday && r.startMinute <= clock.minute && clock.minute < r.endMinute
	);
	if (open.length > 0) {
		// The band that closes LAST among those the clock is inside (bands may overlap in the data).
		const end = Math.max(...open.map((r) => r.endMinute));
		return { available: true, nextLabel: `Until ${minuteLabel(end)}` };
	}

	for (let offset = 0; offset <= 7; offset++) {
		const weekday = (clock.weekday + offset) % 7;
		const candidates = rules
			.filter((r) => r.weekday === weekday && (offset > 0 || r.startMinute > clock.minute))
			.sort((a, b) => a.startMinute - b.startMinute);
		const next = candidates[0];
		if (next) {
			const time = minuteLabel(next.startMinute);
			return {
				available: false,
				nextLabel: offset === 0 ? `Back ${time}` : `Back ${WEEKDAY_SHORT[weekday]} ${time}`,
			};
		}
	}
	return { available: false, nextLabel: null };
}
// #endregion
