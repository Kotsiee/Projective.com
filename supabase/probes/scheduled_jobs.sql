-- =============================================================================================
-- Probe: scheduled work runs in every environment (Decision #203).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing (pg_net only sends a queued
-- request after COMMIT, so nothing leaves the database). Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/scheduled_jobs.sql
--
-- A clean run prints only PASS notices; the first failed check raises `FAIL …` and aborts the run.
-- Checks that write sit between a SAVEPOINT and a ROLLBACK TO, so they never see each other.
-- =============================================================================================

BEGIN;

-- #region 1. Every sweep the platform depends on is registered with pg_cron
-- The contract, by name and cadence. Before #203 the two HTTP sweeps had no job at all, and a
-- registration that failed left only a NOTICE in the migration output. The M3 / M4 sweeps are expected
-- wherever their function exists, matching the seed.
DO $$
DECLARE
    v_expected text[][] := ARRAY[
        ARRAY['finance-billing-cycle',            '20 2 * * *'],
        ARRAY['archive-stale-service-drafts',     '10 3 * * *'],
        ARRAY['auto-release-session-escrow',      '*/15 * * * *'],
        ARRAY['finance-recurring-deposits',       '15 * * * *'],
        ARRAY['account-erasures',                 '10 4 * * *'],
        ARRAY['ops-watch-jobs',                   '*/10 * * * *'],
        ARRAY['analytics-listing-rollups',        '10 2 * * *']
    ];
    v_missing text[] := ARRAY[]::text[];
    i integer;
BEGIN
    IF pg_catalog.to_regprocedure('finance.fn_reconcile_wallets()') IS NOT NULL THEN
        v_expected := v_expected || ARRAY[ARRAY['finance-reconcile-wallets', '40 3 * * *']];
    END IF;
    IF pg_catalog.to_regprocedure('finance.fn_mature_pending_releases(integer)') IS NOT NULL THEN
        v_expected := v_expected || ARRAY[ARRAY['finance-mature-pending-releases', '5 * * * *']];
    END IF;
    IF pg_catalog.to_regprocedure('finance.fn_claim_stale_payouts(integer)') IS NOT NULL THEN
        v_expected := v_expected || ARRAY[ARRAY['finance-sweep-stale-payouts', '*/10 * * * *']];
    END IF;
    IF pg_catalog.to_regprocedure('finance.sweep_disputes(timestamptz)') IS NOT NULL THEN
        v_expected := v_expected || ARRAY[ARRAY['finance-dispute-sweep', '7,22,37,52 * * * *']];
    END IF;
    IF pg_catalog.to_regnamespace('cron') IS NULL THEN
        RAISE EXCEPTION 'FAIL 1: pg_cron is not installed in this database';
    END IF;
    FOR i IN 1 .. pg_catalog.array_length(v_expected, 1) LOOP
        IF NOT EXISTS (
            SELECT 1 FROM cron.job j
             WHERE j.jobname = v_expected[i][1] AND j.schedule = v_expected[i][2] AND j.active
        ) THEN
            v_missing := v_missing || pg_catalog.format('%s (%s)', v_expected[i][1], v_expected[i][2]);
        END IF;
    END LOOP;
    IF pg_catalog.cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION 'FAIL 1: not registered with pg_cron: %', pg_catalog.array_to_string(v_missing, ', ');
    END IF;
    RAISE NOTICE 'PASS 1: all % sweeps are registered at their cadence', pg_catalog.array_length(v_expected, 1);
END $$;
-- #endregion

-- #region 2. The registry and pg_cron agree, row for row
DO $$
DECLARE
    v_drift text;
BEGIN
    SELECT pg_catalog.string_agg(s.name, ', ') INTO v_drift
      FROM ops.scheduled_jobs s
      LEFT JOIN cron.job j ON j.jobname = s.name
     WHERE s.enabled
       AND (j.jobid IS NULL OR j.schedule <> s.schedule OR j.command <> ops.fn_job_command(s.name));
    IF v_drift IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 2: registry and cron.job disagree for %', v_drift;
    END IF;
    IF EXISTS (SELECT 1 FROM ops.scheduled_jobs s JOIN cron.job j ON j.jobname = s.name WHERE NOT s.enabled) THEN
        RAISE EXCEPTION 'FAIL 2: a disabled registry row still has a cron.job';
    END IF;
    RAISE NOTICE 'PASS 2: every enabled registry row has its cron.job with the same schedule and command';
END $$;
-- #endregion

