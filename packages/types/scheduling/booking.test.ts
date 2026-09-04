import { assertEquals } from "@std/assert";
import {
	addDaysInZone,
	dayKeyInZone,
	sameDayInZone,
	zonedMidnight,
	zonedParts,
	zoneOffsetMinutes,
} from "./booking.ts";

/**
 * The slot grid's zoned-time helpers, pinned.
 *
 * These decide which calendar DAY a bookable time falls on, which is the one arithmetic on a booking
 * surface that is invisible when wrong: a slot bucketed into the wrong day still renders, still reads
 * plausibly, and is only discovered when somebody turns up on the wrong date.
 *
 * The DST cases are the point. A shifted-`Date` implementation passes every test written in July and
 * fails twice a year, so the transitions are asserted explicitly rather than sampled.
 */

const DAY = 86_400_000;

Deno.test("a day key is the local ISO date, not the UTC one", () => {
	// 23:30 UTC on the 20th is already the 21st in Tokyo (+09) and still the 20th in New York (-04).
	const t = Date.parse("2026-07-20T23:30:00Z");
	assertEquals(dayKeyInZone(t, "UTC"), "2026-07-20");
	assertEquals(dayKeyInZone(t, "Asia/Tokyo"), "2026-07-21");
	assertEquals(dayKeyInZone(t, "America/New_York"), "2026-07-20");
});

Deno.test("an unknown zone degrades to UTC rather than throwing", () => {
	// A grid drawn in the wrong zone is a bug; one that throws inside a render body removes the picker
	// and everything under it.
	assertEquals(dayKeyInZone(Date.parse("2026-07-20T12:00:00Z"), "Not/AZone"), "2026-07-20");
});

Deno.test("zoned parts read the local wall clock", () => {
	const t = Date.parse("2026-07-20T23:30:00Z");
	const tokyo = zonedParts(t, "Asia/Tokyo");
	assertEquals([tokyo.year, tokyo.month, tokyo.dayOfMonth], [2026, 6, 21]);
	assertEquals([tokyo.hour, tokyo.minute], [8, 30]);
	// 0 = Sunday; 21 July 2026 is a Tuesday.
	assertEquals(tokyo.weekday, 2);
});

Deno.test("zone offsets are signed correctly and follow DST", () => {
	assertEquals(zoneOffsetMinutes(Date.parse("2026-07-20T12:00:00Z"), "UTC"), 0);
	// London is +01:00 in July (BST) and +00:00 in January (GMT).
	assertEquals(zoneOffsetMinutes(Date.parse("2026-07-20T12:00:00Z"), "Europe/London"), 60);
	assertEquals(zoneOffsetMinutes(Date.parse("2026-01-20T12:00:00Z"), "Europe/London"), 0);
	// New York is behind Greenwich, so the offset is negative.
	assertEquals(zoneOffsetMinutes(Date.parse("2026-07-20T12:00:00Z"), "America/New_York"), -240);
});

Deno.test("local midnight is the real local midnight, in every zone", () => {
	const t = Date.parse("2026-07-20T23:30:00Z");
	assertEquals(new Date(zonedMidnight(t, "UTC")).toISOString(), "2026-07-20T00:00:00.000Z");
	// 21 July 00:00 in Tokyo is 20 July 15:00 UTC.
	assertEquals(new Date(zonedMidnight(t, "Asia/Tokyo")).toISOString(), "2026-07-20T15:00:00.000Z");
	// 23:30 UTC is already 00:30 on the 21st in London (BST), so the day CONTAINING it is the 21st and
	// its midnight is 20 July 23:00 UTC. Reasoning about "the 20th" here is the mistake this line pins.
	assertEquals(new Date(zonedMidnight(t, "Europe/London")).toISOString(), "2026-07-20T23:00:00.000Z");
});

