import type { AccountSetup } from "@projective/types/user";
import {
	type ProfileSetupProgress,
	SETUP_STEP_ORDER,
	type VerificationStamp,
} from "@projective/types/org";
import type { ProfileHours } from "@projective/types/profile";
import type { DevProfileSetup, DevVerificationStamp } from "@web/utils/dev-seam.ts";
import { availabilityAt, hoursSummary } from "@web/features/profile/core/hours.ts";

/**
 * account-setup — the account popover's view of the PERSON's own profile: where each setup step and
 * the suggested next action are completed, the presence pip derived from published working hours,
 * and the dev simulation of both.
 *
 * The completeness RULE is not here; it is `org.fn_compute_profile_setup_progress` (Decision #155).
 * This module only names and routes what that function answered.
 */

// #region Step + action routes
export {
	SETUP_ACTION_LABEL,
	SETUP_ACTION_REASON,
	SETUP_STEP_LABEL,
	setupActionHref,
	setupChecklist,
	type SetupChecklistLine,
	setupStepHref,
} from "./setup-actions.ts";
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
 * What `org.fn_compute_profile_setup_progress` answers at each simulated position. Fixed answers,
 * not a re-derivation: the weights live in SQL alone.
 */
function simulatedProgress(
	position: Exclude<DevProfileSetup, "auto">,
	seller: boolean,
): ProfileSetupProgress {
	switch (position) {
		case "new":
			return {
				score: 40,
				completedKeys: ["account", "email_verified", "skills"],
				nextSuggestedAction: seller ? "verify_identity" : "add_photo",
			};
		case "live":
			return {
				score: 80,
				completedKeys: ["account", "email_verified", "skills", "avatar", "profile_copy"],
				nextSuggestedAction: seller ? "add_payout" : "publish_hours",
			};
		case "complete":
			return {
				score: 100,
				completedKeys: [...SETUP_STEP_ORDER],
				nextSuggestedAction: seller ? null : "become_partner",
			};
	}
}

/**
 * The {@link AccountSetup} the Dev Context Switcher's `profileSetup` and `verificationStamp`
 * positions stand for, over the real read (or a bare base when it has not landed). Keeps the real
 * handle and standing so links in the simulation still go somewhere real.
 */
export function simulatedSetup(
	real: AccountSetup | null,
	position: DevProfileSetup,
	stamp: DevVerificationStamp,
	base: { handle: string; seller: boolean; standing: AccountSetup["standing"] },
): AccountSetup | null {
	if (position === "auto" && stamp === "auto") {
		return real ? { ...real, seller: base.seller } : null;
	}
	const finished = position === "complete";
	const progress = position !== "auto"
		? simulatedProgress(position, base.seller)
		: real?.progress ?? simulatedProgress("new", base.seller);
	const verificationStamp: VerificationStamp = stamp !== "auto"
		? stamp
		: real?.verificationStamp ?? "none";
	return {
		handle: real?.handle ?? base.handle,
		seller: base.seller,
		progress,
		verificationStamp,
		hours: position === "auto" ? real?.hours ?? null : finished ? weekdayHours() : null,
		standing: real?.standing ?? base.standing ?? (base.seller ? { level: 1, label: "New" } : null),
	};
}
// #endregion
