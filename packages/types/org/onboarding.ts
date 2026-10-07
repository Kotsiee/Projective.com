import { z } from "zod";

/**
 * `org` onboarding progress — how far a person's own profile is set up (Decision #155).
 *
 * The RULE lives in exactly one place, `org.fn_compute_profile_setup_progress` (00001010): the weights,
 * the step order and the next-action priority are computed there from stored state, and this module
 * only carries the result. Nothing here may re-derive a score — a dev simulation substitutes a whole
 * {@link ProfileSetupProgress} rather than re-implementing the weights.
 */

// #region Vocabulary
/**
 * The setup steps, in checklist order. Weights (SQL): account 20 · email_verified 10 · skills 10 —
 * the 40 a finished sign-up earns — then avatar 20 · profile_copy 20 · working_hours 20.
 */
export const SetupStepKeySchema = z.enum([
	"account",
	"email_verified",
	"skills",
	"avatar",
	"profile_copy",
	"working_hours",
]);
export type SetupStepKey = z.infer<typeof SetupStepKeySchema>;

/** Every step, in the order a checklist lists them. */
export const SETUP_STEP_ORDER: readonly SetupStepKey[] = SetupStepKeySchema.options;

/**
 * The single highest-yield next step the function suggests. Beyond the setup steps it includes a
 * seller's earning gate (`verify_identity`, `add_payout`) and a buyer's freelancer unlock.
 */
export const SetupActionSchema = z.enum([
	"verify_email",
	"verify_identity",
	"add_payout",
	"add_photo",
	"write_profile",
	"publish_hours",
	"add_skills",
	"complete_account",
	"become_partner",
]);
export type SetupAction = z.infer<typeof SetupActionSchema>;
// #endregion

// #region Progress
/** The computed setup progress of one person. */
export const ProfileSetupProgressSchema = z.object({
	/** `0`–`100`; a finished sign-up reads 40. */
	score: z.number().int().min(0).max(100),
	/** The steps already done, in checklist order. */
	completedKeys: z.array(SetupStepKeySchema),
	/** The next step worth taking, or `null` when nothing is left. */
	nextSuggestedAction: SetupActionSchema.nullable(),
});
export type ProfileSetupProgress = z.infer<typeof ProfileSetupProgressSchema>;

/** The RPC's snake_case answer, parsed straight into {@link ProfileSetupProgress}. */
export const ProfileSetupProgressRowSchema = z
	.object({
		score: z.number().int().min(0).max(100),
		completed_keys: z.array(SetupStepKeySchema),
		next_suggested_action: SetupActionSchema.nullable(),
	})
	.transform((row): ProfileSetupProgress => ({
		score: row.score,
		completedKeys: row.completed_keys,
		nextSuggestedAction: row.next_suggested_action,
	}));

/** The steps still to do, in checklist order. */
export function pendingSetupSteps(progress: ProfileSetupProgress): SetupStepKey[] {
	const done = new Set(progress.completedKeys);
	return SETUP_STEP_ORDER.filter((key) => !done.has(key));
}
// #endregion
