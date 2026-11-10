/// <reference lib="dom" />
import { assertEquals } from "@std/assert";
import type {
	Issue as SchedulerIssue,
	SchedulerEngine,
} from "@ui/calendar/islands/availability-scheduler/types.ts";
import type { DevAvailabilityConflict } from "@web/utils/dev-seam.ts";
import { conflictIssues, conflictWindows, withConflict } from "./availability-conflict.ts";

const TODAY = "2026-10-14";

function realIssue(kind: string): SchedulerIssue {
	return {
		kind,
		severity: "warning",
		ruleId: "r1",
		otherRuleId: null,
		date: TODAY,
		message: kind,
	};
}

Deno.test("conflictIssues — auto adds nothing", () => {
	assertEquals(conflictIssues("auto", [], TODAY), []);
});

Deno.test("conflictIssues — empty_horizon adds the empty-30-days warning, dated today when known", () => {
	const [issue, ...rest] = conflictIssues("empty_horizon", [], TODAY);
	assertEquals(rest, []);
	assertEquals([issue.kind, issue.severity, issue.date], ["empty_next_30_days", "warning", TODAY]);
	assertEquals(conflictIssues("empty_horizon", [], undefined)[0].date, null);
});

Deno.test("conflictIssues — never duplicates a kind the real validation reported", () => {
	assertEquals(conflictIssues("empty_horizon", [realIssue("empty_next_30_days")], TODAY), []);
});

Deno.test("conflictWindows — empty_horizon zeroes the count, every other value passes it through", () => {
	assertEquals(conflictWindows("empty_horizon", 12), 0);
	assertEquals(conflictWindows("empty_horizon", undefined), 0);
	assertEquals(conflictWindows("auto", 12), 12);
	assertEquals(conflictWindows("auto", undefined), undefined);
});

Deno.test("withConflict — appends to validate, reads the axis per call, leaves the rest alone", () => {
	const real = [realIssue("replace_tie")];
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
	axis = "empty_horizon";
	assertEquals(engine.validate(preset, { today: TODAY }).map((i) => i.kind), [
		"replace_tie",
		"empty_next_30_days",
	]);
	assertEquals(engine.describe({} as never), "base");
});
