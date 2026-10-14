# catalogue: Functions

## The seller console's write doors — [`00001170_functions_catalogue.sql`](../../../supabase/migrations/00001170_functions_catalogue.sql)

A listing is **two rows that must agree**: the `catalogue.listings` row the console edits, and the
subject it points at — a `catalogue.products` row or a `marketplace.service_blueprints` row. The
subject is what the rest of the platform reads: checkout re-prices a product from
`products.price_cents` (`finance.place_wallet_order`), and booking and discovery read a service's
delivery terms from its blueprint. Written as separate PostgREST requests, a save that failed
halfway would leave the card and the charge disagreeing about the price. So each operation is **one
function, and therefore one transaction**.

The write doors are `SECURITY INVOKER` on purpose. The catalogue and marketplace policies
(`00002018`, `00002020`) already say who may write what, and running as the caller keeps them the
gate; a definer would have to restate them, and a restated rule can drift. Under RLS an UPDATE the
caller may not make does not raise, it matches nothing — so every subject UPDATE checks its row
count and raises rather than letting a save update the listing but not its product.

| Function                                                          | Security | Does                                                                                                                                                                                                                                                                                                                     |
| :---------------------------------------------------------------- | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_listing(p_kind, p_title, p_delivery_model?, p_team?, p_currency?, p_create_category?)` | INVOKER  | A new **draft** and its subject, unpriced and unpublished, in `p_currency` (default `USD`, upper-cased, `^[A-Z]{3}$`) and optionally a CREATE category. Returns `{ listing_id, slug }`; the subject's `svc-`/`prd-` slug (minted by `security.fn_slug_guard`) is the listing's console AND public address. A service needs a delivery model and a `org.freelancer_profiles` row — a buyer account has nothing to deliver it from. `p_team` requires active membership. |
| `save_listing(p_listing, p_patch jsonb)`                          | INVOKER  | Applies an editor patch and returns `{ listing_id, updated_at }`. Only keys **present** change (absent keeps, JSON `null` clears), so a partial autosave cannot wipe what it did not send. The whole patch is validated before anything is written. Mirrors title, description, category, price and terms onto the subject in the same transaction, and decodes the `offer` / `seo` envelopes onto the flat keys (below). The tag, skill and collection sets are replaced whole. The showcase has its own door; availability is a preset binding. |
| `set_listing_status(p_listing, p_status)`                         | INVOKER  | Moves a listing through `draft · published · paused · archived` (nothing is deleted). Publishing runs **the publish gate** — a title, a price, an **image in showcase slot 1** and, for a Pipeline, **at least one stage** — here as well as on the page, so a hand-built request cannot publish what the console would refuse. A service's `is_published` follows the listing. |
| `set_listings_status(p_listings uuid[], p_status)`                | INVOKER  | The console's batch action: `set_listing_status` per listing, each in its own sub-transaction, so one refused listing leaves the rest applied. At most 100 ids, de-duplicated in order. Returns `jsonb[]` of `{ listing_id, ok, code, detail, message }` (`code` = the row's SQLSTATE, e.g. `PG422` with the gate's `detail`). |
| `apply_listing_media(p_listing, p_slots jsonb)`                   | INVOKER  | Replaces the six-slot showcase. `p_slots` = ≤ 6 `{ position 1–6, file_id, kind, rendition_file_id?, poster_file_id?, alt_text? }`; `[]` clears it. Every file must pass `fn_listing_file_ok` for its kind (a poster is an image). Slot 1 must be an image (`23514`); two items in one position are `22023`. Mirrors slot 1's `rendition_file_id ?? file_id` onto a service's `service_blueprints.cover_file_id` (NULL without a slot 1). Returns `{ listing_id, slots, cover_file_id }`. |
| `duplicate_listing(p_listing)`                                    | INVOKER  | Copies the listing as a new **draft**: its subject (every column, through a row-to-json round trip), the showcase by file id, skills, tags and the seller's own collections, under a freshly minted `svc-`/`prd-` slug and a "(copy)" title, unpublished, unpromoted and with zeroed derived counters. A service bound to a `service`-scoped preset (forked for the original) falls back to the schedule default; a `library` binding is kept. Returns `{ listing_id, slug }`. |
| `fn_listing_file_ok(p_file, p_team, p_mime_prefix?)`              | INVOKER  | May the caller put this file on a listing? Live, `status = 'uploaded'` (never quarantined), of the given MIME family, and the caller's own — or the listing team's while they are an active member. |
| `fn_form_archetype(kind, delivery_model)`, `fn_stage_shape_ok(jsonb)`, `fn_team_role_shape_ok(jsonb)` | INVOKER, IMMUTABLE | Pure helpers: the form archetype (`formArchetypeOf`, Decision #217(a)) and the element checks `save_listing` applies to `stage_template` and `team_roles`. |
| `get_listing_sales(p_listing_ids uuid[], p_since timestamptz?)`   | DEFINER  | Per listing, per currency, per week: completed (`confirmed` / `invoiced`) order lines and their gross. A definer because the order lines are the BUYERS' rows, which the seller's policies cannot read — and it answers only for listings the caller owns or whose owning team they actively belong to, so it discloses nothing about any other seller. `p_since` NULL is all time. |
| `get_listing_rollups(p_listing_ids uuid[], p_from date, p_to date)` | INVOKER  | `TABLE(day, metric, subject_id, dimensions, value, sample_count)`: the `subject_kind = 'listing'` rows of `analytics.daily_rollups` for those listings over `[p_from, p_to]` (nothing when the range exceeds 800 days), ordered for paging. The Analytics view and tab read the rollups through it because `analytics` is not a PostgREST-exposed schema; INVOKER, so the table's own policy (`fn_subject_visible('listing')`: the owner, or a `publish_listings` holder on the owning team) still decides each row. |

Recognised `save_listing` keys (Decision #217):

- **Listing:** `title` · `category` · `description_html` · `description_text` · `delivery_label` ·
  `amount_cents` · `ticket_price_cents` · `session_price_cents` · `seats_per_session` ·
  `free_revisions` · `extra_revision_price_cents` · `seo_title` · `seo_description` (blank → NULL) ·
  `create_category` · `currency` (an ISO-4217 code, upper-cased, mirrored onto the subject; changeable
  only while `published_at` is NULL, i.e. the listing has never been live — after that a different
  code is `22023` DETAIL `currency`. The service sends it with the prices it re-states, in its minor
  units).
- **Service** (refused on a product, `22023` DETAIL `kind`): `delivery_model` (only while the listing
  is a **draft** — a live listing is archived and recreated instead) · `intake` (a list; once
  `published_at` is set — even back in draft — the questions' ids, order and kinds must match the
  stored `intake_fields`, else `22023` DETAIL `intake`; wording and options may change,
  `ServiceCreation.md` §1.1) · `stage_template`
  (≤ 12; each element a name of 1–80, ≤ 12 deliverables, `startTrigger` ∈ `on_project_start` ·
  `after_previous` · `fixed_offset`, `lagDays` an integer 0–90, `chainReaction` boolean) ·
  `team_roles` (≤ 12, a name and a headcount of 1–20) · `deliverables` (≤ 24 lines of ≤ 140) ·
  `turnaround_days` · `session_minutes` · `session_count` · `meeting_provider` ·
  `max_seats_per_cohort` · `allow_continuous_enrollment`.
- **Product** (refused on a service): `format` · `licence` · `attribution_required` · `file_manifest`.
- **Children:** `skills` (`org.skills` labels; an unknown label is dropped, not invented) · `tags`
  (at most 10) · `collections` (names).
- **Envelopes:** `offer` — a `ListingOfferSchema` value (camelCase, discriminated by `archetype`),
  decoded per archetype onto the keys above (`milestones`/`stages` → `stage_template`, `scope` →
  `deliverables`, `turnaroundDays`, `teamRoles`, `minutes`/`count`/`meetingProvider`,
  `maxSeatsPerCohort`/`continuousEnrollment`, `format`/`licence`/`attributionRequired`/
  `attachments` → `file_manifest`). The archetype must be the listing's (`22023` DETAIL
  `offer.archetype`), except that a session ↔ cohort offer is the solo/cohort toggle and sets
  `delivery_model`. `seo` — `{ seoTitle, seoDescription, createCategory, tags }`.
- **Guard:** `expected_updated_at` — the `updated_at` the editor loaded, compared to the millisecond.
  A mismatch is `PC409` with `DETAIL` `stale:<current updated_at>`.

The retired `media` and `availability` keys are no longer read.

**Refusal codes** (the thin route maps each to an HTTP status):

| SQLSTATE | Meaning                                                                                      | HTTP |
| :------- | :------------------------------------------------------------------------------------------- | :--- |
| `42501`  | Not signed in; not the seller who created the listing; not a freelancer (services); not a member of the team; the subject could not be updated with the listing; a showcase or attachment file that is not the caller's (or not of its kind). | 403  |
| `22023`  | A malformed request — a blank title, an unknown kind, status, delivery model or currency, a malformed stage / role / scope / manifest / showcase, an offer for the wrong archetype, product keys on a service (or the reverse), a delivery-model change on a live listing, a currency change or a question id / order / kind change on a listing that has been published, a batch of more than 100. `DETAIL` names the key (`stage_template.2`, `slots.0`, …). | 422  |
| `PB404`  | No such listing (or one RLS hides from the caller).                                          | 404  |
| `PC409`  | `save_listing`'s `expected_updated_at` is stale; `DETAIL` `stale:<current updated_at>`.     | 409  |
| `PG422`  | The publish gate. `DETAIL` lists what is missing, separated by `\|` (`a price\|a cover image\|at least one stage`), which the console names back to the seller. Also the 11th tag (`DETAIL` `tags_max`). | 422  |
| `23514`  | A video in showcase slot 1, or a position outside 1–6.                                        | 422  |
| `PM403`  | The seller is under 18. Raised by `catalogue.trg_listings_publish_age_gate` (BEFORE INSERT / UPDATE OF `status` on `catalogue.listings`) on any move to `published`, so no write path publishes past it (Decision #190). | 403  |

**Grants** ([`00002510_permissions_function_grants.sql`](../../../supabase/migrations/00002510_permissions_function_grants.sql)):
every door above and `fn_listing_file_ok` are `REVOKE`d from `public` and `anon` and
`EXECUTE`-granted to `authenticated` and `service_role` only.

**Known limit, by design of the policies:** a team-owned listing is VISIBLE to every active member of
the team but editable only by the member who created it (`owner_user_id = auth.uid()` in both
functions and in the UPDATE policy). Letting any member edit needs a team-permission rule, which is
a product decision.

## Maintained by triggers elsewhere

| Trigger                                                          | Function                                 | Does                                                                                  |
| :--------------------------------------------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------ |
| `trg_products_slug` / `trg_articles_slug` (`00001890`)           | `security.fn_slug_guard('prd' \| 'art')` | Mints the permanent public address on insert; refuses any change to it.              |
| `trg_products_derived` / `trg_listings_derived` (`00001895`)     | `security.fn_guard_derived_columns(...)` | Refuses client writes to ratings and console counters.                               |
| `trg_update_ratings` (`00001800`, on `reviews.entity_reviews`)   | `reviews.recalculate_entity_rating()`    | Recomputes `catalogue.products.rating_*` when a `product` review changes.            |
| `trg_listing_tags_max` (`00001800`, BEFORE INSERT on `listing_tags`) | `catalogue.trg_listing_tags_max()` (DEFINER) | Locks the listing and refuses an 11th tag (`PG422` `tags_max`); it sees rows its own statement already inserted. |
| `trg_listing_tags_touch` (`00001800`, AFTER INSERT/UPDATE/DELETE on `listing_tags`) | `search.fn_listing_tags_touch()` | Re-syncs the listing's `services_index` / `catalogue_index` row (tags + fts). See [../search/Functions.md](../search/Functions.md). |

See [../security/Functions.md](../security/Functions.md) and
[../reviews/Functions.md](../reviews/Functions.md).

## The client pipeline — [`00001170_functions_catalogue.sql`](../../../supabase/migrations/00001170_functions_catalogue.sql) (Decision #217, C5)

One read of everyone buying, asking about or booking the caller's listings: one row per engagement,
each carrying its **source table's own status**. The pipeline's lanes
(`inquiries · active ·
action_required · closed`) are derived in TypeScript by `laneOf`
(`packages/types/catalogue/clients.ts`), never stored or returned, so the read invents no statuses
(root CLAUDE.md §5). Zod: `ClientEngagementRowSchema`, pinned column for column by
`client-pipeline.contract.test.ts`.

| Function                                                  | Security | Does                                                                                                                                                                                                                                                                                                |
| :-------------------------------------------------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_client_pipeline(p_listing uuid?, p_limit int = 200)` | INVOKER  | `TABLE(engagement_kind, engagement_id, listing_id, buyer_user_id, buyer_handle, status, opened_at, last_activity_at, amount_minor, currency, next_event_at, action_reasons text[], href)`, newest activity first, `p_limit` clamped to 1–500. `p_listing` NULL is every listing the caller manages. |
| `fn_manages_listing(p_listing uuid)`                      | DEFINER  | True when the caller may manage the listing: its owner when personal, a holder of `publish_listings` on the owning team when a team's (`org.fn_member_can`, the permission twin). Also the `listing` arm of `analytics.fn_subject_visible`.                                                         |
| `fn_candidate_listings(p_listing uuid?)`                  | DEFINER  | The caller's personal listings by owner and their active teams' listings by membership, both by index, so neither reader scans the catalogue; `fn_manages_listing` then decides each.                                                                                                               |
| `fn_seller_order_lines(p_listing uuid?)`                  | DEFINER  | The order lines that bought the caller's managed listings, narrowed to the buyer, the order's status, `placed_at` / `updated_at`, the line's total, currency and `scheduled_at`. Never the payment method, card, promo, totals or other sellers' lines.                                             |

