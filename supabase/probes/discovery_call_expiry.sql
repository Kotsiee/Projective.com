-- =============================================================================================
-- Probe: paid discovery calls are refused, and an unanswered request expires
-- (SCHEDULING_COMPLETENESS_AUDIT S-02, S-11; Decision #343, rulings C1 and C3).
--
--   1. S-02 — scheduling.request_discovery_call refuses a paid call (`paid_unavailable`) on a
--      published schedule that offers one and confirms it automatically, at a slot the gate itself
--      would accept: before the fix that request came back `confirmed`, with no payment behind it.
--   2. A courtesy request on a published schedule still lands.
--   3. S-11 — scheduling.fn_expire_discovery_calls expires a proposed call past its proposal TTL and
--      one past its proposed start, tells both parties once each, and leaves a confirmed call and
--      requests inside their TTL alone; get_free_busy stops returning the expired spans; a second
--      run changes nothing.
--   4. Only the service role (and pg_cron) may run the sweep; the job registry runs it every 15
--      minutes under the name the dormant 00005060 row waits for, and a by-hand run through
--      ops.run_job (what `deno task cron:run` calls) finds nothing left.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/discovery_call_expiry.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts (non-zero exit under
-- ON_ERROR_STOP). Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- `now()` is the transaction's start in every statement here, so the sweep's clock does not move
-- between its runs.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- The first slot of a flavour on a schedule that the request gate accepts, for some adult who is not
-- the host, from the schedule's own minimum notice onwards (all NULL when there is none).
CREATE FUNCTION pg_temp.requestable_slot(
    p_schedule uuid, p_type scheduling.call_type,
    OUT o_start timestamptz, OUT o_end timestamptz, OUT o_requester uuid
) LANGUAGE plpgsql AS $$
DECLARE
    s scheduling.call_settings;
    v_host uuid := scheduling.fn_schedule_host(p_schedule);
    v_minutes integer;
    u uuid;
    t timestamptz;
BEGIN
    SELECT * INTO s FROM scheduling.call_settings WHERE schedule_id = p_schedule;
    v_minutes := CASE p_type WHEN 'paid' THEN s.paid_duration_minutes ELSE s.courtesy_duration_minutes END;
    FOR u IN
        SELECT p.user_id FROM org.users_public p
         WHERE p.user_id <> v_host AND NOT org.fn_is_minor(p.user_id)
         ORDER BY p.user_id LIMIT 3
    LOOP
        t := date_trunc('hour', now() + make_interval(mins => s.min_notice_minutes)) + interval '1 hour';
        WHILE t < now() + make_interval(days => s.max_advance_days) - interval '1 day' LOOP
            IF scheduling.fn_call_request_refusal(p_schedule, u, p_type, t, t + make_interval(mins => v_minutes)) IS NULL THEN
                o_start := t;
                o_end := t + make_interval(mins => v_minutes);
                o_requester := u;
                RETURN;
            END IF;
            t := t + interval '1 hour';
        END LOOP;
    END LOOP;
END $$;

-- #region 1. S-02: a paid request is refused (as a signed-in requester)
DO $$
DECLARE
    v_schedule uuid; v_start timestamptz; v_end timestamptz; v_requester uuid; v_platform text;
BEGIN
    -- A published schedule offering a paid call that it confirms automatically: the case that used
    -- to be born confirmed with no money behind it. The seed carries one; should it ever stop, one is
    -- made here (and rolled back with the rest).
    SELECT sc.id INTO v_schedule
      FROM scheduling.schedules sc JOIN scheduling.call_settings cs ON cs.schedule_id = sc.id
     WHERE cs.accepts_calls AND cs.paid_enabled AND cs.auto_confirm AND scheduling.fn_schedule_is_public(sc.id)
     ORDER BY sc.id LIMIT 1;
    IF v_schedule IS NULL THEN
        SELECT sc.id INTO v_schedule
          FROM scheduling.schedules sc JOIN scheduling.call_settings cs ON cs.schedule_id = sc.id
         WHERE cs.accepts_calls AND scheduling.fn_schedule_is_public(sc.id)
         ORDER BY sc.id LIMIT 1;
        IF v_schedule IS NULL THEN
            RAISE EXCEPTION 'FAIL no fixture: need a published schedule that takes calls';
        END IF;
        UPDATE scheduling.call_settings
           SET paid_enabled = true, auto_confirm = true, fee_amount_minor = 5000, fee_currency = 'GBP'
         WHERE schedule_id = v_schedule;
    END IF;

    SELECT o_start, o_end, o_requester INTO v_start, v_end, v_requester
      FROM pg_temp.requestable_slot(v_schedule, 'paid');
    IF v_start IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: no paid slot the request gate accepts on schedule %', v_schedule;
    END IF;
    SELECT cp.provider_slug INTO v_platform FROM scheduling.call_platforms cp
     WHERE cp.schedule_id = v_schedule ORDER BY cp.position LIMIT 1;

    PERFORM set_config('probe.paid_schedule', v_schedule::text, true);
    PERFORM set_config('probe.paid_requester', v_requester::text, true);
    PERFORM set_config('probe.paid_start', v_start::text, true);
    PERFORM set_config('probe.paid_end', v_end::text, true);
    PERFORM set_config('probe.paid_platform', COALESCE(v_platform, ''), true);
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.paid_requester'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM scheduling.request_discovery_call(
        current_setting('probe.paid_schedule')::uuid, 'paid', current_setting('probe.paid_start')::timestamptz,
        current_setting('probe.paid_end')::timestamptz, 'Probe agenda', 'UTC',
        NULLIF(current_setting('probe.paid_platform'), ''), NULL);
    RAISE EXCEPTION 'FAIL a paid discovery call was booked with nothing paid for it';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%paid_unavailable%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS a paid request is refused at a slot the gate accepts, under auto_confirm [%]', SQLERRM;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 2. A courtesy request still lands (as a signed-in requester)
