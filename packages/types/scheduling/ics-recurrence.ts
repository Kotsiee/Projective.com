import { addDays, type IsoDate } from "./civil.ts";
import { expandRRule, parseRRule, RRULE_EXPANSION_CAP } from "./rrule.ts";

/**
 * scheduling.ics-recurrence — the instants one imported repeating entry occurs at.
 *
 * The date engine is the availability engine's own `rrule.ts`, reused rather than re-implemented: it
 * answers "which DATES", and an event series is exactly a date set plus DTSTART's wall-clock time in
 * DTSTART's zone, which the caller supplies as {@link IcsSeries.instantOn}. Expanding over civil dates
 * and resolving each one in the zone is what keeps a 09:00 weekly meeting at 09:00 across a DST change.
 *
 * Two parts that engine refuses by design are handled here, because calendar files use them
 * constantly and both are bookkeeping around the date set rather than new date logic:
 *  - `COUNT` — the first N dates from DTSTART (RFC 5545 §3.3.10), counted before any EXDATE.
 *  - `UNTIL` as a DATE-TIME — the engine bounds by date; the instant is then applied exactly, so an
 *    occurrence later on the UNTIL day than UNTIL itself is excluded.
 *
 * DTSTART is always the first occurrence, whether or not the rule would select it. RFC 5545 leaves an
 * unsynchronised DTSTART undefined, and every mainstream client shows it.
 */

/** One repeating entry, described in the caller's own time model. */
export interface IcsSeries {
	/** The `RRULE` value, RFC 5545 form, without the property name. */
	rule: string;
	/** DTSTART's civil date, read in DTSTART's own zone. */
	startsOn: IsoDate;
	/** DTSTART's wall-clock time on `date`, resolved in DTSTART's zone, as epoch ms. */
	instantOn: (date: IsoDate) => number;
	/** Decode an `UNTIL` value in DTSTART's context: the instant, and its date in DTSTART's zone. */
	until: (raw: string) => { ms: number; date: IsoDate } | null;
	/** The civil dates the caller wants occurrences for, both inclusive. */
	window: { from: IsoDate; to: IsoDate };
}

/** The outcome of {@link expandIcsSeries}. */
export type IcsSeriesExpansion =
	| {
		ok: true;
		/** Occurrence starts inside the window, ascending. */
		starts: number[];
		/** Whether the series has occurrences outside the window that were not returned. */
		clipped: boolean;
	}
	| { ok: false; message: string };

const COUNT_CEILING = 10_000;
const COUNT_HORIZON_DAYS = 36_525;

/** Expand one series into its occurrence starts inside {@link IcsSeries.window}. */
export function expandIcsSeries(series: IcsSeries): IcsSeriesExpansion {
	const kept: string[] = [];
	let count: number | null = null;
	let untilRaw: string | null = null;
	for (const segment of series.rule.trim().replace(/^RRULE:/i, "").split(";")) {
		const eq = segment.indexOf("=");
		const name = (eq > 0 ? segment.slice(0, eq) : segment).trim().toUpperCase();
		const value = eq > 0 ? segment.slice(eq + 1).trim() : "";
		if (name === "COUNT") {
			if (!/^\d{1,9}$/.test(value) || Number(value) < 1) {
				return { ok: false, message: "Its COUNT is not a positive whole number." };
			}
			count = Number(value);
		} else if (name === "UNTIL") untilRaw = value;
		else if (segment.trim()) kept.push(segment.trim());
	}

	const parsed = parseRRule(kept.join(";"));
	if (!parsed.ok) return { ok: false, message: parsed.message };

	const until = untilRaw === null ? null : series.until(untilRaw);
	if (untilRaw !== null && until === null) {
		return { ok: false, message: "Its UNTIL date could not be read." };
	}

	const { startsOn, window } = series;
	const inWindow = (d: IsoDate) => d >= window.from && d <= window.to;
	let dates: IsoDate[];
	let clipped: boolean;

	if (count !== null) {
		const cap = Math.min(count, COUNT_CEILING);
		const to = until?.date ?? addDays(startsOn, COUNT_HORIZON_DAYS);
		dates = expandRRule(parsed.value, startsOn, { from: startsOn, to }, cap);
		if (dates[0] !== startsOn) dates = [startsOn, ...dates].slice(0, cap);
		const all = dates.length;
		dates = dates.filter(inWindow);
		clipped = dates.length < all || count > COUNT_CEILING;
	} else {
		const from = startsOn > window.from ? startsOn : window.from;
		const to = until && until.date < window.to ? until.date : window.to;
		dates = to < from ? [] : expandRRule(parsed.value, startsOn, { from, to }, RRULE_EXPANSION_CAP);
		if (inWindow(startsOn) && dates[0] !== startsOn) dates.unshift(startsOn);
		clipped = startsOn < window.from || !until || until.date > window.to ||
			dates.length >= RRULE_EXPANSION_CAP;
	}

	const starts = dates.map(series.instantOn).filter((ms) => !until || ms <= until.ms);
	return { ok: true, starts, clipped };
}
