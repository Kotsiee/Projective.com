-- =============================================================================================
-- 0119_project_lifecycle.sql
-- Project Lifecycle state machine (spec §1 / §3 "Project Mutations Handler").
--
-- Adds:
--   1. projects.project_status_history — append-only ledger of every lifecycle transition
--      (old_status -> new_status, actor, reason, timestamp). Powers closure/audit + telemetry.
--   2. projects.can_review_project(uuid) — RBAC helper: TRUE for the project owner or an active
--      member/owner of the paying client business. Reused by the Kanban "Done" guard (0121) and
--      the Submissions review guard (0120).
--   3. projects.set_project_status(...) — the guarded state-machine RPC. Enforces rigid activation
--      and completion pre-conditions before a project may move to `active` / `completed`, and
--      records the transition to the history ledger + project_activity feed.
--
-- Consistent with the sibling lifecycle RPCs (0115/0117): SECURITY DEFINER wrappers in the exposed
-- `projects` schema, guarded internally (owner / has_project_access) and relying on Postgres'
-- default EXECUTE-to-PUBLIC grant rather than a schema-wide function grant.
-- =============================================================================================

-- #region 1. Transition history ledger
CREATE TABLE IF NOT EXISTS projects.project_status_history (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    actor_user_id uuid NOT NULL REFERENCES org.users_public(user_id),
    from_status   project_status,
    to_status     project_status NOT NULL,
    reason        text,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_status_history_project
    ON projects.project_status_history (project_id, created_at DESC);

-- New table -> own RLS (no later migration re-defines it, so it is safe to declare inline here).
ALTER TABLE projects.project_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View project status history" ON projects.project_status_history;
CREATE POLICY "View project status history" ON projects.project_status_history FOR
SELECT TO public USING (
    actor_user_id = auth.uid()
    OR projects.has_project_access (project_id)
    OR EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = project_status_history.project_id
            AND (p.owner_user_id = auth.uid()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id)))
    )
);
-- Writes only happen inside the SECURITY DEFINER RPC below (which bypasses RLS); no INSERT policy
-- is granted, so direct client inserts are denied.
-- #endregion

