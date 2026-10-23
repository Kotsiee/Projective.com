import { assertEquals } from "@std/assert";
import { addZonedDays, zonedParts, zonedTimeToMs } from "./time.ts";
import { dailyOccurrences, isMultiDay, minuteOfDay, rangeDays, SERIES_MAX_DAYS } from "./series.ts";

const LONDON = "Europe/London";
const midnight = (y: number, m: number, d: number) => zonedTimeToMs(y, m, d, 0, 0, LONDON);
const hm = (ms: number) => {
	const p = zonedParts(ms, LONDON);
	return `${p.day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

Deno.test("rangeDays — an all-day range names each day once, its end exclusive", () => {
	const start = midnight(2026, 10, 5);
	const range = { start, end: addZonedDays(start, 3, LONDON), allDay: true };
	assertEquals(rangeDays(range, LONDON).length, 3);
	assertEquals(isMultiDay(range, LONDON), true);
	assertEquals(
		isMultiDay({ start, end: addZonedDays(start, 1, LONDON), allDay: true }, LONDON),
		false,
	);
});

Deno.test("rangeDays — a runaway range is capped", () => {
	const start = midnight(2026, 1, 1);
	const range = { start, end: addZonedDays(start, 5000, LONDON), allDay: true };
	assertEquals(rangeDays(range, LONDON).length, SERIES_MAX_DAYS);
});

Deno.test("dailyOccurrences — without a repeat the range is one event", () => {
	const start = midnight(2026, 10, 5);
	const range = { start, end: addZonedDays(start, 4, LONDON), allDay: true };
	assertEquals(dailyOccurrences(range, LONDON), [{ start, end: range.end, allDay: true }]);
});

Deno.test("dailyOccurrences — one occurrence a day at the repeat's wall-clock times", () => {
	const start = midnight(2026, 10, 5);
	const range = {
		start,
		end: addZonedDays(start, 3, LONDON),
		allDay: true,
		daily: { startMinute: 9 * 60 + 30, endMinute: 10 * 60 + 15 },
	};
	const occ = dailyOccurrences(range, LONDON);
	assertEquals(occ.map((o) => `${hm(o.start)}–${hm(o.end)}`), [
		"5 09:30–5 10:15",
		"6 09:30–6 10:15",
		"7 09:30–7 10:15",
	]);
});

Deno.test("dailyOccurrences — a DST change keeps every occurrence at the same local time", () => {
	const start = midnight(2026, 10, 24);
	const range = {
		start,
		end: addZonedDays(start, 3, LONDON),
		allDay: true,
		daily: { startMinute: 9 * 60, endMinute: 10 * 60 },
	};
	const occ = dailyOccurrences(range, LONDON);
	assertEquals(occ.map((o) => hm(o.start)), ["24 09:00", "25 09:00", "26 09:00"]);
	assertEquals(occ.map((o) => o.end - o.start), [3_600_000, 3_600_000, 3_600_000]);
});

Deno.test("dailyOccurrences — an end at midnight closes the day rather than wrapping", () => {
	const start = midnight(2026, 10, 5);
	const occ = dailyOccurrences({
		start,
		end: addZonedDays(start, 1, LONDON),
		daily: { startMinute: 23 * 60, endMinute: 24 * 60 },
	}, LONDON);
	assertEquals(occ.length, 1);
	assertEquals(occ[0].end, addZonedDays(start, 1, LONDON));
});

Deno.test("minuteOfDay — minutes past local midnight", () => {
	assertEquals(minuteOfDay(zonedTimeToMs(2026, 10, 5, 14, 45, LONDON), LONDON), 14 * 60 + 45);
});
