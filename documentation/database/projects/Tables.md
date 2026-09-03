# projects Schema: Tables

The `projects` schema is the functional core of the platform. It manages the lifecycle of work, from
project definition and stage-based modularity to staffing, execution, and revision tracking.

## 📑 Core Project Management

### `projects.projects`

The top-level container for all collaborative work. It defines global settings, legal requirements,
and high-level metadata.

| Column                | Type            | Notes                                                                  |
| :-------------------- | :-------------- | :--------------------------------------------------------------------- |
| `id`                  | uuid            | PK. **The canonical address** — `/projects/:projectId` carries this.   |
| `slug`                | text UNIQUE     | Readable alternate read key. Written by the app at create.             |
| `client_business_id`  | uuid            | FK → `org.business_profiles.id`.                                       |
| `owner_user_id`       | uuid            | FK → `auth.users.id` (The creator).                                    |
| `status`              | project_status  | `draft`, `active`, `on_hold`, `completed`, `cancelled`, `archived`.    |
| `visibility`          | visibility      | Where the row sits NOW. **Server-derived**, never a client value.      |
| `publish_visibility`  | visibility      | Where the owner wants it once published — an INTENT. Default `public`. |
| `ip_ownership_mode`   | ip_option_mode  | Global default for the project.                                        |
| `timeline_preset`     | timeline_preset | `sequential`, `simultaneous`, `staggered`, `custom`.                   |
| `source_blueprint_id` | uuid            | FK → `marketplace.service_blueprints.id`; `NULL` when hand-built.      |
| `last_activity_at`    | timestamptz     | Last meaningful activity — what the draft sweep measures idleness by.  |
| `archived_at`         | timestamptz     | Set iff `status = 'archived'` (`ck_projects_archived_at`).             |
| `session_kind`        | text            | `none` \| `normal` \| `group`. `none` on any non-session format.       |
| `budget_type`         | budget_type     | `fixed_price` or `hourly_cap`. Defaults `fixed_price`.                 |
| `budget_amount_cents` | bigint          | Minor units. `NULL` = not set, which is not the same as zero.          |
| `nda_required`        | boolean         | Whether an NDA binds the parties. Says **that**, never **which**.      |
| `nda_source`          | text            | `platform` \| `custom`. Defaults `platform`.                           |
| `nda_document_id`     | uuid            | FK → `files.items.id`, `ON DELETE SET NULL`. `NULL` under `platform`.  |

**`id` is the address; `slug` is a read key.** `/projects/:projectId` carries the **uuid**. A
title-derived slug moves on the first rename, so a link built on one dies the moment the owner edits
the title — which is not an address. The uuid cannot collide, cannot be squatted, and does not
change, so it is what the Quick-Init modal navigates to on create and what a notification links.
`slug` is retained as a readable alternate: the resolvers accept either form, trying the slug first
and then the uuid, so every existing link keeps working. It stays globally `UNIQUE` because it is
still resolved from a bare path with no scope segment to disambiguate two identical slugs.

The column is `NOT NULL` with a generated `p-xxxxxxxxxxxx` fallback rather than `NOT NULL` bare,
because `projects.create_project` inserts without one. Until the Quick-Init create path shipped
**nothing in the repository wrote this column at all**, so on the live path every project would have
carried that opaque fallback permanently — which is why the fallback's shape is load-bearing and
must satisfy `ck_projects_slug_shape`. The create path now writes the title-derived form.

**Which NDA binds the parties.** `nda_required` has always said only **that** an NDA applies, never
**which** — so everyone on a project could be told they were bound by an agreement with no way to
read it. `nda_source` closes that: `platform` is Projective's own standard mutual NDA (no upload, no
legal review, and therefore the default), `custom` names a document the client supplies by reference
into `files.items` — never a copy, because an asset on this platform is one row with one owner and
one privacy scope, and copying the bytes would give them two lifetimes and two access answers.

It is an enum-shaped column rather than "a nullable document id where `NULL` means platform" because
a client who **intended** to attach their own and has not uploaded it yet is a real state the setup
form holds and warns about — and under the nullable-id shape that state is indistinguishable from a
deliberate choice of the platform standard.

`ck_projects_nda_document` is therefore **one-directional** — a `custom` source, or no document —
unlike the bidirectional `ck_projects_archived_at`: a `platform` NDA may never carry a document, but
`custom` with no document yet is legitimate. Making it bidirectional would make the "meant to
upload, hasn't yet" state unrepresentable and force the form to silently record `platform` instead —
i.e. to bind the parties to an agreement nobody chose. Neither column is tied to `nda_required`;
when no NDA applies they are simply ignored, so an owner who turns the requirement off and back on
still has the document they uploaded. `ON DELETE SET NULL` on the document lands the row in exactly
that warnable state, where `RESTRICT` would stop an owner tidying their own library and `CASCADE`
would delete a **project** because somebody removed a file.

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

