import { assertEquals } from "@std/assert";
import type {
	AvailabilityRuleDraft,
	CalendarEvent,
	IsoDate,
	RulePattern,
} from "@projective/types/scheduling";
import { ENTRY_BATCH_MAX } from "@projective/types/scheduling";
import {
	describeRepeat,
	fromRRule,
	pastNotice,
	presetDraft,
	presetOf,
	repeatAnchor,
	type RepeatDraft,
	repeatSentence,
	sameRepeatPattern,
	seriesMasterOf,
	seriesOf,
	templateRepeat,
	toRRule,
} from "./event-recurrence.ts";

const TZ = "Europe/London";
// Wednesday 2026-03-25, 09:00 GMT — the Sunday after it, clocks go forward.
const START = Date.UTC(2026, 2, 25, 9, 0);
const A = repeatAnchor(START, TZ);
const HOUR = 3_600_000;

const event: CalendarEvent = {
	id: "draft-1",
	title: "Standup",
	kind: "sync",
	start: START,
	end: START + HOUR / 4,
};

Deno.test("an entry's repeat reads aloud, from its own rule or its master's", () => {
	const said = (recurrenceRule: string) => repeatSentence({ ...event, recurrenceRule }, [], TZ);
	assertEquals(said("FREQ=DAILY"), "Every day");
	assertEquals(said("FREQ=DAILY;COUNT=10"), "Every day, 10 times");
	assertEquals(said("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"), "Every weekday");
	assertEquals(said("FREQ=WEEKLY;WKST=SU;INTERVAL=2;BYDAY=MO"), "Every other week on Monday");
	assertEquals(said("FREQ=DAILY;UNTIL=20261231T235959Z"), "Every day, until Dec 31, 2026");
	assertEquals(said("FREQ=MONTHLY;BYMONTHDAY=25"), "Monthly on the 25th");
	assertEquals(said("FREQ=MONTHLY;BYDAY=2TU"), "Every month", "no date to name");
	assertEquals(said("FREQ=YEARLY"), "Yearly on March 25");
	assertEquals(said("FREQ=YEARLY;BYDAY=-1FR"), "Every year", "no date to name");

	const master = { ...event, id: "master", recurrenceRule: "FREQ=DAILY" };
	const later = { ...event, id: "later", recurrenceParentId: "master" };
	assertEquals(repeatSentence(later, [master, later], TZ), "Every day");
	assertEquals(seriesMasterOf(later, [master, later]), master);
	assertEquals(seriesMasterOf(later, [later]), null);
	assertEquals(repeatSentence(later, [later], TZ), null);
	assertEquals(repeatSentence(event, [event], TZ), null);
});

Deno.test("the anchor reads DTSTART's civil date in the zone", () => {
	assertEquals(A, { date: "2026-03-25" as IsoDate, isoDay: 3, monthDay: 25, month: 3 });
});

