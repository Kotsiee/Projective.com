import { assertEquals, assertThrows } from "@std/assert";
import type { IsoDate } from "./civil.ts";
import {
	AvailabilityRuleDraftSchema,
	draftToRRule,
	RecurrenceError,
	type RecurrenceInput,
	rruleToDraft,
	type RulePattern,
} from "./recurrence.ts";

/** The plan §5.3 normalisation table, the authoring refusals, and `rruleToDraft`'s equivalences. */

const START = "2026-10-06" as IsoDate;

function input(
	pattern: RulePattern,
	unlessWeekdays: number[] = [],
	endsOn: IsoDate | null = null,
): RecurrenceInput {
	return { pattern, condition: { unlessWeekdays }, startsOn: START, endsOn };
}

Deno.test("the plan §5.3 table compiles to its RRULEs", () => {
	assertEquals(
		draftToRRule(input({ type: "weekly", days: [1, 2, 3, 4, 5], interval: 1 })),
		"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
	);
	assertEquals(
		draftToRRule(input({ type: "weekly", days: [3], interval: 2 })),
		"FREQ=WEEKLY;INTERVAL=2;BYDAY=WE",
	);
	assertEquals(
		draftToRRule(input({ type: "monthly_date", days: [1, 15], interval: 1 })),
		"FREQ=MONTHLY;BYMONTHDAY=1,15",
	);
	assertEquals(
		draftToRRule(input({ type: "monthly_weekday", ordinal: -1, weekday: 5, interval: 1 })),
		"FREQ=MONTHLY;BYDAY=-1FR",
	);
	assertEquals(
		draftToRRule(input({ type: "monthly_date", days: [12], interval: 1 }, [4, 5])),
		"FREQ=MONTHLY;BYMONTHDAY=12;BYDAY=SU,MO,TU,WE,SA",
	);
	assertEquals(
		draftToRRule(input({ type: "monthly_date", days: [21], interval: 1 })),
		"FREQ=MONTHLY;BYMONTHDAY=21",
	);
});

Deno.test("the other patterns compile, an end date becomes UNTIL", () => {
	assertEquals(
		draftToRRule(input({ type: "yearly", month: 2, day: 29 }, [0, 6])),
		"FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;BYDAY=MO,TU,WE,TH,FR",
	);
	assertEquals(
		draftToRRule({ ...input({ type: "once", date: START }) }),
		"FREQ=DAILY;UNTIL=20261006",
	);
	assertEquals(
		draftToRRule(input({ type: "weekly", days: [5, 1], interval: 1 }, [], "2026-12-31" as IsoDate)),
		"FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20261231",
	);
});

Deno.test("a condition RRULE cannot express is refused, never approximated", () => {
	assertThrows(
		() => draftToRRule(input({ type: "weekly", days: [1], interval: 1 }, [2])),
		RecurrenceError,
	);
	assertThrows(
		() =>
			draftToRRule(input({ type: "monthly_weekday", ordinal: 2, weekday: 2, interval: 1 }, [4])),
		RecurrenceError,
	);
	assertThrows(() => draftToRRule(input({ type: "once", date: START }, [1])), RecurrenceError);
	assertThrows(
		() => draftToRRule(input({ type: "once", date: "2026-10-07" as IsoDate })),
		RecurrenceError,
	);
	assertThrows(
		() =>
			draftToRRule(
				input({ type: "monthly_date", days: [1], interval: 1 }, [], "2026-01-01" as IsoDate),
			),
		RecurrenceError,
	);
});

Deno.test("the draft schema reports a refusal under condition", () => {
	const result = AvailabilityRuleDraftSchema.safeParse({
		id: "r1",
		layer: "working_hours",
		effect: "add",
		pattern: { type: "weekly", days: [1], interval: 1 },
		condition: { unlessWeekdays: [2] },
		bands: [{ start: 540, end: 1020 }],
		startsOn: START,
		endsOn: null,
	});
	assertEquals(result.success, false);
	assertEquals(result.error?.issues[0].path, ["condition"]);
});

Deno.test("the draft schema applies its defaults and refuses a midnight-crossing band", () => {
	const base = {
		id: "r1",
		layer: "call_window",
		effect: "add",
		pattern: { type: "monthly_date", days: [12], interval: 1 },
		bands: [{ start: 540, end: 1020 }],
		startsOn: START,
		endsOn: null,
	};
	const ok = AvailabilityRuleDraftSchema.parse(base);
	assertEquals([ok.priority, ok.label, ok.active, ok.condition.unlessWeekdays], [50, "", true, []]);
	assertEquals(
		AvailabilityRuleDraftSchema.safeParse({ ...base, bands: [{ start: 1380, end: 60 }] }).success,
		false,
	);
	assertEquals(
		AvailabilityRuleDraftSchema.safeParse({
			...base,
			pattern: { type: "yearly", month: 2, day: 30 },
		}).success,
		false,
	);
});

Deno.test("rruleToDraft reads equivalent spellings and refuses what no pattern expresses", () => {
	const weekly = { condition: { unlessWeekdays: [] }, endsOn: null };
	assertEquals(rruleToDraft("FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1", START), {
		...weekly,
		pattern: { type: "monthly_weekday", ordinal: -1, weekday: 5, interval: 1 },
	});
	assertEquals(rruleToDraft("FREQ=DAILY", START), {
		...weekly,
		pattern: { type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], interval: 1 },
	});
	assertEquals(rruleToDraft("FREQ=WEEKLY", START), {
		...weekly,
		pattern: { type: "weekly", days: [2], interval: 1 },
	});
	assertEquals(rruleToDraft("FREQ=MONTHLY", START), {
		...weekly,
		pattern: { type: "monthly_date", days: [6], interval: 1 },
	});
	assertEquals(rruleToDraft("FREQ=YEARLY", START), {
		...weekly,
		pattern: { type: "yearly", month: 10, day: 6 },
	});
	assertEquals(rruleToDraft("FREQ=MONTHLY;BYMONTHDAY=12;BYDAY=TH,FR", START), {
		pattern: { type: "monthly_date", days: [12], interval: 1 },
		condition: { unlessWeekdays: [0, 1, 2, 3, 6] },
		endsOn: null,
	});
	for (
		const unrepresentable of [
			"FREQ=DAILY;INTERVAL=2",
			"FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;WKST=SU",
			"FREQ=WEEKLY;BYDAY=MO;BYSETPOS=1",
			"FREQ=MONTHLY;BYDAY=5FR",
			"FREQ=MONTHLY;BYDAY=1MO,3MO",
			"FREQ=MONTHLY;BYMONTH=3;BYMONTHDAY=1",
			"FREQ=YEARLY;INTERVAL=2",
			"FREQ=YEARLY;BYMONTHDAY=1",
			"FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
			"FREQ=WEEKLY;BYDAY=MO;UNTIL=20260101",
			"FREQ=WEEKLY;COUNT=3",
		]
	) {
		assertEquals(rruleToDraft(unrepresentable, START), null, unrepresentable);
	}
});
