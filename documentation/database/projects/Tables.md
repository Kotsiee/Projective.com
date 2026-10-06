# projects Schema: Tables

The `projects` schema is the functional core of the platform. It manages the lifecycle of work, from
project definition and stage-based modularity to staffing, execution, and revision tracking.

**30 tables**, all declared in `supabase/migrations/00000015_tables_projects.sql` (indexes in
`00004003_indexes_projects.sql`, triggers in `00001820`/`00001850`/`00001890`). Column lists below
follow the migration's own order. A column is **nullable with no default** unless its Notes say
otherwise; enum values are quoted from `00000003_enums_core.sql` / `00000004_enums_domains.sql`.

## 📑 Core Project Management

### `projects.projects`

The top-level container for all collaborative work. It defines global settings, legal requirements,
and high-level metadata.

| Column                      | Type                          | Notes                                                                                                   |
| :-------------------------- | :---------------------------- | :------------------------------------------------------------------------------------------------------ |
| `id`                        | uuid                          | PK, `DEFAULT gen_random_uuid()`. Internal only — it does **not** route.                                 |
| `client_business_id`        | uuid                          | FK → `org.business_profiles.id`. `NULL` = an individual client pays.                                    |
| `owner_user_id`             | uuid                          | NOT NULL. FK → `org.users_public.user_id` (the creator).                                                |
| `owner_team_id`             | uuid                          | FK → `org.teams.id`. Seller-side workspace the project is filed under.                                  |
| `owner_organisation_id`     | uuid                          | FK → `org.organisations.id`. Buyer-side workspace. Personal scope = no workspace column set; `owner_user_id` alone answers it. |
| `title`                     | text                          | NOT NULL.                                                                                               |
| `slug`                      | text UNIQUE                   | NOT NULL, no default. **The public address.** `prj-` + 10 symbols. Minted once, immutable.              |
| `description`               | jsonb                         | NOT NULL `DEFAULT '{}'`. Rich-text document.                                                            |
| `description_text`          | text                          | NOT NULL `DEFAULT ''`. Flattened text of `description`.                                                 |
| `format`                    | project_format                | NOT NULL `DEFAULT 'pipeline'`. `one_off`, `pipeline`, `session`.                                        |
| `structure_variation`       | projects.structure_variation  | NOT NULL `DEFAULT 'standard'`. `standard`, `one_off`, `single_task`, `single_stage`.                    |
| `session_kind`              | text                          | NOT NULL `DEFAULT 'none'`, CHECK `none` \| `normal` \| `group`. `none` on any non-session format.       |
| `status`                    | project_status                | NOT NULL `DEFAULT 'draft'`. `draft`, `active`, `on_hold`, `completed`, `cancelled`, `archived`.         |
| `industry_category_id`      | uuid                          | No FK — there is no categories table (see Refactor Notes).                                              |
| `visibility`                | visibility                    | NOT NULL `DEFAULT 'public'`. Where the row sits NOW. **Server-derived**, never a client value.          |
| `publish_visibility`        | visibility                    | NOT NULL `DEFAULT 'public'`. Where the owner wants it once published — an INTENT.                       |
| `currency`                  | text                          | NOT NULL `DEFAULT 'USD'`.                                                                               |
| `budget_type`               | budget_type                   | NOT NULL `DEFAULT 'fixed_price'`. `fixed_price` or `hourly_cap`.                                        |
| `budget_amount_cents`       | bigint                        | CHECK `NULL` or `>= 0`. Minor units. `NULL` = not set, which is not the same as zero.                  |
| `timeline_preset`           | timeline_preset               | NOT NULL `DEFAULT 'sequential'`. `sequential`, `simultaneous`, `staggered`, `custom`.                   |
| `target_project_start_date` | timestamptz                   |                                                                                                         |
| `ip_ownership_mode`         | ip_option_mode                | NOT NULL `DEFAULT 'exclusive_transfer'`. Global default for the project.                                |
| `nda_required`              | boolean                       | NOT NULL `DEFAULT false`. Whether an NDA binds the parties. Says **that**, never **which**.             |
| `nda_source`                | text                          | NOT NULL `DEFAULT 'platform'`, CHECK `platform` \| `custom`.                                            |
| `nda_document_id`           | uuid                          | FK → `files.items.id`, `ON DELETE SET NULL`. `NULL` under `platform`.                                   |
| `portfolio_display_rights`  | portfolio_rights              | NOT NULL `DEFAULT 'allowed'`. `allowed`, `forbidden`, `embargoed`.                                      |
| `location_restriction`      | text[]                        | `DEFAULT '{}'` (nullable).                                                                              |
| `language_requirement`      | text[]                        | `DEFAULT '{}'` (nullable).                                                                              |
| `screening_questions`       | jsonb                         | `DEFAULT '[]'` (nullable).                                                                              |
| `allow_deadline_bonuses`    | boolean                       | NOT NULL `DEFAULT false`. A ticket `due_date` is refused unless this is true (`trg_enforce_ticket_due_date`). |
| `created_at`                | timestamptz                   | NOT NULL `DEFAULT now()`.                                                                               |
| `updated_at`                | timestamptz                   | NOT NULL `DEFAULT now()`.                                                                               |
| `handover_unlocked_at`      | timestamptz                   | Protected-phase handover; stamped by `trg_project_handover_on_complete` on entering `completed`.       |
| `source_blueprint_id`       | uuid                          | FK → `marketplace.service_blueprints.id`, `ON DELETE SET NULL`; `NULL` when hand-built.                 |
| `last_activity_at`          | timestamptz                   | NOT NULL `DEFAULT now()`. Last meaningful activity — what the draft sweep measures idleness by.         |
| `archived_at`               | timestamptz                   | Set iff `status = 'archived'` (`ck_projects_archived_at`).                                              |

**Constraints:** `projects_slug_key` UNIQUE (`slug`) · `ck_projects_slug_shape` · `ck_projects_nda_document`
(`nda_source = 'custom' OR nda_document_id IS NULL`) · `ck_projects_archived_at`
(`(status = 'archived') = (archived_at IS NOT NULL)`). **Indexes:** `idx_projects_source_blueprint`
(`source_blueprint_id, owner_user_id, status` WHERE `source_blueprint_id IS NOT NULL`) ·
`idx_projects_stale_drafts` (`last_activity_at` WHERE `status = 'draft' AND source_blueprint_id IS NOT
NULL`). **Triggers:** `trg_projects_slug` (`security.fn_slug_guard('prj')`) · `trg_sync_project_search`
· `trg_update_project_counts` · `trg_project_handover_on_complete` · `trg_project_shape_lock` (freezes
`format`/`structure_variation` once a seat is taken) · `trg_check_public_project_footprint` ·
`trg_projects_touch_updated_at` (`projects.fn_touch_updated_at`, every `UPDATE` — `updated_at` is
what the Overview's "details changed" lane mark reads, Decision #146).

**`slug` is the address; `id` does not route.** `/projects/:projectSlug` carries a `prj-` slug and
nothing else — not the uuid, and not the title-derived slug this column used to hold. Both of those
were tried and both were wrong in their own way. A title-derived slug moves on the first rename, so
every link built on it — a notification, a bookmark, another member's message — dies the moment the
owner edits the title, silently and with a clean 404. The uuid never moves, but 36 characters of
undifferentiated hex say nothing about what they address, so a segment pasted into the wrong route
resolves against the wrong table with no shape to refuse it.

An opaque prefixed slug has neither problem: it is derived from nothing, so no edit can change it,
and the prefix makes it self-describing. It stays globally `UNIQUE` because it is resolved from a
bare path with no scope segment to disambiguate two identical slugs.

The shape is `^prj-[23456789abcdefghjkmnopqrstuvwxyz]{10}$` (`ck_projects_slug_shape`), which is
**tight on purpose**. The previous CHECK allowed any lowercase URL-safe string, so a title-derived
slug was still storable and "immutable and title-independent" rested on every write path remembering
to be. Here the database refuses it, so the guarantee holds for paths nobody has written yet — and a
lowercase uuid, which satisfied the old permissive form, can no longer be confused for an address.

`NOT NULL` with **no** `DEFAULT`. `security.fn_slug_guard` (a `BEFORE INSERT OR UPDATE` trigger,
`00001890_triggers_slugs.sql`) fills the column before the `NOT NULL` is checked, so an insert that
supplies no slug still gets a canonical one; the same trigger **refuses any UPDATE that would move
an existing slug**, which is what makes the address permanent rather than merely conventional. A
`DEFAULT` could do neither job: a `DEFAULT` expression may not contain a subquery, so generating ten
uniform symbols inline would mean the same ten-line expression copied into all four slugged tables,
and column defaults are laid down in category 0, before any function exists to call.

The alphabet is the 36 lowercase alphanumerics minus `0`, `1`, `i` and `l` — one member of each
confusable group, so `o` stays legible precisely because `0` is gone. Exactly 32 symbols, which is
load-bearing: 256 is a whole multiple of 32, so `byte % 32` is uniform where a 31-symbol alphabet
would need rejection sampling and the naive modulo would be silently biased. It is
character-identical to `SLUG_ALPHABET` in `@projective/types/slugs`, and `slug.contract.test.ts`
reads these migrations and fails if the two ever drift.

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

Atomic units of work. Each stage has its own status, schedule, pricing and delivery terms. There is
**no stage-archetype column**: every archetype's configuration columns (file, session) coexist on
one row, so a stage's kind is implicit in which columns the owner filled (see
`documentation/flows/Projects.md` §6.0).

