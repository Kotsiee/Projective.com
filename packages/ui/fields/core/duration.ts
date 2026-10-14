/**
 * @projective/ui/fields — DurationPicker's pure model: a preset minute count or a custom one.
 */

/** The preset durations, in minutes (plan §4.5). */
export const DURATION_PRESETS: readonly number[] = [15, 30, 45, 60, 90];

/** The custom stepper's bounds and step, in minutes. */
export const DURATION_CUSTOM = { min: 5, max: 600, step: 5, bigStep: 30 } as const;

/** The SelectButton value for "Custom". */
export const DURATION_CUSTOM_KEY = "custom";

/** Which segment a value selects: its preset, or "custom" for anything else. */
export function durationSegment(
	minutes: number | null,
	presets: readonly number[] = DURATION_PRESETS,
): string {
	return minutes !== null && presets.includes(minutes) ? String(minutes) : DURATION_CUSTOM_KEY;
}

/** A duration as a reader says it: "45 min", "1 h", "1 h 30 min". */
export function durationLabel(minutes: number): string {
	const m = Math.max(0, Math.round(minutes));
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	const rest = m % 60;
	return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}
