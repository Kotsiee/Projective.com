-- ============================================================================
-- 00001001 functions security context
-- Consolidated verbatim from: 0004_security_tables.sql, 0099_helpers_functions.sql, 20260715120000_access_token_context_hook.sql
-- ============================================================================

-- Recompute active-penalty aggregates into the denormalized discovery/ranking caches
-- (mirrors the reviews.recalculate_entity_rating pattern so the recommender stays a single read).
CREATE OR REPLACE FUNCTION security.fn_recalc_penalty_aggregates()
RETURNS TRIGGER AS $$
DECLARE
    v_subject_type text;
    v_subject_id uuid;
    v_discovery numeric(6,2);
    v_trust numeric(6,2);
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_subject_type := OLD.subject_type;
        v_subject_id := OLD.subject_id;
    ELSE
        v_subject_type := NEW.subject_type;
        v_subject_id := NEW.subject_id;
    END IF;

    SELECT
        COALESCE(SUM(severity) FILTER (WHERE penalty_type = 'discovery_rank'), 0),
        COALESCE(SUM(severity) FILTER (WHERE penalty_type = 'trust_score'), 0)
    INTO v_discovery, v_trust
    FROM security.penalties
    WHERE subject_type = v_subject_type
        AND subject_id = v_subject_id
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > now());

    UPDATE search.profiles_index
    SET discovery_penalty = v_discovery
    WHERE entity_id = v_subject_id
        AND entity_type::text = v_subject_type;

    IF v_subject_type = 'business' THEN
        UPDATE org.business_profiles
        SET system_penalty_score = v_trust
        WHERE id = v_subject_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, security, search, org;

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

-- #endregion

-- #region 2. Context switches keep the four active slots mutually exclusive
-- Re-declare the profile switcher (migration 0100) with one added line: selecting a
-- freelancer/business profile clears any active organisation, so the slots never conflict.
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
    active_organisation_id = NULL,
    updated_at = NOW()
  WHERE user_id = auth.uid();

  INSERT INTO security.audit_logs (
    user_id, action, entity_table, entity_id, actor_profile_id
  ) VALUES (
    auth.uid(), 'session.switch_context', 'security.session_context', auth.uid(), p_id
  );
END;
$$;

-- New: switch the acting context to an organisation the caller belongs to (owner or active member).
-- Clears the profile/team slots so the four active slots stay mutually exclusive.
CREATE OR REPLACE FUNCTION security.switch_organisation_context(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, security, org
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM org.organisations o
    WHERE o.id = p_org_id AND o.owner_user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM org.organisation_members m
    WHERE m.organisation_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Access Denied: You are not an active member of this organisation.';
  END IF;

  UPDATE security.session_context
  SET
    active_profile_type = NULL,
    active_profile_id = NULL,
    active_team_id = NULL,
    active_organisation_id = p_org_id,
    updated_at = NOW()
  WHERE user_id = auth.uid();

  INSERT INTO security.audit_logs (
    user_id, action, entity_table, entity_id, actor_profile_id
  ) VALUES (
    auth.uid(), 'session.switch_context', 'security.session_context', p_org_id, NULL
  );
END;
$$;

-- #endregion

-- #region 3. current_context() also exposes the active organisation (additive)
-- Extend the RLS helper (migration 0099) to surface the new claim alongside the existing three.
CREATE OR REPLACE FUNCTION security.current_context()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'user_id', auth.uid(),
    'active_profile_type',    auth.jwt()->>'active_profile_type',
    'active_profile_id',      auth.jwt()->>'active_profile_id',
    'active_team_id',         auth.jwt()->>'active_team_id',
    'active_organisation_id', auth.jwt()->>'active_organisation_id'
  );
$$;
