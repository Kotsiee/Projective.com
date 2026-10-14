import { assertEquals } from "@std/assert";
import { type IsoDate, zonedSpan } from "./civil.ts";
import {
	evaluate,
	explain,
	intersectBands,
	type IssueKind,
	layerBandsFor,
	occursOn,
	type PresetLike,
	subtractBands,
	unionBands,
	validate,
} from "./evaluate.ts";
import {
	AvailabilityPresetSchema,
	type AvailabilityRuleDraft,
	type Band,
	type RulePattern,
} from "./recurrence.ts";
import { SCHEDULE_TEMPLATES, TEMPLATE_ANCHOR } from "./templates.ts";

/**
 * The evaluator against plan §5.2: precedence, tie-breaks, whole-day removal, call clipping,
 * midnight joins, blackouts, the four DST transitions, every explain case in the brief, and the
 * templates' own validity.
 */

// #region Fixtures
const d = (s: string) => s as IsoDate;
const at = (iso: string) => Date.parse(iso);
const h = (from: number, to: number): Band => ({ start: from * 60, end: to * 60 });

function rule(
	id: string,
	pattern: RulePattern,
	bands: Band[],
	over: Partial<AvailabilityRuleDraft> = {},
): AvailabilityRuleDraft {
	return {
		id,
		layer: "working_hours",
		effect: "add",
		pattern,
		condition: { unlessWeekdays: [] },
		bands,
		startsOn: d("2026-01-05"),
		endsOn: null,
		priority: 50,
		label: id,
		active: true,
		...over,
	};
}

const weekly = (days: number[], interval = 1): RulePattern => ({ type: "weekly", days, interval });
const monthlyDate = (days: number[], interval = 1): RulePattern => ({
	type: "monthly_date",
	days,
	interval,
});
const once = (date: string): RulePattern => ({ type: "once", date: d(date) });

function preset(rules: AvailabilityRuleDraft[], timezone = "UTC"): PresetLike {
	return { timezone, rules };
}

const WEEKDAYS_9_TO_5 = rule("weekdays", weekly([1, 2, 3, 4, 5]), [h(9, 17)]);
const SKIP_12TH = rule("skip-12th", monthlyDate([12]), [], {
	effect: "subtract",
	condition: { unlessWeekdays: [4, 5] },
	label: "Skip the 12th unless Thu/Fri",
});
const AFTERNOONS_21ST = rule("21st", monthlyDate([21]), [h(15, 17)], {
	effect: "replace",
	label: "21st afternoons",
});
// #endregion

// #region Band algebra
Deno.test("band algebra works on sorted, merged half-open intervals", () => {
	assertEquals(unionBands([h(9, 12), h(14, 17)], [h(12, 13), h(16, 18)]), [h(9, 13), h(14, 18)]);
	assertEquals(unionBands([{ start: 60, end: 60 }]), []);
	assertEquals(subtractBands([h(9, 17)], [h(12, 13), h(16, 18)]), [h(9, 12), h(13, 16)]);
	assertEquals(subtractBands([h(9, 17)], [h(8, 18)]), []);
	assertEquals(intersectBands([h(8, 10), h(16, 18)], [h(9, 17)]), [h(9, 10), h(16, 17)]);
	assertEquals(intersectBands([h(9, 12)], [h(12, 14)]), []);
});
// #endregion

// #region Precedence
Deno.test("precedence: add, then replace, then subtract", () => {
	const midweek = rule("wed-break", weekly([3]), [{ start: 960, end: 990 }], {
		effect: "subtract",
	});
	const p = preset([WEEKDAYS_9_TO_5, AFTERNOONS_21ST, SKIP_12TH, midweek]);
	assertEquals(layerBandsFor(p, d("2026-10-20"), "working_hours"), [h(9, 17)]);
	assertEquals(layerBandsFor(p, d("2026-10-14"), "working_hours"), [{ start: 540, end: 960 }, {
		start: 990,
		end: 1020,
	}]);
	// Wednesday the 21st: the override replaces the day, then the Wednesday break is cut from it.
	assertEquals(layerBandsFor(p, d("2026-10-21"), "working_hours"), [{ start: 900, end: 960 }, {
		start: 990,
		end: 1020,
	}]);
	// Saturday the 21st of November: no add rule occurs, the replace alone supplies the day.
	assertEquals(layerBandsFor(p, d("2026-11-21"), "working_hours"), [h(15, 17)]);
});

