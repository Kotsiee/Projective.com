/**
 * community.feedback — the board's URL vocabulary (Decision #272), with no Zod: the status tabs'
 * `?status=` values and the `?sort=` orders. `FeedbackHost` (mounted on every public and dashboard
 * page) and the account menu's bridge read only these, so they import this sub-path
 * (`@projective/types/community/feedback-constants`) rather than the `community` barrel, whose
 * top-level schemas would ride into every page's always-loaded chunk. `./feedback.ts` builds its
 * schemas from these lists and re-exports them, so the barrel still carries one SSOT.
 */

/** The status tabs' URL values (`?status=`), one per state the board shows. */
export const FEEDBACK_STATUS_FILTERS = [
	"under_review",
	"planned",
	"in_progress",
	"shipped",
] as const;

/** One status tab. */
export type FeedbackStatusFilter = (typeof FEEDBACK_STATUS_FILTERS)[number];

/** The board's orders: most votes first, or newest first. */
export const FEEDBACK_SORTS = ["top", "new"] as const;

/** One order. */
export type FeedbackSort = (typeof FEEDBACK_SORTS)[number];
