-- =============================================================================================
-- Probe: money and job alerts (MR4, Decision #461) — `ops.fn_claim_alerts` folds new server log rows
-- into one delivery per scope and fingerprint per dedupe window, raises a dead-man alert for a silent
-- scope, and leases what is due; `ops.fn_record_alert_delivery` records each send; operators read it
-- through `ops.read_alert_deliveries` (00001660).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/ops_alerts.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. Every assertion reads
-- the probe's own groups (a probe wallet id, a probe scope), so rows the database already holds never
-- move the figures.
--
--   1  grants and shape: the claim and the record are pinned definers only the service role runs; the
--      operator read is a STABLE pinned definer for signed-in callers, never anon; no client role
--      reads the three tables; the job and the seeded rules are there
--   2  the claim cursor is idempotent: a drift row opens one delivery per channel, a second run folds
--      and leases nothing; the payload carries figures and short ids, never the message or an address
--   3  dedupe: the same drift a night later folds into the open alert; past the window it alerts again;
--      a metric row (the reconciliation's heartbeat, which every run now writes) never alerts
--   4  the dead-man switch: a scope silent past its window opens one alert, a second run folds it, and
--      a scope that wrote a row stays quiet
--   5  a failed send stays pending with backoff and comes back when due; a success is final and a
--      replayed record changes nothing
--   6  the operator read: a member and a caller with no JWT get 42501; an operator sees the deliveries
--   7  the record is kept: no delete
--  OPS5 — job failures, a stale job, a failing webhook and a dead watcher reach a person:
--   8  grants and shape: every new door is a pinned definer only the service role runs; the rules,
--      the three parameters and the ops.alert notice type are seeded
--   9  the cadence parser: the largest gap between fire times in a day; what it cannot read is NULL,
--      and every seeded schedule reads
--  10  a scheduler failure opens one alert per channel, folds inside its hour, alerts again after it;
--      a configuration skip (warn) alerts too
--  11  a stale job: one error once past job_stale_factor × its cadence (never finer than the
--      watcher's), once a day while it lasts, nothing once it succeeds; an unreadable schedule warns
--      once
--  12  a webhook burst: six failures are one row; the pass writes one summary, once an hour; a
--      signature burst reaches the webhook channel only; below the threshold, or cleared, nothing
--  13  the heartbeat: the watcher's last success and the oldest pending alert
--  14  the in-app channel: one notice per operator, recorded in the same step, never twice
--  15  the drill: ops.fn_raise_alert('test') reaches every channel once; no other scope
--  16  anon and authenticated read nothing and execute nothing
-- =============================================================================================

BEGIN;
-- The pg_temp helpers below run as anon and authenticated, and 00002500 gives a new function no PUBLIC
-- EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Helpers (as postgres)
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- A server log row as a money check writes one.
CREATE FUNCTION pg_temp.log(p_scope text, p_level text, p_data jsonb, p_at timestamptz DEFAULT now())
RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data, created_at)
    VALUES ('probe:ops_alerts', p_level,
            'Wallet drifted for ada.lovelace@example.com, IBAN GB29NWBK60161331926819', p_at, 'server',
            p_scope, p_data, p_at)
    RETURNING id;
$$;

-- The deliveries of one group, by channel.
CREATE FUNCTION pg_temp.group_rows(p_key text) RETURNS SETOF ops.alert_deliveries LANGUAGE sql AS $$
    SELECT * FROM ops.alert_deliveries d WHERE d.group_key = p_key ORDER BY d.channel, d.created_at;
$$;

CREATE FUNCTION pg_temp.read_state(p_user uuid, p_authenticated boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text := '';
BEGIN
    IF p_user IS NULL AND p_authenticated THEN
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('role', 'authenticated', true);
    ELSE
        PERFORM pg_temp.act(p_user);
    END IF;
    BEGIN
        PERFORM ops.read_alert_deliveries();
    EXCEPTION WHEN OTHERS THEN
        v := SQLSTATE;
    END;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;
-- #endregion

-- #region 1. Grants and shape
DO $$
DECLARE
    f record;
BEGIN
    FOR f IN SELECT p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig
               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'ops' AND p.proname IN ('fn_claim_alerts', 'fn_record_alert_delivery')
    LOOP
        PERFORM pg_temp.check(
            f.prosecdef AND f.provolatile = 'v' AND f.proconfig @> ARRAY['search_path=""']
            AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
            AND has_function_privilege('service_role', f.oid, 'EXECUTE'),
            format('1 ops.%s is a pinned definer only the service role runs', f.proname));
    END LOOP;
    SELECT p.oid, p.prosecdef, p.provolatile, p.proconfig INTO f
      FROM pg_proc p WHERE p.oid = 'ops.read_alert_deliveries()'::regprocedure;
    PERFORM pg_temp.check(
        f.prosecdef AND f.provolatile = 's' AND f.proconfig @> ARRAY['search_path=""']
        AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
        AND has_function_privilege('authenticated', f.oid, 'EXECUTE'),
        '1 the operator read is a STABLE pinned definer for signed-in callers, never anon');
    PERFORM pg_temp.check(
        NOT has_table_privilege('authenticated', 'ops.alert_deliveries', 'SELECT')
        AND NOT has_table_privilege('anon', 'ops.alert_deliveries', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'ops.alert_rules', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'ops.alert_seen', 'SELECT')
        AND has_table_privilege('service_role', 'ops.alert_deliveries', 'SELECT'),
        '1 no client role reads the alert tables');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.scheduled_jobs j WHERE j.name = 'ops-deliver-alerts' AND j.kind = 'http'
                   AND j.secret_name = 'OPS_CRON_SECRET' AND j.path LIKE '/api/ops/cron/alerts%'),
        '1 the ops-deliver-alerts http job is registered on OPS_CRON_SECRET');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.alert_rules r WHERE r.kind = 'level' AND r.scope_pattern = 'finance.%'
            AND r.min_level = 'error' AND r.channel IN ('webhook', 'email', 'in_app')) = 3
        AND (SELECT count(*) FROM ops.alert_rules r WHERE r.kind = 'silence'
            AND r.scope_pattern IN ('finance.reconcile_wallets', 'finance.conservation')) = 6
        AND (SELECT count(*) FROM ops.alert_rules r WHERE r.scope_pattern = 'ops.scheduler' AND r.min_level = 'warn'
            AND r.dedupe_window = interval '1 hour') = 3,
        '1 the seeded rules: money errors and every scheduler row on all three channels, two dead-man scopes');
