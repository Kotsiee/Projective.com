# search: Tables

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Tables content has been written for the `search` schema yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `search.platform_stats` — the landing hero's proof points (view)

Migration [`00003004_views_finance_integrations_analytics.sql`](../../../supabase/migrations/00003004_views_finance_integrations_analytics.sql);
`SELECT` granted to `anon` and `authenticated` in `00003005`.

A one-row definer view of AGGREGATES only — four numbers and a currency, nothing a visitor could use
to identify a person, project or payout. It replaces three figures the landing page used to
hardcode ("$4.2M", "3,800+", "19k").

| Column              | Meaning                                                                                      |
| :------------------ | :------------------------------------------------------------------------------------------- |
| `helpers`           | Listed freelancers and teams in `org.profiles_index`.                                        |
| `stages_delivered`  | `projects.stage_assignments` with `status = 'completed'`.                                   |
| `projects_live`     | `projects.projects` that are `active` or `completed`.                                        |
| `paid_out_minor`    | Sum of settled (`paid`) `finance.payouts` in the base currency, minor units.                |
| `paid_out_currency` | `USD`. A payout in another currency is left out rather than converted at an arbitrary rate. |

The landing page (`ExploreBackendService.stats`) hides any figure that is still zero, so a new
deployment shows fewer proof points rather than "$0 paid out".

## `search.query_logs` — one row per executed discovery query

Migration [`00000018_tables_search.sql`](../../../supabase/migrations/00000018_tables_search.sql).
Written only through `search.fn_log_query` (see [Functions.md](Functions.md)), which
`ExploreBackendService.search` calls fire-and-forget on the **first page** of every search, from
both the `/explore` SSR and `GET /api/explore/search`. A later page of the same feed is not a new
search and is not logged. Gated by `EXPLORE_BACKEND_LIVE` (off ⇒ nothing is written). This is the
`discovery.search` event of `analytics.event_catalogue`.

| Column            | Meaning                                                                                      |
| :---------------- | :------------------------------------------------------------------------------------------- |
| `user_id`         | `auth.uid()` of the caller, NULL for a guest (the RPC resolves it; the app never passes it). |
| `search_query`    | The trimmed `?q=`; `''` for a category browse.                                               |
| `query_embedding` | `search.fn_mock_embedding(query)` until real embeddings exist.                               |
| `filters_applied` | The rest of `ExploreParams` (`category`, `sort`, `filters`).                                 |
| `entity_type`     | The searched category (`all`, `services`, `freelancers`, …).                                 |
| `duration_ms`     | Catalogue load + filter + rank, measured in the fat service.                                 |
| `result_count`    | Matching items (`SearchPayload.count`).                                                      |
| `matched_density` | `result_count / candidate pool`: the pool is the searched category's catalogue size.       |

## `search.interest_events` — discovery impressions, clicks and rail depth

Migration [`00000018_tables_search.sql`](../../../supabase/migrations/00000018_tables_search.sql);
RLS in `00002014`, grants in `00002520`. Zod SSOT: `@projective/types/explore`
(`DiscoveryEventBatchSchema`, `packages/types/explore/telemetry.ts`).

Written by `InterestBackendService.record` (`packages/backend/services/search/`) from the
`ImpressionTracker` island's `POST /api/explore/events` beacon, inserted **as the caller** (their
JWT, so RLS pins `user_id = auth.uid()`). It falls back to an anonymous row with `user_id` NULL
when the caller's token no longer verifies, because a beacon sent from `pagehide` often outlives
its session. Gated by `EXPLORE_BACKEND_LIVE`: off ⇒ the batch is validated and acknowledged with
no write.