Deno.test("a subtract with no bands removes the whole day", () => {
	const p = preset([WEEKDAYS_9_TO_5, SKIP_12TH]);
	assertEquals(layerBandsFor(p, d("2026-10-12"), "working_hours"), []);
	// Thursday the 12th of November is the exception: the rule does not occur.
	assertEquals(layerBandsFor(p, d("2026-11-12"), "working_hours"), [h(9, 17)]);
	assertEquals(occursOn(SKIP_12TH, d("2026-10-12")), true);
	assertEquals(occursOn(SKIP_12TH, d("2026-11-12")), false);
});

Deno.test("replace ties go to priority, then the latest startsOn, then the lowest id", () => {
	const a = rule("b-rule", monthlyDate([21]), [h(10, 11)], { effect: "replace" });
	const b = rule("a-rule", monthlyDate([21]), [h(12, 13)], { effect: "replace" });
	const later = rule("later", monthlyDate([21]), [h(14, 15)], {
		effect: "replace",
		startsOn: d("2026-06-01"),
	});
	const urgent = rule("urgent", monthlyDate([21]), [h(16, 17)], {
		effect: "replace",
		priority: 90,
	});
	const date = d("2026-10-21");
	assertEquals(layerBandsFor(preset([a, b]), date, "working_hours"), [h(12, 13)]);
	assertEquals(layerBandsFor(preset([a, b, later]), date, "working_hours"), [h(14, 15)]);
	assertEquals(layerBandsFor(preset([a, b, later, urgent]), date, "working_hours"), [h(16, 17)]);
});

Deno.test("inactive rules and dates outside a rule's range do nothing", () => {
	const off = rule("off", weekly([1]), [h(9, 17)], { active: false });
	const bounded = rule("bounded", weekly([1]), [h(9, 17)], {
		startsOn: d("2026-10-01"),
		endsOn: d("2026-10-31"),
	});
	assertEquals(layerBandsFor(preset([off]), d("2026-10-12"), "working_hours"), []);
	assertEquals(layerBandsFor(preset([bounded]), d("2026-09-28"), "working_hours"), []);
	assertEquals(layerBandsFor(preset([bounded]), d("2026-10-26"), "working_hours"), [h(9, 17)]);
	assertEquals(layerBandsFor(preset([bounded]), d("2026-11-02"), "working_hours"), []);
});
// #endregion

// #region Calls
Deno.test("call windows are clipped to working hours, never the reverse", () => {
	const calls = rule("calls", weekly([1]), [h(8, 10), h(16, 18)], { layer: "call_window" });
	const p = preset([rule("work", weekly([1]), [h(9, 17)]), calls]);
	const date = d("2026-10-12");
	assertEquals(layerBandsFor(p, date, "call_window"), [h(9, 10), h(16, 17)]);
	assertEquals(layerBandsFor(p, date, "working_hours"), [h(9, 17)]);
	const [, call] = explain(p, date);
	assertEquals(call.clipped, [h(8, 9), h(17, 18)]);
	const outside = validate(p).filter((i) => i.kind === "call_outside_work");
	assertEquals(outside.map((i) => [i.ruleId, i.date]), [["calls", d("2026-01-05")]]);
});

Deno.test("a day off in working hours takes its calls with it", () => {
	const calls = rule("calls", weekly([1, 2, 3, 4, 5]), [h(10, 12)], { layer: "call_window" });
	const p = preset([WEEKDAYS_9_TO_5, SKIP_12TH, calls]);
	assertEquals(layerBandsFor(p, d("2026-10-12"), "call_window"), []);
	assertEquals(layerBandsFor(p, d("2026-10-13"), "call_window"), [h(10, 12)]);
});
// #endregion

// #region Timeline
Deno.test("evaluate yields absolute spans with their rules, both layers", () => {
	const calls = rule("calls", weekly([1]), [h(10, 11)], { layer: "call_window" });
	const spans = evaluate(preset([rule("work", weekly([1]), [h(9, 17)]), calls]), {
		from: d("2026-10-12"),
		to: d("2026-10-13"),
	});
	assertEquals(spans, [
		{
			kind: "working_hours",
			startsAt: at("2026-10-12T09:00:00Z"),
			endsAt: at("2026-10-12T17:00:00Z"),
			ruleIds: ["work"],
		},
		{
			kind: "call_window",
			startsAt: at("2026-10-12T10:00:00Z"),
			endsAt: at("2026-10-12T11:00:00Z"),
			ruleIds: ["calls"],
		},
	]);
});

