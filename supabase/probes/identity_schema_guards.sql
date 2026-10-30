-- =============================================================================================
-- Probe: the identity schema's ruling-free hardening (IDENTITY_AND_WORKSPACES_AUDIT §7, Wave 0).
--
--   * IW-M8: security.is_admin() pins its search_path and is not executable by PUBLIC; the client
--     roles keep it (it is an arm of policies they are evaluated against). Every SECURITY DEFINER in
--     `org` and `security` pins a search_path, and org.enable_freelancer_profile pins it EMPTY.
--   * IW-M10: org.enterprise_members.status is `active` or `left` (CHECK).
--   * IW-L: org.teams.visibility is `public`, `unlisted` or `invite_only` (CHECK).
--   * IW-H2 (whatever F4 rules): org.fn_is_minor fails CLOSED — an identity (auth.users) with no
--     profile row has no date of birth and is not provably adult; an id naming no identity (a team or
--     business id passed polymorphically) and a NULL user (no person) stay false.
--   * IW-L1: an archived enterprise is refused by security.switch_enterprise_context and dropped from
--     the claims at the next mint (public.custom_access_token_hook).
--   * IW-L2: a freelancer context slot is re-verified at mint: a given-up profile (`is_freelancer`
--     off) is dropped from the claims and refused by security.switch_session_context.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/identity_schema_guards.sql
--
-- Fixture: seeded adults with a profile — one freelancer, one who is not — and a throwaway enterprise
-- and auth identity created here. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FAIL % — got %', p_label, p_got;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- The raw and resolved context the hook would stamp for p_user.
CREATE FUNCTION pg_temp.mint(p_user uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT public.custom_access_token_hook(jsonb_build_object(
        'user_id', p_user, 'claims', jsonb_build_object('sub', p_user, 'app_metadata', '{}'::jsonb)))->'claims';
$$;

-- #region IW-M8: security.is_admin
DO $$
DECLARE
    v_fn regprocedure := 'security.is_admin()'::regprocedure;
    v_config text[];
    v_public boolean;
BEGIN
    SELECT p.proconfig INTO v_config FROM pg_proc p WHERE p.oid = v_fn;
    PERFORM pg_temp.check('is_admin pins an empty search_path',
        v_config IS NOT NULL AND 'search_path=""' = ANY (v_config), COALESCE(array_to_string(v_config, ','), '<none>'));
    SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_fn AND a.grantee = 0)
           OR (SELECT p.proacl IS NULL FROM pg_proc p WHERE p.oid = v_fn)
      INTO v_public;
    PERFORM pg_temp.check('is_admin is not executable by PUBLIC', NOT v_public, 'PUBLIC holds EXECUTE');
    PERFORM pg_temp.check('is_admin stays executable by anon, authenticated and service_role',
        has_function_privilege('anon', v_fn, 'EXECUTE')
        AND has_function_privilege('authenticated', v_fn, 'EXECUTE')
        AND has_function_privilege('service_role', v_fn, 'EXECUTE'), 'a client role lost it');
    PERFORM pg_temp.check('a role it was never granted to cannot run it',
        NOT has_function_privilege('authenticator', v_fn, 'EXECUTE'), 'authenticator holds EXECUTE');
END $$;

DO $$
DECLARE
    v_loose text[];
BEGIN
    SELECT array_agg(n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
                     ORDER BY 1)
      INTO v_loose
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosecdef AND n.nspname IN ('org', 'security')
       AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%');
    PERFORM pg_temp.check('every org/security definer pins a search_path', v_loose IS NULL,
        array_to_string(v_loose, ', '));
    PERFORM pg_temp.check('enable_freelancer_profile pins an empty search_path',
        (SELECT 'search_path=""' = ANY (p.proconfig) FROM pg_proc p
          WHERE p.oid = 'org.enable_freelancer_profile(jsonb)'::regprocedure),
        (SELECT array_to_string(p.proconfig, ',') FROM pg_proc p
          WHERE p.oid = 'org.enable_freelancer_profile(jsonb)'::regprocedure));
END $$;
-- #endregion

-- #region Fixture
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

