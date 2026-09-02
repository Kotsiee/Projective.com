# projects Schema: Tables

The `projects` schema is the functional core of the platform. It manages the lifecycle of work, from
project definition and stage-based modularity to staffing, execution, and revision tracking.

## 📑 Core Project Management

### `projects.projects`

The top-level container for all collaborative work. It defines global settings, legal requirements,
and high-level metadata.

| Column                | Type              | Notes                                                                 |
| :-------------------- | :---------------- | :-------------------------------------------------------------------- |
| `id`                  | uuid              | PK.                                                                   |
| `client_business_id`  | uuid              | FK → `org.business_profiles.id`.                                      |
| `owner_user_id`       | uuid              | FK → `auth.users.id` (The creator).                                   |
| `status`              | project_status    | `draft`, `active`, `on_hold`, `completed`, `cancelled`, `archived`.   |
| `visibility`          | visibility        | `public`, `invite_only`, `unlisted`.                                  |
| `ip_ownership_mode`   | ip_option_mode    | Global default for the project.                                       |
| `timeline_preset`     | timeline_preset   | `sequential`, `simultaneous`, `staggered`, `custom`.                  |
| `source_blueprint_id` | uuid              | FK → `marketplace.service_blueprints.id`; `NULL` when hand-built.     |
| `last_activity_at`    | timestamptz       | Last meaningful activity — what the draft sweep measures idleness by. |
| `archived_at`         | timestamptz       | Set iff `status = 'archived'` (`ck_projects_archived_at`).            |
| `session_kind`        | text              | `none` \| `normal` \| `group`. `none` on any non-session format.      |
| `budget_type`         | budget_type       | `fixed_price` or `hourly_cap`. Defaults `fixed_price`.                |
| `budget_amount_cents` | bigint            | Minor units. `NULL` = not set, which is not the same as zero.         |
| `nda_required`        | boolean           | Derived shadow of `nda_mode`. See below.                              |
| `nda_mode`            | projects.nda_mode | `none` \| `platform_standard` \| `custom`. Authoritative.             |
| `nda_document_id`     | uuid              | FK → `files.items.id`, `ON DELETE SET NULL`. `custom` only.           |

**The NDA pair, and why there are two columns rather than one.** `projects.nda_mode` says WHICH
instrument governs confidentiality; `nda_required` says only THAT one does. The boolean predates the
enum and several readers already ask it, so it is kept — but it is a shadow, not a second opinion:
`projects.create_project` writes it as `nda_mode <> 'none'` and never from the payload, and the
setup write keeps the pair in step. Two columns that can disagree about whether work is confidential
is the failure this pairing exists to avoid.

`nda_mode` is a three-member enum on purpose. "Re-use an NDA I already uploaded" and "upload a new
one" are both `custom` plus an `nda_document_id`; a fourth member would encode how the file arrived
rather than what governs the engagement, and every reader that has to decide whether to gate a
download cares only about the terms. `ck_projects_nda_document` refuses a document under any other
mode, so a project cannot carry `nda_mode = 'none'` and a signed instrument at once. The document is
a REFERENCE — it already lives in `files.items` with its own visibility scope and audit trail, and
an NDA that existed twice is an NDA whose two copies can differ.

**Four CHECKs that make an unusable project unrepresentable.**

| Constraint                          | Refuses                                                                     |
| :---------------------------------- | :-------------------------------------------------------------------------- |
| `ck_projects_currency`              | Anything but ISO 4217 alpha-3 uppercase. The unit escrow settles in.        |
| `ck_projects_title_len`             | A trimmed title outside 1–160. Matches `CreateProjectSchema.title` exactly. |
| `ck_projects_deadline_bonus_format` | `allow_deadline_bonuses` on a non-`pipeline` format.                        |
| `ck_projects_nda_document`          | An `nda_document_id` under a mode other than `custom`.                      |

`ck_projects_currency` is not cosmetic: the currency is the unit every money figure on the project
renders in and the one the escrow ledger settles in, so a lowercase or four-letter value is an
amount nobody can price. `create_project` upper-cases what it is given — case is the only difference
between a code that is right and one that is right in lower case — but the shape itself is the
constraint's call, not the function's. **Every writer must send an uppercase 3-letter code**; the
Zod SSOT's `ProjectBudgetSchema.currency` carries the matching regex.

