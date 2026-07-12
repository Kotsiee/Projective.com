-- =============================================================================================
-- 0307_stage_staffing.sql
-- US-004 · Stage Staffing & Assignment — turns the schema-only seats/applications/assignments tables
-- (0007) into a real, guarded feature. Everything here is a SECURITY DEFINER wrapper in the exposed
-- `projects` schema, guarded internally (owner / team-lead / conflict checks), consistent with the
-- other lifecycle RPCs (0115/0117/0119/0120/0121).
--
-- Adds:
--   1. Schema — required-skills for open seats + a seat fill-state; conflict-guard index on assignments.
--   2. org.is_team_lead(uuid)                — AC3: only a team lead may act on behalf of a team.
--   3. projects.fn_stage_window(uuid)        — a stage's scheduled [start, end) window (for AC6).
--   4. projects.fn_assignee_slot_conflict(…) — AC6: is a candidate double-booked on an overlapping slot?
--   5. projects.create_stage_open_seat(…)    — AC1: client defines an open seat + required skills.
--   6. projects.apply_to_seat(…)             — AC2/AC3: freelancer or (lead-gated) team applies.
--   7. projects.assign_from_application(…)   — AC4/AC5/AC6: atomic accept → stage_assignment.
--   8. projects.get_stage_staffing(…)        — read-model powering the staffing surface.
--   9. RLS — applicants read their own applications; owners read their projects'.
-- =============================================================================================