DO $$
BEGIN
    INSERT INTO probe_ids (k, id)
    SELECT 'SELLER', u.user_id FROM org.users_public u
      JOIN org.freelancer_profiles f ON f.user_id = u.user_id
     WHERE u.is_freelancer AND NOT org.fn_is_minor(u.user_id)
     ORDER BY u.username LIMIT 1;
    INSERT INTO probe_ids (k, id)
    SELECT 'CLIENT', u.user_id FROM org.users_public u
     WHERE NOT u.is_freelancer AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.enterprises e WHERE e.owner_user_id = u.user_id)
     ORDER BY u.username LIMIT 1;
    INSERT INTO probe_ids (k, id) VALUES ('GHOST', gen_random_uuid());
    -- A profile-less identity, as an OAuth sign-up (or an enterprise owner, Decision #87(b)) leaves it.
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    SELECT id, 'guards-probe-' || id || '@projective.invalid', 'authenticated', 'authenticated', '{}'::jsonb, now()
      FROM probe_ids WHERE k = 'GHOST';
    IF (SELECT count(*) FROM probe_ids WHERE id IS NOT NULL) <> 3 THEN
        RAISE EXCEPTION 'FAIL fixture — need a seeded adult freelancer and an adult client (run deno task db:reset)';
    END IF;
    IF EXISTS (SELECT 1 FROM org.users_public WHERE user_id = (SELECT id FROM probe_ids WHERE k = 'GHOST')) THEN
        RAISE EXCEPTION 'FAIL fixture — the profile-less identity was given a profile';
    END IF;
    -- An enterprise the client owns, with the client's owner seat (the owner is an adult with a DoB).
    INSERT INTO probe_ids (k, id)
    SELECT 'ENT', public.create_enterprise((SELECT id FROM probe_ids WHERE k = 'CLIENT'), jsonb_build_object(
        'legalName', 'Guards Probe Ltd', 'handle', 'guardsprobe' || substr(md5(random()::text), 1, 8),
        'corporateEmail', 'guards-probe@projective.invalid'));
    RAISE NOTICE 'PASS fixture';
END $$;

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;
-- #endregion

-- #region IW-M10 + teams.visibility: the vocabularies are CHECKs
DO $$
BEGIN
    BEGIN
        UPDATE org.enterprise_members SET status = 'invited'
         WHERE enterprise_id = pg_temp.id('ENT') AND user_id = pg_temp.id('CLIENT');
        RAISE EXCEPTION 'FAIL enterprise_members.status accepted ''invited''';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS enterprise_members.status refuses a value outside active · left (23514)';
    END;
    UPDATE org.enterprise_members SET status = 'left'
     WHERE enterprise_id = pg_temp.id('ENT') AND user_id = pg_temp.id('CLIENT');
    UPDATE org.enterprise_members SET status = 'active'
     WHERE enterprise_id = pg_temp.id('ENT') AND user_id = pg_temp.id('CLIENT');
    RAISE NOTICE 'PASS enterprise_members.status takes left and active';
    BEGIN
        UPDATE org.teams SET visibility = 'secret' WHERE id = (SELECT id FROM org.teams ORDER BY slug LIMIT 1);
        RAISE EXCEPTION 'FAIL teams.visibility accepted ''secret''';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS teams.visibility refuses a value outside public · unlisted · invite_only (23514)';
    END;
    PERFORM pg_temp.check('every seeded team already speaks the vocabulary',
        NOT EXISTS (SELECT 1 FROM org.teams WHERE visibility NOT IN ('public', 'unlisted', 'invite_only')),
        'a seeded team does not');
END $$;
-- #endregion

-- #region IW-H2: fn_is_minor fails closed
DO $$
BEGIN
    PERFORM pg_temp.check('an adult with a profile is not a minor', NOT org.fn_is_minor(pg_temp.id('CLIENT')), 'true');
    PERFORM pg_temp.check('a profile-less identity is NOT provably adult', org.fn_is_minor(pg_temp.id('GHOST')), 'false');
    -- Callers pass polymorphic ids (a business profile as a project participant): an id that names no
    -- identity is no person, so it is not judged a minor.
    PERFORM pg_temp.check('an id naming no identity (a team, a business, nobody) stays false',
        NOT org.fn_is_minor((SELECT id FROM org.teams ORDER BY slug LIMIT 1))
        AND NOT org.fn_is_minor((SELECT id FROM org.business_profiles ORDER BY slug LIMIT 1))
        AND NOT org.fn_is_minor(gen_random_uuid()), 'true');
    PERFORM pg_temp.check('a NULL user (no person: a guest, the service role) stays false',
        org.fn_is_minor(NULL) = false, 'not false');
    BEGIN
        PERFORM org.fn_assert_adult(pg_temp.id('GHOST'));
        RAISE EXCEPTION 'FAIL fn_assert_adult admitted a profile-less identity';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS fn_assert_adult refuses a profile-less identity (PM403)';
    END;
    PERFORM org.fn_assert_adult(NULL);
    PERFORM org.fn_assert_adult(pg_temp.id('CLIENT'));
    RAISE NOTICE 'PASS fn_assert_adult still passes the service role and an adult';
    BEGIN
        INSERT INTO org.enterprise_members (enterprise_id, user_id, role, status)
        VALUES (pg_temp.id('ENT'), pg_temp.id('GHOST'), 'member', 'active');
        RAISE EXCEPTION 'FAIL a profile-less identity took an enterprise seat';
    EXCEPTION WHEN SQLSTATE 'PM403' THEN
        RAISE NOTICE 'PASS a profile-less identity takes no enterprise seat (PM403)';
    END;
END $$;
-- #endregion

-- #region IW-L1: an archived enterprise is no context
DO $$
DECLARE
    v_claims jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('CLIENT'));
    PERFORM security.switch_enterprise_context(pg_temp.id('ENT'));
    v_claims := pg_temp.mint(pg_temp.id('CLIENT'));
    PERFORM pg_temp.check('a live enterprise is the minted context',
        v_claims->>'active_enterprise_id' = pg_temp.id('ENT')::text
        AND v_claims->'app_metadata'->'active_context'->>'type' = 'enterprise',
        v_claims::text);

    UPDATE org.enterprises SET status = 'archived' WHERE id = pg_temp.id('ENT');
    v_claims := pg_temp.mint(pg_temp.id('CLIENT'));
    PERFORM pg_temp.check('an archived enterprise is dropped at the next mint',
        jsonb_typeof(v_claims->'active_enterprise_id') = 'null'
        AND v_claims->'app_metadata'->'active_context'->>'type' = 'personal',
        v_claims::text);
    BEGIN
        PERFORM security.switch_enterprise_context(pg_temp.id('ENT'));
        RAISE EXCEPTION 'FAIL switched into an archived enterprise';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS switch_enterprise_context refuses an archived enterprise (42501)';
    END;
