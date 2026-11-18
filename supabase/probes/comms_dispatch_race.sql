-- comms_dispatch_race.sql — two dispatchers claiming at once never get the same delivery (COMMS NT2;
-- Decision #344 (a)).
--
-- Session A claims one notification's email delivery and keeps its transaction open; session B claims
-- the same notification at the same moment. B must come back at once (SKIP LOCKED) with nothing, and
-- A's row must be the only one queued. The claim reads the comms.dispatch_webhook flag and the
-- delivery in its own transaction, so both are COMMITTED here: the file refuses to start without
-- `-v disposable=1`, and the flag is switched back off (and the row archived) whether the race passes
-- or fails. Run it only against a database about to be reset, as `deno task test:probes:fresh` does.
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d postgres -X -q -v disposable=1 \
--     < supabase/probes/comms_dispatch_race.sql
-- `supabase_admin`: only a superuser may open a passwordless dblink session.
\set ON_ERROR_STOP on
\set QUIET on
\if :{?disposable}
\else
\echo 'comms_dispatch_race.sql commits its claim race; rerun with -v disposable=1 against a throwaway database.'
\quit
\endif

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- #region Fixture (COMMITS): one mandatory notice with one pending email delivery, flag still off
CREATE TEMP TABLE probe_race (notification_id uuid);
DO $$
DECLARE
    v_user uuid;
    v_id uuid;
BEGIN
    SELECT p.user_id INTO v_user
      FROM comms.notification_prefs p
      JOIN org.user_emails ue ON ue.user_id = p.user_id AND ue.is_primary AND ue.verified_at IS NOT NULL
     ORDER BY p.user_id LIMIT 1;
    PERFORM pg_temp.ok(v_user IS NOT NULL, 'fixture: a seeded person with a primary verified email');

    INSERT INTO comms.notification_types (key, category, urgency, default_channels, mandatory, digestible)
    VALUES ('probe.dispatch_race', 'system', 'high', '{in_app,email}', true, false)
    ON CONFLICT (key) DO NOTHING;
    UPDATE comms.notification_prefs SET quiet_hours_enabled = false, muted_until = NULL WHERE user_id = v_user;

    v_id := comms.fn_notify(v_user, 'probe.dispatch_race', 'Probe claim race', 'Probe body');
    PERFORM pg_temp.ok((SELECT status FROM comms.notification_deliveries
                         WHERE notification_id = v_id AND channel = 'email') = 'pending',
        'fixture: one pending email delivery');
    INSERT INTO probe_race VALUES (v_id);
END $$;
-- #endregion

-- #region The race
DO $$
DECLARE
    v_id uuid := (SELECT notification_id FROM probe_race);
    v_sql text;
    v_a text;
    v_b text;
    v_b_rows int;
    v_queued int;
BEGIN
    v_sql := format(
        'SELECT count(*)::text || '':'' || COALESCE(string_agg(delivery_id::text, '',''), '''') FROM comms.fn_claim_deliveries(ARRAY[''email'']::comms.notification_channel[], %L::uuid)',
        v_id);

    -- The flag is committed on by its own autocommitting session, and switched off again below.
    PERFORM extensions.dblink_connect('probe_flag', 'dbname=' || current_database());
    PERFORM extensions.dblink_exec('probe_flag',
        'UPDATE security.feature_flags SET enabled = true WHERE key = ''comms.dispatch_webhook''');

    BEGIN
        PERFORM extensions.dblink_connect('probe_a', 'dbname=' || current_database());
        PERFORM extensions.dblink_connect('probe_b', 'dbname=' || current_database());
        PERFORM extensions.dblink_exec('probe_a', 'BEGIN');
        PERFORM extensions.dblink_exec('probe_b', 'BEGIN');
        -- A claims and holds the row lock; B claims the same notification while A is still open.
        SELECT r INTO v_a FROM extensions.dblink('probe_a', v_sql) AS t(r text);
        PERFORM extensions.dblink_exec('probe_b', 'SET LOCAL lock_timeout = ''2s''');
        SELECT r INTO v_b FROM extensions.dblink('probe_b', v_sql) AS t(r text);
        PERFORM extensions.dblink_exec('probe_a', 'COMMIT');
        PERFORM extensions.dblink_exec('probe_b', 'COMMIT');
        PERFORM extensions.dblink_disconnect('probe_a');
        PERFORM extensions.dblink_disconnect('probe_b');
    EXCEPTION WHEN OTHERS THEN
        PERFORM extensions.dblink_exec('probe_flag',
            'UPDATE security.feature_flags SET enabled = false WHERE key = ''comms.dispatch_webhook''');
        RAISE;
    END;

    PERFORM extensions.dblink_exec('probe_flag',
        'UPDATE security.feature_flags SET enabled = false WHERE key = ''comms.dispatch_webhook''');
    PERFORM extensions.dblink_disconnect('probe_flag');

    v_b_rows := split_part(v_b, ':', 1)::int;
    SELECT count(*) INTO v_queued FROM comms.notification_deliveries
     WHERE notification_id = v_id AND channel = 'email' AND status = 'queued' AND attempts = 1;
    PERFORM pg_temp.ok(split_part(v_a, ':', 1) = '1' AND v_b_rows = 0 AND v_queued = 1,
        format('two sessions claim one delivery: A got %s, B got %s without waiting, %s row queued once',
               split_part(v_a, ':', 1), v_b_rows, v_queued));
    PERFORM pg_temp.ok(NOT (SELECT enabled FROM security.feature_flags WHERE key = 'comms.dispatch_webhook'),
        'the flag is back off');

    -- Keep the committed notice out of the seeded person's inbox, and its delivery out of every sweep.
    UPDATE comms.notification_deliveries SET status = 'skipped', suppressed_reason = 'probe'
     WHERE notification_id = v_id AND channel = 'email';
    UPDATE comms.notifications SET archived_at = now() WHERE id = v_id;
END $$;
-- #endregion
