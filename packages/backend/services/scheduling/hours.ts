import type { AvailabilityRule } from "@projective/types/scheduling";

/**
 * scheduling hours — the PURE weekly working-hours derivation the profile FIXTURES still use for a
 * seller's `hours` (`profile-fixtures.ts`), which the `/[handle]` context bar summarises into a
 * schedule line and a live "Available now ⁄ Away" badge.
 *
 * TRANSITIONAL. The `/[handle]/availability` calendar no longer derives anything: it reads the
 * provider's published bands from `scheduling.availability_rules` (`live-schedule-page.ts`). Once the
 * profile projection reads the same rows, the context bar and the calendar are one fact again and
 * this module goes.
 */

/**
 * Weekly working hours, varied by seed: a morning and an afternoon on each workday, a Saturday
 * morning for every third seed. Availability is one layer (Decision #408), so these are also the
 * hours a call is booked in.
 */
export function buildRules(seed: number): AvailabilityRule[] {
	const startH = 8 + (seed % 2); // 8 or 9
	const closeH = 17 + (seed % 2); // 17 or 18
	const days = seed % 3 === 0 ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
	const rules: AvailabilityRule[] = [];
	for (const wd of days) {
		const isSat = wd === 6;
		rules.push({
			weekday: wd,
			startMinute: (startH + (isSat ? 1 : 0)) * 60,
			endMinute: isSat ? 13 * 60 : 12 * 60 + 30,
			label: "Morning",
			kind: "working_hours",
		});
		if (!isSat) {
			rules.push({
				weekday: wd,
				startMinute: 13 * 60 + 30,
				endMinute: closeH * 60,
				label: "Afternoon",
				kind: "working_hours",
			});
		}
	}
	return rules;
}
