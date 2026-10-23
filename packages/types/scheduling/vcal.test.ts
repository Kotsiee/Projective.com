import { assert, assertEquals } from "@std/assert";
import { parseIcsCalendar } from "./ics.ts";
import {
	decodeQuotedPrintable,
	joinQuotedPrintableLines,
	parseVcalOffset,
	vcalRuleToRRule,
	vcalUnescape,
} from "./vcal.ts";

function vcs(...lines: string[]): string {
	return lines.join("\r\n") + "\r\n";
}

// #region Quoted-printable
Deno.test("quoted-printable decodes UTF-8 bytes, not characters", () => {
	assertEquals(decodeQuotedPrintable("Caf=C3=A9 au lait"), "Café au lait");
});

Deno.test("quoted-printable honours the line's CHARSET", () => {
	assertEquals(decodeQuotedPrintable("Caf=E9", "ISO-8859-1"), "Café");
});

Deno.test("an unknown CHARSET falls back to UTF-8 rather than failing the entry", () => {
	assertEquals(decodeQuotedPrintable("ok=21", "x-not-a-charset"), "ok!");
});

Deno.test("a stray = that is not an escape is kept", () => {
	assertEquals(decodeQuotedPrintable("a=zz"), "a=zz");
});

Deno.test("soft line breaks rejoin only quoted-printable properties", () => {
	assertEquals(
		joinQuotedPrintableLines([
			"DESCRIPTION;ENCODING=QUOTED-PRINTABLE:Line one=0D=0A=",
			"Line two",
			"URL:https://example.test/?a=",
			"SUMMARY:Next",
		]),
		[
			"DESCRIPTION;ENCODING=QUOTED-PRINTABLE:Line one=0D=0ALine two",
			"URL:https://example.test/?a=",
			"SUMMARY:Next",
		],
	);
});
// #endregion

// #region Text and zone
Deno.test("vCalendar text unescapes only its own escapes", () => {
	assertEquals(vcalUnescape("C:\\new \\; a\\, b \\\\ end"), "C:\\new ; a, b \\ end");
});

Deno.test("a TZ offset is read in all three spellings", () => {
	assertEquals(parseVcalOffset("-05:00"), -5 * 3_600_000);
	assertEquals(parseVcalOffset("+0530"), 5.5 * 3_600_000);
	assertEquals(parseVcalOffset("+01"), 3_600_000);
	assertEquals(parseVcalOffset("Europe/London"), null);
});
// #endregion

// #region Repeat rules
Deno.test("each vCalendar repeat form becomes its RRULE", () => {
	const rule = (s: string) => {
		const r = vcalRuleToRRule(s);
		return r.ok ? r.rrule : r.reason;
	};
	assertEquals(rule("W1 MO TH #10"), "FREQ=WEEKLY;BYDAY=MO,TH;COUNT=10");
	assertEquals(rule("D2 #0"), "FREQ=DAILY;INTERVAL=2");
	assertEquals(rule("MD1 1 LD 20261231T000000Z"), "FREQ=MONTHLY;BYMONTHDAY=1,-1;UNTIL=20261231T000000Z");
	assertEquals(rule("MD1 2- #3"), "FREQ=MONTHLY;BYMONTHDAY=-2;COUNT=3");
	assertEquals(rule("MP1 1+ MO 1- FR #5"), "FREQ=MONTHLY;BYDAY=1MO,-1FR;COUNT=5");
	assertEquals(rule("MP1 1+ 3+ TU #0"), "FREQ=MONTHLY;BYDAY=1TU,3TU");
	assertEquals(rule("YM1 6 12 #3"), "FREQ=YEARLY;BYMONTH=6,12;COUNT=3");
});

Deno.test("a rule with no end repeats twice, as vCalendar 1.0 specifies", () => {
	assertEquals(vcalRuleToRRule("D1"), { ok: true, rrule: "FREQ=DAILY;COUNT=2" });
});

Deno.test("forms the expander cannot honour are refused with a reason", () => {
	assertEquals(vcalRuleToRRule("YD1 1 100 #0").ok, false);
	const times = vcalRuleToRRule("D1 0800 1700 #3");
	assert(!times.ok && times.reason.includes("times of day"));
	assertEquals(vcalRuleToRRule("every tuesday").ok, false);
	assertEquals(vcalRuleToRRule("MP1 MO").ok, false);
});
// #endregion

// #region A whole file
Deno.test("a .vcs reads its TZ, decodes quoted-printable text and expands its repeat rule", () => {
	const file = vcs(
		"BEGIN:VCALENDAR",
		"VERSION:1.0",
		"TZ:-05:00",
		"BEGIN:VEVENT",
		"SUMMARY;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Caf=C3=A9 planning",
		"DESCRIPTION;QUOTED-PRINTABLE:Agenda=0D=0A=",
		"Item one",
		"DTSTART:20260706T090000",
		"DTEND:20260706T100000",
		"RRULE:W1 MO #2",
		"END:VEVENT",
		"END:VCALENDAR",
	);
	const result = parseIcsCalendar(file, { timezone: "Europe/London" });

	assertEquals(result.format, "vcalendar");
	assertEquals(result.events.length, 2);
	assertEquals(result.events[0].summary, "Café planning");
	assertEquals(result.events[0].description, "Agenda\nItem one");
	assertEquals(result.events[0].start, Date.UTC(2026, 6, 6, 14));
	assertEquals(result.events[1].start, Date.UTC(2026, 6, 13, 14));
	assertEquals(result.events[1].end - result.events[1].start, 3_600_000);
	assertEquals(result.warnings, []);
});

Deno.test("a .vcs with no TZ is floating and says which zone it was read in", () => {
	const file = vcs(
		"BEGIN:VCALENDAR",
		"VERSION:1.0",
		"BEGIN:VEVENT",
		"SUMMARY:Dentist",
		"DTSTART:20260706T090000",
		"DTEND:20260706T093000",
		"END:VEVENT",
		"END:VCALENDAR",
	);
	const result = parseIcsCalendar(file, { timezone: "UTC" });
	assertEquals(result.events[0].start, Date.UTC(2026, 6, 6, 9));
	assert(result.warnings.some((w) => w.includes("read in UTC")));
});

Deno.test("an unexpandable vCalendar rule keeps the first occurrence and says why", () => {
	const file = vcs(
		"BEGIN:VCALENDAR",
		"VERSION:1.0",
		"BEGIN:VEVENT",
		"SUMMARY:Year planner",
		"DTSTART:20260706T090000Z",
		"DTEND:20260706T100000Z",
		"RRULE:YD1 1 100 #0",
		"END:VEVENT",
		"END:VCALENDAR",
	);
	const result = parseIcsCalendar(file);
	assertEquals(result.events.length, 1);
	assert(result.warnings.some((w) => w.includes("Year planner") && w.includes("first occurrence")));
});
// #endregion
