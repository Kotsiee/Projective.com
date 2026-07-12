CREATE OR REPLACE FUNCTION security.switch_session_context(
  p_type public.profile_type,
  p_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, security, org
AS $$
BEGIN
  
  IF p_type = 'freelancer' THEN
    IF NOT EXISTS (
      SELECT 1 FROM org.freelancer_profiles 
      WHERE user_id = auth.uid() AND user_id = p_id 
    ) THEN
      RAISE EXCEPTION 'Access Denied: You do not have a freelancer profile.';
    END IF;
  
  ELSIF p_type = 'business' THEN
    
    IF NOT EXISTS (
      SELECT 1 FROM org.business_members 
      WHERE business_id = p_id 
      AND user_id = auth.uid() 
      AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Access Denied: You are not an active member of this business.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid profile type';
  END IF;

  
  UPDATE security.session_context
  SET 
    active_profile_type = p_type,
    active_profile_id = p_id,
    active_team_id = NULL,
    updated_at = NOW()
  WHERE user_id = auth.uid();

  
  INSERT INTO security.audit_logs (
    user_id, action, entity_table, entity_id, actor_profile_id
  ) VALUES (
    auth.uid(), 'session.switch_context', 'security.session_context', auth.uid(), p_id
  );
END;
$$;