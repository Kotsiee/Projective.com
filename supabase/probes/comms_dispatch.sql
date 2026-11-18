-- comms_dispatch.sql — probe for the notification dispatcher's database half (COMMS_BUILD_PROMPTS NT2;
-- Decision #344 (a); #339 ruling N3 (c); CAS §2.3, N8).
--
--   0. Grants: fn_dispatch_enabled, fn_claim_deliveries and fn_record_delivery_result are service
--      role only (00002510's deny-by-default region).
--   1. The trigger: with the flag on and both Vault secrets set, a notification with an outbound
--      channel queues one pg_net request to <CRON_APP_URL>/api/comms/dispatch carrying
--      Authorization: Bearer <COMMS_DISPATCH_SECRET> and {notification_id} alone; an in-app-only
--      notification queues none; with the flag off, none.
--   2. A bad bearer in Vault: no request, a WARNING and an ops.log_entries row (scheduler style).
--   3. The claim: a hard-suppressed email comes back 'suppressed', a person with no phone 'skipped',
--      a reachable email 'queued' with its address; a channel not asked for stays pending; a
--      marketing-only suppression does not block a system notice; with the flag off nothing is
--      claimed. Backoff, attempts cap, lease and the 24-hour window.
--   4. The result: monotonic sent → delivered, a refused status, and push 'gone' revoking the device.
--
-- Every section runs in a transaction that is ROLLED BACK, so this is safe on the shared local DB.
-- The two-session claim race is comms_dispatch_race.sql (it commits).
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/comms_dispatch.sql
\set ON_ERROR_STOP on
\set QUIET on

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;
-- Section 0 calls it as service_role, and 00002500 gives a new function no PUBLIC EXECUTE.
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text) TO service_role;

-- The n-th seeded person with notification preferences and a primary verified email.
CREATE FUNCTION pg_temp.person(p_n int) RETURNS uuid LANGUAGE sql AS $$
    SELECT p.user_id
      FROM comms.notification_prefs p
      JOIN org.user_emails ue ON ue.user_id = p.user_id AND ue.is_primary AND ue.verified_at IS NOT NULL
     ORDER BY p.user_id OFFSET p_n - 1 LIMIT 1;
$$;

CREATE FUNCTION pg_temp.address(p_user uuid) RETURNS text LANGUAGE sql AS $$
    SELECT email FROM org.user_emails WHERE user_id = p_user AND is_primary;
$$;

-- Set (or replace) a Vault secret inside the probe's transaction.
CREATE FUNCTION pg_temp.vault_set(p_name text, p_value text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id FROM vault.secrets WHERE name = p_name;
    IF v_id IS NULL THEN
        PERFORM vault.create_secret(p_value, p_name);
    ELSE
        PERFORM vault.update_secret(v_id, p_value);
    END IF;
END $$;

-- Quiet hours, snoozes and digests off, so a mandatory probe type fans out to its every channel.
CREATE FUNCTION pg_temp.reset_prefs(p_users uuid[]) RETURNS void LANGUAGE sql AS $$
    UPDATE comms.notification_prefs
       SET quiet_hours_enabled = false, quiet_hours = NULL, muted_until = NULL, digest_frequency = 'off'
     WHERE user_id = ANY (p_users);
$$;

-- The probe's catalog types: mandatory system notices (they ignore preferences) on chosen channels.
CREATE FUNCTION pg_temp.types() RETURNS void LANGUAGE sql AS $$
    INSERT INTO comms.notification_types (key, category, urgency, default_channels, mandatory, digestible)
    VALUES ('probe.dispatch_out', 'system', 'high', '{in_app,email,sms}', true, false),
           ('probe.dispatch_push', 'system', 'high', '{in_app,push}', true, false),
           ('probe.dispatch_inapp', 'system', 'high', '{in_app}', true, false)
    ON CONFLICT (key) DO NOTHING;
$$;

CREATE FUNCTION pg_temp.flag(p_on boolean) RETURNS void LANGUAGE sql AS $$
    UPDATE security.feature_flags SET enabled = p_on WHERE key = 'comms.dispatch_webhook';
$$;

CREATE FUNCTION pg_temp.delivery(p_notification uuid, p_channel comms.notification_channel)
RETURNS comms.notification_deliveries LANGUAGE sql AS $$
    SELECT * FROM comms.notification_deliveries WHERE notification_id = p_notification AND channel = p_channel LIMIT 1;
$$;

DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.person(3) IS NOT NULL, 'fixture: three seeded people with a primary verified email');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM security.feature_flags WHERE key = 'comms.dispatch_webhook' AND NOT enabled),
        'fixture: the comms.dispatch_webhook flag is seeded off');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM security.platform_params WHERE key = 'comms_dispatch_url'),
        'the comms_dispatch_url placeholder is retired');
    PERFORM pg_temp.ok(EXISTS (
            SELECT 1 FROM ops.scheduled_jobs
             WHERE name = 'comms-dispatch-sweep' AND kind = 'http' AND schedule = '* * * * *'
               AND path = '/api/comms/cron/dispatch?limit=200' AND secret_name = 'COMMS_DISPATCH_SECRET'),
        'comms-dispatch-sweep is registered: http, every minute, on COMMS_DISPATCH_SECRET');
