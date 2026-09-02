# projects: Functions

Functions and RPCs for the `projects` schema. Tables: [Tables.md](Tables.md) · Policies:
[Policies.md](Policies.md).

Coverage is partial — the stage-staffing, ticket-guard and finance helpers are not yet written up
here. The entries below are the ones whose authorisation model or call contract a caller has to know
before using them.

---

## Access predicates

The four `SECURITY DEFINER` helpers every policy and RPC in this domain leans on are tabulated in
[Policies.md](Policies.md#the-predicates-everything-is-built-on): `has_project_access`,
`has_stage_access`, `can_review_project`, `is_protected_phase`.

---

## Creation

### `projects.create_project(payload jsonb) → jsonb {id, slug}`

The one atomic write behind `POST /api/projects/create`. Inserts the project row, its stages, their
staffing roles, the participant record and a readable unique slug in a single transaction.

**Why an RPC rather than four table writes.** PostgREST gives the application one statement per
round trip and no transaction around them, so a TypeScript create would be four calls with no way to
undo the first three when the fourth is refused — leaving an engagement the client has already
navigated to holding half of what they typed. It also runs `projects.update_entity_project_counts`,
an `AFTER INSERT` trigger that is `SECURITY INVOKER` and writes `org.users_public`; inside a
`SECURITY DEFINER` function that bookkeeping runs in the definer's context, where it belongs.

**What DEFINER obliges.** Bypassing RLS means every ownership claim in the payload is checked here
or not at all:

| Field                                                            | Source                      | Note                                                                                                                               |
| :--------------------------------------------------------------- | :-------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `owner_user_id`                                                  | `auth.uid()`                | **Never** from the payload.                                                                                                        |
| `status`                                                         | hardcoded `draft`           | Not from the payload — it gates the public-footprint trigger and the escrow lifecycle.                                             |
| `visibility`                                                     | hardcoded `unlisted`        | Not from the payload — publishing is a later, deliberate write.                                                                    |
| `client_business_id` / `owner_team_id` / `owner_organisation_id` | payload, membership-checked | Active membership of that workspace is required; the three are mutually exclusive. Personal scope is the **absence** of all three. |

**The slug.** `payload.slug` (or the title) is normalised to the column's `^[a-z0-9-]{1,96}$` CHECK,
truncated to 80 characters, and falls back to the generated `p-<12 hex>` form when a title has
nothing usable in it. On `unique_violation` it appends a 6-hex disambiguator and retries, up to five
times — the retry is on the CONSTRAINT rather than a prior `SELECT`, because two callers naming a
project the same thing in the same instant both see the address free.

**The participant row is written only for a business-scoped project**, as
`('business', client_business_id, 'owner')`. `profile_type` is `('freelancer','business')` and has
no member for an individual buyer, and `has_project_access` resolves a personal owner through
`owner_user_id` in its first branch — so a personal project needs no participant row, and writing
one as `freelancer` would be a false claim that also matches nothing (that branch joins
`org.freelancer_profiles`).

**Each stage's General room is opened in the same transaction**, matching `create_stage`.
`comms.get_stage_channels` provisions rooms lazily on first open and the channel tree is built from
rooms that already exist, so a stage created without one is a stage nobody can navigate to.

**Every project leaves with at least one stage.** If the payload names none, one implicit `Delivery`
stage is minted carrying the PROJECT's own `description`, `description_text` and IP mode, plus its
`budget_amount_cents` as `unit_price_cents` — but only when `budget_type = 'fixed_price'`, because
an `hourly_cap` is a ceiling on spend and `finance.fn_hold_ticket_escrow` reads that column as an
amount to hold, so copying a cap there would escrow the ceiling as though it were the fee.

This fires for ANY stageless project, not only one that arrived carrying roles. It used to sit
inside the roles branch, where it existed to give `stage_staffing_roles` (which hangs off a stage,
not a project) somewhere to live — so the far commoner case, a project with neither stages nor
roles, landed with no stage at all: nothing for a ticket to sit in, nothing for escrow to price
against, no room in the channel tree, and `projects.set_project_status` refusing to activate it
because it counts stages. It carries the project's own metadata rather than a bare name because this
stage IS the project's single unit of delivery; seeding it empty would ask the owner to retype what
they have just typed. A Direct Deliverable — roles and no stages — still composes exactly as before.

**The NDA pair cannot be stored disagreeing with itself.** `nda_mode` is authoritative when the
caller sends one, and `nda_required` is written as `nda_mode <> 'none'`. When only the legacy
boolean arrives, `true` resolves to `platform_standard` — "an NDA governs this and nobody said
which" is exactly what that member names. `nda_document_id` is passed through untouched, because
`ck_projects_nda_document` is the single authority on whether a document may accompany a mode, and a
second opinion here could only disagree with it.

**Currency is upper-cased, not re-validated.** `ck_projects_currency` owns the shape; case is the
one difference between a code that is right and one that is right in lower case, and normalising it
is ISO 4217's own convention rather than a decision this function takes on the caller's behalf.

**`allow_deadline_bonuses` is passed through unclamped.** The flag arriving on a one-off is a caller
contradiction, and `ck_projects_deadline_bonus_format` refusing it is more honest than this function
quietly dropping what was sent.

**`file_upload_required` defaults `true` HERE as well as on the column.** The RPC always supplies a
value, so the column default alone never reaches the create path; the two have to carry the same
answer or the change is inert.

⚠️ **Every cast out of the payload goes through `NULLIF`, and every list through
`projects.fn_payload_text_array`.** This function is `EXECUTE`-granted to `authenticated`, so its
argument is caller-controlled: `->>` on a key whose value is an empty string hands an enum, numeric,
boolean or timestamp cast a `''` it cannot parse (`22P02`), and a key holding a JSON `null` reaches
`jsonb_array_elements_text` as a scalar (`22023`). Both are crashes a caller reaches directly rather
than refusals, and neither is visible from reading the happy path.

`EXECUTE` is granted to `authenticated` only.

### `projects.fn_payload_text_array(p_value jsonb) → text[]`

Reads a text array out of an untrusted jsonb payload, answering `{}` for everything that is not an
array. `IMMUTABLE`, no security context of its own.

The bare `ARRAY(SELECT jsonb_array_elements_text(x))` idiom it replaces is correct only for an
ABSENT key. One function rather than a `jsonb_typeof` CASE repeated at six call sites, so "how do we
read a list out of a payload" has one answer that cannot drift between the project and its stages.

---

## Stages

### `projects.create_stage(p_project_id uuid, p_name text, p_description jsonb DEFAULT '{}', p_description_text text DEFAULT '', p_unit_price_cents bigint DEFAULT NULL, p_payload jsonb DEFAULT '{}') → uuid`

Appends a stage to a project and **provisions its channel in the same transaction**. Returns the new
stage id.

**`p_payload` carries the stage's optional settings** — `milestone`, `default_tasks`, `skills`,
`seat_limit`, `parallel`, `nda_override`, `allowed_file_categories`, `allowed_file_extensions`, the
timing fields (`start_trigger_type`, `fixed_start_date`, `start_dependency_stage_id`,
`start_dependency_lag_days`, `file_duration_mode`, `file_duration_days`, `file_due_date`),
`hire_trigger_active`, `file_revisions_allowed` and the IP terms — **in the same shape
`projects.create_project` reads a stage out of**, so the create path and the add-a-stage path cannot
come to disagree about what a field is called.

One jsonb bag rather than a dozen more named parameters: every argument added is another signature
this function can never again be changed without, and the bag keeps the signature stable while the
stage grows. Everything in it is optional — a caller sending `{}` gets exactly the stage the
five-argument form used to build. Where an explicit argument and a bag key both carry a value, **the
explicit argument wins**; it is the more specific statement, and collapsing the five would silently
change what an existing call means.

⚠️ Adding a defaulted parameter changes the signature, and Postgres will **not** `CREATE OR REPLACE`
across one — so this is `DROP FUNCTION IF EXISTS … (uuid, text, jsonb, text, bigint)` + `CREATE`.
Every existing five-argument call still resolves against the new function because `p_payload`
defaults; verified by executing one. The default `PUBLIC EXECUTE` grant is re-established by the
`CREATE` (this function has no explicit grant in `00002510`).

**A dependency must be a stage of THIS project.** Without the check a caller could point the new
stage at a stage id from somebody else's pipeline: the foreign key is satisfied (it names the table,
not the project), the schedule then reads a start trigger it cannot resolve, and the reference
itself discloses that the foreign stage exists. Refused with `check_violation`.

