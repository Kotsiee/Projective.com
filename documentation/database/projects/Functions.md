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

### `projects.get_viewer_hired_teams(p_project_id uuid) → TABLE (team_id uuid, project_stage_id uuid)`

One row per stage of the project held by a team the **caller** is an active member of
(`org.team_members.status = 'active'`), through a live `assignee_type = 'team'` assignment. `SECURITY
DEFINER`, `STABLE`, `search_path = ''`; `EXECUTE` to `authenticated` only (revoked from `public` and
`anon`). Defined in `00001100`.

It drives the Project Details sidebar's **Teams** group, which renders only for a member of a hired
team. A definer is required because the two facts sit behind policies that never meet for this caller:
`stage_assignments` is readable by the owner (or on an active public project) alone, so a team member
on a private engagement cannot see which team holds a stage, while their own `team_members` rows are
readable to them. It discloses nothing the caller cannot already reach — each row names a team they
belong to and a stage whose talent room `comms.can_access_scope` already admits them to.

"Live" excludes `released`, `cancelled` and `declined`, **exactly** the set `comms.can_access_scope`
excludes, so the group and the room it links to cannot disagree; a completed stage keeps its team.
An unanswered invitation is not an assignment and never appears.
`packages/types/projects/hired-teams.contract.test.ts` fails if the two status lists diverge.

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

**The slug is MINTED, never derived** — not from the title, not from anything. `security.mint_slug`
produces the canonical `prj-` address; the whole point of an opaque slug is that no input exists
which could change it, so a project stays reachable at the same URL through every rename it will
ever have.

A caller-supplied slug is honoured ONLY when it already has the canonical shape, which makes the
call idempotent against a client's own retry. Anything else is discarded rather than normalised:
`ck_projects_slug_shape` would refuse it anyway, and a normalisation that silently produced a
DIFFERENT address from the one requested is worse than ignoring the request.

On `unique_violation` it draws a fresh slug and retries, up to five times — a new sample rather than
a search around a taken address. The retry is on the CONSTRAINT rather than a prior `SELECT`,
because two callers minting in the same instant both see the address free, and it re-raises anything
that is not `projects_slug_key` so a duplicate primary key is not reported as an address problem.

**The NDA pair.** The payload speaks in `projects.nda_mode` — the enum TYPE
`none | platform_standard
| custom` — and the row stores a PAIR: `nda_required` (does one apply) and
`nda_source` (which instrument). **`projects.projects` has no `nda_mode` column and never has.** The
INSERT named one regardless, so every call to this function raised
`42703 column "nda_mode" of relation "projects"
does not exist` — a create that could not work at
all, invisible to a type-checker because the statement is a string, and unreachable from the
application because the app's create path does a direct insert instead.

The mapping is `ndaRequiredFor` / `ndaSourceFor` / `ndaDocumentFor` in `@projective/types/projects`,
and it is cross-checked against this file by `nda.contract.test.ts` — two implementations of one
mapping is what caused the defect, so the test reads the SQL and fails if either side moves:

| `nda_mode`          | `nda_required` | `nda_source` |
| :------------------ | :------------- | :----------- |
| `none`              | `false`        | `platform`   |
| `platform_standard` | `true`         | `platform`   |
| `custom`            | `true`         | `custom`     |

`none` maps to `platform` because the column is `NOT NULL` with two members and `platform` is its
own `DEFAULT` — the value is meaningless while `nda_required` is false, and nothing reads it. When
only the legacy boolean arrives, `true` means `platform_standard`: "an NDA governs this and nobody
said which" is exactly what that member names.

`nda_document_id` is passed through untouched and `ck_projects_nda_document` refuses a
contradiction. That is deliberate and differs from `ndaDocumentFor`, which DROPS the reference —
that is an UPDATE rule, for tidying away a document after a mode change. On create there is no
earlier document, so a payload naming one alongside a mode that forbids it is a caller
contradiction, and refusing it is more honest than storing something other than what was sent.

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

Client-side adjudication and funding. Guarded by `can_review_project`. `fund_stage` additionally
spends the CLIENT's money, so it resolves the payer from `client_business_id` (NULL → `PS501`: an
individual client has no escrow path) and requires that business's `spend` capability
(`finance.fn_owner_capability`) — project access alone would let a hired freelancer fund the client's
escrow from the client's wallet ([finance/Functions.md](../finance/Functions.md#stage-level-wrappers-in-projects-invoke-this-engine--migration-0305)).

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

## Invitations

The client-led half of `PRODUCT_SPEC.md` §The Hiring Process ("The Outbound Invitation"), landed
2026-09-21 in `00001130_functions_projects_stages.sql` §10. Four DEFINER functions, one transaction
each, so an invitation and the notification that announces it — or an acceptance and the participant
row it grants — cannot exist without each other. Authorisation is made explicitly inside each body
(DEFINER bypasses RLS), and matches the `Owner manages invitations` policy: the owner alone.