Deno.test("each cadence serialises canonically and is recognised again", () => {
	assertEquals(toRRule(presetDraft("daily", A), A), "FREQ=DAILY");
	assertEquals(toRRule(presetDraft("weekdays", A), A), "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
	assertEquals(toRRule(presetDraft("weekly", A), A), "FREQ=WEEKLY;BYDAY=WE");
	assertEquals(toRRule(presetDraft("monthly", A), A), "FREQ=MONTHLY;BYMONTHDAY=25");
	for (const p of ["daily", "weekdays", "weekly", "monthly"] as const) {
		assertEquals(presetOf(toRRule(presetDraft(p, A), A), A), p);
	}
	assertEquals(presetOf(undefined, A), "none");
	assertEquals(presetOf("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE", A), "custom");
});

Deno.test("a custom draft round-trips through its rule, COUNT and UNTIL included", () => {
	const drafts: RepeatDraft[] = [
		{ freq: "WEEKLY", interval: 2, isoDays: [1, 4, 7], end: { type: "count", count: 10 } },
		{
			freq: "DAILY",
			interval: 3,
			isoDays: [],
			end: { type: "until", date: "2026-06-30" as IsoDate },
		},
	];
	for (const d of drafts) assertEquals(fromRRule(toRRule(d, A)), d);
	assertEquals(
		toRRule(drafts[0], A),
		"FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO,TH;COUNT=10",
	);
});

Deno.test("the sentence reads the rule", () => {
	assertEquals(describeRepeat(presetDraft("weekdays", A), A), "Every weekday");
	assertEquals(describeRepeat(presetDraft("monthly", A), A), "Monthly on the 25th");
	assertEquals(
		describeRepeat(
			{ freq: "WEEKLY", interval: 2, isoDays: [1, 4], end: { type: "count", count: 10 } },
			A,
		),
		"Every other week on Monday and Thursday, 10 times",
	);
	assertEquals(
		describeRepeat(
			{
				freq: "DAILY",
				interval: 3,
				isoDays: [],
				end: { type: "until", date: "2026-06-30" as IsoDate },
			},
			A,
		),
		"Every 3 days, until Jun 30, 2026",
	);
});

Deno.test("a series keeps its wall-clock time across DST and links back to its master", () => {
	const { events, clipped } = seriesOf({ ...event, recurrenceRule: "FREQ=WEEKLY;COUNT=3" }, TZ);
	assertEquals(clipped, false);
	assertEquals(events.map((e) => e.start), [
		START,
		Date.UTC(2026, 3, 1, 8, 0), // 09:00 BST
		Date.UTC(2026, 3, 8, 8, 0),
	]);
	assertEquals(events[0].recurrenceRule, "FREQ=WEEKLY;COUNT=3");
	assertEquals(events[1].recurrenceParentId, "draft-1");
	assertEquals(events[1].recurrenceRule, undefined);
	assertEquals(events[2].end - events[2].start, HOUR / 4);
});

Deno.test("an open-ended series is capped at one create batch and says so", () => {
	const { events, clipped } = seriesOf({ ...event, recurrenceRule: "FREQ=DAILY" }, TZ);
	assertEquals(events.length, ENTRY_BATCH_MAX);
	assertEquals(clipped, true);
	assertEquals(seriesOf(event, TZ), { events: [event], clipped: false });
});

Deno.test("a yearly draft names its month and day, and round-trips through its rule", () => {
	const yearly: RepeatDraft = { freq: "YEARLY", interval: 2, isoDays: [], end: { type: "never" } };
	assertEquals(toRRule(yearly, A), "FREQ=YEARLY;INTERVAL=2;BYMONTH=3;BYMONTHDAY=25");
	assertEquals(fromRRule(toRRule(yearly, A)), yearly);
	assertEquals(describeRepeat(yearly, A), "Every other year on March 25");
	assertEquals(describeRepeat({ ...yearly, interval: 1 }, A), "Yearly on March 25");
});

Deno.test("a past entry is named; a series only when nothing it lays down is still to come", () => {
	const later = START + 30 * 24 * HOUR;
	assertEquals(pastNotice(event, TZ, START - HOUR), null);
	assertEquals(pastNotice(event, TZ, START + HOUR), "This event is in the past.");
	assertEquals(
		pastNotice({ ...event, end: event.start, kind: "general" }, TZ, START + HOUR),
		"This reminder is in the past.",
	);
	const weekly = { ...event, recurrenceRule: "FREQ=WEEKLY;COUNT=10" };
	assertEquals(pastNotice(weekly, TZ, later), null, "the tenth week is still ahead");
	assertEquals(
		pastNotice({ ...event, recurrenceRule: "FREQ=WEEKLY;COUNT=3" }, TZ, later),
		"Every occurrence of this series is in the past.",
	);
	assertEquals(
		pastNotice({ ...event, recurrenceRule: "FREQ=DAILY" }, TZ, START + 60 * 24 * HOUR),
		`The first ${ENTRY_BATCH_MAX} occurrences are added now, and all of them are in the past.`,
	);
});

let ruleSeq = 0;

function rule(
	pattern: RulePattern,
	over: Partial<AvailabilityRuleDraft> = {},
): AvailabilityRuleDraft {
	return {
		id: `r-${++ruleSeq}`,
		effect: "add",
		pattern,
		condition: { unlessWeekdays: [] },
		bands: [{ start: 540, end: 1020 }],
		startsOn: "2026-01-05" as IsoDate,
		endsOn: null,
		priority: 50,
		label: "",
		active: true,
		fee: null,
		colorToken: null,
		...over,
	};
}

Deno.test("a template's weekly rules join into one weekly repeat, in ISO weekdays", () => {
	assertEquals(
		templateRepeat({
			rules: [
				rule({ type: "weekly", days: [2, 4], interval: 1 }),
				rule({ type: "weekly", days: [0, 1], interval: 1 }),
			],
		}),
		{ freq: "WEEKLY", interval: 1, isoDays: [1, 2, 4, 7] },
	);
});

Deno.test("a template one rule cannot follow maps to nothing", () => {
	assertEquals(
		templateRepeat({
			rules: [
				rule({ type: "weekly", days: [2], interval: 1 }),
				rule({ type: "weekly", days: [6], interval: 2 }),
			],
		}),
		null,
		"mixed intervals",
	);
	assertEquals(
		templateRepeat({ rules: [rule({ type: "monthly_date", days: [12], interval: 1 })] }),
		null,
		"monthly",
	);
	assertEquals(templateRepeat({ rules: [] }), null, "no rules");
	assertEquals(
		templateRepeat({
			rules: [
				rule({ type: "daily", interval: 2 }),
				rule({ type: "daily", interval: 3 }),
			],
		}),
		null,
		"two daily rules",
	);
});

Deno.test("only active add rules shape a template's repeat", () => {
	assertEquals(
		templateRepeat({
			rules: [
				rule({ type: "weekly", days: [1, 3], interval: 1 }),
				rule({ type: "weekly", days: [5], interval: 2 }, { active: false }),
				rule({ type: "weekly", days: [6], interval: 3 }, { effect: "subtract", bands: [] }),
			],
		}),
		{ freq: "WEEKLY", interval: 1, isoDays: [1, 3] },
	);
	assertEquals(
		templateRepeat({
			rules: [rule({ type: "weekly", days: [1], interval: 1 }, { active: false })],
		}),
		null,
	);
});

Deno.test("a single daily rule repeats daily at its interval", () => {
	assertEquals(
		templateRepeat({ rules: [rule({ type: "daily", interval: 2 })] }),
		{ freq: "DAILY", interval: 2, isoDays: [] },
	);
});

Deno.test("two repeats match on frequency, interval and weekdays, however they end", () => {
	const weekly: RepeatDraft = {
		freq: "WEEKLY",
		interval: 1,
		isoDays: [3, 1],
		end: { type: "count", count: 4 },
	};
	assertEquals(sameRepeatPattern(weekly, { freq: "WEEKLY", interval: 1, isoDays: [1, 3] }), true);
	assertEquals(sameRepeatPattern(weekly, { freq: "WEEKLY", interval: 2, isoDays: [1, 3] }), false);
	assertEquals(sameRepeatPattern(weekly, { freq: "WEEKLY", interval: 1, isoDays: [1] }), false);
	assertEquals(
		sameRepeatPattern(
			{ freq: "DAILY", interval: 2, isoDays: [] },
			{ freq: "DAILY", interval: 2, isoDays: [4] },
		),
		true,
	);
	assertEquals(
		sameRepeatPattern(weekly, { freq: "DAILY", interval: 1, isoDays: [1, 3] }),
		false,
	);
});
