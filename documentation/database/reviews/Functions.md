# reviews: Functions

Migration [`00001005_functions_reviews.sql`](../../../supabase/migrations/00001005_functions_reviews.sql).

## `reviews.recalculate_entity_rating()` — trigger

`AFTER INSERT OR UPDATE OR DELETE ON reviews.entity_reviews`, as `trg_update_ratings`
(`00001800`). `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` revoked from `PUBLIC` — a trigger
function, never an RPC.

Recomputes `rating_average` (rounded to 2 dp) and `rating_count` for the review's target, filtered by
BOTH `target_entity_id` and `target_entity_type`, and writes them onto the target row:

| Target type         | Row updated                                  |
| :------------------ | :------------------------------------------- |
| `user`              | `org.users_public`                           |
| `freelancer`        | `org.freelancer_profiles`                    |
| `business`          | `org.business_profiles`                      |
| `team`              | `org.teams`                                  |
| `service_blueprint` | `marketplace.service_blueprints`             |
| `product`           | `catalogue.products`                         |

Two properties matter and both were corrected on 2026-09-22:

1. **The type filter.** A person is reviewed as a client (`user`) and as a seller (`freelancer`)
   under the same id. Averaging every review with that id folded each track into the other, so a
   freelancer's delivery rating moved when a seller reviewed them as a buyer.
2. **`SECURITY DEFINER`.** As the invoker, a review written by a signed-in user fired an UPDATE on
   somebody else's row, which that user's RLS forbids — the UPDATE matched nothing, raised nothing,
   and the rating never moved for any review written through the API. As a definer it also passes
   `security.fn_guard_derived_columns`, which refuses the same column writes from a client.
