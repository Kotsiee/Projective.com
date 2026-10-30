import { z } from "zod";
import { KycStatus } from "../finance/verification.ts";
import { ProfileVisibility } from "../profile/profile.ts";

/**
 * org identity rows — the Zod mirror of the person tables (`00000011_tables_org.sql`): the public
 * person row `org.users_public` and the seller row `org.freelancer_profiles` (IDENTITY_AND_WORKSPACES
 * audit IW-M9). The entity and membership rows are in `@projective/types/workspace` (`rows.ts`), the
 * acting-context row in `@projective/types/auth` (`session-context.ts`).
 *
 * These are ROW shapes, camelCase over the snake_case columns, and they assert only what the table
 * asserts: a column with no CHECK is a plain string here, so a bound the database does not hold is
 * never implied. The projections the app renders (`ProfileView`, `UserContext`, …) are built from
 * them. `identity-tables.contract.test.ts` holds them to the migration, column for key.
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
const timestamp = z.string();
/** A `date` column (`YYYY-MM-DD`). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a date.");
/** A `numeric(3,2)` rating average (0.00–5.00 by convention; the column holds no CHECK). */
const ratingAverage = z.number();
// #endregion

// #region org.users_public
/**
 * A row of `org.users_public`: the person, one per `auth.users` row. A TABLE, not a view. `dob` is
 * PII (Decision #190: at least `1900-01-01`, never in the future, the minimum age held by
 * `org.trg_users_public_dob_guard`); the e-mail address is not here but in `org.user_emails`.
 */
export const UsersPublicRowSchema = z.object({
	userId: uuid,
	username: z.string(),
	firstName: z.string().nullable(),
	lastName: z.string().nullable(),
	avatarFileId: uuid.nullable(),
	bannerFileId: uuid.nullable(),
	headline: z.string(),
	city: z.string().nullable(),
	country: z.string().nullable(),
	timezone: z.string().nullable(),
	languages: z.array(z.string()),
	dob: isoDate,
	/** `users_public_visibility_check`. */
	visibility: ProfileVisibility,
	/** The rich-text bio document, validated by the richtext SSOT on write. */
	bio: z.unknown(),
	interests: z.array(z.string()),
	ratingAverage: ratingAverage.nullable(),
	ratingCount: z.number().int().nullable(),
	activeProjectCount: z.number().int().nullable(),
	totalProjectCount: z.number().int().nullable(),
	serviceCount: z.number().int().nullable(),
	productCount: z.number().int().nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
	isFreelancer: z.boolean(),
	hasBusiness: z.boolean(),
	hasTeam: z.boolean(),
	/** Client / Operator Mode: gates the Businesses nav space. */
	isOperator: z.boolean(),
});
export type UsersPublicRow = z.infer<typeof UsersPublicRowSchema>;
// #endregion

// #region org.freelancer_profiles
/** The most hire-intake fields a seller row stores (`ck_freelancer_profiles_hire_intake_shape`). */
export const HIRE_INTAKE_ROW_MAX = 12;

/**
 * A row of `org.freelancer_profiles`: a person's seller side, keyed by their user id. The KYC block
 * is a cache of `finance.verification_cases`; `payoutReady` is the second half of the earning gate
 * (`finance.fn_freelancer_payout_ready`).
 */
export const FreelancerProfileRowSchema = z.object({
	userId: uuid,
	skills: z.array(z.string()),
	/**
	 * Free text in the table (no CHECK). The values written are `available` · `limited` ·
	 * `unavailable`, the set `WorkspaceMember.availability` reads.
	 */
	availabilityStatus: z.string().nullable(),
	currentWorkloadIntensity: z.number().int(),
	availableSince: timestamp,
	ratingAverage: ratingAverage.nullable(),
	ratingCount: z.number().int().nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
	/** The Global Soft Cap on summed active Workload Intensity; `null` is the platform default. */
	maxWorkloadIntensity: z.number().nullable(),
	kycStatus: KycStatus,
	/** 1 Basic · 2 Verified · 3 Business, the `finance.verification_cases.tier` ladder. */
	kycTier: z.number().int().min(1).max(3).nullable(),
	kycVerifiedAt: timestamp.nullable(),
	payoutReady: z.boolean(),
	/** Stripe Identity session id (placeholder; no PII). */
	identityProviderRef: z.string().nullable(),
	/** The HIRE intake document (Decision #108); validated by the intake SSOT on write. */
	hireIntake: z.array(z.unknown()).max(HIRE_INTAKE_ROW_MAX),
});
export type FreelancerProfileRow = z.infer<typeof FreelancerProfileRowSchema>;
// #endregion
