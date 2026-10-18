/**
 * community.help_feedback — the Zod SSOT for the help centre's "Was this helpful?" votes (P2,
 * Decision #274). Placeholder until P2 lands the table.
 *
 * What belongs here: the row schema of the helpfulness table (`00000025`, region `[help_feedback]`),
 * the request body of `POST /api/help/feedback` (the article's slug, `helpful`, an optional comment of
 * at most 280 characters) and its response. A comment is screened through `comms.mask_pii` before it
 * is stored (Decision #147). Import shared primitives from `./common.ts`, and prefix every export
 * `HelpFeedback…` — this module is re-exported by the root barrel, where a bare name can collide.
 */
export {};
