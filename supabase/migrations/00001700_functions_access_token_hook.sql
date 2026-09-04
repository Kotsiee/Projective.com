-- ============================================================================
-- 00001700 functions access token hook
-- Consolidated verbatim from: 20260715120000_access_token_context_hook.sql
-- ============================================================================

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
  -- Whether a Projective profile exists at all.
  --
  -- An OAuth sign-up reaches GoTrue with no username and no dob, so `public.handle_new_user`
  -- deliberately leaves it profile-less until /join calls `public.complete_onboarding` (00001010).
  -- Until then the identity is authenticated and owns nothing: every table that attributes a row to
  -- `org.users_public(user_id)` -- projects, tickets, catalogue listings -- carries a foreign key
  -- that cannot be satisfied, so the write dies deep in Postgres with a constraint name rather than
  -- a sentence anybody can act on.
  --
  -- Stamping the fact into the token is what lets the app route those accounts back to finish
  -- onboarding WITHOUT a database round trip in a middleware that is deliberately network-free. Like
  -- every other claim here it is chrome only: it decides which screen is painted, never what the
  -- caller may do, and the foreign key stays the thing that actually holds.
  v_onboarded boolean := false;

  -- Presentation preferences (org.user_preferences). Chrome-only: they decide which currency and
  -- locale the viewer's figures are FORMATTED in, never what any ledger row stores or settles at.
  v_display_currency text;
  v_locale text;

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

  -- Read IMMEDIATELY, before the next SELECT overwrites it: `FOUND` reports whether the statement
  -- just executed returned a row, and every query below resets it. This is the only honest test --
  -- `v_username IS NOT NULL` would report a profile-less account for anyone whose username column is
  -- somehow blank, and the column is NOT NULL, so the two differ only in the case where the answer
  -- matters.
  v_onboarded := FOUND;

  -- Raw active-context state.
  SELECT sc.active_profile_type::text, sc.active_profile_id, sc.active_team_id, sc.active_organisation_id
    INTO v_profile_type, v_profile_id, v_team_id, v_org_id
  FROM security.session_context sc
  WHERE sc.user_id = v_user_id;

  -- Presentation preferences. A row may not exist yet (the seed trigger runs AFTER INSERT on
  -- org.users_public), so both fall back to the platform defaults rather than a NULL claim.
  SELECT UPPER(NULLIF(TRIM(pr.preferred_display_currency), '')), NULLIF(TRIM(pr.locale), '')
    INTO v_display_currency, v_locale
  FROM org.user_preferences pr
  WHERE pr.user_id = v_user_id;

  v_display_currency := COALESCE(v_display_currency, 'GBP');
  v_locale := COALESCE(v_locale, 'en-GB');

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
  --
  -- `displayCurrency` + `locale` ride the SAME claim rather than a second one because they are read
  -- at the same moment and by the same consumer: the app decodes this object (unverified) to decide
  -- which currency and locale the first SSR byte formats money in, so shipping them apart would mean
  -- a figure could paint in one currency and correct itself to another after hydration. They grant
  -- nothing — a tampered claim only changes the symbol the tamperer's own browser draws, while every
  -- stored amount keeps its origin currency and every settlement uses the snapshot on its own row.
  --
  -- `onboarded` rides it for the same reason and one more: the consumer reads it in a middleware,
  -- and the whole point of putting it here is that resolving it any other way costs a query on every
  -- authenticated request. It is stamped false ONLY when this function positively looked and found
  -- no profile row; the EXCEPTION handler below returns the event unchanged, so a failure omits the
  -- claim entirely rather than asserting an account is un-onboarded. The consumer treats an absent
  -- claim as onboarded, which is what keeps a legacy token — or a hook that errored — from walking a
  -- fully set-up user back through onboarding they already finished.
  v_app_meta := jsonb_set(
    v_app_meta,
    '{active_context}',
    jsonb_build_object(
      'type', v_type,
      'id', v_id,
      'role', v_role,
      'handle', v_handle,
      'isClient', v_ctx_is_client,
      'isFreelancer', v_ctx_is_freelancer,
      'onboarded', v_onboarded,
      'displayCurrency', v_display_currency,
      'locale', v_locale
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
