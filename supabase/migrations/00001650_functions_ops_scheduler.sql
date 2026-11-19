-- =============================================================================================
-- 00001650_functions_ops_scheduler.sql — the job registry's machinery (Category 1, Decision #203).
-- `ops.scheduled_jobs` (00000013) lists every recurring job. These functions turn a row into a
-- pg_cron job, dispatch the HTTP sweeps through pg_net with a bearer read from Vault, settle their
-- responses, and let the service role run any job by hand (`deno task cron:run <job>`). A skip or a
-- failure is never silent: it raises a WARNING and writes an `ops.log_entries` row
-- (`scope = 'ops.scheduler'`, `client_id = 'scheduler:<job>:<reason>'`). The watcher also reports a
-- job that has stopped succeeding, and a burst of failed webhook deliveries (`scope = 'ops.webhooks'`),
-- and the heartbeat says whether the watcher itself is running (OPS5); the alert rules in 00005065
-- route those rows to a person.
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

-- #region 4. Failed runs
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
-- #endregion

-- #region 4a. Cadence and staleness (OPS5)
-- A job that stops running writes nothing: a skipped http run still reads "succeeded" in
-- cron.job_run_details, and a job pg_cron never fires has no run at all. So a job is judged by its
-- last SUCCESS (a 2xx in ops.http_job_dispatches for an http job, a succeeded run in
-- cron.job_run_details for a sql job) against its cadence, read conservatively from the expression:
-- the largest gap between two fire times in a day.

-- The values one cron field names, ascending, or NULL when the field is not one this check reads.
-- Comma lists of `*`, `n`, `a-b`, `*/s` and `a-b/s`, within [p_min, p_max]. Internal.
CREATE OR REPLACE FUNCTION ops.fn_cron_field_values (p_field text, p_min integer, p_max integer)
RETURNS integer[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_part text;
    v_range text;
    v_step integer;
    v_lo integer;
    v_hi integer;
    v_out integer[] := '{}';
    m text[];
BEGIN
    IF p_field IS NULL OR p_field = '' THEN
        RETURN NULL;
    END IF;
    FOREACH v_part IN ARRAY pg_catalog.string_to_array(p_field, ',') LOOP
        m := pg_catalog.regexp_match(v_part, '^(\*|[0-9]{1,2}(?:-[0-9]{1,2})?)(?:/([0-9]{1,2}))?$');
        IF m IS NULL THEN
            RETURN NULL;
        END IF;
        v_range := m[1];
        v_step := COALESCE(m[2]::integer, 1);
        IF v_step < 1 THEN
            RETURN NULL;
        END IF;
        IF v_range = '*' THEN
            v_lo := p_min;
            v_hi := p_max;
        ELSIF pg_catalog.strpos(v_range, '-') > 0 THEN
            v_lo := pg_catalog.split_part(v_range, '-', 1)::integer;
            v_hi := pg_catalog.split_part(v_range, '-', 2)::integer;
        ELSE
            v_lo := v_range::integer;
            -- `n/s` is not standard cron: refuse it rather than guess.
            IF m[2] IS NOT NULL THEN
                RETURN NULL;
            END IF;
            v_hi := v_lo;
        END IF;
        IF v_lo < p_min OR v_hi > p_max OR v_lo > v_hi THEN
            RETURN NULL;
        END IF;
        v_out := v_out || ARRAY(SELECT pg_catalog.generate_series(v_lo, v_hi, v_step));
    END LOOP;
    RETURN ARRAY(SELECT DISTINCT v FROM pg_catalog.unnest(v_out) v ORDER BY v);
END;
$$;

COMMENT ON FUNCTION ops.fn_cron_field_values(text, integer, integer) IS
'The values one five-field cron field names, ascending (comma lists of *, n, a-b, */s, a-b/s within
[p_min, p_max]), or NULL for anything else. Internal to ops.fn_cron_max_gap.';

-- The largest gap between two consecutive fire times of a schedule over one UTC day, wrapping past
-- midnight: '*/10 * * * *' is 10 minutes, '4,19,34,49 * * * *' 15, '20 2 * * *' a day. NULL for an
-- expression this check does not read: anything but five fields, a day-of-month, month or weekday
-- other than '*', or pg_cron's interval form ('30 seconds'). Every cadence it returns is at most a
-- day, so three of them fit inside the 7 days of run history ops-prune-job-history keeps.
CREATE OR REPLACE FUNCTION ops.fn_cron_max_gap (p_schedule text)
RETURNS interval
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_fields text[] := pg_catalog.regexp_split_to_array(pg_catalog.btrim(COALESCE(p_schedule, '')), '\s+');
    v_minutes integer[];
    v_hours integer[];
    v_times integer[];
    v_gap integer := 0;
    i integer;