END $$;
-- #endregion

-- #region 2. The claim cursor is idempotent, and the payload is figures and short ids
DO $$
DECLARE
    v_wallet uuid := gen_random_uuid();
    v_key text := 'finance.reconcile_wallets:' || v_wallet::text;
    v_first jsonb;
    v_second jsonb;
    v_mine jsonb;
    v_payload text;
BEGIN
    PERFORM pg_temp.log('finance.reconcile_wallets', 'error',
        jsonb_build_object('wallet_id', v_wallet, 'currency', 'USD', 'balance_cents', 1700, 'ledger_sum_cents', 1000,
                           'owner_type', 'freelancer', 'note', 'paid to ada.lovelace@example.com'));
    v_first := ops.fn_claim_alerts(500);
    SELECT jsonb_agg(d) INTO v_mine FROM jsonb_array_elements(v_first -> 'deliveries') d
     WHERE d ->> 'scope' = 'finance.reconcile_wallets' AND d ->> 'fingerprint' = left(v_wallet::text, 8);
    PERFORM pg_temp.check(
        (SELECT count(*) FROM pg_temp.group_rows(v_key)) = 3 AND jsonb_array_length(v_mine) = 3
        AND (SELECT array_agg(d ->> 'channel' ORDER BY d ->> 'channel') FROM jsonb_array_elements(v_mine) d)
            = ARRAY['email', 'in_app', 'webhook'],
        '2 one drift row opens one delivery per channel, and all three are leased');
    v_payload := v_mine::text;
    PERFORM pg_temp.check(
        v_payload NOT LIKE '%@%' AND v_payload NOT LIKE '%IBAN%' AND v_payload NOT LIKE '%GB29%'
        AND v_payload NOT LIKE '%' || v_wallet::text || '%'
        AND (v_mine -> 0 -> 'sample' ->> 'balance_cents')::bigint = 1700
        AND v_mine -> 0 -> 'sample' ->> 'wallet_id' = left(v_wallet::text, 8)
        AND v_mine -> 0 -> 'sample' ->> 'currency' = 'USD'
        AND NOT (v_mine -> 0 -> 'sample' ? 'note'),
        '2 the payload carries the figures and an 8-character id, never the message, an address or the full id');

    v_second := ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_second -> 'deliveries') d
                     WHERE d ->> 'fingerprint' = left(v_wallet::text, 8))
        AND (SELECT sum(count) FROM pg_temp.group_rows(v_key)) = 3
        AND (SELECT count(*) FROM ops.alert_seen s JOIN ops.alert_deliveries d ON d.id = s.delivery_id
              WHERE d.group_key = v_key) = 3,
        '2 a second run folds nothing again and leases nothing twice');
    PERFORM set_config('probe.wallet', v_wallet::text, true);
END $$;
-- #endregion

-- #region 3. Dedupe inside the window, again after it; a metric row never alerts
DO $$
DECLARE
    v_wallet uuid := current_setting('probe.wallet')::uuid;
    v_key text := 'finance.reconcile_wallets:' || v_wallet::text;
    v_data jsonb := jsonb_build_object('wallet_id', v_wallet, 'currency', 'USD', 'balance_cents', 1800);
    v_before bigint;
