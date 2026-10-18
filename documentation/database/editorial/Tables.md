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

_Not yet documented._ (P6: Projective articles and their authors.)