| Column        | Meaning                                                                                                                 |
| :------------ | :---------------------------------------------------------------------------------------------------------------------- |
| `user_id`     | The signed-in reader, NULL for a guest.                                                                                 |
| `session_id`  | Anonymous per-tab key (`sessionStorage` `pj.session.explore.discoverySession`). Joins one browsing session's events.    |
| `event_type`  | `impression` · `click` · `rail_depth` from the tracker. `search` · `save` · `hire` · `apply` · `message` are reserved.  |
| `entity_id`   | The listing/profile **uuid**. Cards carry public slugs/handles; the service resolves them against the cached public catalogue and **drops** any id the catalogue does not hold. NULL for `rail_depth`. |
| `entity_type` | `service` · `product` · `article` · `project` · `user` · `freelancer` · `team` · `business`, taken from the catalogue, never from the client. NULL for `rail_depth`. |
| `query`       | The results page's active `?q=` when the event happened.                                                                |
| `weight`      | `impression` 0.1 · `click` 1.0 · `rail_depth` 0 (`EVENT_WEIGHT` in `interest-rows.ts`).                                 |
| `context`     | jsonb: `{ surface, rail?, position? }` for cards (`surface` is `explore.home` or `explore.results`; `position` is the zero-based slot in the rail or grid), `{ surface, rail, depth, items }` for rail depth. |

**Event semantics** (the `discovery.*` rows of `analytics.event_catalogue`):

- `impression`: a card at least 50% visible for 1 s in a visible tab, once per placement
  (`rail` + item) per page view.
- `click`: a press on the card's own stretched link (`.ex-card__link`); a sub-link to the
  creator or a skill is not a click on the item.
- `rail_depth`: the furthest `(scrollLeft + clientWidth) / scrollWidth` reached in one
  `[data-rail-id]` track, re-sent only when it grows by more than 0.01.

> **Ranking caveat.** `search.fn_search_global` / `fn_search_entities` compute popularity as
> `count(*)` over this table with no `event_type` filter, so impressions count as much as clicks
> there. The app's live discovery path does not call those RPCs (it ranks in `query.ts`), but anything
> that adopts them should switch to `sum(weight)` or exclude impressions first.

## `search.search_weights` — the scoring matrix's coefficients

Migration [`00000018_tables_search.sql`](../../../supabase/migrations/00000018_tables_search.sql);
seeded in `00005050`; RLS "Admins read weights" (`00002014`); tuned live by `search.fn_set_weight`.
`(key PK, label, description, scope ∈ universal · talent · opportunity, weight, min_value, max_value,
is_active, updated_at, updated_by)`.

The discovery catalogue reads it through `search.ranking_weights()` (key · weight · is_active only,
[Functions.md](Functions.md)) and its quality score (`packages/backend/services/explore/ranking.ts`,
Decision #178) uses `review_sentiment`, `review_count`, `workload`, `discovery_boost` (seeded 1.25 for
the newcomer Discovery Boost — earned, never sold), `penalty` and `interest_history`. The other keys
belong to the SQL ranking RPCs. `verification` is deliberately NOT read by the catalogue's score:
discovery weight comes from Standing alone (PRODUCT_SPEC §Reputation & Discovery 5).

## `search.user_affinity` — a person's topic affinity

Migration `00000018`; RLS "Users manage own affinity" (own rows, `00002014`); index
`idx_user_affinity (user_id, affinity_score DESC)`. Zod: `UserAffinityRowSchema`
(`packages/types/explore/signals.ts`).

One row per person per TOPIC (`category_slug`: a lowercased skill label or category of something
they opened). Written by `search.record_view`: +1 per opening, after decaying the stored score with a
14-day half-life from `updated_at`; the Home's viewer pass reads a person's top 24 and applies the
same decay to now. It drives "Picked for you" when a person has no usable "Because you viewed" anchor.

## `search.profiles_index` — the trust penalty's cache

`discovery_penalty` is kept by `security.fn_recalc_penalty_aggregates` (the active `discovery_rank`
severity of a subject's `security.penalties`). The discovery catalogue reads the positive rows as
`anon` (policy "Public can view profile search index", `is_active`) and subtracts the penalty from
the owner's items — for a project, the worse of its poster's and its client business's.
