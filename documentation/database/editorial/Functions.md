# editorial: Functions

Migration
[`00001320_functions_editorial_community.sql`](../../../supabase/migrations/00001320_functions_editorial_community.sql)
(regions `[editorial.*]`); triggers in `00001898` under the same region names. EXECUTE is revoked
from `PUBLIC`, `anon` and `authenticated` on the whole schema (`00002510`, "editorial + community —
deny by default") and granted back by name in the surface's region there. Editorial content is read
straight from its tables under their SELECT policies, so editorial functions should be rare — a
derived read, never a write door. Tables: [Tables.md](Tables.md) · Policies:
[Policies.md](Policies.md).

## Shared guards

| Function                               | Returns   | Purpose                                                                                                                                                                                                                         |
| :------------------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editorial.fn_guard_slug_immutable()`  | `trigger` | `BEFORE UPDATE OF slug` guard: a readable editorial slug is permanent once the row exists, so any change raises `23514` (Decision #274 (k), the scoped amendment of #88). Each surface attaches it to its own tables in `00001898`. |

## Help

_Not yet documented._ (P2.)

## Changelog

| Function                                          | Returns   | Purpose                                                                                                                                                                                                                                                            |
| :------------------------------------------------ | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editorial.fn_guard_release_version_immutable()`  | `trigger` | `BEFORE UPDATE OF version` on `editorial.changelog_releases` (`trg_changelog_releases_version_immutable`, `00001898`): a release's version is its permanent public address, so any change raises `23514` — the changelog's twin of `fn_guard_slug_immutable` (Decisions #274 (k) / #278). A mis-versioned release is withdrawn and authored again. The generated seed's upsert never sets the key, so re-running it never trips the guard. |

No client EXECUTE grant (`00002510`, `[editorial.changelog]`): a trigger function needs none, and the
changelog is read straight from its table.

## Articles

_Not yet documented._ (P6.)