| Column                      | Type                             | Notes                                                                                     |
| :-------------------------- | :------------------------------- | :---------------------------------------------------------------------------------------- |
| `id`                        | uuid                             | PK, `DEFAULT gen_random_uuid()`. Internal only — it does **not** route.                   |
| `project_id`                | uuid                             | NOT NULL. FK → `projects.projects.id` (no cascade).                                       |
| `name`                      | text                             | NOT NULL.                                                                                 |
| `slug`                      | text UNIQUE                      | NOT NULL, no default. **The public address.** `stg-` + 10 symbols; minted once, immutable. |
| `description`               | jsonb                            | NOT NULL `DEFAULT '{}'`.                                                                  |
| `description_text`          | text                             | NOT NULL `DEFAULT ''`.                                                                    |
| `sort_order`                | integer                          | NOT NULL. Execution order. Locked once the stage has started (`trg_stage_reorder_lock`).  |
| `status`                    | stage_status                     | NOT NULL `DEFAULT 'open'`. `open`, `assigned`, `in_progress`, `submitted`, `approved`, `revisions`, `paid`, `cancelled`. |
| `file_upload_required`      | boolean                          | NOT NULL `DEFAULT false`.                                                                 |
| `allowed_file_kinds`        | text[]                           | NOT NULL `DEFAULT '{}'`. Submittable kinds. **Empty = any.**                              |
| `default_tasks`             | jsonb                            | NOT NULL `DEFAULT '[]'`. The task TEMPLATE a ticket's `tasks` list is seeded from.        |
| `skills`                    | text[]                           | `DEFAULT '{}'` (nullable). Freeform tags.                                                 |
| `seat_limit`                | integer                          | `DEFAULT 3`, CHECK `NULL` or `> 0`. `NULL` = unlimited.                                   |
| `parallel`                  | boolean                          | NOT NULL `DEFAULT false`. Runs alongside the stage above it rather than after it.         |
| `nda_override`              | boolean                          | NOT NULL `DEFAULT false`. Records intent only; no reader enforces it yet.                 |
| `allowed_file_categories`   | files.file_category[]            | `NULL`/empty = all.                                                                       |
| `allowed_file_extensions`   | text[]                           | NOT NULL `DEFAULT '{}'`. Empty = all.                                                     |
| `unit_price_cents`          | bigint                           | CHECK `NULL` or `>= 0`. Pipeline per-ticket price, and the one-off stage's fixed price.   |
| `milestone`                 | text                             | NOT NULL `DEFAULT ''`. Free-text delivery note.                                           |
| `start_trigger_type`        | start_trigger_type               | NOT NULL `DEFAULT 'on_project_start'`. `fixed_date`, `on_project_start`, `on_hire_confirmed`, `dependent_on_stage`. |
| `fixed_start_date`          | timestamptz                      |                                                                                           |
| `start_dependency_stage_id` | uuid                             | FK → `projects.project_stages.id` (self).                                                 |
| `start_dependency_lag_days` | integer                          | `DEFAULT 0`.                                                                              |
| `hire_trigger_active`       | boolean                          | NOT NULL `DEFAULT true`.                                                                  |
| `file_revisions_allowed`    | integer                          | `DEFAULT 0`.                                                                              |
| `file_duration_mode`        | text                             | CHECK `NULL` or `fixed_deadline` \| `relative_duration` \| `no_due_date`.                 |
| `file_duration_days`        | integer                          |                                                                                           |
| `file_due_date`             | timestamptz                      |                                                                                           |
| `session_duration_minutes`  | integer                          |                                                                                           |
| `session_count`             | integer                          | `DEFAULT 1`.                                                                              |
| `session_preferred_days`    | text[]                           |                                                                                           |
| `session_end_date`          | timestamptz                      |                                                                                           |
| `ip_ownership_override`     | ip_option_mode                   |                                                                                           |
| `nda_required`              | boolean                          | Per-stage override; `NULL` inherits.                                                      |
| `created_at`                | timestamptz                      | NOT NULL `DEFAULT now()`.                                                                 |
| `completed_at`              | timestamptz                      |                                                                                           |
| `ip_mode`                   | ip_option_mode                   | `DEFAULT 'exclusive_transfer'` (nullable). Override for stage-specific IP terms.          |
| `assignment_mode`           | projects.assignment_routing_mode | NOT NULL `DEFAULT 'open_pull'`. `open_pull`, `round_robin`, `manual`, `parallel_stream`.  |
| `max_concurrent_intensity`  | numeric(6,2)                     | Project Hard Cap on summed $W_i$.                                                         |
| `capacity`                  | text                             | NOT NULL `DEFAULT 'unlimited'`, CHECK `unlimited` \| `limited`.                           |
| `seat_count`                | integer                          | CHECK `NULL` or 1–99. Set iff `capacity = 'limited'`.                                     |

**Constraints:** `project_stages_slug_key` UNIQUE (`slug`) · `ck_project_stages_slug_shape`
(`^stg-[23456789abcdefghjkmnopqrstuvwxyz]{10}$`) · `ck_project_stages_seat_count`
(`(capacity = 'limited') = (seat_count IS NOT NULL)`). **Index:** `idx_project_stages_project`
(`project_id`). **Triggers:** `trg_project_stages_slug` (`fn_slug_guard('stg')`) ·
`trg_stage_reorder_lock` (BEFORE UPDATE OF `sort_order`) · `trg_stage_delete_cascade` (BEFORE DELETE:
releases held escrow for its active tickets, scrubs the stage from other tickets' `required_stages`,
nulls dependants' `start_dependency_stage_id`) · `trg_enforce_structure_variation_stages` (BEFORE
INSERT: `single_task`/`single_stage` projects hold one stage). In the `supabase_realtime`
publication.

**The stage's address.** Same contract as `projects.projects.slug` — opaque, derived from nothing,
minted by `security.fn_slug_guard` and refused by it on any later update. Globally unique rather
than unique per project, even though a stage is only ever reached beneath one: the prefix already
says what kind of thing it is, and global uniqueness means a stage segment appearing anywhere (a
deep link, a submission path, a log line) identifies exactly one row without needing its parent
alongside it.

`allowed_file_kinds`, `nda_required`, `capacity` and `seat_count` are what the Stage-2 configuration
surface collects per stage and the table previously could not hold.

**`allowed_file_kinds`: empty means ANY.** It sits beside `file_upload_required` because the two
answer adjacent halves of one question — that one says whether a deliverable must be a file at all,
this says what kind of file counts. Empty is the **permissive** answer, not an unanswered one: a
stage nobody configured must never silently refuse a deliverable, because the refusal lands on the
freelancer at submission time and reads as a broken product rather than a term of the engagement. It
is `NOT NULL DEFAULT '{}'` unlike the nullable `skills` array beside it, and that difference is not
cosmetic — with a nullable column `NULL` and `{}` would both have to mean "any" while looking like
different states, and a reader would eventually treat one of them as "none permitted".
`allowed_file_categories` / `allowed_file_extensions` are a second, coarse/fine pair answering the
same question (a file passes when it satisfies whichever lists are non-empty).