Deno.test("bands split at midnight join into one span across the day boundary", () => {
	const late = rule("late", weekly([1]), [{ start: 1380, end: 1440 }]);
	const early = rule("early", weekly([2]), [{ start: 0, end: 60 }]);
	const spans = evaluate(preset([late, early], "Europe/London"), {
		from: d("2026-10-12"),
		to: d("2026-10-13"),
	});
	assertEquals(spans, [{
		kind: "working_hours",
		startsAt: at("2026-10-12T22:00:00Z"),
		endsAt: at("2026-10-13T00:00:00Z"),
		ruleIds: ["early", "late"],
	}]);
});

Deno.test("blackouts are cut out of the evaluated spans", () => {
	const spans = evaluate(
		preset([rule("work", weekly([1, 2]), [h(9, 17)])]),
		{ from: d("2026-10-12"), to: d("2026-10-13") },
		[{ startsAt: at("2026-10-12T12:00:00Z"), endsAt: at("2026-10-13T10:00:00Z"), label: "Travel" }],
	);
	assertEquals(
		spans.map((s) => [new Date(s.startsAt).toISOString(), new Date(s.endsAt).toISOString()]),
		[
			["2026-10-12T09:00:00.000Z", "2026-10-12T12:00:00.000Z"],
			["2026-10-13T10:00:00.000Z", "2026-10-13T17:00:00.000Z"],
		],
	);
	const [work] = explain(preset([rule("work", weekly([1, 2]), [h(9, 17)])]), d("2026-10-13"), [
		{ startsAt: at("2026-10-12T12:00:00Z"), endsAt: at("2026-10-13T10:00:00Z"), label: "Travel" },
	]);
	assertEquals(work.blackout?.spans.map((b) => b.label), ["Travel"]);
});
// #endregion

// #region DST
function spanIso(date: string, start: number, end: number, tz: string): [string, string] {
	const s = zonedSpan(d(date), start, end, tz);
	return [new Date(s.startsAt).toISOString(), new Date(s.endsAt).toISOString()];
}

Deno.test("DST Europe/London 2026-03-29: a band starting in the gap starts at its end", () => {
	assertEquals(spanIso("2026-03-29", 540, 1020, "Europe/London"), [
		"2026-03-29T08:00:00.000Z",
		"2026-03-29T16:00:00.000Z",
	]);
	assertEquals(spanIso("2026-03-29", 30, 90, "Europe/London"), [
		"2026-03-29T00:30:00.000Z",
		"2026-03-29T01:00:00.000Z",
	]);
	assertEquals(spanIso("2026-03-29", 75, 180, "Europe/London"), [
		"2026-03-29T01:00:00.000Z",
		"2026-03-29T02:00:00.000Z",
	]);
	// 01:00–02:00 does not exist that night, so a band wholly inside it yields nothing.
	assertEquals(
		evaluate(
			preset(
				[rule("gap", once("2026-03-29"), [h(1, 2)], { startsOn: d("2026-03-29") })],
				"Europe/London",
			),
			{
				from: d("2026-03-29"),
				to: d("2026-03-29"),
			},
		),
		[],
	);
});

Deno.test("DST Europe/London 2026-10-25: a band in the repeated hour takes its first occurrence", () => {
	assertEquals(spanIso("2026-10-25", 90, 150, "Europe/London"), [
		"2026-10-25T00:30:00.000Z",
		"2026-10-25T02:30:00.000Z",
	]);
	assertEquals(spanIso("2026-10-25", 0, 1440, "Europe/London"), [
		"2026-10-24T23:00:00.000Z",
		"2026-10-26T00:00:00.000Z",
	]);
	const [span] = evaluate(
		preset(
			[rule("work", once("2026-10-25"), [h(9, 17)], { startsOn: d("2026-10-25") })],
			"Europe/London",
		),
		{ from: d("2026-10-25"), to: d("2026-10-25") },
	);
	assertEquals([span.startsAt, span.endsAt], [
		at("2026-10-25T09:00:00Z"),
		at("2026-10-25T17:00:00Z"),
	]);
});