-- #region 3. Changing the registry reschedules; disabling unschedules; a bad cadence is refused
SAVEPOINT s3;
DO $$
BEGIN
    UPDATE ops.scheduled_jobs SET schedule = '25 2 * * *' WHERE name = 'finance-billing-cycle';
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-billing-cycle' AND schedule = '25 2 * * *') THEN
        RAISE EXCEPTION 'FAIL 3a: a schedule UPDATE did not reach cron.job';
    END IF;

    UPDATE ops.scheduled_jobs SET enabled = false WHERE name = 'finance-billing-cycle';
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-billing-cycle') THEN
        RAISE EXCEPTION 'FAIL 3b: disabling a job left its cron.job behind';
    END IF;

    UPDATE ops.scheduled_jobs SET enabled = true WHERE name = 'finance-billing-cycle';
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finance-billing-cycle' AND schedule = '25 2 * * *') THEN
        RAISE EXCEPTION 'FAIL 3c: re-enabling a job did not schedule it';
    END IF;

    BEGIN
        UPDATE ops.scheduled_jobs SET schedule = 'every so often' WHERE name = 'finance-billing-cycle';
        RAISE EXCEPTION 'FAIL 3d: an invalid cron expression was accepted';
    EXCEPTION WHEN invalid_parameter_value THEN
        NULL;
    END;
    RAISE NOTICE 'PASS 3: the registry drives pg_cron (reschedule, disable, re-enable, invalid refused)';
END $$;
ROLLBACK TO s3;
-- #endregion

-- #region 4. An HTTP sweep with no Vault configuration skips LOUDLY and sends nothing
SAVEPOINT s4;
DO $$
DECLARE
    v_queued bigint := (SELECT pg_catalog.count(*) FROM net.http_request_queue);
    v_logged bigint;
    v_id bigint;
BEGIN
    DELETE FROM vault.secrets WHERE name IN ('CRON_APP_URL', 'FINANCE_CRON_SECRET');
    DELETE FROM ops.log_entries WHERE scope = 'ops.scheduler';

    v_id := ops.fn_dispatch_http_job('finance-recurring-deposits');
    IF v_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 4a: dispatched without a configured base URL (request %)', v_id;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM net.http_request_queue) <> v_queued THEN
        RAISE EXCEPTION 'FAIL 4b: a skipped dispatch still queued a request';
    END IF;
    SELECT pg_catalog.count(*) INTO v_logged FROM ops.log_entries
     WHERE scope = 'ops.scheduler' AND level = 'warn'
       AND client_id = 'scheduler:finance-recurring-deposits:app_url_missing';
    IF v_logged <> 1 THEN
        RAISE EXCEPTION 'FAIL 4c: expected one ops row for the skip, found %', v_logged;
    END IF;

    PERFORM ops.fn_dispatch_http_job('finance-recurring-deposits');
    SELECT pg_catalog.count(*) INTO v_logged FROM ops.log_entries
     WHERE client_id = 'scheduler:finance-recurring-deposits:app_url_missing';
    IF v_logged <> 1 THEN
        RAISE EXCEPTION 'FAIL 4d: a repeated skip within a day logged % rows (want 1)', v_logged;
    END IF;

    PERFORM vault.create_secret('http://host.docker.internal:3000', 'CRON_APP_URL');
    PERFORM vault.create_secret('XXXX-XXXX', 'FINANCE_CRON_SECRET');
    v_id := ops.fn_dispatch_http_job('finance-recurring-deposits');
    IF v_id IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM ops.log_entries
                       WHERE client_id = 'scheduler:finance-recurring-deposits:secret_missing') THEN
        RAISE EXCEPTION 'FAIL 4e: a placeholder bearer was not treated as missing';
    END IF;
    RAISE NOTICE 'PASS 4: unconfigured HTTP sweeps skip with a WARNING and one ops row a day, and queue nothing';
END $$;
ROLLBACK TO s4;
-- #endregion

-- #region 5. A configured HTTP sweep queues the right request, and its outcome is settled
SAVEPOINT s5;
DO $$
DECLARE
    v_bearer CONSTANT text := 'probe-bearer-0123456789-0123456789-abcdef';
    v_ok bigint;
    v_bad bigint;
    v_req record;
    v_failures integer;
