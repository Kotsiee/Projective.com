import { assertEquals } from "@std/assert";
import type { SlotGrid } from "@projective/types/scheduling";
import {
	customEnd,
	customStartBounds,
	customStartProblem,
	defaultCallType,
	defaultPlatform,
	instantOf,
	minuteOfDay,
	platformOptions,
} from "./consultation-model.ts";

/**
 * The custom start-time arithmetic, pinned on a real DST day.
 *
 * 2026-10-25 is the day Europe/London falls back (25 hours long). A start typed as "14:20" on that
 * day must resolve to the instant a London clock shows 14:20 — arithmetic that adds 14h20m to
 * midnight lands an hour off, which on a booking surface is a call the buyer joins an hour late.
 */
const TZ = "Europe/London";
const DAY_KEY = "2026-10-25";
// Midnight of 2026-10-25 in London is 23:00 UTC on the 24th (BST, UTC+1).
const DAY_START = Date.UTC(2026, 9, 24, 23, 0, 0);
// 14:20 London on the 25th is 14:20 UTC (GMT after the fall-back at 02:00).
const START_1420 = Date.UTC(2026, 9, 25, 14, 20, 0);

const grid: SlotGrid = {
	purpose: "discovery_call",
	subjectId: "juno",
	providerTimezone: TZ,
	viewerTimezone: TZ,
	durationMinutes: 20,
	sessionCount: 1,
	days: [{
		key: DAY_KEY,
		startsAt: DAY_START,
		dayOfMonth: 25,
		weekday: 0,
		month: 9,
		year: 2026,
		isToday: false,
		openCount: 1,
		totalCount: 2,
	}],
	slots: {
		[DAY_KEY]: [
			{
				id: "slot-a",
				startsAt: Date.UTC(2026, 9, 25, 9, 0),
				endsAt: Date.UTC(2026, 9, 25, 9, 20),
				available: true,
				reason: null,
				seatsRemaining: null,
			},
			{
				id: "slot-b",
				startsAt: Date.UTC(2026, 9, 25, 15, 0),
				endsAt: Date.UTC(2026, 9, 25, 15, 20),
				available: false,
				reason: "taken",
				seatsRemaining: null,
			},
		],
	},
	bands: {
		[DAY_KEY]: [
			{ startsAt: Date.UTC(2026, 9, 25, 9, 0), endsAt: Date.UTC(2026, 9, 25, 12, 0) },
			{ startsAt: Date.UTC(2026, 9, 25, 14, 0), endsAt: Date.UTC(2026, 9, 25, 17, 0) },
		],
	},
	bookableFrom: Date.UTC(2026, 9, 25, 8, 0),
	windowStart: DAY_START,
	windowEnd: Date.UTC(2026, 11, 1),
	closed: false,
	closedReason: null,
};

Deno.test("minuteOfDay / instantOf round-trip on a fall-back day", () => {
	assertEquals(minuteOfDay(START_1420, TZ), 14 * 60 + 20);
	assertEquals(instantOf(DAY_START, 14 * 60 + 20, TZ), START_1420);
	// Before the transition (01:30 BST) the same rule still lands on the clock's own minute.
	const early = instantOf(DAY_START, 90, TZ);
	assertEquals(minuteOfDay(early, TZ), 90);
});

Deno.test("customStartBounds spans the first band's start to the last band's end less the duration", () => {
	assertEquals(customStartBounds(grid, DAY_KEY), { min: 9 * 60, max: 17 * 60 - 20 });
	assertEquals(customStartBounds(grid, "2026-10-26"), null);
});

Deno.test("customStartProblem: the band, the notice floor and a held slot each refuse in words", () => {
	// Inside a band, clear of the held 15:00 slot.
	assertEquals(customStartProblem(grid, DAY_KEY, START_1420), null);
	assertEquals(customEnd(START_1420, grid), START_1420 + 20 * 60_000);
	// 12:50 falls between the two bands.
	assertEquals(
		customStartProblem(grid, DAY_KEY, Date.UTC(2026, 9, 25, 12, 50)),
		"Outside the hours this provider takes calls.",
	);
	// 11:50 starts inside the morning band but runs past its end.
	assertEquals(
		customStartProblem(grid, DAY_KEY, Date.UTC(2026, 9, 25, 11, 50)),
		"Outside the hours this provider takes calls.",
	);
	// 14:50 overlaps the 15:00 booking.
	assertEquals(
		customStartProblem(grid, DAY_KEY, Date.UTC(2026, 9, 25, 14, 50)),
		"That overlaps a time somebody has already booked.",
	);
	// Before the notice floor.
	assertEquals(
		customStartProblem(grid, DAY_KEY, Date.UTC(2026, 9, 25, 7, 0)),
		"Too soon — this provider needs more notice.",
	);
});

Deno.test("flavour and platform defaults", () => {
	const offer = {
		acceptsCalls: true,
		courtesyEnabled: true,
		courtesyDurationMinutes: 20,
		paidEnabled: true,
		paidDurationMinutes: 45,
		feeAmountMinor: 7500,
		feeCurrency: "GBP",
		agendaRequired: false,
		platforms: ["google" as const, "zoom" as const],
	};
	assertEquals(defaultCallType(offer), "courtesy");
	assertEquals(defaultCallType({ ...offer, courtesyEnabled: false }), "paid");
	assertEquals(defaultPlatform(offer.platforms), null);
	assertEquals(defaultPlatform(["zoom"]), "zoom");
	assertEquals(defaultPlatform([]), null);
	assertEquals(platformOptions(offer.platforms), [
		{ value: "google", label: "Google Meet" },
		{ value: "zoom", label: "Zoom" },
	]);
});