END $$;
-- #endregion

-- #region IW-L2: the freelancer slot is re-verified at mint
DO $$
DECLARE
    v_claims jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('SELLER'));
    PERFORM security.switch_session_context('freelancer', pg_temp.id('SELLER'));
    v_claims := pg_temp.mint(pg_temp.id('SELLER'));
    PERFORM pg_temp.check('a live freelancer profile rides the raw claim',
        v_claims->>'active_profile_type' = 'freelancer', v_claims::text);

    -- Given up (00001060 keeps the row for its 90-day window and turns the persona off).
    UPDATE org.users_public SET is_freelancer = false WHERE user_id = pg_temp.id('SELLER');
    v_claims := pg_temp.mint(pg_temp.id('SELLER'));
    PERFORM pg_temp.check('a given-up freelancer profile is dropped at the next mint',
        jsonb_typeof(v_claims->'active_profile_type') = 'null'
        AND jsonb_typeof(v_claims->'active_profile_id') = 'null',
        v_claims::text);
    BEGIN
        PERFORM security.switch_session_context('freelancer', pg_temp.id('SELLER'));
        RAISE EXCEPTION 'FAIL switched into a given-up freelancer profile';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS switch_session_context refuses a given-up freelancer profile (42501)';
    END;

    -- A freelancer slot naming someone else's profile is never honoured either.
    UPDATE org.users_public SET is_freelancer = true WHERE user_id = pg_temp.id('SELLER');
    UPDATE security.session_context SET active_profile_type = 'freelancer', active_profile_id = pg_temp.id('CLIENT')
     WHERE user_id = pg_temp.id('SELLER');
    v_claims := pg_temp.mint(pg_temp.id('SELLER'));
    PERFORM pg_temp.check('a freelancer slot naming another profile is dropped at mint',
        jsonb_typeof(v_claims->'active_profile_type') = 'null', v_claims::text);
END $$;
-- #endregion

ROLLBACK;
