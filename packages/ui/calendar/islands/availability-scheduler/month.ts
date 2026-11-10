import { zonedParts } from "../../core/time.ts";
import { addDays, DAY_MINUTES, fmtDuration, fmtMinutes } from "./civil.ts";
import { normaliseBands } from "./reducer.ts";
import type { Band, Explanation, Occurrence } from "./types.ts";

// #region Buckets
function localOf(ms: number, timezone: string): { date: string; minute: number } {
	const p = zonedParts(ms, timezone);
	const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
	return { date, minute: p.hour * 60 + p.minute };
}

/** Split absolute occurrences into local bands per civil date in `timezone`. */
export function bucketByDate(
	occurrences: readonly Occurrence[],
	timezone: string,
): Map<string, Band[]> {
	const out = new Map<string, Band[]>();
	const push = (date: string, band: Band) => {
		if (band.end <= band.start) return;
		out.set(date, [...(out.get(date) ?? []), band]);
	};
	for (const o of occurrences) {
		const s = localOf(o.startsAt, timezone);
		const e = localOf(o.endsAt, timezone);
		if (s.date === e.date) {
			push(s.date, { start: s.minute, end: e.minute });
			continue;
		}
		push(s.date, { start: s.minute, end: DAY_MINUTES });
		for (let d = addDays(s.date, 1); d < e.date; d = addDays(d, 1)) {
			push(d, { start: 0, end: DAY_MINUTES });
		}
		push(e.date, { start: 0, end: e.minute });
	}
	for (const [date, bands] of out) out.set(date, normaliseBands(bands));
	return out;
}

function total(bands: readonly Band[]): number {
	return bands.reduce((sum, b) => sum + b.end - b.start, 0);
}

/** The cell summary: the day's working hours ("7h"), or "Off". */
export function summarise(day: readonly Band[] | undefined): string {
	const work = day ? total(day) : 0;
	return work ? fmtDuration(work) : "Off";
}
// #endregion

// #region Explain
function ranges(bands: readonly Band[]): string {
	return bands.map((b) => `${fmtMinutes(b.start)}–${fmtMinutes(b.end)}`).join(", ");
}

/**
 * The "why" sentences for one date: the result, the rules that contributed, any override and what it
 * outranked, and every removal. `nameOf` names a rule (its label, else its sentence).
 */
export function explanationLines(
	explanation: Explanation,
	nameOf: (ruleId: string, label: string) => string,
): string[] {
	const day = explanation;
	const quote = (r: { ruleId: string; label: string }) => `“${nameOf(r.ruleId, r.label)}”`;
	const lines = [day.bands.length ? `Working hours ${ranges(day.bands)}` : "No working hours"];
	if (day.replacedBy) {
		lines.push(`Override ${quote(day.replacedBy)} replaced working hours`);
		for (const r of day.outranked) lines.push(`Override ${quote(r)} was outranked`);
	} else if (day.contributed.length) {
		lines.push(`From ${day.contributed.map(quote).join(", ")}`);
	}
	for (const r of day.removedBy) {
		lines.push(
			r.removed.length
				? `Rule ${quote(r)} removed ${ranges(r.removed)}`
				: `Rule ${quote(r)} applied but removed nothing`,
		);
	}
	return lines;
}
// #endregion
