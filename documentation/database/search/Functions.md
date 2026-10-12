# search: Functions

Declared in `00001400_functions_search.sql`; the triggers that fire them are in
`00001800_triggers_core_search.sql`. Tables: [Tables.md](Tables.md) · Policies:
[Policies.md](Policies.md).

Documented here: the **index-sync triggers**, `fn_log_query`, the **discovery-signal** functions
(`ranking_weights`, `trending_entities`, `record_view`) and the **embedding** functions
(`fn_set_embedding`, `fn_nearest`, `fn_nearest_to_entity` — Decision #179). The other ranking and
query RPCs (`fn_search_entities`, which now takes a trailing nullable `p_query_embedding vector(1024)`
and scores the vector term 0 without one, `fn_search_global`, `fn_search_analytics`, `fn_get_weights`,
`fn_set_weight`, `fn_norm`, `is_admin`) are not yet written up. `fn_mock_embedding` is deleted.

---

## The index-sync triggers

Eight `AFTER INSERT OR UPDATE` triggers keep `search.*_index` in step with the source rows, so a title
edit is searchable without a rebuild.

| Function                          | Fires on                  | Writes to               |
| :-------------------------------- | :------------------------ | :---------------------- |
| `search.sync_team_to_index`       | `org.teams`               | `search.profiles_index` |
| `search.sync_freelancer_to_index` | `org.freelancer_profiles` | `search.profiles_index` |
| `search.sync_project_to_index`    | `projects.projects`       | `search.projects_index` |
| `search.sync_user_to_index`       | `org.users_public`        | `search.profiles_index` |
| `search.sync_business_to_index`   | `org.business_profiles`   | `search.profiles_index` |
| `search.sync_service_to_index`    | `marketplace.service_blueprints` | `search.services_index` |
| `search.sync_product_listing_to_index` | `catalogue.listings` (product rows) | `search.catalogue_index` |
| `search.sync_article_to_index`    | `catalogue.articles`      | `search.catalogue_index` |

Each is an upsert keyed on the source id, so re-running one is idempotent and a row can never be
duplicated by a second write.

---

## ⚠️ An `INVOKER` sync trigger is a WRITE BLOCKER on its source table

`00002500` grants `authenticated` only `SELECT` on schema `search`, and every `*_index` table has
RLS enabled with a **SELECT-only** policy ([Policies.md](Policies.md)). So an `INVOKER` sync trigger
cannot write its index row on an ordinary client's behalf, and the caller's own statement fails:

```
ERROR:  permission denied for table projects_index
CONTEXT: PL/pgSQL function search.sync_project_to_index() line 3 at SQL statement
```

The error names a table the caller never mentioned, inside a statement they never wrote, on a table
their own RLS policy explicitly permits — which is what makes it expensive to diagnose. **Widening
the grant does not fix it**: with `INSERT`/`UPDATE` granted the trigger then raises
`new row violates row-level security policy for table "projects_index"`. Two layers, both blocking.

`SECURITY DEFINER` is the correct fix, and it is what every other function in
`00001400_functions_search.sql` already is. The search index is derived, internal and nobody's
row-level property: it is maintained **by the platform**, not by whoever happened to trigger it.

### Current state

- ✅ `search.sync_project_to_index` is
  `SECURITY DEFINER SET search_path = public, search, projects`. Corrected because a client write to
  `projects.projects` is a live path — the engagement editor's `PATCH /api/projects/[id]` — and was
  measurably failing on it (reproduced as `authenticated` against a seeded project the caller owns,
  then re-verified passing after the change).
- ⚠️ The **other five remain `INVOKER`** and carry the identical defect. They are latent only
  because their own client write paths are still stub-first, so nothing exercises them as
  `authenticated` today. Each gates a different domain's writes (`org`, `marketplace`) and belongs
  to that domain's pass. **A team, business, profile or service write path that goes live before its
  sync trigger is made `SECURITY DEFINER` will fail exactly as the project one did.**

---

## `search.fn_log_query` — discovery query telemetry

`(p_query text, p_entity_type text, p_filters jsonb, p_result_count integer, p_duration_ms integer,
p_candidate_pool integer DEFAULT NULL, p_user_id uuid DEFAULT auth.uid(), p_query_embedding
vector(1024) DEFAULT NULL) RETURNS void`:
`SECURITY DEFINER`, executable by `anon`, `authenticated` and `service_role`.

Inserts one `search.query_logs` row (see [Tables.md](Tables.md)), deriving `matched_density` as
`p_result_count / p_candidate_pool` (NULL when the pool is 0 or absent), and the `voyage-4` query
vector when semantic ranking ran (`p_query_embedding`; NULL otherwise, and the app then omits the
argument entirely). Its only caller is `logDiscoveryQuery` (`packages/backend/services/search/query-log.ts`),
which `ExploreBackendService.search` fires without awaiting on the first page of a search. The
call runs as the reader (their JWT, else `anon`) and **never passes `p_user_id`**, so the default
`auth.uid()` attributes the row.

> **Flag.** `p_user_id` is honoured for any caller, and the function is a definer granted to
> `anon`, so a direct PostgREST call can attribute a query log to another user. The app never
> passes it. Hardening it the way `analytics.fn_emit` treats `p_actor` (honour it only for an
> admin or the service role) is a one-line change that awaits a human decision.

---

## Discovery signals — the quality score and the personalised Home (Decision #178)

The discovery catalogue (`packages/backend/services/explore/live-catalog.ts`) is read as `anon` and
cached for every visitor, so whatever it needs beyond public rows comes through a definer that
projects only what is safe to show anyone. The viewer's own signals are read under their JWT
(`viewer-signals.ts`) — see [org/Tables.md](../org/Tables.md) §Discovery signals.

### `search.ranking_weights()`

`RETURNS TABLE (key text, weight numeric, is_active boolean)`: `STABLE SECURITY DEFINER`, executable
by `anon`, `authenticated`, `service_role`. Every `search.search_weights` row's coefficient and
switch, nothing else — the table itself stays admin-read (its rows also carry labels and
`updated_by`). The catalogue resolves the keys `ranking.ts` reads (`review_sentiment`,
`review_count`, `workload`, `discovery_boost`, `penalty`, `interest_history`): an inactive key scores
0, and a missing one scores 0 and is logged once per process.

### `search.trending_entities(p_days integer DEFAULT 7, p_limit integer DEFAULT 24)`

`RETURNS TABLE (entity_type text, entity_id uuid, people integer, score numeric)`: `STABLE SECURITY
DEFINER`, executable by `anon`, `authenticated`, `service_role`. Per entity, the DISTINCT people who
viewed it (`org.recent_views.viewed_at`) or saved it (`org.user_bookmarks.created_at`) inside the
window — a view counts 1, a save 2 — **only where at least three distinct people stand behind it**,
so no row can be traced back to one person's history. Window clamped to 1–30 days, rows to 1–100,
ordered by score, then people. The catalogue resolves each row to a live item and drops the rest.

### `search.record_view(p_entity_type text, p_entity_id uuid, p_topics text[] DEFAULT '{}')`

`RETURNS void`: `VOLATILE SECURITY DEFINER`, `SET search_path = org, search, public`. **Executable by
`authenticated` and `service_role` only** (revoked from `PUBLIC` and `anon` after the schema-wide
grant), and it refuses a NULL `auth.uid()` with `42501` regardless.

- Upserts the caller's `org.recent_views` row on `(user_id, entity_type, entity_id)`: a first view
  inserts, a repeat moves `viewed_at` to `now()` and increments `view_count`. The caller is always
  `auth.uid()`, never a parameter, and the times are always the server's — it is the table's only
  writer for exactly that reason. An unknown `entity_type` fails the table's CHECK (`23514`); an
  account with no `org.users_public` row fails its FK (`23503`).
- Leans the caller's `search.user_affinity` toward each topic (lowercased, trimmed, de-duplicated, at
  most 8 of 60 characters): an existing score is decayed with a 14-day half-life from its
  `updated_at`, then incremented by 1.

