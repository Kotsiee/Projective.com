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

_Not yet documented._ (P5: releases.)

## Articles

_Not yet documented._ (P6: Projective articles and their authors.)