The channel call is not a convenience. `comms.get_stage_channels` provisions a stage's rooms
_lazily_, on first open, and the channel tree the app renders is built from the channels that
already exist — so a stage created without one is a stage nobody can see or navigate to. Opening the
General room here is what makes a newly-created stage reachable the moment it exists.

`sort_order` is `COALESCE(MAX(sort_order) + 1, 0)`. The `COALESCE` covers the first stage, where
`MAX` over an empty set is `NULL` and a bare `+1` would make the whole expression `NULL` against a
`NOT NULL` column.

`SECURITY DEFINER`, `search_path = public, projects, comms, auth`, because it writes through
`comms.project_channels` whose RLS the caller does not otherwise satisfy. **The ownership check is
therefore the only thing standing between a signed-in caller and somebody else's pipeline**, and it
is deliberately the first thing the body does — an unauthenticated caller and a non-owner both get
`insufficient_privilege`.

### `projects.reorder_stages(p_project_id uuid, p_ordered_ids uuid[]) → void`

Atomic bulk restamp of stage `sort_order`. Ticket order is independent of stage order, so each
column's internal ticket sequence is preserved automatically.

🚨 **It shipped with no caller check at all.** It is `SECURITY DEFINER`, so the `UPDATE` runs as the
owner and RLS never sees it, and it keeps the default `PUBLIC EXECUTE` grant the rest of this file
relies on — so any signed-in caller who knew a project id and its stage ids could reorder somebody
else's pipeline. Stage order is the execution sequence, so that is a change to what gets built when,
not a cosmetic one.

