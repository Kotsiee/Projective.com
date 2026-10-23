import { assert, assertEquals } from "@std/assert";
import { icsFold } from "../finance/order.ts";
import {
	CALENDAR_CSV_COLUMNS,
	calendarComponentFor,
	serialiseIcsComponent,
	toCalendarCsv,
	toJCal,
} from "./export-formats.ts";
import { parseIcsCalendar, unfoldIcsLines } from "./ics.ts";
import type { CalendarEvent } from "./scheduling.ts";

// #region Fixtures
const STAMP = "2026-10-23T12:00:00.000Z";
const TZ = "Europe/London";

const EVENTS: CalendarEvent[] = [
	{
		id: "evt-1",
		title: "Plan, review; ship \\ now",
		kind: "sync",
		status: "tentative",
		start: Date.UTC(2026, 6, 17, 9),
		end: Date.UTC(2026, 6, 17, 10),
		location: "Room 4, Lisbon",
		meta: "Acme rebrand · Stage sync",
	},
	{
		id: "evt-2",
		title: "Public holiday",
		kind: "holiday",
		allDay: true,
		start: Date.UTC(2026, 6, 19, 23),
		end: Date.UTC(2026, 6, 20, 23),
	},
	{
		id: "evt-3",
		title: "Brand guide due",
		kind: "deadline",
		status: "cancelled",
		start: Date.UTC(2026, 6, 24, 16),
		end: Date.UTC(2026, 6, 24, 16),
	},
];

function document(events: readonly CalendarEvent[] = EVENTS, origin?: string): string {
	return serialiseIcsComponent(
		calendarComponentFor(events, { timezone: TZ, stampIso: STAMP, calendarName: "Work", origin }),
	);
}
// #endregion

// #region iCalendar
Deno.test("every entry is written into ONE calendar object", () => {
	const ics = document();
	assertEquals(ics.match(/BEGIN:VCALENDAR/g)?.length, 1);
	assertEquals(ics.match(/BEGIN:VEVENT/g)?.length, EVENTS.length);
	assert(ics.endsWith("END:VCALENDAR\r\n"));
	assert(!/[^\r]\n/.test(ics), "every line ending is CRLF");
});

Deno.test("an export reads back through the platform's own reader unchanged", () => {
	const parsed = parseIcsCalendar(document(), { timezone: TZ });
	assertEquals(parsed.calendarName, "Work");
	const [timed, allDay, instant] = parsed.events;

	assertEquals(timed.summary, EVENTS[0].title);
	assertEquals(timed.location, EVENTS[0].location);
	assertEquals(timed.description, EVENTS[0].meta);
	assertEquals([timed.start, timed.end], [EVENTS[0].start, EVENTS[0].end]);
	assertEquals(timed.status, "TENTATIVE");
	assertEquals(timed.uid, "evt-1@projective");

	assert(allDay.allDay);
	assertEquals([allDay.start, allDay.end], [EVENTS[1].start, EVENTS[1].end]);

	assertEquals(instant.status, "CANCELLED");
	assertEquals(instant.end - instant.start, 60_000);
});

Deno.test("an all-day entry is written as dates in the calendar's zone", () => {
	const ics = document([EVENTS[1]]);
	assert(ics.includes("DTSTART;VALUE=DATE:20260720\r\n"));
	assert(ics.includes("DTEND;VALUE=DATE:20260721\r\n"));
});

Deno.test("a deadline instant gets a one-minute DTEND, never DTEND equal to DTSTART", () => {
	const ics = document([EVENTS[2]]);
	assert(ics.includes("DTSTART:20260724T160000Z\r\n"));
	assert(ics.includes("DTEND:20260724T160100Z\r\n"));
});

Deno.test("URL and ORGANIZER are written only as absolute same-origin links", () => {
	const withLinks: CalendarEvent = {
		...EVENTS[0],
		href: "/projects/prj-abc/board",
		organiser: { name: "Inês, Duarte", avatar: null, handle: "inesduarte" },
	};
	const ics = unfoldIcsLines(document([withLinks], "https://projective.test/")).join("\n");
	assert(ics.includes("URL:https://projective.test/projects/prj-abc/board"));
	assert(ics.includes('ORGANIZER;CN="Inês, Duarte":https://projective.test/inesduarte'));

	const offsite = document([{ ...withLinks, href: "//evil.test/x" }]);
	assert(!offsite.includes("URL:"));
	assert(!document([withLinks]).includes("ORGANIZER"), "no origin, no link to invent");
});