-- #region 1. Schema — required skills, seat fill-state, conflict-guard index
CREATE TABLE IF NOT EXISTS projects.stage_open_seat_skills (
    seat_id  uuid NOT NULL REFERENCES projects.stage_open_seats (id) ON DELETE CASCADE,
    skill_id uuid NOT NULL REFERENCES org.skills (id),
    CONSTRAINT stage_open_seat_skills_pkey PRIMARY KEY (seat_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_stage_open_seat_skills_seat ON projects.stage_open_seat_skills (seat_id);

ALTER TABLE projects.stage_open_seats
    ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS filled_assignment_id uuid REFERENCES projects.stage_assignments (id) ON DELETE SET NULL;

ALTER TABLE projects.stage_open_seats DROP CONSTRAINT IF EXISTS stage_open_seats_status_check;
ALTER TABLE projects.stage_open_seats
    ADD CONSTRAINT stage_open_seats_status_check CHECK (status IN ('open', 'filled', 'closed'));

-- One live assignment of a given assignee to a given stage. A freelancer and a team are namespaced by
-- COALESCE so the two nullable FKs never collide. Terminal assignments (released/cancelled/declined)
-- are excluded so a seat can legitimately be re-staffed after a release.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stage_assignment_active_assignee
    ON projects.stage_assignments (
        project_stage_id,
        assignee_type,
        COALESCE(freelancer_profile_id, team_id)
    )
    WHERE status NOT IN ('released', 'cancelled', 'declined', 'completed');

ALTER TABLE projects.stage_open_seat_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View seat skills" ON projects.stage_open_seat_skills;
CREATE POLICY "View seat skills" ON projects.stage_open_seat_skills FOR SELECT TO public USING (
    EXISTS (
        SELECT 1
        FROM projects.stage_open_seats s
        JOIN projects.project_stages ps ON ps.id = s.project_stage_id
        WHERE s.id = stage_open_seat_skills.seat_id
            AND (projects.has_project_access (ps.project_id) OR EXISTS (
                SELECT 1 FROM projects.projects p
                WHERE p.id = ps.project_id AND p.status = 'active'::project_status
            ))
    )
);
-- #endregion

-- #region 2. org.is_team_lead — AC3 team-application authority
-- A "team lead" is an active member holding an authority role (owner / lead / admin). Only a lead may
-- submit or bind the team to work. Guarded by auth.uid() to mirror org.is_active_team_member (0109).
CREATE OR REPLACE FUNCTION org.is_team_lead(_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, org, auth
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM org.teams t
        WHERE t.id = _team_id AND t.owner_user_id = auth.uid()
    )
    OR EXISTS (
        SELECT 1
        FROM org.team_members tm
        WHERE tm.team_id = _team_id
            AND tm.user_id = auth.uid()
            AND tm.status = 'active'
            AND tm.role IN ('owner', 'lead', 'admin')
    );
$$;
-- #endregion

-- #region 3. fn_stage_window — a stage's scheduled [start, end) slot
-- Lower bound = the fixed start (if any); upper bound = the file due-date, else the session end-date.
-- Unbounded ends become +/-infinity. A fully-open (all-null) stage is [-inf, inf) and only conflicts
-- with another fully-open stage — the deterministic-but-conservative default when timing is unknown.
CREATE OR REPLACE FUNCTION projects.fn_stage_window(p_stage_id uuid)
RETURNS tstzrange
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, projects
AS $$
    SELECT tstzrange(
        COALESCE(ps.fixed_start_date, '-infinity'::timestamptz),
        COALESCE(ps.file_due_date, ps.session_end_date, 'infinity'::timestamptz),
        '[)'
    )
    FROM projects.project_stages ps
    WHERE ps.id = p_stage_id;
$$;
-- #endregion

-- #region 4. fn_assignee_slot_conflict — AC6 double-booking guard
-- TRUE when the candidate already holds a live assignment on a *different* stage whose scheduled
-- window overlaps this stage's window. Same-stage duplication is caught separately by the unique index.
CREATE OR REPLACE FUNCTION projects.fn_assignee_slot_conflict(
    p_stage_id      uuid,
    p_assignee_type assignment_type,
    p_freelancer_id uuid,
    p_team_id       uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects
AS $$
DECLARE
    v_window tstzrange := projects.fn_stage_window(p_stage_id);
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM projects.stage_assignments sa
        WHERE sa.project_stage_id <> p_stage_id
            AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed')
            AND sa.assignee_type = p_assignee_type
            AND (
                (p_assignee_type = 'freelancer' AND sa.freelancer_profile_id = p_freelancer_id)
                OR (p_assignee_type = 'team' AND sa.team_id = p_team_id)
            )
            AND projects.fn_stage_window(sa.project_stage_id) && v_window
    );
END;
$$;
-- #endregion

-- #region 5. create_stage_open_seat — AC1 open-seat definition + required skills
CREATE OR REPLACE FUNCTION projects.create_stage_open_seat(
    p_stage_id          uuid,
    p_description        text,
    p_budget_min_cents   bigint DEFAULT NULL,
    p_budget_max_cents   bigint DEFAULT NULL,
    p_require_proposals  boolean DEFAULT true,
    p_skill_ids          uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor   uuid := auth.uid();
    v_project uuid;
    v_owner   uuid;
    v_seat    uuid;
    v_skill   uuid;
BEGIN
    SELECT ps.project_id, p.owner_user_id
        INTO v_project, v_owner
    FROM projects.project_stages ps
    JOIN projects.projects p ON p.id = ps.project_id
    WHERE ps.id = p_stage_id;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Stage % not found.', p_stage_id USING ERRCODE = 'no_data_found';
    END IF;

    -- Only the paying side (owner or client-business member) may define seats on the stage.
    IF NOT projects.can_review_project(v_project) THEN
        RAISE EXCEPTION 'Only the project owner may define open seats.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF p_budget_min_cents IS NOT NULL AND p_budget_max_cents IS NOT NULL
        AND p_budget_min_cents > p_budget_max_cents THEN
        RAISE EXCEPTION 'Seat budget minimum cannot exceed the maximum.' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO projects.stage_open_seats
        (project_stage_id, description_of_need, budget_min_cents, budget_max_cents, require_proposals)
    VALUES
        (p_stage_id, COALESCE(NULLIF(btrim(p_description), ''), 'Open seat'),
         p_budget_min_cents, p_budget_max_cents, COALESCE(p_require_proposals, true))
    RETURNING id INTO v_seat;

    IF p_skill_ids IS NOT NULL THEN
        FOREACH v_skill IN ARRAY p_skill_ids LOOP
            IF EXISTS (SELECT 1 FROM org.skills sk WHERE sk.id = v_skill) THEN
                INSERT INTO projects.stage_open_seat_skills (seat_id, skill_id)
                VALUES (v_seat, v_skill)
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END IF;

    RAISE LOG '[STAFFING_RPC] create_stage_open_seat ok seat=% stage=% skills=% actor=%',
        v_seat, p_stage_id, COALESCE(array_length(p_skill_ids, 1), 0), v_actor;

    RETURN projects.fn_serialize_seat(v_seat);
END;
$$;
-- #endregion

-- #region 6. apply_to_seat — AC2 multi-type applications + AC3 team-lead gate
CREATE OR REPLACE FUNCTION projects.apply_to_seat(
    p_seat_id             uuid,
    p_applicant_type      text,
    p_applicant_profile_id uuid,
    p_message             text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor    uuid := auth.uid();
    v_project  uuid;
    v_stage    uuid;
    v_app      uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Authentication required to apply.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_applicant_type NOT IN ('freelancer', 'team') THEN
        RAISE EXCEPTION 'Applicant type must be freelancer or team (got %).', p_applicant_type
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT ps.project_id, ps.id
        INTO v_project, v_stage
    FROM projects.stage_open_seats s
    JOIN projects.project_stages ps ON ps.id = s.project_stage_id
    WHERE s.id = p_seat_id;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Open seat % not found.', p_seat_id USING ERRCODE = 'no_data_found';
    END IF;
    IF EXISTS (SELECT 1 FROM projects.stage_open_seats s WHERE s.id = p_seat_id AND s.status <> 'open') THEN
        RAISE EXCEPTION 'This seat is no longer open for applications.' USING ERRCODE = 'check_violation';
    END IF;

    -- AC3: a team application must be filed by a lead of that team; a freelancer application must be
    -- filed for the caller's own freelancer profile.
    IF p_applicant_type = 'team' THEN
        IF NOT org.is_team_lead(p_applicant_profile_id) THEN
            RAISE EXCEPTION 'Only a team lead may apply on behalf of the team.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSE
        IF p_applicant_profile_id <> v_actor THEN
            RAISE EXCEPTION 'You may only apply as yourself.' USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;

    -- No duplicate live application from the same applicant to the same seat.
    IF EXISTS (
        SELECT 1
        FROM projects.project_applications pa
        JOIN projects.project_application_targets pat ON pat.application_id = pa.id
        WHERE pat.target_type = 'seat' AND pat.target_id = p_seat_id
            AND pa.applicant_type = p_applicant_type
            AND pa.applicant_profile_id = p_applicant_profile_id
            AND pa.status = 'pending'
    ) THEN
        RAISE EXCEPTION 'You already have a pending application for this seat.' USING ERRCODE = 'unique_violation';
    END IF;

    INSERT INTO projects.project_applications
        (project_id, applicant_user_id, applicant_type, applicant_profile_id, message, status)
    VALUES
        (v_project, v_actor, p_applicant_type, p_applicant_profile_id, NULLIF(btrim(p_message), ''), 'pending')
    RETURNING id INTO v_app;

    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, 'seat', p_seat_id);

    RAISE LOG '[STAFFING_RPC] apply_to_seat ok application=% seat=% type=% profile=% actor=%',
        v_app, p_seat_id, p_applicant_type, p_applicant_profile_id, v_actor;

    RETURN projects.fn_serialize_application(v_app);
END;
$$;
-- #endregion

-- #region 7. assign_from_application — AC4/AC5/AC6 atomic accept → assignment
-- Accepting an application binds the applicant to the seat's stage. The whole body runs in one
-- transaction; a per-assignee advisory xact-lock serialises concurrent accepts of the *same* candidate
-- so the conflict guard + unique index cannot be raced into a double-booking (AC6).
CREATE OR REPLACE FUNCTION projects.assign_from_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor      uuid := auth.uid();
    v_project    uuid;
    v_seat       uuid;
    v_stage      uuid;
    v_type       text;
    v_profile    uuid;
    v_app_user   uuid;
    v_assignee_type assignment_type;
    v_freelancer uuid;
    v_team       uuid;
    v_assignment uuid;
    v_lock_key   text;
BEGIN
    SELECT pa.project_id, pa.applicant_type, pa.applicant_profile_id, pa.applicant_user_id,
           pat.target_id
        INTO v_project, v_type, v_profile, v_app_user, v_seat
    FROM projects.project_applications pa
    JOIN projects.project_application_targets pat ON pat.application_id = pa.id AND pat.target_type = 'seat'
    WHERE pa.id = p_application_id;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Seat application % not found.', p_application_id USING ERRCODE = 'no_data_found';
    END IF;

    -- Only the paying side may accept an application and bind talent to the stage.
    IF NOT projects.can_review_project(v_project) THEN
        RAISE EXCEPTION 'Only the project owner may accept applications.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT s.project_stage_id INTO v_stage FROM projects.stage_open_seats s WHERE s.id = v_seat;

    v_assignee_type := v_type::assignment_type;
    IF v_assignee_type = 'freelancer' THEN
        v_freelancer := v_profile;
        v_lock_key   := 'freelancer:' || v_profile::text;
    ELSE
        v_team     := v_profile;
        v_lock_key := 'team:' || v_profile::text;
    END IF;

    -- Serialise concurrent accepts of this candidate before the conflict checks (AC6 atomicity).
    PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));

    -- Same-stage duplicate (nicer error than the unique-index violation).
    IF EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
        WHERE sa.project_stage_id = v_stage
            AND sa.assignee_type = v_assignee_type
            AND COALESCE(sa.freelancer_profile_id, sa.team_id) = v_profile
            AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed')
    ) THEN
        RAISE EXCEPTION 'This candidate is already assigned to the stage.' USING ERRCODE = 'unique_violation';
    END IF;

    -- Overlapping-slot conflict on any *other* live stage (AC6).
    IF projects.fn_assignee_slot_conflict(v_stage, v_assignee_type, v_freelancer, v_team) THEN
        RAISE EXCEPTION 'This candidate is already booked on an overlapping active stage.'
            USING ERRCODE = 'exclusion_violation';
    END IF;

    INSERT INTO projects.stage_assignments
        (project_stage_id, assignee_type, freelancer_profile_id, team_id, assigned_by, is_client_managed, status)
    VALUES
        (v_stage, v_assignee_type, v_freelancer, v_team, v_actor, false, 'assigned')
    RETURNING id INTO v_assignment;

    -- Accept this application; auto-reject the other pending applicants for the now-filled seat.
    UPDATE projects.project_applications SET status = 'accepted', updated_at = now()
    WHERE id = p_application_id;

    UPDATE projects.project_applications pa
    SET status = 'rejected', updated_at = now()
    FROM projects.project_application_targets pat
    WHERE pat.application_id = pa.id AND pat.target_type = 'seat' AND pat.target_id = v_seat
        AND pa.id <> p_application_id AND pa.status = 'pending';

    UPDATE projects.stage_open_seats
    SET status = 'filled', filled_assignment_id = v_assignment
    WHERE id = v_seat;

    -- Enrol the freelancer as a project participant so the roster / access checks pick them up.
    IF v_assignee_type = 'freelancer' THEN
        INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
        SELECT v_project, 'freelancer', v_freelancer, 'assignee'
        WHERE NOT EXISTS (
            SELECT 1 FROM projects.project_participants pp
            WHERE pp.project_id = v_project AND pp.profile_id = v_freelancer AND pp.profile_type = 'freelancer'
        );
    END IF;

    -- AC5: an open stage moves to "assigned" the moment its first seat is filled.
    UPDATE projects.project_stages
    SET status = 'assigned'::stage_status
    WHERE id = v_stage AND status = 'open'::stage_status;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        v_project, v_actor, 'seat_assigned',
        jsonb_build_object('application_id', p_application_id, 'seat_id', v_seat, 'stage_id', v_stage,
                           'assignment_id', v_assignment, 'assignee_type', v_type),
        'projects.stage_assignments', v_assignment
    );

    RAISE LOG '[STAFFING_RPC] assign_from_application ok application=% assignment=% stage=% type=%',
        p_application_id, v_assignment, v_stage, v_type;

    RETURN projects.fn_serialize_application(p_application_id);