### `projects.invite_to_project(p_project_id uuid, p_stage_id uuid, p_target_user_id uuid, p_role text, p_message text DEFAULT '', p_offer_price_cents bigint DEFAULT NULL, p_answers jsonb DEFAULT '{}') → uuid`

Issues ONE identity-addressed invitation (one row, one stage — `NULL` for a whole-project offer) as
the project owner, and emits `stage.invite` to the invitee through `comms.fn_notify` in the same
transaction. Refuses, in the database's own words: a non-owner (`insufficient_privilege`), a closed
project, the owner inviting themself, a role the accept path cannot grant, a stage of another project,
a seat the person already holds, and the **48-day re-invitation cooldown** (`check_violation`, naming
the date it lifts). A duplicate open seat is re-raised from `uq_project_invitations_open_seat` as a
readable `unique_violation`.

`placeholder` is DERIVED — `status = 'draft'`, or no figure anywhere (`COALESCE(p_offer_price_cents,
stage unit price | project budget)`) — never accepted from a caller. `token` is minted
(`gen_random_bytes(32)`), `expires_at = now() + 14 days`. Records `invitation_sent` on
`project_activity`.

Why an RPC and not an owner-RLS INSERT from the fat service: `comms.fn_notify` is EXECUTE-granted to
`service_role` only, so a DEFINER body is the only place an application write can route through the
notification ROUTER — the one implementation of the recipient's channel, quiet-hours, mute and digest
preferences. The notification's deep link is the inviter's DM (`/messages/dm-{username}`), where the
invitee can answer today; the catalog's `/projects/{context_id}` template would mint a uuid address
the router no longer serves (Decision #88). `EXECUTE` → `authenticated`.

### `projects.fn_apply_invitation_decision(p_invitation_id uuid, p_accept boolean, p_actor uuid) → jsonb`

**The one implementation of an invitation's answer.** Locks the row; refuses anything not `pending`
(and marks a lapsed `expires_at` as `expired` before refusing); refuses an email-addressed row (those
are accepted through their link). A **decline** stamps `declined_at`, logs `invitation_declined` and
notifies the inviter (`invitation.declined`). An **accept** stamps `accepted_at`, enrols the invitee
as a `project_participants` row (`role = 'assignee'` for a freelancer — the staffing RPC's own
vocabulary — else the invitation's role verbatim), takes the stage seat for a freelancer invited to a
stage (`stage_assignments`, `status = 'pending_funding'` on a placeholder or draft, else `assigned`;
refuses a person with no `org.freelancer_profiles` row), moves an `open` stage to `assigned` on a live
project, logs `invitation_accepted`, and notifies the inviter (`invitation.accepted`) with the
slug-addressed `/projects/{slug}/members`. Returns `{id, status, participant_id, assignment_id}`.

**No client grant** (`EXECUTE` → `service_role` only). `p_actor` is who the decision is recorded AS;
the caller has already established who may make it. Two doors reach it: the invitee's wrapper below,
and — in DEVELOPMENT only — the fat service's `decideInvite`, through the service-role client, after
the row has been read back under the caller's RLS as its inviter. That is what lets the Dev Tools
Invites window force an answer that writes exactly the rows a real answer writes.

### `projects.respond_to_project_invitation(p_invitation_id uuid, p_accept boolean) → jsonb`

The invitee's own door: the row must be addressed to `auth.uid()` (`insufficient_privilege`
otherwise); delegates to `fn_apply_invitation_decision`. `EXECUTE` → `authenticated`. No application
surface calls it yet — the freelancer-side accept UI is the deferred half.

### `projects.remove_project_member(p_project_id uuid, p_participant_id uuid, p_stage_id uuid DEFAULT NULL) → jsonb`

The client removes a hired freelancer from ONE stage (`p_stage_id`) or from the whole project
(`NULL`). Owner-only; refuses a non-freelancer participant (a business participant is the paying
side). Applies `PRODUCT_SPEC.md` §Freelancer Removal Mid-Ticket: every ticket the person holds within
the scope — `claimed`, `in_progress` or `in_review` — goes through `projects.release_ticket_to_backlog`
(escrow released to them in full, ticket back to New), their held `stage_assignments` in scope become
`released`, the accepted invitations the removal undoes gain `dismissed_at` (their acceptance kept as
history), and a whole-project removal deletes the `project_participants` row — the only thing
`has_project_access` reads, and therefore the only way access is actually withdrawn. Logs
`member_removed` / `member_unassigned`. Returns the counts it APPLIED (`claimed_tickets`,
`submitted_tickets`, `started_stages`) so the confirmation the client saw can be read back against
what happened. `EXECUTE` → `authenticated`.

🚨 **`projects.release_ticket_to_backlog(uuid)` had the default `PUBLIC` EXECUTE and no caller check
of its own** — any signed-in caller who knew a ticket id could release its escrow and un-claim it (the
`reorder_stages` class, Decision #84). It had no application caller. `00002510` now revokes its
EXECUTE from `public`/`anon`/`authenticated`; `remove_project_member` still reaches it because a
DEFINER function executes as its owner.
