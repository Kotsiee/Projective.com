# reviews: Tables

The `reviews` schema holds one table: every review anyone writes about anything on the platform.
Migration [`00000019_tables_reviews.sql`](../../../supabase/migrations/00000019_tables_reviews.sql).

The schema was created by the init migration from the start but had no documentation folder until
the discovery surfaces began reading it live (the drift flagged in [../README.md](../README.md) and
Decision #56(e)). It is now exposed to PostgREST so `/view/[id]` and the landing page can read
reviews as a signed-out visitor.

## `reviews.entity_reviews`

| Column               | Type                           | Notes                                                                                      |
| :------------------- | :----------------------------- | :----------------------------------------------------------------------------------------- |
| `id`                 | uuid PK                        |                                                                                            |
| `target_entity_id`   | uuid NOT NULL                  | Polymorphic — no FK; resolved by `target_entity_type`.                                     |
| `target_entity_type` | `reviews.review_target_type`   | `user` · `freelancer` · `business` · `team` · `service_blueprint` · `product` (see below). |
| `reviewer_user_id`   | uuid → `org.users_public`      |                                                                                            |
| `project_id`         | uuid → `projects.projects`     | The engagement the review is about, when there is one.                                     |
| `rating`             | numeric(3,2), 1.0–5.0          |                                                                                            |
| `title`              | text, nullable                 | 1–120 non-blank characters when present.                                                   |
| `comment`            | text NOT NULL                  | At least 100 non-blank characters — the substance the platform requires.                   |
| `reply_comment` / `replied_at` | text / timestamptz   | The reviewee's reply (≥ 100 characters when present).                                      |
| `created_at` / `updated_at` | timestamptz            |                                                                                            |

`unique_review_per_project (target_entity_id, reviewer_user_id, project_id)` — NULLs are distinct,
so it only bounds reviews that name a project.

### The target types, and the two reputation tracks

A person is reviewed on TWO tracks under one id, which is why the target type is part of every
aggregate (`reviews.recalculate_entity_rating` filters on it):

| `target_entity_type` | The reviewee is…                        | Written by…                        | Rating lands on                        |
| :------------------- | :-------------------------------------- | :--------------------------------- | :------------------------------------- |
| `user`               | a person, **as a client**               | a seller they bought from          | `org.users_public.rating_*`            |
| `business`           | a business, as a client                 | a seller they bought from          | `org.business_profiles.rating_*`       |
| `freelancer`         | a person, **as a seller**               | a buyer                            | `org.freelancer_profiles.rating_*`     |
| `team`               | a team, as a seller                     | a buyer                            | `org.teams.rating_*`                   |
| `service_blueprint`  | a service listing                       | a buyer                            | `marketplace.service_blueprints.rating_*` |
| `product`            | a digital product                       | a buyer                            | `catalogue.products.rating_*`          |

The landing page's testimonials read this table directly (`ExploreBackendService.testimonials`): a
`user` / `business` target is quoted in the seller's voice, everything else in the buyer's.

## Seed

`supabase/seeds/05_catalogue.sql` writes 37 listing reviews (21 services, 16 products) and
`06_projects.sql` the engagement reviews; the generator refuses a self-review, a review of one's own
team, and a comment under 100 characters.