**`nda_required` is three-valued, and inherits on `NULL`.** `NULL` follows
`projects.projects.nda_required`; `true`/`false` override it for this stage alone. Nullable rather
than a boolean copied down at stage creation, because a copy goes stale the instant the
project-level term changes: after that nothing on the row says whether `false` means "deliberately
exempted" or "created back when the project required nothing". Three-valued, that question is
answerable. It is named for its SSOT field (`StageSetup.ndaRequired`) rather than following the
`ip_ownership_override` convention beside it, so the column and the shape the mapper reads it into
carry one name — a query joining both tables must alias, which is the price of the mapping being the
identity function. (`nda_override` is an older boolean that tightens confidentiality and is not read
by any enforcement path.)

**`capacity`/`seat_count` are a pair, because "unlimited" is an ANSWER.** Under a single
`seat_count integer NULL`, a client who deliberately opened a stage to everyone and one who has not
decided yet are the same row, and the seat meter has to draw the same thing for both.
`ck_project_stages_seat_count` is bidirectional — a `limited` stage carries a count and an
`unlimited` one does not — the same idiom as `ck_projects_archived_at`, so the two halves cannot
disagree. Without it an unlimited stage carrying a stale `3` would draw a meter over a stage that
has no ceiling.

⚠️ Several capacity-shaped things live near each other and mean different things.
`max_concurrent_intensity` is the Project Hard Cap on **summed $W_i$** — a workload ceiling, not a
headcount. `projects.stage_open_seats` rows are the concrete, individually-described **postings**
recruitment fills. `capacity`/`seat_count` is the stage's **declared shape**, which exists before any
seat has been posted and constrains how many may be. `seat_limit` (nullable = unlimited,
`DEFAULT 3`) is an older headcount column from the creation wizard that coexists with that pair.

### `projects.project_status_history`

The project lifecycle transition ledger — one row per status change, written by
`projects.set_project_status` in the same transaction as the change.

| Column          | Type           | Notes                                                        |
| :-------------- | :------------- | :----------------------------------------------------------- |
| `id`            | uuid           | PK, `DEFAULT gen_random_uuid()`.                             |
| `project_id`    | uuid           | NOT NULL. FK → `projects.projects.id`, `ON DELETE CASCADE`.  |
| `actor_user_id` | uuid           | NOT NULL. FK → `org.users_public.user_id`.                   |
| `from_status`   | project_status | `NULL` on the first recorded transition.                     |
| `to_status`     | project_status | NOT NULL.                                                    |
| `reason`        | text           |                                                              |
| `created_at`    | timestamptz    | NOT NULL `DEFAULT now()`.                                    |

**Index:** `idx_project_status_history_project` (`project_id, created_at DESC`).

### `projects.project_required_skills`

Link table from a project to the canonical `org.skills` vocabulary. Composite PK
(`project_id`, `skill_id`); nothing else on the row.

| Column       | Type | Notes                                  |
| :----------- | :--- | :------------------------------------- |
| `project_id` | uuid | NOT NULL, PK. FK → `projects.projects.id`. |
| `skill_id`   | uuid | NOT NULL, PK. FK → `org.skills.id`.    |

---

## 👥 Staffing & Participation

### `projects.stage_assignments`

Maps a specific freelancer or team to a project stage.

| Column                  | Type            | Notes                                                                    |
| :---------------------- | :-------------- | :----------------------------------------------------------------------- |
| `id`                    | uuid            | PK, `DEFAULT gen_random_uuid()`.                                         |
| `project_stage_id`      | uuid            | NOT NULL. FK → `projects.project_stages.id`.                             |
| `assignee_type`         | assignment_type | NOT NULL. `freelancer` or `team`.                                        |
| `freelancer_profile_id` | uuid            | FK → `org.freelancer_profiles.user_id` (optional).                       |
| `team_id`               | uuid            | FK → `org.teams.id` (optional).                                          |
| `assigned_by`           | uuid            | NOT NULL. FK → `org.users_public.user_id`.                               |
| `is_client_managed`     | boolean         | NOT NULL `DEFAULT false`.                                                |
| `status`                | text            | NOT NULL, no CHECK. Written values include `assigned`, `accepted`, `pending_funding`; `released`/`cancelled`/`declined`/`completed` are the inactive set. |
| `created_at`            | timestamptz     | NOT NULL `DEFAULT now()`.                                                |

**Index:** `uq_stage_assignment_active_assignee` — UNIQUE on (`project_stage_id`, `assignee_type`,
`COALESCE(freelancer_profile_id, team_id)`) WHERE `status NOT IN ('released', 'cancelled',
'declined', 'completed')`: one active seat per assignee per stage. In the `supabase_realtime`
publication.

### `projects.project_participants`

A registry of all profiles (Business or Freelancer) with access to the project workspace.

| Column         | Type         | Notes                                                       |
| :------------- | :----------- | :---------------------------------------------------------- |
| `id`           | uuid         | PK, `DEFAULT gen_random_uuid()`.                            |
| `project_id`   | uuid         | NOT NULL. FK → `projects.projects.id`.                      |
| `profile_type` | profile_type | NOT NULL. `freelancer` or `business`.                       |
| `profile_id`   | uuid         | NOT NULL. Polymorphic on `profile_type` — no FK.            |
| `role`         | text         | NOT NULL, no CHECK.                                         |
| `created_at`   | timestamptz  | NOT NULL `DEFAULT now()`.                                   |

### `projects.stage_staffing_roles`

Used during the recruitment/staffing phase to define the named roles a stage needs.

| Column                    | Type        | Notes                                                         |
| :------------------------ | :---------- | :------------------------------------------------------------ |
| `id`                      | uuid        | PK, `DEFAULT gen_random_uuid()`.                              |
| `project_stage_id`        | uuid        | NOT NULL. FK → `projects.project_stages.id`. A role hangs off a STAGE. |
| `role_title`              | text        | NOT NULL. The seat's name.                                    |
| `quantity`                | integer     | NOT NULL `DEFAULT 1`.                                         |
| `budget_type`             | budget_type | NOT NULL `DEFAULT 'fixed_price'`.                             |
| `budget_amount_cents`     | bigint      | CHECK `NULL` or `>= 0`. `NULL` = not priced yet; zero would say it is free. |
| `skills`                  | text\[]     | NOT NULL `DEFAULT '{}'`. Freeform tags.                       |
| `additional_instructions` | text        | NOT NULL `DEFAULT ''`. One line of guidance beyond the title. |
| `allow_proposals`         | boolean     | NOT NULL `DEFAULT true`.                                      |
| `created_at`              | timestamptz | NOT NULL `DEFAULT now()`.                                     |

**Nullable budget, and a skills column.** Both exist because the Create-Project modal collects a
role's name and skills but no budget — "quick to onboard, slow to set up". A `NOT NULL` budget
forced the write to invent a `0`, which the sibling `projects.budget_amount_cents` comment already
calls a lie: zero is a decision somebody took. The setup form's own save still refuses a budget-less
role, so the AMBER gate is enforced where the owner can act on it rather than at the moment of
naming.

`skills` mirrors `project_stages.skills` rather than joining `org.skills`: these are freeform tags
on one row, not entities. Without it `CreateProjectRoleSchema.skills` had nowhere to land and the
write silently discarded it.

### `projects.stage_open_seats`

The concrete, individually-described postings recruitment fills.

| Column                 | Type        | Notes                                                                      |
| :--------------------- | :---------- | :------------------------------------------------------------------------- |
| `id`                   | uuid        | PK, `DEFAULT gen_random_uuid()`.                                           |
| `project_stage_id`     | uuid        | NOT NULL. FK → `projects.project_stages.id`.                               |
| `description_of_need`  | text        | NOT NULL.                                                                  |
| `budget_min_cents`     | bigint      |                                                                            |
| `budget_max_cents`     | bigint      |                                                                            |
| `require_proposals`    | boolean     | NOT NULL `DEFAULT true`.                                                   |
| `created_at`           | timestamptz | NOT NULL `DEFAULT now()`.                                                  |
| `status`               | text        | NOT NULL `DEFAULT 'open'`, CHECK `open` \| `filled` \| `closed` (`stage_open_seats_status_check`). |
| `filled_assignment_id` | uuid        | FK → `projects.stage_assignments.id`, `ON DELETE SET NULL`.                |

