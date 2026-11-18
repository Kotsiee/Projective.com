# marketplace: Functions

**`EXECUTE` is deny by default (Decision #477).** The first region of `00002510` revokes it from
`PUBLIC`, `anon` and `authenticated` on every function here and `00002500` closes the default for
functions created later, so a client role holds only what `00002510` grants by name. `anon` may
execute none of them. The full allowlist, one reason per line, is in
`supabase/probes/function_grants.sql`.

## Service instantiation — [`00001175_functions_marketplace_instantiate.sql`](../../../supabase/migrations/00001175_functions_marketplace_instantiate.sql)

"Add to Projects" on a Pipeline listing (Decision #209). A pipeline is not bought; it is staffed and
then bought against, one ticket at a time (`PRODUCT_SPEC.md` §Creation & Purchasing Gate). So pressing
it copies the seller's blueprint into the buyer's own workspace as a **draft** they can open, read
and fund ticket by ticket. **No money moves, nothing is reserved, and no seat is minted.** A seat
only ever comes from an accepted invitation or application (`PRODUCT_MANAGEMENT.md` §Stage
assignment), so the seller is hired into the draft through the ordinary hire path.

Three doors, all `SECURITY DEFINER`, all signed-in only, and all answering with one projection
(`fn_service_draft_json`). The write, the listing CTA's read and the archive therefore cannot
describe a draft three different ways.

| Function | Security | Does |
| :-- | :-- | :-- |
| `instantiate_service_blueprint(p_blueprint_id uuid, p_intake jsonb, p_currency text, p_idempotency_key text, p_title text)` | DEFINER | In **one transaction** it writes: the project (**owned by the listing's seller** — `freelancer_profile_id`, filed under the listing's `owner_team_id` — with the caller recorded as its client, `client_user_id = auth.uid()`, Decision #427; `format = 'pipeline'`, `status = 'draft'`, `visibility = 'unlisted'`, `source_blueprint_id`, the listing's brief and currency); one stage per `stage_template` entry with the seller's seat and the stage's room (`fn_write_blueprint_stages`, below); **no ticket** — the client creates them (Decision #409, amending #209); the project-wide Discussion room; and the `projects.service_instantiations` request row, its answers reduced by `fn_intake_answers`. A ticket the client creates on a stage defaults to its price. A listing whose seller is a minor is refused as unavailable (`P0002`): the seller owns the engagement now, and a minor's project is forced personal. Returns the projection plus `created`. |
| `get_service_draft(p_blueprint_id uuid)` | DEFINER | The **live** draft the caller bought from a listing (`client_user_id = auth.uid()`, no paying business or enterprise — Decision #427), `draft` or `active`, newest first. It returns NULL when there is none. This is what flips the listing's primary control to "Open project →". It uses the same predicate the write dedupes on. |
| `archive_service_draft(p_project_slug text, p_reason text)` | DEFINER | "Remove draft". The instantiated project the caller bought (`client_user_id`, Decision #427) is soft-archived through `projects.set_project_status` (status history and activity written). It is **refused once any stage holds an escrow row**, the sweep's own evidence that money moved. The check and the archive happen in one transaction, after locking the project and its stage rows. Archiving an archived draft returns it unchanged. |
| `fn_service_draft_json(p_project_id uuid)` | DEFINER (internal) | The shared projection: `project_id, slug, title, status, source_blueprint_slug, stage_count, ticket_count, funded_stage_count, currency, created_at, last_activity_at`. `funded_stage_count` counts stages with any escrow row, as `projects.fn_archive_stale_service_drafts` does. No client role may execute it. |
| `fn_plain_text_html(p_text text)` | IMMUTABLE (internal) | The SQL twin of `plainTextToHtml`: it escapes `& < > "`, turns blank lines into paragraphs and keeps single newlines as `<br>`. |
| `fn_blueprint_stage_terms(p_bp marketplace.service_blueprints)` | STABLE SQL (internal) | The stages a blueprint instantiates into, in order: `ord`, the template entry (`stage`), and the terms each stage row is written with, plus `price` — what one ticket running the stage at its own intensity is held at there, from `projects.fn_ticket_stage_price` applied to exactly those terms (Decision #457). For a Pipeline or One-Off it gives one row per `stage_template` entry: `unit_price_cents` is the stage's **standard** price, else (a Pipeline only) the listing's `ticket_price_cents`, else NULL ("priced on scope", as `/view` shows it, never a guessed zero, so `price` is NULL too). The **intensity terms** (Decision #417) are `intensity` = the template's (`standard` for a missing or unknown value), `intensity_locked` = NOT `allow_tiered_intensity` for a Pipeline and always true for a One-Off (its milestones take no intensity control, #417 (b), so each sells at the price the configure dialog totals), and, on a tiered Pipeline only, `low_price_cents` / `high_price_cents` = the stage's own `lowPriceCents` / `highPriceCents`. A **Direct Deliverable** (a Task) is one locked `standard` row at the listing's `price_cents`, named and described by its first template entry when there is one. |
| `fn_write_blueprint_stages(p_project_id uuid, p_bp marketplace.service_blueprints, p_terms jsonb)` | INVOKER (internal) | Writes the stages of `p_terms`, else of `fn_blueprint_stage_terms(p_bp)`, into a new engagement and returns their ids in order. `p_terms` is a JSON array of rows in that shape, the seam another terms source writes through. Per stage: the row (its name, else `Stage N` or a Task's `Delivery`; its brief as HTML via `fn_plain_text_html`, a Task's falling back to the listing's; its deliverables as a default checklist and milestone line; its skills as `org.skills` slugs where a label matches; `status = 'assigned'`; its price and intensity terms, which `trg_stage_intensity_terms` freezes; its **CREATE category**, the listing's `catalogue.listings.create_category` (the blueprint has none of its own; were two listings ever to publish one blueprint, the published one, then the newest), copied whatever priced the stages, so every caller gets it, as a label of the work and never a weight on $W_i$ (#338 P4; #417 (c), SC2); NULL stays NULL); its **start trigger** (below); the seller's `accepted` seat (a freelancer seat, or the team's for a team listing), so the seller claims a funded ticket with no hire step — inserted directly rather than through the hire door, whose overlapping-stage refusal does not apply to a service sold to many buyers at once (Decision #427); and the stage's room. Revision terms arrive through `trg_stage_revision_terms`, which reads `source_blueprint_id`. **Start triggers** (Decision #217), mapped as `stageTriggerToDb` maps them: the first stage, and any stage whose `startTrigger` is `on_project_start`, gets `start_trigger_type = on_project_start` with no dependency; `after_previous` (the default, also for a missing or unknown value) and `fixed_offset` get `dependent_on_stage` with `start_dependency_stage_id` = the previous stage and `start_dependency_lag_days` = `lagDays` (clamped 0–90) for `fixed_offset`, else 0; `chain_reaction` = `chainReaction` (default true). No terms is refused `22023`. |
| `fn_intake_answers(p_fields jsonb, p_intake jsonb)` | IMMUTABLE (internal) | The buyer's answers reduced to the listing's own `intake_fields` ids. A non-object or an answer set over 32 KB is refused `22023`. |
| `fn_scoped_service_price(p_blueprint_id uuid, p_whole boolean)` | STABLE SQL (internal) | What checkout charges for a One-Off or a Task: the first milestone's `price`, or every milestone's when `p_whole` (the buyer's whole-project prepay); a Task's one stage either way. NULL for any other delivery model or when a charged milestone has no price. |
| `fn_buy_scoped_service(p_blueprint_id uuid, p_brief text, p_answers jsonb, p_target_date date, p_whole boolean, p_idempotency_key text, p_terms jsonb)` | DEFINER (internal) | A One-Off or Task paid at checkout becomes a funded engagement (below); with `p_terms` (a quote offer's, Decision #491), any listing the seller sells. |

### A One-Off or Task bought at checkout (Decision #457)

A One-Off or a Task is scoped in the configure dialog and **paid at checkout**, so the payment
creates it already funded. `finance.place_wallet_order` calls `fn_buy_scoped_service` for a
`one_off_service` / `single_service_task` line, as the buyer and inside the order's own transaction,
after checking the line's price against `fn_scoped_service_price`. A refusal rolls the whole order
back: no engagement outlives a failed payment, and no payment outlives a failed engagement. In one
transaction it writes:

1. **The project.** Owned by the listing's seller (filed under `owner_team_id` for a team listing),
   with the buyer as `client_user_id` (Decision #427). `format = 'one_off'` with
   `structure_variation` `one_off` (milestones) or `single_task` (a Direct Deliverable),
   `budget_amount_cents` = every stage's price, `source_blueprint_id`, and `allow_deadline_bonuses`
   on only when the buyer chose a target date. A due date needs those terms
   (`fn_enforce_ticket_due_date`), and the bonus itself stays 0 (`ck_escrows_bonus_unfunded`).
2. **Its stages, seats and rooms** (`fn_write_blueprint_stages`), then the Discussion room.
3. **The one master ticket** (`fn_enforce_structure_variation`), authored by the buyer. It is titled
   as the listing and takes the brief as its description. It runs every stage in order at that
   stage's own intensity (#417 (b): a One-Off's milestones take no intensity control), and the
   target date is the final stage's `due_at`. It is created in New and unclaimed.
4. **The `projects.service_instantiations` row.**
5. **`projects.fund_ticket` as the buyer.** The first stage is held, which places the ticket there
   prepaid; the seller binds it by claiming. Under the whole-project prepay every later stage is
   `reserved` and held on arrival (Decision #430). Otherwise each later stage locks when the
   previous one is approved (the Chain Reaction) or waits as Needs funding. Then
   `projects.set_project_status` moves it `draft → active`.

It returns `project_id, project_slug, ticket_id, stage_ids, escrow_id` (the held escrow),
`amount_cents, currency, reserved_stage_ids, intake_answers` (the reduced answers, which the order
line keeps). A buyer may buy the same listing more than once; each
purchase is its own engagement, and `instantiate_service_blueprint`'s live-draft dedupe reads
Pipeline projects only.

| Refusal | SQLSTATE |
| :-- | :-- |
| Not signed in | `28000` |
| Under 18 (`org.fn_assert_adult`) | `PM403` |
| Unknown or unpublished listing, or a minor seller | `P0002` |
| Not a One-Off or Direct Deliverable (checked only without `p_terms`: a quote offer may answer a Pipeline or a group-session listing and is bought as a one-milestone One-Off, Decision #491), an unpriced stage, no brief, a key outside 8–120 characters, malformed or oversized answers | `22023` |
| A target date in the past | `22007` |
| The buyer's own listing, or their team's | `PU422` |
| The wallet cannot cover the hold (`fund_ticket`) | `PF402` |

Probe: [`supabase/probes/one_off_checkout.sql`](../../../supabase/probes/one_off_checkout.sql).

### Idempotency

All of it runs under one advisory lock per buyer (`pg_advisory_xact_lock`), so two concurrent presses
run one after the other instead of racing.

1. **The request's key.** If `(auth.uid(), p_idempotency_key)` already made a project, that project
   comes back with `created: false`, whatever its status since. A replay returns what the request
   did. The same key naming a different listing is a client bug and is refused (`22023`).
2. **The buyer's live Pipeline draft of this listing** (`get_service_draft`'s predicate, narrowed to
   `format = 'pipeline'`) comes back with `created: false`. While one exists, the listing offers "Open project", so a second
   instantiation could only come from a stale tab.
3. Otherwise it creates. After an archive, a fresh key creates a new draft.

### Caller checks

These are the security of this path, because the functions bypass RLS:

| Refusal | SQLSTATE | HTTP (`instantiateRefusal`) |
| :-- | :-- | :-- |
| Not signed in | `28000` | 401 |
| Under 18 (`org.fn_assert_adult`) | `PM403` | 403 |
| Unknown or unpublished listing | `P0002` | 404 |
| Not a Pipeline, no stages, malformed or oversized intake, bad or reused key | `22023` | 422 |
| The caller's own listing, or their team's | `PU422` | 422 |
| `p_currency` is not the listing's currency | `PC409` | 409 |
| Archive of a funded draft | `23514` | 409 |

`p_currency` NULL means the listing's own currency. A different code is **refused, not
converted**. The seller's prices are a commitment in their currency, and converting them here would
put an FX decision nobody took into an escrow figure (Decision #209 flag). `p_intake` must be a JSON
object of at most 32 KB. It is reduced to the ids the listing's `intake_fields` declares. Required
answers are not enforced here (Decision #209 flag).

`EXECUTE` (`00002510`): the three doors go to `authenticated` and `service_role`. Every internal,
the purchase door included, is `service_role` only. `search_path` is `public, projects, marketplace, org, comms, auth`, the same
path `projects.create_project` uses, because the INSERT triggers it fires inherit it.

**Verified by execution:** `supabase/probes/service_instantiation.sql`. It runs 32 checks in one
rolled-back transaction: every refusal by SQLSTATE, three presses making one project, stage prices,
briefs, checklists and revision terms, one room and no ticket per stage, no seat or escrow,
the stranger and direct-write cases, the funded-archive refusal, and replay after an archive.

## Promoted placements — [`00001176_functions_marketplace_promotions.sql`](../../../supabase/migrations/00001176_functions_marketplace_promotions.sql)

The only writers of `marketplace.promoted_placements` (Decision #454). Organic ranking is never for
sale: a placement buys a separately labelled "Promoted" slot outside the ranked order, which the
discovery reader places (`promoted-slots.ts`). Allocation is a plan entitlement while plans cannot be
bought (PRD-F14; dials in `finance-model.md` §16.7): the listing's **owning subject** — its team for a
team listing, else its person — must hold `promoted_placement` (`finance.fn_has_entitlement`, so an
`entitlement_grants` comp counts), and runs **one** live placement at a time.

| Function | Security | Does |
| :-- | :-- | :-- |
| `promote_listing(p_listing uuid, p_surface text)` | DEFINER | Starts the subject's one flight: `explore_home` or `explore_results`, from `now()` for `fn_promotion_flight()` (7 days), `spend_cents` 0 in GBP, sponsored by the caller; sets `catalogue.listings.promoted`. Locks the listing row and takes a per-subject advisory lock, so two listings of one seller cannot both start. Refusals: `42501` not signed in or not the listing's manager (`catalogue.fn_manages_listing`: its owner, or `publish_listings` on its team) · `22023` an unknown surface (`view_rail` included) · `PB404` no such listing · `PM403` the caller is under 18 (`org.fn_assert_adult`) · `PG422` not published · `PK402` the subject's plan lacks `promoted_placement` (HINT `promoted_placement`) · `PC409` a flight is already live for the subject (HINT `promotion_live`, DETAIL its placement id). |
| `stop_listing_promotion(p_listing uuid)` | DEFINER | Stops the listing's live flight now: `cancelled_at` + `updated_at`, never a delete, and clears `catalogue.listings.promoted`. No age gate: stopping only ever reduces exposure. Refusals: `42501` · `PB404` · `PC409` nothing running (HINT `promotion_not_live`). |
| `get_listing_promotion(p_listing uuid)` | DEFINER | The /catalogue Promote control's read: `{listing_id, entitled, subject ('user'·'team'), published, flight_days, live {placement_id, surface, starts_at, ends_at} \| null, elsewhere {listing_id, slug, title, ends_at} \| null}` — `elsewhere` is the subject's live flight on another of its listings. Refusals: `42501` · `PB404`. |
| `fn_live_listing_promotions(p_owner_team uuid, p_owner_user uuid)` | STABLE SQL DEFINER (internal) | The live placements on one subject's listings (the team's, else the person's own non-team ones), oldest flight first: driven from the listings' owner indexes into `idx_promoted_placements_entity`. |
| `fn_promotion_flight()` | IMMUTABLE SQL (internal) | The flight length, `interval '7 days'`, read by the write and by the read's `flight_days`. |

`EXECUTE` (`00002510`): the three doors go to `authenticated` and `service_role`; the two internals
to `service_role` only.

**Verified by execution:** `supabase/probes/promoted_placements.sql`, in one rolled-back
transaction: no guest door and no direct ledger write by either role; a seller without the
entitlement is refused `PK402` and read `entitled = false`; a stranger can neither promote, read nor
stop; unknown and unsold surfaces, an unknown listing and an unpublished one are refused; a flight is
7 days, charged 0 and sponsored by the caller; a second live flight for the seller, on another listing
or another surface, is `PC409`; a stop keeps the row with its `cancelled_at` and frees the slot; a
team holds one live flight across its listings; an `entitlement_grants` comp allocates the slot; and
no plan grants the retired `discovery_boost` flag.

## Quote requests and offers — [`00001177_functions_marketplace_quotes.sql`](../../../supabase/migrations/00001177_functions_marketplace_quotes.sql)

Decision #458. Every door is `SECURITY DEFINER` with `search_path = ''`. Each one locks the request
first, then its offer, and names who may act and from which state. Every refusal is
`Quote refused: <code>` (`23514`), which `QuoteBackendService` maps to a status and a field; the
age gate's `PM403` passes through. No door moves money.

| Door | Who | From | Effect | Notifies |
| :-- | :-- | :-- | :-- | :-- |
| `request_quote(p_blueprint, p_scope, p_budget_cents, p_currency, p_timeline)` | an adult, not the seller or their team | a published blueprint, no open request of theirs on it | a `sent` request addressed to the blueprint's seller | host `quote.requested` |
| `send_quote_offer(p_request, p_scope, p_deliverables, p_price_cents, p_turnaround_days, p_expires_in_days = 14)` | the host (adult) | `sent` / `answered` | a `pending` offer in the blueprint's currency; the previous `pending` one `withdrawn` + `superseded_by`; the request `answered` | buyer `quote.offer_received` |
| `withdraw_quote_offer(p_offer)` | the host | a `pending` offer | `withdrawn` | buyer `quote.offer_withdrawn` |
| `decline_quote_request(p_request, p_reason)` | the host | `sent` / `answered` | `declined` + reason; a `pending` offer `withdrawn` | buyer `quote.declined` |
| `accept_quote_offer(p_offer)` | the buyer (adult) | an unexpired `pending` offer on an `answered` request | offer and request `accepted`; ONE `one_off_service` line in the buyer's default personal basket (`metadata.quoteOfferId`, `fundingScope: whole_project`). Idempotent: returns the live line, re-adds a removed one, refuses `already_ordered` once a line was paid for and `offer_expired` once the accepted offer is past `expires_at` (Decision #491) | host `quote.offer_accepted` (first accept only) |
| `decline_quote_offer(p_offer)` | the buyer | an unexpired `pending` offer | `declined`; the request stays `answered` | host `quote.offer_declined` |
| `withdraw_quote_request(p_request)` | the buyer | `sent` / `answered` / unpaid `accepted` | `withdrawn`; a `pending` offer `declined`; the accepted offer's live basket line removed (soft) | host `quote.withdrawn` |

Refusal codes: `not_signed_in`, `quote_not_found` (a stranger and a missing id alike), `not_your_move`,
`not_open`, `listing_unavailable`, `own_listing`, `scope_required`, `budget_invalid`,
`currency_required`, `timeline_too_long`, `already_open`, `too_many_deliverables`,
`deliverable_too_long`, `price_required`, `turnaround_invalid`, `expiry_invalid`, `offer_expired`,
`already_ordered`, `offer_not_accepted`.

**Reads.** `get_quotes_with(p_counterpart)` returns every request between the caller and one person
in either role, newest first and at most 20. Each entry carries the caller's `role`, the listing
(slug, title, currency, delivery model, `free_revisions`), `offers_sent`, the current offer (the
`pending` or `accepted` one, else the latest, with `expired` derived: a `pending` offer, or an
`accepted` one not yet paid for, past `expires_at`, Decision #491), the buyer's live
`basket_item_id` and `ordered`. Notices link the host to `/catalogue?view=clients&client=@buyer` and
the buyer to `/messages/dm-host` (`fn_quote_link`).

**Checkout's terms.** `fn_quote_offer_terms(p_offer, p_basket_item)` is internal to
`finance.place_wallet_order`, as the buyer, after that function has checked the same in checkout's
own words (`database/finance/Functions.md`, Decision #491), so these refusals are its backstop. It
refuses unless the offer and its request are `accepted`, the offer is not past `expires_at`
(`offer_expired`), the line is a live line in the caller's personal basket carrying this offer, and
no other line has bought it. It returns
`{offer_id, quote_request_id, blueprint_id, brief, target_date (today + turnaround), price_cents, currency, terms}`.
`terms` is a one-row array in `fn_blueprint_stage_terms`' shape (one Standard, locked stage at the
offer's price, its deliverables the stage checklist), which `fn_buy_scoped_service`'s `p_terms`
writes through.

`EXECUTE` (`00002510`): the seven doors and the read go to `authenticated` and `service_role`. The
helpers (`fn_lock_quote`, `fn_lock_quote_offer`, `fn_quote_party_name`, `fn_quote_link`,
`fn_notify_quote`, `fn_quote_listing_title`, `fn_quote_basket`, `fn_quote_offer_line`) and
`fn_quote_offer_terms` go to `service_role` only.

**Verified by execution:** `supabase/probes/quote_offers.sql`, in one rolled-back transaction. Only
the host answers. A stranger can neither price nor read a request. Revisions supersede. An expired
offer can be neither accepted nor declined. Accepting makes exactly one basket line: idempotent,
re-added after a removal, and a second line written by hand is refused. The terms are read by the
buyer and that line only, and refused once paid for. Every decline and withdrawal is covered, with its
notice and link. Both sides' reads and the pipeline's offer price are checked.
