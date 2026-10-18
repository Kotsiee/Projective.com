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
-- Projective's own articles (Decision #271), canonical at /articles/[slug], and the bylines they are
-- written under. Both are keyed by a READABLE slug authored on its own and frozen once the row
-- exists (editorial.fn_guard_slug_immutable, attached in 00001898 — Decision #274 (k)). These rows
-- are seeded in every environment, so an author is a row of its own (never a foreign key onto a
-- seeded profile) and every picture is a static asset path, never a storage object.
CREATE TABLE IF NOT EXISTS editorial.article_authors (
    slug text PRIMARY KEY,
    name text NOT NULL,
    role text NOT NULL,
    kind text NOT NULL,
    bio text NOT NULL,
    avatar_path text NOT NULL,
    avatar_alt text NOT NULL,
    avatar_w integer NOT NULL,
    avatar_h integer NOT NULL,
    profile_href text,
    CONSTRAINT article_authors_slug_check
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 96),
    CONSTRAINT article_authors_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT article_authors_role_check CHECK (char_length(btrim(role)) BETWEEN 1 AND 80),
    CONSTRAINT article_authors_kind_check CHECK (kind IN ('person', 'team')),
    CONSTRAINT article_authors_bio_check CHECK (char_length(btrim(bio)) BETWEEN 1 AND 320),
    CONSTRAINT article_authors_avatar_check CHECK (
        avatar_path ~ '^(/[^/\\]|https://)' AND char_length(btrim(avatar_alt)) > 0
        AND avatar_w > 0 AND avatar_h > 0
    ),
    -- A profile link is a same-origin path (`/@handle`); a team byline has none.
    CONSTRAINT article_authors_profile_href_check CHECK (profile_href IS NULL OR profile_href ~ '^/[^/\\]')
);

COMMENT ON TABLE editorial.article_authors IS
    'Bylines of Projective''s articles (Decision #271): a person or a team writing under one name. Its own rows, never a profile FK, because editorial migrations run where seed personas do not exist.';

CREATE TABLE IF NOT EXISTS editorial.articles (
    slug text PRIMARY KEY,
    title text NOT NULL,
    standfirst text NOT NULL,
    topics text[] NOT NULL,
    -- The article's sections: P0 DocSection[] (an h2 heading, its anchor id and a ContentNode body),
    -- validated by EditorialArticleRowSchema before the generator writes a row.
    body jsonb NOT NULL,
    cover_path text NOT NULL,
    cover_alt text NOT NULL,
    cover_w integer NOT NULL,
    cover_h integer NOT NULL,
    author_slug text NOT NULL REFERENCES editorial.article_authors (slug),
    status text NOT NULL DEFAULT 'draft',
    published_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT articles_slug_check
        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 96),
    CONSTRAINT articles_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 140),
    CONSTRAINT articles_standfirst_check CHECK (char_length(btrim(standfirst)) BETWEEN 1 AND 320),
    -- One to three of EDITORIAL_ARTICLE_TOPICS (@projective/types/editorial), none NULL; the first is
    -- the primary topic. articles-sql.test.ts pins this list to the TypeScript one.
    CONSTRAINT articles_topics_check CHECK (
        cardinality(topics) BETWEEN 1 AND 3
        AND array_position(topics, NULL) IS NULL
        AND topics <@ ARRAY['async-collaboration', 'agile-delivery', 'team-structure', 'value-pricing', 'escrow-and-trust']::text[]
    ),
    CONSTRAINT articles_body_check CHECK (jsonb_typeof(body) = 'array' AND jsonb_array_length(body) > 0),
    CONSTRAINT articles_cover_check CHECK (
        cover_path ~ '^(/[^/\\]|https://)' AND char_length(btrim(cover_alt)) > 0
        AND cover_w > 0 AND cover_h > 0
    ),
    -- PRODUCT_MANAGEMENT §3.5 "Editorial article": draft → published → archived (a retraction; the
    -- row is kept, never deleted).
    CONSTRAINT articles_status_check CHECK (status IN ('draft', 'published', 'archived')),
    CONSTRAINT articles_dates_check CHECK (updated_at >= published_at)
);

COMMENT ON TABLE editorial.articles IS
    'Projective''s own articles (Decision #271), canonical at /articles/[slug]. Shown to readers only while status = ''published'' and published_at has passed (the SELECT policy and the reader''s visible predicate state the same rule). Member posts stay in catalogue.articles.';
COMMENT ON COLUMN editorial.articles.slug IS
    'Readable and authored on its own; permanent once the row exists (editorial.fn_guard_slug_immutable).';
COMMENT ON COLUMN editorial.articles.body IS
    'P0 DocSection[] — sections of ContentNode JSON (@projective/types/content), generated from packages/backend/services/editorial/content/articles.ts; never hand-edited.';
-- #endregion
