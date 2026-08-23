import { assert, assertEquals, assertThrows } from "@std/assert";
import {
	ICS_MAX_BYTES,
	ICS_MAX_EVENTS,
	icsEventsToCalendarEvents,
	IcsParseError,
	icsUnescape,
	parseIcsCalendar,
	parseIcsDuration,
	unfoldIcsLines,
} from "./ics.ts";

/**
 * The iCalendar reader, tested against the three properties of the format that actually break
 * importers: folding, CRLF, and TEXT escaping. Every case below is written as a REAL file — CRLF
 * terminated, folded where a conforming producer would fold — because a parser that only ever sees
 * hand-written LF fixtures passes its tests and then fails on the first export anyone gives it.
 */

// #region Helpers
/** Join content lines with CRLF and terminate, exactly as `buildIcsCalendar` does. */
function ics(...lines: string[]): string {
	return lines.join("\r\n") + "\r\n";
}

/** A minimal well-formed calendar around the supplied VEVENT body lines. */
function calendar(...event: string[]): string {
	return ics(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Projective//Test//EN",
		"BEGIN:VEVENT",
		...event,
		"END:VEVENT",
		"END:VCALENDAR",
	);
}
// #endregion

// #region Folding
Deno.test("unfoldIcsLines rejoins a folded content line before any field is split", () => {
	// The fold marker — CRLF plus ONE space or tab — is removed whole, so a producer that folds
	// mid-word rejoins with no seam. That is why unfolding cannot be done after the split.
	const folded = ics(
		"DESCRIPTION:This description is long enough that a conforming producer wo",
		" uld have folded it at seventy-five octets, twice over, so that it arrives",
		"\tas three physical lines.",
	);
	const lines = unfoldIcsLines(folded);
	assertEquals(lines.length, 1);
	assert(lines[0].startsWith("DESCRIPTION:This description is long enough"));
	assert(lines[0].endsWith("arrivesas three physical lines."));
	// A tab continuation is as valid as a space one, and the tab itself is the marker, not content.
	assert(!lines[0].includes("\t"));
});

Deno.test("unfolding accepts LF-only input from a lenient producer", () => {
	// Two leading spaces: the first is the fold marker, the second is real content.
	const lines = unfoldIcsLines("SUMMARY:Split\n  over two lines\nLOCATION:Room 2\n");
	assertEquals(lines, ["SUMMARY:Split over two lines", "LOCATION:Room 2"]);
});

Deno.test("a folded SUMMARY survives the whole parse", () => {
	const file = calendar(
		"UID:folded@projective",
		"DTSTART:20260717T090000Z",
		"DTEND:20260717T100000Z",
		"SUMMARY:Quarterly planning with the whole delivery side of the studio and t",
		" he two contractors",
	);
	const { events } = parseIcsCalendar(file);
	assertEquals(
		events[0].summary,
		"Quarterly planning with the whole delivery side of the studio and the two contractors",
	);
});
// #endregion

// #region Escaping
Deno.test("icsUnescape decodes every escape in ONE pass", () => {
	assertEquals(icsUnescape("Smith\\, John"), "Smith, John");
	assertEquals(icsUnescape("a\\;b"), "a;b");
	assertEquals(icsUnescape("line one\\nline two"), "line one\nline two");
	assertEquals(icsUnescape("upper\\Ncase"), "upper\ncase");
	assertEquals(icsUnescape("C:\\\\Users"), "C:\\Users");
});

Deno.test("an escaped backslash followed by a literal n is NOT a newline", () => {
	// The regression a sequential replace chain produces in either order: `\\n` is backslash + "n".
	assertEquals(icsUnescape("path\\\\next"), "path\\next");
	assert(!icsUnescape("path\\\\next").includes("\n"));
});

Deno.test("an unknown escape yields the escaped character, and a trailing backslash survives", () => {
	assertEquals(icsUnescape("a\\qb"), "aqb");
	assertEquals(icsUnescape("trailing\\"), "trailing\\");
});

Deno.test("escaped commas, semicolons and newlines round-trip through a full parse", () => {
	const file = calendar(
		"UID:escaped@projective",
		"DTSTART:20260717T090000Z",
		"DTEND:20260717T093000Z",
		"SUMMARY:Review\\, revise\\; ship",
		"DESCRIPTION:First line\\nSecond line\\, with a comma",
		"LOCATION:Studio\\; floor 2",
	);
	const { events } = parseIcsCalendar(file);
	assertEquals(events[0].summary, "Review, revise; ship");
	assertEquals(events[0].description, "First line\nSecond line, with a comma");
	assertEquals(events[0].location, "Studio; floor 2");
});
// #endregion

// #region Property lines
Deno.test("a quoted parameter containing a colon does not cut the line early", () => {
	const file = calendar(
		'DTSTART;TZID="Europe/London":20260717T090000',
		"UID:quoted@projective",
		'SUMMARY;X-LABEL="Surname, Given: Team":Standup',
	);
	const { events } = parseIcsCalendar(file);
	assertEquals(events[0].summary, "Standup");
});