**Arms** (the pipeline is INVOKER, so each answers under the caller's own policies):

| `engagement_kind`  | Source                                                             | `status` (verbatim)                         | `action_reasons`                                                                                     | `href`                                                     |
| :----------------- | :----------------------------------------------------------------- | :------------------------------------------ | :--------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- |
| `inquiry`          | `comms.dm_threads` `service_inquiry` with `subject_listing_id`     | the seller's `dm_participants.inbox_folder` | `inquiry_unanswered` — the last message is not the seller's                                          | `/messages/<thread id>`                                    |
| `quote`            | `marketplace.quote_requests` on the listing's blueprint            | `sent · answered · withdrawn`               | `inquiry_unanswered` while `sent`                                                                    | `/messages/dm-<buyer handle>`                              |
| `discovery_call`   | `scheduling.discovery_calls.service_blueprint_id`                  | `scheduling.call_status`                    | `inquiry_unanswered` while `proposed`; `reschedule_open`                                             | `/calendar?event=<event id>`, else the DM                  |
| `order`            | `fn_seller_order_lines` (non-session lines)                        | `finance.order_status`                      | —                                                                                                    | `/messages/dm-<buyer handle>`                              |
| `session_booking`  | `projects.cohort_memberships` on the listing's session engagements | `active · cancelled · completed`            | `handshake_pending` (round 0 collecting); `reschedule_open`; `dispute_open`                          | `/calendar?event=<next sitting's event>`, else the project |
| `pipeline_project` | `projects.projects.source_blueprint_id`, `session_kind = 'none'`   | `project_status`                            | `revision_requested`; `reschedule_open`; `dispute_open`; `submission_pending` (a drafted submission) | `/projects/<prj- slug>`                                    |

`reschedule_open` is an open round (`collecting · awaiting_counterparty · voting`) the seller did
not open; `dispute_open` a dispute in `open · awaiting_response · under_review` on the engagement's
escrow. `amount_minor` is the line total (order, session), the quote's budget, the call's fee or the
project's budget. `next_event_at` is the next scheduled sitting, the pending call or the project's
next calendar event.

**Why the order arm is a definer.** `finance.orders` / `order_lines` are the buyer's rows
(`View own orders`), so an INVOKER read would show a seller none of their sales. Ruled 2026-10-14: a
narrow definer projection (like `get_listing_sales` above), not a seller policy on the buyer's whole
order row.

**What RLS leaves out, by design.** A buyer's instantiated pipeline project is visible only once the
seller is engaged on it (a participant row or a live stage assignment, `has_project_access`); a
quote request only to its host. The buyer, though a party to every one of these rows, gets no
pipeline for the seller's listings: every arm starts from `fn_manages_listing`.

**Grants** (`00002510`, region "Listing analytics and the client pipeline"): all four are `REVOKE`d
from `public` and `anon` and granted to `authenticated` and `service_role`.

**Indexes** (`00004012_indexes_catalogue_marketplace.sql`, and the C5 regions of `00004003` /
`00004005` / `00004007`): listings by owner and owning team, quote requests by blueprint, order
lines by item, open reschedule rounds, a sitting's calendar mirror, open revision requests. Checked
with `EXPLAIN` under `enable_seqscan = off` on the seeded database: no arm keeps a sequential scan.

Probe: [`supabase/probes/listing_analytics.sql`](../../../supabase/probes/listing_analytics.sql) §5
— one row per arm for the seller, none for the buyer or a stranger.
