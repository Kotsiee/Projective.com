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