Deno.test("properties of a nested VALARM never overwrite the event's own", () => {
	const file = ics(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"BEGIN:VEVENT",
		"UID:alarm@projective",
		"DTSTART:20260717T090000Z",
		"DTEND:20260717T093000Z",
		"SUMMARY:Design review",
		"DESCRIPTION:The real agenda",
		"BEGIN:VALARM",
		"ACTION:DISPLAY",
		"DESCRIPTION:Reminder",
		"TRIGGER:-PT10M",
		"END:VALARM",
		"END:VEVENT",
		"END:VCALENDAR",
	);
	const { events } = parseIcsCalendar(file);
	assertEquals(events.length, 1);
	assertEquals(events[0].description, "The real agenda");
});
// #endregion

// #region Time
Deno.test("a Z-suffixed DTSTART is read as an absolute instant", () => {
	const file = calendar(
		"UID:utc@projective",
		"DTSTART:20260717T093000Z",
		"DTEND:20260717T103000Z",
		"SUMMARY:UTC meeting",
	);
	const { events } = parseIcsCalendar(file);
	assertEquals(events[0].start, Date.parse("2026-07-17T09:30:00Z"));
	assertEquals(events[0].end, Date.parse("2026-07-17T10:30:00Z"));
});

Deno.test("a TZID wall-clock time is DST-corrected, not read as UTC", () => {
	const file = calendar(
		"UID:tz@projective",
		"DTSTART;TZID=Europe/London:20260717T100000",
		"DTEND;TZID=Europe/London:20260717T110000",
		"SUMMARY:London morning",
	);
	const { events } = parseIcsCalendar(file);
	// July is BST (UTC+1), so 10:00 local is 09:00Z. Reading it as UTC would be an hour out.
	assertEquals(events[0].start, Date.parse("2026-07-17T09:00:00Z"));
	assertEquals(events[0].end, Date.parse("2026-07-17T10:00:00Z"));
});

Deno.test("a floating time resolves in the supplied zone and says so", () => {
	const file = calendar(
		"UID:floating@projective",
		"DTSTART:20260117T100000",
		"DTEND:20260117T110000",
		"SUMMARY:Winter standup",
	);
	const { events, warnings } = parseIcsCalendar(file, { timezone: "Europe/London" });
	// January is GMT, so 10:00 local is 10:00Z — the assertion that proves the zone was consulted
	// rather than the offset hard-coded.
	assertEquals(events[0].start, Date.parse("2026-01-17T10:00:00Z"));
	assert(warnings.some((w) => w.includes("Europe/London")));
});

Deno.test("an unknown TZID falls back rather than failing the entry", () => {
	const file = calendar(
		"UID:badzone@projective",
		"DTSTART;TZID=Mars/Olympus:20260717T100000",
		"DTEND;TZID=Mars/Olympus:20260717T110000",
		"SUMMARY:Off-world sync",
	);
	const { events } = parseIcsCalendar(file);
	assertEquals(events.length, 1);
	assertEquals(events[0].start, Date.parse("2026-07-17T10:00:00Z"));
});

Deno.test("VALUE=DATE is a whole day and defaults to a day long", () => {
	const file = calendar(
		"UID:allday@projective",
		"DTSTART;VALUE=DATE:20260720",
		"SUMMARY:Public holiday",
	);
	const { events } = parseIcsCalendar(file);
	assert(events[0].allDay);
	assertEquals(events[0].start, Date.UTC(2026, 6, 20));
	assertEquals(events[0].end - events[0].start, 86_400_000);
});

Deno.test("DURATION is honoured when DTEND is absent", () => {
	const file = calendar(
		"UID:dur@projective",
		"DTSTART:20260717T090000Z",
		"DURATION:PT1H30M",
		"SUMMARY:Long standup",
	);
	const { events } = parseIcsCalendar(file);
	assertEquals(events[0].end - events[0].start, 90 * 60_000);
});

Deno.test("parseIcsDuration reads weeks, days and time components", () => {
	assertEquals(parseIcsDuration("P1W"), 7 * 86_400_000);
	assertEquals(parseIcsDuration("P2DT3H"), 2 * 86_400_000 + 3 * 3_600_000);
	assertEquals(parseIcsDuration("PT45M"), 45 * 60_000);
	assertEquals(parseIcsDuration("-PT30M"), -30 * 60_000);
	assertEquals(parseIcsDuration("not a duration"), null);
});

Deno.test("an end at or before the start is widened rather than drawn as zero", () => {
	const file = calendar(
		"UID:zero@projective",
		"DTSTART:20260717T090000Z",
		"DTEND:20260717T090000Z",
		"SUMMARY:Instant",
	);
	const { events } = parseIcsCalendar(file);
	assert(events[0].end > events[0].start);
});
// #endregion

// #region Refusals
Deno.test("an empty file is refused", () => {
	const err = assertThrows(() => parseIcsCalendar("   \r\n  "), IcsParseError);
	assertEquals((err as IcsParseError).code, "empty");
});

