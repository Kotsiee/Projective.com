-- notify_engine.sql — probe for the notification engine's rules (COMMS_BUILD_PROMPTS NT1; CAS N1–N3,
-- N9, N10; Decision #339, ruling N3 (a)).
--
--   1. The router: at 23:00 local inside 22:00–07:00 quiet hours, a mandatory type keeps every channel
--      but push and SMS, and one that sets overrides_quiet_hours keeps them. Under a snooze, with every
--      toggle off and the type muted, a mandatory type is delivered whole; a snooze still silences a
--      non-mandatory high type and a critical one still pierces it.
--   2. Handlers: a write fn_notify or fn_enqueue cannot make returns NULL (with a WARNING naming the
--      type key and SQLSTATE) and the caller's transaction carries on.
--   3. Escalation: an unread high event falls back to email — not for a type the person muted, not
--      where the category's email is off, not under a snooze.
--   4. Digests: a category-digest user gets a digest of that category only; a global-digest user gets
--      every category but one set to another cadence.
--   5. Collapse: two dblink sessions emit one group_key at once; the second waits on the first's lock,
--      and the pair ends as one row with group_count 2.
--
-- Sections 1–4 each run in a transaction that is ROLLED BACK. Section 5 COMMITS its race (and then
-- archives the row), so the file refuses to start without `-v disposable=1`: run it only against a
-- database about to be reset, as `deno task test:probes:fresh` does.
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d postgres -X -q -v disposable=1 \
--     < supabase/probes/notify_engine.sql
-- `supabase_admin`: only a superuser may open a passwordless dblink session.
\set ON_ERROR_STOP on
\set QUIET on
\if :{?disposable}
\else
\echo 'notify_engine.sql commits its collapse race; rerun with -v disposable=1 against a throwaway database.'
\quit
\endif

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- The n-th seeded person with notification preferences.
CREATE FUNCTION pg_temp.person(p_n int) RETURNS uuid LANGUAGE sql AS $$
    SELECT user_id FROM comms.notification_prefs ORDER BY user_id OFFSET p_n - 1 LIMIT 1;
$$;

-- Clean preferences: everything on, no quiet hours, snooze, category rows, mutes or digest.
CREATE FUNCTION pg_temp.reset_prefs(p_users uuid[]) RETURNS void LANGUAGE sql AS $$
    UPDATE comms.notification_prefs
       SET in_app = true, email = true, push = true, sms = true, quiet_hours_enabled = false,
           quiet_hours = NULL, muted_until = NULL, digest_frequency = 'off', timezone = 'UTC',
           escalate_after = interval '15 minutes'
     WHERE user_id = ANY (p_users);
    DELETE FROM comms.notification_category_prefs WHERE user_id = ANY (p_users);
    DELETE FROM comms.notification_type_mutes WHERE user_id = ANY (p_users);
$$;

DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.person(2) IS NOT NULL, 'fixture: two seeded people with notification preferences');
END $$;
-- #endregion

-- #region 1. The router — quiet hours bind a mandatory type; the snooze and preferences do not
BEGIN;
INSERT INTO comms.notification_types (key, category, urgency, default_channels, mandatory, overrides_quiet_hours, digestible)
VALUES ('probe.mandatory_quiet', 'system', 'high', '{in_app,email,push,sms}', true, false, false),
       ('probe.mandatory_loud', 'system', 'critical', '{in_app,email,push,sms}', true, true, false),
       ('probe.optional_high', 'work', 'high', '{in_app,email,push}', false, false, false),
       ('probe.optional_critical', 'work', 'critical', '{in_app,push}', false, false, false);

DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    -- The Etc/GMT zone whose wall clock reads 23:xx now (Etc/GMT signs are inverted).
    v_offset int := (23 - EXTRACT(HOUR FROM now() AT TIME ZONE 'UTC')::int + 24) % 24;
    v_zone text;
    v_id uuid;