BEGIN
    PERFORM pg_temp.log('finance.reconcile_wallets', 'error', v_data, now() + interval '24 hours');
    PERFORM ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT count(*) FROM pg_temp.group_rows(v_key)) = 3
        AND (SELECT min(count) FROM pg_temp.group_rows(v_key)) = 2,
        '3 the same drift the next night folds into the open alert (count 2, no new delivery)');

    PERFORM pg_temp.log('finance.reconcile_wallets', 'error', v_data, now() + interval '48 hours');
    PERFORM ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT count(*) FROM pg_temp.group_rows(v_key)) = 6
        AND (SELECT count(*) FROM pg_temp.group_rows(v_key) d WHERE d.first_seen > now() + interval '47 hours') = 3,
        '3 past its 36-hour window the same drift alerts again, once per channel');

    SELECT count(*) INTO v_before FROM ops.alert_deliveries;
    PERFORM finance.fn_reconcile_wallets();
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.log_entries l WHERE l.scope = 'finance.reconcile_wallets' AND l.level = 'metric'
                   AND l.created_at = now() AND l.data ? 'drifted'),
        '3 every reconciliation run writes its metric heartbeat');
    PERFORM ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM ops.alert_seen s JOIN ops.log_entries l ON l.id = s.log_entry_id
                     WHERE l.level = 'metric'),
        '3 a metric row is never folded into an alert');
END $$;
-- #endregion

-- #region 4. The dead-man switch
DO $$
DECLARE
    v_rule uuid;
    v_out jsonb;
BEGIN
    INSERT INTO ops.alert_rules (kind, scope_pattern, max_silence, channel, dedupe_window, description, created_at)
    VALUES ('silence', 'probe.heartbeat', interval '26 hours', 'webhook', interval '24 hours', 'probe', now() - interval '3 days')
    RETURNING id INTO v_rule;
    INSERT INTO ops.alert_rules (kind, scope_pattern, max_silence, channel, dedupe_window, description, created_at)
    VALUES ('silence', 'probe.alive', interval '26 hours', 'webhook', interval '24 hours', 'probe', now() - interval '3 days');
    PERFORM pg_temp.log('probe.alive', 'metric', '{}'::jsonb, now() - interval '1 hour');

    v_out := ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT count(*) FROM pg_temp.group_rows('silence:probe.heartbeat')) = 1
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'deliveries') d
                     WHERE d ->> 'scope' = 'probe.heartbeat' AND d ->> 'fingerprint' = 'silence'
                       AND (d -> 'sample' ->> 'silent_minutes')::bigint >= 26 * 60)
        AND (SELECT count(*) FROM pg_temp.group_rows('silence:probe.alive')) = 0,
        '4 a scope silent past its window raises one dead-man alert; a scope that wrote a row does not');
    PERFORM ops.fn_claim_alerts(500);
    PERFORM pg_temp.check((SELECT count(*) FROM pg_temp.group_rows('silence:probe.heartbeat')) = 1,
        '4 a second run while still silent opens no second alert');
END $$;
-- #endregion

-- #region 5. A failed send stays pending and retries; a success is final
DO $$
DECLARE
    v_key text := 'finance.reconcile_wallets:' || current_setting('probe.wallet');
    d ops.alert_deliveries;
    v_rec jsonb;
    v_out jsonb;
BEGIN
    SELECT * INTO d FROM pg_temp.group_rows(v_key) x WHERE x.channel = 'webhook' ORDER BY x.created_at LIMIT 1;
    v_rec := ops.fn_record_alert_delivery(d.id, false, '503');
    SELECT * INTO d FROM ops.alert_deliveries WHERE id = d.id;
    PERFORM pg_temp.check(
        d.status = 'pending' AND d.attempts = 1 AND d.last_error = '503' AND d.lease_until IS NULL
        AND d.next_attempt_at = now() + interval '2 minutes',
        '5 a failed send stays pending, counts the attempt and backs off 2 minutes');
    v_out := ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'deliveries') x
                                       WHERE (x ->> 'id')::uuid = d.id),
        '5 it is not claimed again before its next attempt');
    UPDATE ops.alert_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id = d.id;
    v_out := ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(EXISTS (SELECT 1 FROM jsonb_array_elements(v_out -> 'deliveries') x
                                   WHERE (x ->> 'id')::uuid = d.id AND (x ->> 'attempts')::int = 1),
        '5 once due it is claimed again, its attempts carried');
    PERFORM ops.fn_record_alert_delivery(d.id, false, '503');
    SELECT * INTO d FROM ops.alert_deliveries WHERE id = d.id;
    PERFORM pg_temp.check(d.next_attempt_at = now() + interval '4 minutes',
        '5 the second failure backs off 4 minutes');
    v_rec := ops.fn_record_alert_delivery(d.id, true);
    PERFORM pg_temp.check(v_rec ->> 'status' = 'sent' AND (v_rec ->> 'replayed')::boolean = false,
        '5 a success marks it sent');
    v_rec := ops.fn_record_alert_delivery(d.id, false, 'late');
    SELECT * INTO d FROM ops.alert_deliveries WHERE id = d.id;
    PERFORM pg_temp.check((v_rec ->> 'replayed')::boolean AND d.status = 'sent' AND d.last_error IS NULL,
        '5 a record after it is sent changes nothing');
