import { assert, assertEquals } from "@std/assert";
import { parseIcsCalendar } from "./ics.ts";

// #region Helpers
function ics(...lines: string[]): string {
	return lines.join("\r\n") + "\r\n";
}

function calendar(...events: string[][]): string {
	return ics(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Projective//Test//EN",
		...events.flatMap((e) => ["BEGIN:VEVENT", ...e, "END:VEVENT"]),
		"END:VCALENDAR",
	);
}

const H = 3_600_000;
// #endregion

Deno.test("a weekly series keeps its wall-clock time across a DST change", () => {
	const { events } = parseIcsCalendar(calendar([
		"UID:standup@test",
		"DTSTART;TZID=Europe/London:20260319T090000",
		"DTEND;TZID=Europe/London:20260319T093000",
		"RRULE:FREQ=WEEKLY;COUNT=3",
		"SUMMARY:Standup",
	]));
	assertEquals(events.map((e) => e.start), [
		Date.UTC(2026, 2, 19, 9),
		Date.UTC(2026, 2, 26, 9),
		Date.UTC(2026, 3, 2, 8),
	]);
	assert(events.every((e) => e.end - e.start === H / 2));
	assert(events.every((e) => e.uid === "standup@test"));
});

Deno.test("a date-time UNTIL excludes an occurrence later on its own day", () => {
	const { events } = parseIcsCalendar(calendar([
		"UID:until@test",
		"DTSTART:20260701T100000Z",
		"DTEND:20260701T110000Z",
		"RRULE:FREQ=DAILY;UNTIL=20260703T090000Z",
		"SUMMARY:Daily",
	]));
	assertEquals(events.map((e) => e.start), [Date.UTC(2026, 6, 1, 10), Date.UTC(2026, 6, 2, 10)]);
});

Deno.test("EXDATE removes an occurrence after COUNT, and RDATE adds one", () => {
	const { events } = parseIcsCalendar(calendar([
		"UID:exrd@test",
		"DTSTART:20260701T100000Z",
		"DTEND:20260701T110000Z",
		"RRULE:FREQ=WEEKLY;COUNT=4",
		"EXDATE:20260708T100000Z",
		"RDATE:20260710T150000Z",
		"SUMMARY:Weekly",
	]));
	assertEquals(events.map((e) => e.start), [
		Date.UTC(2026, 6, 1, 10),
		Date.UTC(2026, 6, 10, 15),
		Date.UTC(2026, 6, 15, 10),
		Date.UTC(2026, 6, 22, 10),
	]);
});

Deno.test("a RECURRENCE-ID override replaces its occurrence, even when it comes first", () => {
	const { events } = parseIcsCalendar(calendar(
		[
			"UID:review@test",
			"RECURRENCE-ID:20260702T100000Z",
			"DTSTART:20260702T140000Z",
			"DTEND:20260702T150000Z",
			"SUMMARY:Review (moved)",
		],
		[
			"UID:review@test",
			"DTSTART:20260701T100000Z",
			"DTEND:20260701T110000Z",
			"RRULE:FREQ=DAILY;COUNT=3",
			"SUMMARY:Review",
		],
	));
	assertEquals(events.length, 3);
	assertEquals(events.map((e) => e.summary), ["Review", "Review (moved)", "Review"]);
	assertEquals(events[1].start, Date.UTC(2026, 6, 2, 14));
});

Deno.test("an open series is clipped to the window, and the clipping is said once", () => {
	const { events, warnings } = parseIcsCalendar(
		calendar(
			[
				"UID:a@test",
				"DTSTART:20200106T090000Z",
				"DTEND:20200106T093000Z",
				"RRULE:FREQ=WEEKLY",
				"SUMMARY:Monday sync",
			],
			[
				"UID:b@test",
				"DTSTART:20200107T090000Z",
				"DTEND:20200107T093000Z",
				"RRULE:FREQ=WEEKLY",
				"SUMMARY:Tuesday sync",
			],
		),
		{ recurrenceWindow: { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 1, 1) } },
	);
	assertEquals(events.filter((e) => e.summary === "Monday sync").map((e) => e.start), [
		Date.UTC(2026, 0, 5, 9),
		Date.UTC(2026, 0, 12, 9),
		Date.UTC(2026, 0, 19, 9),
		Date.UTC(2026, 0, 26, 9),
	]);
	const clipped = warnings.filter((w) => w.includes("repeating"));
	assertEquals(clipped.length, 1);
	assert(clipped[0].startsWith("2 repeating events"));
	assert(clipped[0].includes("2026-01-01 – 2026-02-01"));
});

Deno.test("a rule the engine refuses keeps its first occurrence and says why", () => {
	const { events, warnings } = parseIcsCalendar(calendar([
		"UID:hourly@test",
		"DTSTART:20260701T090000Z",
		"DTEND:20260701T093000Z",
		"RRULE:FREQ=DAILY;BYHOUR=9,17",
		"SUMMARY:Pills",
	]));
	assertEquals(events.length, 1);
	assert(warnings.some((w) => w.includes("Pills") && w.includes("first occurrence")));
});

Deno.test("DTSTART is the first occurrence even when the rule would not select it", () => {
	const { events } = parseIcsCalendar(calendar([
		"UID:sync@test",
		"DTSTART:20260701T100000Z",
		"DTEND:20260701T110000Z",
		"RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=2",
		"SUMMARY:Off-cycle",
	]));
	assertEquals(events.map((e) => e.start), [Date.UTC(2026, 6, 1, 10), Date.UTC(2026, 6, 3, 10)]);
});

Deno.test("an all-day series stays midnight to midnight on the short DST day", () => {
	const { events } = parseIcsCalendar(
		calendar([
			"UID:leave@test",
			"DTSTART;VALUE=DATE:20260328",
			"DTEND;VALUE=DATE:20260329",
			"RRULE:FREQ=DAILY;COUNT=2",
			"SUMMARY:Leave",
		]),
		{ timezone: "Europe/London" },
	);
	assertEquals(events.length, 2);
	assert(events.every((e) => e.allDay));
	assertEquals(events[1].start, Date.UTC(2026, 2, 29, 0));
	assertEquals(events[1].end, Date.UTC(2026, 2, 29, 23));
});

Deno.test("an all-day EXDATE removes that day from a timed series", () => {
	const { events } = parseIcsCalendar(calendar([
		"UID:class@test",
		"DTSTART:20260701T100000Z",
		"DTEND:20260701T110000Z",
		"RRULE:FREQ=DAILY;COUNT=3",
		"EXDATE;VALUE=DATE:20260702",
		"SUMMARY:Class",
	]));
	assertEquals(events.map((e) => e.start), [Date.UTC(2026, 6, 1, 10), Date.UTC(2026, 6, 3, 10)]);
});