DO $$
DECLARE
    v_schedule uuid; v_start timestamptz; v_end timestamptz; v_requester uuid; v_platform text;
BEGIN
    FOR v_schedule IN
        SELECT sc.id
          FROM scheduling.schedules sc JOIN scheduling.call_settings cs ON cs.schedule_id = sc.id
         WHERE cs.accepts_calls AND cs.courtesy_enabled AND scheduling.fn_schedule_is_public(sc.id)
         ORDER BY sc.id
    LOOP
        SELECT o_start, o_end, o_requester INTO v_start, v_end, v_requester
          FROM pg_temp.requestable_slot(v_schedule, 'courtesy');
        EXIT WHEN v_start IS NOT NULL;
    END LOOP;
    IF v_start IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published schedule taking courtesy calls with a slot someone may request';
    END IF;
    SELECT cp.provider_slug INTO v_platform FROM scheduling.call_platforms cp
     WHERE cp.schedule_id = v_schedule ORDER BY cp.position LIMIT 1;

    PERFORM set_config('probe.schedule', v_schedule::text, true);
    PERFORM set_config('probe.host', scheduling.fn_schedule_host(v_schedule)::text, true);
    PERFORM set_config('probe.requester', v_requester::text, true);
    PERFORM set_config('probe.start', v_start::text, true);
    PERFORM set_config('probe.end', v_end::text, true);
    PERFORM set_config('probe.platform', COALESCE(v_platform, ''), true);
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.requester'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
    r := scheduling.request_discovery_call(
        current_setting('probe.schedule')::uuid, 'courtesy', current_setting('probe.start')::timestamptz,
        current_setting('probe.end')::timestamptz, 'Probe agenda', 'UTC',
        NULLIF(current_setting('probe.platform'), ''), NULL);
    IF r ->> 'id' IS NULL OR r ->> 'status' NOT IN ('proposed', 'confirmed') THEN
        RAISE EXCEPTION 'FAIL a courtesy request answered %', r;
    END IF;
    PERFORM set_config('probe.fresh', r ->> 'id', true);
    PERFORM set_config('probe.fresh_status', r ->> 'status', true);
    RAISE NOTICE 'PASS a courtesy request still lands (%)', r ->> 'status';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