END $$;
-- #endregion

-- #region 6. The operator read
DO $$
DECLARE
    v_operator uuid;
    v_member uuid;
    v_read jsonb;
BEGIN
    SELECT a.user_id INTO v_operator FROM ops.admin_users a ORDER BY a.created_at LIMIT 1;
    SELECT u.user_id INTO v_member FROM org.users_public u
     WHERE NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    PERFORM pg_temp.check(pg_temp.read_state(v_member) = '42501', '6 a member is refused (42501)');
    PERFORM pg_temp.check(pg_temp.read_state(NULL, true) = '42501', '6 a caller with no JWT is refused (42501)');
    PERFORM pg_temp.act(v_operator);
    v_read := ops.read_alert_deliveries();
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM jsonb_array_elements(v_read -> 'deliveries') d
                 WHERE d ->> 'fingerprint' = left(current_setting('probe.wallet'), 8))
        AND jsonb_array_length(v_read -> 'rules') >= 18
        AND v_read::text NOT LIKE '%@%',
        '6 an operator sees the deliveries, short ids only');
END $$;
-- #endregion

-- #region 7. The record is kept
DO $$
DECLARE v text := '';
BEGIN
    BEGIN
        DELETE FROM ops.alert_deliveries WHERE group_key LIKE 'silence:probe.%';
    EXCEPTION WHEN OTHERS THEN
        v := SQLSTATE;
    END;
    PERFORM pg_temp.check(v = 'PL403', '7 a delivery cannot be deleted (PL403)');
END $$;
-- #endregion

-- #region 8. OPS5 grants and shape
DO $$
DECLARE
    f record;
    v_sig text;
BEGIN
    FOREACH v_sig IN ARRAY ARRAY[
        'ops.fn_report_stale_jobs(timestamptz,integer)',
        'ops.fn_watch_webhooks(timestamptz,integer)',
        'ops.fn_record_webhook_failure(text,text,integer,text,integer,text,text)',
        'ops.fn_heartbeat(timestamptz)',
        'ops.fn_deliver_alert_in_app(uuid,text,text)',
        'ops.fn_raise_alert(text,text)'
    ] LOOP
        SELECT p.oid, p.prosecdef, p.proconfig INTO f FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
        PERFORM pg_temp.check(
            f.prosecdef AND f.proconfig @> ARRAY['search_path=""']
            AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
            AND has_function_privilege('service_role', f.oid, 'EXECUTE'),
            format('8 %s is a pinned definer only the service role runs', v_sig));
    END LOOP;
    FOREACH v_sig IN ARRAY ARRAY['ops.fn_cron_max_gap(text)', 'ops.fn_cron_field_values(text,integer,integer)'] LOOP
        SELECT p.oid, p.provolatile, p.proconfig INTO f FROM pg_proc p WHERE p.oid = v_sig::regprocedure;
        PERFORM pg_temp.check(
            f.provolatile = 'i' AND f.proconfig @> ARRAY['search_path=""']
            AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE'),
            format('8 %s is an immutable pinned helper no client runs', v_sig));
    END LOOP;
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.alert_rules r WHERE r.kind = 'level' AND r.scope_pattern = 'ops.webhooks'
            AND ((r.channel = 'webhook' AND r.min_level = 'warn') OR (r.channel IN ('email', 'in_app') AND r.min_level = 'error'))
            AND r.dedupe_window = interval '1 hour') = 3
        AND (SELECT count(*) FROM ops.alert_rules r WHERE r.kind = 'level' AND r.scope_pattern = 'test'
            AND r.min_level = 'warn') = 3
        AND NOT EXISTS (SELECT 1 FROM ops.alert_rules r WHERE r.scope_pattern LIKE 'webhook.%'),
        '8 the rules: a failing webhook on every channel, a signature burst by webhook only, the drill everywhere, no raw webhook scope');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM security.platform_params pp WHERE
            (pp.key = 'job_stale_factor' AND pp.value = '3'::jsonb)
            OR (pp.key = 'webhook_failure_threshold' AND pp.value = '5'::jsonb)
            OR (pp.key = 'heartbeat_watch_minutes' AND pp.value = '30'::jsonb)) = 3,
        '8 the three parameters are seeded at 3, 5 and 30');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM comms.notification_types t WHERE t.key = 'ops.alert' AND t.category = 'system'
                   AND t.urgency = 'high' AND t.default_channels = ARRAY['in_app']::comms.notification_channel[]
                   AND t.mandatory),
        '8 the ops.alert notice type is system, high, in-app only and mandatory');
