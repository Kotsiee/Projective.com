-- =============================================================================================
-- 00001650_functions_ops_scheduler.sql — the job registry's machinery (Category 1, Decision #203).
-- `ops.scheduled_jobs` (00000013) lists every recurring job. These functions turn a row into a
-- pg_cron job, dispatch the HTTP sweeps through pg_net with a bearer read from Vault, settle their
-- responses, and let the service role run any job by hand (`deno task cron:run <job>`). A skip or a
-- failure is never silent: it raises a WARNING and writes an `ops.log_entries` row
-- (`scope = 'ops.scheduler'`, `client_id = 'scheduler:<job>:<reason>'`).
-- Triggers in 00001897, grants in 00002510, the jobs themselves in 00005060.
-- =============================================================================================

-- #region 1. The scheduler's log
CREATE OR REPLACE FUNCTION ops.fn_log_scheduler_event (
    p_job text,
    p_reason text,
    p_level text,
    p_message text,
    p_data jsonb DEFAULT '{}'::jsonb,
    p_once_a_day boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_client_id text := pg_catalog.format('scheduler:%s:%s', p_job, p_reason);
BEGIN
    RAISE WARNING '[ops.scheduler] %: %', p_job, p_message;

    IF p_once_a_day AND EXISTS (
        SELECT 1
          FROM ops.log_entries l
         WHERE l.client_id = v_client_id
           AND l.created_at > pg_catalog.now() - interval '1 day'
    ) THEN
        RETURN;
    END IF;

    INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
    VALUES (
        v_client_id,
        p_level,
        p_message,
        pg_catalog.now(),
        'server',
        'ops.scheduler',
        COALESCE(p_data, '{}'::jsonb) || pg_catalog.jsonb_build_object('job', p_job, 'reason', p_reason)
    );
END;
$$;

COMMENT ON FUNCTION ops.fn_log_scheduler_event(text, text, text, text, jsonb, boolean) IS
'Raises a WARNING and writes one ops.log_entries row (scope ops.scheduler) for a scheduler skip or
failure. p_once_a_day collapses a repeating configuration skip to one row per job and reason a day;
the WARNING is raised every time.';
-- #endregion

-- #region 2. Registration
CREATE OR REPLACE FUNCTION ops.fn_job_command (p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE j.kind
               WHEN 'sql' THEN j.command
               ELSE pg_catalog.format('SELECT ops.fn_dispatch_http_job(%L);', j.name)
           END
      FROM ops.scheduled_jobs j
     WHERE j.name = p_name;
$$;

COMMENT ON FUNCTION ops.fn_job_command(text) IS
'The command pg_cron runs for a registry row: the row''s own SELECT for a sql job, the pg_net
dispatcher for an http job.';

CREATE OR REPLACE FUNCTION ops.fn_unschedule_job (p_name text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF pg_catalog.to_regnamespace('cron') IS NULL THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = p_name) THEN
        PERFORM cron.unschedule(p_name);
    END IF;
END;
$$;

COMMENT ON FUNCTION ops.fn_unschedule_job(text) IS
'Removes a job from pg_cron by name; a no-op where pg_cron is absent or the job is not scheduled.';

CREATE OR REPLACE FUNCTION ops.fn_schedule_job (p_name text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job ops.scheduled_jobs%ROWTYPE;
BEGIN
    SELECT * INTO v_job FROM ops.scheduled_jobs j WHERE j.name = p_name;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown scheduled job %', p_name USING ERRCODE = 'PJ404';
    END IF;

    IF pg_catalog.to_regnamespace('cron') IS NULL THEN
        PERFORM ops.fn_log_scheduler_event(
            p_name, 'pg_cron_unavailable', 'warn',
            pg_catalog.format('pg_cron is not installed, so %s (%s UTC) is not scheduled. Run it with `deno task cron:run %s`.',
                p_name, v_job.schedule, p_name),
            pg_catalog.jsonb_build_object('schedule', v_job.schedule)
        );
        RETURN false;
    END IF;

    IF NOT v_job.enabled THEN
        PERFORM ops.fn_unschedule_job(p_name);
        RETURN false;
    END IF;

    BEGIN
        PERFORM cron.schedule(p_name, v_job.schedule, ops.fn_job_command(p_name));
    EXCEPTION
        WHEN invalid_parameter_value THEN
            RAISE EXCEPTION 'Invalid cron schedule % for job %: %', v_job.schedule, p_name, SQLERRM
                USING ERRCODE = 'invalid_parameter_value',
                      HINT = 'Five fields, UTC, e.g. ''15 * * * *''.';
        WHEN OTHERS THEN
            PERFORM ops.fn_log_scheduler_event(
                p_name, 'schedule_failed', 'error',
                pg_catalog.format('cron.schedule refused %s: %s (SQLSTATE %s)', p_name, SQLERRM, SQLSTATE),
                pg_catalog.jsonb_build_object('schedule', v_job.schedule, 'sqlstate', SQLSTATE)
            );
            RETURN false;
    END;
    RETURN true;
END;
$$;

COMMENT ON FUNCTION ops.fn_schedule_job(text) IS
'Applies one ops.scheduled_jobs row to pg_cron (cron.schedule upserts by name; a disabled row is
unscheduled). An invalid cron expression is refused with the write. A missing pg_cron or a refused
cron.schedule never blocks the caller: it is logged (WARNING + ops row) and returns false.';

CREATE OR REPLACE FUNCTION ops.fn_touch_updated_at ()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ops.tg_scheduled_jobs_apply ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM ops.fn_unschedule_job(OLD.name);
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.name <> NEW.name THEN
        PERFORM ops.fn_unschedule_job(OLD.name);
    END IF;
    PERFORM ops.fn_schedule_job(NEW.name);
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION ops.tg_scheduled_jobs_apply() IS
'AFTER INSERT/UPDATE/DELETE on ops.scheduled_jobs: keeps pg_cron in step with the registry, so an
UPDATE of schedule or enabled is the whole act of changing a cadence or pausing a job.';
-- #endregion

-- #region 3. HTTP dispatch (pg_net + Vault)
-- The bearer and the app origin live in Vault, never in a migration: `CRON_APP_URL` (the origin the
-- DATABASE reaches the app on) and the row's `secret_name`, which is also the app's env key, so the
-- route and the dispatcher compare the same value. Anything missing skips the run loudly, once a day.
CREATE OR REPLACE FUNCTION ops.fn_dispatch_http_job (p_name text)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job ops.scheduled_jobs%ROWTYPE;
    v_base text;
    v_bearer text;
    v_request bigint;
BEGIN
    SELECT * INTO v_job FROM ops.scheduled_jobs j WHERE j.name = p_name AND j.kind = 'http';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown HTTP job %', p_name USING ERRCODE = 'PJ404';
    END IF;

    IF pg_catalog.to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
        PERFORM ops.fn_log_scheduler_event(p_name, 'pg_net_unavailable', 'warn',
            pg_catalog.format('pg_net is not installed, so %s did not run.', p_name), '{}'::jsonb, true);
        RETURN NULL;
    END IF;
    IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL THEN
        PERFORM ops.fn_log_scheduler_event(p_name, 'vault_unavailable', 'warn',
            pg_catalog.format('Supabase Vault is not installed, so %s has no bearer and did not run.', p_name),
            '{}'::jsonb, true);
        RETURN NULL;
    END IF;

    SELECT s.decrypted_secret INTO v_base FROM vault.decrypted_secrets s WHERE s.name = 'CRON_APP_URL';
    IF v_base IS NULL OR v_base !~ '^https?://[^/\s]+' THEN
        PERFORM ops.fn_log_scheduler_event(p_name, 'app_url_missing', 'warn',
            pg_catalog.format('Vault secret CRON_APP_URL is not an http(s) origin, so %s did not run.', p_name),
            '{}'::jsonb, true);
        RETURN NULL;
    END IF;

    SELECT s.decrypted_secret INTO v_bearer FROM vault.decrypted_secrets s WHERE s.name = v_job.secret_name;
    IF v_bearer IS NULL OR pg_catalog.length(v_bearer) < 32 THEN
        PERFORM ops.fn_log_scheduler_event(p_name, 'secret_missing', 'warn',
            pg_catalog.format('Vault secret %s is missing or shorter than 32 characters, so %s did not run.',
                v_job.secret_name, p_name),
            pg_catalog.jsonb_build_object('secret_name', v_job.secret_name), true);
        RETURN NULL;
    END IF;

    BEGIN
        v_request := net.http_post(
            url := pg_catalog.rtrim(v_base, '/') || v_job.path,
            body := '{}'::jsonb,
            headers := pg_catalog.jsonb_build_object(
                'Authorization', 'Bearer ' || v_bearer,
                'Content-Type', 'application/json'
            ),
            timeout_milliseconds := 120000
        );
    EXCEPTION WHEN OTHERS THEN
        PERFORM ops.fn_log_scheduler_event(p_name, 'dispatch_failed', 'error',
            pg_catalog.format('pg_net refused the request for %s: %s (SQLSTATE %s)', p_name, SQLERRM, SQLSTATE),
            pg_catalog.jsonb_build_object('path', v_job.path, 'sqlstate', SQLSTATE));
        RETURN NULL;
    END;

    INSERT INTO ops.http_job_dispatches (job_name, request_id) VALUES (p_name, v_request);
    RETURN v_request;
END;
$$;

COMMENT ON FUNCTION ops.fn_dispatch_http_job(text) IS
'Queues the POST for an http job through pg_net (sent when the calling transaction commits) with the
Vault bearer, records it in ops.http_job_dispatches and returns the pg_net request id. Returns NULL
and logs (WARNING + ops row, once a day) when pg_net, Vault, CRON_APP_URL or the bearer is missing.';

CREATE OR REPLACE FUNCTION ops.fn_settle_http_dispatches ()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row record;
    v_failures integer := 0;
BEGIN
    IF pg_catalog.to_regclass('net._http_response') IS NULL THEN
        RETURN 0;
    END IF;

    FOR v_row IN
        SELECT d.id, d.job_name, d.request_id, d.dispatched_at,
               r.id IS NOT NULL AS answered,
               r.status_code,
               COALESCE(r.timed_out, false) AS timed_out,
               r.error_msg,
               pg_catalog.left(r.content, 500) AS content
          FROM ops.http_job_dispatches d
          LEFT JOIN net._http_response r ON r.id = d.request_id
         WHERE d.settled_at IS NULL
           AND (r.id IS NOT NULL OR d.dispatched_at < pg_catalog.now() - interval '7 hours')
         ORDER BY d.dispatched_at
           FOR UPDATE OF d SKIP LOCKED
    LOOP
        UPDATE ops.http_job_dispatches
           SET settled_at = pg_catalog.now(),
               status_code = v_row.status_code,
               error = CASE
                           WHEN NOT v_row.answered THEN 'no response recorded within the pg_net TTL'
                           WHEN v_row.timed_out THEN 'timed out'
                           ELSE v_row.error_msg
                       END
         WHERE id = v_row.id;

        IF NOT v_row.answered THEN
            v_failures := v_failures + 1;
            PERFORM ops.fn_log_scheduler_event(v_row.job_name, 'no_response', 'error',
                pg_catalog.format('%s: no response recorded for request %s dispatched at %s.',
                    v_row.job_name, v_row.request_id, v_row.dispatched_at),
                pg_catalog.jsonb_build_object('request_id', v_row.request_id));
        ELSIF v_row.timed_out OR v_row.error_msg IS NOT NULL
              OR v_row.status_code IS NULL OR v_row.status_code NOT BETWEEN 200 AND 299 THEN
            v_failures := v_failures + 1;
            PERFORM ops.fn_log_scheduler_event(v_row.job_name, 'http_failed', 'error',
                pg_catalog.format('%s answered %s%s.', v_row.job_name,
                    COALESCE(v_row.status_code::text, 'no status'),
                    CASE WHEN v_row.timed_out THEN ' (timed out)'
                         WHEN v_row.error_msg IS NOT NULL THEN ' (' || v_row.error_msg || ')'
                         ELSE '' END),
                pg_catalog.jsonb_build_object(
                    'request_id', v_row.request_id,
                    'status_code', v_row.status_code,
                    'error', v_row.error_msg,
                    'body', v_row.content
                ));
        END IF;
    END LOOP;

    RETURN v_failures;
END;
$$;

COMMENT ON FUNCTION ops.fn_settle_http_dispatches() IS
'Copies pg_net''s answer onto each pending ops.http_job_dispatches row and logs every non-2xx,
transport error or timeout, and every dispatch still unanswered after 7 hours (pg_net keeps a
response for 6), as an error row. Returns the number of failures. Run by ops-watch-jobs; SKIP
LOCKED, so overlapping runs never double-report.';
-- #endregion

-- #region 4. Failed runs and the watcher
-- A sql job that raises leaves its error only in `cron.job_run_details`, which nobody reads. Each failed
-- run of the last day is reported once (keyed by its run id).
CREATE OR REPLACE FUNCTION ops.fn_report_failed_runs ()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row record;
    v_count integer := 0;
BEGIN
    IF pg_catalog.to_regclass('cron.job_run_details') IS NULL THEN
        RETURN 0;
    END IF;

    FOR v_row IN
        SELECT d.runid, j.jobname, d.start_time, pg_catalog.left(d.return_message, 1000) AS message
          FROM cron.job_run_details d
          JOIN cron.job j ON j.jobid = d.jobid
         WHERE d.status = 'failed'
           AND d.start_time > pg_catalog.now() - interval '1 day'
           AND NOT EXISTS (
                SELECT 1
                  FROM ops.log_entries l
                 WHERE l.client_id = 'scheduler:' || j.jobname || ':run_failed'
                   AND l.created_at > pg_catalog.now() - interval '2 days'
                   AND l.data ->> 'run_id' = d.runid::text
           )
         ORDER BY d.runid
    LOOP
        v_count := v_count + 1;
        PERFORM ops.fn_log_scheduler_event(v_row.jobname, 'run_failed', 'error',
            pg_catalog.format('%s failed (pg_cron run %s at %s): %s',
                v_row.jobname, v_row.runid, v_row.start_time, COALESCE(v_row.message, 'no message')),
            pg_catalog.jsonb_build_object('run_id', v_row.runid, 'started_at', v_row.start_time));
    END LOOP;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION ops.fn_report_failed_runs() IS
'Reports every failed pg_cron run of the last day (cron.job_run_details) as one ops error row, keyed
by run id so a run is reported once. Returns the number newly reported.';

CREATE OR REPLACE FUNCTION ops.fn_watch_jobs ()
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT ops.fn_settle_http_dispatches() + ops.fn_report_failed_runs();
$$;

COMMENT ON FUNCTION ops.fn_watch_jobs() IS
'The ops-watch-jobs job: settles HTTP dispatches and reports failed pg_cron runs. Returns the number
of failures reported this run.';
-- #endregion

-- #region 5. Manual runs
CREATE OR REPLACE FUNCTION ops.run_job (p_name text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_job ops.scheduled_jobs%ROWTYPE;
    v_result jsonb;
BEGIN
    SELECT * INTO v_job FROM ops.scheduled_jobs j WHERE j.name = p_name;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown scheduled job %', p_name USING ERRCODE = 'PJ404';
    END IF;

    IF v_job.kind = 'http' THEN
        RETURN pg_catalog.jsonb_build_object(
            'job', p_name,
            'kind', 'http',
            'request_id', ops.fn_dispatch_http_job(p_name)
        );
    END IF;

    EXECUTE pg_catalog.format('SELECT pg_catalog.to_jsonb(r) FROM (%s) r',
        pg_catalog.rtrim(pg_catalog.btrim(v_job.command), ';'))
       INTO v_result;
    RETURN pg_catalog.jsonb_build_object('job', p_name, 'kind', 'sql', 'result', v_result);
END;
$$;

COMMENT ON FUNCTION ops.run_job(text) IS
'Runs one registered job now, whether or not it is enabled or scheduled: a sql job''s SELECT (its
result returned as jsonb), or an http job''s pg_net dispatch (its request id). Service role only;
`deno task cron:run <job>` calls it for sql jobs.';
-- #endregion
