-- push_devices.sql — probe for Web Push devices (COMMS NT4; providers spec §8.2).
--
--   1. A signed-in person registers this browser through comms.register_device (pinned to auth.uid()):
--      one live web_push row with its endpoint and keys; registering the same subscription again
--      refreshes that row rather than adding one.
--   2. Nobody can revoke someone else's device; the owner can (comms.revoke_device), and the keys go.
--   3. NT2's claim hands the push transport the live device (endpoint, p256dh, auth) with the
--      notification's urgency and group_key (the Urgency and Topic headers).
--   4. A shared browser belongs to whoever turned alerts on in it last: when B registers the endpoint
--      A registered, A's row is released ('reassigned', keys dropped), so A's notifications stop
--      reaching B's screen, and a push for A finds no device. A guest registers nothing.
--
-- Every section runs in a transaction that is ROLLED BACK, so this is safe on the shared local DB.
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/push_devices.sql
\set ON_ERROR_STOP on
\set QUIET on

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text) TO authenticated;

CREATE FUNCTION pg_temp.person(p_n int) RETURNS uuid LANGUAGE sql AS $$
    SELECT user_id FROM comms.notification_prefs ORDER BY user_id OFFSET p_n - 1 LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.person(int) TO authenticated;

-- Become `p_user` as the app does: the authenticated role with their JWT claims.
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.act(uuid) TO authenticated;

DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.person(2) IS NOT NULL, 'fixture: two seeded people with notification preferences');
END $$;
-- #endregion

-- #region 1–2. Register, refresh, revoke — own rows only
BEGIN;
DO $$
DECLARE
    v_owner uuid := pg_temp.person(1);
    v_other uuid := pg_temp.person(2);
    v_endpoint text := 'https://fcm.googleapis.com/fcm/send/probe-' || gen_random_uuid();
    v_id uuid;
    v_again uuid;
    v_plain uuid;
    v_split uuid;
    d comms.device_tokens;
BEGIN
    PERFORM pg_temp.act(v_owner);
    SET LOCAL ROLE authenticated;
    v_id := comms.register_device(v_endpoint, 'web', 'web_push', v_endpoint, 'probe-p256dh', 'probe-auth', 'Chrome on Windows', 'probe-agent');
    v_again := comms.register_device(v_endpoint, 'web', 'web_push', v_endpoint, 'probe-p256dh-2', 'probe-auth-2', NULL, 'probe-agent');
    -- Called straight through PostgREST, past the app's allowlist: the Web Push shape still holds.
    v_plain := comms.register_device('http://push.example/probe', 'web', 'web_push', 'http://push.example/probe', 'k', 'a', NULL, NULL);
    v_split := comms.register_device('probe-token', 'web', 'web_push', v_endpoint || '-other', 'k', 'a', NULL, NULL);
    RESET ROLE;
    PERFORM pg_temp.ok(v_plain IS NULL AND v_split IS NULL
        AND NOT EXISTS (SELECT 1 FROM comms.device_tokens WHERE token IN ('http://push.example/probe', 'probe-token')),
        'a web_push device must be an https endpoint stored as its own token: anything else registers nothing');

    SELECT * INTO d FROM comms.device_tokens WHERE id = v_id;
    PERFORM pg_temp.ok(v_id IS NOT NULL AND d.user_id = v_owner AND d.provider = 'web_push' AND d.platform = 'web'
        AND d.endpoint = v_endpoint AND d.revoked_at IS NULL,
        'a signed-in person registers this browser: one live web_push row, theirs');
    PERFORM pg_temp.ok(v_again = v_id AND d.p256dh = 'probe-p256dh-2' AND d.label = 'Chrome on Windows'
        AND (SELECT count(*) FROM comms.device_tokens WHERE token = v_endpoint) = 1,
        'registering the same subscription again refreshes the row (new keys, label kept), never a second row');

    -- Someone else cannot revoke it.
    PERFORM pg_temp.act(v_other);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.ok(NOT comms.revoke_device(v_id, 'probe'), 'another person cannot revoke the device');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.device_tokens WHERE id = v_id),
        'and cannot even see it (own-row RLS)');
    RESET ROLE;

    PERFORM pg_temp.act(v_owner);
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.ok(comms.revoke_device(v_id, 'user_revoked'), 'the owner revokes it');
    RESET ROLE;
    SELECT * INTO d FROM comms.device_tokens WHERE id = v_id;
    PERFORM pg_temp.ok(d.revoked_at IS NOT NULL AND d.revoked_reason = 'user_revoked' AND d.p256dh IS NULL AND d.auth_key IS NULL,
        'a revoked device keeps its row and drops its keys');
END $$;
ROLLBACK;
-- #endregion

-- #region 3. The claim hands push its device, urgency and Topic source
BEGIN;
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_endpoint text := 'https://fcm.googleapis.com/fcm/send/probe-' || gen_random_uuid();
    v_device uuid;
    v_n uuid;
    r record;