Deno.test("DST America/New_York 2026-03-08: the spring gap and a 23-hour day", () => {
	assertEquals(spanIso("2026-03-08", 150, 240, "America/New_York"), [
		"2026-03-08T07:00:00.000Z",
		"2026-03-08T08:00:00.000Z",
	]);
	assertEquals(spanIso("2026-03-08", 540, 1020, "America/New_York"), [
		"2026-03-08T13:00:00.000Z",
		"2026-03-08T21:00:00.000Z",
	]);
	assertEquals(spanIso("2026-03-08", 0, 1440, "America/New_York"), [
		"2026-03-08T05:00:00.000Z",
		"2026-03-09T04:00:00.000Z",
	]);
});

Deno.test("DST Australia/Sydney 2026-04-05: the autumn overlap takes AEDT first", () => {
	assertEquals(spanIso("2026-04-05", 150, 210, "Australia/Sydney"), [
		"2026-04-04T15:30:00.000Z",
		"2026-04-04T17:30:00.000Z",
	]);
	assertEquals(spanIso("2026-04-05", 540, 1020, "Australia/Sydney"), [
		"2026-04-04T23:00:00.000Z",
		"2026-04-05T07:00:00.000Z",
	]);
	const spans = evaluate(
		preset(
			[rule("work", weekly([0]), [h(9, 17)], { startsOn: d("2026-03-29") })],
			"Australia/Sydney",
		),
		{ from: d("2026-03-29"), to: d("2026-04-05") },
	);
	assertEquals(spans.map((s) => new Date(s.startsAt).toISOString()), [
		"2026-03-28T22:00:00.000Z",
		"2026-04-04T23:00:00.000Z",
	]);
});
// #endregion

// #region Explain
Deno.test("explain: Mon 9–5", () => {
	const mon = rule("mon", weekly([1]), [h(9, 17)], { label: "Mondays" });
	const [work, call] = explain(preset([mon]), d("2026-10-12"));
	assertEquals(work, {
		layer: "working_hours",
		bands: [h(9, 17)],
		contributed: [{ ruleId: "mon", label: "Mondays", bands: [h(9, 17)] }],
		outranked: [],
		removedBy: [],
		clipped: [],
	});
	assertEquals([call.layer, call.bands, call.contributed], ["call_window", [], []]);
	assertEquals(explain(preset([mon]), d("2026-10-13"))[0].contributed, []);
});

Deno.test("explain: Wed 6–12 + 14–19 is one rule with two bands", () => {
	const wed = rule("wed", weekly([3]), [h(6, 12), h(14, 19)]);
	const [work] = explain(preset([wed]), d("2026-10-14"));
	assertEquals(work.bands, [h(6, 12), h(14, 19)]);
	assertEquals(work.contributed.map((r) => r.ruleId), ["wed"]);
});

Deno.test("explain: bi-weekly contributes on alternate weeks only", () => {
	const fortnight = rule("fortnight", weekly([3], 2), [h(9, 17)], { startsOn: d("2026-10-06") });
	const contributed = (date: string) =>
		explain(preset([fortnight]), d(date))[0].contributed.map((r) => r.ruleId);
	assertEquals([contributed("2026-10-07"), contributed("2026-10-14"), contributed("2026-10-21")], [
		["fortnight"],
		[],
		["fortnight"],
	]);
});

Deno.test("explain: monthly by date and by weekday", () => {
	const byDate = rule("by-date", monthlyDate([1, 15]), [h(9, 12)]);
	const byWeekday = rule("last-fri", {
		type: "monthly_weekday",
		ordinal: -1,
		weekday: 5,
		interval: 1,
	}, [h(13, 17)]);
	const p = preset([byDate, byWeekday]);
	assertEquals(explain(p, d("2026-11-01"))[0].contributed.map((r) => r.ruleId), ["by-date"]);
	assertEquals(explain(p, d("2026-11-02"))[0].contributed, []);
	assertEquals(explain(p, d("2026-10-30"))[0].contributed.map((r) => r.ruleId), ["last-fri"]);
	assertEquals(explain(p, d("2026-10-23"))[0].contributed, []);
});

Deno.test("explain: skip the 12th unless Thu/Fri", () => {
	const p = preset([WEEKDAYS_9_TO_5, SKIP_12TH]);
	const [monday] = explain(p, d("2026-10-12"));
	assertEquals(monday.bands, []);
	assertEquals(monday.contributed.map((r) => r.ruleId), ["weekdays"]);
	assertEquals(monday.removedBy, [{
		ruleId: "skip-12th",
		label: "Skip the 12th unless Thu/Fri",
		bands: [],
		removed: [h(9, 17)],
	}]);
	const [thursday] = explain(p, d("2026-11-12"));
	assertEquals([thursday.bands, thursday.removedBy], [[h(9, 17)], []]);
});

