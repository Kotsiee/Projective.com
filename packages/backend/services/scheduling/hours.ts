import type { AvailabilityRule } from "@projective/types/scheduling";

/**
 * scheduling hours — the PURE weekly working-hours derivation shared by every fixture that has to
 * agree about when a seller is at their desk: the `/[handle]/availability` calendar
 * (`availability-fixtures.ts`), and the profile projection's `hours` (`profile-fixtures.ts`), which
 * the `/[handle]` context bar summarises into a schedule line and a live "Available now ⁄ Away" badge.
 *
 * It lives in its own module, with no import beyond the type, because the availability fixtures
 * import the profile fixtures — so the profile fixtures importing THEM would be a cycle, and a cycle
 * in a module whose corpus builds at import time is the TDZ crash class of Decision #49, not a style
 * problem. Both callers seed it identically (`hash(profile.handle)` from `derive.ts`), which is what
 * makes the calendar's bands and the profile's summary one fact rather than two.
 */

/**
 * Weekly windows, varied by seed — working hours plus the narrower **call windows** inside them.
 *
 * The two `availability_kind` bands are genuinely different claims, which is why the schema carries
 * both (Decision #56): `working_hours` is the broad "at my desk" overlay, `call_window` is the subset
 * during which the owner accepts a booking from a stranger. Emitting only the broad band and letting
 * the booking layer treat it as bookable would publish a provider's entire working week as open —
 * which is both wrong and the kind of wrong nobody notices, because the grid looks healthy.
 *
 * The call windows are deliberately a MINORITY of the working week: mid-morning and mid-afternoon on
 * most workdays, never the first or last hour, never Saturday. That is what a real provider's booking
 * page looks like, and it is what makes the picker's "offered but spoken for" states reachable.
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
	for (const wd of callWindowDays(seed, days)) {
		rules.push({
			weekday: wd,
			startMinute: (startH + 1) * 60 + 30,
			endMinute: 12 * 60,
			label: "Open for calls",
			kind: "call_window",
		});
		rules.push({
			weekday: wd,
			startMinute: 14 * 60,
			endMinute: (closeH - 1) * 60,
			label: "Open for calls",
			kind: "call_window",
		});
	}
	return rules;
}

/**
 * Which weekdays this owner opens for bookings — a stable subset of the days they work.
 *
 * Never all of them, and never none: a provider who takes calls every working hour is not modelling
 * anything a real booking page has to cope with, and one who takes none makes the picker unreachable
 * across the whole corpus. Saturday is excluded outright — an owner who works a Saturday morning is
 * catching up, not receiving strangers.
 */
export function callWindowDays(seed: number, workdays: readonly number[]): number[] {
	const weekdays = workdays.filter((d) => d >= 1 && d <= 5);
	// Drop one workday, chosen stably, so the rail always has a visible closed day inside its fortnight.
	const skip = weekdays[seed % weekdays.length];
	return weekdays.filter((d) => d !== skip);
}

/** The `working_hours` bands alone — what a profile publishes as its schedule. */
export function workingHoursOf(rules: readonly AvailabilityRule[]): AvailabilityRule[] {
	return rules.filter((rule) => (rule.kind ?? "working_hours") === "working_hours");
}
