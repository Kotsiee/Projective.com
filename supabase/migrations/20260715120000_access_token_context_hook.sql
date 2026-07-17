-- Custom Access Token Hook — stamp the active context into every issued JWT.
-- ---------------------------------------------------------------------------
-- Wires the backend origin for User Context Hydration (root CLAUDE.md Decision #16).
-- A GoTrue "custom access token" hook runs before each access token is signed and lets us inject
-- claims resolved from the user's `security.session_context`. We stamp TWO consumers from one place:
--
--   1. Top-level raw claims — `active_profile_type` / `active_profile_id` / `active_team_id` /
--      `active_organisation_id`. These are exactly what the pre-existing `security.current_context()`
--      helper (migration 0099) reads via `auth.jwt()->>...` to drive Row-Level Security. Until this
--      hook existed those claims were always NULL; RLS that leans on `current_context()` only becomes
--      real once this is enabled.
--   2. `app_metadata.active_context` — the resolved, presentation-ready object
--      `{ type, id, role, handle, isClient, isFreelancer }` the web app decodes (unverified) for
--      chrome (`@projective/types/auth` `resolveUserContext`). Type is the four-context matrix
--      (personal | team | business | organisation); role is collapsed to guest|member|admin chrome.
--
-- This is additive: it adds `active_organisation_id` to `security.session_context` (so an
-- organisation can be the active context — organisations are the buyer-only entity of Decision
-- #9/#10), an org context-switch RPC, and the hook function. No table/column/FK is dropped or
-- altered. Named with a timestamp so it runs AFTER every 0xxx migration and the 20260709 overhaul
-- that introduced `org.users_public.is_operator` (read below for the client/buyer capability).

-- #region 1. Additive: make an organisation a first-class active context
ALTER TABLE security.session_context
  ADD COLUMN IF NOT EXISTS active_organisation_id uuid
  REFERENCES org.organisations (id) ON DELETE SET NULL;

COMMENT ON COLUMN security.session_context.active_organisation_id IS
  'The active organisation (buyer-only entity) context, when the user is acting as an organisation. Mutually exclusive with active_profile_id/active_team_id — set by security.switch_organisation_context.';
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

GRANT EXECUTE ON FUNCTION security.switch_organisation_context(uuid) TO authenticated;
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
-- #endregion

-- #region 4. The custom access token hook
-- Resolves the acting context from session_context and stamps it into the JWT claims. Runs as the
-- GoTrue admin role (supabase_auth_admin); SECURITY DEFINER so it can read the org/security tables
-- regardless of RLS. `search_path = ''` (all identifiers fully qualified) hardens it against
-- search_path hijacking. It MUST NOT raise — any failure returns the event unchanged so token
-- issuance (i.e. login) never breaks over a chrome-only claim.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_claims jsonb;
  v_app_meta jsonb;

  -- Raw session_context state.
  v_profile_type text;
  v_profile_id uuid;
  v_team_id uuid;
  v_org_id uuid;

  -- Profile inputs.
  v_username text;
  v_is_freelancer boolean := false;
  v_is_operator boolean := false;

  -- Resolved chrome context.
  v_type text := 'personal';
  v_id uuid;
  v_role text := 'member';
  v_handle text;
  v_ctx_is_freelancer boolean := false;
  v_ctx_is_client boolean := true;
BEGIN
  v_user_id := (event->>'user_id')::uuid;
  v_claims := COALESCE(event->'claims', '{}'::jsonb);
  v_app_meta := COALESCE(v_claims->'app_metadata', '{}'::jsonb);

  -- Profile-level inputs (may be absent for a pre-onboarding / OAuth-landing account).
  SELECT up.username, COALESCE(up.is_freelancer, false), COALESCE(up.is_operator, false)
    INTO v_username, v_is_freelancer, v_is_operator
  FROM org.users_public up
  WHERE up.user_id = v_user_id;

  -- Raw active-context state.
  SELECT sc.active_profile_type::text, sc.active_profile_id, sc.active_team_id, sc.active_organisation_id
    INTO v_profile_type, v_profile_id, v_team_id, v_org_id
  FROM security.session_context sc
  WHERE sc.user_id = v_user_id;

  -- Resolve the four-context matrix (organisation > team > business > personal). role collapses to
  -- admin when the actor owns the entity or holds an owner/admin membership; else member.
  IF v_org_id IS NOT NULL THEN
    v_type := 'organisation';
    v_id := v_org_id;
    SELECT o.handle INTO v_handle FROM org.organisations o WHERE o.id = v_org_id;
    IF EXISTS (SELECT 1 FROM org.organisations o WHERE o.id = v_org_id AND o.owner_user_id = v_user_id) THEN
      v_role := 'admin';
    ELSE
      SELECT CASE WHEN m.role IN ('owner', 'admin') THEN 'admin' ELSE 'member' END
        INTO v_role
      FROM org.organisation_members m
      WHERE m.organisation_id = v_org_id AND m.user_id = v_user_id AND m.status = 'active';
    END IF;
    -- Organisations are the buyer-only entity (Decision #9/#10).
    v_ctx_is_freelancer := false;
    v_ctx_is_client := true;

  ELSIF v_team_id IS NOT NULL THEN
    v_type := 'team';
    v_id := v_team_id;
    SELECT t.slug INTO v_handle FROM org.teams t WHERE t.id = v_team_id;
    IF EXISTS (SELECT 1 FROM org.teams t WHERE t.id = v_team_id AND t.owner_user_id = v_user_id) THEN
      v_role := 'admin';
    ELSE
      SELECT CASE WHEN tm.role IN ('owner', 'admin', 'manager') THEN 'admin' ELSE 'member' END
        INTO v_role
      FROM org.team_members tm
      WHERE tm.team_id = v_team_id AND tm.user_id = v_user_id AND tm.status = 'active';
    END IF;
    v_ctx_is_freelancer := v_is_freelancer;
    v_ctx_is_client := v_is_operator OR NOT v_is_freelancer;

  ELSIF v_profile_type = 'business' AND v_profile_id IS NOT NULL THEN
    v_type := 'business';
    v_id := v_profile_id;
    SELECT b.slug INTO v_handle FROM org.business_profiles b WHERE b.id = v_profile_id;
    IF EXISTS (SELECT 1 FROM org.business_profiles b WHERE b.id = v_profile_id AND b.owner_user_id = v_user_id) THEN
      v_role := 'admin';
    ELSE
      SELECT CASE WHEN bm.role IN ('owner', 'admin', 'manager') THEN 'admin' ELSE 'member' END
        INTO v_role
      FROM org.business_members bm
      WHERE bm.business_id = v_profile_id AND bm.user_id = v_user_id AND bm.status = 'active';
    END IF;
    v_ctx_is_freelancer := v_is_freelancer;
    v_ctx_is_client := v_is_operator OR NOT v_is_freelancer;

  ELSE
    -- Personal: the individual's own space (freelancer persona, or a client with no entity selected).
    v_type := 'personal';
    v_id := v_user_id;
    v_handle := v_username;
    v_role := 'member';
    v_ctx_is_freelancer := v_is_freelancer;
    v_ctx_is_client := v_is_operator OR NOT v_is_freelancer;
  END IF;

  v_role := COALESCE(v_role, 'member');

  -- 1. Raw top-level claims for security.current_context() / RLS. jsonb_set is strict — a NULL value
  -- would collapse the whole object — so NULL slots are stamped as an explicit JSON `null`.
  v_claims := jsonb_set(v_claims, '{active_profile_type}', COALESCE(to_jsonb(v_profile_type), 'null'::jsonb), true);
  v_claims := jsonb_set(v_claims, '{active_profile_id}', COALESCE(to_jsonb(v_profile_id), 'null'::jsonb), true);
  v_claims := jsonb_set(v_claims, '{active_team_id}', COALESCE(to_jsonb(v_team_id), 'null'::jsonb), true);
  v_claims := jsonb_set(v_claims, '{active_organisation_id}', COALESCE(to_jsonb(v_org_id), 'null'::jsonb), true);

  -- 2. Resolved chrome context for the web app (@projective/types/auth).
  v_app_meta := jsonb_set(
    v_app_meta,
    '{active_context}',
    jsonb_build_object(
      'type', v_type,
      'id', v_id,
      'role', v_role,
      'handle', v_handle,
      'isClient', v_ctx_is_client,
      'isFreelancer', v_ctx_is_freelancer
    ),
    true
  );
  v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_meta, true);

  RETURN jsonb_set(event, '{claims}', v_claims, true);
EXCEPTION
  WHEN OTHERS THEN
    -- Never block token issuance on a chrome-claim failure; the app degrades to a guest/personal shell.
    RETURN event;
END;
$$;

-- Only the GoTrue admin role may run the hook; no client role may.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
-- #endregion
