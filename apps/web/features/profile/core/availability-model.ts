import type { OwnerAvailability, OwnerBand } from "@projective/types/scheduling";

/**
 * availability-model — the pure half of the owner's Availability editor: the week in the order a
 * person reads it, the time choices a band offers, and the edits that keep a day's bands legal.
 */

/** Monday-first, as a working week reads — the JS weekday numbers (0 = Sunday). */
export const WEEK: ReadonlyArray<{ weekday: number; label: string; short: string }> = [
	{ weekday: 1, label: "Monday", short: "Mon" },
	{ weekday: 2, label: "Tuesday", short: "Tue" },
	{ weekday: 3, label: "Wednesday", short: "Wed" },
	{ weekday: 4, label: "Thursday", short: "Thu" },
	{ weekday: 5, label: "Friday", short: "Fri" },
	{ weekday: 6, label: "Saturday", short: "Sat" },
	{ weekday: 0, label: "Sunday", short: "Sun" },
];

/** Band edges are chosen on a 30-minute grid. */
export const STEP_MINUTES = 30;

/** `540` → `"09:00"`; `1440` → `"24:00"` (the end of the day, never the start of the next). */
export function clockLabel(minute: number): string {
	const h = Math.floor(minute / 60);
	const m = minute % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The start-time choices (00:00 … 23:30). */
export const START_OPTIONS = Array.from({ length: 1440 / STEP_MINUTES }, (_, i) => {
	const minute = i * STEP_MINUTES;
	return { label: clockLabel(minute), value: String(minute) };
});

/** The end-time choices after `start` (… 24:00). */
export function endOptions(start: number): Array<{ label: string; value: string }> {
	const out: Array<{ label: string; value: string }> = [];
	for (let m = start + STEP_MINUTES; m <= 1440; m += STEP_MINUTES) {
		out.push({ label: m === 1440 ? "24:00 (midnight)" : clockLabel(m), value: String(m) });
	}
	return out;
}

/** A day's working bands, in time order. */
export function bandsFor(value: OwnerAvailability, weekday: number): OwnerBand[] {
	return value.bands
		.filter((b) => b.weekday === weekday && b.kind === "working_hours")
		.sort((a, b) => a.startMinute - b.startMinute);
}

/** Replace one day's working bands, keeping every other band (other days, call windows) as it was. */
export function withDayBands(value: OwnerAvailability, weekday: number, bands: OwnerBand[]): OwnerAvailability {
	const others = value.bands.filter((b) => !(b.weekday === weekday && b.kind === "working_hours"));
	return { ...value, bands: [...others, ...bands] };
}

/**
 * The next band a day can take: the first free 30-minute-aligned slot after its last band, an hour
 * long where there is room — or `null` when the day is full.
 */
export function nextBand(existing: readonly OwnerBand[], weekday: number): OwnerBand | null {
	const last = existing.reduce((end, b) => Math.max(end, b.endMinute), 0);
	const start = existing.length === 0 ? 9 * 60 : Math.ceil(last / STEP_MINUTES) * STEP_MINUTES;
	if (start >= 1440) return null;
	const end = existing.length === 0 ? 17 * 60 : Math.min(1440, start + 60);
	return { weekday, startMinute: start, endMinute: end, kind: "working_hours" };
}

/** Copy one day's working bands onto other days (their own working bands are replaced). */
export function copyDay(value: OwnerAvailability, from: number, to: readonly number[]): OwnerAvailability {
	const source = bandsFor(value, from);
	let next = value;
	for (const weekday of to) {
		if (weekday === from) continue;
		next = withDayBands(next, weekday, source.map((b) => ({ ...b, weekday })));
	}
	return next;
}

/** Whether two bands of a day overlap — the editor marks the day rather than letting a save fail. */
export function dayOverlaps(bands: readonly OwnerBand[]): boolean {
	const sorted = [...bands].sort((a, b) => a.startMinute - b.startMinute);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].startMinute < sorted[i - 1].endMinute) return true;
	}
	return false;
}