`ck_projects_deadline_bonus_format` is expressed as an implication rather than a trigger so it holds
for every writer including the `SECURITY DEFINER` RPCs that bypass RLS. A format switch away from
`pipeline` has to clear the flag in the same statement. The bonus RATE is not stored here and never
has been — the money path is `finance.escrows.deadline_bonus_*`.

**The session kind.** `format` says an engagement is delivered as sessions; `session_kind` says
whether those sessions are 1-1 or a cohort. Two axes rather than two more `project_format` members,
because everything else about a session — its stages, its pricing, its channels — is identical
either way, and folding them in would grow a case in every exhaustive map over that enum that
changes nothing. It also has to be STORED rather than inferred: nothing else on the row
distinguishes the two, and the setup surface renders a different form for each, so a guess renders
the wrong one. Only `session` may carry a non-`none` value; the write normalises the column whenever
`format` changes, so a format switch cannot leave a cohort setting behind for the read to trip over.

**The project-level budget.** `CreateProjectSchema` has carried this pair since it shipped and
`projects.create_project` discarded both halves, so a figure the client typed had nowhere to live
and the setup ladder had nothing to measure "priced" against. The type is the existing `budget_type`
rather than a new enum because `projects.stage_staffing_roles` already models exactly this
`(type,
amount)` pair one level down — a second vocabulary for one concept inside one schema is how
two surfaces come to disagree about what `hourly_cap` means. `NULL` is _not set_ and zero is a
decision somebody took; a reader that cannot tell them apart renders "£0.00" over a project nobody
has priced.

**Service instantiation.** "Add to Projects" on a Pipeline listing copies the seller's blueprint
into the buyer's workspace as `status = 'draft'`, `visibility = 'unlisted'`, with
`source_blueprint_id` set and every `stage_assignments` row parked at `pending_funding`. No money
moves and nothing is reserved: a pipeline is staffed and then bought against, one ticket at a time
(`PRODUCT_SPEC.md` §Creation & Purchasing Gate). `source_blueprint_id` is what makes a repeated
press idempotent — the app resolves an existing draft by `(owner, blueprint)` rather than creating a
second identical pipeline.

**`archived` is soft deletion, and it is distinct from `cancelled`.** Nothing is hard-deleted (root
`CLAUDE.md` §7). `cancelled` records a decision somebody made about live work; `archived` records
that nothing ever happened — a draft the buyer removed, or one
`projects.fn_archive_stale_service_drafts` reclaimed after `service_draft_idle_days` (default 30) of
inactivity with no funded stage. `last_activity_at` is deliberately NOT `updated_at`: any write
touches the latter, so a draft that was merely renamed would keep escaping a sweep that measured it.

### `projects.project_stages`

Atomic units of work. Each stage has its own type, status, and specific delivery logic.

| Column                    | Type                   | Notes                                                              |
| :------------------------ | :--------------------- | :----------------------------------------------------------------- |
| `id`                      | uuid                   | PK.                                                                |
| `project_id`              | uuid                   | FK → `projects.projects.id`.                                       |
| `stage_type`              | stage_type_enum        | `file_based`, `session_based`, etc..                               |
| `status`                  | stage_status           | Current progress state.                                            |
| `sort_order`              | integer                | Execution order.                                                   |
| `start_trigger_type`      | start_trigger_type     | Defines when work can begin.                                       |
| `ip_mode`                 | ip_option_mode         | Override for stage-specific IP terms.                              |
| `milestone`               | text                   | Free-text delivery note. `''` when unset.                          |
| `unit_price_cents`        | bigint                 | Per-ticket price **and** a one-off stage's fixed price.            |
| `file_upload_required`    | boolean                | **Defaults `true`.**                                               |
| `seat_limit`              | integer                | `DEFAULT 3`; `NULL` = Unlimited.                                   |
| `parallel`                | boolean                | Runs alongside the stage above it rather than after it.            |
| `nda_override`            | boolean                | Recorded intent. **Enforces nothing yet** — see below.             |
| `allowed_file_categories` | files.file_category\[] | `NULL` or empty = all.                                             |
| `allowed_file_extensions` | text\[]                | `'{}'` = all.                                                      |
| `file_duration_mode`      | text                   | `fixed_deadline` \| `relative_duration` \| `no_due_date`, CHECKed. |

