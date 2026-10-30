import { z } from "zod";
import { AutoFundMode } from "../finance/billing.ts";
import { InvoicingMode } from "../finance/buyer.ts";
import { KycStatus } from "../finance/verification.ts";
import { MembershipState, WorkspaceCapability, WorkspaceRole, WorkspaceStatus } from "./common.ts";
import { WorkspaceVisibility } from "./workspace.ts";

/**
 * workspace rows — the Zod mirror of the entity and membership tables (`00000011_tables_org.sql`):
 * `org.teams`, `org.business_profiles`, their role tables and their member tables
 * (IDENTITY_AND_WORKSPACES audit IW-M9). The view models in `workspace.ts` / `members.ts` are
 * projections over these rows; the person rows are in `@projective/types/org` (`identity.ts`).
 *
 * Row shapes assert only what the table asserts: a column with no CHECK stays a plain string here,
 * with the values its writers use named in its doc. `identity-tables.contract.test.ts` holds every
 * schema to the migration, column for key.
 */

// #region Primitives
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID_RE, "Expected a UUID.");
/** An ISO timestamp string as returned by PostgREST. */
const timestamp = z.string();
/** The most hire-intake fields a seller row stores (`ck_teams_hire_intake_shape`). */
const HIRE_INTAKE_MAX = 12;
// #endregion

// #region Entities
/**
 * A row of `org.teams`: the seller-side entity. There is no seat-cap column: the cap is the plan's
 * `team_seats` entitlement (`finance.fn_effective_limit`).
 */
export const TeamRowSchema = z.object({
	id: uuid,
	ownerUserId: uuid,
	name: z.string(),
	slug: z.string(),
	avatarFileId: uuid.nullable(),
	bannerFileId: uuid.nullable(),
	headline: z.string().nullable(),
	/** The rich-text bio document, validated by the richtext SSOT on write. */
	bio: z.unknown(),
	/**
	 * Free text in the table (no CHECK, audit IW-L). Its writers use the {@link WorkspaceVisibility}
	 * values, the CHECK `business_profiles.visibility` carries.
	 */
	visibility: z.string(),
	subscriptionTier: z.string(),
	/** Free text (no CHECK); `manager_discretion` by default. */
	payoutModel: z.string(),
	defaultPayoutSettings: z.unknown().nullable(),
	treasuryWalletId: uuid.nullable(),
	currentWorkloadIntensity: z.number().int(),
	availableSince: timestamp,
	ratingAverage: z.number().nullable(),
	ratingCount: z.number().int().nullable(),
	activeProjectCount: z.number().int().nullable(),
	totalProjectCount: z.number().int().nullable(),
	serviceCount: z.number().int().nullable(),
	productCount: z.number().int().nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
	/** `teams_status_check`. */
	status: WorkspaceStatus,
	/** The HIRE intake document (Decision #61); validated by the intake SSOT on write. */
	hireIntake: z.array(z.unknown()).max(HIRE_INTAKE_MAX),
});
export type TeamRow = z.infer<typeof TeamRowSchema>;

/**
 * A row of `org.business_profiles`: the buyer-side entity with members and a pooled wallet
 * (Decision #61). RLS on with no client policy: reads go through definers (Decision #150).
 */
export const BusinessProfileRowSchema = z.object({
	id: uuid,
	ownerUserId: uuid,
	name: z.string(),
	slug: z.string(),
	legalName: z.string().nullable(),
	logoFileId: uuid.nullable(),
	bannerFileId: uuid.nullable(),
	country: z.string().nullable(),
	billingEmail: z.string().nullable(),
	plan: z.string(),
	headline: z.string(),
	/** The rich-text bio document, validated by the richtext SSOT on write. */
	bio: z.unknown(),
	languages: z.array(z.string()),
	timezone: z.string().nullable(),
	defaultCurrency: z.string().nullable(),
	taxId: z.string().nullable(),
	addressLine1: z.string().nullable(),
	addressCity: z.string().nullable(),
	addressZip: z.string().nullable(),
	ratingAverage: z.number().nullable(),
	ratingCount: z.number().int().nullable(),
	systemPenaltyScore: z.number(),
	invoicingMode: InvoicingMode,
	/** The monthly invoice day, 1–28. */
	billingDay: z.number().int().min(1).max(28).nullable(),
	autoFundMode: AutoFundMode,
	/** The wallet's low-balance floor in `defaultCurrency` minor units; `null` is no floor. */
	lowBalanceFloorCents: z.number().int().positive().nullable(),
	activeProjectCount: z.number().int().nullable(),
	totalProjectCount: z.number().int().nullable(),
	serviceCount: z.number().int().nullable(),
	productCount: z.number().int().nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
	/** `business_profiles_status_check`. */
	status: WorkspaceStatus,
	kybStatus: KycStatus,
	kybVerifiedAt: timestamp.nullable(),
	/** Stripe Connect account id (placeholder; no PII). */
	kybProviderRef: z.string().nullable(),
	/** `business_profiles_visibility_check` (Decision #230 (h)). */
	visibility: WorkspaceVisibility,
});
export type BusinessProfileRow = z.infer<typeof BusinessProfileRowSchema>;
// #endregion

