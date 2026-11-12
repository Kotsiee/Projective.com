import { assert, assertEquals } from "@std/assert";
import type { IsoDate } from "@projective/types/scheduling";
import { CALENDAR_READ_DAYS, calendarWindow, windowAnchor } from "./calendar-window.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-12T09:30:00.000Z");
const SEPT_2027 = "2027-09-01" as IsoDate;

Deno.test("a read with no day asked for is centred on the page's now", () => {
	const w = calendarWindow("personal", NOW);
	assertEquals(w, { from: NOW - 60 * DAY, to: NOW + 180 * DAY });
});

Deno.test("a read for a far day covers that day, not today's window (S-29)", () => {
	const w = calendarWindow("personal", NOW, SEPT_2027);
	const day = Date.parse("2027-09-01T00:00:00.000Z");
	assert(w.from <= day && day + DAY <= w.to, "the asked-for day is inside the window");
	assert(w.from > NOW + 180 * DAY, "the window moved past today's own edge");
});

Deno.test("the window covers the whole asked-for day in every zone", () => {
	assertEquals(windowAnchor(NOW, SEPT_2027), Date.parse("2027-09-01T12:00:00.000Z"));
	const midnightUtc = Date.parse("2027-09-01T00:00:00.000Z");
	for (const kind of ["personal", "project", "public"] as const) {
		const w = calendarWindow(kind, NOW, SEPT_2027);
		for (const offsetHours of [-12, -5, 0, 5.5, 14]) {
			const dayStart = midnightUtc - offsetHours * 3_600_000;
			assert(w.from <= dayStart && dayStart + DAY <= w.to, `${kind} UTC${offsetHours}`);
		}
	}
});

Deno.test("each read kind keeps its own span, and the public one stays inside free/busy's 120 days", () => {
	for (const kind of ["personal", "project", "public"] as const) {
		const { back, ahead } = CALENDAR_READ_DAYS[kind];
		const w = calendarWindow(kind, NOW, SEPT_2027);
		assertEquals((w.to - w.from) / DAY, back + ahead, kind);
	}
	const pub = CALENDAR_READ_DAYS.public;
	assert(pub.back + pub.ahead <= 120, "get_free_busy answers at most 120 days from its from");
});

Deno.test("a window never starts before the epoch", () => {
	const w = calendarWindow("project", NOW, "1970-01-02" as IsoDate);
	assertEquals(w.from, 0);
});
