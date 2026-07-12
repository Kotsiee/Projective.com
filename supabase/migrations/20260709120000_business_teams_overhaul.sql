-- Business & Teams overhaul
-- ---------------------------------------------------------------------------
-- 1. "Client / Operator Mode" account modifier (gates the Businesses nav tab).
-- 2. Draft-first, low-friction entity creation: a `status` lifecycle column on
--    org.business_profiles and org.teams, plus a `tier` surfaced to the roster.
-- 3. Minimal create RPCs — only name + slug are required; everything else is
--    deferred to a downstream settings page and the entity starts as 'draft'.
-- ---------------------------------------------------------------------------

-- #region 1. Account-level Operator Mode flag
ALTER TABLE org.users_public
  ADD COLUMN IF NOT EXISTS is_operator boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN org.users_public.is_operator IS
  'Client / Operator Mode: when true the user has opted into hiring/client tooling and the Businesses nav space becomes visible.';

-- Toggle helper so the flag is switchable at runtime (settings / testing).
CREATE OR REPLACE FUNCTION org.set_operator_mode(p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, org, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE org.users_public SET is_operator = p_enabled, updated_at = now()
  WHERE user_id = v_user_id;

  RETURN jsonb_build_object('is_operator', p_enabled);
END;
$$;

GRANT EXECUTE ON FUNCTION org.set_operator_mode(boolean) TO authenticated;
-- #endregion

-- #region 2. Draft lifecycle status on entities
ALTER TABLE org.business_profiles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';
ALTER TABLE org.teams
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

-- Existing rows predate the draft model — treat them as fully live.
UPDATE org.business_profiles SET status = 'active' WHERE status = 'draft';
UPDATE org.teams SET status = 'active' WHERE status = 'draft';

DO $$ BEGIN
  ALTER TABLE org.business_profiles
    ADD CONSTRAINT business_profiles_status_check
    CHECK (status IN ('draft', 'active', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE org.teams
    ADD CONSTRAINT teams_status_check
    CHECK (status IN ('draft', 'active', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Low-friction creation: billing details are deferred to settings, so a draft
-- business no longer needs a billing email up-front.
ALTER TABLE org.business_profiles ALTER COLUMN billing_email DROP NOT NULL;
-- #endregion

-- #region 3. Minimal create_business RPC (name + slug only)
CREATE OR REPLACE FUNCTION org.create_business(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, org, finance, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_new_business_id uuid;
  v_slug text;
  v_status text := COALESCE(NULLIF(payload->>'status', ''), 'draft');
  v_currency text := COALESCE(NULLIF(payload->>'default_currency', ''), 'USD');
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_slug := payload->>'slug';
  IF v_slug IS NULL OR length(v_slug) < 3 THEN RAISE EXCEPTION 'A valid handle is required'; END IF;
  IF EXISTS (SELECT 1 FROM org.business_profiles WHERE slug = v_slug) THEN
    RAISE EXCEPTION 'Business handle already taken' USING ERRCODE = '23505';
  END IF;

  -- Only name + slug are mandatory; all extended metadata is optional and can be
  -- filled in later on the (locked) settings page.
  INSERT INTO org.business_profiles (
    owner_user_id, name, slug, status, headline, bio,
    logo_file_id, banner_file_id, legal_name, billing_email,
    country, address_line_1, address_city, address_zip, tax_id, default_currency
  ) VALUES (
    v_user_id,
    payload->>'name',
    v_slug,
    v_status,
    COALESCE(payload->>'headline', ''),
    COALESCE(payload->'description', '{}'::jsonb),
    NULLIF(payload->>'logo_file_id', '')::uuid,
    NULLIF(payload->>'banner_file_id', '')::uuid,
    NULLIF(payload->>'legal_name', ''),
    NULLIF(payload->>'billing_email', ''),
    NULLIF(payload->>'country', ''),
    NULLIF(payload->>'address_line_1', ''),
    NULLIF(payload->>'address_city', ''),
    NULLIF(payload->>'address_zip', ''),
    NULLIF(payload->>'tax_id', ''),
    v_currency
  ) RETURNING id INTO v_new_business_id;

  INSERT INTO org.business_members (business_id, user_id, role, status)
  VALUES (v_new_business_id, v_user_id, 'owner', 'active');

  -- AC5: initialise the Business Wallet in the finance schema.
  INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
  VALUES ('business', v_new_business_id, v_currency, 0);

  UPDATE org.users_public SET has_business = true WHERE user_id = v_user_id;

  INSERT INTO security.session_context (user_id, active_profile_type, active_profile_id, active_team_id, updated_at)
  VALUES (v_user_id, 'business', v_new_business_id, NULL, NOW())
  ON CONFLICT (user_id) DO UPDATE SET active_profile_type = 'business', active_profile_id = v_new_business_id, active_team_id = NULL, updated_at = NOW();

  -- AC6: immutable audit trail (SECURITY DEFINER only).
  INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata, actor_profile_id)
  VALUES (
    v_user_id, 'business.created', 'org.business_profiles', v_new_business_id,
    jsonb_build_object('slug', v_slug, 'name', payload->>'name', 'status', v_status),
    v_new_business_id
  );

  RETURN jsonb_build_object('business_id', v_new_business_id, 'slug', v_slug, 'status', v_status);
END;
$$;
-- #endregion

-- #region 4. Minimal create_team RPC (name + slug only)
CREATE OR REPLACE FUNCTION org.create_team(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = org, public
AS $$
DECLARE
  new_team_id uuid;
  new_team_slug text;
  invite_record jsonb;
  v_owner_id uuid;
  v_currency text;
  v_wallet_id uuid;
  v_status text := COALESCE(NULLIF(payload->>'status', ''), 'draft');
BEGIN
  new_team_id := COALESCE((payload->>'id')::uuid, gen_random_uuid());
  v_owner_id := COALESCE((payload->>'owner_id')::uuid, auth.uid());
  v_currency := COALESCE(NULLIF(payload->>'currency', ''), 'USD');

  IF v_owner_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF payload->>'slug' IS NULL OR length(payload->>'slug') < 3 THEN
    RAISE EXCEPTION 'A valid handle is required';
  END IF;

  INSERT INTO org.teams (
    id, owner_user_id, name, slug, status, headline, bio,
    avatar_file_id, banner_file_id, visibility, payout_model, default_payout_settings
  ) VALUES (
    new_team_id,
    v_owner_id,
    payload->>'name',
    payload->>'slug',
    v_status,
    COALESCE(payload->>'headline', ''),
    COALESCE(payload->'description', '{}'::jsonb),
    NULLIF(payload->>'avatar_file_id', '')::uuid,
    NULLIF(payload->>'banner_file_id', '')::uuid,
    COALESCE(NULLIF(payload->>'visibility', ''), 'invite_only'),
    COALESCE(NULLIF(payload->>'payout_model', ''), 'manager_discretion'),
    COALESCE(payload->'default_payout_settings', '{}'::jsonb)
  ) RETURNING id, slug INTO new_team_id, new_team_slug;

  INSERT INTO org.team_members (team_id, user_id, role, status)
  VALUES (new_team_id, v_owner_id, 'owner', 'active');

  -- AC5: initialise the Team Vault (finance.wallets) and link it as treasury.
  INSERT INTO finance.wallets (owner_type, owner_id, currency, balance_cents)
  VALUES ('team', new_team_id, v_currency, 0)
  RETURNING id INTO v_wallet_id;

  UPDATE org.teams SET treasury_wallet_id = v_wallet_id WHERE id = new_team_id;

  UPDATE org.users_public SET has_team = true WHERE user_id = v_owner_id;

  IF payload ? 'invites' AND jsonb_array_length(payload->'invites') > 0 THEN
    FOR invite_record IN SELECT * FROM jsonb_array_elements(payload->'invites')
    LOOP
      INSERT INTO org.org_invitations (inviter_user_id, target_email, team_id, token, status)
      VALUES (v_owner_id, invite_record->>'email', new_team_id, encode(gen_random_bytes(32), 'hex'), 'pending');
    END LOOP;
  END IF;

  -- AC6: immutable audit trail (SECURITY DEFINER only).
  INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata, actor_team_id)
  VALUES (
    v_owner_id, 'team.created', 'org.teams', new_team_id,
    jsonb_build_object('slug', new_team_slug, 'name', payload->>'name', 'status', v_status),
    new_team_id
  );

  RETURN jsonb_build_object('team_id', new_team_id, 'team_slug', new_team_slug, 'status', v_status);

EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Team handle already exists' USING ERRCODE = '23505';
END;
$$;
-- #endregion

-- #region 5. Dashboard getters surface status + tier (roster badges)
CREATE OR REPLACE FUNCTION org.get_dashboard_businesses(p_search_query text, p_sort_by text, p_sort_dir text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, owner_user_id uuid, name text, slug text, logo jsonb, country text,
  default_currency text, status text, tier text, created_at timestamptz, total_count bigint
) LANGUAGE plpgsql SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH user_businesses AS (
    SELECT bp.id, bp.owner_user_id, bp.name, bp.slug, bp.logo_file_id, bp.country,
           bp.default_currency, bp.status, bp.plan, bp.created_at
    FROM org.business_profiles bp JOIN org.business_members bm ON bm.business_id = bp.id
    WHERE bm.user_id = auth.uid() AND bm.status = 'active'
      AND (p_search_query = '' OR bp.name ILIKE '%' || p_search_query || '%' OR bp.slug ILIKE '%' || p_search_query || '%')
  )
  SELECT ub.id, ub.owner_user_id, ub.name, ub.slug,
         (SELECT metadata->'variants' FROM files.items WHERE id = ub.logo_file_id) as logo,
         ub.country, ub.default_currency, ub.status, ub.plan as tier,
         ub.created_at, COUNT(*) OVER()::bigint as total_count
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

CREATE OR REPLACE FUNCTION org.get_dashboard_teams(
  p_search_query text, p_role_filter text, p_sort_by text, p_sort_dir text, p_limit int, p_offset int
)
RETURNS TABLE (
  team_id uuid, name text, slug text, avatar_url text, banner_url text, description text,
  user_role text, member_count bigint, payout_model text, status text, tier text,
  created_at timestamptz, updated_at timestamptz, total_count bigint
)
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH user_teams AS (
    SELECT
      t.id, t.name, t.slug, t.avatar_file_id, t.banner_file_id, t.bio,
      t.payout_model, t.status, t.subscription_tier, t.created_at, t.updated_at,
      tm.role as user_role,
      (SELECT COUNT(*) FROM org.team_members m WHERE m.team_id = t.id AND m.status = 'active') as member_count
    FROM org.teams t
    JOIN org.team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = v_user_id AND tm.status = 'active'
      AND (
        p_role_filter = 'all'
        OR (p_role_filter = 'owner' AND tm.role = 'owner')
        OR (p_role_filter = 'admin' AND tm.role = 'admin')
        OR (p_role_filter = 'member' AND tm.role != 'owner')
      )
      AND (p_search_query = '' OR t.name ILIKE '%' || p_search_query || '%' OR t.slug ILIKE '%' || p_search_query || '%')
  )
  SELECT
    ut.id as team_id, ut.name, ut.slug,
    NULL::text as avatar_url, NULL::text as banner_url,
    ut.bio::text as description,
    ut.user_role, ut.member_count, ut.payout_model, ut.status, ut.subscription_tier as tier,
    ut.created_at, ut.updated_at,
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
-- #endregion