Deno.test("a file that is not a calendar is refused", () => {
	const err = assertThrows(
		() => parseIcsCalendar("name,date\r\nStandup,2026-07-17\r\n"),
		IcsParseError,
	);
	assertEquals((err as IcsParseError).code, "not_a_calendar");
});

Deno.test("a truncated calendar is refused rather than importing the fragment", () => {
	const err = assertThrows(
		() =>
			parseIcsCalendar(ics(
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"BEGIN:VEVENT",
				"UID:cut@projective",
				"DTSTART:20260717T090000Z",
			)),
		IcsParseError,
	);
	assertEquals((err as IcsParseError).code, "unterminated");
});

Deno.test("a calendar whose every entry is unusable is refused, not silently empty", () => {
	const err = assertThrows(
		() =>
			parseIcsCalendar(calendar(
				"UID:nostart@projective",
				"SUMMARY:No start time",
			)),
		IcsParseError,
	);
	assertEquals((err as IcsParseError).code, "no_events");
});

Deno.test("one broken entry is skipped with a warning while the rest import", () => {
	const file = ics(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"X-WR-CALNAME:Work",
		"BEGIN:VEVENT",
		"UID:ok@projective",
		"DTSTART:20260717T090000Z",
		"DTEND:20260717T093000Z",
		"SUMMARY:Good one",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"UID:broken@projective",
		"DTSTART:not-a-date",
		"SUMMARY:Bad one",
		"END:VEVENT",
		"END:VCALENDAR",
	);
	const result = parseIcsCalendar(file);
	assertEquals(result.calendarName, "Work");
	assertEquals(result.events.length, 1);
	assertEquals(result.events[0].summary, "Good one");
	assert(result.warnings.some((w) => w.includes("Bad one")));
});

Deno.test("an oversized file is refused before it is scanned", () => {
	const err = assertThrows(() => parseIcsCalendar("x".repeat(5 * 1024 * 1024 + 1)), IcsParseError);
	assertEquals((err as IcsParseError).code, "too_large");
});

Deno.test("the size ceiling counts BYTES, not UTF-16 code units", () => {
	// Three UTF-8 bytes per character, so this is ~7.5 MB of file in 2.6M code units — comfortably
	// under a `String.length` ceiling and comfortably over the 5 MB one the constant actually names.
	const wide = "日".repeat(2_600_000);
	assert(wide.length < ICS_MAX_BYTES, "the fixture must pass a code-unit check to be a regression");
	const err = assertThrows(() => parseIcsCalendar(wide), IcsParseError);
	assertEquals((err as IcsParseError).code, "too_large");
});

Deno.test("a VALUE=DATE entry is anchored at local midnight in the reading zone", () => {
	const file = calendar(
		"UID:allday-tz@projective",
		"DTSTART;VALUE=DATE:20260720",
		"SUMMARY:Public holiday",
	);
	const { events } = parseIcsCalendar(file, { timezone: "America/New_York" });
	// 2026-07-20 00:00 in New York is 04:00 UTC (EDT). Anchoring it at UTC midnight instead puts the
	// block four hours into the 19th locally, so a month grid draws it on both days.
	assertEquals(events[0].start, Date.parse("2026-07-20T04:00:00Z"));
	assertEquals(events[0].end - events[0].start, 86_400_000);
});

Deno.test("a file beyond the event ceiling truncates with a warning", () => {
	const body: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0"];
	for (let i = 0; i < ICS_MAX_EVENTS + 5; i++) {
		body.push(
			"BEGIN:VEVENT",
			`UID:bulk-${i}@projective`,
			"DTSTART:20260717T090000Z",
			"DTEND:20260717T093000Z",
			`SUMMARY:Bulk ${i}`,
			"END:VEVENT",
		);
	}
	body.push("END:VCALENDAR");
	const result = parseIcsCalendar(ics(...body));
	assertEquals(result.events.length, ICS_MAX_EVENTS);
	assert(result.warnings.some((w) => w.includes("first")));
});
// #endregion

// #region Projection
Deno.test("projection stamps the source and carries cancellation through", () => {
	const file = ics(
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"BEGIN:VEVENT",
		"UID:one@projective",
		"DTSTART;VALUE=DATE:20260720",
		"SUMMARY:Away",
		"STATUS:CANCELLED",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"UID:two@projective",
		"DTSTART:20260717T090000Z",
		"DTEND:20260717T093000Z",
		"SUMMARY:Standup",
		"STATUS:TENTATIVE",
		"END:VEVENT",
		"END:VCALENDAR",
	);
	const { events } = parseIcsCalendar(file);
	const projected = icsEventsToCalendarEvents(events, { source: "google", idPrefix: "imp" });

	assertEquals(projected.length, 2);
	assertEquals(projected[0].status, "cancelled");
	assertEquals(projected[0].allDay, true);
	assertEquals(projected[1].status, "tentative");
	assertEquals(projected[0].sources, ["google"]);
	assert(projected[0].id.startsWith("imp-0-"));
	assertEquals(projected[0].kind, "general");
	// The id is bounded by the schema's own 120-character ceiling.
	assert(projected.every((e) => e.id.length <= 120));
});
// #endregion
