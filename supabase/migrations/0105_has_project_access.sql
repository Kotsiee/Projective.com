CREATE OR REPLACE FUNCTION projects.has_project_access(_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, projects, org, auth
AS $$
BEGIN
  
  IF EXISTS (
    SELECT 1 FROM projects.projects
    WHERE id = _project_id AND owner_user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  
  IF EXISTS (
    SELECT 1 
    FROM projects.project_participants pp
    JOIN org.freelancer_profiles fp ON pp.profile_id = fp.user_id
    WHERE pp.project_id = _project_id
      AND pp.profile_type = 'freelancer'
      AND fp.user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  
  IF EXISTS (
    SELECT 1 
    FROM projects.project_participants pp
    JOIN org.business_profiles bp ON pp.profile_id = bp.id
    WHERE pp.project_id = _project_id
      AND pp.profile_type = 'business'
      AND bp.owner_user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  
  
  IF EXISTS (
    SELECT 1 
    FROM projects.stage_assignments sa
    JOIN projects.project_stages ps ON sa.project_stage_id = ps.id
    JOIN org.freelancer_profiles fp ON sa.freelancer_profile_id = fp.user_id
    WHERE ps.project_id = _project_id
      AND sa.assignee_type = 'freelancer'
      AND fp.user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  
  IF EXISTS (
    SELECT 1 
    FROM projects.stage_assignments sa
    JOIN projects.project_stages ps ON sa.project_stage_id = ps.id
    JOIN org.team_members tm ON sa.team_id = tm.team_id
    WHERE ps.project_id = _project_id
      AND sa.assignee_type = 'team'
      AND tm.user_id = auth.uid()
      AND tm.status = 'active'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;