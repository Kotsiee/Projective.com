/**
 * editorial.articles — the Zod SSOT for Projective's own articles and their authors (P6,
 * Decision #274). Placeholder until P6 lands the tables.
 *
 * What belongs here: the row schemas of the article and author tables (`00000024`, region
 * `[articles]`) — an article's slug (canonical at `/articles/[slug]`), title, standfirst, topics,
 * cover, author, publication dates and a `body` of ContentNode JSON (`@projective/types/content`, P0)
 * — plus the domain records the content source authors. Member-authored posts are NOT here: they
 * stay `catalogue.articles`, at `/view` (owner ruling (b) as revised 2026-10-17 — no editorial flag
 * on that table and no redirect between the two). Import shared primitives from `./common.ts`, and
 * prefix every export `EditorialArticle…` — this module is re-exported by the root barrel, where
 * `Article…` names already exist.
 */
export {};
