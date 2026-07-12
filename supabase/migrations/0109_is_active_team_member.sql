CREATE OR REPLACE FUNCTION org.is_active_team_member(_team_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = org, public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM org.team_members 
    WHERE team_id = _team_id 
    AND user_id = auth.uid() 
    AND status = 'active'
  );
$$;