-- #endregion

-- #region 3. S-11: the sweep expires what nobody answered, and only that (as the job runs it)
-- Four calls on the courtesy schedule, written as postgres (the request gate is not asked: the
-- fixture is the call, not its booking). Each starts on its own odd minute, so its span is its own in
-- get_free_busy. `ttl` = the proposal TTL, past in `stale`, not in `recent`.
DO $$
DECLARE
    v_schedule uuid := current_setting('probe.schedule')::uuid;
    v_host uuid := current_setting('probe.host')::uuid;
    v_requester uuid := current_setting('probe.requester')::uuid;
    v_ttl integer;
    v_id uuid;
    t timestamptz;
BEGIN
    v_ttl := COALESCE((
        SELECT (pp.value #>> '{}')::integer FROM security.platform_params pp
         WHERE pp.key = 'discovery_call_proposal_ttl_hours'
    ), 72);

    -- Asked longer ago than the TTL, for a time still ahead: expires by the TTL.
    t := date_trunc('hour', now()) + interval '2 days 7 minutes';
    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, status,
                                            proposed_start, proposed_end, proposed_at)
    VALUES (v_schedule, v_host, v_requester, 'proposed', t, t + interval '20 minutes',
            now() - make_interval(hours => v_ttl + 1))
    RETURNING id INTO v_id;
    PERFORM set_config('probe.stale', v_id::text, true);

    -- Asked an hour ago, for a time that has already begun: expires by its start.
    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, status,
                                            proposed_start, proposed_end, proposed_at)
    VALUES (v_schedule, v_host, v_requester, 'proposed', now() - interval '10 minutes',
            now() + interval '10 minutes', now() - interval '1 hour')
    RETURNING id INTO v_id;
    PERFORM set_config('probe.started', v_id::text, true);

    -- Confirmed long ago, for a time still ahead: a confirmed call is never the sweep's.
    t := date_trunc('hour', now()) + interval '3 days 13 minutes';
    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, status,
                                            proposed_start, proposed_end, confirmed_start, confirmed_end,
                                            proposed_at, confirmed_at)
    VALUES (v_schedule, v_host, v_requester, 'confirmed', t, t + interval '20 minutes',
            t, t + interval '20 minutes', now() - make_interval(hours => v_ttl * 3),
            now() - make_interval(hours => v_ttl * 2))
    RETURNING id INTO v_id;
    PERFORM set_config('probe.confirmed', v_id::text, true);

    -- Asked an hour ago, for a time still ahead: inside its TTL.
    t := date_trunc('hour', now()) + interval '2 days 19 minutes';
    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, status,
                                            proposed_start, proposed_end, proposed_at)
    VALUES (v_schedule, v_host, v_requester, 'proposed', t, t + interval '20 minutes',
            now() - interval '1 hour')
    RETURNING id INTO v_id;
    PERFORM set_config('probe.recent', v_id::text, true);
END $$;

-- The spans free/busy reports around the fixtures, before and after.
CREATE FUNCTION pg_temp.busy(p_call text) RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (
        SELECT 1
          FROM scheduling.discovery_calls c,
               scheduling.get_free_busy(c.host_schedule_id, now() - interval '1 day', now() + interval '7 days') f
         WHERE c.id = current_setting(p_call)::uuid
           AND f.starts_at = COALESCE(c.confirmed_start, c.proposed_start)
           AND f.ends_at = COALESCE(c.confirmed_end, c.proposed_end)
    );
$$;

