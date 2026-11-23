/**
 * legal/acceptance — the rows of `org.legal_document_versions` and `org.legal_acceptances`
 * (Decision #446), the version stamp a sign-up door carries, and the first-commit ask (LG3): the
 * refusal a claim or funding door answers until the IP Transfer Deed or the Escrow Terms is accepted,
 * and the stamp the dialog sends back. Zero drift with `00000011_tables_org.sql` is enforced by
 * `manifest.contract.test.ts`.
 *
 * @module
 */
import { z } from "zod";
import { LegalVersionSchema } from "../content/legal.ts";
import {
	ACCEPTED_LEGAL_SLUGS,
	COMMIT_LEGAL_SLUGS,
	LEGAL_ACCEPTANCE_KINDS,
	LEGAL_ACCEPTANCE_SURFACES,
	SIGNUP_LEGAL_SLUGS,
} from "./manifest.ts";

export const SignupLegalSlugSchema = z.enum(SIGNUP_LEGAL_SLUGS);
export const CommitLegalSlugSchema = z.enum(COMMIT_LEGAL_SLUGS);
export const AcceptedLegalSlugSchema = z.enum(ACCEPTED_LEGAL_SLUGS);
export const LegalAcceptanceKindSchema = z.enum(LEGAL_ACCEPTANCE_KINDS);
export const LegalAcceptanceSurfaceSchema = z.enum(LEGAL_ACCEPTANCE_SURFACES);

/** One row of `org.legal_document_versions`. */
export const LegalDocumentVersionRowSchema = z.object({
	slug: AcceptedLegalSlugSchema,
	version: LegalVersionSchema,
	effectiveDate: z.iso.date(),
	material: z.boolean(),
});
export type LegalDocumentVersionRow = z.infer<typeof LegalDocumentVersionRowSchema>;

/** One row of `org.legal_acceptances`: append-only evidence of one document accepted or shown. */
export const LegalAcceptanceRowSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().uuid(),
	documentSlug: AcceptedLegalSlugSchema,
	version: LegalVersionSchema,
	kind: LegalAcceptanceKindSchema,
	surface: LegalAcceptanceSurfaceSchema,
	/** The enterprise an owner accepted for; set exactly when `surface` is `join_enterprise`. */
	enterpriseId: z.string().uuid().nullable(),
	acceptedAt: z.string(),
});
export type LegalAcceptanceRow = z.infer<typeof LegalAcceptanceRowSchema>;

/**
 * The versions a sign-up door stamps: the `legal_acceptance` key of the sign-up metadata (email and
 * OAuth) and the `legalAcceptance` key of the `create_enterprise` payload. Built only on the server,
 * from `currentLegalVersions()`.
 */
export const LegalVersionStampSchema = z.strictObject({
	terms: LegalVersionSchema,
	"acceptable-use": LegalVersionSchema,
	privacy: LegalVersionSchema,
});

// #region First-commit ask (LG3)
/** The refusal's `reason`, and the SQLSTATE `org.fn_require_legal_acceptance` raises it with. */
export const LEGAL_ACCEPTANCE_REQUIRED = "legal_acceptance_required";
export const LEGAL_GATE_SQLSTATE = "PN409";

/**
 * What a claim or funding door answers (409) while the caller has not accepted the commit document in
 * effect: which document, at which version. The dialog names exactly that version and sends it back.
 */
export const LegalAcceptanceRequiredSchema = z.object({
	reason: z.literal(LEGAL_ACCEPTANCE_REQUIRED),
	document: CommitLegalSlugSchema,
	version: LegalVersionSchema,
});
export type LegalAcceptanceRequired = z.infer<typeof LegalAcceptanceRequiredSchema>;

/** A refusal's `details` as the first-commit ask, or `null` when the refusal is anything else. */
export function readLegalAcceptanceRequired(details: unknown): LegalAcceptanceRequired | null {
	const parsed = LegalAcceptanceRequiredSchema.safeParse(details);
	return parsed.success ? parsed.data : null;
}

/**
 * The `legalAcceptance` a claim or funding request carries after the dialog: the document the person
 * ticked, at the version they were shown. The database accepts only the version in effect.
 */
export const LegalCommitStampSchema = z.strictObject({
	"ip-transfer-deed": LegalVersionSchema.optional(),
	"escrow-terms": LegalVersionSchema.optional(),
});
// #endregion