// #region Roles
/** The presets a business roster offers: no `lead` (`ck_business_role_preset`). */
export const BusinessRolePreset = WorkspaceRole.exclude(["lead"]);
export type BusinessRolePreset = z.infer<typeof BusinessRolePreset>;

/** The columns `org.team_roles` and `org.business_roles` share, column for column. */
const roleRowShape = {
	id: uuid,
	name: z.string(),
	/** One-line remit; the empty string when unwritten, never `null`. */
	summary: z.string(),
	capabilities: z.array(WorkspaceCapability),
	/** A retired custom role; a preset row is never archived (`ck_*_role_shape`). */
	archivedAt: timestamp.nullable(),
	createdAt: timestamp,
	updatedAt: timestamp,
};

/**
 * A row of `org.team_roles`. A PRESET row (`preset` set) stores no capabilities (they are
 * `org.fn_preset_capabilities`); a CUSTOM row (`preset` null) stores its own and names the preset it
 * ranks as, never `owner` (`ck_team_role_shape`).
 */
export const TeamRoleRowSchema = z.object({
	...roleRowShape,
	teamId: uuid,
	preset: WorkspaceRole.nullable(),
	basePreset: WorkspaceRole,
});
export type TeamRoleRow = z.infer<typeof TeamRoleRowSchema>;

/** A row of `org.business_roles`: the buyer-side twin of {@link TeamRoleRowSchema}. */
export const BusinessRoleRowSchema = z.object({
	...roleRowShape,
	businessId: uuid,
	preset: BusinessRolePreset.nullable(),
	basePreset: BusinessRolePreset,
});
export type BusinessRoleRow = z.infer<typeof BusinessRoleRowSchema>;
// #endregion

// #region Members
/**
 * The columns `org.team_members` and `org.business_members` share. `role` is the preset the member
 * ranks as (kept in step with the role row by `org.fn_member_role_sync`); `status` is `active` or
 * `left`, with `leftAt` stamped exactly when it is `left`. A departure is never a DELETE.
 */
const memberRowShape = {
	id: uuid,
	userId: uuid,
	roleId: uuid,
	status: MembershipState,
	invitedBy: uuid.nullable(),
	leftAt: timestamp.nullable(),
	/** Layer 3 of the permission model: effective = role ∪ granted − revoked. */
	grantedCapabilities: z.array(WorkspaceCapability),
	revokedCapabilities: z.array(WorkspaceCapability),
	/** The per-membership job title on the roster and the org chart. */
	title: z.string().nullable(),
	/** The org-chart edge: the manager's MEMBERSHIP id; `null` for a root. */
	reportsTo: uuid.nullable(),
	joinedAt: timestamp,
	createdAt: timestamp,
};

/** A row of `org.team_members`. A member's payout share is not here: it is `finance.contribution_agreements`. */
export const TeamMemberRowSchema = z.object({
	...memberRowShape,
	teamId: uuid,
	role: WorkspaceRole,
});
export type TeamMemberRow = z.infer<typeof TeamMemberRowSchema>;

/** A row of `org.business_members`. */
export const BusinessMemberRowSchema = z.object({
	...memberRowShape,
	businessId: uuid,
	role: BusinessRolePreset,
});
export type BusinessMemberRow = z.infer<typeof BusinessMemberRowSchema>;
// #endregion
