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
    -- Earlier addresses of this article. A slug never changes (Decision #274 (k)), so a renamed
    -- article is a NEW row that lists the old slug here, and the reader 308s a request for it to this
    -- row. The old row stays (archived), and its primary key keeps the old slug from ever being
    -- reused.
    former_slugs text[] NOT NULL DEFAULT '{}',
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
    CONSTRAINT articles_dates_check CHECK (updated_at >= published_at),
    -- At most 16, none NULL, never the row's own slug, each slug-shaped and at most 96 characters.
    -- A CHECK cannot unnest, so the elements are read through two joins: glued together they hold
    -- slug characters only (so no element holds a space), and joined by single spaces every piece is
    -- a non-empty slug the lookahead caps at 96 (so no element is empty or malformed). That each
    -- names an ARCHIVED row and belongs to one article only is a cross-row rule no CHECK can state:
    -- content/articles.test.ts enforces it where the rows are authored, and the reader resolves a
    -- clash newest-first.
    CONSTRAINT articles_former_slugs_check CHECK (
        cardinality(former_slugs) <= 16
        AND array_position(former_slugs, NULL) IS NULL
        AND NOT (slug = ANY (former_slugs))
        AND array_to_string(former_slugs, '') ~ '^[a-z0-9-]*$'
        AND (
            cardinality(former_slugs) = 0
            OR array_to_string(former_slugs, ' ')
                ~ '^(?=[a-z0-9-]{1,96}( |$))[a-z0-9]+(-[a-z0-9]+)*( (?=[a-z0-9-]{1,96}( |$))[a-z0-9]+(-[a-z0-9]+)*)*$'
        )
    )
);

COMMENT ON TABLE editorial.articles IS
    'Projective''s own articles (Decision #271), canonical at /articles/[slug]. Shown to readers only while status = ''published'' and published_at has passed (the SELECT policy and the reader''s visible predicate state the same rule). Member posts stay in catalogue.articles.';
COMMENT ON COLUMN editorial.articles.slug IS
    'Readable and authored on its own; permanent once the row exists (editorial.fn_guard_slug_immutable).';
COMMENT ON COLUMN editorial.articles.former_slugs IS
    'Earlier addresses of this article (a rename is a new row plus a redirect, Decision #274 (k)); each names the archived row that held it, and /articles/<former slug> answers 308 here.';
COMMENT ON COLUMN editorial.articles.body IS
    'P0 DocSection[] — sections of ContentNode JSON (@projective/types/content), generated from packages/backend/services/editorial/content/articles.ts; never hand-edited.';
-- #endregion
