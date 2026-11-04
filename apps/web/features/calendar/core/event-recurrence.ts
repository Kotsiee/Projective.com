import {
	addDays,
	type AvailabilityRuleDraft,
	type CalendarEvent,
	civilParts,
	dateInZone,
	ENTRY_BATCH_MAX,
	expandIcsSeries,
	type IsoDate,
	parseIsoDate,
	parseRRule,
	type RRuleParts,
	serialiseRRule,
	wallClockInZone,
	weekdayOf,
	zonedSpan,
} from "@projective/types/scheduling";

/**
 * event-recurrence — the composer's repeat control, as data: the five standard cadences, the custom
 * draft behind them, the RFC 5545 rule both serialise to, the sentence that rule reads as, and the
 * occurrences a commit lays onto the grid.
 *
 * The RULE on the working copy (`CalendarEvent.recurrenceRule`) is the one source of truth. The
 * preset a dropdown shows and the custom panel's fields are both READ BACK from it, so the two tiers
 * can never disagree about what the entry does.
 *
 * Weekdays here are ISO (1 = Monday … 7 = Sunday), the order the toggles draw in; `rrule.ts` counts
 * from Sunday = 0, and the conversion happens only at that boundary.
 */

// #region Model
/** The frequencies the composer offers. */
export type RepeatFreq = "DAILY" | "WEEKLY" | "MONTHLY";

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

/** The tier-1 cadences, in the order the dropdown lists them. */
export const REPEAT_PRESETS = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type RepeatPreset = (typeof REPEAT_PRESETS)[number];

/** What a series is anchored to: DTSTART's civil date in the schedule's zone. */
export interface RepeatAnchor {
	date: IsoDate;
	isoDay: number;
	monthDay: number;
}

const NEVER: RepeatEnd = { type: "never" };
const WORKWEEK = [1, 2, 3, 4, 5];

const isoOf = (wd: number) => (wd === 0 ? 7 : wd);
const wdOf = (iso: number) => iso % 7;

/** The anchor of an entry starting at `startMs`, read in `tz`. */
export function repeatAnchor(startMs: number, tz: string): RepeatAnchor {
	const date = dateInZone(startMs, tz);
	return { date, isoDay: isoOf(weekdayOf(date)), monthDay: civilParts(date).day };
}
// #endregion

// #region Rule
/** The custom draft a tier-1 cadence stands for. */
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

/**
 * The weekly cadence an availability template stands for in the Repeats dropdown: every weekday its
 * active, every-week working-hours rules add. `null` when it has none — a template of monthly or
 * one-off rules has no weekly shape to repeat on.
 */
export function templateDraft(
	rules: readonly Pick<AvailabilityRuleDraft, "layer" | "effect" | "active" | "pattern">[],
): RepeatDraft | null {
	const days = new Set<number>();
	for (const r of rules) {
		if (!r.active || r.layer !== "working_hours" || r.effect !== "add") continue;
		if (r.pattern.type !== "weekly" || r.pattern.interval !== 1) continue;
		for (const wd of r.pattern.days) days.add(isoOf(wd));
	}
	return days.size
		? { freq: "WEEKLY", interval: 1, isoDays: [...days].sort((a, b) => a - b), end: NEVER }
		: null;
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
		byMonthDay: d.freq === "MONTHLY" ? [a.monthDay] : [],
		byMonth: [],
		bySetPos: [],
		wkst: 1,
		...(d.end.type === "until" ? { until: d.end.date } : {}),
	};
	const rule = serialiseRRule(parts);
	return d.end.type === "count" ? `${rule};COUNT=${d.end.count}` : rule;
}

/** Read a rule back into the custom panel's fields, or `null` for one the composer cannot author. */
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
	if (p.freq === "YEARLY") return null;
	return {
		freq: p.freq,
		interval: p.interval,
		isoDays: p.byDay.map((b) => isoOf(b.wd)).sort((x, y) => x - y),
		end: count !== null
			? { type: "count", count }
			: p.until
			? { type: "until", date: p.until }
			: NEVER,
	};
}

/** Which tier-1 cadence a rule is, or `custom` for anything the dropdown does not name. */
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

/** A cadence's dropdown label, naming the day it falls on so "Weekly" is never a guess. */
export function presetLabel(p: RepeatPreset, a: RepeatAnchor): string {
	switch (p) {
		case "none":
			return "Does not repeat";
		case "daily":
			return "Daily";
		case "weekdays":
			return "Every weekday";
		case "weekly":
			return `Weekly on ${weekdayName(a.isoDay)}`;
		case "monthly":
			return `Monthly on the ${ordinal(a.monthDay)}`;
	}
}

/** The short name of an ISO weekday, for a toggle that has no room for the long one. */
export function weekdayShort(iso: number): string {
	return new Intl.DateTimeFormat(LOCALE, { weekday: "short", timeZone: "UTC" })
		.format(new Date(Date.UTC(2024, 0, iso)));
}

function every(interval: number, unit: string): string {
	if (interval === 1) return `Every ${unit}`;
	if (interval === 2) return `Every other ${unit}`;
	return `Every ${interval} ${unit}s`;
}

/** The rule as one sentence: "Every other week on Monday and Thursday, 10 times". */
export function describeRepeat(d: RepeatDraft, a: RepeatAnchor): string {
	let head: string;
	if (d.freq === "DAILY") head = every(d.interval, "day");
	else if (d.freq === "MONTHLY") {
		head = `${d.interval === 1 ? "Monthly" : every(d.interval, "month")} on the ${
			ordinal(a.monthDay)
		}`;
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
// #endregion
