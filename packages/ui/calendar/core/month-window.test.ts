import { assertEquals } from "@std/assert";
import { startOfWeek, zonedParts, zonedTimeToMs } from "./time.ts";
import {
	centerRow,
	daysOfRow,
	frameRow,
	monthStartOf,
	monthWindow,
	rowOfDay,
	weekStartOf,
} from "./month-window.ts";

const UTC = "UTC";
const LONDON = "Europe/London";

const day = (y: number, m: number, d: number, tz = UTC) => zonedTimeToMs(y, m, d, 0, 0, tz);
const ymd = (ms: number, tz = UTC) => {
	const p = zonedParts(ms, tz);
	return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

Deno.test("rowOfDay — a week is one row, starting on Monday", () => {
	const origin = startOfWeek(day(2026, 10, 7), UTC);
	assertEquals(ymd(origin), "2026-10-05");
	assertEquals(rowOfDay(origin, day(2026, 10, 5), UTC), 0);
	assertEquals(rowOfDay(origin, day(2026, 10, 11), UTC), 0);
	assertEquals(rowOfDay(origin, day(2026, 10, 12), UTC), 1);
	assertEquals(rowOfDay(origin, day(2026, 10, 4), UTC), -1);
});

Deno.test("rowOfDay — a DST change moves no day into the wrong week", () => {
	const origin = startOfWeek(day(2026, 3, 23, LONDON), LONDON);
	assertEquals(rowOfDay(origin, day(2026, 3, 29, LONDON), LONDON), 0);
	assertEquals(rowOfDay(origin, day(2026, 3, 30, LONDON), LONDON), 1);
	assertEquals(rowOfDay(origin, day(2026, 10, 26, LONDON), LONDON), 31);
	assertEquals(ymd(weekStartOf(origin, 31, LONDON), LONDON), "2026-10-26");
});

Deno.test("daysOfRow — seven consecutive midnights", () => {
	const origin = startOfWeek(day(2026, 10, 7), UTC);
	assertEquals(daysOfRow(origin, 0, UTC).map((d) => ymd(d)), [
		"2026-10-05",
		"2026-10-06",
		"2026-10-07",
		"2026-10-08",
		"2026-10-09",
		"2026-10-10",
		"2026-10-11",
	]);
});

Deno.test("frameRow — the week holding the 1st sits at the top", () => {
	const origin = startOfWeek(day(2026, 10, 7), UTC);
	assertEquals(ymd(monthStartOf(day(2026, 10, 19), UTC)), "2026-10-01");
	assertEquals(frameRow(origin, day(2026, 10, 19), UTC), -1);
	assertEquals(
		ymd(weekStartOf(origin, frameRow(origin, day(2026, 11, 20), UTC), UTC)),
		"2026-10-26",
	);
});

Deno.test("centerRow — the day's week is the middle row of the window", () => {
	const origin = startOfWeek(day(2026, 10, 7), UTC);
	const top = centerRow(origin, day(2026, 10, 7), 6, UTC);
	assertEquals(top, -2);
	assertEquals(centerRow(origin, day(2026, 10, 7), 7, UTC), -3);
});

Deno.test("monthWindow — the month with most days on screen is the focal one", () => {
	const origin = startOfWeek(day(2026, 9, 28), UTC);
	const w = monthWindow(origin, 0, 6, UTC);
	assertEquals(ymd(w.focal), "2026-10-01");
	assertEquals(ymd(w.anchor), "2026-10-01");
});

Deno.test("monthWindow — scrolled mid-month, the anchor is the first focal day on screen", () => {
	const origin = startOfWeek(day(2026, 10, 5), UTC);
	const w = monthWindow(origin, 0, 6, UTC);
	assertEquals(ymd(w.focal), "2026-10-01");
	assertEquals(ymd(w.anchor), "2026-10-05");
	assertEquals(ymd(monthWindow(origin, 1, 6, UTC).focal), "2026-11-01");
});

Deno.test("monthWindow — a tie goes to the month holding the centre day", () => {
	const origin = startOfWeek(day(2026, 5, 25), UTC);
	const w = monthWindow(origin, 0, 2, UTC);
	assertEquals(ymd(w.focal), "2026-06-01");
});

Deno.test("monthWindow — ten weeks still name one month", () => {
	const origin = startOfWeek(day(2026, 10, 5), UTC);
	const w = monthWindow(origin, 0, 10, UTC);
	assertEquals(ymd(w.focal), "2026-11-01");
});