-- How many `call.expired` notices a call has sent to one of its parties.
CREATE FUNCTION pg_temp.notices(p_call text, p_party text) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer
      FROM comms.notifications n
      JOIN scheduling.discovery_calls c ON c.id = n.entity_id
     WHERE n.type = 'call.expired' AND n.entity_table = 'scheduling.discovery_calls'
       AND c.id = current_setting(p_call)::uuid
       AND n.user_id = CASE p_party WHEN 'host' THEN c.host_user_id ELSE c.requester_user_id END;
$$;

DO $$
DECLARE k text;
BEGIN
    FOREACH k IN ARRAY ARRAY['probe.stale', 'probe.started', 'probe.confirmed', 'probe.recent'] LOOP
        IF NOT pg_temp.busy(k) THEN
            RAISE EXCEPTION 'FAIL fixture: free/busy does not show the % call before the sweep', k;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS before the sweep, free/busy shows all four calls';
END $$;

DO $$
DECLARE
    n integer;
    c scheduling.discovery_calls;
    k text;
BEGIN
    n := scheduling.fn_expire_discovery_calls();
    IF n < 2 THEN
        RAISE EXCEPTION 'FAIL the sweep expired % call(s); the two stale fixtures alone are 2', n;
    END IF;

    FOREACH k IN ARRAY ARRAY['probe.stale', 'probe.started'] LOOP
        SELECT * INTO c FROM scheduling.discovery_calls WHERE id = current_setting(k)::uuid;
        IF c.status <> 'expired' THEN
            RAISE EXCEPTION 'FAIL the % call is % after the sweep, not expired', k, c.status;
        END IF;
        IF c.responded_at IS NOT NULL OR c.confirmed_start IS NOT NULL OR c.reschedule_count <> 0 THEN
            RAISE EXCEPTION 'FAIL the sweep touched more than the % call''s status', k;
        END IF;
        IF pg_temp.busy(k) THEN
            RAISE EXCEPTION 'FAIL free/busy still shows the expired % call', k;
        END IF;
        IF pg_temp.notices(k, 'host') <> 1 OR pg_temp.notices(k, 'requester') <> 1 THEN
            RAISE EXCEPTION 'FAIL the % call sent % notice(s) to the host and % to the requester, not one each', k,
                pg_temp.notices(k, 'host'), pg_temp.notices(k, 'requester');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM scheduling.call_audit a
                        WHERE a.call_id = c.id AND a.action = 'expired' AND a.actor_user_id IS NULL
                          AND a.from_status = 'proposed' AND a.to_status = 'expired') THEN
            RAISE EXCEPTION 'FAIL the % call''s expiry has no audit line', k;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS the sweep expired % call(s): one past its TTL and one past its start, each told to both parties, audited, and off free/busy', n;

    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = current_setting('probe.confirmed')::uuid;
    IF c.status <> 'confirmed' OR NOT pg_temp.busy('probe.confirmed') THEN
        RAISE EXCEPTION 'FAIL the sweep touched a confirmed call (now %)', c.status;
    END IF;
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = current_setting('probe.recent')::uuid;
    IF c.status <> 'proposed' OR NOT pg_temp.busy('probe.recent') THEN
        RAISE EXCEPTION 'FAIL the sweep touched a request inside its TTL (now %)', c.status;
    END IF;
    SELECT * INTO c FROM scheduling.discovery_calls WHERE id = current_setting('probe.fresh')::uuid;
    IF c.status::text <> current_setting('probe.fresh_status') THEN
        RAISE EXCEPTION 'FAIL the sweep touched the request made a moment ago (% → %)',
            current_setting('probe.fresh_status'), c.status;
    END IF;
    IF pg_temp.notices('probe.confirmed', 'host') + pg_temp.notices('probe.recent', 'host')
       + pg_temp.notices('probe.fresh', 'host') <> 0 THEN
        RAISE EXCEPTION 'FAIL a call the sweep left alone sent an expiry notice';
    END IF;
    RAISE NOTICE 'PASS a confirmed call, a request inside its TTL and a fresh request are untouched';
