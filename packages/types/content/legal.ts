/**
 * content.legal — the schema of a legal document version (`/legal/<slug>`, Decision #270).
 *
 * A legal document is a family of VERSIONS, each a whole {@link LegalDoc}: the full text as it stood
 * when that version took effect. Versions are append-only (nothing is ever removed — an old version
 * stays readable at `/legal/<slug>?v=<version>` and is what a clause-level compare diffs against), so
 * a content module exports every version of its document, newest first.
 *
 * What a version adds to the editorial core ({@link DocSchema}):
 *
 * | Field           | Meaning                                                                       |
 * | :-------------- | :---------------------------------------------------------------------------- |
 * | `slug`          | One of {@link LEGAL_DOCUMENT_SLUGS} — never a {@link LEGAL_RESERVED_SLUGS} word |
 * | `version`       | `MAJOR.MINOR` (`2.0`); orders the family                                      |
 * | `effectiveDate` | The day this version governs from; the newest one in effect is "current"    |
 * | `reviewedAt`    | The day a lawyer signed this version off; `null` = a draft (owner ruling (e): a visible "Draft — pending legal review" disclosure and `noindex` until it is set) |
 * | `changeSummary` | One sentence on what this version changed (the first: what it established)  |
 *
 * Clause numbers are not stored: they are the section's position (`anchorDoc(doc, { numbered: true })`
 * — `1`, `1.1`), so an added clause renumbers the ones after it exactly as a printed agreement does,
 * while the section `id` (the `#anchor`) stays fixed across versions and is what the compare matches
 * clauses by.
 *
 * @module
 */
import { z } from "zod";
import { checkDocAnchors, DocBaseSchema, IsoDateSchema } from "./doc.ts";

// #region Slugs
/**
 * Every legal document, in the order the hub and the document rail list them. A slug is a fixed
 * identifier (not an editorial row, so Decision #274 (k)'s immutability trigger does not apply): it is
 * part of every agreement's URL and of the footer, so it never changes once published.
 */
export const LEGAL_DOCUMENT_SLUGS = [
	"terms",
	"privacy",
	"cookies",
	"acceptable-use",
	"escrow-terms",
	"ip-transfer-deed",
] as const;

/** A legal document's slug. */
export const LegalSlugSchema = z.enum(LEGAL_DOCUMENT_SLUGS);
/** A legal document's slug. */
export type LegalSlug = z.infer<typeof LegalSlugSchema>;

/**
 * Path segments under `/legal/` that are NOT documents and never may be: `workspace` is the signed-in
 * IP chain-of-title workspace (`/legal/workspace/{audit-packs,transfers}`, ruling (a)).
 */
export const LEGAL_RESERVED_SLUGS: readonly string[] = ["workspace"];

/** Whether `value` names a legal document (and is therefore never a reserved segment). */
export function isLegalSlug(value: string): value is LegalSlug {
	return (LEGAL_DOCUMENT_SLUGS as readonly string[]).includes(value) &&
		!LEGAL_RESERVED_SLUGS.includes(value);
}
// #endregion

// #region Version
/** A legal version label: `MAJOR.MINOR` (`1.0`, `2.1`), no leading zeros. */
export const LegalVersionSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/, {
	message: "Legal versions are MAJOR.MINOR, e.g. 2.0",
});
// #endregion

// #region Document
/**
 * One version of a legal document: the editorial core plus the fields in the module table. Built
 * from {@link DocBaseSchema} because `slug` and `version` are narrowed (a refined schema cannot
 * re-declare a key), then refined with the shared anchor rule.
 */
export const LegalDocSchema = DocBaseSchema.extend({
	slug: LegalSlugSchema,
	version: LegalVersionSchema,
	effectiveDate: IsoDateSchema,
	reviewedAt: IsoDateSchema.nullable(),
	changeSummary: z.string().min(1),
}).superRefine((doc, ctx) => {
	checkDocAnchors(doc, ctx);
	if (doc.reviewedAt !== null && doc.reviewedAt < doc.updatedAt) {
		ctx.addIssue({
			code: "custom",
			path: ["reviewedAt"],
			message: "A review must post-date the text it signed off (reviewedAt < updatedAt)",
		});
	}
});
/** One version of a legal document. */
export type LegalDoc = z.infer<typeof LegalDocSchema>;
// #endregion
