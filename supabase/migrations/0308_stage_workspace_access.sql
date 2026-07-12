-- =============================================================================================
-- 0308_stage_workspace_access.sql
-- US-006 AC1 · Workspace access control. The stage room/chat was previously gated only at the
-- *project* level (has_project_access) — any project participant could read a stage's chat. This
-- tightens the stage room to the talent actually assigned to that stage plus the client/owner side.
--
--   1. projects.has_stage_access(uuid) — owner/client-business OR active assignee (freelancer or team
--      member) of THAT stage.
--   2. comms.get_or_create_project_channel — guarded so only stage-accessors may open the stage room.
--   3. comms RLS — stage channels (stage_id NOT NULL) resolve access via has_stage_access; whole-
--      project channels (stage_id NULL) keep has_project_access. Applies to channels + messages.
--
-- Runs after 0202 (comms RLS) so these DROP/CREATE policy statements win.
-- =============================================================================================

-- #region 1. has_stage_access — stage-scoped membership
CREATE OR REPLACE FUNCTION projects.has_stage_access(p_stage_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
    v_project uuid;
BEGIN
    SELECT ps.project_id INTO v_project FROM projects.project_stages ps WHERE ps.id = p_stage_id;
    IF v_project IS NULL THEN
        RETURN false;
    END IF;

    -- The paying side (owner / client-business member) reaches every stage room.
    IF projects.can_review_project(v_project) THEN
        RETURN true;
    END IF;

    -- A freelancer holding a live assignment on this stage.
    IF EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
        WHERE sa.project_stage_id = p_stage_id
            AND sa.assignee_type = 'freelancer'
            AND sa.freelancer_profile_id = auth.uid()
            AND sa.status NOT IN ('released', 'cancelled', 'declined')
    ) THEN
        RETURN true;
    END IF;

    -- An active member of a team holding a live assignment on this stage.
    IF EXISTS (
        SELECT 1 FROM projects.stage_assignments sa
        JOIN org.team_members tm ON tm.team_id = sa.team_id
        WHERE sa.project_stage_id = p_stage_id
            AND sa.assignee_type = 'team'
            AND tm.user_id = auth.uid()
            AND tm.status = 'active'
            AND sa.status NOT IN ('released', 'cancelled', 'declined')
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;
-- #endregion

-- #region 2. Guard the stage-room channel opener
CREATE OR REPLACE FUNCTION comms.get_or_create_project_channel(
    p_project_id uuid,
    p_stage_id uuid,
    p_name text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, comms, projects, org, auth
AS $$
DECLARE
    v_channel_id uuid;
BEGIN
    -- Stage rooms are restricted to the assigned talent + the client/owner; whole-project channels
    -- keep the broader project-access gate.
    IF p_stage_id IS NOT NULL THEN
        IF NOT projects.has_stage_access(p_stage_id) THEN
            RAISE EXCEPTION 'You do not have access to this stage workspace.' USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSIF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT id INTO v_channel_id
    FROM comms.project_channels
    WHERE project_id = p_project_id AND stage_id = p_stage_id
    LIMIT 1;

    IF v_channel_id IS NOT NULL THEN
        RETURN v_channel_id;
    END IF;

    INSERT INTO comms.project_channels (project_id, stage_id, name)
    VALUES (p_project_id, p_stage_id, p_name)
    RETURNING id INTO v_channel_id;

    RETURN v_channel_id;
END;
$$;
-- #endregion

-- #region 3. Stage-aware comms RLS (supersedes the project-level policies in 0202)
DROP POLICY IF EXISTS "view_channels_if_member" ON comms.project_channels;
CREATE POLICY "view_channels_if_member" ON comms.project_channels FOR SELECT TO authenticated USING (
    CASE
        WHEN stage_id IS NOT NULL THEN projects.has_stage_access (stage_id)
        ELSE projects.has_project_access (project_id)
    END
);

DROP POLICY IF EXISTS "send_messages_if_member" ON comms.project_messages;
CREATE POLICY "send_messages_if_member" ON comms.project_messages FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
        SELECT 1 FROM comms.project_channels pc
        WHERE pc.id = project_messages.channel_id
            AND CASE
                WHEN pc.stage_id IS NOT NULL THEN projects.has_stage_access (pc.stage_id)
                ELSE projects.has_project_access (pc.project_id)
            END
    )
);

DROP POLICY IF EXISTS "view_messages_if_member" ON comms.project_messages;
CREATE POLICY "view_messages_if_member" ON comms.project_messages FOR SELECT TO authenticated USING (
    EXISTS (
        SELECT 1 FROM comms.project_channels pc
        WHERE pc.id = project_messages.channel_id
            AND CASE
                WHEN pc.stage_id IS NOT NULL THEN projects.has_stage_access (pc.stage_id)
                ELSE projects.has_project_access (pc.project_id)
            END
    )
);
-- #endregion