END $$;
-- #endregion

-- #region 0. Grants — service role only
DO $$
DECLARE
    v_fn text;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'comms.fn_dispatch_enabled()',
        'comms.fn_claim_deliveries(comms.notification_channel[],uuid,integer)',
        'comms.fn_record_delivery_result(uuid,comms.delivery_status,text,text,text)'
    ] LOOP
        PERFORM pg_temp.ok(
            has_function_privilege('service_role', v_fn, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
            v_fn || ' is executable by service_role only');
    END LOOP;
    PERFORM pg_temp.ok(has_schema_privilege('service_role', 'comms', 'USAGE'),
        'service_role may use the comms schema, without which no grant above is callable');
END $$;

-- The dispatcher's own road: each function, called as service_role.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
BEGIN
    PERFORM pg_temp.ok(comms.fn_dispatch_enabled() IS FALSE, 'as service_role: fn_dispatch_enabled answers (off)');
    PERFORM pg_temp.ok((SELECT count(*) FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[])) = 0,
        'as service_role: fn_claim_deliveries answers (nothing while the flag is off)');
    PERFORM pg_temp.ok(NOT comms.fn_record_delivery_result('00000000-0000-4000-8000-000000000000', 'sent', 'probe'),
        'as service_role: fn_record_delivery_result answers (an unknown delivery moves nothing)');
END $$;
ROLLBACK;
-- #endregion

-- #region 1. The trigger — a signed post with the id alone
BEGIN;
DO $$ BEGIN PERFORM pg_temp.types(); END $$;
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_secret text := 'probe-dispatch-' || repeat('x', 40);
    v_before bigint;
    v_id uuid;
    v_req net.http_request_queue%ROWTYPE;
    v_count int;
BEGIN
    PERFORM pg_temp.ok(to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL,
        'fixture: pg_net is installed');
    PERFORM pg_temp.reset_prefs(ARRAY[v_user]);
    PERFORM pg_temp.vault_set('CRON_APP_URL', 'http://probe.invalid:3000/');
    PERFORM pg_temp.vault_set('COMMS_DISPATCH_SECRET', v_secret);
    SELECT COALESCE(max(id), 0) INTO v_before FROM net.http_request_queue;

    -- Flag off: nothing is posted, however the rest is set.
    v_id := comms.fn_notify(v_user, 'probe.dispatch_out', 'Probe dispatch off', 'Private body');
    SELECT count(*) INTO v_count FROM net.http_request_queue WHERE id > v_before;
    PERFORM pg_temp.ok(v_id IS NOT NULL AND v_count = 0, 'flag off: a notification queues no request');

    PERFORM pg_temp.flag(true);
    v_id := comms.fn_notify(v_user, 'probe.dispatch_out', 'Probe dispatch on', 'Private body');
    SELECT count(*) INTO v_count FROM net.http_request_queue WHERE id > v_before;
    SELECT * INTO v_req FROM net.http_request_queue WHERE id > v_before ORDER BY id DESC LIMIT 1;
    PERFORM pg_temp.ok(v_count = 1
        AND v_req.method = 'POST'
        AND v_req.url = 'http://probe.invalid:3000/api/comms/dispatch'
        AND v_req.headers ->> 'Authorization' = 'Bearer ' || v_secret
        AND v_req.headers ->> 'Content-Type' = 'application/json',
        'flag on, both secrets set: one POST to <CRON_APP_URL>/api/comms/dispatch with Authorization: Bearer');
    PERFORM pg_temp.ok(convert_from(v_req.body, 'UTF8')::jsonb = jsonb_build_object('notification_id', v_id),
        'the request body is {notification_id} alone: no title, body, recipient or type');

    v_before := v_req.id;
    v_id := comms.fn_notify(v_user, 'probe.dispatch_inapp', 'Probe in-app only', 'Private body');
    SELECT count(*) INTO v_count FROM net.http_request_queue WHERE id > v_before;
    PERFORM pg_temp.ok(v_id IS NOT NULL AND v_count = 0, 'an in-app-only notification queues no request');