END;
$$;
-- #endregion

-- #region 8. Serializers + read-model
CREATE OR REPLACE FUNCTION projects.fn_serialize_seat(p_seat_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org
AS $$
    SELECT jsonb_build_object(
        'id', s.id,
        'stageId', s.project_stage_id,
        'description', s.description_of_need,
        'budgetMinCents', s.budget_min_cents,
        'budgetMaxCents', s.budget_max_cents,
        'requireProposals', s.require_proposals,
        'status', s.status,
        'filledAssignmentId', s.filled_assignment_id,
        'createdAt', s.created_at,
        'requiredSkills', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', sk.id, 'name', sk.label) ORDER BY sk.label)
            FROM projects.stage_open_seat_skills ss
            JOIN org.skills sk ON sk.id = ss.skill_id
            WHERE ss.seat_id = s.id
        ), '[]'::jsonb),
        'applicationCount', (
            SELECT count(*)
            FROM projects.project_application_targets pat
            JOIN projects.project_applications pa ON pa.id = pat.application_id
            WHERE pat.target_type = 'seat' AND pat.target_id = s.id AND pa.status = 'pending'
        )
    )
    FROM projects.stage_open_seats s
    WHERE s.id = p_seat_id;
$$;

CREATE OR REPLACE FUNCTION projects.fn_serialize_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org
AS $$
    SELECT jsonb_build_object(
        'id', pa.id,
        'projectId', pa.project_id,
        'seatId', (SELECT pat.target_id FROM projects.project_application_targets pat
                   WHERE pat.application_id = pa.id AND pat.target_type = 'seat' LIMIT 1),
        'applicantType', pa.applicant_type,
        'applicantProfileId', pa.applicant_profile_id,
        'applicantUserId', pa.applicant_user_id,
        'applicantName', COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), up.username),
        'message', pa.message,
        'status', pa.status,
        'createdAt', pa.created_at
    )
    FROM projects.project_applications pa
    LEFT JOIN org.users_public up ON up.user_id = pa.applicant_user_id
    WHERE pa.id = p_application_id;
