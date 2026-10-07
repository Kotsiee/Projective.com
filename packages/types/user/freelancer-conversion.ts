import { z } from "zod";

/**
 * freelancer-conversion — the "Become a Partner" unlock (`PRODUCT_SPEC.md` §Additive, Unlockable
 * Personas): a person who onboarded as a Client/Operator adds the freelancer persona to the same
 * identity. `POST /api/user/freelancer` validates {@link EnableFreelancerInputSchema}, and
 * `UserBackendService.enableFreelancer` calls `org.enable_freelancer_profile`, which answers with the
 * {@link FreelancerConversionResultSchema} shape.
 *
 * Skills are `org.skills` SLUGS — the vocabulary `org.freelancer_profiles.skills` holds — never free
 * text: the RPC refuses an unknown slug, so the schema states the slug shape and the same cap.
 */

// #region Bounds
/** The most starter skills the unlock accepts (`org.enable_freelancer_profile` enforces the same). */
export const MAX_STARTER_SKILLS = 10;

/** An `org.skills.slug`: lowercase words joined by single hyphens. */
export const SkillSlugSchema = z.string().trim().toLowerCase().min(1).max(60).regex(
	/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
	"Choose skills from the list.",
);
// #endregion

// #region Input
/** The unlock request: one to {@link MAX_STARTER_SKILLS} starter skills, de-duplicated. */
export const EnableFreelancerInputSchema = z.object({
	skills: z.array(SkillSlugSchema)
		.min(1, "Choose at least one skill.")
		.max(MAX_STARTER_SKILLS, `Choose at most ${MAX_STARTER_SKILLS} skills.`)
		.transform((skills) => [...new Set(skills)]),
});
export type EnableFreelancerInput = z.infer<typeof EnableFreelancerInputSchema>;
// #endregion

// #region Result
/** What the unlock returns: the person's handle (for `/[handle]/edit`) and whether it was new. */
export const FreelancerConversionResultSchema = z.object({
	/** `org.freelancer_profiles.user_id` — a freelancer profile is keyed by its person. */
	freelancerProfileId: z.string().uuid(),
	/** The PERSON's `@username`, the profile editor's address. */
	handle: z.string().min(1).max(40),
	/** `false` when the profile already existed and the call only re-activated the persona. */
	created: z.boolean(),
	isFreelancer: z.literal(true),
});
export type FreelancerConversionResult = z.infer<typeof FreelancerConversionResultSchema>;
// #endregion

// #region Skill options
/** One `org.skills` row as the starter-skill picker offers it. */
export const StarterSkillOptionSchema = z.object({
	slug: SkillSlugSchema,
	label: z.string().min(1).max(80),
});
export type StarterSkillOption = z.infer<typeof StarterSkillOptionSchema>;
// #endregion
