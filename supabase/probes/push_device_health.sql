-- push_device_health.sql — when a push device is dropped (PROJECTS NO3, Decision #567; PRD-E18).
--
-- Ruled #567 (a): a 404 or 410 (`gone`) revokes the device at once; any other failure counts, and
-- the daily reaper drops a device only after 5 consecutive failures whose first is at least 24 hours
-- old; a success ends the streak. Ruled #567 (b): a successful push refreshes `last_seen_at`, so the
-- 180-day `stale` reap means nothing reached the browser for 180 days.
--
--   1. One notification failing its five attempts within minutes leaves a working device live.
--   2. Five failures whose first is 25 hours old reap it (`gateway_failures`, keys cleared).
--   3. A success between failures ends the streak.
--   4. A success refreshes `last_seen_at`; without one, 180 days unseen still reaps (`stale`).
--   5. `gone` still revokes at once.
--   6. Registering the browser again ends the streak.
--
-- Every region runs in a transaction that is ROLLED BACK, so this is safe on the shared local DB.
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/push_device_health.sql
\set ON_ERROR_STOP on
\set QUIET on

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- A live web-push device for the n-th seeded person, with one queued push delivery to fail or send.
CREATE FUNCTION pg_temp.device(p_n int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_user uuid := (SELECT user_id FROM org.users_public ORDER BY user_id OFFSET p_n - 1 LIMIT 1);
    v_endpoint text := 'https://fcm.googleapis.com/fcm/send/probe-' || gen_random_uuid();
    v_device uuid;
    v_n uuid;
BEGIN
    -- A Web Push device's token is its endpoint (comms.register_device holds that shape).
    INSERT INTO comms.device_tokens (user_id, provider, token, endpoint, p256dh, auth_key)
    VALUES (v_user, 'web_push', v_endpoint, v_endpoint, 'probe-p256dh', 'probe-auth')
    RETURNING id INTO v_device;
    INSERT INTO comms.notifications (user_id, type, title, body)
    VALUES (v_user, 'probe.push_health', 'Probe push', 'Private body')
    RETURNING id INTO v_n;
    INSERT INTO comms.notification_deliveries (notification_id, user_id, channel, status, device_token_id, attempts, queued_at)
    VALUES (v_n, v_user, 'push', 'queued', v_device, 1, now());
    RETURN v_device;
END $$;

-- One send attempt on the device's delivery (a retry re-queues the same row, as the sweep does).
CREATE FUNCTION pg_temp.attempt(p_device uuid, p_status comms.delivery_status, p_error text DEFAULT 'push_503')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_delivery uuid := (SELECT id FROM comms.notification_deliveries WHERE device_token_id = p_device);
BEGIN
    UPDATE comms.notification_deliveries SET status = 'queued' WHERE id = v_delivery;
    IF NOT comms.fn_record_delivery_result(v_delivery, p_status, 'web_push', NULL,
        CASE WHEN p_status = 'failed' THEN p_error END) THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture: the attempt was not recorded';
    END IF;
END $$;

CREATE FUNCTION pg_temp.revoked(p_device uuid) RETURNS text LANGUAGE sql AS $$
    SELECT COALESCE(revoked_reason, 'live') FROM comms.device_tokens WHERE id = p_device;
$$;
-- #endregion

-- #region 1. One outage's retries never reap a working device
BEGIN;
DO $$
DECLARE
    v_device uuid := pg_temp.device(1);
BEGIN
    FOR i IN 1..5 LOOP
        PERFORM pg_temp.attempt(v_device, 'failed');
    END LOOP;
    PERFORM pg_temp.ok((SELECT failure_count FROM comms.device_tokens WHERE id = v_device) = 5,
        'five failed attempts count five');
    PERFORM comms.fn_reap_dead_devices();
    PERFORM pg_temp.ok(pg_temp.revoked(v_device) = 'live',
        'five failures inside 30 minutes do not reap the device (the streak is younger than 24 hours)');
END $$;
ROLLBACK;
-- #endregion

-- #region 2. Five failures across a day reap it
BEGIN;
DO $$
DECLARE
    v_device uuid := pg_temp.device(2);
    v_since timestamptz;
    t comms.device_tokens;
BEGIN
    PERFORM pg_temp.attempt(v_device, 'failed');
    SELECT failing_since INTO v_since FROM comms.device_tokens WHERE id = v_device;
    PERFORM pg_temp.ok(v_since IS NOT NULL, 'the first failure starts the streak');
    UPDATE comms.device_tokens SET failing_since = failing_since - interval '25 hours' WHERE id = v_device;
    FOR i IN 2..5 LOOP
        PERFORM pg_temp.attempt(v_device, 'failed');
    END LOOP;
    SELECT * INTO t FROM comms.device_tokens WHERE id = v_device;
    PERFORM pg_temp.ok(t.failing_since = v_since - interval '25 hours', 'a later failure keeps the streak''s start');
    PERFORM pg_temp.ok(comms.fn_reap_dead_devices() >= 1, 'the reaper reports what it dropped');
    SELECT * INTO t FROM comms.device_tokens WHERE id = v_device;
    PERFORM pg_temp.ok(t.revoked_reason = 'gateway_failures' AND t.auth_key IS NULL AND t.p256dh IS NULL,
        'five failures whose first is 25 hours old reap the device and clear its keys');
END $$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
    v_device uuid := pg_temp.device(3);
BEGIN
    FOR i IN 1..4 LOOP
        PERFORM pg_temp.attempt(v_device, 'failed');
    END LOOP;
    UPDATE comms.device_tokens SET failing_since = failing_since - interval '3 days' WHERE id = v_device;
    PERFORM comms.fn_reap_dead_devices();
    PERFORM pg_temp.ok(pg_temp.revoked(v_device) = 'live', 'four failures, however old, do not reap');
END $$;
ROLLBACK;
-- #endregion

-- #region 3. A success ends the streak
BEGIN;
DO $$
DECLARE
    v_device uuid := pg_temp.device(4);
    t comms.device_tokens;
BEGIN
    FOR i IN 1..4 LOOP
        PERFORM pg_temp.attempt(v_device, 'failed');
    END LOOP;
    UPDATE comms.device_tokens SET failing_since = failing_since - interval '25 hours' WHERE id = v_device;
    PERFORM pg_temp.attempt(v_device, 'sent');
    SELECT * INTO t FROM comms.device_tokens WHERE id = v_device;
    PERFORM pg_temp.ok(t.failure_count = 0 AND t.failing_since IS NULL, 'a success resets the count and the streak');
    PERFORM pg_temp.attempt(v_device, 'failed');
    SELECT * INTO t FROM comms.device_tokens WHERE id = v_device;
    PERFORM pg_temp.ok(t.failure_count = 1 AND t.failing_since > now() - interval '1 minute',
        'the next failure starts a new streak');
    PERFORM comms.fn_reap_dead_devices();
    PERFORM pg_temp.ok(pg_temp.revoked(v_device) = 'live', 'a device that recovered is not reaped');
END $$;
ROLLBACK;
-- #endregion

-- #region 4. A success keeps the device current; 180 days unseen still reaps
BEGIN;
DO $$
DECLARE
    v_working uuid := pg_temp.device(5);
    v_silent uuid := pg_temp.device(6);
BEGIN
    UPDATE comms.device_tokens SET last_seen_at = now() - interval '200 days' WHERE id IN (v_working, v_silent);
    PERFORM pg_temp.attempt(v_working, 'sent');
    PERFORM pg_temp.ok((SELECT last_seen_at FROM comms.device_tokens WHERE id = v_working) > now() - interval '1 minute',
        'a successful push refreshes last_seen_at');
    PERFORM comms.fn_reap_dead_devices();
    PERFORM pg_temp.ok(pg_temp.revoked(v_working) = 'live', 'a browser that receives pushes is never stale');
    PERFORM pg_temp.ok(pg_temp.revoked(v_silent) = 'stale', 'a browser nothing reached for 200 days is reaped stale');
END $$;
ROLLBACK;
-- #endregion

-- #region 5. Gone still revokes at once
BEGIN;
DO $$
DECLARE
    v_device uuid := pg_temp.device(7);
BEGIN
    PERFORM pg_temp.attempt(v_device, 'failed', 'gone');
    PERFORM pg_temp.ok(pg_temp.revoked(v_device) = 'gone', 'a 404 or 410 revokes the device on the first answer');
END $$;
ROLLBACK;
-- #endregion

-- #region 6. Registering again ends the streak
BEGIN;
DO $$
DECLARE
    v_device uuid := pg_temp.device(8);
    t comms.device_tokens;
BEGIN
    FOR i IN 1..3 LOOP
        PERFORM pg_temp.attempt(v_device, 'failed');
    END LOOP;
    SELECT * INTO t FROM comms.device_tokens WHERE id = v_device;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', t.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM comms.register_device(t.token, 'web', 'web_push', t.endpoint, 'probe-p256dh-2', 'probe-auth-2');
    RESET ROLE;
    SELECT * INTO t FROM comms.device_tokens WHERE id = v_device;
    PERFORM pg_temp.ok(t.failure_count = 0 AND t.failing_since IS NULL AND t.revoked_at IS NULL,
        'registering the same browser again resets the count and the streak');
END $$;
ROLLBACK;
-- #endregion
