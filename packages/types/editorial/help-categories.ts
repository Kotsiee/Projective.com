/**
 * editorial.help-categories — the help centre's category slugs, in hub order (Decision #274 (k):
 * permanent once seeded; retitle a category freely, never re-slug it). Zod-free and import-free, so an
 * island-reachable schema may name them without pulling the help centre's content schemas along.
 *
 * The ONE list every surface that files something under a help topic derives from: the `/contact`
 * support form's Topic is one value per category plus "Something else" (`ContactSupportTopic`,
 * Decision #279 — closing #276 flag (h)), mirrored value for value by `ops.submit_contact_request`
 * (`contact.contract.test.ts`). The help content source's categories are pinned to it in the same
 * order (`services/editorial/content/help.test.ts`), so adding a category is one change in three
 * places the tests name: here, the content source, and the contact writer's list.
 */
export const HELP_CENTRE_CATEGORY_SLUGS = [
	"getting-started",
	"projects-and-stages",
	"escrow-and-payments",
	"revisions-and-approvals",
	"disputes-and-fair-exit",
	"payouts-and-verification",
	"teams-and-businesses",
	"account-and-security",
] as const;

/** One help category's slug. */
export type HelpCentreCategorySlug = (typeof HELP_CENTRE_CATEGORY_SLUGS)[number];
