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

_Not yet documented._ (P2: help categories and articles; an article's FAQ flag lives on the
article.)

## Changelog

_Not yet documented._ (P5: releases.)

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
