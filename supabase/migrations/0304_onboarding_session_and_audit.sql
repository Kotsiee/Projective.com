-- US-001 · Multi-Persona Onboarding — provisioning, session context (AC4) & audit (AC6)
--
-- Onboarding provisioning lives in SECURITY DEFINER Postgres functions:
--   * public.provision_user_profile(...) — the single reusable routine that creates
--     the profile rows, initialises security.session_context (AC4) and writes the
--     'user.onboarded' audit entry (AC6). audit_logs is not granted to the
--     `authenticated` role (see 0205), so it can only be written from a definer
--     context — that is why provisioning lives here, not in a TS backend service.
--   * public.handle_new_user() — the on_auth_user_created trigger. It provisions the
--     profile immediately ONLY when the required identity data is present. The
--     email/password wizard supplies username + dob via signUp metadata, so those
--     accounts are provisioned at once. OAuth sign-ups (Google) arrive with NO
--     username/dob — provisioning them here would violate users_public.username
--     NOT NULL and make Gotrue return "Database error saving new user", aborting the
--     handshake. Instead those accounts are created profile-less (isOnboarded =
--     false) and finish onboarding on /join via public.complete_onboarding().
--   * public.complete_onboarding(jsonb) — RPC an already-authenticated user (an OAuth
--     sign-up on /join) calls to provision their profile. Granted to `authenticated`.

-- #region Reusable provisioning routine
CREATE OR REPLACE FUNCTION public.provision_user_profile(
    p_user_id uuid,
    p_email text,
    p_email_confirmed_at timestamptz,
    p_meta jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_is_freelancer boolean := false;
    v_first_name text;
    v_last_name text;
    v_username text;
    v_dob date;
    v_objective text;
    v_skills text[];
    v_interests text[];
    v_avatar_file_id uuid;
    v_active_profile_type public.profile_type;
    v_active_profile_id uuid;
BEGIN
    v_first_name := p_meta->>'first_name';
    v_last_name := p_meta->>'last_name';
    v_username := p_meta->>'username';
    v_dob := (p_meta->>'dob')::date;
    v_objective := p_meta->>'objective';
    v_avatar_file_id := NULLIF(p_meta->>'avatar_file_id', '')::uuid;

    IF v_objective = 'freelancer' OR v_objective = 'seller' THEN
        v_is_freelancer := true;
    END IF;

    IF p_meta ? 'skills' AND jsonb_typeof(p_meta->'skills') = 'array' THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(p_meta->'skills')) INTO v_skills;
    ELSE
        v_skills := '{}'::text[];
    END IF;

    IF p_meta ? 'interests' AND jsonb_typeof(p_meta->'interests') = 'array' THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(p_meta->'interests')) INTO v_interests;
    ELSE
        v_interests := '{}'::text[];
    END IF;

    -- 1. Core profile
    INSERT INTO org.users_public (
        user_id, first_name, last_name, username, dob, visibility,
        interests, is_freelancer, avatar_file_id
    ) VALUES (
        p_user_id, v_first_name, v_last_name, v_username, v_dob, 'unlisted',
        v_interests, v_is_freelancer, v_avatar_file_id
    );

    -- 2. Email relationship (handles NULL verification times automatically)
    INSERT INTO org.user_emails (user_id, email, is_primary, verified_at)
    VALUES (p_user_id, p_email, true, p_email_confirmed_at);

    -- 3. Persona routing → resolve the account's initial active profile
    IF v_is_freelancer THEN
        INSERT INTO org.freelancer_profiles (user_id, skills)
        VALUES (p_user_id, v_skills);

        -- Freelancer profiles are keyed by user_id, so the active profile id is the user id.
        v_active_profile_type := 'freelancer';
        v_active_profile_id := p_user_id;
    ELSE
        -- Client/buyer persona: no owned profile exists yet (a Business is created
        -- later in US-002), so the account starts with no active profile selected.
        v_active_profile_type := NULL;
        v_active_profile_id := NULL;
    END IF;

    -- AC4 — Initialise session context with the resolved active profile (idempotent).
    INSERT INTO security.session_context (
        user_id, active_profile_type, active_profile_id, active_team_id, updated_at
    ) VALUES (
        p_user_id, v_active_profile_type, v_active_profile_id, NULL, NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        active_profile_type = EXCLUDED.active_profile_type,
        active_profile_id = EXCLUDED.active_profile_id,
        active_team_id = NULL,
        updated_at = NOW();

    -- AC6 — Immutable onboarding audit entry. actor_profile_id mirrors the profile
    -- active in session_context (per documentation/database/security/Tables.md).
    INSERT INTO security.audit_logs (
        user_id, action, entity_table, entity_id, metadata, actor_profile_id
    ) VALUES (
        p_user_id,
        'user.onboarded',
        'org.users_public',
        p_user_id,
        jsonb_build_object(
            'objective', v_objective,
            'is_freelancer', v_is_freelancer,
            'username', v_username,
            'active_profile_type', v_active_profile_type
        ),
        v_active_profile_id
    );
END;
$$;
-- #endregion

-- #region Trigger — provision only when identity data is present (email/password path)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    -- The email/password wizard supplies username + dob via signUp metadata, so we
    -- can provision the full profile immediately. OAuth sign-ups arrive without
    -- them; those accounts stay profile-less (isOnboarded = false) and finish via
    -- public.complete_onboarding() after landing on /join.
    IF NULLIF(NEW.raw_user_meta_data->>'username', '') IS NOT NULL
       AND NULLIF(NEW.raw_user_meta_data->>'dob', '') IS NOT NULL THEN
        PERFORM public.provision_user_profile(
            NEW.id, NEW.email, NEW.email_confirmed_at, NEW.raw_user_meta_data
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- #endregion

-- #region complete_onboarding RPC — called by an authenticated OAuth sign-up on /join
CREATE OR REPLACE FUNCTION public.complete_onboarding(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text;
    v_confirmed timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    IF EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_uid) THEN
        RAISE EXCEPTION 'User has already completed onboarding' USING ERRCODE = '23505';
    END IF;

    IF NULLIF(p_payload->>'username', '') IS NULL OR NULLIF(p_payload->>'dob', '') IS NULL THEN
        RAISE EXCEPTION 'username and dob are required' USING ERRCODE = '22023';
    END IF;

    SELECT email, email_confirmed_at INTO v_email, v_confirmed
    FROM auth.users WHERE id = v_uid;

    PERFORM public.provision_user_profile(v_uid, v_email, v_confirmed, p_payload);
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_onboarding(jsonb) TO authenticated;
-- #endregion