END $$;
-- #endregion

-- #region 9. The cadence parser
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN SELECT * FROM (VALUES
        ('*/10 * * * *', 10), ('4,19,34,49 * * * *', 15), ('20 2 * * *', 1440), ('* * * * *', 1),
        ('2-57/5 * * * *', 5), ('15 * * * *', 60), ('0 */6 * * *', 360), ('0 9,17 * * *', 960),
        ('10-20 3 * * *', 1430)
    ) AS v (schedule, minutes) LOOP
        PERFORM pg_temp.check(ops.fn_cron_max_gap(c.schedule) = make_interval(mins => c.minutes),
            format('9 %s has a largest gap of %s minutes', c.schedule, c.minutes));
    END LOOP;
    FOR c IN SELECT * FROM (VALUES
        ('0 12 * * 1'), ('0 0 1 * *'), ('30 seconds'), ('5/10 * * * *'), ('61 * * * *'), ('0 25 * * *'),
        ('*/0 * * * *'), ('20-10 * * * *'), (''), ('@daily')
    ) AS v (schedule) LOOP
        PERFORM pg_temp.check(ops.fn_cron_max_gap(c.schedule) IS NULL,
            format('9 "%s" is not read (NULL)', c.schedule));
    END LOOP;
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM ops.scheduled_jobs j WHERE ops.fn_cron_max_gap(j.schedule) IS NULL),
        '9 every seeded schedule is read');
END $$;
-- #endregion

-- #region 10. A scheduler failure alerts once per window on every channel; a skip alerts too
DO $$
DECLARE
    v_key text := 'ops.scheduler:ops5-probe-failing:http_failed';
    v_out jsonb;
BEGIN
    PERFORM ops.fn_log_scheduler_event('ops5-probe-failing', 'http_failed', 'error',
        'ops5-probe-failing answered 500 for ada.lovelace@example.com.', jsonb_build_object('status_code', 500));
    v_out := ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT array_agg(d ->> 'channel' ORDER BY d ->> 'channel') FROM jsonb_array_elements(v_out -> 'deliveries') d
          WHERE d ->> 'fingerprint' = 'ops5-probe-failing:http_failed') = ARRAY['email', 'in_app', 'webhook']
        AND (SELECT bool_and((d -> 'sample' ->> 'status_code')::int = 500 AND d -> 'sample' ->> 'job' = 'ops5-probe-failing'
                             AND d -> 'sample' ->> 'reason' = 'http_failed' AND d::text NOT LIKE '%@%')
               FROM jsonb_array_elements(v_out -> 'deliveries') d WHERE d ->> 'fingerprint' = 'ops5-probe-failing:http_failed'),
        '10 an http_failed row opens one alert per channel naming the job, the reason and the status, no message');

    PERFORM ops.fn_log_scheduler_event('ops5-probe-failing', 'http_failed', 'error', 'again', '{}'::jsonb);
    PERFORM ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT count(*) FROM pg_temp.group_rows(v_key)) = 3 AND (SELECT min(count) FROM pg_temp.group_rows(v_key)) = 2,
        '10 a repeat inside the hour folds into the open alerts (count 2, none new)');

    PERFORM pg_temp.log('ops.scheduler', 'error',
        jsonb_build_object('job', 'ops5-probe-failing', 'reason', 'http_failed'), now() + interval '61 minutes');
    PERFORM ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT count(*) FROM pg_temp.group_rows(v_key)) = 6
        AND (SELECT count(*) FROM pg_temp.group_rows(v_key) d WHERE d.first_seen > now() + interval '1 hour') = 3,
        '10 past its hour the same failure alerts again, once per channel');

    PERFORM ops.fn_log_scheduler_event('ops5-probe-skipping', 'secret_missing', 'warn',
        'Vault secret OPS5_PROBE_SECRET is missing.', jsonb_build_object('secret_name', 'OPS5_PROBE_SECRET'), true);
    PERFORM ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT count(*) FROM pg_temp.group_rows('ops.scheduler:ops5-probe-skipping:secret_missing') d
          WHERE d.level = 'warn') = 3,
        '10 a configuration skip (warn) alerts on every channel');
END $$;
-- #endregion

-- #region 11. A stale job
DO $$
DECLARE
    v_jobid bigint;
    v_rows integer;
