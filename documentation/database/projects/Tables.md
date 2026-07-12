# projects Schema: Tables

The `projects` schema is the functional core of the platform. It manages the lifecycle of work, from
project definition and stage-based modularity to staffing, execution, and revision tracking.

## 📑 Core Project Management

### `projects.projects`

The top-level container for all collaborative work. It defines global settings, legal requirements,
and high-level metadata.

| Column               | Type            | Notes                                                   |
| :------------------- | :-------------- | :------------------------------------------------------ |
| `id`                 | uuid            | PK.                                                     |
| `client_business_id` | uuid            | FK → `org.business_profiles.id`.                        |
| `owner_user_id`      | uuid            | FK → `auth.users.id` (The creator).                     |
| `status`             | project_status  | `draft`, `active`, `on_hold`, `completed`, `cancelled`. |
| `visibility`         | visibility      | `public`, `invite_only`, `unlisted`.                    |
| `ip_ownership_mode`  | ip_option_mode  | Global default for the project.                         |
| `timeline_preset`    | timeline_preset | `sequential`, `simultaneous`, `staggered`, `custom`.    |

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
