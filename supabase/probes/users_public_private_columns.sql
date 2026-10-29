-- =============================================================================================
-- Probe: org.users_public private columns (00002520, IDENTITY_AND_WORKSPACES_AUDIT IW-C1). A
-- signed-in account reads another person's name and handle but never their dob · city · country ·
-- timezone, not even through `*`; a guest reads nothing; the owner reads their own date of birth
-- and zone through org.get_own_private_profile, which answers for nobody else.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/users_public_private_columns.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Grants (as postgres)
DO $$
DECLARE
    v_col text;
BEGIN
    FOREACH v_col IN ARRAY ARRAY['dob', 'city', 'country', 'timezone'] LOOP
        IF has_column_privilege('authenticated', 'org.users_public', v_col, 'SELECT') THEN
            RAISE EXCEPTION 'FAIL authenticated can SELECT users_public.%', v_col;
        END IF;
    END LOOP;
    IF NOT has_column_privilege('authenticated', 'org.users_public', 'username', 'SELECT') THEN
        RAISE EXCEPTION 'FAIL authenticated lost SELECT on users_public.username';
    END IF;
    IF has_table_privilege('anon', 'org.users_public', 'SELECT')
       OR has_column_privilege('anon', 'org.users_public', 'username', 'SELECT') THEN
        RAISE EXCEPTION 'FAIL anon can SELECT org.users_public';
    END IF;
    IF has_function_privilege('anon', 'org.get_own_private_profile()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL anon can execute org.get_own_private_profile';
    END IF;
    RAISE NOTICE 'PASS private columns ungranted, public columns granted, guest holds nothing';
END $$;
-- #endregion

-- #region 1. Fixtures (as postgres): two seeded people
DO $$
DECLARE
    v_me uuid;
    v_other uuid;
BEGIN
    SELECT u.user_id INTO v_me FROM org.users_public u ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_other FROM org.users_public u WHERE u.user_id <> v_me ORDER BY u.user_id LIMIT 1;
    IF v_other IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: need two seeded users (deno task db:reset)'; END IF;
    PERFORM set_config('probe.me', v_me::text, true);
    PERFORM set_config('probe.other', v_other::text, true);
    PERFORM set_config('probe.my_dob', (SELECT u.dob::text FROM org.users_public u WHERE u.user_id = v_me), true);
END $$;
-- #endregion

-- #region 2. A signed-in reader
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.me'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_other uuid := current_setting('probe.other')::uuid;
    v_col text;
    v_name text;
    v_rows integer;
    v_dob date;
BEGIN
    FOREACH v_col IN ARRAY ARRAY['dob', 'city', 'country', 'timezone', '*'] LOOP
        BEGIN
            EXECUTE format('SELECT %s FROM org.users_public WHERE user_id = $1', v_col) USING v_other;
            RAISE EXCEPTION 'FAIL a reader selected % of another person', v_col;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS % of another person refused', v_col;
        END;
    END LOOP;

    SELECT u.username INTO v_name FROM org.users_public u WHERE u.user_id = v_other;
    IF v_name IS NULL THEN RAISE EXCEPTION 'FAIL a reader lost another person''s handle'; END IF;
    RAISE NOTICE 'PASS another person''s handle still reads';

    SELECT count(*), max(p.dob) INTO v_rows, v_dob FROM org.get_own_private_profile() p;
    IF v_rows <> 1 OR v_dob::text IS DISTINCT FROM current_setting('probe.my_dob') THEN
        RAISE EXCEPTION 'FAIL get_own_private_profile answered % row(s), dob %', v_rows, v_dob;
    END IF;
    RAISE NOTICE 'PASS the owner reads their own date of birth';
END $$;

-- The same door answers nothing to someone with no profile row.
SELECT set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM org.get_own_private_profile()) THEN
        RAISE EXCEPTION 'FAIL get_own_private_profile answered for a caller with no row';
    END IF;
    RAISE NOTICE 'PASS get_own_private_profile answers only for the caller''s own row';
END $$;

RESET ROLE;
-- #endregion

ROLLBACK;
