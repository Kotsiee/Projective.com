-- =============================================================================================
-- 00000015_tables_projects.sql — projects schema tables (Category 0), final folded form.
-- Base: 0007_projects_tables.sql. Also: 0119 (project_status_history), 0307 (stage_open_seat_skills).
-- Folded ALTERs:
--   * projects.projects        += handover_unlocked_at                              (0311)
--   * projects.project_stages  += assignment_mode, max_concurrent_intensity         (0310)
--   * projects.stage_submissions += description/checked_item_ids/number/reviewed_by/
--       reviewed_at/feedback/revision_of/updated_at + status CHECK                  (0120)
--   * projects.stage_open_seats += status, filled_assignment_id + status CHECK      (0307)
-- =============================================================================================

CREATE TABLE projects.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  client_business_id uuid,
  owner_user_id uuid NOT NULL,
  title text NOT NULL,
  description jsonb NOT NULL DEFAULT '{}'::jsonb,
  description_text text NOT NULL DEFAULT ''::text,
  format project_format NOT NULL DEFAULT 'pipeline'::project_format,
  structure_variation projects.structure_variation NOT NULL DEFAULT 'standard'::projects.structure_variation,
  status project_status NOT NULL DEFAULT 'draft'::project_status,
  industry_category_id uuid,
  visibility visibility NOT NULL DEFAULT 'public'::visibility,
  currency text NOT NULL DEFAULT 'USD'::text,
  timeline_preset timeline_preset NOT NULL DEFAULT 'sequential'::timeline_preset,
  target_project_start_date timestamp with time zone,

  ip_ownership_mode ip_option_mode NOT NULL DEFAULT 'exclusive_transfer'::ip_option_mode,
  nda_required boolean NOT NULL DEFAULT false,
  portfolio_display_rights portfolio_rights NOT NULL DEFAULT 'allowed'::portfolio_rights,
  location_restriction text[] DEFAULT '{}'::text[],
  language_requirement text[] DEFAULT '{}'::text[],
  screening_questions jsonb DEFAULT '[]'::jsonb,
  allow_deadline_bonuses boolean NOT NULL DEFAULT false,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  -- Folded (0311): protected-phase / Projective Unlock handover state.
  handover_unlocked_at timestamptz,

  -- Service instantiation ("Add to Projects" on a Pipeline listing).
  --
  -- The blueprint this project was copied from, or NULL for one created from scratch. It is what
  -- makes a repeated press idempotent — the app resolves an existing draft by (owner, blueprint)
  -- rather than creating a second identical pipeline — and it is what the 30-day sweep scopes on, so
  -- a project somebody built by hand is never in its reach.
  source_blueprint_id uuid,

  -- Last meaningful activity. Distinct from `updated_at`, which any write touches (a title fix, a
  -- description tweak, a trigger): idleness has to mean "nothing has HAPPENED here", or the sweep
  -- measures the wrong thing and spares a draft that was merely renamed.
  last_activity_at timestamptz NOT NULL DEFAULT now(),

  -- When the project was soft-archived. Nothing is hard-deleted (root CLAUDE.md §7), so this is the
  -- audit half of `status = 'archived'`: the status says what, this says when.
  archived_at timestamptz,

  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_client_business_id_fkey FOREIGN KEY (client_business_id) REFERENCES org.business_profiles(id),
  CONSTRAINT projects_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES org.users_public(user_id),
  CONSTRAINT projects_source_blueprint_id_fkey FOREIGN KEY (source_blueprint_id) REFERENCES marketplace.service_blueprints(id) ON DELETE SET NULL,
  -- An archived project carries its timestamp, and a live one does not. Without this the two halves
  -- can disagree, and the row then answers "is this archived?" differently depending on which column
  -- the reader happens to look at.
  CONSTRAINT ck_projects_archived_at CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);

CREATE TABLE projects.project_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL,
  description jsonb NOT NULL DEFAULT '{}'::jsonb,
  description_text text NOT NULL DEFAULT ''::text,
  sort_order integer NOT NULL,
  status stage_status NOT NULL DEFAULT 'open'::stage_status,

  file_upload_required boolean NOT NULL DEFAULT false,
  default_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  skills text[] DEFAULT '{}'::text[],

  -- Pipeline per-ticket unit price (minor units); source amount for ticket escrow holds.
  unit_price_cents bigint,

  start_trigger_type start_trigger_type NOT NULL DEFAULT 'on_project_start'::start_trigger_type,
  fixed_start_date timestamp with time zone,
  start_dependency_stage_id uuid,
  start_dependency_lag_days integer DEFAULT 0,
  hire_trigger_active boolean NOT NULL DEFAULT true,

  file_revisions_allowed integer DEFAULT 0,
  file_duration_mode text,
  file_duration_days integer,
  file_due_date timestamp with time zone,

  session_duration_minutes integer,
  session_count integer DEFAULT 1,
  session_preferred_days text[],
  session_end_date timestamp with time zone,

  ip_ownership_override ip_option_mode,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  ip_mode ip_option_mode DEFAULT 'exclusive_transfer'::ip_option_mode,
  -- Folded (0310): per-stage assignment routing mode + Project Hard Cap on summed W_i.
  assignment_mode projects.assignment_routing_mode NOT NULL DEFAULT 'open_pull',
  max_concurrent_intensity numeric(6,2),

  CONSTRAINT project_stages_pkey PRIMARY KEY (id),
  CONSTRAINT project_stages_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects(id),
  CONSTRAINT project_stages_start_dependency_stage_id_fkey FOREIGN KEY (start_dependency_stage_id) REFERENCES projects.project_stages(id)
);

