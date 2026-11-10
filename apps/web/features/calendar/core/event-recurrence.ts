import {
	addDays,
	type CalendarEvent,
	civilParts,
	dateInZone,
	ENTRY_BATCH_MAX,
	entryClassOf,
	expandIcsSeries,
	type IsoDate,
	parseIsoDate,
	parseRRule,
	type RRuleParts,
	serialiseRRule,
	startsInPast,
	wallClockInZone,
	weekdayOf,
	zonedSpan,
} from "@projective/types/scheduling";

/**
 * event-recurrence — the composer's repeat control, as data: the standard cadences, the draft behind
 * them, the RFC 5545 rule a draft serialises to, the sentence that rule reads as, and the occurrences
 * a commit lays onto the grid.
 *
 * The RULE on the working copy (`CalendarEvent.recurrenceRule`) is the one source of truth. The
 * repeat control's fields are READ BACK from it, so they can never disagree about what the entry does.
 *
 * Weekdays here are ISO (1 = Monday … 7 = Sunday); `rrule.ts` and the weekday rail count from
 * Sunday = 0, and the conversion happens only at those boundaries ({@link isoWeekday}).
 */

// #region Model
/** The frequencies the composer offers. */
export type RepeatFreq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** How a series stops. */
export type RepeatEnd =
	| { type: "never" }
	| { type: "until"; date: IsoDate }
	| { type: "count"; count: number };

/** The custom panel's fields. */
export interface RepeatDraft {
	freq: RepeatFreq;
	interval: number;
	/** ISO weekdays, ascending; consulted under WEEKLY only. */
	isoDays: number[];
	end: RepeatEnd;
}

/** The standard cadences a rule is recognised as ({@link presetOf}). */
export const REPEAT_PRESETS = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type RepeatPreset = (typeof REPEAT_PRESETS)[number];

/** What a series is anchored to: DTSTART's civil date in the schedule's zone. */
export interface RepeatAnchor {
	date: IsoDate;
	isoDay: number;
	monthDay: number;
	/** 1 = January. */
	month: number;
}

const NEVER: RepeatEnd = { type: "never" };
const WORKWEEK = [1, 2, 3, 4, 5];

/** An ISO weekday (1 = Monday … 7 = Sunday) for a Sunday = 0 one. */
export function isoWeekday(wd: number): number {
	return wd === 0 ? 7 : wd;
}

/** A Sunday = 0 weekday, the weekday rail's numbering, for an ISO one. */
export function sundayWeekday(iso: number): number {
	return iso % 7;
}

const isoOf = isoWeekday;
const wdOf = sundayWeekday;

/** The anchor of an entry starting at `startMs`, read in `tz`. */
export function repeatAnchor(startMs: number, tz: string): RepeatAnchor {
	const date = dateInZone(startMs, tz);
	const parts = civilParts(date);
	return { date, isoDay: isoOf(weekdayOf(date)), monthDay: parts.day, month: parts.month };
}
// #endregion

// #region Rule
/** The draft a standard cadence stands for. */
export function presetDraft(preset: Exclude<RepeatPreset, "none">, a: RepeatAnchor): RepeatDraft {
	const base = { interval: 1, end: NEVER };
	switch (preset) {
		case "daily":
			return { ...base, freq: "DAILY", isoDays: [] };
		case "weekdays":
			return { ...base, freq: "WEEKLY", isoDays: WORKWEEK };
		case "weekly":
			return { ...base, freq: "WEEKLY", isoDays: [a.isoDay] };
		case "monthly":
			return { ...base, freq: "MONTHLY", isoDays: [] };
	}
}

/** The weekdays a weekly draft repeats on — the anchor's own when none are picked. */
function weeklyDays(d: RepeatDraft, a: RepeatAnchor): number[] {
	return d.isoDays.length ? d.isoDays : [a.isoDay];
}

/**
 * The canonical RFC 5545 rule for a draft. `COUNT` is appended after the canonical parts because the
 * availability parser refuses it by design; the event column and `expandIcsSeries` both accept it.
 */
