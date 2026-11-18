-- =============================================================================================
-- Probe: search query telemetry is attributed to the caller and nobody else (PRD-C8, SEC G13).
-- `search.fn_log_query` takes no user id: it writes `auth.uid()`, which is NULL for a guest and NULL
-- for a minor, whose query vector it also drops (Decision #208). No client role can INSERT
-- `search.query_logs` directly, so the definer is the table's only writer.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded
-- local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/search_query_log_attribution.sql
--
-- Each role block records its outcome in a `probe.*` setting, and the blocks run as `postgres`
-- judge those outcomes. Every finding is collected, and the last block raises once listing them all.
-- A clean run raises nothing.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres): two seeded adults, a 16-year-old, a query vector
-- The legal stamp every sign-up door requires (Decision #446): today's version of each document.
CREATE FUNCTION pg_temp.legal_stamp() RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object(
        'terms', org.fn_current_legal_version('terms'),
        'acceptable-use', org.fn_current_legal_version('acceptable-use'),
        'privacy', org.fn_current_legal_version('privacy'));
$$;

-- Appends one finding; only ever called as postgres.
CREATE FUNCTION pg_temp.fail(p_msg text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('probe.failures', current_setting('probe.failures') || E'\n  FAIL ' || p_msg, true);
$$;

DO $$
DECLARE
    v_noor uuid;
    v_theo uuid;
    v_teen uuid := gen_random_uuid();
    v_tag text := substr(md5(random()::text), 1, 8);
BEGIN
    SELECT user_id INTO v_noor FROM org.users_public WHERE username = 'noor';
    SELECT user_id INTO v_theo FROM org.users_public WHERE username = 'theo';
    IF v_noor IS NULL OR v_theo IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need the seeded personas noor and theo (deno task db:reset)';
    END IF;

    -- No seeded persona is a minor, so the probe provisions one through the real sign-up door.
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v_teen, 'sac2-probe-' || v_teen || '@projective.invalid', 'authenticated', 'authenticated',
            '{}'::jsonb, now());
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_teen, 'role', 'authenticated')::text, true);
    PERFORM public.complete_onboarding(jsonb_build_object(
        'legal_acceptance', pg_temp.legal_stamp(), 'username', 'sac2probe_teen_' || v_tag,
        'dob', (CURRENT_DATE - interval '16 years')::date, 'timezone', 'UTC'));
    IF NOT org.fn_is_minor(v_teen) THEN
        RAISE EXCEPTION 'FAIL fixture: the 16-year-old is not classed a minor';
    END IF;

    PERFORM set_config('probe.failures', '', true);
    PERFORM set_config('probe.noor', v_noor::text, true);
    PERFORM set_config('probe.theo', v_theo::text, true);
    PERFORM set_config('probe.teen', v_teen::text, true);
    PERFORM set_config('probe.tag', 'sac2-probe-' || v_tag, true);
    -- A text literal, so the role blocks cast it through the type's input function and call nothing.
    PERFORM set_config('probe.vec', '[' || array_to_string(array_fill(0.01::real, ARRAY[1024]), ',') || ']', true);
END $$;
-- #endregion

-- #region 1. The function's shape: no user id, a pinned empty search_path
DO $$
DECLARE
    v_fn record;
