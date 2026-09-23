# reviews: Policies

Migration [`00002018_policies_reviews_marketplace.sql`](../../../supabase/migrations/00002018_policies_reviews_marketplace.sql).

| Table                     | Policy                          | Command | Roles    | Rule                     |
| :------------------------ | :------------------------------ | :------ | :------- | :----------------------- |
| `reviews.entity_reviews`  | Reviews are globally visible    | SELECT  | public   | `true`                   |

## There is no client write policy — deliberately

A review moves a PUBLIC rating: `reviews.recalculate_entity_rating` (a definer trigger) recomputes
the target's average on every insert, update and delete. So the only honest write path is one that
proves the reviewer had an **engagement** with what they are reviewing — bought the product, worked
the project, was the client — and is not its owner. No table records a product purchase yet
(`finance.orders` is the deferred live path) and no review flow exists in the app, so that check
cannot be written today.

The three policies this schema used to carry (write / update / delete your own review) allowed any
signed-in user to post any number of reviews of anything with `project_id` left NULL. They were
dormant while `reviews` was not exposed to PostgREST; exposing it for the discovery reads would have
made them live, so they were removed in the same change. Verified by execution: a signed-in insert
is refused by RLS, while the seed's insert (as the table owner) still moves the target's rating.

**Until the engagement-checked review RPC lands, reviews are written by the service role and the
seed only.** That RPC carries its own check (as a definer, or with a policy that states it).
