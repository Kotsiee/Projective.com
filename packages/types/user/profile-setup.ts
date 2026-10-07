import { z } from "zod";
import { ProfileHoursSchema, ProfileStandingSchema } from "../profile/profile.ts";
import { ProfileSetupProgressSchema } from "../org/onboarding.ts";
import { VerificationStampSchema } from "../org/standing.ts";

/**
 * profile-setup — the account-setup read behind the header account popover: the acting PERSON's own
 * setup progress, their verification stamp, and the two published projections the popover draws
 * beside the ring (`GET /api/user/setup`).
 *
 * The percentage is computed in ONE place, `org.fn_compute_profile_setup_progress` (Decision #155,
 * reversing #149(A)'s TypeScript rule); {@link AccountSetupSchema} only carries what it answered. An
 * unreadable setup is `setup: null`, which draws no ring — never a ring at 0%.
 */

// #region Account setup
export const AccountSetupSchema = z.object({
	/**
	 * The PERSON's own handle, without the `@` (`org.users_public.username`). Distinct from
	 * `UserContext.handle`, which is the ENTITY's slug while acting as a team, business or
	 * organisation — the setup steps edit the person's profile, never the entity's.
	 */
	handle: z.string().max(40),
	/** Whether the person holds a seller (freelancer) profile. */
	seller: z.boolean(),
	/** The computed progress and the next step worth taking. */
	progress: ProfileSetupProgressSchema,
	/** The person's strongest verification authority (`none` until a check lands). */
	verificationStamp: VerificationStampSchema,
	/** The published weekly hours (own timezone), or `null` when none are published. */
	hours: ProfileHoursSchema.nullable(),
	/** The earned Standing rung; `null` for a buyer-only person, who has no seller standing. */
	standing: ProfileStandingSchema.nullable(),
});
export type AccountSetup = z.infer<typeof AccountSetupSchema>;
// #endregion