BEGIN
    IF v_offset > 14 THEN v_offset := v_offset - 24; END IF;
    v_zone := 'Etc/GMT' || CASE WHEN v_offset > 0 THEN '-' || v_offset WHEN v_offset < 0 THEN '+' || -v_offset ELSE '' END;
    PERFORM pg_temp.reset_prefs(ARRAY[v_user]);
    UPDATE comms.notification_prefs
       SET timezone = v_zone, quiet_hours_enabled = true, quiet_hours_start = '22:00', quiet_hours_end = '07:00'
     WHERE user_id = v_user;

    PERFORM pg_temp.ok(EXTRACT(HOUR FROM now() AT TIME ZONE v_zone) = 23 AND comms.fn_is_quiet_hours(v_user),
        format('fixture: 23:%s in %s is inside 22:00–07:00 quiet hours', to_char(now() AT TIME ZONE v_zone, 'MI'), v_zone));
    PERFORM pg_temp.ok(comms.fn_resolve_channels(v_user, 'probe.mandatory_quiet') = '{in_app,email}',
        'quiet hours: a mandatory type without the override keeps in_app and email, not push or sms');
    PERFORM pg_temp.ok(comms.fn_resolve_channels(v_user, 'probe.mandatory_loud') = '{in_app,email,push,sms}',
        'quiet hours: an overrides_quiet_hours type keeps push and sms');
    PERFORM pg_temp.ok(comms.fn_resolve_channels(v_user, 'probe.optional_high') = '{in_app,email}',
        'quiet hours: a non-mandatory type still loses push');
    v_id := comms.fn_notify(v_user, 'probe.mandatory_quiet', 'Probe', 'Probe body');
    PERFORM pg_temp.ok((SELECT channels FROM comms.notifications WHERE id = v_id) = '{in_app,email}'
        AND NOT EXISTS (SELECT 1 FROM comms.notification_deliveries WHERE notification_id = v_id AND channel IN ('push', 'sms')),
        'fn_notify records that fan-out and writes no push or sms delivery');

    UPDATE comms.notification_prefs
       SET quiet_hours_enabled = false, muted_until = now() + interval '1 day'
     WHERE user_id = v_user;
    PERFORM pg_temp.ok(comms.fn_resolve_channels(v_user, 'probe.optional_high') = '{}',
        'snooze: a non-mandatory high type is silenced');
    PERFORM pg_temp.ok(comms.fn_resolve_channels(v_user, 'probe.optional_critical') = '{in_app,push}',
        'snooze: a non-mandatory critical type pierces it');

    UPDATE comms.notification_prefs
       SET in_app = false, email = false, push = false, sms = false
     WHERE user_id = v_user;
    INSERT INTO comms.notification_type_mutes (user_id, type_key) VALUES (v_user, 'probe.mandatory_quiet');
    PERFORM pg_temp.ok(comms.fn_resolve_channels(v_user, 'probe.mandatory_quiet') = '{in_app,email,push,sms}',
        'snooze, every toggle off and the type muted: a mandatory type is delivered on every channel');
END $$;
ROLLBACK;
-- #endregion

-- #region 2. Handlers — NULL and a WARNING, and the caller carries on
BEGIN;
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
BEGIN
    -- An absolute action URL fails comms.notifications' relative-link CHECK inside fn_notify.
    PERFORM pg_temp.ok(comms.fn_notify(v_user, 'profile.followed', 'Probe handler', 'Probe body',
            p_action_url => 'https://example.com/x') IS NULL
        AND NOT EXISTS (SELECT 1 FROM comms.notifications WHERE user_id = v_user AND title = 'Probe handler'),
        'fn_notify: a failed write returns NULL and leaves no row');
    -- No such person: the queue's foreign key fails inside fn_enqueue.
    PERFORM pg_temp.ok(comms.fn_enqueue(gen_random_uuid(), 'session.reminder_15m', 'Probe', 'Probe body',
            now() + interval '1 hour') IS NULL,
        'fn_enqueue: a failed write returns NULL');
    PERFORM pg_temp.ok(comms.fn_notify(v_user, 'profile.followed', 'Probe after', 'Probe body') IS NOT NULL,
        'the caller''s transaction carries on and the next notification is written');
END $$;
ROLLBACK;
-- #endregion

