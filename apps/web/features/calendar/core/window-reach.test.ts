import { assertEquals, assertStrictEquals } from "@std/assert";
import type { CalendarWindow, IsoDate } from "@projective/types/scheduling";
import { calendarWindow } from "@server/services/scheduling/calendar-window.ts";
import { nextReadAround } from "./window-reach.ts";

const TZ = "Europe/London";
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-12T09:30:00.000Z");
const personal = calendarWindow("personal", NOW);

Deno.test("a focus well inside the window reads nothing", () => {
	assertStrictEquals(nextReadAround(personal, "week", NOW, TZ, null), null);
	assertStrictEquals(nextReadAround(personal, "month", NOW, TZ, null), null);
});

Deno.test("a focus past the window reads around the focused day (S-29: ?date=2027-09-01)", () => {
	const sept = Date.parse("2027-09-01T11:00:00.000Z");
	assertEquals(nextReadAround(personal, "month", sept, TZ, null), "2027-09-01");
});

Deno.test("the next read starts before the edge, not at it", () => {
	const nearEnd = personal.to - 10 * DAY;
	assertEquals(nextReadAround(personal, "week", nearEnd, TZ, null) !== null, true);
});

Deno.test("a narrow window settles instead of reading the same day forever", () => {
	const monday = Date.parse("2026-11-09T00:00:00.000Z");
	const around = "2026-11-09" as IsoDate;
	const read: CalendarWindow = calendarWindow("public", NOW, around);
	assertStrictEquals(nextReadAround(read, "week", monday, TZ, around), null);
});

Deno.test("a page that is not windowed never reads", () => {
	assertStrictEquals(nextReadAround(undefined, "week", NOW + 900 * DAY, TZ, null), null);
});