END $$;
ROLLBACK;
-- #endregion

-- #region 2. A missing or short bearer — no request, a warning in the scheduler's style
BEGIN;
DO $$ BEGIN PERFORM pg_temp.types(); END $$;
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_before bigint;
    v_logs_before int;
    v_id uuid;
    v_count int;
BEGIN
    PERFORM pg_temp.reset_prefs(ARRAY[v_user]);
    PERFORM pg_temp.flag(true);
    PERFORM pg_temp.vault_set('CRON_APP_URL', 'http://probe.invalid:3000');
    PERFORM pg_temp.vault_set('COMMS_DISPATCH_SECRET', 'too-short');
    -- One row a day per reason: clear today's so the probe sees this call write it.
    DELETE FROM ops.log_entries WHERE client_id = 'scheduler:comms-dispatch:secret_missing';
    SELECT COALESCE(max(id), 0) INTO v_before FROM net.http_request_queue;

    v_id := comms.fn_notify(v_user, 'probe.dispatch_out', 'Probe no bearer', 'Private body');
    SELECT count(*) INTO v_count FROM net.http_request_queue WHERE id > v_before;
    PERFORM pg_temp.ok(v_id IS NOT NULL AND v_count = 0, 'a short COMMS_DISPATCH_SECRET: the notification is written and nothing is posted');
    PERFORM pg_temp.ok(EXISTS (
            SELECT 1 FROM ops.log_entries
             WHERE client_id = 'scheduler:comms-dispatch:secret_missing' AND level = 'warn'
               AND data ->> 'secret_name' = 'COMMS_DISPATCH_SECRET'),
        'the skip is logged as a scheduler warning naming the secret, never its value');
    PERFORM pg_temp.ok((pg_temp.delivery(v_id, 'email')).status = 'pending',
        'its deliveries stay pending for comms-dispatch-sweep');
END $$;
ROLLBACK;
-- #endregion

-- #region 3. The claim — outcomes, channels, the switch, backoff, lease and window
BEGIN;
DO $$ BEGIN PERFORM pg_temp.types(); END $$;
-- Backdating updated_at needs the touch trigger out of the way, inside this transaction only.
ALTER TABLE comms.notification_deliveries DISABLE TRIGGER trg_notification_deliveries_touch;
DO $$
DECLARE
    v_bounced uuid := pg_temp.person(1);
    v_reach uuid := pg_temp.person(2);
    v_unsub uuid := pg_temp.person(3);
    v_n1 uuid;
    v_n2 uuid;
    v_n3 uuid;
    r record;
    d comms.notification_deliveries;
    v_count int;
