-- =============================================================================================
-- 0118_project_roster.sql
-- Roster read-model for the ticket "Reassign" picker (spec §3b). Returns the freelancers eligible
-- to take a ticket on a project: everyone enrolled as a project participant plus anyone currently
-- holding a stage assignment, de-duplicated and joined to their public display name/avatar.
--
-- Consistent with the other modal read-models (get_ticket_finance / get_ticket_timeline): a
-- SECURITY DEFINER wrapper guarded by projects.has_project_access, relying on the default
-- EXECUTE-to-PUBLIC grant rather than an explicit function grant.
-- =============================================================================================

CREATE OR REPLACE FUNCTION projects.get_project_roster(p_project_id uuid)
RETURNS TABLE (
    profile_id uuid,
    name       text,
    avatar     jsonb,
    role       text
) AS $$
BEGIN
    IF NOT projects.has_project_access(p_project_id) THEN
        RAISE EXCEPTION 'You do not have access to this project.' USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN QUERY
    WITH candidates AS (
        -- Freelancers formally enrolled on the project.
        SELECT pp.profile_id AS pid, pp.role AS role
        FROM projects.project_participants pp
        WHERE pp.project_id = p_project_id
          AND pp.profile_type = 'freelancer'
        UNION
        -- Freelancers holding a live stage assignment (covers assignees added via staffing without
        -- a participant row yet).
        SELECT sa.freelancer_profile_id AS pid, 'assignee'::text AS role
        FROM projects.stage_assignments sa
        JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
        WHERE ps.project_id = p_project_id
          AND sa.assignee_type = 'freelancer'
          AND sa.freelancer_profile_id IS NOT NULL
    ),
    deduped AS (
        SELECT DISTINCT ON (c.pid) c.pid, c.role
        FROM candidates c
        ORDER BY c.pid
    )
    SELECT
        d.pid AS profile_id,
        COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), up.username) AS name,
        (SELECT fi.metadata -> 'variants' FROM files.items fi WHERE fi.id = up.avatar_file_id) AS avatar,
        d.role
    FROM deduped d
    JOIN org.users_public up ON up.user_id = d.pid
    ORDER BY name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, projects, org, files, auth;