BEGIN
    INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
        ('ops5-probe-stale', 'http', '0 * * * *', NULL, '/api/ops5-probe', 'OPS5_PROBE_SECRET', 'probe'),
        ('ops5-probe-healthy', 'http', '0 * * * *', NULL, '/api/ops5-probe', 'OPS5_PROBE_SECRET', 'probe'),
        ('ops5-probe-weekly', 'sql', '0 12 * * 1', 'SELECT 1;', NULL, NULL, 'probe');

    PERFORM ops.fn_report_stale_jobs(now() + interval '2 hours');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM ops.log_entries l WHERE l.client_id IN ('scheduler:ops5-probe-stale:stale', 'scheduler:ops5-probe-healthy:stale')),
        '11 an hourly job two hours without a success is not yet stale (3 × 60 minutes)');

    PERFORM ops.fn_report_stale_jobs(now() + interval '4 hours');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-stale:stale'
            AND l.level = 'error' AND l.scope = 'ops.scheduler' AND (l.data ->> 'cadence_minutes')::int = 60) = 1,
        '11 four hours without a success writes one stale error');
    PERFORM ops.fn_report_stale_jobs(now() + interval '4 hours');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-stale:stale') = 1,
        '11 a second pass the same day writes nothing more');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM jsonb_array_elements((ops.fn_claim_alerts(500)) -> 'deliveries') d
          WHERE d ->> 'fingerprint' = 'ops5-probe-stale:stale') = 3,
        '11 the stale job opens one claimable alert per channel');

    INSERT INTO ops.http_job_dispatches (job_name, request_id, dispatched_at, settled_at, status_code)
    VALUES ('ops5-probe-healthy', -1, now() + interval '28 hours', now() + interval '28 hours', 200);
    PERFORM ops.fn_report_stale_jobs(now() + interval '29 hours');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-stale:stale') = 2
        AND (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-healthy:stale') = 1,
        '11 a day later a still-stale job writes again, and one that has since succeeded writes nothing new');

    INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description)
    VALUES ('ops5-probe-sql', 'sql', '*/5 * * * *', 'SELECT 1;', NULL, NULL, 'probe');
    SELECT c.jobid INTO v_jobid FROM cron.job c WHERE c.jobname = 'ops5-probe-sql';
    INSERT INTO cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
    VALUES (v_jobid, -1, 0, 'postgres', 'postgres', 'SELECT 1;', 'succeeded', '1 row', now(), now());
    PERFORM ops.fn_report_stale_jobs(now() + interval '20 minutes');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-sql:stale'),
        '11 a 5-minute sql job 20 minutes after a success is not stale: the watcher sees every 10 minutes, so 3 × 10');
    PERFORM ops.fn_report_stale_jobs(now() + interval '40 minutes');
    PERFORM pg_temp.check(
        EXISTS (SELECT 1 FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-sql:stale'
                   AND (l.data ->> 'cadence_minutes')::int = 10),
        '11 40 minutes after it, it is (the cadence read from cron.job_run_details)');

    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-weekly:cadence_unknown'
            AND l.level = 'warn' AND l.data ->> 'schedule' = '0 12 * * 1') = 1,
        '11 a schedule the check cannot read is warned about');
    PERFORM ops.fn_report_stale_jobs(now() + interval '30 days');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-weekly:cadence_unknown') = 1,
        '11 once, however many passes follow');

    SELECT count(*) INTO v_rows FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-stale:stale';
    UPDATE ops.scheduled_jobs SET enabled = false WHERE name = 'ops5-probe-stale';
    PERFORM ops.fn_report_stale_jobs(now() + interval '60 days');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'scheduler:ops5-probe-stale:stale') = v_rows,
        '11 a paused job is not watched');
END $$;
-- #endregion

-- #region 12. A webhook burst
DO $$
DECLARE
    v_out jsonb;
    v_err text := '';
