# projects: Functions

Functions and RPCs for the `projects` schema. Tables: [Tables.md](Tables.md) · Policies:
[Policies.md](Policies.md).

99 functions — every `CREATE FUNCTION projects.*` in `supabase/migrations/` — each with its
signature, security context, `EXECUTE` holders and caller check. Defined in `00001100`–`00001150`;
trigger bindings in `00001800` / `00001820` / `00001850`; explicit grants in `00002510` and beside a
handful of definitions.

**Reading the `EXECUTE` line.** `projects` is **deny-by-default** (`00002510`, "projects — deny by
default"): every function is revoked from `PUBLIC` and `anon` and granted to `service_role`, and a
client role (`anon`, `authenticated`) holds `EXECUTE` only where it is granted by name — so each
entry names its holders. "Owner only" means no client role and no `service_role`: only a `SECURITY
DEFINER` caller, running as the owner, reaches it. For a trigger function `EXECUTE` is moot: Postgres
refuses to call one outside a trigger (`0A000`). An error marked `P0001` is a bare `RAISE EXCEPTION`
with no `ERRCODE`.

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

`SECURITY DEFINER` (plpgsql, not `STABLE`), `search_path = public, projects, org, auth`; `EXECUTE`:
`anon`, `authenticated`, `service_role` (a policy predicate, so it must run as the invoking role). No
caller check of its own — it answers for `auth.uid()`, so a guest gets `false`.

### `projects.can_review_project(_project_id uuid) → boolean`

`00001100` §2. The "client viewer" authority: `p.owner_user_id = auth.uid() OR
(p.client_business_id IS NOT NULL AND org.is_active_business_member(p.client_business_id))`.
Deliberately **not** true for an assignee. It gates reads (`/details`, `/preview`, the client side of
the board — Decision #163), comments and the client-side configuration doors, and is the FIRST check
of every adjudicating door; on a business project the doors that commit the business additionally
ask a capability ([Business authority](#business-authority-one-capability-per-act-bb2)), so a plain
member reads and reviews but cannot hire, release escrow, bill a project to the business or fund it.
BB2 deliberately did not narrow this predicate.
`LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `search_path = public, projects, org, auth`; `EXECUTE`:
`anon`, `authenticated`, `service_role` (it is a policy predicate, so it must run as the invoking
role). An unknown id and a guest both answer `false`.

### `projects.can_manage_project_members(_project_id uuid) → boolean`

`00001100` §2 (Decision #145). **Staffing authority**: `can_review_project(_project_id)`, or the caller
holds a person-participant row on the project whose `role` is `admin` or `manager` (written by
`set_member_role` or an accepted invitation). The gate on inviting, answering requests, cancelling or
dismissing invitations and managing a stage's invite link, and the SELECT arm on
`project_invitations`, `project_applications`, `project_application_targets` and
`stage_invite_links`. Appointing an admin or manager is NOT covered — each issuing door re-checks
`can_review_project` for those two roles. `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`; `EXECUTE`:
`anon`, `authenticated`, `service_role` (a policy predicate, so it must run as the invoking role).
Unchanged by BB2 (it still answers the SELECT arms); on a business project the staffing WRITE doors
additionally require `hire` or a delegate role through `fn_assert_business_actor(…, 'hire', true)`.

### `projects.is_ticket_manager(_project_id uuid) → boolean`

`00001100` §2 (Decision #294). TRUE when the caller is a **delegated ticket manager**: a
person-participant row on the project with `role IN ('admin', 'manager')` and `can_manage_tickets`,
on a project billed to a business (`client_business_id IS NOT NULL`). The predicate behind the
_Ticket managers compose tickets_ / _edit tickets_ policies; what such a caller may change is narrowed
again by `fn_ticket_immutability_guard`. It is not review authority: it approves, hires, funds and
settles nothing. `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`; `EXECUTE`: `anon`, `authenticated`,
`service_role` (a policy predicate).

### Business authority: one capability per act (BB2)

`00001100` §2b (BUSINESSES_AUDIT BF13–BF15, BF23, §4.2). On a project billed to a business
(`client_business_id`), `can_review_project` admits every active member — right for reads, wrong for
the acts that commit the business. Those ask three predicates, each answering only about
`auth.uid()`; a personal project keeps its owner-only behaviour.

- **`projects.fn_business_actor_can(p_project uuid, p_cap org.workspace_capability) → boolean`** —
  the project's `owner_user_id`, or the project is billed to a business on which the caller holds
  `p_cap` (`org.fn_member_can`: role ∪ granted − revoked). The project's owner keeps the authority
  they created it with whatever they hold on the business. `LANGUAGE sql`, `STABLE`, `SECURITY
  DEFINER`, `search_path = ''`; `EXECUTE`: `authenticated`.
- **`projects.fn_assert_business_actor(p_project uuid, p_cap org.workspace_capability,
  p_allow_delegate boolean DEFAULT false) → void`** — the typed refusal: **`PK403`
  `missing_permission: <cap>`** (HINT names the permission to ask for) and, for `hire`, FIRST
  **`55000 business_not_active:`** when the paying business is not `active`
  (`org.fn_assert_business_active`, BB5) — for everyone, the project's owner included, before the
  capability and delegate tests. A no-op on a personal project
  and for a `NULL` `auth.uid()` (service role, cron, seeds); with `p_allow_delegate` a
  person-participant whose project `role` is `admin` / `manager` passes too (Decision #145). Each
  door calls it AFTER its own authority check, so a stranger still gets that door's wording. plpgsql,
  `STABLE`, `SECURITY DEFINER`, `search_path = ''`; internal (`EXECUTE` revoked from client roles).
- **`projects.fn_can_fund_project(p_project uuid) → boolean`** — the funder predicate. A personal
  project: its owner. A business project: vault `spend` on the business wallet in the project's
  currency (`finance.fn_has_vault_capability`), or `spend_funds` (`org.fn_member_can`) before that
  wallet exists. **Owning a business project is not a licence to spend the business's money** — a
  spend-less project owner is refused. `has_project_access` is not consulted (a read predicate granted
  to `anon` that admits the assignee, and which a spend-only member does not pass). plpgsql (the vault
  helper is created later, in `00001210`), `STABLE`, `SECURITY DEFINER`, `search_path = ''`;
  `EXECUTE`: `authenticated`.

| Door | Business-project requirement | Refusal |
| :-- | :-- | :-- |
| `assign_from_application`, `reject_application`, `invite_to_project`, `invite_by_email`, `act_on_invitation`, `get_stage_invite_link`, `revoke_stage_invite_link` | `hire`, or a delegate (`admin`/`manager` participant) | `PK403 missing_permission: hire`; `55000 business_not_active` (draft / archived business, BB5) |
| Offering `admin`/`manager` (`invite_to_project`, `invite_by_email`), `set_member_role` | `hire` (no delegate) | `PK403 missing_permission: hire`; `55000 business_not_active` (draft / archived business, BB5) |
| `assign_ticket_manual`, `auto_assign_round_robin`, `assign_parallel_stream` | `hire` | `PK403 missing_permission: hire`; `55000 business_not_active` (draft / archived business, BB5) |
| `review_submission` with `accept`, `approve_stage`, `force_complete_stage`, `cancel_stage_fair_exit` | `hire` | `PK403 missing_permission: hire`; `55000 business_not_active` (draft / archived business, BB5) |
| Any ticket entering `completed`, or a delete that settles a claimed/funded ticket (`fn_ticket_settlement_guard` — covers `complete_ticket`, `move_ticket`, `delete_ticket` and the table path) | `hire` | `PK403 missing_permission: hire`; `55000 business_not_active` (draft / archived business, BB5) |
| `create_project` with `client_business_id`; re-pointing `client_business_id` (`fn_guard_project_ownership`) | `manage_projects` on that business | `PK403 missing_permission: manage_projects`; `create_project` also `55000 business_not_active` (draft / archived business, BB5) |
| `fund_stage`, `fund_ticket`, `fund_paid_revision`, `get_stage_funding_quote`, `finance.begin_card_payment` (`escrow_lock`) | `fn_can_fund_project` | `PK403 not_funder: …` |
| `finance.place_wallet_order`, `finance.place_on_account_order` (business basket) | `purchase` on top of vault `spend` | `PK403 missing_permission: purchase` |

Unchanged: `review_submission` with `request_revision` (moves no money), every read, and
`remove_project_member` (already the project owner's alone, narrower than `hire`). The backend maps
each refusal to a 403 whose `details.reason` is `hire` · `purchase` · `manage_projects` ·
`not_funder` (`packages/backend/core/business-authority.ts`, `@projective/types/workspace`
`BusinessAuthorityReason`); the screens' wording is BU6's. Proven by
`supabase/probes/business_authority.sql` (owner · admin · `member` preset · a custom spend-only role ·
a project owner without `hire`).

### `projects.is_cohort_member(_cohort_id uuid) → boolean`

`00001100` §2. True when the caller holds a `projects.cohort_memberships` row for the cohort. The
member arm of _View cohorts_ and _View session events_. It is `SECURITY DEFINER` to break a policy
cycle: an inline `EXISTS` on `cohort_memberships` re-enters that table's policy, whose owner arm reads
`cohorts`, and Postgres refused every authenticated read of the three tables with "infinite recursion
detected in policy". `LANGUAGE sql`, `STABLE`, `search_path = public, projects, org, auth`; `EXECUTE`:
`anon`, `authenticated`, `service_role` (a policy predicate, so it must run as the invoking role).
Answers only for `auth.uid()`; a guest gets `false`.

### `projects.has_stage_access(p_stage_id uuid) → boolean`

`00001100` (from `0308`). Stage-scoped membership for stage rooms and the _Insert own submissions_
policy: `false` for an unknown stage; else true when `can_review_project(stage's project)`, or the
caller is a freelancer (`freelancer_profile_id = auth.uid()`) or an active member of a team holding an
assignment on **that stage** whose status is not `released` / `cancelled` / `declined`. `STABLE`,
`SECURITY DEFINER`, `search_path = public, projects, org, auth`; `EXECUTE`: `anon`, `authenticated`,
`service_role` (a policy predicate, so it must run as the invoking role).

### `projects.is_protected_phase(p_project_id uuid) → boolean`

`00001100` (from `0311`). `COALESCE((SELECT handover_unlocked_at IS NULL FROM projects.projects WHERE
id = p_project_id), true)` — true until the Projective Unlock, and **true for an unknown id**, so the
PII mask fails closed. `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `search_path = public, projects`.
`EXECUTE`: `authenticated`, `service_role` (`00002510`; it discloses one boolean per project id). No
caller check. **The one protected-phase predicate** (SEC L4 (c)): the stage-room mask, the DM mask
(`comms.fn_dm_protected_project`) and the request / invitation / application masks all read it, and
only the Unlock ends the phase — `status` is not part of it, so `cancelled` does not lift the filter.

### `projects.get_viewer_hired_teams(p_project_id uuid) → TABLE (team_id uuid, project_stage_id uuid)`

One row per stage of the project held by a team the **caller** is an active member of
(`org.team_members.status = 'active'`), through a live `assignee_type = 'team'` assignment. `SECURITY
DEFINER`, `STABLE`, `search_path = ''`; `EXECUTE`: `authenticated`, `service_role`. Defined in
`00001100`.

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

**Caller.** `insertProject` (`packages/backend/services/projects/live-writes.ts`) sends the Quick-Init
payload built by `createProjectPayload` — title, `format` / `structure_variation`, the optional brief,
`currency`, the `fixed_price` budget pair, and ONE explicit root stage carrying the baseline price —
so the root stage, its room and the Discussion room commit with the row or not at all (Decision #195).
`live-create.test.ts` holds every payload key against the keys this body reads.

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
| `client_business_id` / `owner_team_id` / `owner_enterprise_id` | payload, membership-checked | Active membership of that workspace is required; the three are mutually exclusive. Personal scope is the **absence** of all three. A business also needs the caller to hold `manage_projects` on it (`PK403 missing_permission: manage_projects`, BB2) and a published business: `55000 business_not_active` for a draft or archived one (`org.fn_assert_business_active`, BB5). |

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
'Discussion')`, visibility `project_all`; named for the lane view it is, Decision #146): it is what `/projects/[slug]/discussion` opens on every
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

`EXECUTE`: `authenticated`, `service_role`.

`SECURITY DEFINER`, `search_path = public, projects, org, comms, auth`. Refuses a `NULL` `auth.uid()`
first with `28000` (`Not authenticated`), and a blank title with `23514`.

### `projects.fn_payload_text_array(p_value jsonb) → text[]`

Reads a text array out of an untrusted jsonb payload, answering `{}` for everything that is not an
array. `IMMUTABLE`, no security context of its own.

The bare `ARRAY(SELECT jsonb_array_elements_text(x))` idiom it replaces is correct only for an
ABSENT key. One function rather than a `jsonb_typeof` CASE repeated at six call sites, so "how do we
read a list out of a payload" has one answer that cannot drift between the project and its stages.

`LANGUAGE sql`, `SECURITY INVOKER`, no `search_path`; `EXECUTE`: `service_role` only — no client
grant (pure, touches no table; `create_project` reaches it as its owner).

### `projects.update_entity_project_counts() → trigger`

`trg_update_project_counts` — `AFTER INSERT OR UPDATE OF status OR DELETE ON projects.projects`, bound
in `00001800`. Recomputes `total_project_count` / `active_project_count` on the owning
`org.business_profiles` row (when `client_business_id` is set) or on the owner's `org.users_public` row
(using `OLD` on delete). `SECURITY DEFINER`, `search_path = public, projects, org`: as `INVOKER` its
update matched zero rows under the caller's RLS and its cascade into `search.sync_user_to_index()`
raised `42501` on `search.profiles_index`, aborting every app-level project insert. No caller check
(a trigger); `EXECUTE` moot.

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
`EXECUTE`: `service_role` only — no client grant; a `NULL` `auth.uid()` matches nothing.

### `projects.get_project_details(p_project_id uuid) → TABLE (project_id uuid, title text, format text, status text, is_starred boolean, allow_deadline_bonuses boolean, target_project_start_date timestamptz, timeline_preset text, owner jsonb, viewer_context jsonb, stages jsonb)`

`00001100` (from `0116`). `SECURITY DEFINER`, `search_path = public, projects, org, auth`;
`EXECUTE`: `service_role` only — no client grant. Resolves the caller's role first — `owner` (owner,
or owner of the client business), else `collaborator` (a freelancer / owned-business participant, or **any**
`stage_assignments` row for the caller or an active team of theirs — this arm has no status filter,
unlike `has_project_access`) — and raises `Access Denied` (`P0001`) when neither applies.
`viewer_context.permissions` lists `manage_settings` / `manage_members` / `view_financials` for the
owner only.

### `projects.get_project_card_summary(p_project_id uuid) → jsonb`

`00001100` (from `0122`). The Quick Inspector blob: status, currency, stage count, live ticket column
counts, `pending_submissions`, `held_escrows`, `next_milestone_at`. `STABLE`, `SECURITY DEFINER`,
`search_path = public, projects, finance, org, auth`; `EXECUTE`: `service_role` only — no client
grant. Guard: `IF NOT projects.has_project_access(p_project_id)` → `insufficient_privilege` (`42501`); an unknown id
fails that check first, so its `no_data_found` branch is unreachable in practice.

### `projects.get_project_roster(p_project_id uuid) → TABLE (profile_id uuid, name text, avatar jsonb, role text)`

`00001100` (from `0118`). The ticket "Reassign" picker: freelancer participants plus every freelancer
on a stage assignment, de-duplicated. The assignment arm has **no status filter**, so a declined or
released freelancer still appears. `SECURITY DEFINER`, `search_path = public, projects, org, files,
auth`; `EXECUTE`: `service_role` only — no client grant. Guard: `has_project_access(p_project_id)` →
`42501`. Also called
inside `auto_assign_round_robin` / `assign_parallel_stream`, where the same guard applies to their
caller.

### `projects.get_stage_details(p_project_id uuid, p_stage_id uuid) → TABLE (stage_id uuid, project_id uuid, title text, description jsonb, description_text text, sort_order int, status text, ip_mode text, file_upload_required boolean, default_tasks jsonb, skills text[], due_date timestamptz, scheduling jsonb, channel_id uuid, budget jsonb, assignee jsonb, latest_submission jsonb, viewer_context jsonb, assignment_mode text)`

`00001100` (from `0104`). `SECURITY DEFINER`, `search_path = public, projects, org, auth`;
`EXECUTE`: `service_role` only — no client grant. 🚨 **No access check** — moot for clients, because
no client role holds `EXECUTE`. The only refusal is `Stage not found or access denied` (`P0001`) when
the stage is not in the project; a caller who holds a (project, stage) id pair reads the stage's brief, budget rule, assignee name/avatar, latest submission notes and
room id. `viewer_context.role` (`owner` / `assignee` / `viewer`) only shapes the returned permission
flags; it gates nothing.

### `projects.get_ticket_finance(p_ticket_id uuid) → TABLE (total_cost_cents bigint, paid_to_date_cents bigint, locked_escrow_cents bigint, remaining_cents bigint, currency text, installments jsonb)`

`00001120` §2a. The ticket modal's Installment Monitor; prices mirror `finance.fn_hold_ticket_escrow`.
`SECURITY DEFINER`, `search_path = public, projects, finance, org, auth`; `EXECUTE`: `service_role`
only — no client grant. Unknown ticket → `P0001`; then `has_project_access(ticket's project)` →
`42501`.

### `projects.get_ticket_timeline(p_ticket_id uuid) → TABLE (id uuid, action_type text, previous_stage_id uuid, new_stage_id uuid, previous_status text, new_status text, changes jsonb, created_at timestamptz, actor_id uuid, actor_name text, actor_avatar_file_id uuid)`

`00001120` §2b. `projects.ticket_history` newest first with the actor's public name. `SECURITY
DEFINER`, `search_path = public, projects, org, auth`; `EXECUTE`: `service_role` only — no client
grant. Unknown ticket → `P0001`; then `has_project_access` → `42501` — the same scope as the _View ticket history_ policy.

### `projects.get_workload_capacity(p_user_id uuid DEFAULT auth.uid(), p_project_id uuid DEFAULT NULL) → jsonb`

`00001140` §4. The Workload Capacity Gauge: `{user_id, current, cap, ratio, ticket_count,
project_current}` from live claimed / in-progress / in-review intensity. `STABLE`, `SECURITY DEFINER`,
`search_path = public, projects, org, security, auth`; `EXECUTE`: `service_role` only — no client
grant. Returns `NULL` for a `NULL` user. **No caller check** — moot for clients, because no client
role holds `EXECUTE`; `p_user_id` is caller-supplied, so a caller can read any user's workload
figures.

---

## Lane activity (`00001145`)

The Project Details lane's per-viewer activity marks (Decision #146). Both RPCs are **`SECURITY
INVOKER`** with `search_path = ''`, so every count is taken under the caller's RLS — that is what splits
the roles. `EXECUTE`: `authenticated`, `service_role` (`00002510`, "lane view activity marks"); each
body also refuses a `NULL` `auth.uid()` with `42501`.

### `projects.get_nav_activity(p_slug text) → jsonb`

`STABLE`. `NULL` when the slug resolves to nothing the caller can read; otherwise one object per lane
view: `overview.changes` (`details` — `projects.updated_at`, non-owners only · `status` —
`project_status_history` by someone else · `stages` — a stage created (non-owners) or completed, or an
owner-visible `project_activity` row on `project_stages`), `discussion.unread` (messages by others in the
discussion room — a Task's root stage room, else the project-wide room — capped at 10),
`board.tone` (`new`: a ticket created by someone else or, for non-owners, a new stage · `moved`: a
`stage_moved`/`status_changed` history row by someone else), `timeline.tone` (`deadline`: an open
stage's `file_due_date` inside 48 h that has entered that window since the last look — ignores the
first-visit floor · `update`: a stage completed/created or a `milestone_confirmed` by someone else),
`files.fresh` (non-owners: the owner attached a file in a readable project room),
`submissions.count` (reviewers: `pending_review` work by others · everyone else: verdicts on their own
submissions; capped at 100) and `members.count` (arrivals; for `can_manage_project_members` also
pending applications, declines and expiries; capped at 100). A view never opened is measured from the
caller's first mark on the engagement, else from now. An archived stage (`archived_at`) is ignored by
the Task discussion-room lookup and the deadline tone (Decision #163).

### `projects.mark_view_seen(p_slug text, p_view text) → timestamptz`

`VOLATILE`. Upserts `projects.view_reads` for `(auth.uid(), project, p_view)` at `now()` and returns it;
`NULL` for an unreadable slug. An unknown view fails the table's CHECK (`23514`).

### `projects.fn_touch_updated_at() → trigger`

`BEFORE UPDATE ON projects.projects` (`trg_projects_touch_updated_at`, `00001820`): `NEW.updated_at :=
now()`. `EXECUTE` moot (a trigger).

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
defaults; verified by executing one. `EXECUTE`: `authenticated`, `service_role`, granted by name on
the six-argument signature in `00002510`.

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
`comms.project_channels` whose RLS the caller does not otherwise satisfy. **The authority check is
therefore the only thing standing between a signed-in caller and somebody else's pipeline**, and it
is deliberately the first thing the body does — an unauthenticated caller and anyone without
`projects.can_review_project` (the owner, or an active member of the paying client business; owner
only before Decision #163) both get `insufficient_privilege`.

### `projects.reorder_stages(p_project_id uuid, p_ordered_ids uuid[]) → void`

Atomic bulk restamp of stage `sort_order`. Ticket order is independent of stage order, so each
column's internal ticket sequence is preserved automatically.

🚨 **It shipped with no caller check at all.** It is `SECURITY DEFINER`, so the `UPDATE` runs as the
owner and RLS never sees it, and `authenticated` holds `EXECUTE` — so without the check any signed-in
caller who knew a project id and its stage ids could reorder somebody else's pipeline. Stage order is the execution sequence, so that is a change to what gets built when,
not a cosmetic one.

Authority is **review authority** (`projects.can_review_project`; ownership only before
Decision #163), not `has_project_access`: an assigned freelancer legitimately reads the pipeline and
must not be able to rewrite the client's sequencing. `search_path` includes `auth` so `auth.uid()` resolves.

The check is now in place: `SECURITY DEFINER`, `search_path = public, projects, auth`, `EXECUTE`:
`authenticated`, `service_role`; `auth.uid() IS NULL` → `42501`, not `can_review_project(p_project_id)` → `42501`. Ids that are
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

`SECURITY DEFINER`, `search_path = public, projects, finance, auth`; `EXECUTE`: `authenticated`,
`service_role`. Guard, in order: `auth.uid() IS NULL` → `42501`; not `can_review_project(p_project_id)` → `42501` (owner only
before Decision #163); stage not in the project → `check_violation` (`23514`).

### `projects.sanitize_single_room_topology(p_project_id uuid) → jsonb`

`00001130` (Decision #163). Called at the end of every live save that leaves the project a Task
(`one_off` + `single_stage` | `single_task`) or a Session, so the engagement presents one shared room.
A **Task** keeps its root stage (lowest `sort_order`, then `created_at`) and retires every other
non-archived stage with its rooms; a **Session** keeps its stages (they are its sessions) and retires
every stage-bound room. The project-wide room is never touched (Decision #135). Retiring is a hard
delete (participants, staffing roles, budget rules and dependants' `start_dependency_stage_id` cleared
first) only when `fn_stage_has_history` / `fn_room_has_history` is false; otherwise the row (and a
stage's rooms) gets `archived_at = now()`. Returns `{sanitized: false}` for any other shape, else
`{sanitized, deleted_stages, archived_stages, deleted_rooms, archived_rooms}`; a second call is a
no-op.

`SECURITY DEFINER`, `search_path = public, projects, comms, finance, auth`; `EXECUTE`:
`authenticated`, `service_role`. Guard: `auth.uid() IS NULL` or not `can_review_project(p_project_id)` → `42501`; unknown
project → `P0002`.

### `projects.fn_stage_has_history(p_stage_id uuid) → boolean` / `projects.fn_room_has_history(p_channel_id uuid) → boolean`

`00001130` (Decision #163). The sanitizer's history probes. A room has history when it holds
`comms.project_messages`, `comms.channel_files` (`channel_type = 'project'`) or `scheduling.events`. A
stage has history when any ticket sits in it or requires it, any `ticket_history` row names it, or it
has a submission, assignment, open seat, invitation, invite link, escrow, invoice, basket item, order
line or inbound payment — or any of its rooms has history. Staffing roles and budget rules are
configuration, not history. `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `search_path = public`.
**`EXECUTE`: owner only** (`00002510`; no client role and no `service_role`): they answer for any id,
so only the sanitizer (which re-asks review authority) calls them, as their owner.

### `projects.fn_stage_reorder_lock() → trigger`

`trg_stage_reorder_lock` — `BEFORE UPDATE OF sort_order ON projects.project_stages` (`00001850`). When
`sort_order` actually changes, raises (`P0001`) if the stage is past `open` / `assigned`, has any
ticket outside `backlog`, or has any `stage_assignments` row at all. `SECURITY INVOKER`, no
`search_path`; `EXECUTE` moot (a trigger).

### `projects.fn_stage_delete_cascade() → trigger`

`trg_stage_delete_cascade` — `BEFORE DELETE ON projects.project_stages` (`00001850`). Calls
`finance.fn_release_ticket_escrow` for every ticket whose `current_stage_id` is the stage, then strips
the stage from every ticket's `required_stages`. `SECURITY DEFINER`, `search_path = public, projects,
finance, org, auth`; no caller check (a trigger), `EXECUTE` moot. Reached through `delete_stage`
(which has already detached the tickets, so the release loop finds none) or a direct `DELETE` under
the review-authority _Users can manage stages of own projects_ policy, where it **does** release the
stage's escrow.

### `projects.fn_enforce_structure_variation() → trigger`

Two bindings in `00001850`: `trg_enforce_structure_variation_tickets` (`BEFORE INSERT ON
projects.tickets`) and `trg_enforce_structure_variation_stages` (`BEFORE INSERT ON
projects.project_stages`). Caps by `projects.structure_variation`: `one_off` ≤ 1 ticket; `single_task`
≤ 1 stage and ≤ 1 ticket; `single_stage` ≤ 1 stage; `standard` / `NULL` unlimited. Archived stages
(`archived_at`) are not counted (Decision #163). Raises `P0001`.
`SECURITY INVOKER`, no `search_path`, so the counts are taken under the inserting role's RLS.
`EXECUTE` moot (a trigger).

### `projects.fn_stage_window(p_stage_id uuid) → tstzrange`

`00001130` §3. A stage's scheduled `[start, end)`: `fixed_start_date` (else `-infinity`) to
`file_due_date`, else `session_end_date` (else `infinity`). An undated stage is therefore
`[-infinity, infinity)` and overlaps every other window. `LANGUAGE sql`, `STABLE`, `SECURITY
DEFINER`, `search_path = public, projects`; `EXECUTE`: `service_role` only — no client grant; no
caller check (moot for clients; it discloses a stage's dates to a caller holding its id).

### `projects.fn_assignee_slot_conflict(p_stage_id uuid, p_assignee_type assignment_type, p_freelancer_id uuid, p_team_id uuid) → boolean`

`00001130` §4, the double-booking guard `assign_from_application` and `fn_apply_invitation_decision`
use: true when the freelancer /
team holds a live assignment (not `released` / `cancelled` / `declined` / `completed`) on a
**different** stage whose `fn_stage_window` overlaps this one's. `STABLE`, `SECURITY DEFINER`,
`search_path = public, projects`; `EXECUTE`: `service_role` only — no client grant; no caller check
(moot for clients; an oracle on whether a named person is booked in a window).

---

## Tickets

### `projects.move_ticket(p_ticket_id uuid, p_to_status ticket_status, p_to_stage_id uuid DEFAULT NULL, p_sort_order integer DEFAULT NULL) → jsonb`

The guarded column transition the board calls. Returns the updated ticket row as `jsonb`.

| Guard               | Rule                                                    |
| :------------------ | :------------------------------------------------------ |
| Any transition      | `projects.has_project_access(project)`                  |
| → `completed`       | **additionally** `projects.can_review_project(project)` |
| Cross-project stage | `p_to_stage_id` must belong to the ticket's project.    |
| → `claimed` / `in_progress` / `in_review` from outside work | an escrow must be held — the no-hold-no-work gate in `trg_ticket_escrow_sync` raises `PF402` (Decision #165) |
| Another stage, on a claimed ticket | **additionally** `projects.can_review_project(project)` — refused `42501` by `trg_ticket_immutability_guard`, because the hold is priced from the current stage (Decision #291) |
| Any move of a claimed ticket | `projects.fn_assert_ticket_move` (below, Decision #293): only its assignee or review authority; the assignee only between `todo` / `in_progress` / `in_review` (and out of `claimed`); review authority not while it is `claimed` / `in_progress` (#94); nobody into `claimed`, `cancelled` or `reported_hidden` |

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

`SECURITY DEFINER`, `search_path = public, projects, finance, org, auth`; `EXECUTE`: `authenticated`,
`service_role`. The ticket row is read `FOR UPDATE`, so the move is judged on the row it writes.
Refusals: unknown ticket `no_data_found` (`P0002`); the authority guards `insufficient_privilege`
(`42501`); a foreign stage `check_violation` (`23514`); entering work with no held escrow `PF402`
("Needs funding — …", from the trigger).

### `projects.fn_assert_ticket_move(p_project_id uuid, p_assignee_id uuid, p_from_status ticket_status, p_to_status ticket_status, p_from_stage uuid, p_to_stage uuid) → void`

`00001110`. Who may move a **claimed** ticket (`p_assignee_id` set), Decision #293. Returns when the
move is allowed and raises `42501` otherwise. Called by `move_ticket`, which is a definer that RLS
never sees, and by `fn_ticket_immutability_guard` for a statement PostgREST runs directly.

| Caller | Allowed | Refusal |
| :----- | :------ | :------ |
| Neither the assignee nor review authority (another freelancer, a member or a delegate without `can_review_project`) | nothing | "Only the client or the freelancer working this ticket may move it." |
| Anyone gated | never **into** `claimed`, `cancelled` or `reported_hidden`. A claim enters `claimed`, the stage's cancellation (`cancel_stage_fair_exit`) enters `cancelled` and a workload report enters `reported_hidden`. | "A ticket enters that state by a claim, its stage's cancellation or a workload report, never by a move." |
| The assignee | from `todo` / `claimed` / `in_progress` / `in_review` to `todo` / `in_progress` / `in_review`. A stage change is then the stage rule's to refuse (#291). | "You move your ticket between To do, In progress and In review; any other move is the client's." |
| Review authority | any move except from `claimed` / `in_progress`: status or stage (#94) | "A freelancer is working this ticket — it can be moved once the work is handed back." |

Why `claimed` is closed: a move into it restamps `claimed_at` (`fn_ticket_claim_before`), and
`fn_release_expired_claims` refunds an expired claim to the client in full. Verified by execution
against the earlier definitions: the client moved a ticket handed back for review to `claimed`, and the
sweep refunded the whole 800,000 hold to the client, so the freelancer was paid nothing for delivered work.

Not gated: an unclaimed ticket, an unchanged status and stage, one person on both sides (the assignee
who also holds `can_review_project`), `security.is_admin()`, a `NULL` `auth.uid()`. The reporting
assignee moving a `reported_hidden` ticket is left to the suspension guard, which refuses it (#290).
`SECURITY INVOKER`, `STABLE`, `search_path = public, projects, security, auth`; `EXECUTE`:
`authenticated`, because the INVOKER trigger calls it as that role. It writes nothing. Regression
probe: `supabase/probes/ticket_move_authority.sql`.

### `projects.claim_ticket(p_ticket_id uuid, p_assignee_id uuid) → uuid`

`00001120` (reworked in `0310`). Self-claim only. Guards, in order: `auth.uid() IS NULL` → `42501`
("Sign in to claim a ticket."); `p_assignee_id` ≠ `auth.uid()` → `42501` (pinning someone else is
`assign_ticket_manual`); unknown ticket → `no_data_found` (`P0002`); not
`has_project_access(ticket's project)` → `42501`; the ticket's stage not in `open_pull` assignment
mode (a ticket with no stage counts as `open_pull`) → `check_violation`; the caller holds no live
seat on the ticket's stage — a `stage_assignments` row in `assigned` / `accepted`, their own
(`assignee_type = 'freelancer'`) or an accepted team's they are an active member of — or the ticket has
no stage → `42501` "You are not hired on this ticket's stage, so you cannot claim it." (Decision #338
(i): project access alone let a freelancer seated on one stage hold the client's money for work on
another). Then delegates to
`fn_assign_ticket_core(p_ticket_id, p_assignee_id, true)` and returns its answer: the held escrow's id,
or `NULL` when the hold was **refused** — the claim did not happen and the ticket is now
`needs_funding` (Decision #165). `SECURITY DEFINER`,
`search_path = public, projects, finance, org, security, auth`; `EXECUTE`: `authenticated`,
`service_role`.

A signed-in caller cannot attach another person to a ticket — and so cannot hold the client's escrow
against them; `supabase/probes/function_grants.sql` is the regression check.

**App caller:** `POST /api/projects/ticket/claim` `{ projectId, ticketId }` (`ClaimTicketSchema`) →
`ProjectBackendService.claimTicket` → `live-claim.ts` `claimTicketRow`, in the caller's JWT with
`p_assignee_id` always the session's own user. The board's **Claim** control and a provider's drag of
an unclaimed card into In Progress both land here — never on `move_ticket`, which sets no assignee and
so always meets `PF402` from the escrow sync. `claimRefusal` words each refusal: `NULL` → 402
`needs_funding`; `PK403 payout_not_ready` → 403 with the payout gate's `details` (fix link for
`self`); `PM403` → the age gate's 403; a cap breach → 409 `over_capacity` in the database's own
sentence; a lost race → 409 `already_claimed`; no description → 422; not `open_pull` → 422; no seat
→ 403 `not_permitted` in the database's sentence; a ticket not open to claim → `refusalFrom`'s answer.
`supabase/probes/claim_seat_and_price_lock.sql` is the regression check for the seat and status rules.

**Ticket triggers** (`00001110`, bound in `00001850`). The settlement guard is under
[Escrow settlement doors](#escrow-settlement-doors). The rest below are all `FOR EACH ROW` on
`projects.tickets`, `EXECUTE` moot (triggers), with no caller check unless stated.

### `projects.fn_enforce_ticket_due_date() → trigger`

`trg_enforce_ticket_due_date` — `BEFORE INSERT OR UPDATE OF due_date`. Refuses (`P0001`) a non-null
`due_date` unless the project's `allow_deadline_bonuses` is true. `SECURITY INVOKER`.

### `projects.fn_ticket_touch_updated_at() → trigger`

`trg_ticket_touch_updated_at` — `BEFORE UPDATE`. Sets `updated_at = now()`, which orders every
non-backlog column. `SECURITY INVOKER`.

### `projects.fn_enforce_ticket_checkout_desc() → trigger`

`trg_enforce_ticket_checkout_desc` — `BEFORE UPDATE`. On entering checkout (`payment_status`
`unpaid` / `needs_funding` → `escrow_funded`, or `status` into `claimed` / `in_progress`) refuses (`P0001`) a ticket whose
`text_description` is blank **and** whose `description` is `NULL` / `{}`. `SECURITY INVOKER`.

### `projects.fn_ticket_ordering_guard() → trigger`

`trg_ticket_ordering_guard` — `BEFORE UPDATE OF sort_order`. Refuses (`P0001`) a `sort_order` change
on any ticket whose `NEW.status` is not `backlog`. `SECURITY INVOKER`.

### `projects.fn_ticket_immutability_guard() → trigger`

`trg_ticket_immutability_guard` — `BEFORE INSERT OR UPDATE`. A claimed ticket's terms bind both
parties (Decision #291): what the client's wallet is held for is not the payee's to rewrite, and
what the freelancer agreed to deliver is not the client's.

| Rule | Who it binds | Refusal |
| :--- | :----------- | :------ |
| Once `OLD.current_assignee_id` is set, `title`, `description`, `text_description`, `unit_price_cents`, `required_stages` and `workload_intensity` do not change | Every signed-in caller, **the assignee included** | Client side `P0001` "…its content is locked to the client."; the assignee `42501` "You claimed this ticket on its client's terms…" |
| Once claimed, `current_stage_id` moves only with `projects.can_review_project` | The assignee, and another freelancer on the project, on every path — `move_ticket` included | `42501` "Only the client moves a claimed ticket to another stage." |
| A claimed ticket's `status` / `current_stage_id` move by `projects.fn_assert_ticket_move` (under [Tickets](#tickets), Decision #293). A change of assignee is not a move. | A statement run as `anon` / `authenticated`. `move_ticket` applies the same rule itself. | `42501`, the predicate's sentences |
| A statement never names or swaps a `current_assignee_id` — an `INSERT` with one, or an `UPDATE` that sets or changes it; clearing it (the owner's removal) stays a direct statement. Work is handed out only through `fn_assign_ticket_core`'s doors, which ask for the seat, the caps, the age and payout gates and the routing mode; a swap would also leave the held escrow bound to the previous payee (Decision #338 (i)) | A statement run as `anon` / `authenticated` | `42501` "A ticket is claimed or assigned through the board, not written to somebody directly." |
| An `INSERT` that names a `current_assignee_id` needs `projects.can_review_project` (the definer doors' backstop; a direct statement already met the row above) | Every signed-in caller | `42501` "A ticket is written by its client; a freelancer claims it." |
| `payment_status` and `total_amount_paid` do not change; an `INSERT` starts them `unpaid` / `0` | A statement run as `anon` / `authenticated` | `42501` |
| A ticket manager's statement changes only the composer's columns (`title`, `description`, `text_description`, `current_stage_id`, `owner_user_id`, `priority`, `workload_intensity`, `required_stages`, `tasks`, `due_date`, `unit_price_cents`, `sort_order`); its `INSERT` starts unclaimed in `backlog` | A statement run as `anon` / `authenticated` by neither the owner nor the ticket's assignee — admitted only by the _Ticket managers_ policies (Decision #294) | `42501` "You may edit a ticket's content for the client, not its assignee, status or payment." / "A ticket you write for the client starts unclaimed in the backlog…" |

Why each is money: `finance.fn_hold_ticket_escrow` holds `COALESCE(unit_price_cents, current
stage's price)`, and approving a stage holds the next required one at once (the Chain Reaction,
Decision #210), so an assignee who could edit the price chose the figure the client's wallet was
held at next. Verified by execution: a tenfold edit, then the client's approval, held 8,000,000 for
an 800,000 stage. The stage pointer decides which stage's price is held and where the chain counts
the next installment from; `required_stages` decides how many installments there are. The
`projects` schema is exposed and _Manage tickets_ admits a self-assigned `INSERT`, which let the
payee write a ticket at its own price into the client's project. `finance.fn_auto_fund_drain` holds
any `needs_funding` ticket on a from-wallet business project, so a client statement that flips
`payment_status` started a hold nobody asked for.

Exempt: one person on both sides (the assignee who also holds `can_review_project`, as on a personal
project), `security.is_admin()`, and a `NULL` `auth.uid()` (the platform, cron, seed). The
bookkeeping rule judges only a client role's own statement: **`SECURITY INVOKER` on purpose**, so
inside a definer door — the claim's hold, a release, the chain — `current_user` is the door's owner
and the escrow functions that keep those columns pass. A statement that restates the current value
(PostgREST patching a whole row back) passes, because nothing moved.

**Delegated ticket managers (Decision #294).** A ticket's content is the client's; a freelancer
writes it only as a project manager the business client explicitly let manage tickets
([`projects.set_ticket_manager`](#projectsset_ticket_managerp_project_id-uuid-p_participant_id-uuid-p_allowed-boolean--jsonb)).
Such a manager acts for the client and is bound like the client: once a ticket is claimed its terms
are frozen (`P0001`) and its stage moves only with review authority. On an unclaimed ticket they
change the composer's columns and nothing else — an assignee is a hire, a status a move, the claim
and workload-report markers and the payment bookkeeping a settlement, each with its own door — and
they delete nothing (no policy admits it). A manager who is also a ticket's assignee is held to that
ticket as its payee. Regression probe: `supabase/probes/ticket_managers.sql`.

The workload-report window turns the `workload_intensity` rule round (Decision #290): while
`OLD.status = 'reported_hidden'` the assignee can change neither `status` nor `workload_intensity`
(`42501`, checked before the admin exemption), and the client may **raise** `workload_intensity` —
the answer to the report (`fn_adjust_workload_report`). Regression probe:
`supabase/probes/ticket_terms_payee_lock.sql`. `search_path = public, projects, security, auth`.

### `projects.fn_ticket_claim_before() → trigger`

`trg_ticket_claim_before` — `BEFORE UPDATE OF current_assignee_id, status`. Stamps `claimed_at` on a
claim (assignee set from `NULL`, or status into `claimed`); on an assignee being cleared, resets
`status = 'backlog'` and `claimed_at = NULL`. `SECURITY INVOKER`.

### `projects.fn_ticket_escrow_sync() → trigger`

`trg_ticket_escrow_sync` — `AFTER UPDATE OF current_assignee_id, status`. Claim with an assignee →
`finance.fn_hold_ticket_escrow`, whose refusal (`PF402`) aborts the claim; status into `completed` →
`finance.fn_release_ticket_escrow`; assignee cleared → `fn_release_ticket_escrow` (paid to the removed
freelancer). **The work-start gate (Decision #165):** entering `claimed` / `in_progress` / `in_review`
from any other status without a `held` escrow raises `PF402` "Needs funding — …" (`DETAIL`
`{state: 'needs_funding', reason: 'not_held'}`). On the trigger so `claim_ticket`, the routing RPCs,
`move_ticket` and a direct row write all meet it; moves between work states (a revision's
`in_review → in_progress`) are not an entry and are not gated. `SECURITY DEFINER`,
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
| `projects.force_complete_stage(p_ticket_id uuid) → uuid`                         | `00001130` | Releases the current installment, advances to the next and holds it (the Chain Reaction, when the next stage's `chain_reaction` is on) | `authenticated`                  | signed in + `can_review_project`                             |
| `projects.approve_stage(p_project_id uuid, p_stage_id uuid) → jsonb`             | `00001150` | Completes every hired ticket still holding escrow on the stage (via `fn_settle_ticket_stage`), releasing it; refunds a still-unclaimed prepaid ticket without completing it; stage → `paid` (#194, #213). Returns `released_count` / `refunded_count` (tickets), `total_paid_cents`, `fee_cents`, `refunded_cents`, `splits` | `authenticated`                  | signed in + `can_review_project`; stage ∈ project; stage row locked and unsettled (#188) |
| `projects.cancel_stage_fair_exit(p_project_id uuid, p_stage_id uuid, p_tier integer) → jsonb` | `00001150` | Pays the tier (25/50/75 %) out, refunds the rest; stage → `cancelled`; the tickets left on it → `cancelled`; both sides notified (#198) | `authenticated`        | signed in + `can_review_project`; stage ∈ project; stage row locked and unsettled (#188) |
| `projects.move_ticket(…)` (→ `completed`)                                        | `00001120` | Via `trg_ticket_escrow_sync`                                   | `authenticated`, `service_role`  | `has_project_access`, plus `can_review_project` for Done; a claimed ticket from `claimed` / `in_progress` not even then (#94, `fn_assert_ticket_move`, #293) |
| `projects.delete_stage(p_project_id uuid, p_stage_id uuid) → void`               | `00001130` | Releases claimed tickets' escrow in the stage                  | `authenticated`, `service_role`  | signed in + `can_review_project` (Decision #163)             |
| `projects.remove_project_member(…)`                                              | `00001130` | Via `release_ticket_to_backlog`                                | `authenticated`, `service_role`  | project owner                                                |
| `projects.release_ticket_to_backlog(p_ticket_id uuid) → void`                    | `00001120` | Releases a ticket's escrow, resets it to New                   | **none** (owner-only, internal)  | none — reachable only through `remove_project_member`        |
| `projects.fn_release_expired_claims(p_now timestamptz DEFAULT now()) → integer`  | `00001140` | **Refunds** every claim older than the TTL                     | **`service_role`** only          | none — a cron job                                            |

**Fair Exit — the quote, the preview and the door (Decision #198).**
`projects.fn_fair_exit_quote(p_stage_id uuid, p_tier integer) → jsonb` (`00001150`, internal, no
grant) reads — without moving anything — what a Fair Exit at `p_tier` settles: every escrow still
held on the tickets that hold escrow on the stage, split by `finance.fn_fair_exit_split` exactly as
`finance.fn_fair_exit_release` splits it, a ticket holding a prepaid (unclaimed) escrow refunded
whole. It answers `{ tier, ticket_count, held_cents, prepaid_cents, freelancer_paid_cents,
fee_cents, client_refunded_cents }` (`client_refunded_cents` includes the prepaid money).
`projects.preview_stage_fair_exit(p_project_id uuid, p_stage_id uuid) → jsonb` (`00001150`,
`authenticated`; signed in + `can_review_project`, `42501` otherwise; `P0002` for a stage outside
the project) is the confirmation's read: `{ stage_id, stage_name, stage_status, currency,
exitable, blocked, held_cents, tickets_to_cancel, tiers }`, `tiers` holding the quote at 25, 50
and 75. `blocked` is `settled` for a stage outside the unsettled set and `nothing_held` when
nothing is held — the two states the door refuses. `cancel_stage_fair_exit` locks the stage, then
the tickets it will settle in id order, takes the same quote, runs the split, and reports
`{ tier, cancelled_count, tickets_cancelled, freelancer_paid_cents, fee_cents,
client_refunded_cents, currency, stage_status }` from that quote (the old figures summed
`finance.transactions`, which has no row for a payout still in its pending window since #191). It
then closes every ticket still standing on the stage (not `completed` / `cancelled` — a ticket
suspended by a workload report included, since it keeps its assignee and its hold, Decision #290) as
`cancelled`, lifting any report countdown (`hidden_until`), with a `ticket_history` row (`reason: fair_exit`, `tier`),
cancels any paid revision round still `awaiting_payment`, and notifies both sides with
`stage_cancelled` (`stage.cancelled` in the catalog): every payee and team-split recipient the
split paid plus the stage's assignees (`fn_notify_payees`), and the project owner plus the reviewer
who ended it (payload: the quote, `currency`, `tickets_cancelled`). Probe:
`supabase/probes/fair_exit_settlement.sql`.

**Authority is review authority, never project access.** `has_project_access` is true for the
assignee — the payee — so every door that settles money asks `projects.can_review_project` (the
owner, or an active member of the paying client business). Until 2026-10-05 `complete_ticket` and
`delete_ticket` had no caller check at all, `approve_stage` / `force_complete_stage` /
`cancel_stage_fair_exit` checked only `has_project_access`, and all five carried the default
`PUBLIC` `EXECUTE` — with `anon` holding `USAGE` on `projects` (Decision #85(e)), anyone with a
ticket id could release its escrow, and a freelancer could approve their own stage.

`force_complete_stage` is the Chain Reaction (Decision #210, PRODUCT_MANAGEMENT §3.6). After releasing
the current installment it reads the NEXT stage's `project_stages.chain_reaction`. On (the default) it
moves the ticket there `in_progress` and holds that stage's escrow through `fn_hold_ticket_escrow` in a
subtransaction, from the paying wallet's live balance: when that hold is refused (`PF402`, Decision
#165) the approval still stands and the installment already earned is still released, but the ticket
waits in the next stage as `todo`, `needs_funding` (`fn_mark_needs_funding`, its DETAIL tagged
`trigger: chain_reaction`), instead of `in_progress` on unheld money. Off, it moves the ticket there
`todo` / `unpaid` (Draft) without a hold, for `fund_ticket` / `fund_stage` to fund later. Each outcome
writes one `ticket_history` row — `chain_held` · `chain_needs_funding` · `chain_off` — and a wait
(refused or off) tells the assignee `ticket.awaiting_funding`. Probe: `supabase/probes/chain_reaction.sql`.

**Settlement completes the ticket (Decision #194).** `approve_stage` and `review_submission('accept')`
settle each ticket through `projects.fn_settle_ticket_stage(p_ticket_id, p_stage_id, p_reason) → uuid[]`:
it locks the ticket, snapshots its held escrows and, when the ticket stands on that stage, calls
`force_complete_stage` — on the final required stage that is the `completed` status write, so the
settlement guard and `trg_ticket_escrow_sync` release the escrow and `payment_status` lands
`released`. It writes a `ticket_history` row (`changes.reason`) and, on completion, a
`milestone_confirmed` activity row, releases anything from the snapshot still held directly, and
returns only the escrows this call released — which is what `approve_stage` sums into
`total_paid_cents` / `fee_cents` / `splits`. `projects.fn_notify_payees(...)` notifies each
individual payee and every `finance.payout_splits` recipient once. Both are internal (no `EXECUTE`
grant). `approve_stage` also notifies the project owner and, when another client member approved,
that approver; the stage's assignees are read BEFORE settlement, since a Pipeline ticket advances to
its next stage when this one completes (Decision #213).

**Unbound prepaid escrow is not work (Decision #213).** A ticket whose held escrow on the stage has no
payee (prepaid, nobody claimed it — Decision #197) is not settled through `fn_settle_ticket_stage`:
`approve_stage` refunds it with `finance.fn_refund_ticket_escrow` and leaves the ticket's status where
it stands (`payment_status` → `unpaid`). With no bound escrow on the stage at all — held or released —
nobody was hired, and the approval is refused before anything moves. `released_count` counts the
tickets this call paid, `refunded_count` / `refunded_cents` the ones it refunded; the owner's
"Stage settled" notification carries both.

`approve_stage`'s handover check (the last settled stage completes the project) ignores archived
stages (`archived_at`, Decision #163), so a retired stage never holds the handover open.

**Refusals** — authority refusals are `42501` (`insufficient_privilege`); the rest carry a specific
`SQLSTATE` so the fat service can map them to an HTTP status rather than a generic 502:

| Caller                                     | Result                                                                                      |
| :----------------------------------------- | :------------------------------------------------------------------------------------------ |
| `anon`                                     | `permission denied for function …` — the grant refuses before the body runs.                |
| `authenticated` with no `sub`              | `Sign in to …` — the body's own `auth.uid() IS NULL` check (defence in depth behind the grant). |
| Signed in, no review authority (assignee)  | `Only the client/owner may …`                                                               |
| Unknown ticket id                          | `no_data_found` (`P0002`). `delete_ticket` used to return silently; it now refuses.         |
| Stage not in the project (`approve_stage`, `cancel_stage_fair_exit`, also `fund_stage` / `get_stage_finance`) | `no_data_found` (`P0002`). |
| Nothing ever funded on the stage (none held, none released — a stage its acceptances already paid settles, #194); `fund_stage` on a stage not `open` / `assigned` / `in_progress` (#197) | `object_not_in_prerequisite_state` (`55000`). |
| `approve_stage` on a stage with no bound escrow — only prepaid escrow nobody has claimed (#213) | `object_not_in_prerequisite_state` (`55000`) — "Nobody has been hired on this stage …". |
| Stage already settled — `approve_stage` on a stage not `open` / `assigned` / `in_progress` / `submitted` / `revisions` / `approved`; `cancel_stage_fair_exit` on one not in that set less `approved` (Decision #188) | `object_not_in_prerequisite_state` (`55000`) — "This stage is already paid / cancelled …". |
| `cancel_stage_fair_exit` tier not 25/50/75 | `invalid_parameter_value` (`22023`).                                                         |

**Exactly once under concurrency (Decision #188).** `approve_stage` and `cancel_stage_fair_exit`
take the stage row `FOR UPDATE` before anything settles and refuse a stage that is no longer
unsettled, so a second approval, a second cancellation, or an approval racing a cancellation waits on
the lock, then finds the stage `paid` / `cancelled` and is refused (`55000`) without moving money.
Underneath, every release, refund and fair-exit split locks the ticket and its held escrow rows and
flips each one only while it is still `held` (`database/finance/Functions.md`), which also covers
the ticket-keyed doors racing a stage door. Lock order is stage → ticket → escrow → wallet. Before
#188 neither door locked or checked the stage, so any stage with held escrow could be approved — even
one already `paid` or `cancelled` — and two concurrent approvals both paid the payee.

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
caller passes `can_review_project`; on a business project, entering `completed` and a delete that
settles a claimed or funded ticket also need `hire` (`fn_assert_business_actor`, `PK403
missing_permission: hire`, BB2) — so every completion path, RPC or table, answers to one rule. Ordinary assignee moves (`in_progress`, `in_review`, …) are
untouched. A `NULL` `auth.uid()` — service role, cron, migrations, seeds — is not gated. Named to sort
before `trg_ticket_claim_before` and `trg_ticket_delete_protocol`, so it reads the caller's own
`NEW.status` and refuses before any escrow trigger runs. No role holds `EXECUTE` on it.

**Verification.** `supabase/probes/escrow_settlement_authority.sql` — one transaction ending in
`ROLLBACK`, fixtures discovered from the seed. It asserts every refusal above for `anon`, a
subject-less `authenticated` caller and the assignee (including the direct `UPDATE`/`DELETE`), that
the escrow is still held afterwards, that the assignee's ordinary status move still works, and that
the owner's `approve_stage` and `complete_ticket` succeed and actually release the escrow.
`supabase/probes/escrow_release_concurrency.sql` (Decision #188) races two real sessions on one stage
— approve × 2, cancel × 2, cancel vs approve both ways — plus the finance functions on one ticket,
asserts the second adds no ledger row, and that both doors refuse a `paid` / `cancelled` stage. It
commits, so it runs against a disposable copy of the database (recipe in its header).

---

## Assignment routing & workload (`00001140`)

How a freelancer comes to hold a ticket, the concurrency caps that bound it, and the workload-report
loop. Every function here is `SECURITY DEFINER` except `file_workload_report`; each entry names its
`EXECUTE` holders (`fn_release_expired_claims` is under
[Escrow settlement doors](#escrow-settlement-doors)).

### `projects.check_ticket_capacity(p_ticket_id uuid, p_user_id uuid) → jsonb`

`00001140` §4. The concurrency-cap verdict `{allowed, scope, reason, ticket_intensity,
global_current, global_projected, global_cap, stage_current, stage_projected, stage_cap}`: the user's
live (claimed / in-progress / in-review) intensity excluding this ticket, plus this ticket's, against
`org.freelancer_profiles.max_workload_intensity` (default `security.platform_params
.global_workload_cap_default`, else `10`) and the stage's `max_concurrent_intensity`. Unknown ticket →
`P0001`. `STABLE`, `search_path = public, projects, org, security, auth`; `EXECUTE`: `service_role`
only — no client grant. **No caller check** — moot for clients, because no client role holds
`EXECUTE`; a caller can evaluate any user against any ticket.

### The earning gate on the staffing doors (Decision #196)

Every door that lands a gig calls `finance.fn_assert_payout_ready` (`database/finance/Functions.md`):
`apply_to_seat` and `apply_to_project` (the person, or the team's shareholders), `redeem_invite_link`,
`assign_from_application` (re-checked at acceptance), `fn_apply_invitation_decision` (accepting a
`freelancer`-role invitation; a manager's and any decline are not gated) and
`fn_assign_ticket_core`. The core asks `projects.fn_ticket_assignee_payout_ready(ticket, assignee)`
→ boolean first: true when a team holds the ticket's stage (an `accepted` team assignment — the
escrow's payee is then the team, cleared when it was seated), else `fn_freelancer_payout_ready`.
`auto_assign_round_robin` and `assign_parallel_stream` use the same predicate to SKIP an unready
roster member rather than fail the run. The predicate has no client grant.

### `projects.fn_assign_ticket_core(p_ticket_id uuid, p_assignee_id uuid, p_enforce_capacity boolean DEFAULT true) → uuid`

**Age gate:** an assignee under 18 is refused `PM403` (`org.fn_assert_adult`, Decision #190), so no self-claim, manual
pin or routed assignment seats a minor on paid work.

`00001140` §5. The one path that attaches an assignee: locks the ticket `FOR UPDATE`; refuses
(`P0001`) an unknown, already-claimed or description-less (`description` `NULL` / `{}`) ticket, and
(`check_violation`, "This ticket is not open to claim.") one whose `status` is not `backlog` or `todo` —
only open work is handed out, New included because a removal or an expired claim returns a ticket there
"so another freelancer can claim it" (PRODUCT_SPEC §Freelancer Removal Mid-Ticket); when
`p_enforce_capacity`, refuses a failed `check_ticket_capacity` verdict with `check_violation`; sets
`current_assignee_id`, `claimed_at`, `status = 'claimed'` (the trigger holds the escrow) and returns the
held escrow's id. **No hold, no work (Decision #165):** the assignment runs in a subtransaction; when the
hold refuses (`PF402`) it is rolled back, `fn_mark_needs_funding` records the ticket as Needs funding
and notifies the client, and the core returns `NULL` — a refusal cannot be both recorded and raised in
one transaction, so `NULL` is the refusal. `search_path = public, projects, finance, org, security,
auth`. `EXECUTE`: `service_role` only — no client role may call it, because it trusts its assignee
argument.

🚨 **No caller check** — moot for clients, because no client role holds `EXECUTE`. It is an internal
primitive (`claim_ticket`, `assign_ticket_manual`, `auto_assign_round_robin`, `assign_parallel_stream`
call it after their own checks, and the policies file names it as a `ticket_history` writer); called
directly it takes any ticket and any assignee — on **any** stage, bypassing `claim_ticket`'s
`open_pull` test too — and `p_enforce_capacity = false` skips the cap. The claim holds the client's
escrow.

### `projects.fn_mark_needs_funding(p_ticket_id uuid, p_detail jsonb) → void`

`00001140` §5 (Decision #165). Sets `payment_status = 'needs_funding'` on a ticket that is `unpaid`,
`needs_funding` or `partially_released` (held, released or refunded tickets keep theirs), and sends the
project owner `escrow.needs_funding` with the hold's `PF402` `DETAIL` (`reason`, `amount_minor`,
`currency`) as its payload and a `?tkv=` link to the ticket. Called by `fn_assign_ticket_core` and
`force_complete_stage`. `SECURITY DEFINER`, `search_path = public, projects, comms, auth`; `EXECUTE`:
owner only (`00002510`; reached from its definer callers) — callable, anyone could mark any unfunded
ticket and notify its owner at will.

### `projects.set_stage_assignment_mode(p_stage_id uuid, p_mode text) → void`

`00001140` §6. Sets `project_stages.assignment_mode` (`p_mode` cast to
`projects.assignment_routing_mode`; a bad value raises `22P02`). Unknown stage → `P0001`; guard
`projects.can_review_project(stage's project)` → `insufficient_privilege` (`42501`).
`search_path = public, projects, auth`; `EXECUTE`: `service_role` only — no client grant.

### `projects.assign_ticket_manual(p_ticket_id uuid, p_assignee_id uuid) → uuid`

`00001140` §6, manual mode: the paying side pins an assignee. Unknown ticket → `P0001`; guard
`can_review_project(ticket's project)` → `42501`; then `fn_assign_ticket_core(…, true)` — capacity
still enforced, and the same work-start gate: `NULL` when the hold was refused (the ticket is then
`needs_funding`). Does not check that the assignee is on the roster. `search_path = public, projects,
finance, org, security, auth`; `EXECUTE`: `authenticated`, `service_role`.

### `projects.auto_assign_round_robin(p_stage_id uuid) → jsonb`

`00001140` §6. Assigns the stage's next ready ticket (unassigned, `backlog` / `todo`, described; by
`sort_order` then `created_at`, `needs_funding` tickets last so an unfunded one doesn't stall the queue)
to the `get_project_roster` member with the lowest live intensity who passes `check_ticket_capacity`.
Returns `{assigned, ticket_id, assignee_id}`, `{assigned: false, reason}`, or — when the hold was refused
— `{assigned: false, ticket_id, needs_funding: true, reason}`. Unknown stage → `P0001`; guard `can_review_project` → `42501`. Because it reads the roster
through `get_project_roster`, a caller must **also** pass `has_project_access` — a client-business
member who is not the business's owner passes the first check and is refused (`42501`) by the second.
`EXECUTE`: `service_role` only — no client grant.

### `projects.assign_parallel_stream(p_stage_id uuid) → integer`

`00001140` §6. Fans every ready ticket in the stage across the roster, each to the lowest-loaded
member with capacity; tickets nobody can take stay in the pool, as does a ticket whose hold is refused
(now `needs_funding` — no other member would change that). Returns the count assigned. Same
guards as `auto_assign_round_robin` (`can_review_project`, then `get_project_roster`'s
`has_project_access`). `EXECUTE`: `service_role` only — no client grant.

### `projects.fn_sync_workload_intensity() → trigger`

`trg_sync_workload_intensity` — `AFTER INSERT OR DELETE OR UPDATE OF current_assignee_id, status,
workload_intensity ON projects.tickets` (`00001850`). Recomputes
`org.freelancer_profiles.current_workload_intensity` (rounded live sum) for the old and new assignee,
then re-sums the search row of every team either holder is an active member of
(`search.fn_refresh_team_workload`, Decision #235 — [search/Functions.md](../search/Functions.md)).
`search_path = public, projects, org`; `EXECUTE` moot (a trigger).

### `projects.file_workload_report(p_ticket_id uuid, p_reason text, p_reported_intensity numeric DEFAULT NULL) → uuid`

`00001140` §8. **`SECURITY INVOKER`** (`search_path = public, projects, auth`): inserts a
`ticket_workload_reports` row with `reporter_user_id = auth.uid()` and the ticket's current intensity,
so the authority is the _File workload report_ policy (reporter is self **and** the ticket's current
assignee). `EXECUTE`: `service_role` only — no client grant. A blank reason, or a ticket the caller
cannot see, → `P0001`. The insert fires `trg_open_workload_report`.

### `projects.fn_open_workload_report() → trigger`

`trg_open_workload_report` — `AFTER INSERT ON projects.ticket_workload_reports` (`00001850`). The
Frozen rule (Decision #290): **suspends** the ticket and moves no money. It refuses
(`object_not_in_prerequisite_state`) unless the ticket is under way (`claimed` / `in_progress`) —
which also keeps one report open per ticket — then sets `status = 'reported_hidden'`,
`hidden_until = now() + workload_report_window_hours` (default 48) and `workload_report_id`, and
stamps the same `hidden_until` on the report (the clock the expiry sweep reads). The assignee and the
held escrow are untouched. It used to clear the assignee instead, which cascaded through
`fn_ticket_escrow_sync`'s removal branch and **released the held escrow to the reporter** — a payout
the freelancer could trigger alone with one INSERT (probe: `supabase/probes/workload_report_suspension.sql`).
`search_path = public, projects, finance, security, org, auth`; `EXECUTE` moot (a trigger).

### `projects.fn_resume_reported_ticket(p_ticket_id uuid, p_report_id uuid) → void`

`00001140`, internal (Decision #290). Ends one report's suspension: if the ticket is still
`reported_hidden` on that report and holds escrow it returns to `in_progress` (through the work-start
gate, which finds the hold it never lost); in every case its `hidden_until` is lifted. A ticket the
client settled meanwhile keeps the status that settlement gave it; a ticket now suspended on a later
report is not touched. `search_path = public, projects, finance`; `EXECUTE`: `service_role` only.

### `projects.fn_adjust_workload_report() → trigger`

`trg_adjust_workload_report` — `AFTER UPDATE OF workload_intensity ON projects.tickets` (`00001850`).
The client's answer to a report (`PRODUCT_SPEC.md` §Workload Intensity Reporting, step 2): when a
`reported_hidden` ticket's `workload_intensity` is raised, the open report becomes `adjusted`
(`resolved_at = now()`) and `fn_resume_reported_ticket` puts the work back `in_progress` at the new
W_i. Only the client side can make that raise — `fn_ticket_immutability_guard` refuses it to the
reporter. `search_path = public, projects`; `EXECUTE` moot (a trigger).

### `projects.fn_resolve_expired_workload_reports() → integer`

`00001140` §1b, the expiry sweep: every `open` report whose `hidden_until` has passed becomes
`expired_penalized`, the suspended ticket resumes `in_progress` at its reported W_i
(`fn_resume_reported_ticket`), and a `trust_score` `security.penalties` row (severity
`client_no_adjust_penalty`) is written against the client business or owner. Returns the count.
`search_path = public, projects, security`; `EXECUTE`: `service_role` only — no client grant. **No
caller check** — moot for clients, because no client role holds `EXECUTE`. It takes no arguments and
only acts on reports that are genuinely expired. **Not scheduled**: no `ops.scheduled_jobs` row runs
it (Decision #290 (FLAG a)).

### `projects.fn_flag_bad_faith_report(p_report_id uuid) → void`

`00001140` (from `0007`), the audit outcome: marks the report `dismissed_bad_faith`, resumes the
suspended ticket `in_progress` at the W_i it was reported at (`fn_resume_reported_ticket`; its hold
never left, Decision #290), and inserts a `discovery_rank` `security.penalties`
row (severity `freelancer_bad_faith_penalty`) against the **reporter**. `search_path = public,
projects, security`; `EXECUTE`: `service_role` only — no client grant.

🚨 **No caller check** — moot for clients, because no client role holds `EXECUTE`. A caller who holds
a report id can dismiss it and penalise the freelancer who filed it. It is an admin/audit action with
no admin test.

---

## Deliverables

### The review door — `submit_deliverable` · `send_submission_draft`

The only two ways a submission reaches `pending_review` (there is no client `UPDATE` on
`stage_submissions` — [Policies.md](Policies.md)). Both run the same three internal steps, so a sent
draft and a fresh submission leave identical state; `00001150` region 4, probe
`supabase/probes/submission_door.sql`.

**`projects.submit_deliverable(...) → jsonb`** — files a new submission. Full signature:
`submit_deliverable(p_ticket_id uuid, p_stage_id uuid, p_title text, p_description jsonb DEFAULT '{}',
p_checked_item_ids jsonb DEFAULT '[]', p_file_ids uuid[] DEFAULT '{}') → jsonb`. Inserts a
`pending_review` row with the stage's next `number`, then the three steps.

**`projects.send_submission_draft(p_submission_id uuid, p_checked_item_ids jsonb DEFAULT NULL,
p_file_ids uuid[] DEFAULT '{}') → jsonb`** — sends a draft. Locks the row; it must be the caller's own
and still `draft`, else `PC409` "That draft can no longer be submitted." (missing, foreign and already
sent read the same). Sets `pending_review`, numbers it if the draft had no `number`, replaces
`checked_item_ids` unless `NULL`, links `p_file_ids` (the files staged since the draft was saved), then
the three steps.

Both: `SECURITY DEFINER`, `search_path = public, projects, org, files, auth`; `EXECUTE`:
`authenticated`, `service_role`; return the `fn_serialize_submission` shape. Idempotent with
`projects.fn_ticket_review_submission`, the trigger that auto-files a ledger row when a card is dragged
into Review: the submission is `pending_review` before the ticket flips, so the trigger no-ops.

The internal steps (`EXECUTE`: owner only):

- **`fn_assert_can_submit(p_ticket_id, p_stage_id) → uuid`** — locks the ticket; unknown ticket
  `P0002`; no project access `42501`; stage outside the project `23514`; ticket not in that stage
  (`current_stage_id`) `23514` "That ticket is not part of this stage."; caller neither the ticket's
  `current_assignee_id` nor an active member (`org.is_active_team_member`) of the stage's accepted team
  assignment (the payee `fn_hold_ticket_escrow` resolves) `42501` "Only the ticket's assignee can
  submit work on it." The client/owner is refused here: project access is not enough.
- **`fn_link_submission_files(p_submission_id, p_file_ids) → integer`** — checks every new id **and**
  every file the submission already links (a draft's earlier attachments). A missing or soft-deleted
  `files.items` row raises `PU422` (`DETAIL.code = 'file_unknown'`); a file neither `owner_user_id =
  auth.uid()` nor team-owned by a team the caller is active in raises `PU422` (`file_foreign`, the
  message names the file). Nothing is skipped. New ids are linked once each; returns the linked count.
- **`fn_enter_review(p_submission_id) → void`** — resolves every `open` revision round on the ticket
  (`status = 'resolved'`, `resolved_at`), writes the newest round's `submission_id` into the
  submission's `revision_of` (Decision #167), and moves the ticket to `in_review` unless it is
  `completed`/`cancelled`. Leaving `in_progress` without a held escrow raises `PF402` from
  `trg_ticket_escrow_sync` (#165); the whole call rolls back.

### Paid revisions — `request_paid_revision` · `fund_paid_revision` · `fn_notify_revision` · `fn_stage_revision_terms`

Decision #167 (lifecycle `PRODUCT_MANAGEMENT.md` §3.7), all in `00001150` except the trigger
function (`00001130`).

- **`request_paid_revision(p_submission_id uuid, p_feedback jsonb DEFAULT NULL) → jsonb`** — the
  review's "Buy a revision". Locks the submission; reviewer guard (`can_review_project`, `42501`)
  before the state checks; not `pending_review` `55000`; a free round still left `PC409`; a stage
  whose `extra_revision_price_cents` is `NULL` `PU422`. Raises (or, per submission, refreshes) one
  round `awaiting_payment` with `price_cents` snapshotted. Returns `{revision_id, price_minor,
  currency, title, stage_id, ticket_id}`. Sends nothing back. `EXECUTE`: `authenticated`,
  `service_role`.
- **`fund_paid_revision(p_revision_id uuid) → jsonb`** — run by `finance.place_wallet_order` for a
  `paid_revision` line, by `finance.settle_card_payment` for a card payment naming the round, and
  directly by the review's "Pay from wallet" (Decision #199) — always as the payer. The funder
  predicate `projects.fn_can_fund_project` (`PK403 not_funder`, BB2); round not
  `awaiting_payment` or submission already decided `PC409`; not a `paid_revision`, or its
  `price_cents` no longer the stage's `extra_revision_price_cents`, `PC409` (raise it again). A
  business payer then passes `finance.fn_assert_business_spend(…, 'revisions', round)` as the funder
  (BB3), and the hold finds the spend covered. Holds the round's escrow
  (`finance.fn_hold_revision_escrow`, `PF402` + `DETAIL` like #165), then opens the round: submission
  `revisions_requested` (feedback = the round's reason), ticket `in_review → in_progress`, a
  `submission_reviewed` activity row, `fn_notify_revision`. A refused hold rolls everything back.
  Returns `{revision_id, escrow_id, status: 'open'}`. `EXECUTE`: `authenticated`, `service_role`.
- **`fn_notify_revision(p_revision_id uuid) → void`** — `submission.revision_requested` to the
  submitter ("Paid revision, funded, you can start." on a paid round) and `ticket.revision_requested`
  to the ticket's assignee when that is someone else. Internal (`EXECUTE`: owner only).
- **`fn_stage_revision_terms() → trigger`** (`trg_stage_revision_terms`, `00001850`) — on a project
  with a `source_blueprint_id`, INSERT copies `free_revisions` / `extra_revision_price_cents` from the
  blueprint (else its newest published listing; once either is declared, free defaults to 0 and price
  to the stage's `unit_price_cents`; neither → `NULL`, unlimited); UPDATE keeps the old values.
  Owner-authored stages pass through. `EXECUTE` moot (a trigger).

### `projects.review_submission(...)` / `projects.fund_stage(...)`

**Age gate:** `fund_stage`, `fund_ticket` and `fund_paid_revision` first refuse a caller under 18
(`PM403`) (`org.fn_assert_adult`, Decision #190).

Client-side adjudication and funding (`approve_stage`, which pays out, is under
[Escrow settlement doors](#escrow-settlement-doors)). `review_submission` is guarded by
`can_review_project` (and, for `accept` on a business project, `hire` — BB2), locks the submission row, and refuses anything not `pending_review` with
`55000` (`object_not_in_prerequisite_state`) — a reviewer can read an unsent `draft` under RLS, and
re-reviewing a decided one would rewrite the decision. The status check runs after the RBAC check,
so a non-reviewer learns nothing about the submission. `fund_stage` asks the funder predicate
`projects.fn_can_fund_project` (BB2): vault `spend` on the paying business's wallet, or — with no
client business — that the caller is the owner paying as an individual. It no longer asks
`has_project_access`, which a spend-only business member does not pass and a hired freelancer does
([finance/Functions.md](../finance/Functions.md#stage-level-wrappers-in-projects-invoke-this-engine--migration-0305)).

Signatures: `review_submission(p_submission_id uuid, p_decision text, p_feedback jsonb DEFAULT NULL) →
jsonb` and `fund_stage(p_project_id uuid, p_stage_id uuid) → jsonb`. Both `SECURITY DEFINER`;
`EXECUTE`: `authenticated`, `service_role`. `review_submission` (`search_path = public, projects, org, auth`): unknown
submission `P0002`, non-reviewer `42501`, not `pending_review` `55000`, decision other than `accept` /
`request_revision` `23514`, a stage already `paid` / `cancelled` `55000` (the stage row is locked for
either verdict, #194); a revision request also files a `stage_revision_requests` row and moves the
ticket back to `in_progress`; an acceptance settles the ticket through `fn_settle_ticket_stage`
(completed, escrow released), notifies the submitter and every payee (`submission.accepted`), and adds
`released_count` to the returned submission. **Revision allotment (Decision #167):** a `request_revision` locks the
stage row and is free while `file_revisions_allowed` is `NULL`, `revisions_used < file_revisions_allowed`
or `extra_revision_price_cents = 0` — then it increments `revisions_used`, links the round to the
submission (`submission_id`) and calls `fn_notify_revision`. Past the allotment it raises **`PR402`**
before writing anything, `DETAIL` = `{code: 'paid_revision_required', price_minor, currency, used,
allowed}`. Either verdict cancels a round still `awaiting_payment` on the submission. `fund_stage` (`search_path = public, projects, finance, comms, org,
auth`): payer refusal `PK403 not_funder`; foreign stage `P0002`; stage not `open`, `assigned` or `in_progress`
`55000` (Decision #197); any ticket with no price `PC409` before anything moves; an individual
owner's wallet short of the stage total `PF402`; a business payer passes
`finance.fn_assert_business_spend` once for the stage total as the funder (ref `project_stages`,
BB3) — `55000 business_not_active` (draft or archived), `PK403 kyb_required:`, `PA403 over_limit:` /
`needs_approval:` (an approval bound to the stage carries it) — whose cover lets each ticket's hold
through without counting again, and `fn_close_spend_cover` closes it after the holds; any ticket's
own hold refusal (`PF402`, Decision #165) aborts the whole stage; nothing fundable `PC409`. Fundable means in the stage, `unpaid` or
`needs_funding`, not `completed`/`cancelled`/`reported_hidden`, **claimed or not** — priced by
`projects.fn_stage_funding_need`, the definition `finance.begin_card_payment` charges by. A ticket
nobody has claimed is held PREPAID (no payee) and bound at its claim. On success an `assigned` stage
moves to `in_progress` (an open or in-progress stage keeps its status) and the answer carries
`awaiting_claim_count`; each hold notifies its assignee and the
client itself (`escrow.funded`), so `fund_stage` sends no `stage_funded` of its own. **Concurrency
(Decision #189):** the fundable tickets are locked `FOR UPDATE` in id order before any hold or the
individual's wallet check, and only that locked set is held. A second `fund_stage` (or a `fund_ticket`)
on the same tickets waits, re-reads them as `escrow_funded` once the first commits, and holds nothing
(`PC409`, nothing fundable). Ticket locks are always taken before a hold touches the payer's wallet row,
so the doors never deadlock on each other. `finance.uq_escrows_ticket_base_held` is the backstop.

### `projects.fund_ticket(p_project_id uuid, p_ticket_id uuid)` → jsonb (Decision #166)

Funds ONE ticket's escrow — the single-ticket Buy Now and a basket ticket line. The same funder
predicate as `fund_stage` (`PK403 not_funder`), then the PRODUCT_SPEC §5 purchasing gate and the hold's prerequisites, in
order: ticket not in the project `P0002`; no description `PU422`; already paid (`payment_status` not
`unpaid`/`needs_funding`, or a held escrow) `PC409`; not in a stage, or the stage `approved`/`paid`/
`cancelled` `PC409`; no price (own, else the stage's) `PC409`; an individual owner's wallet short of
the price `PF402`; a business payer passes `finance.fn_assert_business_spend(…, 'tickets', ticket)`
as the funder (BB3 — inside a basket the basket's cover passes it). A ticket nobody has claimed is held PREPAID and bound at its claim (Decision #197;
before it, `PU422` "Nobody can be paid … yet"). Then exactly one
`finance.fn_hold_ticket_escrow`. **The stage's status is not moved** — its other tickets are still
unfunded, so it stays partially funded; `fund_stage` remains the whole-stage action. Returns
`{ticket_id, escrow_id, stage_id, amount_cents, currency, prepaid}`. `SECURITY DEFINER` (`search_path = public,
projects, finance, comms, org, auth`), `EXECUTE`: `authenticated`, `service_role` (`00002510`).

### `projects.fn_stage_funding_need(p_stage_id uuid)` → jsonb (Decision #197)

What funding a stage takes: `{ticket_count, unpriced_count, amount_cents}` over every ticket in the
stage that is `unpaid`/`needs_funding`, not `completed`/`cancelled`/`reported_hidden`, with no held
base escrow — claimed or not — at `COALESCE(ticket.unit_price_cents, stage.unit_price_cents)`;
`amount_cents` sums the priced ones. THE definition `fund_stage` holds by and
`finance.begin_card_payment` charges by, so a card payment can never settle into a stage that then
refuses it. `SQL STABLE SECURITY DEFINER`, `search_path = ''`; internal (`EXECUTE` revoked from
`PUBLIC`, `anon`, `authenticated`).

### `projects.get_stage_funding_quote(p_project_id uuid, p_stage_id uuid)` → jsonb (Decision #197)

The payer's read before funding a stage (the wallet's Fund a stage, the board's Fund stage via
`GET /api/finance/escrow/quote`): `fn_stage_funding_need` plus `{stage_id, stage_name, stage_status,
fundable (open · assigned · in_progress), currency, payer_scope ('business' | 'personal'), payer_id,
wallet_balance_cents}`. `fund_stage`'s funder predicate (`PK403 not_funder`, BB2); a foreign stage `P0002`.
Read-only; the doors re-check everything. `STABLE SECURITY DEFINER`; `EXECUTE`: `authenticated`.
Called as the payer by `finance.place_wallet_order` (a ticket line) and `finance.settle_card_payment` (a card lock
naming a ticket). Proven by `supabase/probes/single_ticket_purchase.sql`.

### `projects.fn_serialize_submission(p_submission_id uuid) → jsonb`

`00001150` §2. The shared submission shape (title, description, checked items, status, author,
feedback, `revisionOf`, files with name / MIME / size). `LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`,
`search_path = public, projects, org, files, auth`; `EXECUTE`: `service_role` only — no client grant.
**No caller check** — moot for clients, because no client role holds `EXECUTE`; a caller holding a
submission id reads it, bypassing _View submissions_.

### `projects.get_stage_submissions(p_project_id uuid, p_stage_id uuid) → jsonb`

`00001150` §3. Every submission on the stage, newest first, as `fn_serialize_submission` rows.
`STABLE`, `SECURITY DEFINER`, `search_path = public, projects, org, files, auth`; `EXECUTE`:
`service_role` only — no client grant. Guard: `has_project_access(p_project_id)` → `42501`; the stage
is filtered to that project in the `WHERE`, so a foreign stage reads as empty.

### `projects.get_stage_finance(p_project_id uuid, p_stage_id uuid) → jsonb`

`00001150`, the Finance tab: stage status, currency, the `accepted` assignment, escrowed / released /
fee totals from `finance.escrows`, the stage's tickets with price and payment status, team payout
splits, and `fundable`. `SECURITY DEFINER`, `search_path = public, projects, finance, org`;
`EXECUTE`: `service_role` only — no client grant. Guard: `has_project_access(p_project_id)` → `42501`
(so an assignee reads the splits too); foreign stage → `P0002`.

---

## Lifecycle

### `projects.set_project_status(p_project_id uuid, p_to_status project_status, p_reason text DEFAULT NULL) → project_status`

The review-authority state machine (Decision #163). `draft|on_hold → active` needs a title and ≥1
non-archived stage;
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

### `projects.fn_stage_price_lock() → trigger` · `projects.fn_project_price_lock() → trigger`

The money half of the shape lock (PRODUCT_SPEC §Post-Onboarding Immutability; Decision #338 (j)), on
the same deny-list. `00001130`, bound in `00001850` / `00001820`; `SECURITY DEFINER`,
`search_path = public, projects`; `EXECUTE` moot (triggers). The setup service refuses first
(`lockedStagePriceIds` / `projectPriceLocked`, `live-writes.ts`); these hold every other write path.

- `trg_stage_price_lock` — `BEFORE UPDATE OF unit_price_cents ON projects.project_stages`, fired only
  when the price changes. A staged run refuses once **that stage** has an onboarded seat; a flat
  engagement (`single_task`, `single_stage`) refuses once **any** stage of the project has one, since
  its root stage is the engagement. `check_violation`, "Ticket price is locked — a freelancer has been
  onboarded onto this stage." (or "…onto this project." on a flat engagement).
- `trg_project_price_lock` — `BEFORE UPDATE OF budget_amount_cents ON projects.projects`, fired only
  when the budget changes. Only a Task (`single_task`) prices on the project row; it refuses once any
  stage of the project has an onboarded seat. A milestone run's budget is the rolled-up sum the service
  rewrites, so it is not locked here.

`supabase/probes/claim_seat_and_price_lock.sql` is the regression check.

### `projects.fn_guard_project_ownership() → trigger`

`trg_guard_project_ownership` — `BEFORE UPDATE OF owner_user_id, client_business_id ON
projects.projects`, fired only when either value actually changes; bound in `00001820`, defined in
`00001130` (Decision #163). Review authority may update the project row, but reassigning the owner or
the paying business stays the owner's alone: a signed-in caller other than `OLD.owner_user_id` is
refused (`insufficient_privilege`). Pointing the project at a business (a new non-null
`client_business_id`) needs `manage_projects` on it, the same gate as `create_project` (`PK403
missing_permission: manage_projects`, BB2). A `NULL` `auth.uid()` (service role, seeds) passes.
`SECURITY DEFINER` (to ask `org.fn_member_can`, which no client role may call), `search_path = ''`;
`EXECUTE` moot (a trigger).

`set_project_status` is `SECURITY DEFINER`, `search_path = public, projects, finance, org, auth`,
`EXECUTE`: `authenticated`, `service_role`. Guard: unknown project `P0002`, then a `NULL` actor or not
`can_review_project(p_project_id)` → `insufficient_privilege` (`42501`) — the owner or the client
business (owner only before Decision #163). Every
transition refusal is `check_violation` (`23514`); `archived` is reachable from any non-terminal state
and is itself terminal. `fn_project_shape_lock` is `SECURITY DEFINER`, `search_path = public,
projects`, bound in `00001820`; `EXECUTE` moot (a trigger).

### `projects.tg_project_handover_on_complete() → trigger`

`trg_project_handover_on_complete` — `BEFORE UPDATE OF status ON projects.projects WHEN (NEW.status =
'completed')`, bound in `00001820`, defined in `00001150`. Stamps `handover_unlocked_at = now()` if
unset, so a project completed through `set_project_status` lifts the protected phase just as
`approve_stage`'s last release does. `SECURITY INVOKER`, no `search_path`; `EXECUTE` moot (a
trigger).

### `projects.fn_check_public_project_footprint() → trigger`

`trg_check_public_project_footprint` — `BEFORE INSERT OR UPDATE OF status, visibility ON
projects.projects`, bound in `00001820`, defined in `00001140`. Only a row **becoming** `active` +
`public` takes a slot: the limit is `finance.fn_effective_limit` on `business_public_projects` (client
business) or `active_public_projects` (owner), usage `finance.fn_footprint_usage`. At the limit it
emits `entitlement.denied` and refuses with `check_violation` **only** when
`security.platform_params.footprint_caps_enforced` is true. `SECURITY DEFINER`, `search_path =
projects, finance, security, analytics, public`; `EXECUTE` moot (a trigger).

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

`SECURITY DEFINER`, `search_path = ''`, every reference schema-qualified. Scheduled daily at 03:10
UTC as `archive-stale-service-drafts`, a row of the job registry (`ops.scheduled_jobs`, `00005060`;
Decision #203); `deno task cron:run archive-stale-service-drafts` runs it by hand. `EXECUTE`:
`service_role` only — no client grant.

🚨 **No caller check** — moot for clients, because no client role holds `EXECUTE`. `p_now` is
caller-supplied, so a caller can pass a far-future instant and soft-archive every un-funded
instantiated draft on the platform in one call — the same class as `fn_release_expired_claims`.

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
(DEFINER bypasses RLS). Issuing is **staffing authority** (`can_manage_project_members`, Decision
#145) — the owner, the client business, or an appointed admin or manager — while offering the
`admin` or `manager` role stays `can_review_project`. The `Owner manages invitations` policy still
admits direct writes from the owner alone; a delegate reaches every act through these doors.

### `projects.invite_to_project(p_project_id uuid, p_stage_id uuid, p_target_user_id uuid, p_role text, p_message text DEFAULT '', p_offer_price_cents bigint DEFAULT NULL, p_answers jsonb DEFAULT '{}') → uuid`

Issues ONE identity-addressed invitation (one row, one stage — `NULL` for a whole-project offer) as
the project's staffing authority, and emits `stage.invite` to the invitee through `comms.fn_notify`
in the same transaction. Refuses, in the database's own words: a caller without staffing authority
(`insufficient_privilege`), a delegate offering `admin`/`manager` (`insufficient_privilege`), a closed
project, the caller or the owner as the invitee, a role the accept path cannot grant, a stage of another project,
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
the router no longer serves (Decision #88). `EXECUTE`: `authenticated`, `service_role`.

### `projects.invite_by_email(p_project_id uuid, p_stage_id uuid, p_email text, p_role text) → uuid`

`00001135_functions_projects_membership.sql` (Decision #141). The email-addressed twin of
`invite_to_project`, behind the Members tab's Invite modal (`POST /api/projects/[id]/invites`).
Staffing authority, with `admin`/`manager` offers reserved to review authority; refuses a closed project, a role outside `admin · manager · freelancer · member · guest`, a
malformed address (`check_violation`), and a stage of another project. Stores `lower(btrim(email))`
in `target_email` and **never resolves it to `target_user_id`**: the roster re-reads the queue, so a
resolved row would tell the inviter whose account owns the address (the rule
`org.invite_workspace_member` follows). One open offer per (project, stage, address) through
`uq_project_invitations_open_email`, re-raised as a readable `unique_violation`. `placeholder` is
derived as `invite_to_project` derives it. Records `invitation_sent` on `project_activity` and
`project.member_invited` on `security.audit_logs`. The holder of a **verified** matching
`org.user_emails` address (never the caller) is sent `stage.invite` through `comms.fn_notify` in the
same transaction; nothing about whether anyone matched reaches the caller. Refuses a NULL `auth.uid()`
first; `EXECUTE`: `authenticated`, `service_role`.

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
only** — no seat, ticket or escrow moves (that is `remove_project_member`). A seat leaving
`admin` / `manager` loses its `can_manage_tickets` grant in the same write (Decision #294; the audit
metadata carries `ticket_grant_ended`). Returns `{participant_id, role, changed}`. Refuses a NULL
`auth.uid()` first; `EXECUTE`: `authenticated`, `service_role`.

### `projects.set_ticket_manager(p_project_id uuid, p_participant_id uuid, p_allowed boolean) → jsonb`

`00001135` §1b (Decision #294). The business client's explicit grant to a delegated project manager
to compose and edit tickets on its behalf — the Members tab's "Let manage tickets" / "Stop managing
tickets" (`PATCH /api/projects/[id]/members/[memberId]/tickets`). Gated like appointing the delegate:
**review authority** (`insufficient_privilege`) and, on a business project, the `hire` capability
(`fn_assert_business_actor`, `PK403`). Refuses (`check_violation`) a project with no client business
("Only a business client delegates its tickets…"), a closed project, a row of another project, the
caller's own row, and a grant to anything but a `freelancer` person seat holding `admin` / `manager`.
Locks the participant row; idempotent (`changed: false`). Writes `security.audit_logs`
(`project.ticket_manager_changed`, `{project_id, member_user_id, can_manage_tickets}`) and
`project_activity` (`ticket_manager_changed`) in the same transaction. Returns
`{participant_id, can_manage_tickets, changed}`. What the grant reaches is
`fn_ticket_immutability_guard`'s rule. Refuses a NULL `auth.uid()` first; `EXECUTE`:
`authenticated`, `service_role`.

### `projects.fn_apply_invitation_decision(p_invitation_id uuid, p_accept boolean, p_actor uuid) → jsonb`

**The one implementation of an invitation's answer.** Locks the row; refuses anything not `pending`
(and marks a lapsed `expires_at` as `expired` before refusing); refuses an email-addressed row (those
are accepted through their link). A **decline** stamps `declined_at`, logs `invitation_declined` and
notifies the inviter (`invitation.declined`). An **accept** stamps `accepted_at`, enrols the invitee
as a `project_participants` row (`role = 'assignee'` for a freelancer — the staffing RPC's own
vocabulary — else the invitation's role verbatim), takes the stage seat for a freelancer invited to a
stage (`stage_assignments`, `status = 'pending_funding'` while the project is a draft — publishing
promotes it — else `assigned`; refuses a person with no `org.freelancer_profiles` row). Taking a seat
holds the same per-candidate advisory lock as `assign_from_application` (`freelancer:{uid}`), so an
invitation and an application, or two invitations, accepted at once are serialised; a new seat on a
stage whose window overlaps another live assignment (`fn_assignee_slot_conflict`) is refused
`exclusion_violation`. It then moves an
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
otherwise); delegates to `fn_apply_invitation_decision`. `EXECUTE`: `authenticated`, `service_role`.
Reached by
`POST /api/projects/invites/respond` — the conversation context panel's Accept request / Decline,
which answers every invitation of one request together (Decision #128).

### `projects.remove_project_member(p_project_id uuid, p_participant_id uuid, p_stage_id uuid DEFAULT NULL) → jsonb`

The client removes a hired freelancer from ONE stage (`p_stage_id`) or from the whole project
(`NULL`). Owner-only; refuses a non-freelancer participant (a business participant is the paying
side). Applies `PRODUCT_SPEC.md` §Freelancer Removal Mid-Ticket: every ticket the person holds within
the scope — `claimed`, `in_progress`, `in_review`, or `reported_hidden` (suspended by their workload
report, still theirs and still held — Decision #290) — goes through `projects.release_ticket_to_backlog`
(escrow released to them in full, ticket back to New), their held `stage_assignments` in scope become
`released`, the accepted invitations the removal undoes gain `dismissed_at` (their acceptance kept as
history), and a whole-project removal deletes the `project_participants` row — which the
participant arms of `has_project_access` read with no status test, so deleting it is what withdraws
access. (The released assignments stopped granting access on their own on 2026-09-28; a
stage-scoped removal leaves the participant row, and with it project access.) Logs
`member_removed` / `member_unassigned`. Returns the counts it APPLIED (`claimed_tickets`,
`submitted_tickets`, `started_stages`) so the confirmation the client saw can be read back against
what happened. `EXECUTE`: `authenticated`, `service_role`.

## Applications (`00001130` §6b / §11, Decision #128)

The freelancer-led half of `PRODUCT_SPEC.md` §The Hiring Process ("The Inbound Request").

### `projects.apply_to_project(p_project text, p_stage text, p_role_id uuid DEFAULT NULL, p_message text DEFAULT NULL, p_team_id uuid DEFAULT NULL) → jsonb`

**Age gate:** a signed-in caller under 18 is refused `PM403` before anything else (`org.fn_assert_adult`, Decision #190).

`SECURITY DEFINER`, `EXECUTE`: `authenticated`, `service_role`. The caller applies to one stage (slug or id) of a
project (slug or id), naming a staffing role where the stage lists them — as themselves, or with
`p_team_id` on a TEAM's behalf (`applicant_type = 'team'`, the team as `applicant_profile_id`, so
acceptance seats the team; Decision #154(D)). Refuses, in the database's
own words: no caller (`insufficient_privilege`), a note over the hire-message limit (`22023`), an
unknown project (`no_data_found`), the owner's own project, a project that is not `active` and
`public`/`unlisted`, a caller with no freelancer profile (personal applications), a stage of another
project or one not taking applications, a role not open to applications (all `check_violation`), a
person (or team) already on the stage, and a second pending application for the same target from the
same applicant (`unique_violation`). A team application first passes
`projects.fn_assert_team_can_apply` (below: `bind_seat`, an `active` team, two active members,
payout-ready shareholders), then needs a project the team does not own (`check_violation`). The duplicate and already-on-stage checks are applicant-aware, so a lead may
hold one pending application as themselves and one for the team. Inserts the
`project_applications` row (`pending`) with its `project_application_targets` row, the cover note
masked while the project is protected, logs `application_submitted` on `project_activity` (with
`team_id`), and notifies the owner (`application.received`, titled with the team's name for a team,
deep-linked to the applicant's DM). The insert fires `trg_meter_application_allowance`, which spends
one `weekly_proposals` unit (and one buffer token) from the applicant's allowance. Returns
`{ id, projectId, projectSlug, ownerUserId, stageId, roleId, applicantType, teamId, status, message }`;
the fat service then posts the note through `comms.send_request_message` into the owner's Requests.
The app runs the allowance's pre-flight gate before calling it (`ProjectBackendService.apply`).

### `projects.withdraw_application(p_application_id uuid) → jsonb`

`00001130` §6c, `SECURITY DEFINER`; `EXECUTE`: `authenticated`, `service_role` (`00002510`). The
applicant takes a pending proposal back — the only way an application becomes
`withdrawn`. Locks the row, then refuses: no caller (`insufficient_privilege`), an unknown id
(`no_data_found`), a caller who neither filed it nor holds `bind_seat` on the applying team
(`insufficient_privilege`), anything not `pending` (`check_violation`). Sets `withdrawn`, which
`trg_refund_withdrawn_application` turns into a refund of one WEEKLY proposal unit in the same
transaction; the anti-burst buffer token is deliberately not returned (Decision #154(E)). Logs
`application_withdrawn` on `project_activity` and notifies the project owner
(`application.withdrawn`, titled with the team's name for a team, deep-linked to the conversation with
the applicant). Returns `{ id, status: 'withdrawn', refunded: 1 }`.

### `projects.list_my_applications(p_project text DEFAULT NULL, p_team uuid DEFAULT NULL) → jsonb`

`00001130` §6d, `SECURITY DEFINER`, `STABLE`; `EXECUTE`: `authenticated`, `service_role`. The
proposals the caller
has sent — every application they filed, plus those filed for a team they are an active member of —
newest first (at most 200), as a JSON array of `{ id, status, applicantType, teamId, teamName,
canWithdraw, projectSlug, projectTitle, stageSlug, stageName, roleTitle, createdAt }`. The rows are
scoped to the caller; the names are read with the definer's rights, so a project that has since gone
private still shows the title the caller applied to. `p_project` (slug or uuid) narrows to one
project — the listing page's "have I applied here?". `p_team` narrows to the applications filed for
that team, whoever filed them — the team console's Projects → Proposals view (Teams C5); it only
narrows the caller's rows, never widens them, and applies before the 200-row cap, so a member's own
proposals cannot push the team's out (`supabase/probes/team_proposals_filter.sql`). Backs
`GET /api/projects/applications/mine`.

### `projects.assign_from_application(p_application_id uuid) → jsonb`

**Age gate:** after the staffing-authority check, an applicant under 18 is refused `PM403`
(`org.fn_assert_adult`, Decision #190).

The managing side confirms an applicant's seat — whatever the application targeted (a stage, a role,
an open seat, or a stage through its invite link). Gated on **staffing authority** —
`projects.can_manage_project_members(project)` (Decision #145), else `insufficient_privilege`; an
unknown id is `no_data_found`; anything not `pending` is a
`check_violation` naming its status. A candidate already on the stage is `unique_violation`, one
booked on an overlapping stage (`fn_assignee_slot_conflict`) `exclusion_violation`; accepts of one
candidate are serialised by an advisory lock. A freelancer is also enrolled as a `project_participants`
row (`role = 'assignee'`). `SECURITY DEFINER`, `search_path = public, projects, comms, org, auth`;
`EXECUTE`: `authenticated`, `service_role` (`00002510`). Takes the seat as a `stage_assignments` row
(`assigned`), marks the application
`accepted`, and — for a seat — fills it and marks that seat's other pending applications `rejected`,
telling each (`application.declined`, payload `reason: 'seat_filled'`, deep-linked to their
conversation with the owner); moves an `open` stage to `assigned`, and notifies the applicant
(`application.accepted`, deep-linked to `/projects/{slug}`). The client lands on funding next — the
seat is real once its escrow is.

**Seat concurrency.** Locks are taken seat row → application row → candidate advisory lock, so every
accept of one seat queues on the seat row before it holds an application row (no deadlock against the
winner's auto-reject). The seat moves `open → filled` only `WHERE status = 'open'`, with a row-count
check. A seat already filled — including the loser of a two-candidate race, whose application the
winner auto-rejected — is refused `unique_violation` with DETAIL `reason=seat_filled` ("This seat has
already been filled."), which the fat service returns as a 409; a `closed` seat is `check_violation`.
Pinned by `supabase/probes/seat_fill_concurrency.sql`.

### `projects.reject_application(p_application_id uuid) → jsonb`

`00001130` §7b, `SECURITY DEFINER`; `EXECUTE`: `authenticated`, `service_role` (`00002510`). The
managing side declines an applicant — the Members tab's Requests section. Locks the
application row first (so a concurrent accept and decline cannot both land), then refuses: an unknown
id (`no_data_found`), a caller without staffing authority (`can_manage_project_members`,
`insufficient_privilege`), anything not
`pending` (`check_violation`, naming its status). Marks the application `rejected` — the same status a
filled seat gives its other applicants, so "declined" and "not selected" are one state to the
applicant — logs `application_rejected` on `project_activity`, and notifies the applicant
(`application.declined`, deep-linked to their conversation with the owner). Nothing else moves: no
assignment existed, so nothing is released. Returns `fn_serialize_application`.

## Invitation records & stage invite links (`00001135` §3–§4, Decision #145)

### `projects.act_on_invitation(p_invitation_id uuid, p_action text) → jsonb`

The managing side's two acts on an invitation record: `cancel` (`pending → revoked`, no cooldown) and
`dismiss` (`dismissed_at` on a non-pending record, idempotent). Locks the row; a record the caller
cannot manage (`can_manage_project_members`) is `no_data_found` like an unknown id, so a stranger
learns nothing; the wrong act for the status is `check_violation`; an unknown action `22023`. Records
`project.invitation_revoked` / `project.invitation_dismissed` on `security.audit_logs`. A door rather
than a direct UPDATE because a delegate holding UPDATE on the row could rewrite its role or token.
`SECURITY DEFINER`; `EXECUTE`: `authenticated`, `service_role`. Returns `{id, action, changed}`.

### `projects.fn_invite_link_state(p_link projects.stage_invite_links, p_actor uuid) → text`

The ONE rule for what a stage invite link means to a person, read by both doors below:
`revoked` (not active) · `closed` (project archived/cancelled/completed, or stage
approved/paid/cancelled) · `manager` (owner, or a participant admin/manager) · `member` (a live
freelancer assignment on the stage) · `invited` (an open identity-addressed invitation to the stage)
· `requested` (a pending application targeting the stage) · `no_profile` (no
`org.freelancer_profiles` row) · `open`. `STABLE`, `SECURITY DEFINER`; **`EXECUTE`: owner only**
(no client role and no `service_role`; reached from the two doors below as their owner).

### `projects.get_stage_invite_link(p_stage_id uuid, p_rotate boolean DEFAULT false) → jsonb`

The stage's active link, minted on first use (18 random bytes as unpadded base64url); `p_rotate`
revokes the active row (`revoked_at`, `revoked_by`) and mints a replacement in the same transaction.
Staffing authority, else `insufficient_privilege`; a closed project or finished stage is
`check_violation`. A concurrent first mint that loses `uq_stage_invite_links_active` re-reads the
winner. Records `project.invite_link_created` / `project.invite_link_revoked` on
`security.audit_logs`. Returns `{id, token, stageId, createdAt}`. `EXECUTE`: `authenticated`,
`service_role`.

### `projects.revoke_stage_invite_link(p_stage_id uuid) → boolean`

Turns the stage's active link off; `true` when one was active, `false` when there was nothing to
revoke (not an error). Staffing authority. Audited as above. `EXECUTE`: `authenticated`,
`service_role`.

### `projects.resolve_invite_link(p_token text) → jsonb`

The landing page's read: `{state, projectSlug, projectTitle, stageSlug, stageName, sharedByName,
sharedByHandle}` for the signed-in caller (`fn_invite_link_state`); an unknown token answers
`{"state":"invalid"}` only. Refuses a NULL `auth.uid()` (`42501`). `STABLE`, `SECURITY DEFINER`;
`EXECUTE`: `authenticated`, `service_role`.

### `projects.redeem_invite_link(p_token text, p_message text DEFAULT NULL) → jsonb`

The holder asks to join: a `pending` `project_applications` row with `invite_link_id`, a `stage`
target, `application_submitted` on `project_activity` (payload carries `invite_link_id`), and
`application.received` to the owner — the same request `apply_to_project` files, answered by
`assign_from_application` / `reject_application`. Unlike `apply_to_project` it does not require a
public listing or an open hire trigger: the link is the managers' own invitation to ask. An advisory
lock per (stage, caller) makes a double press one request. Every state but `open` is refused with
its sentence and `DETAIL = 'state=<state>'` (`unique_violation` for manager/member/invited/requested,
`check_violation` otherwise); an unknown token is `no_data_found`; the note is masked during the
protected phase and capped at 4,000 characters. Seats nobody. `EXECUTE`: `authenticated`,
`service_role`.

### `projects.get_engagement_context(p_counterpart uuid) → jsonb`

`SECURITY DEFINER`, `EXECUTE`: `authenticated`, `service_role`. The conversation context panel's one
read: between
the caller and one counterpart, every invitation (bar revoked ones) and application (bar withdrawn
ones) in either direction, ten each, newest first, with the project's title, slug and visibility, the stage, role, offer and status, the
intro or cover note, the brief, the target's intake answers and the assignment state; the milestones
of the projects involved; and the counterpart's Standing (`org.fn_standing_level`) when they sell.
It reads ONLY rows the caller is a party to — the inviter or invitee, the applicant or the owner.

### `projects.fn_engaged_projects(p_user_id uuid) → TABLE (project_id uuid)`

`00001100`. Every project a user is engaged in — owner, participant, an active member (or the owner)
of the client business through `project_participants` or `projects.client_business_id` (SEC L4 (a)),
live assignee or team member, pending/accepted invitee or applicant. Read by the DM contact filter
(`comms.fn_dm_protected_project`). **`EXECUTE`: owner only** — no client role and no `service_role`.

### `projects.tg_mask_invitation_message()` — trigger

`00001135`, SEC L6. `trg_project_invitations_mask_message` (`00001820`), `BEFORE INSERT OR UPDATE OF
message ON projects.project_invitations`, `SECURITY DEFINER`, `search_path = ''`. Masks the note with
`comms.mask_pii` while `projects.is_protected_phase(project_id)`. `invite_to_project` already masked
the intro, but the "Owner manages invitations" `FOR ALL` policy let the owner write the row directly
and skip that door; this is the floor every path meets. Masking a masked note changes nothing, so
the door's pass and this one compose.

🚨 **`projects.release_ticket_to_backlog(uuid)` had the default `PUBLIC` EXECUTE and no caller check
of its own** — any signed-in caller who knew a ticket id could release its escrow and un-claim it (the
`reorder_stages` class, Decision #84). It had no application caller. `EXECUTE`: owner only
(`00002510`; no client role and no `service_role`); `remove_project_member` still reaches it because a
DEFINER function executes as its owner.

## Open seats & staffing (`00001130` §5–§8, `00001140` §7)

The posted-seat half of staffing (US-006), its serializers, and the proposal-allowance meter. All
`SECURITY DEFINER`; none has a client grant — `EXECUTE` is `service_role` only, or moot for the
triggers.

### `projects.create_stage_open_seat(p_stage_id uuid, p_description text, p_budget_min_cents bigint DEFAULT NULL, p_budget_max_cents bigint DEFAULT NULL, p_require_proposals boolean DEFAULT true, p_skill_ids uuid[] DEFAULT '{}') → jsonb`

`00001130` §5. Inserts a `stage_open_seats` row (`description_of_need` defaults to `Open seat`) and a
`stage_open_seat_skills` row per skill id that exists in `org.skills`; returns `fn_serialize_seat`.
`search_path = public, projects, org, auth`. Unknown stage → `no_data_found`; guard
`can_review_project(stage's project)` → `insufficient_privilege`; min > max budget →
`check_violation`. It is the only writer of `stage_open_seat_skills`, which has no client write policy.
`EXECUTE`: `service_role` only — no client grant.

### `projects.fn_assert_team_can_apply(p_team_id uuid) → void`

`00001130` §5b, `SECURITY DEFINER`, `STABLE`, `search_path = ''`; no `EXECUTE` for any role
(`00002510` — a step of the two apply doors, never a door). The one team gate `apply_to_seat` and
`apply_to_project` run (Decision #228 (E)). Refuses, in this order: the caller does not hold
`bind_seat` (`org.is_team_lead`) → `insufficient_privilege` "Only a team member who can commit the
team to work may apply on its behalf."; the team is not `active` (draft or archived) →
`check_violation` `team_not_active: only a published team can apply — publish it in Settings`; fewer
than two `active` `org.team_members` → `check_violation` "Teams must have at least 2 members before
applying to client projects."; a shareholder not payout-ready → `PK403 payout_not_ready`
(`finance.fn_assert_payout_ready('team', …)`, Decision #196). `finance.get_proposal_allowance`
reports the same facts (`can_bind_seat`, `team_status`, `team_member_count`) so the app refuses first;
`ProjectBackendService` maps a `team_not_active:` refusal onto the pre-flight's `422`
(`errors.allowance`, `details.blockReason`). Pinned by `supabase/probes/team_apply_gates.sql`.

### `projects.apply_to_seat(p_seat_id uuid, p_applicant_type text, p_applicant_profile_id uuid, p_message text DEFAULT NULL) → jsonb`

`00001130` §6. Files a `pending` `project_applications` row (`applicant_user_id = auth.uid()`) with a
`seat` target; returns `fn_serialize_application`. `search_path = public, projects, org, auth`.
Refusals, in order: `auth.uid() IS NULL` → `insufficient_privilege`; type not `freelancer` / `team` →
`check_violation`; unknown seat → `no_data_found`; seat not `open` → `check_violation`; a team
application that fails `projects.fn_assert_team_can_apply(p_applicant_profile_id)` (below — the same
gate as `apply_to_project`, so a draft, archived or one-member team is refused here too, per
Decision #228 (E)), or a freelancer application whose `p_applicant_profile_id <> auth.uid()` →
`insufficient_privilege` (a freelancer then needs to be payout-ready, `PK403`); a duplicate pending
application → `unique_violation`. Unlike `apply_to_project` it does **not** check that the
project is `active` and discoverable, that the caller is not its owner, or that they have a freelancer
profile, and it neither masks the note in the protected phase nor notifies the owner. Fires
`trg_meter_application_allowance`. `EXECUTE`: `service_role` only — no client grant.

### `projects.fn_serialize_seat(p_seat_id uuid) → jsonb`

`00001130` §8. A seat's description, budget range, `requireProposals`, status, filled assignment,
required skills and pending-application count. `LANGUAGE sql`, `STABLE`, `search_path = public,
projects, org`; `EXECUTE`: `service_role` only — no client grant. **No caller check** — moot for
clients, because no client role holds `EXECUTE`; it reads any seat by id, bypassing _View seats public
or own_.

### `projects.fn_serialize_application(p_application_id uuid) → jsonb`

`00001130` §8. An application's project, seat, applicant type / profile / user / display name,
`message` and status — the return shape of `apply_to_seat`, `assign_from_application` and
`reject_application`. `LANGUAGE sql`, `STABLE`, `search_path = public, projects, org`; `EXECUTE`:
`service_role` only — no client grant. **No caller check** — moot for clients, because no client role
holds `EXECUTE`; a caller holding an application id reads the applicant and their cover note,
bypassing _View own or owned applications_.

### `projects.get_stage_staffing(p_project_id uuid, p_stage_id uuid) → jsonb`

`00001130` §8. `{seats: [seat + applications[]], assignments: [...]}` for one stage. `STABLE`,
`search_path = public, projects, org, auth`; `EXECUTE`: `service_role` only — no client grant. Guard:
`has_project_access(p_project_id)` → `insufficient_privilege`. ⚠️ It never checks that `p_stage_id`
belongs to `p_project_id` — moot for clients, because no client role holds `EXECUTE`; a caller with
access to any one project can read another project's seats, applicants (with cover notes) and
assignments by pairing their own project id with a foreign stage id. `get_stage_submissions` and
`get_stage_finance` both make that check.

### `projects.fn_meter_application_allowance() → trigger`

`trg_meter_application_allowance` — `AFTER INSERT ON projects.project_applications`, bound in
`00001820`. Spends one `weekly_proposals` unit (`finance.fn_consume_allowance`) from the applicant —
the team when `applicant_type = 'team'`, else the user. When the allowance is exhausted it emits
`entitlement.denied` and refuses with `check_violation` **only** when
`security.platform_params.proposal_allowance_enforced` is true. `search_path = projects, finance,
security, analytics, public`; `EXECUTE` moot (a trigger).

### `projects.fn_refund_withdrawn_application() → trigger`

`trg_refund_withdrawn_application` — `AFTER UPDATE OF status ON projects.project_applications`, bound
in `00001820`. On the transition into `withdrawn`, returns the unit (`finance.fn_refund_allowance`).
`search_path = projects, finance, public`; `EXECUTE` moot (a trigger).

## Personal projects and under-18 accounts (`00001130`, Decisions #192, #208)

Any account may choose a personal project: `projects.create_project` reads `payload.is_personal`
(default `false`), and the guard below forces it for a minor whatever is sent. `projects.reserve_seat`
asserts an adult (`PM403`) before holding a session seat.

A restricted (13–17) account creates projects only as **personal** management tools — one person, no
money, never listed — and never joins anybody else's. Every rule is a table trigger (bound in
`00001820`), because the app writes these tables directly under RLS and an owner holds `FOR ALL`
policies on most of them. All are `SECURITY DEFINER`, `search_path = ''`, and granted to no client.

| Function | Bound as | Rule |
| :------- | :------- | :--- |
| `projects.fn_is_personal_project(p_project uuid) → boolean` | — | `projects.is_personal` for the id, `false` for none. |
| `projects.trg_projects_personal_guard()` | `trg_projects_personal_guard` BEFORE INSERT OR UPDATE on `projects.projects` | On insert, `is_personal := is_personal OR org.fn_is_minor(owner_user_id)`; afterwards it cannot change (`PM403`), and a non-personal project cannot be handed to a minor (`PM403`). A personal project refuses a client business, owning team or enterprise (`PM403`) and is coerced to `visibility` = `publish_visibility` = `invite_only`, `session_kind = 'none'`, no budget, no auto-fund, no deadline bonuses. |
| `projects.trg_stages_personal_money_guard()` | BEFORE INSERT OR UPDATE on `project_stages` | On a personal project: `unit_price_cents` and `extra_revision_price_cents` are `NULL`, `hire_trigger_active` is false. |
| `projects.trg_tickets_personal_guard()` | BEFORE INSERT OR UPDATE on `tickets` | On a personal project: `unit_price_cents` is `NULL`, and only the owner may be `current_assignee_id` (`PM403`). |
| `projects.trg_personal_project_closed()` | BEFORE INSERT on `project_participants`, `stage_assignments`, `stage_open_seats`, `stage_staffing_roles`, `stage_budget_rules`, `maintenance_contracts`, `stage_invite_links`, `project_applications`, `project_invitations`, `cohorts` | Refuses any row on a personal project (`PM403`) — nobody joins it and nothing is sold on it. Resolves the project from `project_id` or `project_stage_id`. |
| `projects.trg_project_joiner_adult(column)` | BEFORE INSERT on `project_applications` (`applicant_user_id`), `project_participants` (`profile_id`), `stage_assignments` (`freelancer_profile_id`); BEFORE INSERT OR UPDATE OF `target_user_id` on `project_invitations` | Refuses a row that would seat a minor in a project (`PM403`) — every join path (apply, apply to a seat, an invite link, an invitation and its acceptance, an assignment) and a direct table write alike. |

Work on a personal project moves without money: `projects.fn_ticket_escrow_sync` and
`fn_ticket_delete_protocol` (`00001110`) return at once for it, so entering `claimed` /
`in_progress` / `in_review` needs no held escrow and completing or deleting releases nothing, and
`fn_assign_ticket_core` skips its `org.fn_assert_adult` check there (only the owner can hold the
ticket anyway). The reads stamp it for the workspace: `ProjectDetail.personal`,
`ProjectSetup.personal` (the form drops Budget, Roles and Terms & visibility, and the ladder its
pricing, roles, rules and publish rungs), `ProjectWorkspace.personal` and `BoardCard.personal`
(`funding` is `null`, no Finances tab). Probe: `supabase/probes/personal_projects.sql`.

## Sessions — no-show claims (`00001155` §9 / §13, Decision #212)

| Function | Door | What it does |
| :-- | :-- | :-- |
| `projects.claim_session_no_show(event, reason) → jsonb` | `authenticated` (a seated attendee) | Once the sitting has started, opens a `finance.disputes` row on the escrow that pays for THIS sitting (its own per-sitting escrow, else the seat's whole-cohort escrow) naming `session_event_id`, tells the owner (`dispute.opened`) and runs `finance.fn_advance_dispute` — after the sitting has ended the attendance audit rules at once. Idempotent: a live claim on the escrow, or a settled one on the same sitting, is returned; `uq_disputes_escrow_live` makes racing claims one. Returns `{dispute_id, escrow_id, status}`. The lifecycle and its doors are `database/finance/Functions.md` § Platform disputes. |
| `projects.get_session_workspace(project) → jsonb` (dispute keys) | `authenticated` | `membership.escrow.claim_open` reads `finance.fn_escrow_has_open_dispute`; `disputes` lists the claims the caller is party to (their own; every claim on the engagement for the host) — `id`, `status`, `session_event_id`, `respond_by`, `opened_at`, `resolved_at`, `mine`; `claimable_sitting_id` is the latest started sitting an attendee may report now (its escrow held, no claim on it) — exactly what the claim would accept. |

## Sessions — 1-1 settlement (`00001155`, Decision #211)

A 1-1 session is a cohort of ONE seat, so it reuses the cohort machinery; its one difference is that
it holds **one escrow per sitting** (`finance.escrows.session_event_id`). Probe:
`supabase/probes/session_settlement.sql`.

| Function | Door | What it does |
| :-- | :-- | :-- |
| `projects.fn_book_session_slot(blueprint, buyer, payer_type, payer_id, unit_amount, sittings, currency, starts_at, order_line_id) → jsonb` | Internal — only `finance.place_wallet_order` (a `service_session` line, `sittings = 1`; a `set_session` line, `sittings = session_count`). REVOKEd from every role. | Asserts the buyer is an adult (`org.fn_assert_adult`, `PM403`), finds or makes the listing's session engagement (`fn_session_engagement_for`), re-tests the first slot against the provider's schedule under a row lock — inside their working hours (`scheduling.fn_band_covers` with the blueprint: the listing's compiled availability preset, else the weekly bands, Decision #217) and free of conflict and blackout, each else `PS409` — seats the buyer on a one-seat `active` cohort, writes the sittings (the first at the picked time, each later one a week on), holds one escrow per sitting from the paying wallet, mirrors each sitting onto the provider's calendar (`scheduling.events.source_session_event_id`, host + client on the roster), and on a block opens a round-0 `counterparty` / `collecting` reschedule round on every provisional sitting, due `set_session_schedule_hours` (72) after payment and never later than `session_cancel_notice_hours` before it. Notifies `session.booked` and, on a block, `session.scheduling_requested` to both. Refusals roll the order back: `22023` · `PU422` · `PF402` · `PC409` (time passed / listing gone) · `PM403` (a minor buyer) · `PS409` (outside the provider's hours, or taken). |
| `projects.fn_session_engagement_for(blueprint) → (o_project_id, o_stage_id)` | Internal | ONE engagement per 1-1 listing (`format = 'session'`, `session_kind = 'normal'`, `unlisted`, `active`, one "Sessions" stage), made on the first booking under an advisory lock keyed to the listing. |
| `projects.fn_session_host_schedule(project) → uuid` | Internal | The team's schedule for a team-owned engagement, else the owner's (freelancer first); `NULL` when none is published. |
| `projects.fn_settle_membership_state(membership, now)` | Internal (also called by the dispute settlement) | Ends an `active` seat once nothing is left held on it: `completed` if any of its escrows was released, else `cancelled`. |
| `projects.cancel_cohort_membership(membership) → jsonb` | `authenticated` (attendee or host) | PRODUCT_SPEC §Session-Based C. A cohort seat's one escrow is judged against the cohort's first sitting; a 1-1 seat's escrows **per sitting** against each one's own start — host cancel refunds every sitting not yet started, the client's refunds those more than the notice away and forfeits the rest. A started sitting is left to settle. Cancelled sittings become `cancelled_by_freelancer` / `cancelled_by_client`, leave the calendar, have their open round withdrawn; the one-seat cohort is cancelled. Returns `{outcome: refunded \| forfeited \| partial, amount_minor, refunded_minor, forfeited_minor, currency}`; `PS409` when every sitting has started. |
| `finance.auto_release_session_escrow(now) → jsonb` | pg_cron (`auto-release-session-escrow`), `service_role` | Completes ended sittings; refunds the escrow behind any tracked sitting with a provider no-show, at any age; releases each escrow with no open dispute (`finance.fn_escrow_has_open_dispute`) `session_payout_hours` after its sitting — a 1-1 sitting's own end, a cohort seat's last sitting. |
| `projects.fn_lapse_session_handshakes(now) → jsonb` | pg_cron (`session-scheduling-handshakes`), `service_role` | Reminds a provider once (`session.scheduling_reminder`) 24h before their booking's earliest open deadline, then lapses each open `counterparty` round on a scheduled sitting past `resolves_at` through `scheduling.close_reschedule_round` — the pencilled-in time stands — and tells both people (`session.scheduling_lapsed`). Returns `{reminded, lapsed}`. |
| `projects.trg_sitting_follows_calendar()` | AFTER UPDATE OF `starts_at`, `ends_at` on `scheduling.events` (`00001860`) | A sitting's calendar mirror that moved (a round carried) moves the `scheduled` sitting with it — the join window, presence rule and payout clock read the sitting. |
| `projects.trg_session_handshake_closed()` | AFTER UPDATE OF `status` on `scheduling.event_reschedules`, entering `resolved` / `lapsed` | Confirms a provisional (`tentative`) sitting mirror and the client's pending RSVP on it. |
