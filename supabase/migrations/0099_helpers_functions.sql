CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION security.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ops.admin_users au
    WHERE au.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION security.current_context()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'active_profile_type', auth.jwt()->>'active_profile_type',
    'active_profile_id',   auth.jwt()->>'active_profile_id',
    'active_team_id',      auth.jwt()->>'active_team_id'
  );
$$;