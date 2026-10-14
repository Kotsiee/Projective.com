import { assertEquals } from "@std/assert";
import { parseRRule, type RRuleRefusal, serialiseRRule } from "./rrule.ts";

/** The parser's refusals and the serialiser's canonical form. */

function refusalOf(s: string): RRuleRefusal | null {
	const r = parseRRule(s);
	return r.ok ? null : r.reason;
}

Deno.test("unsupported parts are refused by name, never ignored", () => {
	assertEquals(refusalOf(""), "empty");
	assertEquals(refusalOf("RRULE:"), "empty");
	assertEquals(refusalOf("FREQ"), "malformed");
	assertEquals(refusalOf("BYDAY=MO"), "missing_freq");
	assertEquals(refusalOf("FREQ=HOURLY"), "freq_unsupported");
	assertEquals(refusalOf("FREQ=FORTNIGHTLY"), "invalid_value");
	assertEquals(refusalOf("FREQ=WEEKLY;COUNT=10"), "count_unsupported");
	assertEquals(refusalOf("FREQ=DAILY;BYHOUR=9"), "time_of_day_unsupported");
	assertEquals(refusalOf("FREQ=DAILY;BYMINUTE=30"), "time_of_day_unsupported");
	assertEquals(refusalOf("FREQ=YEARLY;BYWEEKNO=20"), "part_unsupported");
	assertEquals(refusalOf("FREQ=YEARLY;X-NAME=1"), "part_unsupported");
	assertEquals(refusalOf("FREQ=WEEKLY;FREQ=DAILY"), "duplicate_part");
	assertEquals(refusalOf("FREQ=WEEKLY;BYDAY=2MO"), "ordinal_not_allowed");
	assertEquals(refusalOf("FREQ=DAILY;BYDAY=-1FR"), "ordinal_not_allowed");
	assertEquals(refusalOf("FREQ=MONTHLY;BYDAY=6MO"), "invalid_value");
	assertEquals(refusalOf("FREQ=WEEKLY;BYMONTHDAY=1"), "monthday_not_allowed");
	assertEquals(refusalOf("FREQ=MONTHLY;BYMONTHDAY=0"), "invalid_value");
	assertEquals(refusalOf("FREQ=MONTHLY;BYMONTHDAY=32"), "invalid_value");
	assertEquals(refusalOf("FREQ=YEARLY;BYMONTH=13"), "invalid_value");
	assertEquals(refusalOf("FREQ=MONTHLY;INTERVAL=0"), "invalid_value");
	assertEquals(refusalOf("FREQ=MONTHLY;BYSETPOS=1"), "setpos_needs_by_part");
	assertEquals(refusalOf("FREQ=WEEKLY;UNTIL=20261231T235959Z"), "until_not_a_date");
	assertEquals(refusalOf("FREQ=WEEKLY;UNTIL=20260230"), "until_not_a_date");
	assertEquals(refusalOf("FREQ=WEEKLY;WKST=XX"), "invalid_value");
});

Deno.test("a refusal carries the offending part and its copy", () => {
	const r = parseRRule("FREQ=WEEKLY;COUNT=4");
	if (r.ok) throw new Error("expected a refusal");
	assertEquals(r.part, "COUNT");
	assertEquals(r.message, "COUNT is not supported — set an end date instead.");
});

Deno.test("serialise emits the canonical order and omits the defaults", () => {
	const cases: [string, string][] = [
		["WKST=SU;BYDAY=WE;INTERVAL=2;FREQ=WEEKLY", "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;WKST=SU"],
		["FREQ=WEEKLY;INTERVAL=1;WKST=MO;BYDAY=FR,MO,FR", "FREQ=WEEKLY;BYDAY=MO,FR"],
		[
			"FREQ=MONTHLY;BYDAY=SA,SU,MO,TU,WE;BYMONTHDAY=12",
			"FREQ=MONTHLY;BYMONTHDAY=12;BYDAY=SU,MO,TU,WE,SA",
		],
		[
			"UNTIL=20261231;BYSETPOS=-1;BYDAY=FR,MO;FREQ=MONTHLY",
			"FREQ=MONTHLY;BYDAY=MO,FR;BYSETPOS=-1;UNTIL=20261231",
		],
		["FREQ=YEARLY;BYMONTHDAY=29;BYMONTH=2", "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29"],
		["FREQ=MONTHLY;BYMONTHDAY=15,1,-1", "FREQ=MONTHLY;BYMONTHDAY=-1,1,15"],
		["FREQ=MONTHLY;BYDAY=+2TU", "FREQ=MONTHLY;BYDAY=2TU"],
	];
	for (const [input, canonical] of cases) {
		const parsed = parseRRule(input);
		if (!parsed.ok) throw new Error(`${input} refused: ${parsed.reason}`);
		assertEquals(serialiseRRule(parsed.value), canonical, input);
	}
});
