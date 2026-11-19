# marketplace: Tables

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Tables content has been written for the `marketplace` schema
yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `marketplace.service_blueprints` — the public address

Documented ahead of the rest of the table because it is a routing contract shared with three other
schemas, not a detail of this one.

| Column | Type        | Notes                                                                |
| :----- | :---------- | :------------------------------------------------------------------- |
| `slug` | text UNIQUE | **The public address.** `svc-` + 10 symbols. Minted once, immutable. |

`NOT NULL` with no `DEFAULT`: `security.fn_slug_guard` (`00001890_triggers_slugs.sql`) fills it
before the `NOT NULL` is checked and refuses any UPDATE that would move it. The shape is
`^svc-[23456789abcdefghjkmnopqrstuvwxyz]{10}$` (`ck_service_blueprints_slug_shape`) — the same
alphabet and the same cross-checked contract as `projects.projects.slug`; see
[../projects/Tables.md](../projects/Tables.md) for the full reasoning.

It matters more here than anywhere else that the address is title-independent. A seller renames a
listing to reposition it — ordinary catalogue work, not a republication — and under a title-derived
address every card, share link and search result pointing at it would die on the edit, silently, at
exactly the moment the seller was trying to sell more of it.

## `marketplace.service_blueprints.intake_fields` — the seller's questions

| Column          | Type  | Notes                                                                                     |
| :-------------- | :---- | :---------------------------------------------------------------------------------------- |
| `intake_fields` | jsonb | NOT NULL `DEFAULT '[]'`. An ORDERED array of `IntakeField` documents. `CHECK` array, ≤ 12. |