**Visibility is two columns, and they answer two different questions.** `visibility` is where the
row sits right now; `publish_visibility` is where its owner wants it to sit once it goes live. One
column cannot hold both. A draft is minted `unlisted` so nothing half-written reaches Explore and it
must stay that way while it is a draft — but the setup form is only ever open WHILE the project is a
draft, so that is the only moment its owner can answer "and when it publishes, who sees it?".
Writing that answer to `visibility` publishes the draft; refusing to store it at all leaves the
form's dropdown reverting to a value nobody chose.

The promotion is one function — `liveVisibilityFor` in `@projective/types/projects`: a `draft` is
`unlisted` unconditionally, anything else takes the intent verbatim, including on the way back to
draft, which re-hides. It is applied server-side AFTER `projects.set_project_status` succeeds, so a
refused transition cannot leave a public row on a still-draft project, and it runs on every save, so
an already-published project's visibility change takes effect immediately. `visibility` is never
written from a client payload; `publish_visibility` is the only half the form can set.

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

| Column               | Type               | Notes                                     |
| :------------------- | :----------------- | :---------------------------------------- |
| `id`                 | uuid               | PK.                                       |
| `project_id`         | uuid               | FK → `projects.projects.id`.              |
| `stage_type`         | stage_type_enum    | `file_based`, `session_based`, etc..      |
| `status`             | stage_status       | Current progress state.                   |
| `sort_order`         | integer            | Execution order.                          |
| `start_trigger_type` | start_trigger_type | Defines when work can begin.              |
| `ip_mode`            | ip_option_mode     | Override for stage-specific IP terms.     |
| `milestone`          | text               | Free-text delivery note. `''` when unset. |
| `allowed_file_kinds` | text[]             | Submittable kinds. **Empty = any.**       |
| `nda_required`       | boolean            | Per-stage override; `NULL` inherits.      |
| `capacity`           | text               | `unlimited` (default) \| `limited`.       |
| `seat_count`         | integer            | 1–99. Set iff `capacity = 'limited'`.     |

These four are what the Stage-2 configuration surface collects per stage and the table previously
could not hold.

**`allowed_file_kinds`: empty means ANY.** It sits beside `file_upload_required` because the two
answer adjacent halves of one question — that one says whether a deliverable must be a file at all,
this says what kind of file counts. Empty is the **permissive** answer, not an unanswered one: a
stage nobody configured must never silently refuse a deliverable, because the refusal lands on the
freelancer at submission time and reads as a broken product rather than a term of the engagement. It
is `NOT NULL DEFAULT '{}'` unlike the nullable `skills` array beside it, and that difference is not
cosmetic — with a nullable column `NULL` and `{}` would both have to mean "any" while looking like
different states, and a reader would eventually treat one of them as "none permitted".

**`nda_required` is three-valued, and inherits on `NULL`.** `NULL` follows
`projects.projects.nda_required`; `true`/`false` override it for this stage alone. Nullable rather
than a boolean copied down at stage creation, because a copy goes stale the instant the
project-level term changes: after that nothing on the row says whether `false` means "deliberately
exempted" or "created back when the project required nothing". Three-valued, that question is
answerable. It is named for its SSOT field (`StageSetup.ndaRequired`) rather than following the
`ip_ownership_override` convention beside it, so the column and the shape the mapper reads it into
carry one name — a query joining both tables must alias, which is the price of the mapping being the
identity function.

**`capacity`/`seat_count` are a pair, because "unlimited" is an ANSWER.** Under a single
`seat_count integer NULL`, a client who deliberately opened a stage to everyone and one who has not
decided yet are the same row, and the seat meter has to draw the same thing for both.
`ck_project_stages_seat_count` is bidirectional — a `limited` stage carries a count and an
`unlimited` one does not — the same idiom as `ck_projects_archived_at`, so the two halves cannot
disagree. Without it an unlimited stage carrying a stale `3` would draw a meter over a stage that
has no ceiling.

⚠️ Three capacity-shaped things now live near each other and mean different things.
`max_concurrent_intensity` is the Project Hard Cap on **summed $W_i$** — a workload ceiling, not a
headcount. `projects.stage_open_seats` rows are the concrete, individually-described **postings**
recruitment fills. This pair is the stage's **declared shape**, which exists before any seat has
been posted and constrains how many may be.

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

### `projects.project_attachments`

The link table between a project and its reference files — the brief, the brand sheet, the spec.
Both columns are the composite primary key (`project_id`, `attachment_id` → `files.items.id`), so
there is nothing on the row to update: re-pointing a reference is a `DELETE` and an `INSERT`.

Carried **by reference**, never by copy: an asset on this platform is one `files.items` row with one
owner and one privacy scope, and a project attachment is a second surface onto an asset that may
also be a submission deliverable or a profile banner.

⚠️ This table had RLS enabled in `00002001` and **zero policies** for its whole life, which is
default deny — and default deny on a `SELECT` is silent, returning `200 []` rather than an error.
The attachments list therefore rendered as an empty list rather than a failure, the one shape nobody
investigates because it is indistinguishable from a project with no attachments. Policies now exist:
read via `projects.has_project_access` (the brief is what a participant works against), write
owner-only. See [Policies.md](Policies.md). Note that admitting a **link** never admits a **file** —
the bytes are governed separately by `files.fn_can_read`.

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