BEGIN
    INSERT INTO comms.notification_types (key, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible)
    VALUES ('probe.push_device', 'system', 'critical', '{in_app,push}', true, true, false)
    ON CONFLICT (key) DO NOTHING;
    UPDATE comms.notification_prefs SET quiet_hours_enabled = false, muted_until = NULL WHERE user_id = v_user;
    UPDATE comms.device_tokens SET revoked_at = now(), revoked_reason = 'probe' WHERE user_id = v_user AND revoked_at IS NULL;
    INSERT INTO comms.device_tokens (user_id, provider, token, endpoint, p256dh, auth_key, platform)
    VALUES (v_user, 'web_push', v_endpoint, v_endpoint, 'probe-p256dh', 'probe-auth', 'web')
    RETURNING id INTO v_device;

    v_n := comms.fn_notify(v_user, 'probe.push_device', 'Probe push', 'Private body', p_group_key => 'probe:push:group');
    UPDATE security.feature_flags SET enabled = true WHERE key = 'comms.dispatch_webhook';
    SELECT * INTO r FROM comms.fn_claim_deliveries(ARRAY['push']::comms.notification_channel[], v_n);
    PERFORM pg_temp.ok(r.status = 'queued' AND r.destination ->> 'device_id' = v_device::text
        AND r.destination ->> 'endpoint' = v_endpoint AND r.destination ->> 'p256dh' = 'probe-p256dh'
        AND r.destination ->> 'auth' = 'probe-auth',
        'the claim hands push the live device: endpoint, p256dh and auth');
    PERFORM pg_temp.ok(r.urgency = 'critical' AND r.group_key = 'probe:push:group',
        'with the notification''s urgency and group_key (the Urgency and Topic headers)');
END $$;
ROLLBACK;
-- #endregion

-- #region 4. A shared browser: the last person to turn alerts on owns it
BEGIN;
DO $$
DECLARE
    v_a uuid := pg_temp.person(1);
    v_b uuid := pg_temp.person(2);
    v_endpoint text := 'https://fcm.googleapis.com/fcm/send/probe-' || gen_random_uuid();
    v_a_id uuid;
    v_b_id uuid;
    v_guest uuid;
    v_n uuid;
    d comms.device_tokens;
    r record;
BEGIN
    PERFORM pg_temp.act(v_a);
    SET LOCAL ROLE authenticated;
    v_a_id := comms.register_device(v_endpoint, 'web', 'web_push', v_endpoint, 'a-p256dh', 'a-auth', 'Chrome on Windows', 'probe-agent');
    RESET ROLE;

    PERFORM pg_temp.act(v_b);
    SET LOCAL ROLE authenticated;
    v_b_id := comms.register_device(v_endpoint, 'web', 'web_push', v_endpoint, 'b-p256dh', 'b-auth', 'Chrome on Windows', 'probe-agent');
    -- B cannot see A's row at all; B's own row is live.
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM comms.device_tokens WHERE token = v_endpoint AND revoked_at IS NULL) = 1,
        'B sees exactly one live row for the browser: their own');
    RESET ROLE;

    SELECT * INTO d FROM comms.device_tokens WHERE id = v_a_id;
    PERFORM pg_temp.ok(d.revoked_at IS NOT NULL AND d.revoked_reason = 'reassigned' AND d.p256dh IS NULL AND d.auth_key IS NULL,
        'B turning alerts on in A''s browser releases A''s row (reassigned, keys dropped)');
    PERFORM pg_temp.ok(v_b_id IS NOT NULL AND v_b_id <> v_a_id
        AND (SELECT count(*) FROM comms.device_tokens WHERE token = v_endpoint AND revoked_at IS NULL) = 1
        AND (SELECT user_id FROM comms.device_tokens WHERE token = v_endpoint AND revoked_at IS NULL) = v_b,
        'one live row for the endpoint across every account, and it is B''s');

    -- A push for A now finds no device here: the claim skips it (no_target), never sends to B's screen.
    INSERT INTO comms.notification_types (key, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible)
    VALUES ('probe.push_shared', 'system', 'critical', '{in_app,push}', true, true, false)
    ON CONFLICT (key) DO NOTHING;
    UPDATE comms.notification_prefs SET quiet_hours_enabled = false, muted_until = NULL WHERE user_id = v_a;
    -- A's OTHER devices are set aside, so only the released browser could have carried this push.
    UPDATE comms.device_tokens SET revoked_at = now(), revoked_reason = 'probe'
     WHERE user_id = v_a AND revoked_at IS NULL AND token <> v_endpoint;
    UPDATE security.feature_flags SET enabled = true WHERE key = 'comms.dispatch_webhook';
    v_n := comms.fn_notify(v_a, 'probe.push_shared', 'For A only', 'Private body');
    SELECT * INTO r FROM comms.fn_claim_deliveries(ARRAY['push']::comms.notification_channel[], v_n);
    -- With A's only browser released there is no push delivery to claim at all (or, at most, one
    -- skipped for no target): nothing is ever queued for the browser B now holds.
    PERFORM pg_temp.ok(r.status IS DISTINCT FROM 'queued' AND r.destination IS NULL
        AND NOT EXISTS (SELECT 1 FROM comms.notification_deliveries
                         WHERE notification_id = v_n AND channel = 'push' AND status IN ('queued', 'sent')),
        'a push for A is never queued for the browser B now holds');

    -- Signed out, nobody registers anything.
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    SET LOCAL ROLE authenticated;
    v_guest := comms.register_device(v_endpoint, 'web', 'web_push', v_endpoint, 'g-p256dh', 'g-auth', NULL, 'probe-agent');
    RESET ROLE;
    PERFORM pg_temp.ok(v_guest IS NULL AND (SELECT user_id FROM comms.device_tokens WHERE token = v_endpoint AND revoked_at IS NULL) = v_b,
        'with no signed-in person, register_device writes and releases nothing');
END $$;
ROLLBACK;
-- #endregion