BEGIN
    PERFORM pg_temp.reset_prefs(ARRAY[v_bounced, v_reach, v_unsub]);
    -- Each delivery is claimed by its own notification below; the flag stays off while they are written.
    v_n1 := comms.fn_notify(v_bounced, 'probe.dispatch_out', 'Probe bounced', 'Private body');
    v_n2 := comms.fn_notify(v_reach, 'probe.dispatch_out', 'Probe reachable', 'Private body');
    v_n3 := comms.fn_notify(v_unsub, 'probe.dispatch_out', 'Probe unsubscribed', 'Private body');
    INSERT INTO comms.channel_suppressions (channel, destination, user_id, reason, marketing_only)
    VALUES ('email', upper(pg_temp.address(v_bounced)), v_bounced, 'hard_bounce', false),
           ('email', pg_temp.address(v_unsub), v_unsub, 'unsubscribe', true);

    -- The switch: off, nothing is claimed and nothing moves.
    SELECT count(*) INTO v_count FROM comms.fn_claim_deliveries(ARRAY['email', 'sms']::comms.notification_channel[], v_n1);
    PERFORM pg_temp.ok(v_count = 0 AND (pg_temp.delivery(v_n1, 'email')).status = 'pending',
        'flag off: the claim hands out nothing and the row stays pending');
    PERFORM pg_temp.flag(true);

    -- A hard bounce blocks every category; no phone means no SMS target.
    FOR r IN SELECT * FROM comms.fn_claim_deliveries(ARRAY['email', 'sms']::comms.notification_channel[], v_n1) LOOP
        IF r.channel = 'email' THEN
            PERFORM pg_temp.ok(r.status = 'suppressed' AND r.suppressed_reason = 'suppressed_destination'
                AND r.destination IS NULL AND r.attempts = 0,
                'a hard-suppressed email comes back suppressed (suppressed_destination), no destination, no attempt');
        ELSE
            PERFORM pg_temp.ok(r.status = 'skipped' AND r.suppressed_reason = 'no_target' AND r.destination IS NULL,
                'a person with no confirmed phone: the SMS comes back skipped (no_target)');
        END IF;
    END LOOP;
    PERFORM pg_temp.ok((pg_temp.delivery(v_n1, 'email')).status = 'suppressed' AND (pg_temp.delivery(v_n1, 'sms')).status = 'skipped',
        'both outcomes are written to the rows');

    -- A reachable email, claimed alone: queued with its address; the SMS row is not touched.
    SELECT * INTO r FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n2);
    PERFORM pg_temp.ok(r.status = 'queued' AND r.attempts = 1
        AND r.destination ->> 'address' = pg_temp.address(v_reach)
        AND r.title = 'Probe reachable' AND r.notification_id = v_n2,
        'a reachable email comes back queued, attempts 1, with the primary verified address and the title');
    d := pg_temp.delivery(v_n2, 'sms');
    PERFORM pg_temp.ok(d.status = 'pending' AND d.attempts = 0,
        'a channel the dispatcher cannot send stays pending and untouched');
    SELECT count(*) INTO v_count FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n2);
    PERFORM pg_temp.ok(v_count = 0, 'a queued row is not handed out again inside its lease');

    -- An unsubscribe is Marketing only: a system notice still goes.
    SELECT * INTO r FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n3);
    PERFORM pg_temp.ok(r.status = 'queued', 'a marketing-only suppression does not block a system notice');

    -- Backoff: a failure is due again after 2^attempts minutes, and never after 5 attempts.
    d := pg_temp.delivery(v_n2, 'email');
    PERFORM comms.fn_record_delivery_result(d.id, 'failed', 'probe', NULL, 'probe failure');
    SELECT count(*) INTO v_count FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n2);
    PERFORM pg_temp.ok(v_count = 0, 'a fresh failure waits out its backoff');
    UPDATE comms.notification_deliveries SET updated_at = now() - interval '3 minutes' WHERE id = d.id;
    SELECT * INTO r FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n2);
    PERFORM pg_temp.ok(r.status = 'queued' AND r.attempts = 2, 'past 2^1 minutes the failure is claimed again, attempts 2');
    UPDATE comms.notification_deliveries
       SET status = 'failed', attempts = 5, updated_at = now() - interval '2 days' WHERE id = d.id;
    SELECT count(*) INTO v_count FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n2);
    PERFORM pg_temp.ok(v_count = 0, 'after 5 attempts a failure is final');

    -- The lease: a queued row whose dispatcher died is offered again after 15 minutes.
    d := pg_temp.delivery(v_n3, 'email');
    UPDATE comms.notification_deliveries SET queued_at = now() - interval '16 minutes' WHERE id = d.id;
    SELECT * INTO r FROM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n3);
    PERFORM pg_temp.ok(r.status = 'queued' AND r.attempts = 2, 'a lapsed lease is claimed again');

    -- The window: a pending row older than 24 hours is never sent, and is closed as expired.
    d := pg_temp.delivery(v_n3, 'sms');
    UPDATE comms.notification_deliveries SET created_at = now() - interval '25 hours' WHERE id = d.id;
    SELECT count(*) INTO v_count FROM comms.fn_claim_deliveries(ARRAY['sms']::comms.notification_channel[], v_n3);
    d := pg_temp.delivery(v_n3, 'sms');
    PERFORM pg_temp.ok(v_count = 0 AND d.status = 'skipped' AND d.suppressed_reason = 'expired' AND d.attempts = 0,
        'a pending row past 24 hours is not sent: skipped (expired)');
