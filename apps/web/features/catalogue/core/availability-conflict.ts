import type {
	Issue as SchedulerIssue,
	SchedulerEngine,
} from "@ui/calendar/islands/availability-scheduler/types.ts";
import type { DevAvailabilityConflict } from "@web/utils/dev-seam.ts";

/**
 * availability-conflict — the `availabilityConflict` dev axis (plan §10) as pure functions over the
 * workspace's availability facts. They substitute the FACTS the scheduler validates and the publish
 * readiness counts; the shipping rules that read them are unchanged, and a save still meets the real
 * gate. Under `auto` (always, in production) every helper passes the real values through.
 */

// #region Pure
const CALL_OUTSIDE_WORK: Omit<SchedulerIssue, "date"> = {
	kind: "call_outside_work",
	severity: "warning",
	ruleId: null,
	otherRuleId: null,
	layer: "call_window",
	message: "Some call times fall outside working hours, so they are not offered.",
};

/**
 * The issues a conflict adds to the scheduler's own, in the engine's words: one warning per kind,
 * never a duplicate of a kind the real validation already reported.
 */
export function conflictIssues(
	conflict: DevAvailabilityConflict,
	real: readonly SchedulerIssue[],
	today: string | undefined,
): SchedulerIssue[] {
	const has = (kind: string, layer?: string) =>
		real.some((i) => i.kind === kind && (layer === undefined || i.layer === layer));
	const date = today ?? null;
	if (conflict === "call_outside_work" && !has("call_outside_work")) {
		return [{ ...CALL_OUTSIDE_WORK, date }];
	}
	if (conflict === "empty_horizon" && !has("empty_next_30_days", "working_hours")) {
		return [{
			kind: "empty_next_30_days",
			severity: "warning",
			ruleId: null,
			otherRuleId: null,
			layer: "working_hours",
			date,
			message: "No working hours in the next 30 days.",
		}];
	}
	return [];
}

/** The bookable-window count the readiness gate sees: zero under `empty_horizon`, else the real one. */
export function conflictWindows(
	conflict: DevAvailabilityConflict,
	real: number | undefined,
): number | undefined {
	return conflict === "empty_horizon" ? 0 : real;
}

/**
 * `engine` with {@link conflictIssues} appended to `validate`. `read` is called inside `validate`, so
 * a signal read there keeps the scheduler's computed issues reactive to the axis.
 */
export function withConflict(
	engine: SchedulerEngine,
	read: () => DevAvailabilityConflict,
): SchedulerEngine {
	return {
		...engine,
		validate: (preset, options) => {
			const real = engine.validate(preset, options);
			return [...real, ...conflictIssues(read(), real, options?.today)];
		},
	};
}
// #endregion