END $$;

-- Idempotent: the same clock, nothing left to expire, nobody told twice.
DO $$
DECLARE n integer; k text;
BEGIN
    n := scheduling.fn_expire_discovery_calls();
    IF n <> 0 THEN
        RAISE EXCEPTION 'FAIL a second run expired % more call(s)', n;
    END IF;
    FOREACH k IN ARRAY ARRAY['probe.stale', 'probe.started'] LOOP
        IF pg_temp.notices(k, 'host') <> 1 OR pg_temp.notices(k, 'requester') <> 1 THEN
            RAISE EXCEPTION 'FAIL a second run told the parties of the % call again', k;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS a second run changes nothing';
END $$;
-- #endregion

-- #region 4. Who may run it, and the job that does
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.requester'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM scheduling.fn_expire_discovery_calls();
    RAISE EXCEPTION 'FAIL a signed-in client ran the expiry sweep';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS a signed-in client cannot run the sweep [%]', SQLERRM;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE j ops.scheduled_jobs;
BEGIN
    IF has_function_privilege('anon', 'scheduling.fn_expire_discovery_calls(integer)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'scheduling.fn_expire_discovery_calls(integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL the sweep''s EXECUTE grant is not service_role only';
    END IF;
    -- The dormant row matches by name (to_regproc), so an overload or a rename would leave the job
    -- silently unregistered.
    IF pg_catalog.to_regproc('scheduling.fn_expire_discovery_calls') IS NULL THEN
        RAISE EXCEPTION 'FAIL to_regproc cannot resolve scheduling.fn_expire_discovery_calls by name';
    END IF;
    SELECT * INTO j FROM ops.scheduled_jobs s WHERE s.name = 'scheduling-expire-discovery-calls';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL scheduling-expire-discovery-calls is not registered; reset the database once the function exists';
    END IF;
    IF NOT j.enabled OR j.kind <> 'sql' OR j.schedule <> '1,16,31,46 * * * *'
       OR j.command <> 'SELECT scheduling.fn_expire_discovery_calls();' THEN
        RAISE EXCEPTION 'FAIL the expiry job is registered as % / % / % (enabled %)', j.kind, j.schedule, j.command, j.enabled;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job c
                    WHERE c.jobname = 'scheduling-expire-discovery-calls' AND c.active
                      AND c.schedule = '1,16,31,46 * * * *') THEN
        RAISE EXCEPTION 'FAIL pg_cron does not run scheduling-expire-discovery-calls';
    END IF;
    RAISE NOTICE 'PASS only the service role may run the sweep, and pg_cron runs it at :01/:16/:31/:46';
END $$;

-- The by-hand path, `deno task cron:run scheduling-expire-discovery-calls`, is the registry's own
-- runner as the service role. On the swept database it finds nothing and tells nobody.
SET LOCAL ROLE service_role;
DO $$
DECLARE r jsonb;
BEGIN
    r := ops.run_job('scheduling-expire-discovery-calls');
    IF r ->> 'kind' <> 'sql' OR (r #>> '{result,fn_expire_discovery_calls}')::integer IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'FAIL ops.run_job answered % on a swept database', r;
    END IF;
    RAISE NOTICE 'PASS the job runs by hand through ops.run_job [%]', r;
END $$;
RESET ROLE;

DO $$
DECLARE k text;
BEGIN
    FOREACH k IN ARRAY ARRAY['probe.stale', 'probe.started'] LOOP
        IF pg_temp.notices(k, 'host') <> 1 OR pg_temp.notices(k, 'requester') <> 1 THEN
            RAISE EXCEPTION 'FAIL the by-hand run told the parties of the % call again', k;
        END IF;
    END LOOP;
END $$;
-- #endregion

ROLLBACK;
