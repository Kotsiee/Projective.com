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
-- The help centre at /help (P2): eight categories, each a list of articles, and the hub's FAQ — an
-- article's own FAQ entry (faq_rank + faq_question), answered by its summary. Every row is authored in
-- packages/backend/services/editorial/content/help.ts (+ content/help/*.ts) and generated into
-- 00005071; the Zod SSOT is packages/types/editorial/help.ts, which mirrors every CHECK below.
--
-- Slugs are READABLE and permanent (Decision #274 (k)): authored apart from the title and frozen by
-- editorial.fn_guard_slug_immutable (00001898). An article moved to another category keeps its slug;
-- the route answers its old address with a 308 to the new one.

-- One row per category; `position` orders the hub's Topics list. `icon` is a registry glyph name
-- (@projective/ui/icons), held to the set HELP_CENTRE_CATEGORY_ICONS names.
CREATE TABLE editorial.help_categories (
    slug text NOT NULL,
    position smallint NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    icon text NOT NULL,
    CONSTRAINT help_categories_pkey PRIMARY KEY (slug),
    CONSTRAINT help_categories_position_key UNIQUE (position),
    CONSTRAINT help_categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT help_categories_position_check CHECK (position >= 0),
    CONSTRAINT help_categories_title_length CHECK (char_length(title) BETWEEN 1 AND 60),
    CONSTRAINT help_categories_description_length CHECK (char_length(description) BETWEEN 1 AND 200),
    CONSTRAINT help_categories_icon_check CHECK (
        icon IN ('flag', 'stages', 'wallet', 'submission', 'shield', 'arrow-up-right', 'members', 'lock')
    )
);

-- One row per article. The body is P0's ContentNode sections (`sections`, validated by the Zod row
-- schema before generation — DocSectionSchema). `roles` says who it is written for, in the product's
-- words (owner ruling (c)); `start_here` the roles (a subset) whose "Start here by role" column on the
-- hub lists it; `related` names up to four other articles in
-- reading order (an array cannot carry a foreign key, so content-source tests check every slug
-- resolves). Visibility is authored, never deleted: shown from `published_on` until `archived_on`
-- (UTC dates), the rule help_articles_select_published (00002021) and the content source's `visible`
-- both state.
CREATE TABLE editorial.help_articles (
    slug text NOT NULL,
    category_slug text NOT NULL,
    position smallint NOT NULL,
    title text NOT NULL,
    summary text NOT NULL,
    roles text[] NOT NULL,
    start_here text[] NOT NULL DEFAULT '{}'::text[],
    related text[] NOT NULL DEFAULT '{}'::text[],
    faq_rank smallint,
    faq_question text,
    sections jsonb NOT NULL,
    updated_on date NOT NULL,
    published_on date NOT NULL,
    archived_on date,
    CONSTRAINT help_articles_pkey PRIMARY KEY (slug),
    -- A category is never deleted (editorial content is retracted by visibility, not removed), so a
    -- delete that would orphan its articles is refused rather than cascaded.
    CONSTRAINT help_articles_category_slug_fkey
        FOREIGN KEY (category_slug) REFERENCES editorial.help_categories (slug) ON DELETE RESTRICT,
    -- One article per place in a category, so a category reads in one authored order.
    CONSTRAINT help_articles_category_position_key UNIQUE (category_slug, position),
    -- One article per FAQ rank (NULLs — articles not in the FAQ — never collide).
    CONSTRAINT help_articles_faq_rank_key UNIQUE (faq_rank),
    CONSTRAINT help_articles_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT help_articles_position_check CHECK (position >= 0),
    CONSTRAINT help_articles_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT help_articles_summary_length CHECK (char_length(summary) BETWEEN 1 AND 320),
    CONSTRAINT help_articles_roles_check CHECK (
        cardinality(roles) >= 1
        AND array_position(roles, NULL) IS NULL
        AND roles <@ ARRAY['client', 'freelancer', 'team', 'business']::text[]
    ),
    CONSTRAINT help_articles_start_here_check CHECK (
        array_position(start_here, NULL) IS NULL AND start_here <@ roles
    ),
    CONSTRAINT help_articles_related_size CHECK (
        cardinality(related) <= 4
        AND array_position(related, NULL) IS NULL
        AND NOT (slug = ANY (related))
    ),
    CONSTRAINT help_articles_faq_pair CHECK ((faq_rank IS NULL) = (faq_question IS NULL)),
    CONSTRAINT help_articles_faq_rank_range CHECK (faq_rank IS NULL OR faq_rank BETWEEN 1 AND 8),
    CONSTRAINT help_articles_faq_question_length CHECK (
        faq_question IS NULL OR char_length(faq_question) BETWEEN 1 AND 160
    ),
    CONSTRAINT help_articles_sections_shape CHECK (
        jsonb_typeof(sections) = 'array' AND jsonb_array_length(sections) >= 1
    ),
    CONSTRAINT help_articles_dates_order CHECK (
        updated_on >= published_on AND (archived_on IS NULL OR archived_on >= published_on)
    )
);
-- #endregion


-- #region [changelog] Changelog — releases (P5)
-- #endregion


-- #region [articles] Projective articles and authors (P6)
-- #endregion
