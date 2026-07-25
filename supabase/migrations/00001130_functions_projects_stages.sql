-- ============================================================================
-- 00001130 functions projects stages
-- Consolidated verbatim from: 0007_projects_tables.sql, 0115_ticket_lifecycle_rpcs.sql, 0117_ticket_board_and_finance.sql, 0307_stage_staffing.sql
-- ============================================================================

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

-- ---------------------------------------------------------------------------------------------
-- projects.delete_stage(p_project_id, p_stage_id)
-- Deleting an active stage:
--   1. Releases escrow for every actively-claimed ticket currently in the stage.
--   2. Detaches those tickets (they fall back to the backlog pool).
--   3. Clears the stage from every ticket's `required_stages` dependency array.
--   4. Nulls any sibling stage that depended on this one (start_dependency_stage_id).
--   5. Deletes the stage — UNLESS it carries escrow history (finance.escrows.project_stage_id
--      is ON DELETE RESTRICT + NOT NULL): funds are still released, but the stage cannot be
--      hard-deleted and the caller is told to archive it instead. This preserves the finance
--      audit trail rather than silently orphaning it.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.delete_stage(p_project_id uuid, p_stage_id uuid)
RETURNS void AS $$
DECLARE
  r record;
BEGIN
  -- 1. Release escrow for claimed tickets sitting in this stage.
  FOR r IN
    SELECT id FROM projects.tickets
    WHERE current_stage_id = p_stage_id AND current_assignee_id IS NOT NULL
  LOOP
    PERFORM finance.fn_release_ticket_escrow(r.id);
  END LOOP;

  -- 2. Detach tickets pointing at this stage back into the backlog pool.
  UPDATE projects.tickets
  SET current_stage_id = NULL, updated_at = now()
  WHERE current_stage_id = p_stage_id;

  -- 3. Clear this stage from every ticket's required_stages dependency array.
  UPDATE projects.tickets
  SET required_stages = COALESCE((
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(required_stages) elem
        WHERE elem->>'stage_id' <> p_stage_id::text
      ), '[]'::jsonb),
      updated_at = now()
  WHERE project_id = p_project_id
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(required_stages) e
      WHERE e->>'stage_id' = p_stage_id::text
    );

  -- 4. Null sibling stages that used this stage as a start dependency.
  UPDATE projects.project_stages
  SET start_dependency_stage_id = NULL
  WHERE start_dependency_stage_id = p_stage_id;

  -- 5. Guard the finance audit trail before hard-deleting.
  IF EXISTS (SELECT 1 FROM finance.escrows WHERE project_stage_id = p_stage_id) THEN
    RAISE EXCEPTION 'Stage % has escrow history: its funds were released but the stage must be archived, not deleted.', p_stage_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM projects.project_stages WHERE id = p_stage_id AND project_id = p_project_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance;

-- ---------------------------------------------------------------------------------------------
-- projects.reorder_stages(p_project_id, p_ordered_ids)
-- Atomic bulk reorder that preserves each column's internal ticket array/order (ticket
-- sort_order is independent of stage sort_order, so simply restamping stage order is safe).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.reorder_stages(p_project_id uuid, p_ordered_ids uuid[])
RETURNS void AS $$
DECLARE
  i integer;
BEGIN
  FOR i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE projects.project_stages
    SET sort_order = i - 1
    WHERE id = p_ordered_ids[i] AND project_id = p_project_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects;

-- ---------------------------------------------------------------------------------------------
-- 3. projects.force_complete_stage(p_ticket_id)
-- Client override that approves the current phase: release the held installment for the current
-- stage, then advance to the next required stage and fund its installment — or, on the final stage,
-- complete the whole ticket. Returns the new current_stage_id (NULL once the ticket is completed).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.force_complete_stage(p_ticket_id uuid)
RETURNS uuid AS $$
DECLARE
    v_current uuid;
    v_stages jsonb;
    v_project_id uuid;
    v_next uuid;
    v_current_ord int;
BEGIN
    SELECT current_stage_id, required_stages, project_id
    INTO v_current, v_stages, v_project_id
    FROM projects.tickets WHERE id = p_ticket_id;

    IF v_project_id IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id;
    END IF;
    IF NOT projects.has_project_access(v_project_id) THEN
        RAISE EXCEPTION 'You do not have permission to complete this stage.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Resolve the next required stage after the current one (by declared order).
    SELECT COALESCE((e->>'order')::int, 0) INTO v_current_ord
    FROM jsonb_array_elements(COALESCE(v_stages, '[]'::jsonb)) e
    WHERE (e->>'stage_id')::uuid = v_current
    LIMIT 1;

    SELECT (e->>'stage_id')::uuid INTO v_next
    FROM jsonb_array_elements(COALESCE(v_stages, '[]'::jsonb)) e
    WHERE COALESCE((e->>'order')::int, 0) > COALESCE(v_current_ord, -1)
    ORDER BY COALESCE((e->>'order')::int, 0) ASC
    LIMIT 1;

    IF v_next IS NULL THEN
        -- Final stage: completing the ticket releases the last held installment via the escrow-sync
        -- trigger (status -> completed), which also stamps payment_status = 'released'.
        UPDATE projects.tickets
        SET status = 'completed'::ticket_status, updated_at = now()
        WHERE id = p_ticket_id;
        RETURN NULL;
    END IF;

    -- Intermediate stage: release the current installment, move to the next stage and fund it.
    PERFORM finance.fn_release_ticket_escrow(p_ticket_id);

    UPDATE projects.tickets
    SET current_stage_id = v_next,
        status = 'in_progress'::ticket_status,
        updated_at = now()
    WHERE id = p_ticket_id;

    PERFORM finance.fn_hold_ticket_escrow(p_ticket_id);
    RETURN v_next;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, org, auth;

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
