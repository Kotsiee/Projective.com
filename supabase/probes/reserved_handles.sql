-- =============================================================================================
-- Probe: reserved handles (org.fn_is_reserved_handle and the refusal the create / rename doors read,
-- org.fn_handle_refusal) — the public editorial routes `/changelog` and `/feedback` and the landing
-- track's `/features` are top-level words no handle may take; so are the planned segments
-- (PLANNED_SEGMENTS, Decision #444 flag (c)), at the team door and at both doors that mint a person
-- (the GoTrue sign-up trigger and public.complete_onboarding, through public.provision_user_profile).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/reserved_handles.sql
--
-- A wrong answer raises `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run
-- prints only PASS notices. The TypeScript twin (RESERVED_HANDLES) is pinned to the same list by
-- packages/types/workspace/workspace.contract.test.ts; this probe pins the database's behaviour.
-- =============================================================================================

BEGIN;

-- #region 1. The new words are reserved, however they are typed
DO $$
DECLARE
    v_handle text;
BEGIN
    FOREACH v_handle IN ARRAY ARRAY['changelog', 'feedback', 'features', 'Changelog', '  FEATURES ', 'Feedback']
    LOOP
        IF NOT org.fn_is_reserved_handle(v_handle) THEN
            RAISE EXCEPTION 'FAIL "%" is not reserved', v_handle;
        END IF;
        RAISE NOTICE 'PASS reserved: "%"', v_handle;
    END LOOP;
END $$;
-- #endregion

-- #region 2. The existing words still are; ordinary handles and near-misses are not
DO $$
DECLARE
    v_handle text;
BEGIN
    FOREACH v_handle IN ARRAY ARRAY['legal', 'help', 'about', 'articles', 'contact', 'inspect', 'share']
    LOOP
        IF NOT org.fn_is_reserved_handle(v_handle) THEN
            RAISE EXCEPTION 'FAIL "%" lost its reservation', v_handle;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS the existing reservations stand';

    FOREACH v_handle IN ARRAY ARRAY['ahmed-k', 'changelogs', 'feedback-team', 'featured', 'my-features', '']
    LOOP
        IF org.fn_is_reserved_handle(v_handle) THEN
            RAISE EXCEPTION 'FAIL ordinary handle "%" is reserved', v_handle;
        END IF;
        RAISE NOTICE 'PASS not reserved: "%"', v_handle;
    END LOOP;

    IF org.fn_is_reserved_handle(NULL) THEN
        RAISE EXCEPTION 'FAIL NULL is reserved';
    END IF;
    RAISE NOTICE 'PASS NULL is not a reserved word';
END $$;
-- #endregion

-- #region 3. The refusal every create / rename door shows
DO $$
DECLARE
    v_handle text;
    v_reason text;
BEGIN
    FOREACH v_handle IN ARRAY ARRAY['changelog', 'feedback', 'features']
    LOOP
        v_reason := org.fn_handle_refusal(v_handle);
        IF v_reason IS DISTINCT FROM 'That handle is reserved.' THEN
            RAISE EXCEPTION 'FAIL refusal for "%" is %', v_handle, COALESCE(v_reason, 'NULL (claimable)');
        END IF;
        RAISE NOTICE 'PASS "%" refused: %', v_handle, v_reason;
    END LOOP;
END $$;
-- #endregion

-- #region 4. Nobody already holds a newly reserved word (it would be shadowed by its route)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM org.users_public WHERE lower(username) IN ('changelog', 'feedback', 'features'))
        OR EXISTS (SELECT 1 FROM org.teams WHERE lower(slug) IN ('changelog', 'feedback', 'features'))
        OR EXISTS (SELECT 1 FROM org.business_profiles WHERE lower(slug) IN ('changelog', 'feedback', 'features'))
        OR EXISTS (SELECT 1 FROM org.enterprises WHERE lower(handle) IN ('changelog', 'feedback', 'features'))
    THEN
        RAISE EXCEPTION 'FAIL a profile, team, business or enterprise already holds a newly reserved handle';
    END IF;
    RAISE NOTICE 'PASS no existing holder of changelog / feedback / features';
END $$;
-- #endregion

-- #region 5. The planned segments are reserved before their routes exist (Decision #444 flag (c))
DO $$
DECLARE
    v_handle text;
BEGIN
    FOREACH v_handle IN ARRAY ARRAY['analytics', 'disputes', 'connections', 'Analytics', ' DISPUTES ',
        'reset', 'vendor', 'email', 'support', 'projective', 'www', 'docs', 'developers', 'marketplace']
    LOOP
        IF NOT org.fn_is_reserved_handle(v_handle) THEN
            RAISE EXCEPTION 'FAIL planned segment "%" is not reserved', v_handle;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS the planned segments are reserved, however they are typed';

    FOREACH v_handle IN ARRAY ARRAY['analytics', 'disputes', 'connections']
    LOOP
        IF org.fn_handle_refusal(v_handle) IS DISTINCT FROM 'That handle is reserved.' THEN
            RAISE EXCEPTION 'FAIL "%" is claimable: %', v_handle, COALESCE(org.fn_handle_refusal(v_handle), 'NULL');
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS analytics / disputes / connections are refused as reserved';

    FOREACH v_handle IN ARRAY ARRAY['analytics-lab', 'disputed', 'my-connections', 'docsy']
    LOOP
        IF org.fn_is_reserved_handle(v_handle) THEN
            RAISE EXCEPTION 'FAIL near-miss "%" is reserved', v_handle;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS near-misses of the planned segments stay claimable';
END $$;
-- #endregion

-- #region 6. A team cannot claim a planned segment
DO $$
DECLARE
    v_owner uuid := (SELECT t.owner_user_id FROM org.teams t ORDER BY t.slug LIMIT 1);
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: the seed has no team owner';
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM org.create_workspace('team', 'Probe Analytics', 'analytics');
        RAISE EXCEPTION 'FAIL a team claimed @analytics';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        IF SQLERRM IS DISTINCT FROM 'handle: That handle is reserved.' THEN
            RAISE EXCEPTION 'FAIL the team door refused @analytics for another reason: %', SQLERRM;
        END IF;
        RAISE NOTICE 'PASS the team door refuses @analytics: %', SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
-- #endregion

-- #region 7. No door that mints a person takes a reserved word
DO $$
DECLARE
    v_uid uuid;
    v_handle text;
BEGIN
    -- The GoTrue sign-up trigger (public.handle_new_user), as an email/password sign-up reaches it.
    FOREACH v_handle IN ARRAY ARRAY['analytics', 'Disputes', 'share']
    LOOP
        v_uid := gen_random_uuid();
        BEGIN
            INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
            VALUES (v_uid, 'reserved-probe-' || v_uid || '@projective.invalid', 'authenticated',
                'authenticated', jsonb_build_object('username', v_handle, 'dob', '1990-01-01',
                    'first_name', 'Reserved', 'last_name', 'Probe'), now());
            RAISE EXCEPTION 'FAIL a sign-up minted @%', v_handle;
        EXCEPTION WHEN SQLSTATE '22023' THEN
            IF SQLERRM IS DISTINCT FROM 'That handle is reserved.' THEN
                RAISE EXCEPTION 'FAIL the sign-up refused @% for another reason: %', v_handle, SQLERRM;
            END IF;
        END;
    END LOOP;
    RAISE NOTICE 'PASS the sign-up trigger refuses a reserved username';

    -- public.complete_onboarding, as an OAuth sign-up finishes on /join.
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v_uid, 'reserved-probe-' || v_uid || '@projective.invalid', 'authenticated',
        'authenticated', '{}'::jsonb, now());
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM public.complete_onboarding(jsonb_build_object('username', 'connections', 'dob', '1990-01-01'));
        RAISE EXCEPTION 'FAIL complete_onboarding minted @connections';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        IF SQLERRM IS DISTINCT FROM 'That handle is reserved.' THEN
            RAISE EXCEPTION 'FAIL complete_onboarding refused @connections for another reason: %', SQLERRM;
        END IF;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF EXISTS (SELECT 1 FROM org.users_public WHERE user_id = v_uid) THEN
        RAISE EXCEPTION 'FAIL the refused onboarding left a profile behind';
    END IF;
    RAISE NOTICE 'PASS complete_onboarding refuses a reserved username';
END $$;
-- #endregion

-- #region 8. Nobody holds any reserved handle
DO $$
DECLARE
    v_held text;
BEGIN
    SELECT string_agg(h, ', ') INTO v_held FROM (
        SELECT u.username AS h FROM org.users_public u WHERE org.fn_is_reserved_handle(u.username)
        UNION ALL SELECT t.slug FROM org.teams t WHERE org.fn_is_reserved_handle(t.slug)
        UNION ALL SELECT b.slug FROM org.business_profiles b WHERE org.fn_is_reserved_handle(b.slug)
        UNION ALL SELECT o.handle FROM org.enterprises o WHERE org.fn_is_reserved_handle(o.handle)
    ) held;
    IF v_held IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL reserved handles are held, so each holder''s profile 404s: %', v_held;
    END IF;
    RAISE NOTICE 'PASS no person, team, business or enterprise holds a reserved handle';
END $$;
-- #endregion

ROLLBACK;
