import { z } from "zod";

/**
 * org.organisations — the Zod SSOT for the **client/buyer-only** corporate entity.
 *
 * An Organisation is distinct from `org.business_profiles` (the seller-side entity that offers
 * services/products): an organisation registers only to hire/buy, never to sell. Multi-tenancy is
 * modelled as a membership join table, not a single `users.organisation_id`, because a user may
 * belong to several organisations. These shapes mirror migration
 * `supabase/migrations/0314_organisations.sql` column-for-column and back the
 * `documentation/database/org/*` docs — the three land together (root CLAUDE.md §1).
 *
 * Only regex/min/max/enum/array primitives are used, so the schema is stable across Zod majors
 * (matching the convention in `apps/web/features/auth/core/schema.ts`).
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opaque UUID id. */
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
const timestamp = z.string();
// #endregion

// #region Enums (mirror the Postgres enum types created in migration 0314)
/** `org.organisation_role` — a member's authority within an organisation. */
export const OrganisationRole = z.enum(["owner", "admin", "member"]);
export type OrganisationRole = z.infer<typeof OrganisationRole>;

/** `org.employee_scale` — headcount tier collected at onboarding. */
export const EmployeeScale = z.enum(["1-50", "51-200", "201-500", "500+"]);
export type EmployeeScale = z.infer<typeof EmployeeScale>;

/** `org.organisation_status` — lifecycle state (nothing is hard-deleted; use `archived`). */
export const OrganisationStatus = z.enum(["draft", "active", "suspended", "archived"]);
export type OrganisationStatus = z.infer<typeof OrganisationStatus>;

/** `org.organisation_verification_level` — KYB stays deferred; starts `unverified`. */
export const OrganisationVerificationLevel = z.enum([
	"unverified",
	"email_verified",
	"kyb_pending",
	"verified",
]);
export type OrganisationVerificationLevel = z.infer<typeof OrganisationVerificationLevel>;
// #endregion

// #region Row shapes
/** A row of `org.organisations`. */
export const OrganisationSchema = z.object({
	id: uuid,
	ownerUserId: uuid,
	legalName: z.string().min(1).max(160),
	tradingName: z.string().max(160).nullable(),
	handle: z.string().min(1).max(40),
	/** CRN / EIN / VAT / Tax ID. */
	registrationNumber: z.string().max(60).nullable(),
	corporateEmail: z.string().max(160),
	corporatePhone: z.string().max(40).nullable(),
	/** Corporate website / domain. */
	website: z.string().max(200).nullable(),
	addressLine1: z.string().max(160).nullable(),
	addressCity: z.string().max(80).nullable(),
	addressPostcode: z.string().max(20).nullable(),
	addressCountry: z.string().max(60).nullable(),
	employeeScale: EmployeeScale.nullable(),
	/** Industry slug from the onboarding set; `other` requires {@link industryOther}. */
	primaryIndustry: z.string().max(60).nullable(),
	industryOther: z.string().max(80).nullable(),
	departments: z.array(z.string().max(60)),
	purpose: z.array(z.string().max(40)),
	status: OrganisationStatus,
	verificationLevel: OrganisationVerificationLevel,
	logoFileId: uuid.nullable(),
	billingEmail: z.string().max(160).nullable(),
	defaultCurrency: z.string().max(8),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type Organisation = z.infer<typeof OrganisationSchema>;

/** A row of `org.organisation_members` — the multi-tenant user↔organisation link + role. */
export const OrganisationMemberSchema = z.object({
	id: uuid,
	organisationId: uuid,
	userId: uuid,
	role: OrganisationRole,
	status: z.string().max(20),
	invitedBy: uuid.nullable(),
	joinedAt: timestamp,
	createdAt: timestamp,
});
export type OrganisationMember = z.infer<typeof OrganisationMemberSchema>;
// #endregion

// #region Insert shape (onboarding wizard payload → columns the app sets)
/**
 * The fields the `/join` organisation flow supplies when provisioning a new organisation. The DB
 * derives id/owner/status/verification/timestamps; the CHECK constraint on `industry_other` is
 * mirrored here as a refinement so the same rule is enforced client-, service-, and DB-side.
 */
export const CreateOrganisationSchema = z.object({
	legalName: z.string().min(1).max(160),
	tradingName: z.string().max(160).default(""),
	handle: z.string().min(1).max(40),
	registrationNumber: z.string().max(60).default(""),
	corporateEmail: z.string().max(160),
	corporatePhone: z.string().max(40).default(""),
	website: z.string().max(200).default(""),
	addressLine1: z.string().min(1).max(160),
	addressCity: z.string().min(1).max(80),
	addressPostcode: z.string().min(1).max(20),
	addressCountry: z.string().min(1).max(60),
	employeeScale: EmployeeScale,
	primaryIndustry: z.string().min(1).max(60),
	industryOther: z.string().max(80).default(""),
	departments: z.array(z.string().max(60)).max(50).default([]),
	purpose: z.array(z.string().max(40)).max(20).default([]),
}).superRefine((value, ctx) => {
	if (value.primaryIndustry === "other" && value.industryOther.trim().length === 0) {
		ctx.addIssue({
			code: "custom",
			path: ["industryOther"],
			message: "Specify your industry.",
		});
	}
});
export type CreateOrganisation = z.infer<typeof CreateOrganisationSchema>;
// #endregion
