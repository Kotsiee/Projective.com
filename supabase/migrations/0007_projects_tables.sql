CREATE TYPE project_format AS ENUM ('one_off', 'pipeline', 'session');

CREATE TYPE ticket_status AS ENUM ('backlog', 'todo', 'claimed', 'in_progress', 'in_review', 'completed', 'cancelled', 'reported_hidden');

CREATE TYPE payment_status AS ENUM ('unpaid', 'escrow_funded', 'partially_released', 'released', 'refunded');

CREATE TYPE projects.structure_variation AS ENUM ('standard', 'one_off', 'single_task', 'single_stage');

CREATE TYPE projects.workload_report_status AS ENUM ('open', 'acknowledged', 'adjusted', 'expired_penalized', 'dismissed_bad_faith');

CREATE TYPE projects.cohort_status AS ENUM ('enrolling', 'active', 'completed', 'cancelled');

CREATE TYPE projects.session_event_status AS ENUM ('scheduled', 'completed', 'cancelled_by_freelancer', 'cancelled_by_client');

CREATE TYPE projects.waitlist_status AS ENUM ('waiting', 'invited', 'expired', 'converted');

CREATE TYPE projects.application_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');

CREATE TYPE projects.application_target_type AS ENUM ('stage', 'role');


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
  
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_client_business_id_fkey FOREIGN KEY (client_business_id) REFERENCES org.business_profiles(id),
  CONSTRAINT projects_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES org.users_public(user_id)
);


CREATE TABLE IF NOT EXISTS projects.project_stages (
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
  
  CONSTRAINT project_stages_pkey PRIMARY KEY (id),
  CONSTRAINT project_stages_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects.projects(id),
  CONSTRAINT project_stages_start_dependency_stage_id_fkey FOREIGN KEY (start_dependency_stage_id) REFERENCES projects.project_stages(id)
);

CREATE INDEX IF NOT EXISTS idx_project_stages_project ON projects.project_stages (project_id);
-- #endregion

-- #region 3. Tickets Table


