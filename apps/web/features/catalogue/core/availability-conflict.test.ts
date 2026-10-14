/// <reference lib="dom" />
import { assertEquals } from "@std/assert";
import type {
	Issue as SchedulerIssue,
	SchedulerEngine,
} from "@ui/calendar/islands/availability-scheduler/types.ts";
import type { DevAvailabilityConflict } from "@web/utils/dev-seam.ts";
import { conflictIssues, conflictWindows, withConflict } from "./availability-conflict.ts";

const TODAY = "2026-10-14";

function realIssue(kind: string, layer: SchedulerIssue["layer"]): SchedulerIssue {
	return {
		kind,
		severity: "warning",
		ruleId: "r1",
		otherRuleId: null,
		layer,
		date: TODAY,
		message: kind,
	};
}

Deno.test("conflictIssues — auto adds nothing", () => {
	assertEquals(conflictIssues("auto", [], TODAY), []);
});

Deno.test("conflictIssues — call_outside_work adds one call-window warning dated today", () => {
	const [issue, ...rest] = conflictIssues("call_outside_work", [], TODAY);
	assertEquals(rest, []);
	assertEquals([issue.kind, issue.severity, issue.layer, issue.date], [
		"call_outside_work",
		"warning",
		"call_window",
		TODAY,
	]);
});

Deno.test("conflictIssues — empty_horizon adds the working-hours empty-30-days warning", () => {
	const [issue] = conflictIssues("empty_horizon", [], undefined);
	assertEquals([issue.kind, issue.layer, issue.date], [
		"empty_next_30_days",
		"working_hours",
		null,
	]);
});

Deno.test("conflictIssues — never duplicates a kind the real validation reported", () => {
	assertEquals(
		conflictIssues("call_outside_work", [realIssue("call_outside_work", "call_window")], TODAY),
		[],
	);
	assertEquals(
		conflictIssues("empty_horizon", [realIssue("empty_next_30_days", "working_hours")], TODAY),
		[],
	);
	// The call-window layer's empty warning is a different fact; the working-hours one still lands.
	assertEquals(
		conflictIssues("empty_horizon", [realIssue("empty_next_30_days", "call_window")], TODAY).length,
		1,
	);
});

Deno.test("conflictWindows — empty_horizon zeroes the count, every other value passes it through", () => {
	assertEquals(conflictWindows("empty_horizon", 12), 0);
	assertEquals(conflictWindows("empty_horizon", undefined), 0);
	assertEquals(conflictWindows("auto", 12), 12);
	assertEquals(conflictWindows("call_outside_work", undefined), undefined);
});

Deno.test("withConflict — appends to validate, reads the axis per call, leaves the rest alone", () => {
	const real = [realIssue("replace_tie", "working_hours")];
	const base = {
		validate: () => real,
		describe: () => "base",
	} as unknown as SchedulerEngine;
	let axis: DevAvailabilityConflict = "auto";
	const engine = withConflict(base, () => axis);
	const preset = { timezone: "UTC", rules: [] } as unknown as Parameters<
		SchedulerEngine["validate"]
	>[0];

	assertEquals(engine.validate(preset, { today: TODAY }), real);
	axis = "call_outside_work";
	assertEquals(engine.validate(preset, { today: TODAY }).map((i) => i.kind), [
		"replace_tie",
		"call_outside_work",
	]);
	assertEquals(engine.describe({} as never), "base");
});
