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

-- Post-onboarding shape lock (Decision #89 backstop): `format` and `structure_variation` freeze
-- project-wide once any seat was genuinely taken. "Taken" is the same deny-list as
-- `ONBOARDED_ASSIGNMENT_EXCLUDED` in packages/types/projects/setup.ts — only `declined` and
-- `pending_funding` leave the shape open.
CREATE OR REPLACE FUNCTION projects.fn_project_shape_lock()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM projects.stage_assignments sa
        JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
        WHERE ps.project_id = NEW.id
            AND sa.status NOT IN ('declined', 'pending_funding')
    ) THEN
        RAISE EXCEPTION 'Project type cannot be modified after freelancers have been onboarded.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects;

-- ---------------------------------------------------------------------------------------------
-- projects.create_stage(p_project_id, p_name, p_description, p_description_text, p_unit_price_cents,
--                       p_payload)
-- Appends a stage to a project and provisions its room in the same transaction.
--
-- The channel call is not a convenience. `comms.get_stage_channels` provisions a stage's rooms
-- LAZILY, on first open, and the channel tree the app renders is built from the channels that
-- already exist — so a stage created without one is a stage nobody can see or navigate to. Opening
-- the General room here is what makes a newly-created stage reachable the moment it exists.
--
-- SECURITY DEFINER because it writes through `comms.project_channels`, whose RLS the caller does not
-- otherwise satisfy; the ownership check below is therefore the ONLY thing standing between a signed
-- in caller and somebody else's pipeline, and it is deliberately the first thing the body does.
--
-- WHY `p_payload` AND NOT TEN MORE NAMED PARAMETERS. A stage now carries a dozen configurable
-- fields — its task template, skills, seat cap, parallelism, NDA override, file policy and timing —
-- and every one added as a named argument is another signature this function can never again be
-- changed without. One jsonb bag keeps the signature stable while the stage grows, and it is the
-- SAME shape `projects.create_project` already reads a stage out of, so the create path and the
-- add-a-stage path cannot come to disagree about what a field is called. Everything in it is
-- optional; a caller that sends `{}` gets exactly the stage the five-argument form used to build.
--
-- The explicit arguments are kept rather than folded into the bag because they are the ones every
-- caller supplies, and because collapsing them would silently change what a five-argument call means.
-- Where both carry a value the explicit argument wins — it is the more specific statement.
--
-- Adding a defaulted parameter changes the signature, and Postgres will not `CREATE OR REPLACE`
-- across one, so this is DROP + CREATE. The old five-argument form is dropped by name; every
-- existing five-argument call still resolves against the new function, because `p_payload` defaults.
-- ---------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS projects.create_stage (uuid, text, jsonb, text, bigint);

