CREATE OR REPLACE FUNCTION org.get_dashboard_teams(
  p_search_query text,
  p_role_filter text, 
  p_sort_by text,
  p_sort_dir text,
  p_limit int,
  p_offset int
)
RETURNS TABLE (
  team_id uuid,
  name text,
  slug text,
  avatar_url text,
  banner_url text,
  description text,
  user_role text,
  member_count bigint,
  payout_model text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
) 
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH user_teams AS (
    SELECT
      t.id,
      t.name,
      t.slug,
      t.avatar_file_id,
      t.banner_file_id,
      t.description,
      t.payout_model,
      t.created_at,
      t.updated_at,
      tm.role as user_role,
      
      (SELECT COUNT(*) FROM org.team_members m WHERE m.team_id = t.id AND m.status = 'active') as member_count
    FROM org.teams t
    JOIN org.team_members tm ON tm.team_id = t.id
    WHERE 
      tm.user_id = v_user_id
      AND tm.status = 'active'
      AND (
        p_role_filter = 'all' 
        OR (p_role_filter = 'owner' AND tm.role = 'owner')
        OR (p_role_filter = 'admin' AND tm.role = 'admin')
        OR (p_role_filter = 'member' AND tm.role != 'owner')
      )
      AND (
        p_search_query = '' 
        OR t.name ILIKE '%' || p_search_query || '%'
        OR t.slug ILIKE '%' || p_search_query || '%'
      )
  )
  SELECT
    ut.id as team_id, 
    ut.name,
    ut.slug,
    ut.avatar_url,
    ut.banner_url,
    ut.description,
    ut.user_role,
    ut.member_count,
    ut.payout_model,
    ut.created_at,
    ut.updated_at,
    COUNT(*) OVER() as total_count
  FROM user_teams ut
  ORDER BY
    CASE WHEN p_sort_by = 'name' AND p_sort_dir = 'asc' THEN ut.name END ASC,
    CASE WHEN p_sort_by = 'name' AND p_sort_dir = 'desc' THEN ut.name END DESC,
    
    CASE WHEN p_sort_by = 'member_count' AND p_sort_dir = 'asc' THEN ut.member_count END ASC,
    CASE WHEN p_sort_by = 'member_count' AND p_sort_dir = 'desc' THEN ut.member_count END DESC,
    
    CASE WHEN p_sort_by = 'last_updated' AND p_sort_dir = 'asc' THEN ut.updated_at END ASC,
    CASE WHEN p_sort_by = 'last_updated' AND p_sort_dir = 'desc' THEN ut.updated_at END DESC,
    
    ut.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;