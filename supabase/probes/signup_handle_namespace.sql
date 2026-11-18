-- =============================================================================================
-- Probe: a person's sign-up asks the whole handle namespace (PRD-C25, Decision #444 flag (c)).
--
-- `org.fn_resolve_profile` ranks a person above a team above a business, so a person who signed up
-- as a team's handle would make that team's page unreachable. Both doors that mint a person (the
-- GoTrue sign-up trigger `public.handle_new_user` and `public.complete_onboarding`) provision through
-- `public.provision_user_profile`, which must refuse a handle any person (in any case), team,
-- business or enterprise holds, or that a renamed person released in the last 90 days — the same
-- `org.fn_handle_taken` every create and rename door reads. A fresh handle still signs up.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Fixtures come from the seed.
-- =============================================================================================

BEGIN;

CREATE FUNCTION pg_temp.legal_stamp() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'terms', org.fn_current_legal_version('terms'),
        'acceptable-use', org.fn_current_legal_version('acceptable-use'),
        'privacy', org.fn_current_legal_version('privacy'));
$$;

-- The GoTrue sign-up trigger's door, as an email/password sign-up reaches it: the error it raised,
-- or NULL when the person was provisioned.
CREATE FUNCTION pg_temp.sign_up(p_username text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_uid uuid := gen_random_uuid();
BEGIN
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v_uid, 'namespace-probe-' || v_uid || '@projective.invalid', 'authenticated', 'authenticated',
        jsonb_build_object('username', p_username, 'dob', '1990-01-01', 'first_name', 'Namespace',
            'last_name', 'Probe', 'legal_acceptance', pg_temp.legal_stamp()), now());
    IF NOT EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_uid) THEN
        RETURN 'no profile was written';
    END IF;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END;
$$;

-- #region 1. The trigger door refuses a handle a team, a business or another person holds
DO $$
DECLARE
    v_team text := (SELECT t.slug FROM org.teams t ORDER BY t.slug LIMIT 1);
    v_business text := (SELECT b.slug FROM org.business_profiles b ORDER BY b.slug LIMIT 1);
    v_person text := (SELECT u.username FROM org.users_public u WHERE u.username ~ '^[a-z]+$' ORDER BY u.username LIMIT 1);
    v_handle text;
    v_result text;
BEGIN
    IF v_team IS NULL OR v_business IS NULL OR v_person IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: the seed needs a team, a business and a person';
    END IF;
    FOREACH v_handle IN ARRAY ARRAY[v_team, upper(v_team), v_business, initcap(v_person)]
    LOOP
        v_result := pg_temp.sign_up(v_handle);
        IF v_result IS DISTINCT FROM '23505 That handle is taken.' THEN
            RAISE EXCEPTION 'FAIL a sign-up as @% was not refused as taken: %', v_handle, COALESCE(v_result, 'provisioned');
        END IF;
        RAISE NOTICE 'PASS a sign-up as @% is refused: %', v_handle, v_result;
    END LOOP;
END $$;
-- #endregion

-- #region 2. A renamed person's released handle is held for 90 days, then free
DO $$
DECLARE
    v_holder uuid := (SELECT u.user_id FROM org.users_public u ORDER BY u.username LIMIT 1);
    v_result text;
BEGIN
    INSERT INTO org.handle_changes (user_id, old_handle, new_handle, changed_at)
    VALUES (v_holder, 'namespace-probe-held', 'namespace-probe-new', now() - interval '10 days'),
           (v_holder, 'namespace-probe-lapsed', 'namespace-probe-newer', now() - interval '91 days');
    v_result := pg_temp.sign_up('namespace-probe-held');
    IF v_result IS DISTINCT FROM '23505 That handle is taken.' THEN
        RAISE EXCEPTION 'FAIL a held handle signed up: %', COALESCE(v_result, 'provisioned');
    END IF;
    RAISE NOTICE 'PASS a handle released 10 days ago is held: %', v_result;
    v_result := pg_temp.sign_up('namespace-probe-lapsed');
    IF v_result IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a handle released 91 days ago is still refused: %', v_result;
    END IF;
    RAISE NOTICE 'PASS a handle released 91 days ago is free again';
END $$;
-- #endregion

-- #region 3. complete_onboarding (an OAuth sign-up on /join) refuses a team's handle
DO $$
DECLARE
    v_uid uuid := gen_random_uuid();
    v_team text := (SELECT t.slug FROM org.teams t ORDER BY t.slug DESC LIMIT 1);
BEGIN
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v_uid, 'namespace-probe-' || v_uid || '@projective.invalid', 'authenticated',
        'authenticated', '{}'::jsonb, now());
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM public.complete_onboarding(jsonb_build_object(
            'username', v_team, 'dob', '1990-01-01', 'legal_acceptance', pg_temp.legal_stamp()));
        RAISE EXCEPTION 'FAIL complete_onboarding minted @% over the team', v_team;
    EXCEPTION WHEN SQLSTATE '23505' THEN
        IF SQLERRM IS DISTINCT FROM 'That handle is taken.' THEN
            RAISE EXCEPTION 'FAIL complete_onboarding refused @% for another reason: %', v_team, SQLERRM;
        END IF;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_uid) THEN
        RAISE EXCEPTION 'FAIL the refused onboarding left a profile behind';
    END IF;
    RAISE NOTICE 'PASS complete_onboarding refuses a team''s handle (@%)', v_team;
END $$;
-- #endregion

-- #region 4. A fresh handle still signs up, and the team's page still resolves to the team
DO $$
DECLARE
    v_result text := pg_temp.sign_up('namespace-probe-fresh');
    v_team text := (SELECT t.slug FROM org.teams t ORDER BY t.slug LIMIT 1);
BEGIN
    IF v_result IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a fresh handle was refused: %', v_result;
    END IF;
    RAISE NOTICE 'PASS a fresh handle signs up';
    IF (SELECT r.owner_type::text FROM org.fn_resolve_profile(v_team) r) IS DISTINCT FROM 'team' THEN
        RAISE EXCEPTION 'FAIL @% no longer resolves to its team', v_team;
    END IF;
    RAISE NOTICE 'PASS @% resolves to its team', v_team;
END $$;
-- #endregion

-- #region 5. No two holders share a handle in any case, across the four tables
DO $$
DECLARE
    v_dupes text;
BEGIN
    SELECT string_agg(h, ', ') INTO v_dupes FROM (
        SELECT lower(h) AS h FROM (
            SELECT u.username AS h FROM org.users_public u
            UNION ALL SELECT t.slug FROM org.teams t
            UNION ALL SELECT b.slug FROM org.business_profiles b
            UNION ALL SELECT o.handle FROM org.enterprises o
        ) every_handle
        GROUP BY lower(h) HAVING count(*) > 1
    ) shared;
    IF v_dupes IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL handles held twice across the namespace: %', v_dupes;
    END IF;
    RAISE NOTICE 'PASS every handle has one holder';
END $$;
-- #endregion

ROLLBACK;