END $$;
ROLLBACK;
-- #endregion

-- #region 4. The result — forward only; push 'gone' retires the device
BEGIN;
DO $$ BEGIN PERFORM pg_temp.types(); END $$;
DO $$
DECLARE
    v_user uuid := pg_temp.person(2);
    v_device uuid;
    v_n uuid;
    v_push uuid;
    d comms.notification_deliveries;
    t comms.device_tokens;
    v_refused boolean := false;
BEGIN
    PERFORM pg_temp.reset_prefs(ARRAY[v_user]);
    v_n := comms.fn_notify(v_user, 'probe.dispatch_out', 'Probe result', 'Private body');
    PERFORM pg_temp.flag(true);
    PERFORM comms.fn_claim_deliveries(ARRAY['email']::comms.notification_channel[], v_n);
    d := pg_temp.delivery(v_n, 'email');

    PERFORM pg_temp.ok(comms.fn_record_delivery_result(d.id, 'sent', 'probe', 'msg_probe_1'), 'queued → sent is recorded');
    d := pg_temp.delivery(v_n, 'email');
    PERFORM pg_temp.ok(d.status = 'sent' AND d.sent_at IS NOT NULL AND d.provider = 'probe' AND d.provider_ref = 'msg_probe_1',
        'sent writes sent_at, the provider and its message id');
    PERFORM pg_temp.ok(NOT comms.fn_record_delivery_result(d.id, 'sent', 'probe', 'msg_probe_2'),
        'a replayed sent moves nothing');
    PERFORM pg_temp.ok(comms.fn_record_delivery_result(d.id, 'delivered'), 'sent → delivered is recorded');
    d := pg_temp.delivery(v_n, 'email');
    PERFORM pg_temp.ok(d.status = 'delivered' AND d.delivered_at IS NOT NULL AND d.provider_ref = 'msg_probe_1',
        'delivered writes delivered_at and keeps the message id');
    PERFORM pg_temp.ok(NOT comms.fn_record_delivery_result(d.id, 'failed', 'probe', NULL, 'late'),
        'a late failure cannot undo a delivery');

    BEGIN
        PERFORM comms.fn_record_delivery_result(d.id, 'queued');
    EXCEPTION WHEN invalid_parameter_value THEN
        v_refused := true;
    END;
    PERFORM pg_temp.ok(v_refused, 'a result other than sent, delivered or failed is refused (22023)');

    -- Push: a gone subscription retires its device; another failure counts against it.
    INSERT INTO comms.device_tokens (user_id, provider, token, endpoint, p256dh, auth_key)
    VALUES (v_user, 'web_push', 'probe-token-' || gen_random_uuid(), 'https://push.example.test/probe', 'probe-p256dh', 'probe-auth')
    RETURNING id INTO v_device;
    v_n := comms.fn_notify(v_user, 'probe.dispatch_push', 'Probe push', 'Private body');
    PERFORM comms.fn_claim_deliveries(ARRAY['push']::comms.notification_channel[], v_n);
    v_push := (SELECT id FROM comms.notification_deliveries WHERE notification_id = v_n AND device_token_id = v_device);
    PERFORM pg_temp.ok((SELECT status FROM comms.notification_deliveries WHERE id = v_push) = 'queued',
        'fixture: the device''s push delivery is queued');
    PERFORM comms.fn_record_delivery_result(v_push, 'failed', 'web_push', NULL, 'timeout');
    SELECT * INTO t FROM comms.device_tokens WHERE id = v_device;
    PERFORM pg_temp.ok(t.failure_count = 1 AND t.revoked_at IS NULL, 'a push failure counts against the device');

    UPDATE comms.notification_deliveries SET status = 'queued' WHERE id = v_push;
    PERFORM comms.fn_record_delivery_result(v_push, 'failed', 'web_push', NULL, 'gone');
    SELECT * INTO t FROM comms.device_tokens WHERE id = v_device;
    PERFORM pg_temp.ok(t.revoked_at IS NOT NULL AND t.revoked_reason = 'gone' AND t.auth_key IS NULL AND t.p256dh IS NULL,
        'a push answered gone revokes the device and clears its keys');
END $$;
ROLLBACK;
-- #endregion
