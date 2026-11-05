import { assertEquals } from "@std/assert";
import type { CalendarEvent } from "@projective/types/scheduling";
import { addZonedDays, zonedParts, zonedTimeToMs } from "@ui/calendar/core/time.ts";
import type { CalendarRange } from "@ui/calendar/core/types.ts";
import { eventsForRange, firstOccurrence, listRows, spreadDaily } from "./event-series.ts";

const TZ = "Europe/London";
const midnight = (d: number) => zonedTimeToMs(2026, 10, d, 0, 0, TZ);
const hhmm = (ms: number) => {
	const p = zonedParts(ms, TZ);
	return `${p.day} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

let seq = 0;
const mint = (range: CalendarRange): CalendarEvent => ({
	id: `draft-${++seq}`,
	title: "",
	kind: "sync",
	status: "confirmed",
	start: range.start,
	end: range.end,
	...(range.allDay ? { allDay: true } : {}),
});

const week: CalendarRange = {
	start: midnight(5),
	end: addZonedDays(midnight(5), 5, TZ),
	allDay: true,
};

Deno.test("eventsForRange — a spanning range is one all-day event over every day", () => {
	const made = eventsForRange(week, "Leave", TZ, mint);
	assertEquals(made.length, 1);
	assertEquals(made[0].title, "Leave");
	assertEquals(made[0].allDay, true);
	assertEquals(made[0].end - made[0].start, 5 * 86_400_000);
});

Deno.test("eventsForRange — a daily range is one timed event per day", () => {
	const daily = { ...week, daily: { startMinute: 9 * 60 + 30, endMinute: 10 * 60 } };
	const made = eventsForRange(daily, "Stand-up", TZ, mint);
	assertEquals(made.map((e) => hhmm(e.start)), [
		"5 09:30",
		"6 09:30",
		"7 09:30",
		"8 09:30",
		"9 09:30",
	]);
	assertEquals(made.every((e) => e.title === "Stand-up" && !e.allDay), true);
	assertEquals(new Set(made.map((e) => e.id)).size, 5);
});

Deno.test("firstOccurrence — the full modal opens on the series' first day", () => {
	const daily = { ...week, daily: { startMinute: 14 * 60, endMinute: 15 * 60 } };
	const first = firstOccurrence(daily, TZ);
	assertEquals(hhmm(first.start), "5 14:00");
	assertEquals(hhmm(first.end), "5 15:00");
});

Deno.test("listRows — a series is one row, on its next occurrence", () => {
	const day = (d: number) => midnight(d) + 9 * 3_600_000;
	const at = (id: string, d: number, over: Partial<CalendarEvent> = {}) => ({
		...mint({ start: day(d), end: day(d) + 3_600_000 }),
		id,
		...over,
	});
	const events = [
		at("series-3", 7, { recurrenceParentId: "series-1" }),
		at("series-1", 5, { recurrenceRule: "FREQ=DAILY" }),
		at("series-2", 6, { recurrenceParentId: "series-1" }),
		at("alone", 6),
		at("other-2", 8, { recurrenceParentId: "other-1" }),
	];
	const now = day(6) + 7_200_000;
	const ids = (picked: string | null, at = now) => listRows(events, at, picked).map((e) => e.id);

	assertEquals(ids(null), ["alone", "series-3", "other-2"]);
	assertEquals(ids(null, day(1)), ["series-1", "alone", "other-2"]);
	assertEquals(ids(null, day(9)), ["alone", "series-3", "other-2"]);
	assertEquals(ids("series-1"), ["series-1", "alone", "other-2"]);
});

Deno.test("spreadDaily — an edit's time of day and length carry to every day", () => {
	const edited = mint({
		start: zonedTimeToMs(2026, 10, 5, 11, 15, TZ),
		end: zonedTimeToMs(2026, 10, 5, 12, 45, TZ),
	});
	const series = spreadDaily({ ...edited, title: "Review" }, week, TZ);
	assertEquals(series.map((e) => hhmm(e.start)), [
		"5 11:15",
		"6 11:15",
		"7 11:15",
		"8 11:15",
		"9 11:15",
	]);
	assertEquals(series.every((e) => e.end - e.start === 90 * 60_000), true);
	assertEquals(series[0].id, edited.id);
	assertEquals(new Set(series.map((e) => e.id)).size, 5);
});
