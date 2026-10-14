import { assertEquals } from "@std/assert";
import type { IsoDate } from "./civil.ts";
import { type DescribableRule, describePreset, describeRule } from "./describe.ts";
import { SCHEDULE_TEMPLATES } from "./templates.ts";

/** Rule sentences: the plan §5.3 example verbatim, every pattern, and locale-driven names. */

const base: DescribableRule = {
	layer: "working_hours",
	effect: "add",
	pattern: { type: "weekly", days: [3], interval: 2 },
	condition: { unlessWeekdays: [] },
	bands: [{ start: 360, end: 720 }, { start: 840, end: 1140 }],
	startsOn: "2026-10-06" as IsoDate,
	endsOn: null,
};

Deno.test("the plan's example sentence", () => {
	assertEquals(
		describeRule(base),
		"Every other Wednesday from 6 Oct · 06:00–12:00, 14:00–19:00 · working hours",
	);
});

Deno.test("each pattern and effect reads as a sentence", () => {
	const nine = [{ start: 540, end: 1020 }];
	const cases: [Partial<DescribableRule>, string][] = [
		[
			{ pattern: { type: "weekly", days: [1, 2, 3, 4, 5], interval: 1 }, bands: nine },
			"Every weekday from 6 Oct · 09:00–17:00 · working hours",
		],
		[
			{ pattern: { type: "weekly", days: [0, 1, 2, 3, 4, 5, 6], interval: 1 }, bands: nine },
			"Every day from 6 Oct · 09:00–17:00 · working hours",
		],
		[
			{ pattern: { type: "weekly", days: [1, 5], interval: 3 }, bands: nine },
			"Every 3 weeks on Monday and Friday from 6 Oct · 09:00–17:00 · working hours",
		],
		[
			{ pattern: { type: "monthly_date", days: [15, 1], interval: 1 }, bands: nine },
			"Monthly on the 1st and 15th from 6 Oct · 09:00–17:00 · working hours",
		],
		[
			{ pattern: { type: "monthly_date", days: [-1], interval: 2 }, bands: nine },
			"Every other month on the last day from 6 Oct · 09:00–17:00 · working hours",
		],
		[
			{
				pattern: { type: "monthly_weekday", ordinal: -1, weekday: 5, interval: 1 },
				bands: nine,
				layer: "call_window",
			},
			"Monthly on the last Friday from 6 Oct · 09:00–17:00 · calls",
		],
		[
			{ pattern: { type: "monthly_weekday", ordinal: 2, weekday: 2, interval: 3 }, bands: nine },
			"Every 3 months on the 2nd Tuesday from 6 Oct · 09:00–17:00 · working hours",
		],
		[
			{
				effect: "subtract",
				pattern: { type: "monthly_date", days: [12], interval: 1 },
				condition: { unlessWeekdays: [5, 4] },
				bands: [],
			},
			"Monthly on the 12th from 6 Oct, unless it's a Thursday or Friday · the whole day off · working hours",
		],
		[
			{
				effect: "replace",
				pattern: { type: "monthly_date", days: [21], interval: 1 },
				bands: [{ start: 900, end: 1020 }],
			},
			"Monthly on the 21st from 6 Oct · 15:00–17:00 instead · working hours",
		],
		[
			{
				effect: "subtract",
				pattern: { type: "weekly", days: [3], interval: 1 },
				bands: [{ start: 720, end: 780 }],
			},
			"Every Wednesday from 6 Oct · not 12:00–13:00 · working hours",
		],
		[
			{
				pattern: { type: "yearly", month: 2, day: 29 },
				bands: nine,
				endsOn: "2036-12-31" as IsoDate,
			},
			"Every year on 29 February from 6 Oct until 31 Dec 2036 · 09:00–17:00 · working hours",
		],
		[
			{ pattern: { type: "once", date: "2026-10-21" as IsoDate }, bands: nine },
			"On Wednesday, 21 October 2026 · 09:00–17:00 · working hours",
		],
		[
			{ pattern: { type: "weekly", days: [6], interval: 1 }, bands: [{ start: 1320, end: 1440 }] },
			"Every Saturday from 6 Oct · 22:00–00:00 · working hours",
		],
	];
	for (const [over, expected] of cases) assertEquals(describeRule({ ...base, ...over }), expected);
});

Deno.test("weekday and month names come from the locale", () => {
	const sentence = describeRule(base, "fr-FR");
	assertEquals(sentence.includes("mercredi"), true, sentence);
	assertEquals(sentence.includes("oct."), true, sentence);
});

Deno.test("a preset summary counts each layer", () => {
	const vip = SCHEDULE_TEMPLATES.find((t) => t.key === "vip_intensive");
	if (!vip) throw new Error("missing vip template");
	const description = describePreset(vip);
	assertEquals(description.summary, "2 working-hours rules · 2 call rules · Europe/London");
	assertEquals(description.rules[2], {
		id: "vip-saturday-work",
		sentence: "Every other Saturday from 5 Jan · 10:00–13:00 · working hours",
	});
	assertEquals(describePreset({ timezone: "UTC", rules: [] }).summary, "No rules · UTC");
});
