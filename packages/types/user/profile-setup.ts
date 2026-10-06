import { z } from "zod";
import { ProfileHoursSchema, ProfileStandingSchema } from "../profile/profile.ts";

/**
 * profile-setup — how far the acting PERSON's own profile is set up, for the header account popover's
 * completion ring and its "go live" nudge (`PRODUCT_SPEC.md` §Additive, Unlockable Personas — the
 * go-live milestone).
 *
 * Two halves, deliberately split: {@link AccountSetupSchema} carries the raw FACTS the server read
 * (is there a photo, how many skills, are the hours published), and {@link calculateProfileCompleteness}
 * turns facts into steps and a percentage. The server never ships a percentage, so the rule for what
 * counts as "set up" lives in exactly one pure function that the island, the server and a test all
 * call — and a dev simulation can swap the facts without re-implementing the rule.
 *
 * Every fact is DERIVED from stored data; none is asserted. A fact the server could not check (the
 * payout read is not connected in this environment) arrives as `null` and its step is left out of
 * the count entirely, rather than counted as done or as missing — a ring that claims a step the
 * platform never looked at is the one failure this model must not have.
 */

// #region Facts
/** The raw, derived facts the completeness rule is computed from. */
export const ProfileSetupFactsSchema = z.object({
	/** Whether the person holds a seller (freelancer) profile — sellers have the longer checklist. */
	seller: z.boolean(),
	/** An uploaded profile photo exists (`org.users_public.avatar_file_id`); a sign-in provider's does not count. */
	hasPhoto: z.boolean(),
	/** The headline is non-empty (`org.users_public.headline`). */
	hasHeadline: z.boolean(),
	/** The story is non-empty (`org.users_public.bio`, as plain text). */
	hasStory: z.boolean(),
	/** How many skills the seller profile carries (`org.freelancer_profiles.skills`). */
	skillCount: z.number().int().min(0),
	/** A payout account is ready (`org.freelancer_profiles.payout_ready`); `null` = not checkable here. */
	payoutReady: z.boolean().nullable(),
	/** Weekly working hours are published (`scheduling.schedules.is_published` with ≥ 1 band). */
	hoursPublished: z.boolean(),
});
export type ProfileSetupFacts = z.infer<typeof ProfileSetupFactsSchema>;

/**
 * The account-setup read (`GET /api/user/setup`): the facts, plus the two published projections the
 * popover draws beside the ring — the working hours its presence pip is derived from, and the earned
 * Standing rung.
 */
export const AccountSetupSchema = z.object({
	/**
	 * The PERSON's own handle, without the `@` (`org.users_public.username`). Distinct from
	 * `UserContext.handle`, which is the ENTITY's slug while acting as a team, business or
	 * organisation — the setup steps edit the person's profile, never the entity's.
	 */
	handle: z.string().max(40),
	facts: ProfileSetupFactsSchema,
	/** The published weekly hours (own timezone), or `null` when none are published. */
	hours: ProfileHoursSchema.nullable(),
	/** The earned Standing rung; `null` for a buyer-only person, who has no seller standing. */
	standing: ProfileStandingSchema.nullable(),
});
export type AccountSetup = z.infer<typeof AccountSetupSchema>;
// #endregion

// #region The rule
/** The minimum number of skills the go-live milestone asks a seller for. */
export const GO_LIVE_MIN_SKILLS = 3;

/** One checklist step, in the order the popover lists them. */
export type ProfileSetupStepId = "photo" | "story" | "skills" | "payout" | "hours";

/** A resolved checklist step. */
export interface ProfileSetupStep {
	id: ProfileSetupStepId;
	/** Imperative label, read the same whether the step is done or pending ("Add a profile photo"). */
	label: string;
	done: boolean;
	/** Part of the go-live baseline (photo · headline + story · skills) rather than full completion. */
	goLive: boolean;
}

/** The computed completeness of a profile. */
export interface ProfileCompleteness {
	/** `0`–`100`, rounded, over the steps that could be checked. */
	percent: number;
	/** Every applicable, checkable step, in display order. */
	steps: ProfileSetupStep[];
	/** How many of {@link steps} are still pending. */
	remaining: number;
	/** Every checkable step is done. */
	complete: boolean;
	/**
	 * The go-live milestone. `applies` is `false` for a buyer-only person, who publishes nothing to
	 * sell; for a seller, `met` is what lets them publish publicly — which can happen before 100%.
	 */
	goLive: { applies: boolean; met: boolean; remaining: number };
}

/**
 * Compute a profile's completeness from its {@link ProfileSetupFacts}. Pure and total.
 *
 * A seller's checklist: photo · headline + story · at least {@link GO_LIVE_MIN_SKILLS} skills ·
 * payout method · published working hours. The first three are the go-live baseline. A buyer-only
 * person has no skills or payout to set up, so their checklist is photo · headline + story · hours,
 * and the go-live milestone does not apply. A `null` payout fact drops that step from the count.
 */
export function calculateProfileCompleteness(facts: ProfileSetupFacts): ProfileCompleteness {
	const candidates: Array<ProfileSetupStep | null> = [
		{ id: "photo", label: "Add a profile photo", done: facts.hasPhoto, goLive: true },
		{
			id: "story",
			label: "Write your headline and story",
			done: facts.hasHeadline && facts.hasStory,
			goLive: true,
		},
		facts.seller
			? {
				id: "skills",
				label: `Add at least ${GO_LIVE_MIN_SKILLS} skills`,
				done: facts.skillCount >= GO_LIVE_MIN_SKILLS,
				goLive: true,
			}
			: null,
		facts.seller && facts.payoutReady !== null
			? { id: "payout", label: "Add a payout method", done: facts.payoutReady, goLive: false }
			: null,
		{ id: "hours", label: "Publish your working hours", done: facts.hoursPublished, goLive: false },
	];
	// A buyer's two identity steps still exist; only a seller's are the go-live baseline.
	const steps = candidates
		.filter((s): s is ProfileSetupStep => s !== null)
		.map((s) => facts.seller ? s : { ...s, goLive: false });

	const done = steps.filter((s) => s.done).length;
	const remaining = steps.length - done;
	const liveSteps = steps.filter((s) => s.goLive);
	const liveRemaining = liveSteps.filter((s) => !s.done).length;

	return {
		percent: steps.length === 0 ? 100 : Math.round((done / steps.length) * 100),
		steps,
		remaining,
		complete: remaining === 0,
		goLive: {
			applies: facts.seller,
			met: facts.seller && liveRemaining === 0,
			remaining: liveRemaining,
		},
	};
}
// #endregion