**`unit_price_cents` is the ONE price a stage has,** and a one-off stage's "fixed price" is the same
column rather than a second one. A one-off stage is a one-ticket stage, so a second column would
create two answers to "what does this stage cost" while `finance.fn_hold_ticket_escrow` reads only
this one — silently, which is what makes that class of divergence a money hole rather than a display
bug. Its `CHECK (… >= 0)` is not decorative either: a negative price was storable and flowed
straight into an escrow hold, where it inverts the direction the money moves.

**`file_upload_required` defaults `true`.** A stage exists to produce a deliverable, and the
submissions explorer, the review workspace and the escrow release all read a stage that owes nothing
as a stage with nothing to approve. The old `false` default made the common case the one the owner
had to remember to ask for. ⚠️ The column default alone is inert on the create path —
`projects.create_project` always supplies a value — so the RPC's own `COALESCE` fallback carries the
same `true`. Changing one without the other changes nothing.

**`seat_limit` is headcount, and `NULL` means Unlimited**, matching `finance.plan_entitlements`' own
nullable-as-unbounded convention. Deliberately **not** modelled as `max_concurrent_intensity`
(summed workload `W_i`, a different unit) and **not** as `stage_staffing_roles.quantity` (which
establishes one named role, not the stage's headcount). `> 0` rather than `>= 0`: a stage capped at
zero seats is a stage nobody can be assigned to, which `hire_trigger_active = false` already says
without pretending to be a number.

**`nda_override` stores intent and changes no behaviour.** Said plainly because the column looks
like a switch: the no-download, watermark and owner-only rules reach three separate readers that
consult no stage flag today. Writing it records what the owner asked for; nothing gates on it until
those readers are taught to ask.

**The file policy is two lists, and empty means ALL.** An empty allow-list meaning "nothing" would
make an unconfigured stage unsubmittable, and every stage starts unconfigured. Categories are the
coarse taxonomy (`files.file_category`, the Zod `FileCategory` literals verbatim); extensions are
the fine one, for a stage that wants `.fig` but not every Vector file. Both may be set, and a file
passes when it satisfies whichever lists are non-empty.

**`hasStages` is not a column and must not become one.** It is derived —
`structure_variation <> 'single_task'`. A real boolean creates two columns that can disagree about
whether a project has stages, while `projects.set_project_status` gates activation on the stage
COUNT. `projects.create_project` guarantees the count is never zero: a project that names no stage
is given one implicit `Delivery` stage carrying the project's own brief, price and IP terms.

---

## 👥 Staffing & Participation

### `projects.stage_assignments`

Maps a specific freelancer or team to a project stage.

| Column                  | Type            | Notes                                         |
| :---------------------- | :-------------- | :-------------------------------------------- |
| `project_stage_id`      | uuid            | FK → `projects.project_stages.id`.            |
| `assignee_type`         | assignment_type | `freelancer` or `team`.                       |
| `freelancer_profile_id` | uuid            | FK → `org.freelancer_profiles.id` (optional). |
| `team_id`               | uuid            | FK → `org.teams.id` (optional).               |

### `projects.project_participants`

A registry of all profiles (Business or Freelancer) with access to the project workspace.

### `projects.stage_staffing_roles` & `projects.stage_open_seats`

Used during the recruitment/staffing phase to define requirements and attract talent.

| Column                | Type    | Notes                                                         |
| :-------------------- | :------ | :------------------------------------------------------------ |
| `project_stage_id`    | uuid    | FK → `projects.project_stages.id`. A role hangs off a STAGE.  |
| `role_title`          | text    | The seat's name.                                              |
| `budget_amount_cents` | bigint  | Nullable. `NULL` = not priced yet; zero would say it is free. |
| `skills`              | text\[] | Freeform tags. `'{}'` when unset.                             |

**Nullable budget, and a skills column.** Both exist because the Create-Project modal collects a
role's name and skills but no budget — "quick to onboard, slow to set up". A `NOT NULL` budget
forced the write to invent a `0`, which the sibling `projects.budget_amount_cents` comment already
calls a lie: zero is a decision somebody took. The setup form's own save still refuses a budget-less
role, so the AMBER gate is enforced where the owner can act on it rather than at the moment of
naming.

`skills` mirrors `project_stages.skills` rather than joining `org.skills`: these are freeform tags
on one row, not entities. Without it `CreateProjectRoleSchema.skills` had nowhere to land and the
write silently discarded it.

---

## 🚀 Execution & Quality Control

### `projects.stage_submissions`

The formal handover of work for review.

```sql
CREATE TABLE projects.stage_submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_stage_id uuid NOT NULL,
  submitted_by uuid NOT NULL,
  title text NOT NULL,
  notes text,
  status text DEFAULT 'pending_review'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stage_submissions_pkey PRIMARY KEY (id)
);
```

### `projects.stage_revision_requests`

Tracks requests for changes following a submission.

| Column             | Type | Notes                              |
| :----------------- | :--- | :--------------------------------- |
| `project_stage_id` | uuid | FK → `projects.project_stages.id`. |
| `request_type`     | text | e.g., `minor`, `major`.            |
| `status`           | text | `open`, `in_progress`, `resolved`. |

---

## 🛠 Project Infrastructure

### `projects.project_activity`

A unified ledger of events occurring within a project (e.g., status changes, file uploads).

### `projects.user_preferences`

Per-user metadata for UI customization (e.g., starring or archiving projects). Own-rows-only under
RLS — see [Policies.md](Policies.md).

### `projects.ticket_history`

The ticket audit log: who moved what, when, and out of which status. Every row is written by a
`SECURITY DEFINER` RPC (`projects.move_ticket`, `projects.fn_assign_ticket_core`, …), never by a
client — there is no write policy at all, deliberately. See [Policies.md](Policies.md).

### `projects.project_invitations`

Project-scoped invitations, deliberately **not** `org.org_invitations` (which is org-scoped, has no
`project_id`/`project_stage_id`, and whose `check_invitation_target` CHECK requires exactly one of
`team_id`/`business_id` — so a stage-targeted project invite is structurally inexpressible in it).

| Column             | Type        | Notes                                                                 |
| :----------------- | :---------- | :-------------------------------------------------------------------- |
| `project_id`       | uuid        | FK → `projects.projects.id`, `ON DELETE CASCADE`.                     |
| `project_stage_id` | uuid        | `NULL` = whole-project invite; set = stage-targeted.                  |
| `target_email`     | text        | The invitee may have no account yet — the one participant reference   |
|                    |             | that cannot be a `user_id`. Acceptance is what turns it into one.     |
| `role`             | text        | CHECK-constrained to the roles the accept path can actually grant.    |
| `token`            | text UNIQUE | **The capability.** Whoever holds it can accept.                      |
| `status`           | text        | `pending`, `accepted`, `expired`, `revoked`.                          |
| `accepted_at`      | timestamptz | Set iff `status = 'accepted'` (`ck_project_invitations_accepted_at`). |

⚠️ Because `token` is the capability and RLS is row-level, **any policy that admits a row admits its
token**. The SELECT policy is therefore limited to the project owner and to the invited identity —
see [Policies.md](Policies.md) before widening it.

### `projects.maintenance_contracts`

Specifically for `maintenance_based` stages that require recurring billing logic.

---

## 🚩 Refactor Notes & Suggestions

- **Industry Categories**: `projects.projects` references `industry_category_id`, but no
  `industry_categories` table is defined in the current migration.
- **JSONB Consistency**: `description` in `projects.projects` and `project_stages` uses `jsonb`. We
  should define a standardized schema (e.g., Tiptap JSON or Markdown) to avoid rendering issues in
  the Fresh frontend.
- **Circular Dependencies**: `project_stages.start_dependency_stage_id` references its own table.
  Ensure the backend prevents circular logic (A depends on B, B depends on A) during project
  creation.
