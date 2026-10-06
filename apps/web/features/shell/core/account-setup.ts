import type { AccountSetup, ProfileSetupStepId } from "@projective/types/user";
import { GO_LIVE_MIN_SKILLS } from "@projective/types/user";
import type { ProfileHours } from "@projective/types/profile";
import type { DevProfileSetup } from "@web/utils/dev-seam.ts";
import { availabilityAt, hoursSummary } from "@web/features/profile/core/hours.ts";

/**
 * account-setup — the account popover's view of the PERSON's own profile: where each setup step is
 * edited, the presence pip derived from published working hours, and the dev simulation of both.
 *
 * The completeness RULE is not here; it is `calculateProfileCompleteness` in `@projective/types/user`,
 * shared with the server and its tests. This module only routes the rule's steps and derives presence.
 */

// #region Step routes
/**
 * Where a checklist step is completed. Identity steps open the profile editor; payout opens
 * Verification & payouts; hours open the Availability editor. `handle` is the PERSON's (no `@`).
 */
export function setupStepHref(step: ProfileSetupStepId, handle: string): string {
	switch (step) {
		case "payout":
			return "/settings/verification";
		case "hours":
			return `/${handle}/edit/availability`;
		default:
			return `/${handle}/edit`;
	}
}
// #endregion

// #region Presence (derived, never asserted)
/** The pip's two tones — inside a published working band now, or outside it. */
export type PresenceTone = "available" | "away";

/** The presence line + its tooltip, derived from published hours and the clock. */
export interface Presence {
	tone: PresenceTone;
	/** `Available now` / `Away`. */
	label: string;
	/** The next edge: `Until 5:30 PM` / `Back Mon 9:00 AM`, or `null` when there is none. */
	next: string | null;
	/** The weekly schedule in the schedule's own zone: `Mon–Fri, 9:00 AM – 5:30 PM · BST`. */
	schedule: string;
}

/** The short zone name (`BST`, `EDT`, `GMT+1`) in the viewer's own locale, or the IANA id. */
function zoneLabel(timezone: string, now: number): string {
	try {
		const parts = new Intl.DateTimeFormat(undefined, { timeZone: timezone, timeZoneName: "short" })
			.formatToParts(new Date(now));
		return parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
	} catch {
		return timezone;
	}
}

/**
 * The owner's presence at `now`, derived from the SAME published working hours a visitor's
 * "Available now ⁄ Away" badge reads (`PRODUCT_SPEC.md` — availability is derived, never asserted).
 * `null` when no hours are published: there is then nothing to say, and the pip is not drawn.
 */
export function presenceAt(hours: ProfileHours | null, now: number): Presence | null {
	if (!hours || hours.rules.length === 0) return null;
	const state = availabilityAt(hours, now);
	const lines = hoursSummary(hours.rules).map((line) => `${line.days}, ${line.times}`);
	if (lines.length === 0) return null;
	return {
		tone: state.available ? "available" : "away",
		label: state.available ? "Available now" : "Away",
		next: state.nextLabel,
		schedule: `${lines.join("; ")} · ${zoneLabel(hours.timezone, now)}`,
	};
}
// #endregion

// #region Dev simulation
/** The browser's own zone, so a simulated schedule is "working hours" wherever the developer is. */
function browserZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/** Mon–Fri 9:00–17:30 — the schedule the `complete` simulation publishes. */
function weekdayHours(): ProfileHours {
	return {
		timezone: browserZone(),
		rules: [1, 2, 3, 4, 5].map((weekday) => ({
			weekday,
			startMinute: 9 * 60,
			endMinute: 17 * 60 + 30,
			kind: "working_hours" as const,
		})),
	};
}

/**
 * The {@link AccountSetup} a Dev Context Switcher `profileSetup` position stands for. It substitutes
 * FACTS only — the shipping completeness rule still decides the percentage — and keeps the real
 * handle and standing where they are known, so links in the simulation still go somewhere real.
 */
export function simulatedSetup(
	position: Exclude<DevProfileSetup, "auto">,
	base: { handle: string; seller: boolean; standing: AccountSetup["standing"] },
): AccountSetup {
	const identity = position !== "new";
	const finished = position === "complete";
	return {
		handle: base.handle,
		facts: {
			seller: base.seller,
			hasPhoto: identity,
			hasHeadline: identity,
			hasStory: identity,
			skillCount: identity ? GO_LIVE_MIN_SKILLS : 0,
			payoutReady: finished,
			hoursPublished: finished,
		},
		hours: finished ? weekdayHours() : null,
		standing: base.standing ?? (base.seller ? { level: 1, label: "New" } : null),
	};
}
// #endregion
