-- =============================================================================================
-- 00000024_tables_editorial.sql — editorial schema tables (Category 0).
--
-- The content the PLATFORM authors and publishes (Decision #274): the help centre, the changelog and
-- Projective's own articles. Bodies are the typed ContentNode JSON of `@projective/types/content`
-- (P0), stored as `jsonb` and validated by the Zod row schema before any row is written — nothing
-- hand-edits the JSON.
--
-- WHERE THE ROWS COME FROM. Editorial content is platform reference data that must exist in every
-- environment, so it is NOT part of the development seed (supabase/seeds/, local resets only). Each
-- surface's rows are authored as Zod-validated TypeScript in
-- packages/backend/services/editorial/content/<surface>.ts and emitted by
-- `deno task db:editorial:generate` into ONE category-5 migration per surface
-- (00005071 help · 00005072 changelog · 00005073 articles). The fixture path (EDITORIAL_BACKEND_LIVE
-- off) serves the same sources through the same row parse and mapping, so the two cannot drift.
--
-- REGIONS. Each surface owns exactly one region below and fills only that region:
--
--   [help]       P2 — help categories and articles (an article's FAQ flag lives on the article)
--   [changelog]  P5 — changelog releases
--   [articles]   P6 — Projective articles and their authors (canonical at /articles/[slug])
--
-- Keep the regions in this order and keep the blank lines between them. Member-authored posts are
-- NOT here — they stay in `catalogue.articles` (00000023), rendered at /view. A table's policies,
-- grants, functions, triggers and indexes go into the same-named region of their own category file
-- (00002021, 00002520, 00001320, 00001898, 00004013), never next to the table.
-- =============================================================================================

-- #region [help] Help centre — categories, articles, FAQs (P2)
-- #endregion


-- #region [changelog] Changelog — releases (P5)
-- #endregion


-- #region [articles] Projective articles and authors (P6)
-- #endregion