BEGIN
    DELETE FROM vault.secrets WHERE name IN ('CRON_APP_URL', 'FINANCE_CRON_SECRET', 'ACCOUNT_CRON_SECRET');
    PERFORM vault.create_secret('http://host.docker.internal:3000/', 'CRON_APP_URL');
    PERFORM vault.create_secret(v_bearer, 'FINANCE_CRON_SECRET');
    PERFORM vault.create_secret(v_bearer, 'ACCOUNT_CRON_SECRET');

    v_ok := ops.fn_dispatch_http_job('finance-recurring-deposits');
    v_bad := ops.fn_dispatch_http_job('account-erasures');
    IF v_ok IS NULL OR v_bad IS NULL THEN
        RAISE EXCEPTION 'FAIL 5a: a configured dispatch returned no request id';
    END IF;

    SELECT q.method, q.url, q.headers ->> 'Authorization' AS auth INTO v_req
      FROM net.http_request_queue q WHERE q.id = v_ok;
    IF v_req.method <> 'POST'
       OR v_req.url <> 'http://host.docker.internal:3000/api/finance/cron/deposits?limit=50'
       OR v_req.auth <> 'Bearer ' || v_bearer THEN
        RAISE EXCEPTION 'FAIL 5b: queued % % (auth %)', v_req.method, v_req.url, v_req.auth;
    END IF;
    IF (SELECT pg_catalog.count(*) FROM ops.http_job_dispatches WHERE request_id IN (v_ok, v_bad) AND settled_at IS NULL) <> 2 THEN
        RAISE EXCEPTION 'FAIL 5c: dispatches were not recorded as pending';
    END IF;

    INSERT INTO net._http_response (id, status_code, content, timed_out, created)
    VALUES (v_ok, 200, '{"ok":true}', false, pg_catalog.now()),
           (v_bad, 404, '', false, pg_catalog.now());
    DELETE FROM ops.log_entries WHERE scope = 'ops.scheduler';

    v_failures := ops.fn_settle_http_dispatches();
    IF v_failures <> 1 THEN
        RAISE EXCEPTION 'FAIL 5d: settle reported % failures (want 1)', v_failures;
    END IF;
    IF EXISTS (SELECT 1 FROM ops.http_job_dispatches WHERE request_id IN (v_ok, v_bad) AND settled_at IS NULL) THEN
        RAISE EXCEPTION 'FAIL 5e: an answered dispatch is still pending';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.log_entries
                    WHERE scope = 'ops.scheduler' AND level = 'error'
                      AND client_id = 'scheduler:account-erasures:http_failed'
                      AND (data ->> 'status_code')::integer = 404) THEN
        RAISE EXCEPTION 'FAIL 5f: a 404 from the erasure route was not logged as an error';
    END IF;
    IF EXISTS (SELECT 1 FROM ops.log_entries WHERE client_id LIKE 'scheduler:finance-recurring-deposits:%') THEN
        RAISE EXCEPTION 'FAIL 5g: a 200 was logged as a failure';
    END IF;

    UPDATE ops.http_job_dispatches SET dispatched_at = pg_catalog.now() - interval '8 hours', settled_at = NULL
     WHERE request_id = v_ok;
    DELETE FROM net._http_response WHERE id = v_ok;
    v_failures := ops.fn_settle_http_dispatches();
    IF v_failures <> 1
       OR NOT EXISTS (SELECT 1 FROM ops.log_entries WHERE client_id = 'scheduler:finance-recurring-deposits:no_response') THEN
        RAISE EXCEPTION 'FAIL 5h: a dispatch with no response past the pg_net TTL was not reported';
    END IF;
    RAISE NOTICE 'PASS 5: the queued request carries the Vault bearer; non-2xx and lost responses are logged as errors';
END $$;
ROLLBACK TO s5;
-- #endregion

-- #region 6. Manual runs: service role only, unknown names refused
SAVEPOINT s6;
DO $$
DECLARE
    v_result jsonb;
BEGIN
    IF pg_catalog.has_function_privilege('authenticated', 'ops.run_job(text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'ops.run_job(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 6a: ops.run_job is executable by a client role';
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', 'ops.run_job(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 6b: the service role cannot run a job by hand';
    END IF;
    IF pg_catalog.has_function_privilege('service_role', 'ops.fn_dispatch_http_job(text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', 'ops.fn_schedule_job(text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'ops.fn_watch_jobs()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 6c: an internal scheduler function is directly executable';
    END IF;

    v_result := ops.run_job('ops-watch-jobs');
    IF v_result ->> 'kind' <> 'sql' OR NOT (v_result ? 'result') THEN
        RAISE EXCEPTION 'FAIL 6d: run_job returned %', v_result;
    END IF;

    BEGIN
        PERFORM ops.run_job('no-such-job');
        RAISE EXCEPTION 'FAIL 6e: an unknown job name was accepted';
    EXCEPTION WHEN SQLSTATE 'PJ404' THEN
        NULL;
    END;
    RAISE NOTICE 'PASS 6: ops.run_job is the service role''s, runs a SQL job and refuses an unknown name';
END $$;
ROLLBACK TO s6;
-- #endregion

-- #region 7. A sql job that fails is reported once, not left in cron.job_run_details
SAVEPOINT s7;
DO $$
DECLARE
    v_jobid bigint := (SELECT jobid FROM cron.job WHERE jobname = 'finance-billing-cycle');
    v_runid bigint;
BEGIN
    DELETE FROM ops.log_entries WHERE scope = 'ops.scheduler';
    INSERT INTO cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
    VALUES (v_jobid, (SELECT COALESCE(pg_catalog.max(runid), 0) + 1000 FROM cron.job_run_details), 0, 'postgres', 'postgres',
            'SELECT finance.fn_run_billing_cycle();', 'failed', 'ERROR:  probe failure', pg_catalog.now(), pg_catalog.now())
    RETURNING runid INTO v_runid;

    IF ops.fn_report_failed_runs() < 1 THEN
        RAISE EXCEPTION 'FAIL 7a: a failed run was not reported';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.log_entries
                    WHERE client_id = 'scheduler:finance-billing-cycle:run_failed' AND level = 'error'
                      AND data ->> 'run_id' = v_runid::text) THEN
        RAISE EXCEPTION 'FAIL 7b: no ops error row carries run %', v_runid;
    END IF;
    IF ops.fn_report_failed_runs() <> 0 THEN
        RAISE EXCEPTION 'FAIL 7c: a failed run was reported twice';
    END IF;
    RAISE NOTICE 'PASS 7: a failed pg_cron run becomes one ops error row';
END $$;
ROLLBACK TO s7;
-- #endregion

ROLLBACK;
