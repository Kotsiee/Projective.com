import { assertEquals } from "@std/assert";
import type { AvailabilityRule } from "@projective/types/scheduling";
import { availabilityAt, hoursSummary, localTimeLabel, minuteLabel, wallClockAt } from "./hours.ts";

const band = (
	weekday: number,
	startMinute: number,
	endMinute: number,
	kind: AvailabilityRule["kind"] = "working_hours",
): AvailabilityRule => ({ weekday, startMinute, endMinute, kind });

/** Mon–Fri 9:00–12:30 + 13:30–17:00, Sat 10:00–13:00, plus a call window that must be ignored. */
const WEEK: AvailabilityRule[] = [
	...[1, 2, 3, 4, 5].flatMap((
		d,
	) => [band(d, 9 * 60, 12 * 60 + 30), band(d, 13 * 60 + 30, 17 * 60)]),
	band(6, 10 * 60, 13 * 60),
	band(2, 10 * 60, 12 * 60, "call_window"),
];

Deno.test("minuteLabel prints a fixed-locale 12-hour clock", () => {
	assertEquals(minuteLabel(0), "12:00 AM");
	assertEquals(minuteLabel(9 * 60), "9:00 AM");
	assertEquals(minuteLabel(17 * 60 + 30), "5:30 PM");
	assertEquals(minuteLabel(1440), "12:00 AM");
});

Deno.test("hoursSummary collapses a standard week to two lines and ignores call windows", () => {
	assertEquals(hoursSummary(WEEK), [
		{ days: "Mon–Fri", times: "9:00 AM – 5:00 PM" },
		{ days: "Sat", times: "10:00 AM – 1:00 PM" },
	]);
});

Deno.test("hoursSummary names a non-contiguous run day by day and yields nothing for no bands", () => {
	assertEquals(hoursSummary([band(1, 540, 1020), band(3, 540, 1020), band(5, 540, 1020)]), [
		{ days: "Mon, Wed, Fri", times: "9:00 AM – 5:00 PM" },
	]);
	assertEquals(hoursSummary([]), []);
	assertEquals(hoursSummary([band(2, 600, 720, "call_window")]), []);
});

Deno.test("wallClockAt reads the seller's zone, not the server's", () => {
	// 2026-07-14T08:30:00Z is a Tuesday: 09:30 in London (BST), 17:30 in Tokyo, 04:30 in New York.
	const t = Date.UTC(2026, 6, 14, 8, 30);
	assertEquals(wallClockAt("Europe/London", t), { weekday: 2, minute: 9 * 60 + 30 });
	assertEquals(wallClockAt("Asia/Tokyo", t), { weekday: 2, minute: 17 * 60 + 30 });
	assertEquals(wallClockAt("America/New_York", t), { weekday: 2, minute: 4 * 60 + 30 });
	assertEquals(localTimeLabel("Asia/Tokyo", t), "5:30 PM");
});

Deno.test("availabilityAt is inside a band, in a lunch gap, after hours, and over a weekend", () => {
	const hours = { timezone: "Europe/London", rules: WEEK };
	// Tuesday 09:30 London → inside the morning band.
	assertEquals(availabilityAt(hours, Date.UTC(2026, 6, 14, 8, 30)), {
		available: true,
		nextLabel: "Until 12:30 PM",
	});
	// Tuesday 13:00 London → the lunch gap; back at the afternoon band.
	assertEquals(availabilityAt(hours, Date.UTC(2026, 6, 14, 12, 0)), {
		available: false,
		nextLabel: "Back 1:30 PM",
	});
	// Friday 18:00 London → next opening is Saturday morning.
	assertEquals(availabilityAt(hours, Date.UTC(2026, 6, 17, 17, 0)), {
		available: false,
		nextLabel: "Back Sat 10:00 AM",
	});
	// Sunday 20:00 London → next opening is Monday.
	assertEquals(availabilityAt(hours, Date.UTC(2026, 6, 19, 19, 0)), {
		available: false,
		nextLabel: "Back Mon 9:00 AM",
	});
});

Deno.test("availabilityAt with no working bands is away with no next edge", () => {
	assertEquals(availabilityAt({ timezone: "UTC", rules: [] }, Date.UTC(2026, 6, 14)), {
		available: false,
		nextLabel: null,
	});
	assertEquals(
		availabilityAt(
			{ timezone: "UTC", rules: [band(2, 600, 720, "call_window")] },
			Date.UTC(2026, 6, 14),
		),
		{ available: false, nextLabel: null },
	);
});