export function toRRule(d: RepeatDraft, a: RepeatAnchor): string {
	const parts: RRuleParts = {
		freq: d.freq,
		interval: d.interval,
		byDay: d.freq === "WEEKLY"
			? weeklyDays(d, a).map((iso) => ({ wd: wdOf(iso) })).sort((x, y) => x.wd - y.wd)
			: [],
		byMonthDay: d.freq === "MONTHLY" || d.freq === "YEARLY" ? [a.monthDay] : [],
		byMonth: d.freq === "YEARLY" ? [a.month] : [],
		bySetPos: [],
		wkst: 1,
		...(d.end.type === "until" ? { until: d.end.date } : {}),
	};
	const rule = serialiseRRule(parts);
	return d.end.type === "count" ? `${rule};COUNT=${d.end.count}` : rule;
}

/** Read a rule back into the repeat control's fields, or `null` for one the composer cannot author. */
export function fromRRule(rule: string): RepeatDraft | null {
	let count: number | null = null;
	const rest = rule.split(";").filter((seg) => {
		const m = /^COUNT=(\d{1,9})$/i.exec(seg.trim());
		if (m) count = Number(m[1]);
		return !m;
	}).join(";");
	const parsed = parseRRule(rest);
	if (!parsed.ok) return null;
	const p = parsed.value;
	return {
		freq: p.freq,
		interval: p.interval,
		isoDays: p.freq === "YEARLY" ? [] : p.byDay.map((b) => isoOf(b.wd)).sort((x, y) => x - y),
		end: count !== null
			? { type: "count", count }
			: p.until
			? { type: "until", date: p.until }
			: NEVER,
	};
}

/** Which standard cadence a rule is, or `custom` for anything else. */
export function presetOf(rule: string | undefined, a: RepeatAnchor): RepeatPreset | "custom" {
	if (!rule) return "none";
	return REPEAT_PRESETS.find((p) => p !== "none" && toRRule(presetDraft(p, a), a) === rule) ??
		"custom";
}
// #endregion

// #region Sentence
const LOCALE = "en-US";

function weekdayName(iso: number): string {
	// 2024-01-01 was a Monday, so ISO day n is January n.
	return new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: "UTC" })
		.format(new Date(Date.UTC(2024, 0, iso)));
}

function ordinal(n: number): string {
	const suffix = { one: "st", two: "nd", few: "rd", other: "th" }[
		new Intl.PluralRules(LOCALE, { type: "ordinal" }).select(n) as "one" | "two" | "few" | "other"
	];
	return `${n}${suffix}`;
}

function monthDayName(a: RepeatAnchor): string {
	return new Intl.DateTimeFormat(LOCALE, { month: "long", day: "numeric", timeZone: "UTC" })
		.format(new Date(Date.UTC(2024, a.month - 1, a.monthDay)));
}

function every(interval: number, unit: string): string {
	if (interval === 1) return `Every ${unit}`;
	if (interval === 2) return `Every other ${unit}`;
	return `Every ${interval} ${unit}s`;
}

/** The master of the series `event` is an occurrence of, `event` itself if it stands alone. */
export function seriesMasterOf(
	event: CalendarEvent,
	events: readonly CalendarEvent[],
): CalendarEvent | null {
	if (!event.recurrenceParentId) return event;
	return events.find((e) => e.id === event.recurrenceParentId) ?? null;
}

/**
 * How an entry repeats, as one sentence, or `null` when it does not. A connected calendar's rule was not
 * written by the composer: its UNTIL can carry a time, and a "second Tuesday" has no date to name.
 */
export function repeatSentence(
	event: CalendarEvent,
	events: readonly CalendarEvent[],
	tz: string,
): string | null {
	const rule = seriesMasterOf(event, events)?.recurrenceRule;
	if (!rule) return null;
	const draft = /BYDAY=[+-]?\d/i.test(rule)
		? null
		: fromRRule(rule.replace(/(UNTIL=\d{8})T\d{6}Z?/i, "$1"));
	if (draft) return describeRepeat(draft, repeatAnchor(event.start, tz));
	return /^FREQ=YEARLY/i.test(rule)
		? "Every year"
		: /^FREQ=MONTHLY/i.test(rule)
		? "Every month"
		: "Repeats";
}

