/**
 * editorial.help — the Zod SSOT for the help centre's content (P2, Decision #274). Placeholder until
 * P2 lands the tables.
 *
 * What belongs here: the row schemas of the help category and help article tables (`00000024`,
 * region `[help]`) — an article carries its category, the roles it is written for (the product's
 * words: Client, Freelancer, Team, Business), its related articles, an FAQ flag and a `body` of
 * ContentNode JSON (`@projective/types/content`, P0) — plus the domain records the content source
 * authors and the search response of `GET /api/help/search`. Import shared primitives from
 * `./common.ts`, and prefix every export `Help…` — this module is re-exported by the root barrel,
 * where a bare name can collide. `HelpArticle` and `HelpArticleSchema` are already taken there by
 * `explore/items.ts` (the link shape of the Explore home's editorial promo), so the article record
 * here is `HelpCentreArticle…`.
 */
export {};