CREATE FUNCTION projects.create_stage(
  p_project_id       uuid,
  p_name             text,
  p_description      jsonb DEFAULT '{}'::jsonb,
  p_description_text text DEFAULT '',
  p_unit_price_cents bigint DEFAULT NULL,
  p_payload          jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, auth
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_stage uuid;
  v_order integer;
  -- Resolved ONCE, because the stage row and its channel must be given the same name. Passing the raw
  -- argument to the channel meant an empty or blank name produced a stage called "Untitled stage" and
  -- a room called "" -- one thing under two names, in the two places a reader looks for it.
  v_name  text;
  v_bag   jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_dependency uuid;
  v_ip_override ip_option_mode;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to add a stage.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF jsonb_typeof(v_bag) <> 'object' THEN
    RAISE EXCEPTION 'Stage settings must be an object.' USING ERRCODE = '22023';
  END IF;

  v_name := COALESCE(NULLIF(btrim(p_name), ''), NULLIF(btrim(COALESCE(v_bag->>'name', '')), ''), 'Untitled stage');

  IF NOT EXISTS (
    SELECT 1 FROM projects.projects p
    WHERE p.id = p_project_id AND p.owner_user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'Only the project owner may add a stage.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A dependency has to be a stage of THIS project. Without the check a caller could point the new
  -- stage at a stage id from somebody else's pipeline: the FK is satisfied (it names the table, not
  -- the project), the schedule then reads a start trigger it cannot resolve, and the reference
  -- discloses that the foreign stage exists.
  v_dependency := NULLIF(v_bag->>'start_dependency_stage_id', '')::uuid;
  IF v_dependency IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM projects.project_stages ps
    WHERE ps.id = v_dependency AND ps.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'That stage is not part of this project.' USING ERRCODE = 'check_violation';
  END IF;

  v_ip_override := NULLIF(v_bag->>'ip_ownership_override', '')::ip_option_mode;

  -- Append. COALESCE covers the first stage, where MAX over an empty set is NULL and a bare +1 would
  -- make the whole expression NULL against a NOT NULL column.
  SELECT COALESCE(MAX(ps.sort_order) + 1, 0) INTO v_order
  FROM projects.project_stages ps
  WHERE ps.project_id = p_project_id;

  -- Every cast out of the bag goes through NULLIF, and every list through
  -- `projects.fn_payload_text_array`, for the reason spelled out on `projects.create_project`: this
  -- function keeps the default PUBLIC EXECUTE grant, so its arguments are caller-controlled and an
  -- empty string reaching an enum or numeric cast is a 22P02 crash rather than a refusal.
  INSERT INTO projects.project_stages (
    project_id, name, description, description_text, sort_order,
    unit_price_cents, milestone,
    file_upload_required, default_tasks, skills,
    seat_limit, parallel, nda_override,
    allowed_file_categories, allowed_file_extensions,
    start_trigger_type, fixed_start_date, start_dependency_stage_id, start_dependency_lag_days,
    hire_trigger_active, file_revisions_allowed,
    file_duration_mode, file_duration_days, file_due_date,
    ip_ownership_override, ip_mode
  )
  VALUES (
    p_project_id,
    v_name,
    COALESCE(p_description, v_bag->'description', '{}'::jsonb),
    COALESCE(NULLIF(p_description_text, ''), v_bag->>'description_text', ''),
    v_order,
    COALESCE(p_unit_price_cents, NULLIF(v_bag->>'unit_price_cents', '')::bigint),
    COALESCE(v_bag->>'milestone', ''),
    COALESCE(NULLIF(v_bag->>'file_upload_required', '')::boolean, true),
    CASE
      WHEN jsonb_typeof(v_bag->'default_tasks') = 'array' THEN v_bag->'default_tasks'
      ELSE '[]'::jsonb
    END,
    projects.fn_payload_text_array(v_bag->'skills'),
    -- Absent means the column default; an explicit null means Unlimited, which is a decision.
    CASE
      WHEN v_bag ? 'seat_limit' THEN NULLIF(v_bag->>'seat_limit', '')::integer
      ELSE 3
    END,
    COALESCE(NULLIF(v_bag->>'parallel', '')::boolean, false),
    COALESCE(NULLIF(v_bag->>'nda_override', '')::boolean, false),
    NULLIF(projects.fn_payload_text_array(v_bag->'allowed_file_categories'), '{}'::text[])::files.file_category[],
    projects.fn_payload_text_array(v_bag->'allowed_file_extensions'),
    COALESCE(NULLIF(v_bag->>'start_trigger_type', '')::start_trigger_type, 'on_project_start'::start_trigger_type),
    NULLIF(v_bag->>'fixed_start_date', '')::timestamptz,
    v_dependency,
    COALESCE(NULLIF(v_bag->>'start_dependency_lag_days', '')::integer, 0),
    COALESCE(NULLIF(v_bag->>'hire_trigger_active', '')::boolean, true),
    COALESCE(NULLIF(v_bag->>'file_revisions_allowed', '')::integer, 0),
    NULLIF(v_bag->>'file_duration_mode', ''),
    NULLIF(v_bag->>'file_duration_days', '')::integer,
    NULLIF(v_bag->>'file_due_date', '')::timestamptz,
    v_ip_override,
    COALESCE(NULLIF(v_bag->>'ip_mode', '')::ip_option_mode, v_ip_override, 'exclusive_transfer'::ip_option_mode)
  )
  RETURNING id INTO v_stage;

  PERFORM comms.get_or_create_project_channel(p_project_id, v_stage, v_name);

  RETURN v_stage;
END;
$$;

COMMENT ON FUNCTION projects.create_stage (uuid, text, jsonb, text, bigint, jsonb) IS
'Appends a stage to a project the caller owns and opens its General channel, so the new stage is immediately visible in the channel tree. p_payload carries the stage''s optional settings (tasks, skills, seat cap, parallelism, NDA override, file policy, timing, IP terms) in the same shape projects.create_project reads a stage from. Returns the new stage id.';

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
  -- 🚨 This block is the whole security of the function, and it is strictly more load-bearing here
  -- than on `reorder_stages` below: this one RELEASES ESCROW to freelancers and then hard-deletes the
  -- stage. It is SECURITY DEFINER with the default PUBLIC EXECUTE, so without a caller check any
  -- signed-in account could wipe an unrelated project's pipeline — and, once a stage reconciler
  -- reached it over HTTP, could do so in one request.
  --
  -- Ownership rather than `has_project_access`: an assigned freelancer legitimately reads the
  -- pipeline and must never be able to delete the stage their own escrow is held against.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to delete a stage.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM projects.projects p
    WHERE p.id = p_project_id AND p.owner_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the project owner may delete a stage.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The stage must belong to the project named. Without this the ownership check above proves only
  -- that the caller owns SOME project, and a stage id from another one would still be deleted.
  IF NOT EXISTS (
    SELECT 1 FROM projects.project_stages ps
    WHERE ps.id = p_stage_id AND ps.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Stage % does not belong to project %.', p_stage_id, p_project_id
      USING ERRCODE = 'check_violation';
  END IF;

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
-- `auth` on the path so `auth.uid()` resolves for the ownership guard above.
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, finance, auth;

-- ---------------------------------------------------------------------------------------------
-- projects.reorder_stages(p_project_id, p_ordered_ids)
-- Atomic bulk reorder that preserves each column's internal ticket array/order (ticket
-- sort_order is independent of stage sort_order, so simply restamping stage order is safe).
--
-- 🚨 The authorisation block below is the whole security of this function. It is SECURITY DEFINER,
-- so the UPDATE inside runs as the owner and RLS never sees it, and it keeps the default PUBLIC
-- EXECUTE grant every other RPC in this file relies on. Without a caller check that combination
-- means any signed-in caller who knows a project id and its stage ids can reorder somebody else's
-- pipeline — and stage order is the execution sequence, so a reorder is a change to what gets built
-- when, not a cosmetic one.
--
-- Ownership rather than `has_project_access`: an assigned freelancer legitimately reads the pipeline
-- and must not be able to rewrite the client's sequencing.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION projects.reorder_stages(p_project_id uuid, p_ordered_ids uuid[])
RETURNS void AS $$
DECLARE
  i integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to reorder stages.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM projects.projects p WHERE p.id = p_project_id AND p.owner_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Only the project owner may reorder its stages.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR i IN 1 .. array_length(p_ordered_ids, 1) LOOP
    UPDATE projects.project_stages
    SET sort_order = i - 1
    WHERE id = p_ordered_ids[i] AND project_id = p_project_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, auth;

-- ---------------------------------------------------------------------------------------------
-- 3. projects.force_complete_stage(p_ticket_id)
-- Client override that approves the current phase: release the held installment for the current
-- stage, then advance to the next required stage and fund its installment — or, on the final stage,
-- complete the whole ticket. Returns the new current_stage_id (NULL once the ticket is completed).
--
-- 🚨 A CLIENT override, so the guard is review authority (`can_review_project`), not
-- `has_project_access`: the assignee has project access, and under that guard could approve their
-- own installment and release its escrow. The ticket row is locked before the check.
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
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to complete a stage.' USING ERRCODE = '42501';
    END IF;

    SELECT current_stage_id, required_stages, project_id
    INTO v_current, v_stages, v_project_id
    FROM projects.tickets WHERE id = p_ticket_id
    FOR UPDATE;

    IF v_project_id IS NULL THEN
        RAISE EXCEPTION 'Ticket % not found.', p_ticket_id USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT projects.can_review_project(v_project_id) THEN
        RAISE EXCEPTION 'Only the client/owner may complete this stage.' USING ERRCODE = '42501';
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

-- #region 6b. apply_to_project — the freelancer-led request to a stage (or one of its roles)
-- `apply_to_seat` covers a posted seat, but the setup wizard writes staffing ROLES and no seats, so
-- most stages have none to apply to. This is the general door: a freelancer applies, as themselves,
-- to a stage of a live, discoverable project — naming one of its staffing roles when the stage has
-- them — and the application waits as `pending` for the owner (`assign_from_application`).
--
-- The cover note is held to the protected phase's PII rule before it is stored or quoted, and the
-- owner is told through the router (`application.received`), whose deep link is the conversation
-- with the applicant. The fat service then posts the note as the opening DM through
-- comms.send_request_message, which files it in the owner's Requests folder.
--
-- `p_team_id` applies on a TEAM's behalf instead (`applicant_type = 'team'`, the team as the
-- applicant profile, so acceptance seats the team). Only a member holding `bind_seat` may commit the
-- team to work (`org.is_team_lead`), and a team needs two active members before it may send
-- proposals at all (PRODUCT_SPEC §Proposal allowances). The proposal is metered against the team's
-- pool by the insert trigger, exactly as a personal one is metered against the person's.
CREATE OR REPLACE FUNCTION projects.apply_to_project(
    p_project text,
    p_stage   text,
    p_role_id uuid DEFAULT NULL,
    p_message text DEFAULT NULL,
    p_team_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org, auth
AS $$
DECLARE
    v_actor       uuid := auth.uid();
    v_project     projects.projects%ROWTYPE;
    v_stage       projects.project_stages%ROWTYPE;
    v_role_title  text;
    v_target_type projects.application_target_type;
    v_target_id   uuid;
    v_message     text := NULLIF(btrim(COALESCE(p_message, '')), '');
    v_app         uuid;
    v_name        text;
    v_username    text;
    v_team_name   text;
    v_members     integer;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to apply to a project.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_message IS NOT NULL AND char_length(v_message) > 4000 THEN
        RAISE EXCEPTION 'message: too_long' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_project FROM projects.projects p
     WHERE p.slug = p_project OR p.id::text = p_project;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project USING ERRCODE = 'no_data_found';
    END IF;
    IF v_project.owner_user_id = v_actor THEN
        RAISE EXCEPTION 'You cannot apply to your own project.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_project.status <> 'active' OR v_project.visibility NOT IN ('public', 'unlisted') THEN
        RAISE EXCEPTION 'This project is not taking applications.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_team_id IS NOT NULL THEN
        -- A team application seats the TEAM on acceptance, so the team is what must be able to work.
        IF NOT org.is_team_lead(p_team_id) THEN
            RAISE EXCEPTION 'Only a team member who can commit the team to work may apply on its behalf.'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF v_project.owner_team_id = p_team_id THEN
            RAISE EXCEPTION 'A team cannot apply to its own project.' USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*)::integer INTO v_members
          FROM org.team_members m
         WHERE m.team_id = p_team_id AND m.status = 'active';
        IF v_members < 2 THEN
            RAISE EXCEPTION 'Teams must have at least 2 members before applying to client projects.'
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT t.name INTO v_team_name FROM org.teams t WHERE t.id = p_team_id;
    -- An accepted application becomes a freelancer stage assignment, whose FK is the freelancer profile.
    ELSIF NOT EXISTS (SELECT 1 FROM org.freelancer_profiles fp WHERE fp.user_id = v_actor) THEN
        RAISE EXCEPTION 'Set up your freelancer profile before applying.' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_stage FROM projects.project_stages s
     WHERE s.project_id = v_project.id AND (s.slug = p_stage OR s.id::text = p_stage);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That stage is not part of this project.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_stage.hire_trigger_active OR v_stage.status NOT IN ('open', 'assigned', 'in_progress') THEN
        RAISE EXCEPTION 'This stage is not taking applications.' USING ERRCODE = 'check_violation';
    END IF;

    IF p_role_id IS NOT NULL THEN
        SELECT r.role_title INTO v_role_title
          FROM projects.stage_staffing_roles r
         WHERE r.id = p_role_id AND r.project_stage_id = v_stage.id AND r.allow_proposals;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That role is not open to applications.' USING ERRCODE = 'check_violation';
        END IF;
        v_target_type := 'role';
        v_target_id := p_role_id;
    ELSE
        v_target_type := 'stage';
        v_target_id := v_stage.id;
    END IF;

    -- Both checks are applicant-aware: a lead's own seat and their team's are different applicants, so a
    -- person may hold one pending application as themselves and one on their team's behalf.
    IF EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
         WHERE sa.project_stage_id = v_stage.id
           AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed')
           AND (
                (p_team_id IS NULL AND sa.assignee_type = 'freelancer' AND sa.freelancer_profile_id = v_actor)
             OR (p_team_id IS NOT NULL AND sa.assignee_type = 'team' AND sa.team_id = p_team_id)
           )
    ) THEN
        RAISE EXCEPTION 'You are already on this stage.' USING ERRCODE = 'unique_violation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM projects.project_applications pa
          JOIN projects.project_application_targets pat ON pat.application_id = pa.id
         WHERE pa.status = 'pending'
           AND pat.target_type = v_target_type
           AND pat.target_id = v_target_id
           AND (
                (p_team_id IS NULL AND pa.applicant_type = 'freelancer' AND pa.applicant_user_id = v_actor)
             OR (p_team_id IS NOT NULL AND pa.applicant_type = 'team' AND pa.applicant_profile_id = p_team_id)
           )
    ) THEN
        RAISE EXCEPTION 'You already have a pending application here.' USING ERRCODE = 'unique_violation';
    END IF;

    IF v_message IS NOT NULL AND projects.is_protected_phase(v_project.id) THEN
        SELECT m.masked INTO v_message FROM comms.mask_pii(v_message) m;
    END IF;

    INSERT INTO projects.project_applications
        (project_id, applicant_user_id, applicant_type, applicant_profile_id, message, status)
    VALUES
        (v_project.id, v_actor, CASE WHEN p_team_id IS NULL THEN 'freelancer' ELSE 'team' END,
         COALESCE(p_team_id, v_actor), v_message, 'pending')
    RETURNING id INTO v_app;

    INSERT INTO projects.project_application_targets (application_id, target_type, target_id)
    VALUES (v_app, v_target_type, v_target_id);

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        v_project.id, v_actor, 'application_submitted',
        jsonb_build_object('application_id', v_app, 'stage_id', v_stage.id, 'role_id', p_role_id, 'team_id', p_team_id),
        'projects.project_applications', v_app
    );

    SELECT NULLIF(trim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')), ''), up.username
      INTO v_name, v_username
      FROM org.users_public up
     WHERE up.user_id = v_actor;

    PERFORM comms.fn_notify(
        v_project.owner_user_id,
        'application.received',
        format('%s applied to %s', COALESCE(v_team_name, v_name, 'A freelancer'), COALESCE(v_role_title, v_stage.name)),
        v_project.title || ' · ' || v_stage.name
            || CASE WHEN v_message IS NOT NULL THEN ' — ' || left(v_message, 140) ELSE '' END,
        'projects.project_applications',
        v_app,
        jsonb_build_object(
            'project_slug', v_project.slug,
            'project_title', v_project.title,
            'stage_id', v_stage.id,
            'stage_name', v_stage.name,
            'role_title', v_role_title
        ),
        v_actor,
        'project',
        v_project.id,
        NULL,
        CASE WHEN v_username IS NOT NULL THEN '/messages/dm-' || v_username ELSE NULL END
    );

    RETURN jsonb_build_object(
        'id', v_app,
        'projectId', v_project.id,
        'projectSlug', v_project.slug,
        'ownerUserId', v_project.owner_user_id,
        'stageId', v_stage.id,
        'roleId', p_role_id,
        'applicantType', CASE WHEN p_team_id IS NULL THEN 'freelancer' ELSE 'team' END,
        'teamId', p_team_id,
        'status', 'pending',
        'message', v_message
    );
END;
$$;

COMMENT ON FUNCTION projects.apply_to_project(text, text, uuid, text, uuid) IS
'A freelancer applies, as themselves or (p_team_id) on behalf of a team they may bind to work, to a stage (optionally one of its staffing roles) of an active, public or unlisted project. A team needs two active members. Masks the cover note in the protected phase, records a pending application (metered against the applicant''s proposal allowance by trigger), and notifies the owner (application.received). Project and stage accept a slug or a uuid.';

REVOKE ALL ON FUNCTION projects.apply_to_project(text, text, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects.apply_to_project(text, text, uuid, text, uuid) TO authenticated;

-- #endregion

-- #region 6c. withdraw_application — the applicant takes a pending proposal back
-- Withdrawing is the applicant's own act and the only way an application becomes `withdrawn`. The
-- status flip is what `trg_refund_withdrawn_application` listens for, so the proposal's unit returns
-- to the applicant's weekly allowance in this same transaction — selectivity is never punished twice.
-- The buffer token is NOT returned: the drip exists to stop bursts, and an apply → withdraw loop that
-- refilled it would let a sender notify the same client without limit.
--
-- The person who filed it may withdraw it, and so may anyone who could have filed it for the team
-- (`bind_seat`). Only a pending application can be withdrawn; an answered one is history.
CREATE OR REPLACE FUNCTION projects.withdraw_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_app   projects.project_applications%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to withdraw an application.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_app FROM projects.project_applications pa
     WHERE pa.id = p_application_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Application % not found.', p_application_id USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT (
        v_app.applicant_user_id = v_actor
        OR (v_app.applicant_type = 'team' AND org.is_team_lead(v_app.applicant_profile_id))
    ) THEN
        RAISE EXCEPTION 'Only the applicant can withdraw this application.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_app.status <> 'pending' THEN
        RAISE EXCEPTION 'Only a pending application can be withdrawn.' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE projects.project_applications
       SET status = 'withdrawn'
     WHERE id = v_app.id;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        v_app.project_id, v_actor, 'application_withdrawn',
        jsonb_build_object('application_id', v_app.id),
        'projects.project_applications', v_app.id
    );

    RETURN jsonb_build_object('id', v_app.id, 'status', 'withdrawn', 'refunded', 1);