CREATE TABLE projects.tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    current_stage_id uuid REFERENCES projects.project_stages(id) ON DELETE SET NULL,
    current_assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

    title text NOT NULL,
    description jsonb NOT NULL DEFAULT '{}'::jsonb,
    text_description text NOT NULL DEFAULT '', -- Flattened rich text for search functionality

    status ticket_status NOT NULL DEFAULT 'backlog'::ticket_status,
    attachment_count smallint NOT NULL DEFAULT 0,
    required_stages jsonb NOT NULL DEFAULT '[]'::jsonb, -- Format: [{"stage_id": "uuid", "order": 1}]

    due_date timestamp with time zone NULL,
    workload_intensity numeric(4,2) NOT NULL DEFAULT 1.00,
    payment_status payment_status NOT NULL DEFAULT 'unpaid'::payment_status,

    -- Escrow / installment tracking (minor units, e.g. cents)
    unit_price_cents bigint,
    total_amount_paid bigint NOT NULL DEFAULT 0 CHECK (total_amount_paid >= 0),

    -- Ordering: manual only while in the backlog ("New") stage; else ordered by updated_at DESC
    sort_order integer,

    -- Lifecycle markers
    claimed_at timestamp with time zone,
    hidden_until timestamp with time zone,
    workload_report_id uuid,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE projects.ticket_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES projects.tickets(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

    action_type text NOT NULL, -- e.g., 'created', 'stage_moved', 'status_changed', 'reassigned', 'metadata_updated'

    previous_stage_id uuid REFERENCES projects.project_stages(id) ON DELETE SET NULL,
    new_stage_id uuid REFERENCES projects.project_stages(id) ON DELETE SET NULL,

    previous_status ticket_status NULL,
    new_status ticket_status NULL,

    changes jsonb NOT NULL DEFAULT '{}'::jsonb, -- Captures any other modified attributes as a diff patch
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE projects.maintenance_contracts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  freelancer_profile_id uuid NOT NULL,
  business_profile_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
  currency text NOT NULL,
  billing_interval text NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT maintenance_contracts_pkey PRIMARY KEY (id),
  CONSTRAINT maintenance_contracts_freelancer_profile_id_fkey FOREIGN KEY (freelancer_profile_id) REFERENCES org.freelancer_profiles(user_id),
  CONSTRAINT maintenance_contracts_business_profile_id_fkey FOREIGN KEY (business_profile_id) REFERENCES org.business_profiles(id)
);

CREATE TABLE projects.project_activity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_table text NOT NULL,
  entity_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_activity_pkey PRIMARY KEY (id),
  CONSTRAINT project_activity_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES org.users_public(user_id)
);

CREATE TABLE projects.project_participants (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    project_id uuid NOT NULL,
    profile_type profile_type NOT NULL,
    profile_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT project_participants_pkey PRIMARY KEY (id),
        CONSTRAINT project_participants_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects (id)
);

CREATE TABLE projects.stage_assignments (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    project_stage_id uuid NOT NULL,
    assignee_type assignment_type NOT NULL,
    freelancer_profile_id uuid,
    team_id uuid,
    assigned_by uuid NOT NULL,
    is_client_managed boolean NOT NULL DEFAULT false,
    status text NOT NULL,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT stage_assignments_pkey PRIMARY KEY (id),
        CONSTRAINT stage_assignments_project_stage_id_fkey FOREIGN KEY (project_stage_id) REFERENCES projects.project_stages (id),
        CONSTRAINT stage_assignments_freelancer_profile_id_fkey FOREIGN KEY (freelancer_profile_id) REFERENCES org.freelancer_profiles (user_id),
        CONSTRAINT stage_assignments_team_id_fkey FOREIGN KEY (team_id) REFERENCES org.teams (id),
        CONSTRAINT stage_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES org.users_public (user_id)
);

