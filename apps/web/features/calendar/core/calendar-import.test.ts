import { assert, assertEquals } from "@std/assert";
import type { CalendarEvent } from "@projective/types/scheduling";
import { ICS_MAX_BYTES, ICS_REFUSAL_COPY } from "@projective/types/scheduling";
import {
	checkCalendarFile,
	IMPORT_RECURRENCE_DAYS,
	importIdPrefix,
	mergeImported,
	previewCalendarText,
	readCalendarFile,
} from "./calendar-import.ts";

const NOW = Date.UTC(2026, 9, 23, 12);
const CONTEXT = { timezone: "Europe/London", now: NOW };
const DAY = 86_400_000;

function ics(...lines: string[]): string {
	return lines.join("\r\n") + "\r\n";
}

const WORK = ics(
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"X-WR-CALNAME:Work",
	"BEGIN:VEVENT",
	"UID:late@test",
	"DTSTART:20261030T090000Z",
	"DTEND:20261030T100000Z",
	"SUMMARY:Later",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:early@test",
	"DTSTART:20261026T090000Z",
	"DTEND:20261026T100000Z",
	"SUMMARY:Earlier",
	"END:VEVENT",
	"END:VCALENDAR",
);

// #region File checks
Deno.test("each offered extension is accepted with the media types systems report for it", () => {
	assertEquals(checkCalendarFile({ name: "Work.ICS", type: "text/calendar", size: 100 }).ok, true);
	assertEquals(checkCalendarFile({ name: "phone.vcs", type: "", size: 100 }).ok, true);
	assertEquals(
		checkCalendarFile({ name: "old.ical", type: "application/octet-stream", size: 100 }).ok,
		true,
	);
	assertEquals(
		checkCalendarFile({ name: "x.ics", type: "text/calendar; charset=utf-8", size: 100 }).ok,
		true,
	);
});

Deno.test("a wrong extension, a contradicting media type or a bad size is refused before reading", () => {
	assertEquals(checkCalendarFile({ name: "photo.png", type: "image/png", size: 100 }).ok, false);
	const renamed = checkCalendarFile({ name: "evil.ics", type: "image/png", size: 100 });
	assert(!renamed.ok && renamed.message.includes("image/png"));
	assertEquals(checkCalendarFile({ name: "a.ics", type: "", size: 0 }), {
		ok: false,
		message: ICS_REFUSAL_COPY.empty,
	});
	assertEquals(checkCalendarFile({ name: "a.ics", type: "", size: ICS_MAX_BYTES + 1 }), {
		ok: false,
		message: ICS_REFUSAL_COPY.too_large,
	});
});
// #endregion

// #region Preview
Deno.test("a preview names the calendar, sorts its entries and stamps the file's prefix", () => {
	const read = previewCalendarText(WORK, "work.ics", CONTEXT);
	assert(read.ok);
	assertEquals(read.preview.calendarName, "Work");
	assertEquals(read.preview.format, "icalendar");
	assertEquals(read.preview.events.map((e) => e.title), ["Earlier", "Later"]);
	assert(read.preview.events.every((e) => e.id.startsWith(`${read.preview.idPrefix}-`)));
	assert(read.preview.events.every((e) => e.sources?.[0] === "ics"));
});

Deno.test("a calendar with no name of its own is named after its file", () => {
	const read = previewCalendarText(WORK.replace("X-WR-CALNAME:Work\r\n", ""), "team.ics", CONTEXT);
	assert(read.ok);
	assertEquals(read.preview.calendarName, "team.ics");
});

Deno.test("a file that is not a calendar is refused in the parser's own words", () => {
	assertEquals(previewCalendarText("Subject,Start\r\nSync,2026-10-23\r\n", "a.ics", CONTEXT), {
		ok: false,
		message: ICS_REFUSAL_COPY.not_a_calendar,
	});
});

Deno.test("a repeating entry is expanded a year either side of the import, and says so", () => {
	const read = previewCalendarText(
		ics(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"BEGIN:VEVENT",
			"UID:weekly@test",
			"DTSTART:20200106T090000Z",
			"DTEND:20200106T093000Z",
			"RRULE:FREQ=WEEKLY",
			"SUMMARY:Sync",
			"END:VEVENT",
			"END:VCALENDAR",
		),
		"sync.ics",
		CONTEXT,
	);
	assert(read.ok);
	const { events, warnings } = read.preview;
	assert(events.length > 100);
	assert(events[0].start >= NOW - IMPORT_RECURRENCE_DAYS * DAY);
	assert(events[events.length - 1].start < NOW + IMPORT_RECURRENCE_DAYS * DAY);
	assert(warnings.some((w) => w.startsWith("1 repeating event")));
});

Deno.test("a picked File is checked, read and previewed", async () => {
	const ok = await readCalendarFile(new File([WORK], "work.ics", { type: "text/calendar" }), CONTEXT);
	assert(ok.ok && ok.preview.events.length === 2);
	const refused = await readCalendarFile(new File([WORK], "work.pdf", { type: "" }), CONTEXT);
	assertEquals(refused.ok, false);
});
// #endregion

// #region Identity
Deno.test("a file's id prefix is stable, fixed-length and never a prefix of another's", () => {
	assertEquals(importIdPrefix("Work.ics"), importIdPrefix("work.ICS"));
	assertEquals(importIdPrefix("a.ics").length, importIdPrefix("a-much-longer-name.ics").length);
	assert(!`${importIdPrefix("work-ics.ics")}-`.startsWith(`${importIdPrefix("work.ics")}-`));
});

Deno.test("importing the same file again replaces its entries and leaves other files alone", () => {
	const first = previewCalendarText(WORK, "work.ics", CONTEXT);
	const other = previewCalendarText(WORK, "home.ics", CONTEXT);
	assert(first.ok && other.ok);
	let imported: CalendarEvent[] = mergeImported([], first.preview);
	imported = mergeImported(imported, other.preview);
	imported = mergeImported(imported, first.preview);
	assertEquals(imported.length, 4);
	assertEquals(new Set(imported.map((e) => e.id)).size, 4);
});
// #endregion
