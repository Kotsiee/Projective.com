# reviews: Tables

The `reviews` schema holds every review anyone writes about anything on the platform, and the ledger
of the one review reminder each person gets per anchor. Migration
[`00000019_tables_reviews.sql`](../../../supabase/migrations/00000019_tables_reviews.sql); indexes
in [`00004014_indexes_reviews.sql`](../../../supabase/migrations/00004014_indexes_reviews.sql). The
Zod row is `EntityReviewRowSchema` in `@projective/types/reviews`.

The schema is exposed to PostgREST so `/view/[id]` and `/@handle/reviews` read reviews as a
signed-out visitor. No client role holds a write privilege on any table here (`00002500`,
`00002520`): every write is a door in
[`00001670_functions_reviews_doors.sql`](../../../supabase/migrations/00001670_functions_reviews_doors.sql)
(Decision #487).

## `reviews.entity_reviews`

| Column                                             | Type                                     | Notes                                                                                                                                                                 |
| :------------------------------------------------- | :--------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                               | uuid PK                                  |                                                                                                                                                                       |
| `target_entity_id`                                 | uuid NOT NULL                            | Polymorphic — no FK; resolved by `target_entity_type`.                                                                                                                |
| `target_entity_type`                               | `reviews.review_target_type`             | `user` · `freelancer` · `business` · `team` · `service_blueprint` · `product` (see below).                                                                            |
| `reviewer_user_id`                                 | uuid → `org.users_public`                | The author.                                                                                                                                                           |
| `reviewer_business_id`                             | uuid → `org.business_profiles`, nullable | The business the author wrote for: a business client is one party (Decision #244 (e), ruled by #487). NULL for a person.                                              |
| `project_id`                                       | uuid → `projects.projects`, nullable     | **Anchor:** the engagement.                                                                                                                                           |
| `stage_assignment_id`                              | uuid → `projects.stage_assignments`      | The released seat that opened the review before the engagement completed (with `project_id` only).                                                                    |
| `cohort_membership_id`                             | uuid → `projects.cohort_memberships`     | **Anchor:** the attendee's session seat.                                                                                                                              |
| `session_event_id`                                 | uuid → `projects.session_events`         | The completed sitting that opened it (with `cohort_membership_id` only).                                                                                              |
| `order_line_id`                                    | uuid → `finance.order_lines`, nullable   | **Anchor:** the product purchase. No door writes it until CK1 records a delivery (ruling 5).                                                                          |
| `service_blueprint_id`                             | uuid → `marketplace.service_blueprints`  | The listing the engagement was bought from, stamped by the door from the anchor, so the listing reads its provider's reviews without reading the provider's projects. |
| `window_closes_at`                                 | timestamptz NOT NULL                     | 30 days from the anchor's completion: the author edits until then, or until the reply.                                                                                |
| `rating`                                           | numeric(3,2), 1.0–5.0                    | The dialog offers half stars.                                                                                                                                         |
| `title`                                            | text, nullable                           | 1–120 non-blank characters when present.                                                                                                                              |
| `comment`                                          | text NOT NULL                            | At least 100 non-blank characters; the door caps it at 5,000.                                                                                                         |
| `edited_at`                                        | timestamptz                              | The author's last edit.                                                                                                                                               |
| `withdrawn_at`                                     | timestamptz                              | The author withdrew it: kept, gone from every reader and average.                                                                                                     |
| `hidden_at` / `hidden_reason` / `hidden_by`        | timestamptz / text (1–500) / uuid        | An operator hid it (`reviews.hide_review`); `ck_entity_reviews_hidden` pairs the time and the reason.                                                                 |
| `is_visible`                                       | boolean, GENERATED STORED                | `withdrawn_at IS NULL AND hidden_at IS NULL` — the one predicate every reader, policy and aggregate uses.                                                             |
| `reply_comment`                                    | text, 1–1,000 characters                 | The reviewed side's one public reply.                                                                                                                                 |
| `reply_user_id` / `replied_at` / `reply_edited_at` | uuid / timestamptz / timestamptz         | Who replied and when; the reply is editable for 7 days.                                                                                                               |
| `created_at` / `updated_at`                        | timestamptz                              |                                                                                                                                                                       |

Constraints:

- `ck_entity_reviews_one_anchor` — exactly one of `project_id`, `cohort_membership_id`,
  `order_line_id`. The seed obeys it; it is never relaxed for seed data.
- `ck_entity_reviews_seat_on_project`, `ck_entity_reviews_sitting_on_membership` — the seat and the
  sitting only ever sit beside the anchor they belong to.
- `ck_entity_reviews_hidden`, `ck_entity_reviews_reply` — a hidden review has its reason; a reply
  has its author and time, and an edit only follows a reply.
- `uq_entity_reviews_one_per_party` (`00004014`) — one review per (anchor, party, target), the party
  being `COALESCE(reviewer_business_id, reviewer_user_id)`. A withdrawn or hidden review still
  counts. It replaces `unique_review_per_project`, whose NULLs were distinct and so bounded nothing
  without a project.

Indexes for the readers (`00004014`): by target and date (visible only), by listing and date
(visible only), by reviewer, by project anchor, by membership anchor.

### The target types, and the two reputation tracks

A person is reviewed on TWO tracks under one id, which is why the target type is part of every
aggregate (`reviews.fn_recount_rating` filters on it):

| `target_entity_type` | The reviewee is…            | Written by…                                  | Rating lands on                                                                                                                 |
| :------------------- | :-------------------------- | :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `user`               | a person, **as a client**   | a provider (RV2's door)                      | `org.users_public.rating_*`                                                                                                     |
| `business`           | a business, as a client     | a provider (RV2's door)                      | `org.business_profiles.rating_*`                                                                                                |
| `freelancer`         | a person, **as a provider** | the client party of an engagement or session | `org.freelancer_profiles.rating_*`                                                                                              |
| `team`               | a team, as a provider       | the client party of an engagement or session | `org.teams.rating_*`                                                                                                            |
| `service_blueprint`  | a service listing           | no door writes it                            | `marketplace.service_blueprints.rating_*` — recomputed from every visible review carrying the listing in `service_blueprint_id` |
| `product`            | a digital product           | its buyer, once CK1 lands                    | `catalogue.products.rating_*`                                                                                                   |

A review of a provider bought through a listing targets the PROVIDER and names the listing, so the
provider's profile and the listing's card are two views of the same rows (Decision #487 ruling 1).

The landing page's former testimonials reader (`ExploreBackendService.testimonials`) is dead code
since Decision #349 and reads visible rows only like everything else.

## `reviews.review_reminders`

The one `review.reminder` each person gets per anchor (Decision #487 ruling 6), written only by
`reviews.fn_send_review_reminders`. RLS on, no policy, no client privilege.

| Column                 | Type                                 | Notes                 |
| :--------------------- | :----------------------------------- | :-------------------- |
| `id`                   | uuid PK                              |                       |
| `user_id`              | uuid → `org.users_public` (CASCADE)  | Who was asked.        |
| `project_id`           | uuid → `projects.projects`, nullable | An engagement anchor. |
| `cohort_membership_id` | uuid → `projects.cohort_memberships` | A session anchor.     |
| `asked_at`             | timestamptz NOT NULL                 |                       |

`ck_review_reminders_one_anchor` — exactly one anchor; `uq_review_reminders_once` (`00004014`) — one
row per person and anchor. It is never `projects.session_events.review_asked_at`, which is Decision
#383 R6's attendance question and decides when an unanswered sitting becomes a dispute.

## The seat clock

`projects.stage_assignments.ended_at` (`00000015`) is stamped by
`projects.trg_stage_assignment_ended_at` (`00001670`, trigger in `00001850`) when a seat moves into
`completed`, `released` or `cancelled`. An update that leaves the status alone keeps the stamp, so
the project owner's assignment policy cannot backdate it.

## Seed

`supabase/seeds/06_reviews.sql` (`gen/emit-reviews.ts`) writes the 21 service reviews of
`gen/reviews.ts`, each on its anchor: a completed engagement bought from the listing, or a completed
session seat with one completed sitting; two carry the provider's reply. One more completed
engagement is left unreviewed for the live path. The 16 product reviews wait for CK1
(`PRODUCT_REVIEWS_AWAITING_DELIVERY`), and a world project's own reviews are emitted only once it is
completed. The generator refuses a self-review, a review of one's own team, a comment under 100
characters and a reply outside 1–1,000.
