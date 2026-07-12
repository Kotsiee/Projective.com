-- #region get_project_details: surface deadline-bonus flag + stage installment costs
-- Extends projects.get_project_details so the project details payload carries:
--   • allow_deadline_bonuses — gates the ticket Due Date inline field (spec §2). The DB already
--     enforces this (projects.fn_enforce_ticket_due_date); the client needs the flag to hide the
--     field entirely when the engagement has not agreed to deadline-bonus terms.
--   • per-stage unit_price_cents + sort_order — the installment currency cost and ordering the
--     ticket Stage Breakdown renders per node (spec §3).
--
-- Adding output columns changes the RETURNS TABLE signature, so the function must be dropped and
-- recreated rather than CREATE OR REPLACE'd. Body is otherwise identical to 0102.
DROP FUNCTION IF EXISTS projects.get_project_details(uuid);

CREATE FUNCTION projects.get_project_details(
  p_project_id uuid
)
RETURNS TABLE (
  project_id uuid,
  title text,
  format text,
  status text,
  is_starred boolean,
  allow_deadline_bonuses boolean,
  target_project_start_date timestamptz,
  timeline_preset text,
  owner jsonb,
  viewer_context jsonb,
  stages jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_is_owner boolean;
BEGIN
  SELECT
    CASE
      WHEN p.owner_user_id = v_user_id OR EXISTS (SELECT 1 FROM org.business_profiles bp WHERE bp.id = p.client_business_id AND bp.owner_user_id = v_user_id) THEN 'owner'
      WHEN EXISTS (SELECT 1 FROM projects.project_participants pp WHERE pp.project_id = p.id AND ((pp.profile_type = 'freelancer' AND pp.profile_id = v_user_id) OR (pp.profile_type = 'business' AND pp.profile_id IN (SELECT bp.id FROM org.business_profiles bp WHERE bp.owner_user_id = v_user_id)))) THEN 'collaborator'
      WHEN EXISTS (SELECT 1 FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id WHERE ps.project_id = p.id AND ((sa.assignee_type = 'freelancer' AND sa.freelancer_profile_id = v_user_id) OR (sa.assignee_type = 'team' AND sa.team_id IN (SELECT tm.team_id FROM org.team_members tm WHERE tm.user_id = v_user_id AND tm.status = 'active')))) THEN 'collaborator'
      ELSE NULL
    END
  INTO v_user_role
  FROM projects.projects p
  WHERE p.id = p_project_id;

  IF v_user_role IS NULL THEN RAISE EXCEPTION 'Access Denied'; END IF;
  v_is_owner := (v_user_role = 'owner');

  RETURN QUERY
  SELECT
    p.id, p.title, p.format::text, p.status::text,
    COALESCE(pref.is_starred, false), p.allow_deadline_bonuses,
    p.target_project_start_date, p.timeline_preset::text,
    jsonb_build_object(
      'id', COALESCE(bp.id, p.owner_user_id),
      'name', CASE WHEN bp.id IS NOT NULL THEN bp.name ELSE COALESCE(NULLIF(TRIM(CONCAT_WS(' ', up.first_name, up.last_name)), ''), up.username) END,
      'avatar', CASE WHEN bp.id IS NOT NULL THEN (SELECT metadata->'variants' FROM files.items WHERE id = bp.logo_file_id) ELSE (SELECT metadata->'variants' FROM files.items WHERE id = up.avatar_file_id) END,
      'banner', CASE WHEN bp.id IS NOT NULL THEN (SELECT metadata->'variants' FROM files.items WHERE id = bp.banner_file_id) ELSE (SELECT metadata->'variants' FROM files.items WHERE id = up.banner_file_id) END,
      'type', CASE WHEN bp.id IS NOT NULL THEN 'business' ELSE 'freelancer' END
    ) as owner,
    jsonb_build_object('role', v_user_role, 'permissions', (SELECT jsonb_agg(perm) FROM (SELECT 'manage_settings' WHERE v_is_owner UNION ALL SELECT 'manage_members' WHERE v_is_owner UNION ALL SELECT 'view_financials' WHERE v_is_owner) as pr(perm))) as viewer_context,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'name', ps.name, 'status', ps.status, 'sort_order', ps.sort_order, 'unit_price_cents', ps.unit_price_cents, 'file_upload_required', ps.file_upload_required, 'default_tasks', ps.default_tasks, 'skills', ps.skills, 'start_trigger_type', ps.start_trigger_type, 'fixed_start_date', ps.fixed_start_date, 'start_dependency_stage_id', ps.start_dependency_stage_id, 'start_dependency_lag_days', ps.start_dependency_lag_days, 'file_duration_mode', ps.file_duration_mode, 'file_duration_days', ps.file_duration_days, 'file_due_date', ps.file_due_date, 'session_count', ps.session_count, 'session_preferred_days', ps.session_preferred_days, 'session_end_date', ps.session_end_date, 'hire_trigger_active', ps.hire_trigger_active) ORDER BY ps.sort_order ASC) FROM projects.project_stages ps WHERE ps.project_id = p.id), '[]'::jsonb) as stages
  FROM projects.projects p
  LEFT JOIN projects.user_preferences pref ON pref.project_id = p.id AND pref.user_id = v_user_id
  LEFT JOIN org.business_profiles bp ON bp.id = p.client_business_id
  LEFT JOIN org.users_public up ON up.user_id = p.owner_user_id
  WHERE p.id = p_project_id;
END;
$$;
-- #endregion