BEGIN
    SELECT p.prosecdef, p.proconfig, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
           'uuid'::regtype::oid = ANY (p.proargtypes::oid[]) AS takes_uuid
      INTO v_fn
      FROM pg_catalog.pg_proc p
     WHERE p.oid = 'search.fn_log_query'::regproc;
    IF v_fn.takes_uuid THEN
        PERFORM pg_temp.fail('search.fn_log_query takes a uuid argument: (' || v_fn.args || ')');
    END IF;
    IF NOT v_fn.prosecdef THEN
        PERFORM pg_temp.fail('search.fn_log_query is not SECURITY DEFINER');
    END IF;
    IF v_fn.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
        PERFORM pg_temp.fail('search.fn_log_query pins ' || coalesce(v_fn.proconfig::text, 'no search_path')
            || ', not search_path = ''''');
    END IF;
END $$;
-- #endregion

-- #region 2. A guest (anon)
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
    -- 2a. Naming another person: the parameter no longer exists.
    BEGIN
        PERFORM search.fn_log_query(
            p_query => current_setting('probe.tag') || '-anon-named', p_entity_type => 'all',
            p_filters => '{}'::jsonb, p_result_count => 3, p_duration_ms => 12, p_candidate_pool => 10,
            p_user_id => current_setting('probe.noor')::uuid);
        PERFORM set_config('probe.anon_named', 'accepted', true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('probe.anon_named', SQLSTATE, true);
    END;

    -- 2b. Logging as themselves: a row with no user.
    BEGIN
        PERFORM search.fn_log_query(
            p_query => current_setting('probe.tag') || '-anon', p_entity_type => 'all',
            p_filters => '{}'::jsonb, p_result_count => 3, p_duration_ms => 12, p_candidate_pool => 10);
        PERFORM set_config('probe.anon_own', 'accepted', true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('probe.anon_own', SQLSTATE || ' ' || SQLERRM, true);
    END;

    -- 2c. The table door: a direct INSERT in another person's name.
    BEGIN
        INSERT INTO search.query_logs (user_id, search_query)
        VALUES (current_setting('probe.noor')::uuid, current_setting('probe.tag') || '-anon-direct');
        PERFORM set_config('probe.anon_direct', 'accepted', true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('probe.anon_direct', SQLSTATE, true);
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 3. A signed-in adult (noor)
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.noor'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    -- 3a. Their own search, with a query vector: attributed to them, vector kept.
    BEGIN
        PERFORM search.fn_log_query(
            p_query => current_setting('probe.tag') || '-noor', p_entity_type => 'service',
            p_filters => '{"sort":"best"}'::jsonb, p_result_count => 4, p_duration_ms => 20,
            p_candidate_pool => 8, p_query_embedding => current_setting('probe.vec')::public.vector);
        PERFORM set_config('probe.noor_own', 'accepted', true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('probe.noor_own', SQLSTATE || ' ' || SQLERRM, true);
    END;

    -- 3b. Naming another person (theo).
    BEGIN
        PERFORM search.fn_log_query(
            p_query => current_setting('probe.tag') || '-noor-named', p_entity_type => 'all',
            p_filters => '{}'::jsonb, p_result_count => 1, p_duration_ms => 5, p_candidate_pool => 2,
            p_user_id => current_setting('probe.theo')::uuid);
        PERFORM set_config('probe.noor_named', 'accepted', true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('probe.noor_named', SQLSTATE, true);
    END;

    -- 3c. The table door, in their own name: the definer is the only writer.
    BEGIN
        INSERT INTO search.query_logs (user_id, search_query)
        VALUES (current_setting('probe.noor')::uuid, current_setting('probe.tag') || '-noor-direct');
        PERFORM set_config('probe.noor_direct', 'accepted', true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('probe.noor_direct', SQLSTATE, true);
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 4. A signed-in minor (the 16-year-old)
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.teen'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    BEGIN
        PERFORM search.fn_log_query(
            p_query => current_setting('probe.tag') || '-teen', p_entity_type => 'all',
            p_filters => '{}'::jsonb, p_result_count => 2, p_duration_ms => 9, p_candidate_pool => 6,
            p_query_embedding => current_setting('probe.vec')::public.vector);
        PERFORM set_config('probe.teen_own', 'accepted', true);
    EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('probe.teen_own', SQLSTATE || ' ' || SQLERRM, true);
    END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 5. Verdicts (as postgres)
DO $$
DECLARE
    v_tag text := current_setting('probe.tag');
    v_noor uuid := current_setting('probe.noor')::uuid;
    v_row record;
    v_n integer;
BEGIN
    -- 2a
    IF current_setting('probe.anon_named') = 'accepted' THEN
        SELECT count(*) INTO v_n FROM search.query_logs WHERE search_query = v_tag || '-anon-named' AND user_id = v_noor;
        PERFORM pg_temp.fail(format('a guest call naming p_user_id = noor was accepted; %s row(s) landed in noor''s name', v_n));
    ELSIF current_setting('probe.anon_named') <> '42883' THEN
        PERFORM pg_temp.fail('a guest call naming p_user_id answered ' || current_setting('probe.anon_named') || ', not 42883');
    END IF;

    -- 2b
    IF current_setting('probe.anon_own') <> 'accepted' THEN
        PERFORM pg_temp.fail('a guest search was not logged: ' || current_setting('probe.anon_own'));
    ELSE
        SELECT count(*) FILTER (WHERE user_id IS NULL) AS anonymous, count(*) AS total INTO v_row
          FROM search.query_logs WHERE search_query = v_tag || '-anon';
        IF v_row.total <> 1 OR v_row.anonymous <> 1 THEN
            PERFORM pg_temp.fail(format('a guest search wrote %s row(s), %s with user_id NULL; want exactly 1 and 1',
                v_row.total, v_row.anonymous));
        END IF;
    END IF;

    -- 2c
    IF current_setting('probe.anon_direct') = 'accepted' THEN
        PERFORM pg_temp.fail('a guest INSERT into search.query_logs landed a row in noor''s name');
    ELSIF current_setting('probe.anon_direct') <> '42501' THEN
        PERFORM pg_temp.fail('a guest INSERT into search.query_logs answered ' || current_setting('probe.anon_direct') || ', not 42501');
    END IF;

    -- 3a
    IF current_setting('probe.noor_own') <> 'accepted' THEN
        PERFORM pg_temp.fail('noor''s search was not logged: ' || current_setting('probe.noor_own'));
    ELSE
        SELECT q.user_id, q.query_embedding IS NOT NULL AS has_vector, q.matched_density, count(*) OVER () AS total
          INTO v_row FROM search.query_logs q WHERE q.search_query = v_tag || '-noor';
        IF coalesce(v_row.total, 0) <> 1 OR v_row.user_id IS DISTINCT FROM v_noor OR NOT v_row.has_vector
           OR v_row.matched_density IS DISTINCT FROM 0.5000 THEN
            PERFORM pg_temp.fail(format('noor''s search logged %s row(s) as %s, vector %s, density %s; want 1 as noor, a vector, 0.5000',
                v_row.total, coalesce(v_row.user_id::text, 'NULL'), v_row.has_vector, v_row.matched_density));
        END IF;
    END IF;

    -- 3b
    IF current_setting('probe.noor_named') = 'accepted' THEN
        PERFORM pg_temp.fail('noor''s call naming p_user_id = theo was accepted');
    ELSIF current_setting('probe.noor_named') <> '42883' THEN
        PERFORM pg_temp.fail('noor''s call naming p_user_id answered ' || current_setting('probe.noor_named') || ', not 42883');
    END IF;

    -- 3c
    IF current_setting('probe.noor_direct') = 'accepted' THEN
        PERFORM pg_temp.fail('an authenticated INSERT into search.query_logs was accepted');
    ELSIF current_setting('probe.noor_direct') <> '42501' THEN
        PERFORM pg_temp.fail('an authenticated INSERT into search.query_logs answered ' || current_setting('probe.noor_direct') || ', not 42501');
    END IF;

    -- 4
    IF current_setting('probe.teen_own') <> 'accepted' THEN
        PERFORM pg_temp.fail('the minor''s search was refused: ' || current_setting('probe.teen_own'));
    ELSE
        SELECT count(*) AS total, count(*) FILTER (WHERE user_id IS NULL AND query_embedding IS NULL) AS anonymous
          INTO v_row FROM search.query_logs WHERE search_query = v_tag || '-teen';
        IF v_row.total <> 1 OR v_row.anonymous <> 1 THEN
            PERFORM pg_temp.fail(format('the minor''s search wrote %s row(s), %s with no user and no vector; want 1 and 1',
                v_row.total, v_row.anonymous));
        END IF;
    END IF;

    -- The grants and policies behind 2c and 3c.
    IF has_table_privilege('anon', 'search.query_logs', 'INSERT')
       OR has_table_privilege('authenticated', 'search.query_logs', 'INSERT') THEN
        PERFORM pg_temp.fail('anon or authenticated holds INSERT on search.query_logs');
    END IF;
    SELECT count(*) INTO v_n FROM pg_catalog.pg_policies
     WHERE schemaname = 'search' AND tablename = 'query_logs' AND cmd IN ('INSERT', 'ALL');
    IF v_n > 0 THEN
        PERFORM pg_temp.fail(format('search.query_logs has %s INSERT-capable polic(ies); the definer is meant to be its only writer', v_n));
    END IF;

    IF current_setting('probe.failures') <> '' THEN
        RAISE EXCEPTION 'FAIL search_query_log_attribution, % finding(s):%',
            length(current_setting('probe.failures')) - length(replace(current_setting('probe.failures'), E'\n', '')),
            current_setting('probe.failures');
    END IF;
    RAISE NOTICE 'PASS search telemetry is attributed to the caller and nobody else';
END $$;
-- #endregion

ROLLBACK;
