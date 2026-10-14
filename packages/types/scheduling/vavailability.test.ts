import { assertEquals } from "@std/assert";
import type { IsoDate } from "./civil.ts";
import { toVAvailability } from "./ics.ts";
import type { AvailabilityRuleDraft } from "./recurrence.ts";

/**
 * The RFC 7953 export: add rules travel as RRULEs, and every date precedence changed is excluded
 * from them and re-emitted evaluated, so a consumer without precedence still sees the right day.
 */

const d = (s: string) => s as IsoDate;

function rule(
	over: Partial<AvailabilityRuleDraft> & Pick<AvailabilityRuleDraft, "id" | "pattern">,
): AvailabilityRuleDraft {
	return {
		layer: "working_hours",
		effect: "add",
		condition: { unlessWeekdays: [] },
		bands: [{ start: 540, end: 1020 }],
		startsOn: d("2026-01-05"),
		endsOn: null,
		priority: 50,
		label: "",
		active: true,
		...over,
	};
}

const PRESET = {
	timezone: "Europe/London",
	rules: [
		rule({
			id: "weekdays",
			pattern: { type: "weekly", days: [1, 2, 3, 4, 5], interval: 1 },
			label: "Weekdays",
		}),
		rule({
			id: "skip",
			effect: "subtract",
			pattern: { type: "monthly_date", days: [12], interval: 1 },
			condition: { unlessWeekdays: [4, 5] },
			bands: [],
		}),
		rule({
			id: "21st",
			effect: "replace",
			pattern: { type: "monthly_date", days: [21], interval: 1 },
			bands: [{ start: 900, end: 1020 }],
		}),
	],
};

Deno.test("add rules export as RRULEs; changed dates are excluded and re-emitted evaluated", () => {
	const text = toVAvailability(PRESET, { from: d("2026-10-01"), to: d("2026-10-31") }, {
		stampIso: "2026-10-14T00:00:00Z",
		uid: "preset-1",
		name: "General",
	});
	assertEquals(text.endsWith("\r\n"), true);
	assertEquals(text.split("\r\n").filter(Boolean), [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Projective//Availability//EN",
		"CALSCALE:GREGORIAN",
		"BEGIN:VAVAILABILITY",
		"UID:preset-1",
		"DTSTAMP:20261014T000000Z",
		"SUMMARY:General",
		"DTSTART;TZID=Europe/London:20261001T000000",
		"DTEND;TZID=Europe/London:20261101T000000",
		"BEGIN:AVAILABLE",
		"UID:weekdays-0",
		"DTSTAMP:20261014T000000Z",
		"DTSTART;TZID=Europe/London:20260105T090000",
		"DTEND;TZID=Europe/London:20260105T170000",
		"RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
		"EXDATE;TZID=Europe/London:20261012T090000,20261021T090000",
		"SUMMARY:Weekdays",
		"END:AVAILABLE",
		"BEGIN:AVAILABLE",
		"UID:2026-10-21-0-evaluated",
		"DTSTAMP:20261014T000000Z",
		"DTSTART;TZID=Europe/London:20261021T150000",
		"DTEND;TZID=Europe/London:20261021T170000",
		"END:AVAILABLE",
		"END:VAVAILABILITY",
		"END:VCALENDAR",
	]);
});

Deno.test("UNTIL beside a zoned DTSTART is the UTC instant of the last start", () => {
	const bounded = {
		timezone: "Europe/London",
		rules: [
			rule({
				id: "autumn",
				pattern: { type: "weekly", days: [3], interval: 1 },
				endsOn: d("2026-12-30"),
			}),
		],
	};
	const text = toVAvailability(bounded, { from: d("2026-10-01"), to: d("2026-10-31") });
	assertEquals(text.includes("RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261230T090000Z\r\n"), true, text);
	assertEquals(text.includes("DTSTART;TZID=Europe/London:20260107T090000"), true, text);
});

Deno.test("the call layer exports its clipped windows as evaluated instances", () => {
	const p = {
		timezone: "UTC",
		rules: [
			rule({ id: "work", pattern: { type: "weekly", days: [1], interval: 1 } }),
			rule({
				id: "calls",
				layer: "call_window",
				pattern: { type: "weekly", days: [1], interval: 1 },
				bands: [{ start: 480, end: 600 }],
			}),
		],
	};
	const text = toVAvailability(p, { from: d("2026-10-12"), to: d("2026-10-12") }, {
		layer: "call_window",
	});
	assertEquals(text.includes("EXDATE;TZID=UTC:20261012T080000"), true, text);
	assertEquals(
		text.includes("DTSTART;TZID=UTC:20261012T090000\r\nDTEND;TZID=UTC:20261012T100000"),
		true,
		text,
	);
});
