import { z } from "zod";

/**
 * One capability per act on a business project (BUSINESSES_AUDIT §4.2, work order BB2). The database
 * is the authority: hiring, assigning and approving work that releases escrow need `hire`; billing a
 * new project to the business needs `manage_projects`; buying as the business needs `purchase` on top
 * of vault `spend`; funding escrow needs vault `spend` on the business wallet (`not_funder`). These
 * are the shapes the API and the islands share for those refusals; the wording is BU6's.
 */

// #region Refusal
/** The SQLSTATE the business-authority refusals raise (shared with the other verification refusals). */
export const BUSINESS_AUTHORITY_SQLSTATE = "PK403";

/**
 * The refusal code on the API envelope (`details.reason`): the capability that was missing, or
 * `not_funder` for a caller who may not move the client's money into escrow.
 */
export const BusinessAuthorityReason = z.enum([
	"hire",
	"purchase",
	"manage_projects",
	"not_funder",
]);
export type BusinessAuthorityReason = z.infer<typeof BusinessAuthorityReason>;

/** `details` of a business-authority refusal. */
export const BusinessAuthorityDetailsSchema = z.object({
	reason: BusinessAuthorityReason,
});
export type BusinessAuthorityDetails = z.infer<typeof BusinessAuthorityDetailsSchema>;

/** Fallback copy per reason, used until the screens word their own (BU6). */
export const BUSINESS_AUTHORITY_REFUSAL: Readonly<Record<BusinessAuthorityReason, string>> = {
	hire: "You need the business's hiring permission to do that.",
	purchase: "You need the business's purchasing permission to buy with its wallet.",
	manage_projects: "You need the business's project permission to create a project billed to it.",
	not_funder: "Only a member who can spend from the client's wallet can fund this.",
};
// #endregion
