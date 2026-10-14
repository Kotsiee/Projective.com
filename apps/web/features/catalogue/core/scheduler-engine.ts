import type {
	Preset as SchedulerPreset,
	RuleDraft as SchedulerRuleDraft,
	SchedulerEngine,
	SchedulerTemplate,
} from "@ui/calendar/islands/availability-scheduler/types.ts";
import {
	type AvailabilityRuleDraft,
	compileRecurrence,
	describeRule,
	evaluate,
	explain,
	type IsoDate,
	parseIsoDate,
	parseRRule,
	type PresetLike,
	rruleToDraft,
	SCHEDULE_TEMPLATES,
	serialiseRRule,
	validate,
} from "@projective/types/scheduling";

/**
 * scheduler-engine — the app's {@link SchedulerEngine}: `@projective/ui/calendar`'s scheduler is
 * engine-injected and never imports `@projective/types`, so this adapter hands it the one pure
 * evaluator the booking gate compiles from (Decision #217 (d)). The scheduler speaks plain date
 * strings; the evaluator brands them as `IsoDate`, so every date crossing the boundary is parsed
 * here, and a malformed one is a bug in the scheduler, thrown rather than guessed at.
 */

// #region Dates
/** A scheduler date as the evaluator's `IsoDate`. */
export function isoDate(s: string): IsoDate {
	const date = parseIsoDate(s);
	if (!date) throw new RangeError(`Not a civil date: ${s}`);
	return date;
}

/** A scheduler rule in the evaluator's terms. */
export function toEngineRule(rule: SchedulerRuleDraft): AvailabilityRuleDraft {
	return {
		...rule,
		pattern: rule.pattern.type === "once"
			? { type: "once", date: isoDate(rule.pattern.date) }
			: rule.pattern,
		startsOn: isoDate(rule.startsOn),
		endsOn: rule.endsOn === null ? null : isoDate(rule.endsOn),
	};
}

/** The slice of a scheduler preset the evaluator reads. */
export function toEnginePreset(preset: Pick<SchedulerPreset, "timezone" | "rules">): PresetLike {
	return { timezone: preset.timezone, rules: preset.rules.map(toEngineRule) };
}
// #endregion

// #region Engine
/** The engine the workspace's scheduler runs on. Pure: no clock, no network. */
export const schedulerEngine: SchedulerEngine = {
	evaluate: (preset, range) =>
		evaluate(toEnginePreset(preset), { from: isoDate(range.from), to: isoDate(range.to) }),
	explain: (preset, date) => explain(toEnginePreset(preset), isoDate(date)),
	describe: (rule) => describeRule(toEngineRule(rule)),
	validate: (preset, options) =>
		validate(toEnginePreset(preset), options?.today ? { today: isoDate(options.today) } : {}),
	parseRRule: (rrule, startsOn) => {
		const parsed = parseRRule(rrule);
		if (!parsed.ok) return { ok: false, message: parsed.message };
		const draft = rruleToDraft(rrule, isoDate(startsOn));
		return draft
			? { ok: true, ...draft }
			: { ok: false, message: "That rule is valid, but the editor can't show it as a pattern." };
	},
	draftToRRule: (rule) => {
		const compiled = compileRecurrence(toEngineRule(rule));
		return compiled.ok
			? { ok: true, rrule: serialiseRRule(compiled.value) }
			: { ok: false, message: compiled.message };
	},
};

/** The plan §5.5 starting points, as the preset bar lists them. */
export const SCHEDULER_TEMPLATES: readonly SchedulerTemplate[] = SCHEDULE_TEMPLATES.map((t) => ({
	key: t.key,
	name: t.name,
	description: t.description,
	rules: t.rules,
}));
// #endregion
