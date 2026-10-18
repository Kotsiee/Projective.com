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
    -- Deferred to COMMIT: a regenerated 00005071 that reorders the Topics list swaps positions in one
    -- upsert. Not an ON CONFLICT arbiter (slug is), so the generated upsert is unchanged.
    CONSTRAINT help_categories_position_key UNIQUE (position) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT help_categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    -- At most 80 characters, the help slug bound (HELP_CENTRE_SLUG_MAX) the articles share.
    CONSTRAINT help_categories_slug_length CHECK (char_length(slug) <= 80),
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
    -- One article per place in a category, so a category reads in one authored order. Both keys
    -- below are deferred to COMMIT, so a regenerated 00005071 that reorders a category, moves an
    -- article or re-ranks the FAQ (a swap inside one upsert) applies; neither is an ON CONFLICT
    -- arbiter (slug is), so the generated upsert is unchanged.
    CONSTRAINT help_articles_category_position_key UNIQUE (category_slug, position)
        DEFERRABLE INITIALLY DEFERRED,
    -- One article per FAQ rank (NULLs — articles not in the FAQ — never collide).
    CONSTRAINT help_articles_faq_rank_key UNIQUE (faq_rank) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT help_articles_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    -- The bound a vote's article slug is held to (HELP_CENTRE_SLUG_MAX, help-feedback.ts).
    CONSTRAINT help_articles_slug_length CHECK (char_length(slug) <= 80),
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
    -- The release's gallery: an array of { src, alt, w, h, caption } (ChangelogImageSchema).
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
    'The release''s gallery, opened in the lightbox: [{ src, alt, w, h, caption }].';
COMMENT ON COLUMN editorial.changelog_releases.withdrawn IS
    'Retracted: hidden from every reader by the SELECT policy and the content source''s visible predicate. Never deleted.';
-- #endregion


-- #region [articles] Projective articles and authors (P6)
-- #endregion
