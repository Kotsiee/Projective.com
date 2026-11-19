-- =============================================================================================
-- Probe: search query logs past their retention are deleted daily (OPS4, PRD-G5; finance-model.md
-- §17 ⚖️, ERA2 step 3).
--
--   1. With the seeded dial ({"default": 90}) search.fn_prune_query_logs deletes a 91-day-old row and
--      keeps an 89-day-old one and an undated one, answers how many it deleted, and a second run
--      deletes nothing.
--   2. The dial moves the boundary (30 days takes a 31-day row and keeps a 29-day one; 120 days keeps
--      a 91-day row), p_now moves the clock, and a period longer than the calendar keeps every row.
--   3. A dial that is missing, a string, 0, negative, fractional, null or not an object falls back to
--      90 days and writes one `warn` ops.log_entries row (scope search.retention) per run.
--   4. One run stops after 20 batches and says so; the next run drains the rest and says nothing.
--   5. Only the service role (and pg_cron) may run it: a guest and a signed-in client are refused, no
--      PUBLIC grant exists, and the definer pins an empty search_path.
--   6. The dormant registry row has registered: ops.scheduled_jobs and cron.job run it daily at
--      04:36, and ops.run_job (what `deno task cron:run` calls) runs it by hand.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/query_log_retention.sql
--
-- A clean run prints only PASS notices (and the prune's own WARNINGs from region 3 and 4); any failure
-- raises `FAIL …` and aborts. Each region's writes sit between a SAVEPOINT and a ROLLBACK TO, so no
-- region sees another's rows. Ages are measured from now(), the transaction's start, which is also
-- the prune's clock when p_now is not given.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Fixtures (as postgres)
CREATE FUNCTION pg_temp.qlr_row(p_tag text, p_age interval) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO search.query_logs (search_query, created_at)
    VALUES ('probe-qlr-' || p_tag, CASE WHEN p_age IS NULL THEN NULL ELSE now() - p_age END)
    RETURNING id;
$$;

CREATE FUNCTION pg_temp.qlr_alive(p_tag text) RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (SELECT 1 FROM search.query_logs WHERE search_query = 'probe-qlr-' || p_tag);
$$;

-- Every row older than p_days, the probe's and any the database already holds.
CREATE FUNCTION pg_temp.qlr_due(p_days integer) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM search.query_logs WHERE created_at < now() - make_interval(days => p_days);
$$;

-- The prune's warning rows written in this transaction (created_at defaults to its start).
CREATE FUNCTION pg_temp.qlr_logs(p_reason text) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM ops.log_entries
     WHERE client_id = 'scheduler:search-query-log-retention:' || p_reason
       AND scope = 'search.retention' AND level = 'warn' AND source = 'server'
       AND created_at = now();
$$;

CREATE FUNCTION pg_temp.qlr_dial(p_value jsonb) RETURNS void LANGUAGE sql AS $$
    UPDATE security.platform_params SET value = p_value WHERE key = 'retention_search_query_log_days';
$$;
-- #endregion

-- #region 1. The seeded 90 days: the 91-day row goes, the 89-day and undated rows stay
SAVEPOINT s1;
DO $$
DECLARE
    v_due integer;
    v_n integer;
BEGIN
    IF (SELECT p.value FROM security.platform_params p WHERE p.key = 'retention_search_query_log_days')
       IS DISTINCT FROM '{"default": 90, "by_country": {}}'::jsonb THEN
        RAISE EXCEPTION 'FAIL 1: retention_search_query_log_days is not seeded as {"default": 90, "by_country": {}}';
    END IF;

    PERFORM pg_temp.qlr_row('89d', interval '89 days');
    PERFORM pg_temp.qlr_row('91d', interval '91 days');
    PERFORM pg_temp.qlr_row('undated', NULL);
    v_due := pg_temp.qlr_due(90);

    v_n := search.fn_prune_query_logs();
    IF pg_temp.qlr_alive('91d') THEN
        RAISE EXCEPTION 'FAIL 1: a 91-day-old query log survived the prune';
    END IF;
    IF NOT pg_temp.qlr_alive('89d') THEN
        RAISE EXCEPTION 'FAIL 1: an 89-day-old query log was deleted';
    END IF;
    IF NOT pg_temp.qlr_alive('undated') THEN
        RAISE EXCEPTION 'FAIL 1: a query log with no created_at was given an age and deleted';
    END IF;
    IF pg_temp.qlr_due(90) <> 0 OR v_n <> v_due THEN
        RAISE EXCEPTION 'FAIL 1: % rows were past 90 days, the prune answered % and % remain',
            v_due, v_n, pg_temp.qlr_due(90);
    END IF;

    v_n := search.fn_prune_query_logs();
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'FAIL 1: a second run deleted % more rows', v_n;
    END IF;
    IF pg_temp.qlr_logs('invalid_dial') + pg_temp.qlr_logs('backlog') <> 0 THEN
        RAISE EXCEPTION 'FAIL 1: a run on a valid dial with nothing left over wrote a warning row';
    END IF;
    RAISE NOTICE 'PASS 1: the seeded 90 days take the 91-day row (% deleted) and keep the 89-day and undated rows; a second run deletes nothing', v_due;
END $$;
ROLLBACK TO SAVEPOINT s1;
-- #endregion

-- #region 2. The dial and p_now move the boundary
SAVEPOINT s2;
DO $$
DECLARE
    v_n integer;
BEGIN
    PERFORM pg_temp.qlr_dial('{"default": 30, "by_country": {}}');
    PERFORM pg_temp.qlr_row('29d', interval '29 days');
    PERFORM pg_temp.qlr_row('31d', interval '31 days');
    PERFORM search.fn_prune_query_logs();
    IF pg_temp.qlr_alive('31d') OR NOT pg_temp.qlr_alive('29d') THEN
        RAISE EXCEPTION 'FAIL 2: a 30-day dial kept the 31-day row or took the 29-day one';
    END IF;

    PERFORM pg_temp.qlr_dial('{"default": 120, "by_country": {}}');
    PERFORM pg_temp.qlr_row('91d', interval '91 days');
    PERFORM pg_temp.qlr_row('121d', interval '121 days');
    PERFORM search.fn_prune_query_logs();
    IF NOT pg_temp.qlr_alive('91d') OR pg_temp.qlr_alive('121d') THEN
        RAISE EXCEPTION 'FAIL 2: a 120-day dial took the 91-day row or kept the 121-day one';
    END IF;

    -- Two days on, the 29-day row is 31 days old.
    PERFORM pg_temp.qlr_dial('{"default": 30, "by_country": {}}');
    PERFORM search.fn_prune_query_logs(5000, now() + interval '2 days');
    IF pg_temp.qlr_alive('29d') THEN
        RAISE EXCEPTION 'FAIL 2: with p_now two days on, a 30-day dial kept a row then 31 days old';
    END IF;

    -- Longer than the calendar reaches back: nothing is old enough, and nothing is refused.
    PERFORM pg_temp.qlr_row('ancient', interval '3650 days');
    PERFORM pg_temp.qlr_dial('{"default": 100000000, "by_country": {}}');
    v_n := search.fn_prune_query_logs();
    IF v_n <> 0 OR NOT pg_temp.qlr_alive('ancient') THEN
        RAISE EXCEPTION 'FAIL 2: a dial longer than the calendar deleted % rows', v_n;
    END IF;

    IF pg_temp.qlr_logs('invalid_dial') <> 0 THEN
        RAISE EXCEPTION 'FAIL 2: a valid dial was logged as invalid';
    END IF;
    RAISE NOTICE 'PASS 2: the dial (30, 120, 100000000 days) and p_now move the boundary';
END $$;
ROLLBACK TO SAVEPOINT s2;
-- #endregion

-- #region 3. An invalid dial keeps 90 days and says so
SAVEPOINT s3;
DO $$
DECLARE
    v_bad jsonb[] := ARRAY[
        '{"default": "90", "by_country": {}}',
        '{"default": 0, "by_country": {}}',
        '{"default": -5, "by_country": {}}',
        '{"default": 12.5, "by_country": {}}',
        '{"default": null, "by_country": {}}',
        '{"by_country": {}}',
        '90',
        '"ninety"'
    ]::jsonb[];
    v_logs integer;
    v_row ops.log_entries;
    i integer;
BEGIN
    FOR i IN 1 .. pg_catalog.array_length(v_bad, 1) + 1 LOOP
        IF i <= pg_catalog.array_length(v_bad, 1) THEN
            PERFORM pg_temp.qlr_dial(v_bad[i]);
        ELSE
            DELETE FROM security.platform_params WHERE key = 'retention_search_query_log_days';
        END IF;
        PERFORM pg_temp.qlr_row('89d-' || i, interval '89 days');
        PERFORM pg_temp.qlr_row('91d-' || i, interval '91 days');
        v_logs := pg_temp.qlr_logs('invalid_dial');

        PERFORM search.fn_prune_query_logs();

        IF pg_temp.qlr_alive('91d-' || i) OR NOT pg_temp.qlr_alive('89d-' || i) THEN
            RAISE EXCEPTION 'FAIL 3: the dial % did not fall back to 90 days', COALESCE(v_bad[i]::text, 'missing');
        END IF;
        IF pg_temp.qlr_logs('invalid_dial') <> v_logs + 1 THEN
            RAISE EXCEPTION 'FAIL 3: the dial % wrote % warning rows, not one',
                COALESCE(v_bad[i]::text, 'missing'), pg_temp.qlr_logs('invalid_dial') - v_logs;
        END IF;
        SELECT * INTO v_row FROM ops.log_entries l
         WHERE l.client_id = 'scheduler:search-query-log-retention:invalid_dial' AND l.created_at = now()
           AND l.data -> 'value' IS NOT DISTINCT FROM COALESCE(v_bad[i], 'null'::jsonb);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'FAIL 3: no warning row records the dial %', COALESCE(v_bad[i]::text, 'missing');
        END IF;
        IF v_row.data ->> 'job' IS DISTINCT FROM 'search-query-log-retention'
           OR v_row.data ->> 'reason' IS DISTINCT FROM 'invalid_dial'
           OR v_row.data ->> 'key' IS DISTINCT FROM 'retention_search_query_log_days'
           OR (v_row.data ->> 'fallback_days')::integer IS DISTINCT FROM 90 THEN
            RAISE EXCEPTION 'FAIL 3: the warning row carries %', v_row.data;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS 3: % invalid dials and a missing one each kept 90 days and wrote one warning row',
        pg_catalog.array_length(v_bad, 1);
END $$;
ROLLBACK TO SAVEPOINT s3;
-- #endregion

-- #region 4. One run is capped at 20 batches
SAVEPOINT s4;
DO $$
DECLARE
    v_due integer;
    v_n integer;
    i integer;
BEGIN
    FOR i IN 1 .. 25 LOOP
        PERFORM pg_temp.qlr_row('old-' || i, pg_catalog.make_interval(days => 100 + i));
    END LOOP;
    v_due := pg_temp.qlr_due(90);

    v_n := search.fn_prune_query_logs(1);
    IF v_n <> 20 OR pg_temp.qlr_due(90) <> v_due - 20 THEN
        RAISE EXCEPTION 'FAIL 4: a run in batches of 1 deleted % of % due rows, not 20', v_n, v_due;
    END IF;
    IF pg_temp.qlr_logs('backlog') <> 1 THEN
        RAISE EXCEPTION 'FAIL 4: a run that stopped at its cap with rows still due wrote % backlog rows, not one',
            pg_temp.qlr_logs('backlog');
    END IF;

    v_n := search.fn_prune_query_logs(10);
    IF v_n <> v_due - 20 OR pg_temp.qlr_due(90) <> 0 THEN
        RAISE EXCEPTION 'FAIL 4: the next run deleted % of the % left', v_n, v_due - 20;
    END IF;
    IF pg_temp.qlr_logs('backlog') <> 1 THEN
        RAISE EXCEPTION 'FAIL 4: a run that drained the backlog warned about one';
    END IF;
    RAISE NOTICE 'PASS 4: one run stops at 20 batches and logs the backlog; the next drains the other % rows', v_due - 20;
END $$;
ROLLBACK TO SAVEPOINT s4;
-- #endregion

-- #region 5. Only the service role may run it
DO $$
DECLARE
    v_fn regprocedure := 'search.fn_prune_query_logs(integer, timestamptz)'::regprocedure;
BEGIN
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 5: the prune''s EXECUTE grant is not service_role only';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
                WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 5: PUBLIC holds EXECUTE on the prune';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)) THEN
        RAISE EXCEPTION 'FAIL 5: the prune is not a SECURITY DEFINER pinned to search_path = ''''';
    END IF;
    RAISE NOTICE 'PASS 5: EXECUTE is service_role only, PUBLIC holds none, and the definer pins search_path';
END $$;

SET LOCAL ROLE anon;
DO $$
BEGIN
    PERFORM search.fn_prune_query_logs();
    RAISE EXCEPTION 'FAIL 5: a guest ran the prune';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 5a: a guest cannot run the prune [%]', SQLERRM;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT u.user_id FROM org.users_public u ORDER BY u.user_id LIMIT 1),
                      'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM search.fn_prune_query_logs();
    RAISE EXCEPTION 'FAIL 5: a signed-in client ran the prune';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS 5b: a signed-in client cannot run the prune [%]', SQLERRM;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 6. The job registered, and runs by hand
SAVEPOINT s6;
DO $$
BEGIN
    PERFORM pg_temp.qlr_row('run-job-91d', interval '91 days');
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE
    r jsonb;
BEGIN
    r := ops.run_job('search-query-log-retention');
    IF r ->> 'kind' IS DISTINCT FROM 'sql' OR (r #>> '{result,fn_prune_query_logs}')::integer < 1 THEN
        RAISE EXCEPTION 'FAIL 6: ops.run_job answered % with a 91-day row due', r;
    END IF;
    RAISE NOTICE 'PASS 6a: the job runs by hand through ops.run_job [%]', r;
END $$;
RESET ROLE;
DO $$
BEGIN
    IF pg_temp.qlr_alive('run-job-91d') THEN
        RAISE EXCEPTION 'FAIL 6: the by-hand run left the 91-day row';
    END IF;
END $$;
ROLLBACK TO SAVEPOINT s6;

DO $$
DECLARE
    j ops.scheduled_jobs;
BEGIN
    -- The dormant row matches by name (to_regproc), so an overload would leave the job unregistered.
    IF pg_catalog.to_regproc('search.fn_prune_query_logs') IS NULL THEN
        RAISE EXCEPTION 'FAIL 6: to_regproc cannot resolve search.fn_prune_query_logs by name';
    END IF;
    SELECT * INTO j FROM ops.scheduled_jobs s WHERE s.name = 'search-query-log-retention';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL 6: search-query-log-retention is not registered; reset the database once the function exists';
    END IF;
    IF NOT j.enabled OR j.kind <> 'sql' OR j.schedule <> '36 4 * * *'
       OR j.command <> 'SELECT search.fn_prune_query_logs();' THEN
        RAISE EXCEPTION 'FAIL 6: the job is registered as % / % / % (enabled %)', j.kind, j.schedule, j.command, j.enabled;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job c
                    WHERE c.jobname = 'search-query-log-retention' AND c.active AND c.schedule = '36 4 * * *'
                      AND c.command = ops.fn_job_command('search-query-log-retention')) THEN
        RAISE EXCEPTION 'FAIL 6: pg_cron does not run search-query-log-retention at 04:36';
    END IF;
    RAISE NOTICE 'PASS 6b: search-query-log-retention is registered and pg_cron runs it daily at 04:36';
END $$;
-- #endregion

ROLLBACK;
