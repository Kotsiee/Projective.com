# editorial: Tables

The content the **platform** authors and publishes (Decision #274): the help centre, the changelog
and Projective's own articles. Migration
[`00000024_tables_editorial.sql`](../../../supabase/migrations/00000024_tables_editorial.sql).
Policies: [Policies.md](Policies.md) · Functions: [Functions.md](Functions.md). User-generated
activity around this content — helpfulness votes, the feedback board — is
[`community`](../community/Tables.md). Member-authored posts are **not** here: they stay
`catalogue.articles`, rendered at `/view`; Projective's articles are editorial rows, canonical at
`/articles/[slug]`, with no flag on the catalogue table and no redirect between the two (owner
ruling (b), revised 2026-10-17). Legal documents stay versioned TypeScript modules.

## Where the rows come from

Editorial content is platform **reference data**: it must exist in every environment, so it is not
the development seed (`supabase/seeds/`, local resets only — see [Seed.md](../Seed.md)). Each
surface's rows are authored as domain records in
`packages/backend/services/editorial/content/<surface>.ts`, validated by the table's Zod row schema
(`@projective/types/editorial`), and emitted by `deno task db:editorial:generate` into **one
category-5 migration per surface**:

| Surface   | Content source                                 | Generated migration                     |
| :-------- | :--------------------------------------------- | :-------------------------------------- |
| Help      | `services/editorial/content/help.ts` (P2)      | `00005071_seed_editorial_help.sql`      |
| Changelog | `services/editorial/content/changelog.ts` (P5) | `00005072_seed_editorial_changelog.sql` |
| Articles  | `services/editorial/content/articles.ts` (P6)  | `00005073_seed_editorial_articles.sql`  |

Every row is upserted on its natural key (a slug, a version), so a regenerated file updates what the
last one wrote. Bodies are ContentNode JSON (`@projective/types/content`, P0) in `jsonb` columns —
nobody hand-edits them; `content-sql.test.ts` fails while a committed file and its source disagree.
With `EDITORIAL_BACKEND_LIVE` off the same records are served through the same row parse and mapping
(`services/editorial/editorial-source.ts`), so the fixture path cannot drift from the database.

The generator's rules a table must fit: column names are plain lowercase identifiers
(`[a-z_][a-z0-9_]*`), emitted double-quoted, so `order` or `default` is a fine column name; a NUL
anywhere (text, or any string or key inside a jsonb value) fails generation. **Nothing is pruned:**
a record removed from its source, or whose key changes, keeps its old row in any database that is
not rebuilt — the removal lands only on the next reset. So content is retracted by authoring the
record hidden (a visibility column the table's `visible` predicate and SELECT policy read — see
[Policies.md](Policies.md)), never by deleting it, which is also the rule that nothing is
hard-deleted.

Because these migrations run where the development personas do not exist, an editorial row never
foreign-keys onto a seeded `org.users_public` row or a seeded storage object: an article's author is
an editorial row of its own, and an image is a static asset.

Each surface owns one region of every SQL file it adds to and one heading below:

| Surface   | Region (`00000024`) / shared files (`00002001`, `00002021`, `00002510`, `00002520`, `00001320`, `00001898`, `00004013`) | Built by |
| :-------- | :---------------------------------------------------------------------------------------------------------------------- | :------- |
| Help      | `[help]` / `[editorial.help]`                                                                                           | P2       |
| Changelog | `[changelog]` / `[editorial.changelog]`                                                                                 | P5       |
| Articles  | `[articles]` / `[editorial.articles]`                                                                                   | P6       |

## Help

The help centre at `/help` (P2): eight categories, each a list of articles, and the hub's FAQ.
Authored in `services/editorial/content/help.ts` (+ one module per category under `content/help/`,
each article's JSDoc citing the PRODUCT_SPEC section or decision it explains) and generated into
`00005071_seed_editorial_help.sql`; read by `HelpBackendService`. Zod SSOT:
`@projective/types/editorial` (`HelpCentreCategoryRowSchema`, `HelpCentreArticleRowSchema` and the
domain records `HelpCentreCategory` / `HelpCentreArticle` — not `HelpArticle`, which the root barrel
already gives the Explore promo link). Every CHECK below is mirrored in the row schema.

Both tables are keyed by a **readable, permanent slug** (Decision #274 (k)): authored apart from the
title and frozen by `editorial.fn_guard_slug_immutable` (`00001898`, see
[Functions.md](Functions.md#help)). An article moved to another category keeps its slug; the route
answers the old address with a `308` to the new one.

### `editorial.help_categories`

| Column        | Type     | Notes                                                                                                                                                    |
| :------------ | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`        | text PK  | Readable and permanent (`help_categories_slug_format`: lower-case kebab), at most 80 characters (`help_categories_slug_length`, `HELP_CENTRE_SLUG_MAX`). |
| `position`    | smallint | NOT NULL, UNIQUE (`help_categories_position_key`, deferred — see **Order keys** below), ≥ 0 — the hub's Topics order.                                    |
| `title`       | text     | NOT NULL, 1–60 characters.                                                                                                                               |
| `description` | text     | NOT NULL, 1–200 characters — the topic row's one line and the category page's lead.                                                                      |
| `icon`        | text     | NOT NULL, one of the registry glyphs `HELP_CENTRE_CATEGORY_ICONS` names (`help_categories_icon_check`).                                                  |

Never hidden: no visibility column; a category with no visible article is left out of the hub by the
service.

### `editorial.help_articles`

| Column          | Type     | Notes                                                                                                                                                                                                                        |
| :-------------- | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`          | text PK  | Readable and permanent; globally unique (never equal to a category slug — `help.test.ts`); at most 80 characters (`help_articles_slug_length`), the bound a vote's article slug is held to as well (`HELP_CENTRE_SLUG_MAX`). |
| `category_slug` | text     | NOT NULL, FK → `help_categories(slug)` ON DELETE RESTRICT.                                                                                                                                                                   |
| `position`      | smallint | NOT NULL, ≥ 0; UNIQUE with `category_slug` (`help_articles_category_position_key`, deferred) — the order inside a category, and the previous / next pager.                                                                   |
| `title`         | text     | NOT NULL, 1–120 characters.                                                                                                                                                                                                  |
| `summary`       | text     | NOT NULL, 1–320 characters — the lead, the meta description and the FAQ answer.                                                                                                                                              |
| `roles`         | text[]   | NOT NULL, ≥ 1, ⊆ `{client, freelancer, team, business}` (`ContentAudience`, owner ruling (c)) — who it is written for; the meta line's "For …".                                                                              |
| `start_here`    | text[]   | NOT NULL, default `{}`, ⊆ `roles` (`help_articles_start_here_check`) — the roles whose "Start here by role" column on the hub lists it (4–6 per role, `help.test.ts`).                                                       |
| `related`       | text[]   | NOT NULL, default `{}`, ≤ 4, never itself (`help_articles_related_size`) — other article slugs in reading order. An array carries no FK, so `help.test.ts` checks every slug resolves.                                       |
| `faq_rank`      | smallint | Nullable, 1–8, UNIQUE (`help_articles_faq_rank_key`, deferred) — the article's place in the hub's FAQ (its FAQ flag). Set together with `faq_question` (`help_articles_faq_pair`).                                           |
| `faq_question`  | text     | Nullable, 1–160 characters — the question as a reader asks it; the answer is `summary` plus a link to the article.                                                                                                           |
| `sections`      | jsonb    | NOT NULL, a non-empty array (`help_articles_sections_shape`) of P0 `DocSection`s — ContentNode bodies, validated by `DocSectionSchema` and the anchor rule before generation.                                                |
| `updated_on`    | date     | NOT NULL, ≥ `published_on` — when its facts were last checked against the product; the meta line's "Updated".                                                                                                                |
| `published_on`  | date     | NOT NULL — shown from this UTC date.                                                                                                                                                                                         |
| `archived_on`   | date     | Nullable, ≥ `published_on` — hidden from this UTC date (`help_articles_dates_order`). Content is retracted this way, never deleted.                                                                                          |

**Order keys** — `help_categories_position_key`, `help_articles_category_position_key` and
`help_articles_faq_rank_key` are `DEFERRABLE INITIALLY DEFERRED`: checked at COMMIT, so a
regenerated `00005071` that reorders the Topics, a category or the FAQ — or moves an article — swaps
places inside one by-slug upsert and applies on a database that is not rebuilt. None is an
`ON CONFLICT` arbiter (`slug` is), so the generated upsert is unchanged; a real duplicate still
fails at COMMIT (`supabase/probes/help_centre.sql` §4b).

**Visibility** is `published_on <= today (UTC) AND (archived_on IS NULL OR archived_on > today)`,
the table's `visible` predicate (`isHelpCentreArticleVisible`) and `help_articles_select_published`
alike ([Policies.md](Policies.md#help)).

**Indexes**: none beyond the constraints — the service reads both tables whole;
`help_articles_category_position_key` leads with `category_slug` and serves its FK, and
`help_articles_faq_rank_key` the FAQ order. Votes on articles are `community.help_feedback`
([community Tables](../community/Tables.md#help-feedback)).

## Changelog

**`editorial.changelog_releases`** — one row per release of the platform (P5, Decision #278), read
by `/changelog`, `/changelog/[version]` and `/changelog/rss.xml` through `ChangelogBackendService`.
Zod row schema `ChangelogReleaseRowSchema` (`@projective/types/editorial`); records authored in
`services/editorial/content/changelog.ts`, generated into `00005072_seed_editorial_changelog.sql`.

| Column        | Type      | Notes                                                                                                                                                                                                                                                                    |
| :------------ | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`     | `text`    | **PK.** A semantic version in lower case, ≤ 64 characters (`changelog_releases_version_semver`): the natural key the seed upserts on and the public address `/changelog/<version>`. Permanent — `trg_changelog_releases_version_immutable` refuses any change (`23514`). |
| `released_on` | `date`    | The day the release shipped. A future day keeps the release hidden until that UTC day.                                                                                                                                                                                   |
| `title`       | `text`    | 1–120 characters, not blank.                                                                                                                                                                                                                                             |
| `summary`     | `text`    | 1–320 characters, not blank: the feed's lead line, the RSS `<description>` and the page's meta description.                                                                                                                                                              |
| `categories`  | `text[]`  | At least one, no NULL, each from `CHANGELOG_CATEGORIES` — `escrow` · `projects` · `discovery` · `messaging` · `workspaces` · `ux` · `security` · `infrastructure` (`changelog_releases_categories_known`). Inline meta text on a release; the feed's filter facets.      |
| `body`        | `jsonb`   | A non-empty array of ContentNode blocks (`@projective/types/content`). The row schema refuses an `image` node (pictures are the gallery) and an explicit `h3` id (a feed anchors many bodies on one page).                                                               |
| `images`      | `jsonb`   | The release's gallery, default `[]`, at most 12: `{ src, alt, w, h, caption }` (`ChangelogImageSchema`; every picture has a caption), opened in the lightbox.                                                                                                            |
| `withdrawn`   | `boolean` | Default `false`. A retracted release: hidden from every reader, never deleted (the seed never prunes).                                                                                                                                                                   |

**Visibility:** a reader sees a release when `NOT withdrawn AND released_on <= today (UTC)` — the
table's SELECT policy ([Policies.md](Policies.md#changelog)) and the content source's `visible`
predicate state the same rule, so the fixture and live roads serve the same releases.

**Versions and dates** are reconstructed from the build history: each MINOR version is one milestone
of work that landed on `main`, dated by its last decision; every release is `0.x` until launch. The
derivation is recorded in the content source's header and in Decision #278.

No secondary index: the service reads the whole table (tens of rows) and orders it, and the one
keyed read — a release by version — is the primary key.

## Articles

Projective's own articles and the bylines they are written under (P6, Decision #271), canonical at
`/articles/[slug]`. Region `[articles]` of `00000024`; rows generated into
`00005073_seed_editorial_articles.sql` from `services/editorial/content/articles.ts` (one module per
article under `content/articles/`). Zod SSOT: `@projective/types/editorial` (`articles.ts`). Read by
`EditorialArticlesBackendService` through `readEditorialTable`.

### `editorial.article_authors`

A byline. Its own row, never a foreign key onto a seeded profile, because this migration runs where
the development personas do not exist. Nothing here is ever hidden.

| Column                  | Type      | Notes                                                                                           |
| :---------------------- | :-------- | :---------------------------------------------------------------------------------------------- |
| `slug`                  | `text` PK | Readable kebab-case, ≤ 96; permanent once the row exists (`trg_article_authors_slug_immutable`) |
| `name`                  | `text`    | 1–80 characters                                                                                 |
| `role`                  | `text`    | 1–80 characters (`Editorial team`)                                                              |
| `kind`                  | `text`    | `person` · `team` — a team byline is the JSON-LD `Organization`, a person a `Person`            |
| `bio`                   | `text`    | 1–320 characters, under the end-of-article byline                                               |
| `avatar_path`           | `text`    | A static asset path (`/logo.svg`) or `https://`; never `//host`                                 |
| `avatar_alt`            | `text`    | Non-empty                                                                                       |
| `avatar_w` / `avatar_h` | `integer` | Intrinsic pixels, > 0, so every reader reserves the box                                         |
| `profile_href`          | `text?`   | The author's public page (`/@handle`), same-origin; `NULL` for a team byline                    |

Seeded: one row, `projective-editorial` — "Projective Editorial", `Editorial team`, `kind = team`,
the brandmark, no profile link (no named staff were given; Decision #271 flag (a)).

### `editorial.articles`

| Column                | Type          | Notes                                                                                                                                                                                                                                                                                                                                                                                    |
| :-------------------- | :------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`                | `text` PK     | Readable kebab-case, ≤ 96, authored on its own; permanent once the row exists (`trg_articles_slug_immutable`, Decision #274 (k))                                                                                                                                                                                                                                                         |
| `title`               | `text`        | 1–140 characters                                                                                                                                                                                                                                                                                                                                                                         |
| `standfirst`          | `text`        | 1–320 characters — the lead paragraph and the meta description                                                                                                                                                                                                                                                                                                                           |
| `topics`              | `text[]`      | One to three of `async-collaboration` · `agile-delivery` · `team-structure` · `value-pricing` · `escrow-and-trust`, none `NULL`; the first is the primary topic. A repeat is refused by the Zod row schema                                                                                                                                                                               |
| `body`                | `jsonb`       | A non-empty array of P0 `DocSection`s (`id`, `heading`, optional `tldr`, `body` of ContentNodes); anchor ids unique per article                                                                                                                                                                                                                                                          |
| `cover_path`          | `text`        | A static asset path or `https://`; never `//host`                                                                                                                                                                                                                                                                                                                                        |
| `cover_alt`           | `text`        | Non-empty                                                                                                                                                                                                                                                                                                                                                                                |
| `cover_w` / `cover_h` | `integer`     | Intrinsic pixels, > 0                                                                                                                                                                                                                                                                                                                                                                    |
| `author_slug`         | `text` FK     | → `editorial.article_authors (slug)`; indexed (`idx_editorial_articles_author`, `00004013`)                                                                                                                                                                                                                                                                                              |
| `status`              | `text`        | `draft` · `published` · `archived` (default `draft`) — PRODUCT_MANAGEMENT §3.5 "Editorial article"                                                                                                                                                                                                                                                                                       |
| `published_at`        | `timestamptz` | When it goes public; a `published` row dated ahead is scheduled                                                                                                                                                                                                                                                                                                                          |
| `updated_at`          | `timestamptz` | Authored (fixtures have no `now()`); never before `published_at` (`articles_dates_check`)                                                                                                                                                                                                                                                                                                |
| `former_slugs`        | `text[]`      | Earlier slugs of a renamed article (default `{}`): each the slug of the ARCHIVED row that held it, at most 16, slug-shaped, ≤ 96, never the row's own (`articles_former_slugs_check`). `/articles/<former>` answers 308 here. That each names an archived row and has one claimant is checked in `content/articles.test.ts` (`formerSlugProblems`) — a cross-row rule no CHECK can state |

**Visible** = `status = 'published' AND published_at <= now()` — `isEditorialArticleVisible` on both
reader roads and the `articles_select_published` policy alike. A retraction is `archived`, never a
deleted record; a rename is a new row under a new slug listing the old one in `former_slugs`, with
the old row archived, so the old address redirects (Decision #274 (k)). Seeded: six published
articles, at least one leading each topic.