BEGIN
    IF pg_catalog.array_length(v_fields, 1) IS DISTINCT FROM 5
       OR v_fields[3] <> '*' OR v_fields[4] <> '*' OR v_fields[5] <> '*' THEN
        RETURN NULL;
    END IF;
    v_minutes := ops.fn_cron_field_values(v_fields[1], 0, 59);
    v_hours := ops.fn_cron_field_values(v_fields[2], 0, 23);
    IF v_minutes IS NULL OR v_hours IS NULL THEN
        RETURN NULL;
    END IF;
    v_times := ARRAY(
        SELECT h * 60 + mi
          FROM pg_catalog.unnest(v_hours) h, pg_catalog.unnest(v_minutes) mi
         ORDER BY 1
    );
    FOR i IN 2 .. pg_catalog.array_length(v_times, 1) LOOP
        v_gap := GREATEST(v_gap, v_times[i] - v_times[i - 1]);
    END LOOP;
    v_gap := GREATEST(v_gap, v_times[1] + 1440 - v_times[pg_catalog.array_length(v_times, 1)]);
    RETURN pg_catalog.make_interval(mins => v_gap);
END;
$$;

COMMENT ON FUNCTION ops.fn_cron_max_gap(text) IS
'A five-field cron schedule''s largest gap between two consecutive fire times over one UTC day,
wrapping past midnight (the staleness check''s conservative cadence). NULL for an expression it does
not read: not five fields, a day-of-month, month or weekday other than *, or pg_cron''s interval form.';

