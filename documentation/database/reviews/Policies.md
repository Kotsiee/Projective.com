# reviews: Policies

Migration
[`00002018_policies_reviews_marketplace.sql`](../../../supabase/migrations/00002018_policies_reviews_marketplace.sql).

| Table                      | Policy                     | Command | Roles  | Rule         |
| :------------------------- | :------------------------- | :------ | :----- | :----------- |
| `reviews.entity_reviews`   | Visible reviews are public | SELECT  | public | `is_visible` |
| `reviews.review_reminders` | (RLS on, no policy)        | —       | —      | —            |

## Reads: visible rows only

A withdrawn or operator-hidden review is kept but no client reads it, signed in or not (Decision
#487). Its author still sees their own through `reviews.get_reviewables`, a definer.

## Writes: the doors, and nothing else

A review moves a PUBLIC rating: `reviews.recalculate_entity_rating` (a definer trigger) recomputes
the target's average on every write. So the only honest write path is one that proves the reviewer
had an **engagement** with what they review and is not its owner. That path is the doors in
[`00001670`](../../../supabase/migrations/00001670_functions_reviews_doors.sql) — `submit_review`,
`edit_review`, `withdraw_review`, `reply_to_review`, `edit_reply`, `hide_review` — which check the
anchor: a completed project or a seat released on it after work began, a completed sitting or cohort
membership, and, once CK1 records a delivery, the `finance.order_lines` row that bought a product.

There is no client write policy, and since Decision #487 no client write **privilege** either:
`00002500` grants the schema USAGE only and `00002520` grants SELECT on `entity_reviews` by name.
The blanket `GRANT ALL` Decision #83 flagged is gone, so a direct INSERT, UPDATE or DELETE is
refused with 42501 by the privilege, not left to RLS — which answers an UPDATE or DELETE it does not
admit with zero rows and no error (`supabase/probes/reviews_writer.sql` region 2).

The three policies this schema used to carry (write / update / delete your own review) allowed any
signed-in user to post any number of reviews of anything with `project_id` left NULL; they were
removed when the schema was exposed to PostgREST.
