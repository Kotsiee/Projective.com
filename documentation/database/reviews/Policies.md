# reviews: Policies

Migration
[`00002018_policies_reviews_marketplace.sql`](../../../supabase/migrations/00002018_policies_reviews_marketplace.sql).

| Table                           | Policy                        | Command | Roles  | Rule                                                                                 |
| :------------------------------ | :---------------------------- | :------ | :----- | :----------------------------------------------------------------------------------- |
| `reviews.entity_reviews`        | Visible reviews are public    | SELECT  | public | `is_visible OR (reviewer_user_id = auth.uid() AND withdrawn_at IS NULL AND hidden_at IS NULL)` |
| `reviews.review_reminders`      | (RLS on, no policy)           | —       | —      | —                                                                                    |
| `reviews.client_trust_scores`   | Shown trust scores are public | SELECT  | public | `review_count >= 3`                                                                  |
| `reviews.client_trust_consents` | (RLS on, no policy)           | —       | —      | —                                                                                    |

## Reads: visible rows only

A withdrawn or operator-hidden review is kept but no client reads it, signed in or not (Decision
#487). Its author still sees their own through `reviews.get_reviewables`, a definer. A blind review,
waiting on an engagement for the other side's (Decision #486 (A)), is read by its author alone:
`is_visible` is false until `reviews.fn_reveal` stamps `revealed_at`, and the policy's second arm
admits the author's own live review only.

A Client Trust Score is public once it is shown, from 3 reviews (#486 (B)); below that no client
reads its row. Its one writer is `reviews.fn_recompute_client_trust`, and the consent log is written
only by `reviews.acknowledge_client_trust`; neither table takes a client write privilege (`00002520`
grants SELECT on `client_trust_scores` only).

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
