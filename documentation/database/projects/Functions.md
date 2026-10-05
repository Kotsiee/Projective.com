# projects: Functions

Functions and RPCs for the `projects` schema. Tables: [Tables.md](Tables.md) · Policies:
[Policies.md](Policies.md).

83 functions — every `CREATE FUNCTION projects.*` in `supabase/migrations/` — each with its
signature, security context, `EXECUTE` holders and caller check. Defined in `00001100`–`00001150`;
trigger bindings in `00001800` / `00001820` / `00001850`; explicit grants in `00002510` and beside a
handful of definitions.

**Reading the `EXECUTE` line.** Postgres grants `EXECUTE` to `PUBLIC` on every new function, `projects`
has no schema-wide revoke, and `anon` holds `USAGE` on the schema (Decision #85(e)) — so "default
`PUBLIC`" below means **`anon`, `authenticated` and `service_role` can all call it over PostgREST**.
For a trigger function that is moot: Postgres refuses to call one outside a trigger (`0A000`). An
error marked `P0001` is a bare `RAISE EXCEPTION` with no `ERRCODE`.

---

## Access predicates

The four `SECURITY DEFINER` helpers every policy and RPC in this domain leans on are tabulated in
[Policies.md](Policies.md#the-predicates-everything-is-built-on): `has_project_access`,
`has_stage_access`, `can_review_project`, `is_protected_phase`.

### `projects.has_project_access(_project_id uuid) → boolean`

Defined in `00001100`. True for, in order: the project's owner (`owner_user_id`); a freelancer
participant (`project_participants`, `profile_type = 'freelancer'`); the owner of a participating
business (`profile_type = 'business'`); a freelancer holding a stage assignment on the project; an
active member (`org.team_members.status = 'active'`) of a team holding a stage assignment.

**The two assignment arms count only a live assignment** (since 2026-09-28): a row whose
`stage_assignments.status` is `declined`, `cancelled` or `released` no longer grants the engagement
— the same set `comms.can_access_scope` excludes (and `get_viewer_hired_teams` below). Before that
they counted ANY assignment row whatever its status, so a freelancer who turned a stage down, or a
member removed from one (Decision #116), kept reading the project and every surface keyed on this
predicate indefinitely — including every project meeting's room and roster on `scheduling.events`,
while `comms.has_channel_access` already refused them the meeting's own chat room. The two
participant arms carry no status test: a `project_participants` row grants access for as long as it
exists, which is why a whole-project removal deletes it (see `remove_project_member` below).

`SECURITY DEFINER` (plpgsql, not `STABLE`), `search_path = public, projects, org, auth`; default
`PUBLIC` `EXECUTE`. No caller check of its own — it answers for `auth.uid()`, so a guest gets `false`.

### `projects.can_review_project(_project_id uuid) → boolean`

`00001100` §2. The "client viewer" authority every money-moving and adjudicating door asks:
`p.owner_user_id = auth.uid() OR (p.client_business_id IS NOT NULL AND
org.is_active_business_member(p.client_business_id))`. Deliberately **not** true for an assignee.
`LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `search_path = public, projects, org, auth`; default
`PUBLIC` `EXECUTE` (it is a policy predicate, so it must run as the invoking role). An unknown id and a
guest both answer `false`.

### `projects.has_stage_access(p_stage_id uuid) → boolean`

`00001100` (from `0308`). Stage-scoped membership for stage rooms and the _Insert own submissions_
policy: `false` for an unknown stage; else true when `can_review_project(stage's project)`, or the
caller is a freelancer (`freelancer_profile_id = auth.uid()`) or an active member of a team holding an
assignment on **that stage** whose status is not `released` / `cancelled` / `declined`. `STABLE`,
`SECURITY DEFINER`, `search_path = public, projects, org, auth`; default `PUBLIC` `EXECUTE`.

### `projects.is_protected_phase(p_project_id uuid) → boolean`

`00001100` (from `0311`). `COALESCE((SELECT handover_unlocked_at IS NULL FROM projects.projects WHERE
id = p_project_id), true)` — true until the Projective Unlock, and **true for an unknown id**, so the
PII mask fails closed. `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `search_path = public, projects`.
`00002510` grants `EXECUTE` to `authenticated` explicitly, but nothing revokes the default `PUBLIC`
grant, so `anon` can call it too (it discloses one boolean per project id). No caller check.

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
navigated to holding half of what they typed. It also fires `projects.update_entity_project_counts`,
an `AFTER INSERT` trigger that writes `org.users_public` / `org.business_profiles`; that function is
now itself `SECURITY DEFINER` (see [below](#projectsupdate_entity_project_counts--trigger)), so the
bookkeeping no longer depends on being reached from inside this one.

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

**So is the project-wide room** (step 7b — `comms.get_or_create_project_channel(id, NULL,
'General')`, visibility `project_all`): it is what `/projects/[slug]/discussion` opens on every
one-off, pipeline and session, and a project created without it has no Discussion. Opened for a Task
as well, so a Task converted into a pipeline has its room already (Decision #135).

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

`SECURITY DEFINER`, `search_path = public, projects, org, comms, auth`. Refuses a `NULL` `auth.uid()`
first with `28000` (`Not authenticated`), and a blank title with `23514`.

### `projects.fn_payload_text_array(p_value jsonb) → text[]`

Reads a text array out of an untrusted jsonb payload, answering `{}` for everything that is not an
array. `IMMUTABLE`, no security context of its own.

The bare `ARRAY(SELECT jsonb_array_elements_text(x))` idiom it replaces is correct only for an
ABSENT key. One function rather than a `jsonb_typeof` CASE repeated at six call sites, so "how do we
read a list out of a payload" has one answer that cannot drift between the project and its stages.

`LANGUAGE sql`, `SECURITY INVOKER`, no `search_path`; default `PUBLIC` `EXECUTE` (pure, touches no
table).

### `projects.update_entity_project_counts() → trigger`

`trg_update_project_counts` — `AFTER INSERT OR UPDATE OF status OR DELETE ON projects.projects`, bound
in `00001800`. Recomputes `total_project_count` / `active_project_count` on the owning
`org.business_profiles` row (when `client_business_id` is set) or on the owner's `org.users_public` row
(using `OLD` on delete). `SECURITY DEFINER`, `search_path = public, projects, org`: as `INVOKER` its
update matched zero rows under the caller's RLS and its cascade into `search.sync_user_to_index()`
raised `42501` on `search.profiles_index`, aborting every app-level project insert. No caller check
(a trigger); default `PUBLIC` `EXECUTE`, moot.

---

## Read models

`SECURITY DEFINER` reads behind the dashboard, project header, ticket modal and gauges. Each runs as
the owner, so its body guard is the whole of its authorisation.

### `projects.get_dashboard_projects(p_category text, p_category_id uuid, p_search_query text, p_sort_by text, p_sort_dir text, p_limit int, p_offset int) → TABLE (project_id uuid, title text, status text, owner_name text, owner_avatar jsonb, is_starred boolean, is_archived boolean, has_unread boolean, last_updated_at timestamptz, total_count bigint)`

`00001100` (from `0103`). The one read here that is **`SECURITY INVOKER`** (no `search_path` set), so
every table it reads is filtered by the caller's own RLS on top of its predicate: the project owner,
or a participant (`pp.profile_type = 'freelancer' AND pp.profile_id = auth.uid()`, or a business
participant the caller owns). The `stage_assignments` join is never referenced by the `WHERE`, so an
assignee with no participant row is not listed. `p_category` filters `starred · unread · in-progress ·
completed · archived` (default: not archived), plus `team` / `service` keyed on `p_category_id`.
Default `PUBLIC` `EXECUTE`; a guest's `auth.uid()` is `NULL` and matches nothing.

### `projects.get_project_details(p_project_id uuid) → TABLE (project_id uuid, title text, format text, status text, is_starred boolean, allow_deadline_bonuses boolean, target_project_start_date timestamptz, timeline_preset text, owner jsonb, viewer_context jsonb, stages jsonb)`

`00001100` (from `0116`). `SECURITY DEFINER`, `search_path = public, projects, org, auth`; default
`PUBLIC` `EXECUTE`. Resolves the caller's role first — `owner` (owner, or owner of the client
business), else `collaborator` (a freelancer / owned-business participant, or **any**
`stage_assignments` row for the caller or an active team of theirs — this arm has no status filter,
unlike `has_project_access`) — and raises `Access Denied` (`P0001`) when neither applies.
`viewer_context.permissions` lists `manage_settings` / `manage_members` / `view_financials` for the
owner only.

### `projects.get_project_card_summary(p_project_id uuid) → jsonb`

`00001100` (from `0122`). The Quick Inspector blob: status, currency, stage count, live ticket column
counts, `pending_submissions`, `held_escrows`, `next_milestone_at`. `STABLE`, `SECURITY DEFINER`,
`search_path = public, projects, finance, org, auth`; default `PUBLIC` `EXECUTE`. Guard:
`IF NOT projects.has_project_access(p_project_id)` → `insufficient_privilege` (`42501`); an unknown id
fails that check first, so its `no_data_found` branch is unreachable in practice.

### `projects.get_project_roster(p_project_id uuid) → TABLE (profile_id uuid, name text, avatar jsonb, role text)`

`00001100` (from `0118`). The ticket "Reassign" picker: freelancer participants plus every freelancer
on a stage assignment, de-duplicated. The assignment arm has **no status filter**, so a declined or
released freelancer still appears. `SECURITY DEFINER`, `search_path = public, projects, org, files,
auth`; default `PUBLIC` `EXECUTE`. Guard: `has_project_access(p_project_id)` → `42501`. Also called
inside `auto_assign_round_robin` / `assign_parallel_stream`, where the same guard applies to their
caller.

### `projects.get_stage_details(p_project_id uuid, p_stage_id uuid) → TABLE (stage_id uuid, project_id uuid, title text, description jsonb, description_text text, sort_order int, status text, ip_mode text, file_upload_required boolean, default_tasks jsonb, skills text[], due_date timestamptz, scheduling jsonb, channel_id uuid, budget jsonb, assignee jsonb, latest_submission jsonb, viewer_context jsonb, assignment_mode text)`

`00001100` (from `0104`). `SECURITY DEFINER`, `search_path = public, projects, org, auth`; default
`PUBLIC` `EXECUTE`. 🚨 **No access check.** The only refusal is `Stage not found or access denied`
(`P0001`) when the stage is not in the project; any caller — `anon` included — who holds a (project,
stage) id pair reads the stage's brief, budget rule, assignee name/avatar, latest submission notes and
room id. `viewer_context.role` (`owner` / `assignee` / `viewer`) only shapes the returned permission
flags; it gates nothing.

### `projects.get_ticket_finance(p_ticket_id uuid) → TABLE (total_cost_cents bigint, paid_to_date_cents bigint, locked_escrow_cents bigint, remaining_cents bigint, currency text, installments jsonb)`

`00001120` §2a. The ticket modal's Installment Monitor; prices mirror `finance.fn_hold_ticket_escrow`.
`SECURITY DEFINER`, `search_path = public, projects, finance, org, auth`; default `PUBLIC` `EXECUTE`.
Unknown ticket → `P0001`; then `has_project_access(ticket's project)` → `42501`.

### `projects.get_ticket_timeline(p_ticket_id uuid) → TABLE (id uuid, action_type text, previous_stage_id uuid, new_stage_id uuid, previous_status text, new_status text, changes jsonb, created_at timestamptz, actor_id uuid, actor_name text, actor_avatar_file_id uuid)`

`00001120` §2b. `projects.ticket_history` newest first with the actor's public name. `SECURITY
DEFINER`, `search_path = public, projects, org, auth`; default `PUBLIC` `EXECUTE`. Unknown ticket →
`P0001`; then `has_project_access` → `42501` — the same scope as the _View ticket history_ policy.

### `projects.get_workload_capacity(p_user_id uuid DEFAULT auth.uid(), p_project_id uuid DEFAULT NULL) → jsonb`

`00001140` §4. The Workload Capacity Gauge: `{user_id, current, cap, ratio, ticket_count,
project_current}` from live claimed / in-progress / in-review intensity. `STABLE`, `SECURITY DEFINER`,
`search_path = public, projects, org, security, auth`; default `PUBLIC` `EXECUTE`. Returns `NULL` for a
`NULL` user. **No caller check** — `p_user_id` is caller-supplied, so any caller can read any user's
workload figures.

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

The check is now in place: `SECURITY DEFINER`, `search_path = public, projects, auth`, default `PUBLIC`
`EXECUTE`; `auth.uid() IS NULL` → `42501`, not `p.owner_user_id = auth.uid()` → `42501`. Ids that are
not stages of `p_project_id` are silently skipped. `trg_stage_reorder_lock` (below) raises if any
stage whose position actually changes has already started.

### `projects.delete_stage(p_project_id uuid, p_stage_id uuid) → void`

Releases escrow for claimed tickets in the stage, detaches its tickets to the backlog, scrubs the
stage from every `required_stages` array and from sibling `start_dependency_stage_id`, then deletes
— **unless** the stage carries `finance.escrows` history, in which case it raises
`foreign_key_violation` (`23503`) telling the caller to archive instead. `finance.escrows.project_stage_id`
is `NOT NULL` + `ON DELETE RESTRICT`, so the alternative would be orphaning the finance audit trail.
⚠️ That refusal is a `RAISE`, so it rolls back the **whole call** — the escrow releases, detaches and
scrubs before it included. The function's own comment (and this doc, until 2026-10-05) said the funds
"are still released"; they are not. Any stage that ever held escrow therefore cannot be deleted here
at all.

`SECURITY DEFINER`, `search_path = public, projects, finance, auth`; default `PUBLIC` `EXECUTE`. Guard,
in order: `auth.uid() IS NULL` → `42501`; not `p.owner_user_id = auth.uid()` → `42501`; stage not in
the project → `check_violation` (`23514`).

### `projects.fn_stage_reorder_lock() → trigger`

`trg_stage_reorder_lock` — `BEFORE UPDATE OF sort_order ON projects.project_stages` (`00001850`). When
`sort_order` actually changes, raises (`P0001`) if the stage is past `open` / `assigned`, has any
ticket outside `backlog`, or has any `stage_assignments` row at all. `SECURITY INVOKER`, no
`search_path`; default `PUBLIC` `EXECUTE`, moot.

### `projects.fn_stage_delete_cascade() → trigger`

`trg_stage_delete_cascade` — `BEFORE DELETE ON projects.project_stages` (`00001850`). Calls
`finance.fn_release_ticket_escrow` for every ticket whose `current_stage_id` is the stage, then strips
the stage from every ticket's `required_stages`. `SECURITY DEFINER`, `search_path = public, projects,
finance, org, auth`; no caller check (a trigger). Reached through `delete_stage` (which has already
detached the tickets, so the release loop finds none) or a direct `DELETE` under the owner-only
_Users can manage stages of own projects_ policy, where it **does** release the stage's escrow.

### `projects.fn_enforce_structure_variation() → trigger`

Two bindings in `00001850`: `trg_enforce_structure_variation_tickets` (`BEFORE INSERT ON
projects.tickets`) and `trg_enforce_structure_variation_stages` (`BEFORE INSERT ON
projects.project_stages`). Caps by `projects.structure_variation`: `one_off` ≤ 1 ticket; `single_task`
≤ 1 stage and ≤ 1 ticket; `single_stage` ≤ 1 stage; `standard` / `NULL` unlimited. Raises `P0001`.
`SECURITY INVOKER`, no `search_path`, so the counts are taken under the inserting role's RLS.

### `projects.fn_stage_window(p_stage_id uuid) → tstzrange`

`00001130` §3. A stage's scheduled `[start, end)`: `fixed_start_date` (else `-infinity`) to
`file_due_date`, else `session_end_date` (else `infinity`). `LANGUAGE sql`, `STABLE`, `SECURITY
DEFINER`, `search_path = public, projects`; default `PUBLIC` `EXECUTE`; no caller check (discloses a
stage's dates to anyone holding its id).

### `projects.fn_assignee_slot_conflict(p_stage_id uuid, p_assignee_type assignment_type, p_freelancer_id uuid, p_team_id uuid) → boolean`

`00001130` §4, the double-booking guard `assign_from_application` uses: true when the freelancer /
team holds a live assignment (not `released` / `cancelled` / `declined` / `completed`) on a
**different** stage whose `fn_stage_window` overlaps this one's. `STABLE`, `SECURITY DEFINER`,
`search_path = public, projects`; default `PUBLIC` `EXECUTE`; no caller check (an oracle on whether a
named person is booked in a window).

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
freelancer must not be able to self-confirm delivery. The same rule holds on the table path, where
`trg_ticket_authority_guard` enforces it (see [Escrow settlement doors](#escrow-settlement-doors)).

`p_sort_order` carries the card's new position within its destination lane and is **defaulted**, so
the three-argument call sites that predate it keep resolving to this same function. It is honoured
**only** for a move into `backlog`: `projects.fn_ticket_ordering_guard` RAISES on any `sort_order`
change outside that lane, because every other column is ordered by `updated_at` rather than by hand,
so forwarding a position there would turn an ordinary drag into an error the board cannot explain.

Every move writes a `projects.ticket_history` row, which is why that table has no client write
policy (see [Policies.md](Policies.md)).

`SECURITY DEFINER`, `search_path = public, projects, finance, org, auth`; default `PUBLIC` `EXECUTE`.
Refusals: unknown ticket `no_data_found` (`P0002`); the two authority guards `insufficient_privilege`
(`42501`); a foreign stage `check_violation` (`23514`).

### `projects.claim_ticket(p_ticket_id uuid, p_assignee_id uuid) → uuid`

`00001120` (reworked in `0310`). Self-claim, permitted only when the ticket's stage is in `open_pull`
assignment mode (a ticket with no stage counts as `open_pull`); any other mode → `check_violation`.
Delegates to `fn_assign_ticket_core(p_ticket_id, p_assignee_id, true)`. Returns that call's escrow id
— normally `NULL`, because `trg_ticket_escrow_sync` has already held the escrow on the same `UPDATE`
and the core's second `fn_hold_ticket_escrow` call finds a `held` row and skips. `SECURITY DEFINER`,
`search_path = public, projects, finance, org, security, auth`; default `PUBLIC` `EXECUTE`.

🚨 **No caller check, and the assignee is a parameter.** Nothing compares `p_assignee_id` with
`auth.uid()`, checks it is a freelancer, or refuses a `NULL` `auth.uid()`; the core does not either.
So any caller — `anon` included — can attach any user to any unclaimed, described ticket on an
`open_pull` stage, which holds the client's money in escrow against that user
(`finance.fn_hold_ticket_escrow` debits the payer wallet). See Findings in
[Policies.md](Policies.md#findings).

**Ticket triggers** (`00001110`, bound in `00001850`). The settlement guard is under
[Escrow settlement doors](#escrow-settlement-doors). The rest below are all `FOR EACH ROW` on
`projects.tickets`, default `PUBLIC` `EXECUTE` (moot), with no caller check unless stated.

### `projects.fn_enforce_ticket_due_date() → trigger`

`trg_enforce_ticket_due_date` — `BEFORE INSERT OR UPDATE OF due_date`. Refuses (`P0001`) a non-null
`due_date` unless the project's `allow_deadline_bonuses` is true. `SECURITY INVOKER`.

### `projects.fn_ticket_touch_updated_at() → trigger`

`trg_ticket_touch_updated_at` — `BEFORE UPDATE`. Sets `updated_at = now()`, which orders every
non-backlog column. `SECURITY INVOKER`.

### `projects.fn_enforce_ticket_checkout_desc() → trigger`

`trg_enforce_ticket_checkout_desc` — `BEFORE UPDATE`. On entering checkout (`payment_status`
`unpaid → escrow_funded`, or `status` into `claimed` / `in_progress`) refuses (`P0001`) a ticket whose
`text_description` is blank **and** whose `description` is `NULL` / `{}`. `SECURITY INVOKER`.

### `projects.fn_ticket_ordering_guard() → trigger`

`trg_ticket_ordering_guard` — `BEFORE UPDATE OF sort_order`. Refuses (`P0001`) a `sort_order` change
on any ticket whose `NEW.status` is not `backlog`. `SECURITY INVOKER`.

### `projects.fn_ticket_immutability_guard() → trigger`

`trg_ticket_immutability_guard` — `BEFORE UPDATE`. Once `OLD.current_assignee_id` is set, a caller
who is not that assignee and not `security.is_admin()` cannot change `title`, `description`,
`text_description`, `unit_price_cents`, `required_stages` or `workload_intensity` (`P0001`). A `NULL`
`auth.uid()` is not gated. `SECURITY DEFINER`, `search_path = public, projects, security, auth`.

### `projects.fn_ticket_claim_before() → trigger`

`trg_ticket_claim_before` — `BEFORE UPDATE OF current_assignee_id, status`. Stamps `claimed_at` on a
claim (assignee set from `NULL`, or status into `claimed`); on an assignee being cleared, resets
`status = 'backlog'` and `claimed_at = NULL`. `SECURITY INVOKER`.

### `projects.fn_ticket_escrow_sync() → trigger`

`trg_ticket_escrow_sync` — `AFTER UPDATE OF current_assignee_id, status`. Claim →
`finance.fn_hold_ticket_escrow`; status into `completed` → `finance.fn_release_ticket_escrow`;
assignee cleared → `fn_release_ticket_escrow` (paid to the removed freelancer). `SECURITY DEFINER`,
`search_path = public, projects, finance, org, auth`. Money-moving: on the table path its authority
is the _Manage tickets_ policy plus `trg_ticket_authority_guard`.

### `projects.fn_ticket_delete_protocol() → trigger`

`trg_ticket_delete_protocol` — `BEFORE DELETE`. Releases escrow (`fn_release_ticket_escrow`) when the
ticket has an assignee or a `held` escrow, then lets the delete proceed. `SECURITY DEFINER`,
`search_path = public, projects, finance, org, auth`; gated on the table path by
`trg_ticket_authority_guard`.

### `projects.fn_ticket_review_submission() → trigger`

`trg_ticket_review_submission` — `AFTER UPDATE OF status ON projects.tickets`, bound in `00001820`
(defined in `00001120`). On the transition **into** `in_review`, files a `pending_review`
`stage_submissions` row for the current stage attributed to `current_assignee_id`, unless one is
already pending (the idempotency pair of `submit_deliverable`); skips with a log line when there is no
stage or assignee. `SECURITY DEFINER`, `search_path = public, projects, org, auth`.

---

## Escrow settlement doors

Every `projects` entry point that pays out, refunds or settles escrow (`finance.fn_release_ticket_escrow`,
`fn_refund_ticket_escrow`, `fn_fair_exit_release`). All are `SECURITY DEFINER`, so RLS never sees
the money move: **the guard inside the body and the `EXECUTE` grant are the only authorisation**.
Grants are in `00002510` ("escrow settlement doors").

| Function                                                                         | Defined    | Settles                                                        | `EXECUTE`                        | Body guard                                                   |
| :------------------------------------------------------------------------------- | :--------- | :------------------------------------------------------------- | :------------------------------- | :----------------------------------------------------------- |
| `projects.complete_ticket(p_ticket_id uuid) → void`                              | `00001120` | Ticket → `completed`; releases all its held escrow             | `authenticated`                  | signed in + `can_review_project`                             |
| `projects.delete_ticket(p_ticket_id uuid) → void`                                | `00001120` | Releases a claimed ticket's escrow, then hard-deletes the row  | `authenticated`                  | signed in + `can_review_project`                             |
| `projects.force_complete_stage(p_ticket_id uuid) → uuid`                         | `00001130` | Releases the current installment, advances (and funds) the next | `authenticated`                  | signed in + `can_review_project`                             |
| `projects.approve_stage(p_project_id uuid, p_stage_id uuid) → jsonb`             | `00001150` | Releases every held escrow on the stage; stage → `paid`        | `authenticated`                  | signed in + `can_review_project`; stage ∈ project            |
| `projects.cancel_stage_fair_exit(p_project_id uuid, p_stage_id uuid, p_tier integer) → jsonb` | `00001150` | Pays the tier (25/50/75 %) out, refunds the rest; stage → `cancelled` | `authenticated`        | signed in + `can_review_project`; stage ∈ project            |
| `projects.move_ticket(…)` (→ `completed`)                                        | `00001120` | Via `trg_ticket_escrow_sync`                                   | default                          | `has_project_access`, plus `can_review_project` for Done     |
| `projects.delete_stage(p_project_id uuid, p_stage_id uuid) → void`               | `00001130` | Releases claimed tickets' escrow in the stage                  | default                          | signed in + project **owner**                                |
| `projects.remove_project_member(…)`                                              | `00001130` | Via `release_ticket_to_backlog`                                | `authenticated`                  | project owner                                                |
| `projects.release_ticket_to_backlog(p_ticket_id uuid) → void`                    | `00001120` | Releases a ticket's escrow, resets it to New                   | **none** (owner-only, internal)  | none — reachable only through `remove_project_member`        |
| `projects.fn_release_expired_claims(p_now timestamptz DEFAULT now()) → integer`  | `00001140` | **Refunds** every claim older than the TTL                     | **`service_role`** only          | none — a cron job                                            |

**Authority is review authority, never project access.** `has_project_access` is true for the
assignee — the payee — so every door that settles money asks `projects.can_review_project` (the
owner, or an active member of the paying client business). Until 2026-10-05 `complete_ticket` and
`delete_ticket` had no caller check at all, `approve_stage` / `force_complete_stage` /
`cancel_stage_fair_exit` checked only `has_project_access`, and all five carried the default
`PUBLIC` `EXECUTE` — with `anon` holding `USAGE` on `projects` (Decision #85(e)), anyone with a
ticket id could release its escrow, and a freelancer could approve their own stage.

**Refusals** — authority refusals are `42501` (`insufficient_privilege`); the rest carry a specific
`SQLSTATE` so the fat service can map them to an HTTP status rather than a generic 502:

| Caller                                     | Result                                                                                      |
| :----------------------------------------- | :------------------------------------------------------------------------------------------ |
| `anon`                                     | `permission denied for function …` — the grant refuses before the body runs.                |
| `authenticated` with no `sub`              | `Sign in to …` — the body's own `auth.uid() IS NULL` check (defence in depth behind the grant). |
| Signed in, no review authority (assignee)  | `Only the client/owner may …`                                                               |
| Unknown ticket id                          | `no_data_found` (`P0002`). `delete_ticket` used to return silently; it now refuses.         |
| Stage not in the project (`approve_stage`, `cancel_stage_fair_exit`, also `fund_stage` / `get_stage_finance`) | `no_data_found` (`P0002`). |
| No held escrow on the stage; `fund_stage` on a stage not `assigned` | `object_not_in_prerequisite_state` (`55000`). |
| `cancel_stage_fair_exit` tier not 25/50/75 | `invalid_parameter_value` (`22023`).                                                         |

The three ticket-keyed doors take the ticket row `FOR UPDATE` before the check, so the authority
decision and the release see the same row. `cancel_stage_fair_exit` also refuses a `NULL` tier.

**Why not `service_role`.** Each door attributes its decision to `auth.uid()` and refuses without
one, so a service-role grant could only ever produce a refusal. A backend that needs to settle on a
user's behalf calls with that user's JWT. The sweep is the opposite case: it acts as the platform,
and its `p_now` is caller-supplied — with `PUBLIC` `EXECUTE` anybody could pass a far-future instant
and refund and evict every claimed ticket on the platform.

### `projects.fn_ticket_settlement_guard() → trigger`

`trg_ticket_authority_guard` — `BEFORE UPDATE OF status OR DELETE ON projects.tickets`, defined in
`00001110`, bound in `00001850`. The RPC guards above are worthless on their own: the _Manage
tickets_ policy lets the **assignee** update and delete their own ticket, and
`trg_ticket_escrow_sync` / `trg_ticket_delete_protocol` release escrow on entering `completed` and on
delete — so one `PATCH` or `DELETE` against `/rest/v1/tickets` released the assignee's own escrow
without touching any RPC. The guard refuses (`42501`) entering `completed` and any delete unless the
caller passes `can_review_project`. Ordinary assignee moves (`in_progress`, `in_review`, …) are
untouched. A `NULL` `auth.uid()` — service role, cron, migrations, seeds — is not gated. Named to sort
before `trg_ticket_claim_before` and `trg_ticket_delete_protocol`, so it reads the caller's own
`NEW.status` and refuses before any escrow trigger runs. No role holds `EXECUTE` on it.

**Verification.** `supabase/probes/escrow_settlement_authority.sql` — one transaction ending in
`ROLLBACK`, fixtures discovered from the seed. It asserts every refusal above for `anon`, a
subject-less `authenticated` caller and the assignee (including the direct `UPDATE`/`DELETE`), that
the escrow is still held afterwards, that the assignee's ordinary status move still works, and that
the owner's `approve_stage` and `complete_ticket` succeed and actually release the escrow.

---

## Assignment routing & workload (`00001140`)

How a freelancer comes to hold a ticket, the concurrency caps that bound it, and the workload-report
loop. Every function here is `SECURITY DEFINER` except `file_workload_report`, and none carries an
explicit grant — all keep the default `PUBLIC` `EXECUTE` except `fn_release_expired_claims` (under
[Escrow settlement doors](#escrow-settlement-doors)).

### `projects.check_ticket_capacity(p_ticket_id uuid, p_user_id uuid) → jsonb`

`00001140` §4. The concurrency-cap verdict `{allowed, scope, reason, ticket_intensity,
global_current, global_projected, global_cap, stage_current, stage_projected, stage_cap}`: the user's
live (claimed / in-progress / in-review) intensity excluding this ticket, plus this ticket's, against
`org.freelancer_profiles.max_workload_intensity` (default `security.platform_params
.global_workload_cap_default`, else `10`) and the stage's `max_concurrent_intensity`. Unknown ticket →
`P0001`. `STABLE`, `search_path = public, projects, org, security, auth`. **No caller check**; any
caller can evaluate any user against any ticket.

### `projects.fn_assign_ticket_core(p_ticket_id uuid, p_assignee_id uuid, p_enforce_capacity boolean DEFAULT true) → uuid`

`00001140` §5. The one path that attaches an assignee: locks the ticket `FOR UPDATE`; refuses
(`P0001`) an unknown, already-claimed or description-less (`description` `NULL` / `{}`) ticket; when
`p_enforce_capacity`, refuses a failed `check_ticket_capacity` verdict with `check_violation`; sets
`current_assignee_id`, `claimed_at`, `status = 'claimed'`; returns `finance.fn_hold_ticket_escrow`.
`search_path = public, projects, finance, org, security, auth`.

🚨 **No caller check and default `PUBLIC` `EXECUTE`.** It is an internal primitive (`claim_ticket`,
`assign_ticket_manual`, `auto_assign_round_robin`, `assign_parallel_stream` call it after their own
checks, and the policies file names it as a `ticket_history` writer), yet `anon` can call it directly
with any ticket and any assignee — on **any** stage, bypassing `claim_ticket`'s `open_pull` test too —
and pass `p_enforce_capacity = false` to skip the cap. The claim holds the client's escrow.

### `projects.set_stage_assignment_mode(p_stage_id uuid, p_mode text) → void`

`00001140` §6. Sets `project_stages.assignment_mode` (`p_mode` cast to
`projects.assignment_routing_mode`; a bad value raises `22P02`). Unknown stage → `P0001`; guard
`projects.can_review_project(stage's project)` → `insufficient_privilege` (`42501`).
`search_path = public, projects, auth`.

### `projects.assign_ticket_manual(p_ticket_id uuid, p_assignee_id uuid) → uuid`

`00001140` §6, manual mode: the paying side pins an assignee. Unknown ticket → `P0001`; guard
`can_review_project(ticket's project)` → `42501`; then `fn_assign_ticket_core(…, true)` — capacity
still enforced. Does not check that the assignee is on the roster. `search_path = public, projects,
finance, org, security, auth`.

### `projects.auto_assign_round_robin(p_stage_id uuid) → jsonb`

`00001140` §6. Assigns the stage's next ready ticket (unassigned, `backlog` / `todo`, described; by
`sort_order` then `created_at`) to the `get_project_roster` member with the lowest live intensity who
passes `check_ticket_capacity`. Returns `{assigned, ticket_id, assignee_id}` or `{assigned: false,
reason}`. Unknown stage → `P0001`; guard `can_review_project` → `42501`. Because it reads the roster
through `get_project_roster`, a caller must **also** pass `has_project_access` — a client-business
member who is not the business's owner passes the first check and is refused (`42501`) by the second.

### `projects.assign_parallel_stream(p_stage_id uuid) → integer`

`00001140` §6. Fans every ready ticket in the stage across the roster, each to the lowest-loaded
member with capacity; tickets nobody can take stay in the pool. Returns the count assigned. Same
guards as `auto_assign_round_robin` (`can_review_project`, then `get_project_roster`'s
`has_project_access`).

### `projects.fn_sync_workload_intensity() → trigger`

`trg_sync_workload_intensity` — `AFTER INSERT OR DELETE OR UPDATE OF current_assignee_id, status,
workload_intensity ON projects.tickets` (`00001850`). Recomputes
`org.freelancer_profiles.current_workload_intensity` (rounded live sum) for the old and new assignee.
`search_path = public, projects, org`.

### `projects.file_workload_report(p_ticket_id uuid, p_reason text, p_reported_intensity numeric DEFAULT NULL) → uuid`

`00001140` §8. **`SECURITY INVOKER`** (`search_path = public, projects, auth`): inserts a
`ticket_workload_reports` row with `reporter_user_id = auth.uid()` and the ticket's current intensity,
so the authority is the _File workload report_ policy (reporter is self **and** the ticket's current
assignee) — a non-assignee is refused by RLS (`42501`), and `anon`, which holds no `INSERT` on the
table, by privilege. A blank reason, or a ticket the caller cannot see, → `P0001`. The insert fires
`trg_open_workload_report`.

### `projects.fn_open_workload_report() → trigger`

`trg_open_workload_report` — `AFTER INSERT ON projects.ticket_workload_reports` (`00001850`). The
Frozen rule: clears the ticket's assignee (cascading `fn_ticket_claim_before` → `backlog` and
`fn_ticket_escrow_sync` → escrow **released** to the reporter), stamps `hidden_until = now() +
workload_report_window_hours` (default 48) and `workload_report_id`. `search_path = public, projects,
finance, security, org, auth`.

### `projects.fn_resolve_expired_workload_reports() → integer`

`00001140` §1b, the expiry sweep: every `open` report whose `hidden_until` has passed becomes
`expired_penalized`, the ticket's `hidden_until` is lifted, and a `trust_score` `security.penalties`
row (severity `client_no_adjust_penalty`) is written against the client business or owner. Returns
the count. `search_path = public, projects, security`. **No caller check and default `PUBLIC`
`EXECUTE`**: anyone can run the sweep early. It takes no arguments and only acts on reports that are
genuinely expired, so the damage is timing, but it is an `anon`-callable write.

### `projects.fn_flag_bad_faith_report(p_report_id uuid) → void`

`00001140` (from `0007`), the audit outcome: marks the report `dismissed_bad_faith`, sets the ticket
back to `in_progress` with `hidden_until = NULL`, and inserts a `discovery_rank` `security.penalties`
row (severity `freelancer_bad_faith_penalty`) against the **reporter**. `search_path = public,
projects, security`.

🚨 **No caller check and default `PUBLIC` `EXECUTE`.** Anyone — `anon` included — who holds a report
id can dismiss it and penalise the freelancer who filed it. It is an admin/audit action with no admin
test.

---

## Deliverables

### `projects.submit_deliverable(...) → jsonb`

Files a submission against a stage, links its `files.items` ids (tolerantly — an id with no row is
logged and skipped) and moves the ticket into `in_review`. Guarded by `has_project_access` plus a
stage-belongs-to-project check. Idempotent with `projects.fn_ticket_review_submission`, the trigger
that auto-files a ledger row when a card is dragged into Review: whichever runs first, the other
no-ops.

Full signature: `submit_deliverable(p_ticket_id uuid, p_stage_id uuid, p_title text, p_description
jsonb DEFAULT '{}', p_checked_item_ids jsonb DEFAULT '[]', p_file_ids uuid[] DEFAULT '{}') → jsonb`
(the `fn_serialize_submission` shape). `SECURITY DEFINER`, `search_path = public, projects, org,
files, auth`; default `PUBLIC` `EXECUTE`. Refusals: unknown ticket `P0002`; no project access
`42501`; foreign stage `23514`. Project access, not stage assignment, is the test — any project
participant may file — and the `files.items` ids are linked without checking who owns them.

### `projects.review_submission(...)` / `projects.fund_stage(...)`

Client-side adjudication and funding (`approve_stage`, which pays out, is under
[Escrow settlement doors](#escrow-settlement-doors)). `review_submission` is guarded by
`can_review_project`, locks the submission row, and refuses anything not `pending_review` with
`55000` (`object_not_in_prerequisite_state`) — a reviewer can read an unsent `draft` under RLS, and
re-reviewing a decided one would rewrite the decision. The status check runs after the RBAC check,
so a non-reviewer learns nothing about the submission. `fund_stage` checks `has_project_access` and then, because it spends the
CLIENT's money, resolves the payer from `client_business_id` and requires that business's `spend`
capability (`finance.fn_owner_capability`) — or, with no client business, that the caller is the
owner paying as an individual — since project access alone would let a hired freelancer fund the
client's escrow from the client's wallet ([finance/Functions.md](../finance/Functions.md#stage-level-wrappers-in-projects-invoke-this-engine--migration-0305)).

Signatures: `review_submission(p_submission_id uuid, p_decision text, p_feedback jsonb DEFAULT NULL) →
jsonb` and `fund_stage(p_project_id uuid, p_stage_id uuid) → jsonb`. Both `SECURITY DEFINER`, default
`PUBLIC` `EXECUTE`. `review_submission` (`search_path = public, projects, org, auth`): unknown
submission `P0002`, non-reviewer `42501`, not `pending_review` `55000`, decision other than `accept` /
`request_revision` `23514`; a revision request also files a `stage_revision_requests` row and moves the
ticket back to `in_progress`. `fund_stage` (`search_path = public, projects, finance, comms, org,
auth`): payer refusals `42501`; foreign stage `P0002`; stage not `assigned` `55000`; an individual
owner's wallet short of the stage total `PF402`; nothing fundable `P0001`. On success the stage moves
to `in_progress` and each assignee is notified.

### `projects.fn_serialize_submission(p_submission_id uuid) → jsonb`

`00001150` §2. The shared submission shape (title, description, checked items, status, author,
feedback, `revisionOf`, files with name / MIME / size). `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`,
`search_path = public, projects, org, files, auth`; default `PUBLIC` `EXECUTE`. **No caller check** —
any caller holding a submission id reads it, bypassing _View submissions_.

### `projects.get_stage_submissions(p_project_id uuid, p_stage_id uuid) → jsonb`

`00001150` §3. Every submission on the stage, newest first, as `fn_serialize_submission` rows.
`STABLE`, `SECURITY DEFINER`, `search_path = public, projects, org, files, auth`; default `PUBLIC`
`EXECUTE`. Guard: `has_project_access(p_project_id)` → `42501`; the stage is filtered to that project
in the `WHERE`, so a foreign stage reads as empty.

### `projects.get_stage_finance(p_project_id uuid, p_stage_id uuid) → jsonb`

`00001150`, the Finance tab: stage status, currency, the `accepted` assignment, escrowed / released /
fee totals from `finance.escrows`, the stage's tickets with price and payment status, team payout
splits, and `fundable`. `SECURITY DEFINER`, `search_path = public, projects, finance, org`; default
`PUBLIC` `EXECUTE`. Guard: `has_project_access(p_project_id)` → `42501` (so an assignee reads the
splits too); foreign stage → `P0002`.

---

## Lifecycle

### `projects.set_project_status(p_project_id uuid, p_to_status project_status, p_reason text DEFAULT NULL) → project_status`

The owner-only state machine. `draft|on_hold → active` needs a title and ≥1 stage;
`active|on_hold →
completed` needs every ticket terminal **and** no escrow still held; terminal
states are immutable. Writes `projects.project_status_history` and `projects.project_activity`.
Publishing (`draft → active`) settles the staged seats: every `stage_assignments` row at
`pending_funding` becomes `assigned` and an `open` stage holding one becomes `assigned` — except on a
blueprint-instantiated draft (`source_blueprint_id` set), whose seats stay parked until funded
(Decision #139).

### `projects.fn_project_shape_lock() → trigger`

`trg_project_shape_lock` — `BEFORE UPDATE OF format, structure_variation ON projects.projects`, fired
only when either value actually changes. Refuses (`check_violation`) once any `stage_assignments` row
on the project has a status other than `declined` / `pending_funding` — the same deny-list as
`ONBOARDED_ASSIGNMENT_EXCLUDED` in `packages/types/projects/setup.ts`. The database backstop of
Decision #89's shape lock (Decision #139).

`set_project_status` is `SECURITY DEFINER`, `search_path = public, projects, finance, org, auth`,
default `PUBLIC` `EXECUTE`. Guard: unknown project `P0002`, then `v_owner IS DISTINCT FROM
auth.uid()` → `insufficient_privilege` (`42501`) — owner only, not the client business. Every
transition refusal is `check_violation` (`23514`); `archived` is reachable from any non-terminal state
and is itself terminal. `fn_project_shape_lock` is `SECURITY DEFINER`, `search_path = public,
projects`, bound in `00001820`; default `PUBLIC` `EXECUTE`, moot.

### `projects.tg_project_handover_on_complete() → trigger`

`trg_project_handover_on_complete` — `BEFORE UPDATE OF status ON projects.projects WHEN (NEW.status =
'completed')`, bound in `00001820`, defined in `00001150`. Stamps `handover_unlocked_at = now()` if
unset, so a project completed through `set_project_status` lifts the protected phase just as
`approve_stage`'s last release does. `SECURITY INVOKER`, no `search_path`; default `PUBLIC`
`EXECUTE`, moot.

### `projects.fn_check_public_project_footprint() → trigger`

`trg_check_public_project_footprint` — `BEFORE INSERT OR UPDATE OF status, visibility ON
projects.projects`, bound in `00001820`, defined in `00001140`. Only a row **becoming** `active` +
`public` takes a slot: the limit is `finance.fn_effective_limit` on `business_public_projects` (client
business) or `active_public_projects` (owner), usage `finance.fn_footprint_usage`. At the limit it
emits `entitlement.denied` and refuses with `check_violation` **only** when
`security.platform_params.footprint_caps_enforced` is true. `SECURITY DEFINER`, `search_path =
projects, finance, security, analytics, public`; default `PUBLIC` `EXECUTE`, moot.

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

🚨 **No caller check and default `PUBLIC` `EXECUTE`** — nothing in `00002510` revokes it. `p_now` is
caller-supplied, so any caller (`anon` included) can pass a far-future instant and soft-archive every
un-funded instantiated draft on the platform in one call — the same class as `fn_release_expired_claims`
before it was narrowed to `service_role`.

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
the date it lifts in the message and the exact instant in `DETAIL = 'reopens_at=<ISO-8601 UTC>'`, which
the fat service returns as `details.reopensAt` on its 422). A duplicate open seat is re-raised from
`uq_project_invitations_open_seat` as a readable `unique_violation`. The intro (`p_message`) is stored
through `comms.mask_pii` while the project is in its protected phase, so the contact filter cannot be
skipped by putting a phone number in an invitation; the fat service then posts the same intro into the
pair's DM through `comms.send_request_message` (Decision #128).

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

### `projects.invite_by_email(p_project_id uuid, p_stage_id uuid, p_email text, p_role text) → uuid`

`00001135_functions_projects_membership.sql` (Decision #141). The email-addressed twin of
`invite_to_project`, behind the Members tab's Invite modal (`POST /api/projects/[id]/invites`). Owner
only; refuses a closed project, a role outside `admin · manager · freelancer · member · guest`, a
malformed address (`check_violation`), and a stage of another project. Stores `lower(btrim(email))`
in `target_email` and **never resolves it to `target_user_id`**: the roster re-reads the queue, so a
resolved row would tell the inviter whose account owns the address (the rule
`org.invite_workspace_member` follows). One open offer per (project, stage, address) through
`uq_project_invitations_open_email`, re-raised as a readable `unique_violation`. `placeholder` is
derived as `invite_to_project` derives it. Records `invitation_sent` on `project_activity` and
`project.member_invited` on `security.audit_logs`. The holder of a **verified** matching
`org.user_emails` address (never the caller) is sent `stage.invite` through `comms.fn_notify` in the
same transaction; nothing about whether anyone matched reaches the caller. Refuses a NULL `auth.uid()`
first; `EXECUTE` revoked from `PUBLIC, anon`, granted to `authenticated`.

### `projects.set_member_role(p_project_id uuid, p_participant_id uuid, p_role text) → jsonb`

`00001135_functions_projects_membership.sql` (Decision #141). The Members tab's Change role
(`PATCH /api/projects/[id]/members/[memberId]/role`). Gated on **review authority**
(`can_review_project` — the owner or an active client-business member; else `insufficient_privilege`).
Locks the participant row; refuses a closed project, a role outside the five grantable ones, a row of
another project, an entity participant, and the caller's own row (`check_violation`). Stores
`freelancer` as `'assignee'` — the vocabulary `fn_apply_invitation_decision` writes — and every other
role verbatim. Idempotent (an unchanged role returns `changed: false` and writes nothing). Writes
`security.audit_logs` (`project.member_role_changed`, `{project_id, member_user_id, from, to}`) and
`project_activity` (`member_role_changed`) in the same transaction. **A role is a permission label
only** — no seat, ticket or escrow moves (that is `remove_project_member`). Returns
`{participant_id, role, changed}`. Refuses a NULL `auth.uid()` first; `EXECUTE` revoked from
`PUBLIC, anon`, granted to `authenticated`.

### `projects.fn_apply_invitation_decision(p_invitation_id uuid, p_accept boolean, p_actor uuid) → jsonb`

**The one implementation of an invitation's answer.** Locks the row; refuses anything not `pending`
(and marks a lapsed `expires_at` as `expired` before refusing); refuses an email-addressed row (those
are accepted through their link). A **decline** stamps `declined_at`, logs `invitation_declined` and
notifies the inviter (`invitation.declined`). An **accept** stamps `accepted_at`, enrols the invitee
as a `project_participants` row (`role = 'assignee'` for a freelancer — the staffing RPC's own
vocabulary — else the invitation's role verbatim), takes the stage seat for a freelancer invited to a
stage (`stage_assignments`, `status = 'pending_funding'` while the project is a draft — publishing
promotes it — else `assigned`; refuses a person with no `org.freelancer_profiles` row), moves an
`open` stage to `assigned` on a live project, logs `invitation_accepted`, and notifies the inviter (`invitation.accepted`) with the
slug-addressed `/projects/{slug}/members`. A whole-project freelancer invitation (`project_stage_id` NULL) takes the
project's only stage when it has exactly one (a Task, a flat one-off) and no seat otherwise — a
freelancer is never seated on every stage (Decision #139). Returns `{id, status, participant_id, assignment_id}`.

**No client grant** (`EXECUTE` → `service_role` only). `p_actor` is who the decision is recorded AS;
the caller has already established who may make it. Two doors reach it: the invitee's wrapper below,
and — in DEVELOPMENT only — the fat service's `decideInvite`, through the service-role client, after
the row has been read back under the caller's RLS as its inviter. That is what lets the Dev Tools
Invites window force an answer that writes exactly the rows a real answer writes.

### `projects.respond_to_project_invitation(p_invitation_id uuid, p_accept boolean) → jsonb`

The invitee's own door: the row must be addressed to `auth.uid()` (`insufficient_privilege`
otherwise); delegates to `fn_apply_invitation_decision`. `EXECUTE` → `authenticated`. Reached by
`POST /api/projects/invites/respond` — the conversation context panel's Accept request / Decline,
which answers every invitation of one request together (Decision #128).

### `projects.remove_project_member(p_project_id uuid, p_participant_id uuid, p_stage_id uuid DEFAULT NULL) → jsonb`

The client removes a hired freelancer from ONE stage (`p_stage_id`) or from the whole project
(`NULL`). Owner-only; refuses a non-freelancer participant (a business participant is the paying
side). Applies `PRODUCT_SPEC.md` §Freelancer Removal Mid-Ticket: every ticket the person holds within
the scope — `claimed`, `in_progress` or `in_review` — goes through `projects.release_ticket_to_backlog`
(escrow released to them in full, ticket back to New), their held `stage_assignments` in scope become
`released`, the accepted invitations the removal undoes gain `dismissed_at` (their acceptance kept as
history), and a whole-project removal deletes the `project_participants` row — which the
participant arms of `has_project_access` read with no status test, so deleting it is what withdraws
access. (The released assignments stopped granting access on their own on 2026-09-28; a
stage-scoped removal leaves the participant row, and with it project access.) Logs
`member_removed` / `member_unassigned`. Returns the counts it APPLIED (`claimed_tickets`,
`submitted_tickets`, `started_stages`) so the confirmation the client saw can be read back against
what happened. `EXECUTE` → `authenticated`.

## Applications (`00001130` §6b / §11, Decision #128)

The freelancer-led half of `PRODUCT_SPEC.md` §The Hiring Process ("The Inbound Request").

### `projects.apply_to_project(p_project text, p_stage text, p_role_id uuid DEFAULT NULL, p_message text DEFAULT NULL) → jsonb`

`SECURITY DEFINER`, `EXECUTE` → `authenticated`. The caller applies to one stage (slug or id) of a
project (slug or id), naming a staffing role where the stage lists them. Refuses, in the database's
own words: no caller (`insufficient_privilege`), a note over the hire-message limit (`22023`), an
unknown project (`no_data_found`), the owner's own project, a project that is not `active` and
`public`/`unlisted`, a caller with no freelancer profile, a stage of another project or one not
taking applications, a role not open to applications (all `check_violation`), a person already on
the stage, and a second pending application for the same target (`unique_violation`). Inserts the
`project_applications` row (`pending`) with its `project_application_targets` row, the cover note
masked while the project is protected, logs `application_submitted` on `project_activity`, and
notifies the owner (`application.received`, deep-linked to the applicant's DM). Returns
`{ id, projectId, projectSlug, ownerUserId, stageId, roleId, status, message }`; the fat service
then posts the note through `comms.send_request_message` into the owner's Requests.

### `projects.assign_from_application(p_application_id uuid) → jsonb`

The owner confirms an applicant's seat — whatever the application targeted (a stage, a role or an
open seat). Gated on **review authority** — `projects.can_review_project(project)`, i.e. the owner
or an active client-business member, else `insufficient_privilege` (the message says "project owner";
the predicate is wider); an unknown id is `no_data_found`; anything not `pending` is a
`check_violation` naming its status. A candidate already on the stage is `unique_violation`, one
booked on an overlapping stage (`fn_assignee_slot_conflict`) `exclusion_violation`; accepts of one
candidate are serialised by an advisory lock. A freelancer is also enrolled as a `project_participants`
row (`role = 'assignee'`). `SECURITY DEFINER`, `search_path = public, projects, comms, org, auth`;
default `PUBLIC` `EXECUTE` (no explicit grant). Takes the seat as a `stage_assignments` row (`assigned`), marks the application
`accepted`, and — for a seat — fills it and marks that seat's other pending applications `rejected`;
moves an `open` stage to `assigned`, and notifies the applicant (`application.accepted`, deep-linked
to `/projects/{slug}`). The client lands on funding next — the seat is real once its escrow is.

### `projects.reject_application(p_application_id uuid) → jsonb`

`00001130` §7b, `SECURITY DEFINER`; `EXECUTE` → `authenticated` (revoked from `public`/`anon` in
`00002510`). The owner declines an applicant — the Members tab's Requests section. Locks the
application row first (so a concurrent accept and decline cannot both land), then refuses: an unknown
id (`no_data_found`), a caller who cannot review the project (`insufficient_privilege`), anything not
`pending` (`check_violation`, naming its status). Marks the application `rejected` — the same status a
filled seat gives its other applicants, so "declined" and "not selected" are one state to the
applicant — logs `application_rejected` on `project_activity`, and notifies the applicant
(`application.declined`, deep-linked to their conversation with the owner). Nothing else moves: no
assignment existed, so nothing is released. Returns `fn_serialize_application`.

### `projects.get_engagement_context(p_counterpart uuid) → jsonb`

`SECURITY DEFINER`, `EXECUTE` → `authenticated`. The conversation context panel's one read: between
the caller and one counterpart, every invitation (bar revoked ones) and application (bar withdrawn
ones) in either direction, ten each, newest first, with the project's title, slug and visibility, the stage, role, offer and status, the
intro or cover note, the brief, the target's intake answers and the assignment state; the milestones
of the projects involved; and the counterpart's Standing (`org.fn_standing_level`) when they sell.
It reads ONLY rows the caller is a party to — the inviter or invitee, the applicant or the owner.

### `projects.fn_engaged_projects(p_user_id uuid) → TABLE (project_id uuid)`

`00001100`. Every project a user is engaged in — owner, participant, live assignee or team member,
pending/accepted invitee or applicant. Read by the DM contact filter
(`comms.fn_dm_protected_project`). **No client role may execute it.**

🚨 **`projects.release_ticket_to_backlog(uuid)` had the default `PUBLIC` EXECUTE and no caller check
of its own** — any signed-in caller who knew a ticket id could release its escrow and un-claim it (the
`reorder_stages` class, Decision #84). It had no application caller. `00002510` now revokes its
EXECUTE from `public`/`anon`/`authenticated`; `remove_project_member` still reaches it because a
DEFINER function executes as its owner.

## Open seats & staffing (`00001130` §5–§8, `00001140` §7)

The posted-seat half of staffing (US-006), its serializers, and the proposal-allowance meter. All
`SECURITY DEFINER` with the default `PUBLIC` `EXECUTE` — none has an explicit grant.

### `projects.create_stage_open_seat(p_stage_id uuid, p_description text, p_budget_min_cents bigint DEFAULT NULL, p_budget_max_cents bigint DEFAULT NULL, p_require_proposals boolean DEFAULT true, p_skill_ids uuid[] DEFAULT '{}') → jsonb`

`00001130` §5. Inserts a `stage_open_seats` row (`description_of_need` defaults to `Open seat`) and a
`stage_open_seat_skills` row per skill id that exists in `org.skills`; returns `fn_serialize_seat`.
`search_path = public, projects, org, auth`. Unknown stage → `no_data_found`; guard
`can_review_project(stage's project)` → `insufficient_privilege`; min > max budget →
`check_violation`. It is the only writer of `stage_open_seat_skills`, which has no client write policy.

### `projects.apply_to_seat(p_seat_id uuid, p_applicant_type text, p_applicant_profile_id uuid, p_message text DEFAULT NULL) → jsonb`

`00001130` §6. Files a `pending` `project_applications` row (`applicant_user_id = auth.uid()`) with a
`seat` target; returns `fn_serialize_application`. `search_path = public, projects, org, auth`.
Refusals, in order: `auth.uid() IS NULL` → `insufficient_privilege`; type not `freelancer` / `team` →
`check_violation`; unknown seat → `no_data_found`; seat not `open` → `check_violation`; a team
application whose caller fails `org.is_team_lead(p_applicant_profile_id)`, or a freelancer
application whose `p_applicant_profile_id <> auth.uid()` → `insufficient_privilege`; a duplicate
pending application → `unique_violation`. Unlike `apply_to_project` it does **not** check that the
project is `active` and discoverable, that the caller is not its owner, or that they have a freelancer
profile, and it neither masks the note in the protected phase nor notifies the owner. Fires
`trg_meter_application_allowance`.

### `projects.fn_serialize_seat(p_seat_id uuid) → jsonb`

`00001130` §8. A seat's description, budget range, `requireProposals`, status, filled assignment,
required skills and pending-application count. `LANGUAGE sql`, `STABLE`, `search_path = public,
projects, org`. **No caller check** — reads any seat by id, bypassing _View seats public or own_.

### `projects.fn_serialize_application(p_application_id uuid) → jsonb`

`00001130` §8. An application's project, seat, applicant type / profile / user / display name,
`message` and status — the return shape of `apply_to_seat`, `assign_from_application` and
`reject_application`. `LANGUAGE sql`, `STABLE`, `search_path = public, projects, org`. **No caller
check** — any caller holding an application id reads the applicant and their cover note, bypassing
_View own or owned applications_.

### `projects.get_stage_staffing(p_project_id uuid, p_stage_id uuid) → jsonb`

`00001130` §8. `{seats: [seat + applications[]], assignments: [...]}` for one stage. `STABLE`,
`search_path = public, projects, org, auth`. Guard: `has_project_access(p_project_id)` →
`insufficient_privilege`. ⚠️ It never checks that `p_stage_id` belongs to `p_project_id`, so a caller
with access to any one project can read another project's seats, applicants (with cover notes) and
assignments by pairing their own project id with a foreign stage id. `get_stage_submissions` and
`get_stage_finance` both make that check.

### `projects.fn_meter_application_allowance() → trigger`

`trg_meter_application_allowance` — `AFTER INSERT ON projects.project_applications`, bound in
`00001820`. Spends one `weekly_proposals` unit (`finance.fn_consume_allowance`) from the applicant —
the team when `applicant_type = 'team'`, else the user. When the allowance is exhausted it emits
`entitlement.denied` and refuses with `check_violation` **only** when
`security.platform_params.proposal_allowance_enforced` is true. `search_path = projects, finance,
security, analytics, public`; default `PUBLIC` `EXECUTE`, moot.

### `projects.fn_refund_withdrawn_application() → trigger`

`trg_refund_withdrawn_application` — `AFTER UPDATE OF status ON projects.project_applications`, bound
in `00001820`. On the transition into `withdrawn`, returns the unit (`finance.fn_refund_allowance`).
`search_path = projects, finance, public`; default `PUBLIC` `EXECUTE`, moot.