BEGIN
    FOR i IN 1 .. 6 LOOP
        PERFORM ops.fn_record_webhook_failure('probeprov', 'failure', 500, 'handler_failed', 1, 'evt_probe' || i, 'invoice.paid');
    END LOOP;
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.scope = 'webhook.probeprov') = 1
        AND (SELECT (l.data ->> 'count')::int FROM ops.log_entries l WHERE l.scope = 'webhook.probeprov') = 6
        AND (SELECT l.level FROM ops.log_entries l WHERE l.scope = 'webhook.probeprov') = 'warn',
        '12 six failures in one minute are one warn row counting 6');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements((ops.fn_claim_alerts(500)) -> 'deliveries') d
                     WHERE d ->> 'scope' LIKE 'webhook.%'),
        '12 a raw webhook row never alerts by itself');

    PERFORM ops.fn_watch_webhooks(now());
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.scope = 'ops.webhooks' AND l.client_id = 'webhook:probeprov:failing'
            AND l.level = 'error' AND (l.data ->> 'failures')::int = 6) = 1,
        '12 the pass writes one failing summary for the provider');
    v_out := ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT array_agg(d ->> 'channel' ORDER BY d ->> 'channel') FROM jsonb_array_elements(v_out -> 'deliveries') d
          WHERE d ->> 'fingerprint' = 'probeprov:failing') = ARRAY['email', 'in_app', 'webhook']
        AND (SELECT bool_and(d -> 'sample' ->> 'provider' = 'probeprov' AND (d -> 'sample' ->> 'failures')::int = 6
                             AND d::text NOT LIKE '%evt_probe%')
               FROM jsonb_array_elements(v_out -> 'deliveries') d WHERE d ->> 'fingerprint' = 'probeprov:failing'),
        '12 the burst opens one alert per channel naming the provider and the count, never an event id');
    PERFORM ops.fn_watch_webhooks(now());
    PERFORM ops.fn_watch_webhooks(now() + interval '30 minutes');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'webhook:probeprov:failing') = 1,
        '12 a repeat inside the hour writes nothing');
    PERFORM ops.fn_watch_webhooks(now() + interval '2 hours');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'webhook:probeprov:failing') = 1,
        '12 once the failures stop (none in the last 15 minutes), nothing new is written');
    INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data, created_at)
    VALUES ('webhook:probeprov:failure:minute', 'warn', 'probe', now() + interval '3 hours', 'server', 'webhook.probeprov',
            jsonb_build_object('provider', 'probeprov', 'class', 'failure', 'status', 503, 'count', 7), now() + interval '3 hours');
    PERFORM ops.fn_watch_webhooks(now() + interval '3 hours 1 minute');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'webhook:probeprov:failing') = 2,
        '12 a new burst past the hour writes a second summary');

    FOR i IN 1 .. 5 LOOP
        PERFORM ops.fn_record_webhook_failure('probesig', 'signature', 400, 'signature_invalid');
    END LOOP;
    FOR i IN 1 .. 4 LOOP
        PERFORM ops.fn_record_webhook_failure('probequiet', 'failure', 503, 'not_configured');
    END LOOP;
    FOR i IN 1 .. 9 LOOP
        PERFORM ops.fn_record_webhook_failure('proberefused', 'refused', 404, 'unknown_provider');
    END LOOP;
    PERFORM ops.fn_watch_webhooks(now());
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'webhook:probesig:signature' AND l.level = 'warn') = 1
        AND NOT EXISTS (SELECT 1 FROM ops.log_entries l WHERE l.client_id IN ('webhook:probequiet:failing', 'webhook:proberefused:failing')),
        '12 five signature refusals write one warn summary; four failures, or refusals of another kind, write none');
    v_out := ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT array_agg(d ->> 'channel') FROM jsonb_array_elements(v_out -> 'deliveries') d
          WHERE d ->> 'fingerprint' = 'probesig:signature') = ARRAY['webhook'],
        '12 a signature burst reaches the webhook channel only');
    PERFORM ops.fn_watch_webhooks(now() + interval '2 hours');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM ops.log_entries l WHERE l.client_id = 'webhook:probesig:signature') = 1,
        '12 and is not written again within the day');

    BEGIN
        PERFORM ops.fn_record_webhook_failure('Not A Provider!', 'failure', 500, 'x');
    EXCEPTION WHEN OTHERS THEN
        v_err := SQLSTATE;
    END;
    PERFORM pg_temp.check(v_err = '22023', '12 a provider that is not a short code is refused (22023)');
END $$;
-- #endregion

-- #region 13. The heartbeat
DO $$
DECLARE
    v_jobid bigint;
BEGIN
    UPDATE ops.alert_deliveries SET status = 'sent', sent_at = now(), lease_until = NULL
     WHERE status = 'pending' AND created_at < now();
    SELECT c.jobid INTO v_jobid FROM cron.job c WHERE c.jobname = 'ops-watch-jobs';
    INSERT INTO cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
    VALUES (v_jobid, -2, 0, 'postgres', 'postgres', 'SELECT ops.fn_watch_jobs();', 'succeeded', '1 row', now(), now());
    PERFORM pg_temp.check(ops.fn_heartbeat(now()) = '{"watch": true, "alerts": true}'::jsonb,
        '13 the watcher just ran and no alert has waited: both true');
    PERFORM pg_temp.check((ops.fn_heartbeat(now() + interval '16 minutes') ->> 'alerts')::boolean = false
                          AND (ops.fn_heartbeat(now() + interval '16 minutes') ->> 'watch')::boolean,
        '13 an alert pending for 15 minutes turns alerts false');
    PERFORM pg_temp.check((ops.fn_heartbeat(now() + interval '31 minutes') ->> 'watch')::boolean = false,
        '13 no successful watcher run within heartbeat_watch_minutes turns watch false');
    UPDATE ops.scheduled_jobs SET enabled = false WHERE name = 'ops-watch-jobs';
    PERFORM pg_temp.check((ops.fn_heartbeat(now()) ->> 'watch')::boolean = false,
        '13 a paused watcher turns watch false at once');
    UPDATE ops.scheduled_jobs SET enabled = true WHERE name = 'ops-watch-jobs';
END $$;
-- #endregion

-- #region 14. The in-app channel
DO $$
DECLARE
    d ops.alert_deliveries;
    v_hook ops.alert_deliveries;
    v_operators integer := (SELECT count(*) FROM ops.admin_users);
    v_out jsonb;
    v_err text := '';
