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

_Not yet documented._ (P6: Projective articles and their authors.)
