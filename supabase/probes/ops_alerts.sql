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
            AND r.min_level = 'error' AND r.channel IN ('webhook', 'email')) = 2
        AND (SELECT count(*) FROM ops.alert_rules r WHERE r.kind = 'silence'
            AND r.scope_pattern IN ('finance.reconcile_wallets', 'finance.conservation')) = 4
        AND (SELECT count(*) FROM ops.alert_rules r WHERE r.scope_pattern = 'ops.scheduler' AND r.min_level = 'error') = 2,
        '1 the seeded rules: money errors and job failures on both channels, two dead-man scopes');
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
        (SELECT count(*) FROM pg_temp.group_rows(v_key)) = 2 AND jsonb_array_length(v_mine) = 2
        AND (SELECT array_agg(d ->> 'channel' ORDER BY d ->> 'channel') FROM jsonb_array_elements(v_mine) d)
            = ARRAY['email', 'webhook'],
        '2 one drift row opens one delivery per channel, and both are leased');
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
        AND (SELECT sum(count) FROM pg_temp.group_rows(v_key)) = 2
        AND (SELECT count(*) FROM ops.alert_seen s JOIN ops.alert_deliveries d ON d.id = s.delivery_id
              WHERE d.group_key = v_key) = 2,
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
        (SELECT count(*) FROM pg_temp.group_rows(v_key)) = 2
        AND (SELECT min(count) FROM pg_temp.group_rows(v_key)) = 2,
        '3 the same drift the next night folds into the open alert (count 2, no new delivery)');

    PERFORM pg_temp.log('finance.reconcile_wallets', 'error', v_data, now() + interval '48 hours');
    PERFORM ops.fn_claim_alerts(500);
    PERFORM pg_temp.check(
        (SELECT count(*) FROM pg_temp.group_rows(v_key)) = 4
        AND (SELECT count(*) FROM pg_temp.group_rows(v_key) d WHERE d.first_seen > now() + interval '47 hours') = 2,
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
        AND jsonb_array_length(v_read -> 'rules') >= 8
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

ROLLBACK;
