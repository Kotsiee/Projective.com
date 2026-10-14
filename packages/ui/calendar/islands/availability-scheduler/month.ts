import { zonedParts } from "../../core/time.ts";
import { addDays, DAY_MINUTES, fmtDuration, fmtMinutes } from "./civil.ts";
import { normaliseBands } from "./reducer.ts";
import type { Band, Explanation, Layer, Occurrence } from "./types.ts";

// #region Buckets
/** One date's evaluated bands, per layer. */
export interface DayBands {
	working: Band[];
	call: Band[];
}

function localOf(ms: number, timezone: string): { date: string; minute: number } {
	const p = zonedParts(ms, timezone);
	const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
	return { date, minute: p.hour * 60 + p.minute };
}

/** Split absolute occurrences into local bands per civil date in `timezone`. */
export function bucketByDate(
	occurrences: readonly Occurrence[],
	timezone: string,
): Map<string, DayBands> {
	const out = new Map<string, DayBands>();
	const push = (date: string, layer: Layer, band: Band) => {
		if (band.end <= band.start) return;
		const day = out.get(date) ?? { working: [], call: [] };
		(layer === "working_hours" ? day.working : day.call).push(band);
		out.set(date, day);
	};
	for (const o of occurrences) {
		const s = localOf(o.startsAt, timezone);
		const e = localOf(o.endsAt, timezone);
		if (s.date === e.date) {
			push(s.date, o.kind, { start: s.minute, end: e.minute });
			continue;
		}
		push(s.date, o.kind, { start: s.minute, end: DAY_MINUTES });
		for (let d = addDays(s.date, 1); d < e.date; d = addDays(d, 1)) {
			push(d, o.kind, { start: 0, end: DAY_MINUTES });
		}
		push(e.date, o.kind, { start: 0, end: e.minute });
	}
	for (const [date, day] of out) {
		out.set(date, { working: normaliseBands(day.working), call: normaliseBands(day.call) });
	}
	return out;
}

function total(bands: readonly Band[]): number {
	return bands.reduce((sum, b) => sum + b.end - b.start, 0);
}

/** The cell summary: "7h · calls 3h", "calls 1h", or "Off". */
export function summarise(day: DayBands | undefined): string {
	const work = day ? total(day.working) : 0;
	const calls = day ? total(day.call) : 0;
	const parts = [work ? fmtDuration(work) : "", calls ? `calls ${fmtDuration(calls)}` : ""]
		.filter(Boolean);
	return parts.length ? parts.join(" · ") : "Off";
}
// #endregion

// #region Explain
function ranges(bands: readonly Band[]): string {
	return bands.map((b) => `${fmtMinutes(b.start)}–${fmtMinutes(b.end)}`).join(", ");
}

/**
 * The "why" sentences for one date, working hours first: the result, the rules that contributed,
 * any override and what it outranked, every removal, and call time clipped to working hours.
 * `nameOf` names a rule (its label, else its sentence).
 */
export function explanationLines(
	explanation: Explanation,
	nameOf: (ruleId: string, label: string) => string,
): string[] {
	const lines: string[] = [];
	for (const layer of explanation) {
		const what = layer.layer === "working_hours" ? "Working hours" : "Calls";
		lines.push(layer.bands.length ? `${what} ${ranges(layer.bands)}` : `No ${what.toLowerCase()}`);
		const quote = (r: { ruleId: string; label: string }) => `“${nameOf(r.ruleId, r.label)}”`;
		if (layer.replacedBy) {
			lines.push(`Override ${quote(layer.replacedBy)} replaced ${what.toLowerCase()}`);
			for (const r of layer.outranked) lines.push(`Override ${quote(r)} was outranked`);
		} else if (layer.contributed.length) {
			lines.push(`From ${layer.contributed.map(quote).join(", ")}`);
		}
		for (const r of layer.removedBy) {
			lines.push(
				r.removed.length
					? `Rule ${quote(r)} removed ${ranges(r.removed)}`
					: `Rule ${quote(r)} applied but removed nothing`,
			);
		}
		if (layer.clipped.length) {
			lines.push(`Not offered outside working hours: ${ranges(layer.clipped)}`);
		}
	}
	return lines;
}
// #endregion
