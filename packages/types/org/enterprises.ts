import { z } from "zod";

/**
 * org.enterprises — the Zod SSOT for the **client/buyer-only** corporate entity.
 *
 * An Enterprise is distinct from `org.business_profiles` (a Business — the buyer-side entity with
 * members and a pooled wallet, Decision #61): an enterprise registers only to hire/buy, never to
 * sell. Multi-tenancy is modelled as a membership join table, not a single `users.enterprise_id`, because a user may
 * belong to several enterprises. These shapes mirror migration
 * `supabase/migrations/0314_enterprises.sql` column-for-column and back the
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
/** `org.enterprise_role` — a member's authority within an enterprise. */
export const EnterpriseRole = z.enum(["owner", "admin", "member"]);
export type EnterpriseRole = z.infer<typeof EnterpriseRole>;

/** `org.employee_scale` — headcount tier collected at onboarding. */
export const EmployeeScale = z.enum(["1-50", "51-200", "201-500", "500+"]);
export type EmployeeScale = z.infer<typeof EmployeeScale>;

/** `org.enterprise_status` — lifecycle state (nothing is hard-deleted; use `archived`). */
export const EnterpriseStatus = z.enum(["draft", "active", "suspended", "archived"]);
export type EnterpriseStatus = z.infer<typeof EnterpriseStatus>;

/** `org.enterprise_verification_level` — KYB stays deferred; starts `unverified`. */
export const EnterpriseVerificationLevel = z.enum([
	"unverified",
	"email_verified",
	"kyb_pending",
	"verified",
]);
export type EnterpriseVerificationLevel = z.infer<typeof EnterpriseVerificationLevel>;
// #endregion

// #region Row shapes
/** A row of `org.enterprises`. */
export const EnterpriseSchema = z.object({
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
	status: EnterpriseStatus,
	verificationLevel: EnterpriseVerificationLevel,
	logoFileId: uuid.nullable(),
	billingEmail: z.string().max(160).nullable(),
	defaultCurrency: z.string().max(8),
	createdAt: timestamp,
	updatedAt: timestamp,
});
export type Enterprise = z.infer<typeof EnterpriseSchema>;

/** A row of `org.enterprise_members` — the multi-tenant user↔enterprise link + role. */
export const EnterpriseMemberSchema = z.object({
	id: uuid,
	enterpriseId: uuid,
	userId: uuid,
	role: EnterpriseRole,
	status: z.string().max(20),
	/**
	 * The departments this member sits in: names drawn from the parent's
	 * {@link EnterpriseSchema} `departments` catalogue (an array element cannot carry a FK, so the
	 * agreement is the application's job). A member in N departments is listed under each.
	 */
	departments: z.array(z.string().max(60)),
	invitedBy: uuid.nullable(),
	joinedAt: timestamp,
	createdAt: timestamp,
});
export type EnterpriseMember = z.infer<typeof EnterpriseMemberSchema>;
// #endregion

// #region Insert shape (onboarding wizard payload → columns the app sets)
/**
 * The fields the `/join` enterprise flow supplies when provisioning a new enterprise. The DB
 * derives id/owner/status/verification/timestamps; the CHECK constraint on `industry_other` is
 * mirrored here as a refinement so the same rule is enforced client-, service-, and DB-side.
 */
export const CreateEnterpriseSchema = z.object({
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
export type CreateEnterprise = z.infer<typeof CreateEnterpriseSchema>;
// #endregion

// #region Update shape (org.update_enterprise payload)
/**
 * The keys `org.update_enterprise(p_enterprise_id, p_payload)` accepts — the only write door on
 * `org.enterprises` (the client UPDATE policy is gone). A genuine partial: send only what changes;
 * an empty string clears an optional field. `.strict()` mirrors the RPC, which refuses an unknown key
 * rather than ignoring it, and never lists the platform-owned columns (owner · handle · status ·
 * verification · logo).
 *
 * {@link ENTERPRISE_IDENTITY_KEYS} are the LEGAL identity: the owner's alone to change, and refused
 * by the RPC once `verificationLevel` is `kyb_pending` or `verified`. The cross-field `other`
 * industry rule is checked by the RPC against the stored row, since a partial cannot see it.
 */
export const UpdateEnterpriseSchema = z.object({
	legalName: z.string().trim().min(1).max(160),
	tradingName: z.string().trim().max(160),
	registrationNumber: z.string().trim().max(60),
	corporateEmail: z.string().trim().email().max(160),
	corporatePhone: z.string().trim().max(40),
	website: z.string().trim().max(200),
	addressLine1: z.string().trim().max(160),
	addressCity: z.string().trim().max(80),
	addressPostcode: z.string().trim().max(20),
	addressCountry: z.string().trim().max(60),
	employeeScale: EmployeeScale.or(z.literal("")),
	primaryIndustry: z.string().trim().max(60),
	industryOther: z.string().trim().max(80),
	departments: z.array(z.string().max(60)).max(50),
	purpose: z.array(z.string().max(40)).max(20),
	billingEmail: z.string().trim().email().max(160).or(z.literal("")),
	defaultCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/, "A three-letter currency code."),
}).partial().strict().refine((value) => Object.keys(value).length > 0, {
	message: "Nothing to update.",
});
export type UpdateEnterprise = z.infer<typeof UpdateEnterpriseSchema>;

/** The legal-identity keys of {@link UpdateEnterpriseSchema}: owner-only, frozen once KYB begins. */
export const ENTERPRISE_IDENTITY_KEYS = [
	"legalName",
	"registrationNumber",
	"corporateEmail",
] as const;
// #endregion
