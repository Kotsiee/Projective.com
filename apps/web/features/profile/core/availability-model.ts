import type { OwnerBand } from "@projective/types/scheduling";

/**
 * availability-model — the pure half of the owner's Availability page: the stored weekly hours as the
 * read-only summary beside the link to `/calendar?view=availability`, where they are edited
 * (Decision #408).
 */

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** `540` → `"09:00"`; `1440` → `"24:00"` (the end of the day, never the start of the next). */
export function clockLabel(minute: number): string {
	const h = Math.floor(minute / 60);
	const m = minute % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** One line of the summary: a run of days with the same hours, and those hours. */
export interface WeekHoursLine {
	/** `Mon–Fri` for three days or more in a row, else `Mon` or `Mon, Tue`. */
	days: string;
	/** `09:00–12:00, 13:00–17:30` — the day's bands, touching ones joined. */
	times: string;
}

function dayTimes(bands: readonly OwnerBand[], weekday: number): string {
	const merged: Array<{ start: number; end: number }> = [];
	const day = bands
		.filter((b) => b.weekday === weekday && b.endMinute > b.startMinute)
		.sort((a, b) => a.startMinute - b.startMinute);
	for (const b of day) {
		const last = merged[merged.length - 1];
		if (last && b.startMinute <= last.end) last.end = Math.max(last.end, b.endMinute);
		else merged.push({ start: b.startMinute, end: b.endMinute });
	}
	return merged.map((b) => `${clockLabel(b.start)}–${clockLabel(b.end)}`).join(", ");
}

function runLabel(days: readonly number[]): string {
	const names = days.map((d) => SHORT[d]);
	return names.length > 2 ? `${names[0]}–${names[names.length - 1]}` : names.join(", ");
}

/**
 * The stored week as summary lines, read from the owner's first weekday: days in a row with the same
 * hours share a line, and a day without hours ends the run and prints nothing.
 */
export function weekHours(bands: readonly OwnerBand[], weekStartsOn = 1): WeekHoursLine[] {
	const lines: WeekHoursLine[] = [];
	let run: number[] = [];
	let times = "";
	const flush = () => {
		if (run.length && times) lines.push({ days: runLabel(run), times });
		run = [];
	};
	for (let i = 0; i < 7; i++) {
		const weekday = (weekStartsOn + i) % 7;
		const day = dayTimes(bands, weekday);
		if (!day || day !== times) flush();
		times = day;
		if (day) run.push(weekday);
	}
	flush();
	return lines;
}