The questions a buyer answers in the Service Detail modal on the way to purchase (Decision #108).
The element shape is owned by the Zod SSOT — `IntakeFieldSchema` in
`packages/types/services/intake.ts`: nine kinds (text · textarea · number, optionally with a slider ·
boolean · select · multiselect · radio · pills · checkboxes), each with an `id`, a `label`, a
`required` flag and kind-specific bounds/options — and it is validated by every fat service that
writes or reads it. The database refuses only what no reader could interpret at all: a non-array,
or more than `INTAKE_FIELDS_MAX` (12) elements (`ck_service_blueprints_intake_shape`).

A jsonb document rather than a child table for the same reason `session_template_rules` is one: the
seller authors the list as one unit, every reader takes it whole, and nothing queries across
listings by field. **Answers never live here.** They travel keyed by field id on the purchase
(`finance.basket_items.metadata` under `answers`) or on the invitation
(`projects.project_invitations.answers`), and the buyer-side services re-run `intakeRefusal`
against the list on the way in, so the modal's gate and the server's cannot drift.

The seller-side EDITOR for this column is the catalogue console (`ListingDetail.intake` /
`UpdateListingInput.intake`); see [`../../flows/ServiceCreation.md`](../../flows/ServiceCreation.md)
for what that surface must write.

## `marketplace.service_blueprints` — what the listing page shows

The listing page (`/view/svc-…`) and every discovery card read these columns live
(`packages/backend/services/explore/live-catalog.ts` + `live-view.ts`). Each is seller-declared; an
empty value means the seller has not stated it, and the page omits that part rather than inventing
it.

**No contact or payment details in service copy (Decision #147).** Every seller-authored text on a
blueprint — `title`, `description`, the `stage_template` and `team_roles` entries, `deliverables`,
`intake_fields` labels — is public copy and permanently outside the Projective Unlock
(`PRODUCT_SPEC.md` §Messaging 1.B): no email, phone, messaging or off-platform payment link,
`$cashtag`, or bank/card detail. Checked at create/update time by the catalogue write service and
refused field-named, never masked; no CHECK or trigger enforces it. **Not yet enforced.**

| Column            | Type             | Notes                                                                                                   |
| :---------------- | :--------------- | :------------------------------------------------------------------------------------------------------ |
| `stage_template`  | jsonb            | NOT NULL `DEFAULT '[]'`. An ordered array of `BlueprintStage` (`@projective/types/explore` `stored.ts`: name, description, deliverables, turnaround, `priceCents`, skills, when the stage starts — `startTrigger` `on_project_start` · `after_previous` (default) · `fixed_offset`, `lagDays` 0–90, `chainReaction` (default true) — and its intensity terms: `intensity` `low` · `standard` (default) · `high`, and the optional whole, non-negative `lowPriceCents` / `highPriceCents` read only under `allow_tiered_intensity`). The stages a Pipeline or One-Off is delivered through — the showcase the view renders and what "Add to projects" instantiates. `ck_service_blueprints_stage_template_shape`: array, ≤ 12; `catalogue.save_listing` checks each element's shape on the way in, and on a tiered listing that a stage's own Low price is not above its price nor its High price below it (Decision #417). |
| `allow_tiered_intensity` | boolean   | NOT NULL `DEFAULT false` (Decision #417). How the stage template sells. `false` — the default for a productised service — sells each stage at ONE intensity and price (`intensity`, `priceCents`): "Add to projects" copies its stages **locked** (`project_stages.intensity_locked`), so every ticket in them runs at that intensity and costs that price. `true` lets the client pick Low · Standard · High per ticket, priced at the stage's own `lowPriceCents` / `highPriceCents` where set, else at the platform's tier multiple of its price (`PRODUCT_SPEC.md` §The Weighting Engine); the instantiated stages are unlocked and carry those own prices as `low_price_cents` / `high_price_cents`. Read by the Pipeline offer only (`PipelineOffer.allowTieredIntensity`). |
| `team_roles`      | jsonb            | NOT NULL `DEFAULT '[]'`. A Direct Deliverable's named roles (`BlueprintTeamRole`: name, summary, skills, count). Array, ≤ 12. |
| `deliverables`    | text[]           | NOT NULL `DEFAULT '{}'`. The flat "what you get" list for a Direct Deliverable, a Session or a stage-less listing. |
| `session_minutes` | integer, 5–600   | A Session's fixed sitting length. NULL on every non-session model, and NULL on a session whose seller has not stated one — the booking layer then says so instead of assuming an hour. |
| `session_count`   | integer, 1–52    | For a set-session block, how many sittings one purchase commits to.                                     |
| `session_plan`    | jsonb            | NOT NULL `DEFAULT '[]'`. What each sitting of a fixed-count Session or Group Session covers: an ordered array of `{ title, description }` (`BlueprintSessionPlanEntrySchema`, `@projective/types/explore` `stored.ts`; title ≤ 80, description ≤ 600, either may be blank) read **by position** — entry 0 is session 1 — so a blank entry keeps the numbers after it. Readers take at most `session_count` entries. `ck_service_blueprints_session_plan_shape`: array, ≤ 52; `catalogue.save_listing` checks each element. Shown on `/view` as the sitting track, named in the booking modal, and used to title each booked sitting (Decision #411). |
| `session_rolling` | boolean          | NOT NULL `DEFAULT false`. A 1-on-1 Session sold as an **ongoing** relationship: every booking is one session and the buyer books again whenever they need another. `ck_service_blueprints_rolling_session`: a rolling row has `session_count` 1 (or NULL) and an empty `session_plan` (Decision #411). |
| `turnaround_days` | smallint, 1–90   | A One-Off's delivery time in days (Decision #217). NULL until the seller states it.                    |
| `meeting_provider` | text             | The room provider a Session or Group Session books into: `google` · `outlook` · `zoom` · `microsoft_teams` · `discord` · `custom` (the `scheduling.events` set). NULL defers to the seller's connected default (`scheduling.fn_conferencing_provider`). |
| `availability_preset_id` | uuid      | The scheduling preset a Session books against (Decision #217(c)); NULL means the owner schedule's default. Replaces the retired `catalogue.listing_availability`. Its FK (→ `scheduling.availability_presets`, SET NULL) is in `00000031`, because the presets table is created after this file. |
| `cover_file_id`   | uuid → `files.items` | The card hero. For a catalogue listing it mirrors showcase slot 1 (rendition, else original), written by `catalogue.apply_listing_media`. |
| `rating_average` / `rating_count` | numeric / integer | **Derived** from the visible `reviews.entity_reviews` that carry the listing in `service_blueprint_id` — its provider's reviews bought through it (`reviews.recalculate_entity_rating`, Decision #487). A client write is refused by `trg_service_blueprints_derived` (`security.fn_guard_derived_columns`). |

## `marketplace.promoted_placements` — the promoted-placement ledger

One row per promotion: `sponsor_user_id`, the promoted `entity_type`
(`service` · `product` · `freelancer` · `team` · `project`) and `entity_id`, the `surface`
(`explore_home` · `explore_results` · `view_rail`), the flight window `starts_at` → `ends_at`
(`ends_at > starts_at`), an optional `cancelled_at` inside the window, and `spend_cents` + `currency`.
Zod: `PromotedPlacementRowSchema` (`@projective/types/catalogue`).

**Organic ranking is never for sale (Decision #454).** A live placement
(`cancelled_at IS NULL AND starts_at <= now() < ends_at`) buys a separately labelled "Promoted" slot
at a fixed position, never a place in the ranked order, and never a mark on the listing's organic
card. Its only writers are the `marketplace.promote_listing` / `stop_listing_promotion` doors
([Functions.md](Functions.md)): a seller whose plan holds `promoted_placement` runs **one** live
placement at a time, a 7-day flight from now on `explore_home` or `explore_results` for a published
service or product, `spend_cents` 0 (allocated by the plan while plans cannot be bought, PRD-F14). A
stop sets `cancelled_at`; a row is never deleted. `catalogue.listings.promoted` is kept in step by the
doors as a console hint, and every reader answers from this ledger's window instead. The seed writes
one 7-day flight per sponsored corpus listing, at most one per seller (Atelier Nova's service on
`explore_home`, Maris Delacroix's product on `explore_results`).

`surface` is read by the discovery load (`live-catalog.ts`, oldest `starts_at` first) and placed by
`promoted-slots.ts`: one slot per services / products rail, rotating hourly among live flights, at
the head of the Home rail (`explore_home`), or of a grouped results rail or before an isolated
services / products results feed (`explore_results`) — drawn only from listings that already match
the search, on the first page, and never for a 13–17 viewer. `view_rail` is not sold or rendered.

## `marketplace.quote_requests` — "Request a custom quote"

A buyer (`requester_user_id`) describes a `scope` against a published blueprint (`blueprint_id`) and
its seller (`host_user_id`), with an optional soft budget (`budget_cents` requires `currency`) and a
free-text `timeline`. Nothing is reserved, charged or escrowed. The parties and the blueprint cannot
change once written (`trg_quote_requests_parties`, `security.fn_guard_immutable_columns`).

| Column           | Type          | Notes                                                                                          |
| :--------------- | :------------ | :--------------------------------------------------------------------------------------------- |
| `status`         | `text`        | `sent` · `answered` · `accepted` · `declined` · `withdrawn` (Decision #458; PRODUCT_MANAGEMENT §3.5). |
| `answered_at`    | `timestamptz` | Set by the first offer. Required while `answered` or `accepted`.                              |
| `closed_at`      | `timestamptz` | Set exactly when `accepted`, `declined` or `withdrawn` (`quote_requests_closed_at_check`).      |
| `decline_reason` | `text`        | The host's reason, at most 280 characters, only on a `declined` row.                           |
| `answers`        | `jsonb`       | The buyer's answers to the listing's own questions, keyed by question id (an object, `quote_requests_answers_check`); `{}` when none. Decision #522. |
| `origin`         | `text`        | `buyer` (`request_quote`) or `host` (a seller's own quote from a conversation, `issue_quote`, born `answered`). Decision #522. |

One open (`sent` / `answered`) request per buyer per blueprint: `uq_quote_requests_open` (00004012),
which `marketplace.request_quote` refuses ahead of as `already_open`. Indexed by blueprint for the
pipeline's quote arm and by requester for the pair read.

## `marketplace.quote_offers` — the host's priced answer (Decision #458)

One row per offer sent on a request; a revision is a new row, so history stays.

| Column             | Type          | Notes                                                                                    |
| :----------------- | :------------ | :--------------------------------------------------------------------------------------- |
| `id`               | `uuid` PK     |                                                                                          |
| `quote_request_id` | `uuid` FK     | `marketplace.quote_requests(id)`, `ON DELETE CASCADE`.                                   |
| `author_user_id`   | `uuid` FK     | The request's host when they priced it; `org.users_public`.                              |
| `scope`            | `text`        | 1–4000 characters; the engagement's brief once paid for.                                 |
| `deliverables`     | `text[]`      | A checklist inside one escrow, at most 12 items of 160 characters (the stage writer's bounds). |
| `price_cents`      | `bigint`      | `> 0`, in `currency`.                                                                    |
| `currency`         | `text`        | The blueprint's own currency, set by the door, never by the caller.                     |
| `turnaround_days`  | `smallint`    | 1–90, the blueprint's own range; the paid engagement's due date is payment + this.       |
| `expires_at`       | `timestamptz` | 3–30 days after `created_at` (`quote_offers_expiry_window_check`).                       |
| `terms_hash`       | `text`        | Hex SHA-256 of the offer's canonical terms (`fn_quote_terms`), stamped from the row on insert (`trg_quote_offers_stamp`); never written by a caller. Decision #522. |
| `status`           | `text`        | `pending` · `accepted` · `declined` · `withdrawn`. `expired` is derived: `pending` past `expires_at`. |
| `superseded_by`    | `uuid` FK     | Self-reference to the offer that replaced it; only on a `withdrawn` row; `ON DELETE SET NULL`. |
| `decided_at`       | `timestamptz` | Set exactly when it leaves `pending`.                                                    |

At most one `pending` and one `accepted` offer per request (`uq_quote_offers_one_pending`,
`uq_quote_offers_one_accepted`, 00004012). An accepted offer's basket line carries its id in
`finance.basket_items.metadata ->> 'quoteOfferId'` (and its `quoteTermsHash`), and
`uq_basket_items_live_quote_offer` (00004005) allows one live line per offer across every basket. The
paid line is `finance.order_lines.quote_offer_id` (one per offer, `uq_order_lines_quote_offer`).

**Frozen (Decision #522).** `trg_quote_offers_kept` (`fn_quote_record_kept`) refuses any UPDATE that
changes a column other than `status`, `superseded_by`, `decided_at` and `updated_at` (`terms_frozen`),
for every role including the owner: a revision is a new row with its own hash. A direct DELETE of an
offer or a request is refused (`record_kept`); the cascade of an erased account still passes.

## `marketplace.quote_events` — the quote record (Decision #522)

Append-only: one row per move on a request, written only by the doors in 00001177 and by
`finance.place_wallet_order` (the `paid` move). Never updated, never deleted directly
(`trg_quote_events_kept`). Each row also has a quote card in the pair's conversation
(`comms.dm_messages.quote_event_id`).

| Column             | Type          | Notes                                                                                     |
| :----------------- | :------------ | :---------------------------------------------------------------------------------------- |
| `id`               | `uuid` PK     |                                                                                           |
| `quote_request_id` | `uuid` FK     | `marketplace.quote_requests(id)`, `ON DELETE CASCADE`.                                    |
| `quote_offer_id`   | `uuid` FK     | The offer the move concerned; `NULL` for a request-only move (asked, declined, withdrawn). |
| `actor_user_id`    | `uuid` FK     | Who moved (the door's `auth.uid()`).                                                       |
| `kind`             | `text`        | `requested` · `issued` · `offer_sent` · `offer_revised` · `offer_withdrawn` · `request_declined` · `offer_accepted` · `offer_declined` · `request_withdrawn` · `paid`. |
| `terms`            | `jsonb`       | The offer's canonical terms as they stood at the move (`fn_quote_terms`); with `terms_hash`, both or neither. |
| `terms_hash`       | `text`        | Hex SHA-256 of `terms`; on `offer_accepted` it is the hash the buyer accepted.            |
| `detail`           | `jsonb`       | `{reason}` on a decline; `{order_line_id, project_id, escrow_id}` on `paid`.               |
| `created_at`       | `timestamptz` |                                                                                           |

Indexed by request (newest first) and by offer (00004012).