### `projects.stage_open_seat_skills`

The canonical skills an open seat requires (written by `projects.create_stage_open_seat`, which
skips unknown skill ids).

| Column     | Type | Notes                                                                  |
| :--------- | :--- | :--------------------------------------------------------------------- |
| `seat_id`  | uuid | NOT NULL, PK. FK → `projects.stage_open_seats.id`, `ON DELETE CASCADE`. |
| `skill_id` | uuid | NOT NULL, PK. FK → `org.skills.id`.                                    |

**Index:** `idx_stage_open_seat_skills_seat` (`seat_id`).

### `projects.project_applications`

A seller's application to work on a project, written by `projects.apply_to_project` /
`projects.apply_to_seat` / `projects.redeem_invite_link` (a stage invite link, Decision #145) and
resolved by `projects.assign_from_application` or `projects.reject_application` — both open to the
project's staffing authority (`can_manage_project_members`). What it applies to lives in
`project_application_targets`.

| Column                 | Type                         | Notes                                                                 |
| :--------------------- | :--------------------------- | :-------------------------------------------------------------------- |
| `id`                   | uuid                         | PK, `DEFAULT gen_random_uuid()`.                                      |
| `project_id`           | uuid                         | NOT NULL. FK → `projects.projects.id`.                                |
| `applicant_user_id`    | uuid                         | NOT NULL. FK → `org.users_public.user_id` (`project_applications_user_id_fkey`). |
| `applicant_type`       | text                         | NOT NULL, no CHECK (e.g. `freelancer`).                               |
| `applicant_profile_id` | uuid                         | NOT NULL. Polymorphic on `applicant_type` — no FK.                    |
| `message`              | text                         | PII-masked by `apply_to_project`.                                     |
| `status`               | projects.application_status | NOT NULL `DEFAULT 'pending'`. `pending`, `accepted`, `rejected`, `withdrawn`. |
| `invite_link_id`       | uuid                         | FK → `projects.stage_invite_links.id`. The link the request arrived through; NULL for a listing application. Provenance only (Decision #145). |
| `created_at`           | timestamptz                  | NOT NULL `DEFAULT now()`.                                             |
| `updated_at`           | timestamptz                  | NOT NULL `DEFAULT now()`.                                             |

**Triggers:** `trg_meter_application_allowance` (AFTER INSERT: meters the applicant's entitlement
allowance) · `trg_refund_withdrawn_application` (AFTER UPDATE OF `status`: refunds it on withdrawal).
**Indexes:** `idx_project_applications_invite_link` (`invite_link_id` WHERE NOT NULL).

### `projects.project_application_targets`

What one application targets — a stage, a staffing role or an open seat.

| Column           | Type                              | Notes                                                                       |
| :--------------- | :-------------------------------- | :-------------------------------------------------------------------------- |
| `id`             | uuid                              | PK, `DEFAULT gen_random_uuid()`.                                            |
| `application_id` | uuid                              | NOT NULL. FK → `projects.project_applications.id`, `ON DELETE CASCADE` (`pat_application_id_fkey`). |
| `target_type`    | projects.application_target_type | NOT NULL. `stage`, `role`, `seat`.                                          |
| `target_id`      | uuid                              | NOT NULL. Polymorphic on `target_type` — no FK.                             |

### `projects.project_invitations`

Project-scoped invitations, deliberately **not** `org.org_invitations` (which is org-scoped, has no
`project_id`/`project_stage_id`, and whose `check_invitation_target` CHECK requires exactly one of
`team_id`/`business_id` — so a stage-targeted project invite is structurally inexpressible in it).

| Column             | Type        | Notes                                                                 |
| :----------------- | :---------- | :-------------------------------------------------------------------- |
| `id`               | uuid        | PK, `DEFAULT gen_random_uuid()`.                                      |
| `project_id`       | uuid        | NOT NULL. FK → `projects.projects.id`, `ON DELETE CASCADE`.           |
| `project_stage_id` | uuid        | FK → `projects.project_stages.id`, `ON DELETE CASCADE`. `NULL` = whole-project invite; set = stage-targeted. |
| `target_email`     | text        | The invitee may have no account yet — a participant reference that    |
|                    |             | cannot be a `user_id`. Acceptance is what turns it into one.          |
| `target_user_id`   | uuid        | FK → `org.users_public.user_id` (CASCADE). A hire FROM A PROFILE names |
|                    |             | a person the platform already knows (Decision #108).                  |
| `message`          | text        | NOT NULL `DEFAULT ''`. The client's intro.                            |
| `offer_price_cents`| bigint      | The compensation for the stage this row names, in the project's       |
|                    |             | currency; NULL = the stage's configured rate applies. `CHECK >= 0`.   |
| `answers`          | jsonb       | NOT NULL `DEFAULT '{}'`, `CHECK` object. The client's answers to the  |
|                    |             | seller's `hire_intake`, keyed by field id.                            |
| `placeholder`      | boolean     | NOT NULL `DEFAULT false`. A seat on an UNPUBLISHED project whose terms |
|                    |             | are settled at publish. An attribute, never a status.                 |
| `role`             | text        | NOT NULL. CHECK `client`, `owner`, `admin`, `manager`, `freelancer`, `member`, `guest` — the roles the accept path can actually grant. |
| `inviter_user_id`  | uuid        | NOT NULL. FK → `org.users_public.user_id`.                            |
| `token`            | text UNIQUE | NOT NULL. **The capability.** Whoever holds it can accept.            |
| `status`           | text        | NOT NULL `DEFAULT 'pending'`. CHECK `pending`, `accepted`, `declined`, `expired`, `revoked`. |
| `created_at`       | timestamptz | NOT NULL `DEFAULT now()`.                                             |
| `expires_at`       | timestamptz | `NULL` = never expires; `status = 'expired'` is the sweep's record that it noticed. |
| `accepted_at`      | timestamptz | Set iff `status = 'accepted'` (`ck_project_invitations_accepted_at`). |
| `declined_at`      | timestamptz | Set iff `status = 'declined'` (`ck_project_invitations_declined_at`). The invitee's refusal; the instant the **48-day re-invitation cooldown** counts from. |
| `dismissed_at`     | timestamptz | The CLIENT took the record off their Invitations list (`ck_project_invitations_dismissed`: never on a `pending` row). Set by the client's "Dismiss" on a declined/expired record, and by `remove_project_member` retiring an accepted record whose member was removed. The answer underneath is kept — a dismissed decline still starts the cooldown (the cooldown read consults `declined_at`, never this column). An attribute, never a status. |

**Constraints:** `ck_project_invitations_addressee` · `ck_project_invitations_offer_price` ·
`ck_project_invitations_answers_shape` · `project_invitations_role_check` ·
`project_invitations_status_check` · `ck_project_invitations_accepted_at` ·
`ck_project_invitations_declined_at` · `ck_project_invitations_dismissed`. **Indexes:**
`idx_project_invitations_target_user` (`target_user_id, status` WHERE `target_user_id IS NOT NULL`)
· `uq_project_invitations_open_seat` · `uq_project_invitations_open_email` (both below).

**Exactly one addressee** — `ck_project_invitations_addressee` requires `target_email` XOR
`target_user_id`. Email-addressed rows are the pre-existing "invite someone who may have no
account" path; identity-addressed rows are the profile Hire / Add-to-project flow, which cannot
address by email because `org.user_emails` is own-rows-only and the inviter may not read the
invitee's address. `placeholder` is DERIVED by the fat service (`resolveHireOffer`: any draft
project, or any unpriced selected stage) and never trusted from a caller — a caller who could mark a
live project's invitation "placeholder" could invite somebody onto a priced stage while stating no
price. One OPEN offer per seat: `uq_project_invitations_open_seat` is a partial unique index on
`(project_id, project_stage_id, target_user_id) NULLS NOT DISTINCT WHERE status = 'pending' AND
target_user_id IS NOT NULL`, so a double-press cannot stack a second pending offer under the first,
and two whole-project offers (`project_stage_id` NULL) collide too.
`uq_project_invitations_open_email` — the email-addressed twin: a partial unique index on
(project_id, project_stage_id, lower(target_email)) NULLS NOT DISTINCT WHERE status = 'pending' AND
target_email IS NOT NULL; `projects.invite_by_email` re-raises it as a readable unique_violation
(Decision #141).

**Re-invitation cooldown.** A `declined` row locks the `(project, invitee)` pair for
`INVITE_COOLDOWN_DAYS` (48) days from `declined_at` — the fat service refuses a new invitation to
that person on that project until it lifts (`activeInviteCooldown` / `hireInvitationRefusal`,
`packages/types/projects/hire.ts`), the profile's Add-to-project rows are disabled with the date,
and `projects.invite_to_project` refuses it a second time in the database (the SQL's `interval '48
days'` is pinned to the TypeScript constant by `hire.contract.test.ts`). `revoked` is the INVITER's
act and starts no cooldown. Outbound invitations are additionally rate-limited per acting identity
(`HIRE_RATE_LIMIT`: 10 per sliding 10 minutes, in-process).

**The client's three acts on a record** (2026-09-21) are decided by its status alone
(`inviteActionFor`, `packages/types/projects/members.ts`): a `pending` offer is **cancelled**
(`status → revoked`) and a `declined`/`expired` record is **dismissed** (`dismissed_at`, the answer
kept), both through `projects.act_on_invitation` so an admin or manager can perform them without a
direct-write grant (Decision #145); an `accepted` record's action is to **remove the
freelancer it brought in** (`projects.remove_project_member`, see [Functions.md](Functions.md)),
which retires the record with `dismissed_at`. A stage-scoped Members page lists only the
invitations addressed to that stage (`invitesForScope`); a whole-project invitation appears in
project scope alone.

⚠️ Because `token` is the capability and RLS is row-level, **any policy that admits a row admits its
token**. The SELECT policy is therefore limited to the project's staffing authority
(`can_manage_project_members` — the owner, the client business, an appointed admin or manager) and to
the invited identity — see [Policies.md](Policies.md) before widening it.

### `projects.stage_invite_links`

A stage's shareable invite link (Decision #145). Holding it lets a signed-in person **ask** to join
the stage — `projects.redeem_invite_link` files a pending `project_applications` row carrying
`invite_link_id` — and nothing more: no seat, ticket or escrow moves until the request is accepted
from the Requests section. Lifecycle `active → revoked` (terminal); a reset revokes the active row
and mints a new one in one transaction, so the old URL dies first. Nothing is deleted.

| Column             | Type        | Notes                                                                 |
| :----------------- | :---------- | :-------------------------------------------------------------------- |
| `id`               | uuid        | PK, `DEFAULT gen_random_uuid()`.                                      |
| `project_id`       | uuid        | NOT NULL. FK → `projects.projects.id`, `ON DELETE CASCADE`.           |
| `project_stage_id` | uuid        | NOT NULL. FK → `projects.project_stages.id`, `ON DELETE CASCADE`.     |
| `token`            | text UNIQUE | NOT NULL. **The capability to ask.** 18 random bytes as unpadded base64url (`ck_stage_invite_links_token`: 24 chars of `[A-Za-z0-9_-]`). |
| `status`           | text        | NOT NULL `DEFAULT 'active'`. CHECK `active`, `revoked`.               |
| `created_by`       | uuid        | NOT NULL. FK → `org.users_public.user_id`. Shown as "shared by".      |
| `created_at`       | timestamptz | NOT NULL `DEFAULT now()`.                                             |
| `revoked_at`       | timestamptz | Set iff `status = 'revoked'` (`ck_stage_invite_links_revoked`).       |
| `revoked_by`       | uuid        | FK → `org.users_public.user_id`. Who reset or turned the link off.    |

**Constraints:** `stage_invite_links_status_check` · `ck_stage_invite_links_revoked` ·
`ck_stage_invite_links_token`. **Indexes:** `uq_stage_invite_links_active` — one ACTIVE link per
stage (partial unique on `project_stage_id` WHERE `status = 'active'`). RLS: staffing authority
reads; no write policy — every write is a definer door (`get_stage_invite_link` ·
`revoke_stage_invite_link` · `redeem_invite_link`, see [Functions.md](Functions.md)).

---

## 🎫 Tickets & Workload

### `projects.tickets`

The unit of work a client commissions and a freelancer claims. Its lifecycle columns (`status`,
`current_stage_id`, `claimed_at`, `payment_status`, `unit_price_cents`) are written only by the
`SECURITY DEFINER` ticket RPCs; the board's commit writes the client-owned content.

| Column                | Type                     | Null     | Default                  | Meaning                                                                                                                      |
| :-------------------- | :----------------------- | :------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | uuid                     | NOT NULL | `gen_random_uuid()`      | PK.                                                                                                                          |
| `project_id`          | uuid                     | NOT NULL | —                        | FK → `projects.projects.id`, `ON DELETE CASCADE`.                                                                            |
| `current_stage_id`    | uuid                     | null     | —                        | FK → `projects.project_stages.id`, `ON DELETE SET NULL`. The stage the ticket is in; `NULL` in the New/Completed bookends.  |
| `current_assignee_id` | uuid                     | null     | —                        | FK → `auth.users.id`, `ON DELETE SET NULL`. The provider-side freelancer who claimed it.                                    |
| `slug`                | text UNIQUE              | NOT NULL | — (minted by trigger)    | **The public address.** `tkt-` + 10 symbols. Minted once, immutable.                                                         |
| `owner_user_id`       | uuid                     | null     | —                        | FK → `org.users_public.user_id`, `ON DELETE SET NULL` (`tickets_owner_user_id_fkey`). The CLIENT-side member accountable for the ticket in a multi-member workspace; `NULL` in personal scope. |
| `title`               | text                     | NOT NULL | —                        | A title-only ticket is a valid draft.                                                                                        |
| `description`         | jsonb                    | NOT NULL | `'{}'`                   | Rich-text brief. Required (with `text_description`) before purchase/claim (`trg_enforce_ticket_checkout_desc`).              |
| `text_description`    | text                     | NOT NULL | `''`                     | Flattened rich text, for search.                                                                                             |
| `status`              | ticket_status            | NOT NULL | `'backlog'`              | `backlog`, `todo`, `claimed`, `in_progress`, `in_review`, `completed`, `cancelled`, `reported_hidden`.                       |
| `priority`            | projects.ticket_priority | NOT NULL | `'normal'`               | `low`, `normal`, `high`, `urgent`. Triage rank only — moves neither escrow nor $W_i$.                                        |
| `attachment_count`    | smallint                 | NOT NULL | `0`                      | Counter on the ticket (no ticket↔file link table).                                                                           |
| `required_stages`     | jsonb                    | NOT NULL | `'[]'`                   | The stages this ticket must pass, in order: `[{"stage_id": "uuid", "order": 1}]`.                                            |
| `tasks`               | jsonb                    | NOT NULL | `'[]'`                   | The ticket's own checklist: `[{"id", "text", "done", "completed_by": [...]}]`, order-significant. Seeded from the stage's `default_tasks`; distinct from `stage_submissions.checked_item_ids`. |
| `due_date`            | timestamptz              | null     | —                        | Refused unless the project has `allow_deadline_bonuses = true` (`trg_enforce_ticket_due_date`).                              |
| `workload_intensity`  | numeric(4,2)             | NOT NULL | `1.00`                   | The agreed capacity cost $W_i$ (the multiplier's RESULT, not the multiplier). Summed into the assignee's `org.freelancer_profiles.current_workload_intensity`. |
| `payment_status`      | payment_status           | NOT NULL | `'unpaid'`               | `unpaid`, `escrow_funded`, `partially_released`, `released`, `refunded`.                                                     |
| `unit_price_cents`    | bigint                   | null     | —                        | The agreed per-ticket price, minor units. No CHECK.                                                                          |
| `total_amount_paid`   | bigint                   | NOT NULL | `0`                      | CHECK `>= 0`. Running total paid, minor units.                                                                               |
| `sort_order`          | integer                  | null     | —                        | Manual order — valid only while `status = 'backlog'` (`trg_ticket_ordering_guard`); other lanes order by `updated_at DESC`. |
| `claimed_at`          | timestamptz              | null     | —                        | Stamped on claim, cleared on unassignment (`trg_ticket_claim_before`).                                                       |
| `hidden_until`        | timestamptz              | null     | —                        | End of the workload-report response window while the ticket is hidden (set by `fn_open_workload_report`).                    |
| `workload_report_id`  | uuid                     | null     | —                        | The open `ticket_workload_reports.id`. **No FK.**                                                                            |
| `created_at`          | timestamptz              | NOT NULL | `now()`                  |                                                                                                                              |
| `updated_at`          | timestamptz              | NOT NULL | `now()`                  | Refreshed on every UPDATE (`trg_ticket_touch_updated_at`).                                                                   |

**Constraints:** PK (`id`) · `tickets_slug_key` UNIQUE (`slug`) · `ck_tickets_slug_shape`
(`^tkt-[23456789abcdefghjkmnopqrstuvwxyz]{10}$`) · CHECK `total_amount_paid >= 0`. Outbound FKs are
the four above (inline, default-named except `tickets_owner_user_id_fkey`). **Inbound FKs:**
`ticket_history.ticket_id` and `ticket_workload_reports.ticket_id` (`ON DELETE CASCADE`);
`stage_submissions.ticket_id` and `stage_revision_requests.ticket_id` (no action — a ticket with
submissions or revision requests cannot be deleted); `finance.escrows.ticket_id` (`ON DELETE SET
NULL`).

**Indexes:** `idx_tickets_project` (`project_id`) · `idx_tickets_stage` (`current_stage_id`) ·
`idx_tickets_assignee` (`current_assignee_id`) · `idx_tickets_stage_sort` (`current_stage_id,
sort_order`) · `idx_tickets_stage_recent` (`current_stage_id, updated_at DESC`) ·
`idx_tickets_project_status` (`project_id, status`) · `idx_tickets_project_sort` (`project_id,
sort_order`).

**Triggers** (`00001850` unless noted; trigger functions in `00001110`/`00001120`/`00001130`/`00001140`):

| Trigger                                  | Timing / event                                                  | Effect                                                                                                                       |
| :--------------------------------------- | :-------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `trg_tickets_slug` (`00001890`)          | BEFORE INSERT OR UPDATE                                         | `security.fn_slug_guard('tkt')`: mints a missing slug, refuses a moved one.                                                  |
| `trg_enforce_structure_variation_tickets`| BEFORE INSERT                                                   | `one_off` / `single_task` projects hold one ticket.                                                                          |
| `trg_enforce_ticket_due_date`            | BEFORE INSERT OR UPDATE OF `due_date`                           | Refuses a due date unless `projects.allow_deadline_bonuses`.                                                                 |
| `trg_ticket_touch_updated_at`            | BEFORE UPDATE                                                   | `updated_at := now()`.                                                                                                       |
| `trg_enforce_ticket_checkout_desc`       | BEFORE UPDATE                                                   | Entering `escrow_funded` or `claimed`/`in_progress` requires a description.                                                  |
| `trg_ticket_ordering_guard`              | BEFORE UPDATE OF `sort_order`                                   | Refuses a manual reorder outside `backlog`.                                                                                  |
| `trg_ticket_immutability_guard`          | BEFORE UPDATE                                                   | Once claimed, `title`/`description`/`text_description`/`unit_price_cents`/`required_stages`/`workload_intensity` are locked to all but the assignee and admins. |
| `trg_ticket_authority_guard`             | BEFORE UPDATE OF `status` OR DELETE                             | `fn_ticket_settlement_guard`: only review authority (`can_review_project`) may complete or delete; service role ungated.      |
| `trg_ticket_claim_before`                | BEFORE UPDATE OF `current_assignee_id`, `status`                | Stamps `claimed_at`; unassignment resets to `backlog`.                                                                       |
| `trg_ticket_delete_protocol`             | BEFORE DELETE                                                   | Releases held escrow before the row goes.                                                                                    |
| `trg_ticket_escrow_sync`                 | AFTER UPDATE OF `current_assignee_id`, `status`                 | Claim → `finance.fn_hold_ticket_escrow`; `completed` or unassignment → `finance.fn_release_ticket_escrow`.                     |
| `trg_sync_workload_intensity`            | AFTER INSERT OR DELETE OR UPDATE OF `current_assignee_id`, `status`, `workload_intensity` | Recomputes the old/new assignee's `current_workload_intensity` over `claimed`/`in_progress`/`in_review` tickets. |
| `trg_ticket_review_submission` (`00001820`) | AFTER UPDATE OF `status`                                     | Entering `in_review` files a placeholder `stage_submissions` row unless a `pending_review` one already exists.                |

**The slug is the deep link, not a path.** A ticket is opened by `?tkv=<slug>` on whichever page the
viewer is already on (the modal is global — `apps/web/features/projects/islands/TicketDeepLinkHost`),
so unlike a project or stage it has no route segment of its own. It is globally unique for the same
reason a stage's is: the link arrives with no project alongside it and must name exactly one row.
Same contract as `projects.projects.slug` — `NOT NULL` with **no** `DEFAULT`, filled and pinned by
`security.fn_slug_guard('tkt')` (`00001890_triggers_slugs.sql`), shaped by `ck_tickets_slug_shape`
(`^tkt-[23456789abcdefghjkmnopqrstuvwxyz]{10}$`), cross-checked against `@projective/types/slugs` by
`slug.contract.test.ts`. Because every insert passes through the trigger, a ticket created by any
path — the board's PostgREST insert, `projects.create_project`'s seeding, a future RPC — is
addressable from the moment it exists, and there is no backfill to run on a reset-driven schema.

Read by `/api/projects/ticket?slug=` (`ProjectBackendService.ticket`), which resolves the ticket's
project under the caller's own JWT and then performs the ordinary board read — so RLS on this table
and the board's participant scoping make the access decision, and a ticket the viewer may not open
is reported with the same words as one that does not exist.

### `projects.ticket_history`

The ticket audit log: who moved what, when, and out of which status. Every row is written by a
`SECURITY DEFINER` RPC (`projects.move_ticket`, `projects.fn_assign_ticket_core`, …), never by a
client — there is no write policy at all, deliberately. See [Policies.md](Policies.md).

| Column              | Type          | Notes                                                                  |
| :------------------ | :------------ | :--------------------------------------------------------------------- |
| `id`                | uuid          | PK, `DEFAULT gen_random_uuid()`.                                       |
| `ticket_id`         | uuid          | NOT NULL. FK → `projects.tickets.id`, `ON DELETE CASCADE`.             |
| `actor_id`          | uuid          | NOT NULL. FK → `auth.users.id`, `ON DELETE RESTRICT`.                  |
| `action_type`       | text          | NOT NULL, no CHECK (e.g. `created`, `stage_moved`, `status_changed`, `reassigned`, `metadata_updated`). |
| `previous_stage_id` | uuid          | FK → `projects.project_stages.id`, `ON DELETE SET NULL`.               |
| `new_stage_id`      | uuid          | FK → `projects.project_stages.id`, `ON DELETE SET NULL`.               |
| `previous_status`   | ticket_status |                                                                        |
| `new_status`        | ticket_status |                                                                        |
| `changes`           | jsonb         | NOT NULL `DEFAULT '{}'`. Any other modified attributes, as a diff.     |
| `created_at`        | timestamptz   | NOT NULL `DEFAULT now()`.                                              |

**Indexes:** `idx_ticket_history_ticket` (`ticket_id`) · `idx_ticket_history_timeline` (`ticket_id,
created_at DESC`).

### `projects.ticket_workload_reports`

A freelancer's report that a ticket's workload was mis-stated, filed by
`projects.file_workload_report`. Inserting one hides the ticket for the response window.

| Column               | Type                            | Notes                                                       |
| :------------------- | :------------------------------ | :---------------------------------------------------------- |
| `id`                 | uuid                            | PK, `DEFAULT gen_random_uuid()`.                            |
| `ticket_id`          | uuid                            | NOT NULL. FK → `projects.tickets.id`, `ON DELETE CASCADE`.  |
| `reporter_user_id`   | uuid                            | NOT NULL. FK → `org.users_public.user_id`.                  |
| `claimed_intensity`  | numeric(4,2)                    | The ticket's `workload_intensity` at filing.                |
| `reported_intensity` | numeric(4,2)                    | What the reporter says it should be.                        |
| `reason`             | text                            | NOT NULL.                                                   |
| `status`             | projects.workload_report_status | NOT NULL `DEFAULT 'open'`. `open`, `acknowledged`, `adjusted`, `expired_penalized`, `dismissed_bad_faith`. |
| `hidden_until`       | timestamptz                     |                                                             |
| `created_at`         | timestamptz                     | NOT NULL `DEFAULT now()`.                                   |
| `resolved_at`        | timestamptz                     |                                                             |

**Indexes:** `idx_workload_reports_ticket` (`ticket_id`) · `idx_workload_reports_sweep` (`status,
hidden_until`). **Trigger:** `trg_open_workload_report` (AFTER INSERT) clears the ticket's
assignee (which resets it to backlog and releases escrow via the ticket triggers), sets its
`hidden_until` to now + `workload_report_window_hours` (default 48) and points
`tickets.workload_report_id` at the report.

---

## 🚀 Execution & Quality Control

### `projects.stage_submissions`

The formal handover of work for review — one row per delivery against a (stage, ticket).

| Column             | Type        | Null     | Default             | Meaning                                                                                                     |
| :----------------- | :---------- | :------- | :------------------ | :---------------------------------------------------------------------------------------------------------- |
| `id`               | uuid        | NOT NULL | `gen_random_uuid()` | PK (`stage_submissions_pkey`).                                                                              |
| `project_stage_id` | uuid        | NOT NULL | —                   | FK → `projects.project_stages.id` (`stage_submissions_project_stage_id_fkey`, no action).                  |
| `ticket_id`        | uuid        | NOT NULL | —                   | FK → `projects.tickets.id` (`stage_submissions_ticket_id_fkey`, no action). Every submission delivers against a ticket. |
| `submitted_by`     | uuid        | NOT NULL | —                   | FK → `org.users_public.user_id` (`stage_submissions_submitted_by_fkey`).                                    |
| `notes`            | text        | null     | —                   | Legacy plain note; `submit_deliverable` writes `NULL` (the brief lives in `description`).                   |
| `created_at`       | timestamptz | NOT NULL | `now()`             |                                                                                                             |
| `title`            | text        | NOT NULL | —                   | `submit_deliverable` falls back to `New Submission #<number>`; the Review trigger writes `Review: <ticket title>`. |
| `status`           | text        | **null** | `'pending_review'`  | CHECK `draft` \| `pending_review` \| `accepted` \| `revisions_requested` (`stage_submissions_status_check`). Not `NOT NULL`, so the CHECK admits `NULL`. Note the plural `revisions_requested`. |
| `description`      | jsonb       | NOT NULL | `'{}'`              | The delivery note (the app stores `{"html": …}`).                                                           |
| `checked_item_ids` | jsonb       | NOT NULL | `'[]'`              | The ticket `tasks` ids this delivery claims to satisfy.                                                     |
| `number`           | integer     | null     | —                   | Per-stage sequence, `MAX(number) + 1` within `project_stage_id` at insert. No UNIQUE. `NULL` on drafts inserted directly. |
| `reviewed_by`      | uuid        | null     | —                   | FK → `org.users_public.user_id` (default-named). Set by `review_submission`.                                |
| `reviewed_at`      | timestamptz | null     | —                   | Set by `review_submission`.                                                                                 |
| `feedback`         | jsonb       | null     | —                   | The reviewer's feedback; only `review_submission` writes it (`feedback->>'global'` seeds the revision request's reason). |
| `revision_of`      | uuid        | null     | —                   | FK → `projects.stage_submissions.id` (self), `ON DELETE SET NULL`. The submission this one revises. No RPC writes it yet. |
| `updated_at`       | timestamptz | NOT NULL | `now()`             | No touch trigger — the writers set it explicitly.                                                           |

**Constraints:** `stage_submissions_pkey` · `stage_submissions_status_check` · the four FKs above.
**Inbound FK:** `submission_files.submission_id` (`ON DELETE CASCADE`). **Indexes:**
`idx_stage_submissions_stage` (`project_stage_id, created_at DESC`) · `idx_stage_submissions_ticket`
(`ticket_id, created_at DESC`). No trigger fires **on** this table; it is in the `supabase_realtime`
publication.

**Writers.** `projects.submit_deliverable` inserts a `pending_review` row with the next `number`,
links its files into `submission_files` (skipping unknown ids), then moves the ticket to
`in_review`. `trg_ticket_review_submission` (on `projects.tickets`) files a placeholder
`pending_review` row when a ticket enters `in_review` with none pending — idempotent with
`submit_deliverable`, which inserts first. The fat service inserts `draft` rows directly under RLS
and sends a draft by UPDATE to `pending_review`. `projects.review_submission` (review authority only,
`pending_review` rows only) sets `accepted` or `revisions_requested` with `reviewed_by`/`reviewed_at`/
`feedback`; a revision request also inserts a `stage_revision_requests` row and bounces the ticket
from `in_review` to `in_progress`. The Zod `SubmissionStatus` spells the last state
`revision_requested` — `toSubmissionStatus` (`live-support.ts`) maps between them.

### `projects.submission_files`

The submission → `files.items` link. Carried by reference, like every asset link on the platform.

| Column          | Type | Notes                                                                                 |
| :-------------- | :--- | :------------------------------------------------------------------------------------ |
| `id`            | uuid | PK, `DEFAULT gen_random_uuid()`.                                                      |
| `submission_id` | uuid | NOT NULL. FK → `projects.stage_submissions.id`, `ON DELETE CASCADE` (`fk_sub_file_submission`). |
| `file_id`       | uuid | NOT NULL. FK → `files.items.id`, `ON DELETE CASCADE` (`fk_sub_file_item`).            |

**Index:** `idx_submission_files_submission` (`submission_id`). No UNIQUE on the pair.

### `projects.stage_revision_requests`

Tracks requests for changes following a submission.

| Column             | Type        | Notes                                                                       |
| :----------------- | :---------- | :-------------------------------------------------------------------------- |
| `id`               | uuid        | PK, `DEFAULT gen_random_uuid()`.                                            |
| `project_stage_id` | uuid        | NOT NULL. **No FK.**                                                        |
| `ticket_id`        | uuid        | NOT NULL. FK → `projects.tickets.id` (no action).                           |
| `requested_by`     | uuid        | NOT NULL. FK → `org.users_public.user_id`.                                  |
| `request_type`     | text        | NOT NULL, no CHECK. `review_submission` writes `revision`.                  |
| `reason`           | text        | NOT NULL.                                                                   |
| `status`           | text        | NOT NULL `DEFAULT 'open'`, no CHECK.                                        |
| `created_at`       | timestamptz | NOT NULL `DEFAULT now()`.                                                   |
| `resolved_at`      | timestamptz |                                                                             |

---

## 🎓 Sessions & Cohorts

### `projects.cohorts`

A group of attendees on a `session` engagement.

| Column       | Type                   | Notes                                                       |
| :----------- | :--------------------- | :---------------------------------------------------------- |
| `id`         | uuid                   | PK, `DEFAULT gen_random_uuid()`.                            |
| `project_id` | uuid                   | NOT NULL. FK → `projects.projects.id`.                      |
| `name`       | text                   | NOT NULL.                                                   |
| `max_seats`  | integer                | NOT NULL `DEFAULT 1`.                                       |
| `status`     | projects.cohort_status | NOT NULL `DEFAULT 'enrolling'`. `enrolling`, `active`, `completed`, `cancelled`. |
| `created_at` | timestamptz            | NOT NULL `DEFAULT now()`.                                   |

### `projects.cohort_memberships`

Who is enrolled in a cohort. One row per (cohort, user) — `cohort_memberships_unique_user`.

| Column      | Type        | Notes                                              |
| :---------- | :---------- | :------------------------------------------------- |
| `id`        | uuid        | PK, `DEFAULT gen_random_uuid()`.                   |
| `cohort_id` | uuid        | NOT NULL. FK → `projects.cohorts.id`.              |
| `user_id`   | uuid        | NOT NULL. FK → `org.users_public.user_id`.         |
| `status`    | text        | NOT NULL `DEFAULT 'active'`, no CHECK.             |
| `joined_at` | timestamptz | NOT NULL `DEFAULT now()`.                          |

### `projects.session_events`

One scheduled sitting of a cohort.

| Column              | Type                          | Notes                                                                |
| :------------------ | :---------------------------- | :------------------------------------------------------------------- |
| `id`                | uuid                          | PK, `DEFAULT gen_random_uuid()`.                                     |
| `cohort_id`         | uuid                          | NOT NULL. FK → `projects.cohorts.id`.                                |
| `title`             | text                          | NOT NULL.                                                            |
| `slug`              | text UNIQUE                   | NOT NULL, no default. **The public address.** `ssn-` + 10 symbols. Minted once, immutable. |
| `start_time`        | timestamptz                   | NOT NULL.                                                            |
| `end_time`          | timestamptz                   | NOT NULL.                                                            |
| `host_join_url`     | text                          |                                                                      |
| `attendee_join_url` | text                          |                                                                      |
| `status`            | projects.session_event_status | NOT NULL `DEFAULT 'scheduled'`. `scheduled`, `completed`, `cancelled_by_freelancer`, `cancelled_by_client`. |
| `created_at`        | timestamptz                   | NOT NULL `DEFAULT now()`.                                            |
| `updated_at`        | timestamptz                   | NOT NULL `DEFAULT now()`.                                            |

Same contract as `projects.projects.slug` — filled and pinned by `security.fn_slug_guard`
(`trg_session_events_slug`), shaped by `ck_session_events_slug_shape`. A session is the one entity
here whose natural-looking identifier would be its **time**, and a time is exactly what a reschedule
changes: an address derived from it would break on the event this table exists to record.

### `projects.session_attendance`

Who joined a sitting, and when.

| Column             | Type        | Notes                                                                            |
| :----------------- | :---------- | :------------------------------------------------------------------------------- |
| `id`               | uuid        | PK, `DEFAULT gen_random_uuid()`.                                                 |
| `session_event_id` | uuid        | NOT NULL. FK → `projects.session_events.id` (`session_attendance_event_id_fkey`). |
| `user_id`          | uuid        | NOT NULL. FK → `org.users_public.user_id`.                                       |
| `joined_at`        | timestamptz | NOT NULL `DEFAULT now()`.                                                        |
| `ip_address`       | inet        |                                                                                  |

### `projects.waitlists`

A buyer queued for a full service listing. Keyed on the blueprint, not a project. One row per
(blueprint, user) — `waitlists_unique_user`.

| Column                 | Type                     | Notes                                                       |
| :--------------------- | :----------------------- | :---------------------------------------------------------- |
| `id`                   | uuid                     | PK, `DEFAULT gen_random_uuid()`.                            |
| `service_blueprint_id` | uuid                     | NOT NULL. FK → `marketplace.service_blueprints.id`.         |
| `user_id`              | uuid                     | NOT NULL. FK → `org.users_public.user_id`.                  |
| `status`               | projects.waitlist_status | NOT NULL `DEFAULT 'waiting'`. `waiting`, `invited`, `expired`, `converted`. |
| `created_at`           | timestamptz              | NOT NULL `DEFAULT now()`.                                   |

---

## 💷 Commercial Terms

### `projects.stage_budget_rules`

A stage's budget rule, read by `projects.get_stage_details` as the stage's `budget` object.

| Column             | Type   | Notes                                       |
| :----------------- | :----- | :------------------------------------------ |
| `id`               | uuid   | PK, `DEFAULT gen_random_uuid()`.            |
| `project_stage_id` | uuid   | NOT NULL. **No FK, no UNIQUE.**             |
| `rule_type`        | text   | NOT NULL, no CHECK.                         |
| `amount_currency`  | text   | NOT NULL.                                   |
| `amount_cents`     | bigint | NOT NULL, CHECK `>= 0`.                     |
| `notes`            | text   |                                             |

⚠️ `get_stage_details` reads this table as a scalar subquery, so a second rule on one stage would
raise rather than be ignored — nothing in the schema prevents one.

### `projects.maintenance_contracts`

A recurring-billing agreement between a client business and a freelancer on a project. It is
project-level — nothing links it to a stage.

| Column                  | Type        | Notes                                                |
| :---------------------- | :---------- | :--------------------------------------------------- |
| `id`                    | uuid        | PK, `DEFAULT gen_random_uuid()`.                     |
| `project_id`            | uuid        | NOT NULL. **No FK.**                                 |
| `freelancer_profile_id` | uuid        | NOT NULL. FK → `org.freelancer_profiles.user_id`.    |
| `business_profile_id`   | uuid        | NOT NULL. FK → `org.business_profiles.id`.           |
| `amount_cents`          | bigint      | NOT NULL, CHECK `>= 0`.                              |
| `currency`              | text        | NOT NULL.                                            |
| `billing_interval`      | text        | NOT NULL, no CHECK.                                  |
| `status`                | text        | NOT NULL `DEFAULT 'active'`, no CHECK.               |
| `created_at`            | timestamptz | NOT NULL `DEFAULT now()`.                            |

---

## 🛠 Project Infrastructure

### `projects.project_activity`

A unified ledger of events occurring within a project (e.g., status changes, file uploads). Written
by the projects RPCs alongside the change they record; in the `supabase_realtime` publication.

| Column          | Type        | Notes                                                              |
| :-------------- | :---------- | :----------------------------------------------------------------- |
| `id`            | uuid        | PK, `DEFAULT gen_random_uuid()`.                                   |
| `project_id`    | uuid        | NOT NULL. **No FK.**                                               |
| `actor_user_id` | uuid        | NOT NULL. FK → `org.users_public.user_id`.                         |
| `kind`          | text        | NOT NULL, no CHECK (e.g. `submission_reviewed`, `application_submitted`). |
| `payload`       | jsonb       | NOT NULL `DEFAULT '{}'`.                                           |
| `entity_table`  | text        | NOT NULL. The qualified table the event concerns.                  |
| `entity_id`     | uuid        | NOT NULL. Polymorphic on `entity_table` — no FK.                   |
| `created_at`    | timestamptz | NOT NULL `DEFAULT now()`.                                          |

### `projects.user_preferences`

Per-user metadata for UI customization (e.g., starring or archiving projects). Own-rows-only under
RLS — see [Policies.md](Policies.md). Composite PK (`user_id`, `project_id`).

| Column           | Type        | Notes                                       |
| :--------------- | :---------- | :------------------------------------------ |
| `user_id`        | uuid        | NOT NULL, PK. FK → `org.users_public.user_id`. |
| `project_id`     | uuid        | NOT NULL, PK. FK → `projects.projects.id`.  |
| `is_starred`     | boolean     | `DEFAULT false` (nullable).                 |
| `is_archived`    | boolean     | `DEFAULT false` (nullable).                 |
| `last_viewed_at` | timestamptz | `DEFAULT now()` (nullable).                 |

### `projects.view_reads`

When one person last opened one of an engagement's lane views (Decision #146). `projects.get_nav_activity`
counts what changed after `seen_at`; `projects.mark_view_seen` upserts it. Never deleted. Own-rows RLS
— see [Policies.md](Policies.md). Composite PK (`user_id`, `project_id`, `lane_view`).

| Column       | Type        | Notes                                                                                     |
| :----------- | :---------- | :---------------------------------------------------------------------------------------- |
| `user_id`    | uuid        | NOT NULL, PK. FK → `org.users_public.user_id`, `ON DELETE CASCADE`.                         |
| `project_id` | uuid        | NOT NULL, PK. FK → `projects.projects.id`, `ON DELETE CASCADE`.                            |
| `lane_view`  | text        | NOT NULL, PK. CHECK `overview · discussion · board · timeline · files · submissions · members`. |
| `seen_at`    | timestamptz | NOT NULL `DEFAULT now()`.                                                                 |

### `projects.project_attachments`

The link table between a project and its reference files — the brief, the brand sheet, the spec.
Both columns are the composite primary key (`project_id` → `projects.projects.id`, `attachment_id` →
`files.items.id` `ON DELETE CASCADE`), so there is nothing on the row to update: re-pointing a
reference is a `DELETE` and an `INSERT`.

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

---

## 🚩 Refactor Notes & Suggestions

- **Industry Categories**: `projects.projects.industry_category_id` exists with no FK, and no
  `industry_categories` table is defined in any migration.
- **JSONB Consistency**: `description` in `projects.projects` and `project_stages` uses `jsonb`. We
  should define a standardized schema (e.g., Tiptap JSON or Markdown) to avoid rendering issues in
  the Fresh frontend.
- **Circular Dependencies**: `project_stages.start_dependency_stage_id` references its own table.
  The setup form refuses a cycle (`wouldCycle`, `packages/types/projects/setup.ts`), but nothing in
  the database does.