Deno.test("control characters never reach a TEXT value", () => {
	const ics = document([{ ...EVENTS[0], title: "Bell\u0007 and\u0000 nul" }]);
	assert(ics.includes("SUMMARY:Bell and nul\r\n"));
});
// #endregion

// #region Folding
Deno.test("folding counts octets, so no line of non-ASCII text exceeds 75", () => {
	const ics = document([{ ...EVENTS[0], title: "日本語のタイトル".repeat(12) }]);
	const encoder = new TextEncoder();
	for (const line of ics.split("\r\n")) assert(encoder.encode(line).length <= 75, line);
	assertEquals(parseIcsCalendar(ics).events[0].summary, "日本語のタイトル".repeat(12));
});

Deno.test("folding never splits a surrogate pair", () => {
	const folded = icsFold(`SUMMARY:${"😀".repeat(40)}`);
	for (const line of folded.split("\r\n")) {
		assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(line));
	}
	assertEquals(unfoldIcsLines(folded).join(""), `SUMMARY:${"😀".repeat(40)}`);
});

Deno.test("an ASCII line folds exactly as before: 75, then a space and 74", () => {
	const folded = icsFold("X".repeat(200)).split("\r\n");
	assertEquals(folded.map((l) => l.length), [75, 75, 52]);
	assert(folded.slice(1).every((l) => l.startsWith(" ")));
});
// #endregion

// #region jCal
Deno.test("jCal is the same tree: lower-case names, typed values, text unescaped", () => {
	const jcal = toJCal(calendarComponentFor(EVENTS, { timezone: TZ, stampIso: STAMP }));
	const [name, properties, components] = jcal;
	assertEquals(name, "vcalendar");
	assert(properties.some((p) => p[0] === "version" && p[3] === "2.0"));
	assertEquals(components.length, EVENTS.length);

	const prop = (i: number, key: string) => components[i][1].find((p) => p[0] === key);
	assertEquals(prop(0, "dtstart"), ["dtstart", {}, "date-time", "2026-07-17T09:00:00Z"]);
	assertEquals(prop(0, "summary"), ["summary", {}, "text", EVENTS[0].title]);
	assertEquals(prop(1, "dtstart"), ["dtstart", {}, "date", "2026-07-20"]);
	assertEquals(JSON.parse(JSON.stringify(jcal)), jcal);
});
// #endregion

// #region CSV
Deno.test("CSV writes the importer columns on the calendar's wall clock", () => {
	const rows = toCalendarCsv(EVENTS, { timezone: TZ }).split("\r\n");
	assertEquals(rows[0], CALENDAR_CSV_COLUMNS.join(","));
	assertEquals(
		rows[1],
		'"Plan, review; ship \\ now",2026-07-17,10:00,2026-07-17,11:00,False,Acme rebrand · Stage sync,"Room 4, Lisbon"',
	);
	assertEquals(rows[2], "Public holiday,2026-07-20,,2026-07-20,,True,,");
	assertEquals(rows[3], "Brand guide due,2026-07-24,17:00,2026-07-24,17:00,False,,");
	assertEquals(rows[4], "");
});

Deno.test("CSV neutralises spreadsheet formulas and doubles quotes", () => {
	const csv = toCalendarCsv(
		[
			{ ...EVENTS[0], title: '=HYPERLINK("https://evil.test","Click")', meta: "+1 owed", location: "@home" },
			{ ...EVENTS[0], title: 'He said "go"', meta: undefined, location: undefined },
		],
		{ timezone: TZ },
	);
	const [, injected, quoted] = csv.split("\r\n");
	assert(injected.startsWith(`"'=HYPERLINK(""https://evil.test"",""Click"")"`));
	assert(injected.includes(",'+1 owed,'@home"));
	assert(quoted.startsWith('"He said ""go"""'));
});
// #endregion