Its only app caller is `ExploreBackendService.recordView`, which resolves the item against the
PUBLISHED catalogue first and skips the viewer's own work, so an id that names nothing never reaches
it and nobody can push their own listing toward Trending.

---

## Embeddings (Decision #179)

Voyage AI `voyage-4` vectors: 1024 dimensions, unit length — inner product ranks as cosine, and the
HNSW indexes use `vector_ip_ops` (`00004004`). The columns are in [Tables.md](Tables.md) §Embeddings.

### `search.fn_set_embedding(p_entity_type text, p_entity_id uuid, p_embedding vector(1024), p_model text, p_hash text)`

`RETURNS boolean`: `VOLATILE SECURITY DEFINER`. **Executable by `service_role` only** — revoked from
`PUBLIC`, `anon` and `authenticated` after the schema-wide grant (`00002510`). The only writer of the
embedding columns: it sets `embedding`, `embedding_model`, `embedding_hash` and `embedded_at = now()` on
the entity's index row (`service_blueprint` → `services_index`, `project` → `projects_index`, `user` ·
`freelancer` · `team` · `business` → `profiles_index`, `product` · `article` → `catalogue_index`) and
returns whether there was a row to set. Refuses (`22023`) a vector that is not 1024 wide, a blank
model or hash, and an unknown entity type. Callers: `deno task embeddings:backfill` and the
post-commit re-embed (`packages/backend/services/search/embedding-sync.ts`), both with the
service-role key.

### `search.fn_nearest(p_embedding vector(1024), p_types text[] DEFAULT NULL, p_exclude uuid[] DEFAULT '{}', p_limit integer DEFAULT 24)`

`RETURNS TABLE (entity_type text, entity_id uuid, score double precision)`: `STABLE SECURITY DEFINER`,
executable by `anon`, `authenticated`, `service_role`. The public entities nearest `p_embedding`, best
first; `score` is the cosine similarity. A definer because `anon` cannot read a vector; it applies each
index's own public rule — the USING clause of its anon SELECT policy (`is_active` on profiles and
projects, `is_public` on services and the catalogue) — so it returns nothing anon could not already
read, and never a vector. `p_types` narrows to entity kinds (NULL = all), `p_exclude` drops ids,
`p_limit` is clamped to 1–100, and a NULL vector returns nothing. Caller: `ExploreBackendService.search`
with the query vector, as `anon`.

### `search.fn_nearest_to_entity(p_entity_type text, p_entity_id uuid, p_types text[] DEFAULT NULL, p_exclude uuid[] DEFAULT '{}', p_limit integer DEFAULT 24)`

The same answer, seeded with one entity's STORED vector, read inside the database so it never crosses
the wire and a public page needs no service-role read (Decision #178(b)). The entity must itself be
public; it is always excluded from its own answer; the answer is empty while it has no vector.
Caller: the `/view` "Similar" rail (`semanticSimilarTo`, `packages/backend/services/explore/live-view.ts`),
which also excludes everything the item's owner published.

### `search.sync_product_listing_to_index` · `search.sync_article_to_index`

The two `search.catalogue_index` sync triggers in the table above — `SECURITY DEFINER`, like the other
sync functions in `00001400`. They upsert the title, `fts` and `is_public` and leave the embedding
columns alone: a changed text is caught by its hash on the next backfill or re-embed.
