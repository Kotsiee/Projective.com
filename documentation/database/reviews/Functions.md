# reviews: Functions

**`EXECUTE` is deny by default (Decision #477).** The first region of `00002510` revokes it from
`PUBLIC`, `anon` and `authenticated` on every function here and `00002500` closes the default for
functions created later, so a client role holds only what `00002510` grants by name (its "Reviews"
region). `anon` may execute none of them. The full allowlist, one reason per line, is in
`supabase/probes/function_grants.sql`.

Migrations [`00001005_functions_reviews.sql`](../../../supabase/migrations/00001005_functions_reviews.sql)
(the rating trigger) and
[`00001670_functions_reviews_doors.sql`](../../../supabase/migrations/00001670_functions_reviews_doors.sql)
(the doors, the reads, the reminder; Decision #487). Every definer pins `search_path = ''` and
schema-qualifies every name.

## The doors (signed in: `authenticated`)

| Function                                                                     | What it does                                                                                     | Refusals (SQLSTATE)                                                                                 |
| :--------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `submit_review(anchor_kind, anchor_id, target_type, target_id, rating, title, comment) → uuid` | Writes the caller's review of a target on an anchor (`project`, `cohort_membership`, `order_line`), stamps the listing and the 30-day window, tells the target (`review.received`). | 42501 no JWT · PM403 13–17 · 22023 bounds / unknown kind · PT404 no anchor, or nothing complete for that target · PT403 not the anchor's party · PT422 oneself, one's own team or business · PT410 window closed · PT409 a review by this party exists · PT501 a product until CK1 |
| `edit_review(review, rating, title, comment)`                                | The author rewrites it while the window is open and before the reply.                           | PT403 not the author · PT404 withdrawn or hidden · PT409 replied · PT410 window closed · 22023     |
| `withdraw_review(review)`                                                    | The author withdraws it (kept, hidden everywhere); a second call is a no-op.                     | PT403 not the author                                                                                 |
| `reply_to_review(review, body)`                                              | The one public reply, by whoever answers for the target.                                         | PT403 may not answer · PT404 not visible · PT409 already replied · 22023 outside 1–1,000            |
| `edit_reply(review, body)`                                                   | Rewrites the reply for 7 days.                                                                   | PT403 · PT404 no reply · PT410 after 7 days · 22023                                                  |
| `hide_review(review, reason)`                                                | An operator hides it (kept); a second call keeps the first reason.                               | 42501 not an operator (`security.is_admin()`) · 22023 reason outside 1–500 · PT404                  |
| `get_reviewables(project_slug) → jsonb`                                      | What the caller may review on one project: each provider, and the provider of each of their session seats, with the party's review and the window. `[]` for a 13–17 account or a non-party; NULL for no such project. | 42501 no JWT |
| `get_review_actions(ids uuid[]) → jsonb`                                     | Per visible review: `can_edit`, `can_withdraw`, `can_reply`, `can_edit_reply`, and the author's `edit_href` (`/projects/<slug>?review=<slug>`). `[]` signed out. | — |

Who may review what (ruling 1): the client party of a completed engagement reviews each provider who
held a seat on it (`accepted`, `completed` or `released`) and the provider of the listing it was
bought from; on a running engagement, a provider whose seat was **released after work began** (they
submitted on its stage). The client party is `COALESCE(client_user_id, owner_user_id)`, and for a
business client also any active member holding `hire`. The attendee of a cohort membership reviews
the session listing's provider once a sitting of the cohort completed, or the membership did. The
window opens at the project's `completed` status-history row, the seat's `ended_at`, or the later of
the cohort's last completed sitting and the seat escrow's release.

## The helpers (no client grant; run as their owner inside a door)

`fn_review_window()` (30 days) · `fn_reply_edit_window()` (7 days) · `fn_reminder_lead()` (3 days) ·
`fn_engagement_targets(project, user)` · `fn_session_targets(membership, user)` ·
`fn_is_own_target(type, id, user)` · `fn_can_answer(type, id, user)` (the person, or a team or
business member holding `edit_profile` or `publish_listings`) · `fn_answerers(type, id)` ·
`fn_notify_received(review)` (to `/view/<slug>#evp-reviews` for a listing, else `/@handle/reviews`) ·
`fn_check_review_input` · `fn_check_reply` · `fn_authored` · `fn_answerable` · `fn_target_card` ·
`fn_recount_rating`.

## `fn_send_review_reminders(now) → integer` — the daily job (service role)

`reviews-reminders` (`00005060`, 09:21 UTC). Asks each client party, and each attendee, once per
anchor (`reviews.review_reminders`) to review it — the first run at least 3 days after it opened and
before its window closes, while something on it is still unreviewed by that party — with
`review.reminder` linking `/projects/<slug>?review=<slug>`. Never writes `review_asked_at`.

## `projects.trg_stage_assignment_ended_at()` — trigger

`BEFORE INSERT OR UPDATE ON projects.stage_assignments` (`00001850`). Stamps `ended_at` on the move
into an ended status; keeps it when the status is unchanged; only the table owner (the seed) may supply
one on insert.

## `reviews.recalculate_entity_rating()` — trigger

`AFTER INSERT OR UPDATE OR DELETE ON reviews.entity_reviews`, as `trg_update_ratings`
(`00001800`). `SECURITY DEFINER`, `search_path = ''` — a trigger function, never an RPC. It calls
`reviews.fn_recount_rating(type, id)` for the old and the new row's target, and for the listing in
`service_blueprint_id`, counting **visible reviews only** (Decision #487), and writes `rating_average`
(rounded to 2 dp) and `rating_count` onto the target row:

| Target type         | Row updated                                  |
| :------------------ | :------------------------------------------- |
| `user`              | `org.users_public`                           |
| `freelancer`        | `org.freelancer_profiles`                    |
| `business`          | `org.business_profiles`                      |
| `team`              | `org.teams`                                  |
| `service_blueprint` | `marketplace.service_blueprints` (every visible review carrying the listing) |
| `product`           | `catalogue.products`                         |

Two properties were corrected on 2026-09-22 and still hold:

1. **The type filter.** A person is reviewed as a client (`user`) and as a seller (`freelancer`)
   under the same id. Averaging every review with that id folded each track into the other.
2. **`SECURITY DEFINER`.** As the invoker, a review written by a signed-in user fired an UPDATE on
   somebody else's row, which that user's RLS forbids. As a definer it also passes
   `security.fn_guard_derived_columns`, which refuses the same column writes from a client.