CREATE TABLE projects.stage_submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_stage_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  submitted_by uuid NOT NULL,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  title text NOT NULL,
  status text DEFAULT 'pending_review'::text,
  -- Folded (0120): enrich stage_submissions into a real, reviewable ledger.
  description      jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  number           integer,
  reviewed_by      uuid REFERENCES org.users_public(user_id),
  reviewed_at      timestamptz,
  feedback         jsonb,
  revision_of      uuid REFERENCES projects.stage_submissions(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stage_submissions_pkey PRIMARY KEY (id),
  CONSTRAINT stage_submissions_project_stage_id_fkey FOREIGN KEY (project_stage_id) REFERENCES projects.project_stages(id),
  CONSTRAINT stage_submissions_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES projects.tickets(id),
  CONSTRAINT stage_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES org.users_public(user_id),
  -- Folded (0120): constrain the status vocabulary to the four frontend states.
  CONSTRAINT stage_submissions_status_check CHECK (status IN ('draft', 'pending_review', 'accepted', 'revisions_requested'))
);

CREATE TABLE projects.project_attachments (
    project_id uuid NOT NULL,
    attachment_id uuid NOT NULL,
    CONSTRAINT project_attachments_pkey PRIMARY KEY (project_id, attachment_id),
    CONSTRAINT project_attachments_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects (id),
    CONSTRAINT project_attachments_file_fkey FOREIGN KEY (attachment_id) REFERENCES files.items (id) ON DELETE CASCADE
);

CREATE TABLE projects.project_required_skills (
    project_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    CONSTRAINT project_required_skills_pkey PRIMARY KEY (project_id, skill_id),
    CONSTRAINT project_required_skills_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects (id),
    CONSTRAINT project_required_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES org.skills (id)
);

CREATE TABLE projects.user_preferences (
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    is_starred boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    last_viewed_at timestamp
    with
        time zone DEFAULT now(),
        CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id, project_id),
        CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id),
        CONSTRAINT user_preferences_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects (id)
);

CREATE TABLE projects.stage_open_seats (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    project_stage_id uuid NOT NULL,
    description_of_need text NOT NULL,
    budget_min_cents bigint,
    budget_max_cents bigint,
    require_proposals boolean NOT NULL DEFAULT true,
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        -- Folded (0307): seat fill-state.
        status              text NOT NULL DEFAULT 'open',
        filled_assignment_id uuid REFERENCES projects.stage_assignments (id) ON DELETE SET NULL,
        CONSTRAINT stage_open_seats_pkey PRIMARY KEY (id),
        CONSTRAINT stage_open_seats_project_stage_id_fkey FOREIGN KEY (project_stage_id) REFERENCES projects.project_stages (id),
        CONSTRAINT stage_open_seats_status_check CHECK (status IN ('open', 'filled', 'closed'))
);

CREATE TABLE projects.stage_staffing_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_stage_id uuid NOT NULL,
  role_title text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  budget_type budget_type NOT NULL DEFAULT 'fixed_price'::budget_type,
  budget_amount_cents bigint NOT NULL CHECK (budget_amount_cents >= 0),
  allow_proposals boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT stage_staffing_roles_pkey PRIMARY KEY (id),
  CONSTRAINT stage_staffing_roles_project_stage_id_fkey FOREIGN KEY (project_stage_id) REFERENCES projects.project_stages(id)
);

CREATE TABLE projects.submission_files (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    submission_id uuid NOT NULL,
    file_id uuid NOT NULL,
    CONSTRAINT submission_files_pkey PRIMARY KEY (id),
    CONSTRAINT fk_sub_file_submission FOREIGN KEY (submission_id) REFERENCES projects.stage_submissions (id) ON DELETE CASCADE,
    CONSTRAINT fk_sub_file_item FOREIGN KEY (file_id) REFERENCES files.items (id) ON DELETE CASCADE
);

CREATE TABLE projects.stage_budget_rules (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    project_stage_id uuid NOT NULL,
    rule_type text NOT NULL,
    amount_currency text NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
    notes text,
    CONSTRAINT stage_budget_rules_pkey PRIMARY KEY (id)
);

CREATE TABLE projects.stage_revision_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_stage_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  request_type text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,

  CONSTRAINT stage_revision_requests_pkey PRIMARY KEY (id),
  CONSTRAINT stage_revision_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES org.users_public(user_id),
  CONSTRAINT stage_revision_requests_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES projects.tickets(id)
);

CREATE TABLE projects.cohorts (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	project_id uuid NOT NULL,
	name text NOT NULL,
	max_seats integer NOT NULL DEFAULT 1,
	status projects.cohort_status NOT NULL DEFAULT 'enrolling'::projects.cohort_status,
	created_at timestamp with time zone NOT NULL DEFAULT now(),

	CONSTRAINT cohorts_pkey PRIMARY KEY (id),
	CONSTRAINT cohorts_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects(id)
);