-- One staleness pass over the enabled registry rows (at most p_limit, by name):
--   - a schedule ops.fn_cron_max_gap cannot read is warned about once per job and schedule
--     (`scheduler:<job>:cadence_unknown`), never silently skipped;
--   - a job with no success for job_stale_factor × its cadence (security.platform_params, default 3)
--     writes one `scheduler:<job>:stale` error, at most once a day while it lasts. The cadence is never
--     taken as finer than the watcher's own (ops-watch-jobs), which is as often as a success can be
--     seen; the clock starts at the row's last change when the job has no later success.
-- Each row is locked FOR NO KEY UPDATE SKIP LOCKED (a dispatch's FK check still passes) and its
-- once-a-day check reads after the lock, so an overlapping pass writes nothing twice. Without pg_cron
-- nothing runs on its own and every registration has already said so: returns 0. Returns the number
-- of rows written.
CREATE OR REPLACE FUNCTION ops.fn_report_stale_jobs (
    p_now timestamptz DEFAULT pg_catalog.now(),
    p_limit integer DEFAULT 200
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_factor numeric;
    v_watch interval;
    v_job record;
    v_cadence interval;
    v_after interval;
    v_since timestamptz;
    v_count integer := 0;
BEGIN
    IF pg_catalog.to_regclass('cron.job_run_details') IS NULL THEN
        RETURN 0;
    END IF;

    SELECT CASE WHEN pg_catalog.jsonb_typeof(pp.value) = 'number' AND (pp.value #>> '{}')::numeric >= 1
                THEN (pp.value #>> '{}')::numeric END
      INTO v_factor
      FROM security.platform_params pp
     WHERE pp.key = 'job_stale_factor';
    v_factor := COALESCE(v_factor, 3);
    v_watch := COALESCE(
        (SELECT ops.fn_cron_max_gap(w.schedule) FROM ops.scheduled_jobs w WHERE w.name = 'ops-watch-jobs'),
        interval '10 minutes'
    );

    FOR v_job IN
        SELECT j.name, j.kind, j.schedule, j.updated_at,
               CASE j.kind WHEN 'http' THEN h.dispatched_at ELSE s.succeeded_at END AS last_success
          FROM ops.scheduled_jobs j
          LEFT JOIN LATERAL (
                SELECT d.dispatched_at
                  FROM ops.http_job_dispatches d
                 WHERE d.job_name = j.name
                   AND d.settled_at IS NOT NULL
                   AND d.status_code BETWEEN 200 AND 299
                   AND d.error IS NULL
                 ORDER BY d.dispatched_at DESC
                 LIMIT 1
          ) h ON j.kind = 'http'
          LEFT JOIN (
                SELECT c.jobname, pg_catalog.max(r.end_time) AS succeeded_at
                  FROM cron.job_run_details r
                  JOIN cron.job c ON c.jobid = r.jobid
                 WHERE r.status = 'succeeded'
                 GROUP BY c.jobname
          ) s ON s.jobname = j.name
         WHERE j.enabled
         ORDER BY j.name
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 200), 1000), 1)
           FOR NO KEY UPDATE OF j SKIP LOCKED
    LOOP
        v_cadence := ops.fn_cron_max_gap(v_job.schedule);
        IF v_cadence IS NULL THEN
            IF NOT EXISTS (
                SELECT 1
                  FROM ops.log_entries l
                 WHERE l.source = 'server'
                   AND l.scope = 'ops.scheduler'
                   AND l.client_id = pg_catalog.format('scheduler:%s:cadence_unknown', v_job.name)
                   AND l.data ->> 'schedule' = v_job.schedule
            ) THEN
                PERFORM ops.fn_log_scheduler_event(v_job.name, 'cadence_unknown', 'warn',
                    pg_catalog.format('%s runs on "%s", which the staleness check cannot read, so a missed run of it is not detected.',
                        v_job.name, v_job.schedule),
                    pg_catalog.jsonb_build_object('schedule', v_job.schedule));
                v_count := v_count + 1;
            END IF;
            CONTINUE;
        END IF;

        v_after := GREATEST(v_cadence, v_watch) * v_factor;
        v_since := GREATEST(COALESCE(v_job.last_success, v_job.updated_at), v_job.updated_at);
        CONTINUE WHEN p_now - v_since <= v_after;
        CONTINUE WHEN EXISTS (
            SELECT 1
              FROM ops.log_entries l
             WHERE l.source = 'server'
               AND l.scope = 'ops.scheduler'
               AND l.client_id = pg_catalog.format('scheduler:%s:stale', v_job.name)
               AND l.created_at > p_now - interval '1 day'
        );
        PERFORM ops.fn_log_scheduler_event(v_job.name, 'stale', 'error',
            pg_catalog.format('%s has not succeeded since %s: %s minutes, past %s × its %s-minute cadence.',
                v_job.name,
                COALESCE(pg_catalog.to_char(v_job.last_success AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), 'it was registered'),
                pg_catalog.floor(pg_catalog.date_part('epoch', p_now - v_since) / 60)::bigint,
                v_factor,
                (pg_catalog.date_part('epoch', GREATEST(v_cadence, v_watch)) / 60)::bigint),
            pg_catalog.jsonb_build_object(
                'cadence_minutes', (pg_catalog.date_part('epoch', GREATEST(v_cadence, v_watch)) / 60)::bigint,
                'stale_minutes', pg_catalog.floor(pg_catalog.date_part('epoch', p_now - v_since) / 60)::bigint,
                'last_success_at', v_job.last_success
            ));
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION ops.fn_report_stale_jobs(timestamptz, integer) IS
'The staleness pass of ops-watch-jobs (OPS5): an enabled job with no success (an http 2xx, a
succeeded sql run) for job_stale_factor × its cadence (ops.fn_cron_max_gap, never finer than the
watcher''s) writes one scheduler:<job>:stale error a day while it lasts; a schedule it cannot read is
warned about once (scheduler:<job>:cadence_unknown). SKIP LOCKED per row. Returns the rows written.';
-- #endregion

-- #region 4b. Webhook failures (OPS5)
-- A webhook endpoint that keeps failing loses events quietly: Stripe retries a 5xx for days and then
-- disables the endpoint. Each webhook service records a non-2xx through
-- `ops.fn_record_webhook_failure` (OpsHealthService.recordWebhookFailure): one `warn` row per
-- provider, outcome class and minute (scope `webhook.<provider>`), its count in `data`, so a flood of
-- forged posts adds a row a minute, not a row a post. No alert rule matches those raw scopes: a single
-- failure never alerts. `ops.fn_watch_webhooks` turns a burst into one summary row (scope
-- `ops.webhooks`) that the seeded rules route.