Deno.test("explain: the 21st 15–17 override replaces working hours", () => {
	const loser = rule("loser", monthlyDate([21]), [h(9, 10)], { effect: "replace", priority: 10 });
	const [work] = explain(preset([WEEKDAYS_9_TO_5, AFTERNOONS_21ST, loser]), d("2026-10-21"));
	assertEquals(work.bands, [h(15, 17)]);
	assertEquals(work.contributed.map((r) => r.ruleId), ["weekdays"]);
	assertEquals(work.replacedBy, { ruleId: "21st", label: "21st afternoons", bands: [h(15, 17)] });
	assertEquals(work.outranked.map((r) => r.ruleId), ["loser"]);
	assertEquals(
		explain(preset([WEEKDAYS_9_TO_5, AFTERNOONS_21ST]), d("2026-10-20"))[0].replacedBy,
		undefined,
	);
});
// #endregion

// #region Validate
const kinds = (p: PresetLike, today?: string) =>
	validate(p, today ? { today: d(today) } : {}).map((i) => i.kind);

Deno.test("validate reports each issue kind", () => {
	const overlapping = rule("overlap", weekly([1]), [h(9, 12), h(11, 14)]);
	assertEquals(kinds(preset([overlapping])), ["overlapping_bands"] satisfies IssueKind[]);

	const unschemaed = rule("bad", weekly([1]), [h(9, 17)], { condition: { unlessWeekdays: [2] } });
	assertEquals(kinds(preset([unschemaed])), ["rrule_invalid"]);

	const a = rule("a", monthlyDate([21]), [h(10, 11)], { effect: "replace" });
	const b = rule("b", weekly([3]), [h(12, 13)], { effect: "replace" });
	const tie = validate(preset([a, b]));
	assertEquals(tie.map((i) => [i.kind, i.ruleId, i.otherRuleId, i.date]), [[
		"replace_tie",
		"a",
		"b",
		d("2026-01-21"),
	]]);
	assertEquals(kinds(preset([a, { ...b, priority: 60 }])), []);

	const ended = rule("ended", weekly([1]), [h(9, 17)], { endsOn: d("2026-03-01") });
	assertEquals(kinds(preset([ended]), "2026-10-14"), ["empty_next_30_days", "empty_next_30_days"]);
});

Deno.test("templates are valid presets with no issues", () => {
	for (const template of SCHEDULE_TEMPLATES) {
		const parsed = AvailabilityPresetSchema.safeParse({
			...template,
			id: template.key,
			blueprintId: null,
		});
		assertEquals(parsed.success, true, template.key);
		for (const today of [TEMPLATE_ANCHOR, d("2026-10-14")]) {
			assertEquals(validate(template, { today }), [], `${template.key} @ ${today}`);
		}
	}
});

Deno.test("templates match plan §5.5", () => {
	const general = SCHEDULE_TEMPLATES.find((t) => t.key === "general");
	if (!general) throw new Error("missing general template");
	assertEquals(layerBandsFor(general, d("2026-10-14"), "working_hours"), [{
		start: 540,
		end: 1050,
	}]);
	assertEquals(layerBandsFor(general, d("2026-10-14"), "call_window"), [h(10, 12), h(14, 16)]);
	assertEquals(layerBandsFor(general, d("2026-10-17"), "working_hours"), []);

	const vip = SCHEDULE_TEMPLATES.find((t) => t.key === "vip_intensive");
	if (!vip) throw new Error("missing vip template");
	assertEquals(layerBandsFor(vip, d("2026-10-13"), "call_window"), [h(7, 9), h(18, 20)]);
	const saturdays = ["2026-01-10", "2026-01-17", "2026-01-24"].map((s) =>
		layerBandsFor(vip, d(s), "working_hours")
	);
	assertEquals(saturdays, [[h(10, 13)], [], [h(10, 13)]]);

	const evening = SCHEDULE_TEMPLATES.find((t) => t.key === "evening_sprints");
	if (!evening) throw new Error("missing evening template");
	assertEquals(layerBandsFor(evening, d("2026-10-15"), "call_window"), [h(18, 19)]);
	assertEquals(layerBandsFor(evening, d("2026-10-16"), "working_hours"), []);
});
// #endregion
