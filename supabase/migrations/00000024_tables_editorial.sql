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
-- One row per release of the platform, keyed by its semantic version — a fixed identifier that is
-- also its public address (/changelog/<version>). Authored in
-- packages/backend/services/editorial/content/changelog.ts and generated into 00005072; the Zod row
-- schema is ChangelogReleaseRowSchema (@projective/types/editorial). A release is public from its
-- `released_on` day (UTC) while it is not `withdrawn` — the SELECT policy (00002021) and the content
-- source's `visible` predicate state the same rule. A retracted release is withdrawn, never deleted.
CREATE TABLE editorial.changelog_releases (
    version     text        PRIMARY KEY,
    released_on date        NOT NULL,
    title       text        NOT NULL,
    summary     text        NOT NULL,
    categories  text[]      NOT NULL,
    body        jsonb       NOT NULL,
    images      jsonb       NOT NULL DEFAULT '[]'::jsonb,
    withdrawn   boolean     NOT NULL DEFAULT false,
    -- A semantic version in lower case (MAJOR.MINOR.PATCH, optional pre-release), so one release has
    -- one spelling and one address.
    CONSTRAINT changelog_releases_version_semver CHECK (
        char_length(version) <= 64
        AND version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9a-z-]+(\.[0-9a-z-]+)*)?$'
    ),
    CONSTRAINT changelog_releases_title_length CHECK (char_length(title) BETWEEN 1 AND 120 AND title ~ '\S'),
    CONSTRAINT changelog_releases_summary_length CHECK (char_length(summary) BETWEEN 1 AND 320 AND summary ~ '\S'),
    -- At least one category, no NULL element, every value from CHANGELOG_CATEGORIES.
    CONSTRAINT changelog_releases_categories_known CHECK (
        cardinality(categories) >= 1
        AND array_position(categories, NULL) IS NULL
        AND categories <@ ARRAY['escrow', 'projects', 'discovery', 'messaging', 'workspaces', 'ux', 'security', 'infrastructure']::text[]
    ),
    -- A ContentNode list (@projective/types/content); the Zod row schema validates the nodes.
    CONSTRAINT changelog_releases_body_blocks CHECK (jsonb_typeof(body) = 'array' AND jsonb_array_length(body) >= 1),
    -- The release's gallery: an array of { src, alt, w, h, caption? } (ChangelogImageSchema).
    CONSTRAINT changelog_releases_images_array CHECK (jsonb_typeof(images) = 'array' AND jsonb_array_length(images) <= 12)
);

COMMENT ON TABLE editorial.changelog_releases IS
    'The public changelog (P5, Decisions #274 / #278): one row per release, keyed by its semantic version. Generated from services/editorial/content/changelog.ts into 00005072; public from released_on (UTC) while not withdrawn; never deleted.';
COMMENT ON COLUMN editorial.changelog_releases.version IS
    'Semantic version in lower case — the natural key and the public address /changelog/<version>; permanent (trg_changelog_releases_version_immutable).';
COMMENT ON COLUMN editorial.changelog_releases.released_on IS
    'The day the release shipped. A future date keeps the release hidden until that UTC day.';
COMMENT ON COLUMN editorial.changelog_releases.summary IS
    'One or two sentences: the feed''s lead line, the RSS item description and the page''s meta description.';
COMMENT ON COLUMN editorial.changelog_releases.categories IS
    'What the release is about, from CHANGELOG_CATEGORIES — inline meta text on a release, the feed''s filter facets.';
COMMENT ON COLUMN editorial.changelog_releases.body IS
    'ContentNode blocks (@projective/types/content) — no image nodes (pictures are the gallery) and no explicit h3 ids (a feed anchors many bodies on one page).';
COMMENT ON COLUMN editorial.changelog_releases.images IS
    'The release''s gallery, opened in the lightbox: [{ src, alt, w, h, caption? }].';
COMMENT ON COLUMN editorial.changelog_releases.withdrawn IS
    'Retracted: hidden from every reader by the SELECT policy and the content source''s visible predicate. Never deleted.';
-- #endregion


-- #region [articles] Projective articles and authors (P6)
-- #endregion