END;
$$;

COMMENT ON FUNCTION projects.withdraw_application(uuid) IS
'The applicant (or a member who may bind the applying team) withdraws a pending application. The status flip refunds one weekly proposal unit through trg_refund_withdrawn_application; the anti-burst buffer token is not returned.';

-- #endregion

-- #region 6d. list_my_applications — the proposals the caller has sent
-- Every application the caller filed, plus those filed for a team they belong to, newest first, with
-- the names a list needs (project, stage, role, team) resolved here. The applicant may not be able to
-- read a project that has since gone private, and the title they applied to is still theirs to see,
-- so the names are read with the definer's rights; the ROWS are scoped to the caller.
-- `p_project` narrows to one project (slug or uuid) — the listing page asks "have I applied here?".
CREATE OR REPLACE FUNCTION projects.list_my_applications(p_project text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to see your proposals.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r."createdAt" DESC)
        FROM (
            SELECT
                pa.id,
                pa.status,
                pa.applicant_type AS "applicantType",
                CASE WHEN pa.applicant_type = 'team' THEN pa.applicant_profile_id END AS "teamId",
                CASE WHEN pa.applicant_type = 'team' THEN t.name END AS "teamName",
                (pa.applicant_user_id = v_actor
                    OR (pa.applicant_type = 'team' AND org.is_team_lead(pa.applicant_profile_id))) AS "canWithdraw",
                p.slug AS "projectSlug",
                p.title AS "projectTitle",
                s.slug AS "stageSlug",
                s.name AS "stageName",
                sr.role_title AS "roleTitle",
                pa.created_at AS "createdAt"
            FROM projects.project_applications pa
            JOIN projects.projects p ON p.id = pa.project_id
            LEFT JOIN projects.project_application_targets pat ON pat.application_id = pa.id
            LEFT JOIN projects.stage_staffing_roles sr
                   ON pat.target_type = 'role' AND sr.id = pat.target_id
            LEFT JOIN projects.stage_open_seats os
                   ON pat.target_type = 'seat' AND os.id = pat.target_id
            LEFT JOIN projects.project_stages s
                   ON s.id = CASE pat.target_type
                                WHEN 'stage' THEN pat.target_id
                                WHEN 'role' THEN sr.project_stage_id
                                ELSE os.project_stage_id
                             END
            LEFT JOIN org.teams t ON pa.applicant_type = 'team' AND t.id = pa.applicant_profile_id
            WHERE (
                    pa.applicant_user_id = v_actor
                 OR (pa.applicant_type = 'team' AND org.is_active_team_member(pa.applicant_profile_id))
                  )
              AND (p_project IS NULL OR p.slug = p_project OR p.id::text = p_project)
            ORDER BY pa.created_at DESC
            LIMIT 200
        ) r
    ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION projects.list_my_applications(text) IS
'The applications the caller filed or that were filed for a team they belong to, newest first, with project, stage, role and team names and whether the caller may withdraw each. p_project narrows to one project (slug or uuid).';

-- #endregion

-- #region 7. assign_from_application — AC4/AC5/AC6 atomic accept → assignment
-- Accepting an application binds the applicant to the target's stage — a posted seat's, a staffing
-- role's, or the stage itself (`apply_to_project`). The whole body runs in one transaction; a
-- per-assignee advisory xact-lock serialises concurrent accepts of the *same* candidate so the
-- conflict guard + unique index cannot be raced into a double-booking (AC6). Only a seat is FILLED
-- (and its other applicants rejected): a role or a stage can take more than one person.
CREATE OR REPLACE FUNCTION projects.assign_from_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org, auth
AS $$
DECLARE
    v_actor      uuid := auth.uid();
    v_project    uuid;
    v_seat       uuid;
    v_stage      uuid;
    v_type       text;
    v_profile    uuid;
    v_app_user   uuid;
    v_status     projects.application_status;
    v_target_type projects.application_target_type;
    v_target_id  uuid;
    v_assignee_type assignment_type;
    v_freelancer uuid;
    v_team       uuid;
    v_assignment uuid;
    v_lock_key   text;
    v_slug       text;
    v_title      text;
    v_stage_name text;