-- One failure, or `p_count` of them, folded into the provider's row for this minute. `p_class` is
-- `failure` (a 5xx: the provider redelivers), `signature` (a missing or forged signature) or `refused`
-- (any other 4xx). Facts only: the status, a reason code, and the event's id and type when it had
-- one; anything that is not a short code is dropped. Service role only.
CREATE OR REPLACE FUNCTION ops.fn_record_webhook_failure (
    p_provider text,
    p_class text,
    p_status integer,
    p_reason text,
    p_count integer DEFAULT 1,
    p_event_id text DEFAULT NULL,
    p_event_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_client text;
    v_scope text;
    v_reason text;
    v_event_id text;
    v_event_type text;
    v_id uuid;
    v_count bigint;
BEGIN
    IF p_provider IS NULL OR p_provider !~ '^[a-z0-9][a-z0-9_-]{0,31}$' THEN
        RAISE EXCEPTION 'ops: % is not a webhook provider code', p_provider USING ERRCODE = '22023';
    END IF;
    IF p_class IS NULL OR p_class <> ALL (ARRAY['failure', 'signature', 'refused']) THEN
        RAISE EXCEPTION 'ops: % is not a webhook outcome class', p_class USING ERRCODE = '22023';
    END IF;
    IF p_status IS NULL OR p_status NOT BETWEEN 300 AND 599 THEN
        RAISE EXCEPTION 'ops: % is not a failed webhook status', p_status USING ERRCODE = '22023';
    END IF;
    IF p_count IS NULL OR p_count NOT BETWEEN 1 AND 1000000 THEN
        RAISE EXCEPTION 'ops: a webhook failure count is 1 to 1000000' USING ERRCODE = '22023';
    END IF;
    v_reason := CASE WHEN p_reason ~ '^[a-z0-9_]{1,40}$' THEN p_reason ELSE 'other' END;
    v_event_id := CASE WHEN p_event_id ~ '^[A-Za-z0-9_.:-]{1,128}$' THEN p_event_id END;
    v_event_type := CASE WHEN p_event_type ~ '^[A-Za-z0-9_.:-]{1,128}$' THEN p_event_type END;
    v_client := pg_catalog.format('webhook:%s:%s:minute', p_provider, p_class);
    v_scope := 'webhook.' || p_provider;

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client, 0));
    SELECT l.id INTO v_id
      FROM ops.log_entries l
     WHERE l.source = 'server'
       AND l.scope = v_scope
       AND l.client_id = v_client
       AND l.created_at >= pg_catalog.date_trunc('minute', pg_catalog.now())
     ORDER BY l.created_at DESC
     LIMIT 1;

    IF v_id IS NOT NULL THEN
        UPDATE ops.log_entries l
           SET data = l.data || pg_catalog.jsonb_build_object(
                   'count', COALESCE((l.data ->> 'count')::bigint, 0) + p_count,
                   'status', p_status,
                   'reason', v_reason,
                   'event_id', COALESCE(v_event_id, l.data ->> 'event_id'),
                   'event_type', COALESCE(v_event_type, l.data ->> 'event_type')
               ),
               message = pg_catalog.format('%s webhook: %s %s (%s) this minute.', p_provider,
                   COALESCE((l.data ->> 'count')::bigint, 0) + p_count, p_class, v_reason)
         WHERE l.id = v_id
        RETURNING (l.data ->> 'count')::bigint INTO v_count;
    ELSE
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        VALUES (
            v_client, 'warn',
            pg_catalog.format('%s webhook: %s %s (%s) this minute.', p_provider, p_count, p_class, v_reason),
            pg_catalog.now(), 'server', v_scope,
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                'provider', p_provider, 'class', p_class, 'status', p_status, 'reason', v_reason,
                'count', p_count, 'event_id', v_event_id, 'event_type', v_event_type
            ))
        )
        RETURNING id INTO v_id;
        v_count := p_count;
    END IF;

    RETURN pg_catalog.jsonb_build_object('id', v_id, 'count', v_count);
END;
$$;

COMMENT ON FUNCTION ops.fn_record_webhook_failure(text, text, integer, text, integer, text, text) IS
'Folds p_count webhook failures of one provider and outcome class (failure · signature · refused)
into that minute''s ops.log_entries row (scope webhook.<provider>, level warn, client_id
webhook:<provider>:<class>:minute), its count in data: at most one row per provider, class and minute.
Facts only (status, reason code, event id and type). Service role only.';