-- #region 2. Review-authority RBAC helper
-- TRUE when the caller is the project owner or belongs to the paying client business. This is the
-- "client viewer" authority the spec requires for approving deliverables and confirming milestones.
CREATE OR REPLACE FUNCTION projects.can_review_project(_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
    SELECT EXISTS (
        SELECT 1 FROM projects.projects p
        WHERE p.id = _project_id
            AND (
                p.owner_user_id = auth.uid()
                OR (p.client_business_id IS NOT NULL AND org.is_active_business_member (p.client_business_id))
            )
    );
$$;
-- #endregion

-- #region 3. Guarded lifecycle state machine
-- projects.set_project_status(p_project_id, p_to_status, p_reason)
-- Rigid assertions (spec §3 "changing states to Active or Completed requires valid validation
-- conditions"):
--   • draft|on_hold -> active     : project must have a title and >= 1 stage defined.
--   • active|on_hold -> completed : every ticket must be terminal (completed/cancelled) AND no
--                                   escrow may still be held (funds must be settled first).
--   • active -> on_hold           : always allowed by the owner.
--   • draft|active|on_hold -> cancelled : always allowed by the owner.
--   • terminal states (completed/cancelled) are immutable.
-- Returns the new status. RAISE LOG lines carry the telemetry mandate's structured tags.
CREATE OR REPLACE FUNCTION projects.set_project_status(
    p_project_id uuid,
    p_to_status  project_status,
    p_reason     text DEFAULT NULL
)
RETURNS project_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, finance, org, auth
AS $$
DECLARE
    v_actor       uuid := auth.uid();
    v_from        project_status;
    v_owner       uuid;
    v_title       text;
    v_stage_count integer;
    v_open_ticket integer;
    v_held_escrow integer;
    v_started_at  timestamptz := clock_timestamp();
BEGIN
    RAISE LOG '[PROJECT_LIFECYCLE_RPC] set_project_status begin ts=% actor=% project=% target=%',
        v_started_at, v_actor, p_project_id, p_to_status;

    SELECT status, owner_user_id, title
        INTO v_from, v_owner, v_title
    FROM projects.projects
    WHERE id = p_project_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project % not found.', p_project_id USING ERRCODE = 'no_data_found';
    END IF;

    -- Only the project owner may drive lifecycle transitions.
    IF v_owner IS DISTINCT FROM v_actor THEN
        RAISE WARNING '[PROJECT_LIFECYCLE_RPC] denied actor=% is not owner=% project=%',
            v_actor, v_owner, p_project_id;
        RAISE EXCEPTION 'Only the project owner may change the project status.'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- No-op guard.
    IF v_from = p_to_status THEN
        RAISE LOG '[PROJECT_LIFECYCLE_RPC] no-op project=% already=%', p_project_id, p_to_status;
        RETURN v_from;
    END IF;

    -- Terminal states are immutable.
    IF v_from IN ('completed'::project_status, 'cancelled'::project_status) THEN
        RAISE EXCEPTION 'Project is % and can no longer change state.', v_from
            USING ERRCODE = 'check_violation';
    END IF;

    -- ----- Transition-specific validation -----
    IF p_to_status = 'active'::project_status THEN
        IF v_from NOT IN ('draft'::project_status, 'on_hold'::project_status) THEN
            RAISE EXCEPTION 'A project can only be activated from draft or on_hold (was %).', v_from
                USING ERRCODE = 'check_violation';
        END IF;
        IF v_title IS NULL OR btrim(v_title) = '' THEN
            RAISE EXCEPTION 'A project must have a title before it can be activated.'
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_stage_count FROM projects.project_stages WHERE project_id = p_project_id;
        IF v_stage_count < 1 THEN
            RAISE EXCEPTION 'A project needs at least one stage before it can be activated.'
                USING ERRCODE = 'check_violation';
        END IF;

    ELSIF p_to_status = 'completed'::project_status THEN
        IF v_from NOT IN ('active'::project_status, 'on_hold'::project_status) THEN
            RAISE EXCEPTION 'A project can only be completed from active or on_hold (was %).', v_from
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_open_ticket
        FROM projects.tickets
        WHERE project_id = p_project_id
            AND status NOT IN ('completed'::ticket_status, 'cancelled'::ticket_status);
        IF v_open_ticket > 0 THEN
            RAISE EXCEPTION 'Cannot complete: % ticket(s) are still open. Resolve them first.', v_open_ticket
                USING ERRCODE = 'check_violation';
        END IF;
        SELECT count(*) INTO v_held_escrow
        FROM finance.escrows e
        JOIN projects.project_stages ps ON ps.id = e.project_stage_id
        WHERE ps.project_id = p_project_id AND e.status = 'held';
        IF v_held_escrow > 0 THEN
            RAISE EXCEPTION 'Cannot complete: % escrow hold(s) are unsettled. Release or refund them first.', v_held_escrow
                USING ERRCODE = 'check_violation';
        END IF;

    ELSIF p_to_status = 'on_hold'::project_status THEN
        IF v_from <> 'active'::project_status THEN
            RAISE EXCEPTION 'Only an active project can be put on hold (was %).', v_from
                USING ERRCODE = 'check_violation';
        END IF;

    ELSIF p_to_status = 'cancelled'::project_status THEN
        -- Allowed from any non-terminal state (already guarded above).
        NULL;

    ELSE
        RAISE EXCEPTION 'Unsupported target status %.', p_to_status USING ERRCODE = 'check_violation';
    END IF;

    -- ----- Apply -----
    UPDATE projects.projects
    SET status = p_to_status, updated_at = now()
    WHERE id = p_project_id;

    INSERT INTO projects.project_status_history (project_id, actor_user_id, from_status, to_status, reason)
    VALUES (p_project_id, v_actor, v_from, p_to_status, p_reason);

    INSERT INTO projects.project_activity (project_id, actor_user_id, kind, payload, entity_table, entity_id)
    VALUES (
        p_project_id, v_actor, 'project_status_changed',
        jsonb_build_object('from', v_from, 'to', p_to_status, 'reason', p_reason),
        'projects.projects', p_project_id
    );

    RAISE LOG '[PROJECT_LIFECYCLE_RPC] set_project_status ok project=% % -> % duration_ms=%',
        p_project_id, v_from, p_to_status,
        round(extract(epoch FROM (clock_timestamp() - v_started_at)) * 1000, 2);

    RETURN p_to_status;
END;
$$;
-- #endregion