Authority is **ownership**, not `has_project_access`: an assigned freelancer legitimately reads the
pipeline and must not be able to rewrite the client's sequencing. `search_path` includes `auth` so
`auth.uid()` resolves.

### `projects.delete_stage(p_project_id uuid, p_stage_id uuid) → void`

Releases escrow for claimed tickets in the stage, detaches its tickets to the backlog, scrubs the
stage from every `required_stages` array and from sibling `start_dependency_stage_id`, then deletes
— **unless** the stage carries `finance.escrows` history, in which case funds are still released and
the caller is told to archive instead. `finance.escrows.project_stage_id` is `NOT NULL` +
`ON DELETE
RESTRICT`, so the alternative would be orphaning the finance audit trail.

---

## Tickets

### `projects.move_ticket(p_ticket_id uuid, p_to_status ticket_status, p_to_stage_id uuid DEFAULT NULL, p_sort_order integer DEFAULT NULL) → jsonb`

The guarded column transition the board calls. Returns the updated ticket row as `jsonb`.

| Guard               | Rule                                                    |
| :------------------ | :------------------------------------------------------ |
| Any transition      | `projects.has_project_access(project)`                  |
| → `completed`       | **additionally** `projects.can_review_project(project)` |
| Cross-project stage | `p_to_stage_id` must belong to the ticket's project.    |

⚠️ **`status` is a money-moving column.** `trg_ticket_escrow_sync` releases escrow on entering
`completed` and holds it on claim, which is why only the client/owner may drop a card into Done — a
freelancer must not be able to self-confirm delivery.

`p_sort_order` carries the card's new position within its destination lane and is **defaulted**, so
the three-argument call sites that predate it keep resolving to this same function. It is honoured
**only** for a move into `backlog`: `projects.fn_ticket_ordering_guard` RAISES on any `sort_order`
change outside that lane, because every other column is ordered by `updated_at` rather than by hand,
so forwarding a position there would turn an ordinary drag into an error the board cannot explain.

Every move writes a `projects.ticket_history` row, which is why that table has no client write
policy (see [Policies.md](Policies.md)).

---

## Deliverables

### `projects.submit_deliverable(...) → jsonb`

Files a submission against a stage, links its `files.items` ids (tolerantly — an id with no row is
logged and skipped) and moves the ticket into `in_review`. Guarded by `has_project_access` plus a
stage-belongs-to-project check. Idempotent with `projects.fn_ticket_review_submission`, the trigger
that auto-files a ledger row when a card is dragged into Review: whichever runs first, the other
no-ops.

### `projects.review_submission(...)` / `projects.approve_stage(...)` / `projects.fund_stage(...)`

Client-side adjudication and funding. Guarded by `can_review_project`.

---

## Lifecycle

### `projects.set_project_status(p_project_id uuid, p_to_status project_status, p_reason text DEFAULT NULL) → project_status`

The owner-only state machine. `draft|on_hold → active` needs a title and ≥1 stage;
`active|on_hold →
completed` needs every ticket terminal **and** no escrow still held; terminal
states are immutable. Writes `projects.project_status_history` and `projects.project_activity`.

---

## Service instantiation

### `projects.fn_archive_stale_service_drafts(p_now timestamptz DEFAULT now()) → integer`

Soft-archives instantiated pipeline drafts that nobody funded. Returns how many it archived.

Scope is three predicates, each load-bearing:

- `source_blueprint_id IS NOT NULL` — only drafts created by "Add to Projects" are in reach. A
  project somebody built by hand is theirs, however long it sits.
- `status = 'draft'` — anything that has moved on has left the sweep by definition.
- no `finance.escrows` row against any of its stages — funding does not POSTPONE the deadline, it
  REMOVES it. A pipeline somebody has paid into is an engagement, and no amount of later idleness
  makes it an abandoned draft again. The escrow record is used as the evidence rather than a status
  flag, because it is what a dispute would actually be resolved against.

The window is `security.platform_params.service_draft_idle_days` (seeded `30`), not a literal, and
it is **mirrored by `DRAFT_IDLE_DAYS` in `@projective/types/services`** — which the interface reads
to tell the buyer when their draft expires. The two must agree or the interface promises a date the
job does not honour.

Nothing is deleted. `status` becomes `archived` and `archived_at` is stamped; the project, its
stages and their history stay (root `CLAUDE.md` §7).

`SECURITY DEFINER`, `search_path = ''`, every reference schema-qualified. Registered with `pg_cron`
daily at 03:10 UTC by a guarded `DO` block beside the definition — guarded end to end, because the
extension may be absent and `cron.schedule` needs privileges a migration run may not have, and a
failure there must not block the rest of the migration.

⚠️ **It has an application-side twin.** `ProjectBackendService.sweepStaleDrafts` implements the same
rule in TypeScript, because with `PROJECTS_BACKEND_LIVE` off there is no database to run the job and
a rule that only exists on the path nobody exercises is a rule nobody has tested. Both call the
SSOT's own `draftIsStale`, and `packages/types/services/pipeline_test.ts` pins the predicate so the
pair cannot drift into different definitions of "stale".
