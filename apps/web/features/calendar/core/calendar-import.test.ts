import { assert, assertEquals } from "@std/assert";
import { ICS_MAX_BYTES, ICS_REFUSAL_COPY } from "@projective/types/scheduling";
import {
	checkCalendarFile,
	dragVerdict,
	IMPORT_RECURRENCE_DAYS,
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
Deno.test("a preview names the calendar and sorts its entries", () => {
	const read = previewCalendarText(WORK, "work.ics", CONTEXT);
	assert(read.ok);
	assertEquals(read.preview.calendarName, "Work");
	assertEquals(read.preview.format, "icalendar");
	assertEquals(read.preview.items.map((e) => e.title), ["Earlier", "Later"]);
	assertEquals(read.preview.cancelled, 0);
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
	const { items, warnings } = read.preview;
	assert(items.length > 100);
	assert(items[0].start >= NOW - IMPORT_RECURRENCE_DAYS * DAY);
	assert(items[items.length - 1].start < NOW + IMPORT_RECURRENCE_DAYS * DAY);
	assert(items.every((e) => e.rrule === "FREQ=WEEKLY"), "every occurrence names its series' rule");
	assert(warnings.some((w) => w.startsWith("1 repeating event")));
});

Deno.test("a picked File is checked, read and previewed", async () => {
	const ok = await readCalendarFile(new File([WORK], "work.ics", { type: "text/calendar" }), CONTEXT);
	assert(ok.ok && ok.preview.items.length === 2);
	const refused = await readCalendarFile(new File([WORK], "work.pdf", { type: "" }), CONTEXT);
	assertEquals(refused.ok, false);
});
// #endregion

// #region Native import (Decision #442)
Deno.test("a midnight-to-midnight block is read as a whole day", () => {
	const read = previewCalendarText(
		ics(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"BEGIN:VEVENT",
			"UID:launch@test",
			"DTSTART;TZID=Europe/London:20261120T000000",
			"DTEND;TZID=Europe/London:20261121T000000",
			"SUMMARY:Helios launch",
			"END:VEVENT",
			"END:VCALENDAR",
		),
		"launch.ics",
		CONTEXT,
	);
	assert(read.ok);
	assertEquals(read.preview.items[0].allDay, true);
});

Deno.test("cancelled entries are counted and left out, and a file of nothing else is refused", () => {
	const cancelled = (uid: string) => [
		"BEGIN:VEVENT",
		`UID:${uid}`,
		"DTSTART:20261026T090000Z",
		"DTEND:20261026T100000Z",
		"SUMMARY:Off",
		"STATUS:CANCELLED",
		"END:VEVENT",
	];
	const mixed = WORK.replace("END:VCALENDAR", [...cancelled("c1"), "END:VCALENDAR"].join("\r\n"));
	const read = previewCalendarText(mixed, "work.ics", CONTEXT);
	assert(read.ok);
	assertEquals(read.preview.items.length, 2);
	assertEquals(read.preview.cancelled, 1);
	const only = ics("BEGIN:VCALENDAR", "VERSION:2.0", ...cancelled("c2"), "END:VCALENDAR");
	assertEquals(previewCalendarText(only, "off.ics", CONTEXT).ok, false);
});

Deno.test("a drag in the air is judged by the media type it shows, never refused for a blank one", () => {
	assertEquals(dragVerdict([{ kind: "file", type: "text/calendar" }]), "ok");
	assertEquals(dragVerdict([{ kind: "file", type: "" }]), "ok");
	assertEquals(dragVerdict([{ kind: "file", type: "image/png" }]), "wrong");
	assertEquals(
		dragVerdict([{ kind: "file", type: "text/calendar" }, { kind: "file", type: "" }]),
		"wrong",
	);
	assertEquals(dragVerdict([{ kind: "string", type: "text/plain" }]), "none");
});
// #endregion