CREATE TABLE projects.cohort_memberships (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	cohort_id uuid NOT NULL,
	user_id uuid NOT NULL,
	status text NOT NULL DEFAULT 'active'::text,
	joined_at timestamp with time zone NOT NULL DEFAULT now(),

	CONSTRAINT cohort_memberships_pkey PRIMARY KEY (id),
	CONSTRAINT cohort_memberships_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES projects.cohorts(id),
	CONSTRAINT cohort_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public(user_id),
	CONSTRAINT cohort_memberships_unique_user UNIQUE (cohort_id, user_id)
);

CREATE TABLE projects.session_events (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	cohort_id uuid NOT NULL,
	title text NOT NULL,
	start_time timestamp with time zone NOT NULL,
	end_time timestamp with time zone NOT NULL,

	host_join_url text,
	attendee_join_url text,

	status projects.session_event_status NOT NULL DEFAULT 'scheduled'::projects.session_event_status,
	created_at timestamp with time zone NOT NULL DEFAULT now(),
	updated_at timestamp with time zone NOT NULL DEFAULT now(),

	CONSTRAINT session_events_pkey PRIMARY KEY (id),
	CONSTRAINT session_events_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES projects.cohorts(id)
);

CREATE TABLE projects.session_attendance (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    session_event_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        ip_address inet,
        CONSTRAINT session_attendance_pkey PRIMARY KEY (id),
        CONSTRAINT session_attendance_event_id_fkey FOREIGN KEY (session_event_id) REFERENCES projects.session_events (id),
        CONSTRAINT session_attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE projects.waitlists (
	id uuid NOT NULL DEFAULT gen_random_uuid(),
	service_blueprint_id uuid NOT NULL,
	user_id uuid NOT NULL,
	status projects.waitlist_status NOT NULL DEFAULT 'waiting'::projects.waitlist_status,
	created_at timestamp with time zone NOT NULL DEFAULT now(),

	CONSTRAINT waitlists_pkey PRIMARY KEY (id),
	CONSTRAINT waitlists_service_blueprint_id_fkey FOREIGN KEY (service_blueprint_id) REFERENCES marketplace.service_blueprints(id),
	CONSTRAINT waitlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES org.users_public(user_id),
	CONSTRAINT waitlists_unique_user UNIQUE (service_blueprint_id, user_id)
);

CREATE TABLE projects.project_applications (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    project_id uuid NOT NULL,
    applicant_user_id uuid NOT NULL,
    applicant_type text NOT NULL,
    applicant_profile_id uuid NOT NULL,
    message text,
    status projects.application_status NOT NULL DEFAULT 'pending',
    created_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        updated_at timestamp
    with
        time zone NOT NULL DEFAULT now(),
        CONSTRAINT project_applications_pkey PRIMARY KEY (id),
        CONSTRAINT project_applications_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects (id),
        CONSTRAINT project_applications_user_id_fkey FOREIGN KEY (applicant_user_id) REFERENCES org.users_public (user_id)
);

CREATE TABLE projects.project_application_targets (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    application_id uuid NOT NULL,
    target_type projects.application_target_type NOT NULL,
    target_id uuid NOT NULL,
    CONSTRAINT project_application_targets_pkey PRIMARY KEY (id),
    CONSTRAINT pat_application_id_fkey FOREIGN KEY (application_id) REFERENCES projects.project_applications (id) ON DELETE CASCADE
);

CREATE TABLE projects.ticket_workload_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES projects.tickets(id) ON DELETE CASCADE,
    reporter_user_id uuid NOT NULL REFERENCES org.users_public(user_id),
    claimed_intensity numeric(4,2),
    reported_intensity numeric(4,2),
    reason text NOT NULL,
    status projects.workload_report_status NOT NULL DEFAULT 'open'::projects.workload_report_status,
    hidden_until timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    resolved_at timestamp with time zone
);

-- #region Project Lifecycle transition ledger (0119_project_lifecycle.sql)
CREATE TABLE projects.project_status_history (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    actor_user_id uuid NOT NULL REFERENCES org.users_public(user_id),
    from_status   project_status,
    to_status     project_status NOT NULL,
    reason        text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region Stage staffing required-skills (0307_stage_staffing.sql)
CREATE TABLE projects.stage_open_seat_skills (
    seat_id  uuid NOT NULL REFERENCES projects.stage_open_seats (id) ON DELETE CASCADE,
    skill_id uuid NOT NULL REFERENCES org.skills (id),
    CONSTRAINT stage_open_seat_skills_pkey PRIMARY KEY (seat_id, skill_id)
);
-- #endregion