BEGIN
    SELECT pa.project_id, pa.applicant_type, pa.applicant_profile_id, pa.applicant_user_id, pa.status,
           pat.target_type, pat.target_id
        INTO v_project, v_type, v_profile, v_app_user, v_status, v_target_type, v_target_id
    FROM projects.project_applications pa
    JOIN projects.project_application_targets pat ON pat.application_id = pa.id
    WHERE pa.id = p_application_id
    ORDER BY CASE pat.target_type WHEN 'seat' THEN 0 WHEN 'role' THEN 1 ELSE 2 END
    LIMIT 1;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Application % not found.', p_application_id USING ERRCODE = 'no_data_found';
    END IF;

    -- Staffing authority (Decision #145): the owner, the client business, or a delegated admin/manager.
    IF NOT projects.can_manage_project_members(v_project) THEN
        RAISE EXCEPTION 'Only the project owner, an admin or a manager may accept requests.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'This application has already been %.', v_status USING ERRCODE = 'check_violation';
    END IF;

    IF v_target_type = 'seat' THEN
        v_seat := v_target_id;
        SELECT s.project_stage_id INTO v_stage FROM projects.stage_open_seats s WHERE s.id = v_seat;
    ELSIF v_target_type = 'role' THEN
        SELECT r.project_stage_id INTO v_stage FROM projects.stage_staffing_roles r WHERE r.id = v_target_id;
    ELSE
        v_stage := v_target_id;
    END IF;

    IF v_stage IS NULL THEN
        RAISE EXCEPTION 'The stage this application named no longer exists.' USING ERRCODE = 'no_data_found';
    END IF;

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

    UPDATE projects.project_applications SET status = 'accepted', updated_at = now()
    WHERE id = p_application_id;

    -- A seat holds one person: fill it and auto-reject its other pending applicants.
    IF v_seat IS NOT NULL THEN
        UPDATE projects.project_applications pa
        SET status = 'rejected', updated_at = now()
        FROM projects.project_application_targets pat
        WHERE pat.application_id = pa.id AND pat.target_type = 'seat' AND pat.target_id = v_seat
            AND pa.id <> p_application_id AND pa.status = 'pending';

        UPDATE projects.stage_open_seats
        SET status = 'filled', filled_assignment_id = v_assignment
        WHERE id = v_seat;
    END IF;

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
                           'assignment_id', v_assignment, 'assignee_type', v_type,
                           'target_type', v_target_type),
        'projects.stage_assignments', v_assignment
    );

    -- Tell the applicant, through the router; they are a participant now, so the project routes.
    SELECT p.slug, p.title INTO v_slug, v_title FROM projects.projects p WHERE p.id = v_project;
    SELECT s.name INTO v_stage_name FROM projects.project_stages s WHERE s.id = v_stage;
    PERFORM comms.fn_notify(
        v_app_user,
        'application.accepted',
        format('Your application to %s was accepted', COALESCE(v_stage_name, v_title)),
        v_title || CASE WHEN v_stage_name IS NOT NULL THEN ' · ' || v_stage_name ELSE '' END,
        'projects.project_applications',
        p_application_id,
        jsonb_build_object('project_slug', v_slug, 'project_title', v_title,
                           'stage_id', v_stage, 'stage_name', v_stage_name),
        v_actor,
        'project',
        v_project,
        NULL,
        '/projects/' || v_slug
    );

    RAISE LOG '[STAFFING_RPC] assign_from_application ok application=% assignment=% stage=% type=%',
        p_application_id, v_assignment, v_stage, v_type;

    RETURN projects.fn_serialize_application(p_application_id);
END;
$$;

-- #endregion

-- #region 7b. reject_application — the managing side declines an applicant
-- The other answer to an inbound request (the Members tab's Requests section). The application becomes
-- `rejected` — the status a filled seat already gives its other applicants, so "declined" and "not
-- selected" are one state to the applicant — and they are told (`application.declined`), deep-linked to
-- their conversation with the owner. Nothing else moves: no assignment existed, so nothing is released.
-- The row is locked first so a concurrent accept and decline of the same application cannot both land.
CREATE OR REPLACE FUNCTION projects.reject_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org, auth
AS $$
DECLARE
    v_actor    uuid := auth.uid();
    v_project  uuid;
    v_app_user uuid;
    v_status   projects.application_status;
    v_slug     text;
    v_title    text;
    v_owner    text;
BEGIN
    SELECT pa.project_id, pa.applicant_user_id, pa.status
        INTO v_project, v_app_user, v_status
    FROM projects.project_applications pa
    WHERE pa.id = p_application_id
    FOR UPDATE;

    IF v_project IS NULL THEN
        RAISE EXCEPTION 'Application % not found.', p_application_id USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT projects.can_manage_project_members(v_project) THEN
        RAISE EXCEPTION 'Only the project owner, an admin or a manager may decline requests.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'This application has already been %.', v_status USING ERRCODE = 'check_violation';
    END IF;

    UPDATE projects.project_applications SET status = 'rejected', updated_at = now()
    WHERE id = p_application_id;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        v_project, v_actor, 'application_rejected',
        jsonb_build_object('application_id', p_application_id),
        'projects.project_applications', p_application_id
    );

    SELECT p.slug, p.title, up.username INTO v_slug, v_title, v_owner
    FROM projects.projects p
    LEFT JOIN org.users_public up ON up.user_id = p.owner_user_id
    WHERE p.id = v_project;

    PERFORM comms.fn_notify(
        v_app_user,
        'application.declined',
        format('Your application to %s was declined', v_title),
        v_title,
        'projects.project_applications',
        p_application_id,
        jsonb_build_object('project_slug', v_slug, 'project_title', v_title),
        v_actor,
        'project',
        v_project,
        NULL,
        CASE WHEN v_owner IS NOT NULL THEN '/messages/dm-' || v_owner ELSE NULL END
    );

    RAISE LOG '[STAFFING_RPC] reject_application ok application=% project=%', p_application_id, v_project;

    RETURN projects.fn_serialize_application(p_application_id);
END;
$$;

COMMENT ON FUNCTION projects.reject_application(uuid) IS
'The project''s staffing authority (can_manage_project_members) declines a pending application: it becomes rejected, the decision is logged on project_activity, and the applicant is notified (application.declined). Anything not pending is refused naming its status.';

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