-- One pass over the last 15 minutes of raw webhook rows (as of p_now): a provider whose `failure`
-- rows count webhook_failure_threshold or more (security.platform_params, default 5) writes one
-- `webhook:<provider>:failing` error, at most once an hour while it lasts; the same count of
-- `signature` refusals (a rotated secret, or someone probing) writes one `webhook:<provider>:signature`
-- warn, at most once a day. Scope `ops.webhooks`. The pass holds one advisory lock and re-checks each
-- summary after taking it, so an overlapping pass writes nothing twice. At most p_limit summaries.
-- Returns the number written.
CREATE OR REPLACE FUNCTION ops.fn_watch_webhooks (
    p_now timestamptz DEFAULT pg_catalog.now(),
    p_limit integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_threshold integer;
    r record;
    v_reason text;
    v_client text;
    v_count integer := 0;
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ops.fn_watch_webhooks', 0));

    SELECT CASE WHEN pg_catalog.jsonb_typeof(pp.value) = 'number' AND (pp.value #>> '{}')::numeric >= 1
                THEN pg_catalog.floor((pp.value #>> '{}')::numeric)::integer END
      INTO v_threshold
      FROM security.platform_params pp
     WHERE pp.key = 'webhook_failure_threshold';
    v_threshold := COALESCE(v_threshold, 5);

    FOR r IN
        SELECT l.data ->> 'provider' AS provider,
               l.data ->> 'class' AS class,
               pg_catalog.sum(CASE WHEN pg_catalog.jsonb_typeof(l.data -> 'count') = 'number'
                                   THEN (l.data ->> 'count')::bigint ELSE 1 END) AS failures,
               pg_catalog.max(CASE WHEN pg_catalog.jsonb_typeof(l.data -> 'status') = 'number'
                                   THEN (l.data ->> 'status')::integer END) AS status
          FROM ops.log_entries l
         WHERE l.source = 'server'
           AND l.scope LIKE 'webhook.%'
           AND l.created_at > p_now - interval '15 minutes'
           AND l.created_at <= p_now
           AND l.data ->> 'class' IN ('failure', 'signature')
           AND l.data ->> 'provider' ~ '^[a-z0-9][a-z0-9_-]{0,31}$'
         GROUP BY 1, 2
        HAVING pg_catalog.sum(CASE WHEN pg_catalog.jsonb_typeof(l.data -> 'count') = 'number'
                                   THEN (l.data ->> 'count')::bigint ELSE 1 END) >= v_threshold
         ORDER BY 1, 2
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1)
    LOOP
        v_reason := CASE r.class WHEN 'failure' THEN 'failing' ELSE 'signature' END;
        v_client := pg_catalog.format('webhook:%s:%s', r.provider, v_reason);
        CONTINUE WHEN EXISTS (
            SELECT 1
              FROM ops.log_entries l
             WHERE l.source = 'server'
               AND l.scope = 'ops.webhooks'
               AND l.client_id = v_client
               AND l.created_at > p_now - CASE r.class WHEN 'failure' THEN interval '1 hour' ELSE interval '1 day' END
        );
        RAISE WARNING '[ops.webhooks] %: % % in 15 minutes (threshold %)', r.provider, r.failures,
            CASE r.class WHEN 'failure' THEN 'failed deliveries' ELSE 'signature refusals' END, v_threshold;
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        VALUES (
            v_client,
            CASE r.class WHEN 'failure' THEN 'error' ELSE 'warn' END,
            pg_catalog.format(CASE r.class
                    WHEN 'failure' THEN '%s webhook deliveries failed %s times in 15 minutes; the provider will retry, then may disable the endpoint.'
                    ELSE '%s webhook deliveries were refused for their signature %s times in 15 minutes: a rotated secret, or someone probing the endpoint.'
                END, r.provider, r.failures),
            pg_catalog.now(), 'server', 'ops.webhooks',
            pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                'provider', r.provider, 'reason', v_reason, 'failures', r.failures,
                'threshold', v_threshold, 'window_minutes', 15, 'last_status', r.status
            ))
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION ops.fn_watch_webhooks(timestamptz, integer) IS
'The webhook pass of ops-watch-jobs (OPS5): webhook_failure_threshold 5xx failures of one provider
within 15 minutes write one webhook:<provider>:failing error (scope ops.webhooks) at most hourly; the
same count of signature refusals one webhook:<provider>:signature warn at most daily. One advisory
lock per pass. Returns the summaries written.';
-- #endregion

-- #region 4c. The watcher, the heartbeat and run history
-- Each pass runs in its own subtransaction, so a pass that raises is logged and the others still run;
-- settling comes first, so the staleness pass sees every answered dispatch.
CREATE OR REPLACE FUNCTION ops.fn_watch_jobs ()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    v_count := v_count + ops.fn_settle_http_dispatches();
    v_count := v_count + ops.fn_report_failed_runs();
    BEGIN
        v_count := v_count + ops.fn_report_stale_jobs();
    EXCEPTION WHEN OTHERS THEN
        PERFORM ops.fn_log_scheduler_event('ops-watch-jobs', 'stale_check_failed', 'error',
            pg_catalog.format('The staleness pass raised %s (SQLSTATE %s).', SQLERRM, SQLSTATE),
            pg_catalog.jsonb_build_object('sqlstate', SQLSTATE));
    END;
    BEGIN
        v_count := v_count + ops.fn_watch_webhooks();
    EXCEPTION WHEN OTHERS THEN
        PERFORM ops.fn_log_scheduler_event('ops-watch-jobs', 'webhook_check_failed', 'error',
            pg_catalog.format('The webhook pass raised %s (SQLSTATE %s).', SQLERRM, SQLSTATE),
            pg_catalog.jsonb_build_object('sqlstate', SQLSTATE));
    END;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION ops.fn_watch_jobs() IS
'The ops-watch-jobs job: settles HTTP dispatches, reports failed pg_cron runs, reports stale jobs
(ops.fn_report_stale_jobs) and webhook bursts (ops.fn_watch_webhooks). A pass that raises is logged
and the rest still run. Returns the number of rows reported this run.';

-- The heartbeat behind GET /api/ops/health (OPS5 step 5), as of p_now. `watch`: ops-watch-jobs is
-- enabled and a run of it succeeded within heartbeat_watch_minutes (security.platform_params, default
-- 30); false without pg_cron. `alerts`: no alert delivery opened 15 minutes ago or earlier is still
-- pending. The database answering at all is the third condition, which only the caller can see.
-- Booleans only. Service role only.
CREATE OR REPLACE FUNCTION ops.fn_heartbeat (p_now timestamptz DEFAULT pg_catalog.now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_minutes integer;
    v_watch boolean := false;
BEGIN
    SELECT CASE WHEN pg_catalog.jsonb_typeof(pp.value) = 'number' AND (pp.value #>> '{}')::numeric >= 1
                THEN pg_catalog.floor((pp.value #>> '{}')::numeric)::integer END
      INTO v_minutes
      FROM security.platform_params pp
     WHERE pp.key = 'heartbeat_watch_minutes';
    v_minutes := COALESCE(v_minutes, 30);

    IF pg_catalog.to_regclass('cron.job_run_details') IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
              FROM ops.scheduled_jobs j
              JOIN cron.job c ON c.jobname = j.name
              JOIN cron.job_run_details r ON r.jobid = c.jobid
             WHERE j.name = 'ops-watch-jobs'
               AND j.enabled
               AND r.status = 'succeeded'
               AND r.end_time > p_now - pg_catalog.make_interval(mins => v_minutes)
        ) INTO v_watch;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'watch', v_watch,
        'alerts', NOT EXISTS (
            SELECT 1
              FROM ops.alert_deliveries d
             WHERE d.status = 'pending'
               AND d.created_at <= p_now - interval '15 minutes'
        )
    );
END;
$$;

COMMENT ON FUNCTION ops.fn_heartbeat(timestamptz) IS
'The heartbeat behind GET /api/ops/health (OPS5): {watch, alerts}. watch = ops-watch-jobs is enabled
and succeeded within heartbeat_watch_minutes (default 30; false without pg_cron); alerts = no alert
delivery opened 15 or more minutes ago is still pending. Booleans only. Service role only.';

-- pg_cron writes one cron.job_run_details row per run and never prunes it: comms-process-queue alone
-- adds 1,440 a day. fn_report_failed_runs reads only the last day, so a week of history is plenty.
CREATE OR REPLACE FUNCTION ops.fn_prune_job_history (p_keep interval DEFAULT interval '7 days')
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer;
BEGIN
    IF pg_catalog.to_regclass('cron.job_run_details') IS NULL THEN
        RETURN 0;
    END IF;

    DELETE FROM cron.job_run_details d
     WHERE d.end_time < pg_catalog.now() - p_keep;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION ops.fn_prune_job_history(interval) IS
'The ops-prune-job-history job: deletes pg_cron run history (cron.job_run_details) that ended more
than p_keep ago (default 7 days; fn_report_failed_runs has reported every failure by then). A run
still in progress is kept. Returns the number of rows deleted.';
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