$$;

-- get_stage_staffing — one payload with the stage's seats (each with skills + applicant list) so the
-- staffing surface hydrates in a single round-trip. Guarded by has_project_access.
CREATE OR REPLACE FUNCTION projects.get_stage_staffing(p_project_id uuid, p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_result jsonb;
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT jsonb_build_object(
        'seats', COALESCE((
            SELECT jsonb_agg(
                projects.fn_serialize_seat(s.id) || jsonb_build_object(
                    'applications', COALESCE((
                        SELECT jsonb_agg(projects.fn_serialize_application(pa.id) ORDER BY pa.created_at)
                        FROM projects.project_application_targets pat
                        JOIN projects.project_applications pa ON pa.id = pat.application_id
                        WHERE pat.target_type = 'seat' AND pat.target_id = s.id
                    ), '[]'::jsonb)
                ) ORDER BY s.created_at
            )
            FROM projects.stage_open_seats s
            WHERE s.project_stage_id = p_stage_id
        ), '[]'::jsonb),
        'assignments', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', sa.id,
                'assigneeType', sa.assignee_type,
                'freelancerProfileId', sa.freelancer_profile_id,
                'teamId', sa.team_id,
                'status', sa.status,
                'createdAt', sa.created_at
            ) ORDER BY sa.created_at)
            FROM projects.stage_assignments sa
            WHERE sa.project_stage_id = p_stage_id
        ), '[]'::jsonb)
    ) INTO v_result;

    RETURN v_result;
END;
$$;
-- #endregion

-- #region 9. RLS — applications visible to their applicant and the project owner
ALTER TABLE projects.project_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View own or owned applications" ON projects.project_applications;
CREATE POLICY "View own or owned applications" ON projects.project_applications FOR SELECT TO public USING (
    applicant_user_id = auth.uid()
    OR projects.can_review_project (project_id)
);

ALTER TABLE projects.project_application_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "View application targets" ON projects.project_application_targets;
CREATE POLICY "View application targets" ON projects.project_application_targets FOR SELECT TO public USING (
    EXISTS (
        SELECT 1 FROM projects.project_applications pa
        WHERE pa.id = project_application_targets.application_id
            AND (pa.applicant_user_id = auth.uid() OR projects.can_review_project (pa.project_id))
    )
);
-- Writes flow exclusively through the SECURITY DEFINER RPCs above; no INSERT/UPDATE policy is granted.
-- #endregion