-- ============================================================================
-- Service instantiation — the 30-day sweep for un-funded pipeline drafts.
--
-- "Add to Projects" on a Pipeline listing copies the seller's blueprint into the buyer's workspace as
-- `status = 'draft'`, `visibility = 'unlisted'`, with every `stage_assignments` row parked at
-- `pending_funding`. No money moves and nothing is reserved, which is the point: a pipeline is
-- staffed and then bought against, one ticket at a time (PRODUCT_SPEC.md §Creation & Purchasing
-- Gate).
--
-- A draft nobody ever funds is clutter rather than history, so it is reclaimed after 30 days of
-- inactivity — by SOFT ARCHIVAL. Nothing here deletes a row (root CLAUDE.md §7): the status becomes
-- `archived`, `archived_at` is stamped, and the project and its stages stay exactly where they were.
--
-- The three predicates are each load-bearing:
--   * `source_blueprint_id IS NOT NULL` — only instantiated drafts are in scope. A project somebody
--     built by hand is theirs, however long it sits.
--   * `status = 'draft'` — anything that has moved on has left the sweep's reach by definition.
--   * no funded stage — funding does not POSTPONE the deadline, it REMOVES it. A pipeline somebody
--     has paid into is an engagement, and no amount of subsequent idleness makes it an abandoned
--     draft again.
-- ============================================================================
CREATE OR REPLACE FUNCTION projects.fn_archive_stale_service_drafts (p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idle_days integer;
    v_archived  integer := 0;
BEGIN
    -- The window is a platform parameter rather than a literal, so it can be tuned without a
    -- migration — and it is mirrored by `DRAFT_IDLE_DAYS` in `@projective/types/services`, which the
    -- app reads to tell the buyer when their draft expires. Two places, one number: if they disagree
    -- the interface promises a date the job does not honour.
    SELECT COALESCE((value #>> '{}')::integer, 30)
      INTO v_idle_days
      FROM security.platform_params
     WHERE key = 'service_draft_idle_days';

    IF v_idle_days IS NULL THEN
        v_idle_days := 30;
    END IF;

    WITH stale AS (
        UPDATE projects.projects p
           SET status      = 'archived',
               archived_at = p_now,
               updated_at  = p_now
         WHERE p.status = 'draft'
           AND p.source_blueprint_id IS NOT NULL
           AND p.last_activity_at < p_now - make_interval(days => v_idle_days)
           -- No stage has been funded. `fn_stage_is_funded` is not assumed to exist here; the
           -- escrow record is the authoritative evidence that money moved, and it is what a dispute
           -- would be resolved against.
           AND NOT EXISTS (
               SELECT 1
                 FROM projects.project_stages ps
                 JOIN finance.escrows e ON e.project_stage_id = ps.id
                WHERE ps.project_id = p.id
           )
        RETURNING 1
    )
    SELECT count(*) INTO v_archived FROM stale;

    RETURN v_archived;
END;
$$;

COMMENT ON FUNCTION projects.fn_archive_stale_service_drafts (timestamptz) IS
'Soft-archives instantiated pipeline drafts idle for `service_draft_idle_days` (default 30) with no funded stage. Never deletes. Returns the number archived.';

-- Scheduled registration.
--
-- Guarded end to end, matching the `pg_cron` block in `00000002_extensions_core.sql`: the extension
-- may not be installed (a local `supabase start` does not ship it), and `cron.schedule` needs
-- privileges a migration run may not have. A failure here must not block the rest of the migration —
-- the job can be scheduled by hand afterwards, and the application-side twin
-- (`ProjectBackendService.sweepStaleDrafts`) covers the fixture path where there is no database at
-- all.
--
-- Daily at 03:10 UTC. The window is thirty days, so the hour is irrelevant to correctness and is
-- chosen to sit away from the top of an hour where every other job clusters.
DO $$
BEGIN
    PERFORM cron.schedule (
        'archive-stale-service-drafts',
        '10 3 * * *',
        $cron$SELECT projects.fn_archive_stale_service_drafts();$cron$
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable — projects.fn_archive_stale_service_drafts must be scheduled manually.';
END $$;

-- #region 10. Project invitations — issue, answer, and the removal that undoes an acceptance
--
-- The client-led half of `PRODUCT_SPEC.md` §The Hiring Process ("The Outbound Invitation"). Four
-- functions, one transaction each, so an invitation and the notification that announces it — or an
-- acceptance and the participant row it grants — cannot exist without each other.
--
-- Why RPCs rather than the fat service writing the table through PostgREST under the owner's RLS:
--   1. `comms.fn_notify` is EXECUTE-granted to `service_role` only (00002510), so the only place an
--      application-tier write can emit through the notification ROUTER — the one implementation of
--      the recipient's channel, quiet-hours, mute and digest preferences — is a DEFINER function.
--      Issuing the row and routing the notice in one body is what makes "an invitation the invitee
--      was never told about" and "a notice about an invitation that rolled back" both impossible.
--   2. An acceptance touches THREE tables (the invitation, `project_participants`, `stage_assignments`)
--      and PostgREST gives one statement per round trip with no transaction around them.
--   3. `placeholder` is DERIVED here, never accepted from a caller (see the column comment): a caller
--      who could mark a live project's invitation "placeholder" could invite somebody onto a priced
--      stage while stating no price.
--
-- Authorisation is the owner's alone, matching the `Owner manages invitations` policy on the table:
-- DEFINER bypasses RLS, so the check the policy would have made is made here, explicitly, first.
-- ---------------------------------------------------------------------------------------------

-- projects.invite_to_project(project, stage, target, role, message, offer, answers) -> invitation id
--
-- One row, one stage (or NULL for a whole-project invitation). The invitee is addressed by IDENTITY
-- (Decision #108/#109) — the fat service resolved the `@handle` to a user id — so `target_email`
-- stays NULL. The re-invitation cooldown is enforced HERE as well as in the fat service: 48 days from
-- the latest decline for this (project, invitee), the same figure as `INVITE_COOLDOWN_DAYS` in
-- `packages/types/projects/hire.ts` (a contract test pins the two together). Refused as
-- `check_violation` with the date it lifts, in the same words the service uses.
CREATE OR REPLACE FUNCTION projects.invite_to_project(
    p_project_id        uuid,
    p_stage_id          uuid,
    p_target_user_id    uuid,
    p_role              text,
    p_message           text DEFAULT '',
    p_offer_price_cents bigint DEFAULT NULL,
    p_answers           jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org, auth
AS $$
DECLARE
    v_actor        uuid := auth.uid();
    v_project      projects.projects%ROWTYPE;
    v_stage_name   text;
    v_stage_price  bigint;
    v_price        bigint;
    v_placeholder  boolean;
    v_cooldown_end timestamptz;
    v_inviter_name text;
    v_inviter_slug text;
    v_id           uuid;
    v_title        text;
    v_body         text;
    v_message      text := COALESCE(p_message, '');
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to invite someone to a project.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT * INTO v_project FROM projects.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;
    IF NOT projects.can_manage_project_members(p_project_id) THEN
        RAISE EXCEPTION 'Only the project owner, an admin or a manager may invite people to it.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF v_project.status IN ('archived', 'cancelled', 'completed') THEN
        RAISE EXCEPTION 'This project is closed — nobody can be invited to it.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_target_user_id = v_actor OR p_target_user_id = v_project.owner_user_id THEN
        RAISE EXCEPTION 'You are already on this project.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('admin', 'manager', 'freelancer', 'member', 'guest') THEN
        RAISE EXCEPTION 'That is not a role an invitation can grant.' USING ERRCODE = 'check_violation';
    END IF;
    -- A delegate staffs the project; appointing another delegate is the owner's call.
    IF p_role IN ('admin', 'manager') AND NOT projects.can_review_project(p_project_id) THEN
        RAISE EXCEPTION 'Only the project owner may invite an admin or a manager.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- The stage, when named, must be THIS project's. The FK only names the table.
    IF p_stage_id IS NOT NULL THEN
        SELECT s.name, s.unit_price_cents INTO v_stage_name, v_stage_price
        FROM projects.project_stages s
        WHERE s.id = p_stage_id AND s.project_id = p_project_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'That stage is not part of this project.' USING ERRCODE = 'check_violation';
        END IF;
        -- A seat they already hold is not one they can be invited to.
        IF EXISTS (
            SELECT 1 FROM projects.stage_assignments sa
            WHERE sa.project_stage_id = p_stage_id
                AND sa.assignee_type = 'freelancer'
                AND sa.freelancer_profile_id = p_target_user_id
                AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed')
        ) THEN
            RAISE EXCEPTION 'This person is already assigned to that stage.' USING ERRCODE = 'unique_violation';
        END IF;
    ELSIF EXISTS (
        SELECT 1 FROM projects.project_participants pp
        WHERE pp.project_id = p_project_id AND pp.profile_type = 'freelancer' AND pp.profile_id = p_target_user_id
    ) THEN
        RAISE EXCEPTION 'This person is already on the project.' USING ERRCODE = 'unique_violation';
    END IF;

    -- The re-invitation cooldown — the invitee's no is honoured for 48 days from the decline.
    SELECT max(i.declined_at) + interval '48 days' INTO v_cooldown_end
    FROM projects.project_invitations i
    WHERE i.project_id = p_project_id
        AND i.target_user_id = p_target_user_id
        AND i.status = 'declined';
    IF v_cooldown_end IS NOT NULL AND v_cooldown_end > now() THEN
        -- DETAIL carries the exact instant (ISO 8601, UTC) so the service can answer with the
        -- reopening timestamp as well as the sentence.
        RAISE EXCEPTION 'You can invite this freelancer to this project again after %.',
            to_char(v_cooldown_end AT TIME ZONE 'UTC', 'FMDD Mon YYYY')
            USING ERRCODE = 'check_violation',
                  DETAIL = 'reopens_at=' || to_char(v_cooldown_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    END IF;

    -- The intro is the first thing a stranger reads from this client, so it is held to the protected
    -- phase's PII rule before it is stored, quoted in the notice, or posted as the opening DM.
    IF v_message <> '' AND projects.is_protected_phase(p_project_id) THEN
        SELECT m.masked INTO v_message FROM comms.mask_pii(v_message) m;
    END IF;

    -- The terms as RECORDED: a stated figure, else the stage's configured rate (the project budget for
    -- a whole-project offer). A draft, or an offer with no figure anywhere, is a placeholder.
    v_price := COALESCE(p_offer_price_cents, CASE WHEN p_stage_id IS NULL THEN v_project.budget_amount_cents ELSE v_stage_price END);
    v_placeholder := v_project.status = 'draft' OR v_price IS NULL;

    BEGIN
        INSERT INTO projects.project_invitations (
            project_id, project_stage_id, target_user_id, role, inviter_user_id, token,
            message, offer_price_cents, answers, placeholder, status, expires_at
        ) VALUES (
            -- Schema-qualified: pgcrypto is installed into `extensions`, which this function's
            -- search_path deliberately does not include, and an unqualified call raises 42883 at
            -- RUN time (plpgsql defers resolution) — the function creates cleanly and fails on
            -- its first real call.
            p_project_id, p_stage_id, p_target_user_id, p_role, v_actor, encode(extensions.gen_random_bytes(32), 'hex'),
            v_message, p_offer_price_cents, COALESCE(p_answers, '{}'::jsonb), v_placeholder,
            'pending', now() + interval '14 days'
        )
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        -- `uq_project_invitations_open_seat`: one open offer per (project, stage, person).
        RAISE EXCEPTION 'An invitation to this person for this stage is already pending.' USING ERRCODE = 'unique_violation';
    END;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        p_project_id, v_actor, 'invitation_sent',
        jsonb_build_object('invitation_id', v_id, 'stage_id', p_stage_id, 'target_user_id', p_target_user_id,
                           'role', p_role, 'placeholder', v_placeholder),
        'projects.project_invitations', v_id
    );

    -- Tell the invitee, through the router. `stage.invite` is the catalog's invitation event for both
    -- grains — a whole-project offer is the same product event addressed to the whole engagement —
    -- and its policy (work · high · in_app + push + email · mutable) is what the recipient's
    -- preferences are intersected with. The deep link is the conversation the two share, which is
    -- where the invitee can answer today; the catalog's `/projects/{context_id}` template would mint
    -- a uuid address the router no longer serves (Decision #88).
    SELECT trim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')), up.username
        INTO v_inviter_name, v_inviter_slug
    FROM org.users_public up WHERE up.user_id = v_actor;
    v_inviter_name := NULLIF(v_inviter_name, '');
    v_title := format('%s invited you to %s',
        COALESCE(v_inviter_name, 'A client'),
        COALESCE(v_stage_name, v_project.title));
    v_body := v_project.title
        || CASE WHEN v_stage_name IS NOT NULL THEN ' · ' || v_stage_name ELSE '' END
        || CASE WHEN v_message <> '' THEN ' — ' || left(v_message, 140) ELSE '' END;

    PERFORM comms.fn_notify(
        p_target_user_id,
        'stage.invite',
        v_title,
        v_body,
        'projects.project_invitations',
        v_id,
        jsonb_build_object(
            'project_slug', v_project.slug,
            'project_title', v_project.title,
            'stage_id', p_stage_id,
            'stage_name', v_stage_name,
            'offer_price_cents', v_price,
            'currency', v_project.currency,
            'placeholder', v_placeholder
        ),
        v_actor,
        'project',
        p_project_id,
        NULL,
        CASE WHEN v_inviter_slug IS NOT NULL THEN '/messages/dm-' || v_inviter_slug ELSE NULL END
    );

    RETURN v_id;
END;
$$;

COMMENT ON FUNCTION projects.invite_to_project(uuid, uuid, uuid, text, text, bigint, jsonb) IS
'Issues one identity-addressed project (or stage) invitation as the project''s staffing authority (can_manage_project_members; only review authority may offer admin or manager), derives `placeholder` from the project status and the resolved offer, enforces the 48-day re-invitation cooldown, and emits a `stage.invite` notification to the invitee through comms.fn_notify in the same transaction.';

REVOKE ALL ON FUNCTION projects.invite_to_project(uuid, uuid, uuid, text, text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects.invite_to_project(uuid, uuid, uuid, text, text, bigint, jsonb) TO authenticated;

-- projects.fn_apply_invitation_decision(invitation, accept, actor) -> jsonb
--
-- The ONE implementation of an invitation's answer, written to be called from two doors:
-- `respond_to_project_invitation` (the invitee, below) and — in DEVELOPMENT ONLY, through the
-- service-role client — the Dev Tools Invites window, which forces a decision so an invite flow can
-- be walked through every state without a second account. Neither door has a copy of the body, which
-- is how the forced path is guaranteed to write exactly the rows a real acceptance writes.
--
-- No client grant. `p_actor` is who the decision is recorded AS; the caller has already established
-- who may make it. A function that trusted a caller-supplied actor and was reachable from PostgREST
-- would be a forgery primitive, so it is reachable only by `service_role` and by the invitee's
-- wrapper.
CREATE OR REPLACE FUNCTION projects.fn_apply_invitation_decision(
    p_invitation_id uuid,
    p_accept        boolean,
    p_actor         uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org, auth
AS $$
DECLARE
    v_inv          projects.project_invitations%ROWTYPE;
    v_project      projects.projects%ROWTYPE;
    v_participant  uuid;
    v_assignment   uuid;
    v_seat_stage   uuid;
    v_stage_name   text;
    v_invitee_name text;
    v_type         text;
    v_title        text;
BEGIN
    SELECT * INTO v_inv FROM projects.project_invitations WHERE id = p_invitation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation % not found.', p_invitation_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_inv.status <> 'pending' THEN
        RAISE EXCEPTION 'This invitation has already been %.', v_inv.status USING ERRCODE = 'check_violation';
    END IF;
    IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at <= now() THEN
        -- The reader noticed what the sweep has not yet: record it, then refuse.
        UPDATE projects.project_invitations SET status = 'expired' WHERE id = p_invitation_id;
        RAISE EXCEPTION 'This invitation has expired.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_inv.target_user_id IS NULL THEN
        RAISE EXCEPTION 'An email-addressed invitation is accepted through its link.' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_project FROM projects.projects WHERE id = v_inv.project_id;
    IF v_inv.project_stage_id IS NOT NULL THEN
        SELECT s.name INTO v_stage_name FROM projects.project_stages s WHERE s.id = v_inv.project_stage_id;
    END IF;
    SELECT NULLIF(trim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')), '')
        INTO v_invitee_name
    FROM org.users_public up WHERE up.user_id = v_inv.target_user_id;

    IF NOT p_accept THEN
        UPDATE projects.project_invitations
        SET status = 'declined', declined_at = now()
        WHERE id = p_invitation_id;

        INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
        VALUES (v_inv.project_id, p_actor, 'invitation_declined',
                jsonb_build_object('invitation_id', p_invitation_id, 'stage_id', v_inv.project_stage_id),
                'projects.project_invitations', p_invitation_id);

        v_type := 'invitation.declined';
        v_title := format('%s declined your invitation to %s',
            COALESCE(v_invitee_name, 'The freelancer'), COALESCE(v_stage_name, v_project.title));
    ELSE
        UPDATE projects.project_invitations
        SET status = 'accepted', accepted_at = now()
        WHERE id = p_invitation_id;

        -- The seat. A freelancer joins the project's roster the way the staffing RPC enrols one —
        -- `role = 'assignee'`, the only vocabulary `project_participants.role` has ever been written
        -- in — and takes the stage the invitation named. Any other role joins the roster as itself and
        -- holds no delivery seat: a manager invited to a stage oversees it rather than contributing.
        SELECT pp.id INTO v_participant
        FROM projects.project_participants pp
        WHERE pp.project_id = v_inv.project_id AND pp.profile_type = 'freelancer' AND pp.profile_id = v_inv.target_user_id;
        IF v_participant IS NULL THEN
            INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
            VALUES (v_inv.project_id, 'freelancer', v_inv.target_user_id,
                    CASE WHEN v_inv.role = 'freelancer' THEN 'assignee' ELSE v_inv.role END)
            RETURNING id INTO v_participant;
        END IF;

        -- The seat is the stage the invitation named. A whole-project invitation names none: on a
        -- single-stage shape (a Task, a flat one-off) that stage is the only seat there is, so it is
        -- taken; on a multi-stage run the freelancer joins unassigned and is invited onto stages one
        -- at a time (Decision #139).
        v_seat_stage := v_inv.project_stage_id;
        IF v_seat_stage IS NULL AND v_inv.role = 'freelancer' THEN
            SELECT min(ps.id::text)::uuid INTO v_seat_stage
            FROM projects.project_stages ps
            WHERE ps.project_id = v_inv.project_id
            HAVING count(*) = 1;
        END IF;

        IF v_inv.role = 'freelancer' AND v_seat_stage IS NOT NULL THEN
            IF NOT EXISTS (SELECT 1 FROM org.freelancer_profiles fp WHERE fp.user_id = v_inv.target_user_id) THEN
                RAISE EXCEPTION 'This person does not have a freelancer profile yet.' USING ERRCODE = 'check_violation';
            END IF;
            SELECT sa.id INTO v_assignment
            FROM projects.stage_assignments sa
            WHERE sa.project_stage_id = v_seat_stage
                AND sa.assignee_type = 'freelancer'
                AND sa.freelancer_profile_id = v_inv.target_user_id
                AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed');
            IF v_assignment IS NULL THEN
                INSERT INTO projects.stage_assignments
                    (project_stage_id, assignee_type, freelancer_profile_id, team_id, assigned_by, is_client_managed, status)
                VALUES
                    (v_seat_stage, 'freelancer', v_inv.target_user_id, NULL, v_inv.inviter_user_id, false,
                     -- A draft's acceptance parks the seat until publish, which promotes it
                     -- (`set_project_status`); once live the terms are settled and the seat is taken.
                     CASE WHEN v_project.status = 'draft' THEN 'pending_funding' ELSE 'assigned' END)
                RETURNING id INTO v_assignment;
            END IF;

            -- An open stage moves to "assigned" the moment its first seat is filled (the staffing RPC's own rule).
            UPDATE projects.project_stages
            SET status = 'assigned'::stage_status
            WHERE id = v_seat_stage AND status = 'open'::stage_status
                AND v_project.status <> 'draft';
        END IF;

        INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
        VALUES (v_inv.project_id, p_actor, 'invitation_accepted',
                jsonb_build_object('invitation_id', p_invitation_id, 'stage_id', v_inv.project_stage_id,
                                   'participant_id', v_participant, 'assignment_id', v_assignment),
                'projects.project_invitations', p_invitation_id);

        v_type := 'invitation.accepted';
        v_title := format('%s accepted your invitation to %s',
            COALESCE(v_invitee_name, 'The freelancer'), COALESCE(v_stage_name, v_project.title));
    END IF;

    -- Tell the inviter, through the router, with the members page as the deep link (slug-addressed).
    PERFORM comms.fn_notify(
        v_inv.inviter_user_id,
        v_type,
        v_title,
        v_project.title || CASE WHEN v_stage_name IS NOT NULL THEN ' · ' || v_stage_name ELSE '' END,
        'projects.project_invitations',
        p_invitation_id,
        jsonb_build_object('project_slug', v_project.slug, 'project_title', v_project.title,
                           'stage_id', v_inv.project_stage_id, 'stage_name', v_stage_name,
                           'accepted', p_accept),
        p_actor,
        'project',
        v_inv.project_id,
        NULL,
        '/projects/' || v_project.slug || '/members'
    );

    RETURN jsonb_build_object(
        'id', p_invitation_id,
        'status', CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
        'participant_id', v_participant,
        'assignment_id', v_assignment
    );
END;
$$;

COMMENT ON FUNCTION projects.fn_apply_invitation_decision(uuid, boolean, uuid) IS
'The one implementation of an invitation''s answer: records accept/decline with its timestamp, enrols an accepted freelancer as a participant and stage assignee, and notifies the inviter through comms.fn_notify. No client grant — reached through respond_to_project_invitation (the invitee) or the service role (development-only forcing).';

REVOKE ALL ON FUNCTION projects.fn_apply_invitation_decision(uuid, boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects.fn_apply_invitation_decision(uuid, boolean, uuid) TO service_role;

-- projects.respond_to_project_invitation(invitation, accept) -> jsonb
-- The invitee's own door. The only caller check that matters: the row must be addressed to `auth.uid()`.
CREATE OR REPLACE FUNCTION projects.respond_to_project_invitation(p_invitation_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, comms, org, auth
AS $$
DECLARE
    v_actor  uuid := auth.uid();
    v_target uuid;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to answer an invitation.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT target_user_id INTO v_target FROM projects.project_invitations WHERE id = p_invitation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation % not found.', p_invitation_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_target IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'Only the person invited may answer this invitation.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN projects.fn_apply_invitation_decision(p_invitation_id, p_accept, v_actor);
END;
$$;

COMMENT ON FUNCTION projects.respond_to_project_invitation(uuid, boolean) IS
'Accept or decline an identity-addressed project invitation as its invitee. Delegates to fn_apply_invitation_decision.';

REVOKE ALL ON FUNCTION projects.respond_to_project_invitation(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects.respond_to_project_invitation(uuid, boolean) TO authenticated;

-- projects.remove_project_member(project, participant, stage) -> jsonb
--
-- The client removes an active freelancer from ONE stage (p_stage_id) or from the whole project
-- (NULL). The consequences are `PRODUCT_SPEC.md` §"Freelancer Removal Mid-Ticket", applied rather than
-- described: every ticket the person holds within the scope — claimed, in progress, or submitted and
-- awaiting review — has its escrow released to them in full and returns to New for someone else to
-- claim (`release_ticket_to_backlog`, whose body is exactly that rule); their held assignments within
-- the scope are `released`; a whole-project removal also deletes the participant row, which is the
-- only thing `has_project_access` reads and therefore the only way access is actually withdrawn.
-- Every accepted invitation the removal undoes is retired from the Invitations list (`dismissed_at`),
-- its acceptance kept as history.
--
-- Returns the counts the confirmation dialog warned about, as they were APPLIED — so a client who was
-- told "1 claimed ticket" can read back that one was released.
CREATE OR REPLACE FUNCTION projects.remove_project_member(
    p_project_id     uuid,
    p_participant_id uuid,
    p_stage_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, finance, comms, org, auth
AS $$
DECLARE
    v_actor     uuid := auth.uid();
    v_owner     uuid;
    v_user      uuid;
    v_type      profile_type;
    v_stages    uuid[];
    v_claimed   integer := 0;
    v_submitted integer := 0;
    v_started   integer := 0;
    v_ticket    record;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sign in to manage members.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT owner_user_id INTO v_owner FROM projects.projects WHERE id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_owner <> v_actor THEN
        RAISE EXCEPTION 'Only the project owner may remove members.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT pp.profile_id, pp.profile_type INTO v_user, v_type
    FROM projects.project_participants pp
    WHERE pp.id = p_participant_id AND pp.project_id = p_project_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That person is not on this project.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_type <> 'freelancer' THEN
        -- A business participant is the paying side of the engagement, not a hire.
        RAISE EXCEPTION 'Only a hired person can be removed here.' USING ERRCODE = 'check_violation';
    END IF;

    IF p_stage_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM projects.project_stages s WHERE s.id = p_stage_id AND s.project_id = p_project_id) THEN
            RAISE EXCEPTION 'That stage is not part of this project.' USING ERRCODE = 'check_violation';
        END IF;
        v_stages := ARRAY[p_stage_id];
    ELSE
        SELECT COALESCE(array_agg(s.id), '{}'::uuid[]) INTO v_stages
        FROM projects.project_stages s WHERE s.project_id = p_project_id;
    END IF;

    -- Stages under way that they were contributing to — a seat opening mid-stage, counted before the
    -- assignments below are released.
    SELECT count(*) INTO v_started
    FROM projects.stage_assignments sa
    JOIN projects.project_stages s ON s.id = sa.project_stage_id
    WHERE sa.project_stage_id = ANY (v_stages)
        AND sa.assignee_type = 'freelancer'
        AND sa.freelancer_profile_id = v_user
        AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed')
        AND s.status IN ('in_progress', 'submitted', 'revisions');

    -- Held tickets within the scope: escrow to them in full, ticket back to New.
    FOR v_ticket IN
        SELECT t.id, t.status
        FROM projects.tickets t
        WHERE t.project_id = p_project_id
            AND t.current_assignee_id = v_user
            AND t.status IN ('claimed', 'in_progress', 'in_review')
            AND (p_stage_id IS NULL OR t.current_stage_id = p_stage_id)
    LOOP
        IF v_ticket.status = 'in_review' THEN
            v_submitted := v_submitted + 1;
        ELSE
            v_claimed := v_claimed + 1;
        END IF;
        PERFORM projects.release_ticket_to_backlog(v_ticket.id);
    END LOOP;

    UPDATE projects.stage_assignments sa
    SET status = 'released'
    WHERE sa.project_stage_id = ANY (v_stages)
        AND sa.assignee_type = 'freelancer'
        AND sa.freelancer_profile_id = v_user
        AND sa.status NOT IN ('released', 'cancelled', 'declined', 'completed');

    -- The accepted invitations this undoes leave the list; their acceptance stays as history.
    UPDATE projects.project_invitations i
    SET dismissed_at = now()
    WHERE i.project_id = p_project_id
        AND i.target_user_id = v_user
        AND i.status = 'accepted'
        AND i.dismissed_at IS NULL
        AND (p_stage_id IS NULL OR i.project_stage_id = p_stage_id);

    IF p_stage_id IS NULL THEN
        DELETE FROM projects.project_participants WHERE id = p_participant_id;
    END IF;

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        p_project_id, v_actor,
        CASE WHEN p_stage_id IS NULL THEN 'member_removed' ELSE 'member_unassigned' END,
        jsonb_build_object('participant_id', p_participant_id, 'user_id', v_user, 'stage_id', p_stage_id,
                           'claimed_tickets', v_claimed, 'submitted_tickets', v_submitted, 'started_stages', v_started),
        'projects.project_participants', p_participant_id
    );

    RETURN jsonb_build_object(
        'participant_id', p_participant_id,
        'removed_from', CASE WHEN p_stage_id IS NULL THEN 'project' ELSE 'stage' END,
        'claimed_tickets', v_claimed,
        'submitted_tickets', v_submitted,
        'started_stages', v_started
    );
END;
$$;

COMMENT ON FUNCTION projects.remove_project_member(uuid, uuid, uuid) IS
'Removes a hired freelancer from one stage or the whole project as its owner: releases the escrow of every ticket they hold in scope to them and returns those tickets to New (PRODUCT_SPEC §Freelancer Removal Mid-Ticket), releases their assignments, retires the accepted invitations it undoes, and deletes the participant row on a whole-project removal. Returns the applied counts.';

REVOKE ALL ON FUNCTION projects.remove_project_member(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects.remove_project_member(uuid, uuid, uuid) TO authenticated;

-- #endregion

-- #region 11. Engagement context — what two people are negotiating, for the conversation drawer
--
-- The drawer beside a DM shows the invitations and applications BETWEEN the caller and one other
-- person, with the brief, the questions answered and the stages being offered. A pending invitee
-- cannot read a private project under RLS (they are not on it yet), and deciding on an offer means
-- reading what it is for, so this is a DEFINER read whose whole scope is the pair: every row it
-- returns names the caller as inviter, invitee, applicant or the applied-to project's owner.
--
-- The counterpart's earned Standing rung rides along when they sell (buyers are not gamified —
-- PRODUCT_SPEC §Buyers are not gamified), read the way org.get_profile_view reads it.
CREATE OR REPLACE FUNCTION projects.get_engagement_context(p_counterpart uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_me       uuid := auth.uid();
    v_projects uuid[];
BEGIN
    IF v_me IS NULL THEN
        RAISE EXCEPTION 'Sign in to read a conversation.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_counterpart IS NULL OR p_counterpart = v_me THEN
        RETURN jsonb_build_object('standing', NULL, 'invitations', '[]'::jsonb,
                                  'applications', '[]'::jsonb, 'milestones', '[]'::jsonb);
    END IF;

    SELECT array_agg(DISTINCT x.project_id) INTO v_projects
    FROM (
        SELECT i.project_id
          FROM projects.project_invitations i
         WHERE i.status <> 'revoked'
           AND ((i.inviter_user_id = v_me AND i.target_user_id = p_counterpart)
             OR (i.inviter_user_id = p_counterpart AND i.target_user_id = v_me))
        UNION
        SELECT a.project_id
          FROM projects.project_applications a
          JOIN projects.projects p ON p.id = a.project_id
         WHERE a.status <> 'withdrawn'
           AND ((a.applicant_user_id = v_me AND p.owner_user_id = p_counterpart)
             OR (a.applicant_user_id = p_counterpart AND p.owner_user_id = v_me))
    ) x;

    RETURN jsonb_build_object(
        'standing', (
            SELECT jsonb_build_object('level', sl.level, 'label', sl.label)
              FROM org.freelancer_profiles fp
              JOIN org.standing_levels sl ON sl.level = org.fn_standing_level('freelancer', fp.user_id)
             WHERE fp.user_id = p_counterpart
        ),
        'invitations', COALESCE((
            SELECT jsonb_agg(q.row ORDER BY q.created_at DESC)
              FROM (
                SELECT i.created_at, jsonb_build_object(
                    'id', i.id,
                    'direction', CASE WHEN i.inviter_user_id = v_me THEN 'sent' ELSE 'received' END,
                    'status', i.status,
                    'projectId', p.id,
                    'projectSlug', p.slug,
                    'projectTitle', p.title,
                    'projectStatus', p.status,
                    'projectVisibility', p.visibility,
                    'format', p.format,
                    'currency', p.currency,
                    'summary', left(p.description_text, 600),
                    'stageId', s.id,
                    'stageSlug', s.slug,
                    'stageName', s.name,
                    'stageStatus', s.status,
                    'offerPriceCents', COALESCE(
                        i.offer_price_cents,
                        CASE WHEN i.project_stage_id IS NULL THEN p.budget_amount_cents ELSE s.unit_price_cents END
                    ),
                    'placeholder', i.placeholder,
                    'message', i.message,
                    'answers', i.answers,
                    'intake', COALESCE((
                        SELECT fp.hire_intake FROM org.freelancer_profiles fp WHERE fp.user_id = i.target_user_id
                    ), '[]'::jsonb),
                    'createdAt', i.created_at,
                    'expiresAt', i.expires_at,
                    'acceptedAt', i.accepted_at,
                    'declinedAt', i.declined_at,
                    'assignmentStatus', (
                        SELECT sa.status FROM projects.stage_assignments sa
                         WHERE sa.project_stage_id = i.project_stage_id
                           AND sa.assignee_type = 'freelancer'
                           AND sa.freelancer_profile_id = i.target_user_id
                         ORDER BY sa.created_at DESC
                         LIMIT 1
                    )
                ) AS row
                  FROM projects.project_invitations i
                  JOIN projects.projects p ON p.id = i.project_id
                  LEFT JOIN projects.project_stages s ON s.id = i.project_stage_id
                 WHERE i.status <> 'revoked'
                   AND ((i.inviter_user_id = v_me AND i.target_user_id = p_counterpart)
                     OR (i.inviter_user_id = p_counterpart AND i.target_user_id = v_me))
                 ORDER BY i.created_at DESC
                 LIMIT 10
              ) q
        ), '[]'::jsonb),
        'applications', COALESCE((
            SELECT jsonb_agg(q.row ORDER BY q.created_at DESC)
              FROM (
                SELECT a.created_at, jsonb_build_object(
                    'id', a.id,
                    'direction', CASE WHEN a.applicant_user_id = v_me THEN 'sent' ELSE 'received' END,
                    'status', a.status,
                    'projectId', p.id,
                    'projectSlug', p.slug,
                    'projectTitle', p.title,
                    'projectStatus', p.status,
                    'projectVisibility', p.visibility,
                    'format', p.format,
                    'currency', p.currency,
                    'summary', left(p.description_text, 600),
                    'stageId', s.id,
                    'stageSlug', s.slug,
                    'stageName', s.name,
                    'stageStatus', s.status,
                    'roleTitle', r.role_title,
                    'priceCents', COALESCE(r.budget_amount_cents, s.unit_price_cents),
                    'message', a.message,
                    'createdAt', a.created_at,
                    'assignmentStatus', (
                        SELECT sa.status FROM projects.stage_assignments sa
                         WHERE sa.project_stage_id = s.id
                           AND sa.assignee_type = 'freelancer'
                           AND sa.freelancer_profile_id = a.applicant_user_id
                         ORDER BY sa.created_at DESC
                         LIMIT 1
                    )
                ) AS row
                  FROM projects.project_applications a
                  JOIN projects.projects p ON p.id = a.project_id
                  JOIN LATERAL (
                      SELECT pat.target_type, pat.target_id
                        FROM projects.project_application_targets pat
                       WHERE pat.application_id = a.id
                       ORDER BY CASE pat.target_type WHEN 'seat' THEN 0 WHEN 'role' THEN 1 ELSE 2 END
                       LIMIT 1
                  ) t ON true
                  LEFT JOIN projects.stage_staffing_roles r
                         ON t.target_type = 'role' AND r.id = t.target_id
                  LEFT JOIN projects.stage_open_seats so
                         ON t.target_type = 'seat' AND so.id = t.target_id
                  LEFT JOIN projects.project_stages s
                         ON s.id = CASE t.target_type
                                       WHEN 'stage' THEN t.target_id
                                       WHEN 'role' THEN r.project_stage_id
                                       ELSE so.project_stage_id
                                   END
                 WHERE a.status <> 'withdrawn'
                   AND ((a.applicant_user_id = v_me AND p.owner_user_id = p_counterpart)
                     OR (a.applicant_user_id = p_counterpart AND p.owner_user_id = v_me))
                 ORDER BY a.created_at DESC
                 LIMIT 10
              ) q
        ), '[]'::jsonb),
        'milestones', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'projectId', s.project_id,
                'stageId', s.id,
                'name', s.name,
                'milestone', s.milestone,
                'status', s.status,
                'priceCents', s.unit_price_cents,
                'sortOrder', s.sort_order
            ) ORDER BY s.project_id, s.sort_order)
              FROM projects.project_stages s
             WHERE s.project_id = ANY (COALESCE(v_projects, '{}'::uuid[]))
        ), '[]'::jsonb)
    );
END;
$$;

COMMENT ON FUNCTION projects.get_engagement_context(uuid) IS
'The invitations and applications between the caller and one counterpart (either direction), with the brief, the intake answers, the stages on offer and the counterpart''s seller Standing — the conversation context drawer''s read. Scoped to the pair; DEFINER because a pending invitee cannot read a private project under RLS.';

REVOKE ALL ON FUNCTION projects.get_engagement_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION projects.get_engagement_context(uuid) TO authenticated;

-- #endregion