/** The rule as one sentence: "Every other week on Monday and Thursday, 10 times". */
export function describeRepeat(d: RepeatDraft, a: RepeatAnchor): string {
	let head: string;
	if (d.freq === "DAILY") head = every(d.interval, "day");
	else if (d.freq === "MONTHLY") {
		head = `${d.interval === 1 ? "Monthly" : every(d.interval, "month")} on the ${
			ordinal(a.monthDay)
		}`;
	} else if (d.freq === "YEARLY") {
		head = `${d.interval === 1 ? "Yearly" : every(d.interval, "year")} on ${monthDayName(a)}`;
	} else {
		const days = weeklyDays(d, a);
		const workweek = days.length === 5 && days.every((x, i) => x === WORKWEEK[i]);
		const named = days.length === 7
			? "every day"
			: workweek
			? (d.interval === 1 ? "weekday" : "weekdays")
			: new Intl.ListFormat(LOCALE, { type: "conjunction" }).format(days.map(weekdayName));
		head = d.interval === 1
			? (days.length === 7 ? "Every day" : `Every ${named}`)
			: `${every(d.interval, "week")} on ${named}`;
	}

	if (d.end.type === "count") {
		return `${head}, ${d.end.count === 1 ? "once" : `${d.end.count} times`}`;
	}
	if (d.end.type === "until") {
		const p = civilParts(d.end.date);
		const date = new Intl.DateTimeFormat(LOCALE, {
			month: "short",
			day: "numeric",
			year: "numeric",
			timeZone: "UTC",
		}).format(new Date(Date.UTC(p.year, p.month - 1, p.day)));
		return `${head}, until ${date}`;
	}
	return head;
}
// #endregion

// #region Occurrences
/** How far ahead an open-ended series is laid out: past the batch cap for every cadence offered. */
const SERIES_HORIZON_DAYS = 4 * 366;

function untilDate(raw: string): IsoDate | null {
	const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
	return m ? parseIsoDate(`${m[1]}-${m[2]}-${m[3]}`) : null;
}

/**
 * The entries one commit of a repeating entry lays onto the grid: the master (carrying the rule) and
 * its later occurrences (carrying `recurrenceParentId`), at the master's wall-clock time in `tz` so a
 * 09:00 meeting stays at 09:00 across a DST change, and its length.
 *
 * shortcut: capped at {@link ENTRY_BATCH_MAX}, the most one create batch carries; `clipped` says the
 * series runs on past it. Upgrade once the events API writes a series server-side.
 */
export function seriesOf(
	event: CalendarEvent,
	tz: string,
): { events: CalendarEvent[]; clipped: boolean } {
	const rule = event.recurrenceRule;
	if (!rule) return { events: [event], clipped: false };
	const { date, minute } = wallClockInZone(event.start, tz);
	const expansion = expandIcsSeries({
		rule,
		startsOn: date,
		instantOn: (d) => zonedSpan(d, minute, minute, tz).startsAt,
		until: (raw) => {
			const d = untilDate(raw);
			return d ? { date: d, ms: zonedSpan(d, 0, 1440, tz).endsAt - 1 } : null;
		},
		window: { from: date, to: addDays(date, SERIES_HORIZON_DAYS) },
	});
	if (!expansion.ok) return { events: [event], clipped: false };

	const length = event.end - event.start;
	const starts = expansion.starts.slice(0, ENTRY_BATCH_MAX);
	return {
		events: starts.map((start, i) =>
			i === 0 ? event : {
				...event,
				id: `${event.id}-${i}`,
				start,
				end: start + length,
				recurrenceRule: undefined,
				recurrenceParentId: event.id,
			}
		),
		clipped: expansion.clipped || expansion.starts.length > ENTRY_BATCH_MAX,
	};
}

/**
 * What the composer says about a new entry in the past, or `null`: a single entry by its own start, and
 * a series only when nothing it lays down is still to come. It is judged on the occurrences one create
 * writes ({@link seriesOf}), so a long-past open series whose first batch never reaches today warns too.
 */
export function pastNotice(event: CalendarEvent, tz: string, nowMs: number): string | null {
	if (!event.recurrenceRule) {
		if (!startsInPast(nowMs, event)) return null;
		return `This ${entryClassOf(event) === "reminder" ? "reminder" : "event"} is in the past.`;
	}
	const series = seriesOf(event, tz);
	if (series.events.some((e) => !startsInPast(nowMs, e))) return null;
	return series.clipped
		? `The first ${series.events.length} occurrences are added now, and all of them are in the past.`
		: "Every occurrence of this series is in the past.";
}
// #endregion