-- #region 3. Escalation — only where the person's email channel for that type is on
BEGIN;
INSERT INTO comms.notification_types (key, category, urgency, default_channels, digestible)
VALUES ('probe.urgent', 'schedule', 'high', '{in_app,push}', false),
       ('probe.urgent_muted', 'schedule', 'high', '{in_app,push}', false),
       ('probe.urgent_discovery', 'discovery', 'high', '{in_app,push}', false);

DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_snoozed uuid := pg_temp.person(2);
    v_ids uuid[];
BEGIN
    PERFORM pg_temp.reset_prefs(ARRAY[v_user, v_snoozed]);
    UPDATE comms.notification_prefs SET muted_until = now() + interval '1 day' WHERE user_id = v_snoozed;
    INSERT INTO comms.notification_type_mutes (user_id, type_key) VALUES (v_user, 'probe.urgent_muted');
    INSERT INTO comms.notification_category_prefs (user_id, category, email) VALUES (v_user, 'discovery', false);

    v_ids := ARRAY[
        comms.fn_notify(v_user, 'probe.urgent', 'Probe', 'Probe body'),
        comms.fn_notify(v_user, 'probe.urgent_muted', 'Probe', 'Probe body'),
        comms.fn_notify(v_user, 'probe.urgent_discovery', 'Probe', 'Probe body'),
        comms.fn_notify(v_snoozed, 'probe.urgent', 'Probe', 'Probe body')
    ];
    PERFORM pg_temp.ok(array_position(v_ids, NULL) IS NULL, 'fixture: four unread high notifications');
    UPDATE comms.notifications SET created_at = now() - interval '20 minutes' WHERE id = ANY (v_ids);

    PERFORM comms.fn_escalate_unread(100000);

    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notification_deliveries
                                WHERE notification_id = v_ids[1] AND channel = 'email' AND provider = 'escalation')
        AND (SELECT 'email' = ANY (channels) FROM comms.notifications WHERE id = v_ids[1]),
        'an unread high event falls back to email');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.notification_deliveries WHERE notification_id = v_ids[2] AND channel = 'email'),
        'no escalation email for a type the person muted');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.notification_deliveries WHERE notification_id = v_ids[3] AND channel = 'email'),
        'no escalation email where the category''s email is off');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.notification_deliveries WHERE notification_id = v_ids[4] AND channel = 'email'),
        'no escalation email under a snooze');
END $$;
ROLLBACK;
-- #endregion

-- #region 4. Digests — a category's own cadence decides what rolls up
BEGIN;
INSERT INTO comms.notification_types (key, category, urgency, default_channels, digestible)
VALUES ('probe.digest_discovery', 'discovery', 'low', '{in_app,email}', true),
       ('probe.digest_work', 'work', 'low', '{in_app,email}', true);

DO $$
DECLARE
    v_category uuid := pg_temp.person(1);
    v_global uuid := pg_temp.person(2);
    v_end timestamptz := date_trunc('hour', now());
    v_ids uuid[];
    d comms.notification_digests%ROWTYPE;
BEGIN
    PERFORM pg_temp.reset_prefs(ARRAY[v_category, v_global]);
    UPDATE comms.notification_prefs
       SET digest_hour = EXTRACT(HOUR FROM now() AT TIME ZONE 'UTC')::smallint,
           digest_frequency = CASE WHEN user_id = v_global THEN 'daily' ELSE 'off' END::comms.digest_frequency
     WHERE user_id IN (v_category, v_global);
    INSERT INTO comms.notification_category_prefs (user_id, category, digest_frequency)
    VALUES (v_category, 'discovery', 'daily'), (v_global, 'work', 'off');
    DELETE FROM comms.notification_digests WHERE user_id IN (v_category, v_global);

    v_ids := ARRAY[
        comms.fn_notify(v_category, 'probe.digest_discovery', 'Probe', 'Probe body'),
        comms.fn_notify(v_category, 'probe.digest_work', 'Probe', 'Probe body'),
        comms.fn_notify(v_global, 'probe.digest_discovery', 'Probe', 'Probe body'),
        comms.fn_notify(v_global, 'probe.digest_work', 'Probe', 'Probe body')
    ];
    PERFORM pg_temp.ok(array_position(v_ids, NULL) IS NULL, 'fixture: four digestible notifications');
    UPDATE comms.notifications SET created_at = v_end - interval '30 minutes' WHERE id = ANY (v_ids);

    PERFORM comms.fn_build_digests('daily');

    SELECT * INTO d FROM comms.notification_digests
     WHERE user_id = v_category AND period = 'daily' AND window_start = v_end - interval '1 day';
    PERFORM pg_temp.ok(v_ids[1] = ANY (d.notification_ids) AND NOT v_ids[2] = ANY (d.notification_ids)
        AND d.summary ? 'discovery' AND NOT d.summary ? 'work',
        'a category-digest user gets a digest of that category only');
    SELECT * INTO d FROM comms.notification_digests
     WHERE user_id = v_global AND period = 'daily' AND window_start = v_end - interval '1 day';
    PERFORM pg_temp.ok(v_ids[3] = ANY (d.notification_ids) AND NOT v_ids[4] = ANY (d.notification_ids),
        'a global-digest user gets every category but one set to another cadence');