CREATE TABLE IF NOT EXISTS projects.tickets (
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

CREATE INDEX IF NOT EXISTS idx_tickets_project ON projects.tickets (project_id);

CREATE INDEX IF NOT EXISTS idx_tickets_stage ON projects.tickets (current_stage_id);

CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON projects.tickets (current_assignee_id);

-- Backlog manual ordering vs. auto (updated_at DESC) ordering for all other stages
CREATE INDEX IF NOT EXISTS idx_tickets_stage_sort ON projects.tickets (current_stage_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_tickets_stage_recent ON projects.tickets (current_stage_id, updated_at DESC);
-- #endregion

-- #region 4. Conditional Due Date Rule Enforcement
CREATE OR REPLACE FUNCTION projects.fn_enforce_ticket_due_date()
RETURNS TRIGGER AS $$
DECLARE
    v_allow_deadlines boolean;
BEGIN
    -- Query the finance configuration on the parent project
    SELECT allow_deadline_bonuses INTO v_allow_deadlines 
    FROM projects.projects 
    WHERE id = NEW.project_id;

    -- If a due date is specified but the project finance settings forbid it, raise an error
    IF NEW.due_date IS NOT NULL AND (v_allow_deadlines IS NULL OR NOT v_allow_deadlines) THEN
        RAISE EXCEPTION 'Due dates can only be set if the client has agreed to deadline bonus terms under project finance settings.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_enforce_ticket_due_date
    BEFORE INSERT OR UPDATE OF due_date ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_enforce_ticket_due_date();
-- #endregion

-- #region 4b. Ticket Lifecycle State Machine

-- Keep updated_at fresh so "order by updated_at DESC" (non-backlog stages) stays accurate.
CREATE OR REPLACE FUNCTION projects.fn_ticket_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_ticket_touch_updated_at
    BEFORE UPDATE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_touch_updated_at();

-- Creation with only a title is allowed; a purchase/checkout transition requires a description.
CREATE OR REPLACE FUNCTION projects.fn_enforce_ticket_checkout_desc()
RETURNS TRIGGER AS $$
DECLARE
    v_entering_checkout boolean;
BEGIN
    v_entering_checkout :=
        (NEW.payment_status = 'escrow_funded'::payment_status
            AND OLD.payment_status = 'unpaid'::payment_status)
        OR (NEW.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status)
            AND OLD.status NOT IN ('claimed'::ticket_status, 'in_progress'::ticket_status));

    IF v_entering_checkout THEN
        IF (NEW.text_description IS NULL OR btrim(NEW.text_description) = '')
            AND (NEW.description IS NULL OR NEW.description = '{}'::jsonb) THEN
            RAISE EXCEPTION 'A ticket must have a description before it can be purchased or claimed.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_enforce_ticket_checkout_desc
    BEFORE UPDATE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_enforce_ticket_checkout_desc();

-- Manual sort_order is only valid in the backlog ("New") stage; other stages auto-order by updated_at.
CREATE OR REPLACE FUNCTION projects.fn_ticket_ordering_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sort_order IS DISTINCT FROM OLD.sort_order
        AND NEW.status <> 'backlog'::ticket_status THEN
        RAISE EXCEPTION 'Manual ticket ordering is only permitted in the backlog (New) stage.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_ticket_ordering_guard
    BEFORE UPDATE OF sort_order ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_ordering_guard();

-- Once claimed, client-owned content is locked; only the assignee (or an admin) may edit it.
CREATE OR REPLACE FUNCTION projects.fn_ticket_immutability_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.current_assignee_id IS NOT NULL
        AND auth.uid() IS NOT NULL
        AND auth.uid() <> OLD.current_assignee_id
        AND NOT security.is_admin() THEN
        IF NEW.title IS DISTINCT FROM OLD.title
            OR NEW.description IS DISTINCT FROM OLD.description
            OR NEW.text_description IS DISTINCT FROM OLD.text_description
            OR NEW.unit_price_cents IS DISTINCT FROM OLD.unit_price_cents
            OR NEW.required_stages IS DISTINCT FROM OLD.required_stages
            OR NEW.workload_intensity IS DISTINCT FROM OLD.workload_intensity THEN
            RAISE EXCEPTION 'This ticket has been claimed by a freelancer; its content is locked to the client.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, security, auth;

CREATE OR REPLACE TRIGGER trg_ticket_immutability_guard
    BEFORE UPDATE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_immutability_guard();

-- Stamp claim time on claim; on freelancer removal, reset to backlog (re-enter the "New" backlog).
CREATE OR REPLACE FUNCTION projects.fn_ticket_claim_before()
RETURNS TRIGGER AS $$
BEGIN
    -- Claim: freelancer attaches themselves (or status flips to 'claimed')
    IF (OLD.current_assignee_id IS NULL AND NEW.current_assignee_id IS NOT NULL)
        OR (OLD.status <> 'claimed'::ticket_status AND NEW.status = 'claimed'::ticket_status) THEN
        NEW.claimed_at := now();
    END IF;

    -- Freelancer removed mid-work: send the ticket back to the backlog.
    IF OLD.current_assignee_id IS NOT NULL AND NEW.current_assignee_id IS NULL THEN
        NEW.status := 'backlog'::ticket_status;
        NEW.claimed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_ticket_claim_before
    BEFORE UPDATE OF current_assignee_id, status ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_claim_before();

-- Escrow money movement (funds delegated to finance.* SECURITY DEFINER helpers in 0009).
CREATE OR REPLACE FUNCTION projects.fn_ticket_escrow_sync()
RETURNS TRIGGER AS $$
BEGIN
    -- Claim -> move ticket funds into the escrow pool (held).
    IF (OLD.current_assignee_id IS NULL AND NEW.current_assignee_id IS NOT NULL)
        OR (OLD.status <> 'claimed'::ticket_status AND NEW.status = 'claimed'::ticket_status) THEN
        PERFORM finance.fn_hold_ticket_escrow(NEW.id);
    END IF;

    -- Stage-completion approval -> release payout to the payee.
    IF OLD.status <> 'completed'::ticket_status AND NEW.status = 'completed'::ticket_status THEN
        PERFORM finance.fn_release_ticket_escrow(NEW.id);
    END IF;

    -- Freelancer removed mid-work -> release held escrow to the removed freelancer.
    IF OLD.current_assignee_id IS NOT NULL AND NEW.current_assignee_id IS NULL THEN
        PERFORM finance.fn_release_ticket_escrow(NEW.id);
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, auth;

CREATE OR REPLACE TRIGGER trg_ticket_escrow_sync
    AFTER UPDATE OF current_assignee_id, status ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_escrow_sync();

-- Deletion protocol: unclaimed -> delete freely; claimed -> release escrowed funds first, then delete
-- (prevents further client charges). Releasing before the row is removed keeps the ledger intact.
CREATE OR REPLACE FUNCTION projects.fn_ticket_delete_protocol()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.current_assignee_id IS NOT NULL
        OR EXISTS (
            SELECT 1 FROM finance.escrows e
            WHERE e.ticket_id = OLD.id AND e.status = 'held'
        ) THEN
        PERFORM finance.fn_release_ticket_escrow(OLD.id);
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, auth;

CREATE OR REPLACE TRIGGER trg_ticket_delete_protocol
    BEFORE DELETE ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_ticket_delete_protocol();
-- #endregion

-- #region 5. Ticket History Table (Audit Trail Ledger)


CREATE TABLE IF NOT EXISTS projects.ticket_history (
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

CREATE INDEX IF NOT EXISTS idx_ticket_history_ticket ON projects.ticket_history (ticket_id);

CREATE INDEX IF NOT EXISTS idx_ticket_history_timeline ON projects.ticket_history (ticket_id, created_at DESC);


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
  
  CONSTRAINT stage_submissions_pkey PRIMARY KEY (id),
  CONSTRAINT stage_submissions_project_stage_id_fkey FOREIGN KEY (project_stage_id) REFERENCES projects.project_stages(id),
  CONSTRAINT stage_submissions_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES projects.tickets(id),
  CONSTRAINT stage_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES org.users_public(user_id)
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
        CONSTRAINT stage_open_seats_pkey PRIMARY KEY (id),
        CONSTRAINT stage_open_seats_project_stage_id_fkey FOREIGN KEY (project_stage_id) REFERENCES projects.project_stages (id)
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

-- #region Stage lifecycle & structural-variation enforcement

-- Reordering is locked once a stage has been started or claimed; inner ticket sequence is preserved
-- automatically since only project_stages.sort_order changes (ticket rows are untouched).
CREATE OR REPLACE FUNCTION projects.fn_stage_reorder_lock()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
        IF OLD.status NOT IN ('open'::stage_status, 'assigned'::stage_status)
            OR EXISTS (
                SELECT 1 FROM projects.tickets t
                WHERE t.current_stage_id = OLD.id
                    AND t.status <> 'backlog'::ticket_status
            )
            OR EXISTS (
                SELECT 1 FROM projects.stage_assignments sa
                WHERE sa.project_stage_id = OLD.id
            ) THEN
            RAISE EXCEPTION 'Stages that have already been started or claimed cannot be reordered.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_stage_reorder_lock
    BEFORE UPDATE OF sort_order ON projects.project_stages
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_stage_reorder_lock();

-- Deleting a stage releases held escrow for its active tickets and scrubs the stage id from any
-- other ticket that lists it as a required prerequisite.
CREATE OR REPLACE FUNCTION projects.fn_stage_delete_cascade()
RETURNS TRIGGER AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT id FROM projects.tickets WHERE current_stage_id = OLD.id
    LOOP
        PERFORM finance.fn_release_ticket_escrow(r.id);
    END LOOP;

    UPDATE projects.tickets t
    SET required_stages = COALESCE((
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(t.required_stages) elem
            WHERE elem->>'stage_id' <> OLD.id::text
        ), '[]'::jsonb)
    WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(t.required_stages) e
        WHERE e->>'stage_id' = OLD.id::text
    );

    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, auth;

CREATE OR REPLACE TRIGGER trg_stage_delete_cascade
    BEFORE DELETE ON projects.project_stages
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_stage_delete_cascade();

-- Structural project variations: enforce the ticket/stage cardinality caps at write time.
CREATE OR REPLACE FUNCTION projects.fn_enforce_structure_variation()
RETURNS TRIGGER AS $$
DECLARE
    v_variation projects.structure_variation;
    v_ticket_count integer;
    v_stage_count integer;
BEGIN
    SELECT structure_variation INTO v_variation
    FROM projects.projects WHERE id = NEW.project_id;

    IF v_variation IS NULL OR v_variation = 'standard'::projects.structure_variation THEN
        RETURN NEW;
    END IF;

    SELECT count(*) INTO v_ticket_count FROM projects.tickets WHERE project_id = NEW.project_id;
    SELECT count(*) INTO v_stage_count FROM projects.project_stages WHERE project_id = NEW.project_id;

    IF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'tickets' THEN
        v_ticket_count := v_ticket_count + 1;
    ELSIF TG_OP = 'INSERT' AND TG_TABLE_NAME = 'project_stages' THEN
        v_stage_count := v_stage_count + 1;
    END IF;

    IF v_variation = 'one_off'::projects.structure_variation AND v_ticket_count > 1 THEN
        RAISE EXCEPTION 'One-off projects are limited to a single ticket.';
    ELSIF v_variation = 'single_task'::projects.structure_variation
        AND (v_stage_count > 1 OR v_ticket_count > 1) THEN
        RAISE EXCEPTION 'Single-task projects are limited to exactly one stage and one ticket.';
    ELSIF v_variation = 'single_stage'::projects.structure_variation AND v_stage_count > 1 THEN
        RAISE EXCEPTION 'Single-stage pipelines are limited to exactly one lifecycle stage.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_enforce_structure_variation_tickets
    BEFORE INSERT ON projects.tickets
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_enforce_structure_variation();

CREATE OR REPLACE TRIGGER trg_enforce_structure_variation_stages
    BEFORE INSERT ON projects.project_stages
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_enforce_structure_variation();
-- #endregion

-- #region Workload-intensity dispute loop

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

CREATE INDEX idx_workload_reports_ticket ON projects.ticket_workload_reports (ticket_id);

CREATE INDEX idx_workload_reports_sweep ON projects.ticket_workload_reports (status, hidden_until);

-- Filing a report suspends active work: the ticket is hidden for a configurable window.
CREATE OR REPLACE FUNCTION projects.fn_open_workload_report()
RETURNS TRIGGER AS $$
DECLARE
    v_hours integer;
BEGIN
    SELECT (value #>> '{}')::integer INTO v_hours
    FROM security.platform_params
    WHERE key = 'workload_report_window_hours';
    v_hours := COALESCE(v_hours, 48);

    UPDATE projects.tickets
    SET status = 'reported_hidden'::ticket_status,
        hidden_until = now() + make_interval(hours => v_hours),
        workload_report_id = NEW.id
    WHERE id = NEW.ticket_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, security;

CREATE OR REPLACE TRIGGER trg_open_workload_report
    AFTER INSERT ON projects.ticket_workload_reports
    FOR EACH ROW
    EXECUTE FUNCTION projects.fn_open_workload_report();

-- Sweep RPC (called by an Edge Function / external cron): if the client did not adjust the
-- workload intensity within the window, apply the configurable client penalty and resume the ticket.
CREATE OR REPLACE FUNCTION projects.fn_resolve_expired_workload_reports()
RETURNS integer AS $$
DECLARE
    r record;
    v_sev numeric;
    v_count integer := 0;
    v_subject_type text;
    v_subject_id uuid;
BEGIN
    SELECT (value #>> '{}')::numeric INTO v_sev
    FROM security.platform_params WHERE key = 'client_no_adjust_penalty';
    v_sev := COALESCE(v_sev, 0);

    FOR r IN
        SELECT wr.id AS report_id, wr.ticket_id, p.owner_user_id, p.client_business_id
        FROM projects.ticket_workload_reports wr
        JOIN projects.tickets t ON t.id = wr.ticket_id
        JOIN projects.projects p ON p.id = t.project_id
        WHERE wr.status = 'open'::projects.workload_report_status
            AND wr.hidden_until IS NOT NULL
            AND wr.hidden_until <= now()
    LOOP
        UPDATE projects.ticket_workload_reports
        SET status = 'expired_penalized'::projects.workload_report_status, resolved_at = now()
        WHERE id = r.report_id;

        UPDATE projects.tickets
        SET status = 'in_progress'::ticket_status, hidden_until = NULL
        WHERE id = r.ticket_id;

        IF r.client_business_id IS NOT NULL THEN
            v_subject_type := 'business'; v_subject_id := r.client_business_id;
        ELSE
            v_subject_type := 'user'; v_subject_id := r.owner_user_id;
        END IF;

        INSERT INTO security.penalties (
            subject_type, subject_id, penalty_type, source_type, source_id, severity, reason
        )
        VALUES (
            v_subject_type, v_subject_id, 'trust_score', 'workload_report', r.report_id, v_sev,
            'Client failed to adjust workload intensity within the required window.'
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, security;

-- Audit outcome: a report found bad-faith / unsubstantiated penalizes the reporter's discovery rank.
CREATE OR REPLACE FUNCTION projects.fn_flag_bad_faith_report(p_report_id uuid)
RETURNS void AS $$
DECLARE
    v_sev numeric;
    v_reporter uuid;
    v_ticket uuid;
BEGIN
    SELECT (value #>> '{}')::numeric INTO v_sev
    FROM security.platform_params WHERE key = 'freelancer_bad_faith_penalty';
    v_sev := COALESCE(v_sev, 0);

    SELECT reporter_user_id, ticket_id INTO v_reporter, v_ticket
    FROM projects.ticket_workload_reports WHERE id = p_report_id;

    UPDATE projects.ticket_workload_reports
    SET status = 'dismissed_bad_faith'::projects.workload_report_status, resolved_at = now()
    WHERE id = p_report_id;

    UPDATE projects.tickets
    SET status = 'in_progress'::ticket_status, hidden_until = NULL
    WHERE id = v_ticket;

    INSERT INTO security.penalties (
        subject_type, subject_id, penalty_type, source_type, source_id, severity, reason
    )
    VALUES (
        'freelancer', v_reporter, 'discovery_rank', 'workload_report', p_report_id, v_sev,
        'Workload-intensity report audited as bad-faith / unsubstantiated.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, security;
-- #endregion