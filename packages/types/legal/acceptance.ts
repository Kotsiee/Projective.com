/**
 * legal/acceptance — the rows of `org.legal_document_versions` and `org.legal_acceptances`
 * (Decision #446), and the version stamp a sign-up door carries. Zero drift with
 * `00000011_tables_org.sql` is enforced by `manifest.contract.test.ts`.
 *
 * @module
 */
import { z } from "zod";
import { LegalVersionSchema } from "../content/legal.ts";
import {
	LEGAL_ACCEPTANCE_KINDS,
	LEGAL_ACCEPTANCE_SURFACES,
	SIGNUP_LEGAL_SLUGS,
} from "./manifest.ts";

export const SignupLegalSlugSchema = z.enum(SIGNUP_LEGAL_SLUGS);
export const LegalAcceptanceKindSchema = z.enum(LEGAL_ACCEPTANCE_KINDS);
export const LegalAcceptanceSurfaceSchema = z.enum(LEGAL_ACCEPTANCE_SURFACES);

/** One row of `org.legal_document_versions`. */
export const LegalDocumentVersionRowSchema = z.object({
	slug: SignupLegalSlugSchema,
	version: LegalVersionSchema,
	effectiveDate: z.iso.date(),
	material: z.boolean(),
});
export type LegalDocumentVersionRow = z.infer<typeof LegalDocumentVersionRowSchema>;

/** One row of `org.legal_acceptances`: append-only evidence of one document accepted or shown. */
export const LegalAcceptanceRowSchema = z.object({
	id: z.string().uuid(),
	userId: z.string().uuid(),
	documentSlug: SignupLegalSlugSchema,
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
