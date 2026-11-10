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
/**
 * The issues a conflict adds to the scheduler's own, in the engine's words: one warning, never a
 * duplicate of a kind the real validation already reported.
 */
export function conflictIssues(
	conflict: DevAvailabilityConflict,
	real: readonly SchedulerIssue[],
	today: string | undefined,
): SchedulerIssue[] {
	if (conflict === "empty_horizon" && !real.some((i) => i.kind === "empty_next_30_days")) {
		return [{
			kind: "empty_next_30_days",
			severity: "warning",
			ruleId: null,
			otherRuleId: null,
			date: today ?? null,
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
