import type { IsoDate } from "./civil.ts";
import type { AvailabilityPreset, AvailabilityRuleDraft, Band } from "./recurrence.ts";

/**
 * scheduling.templates — the starting points the preset bar offers (plan §5.5). Pure constants, not
 * rows: loading one copies its rules into the editor, which re-anchors them and mints real ids.
 */

// #region Shape
/** A template: a preset minus everything that identifies a stored one. */
export type ScheduleTemplate = Omit<AvailabilityPreset, "id" | "blueprintId"> & {
	/** Stable key the preset bar addresses a template by. */
	key: "general" | "vip_intensive" | "evening_sprints";
};

/** The anchor every template rule starts on — a Monday, so week parity starts on a whole week. */
export const TEMPLATE_ANCHOR = "2026-01-05" as IsoDate;

const hours = (from: number, to: number): Band => ({
	start: Math.round(from * 60),
	end: Math.round(to * 60),
});

function weekly(
	id: string,
	layer: AvailabilityRuleDraft["layer"],
	days: number[],
	bands: Band[],
	label: string,
	interval = 1,
): AvailabilityRuleDraft {
	return {
		id,
		layer,
		effect: "add",
		pattern: { type: "weekly", days, interval },
		condition: { unlessWeekdays: [] },
		bands,
		startsOn: TEMPLATE_ANCHOR,
		endsOn: null,
		priority: 50,
		label,
		active: true,
	};
}
// #endregion

// #region Templates
const BASE = {
	timezone: "Europe/London",
	isDefault: false,
	scope: "library",
	archivedAt: null,
} as const;

/** The three plan §5.5 templates. */
export const SCHEDULE_TEMPLATES: readonly ScheduleTemplate[] = [
	{
		...BASE,
		key: "general",
		name: "General Freelancer Availability",
		description: "Monday to Friday, 09:00–17:30, with calls mid-morning and mid-afternoon.",
		rules: [
			weekly("general-work", "working_hours", [1, 2, 3, 4, 5], [hours(9, 17.5)], "Weekdays"),
			weekly(
				"general-calls",
				"call_window",
				[1, 2, 3, 4, 5],
				[hours(10, 12), hours(14, 16)],
				"Weekday calls",
			),
		],
	},
	{
		...BASE,
		key: "vip_intensive",
		name: "VIP Intensive Advising",
		description:
			"Early and late advising on Tuesdays and Thursdays, and every other Saturday morning.",
		rules: [
			weekly(
				"vip-work",
				"working_hours",
				[2, 4],
				[hours(7, 9), hours(18, 20)],
				"Tuesday and Thursday",
			),
			weekly(
				"vip-calls",
				"call_window",
				[2, 4],
				[hours(7, 9), hours(18, 20)],
				"Tuesday and Thursday calls",
			),
			weekly("vip-saturday-work", "working_hours", [6], [hours(10, 13)], "Alternate Saturdays", 2),
			weekly(
				"vip-saturday-calls",
				"call_window",
				[6],
				[hours(10, 13)],
				"Alternate Saturday calls",
				2,
			),
		],
	},
	{
		...BASE,
		key: "evening_sprints",
		name: "Evening Sprints",
		description: "Monday to Thursday evenings, 18:00–22:00, with calls in the first hour.",
		rules: [
			weekly("evening-work", "working_hours", [1, 2, 3, 4], [hours(18, 22)], "Weeknights"),
			weekly("evening-calls", "call_window", [1, 2, 3, 4], [hours(18, 19)], "Weeknight calls"),
		],
	},
];
// #endregion
