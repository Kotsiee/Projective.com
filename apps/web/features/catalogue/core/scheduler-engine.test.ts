import { assert, assertEquals, assertThrows } from "@std/assert";
import type {
	Preset as SchedulerPreset,
	SchedulerEngine,
} from "@ui/calendar/islands/availability-scheduler/types.ts";
import { SCHEDULE_TEMPLATES } from "@projective/types/scheduling";
import { isoDate, SCHEDULER_TEMPLATES, schedulerEngine } from "./scheduler-engine.ts";
import { schedulerPresetOf, starterPreset } from "./availability-model.ts";

const engine: SchedulerEngine = schedulerEngine;

const GENERAL: SchedulerPreset = starterPreset("Europe/London");

Deno.test("the adapter implements every SchedulerEngine method", () => {
	const methods: (keyof SchedulerEngine)[] = [
		"evaluate",
		"explain",
		"describe",
		"validate",
		"parseRRule",
		"draftToRRule",
	];
	for (const method of methods) assertEquals(typeof engine[method], "function", method);
	assertEquals(SCHEDULER_TEMPLATES.map((t) => t.key), SCHEDULE_TEMPLATES.map((t) => t.key));
});

Deno.test("evaluate end to end: General weekdays in London across the autumn clock change", () => {
	const spans = engine.evaluate(GENERAL, { from: "2026-10-23", to: "2026-10-26" });
	const working = spans.filter((s) => s.kind === "working_hours");
	assertEquals(
		working.map((s) => [new Date(s.startsAt).toISOString(), new Date(s.endsAt).toISOString()]),
		[
			["2026-10-23T08:00:00.000Z", "2026-10-23T16:30:00.000Z"],
			["2026-10-26T09:00:00.000Z", "2026-10-26T17:30:00.000Z"],
		],
	);
	const calls = spans.filter((s) =>
		s.kind === "call_window" && s.startsAt >= Date.UTC(2026, 9, 26)
	);
	assertEquals(calls.length, 2);
	assertEquals(working[0].ruleIds, ["general-work"]);
});

Deno.test("explain, describe and validate read the scheduler's plain dates", () => {
	const [workingHours] = engine.explain(GENERAL, "2026-10-26");
	assertEquals(workingHours.layer, "working_hours");
	assertEquals(workingHours.bands, [{ start: 540, end: 1050 }]);
	assert(engine.describe(GENERAL.rules[0]).includes("working hours"));
	assertEquals(engine.validate(GENERAL, { today: "2026-10-14" }), []);
});

Deno.test("RRULE round trip through the adapter", () => {
	const rule = {
		...GENERAL.rules[0],
		pattern: { type: "monthly_weekday" as const, ordinal: -1, weekday: 5, interval: 1 },
	};
	const written = engine.draftToRRule(rule);
	assert(written.ok);
	assertEquals(written.rrule, "FREQ=MONTHLY;BYDAY=-1FR");
	const read = engine.parseRRule(written.rrule, rule.startsOn);
	assert(read.ok);
	assertEquals(read.pattern, rule.pattern);
	assertEquals(engine.parseRRule("FREQ=SECONDLY", rule.startsOn).ok, false);
});

Deno.test("a malformed date is a bug, thrown rather than guessed at", () => {
	assertThrows(() => isoDate("14/10/2026"), RangeError);
	assertEquals(isoDate("2026-10-14"), "2026-10-14");
	assertEquals(
		schedulerPresetOf({ ...SCHEDULE_TEMPLATES[0], id: "p", blueprintId: null }).rules.length,
		2,
	);
});
