# projects Schema: Tables

The `projects` schema is the functional core of the platform. It manages the lifecycle of work, from
project definition and stage-based modularity to staffing, execution, and revision tracking.

## 📑 Core Project Management

### `projects.projects`

The top-level container for all collaborative work. It defines global settings, legal requirements,
and high-level metadata.

| Column                | Type            | Notes                                                                 |
| :-------------------- | :-------------- | :-------------------------------------------------------------------- |
| `id`                  | uuid            | PK.                                                                   |
| `client_business_id`  | uuid            | FK → `org.business_profiles.id`.                                      |
| `owner_user_id`       | uuid            | FK → `auth.users.id` (The creator).                                   |
| `status`              | project_status  | `draft`, `active`, `on_hold`, `completed`, `cancelled`, `archived`.   |
| `visibility`          | visibility      | `public`, `invite_only`, `unlisted`.                                  |
| `ip_ownership_mode`   | ip_option_mode  | Global default for the project.                                       |
| `timeline_preset`     | timeline_preset | `sequential`, `simultaneous`, `staggered`, `custom`.                  |
| `source_blueprint_id` | uuid            | FK → `marketplace.service_blueprints.id`; `NULL` when hand-built.     |
| `last_activity_at`    | timestamptz     | Last meaningful activity — what the draft sweep measures idleness by. |
| `archived_at`         | timestamptz     | Set iff `status = 'archived'` (`ck_projects_archived_at`).            |

**Service instantiation.** "Add to Projects" on a Pipeline listing copies the seller's blueprint into
the buyer's workspace as `status = 'draft'`, `visibility = 'unlisted'`, with `source_blueprint_id`
set and every `stage_assignments` row parked at `pending_funding`. No money moves and nothing is
reserved: a pipeline is staffed and then bought against, one ticket at a time (`PRODUCT_SPEC.md`
§Creation & Purchasing Gate). `source_blueprint_id` is what makes a repeated press idempotent — the
app resolves an existing draft by `(owner, blueprint)` rather than creating a second identical
pipeline.

**`archived` is soft deletion, and it is distinct from `cancelled`.** Nothing is hard-deleted (root
`CLAUDE.md` §7). `cancelled` records a decision somebody made about live work; `archived` records
that nothing ever happened — a draft the buyer removed, or one
`projects.fn_archive_stale_service_drafts` reclaimed after `service_draft_idle_days` (default 30) of
inactivity with no funded stage. `last_activity_at` is deliberately NOT `updated_at`: any write
touches the latter, so a draft that was merely renamed would keep escaping a sweep that measured it.

### `projects.project_stages`

Atomic units of work. Each stage has its own type, status, and specific delivery logic.

| Column               | Type               | Notes                                 |
| :------------------- | :----------------- | :------------------------------------ |
| `id`                 | uuid               | PK.                                   |
| `project_id`         | uuid               | FK → `projects.projects.id`.          |
| `stage_type`         | stage_type_enum    | `file_based`, `session_based`, etc..  |
| `status`             | stage_status       | Current progress state.               |
| `sort_order`         | integer            | Execution order.                      |
| `start_trigger_type` | start_trigger_type | Defines when work can begin.          |
| `ip_mode`            | ip_option_mode     | Override for stage-specific IP terms. |

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

Per-user metadata for UI customization (e.g., starring or archiving projects).

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
