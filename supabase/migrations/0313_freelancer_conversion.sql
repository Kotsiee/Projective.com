-- Post-onboarding persona expansion — "Become a Partner" (client/operator → freelancer)
--
-- US-001 provisions a freelancer profile only at signup (when objective = freelancer/seller,
-- see public.provision_user_profile in 0304). A user who onboarded as a client/operator had no
-- way to unlock a freelancer profile later. This RPC is that path: it is the mutation behind the
-- "Become a Partner" / "Unlock Freelancer Suite" CTAs on the /become-partner conversion page.
--
-- It is idempotent and self-serve (granted to `authenticated`, keyed off auth.uid()). Like the
-- onboarding provisioning it must run in a SECURITY DEFINER context because it writes
-- security.audit_logs, which is not granted to `authenticated` (see 0205 / 0304).

-- #region enable_freelancer_profile RPC
CREATE OR REPLACE FUNCTION org.enable_freelancer_profile(p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, org, security, auth
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_skills text[];
    v_created boolean := false;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
    END IF;

    -- Must be a fully-onboarded user (owns a public profile) before adding a persona.
    IF NOT EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_uid) THEN
        RAISE EXCEPTION 'Complete onboarding before unlocking a freelancer profile'
            USING ERRCODE = '42501';
    END IF;

    -- Optional starter skills carried from the CTA (mirrors provision_user_profile's contract).
    IF p_payload ? 'skills' AND jsonb_typeof(p_payload->'skills') = 'array' THEN
        SELECT ARRAY(SELECT jsonb_array_elements_text(p_payload->'skills')) INTO v_skills;
    ELSE
        v_skills := '{}'::text[];
    END IF;

    -- 1. Link the freelancer profile record to the account (idempotent — freelancer_profiles is
    --    keyed by user_id). FOUND is true only when a row was actually inserted (not on conflict).
    INSERT INTO org.freelancer_profiles (user_id, skills)
    VALUES (v_uid, v_skills)
    ON CONFLICT (user_id) DO NOTHING;
    v_created := FOUND;

    -- 2. Flip the denormalised persona flag consumed by getMe + the nav gates.
    UPDATE org.users_public
       SET is_freelancer = true, updated_at = now()
     WHERE user_id = v_uid;

    -- 3. Activate the freelancer persona immediately so the suite unlocks without a manual switch.
    --    Freelancer profiles are keyed by user_id, so the active profile id is the user id. Any
    --    active team context is left untouched.
    INSERT INTO security.session_context (
        user_id, active_profile_type, active_profile_id, updated_at
    ) VALUES (
        v_uid, 'freelancer', v_uid, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        active_profile_type = 'freelancer',
        active_profile_id = v_uid,
        updated_at = now();

    -- 4. Audit a genuine conversion only (definer context — audit_logs isn't granted to authenticated).
    IF v_created THEN
        INSERT INTO security.audit_logs (
            user_id, action, entity_table, entity_id, metadata, actor_profile_id
        ) VALUES (
            v_uid,
            'freelancer.unlocked',
            'org.freelancer_profiles',
            v_uid,
            jsonb_build_object(
                'source', 'become_partner',
                'skills_count', COALESCE(array_length(v_skills, 1), 0)
            ),
            v_uid
        );
    END IF;

    RETURN jsonb_build_object(
        'freelancer_profile_id', v_uid,
        'created', v_created,
        'is_freelancer', true
    );
END;
$$;

GRANT EXECUTE ON FUNCTION org.enable_freelancer_profile(jsonb) TO authenticated;
-- #endregion
