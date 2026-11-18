# search: Policies

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Policies content has been written for the `search` schema yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `search.query_logs`

| Policy                    | Command | Rule                   |
| :------------------------ | :------ | :--------------------- |
| Users view own query logs | SELECT  | `user_id = auth.uid()` |

There is no INSERT policy, and `00002520` revokes `INSERT` from `PUBLIC`, `anon` and
`authenticated` (Decision #462). The table's one writer is the `SECURITY DEFINER`
`search.fn_log_query`, which takes no user id and attributes each row to `auth.uid()` itself
([Functions.md](Functions.md#searchfn_log_query--discovery-query-telemetry)). A direct PostgREST
INSERT is refused (`42501`) for a guest and a signed-in user alike, so no one can write a query log
in another person's name (SEC G13; `supabase/probes/search_query_log_attribution.sql`).
`service_role` keeps `ALL`. Reads are column-granted without `query_embedding` (`00002520`).

## `search.interest_events`

| Policy                       | Command | Rule                                     |
| :--------------------------- | :------ | :--------------------------------------- |
| Insert own interest events   | INSERT  | `user_id = auth.uid() OR user_id IS NULL` |
| Read own interest events     | SELECT  | `user_id = auth.uid()`                   |

Grants: `INSERT` to `anon` and `authenticated`, `SELECT` to `authenticated`, `ALL` to
`service_role`. There is no UPDATE or DELETE policy: rows are append-only. A writer can attribute a
row to themselves or to nobody, never to someone else.

## `search.profiles_index` · `projects_index` · `services_index` · `catalogue_index`

| Table             | Policy                                 | Command | Rule                                |
| :---------------- | :------------------------------------- | :------ | :---------------------------------- |
| `profiles_index`  | Public can view profile search index   | SELECT  | `is_active = true`                  |
| `projects_index`  | Public can view project search index   | SELECT  | `is_active = true`                  |

`is_active` on both is the source's directory-listed predicate, written by the sync triggers
([Functions.md](Functions.md#index-visibility-is-directory-visibility-sec-e6--g12)), so these policies
admit nothing the public directory does not.
| `services_index`  | Public can view service search index   | SELECT  | `is_public = true`                  |
| `catalogue_index` | Public can view catalogue search index | SELECT  | `is_public = true` (Decision #179)  |

**Column grants (Decision #179, `00002520`).** The rows are public; their vectors are not. The
table-level SELECT `00002500` gives `anon` and `authenticated` on every `search` table is revoked on
these four and on `query_logs`, then granted again column by column without `embedding`,
`embedding_model`, `embedding_hash` and `embedded_at` (`query_embedding` on `query_logs`). A PostgREST
select naming one of them — or `*` — is refused with `42501`; the discovery catalogue's penalty read
(`entity_id, discovery_penalty`) is unaffected. `service_role` keeps `ALL`. There is no write policy:
the sync triggers and `search.fn_set_embedding` are definers.