BEGIN
    PERFORM ops.fn_log_scheduler_event('ops5-probe-inapp', 'run_failed', 'error', 'probe', '{}'::jsonb);
    PERFORM ops.fn_claim_alerts(500);
    SELECT * INTO d FROM pg_temp.group_rows('ops.scheduler:ops5-probe-inapp:run_failed') x WHERE x.channel = 'in_app';
    SELECT * INTO v_hook FROM pg_temp.group_rows('ops.scheduler:ops5-probe-inapp:run_failed') x WHERE x.channel = 'webhook';
    v_out := ops.fn_deliver_alert_in_app(d.id, '[Projective] ops.scheduler', 'ops5-probe-inapp:run_failed');
    PERFORM pg_temp.check(
        v_operators >= 1 AND (v_out ->> 'notified')::int = v_operators AND v_out ->> 'status' = 'sent'
        AND (SELECT count(*) FROM comms.notifications n WHERE n.type = 'ops.alert' AND n.entity_id = d.id
                AND n.user_id IN (SELECT a.user_id FROM ops.admin_users a)) = v_operators
        AND (SELECT status FROM ops.alert_deliveries WHERE id = d.id) = 'sent',
        '14 an in-app alert is one notice per operator, recorded sent in the same step');
    v_out := ops.fn_deliver_alert_in_app(d.id, 'again', 'again');
    PERFORM pg_temp.check(
        (v_out ->> 'replayed')::boolean
        AND (SELECT count(*) FROM comms.notifications n WHERE n.type = 'ops.alert' AND n.entity_id = d.id) = v_operators,
        '14 a delivery already sent is answered as it is, with no second notice');
    BEGIN
        PERFORM ops.fn_deliver_alert_in_app(v_hook.id, 't', 'b');
    EXCEPTION WHEN OTHERS THEN
        v_err := SQLSTATE;
    END;
    PERFORM pg_temp.check(v_err = '22023', '14 a webhook delivery is refused by the in-app door (22023)');
END $$;
-- #endregion

-- #region 15. The drill
DO $$
DECLARE
    v_raised jsonb;
    v_first jsonb;
    v_second jsonb;
    v_err text := '';
BEGIN
    v_raised := ops.fn_raise_alert('test');
    PERFORM pg_temp.check((v_raised ->> 'rules')::int = 3 AND v_raised ->> 'scope' = 'test',
        '15 a drill row matches the three test rules');
    v_first := ops.fn_claim_alerts(500);
    v_second := ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT array_agg(d ->> 'channel' ORDER BY d ->> 'channel') FROM jsonb_array_elements(v_first -> 'deliveries') d
          WHERE d ->> 'scope' = 'test') = ARRAY['email', 'in_app', 'webhook']
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_second -> 'deliveries') d WHERE d ->> 'scope' = 'test'),
        '15 the next sweep leases one test alert per channel, and the one after leases none');
    BEGIN
        PERFORM ops.fn_raise_alert('finance.reconcile_wallets');
    EXCEPTION WHEN OTHERS THEN
        v_err := SQLSTATE;
    END;
    PERFORM pg_temp.check(v_err = '22023', '15 a drill cannot pose as a money alert (22023)');
END $$;
-- #endregion

-- #region 16. Clients read nothing and execute nothing
DO $$
DECLARE
    v_member uuid;
    v_seen bigint := -1;
    v_state text := '';
BEGIN
    SELECT u.user_id INTO v_member FROM org.users_public u
     WHERE NOT EXISTS (SELECT 1 FROM ops.admin_users a WHERE a.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    PERFORM pg_temp.act(v_member);
    BEGIN
        SELECT count(*) INTO v_seen FROM ops.log_entries l WHERE l.scope IN ('ops.webhooks', 'webhook.probeprov', 'ops.scheduler');
    EXCEPTION WHEN OTHERS THEN
        v_state := SQLSTATE;
    END;
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(v_state = '42501' OR v_seen = 0,
        '16 a signed-in member reads no scheduler or webhook row');
    PERFORM set_config('role', 'anon', true);
    v_state := '';
    v_seen := -1;
    BEGIN
        SELECT count(*) INTO v_seen FROM ops.log_entries l WHERE l.scope IN ('ops.webhooks', 'webhook.probeprov');
    EXCEPTION WHEN OTHERS THEN
        v_state := SQLSTATE;
    END;
    BEGIN
        PERFORM ops.fn_heartbeat();
    EXCEPTION WHEN OTHERS THEN
        v_state := v_state || ':' || SQLSTATE;
    END;
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check((v_state LIKE '42501%' OR v_seen = 0) AND v_state LIKE '%:42501',
        '16 anon reads no webhook row and cannot run the heartbeat');
END $$;
-- #endregion

ROLLBACK;
