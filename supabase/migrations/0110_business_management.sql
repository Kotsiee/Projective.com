CREATE OR REPLACE FUNCTION org.create_business(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, org, finance, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_new_business_id uuid;
  v_slug text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_slug := payload->>'slug';
  IF EXISTS (SELECT 1 FROM org.business_profiles WHERE slug = v_slug) THEN RAISE EXCEPTION 'Business handle already taken' USING ERRCODE = '23505'; END IF;

  -- `bio` is the jsonb rich-text column; branding is stored as files.items references
  -- (logo_file_id / banner_file_id), not URLs.
  INSERT INTO org.business_profiles (
    owner_user_id, name, slug, headline, bio, logo_file_id, banner_file_id, legal_name, billing_email, country, address_line_1, address_city, address_zip, tax_id, default_currency
  ) VALUES (
    v_user_id, payload->>'name', v_slug, COALESCE(payload->>'headline', ''), COALESCE(payload->'description', '{}'::jsonb), NULLIF(payload->>'logo_file_id', '')::uuid, NULLIF(payload->>'banner_file_id', '')::uuid, payload->>'legal_name', payload->>'billing_email', payload->>'country', payload->>'address_line_1', payload->>'address_city', payload->>'address_zip', payload->>'tax_id', COALESCE(payload->>'default_currency', 'USD')
  ) RETURNING id INTO v_new_business_id;

  INSERT INTO org.business_members (business_id, user_id, role, status) VALUES (v_new_business_id, v_user_id, 'owner', 'active');

  -- AC5: initialise the Business Wallet in the finance schema.
  INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents) VALUES ('business', v_new_business_id, COALESCE(payload->>'default_currency', 'USD'), 0);

  INSERT INTO security.session_context (user_id, active_profile_type, active_profile_id, active_team_id, updated_at) VALUES (v_user_id, 'business', v_new_business_id, NULL, NOW()) ON CONFLICT (user_id) DO UPDATE SET active_profile_type = 'business', active_profile_id = v_new_business_id, active_team_id = NULL, updated_at = NOW();

  -- AC6: immutable audit trail. security.audit_logs has no `authenticated` grant, so
  -- this can only be written from a SECURITY DEFINER context such as this one.
  INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata, actor_profile_id)
  VALUES (
    v_user_id, 'business.created', 'org.business_profiles', v_new_business_id,
    jsonb_build_object('slug', v_slug, 'name', payload->>'name', 'default_currency', COALESCE(payload->>'default_currency', 'USD')),
    v_new_business_id
  );

  RETURN jsonb_build_object('business_id', v_new_business_id, 'slug', v_slug);
END;
$$;

CREATE OR REPLACE FUNCTION org.get_dashboard_businesses(p_search_query text, p_sort_by text, p_sort_dir text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, owner_user_id uuid, name text, slug text, logo jsonb, country text, default_currency text, created_at timestamptz, total_count bigint
) LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH user_businesses AS (
    SELECT bp.id, bp.owner_user_id, bp.name, bp.slug, bp.logo_file_id, bp.country, bp.default_currency, bp.created_at
    FROM org.business_profiles bp JOIN org.business_members bm ON bm.business_id = bp.id
    WHERE bm.user_id = auth.uid() AND bm.status = 'active' AND (p_search_query = '' OR bp.name ILIKE '%' || p_search_query || '%' OR bp.slug ILIKE '%' || p_search_query || '%')
  )
  SELECT ub.id, ub.owner_user_id, ub.name, ub.slug, 
         (SELECT metadata->'variants' FROM files.items WHERE id = ub.logo_file_id) as logo, 
         ub.country, ub.default_currency, ub.created_at, COUNT(*) OVER()::bigint as total_count
  FROM user_businesses ub
  ORDER BY
    CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'asc' THEN ub.created_at END ASC,
    CASE WHEN p_sort_by = 'created_at' AND p_sort_dir = 'desc' THEN ub.created_at END DESC,
    CASE WHEN p_sort_by = 'name' AND p_sort_dir = 'asc' THEN ub.name END ASC,
    CASE WHEN p_sort_by = 'name' AND p_sort_dir = 'desc' THEN ub.name END DESC,
    ub.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;