END $$;
ROLLBACK;
-- #endregion

-- #region 5. Collapse — two sessions, one group_key, one row (COMMITS)
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_key text := 'probe:notify_engine:' || gen_random_uuid();
    v_sql text;
    v_a text;
    v_b text;
    v_pid int;
    v_blocked boolean := false;
    v_tries int := 0;
    v_rows int;
    v_count int;
BEGIN
    PERFORM pg_temp.ok((SELECT group_window IS NOT NULL FROM comms.notification_types WHERE key = 'profile.followed'),
        'fixture: profile.followed collapses inside a group_window');
    v_sql := format('SELECT comms.fn_notify(%L::uuid, %L, %L, %L, p_group_key => %L)::text',
        v_user, 'profile.followed', 'Probe collapse race', 'Probe body', v_key);

    -- A emits and keeps its transaction open; B emits the same group_key and must wait on A.
    PERFORM extensions.dblink_connect('probe_a', 'dbname=' || current_database());
    PERFORM extensions.dblink_connect('probe_b', 'dbname=' || current_database());
    PERFORM extensions.dblink_exec('probe_a', 'BEGIN');
    PERFORM extensions.dblink_exec('probe_b', 'BEGIN');
    SELECT r INTO v_a FROM extensions.dblink('probe_a', v_sql) AS t(r text);
    SELECT p INTO v_pid FROM extensions.dblink('probe_b', 'SELECT pg_backend_pid()') AS t(p int);
    PERFORM extensions.dblink_send_query('probe_b', v_sql);
    LOOP
        v_blocked := cardinality(pg_blocking_pids(v_pid)) > 0;
        EXIT WHEN v_blocked OR extensions.dblink_is_busy('probe_b') = 0 OR v_tries >= 200;
        v_tries := v_tries + 1;
        PERFORM pg_sleep(0.05);
    END LOOP;
    PERFORM extensions.dblink_exec('probe_a', 'COMMIT');
    SELECT r INTO v_b FROM extensions.dblink_get_result('probe_b') AS t(r text);
    PERFORM * FROM extensions.dblink_get_result('probe_b') AS t(r text);
    PERFORM extensions.dblink_exec('probe_b', 'COMMIT');
    PERFORM extensions.dblink_disconnect('probe_a');
    PERFORM extensions.dblink_disconnect('probe_b');

    SELECT count(*), max(group_count) INTO v_rows, v_count
      FROM comms.notifications WHERE user_id = v_user AND group_key = v_key;
    PERFORM pg_temp.ok(v_blocked AND v_a IS NOT NULL AND v_b = v_a AND v_rows = 1 AND v_count = 2,
        format('one group_key from two sessions: B waited on A (%s), %s row(s), group_count %s, B returned A''s id (%s)',
               v_blocked, v_rows, v_count, v_b = v_a));
    -- Keep the committed row out of the seeded person's inbox.
    UPDATE comms.notifications SET archived_at = now() WHERE user_id = v_user AND group_key = v_key;
END $$;
-- #endregion
