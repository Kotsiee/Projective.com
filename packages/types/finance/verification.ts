import { z } from "zod";
import { timestamp, uuid } from "./common.ts";

/**
 * finance verification — KYC (individual identity) & KYB (business) status, tier, and the auditable
 * verification case. Mirrors migration 20260723091000: the `finance.kyc_status` enum, the
 * `finance.verification_cases` trail, and the denormalised cache columns added to
 * `org.freelancer_profiles` (KYC) and `org.business_profiles` (KYB).
 *
 * Gating rule (finance-model.md §KYC/KYB Gating): freelancers (earners) must be verified + payout-ready
 * before landing a gig / joining a team; individual clients need NO ID verification (tap-and-pay);
 * business owners need KYB to operate the pooled Business Wallet. Distinct from EMAIL verification
 * (`org.user_emails.verified_at`, migration 0312) — never conflated. Organisations keep their own
 * `org.organisation_verification_level` (migration 0314), unchanged.
 *
 * ⚠️ NO PII: only opaque provider references (Stripe Identity session / Connect account id) are
 * modelled — never a document number, image, or SSN.
 */

// #region Status
/** `finance.kyc_status` — the individual/business identity verification lifecycle. */
export const KycStatus = z.enum(["unverified", "pending", "verified", "rejected", "expired"]);
export type KycStatus = z.infer<typeof KycStatus>;

/** The verification ladder tier (PRODUCT_SPEC §Identity): 1 Basic · 2 Verified · 3 Business (KYB). */
export const VerificationTier = z.number().int().min(1).max(3);
// #endregion

// #region Verification case (audit trail)
/** The subject of a verification case. */
export const VerificationSubjectType = z.enum(["freelancer", "business", "organisation", "user"]);
export type VerificationSubjectType = z.infer<typeof VerificationSubjectType>;

/** Whether the case is individual identity (`kyc`) or business (`kyb`). */
export const VerificationKind = z.enum(["kyc", "kyb"]);
export type VerificationKind = z.infer<typeof VerificationKind>;

/** A row of `finance.verification_cases` — the append-friendly verification history (no PII). */
export const VerificationCaseSchema = z.object({
	id: uuid,
	subjectType: VerificationSubjectType,
	subjectId: uuid,
	kind: VerificationKind,
	status: KycStatus,
	tier: VerificationTier.nullable(),
	provider: z.string().max(60),
	/** External verification-session / Connect account id (placeholder XXXX-XXXX in docs). */
	providerRef: z.string().max(200).nullable(),
	submittedAt: timestamp.nullable(),
	decidedAt: timestamp.nullable(),
	notes: z.string().max(2000).nullable(),
	createdAt: timestamp,
});
export type VerificationCase = z.infer<typeof VerificationCaseSchema>;
// #endregion

// #region Denormalised caches (additive columns on org tables)
/**
 * The KYC + payout-readiness columns added to `org.freelancer_profiles`. `payoutReady` is the
 * onboarding gate: true only when KYC-verified AND a usable payout method exists
 * (`finance.fn_freelancer_payout_ready`).
 */
export const FreelancerVerificationSchema = z.object({
	kycStatus: KycStatus,
	kycTier: VerificationTier.nullable(),
	kycVerifiedAt: timestamp.nullable(),
	payoutReady: z.boolean(),
	/** Stripe Identity session id (placeholder; no PII). */
	identityProviderRef: z.string().max(200).nullable(),
});
export type FreelancerVerification = z.infer<typeof FreelancerVerificationSchema>;

/** The KYB columns added to `org.business_profiles` — required to OPERATE the pooled Business Wallet. */
export const BusinessVerificationSchema = z.object({
	kybStatus: KycStatus,
	kybVerifiedAt: timestamp.nullable(),
	/** Stripe Connect account id (placeholder; no PII). */
	kybProviderRef: z.string().max(200).nullable(),
});
export type BusinessVerification = z.infer<typeof BusinessVerificationSchema>;
// #endregion