Deno.test("local midnight survives a spring-forward day", () => {
	// London springs forward at 01:00 UTC on 29 March 2026. Midday that day is 12:00 BST.
	const midday = Date.parse("2026-03-29T12:00:00Z");
	const midnight = zonedMidnight(midday, "Europe/London");
	// Local midnight was BEFORE the transition, so it is still 00:00 GMT — exactly 00:00 UTC.
	assertEquals(new Date(midnight).toISOString(), "2026-03-29T00:00:00.000Z");
	assertEquals(dayKeyInZone(midnight, "Europe/London"), "2026-03-29");
	// The naive "subtract the offset at noon" answer would land an hour early, on the 28th.
	assertEquals(dayKeyInZone(midnight - 1, "Europe/London"), "2026-03-28");
});

Deno.test("local midnight survives a fall-back day", () => {
	// London falls back at 02:00 BST on 25 October 2026.
	const midday = Date.parse("2026-10-25T12:00:00Z");
	const midnight = zonedMidnight(midday, "Europe/London");
	assertEquals(dayKeyInZone(midnight, "Europe/London"), "2026-10-25");
	assertEquals(new Date(midnight).toISOString(), "2026-10-24T23:00:00.000Z");
});

Deno.test("stepping days is CALENDAR-aware, so a 25-hour day is not rendered twice", () => {
	// 25 October 2026 is a fall-back day in London: 25 hours long. `midnight + 24h` is still inside it,
	// so a rail stepping by a fixed day would emit 25 October twice, collide its key in the slot map,
	// and lose the last day of the window. A spring-forward day survives the naive version, which is
	// precisely why this ships unnoticed.
	const start = zonedMidnight(Date.parse("2026-10-25T12:00:00Z"), "Europe/London");
	assertEquals(dayKeyInZone(start, "Europe/London"), "2026-10-25");
	assertEquals(dayKeyInZone(zonedMidnight(start + DAY, "Europe/London"), "Europe/London"), "2026-10-25");
	assertEquals(dayKeyInZone(addDaysInZone(start, 1, "Europe/London"), "Europe/London"), "2026-10-26");
});

Deno.test("a fortnight of calendar steps produces 14 DISTINCT contiguous days across a transition", () => {
	// The rail's actual shape, across the fall-back boundary.
	const start = zonedMidnight(Date.parse("2026-10-20T12:00:00Z"), "Europe/London");
	const keys = Array.from({ length: 14 }, (_, i) => dayKeyInZone(addDaysInZone(start, i, "Europe/London"), "Europe/London"));
	assertEquals(new Set(keys).size, 14);
	assertEquals(keys[0], "2026-10-20");
	assertEquals(keys[13], "2026-11-02");
	// And across a month boundary, which is where hand-rolled day arithmetic usually breaks instead.
	assertEquals(keys.includes("2026-11-01"), true);
});

Deno.test("calendar steps run backwards and across a year boundary", () => {
	const start = zonedMidnight(Date.parse("2027-01-01T12:00:00Z"), "Europe/London");
	assertEquals(dayKeyInZone(addDaysInZone(start, -1, "Europe/London"), "Europe/London"), "2026-12-31");
	assertEquals(dayKeyInZone(addDaysInZone(start, -32, "Europe/London"), "Europe/London"), "2026-11-30");
});

Deno.test("same-day comparison is zone-relative", () => {
	const a = Date.parse("2026-07-20T22:00:00Z");
	const b = Date.parse("2026-07-20T23:30:00Z");
	assertEquals(sameDayInZone(a, b, "UTC"), true);
	// In Tokyo those two instants are 21 July 07:00 and 08:30 — still the same day.
	assertEquals(sameDayInZone(a, b, "Asia/Tokyo"), true);
	// But 20 July 12:00 UTC and 20 July 23:30 UTC are two different Tokyo days.
	assertEquals(sameDayInZone(Date.parse("2026-07-20T12:00:00Z"), b, "Asia/Tokyo"), false);
});
