-- digest_claim_race.sql — two digest senders claiming at once never take the same digest (PROJECTS NO2;
-- PRD-E15; Decision #344 (a)).
--
-- Session A claims and keeps its transaction open; session B claims at the same moment. B must come
-- back at once (SKIP LOCKED) without the digest, and the digest must be leased once (attempts 1). The
-- claim reads the comms.dispatch_webhook flag and the digest in its own transaction, so both are
-- COMMITTED here: the file refuses to start without `-v disposable=1`, and the flag is switched back
-- off (and the fixture closed) whether the race passes or fails. Run it only against a database about
-- to be reset, as `deno task test:probes:fresh` does.
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d postgres -X -q -v disposable=1 \
--     < supabase/probes/digest_claim_race.sql
-- `supabase_admin`: only a superuser may open a passwordless dblink session.
\set ON_ERROR_STOP on
\set QUIET on
\if :{?disposable}
\else
\echo 'digest_claim_race.sql commits its claim race; rerun with -v disposable=1 against a throwaway database.'
\quit
\endif

CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- #region Fixture (COMMITS): one pending digest of one work notice, flag still off
CREATE TEMP TABLE probe_race (digest_id uuid, notification_id uuid);
DO $$
DECLARE
    v_user uuid;
    v_note uuid;
    v_digest uuid;
BEGIN
    SELECT p.user_id INTO v_user
      FROM comms.notification_prefs p
      JOIN org.user_emails ue ON ue.user_id = p.user_id AND ue.is_primary AND ue.verified_at IS NOT NULL
     WHERE p.email AND (p.muted_until IS NULL OR p.muted_until <= now())
       AND NOT comms.fn_is_suppressed('email', ue.email, 'system')
       AND NOT EXISTS (SELECT 1 FROM comms.notification_category_prefs c
                        WHERE c.user_id = p.user_id AND c.category = 'work' AND c.email IS FALSE)
     ORDER BY p.user_id LIMIT 1;
    PERFORM pg_temp.ok(v_user IS NOT NULL, 'fixture: a seeded, reachable person with work email on');

    INSERT INTO comms.notification_types (key, category, urgency, default_channels, mandatory, digestible)
    VALUES ('probe.digest_race', 'work', 'low', '{in_app}', false, true)
    ON CONFLICT (key) DO NOTHING;
    v_note := comms.fn_notify(v_user, 'probe.digest_race', 'Probe digest race', 'Probe body');

    INSERT INTO comms.notification_digests (user_id, period, window_start, window_end, status, notification_ids, item_count)
    VALUES (v_user, 'daily', date_trunc('hour', now()) - interval '1 day' - interval '1 hour',
            date_trunc('hour', now()) - interval '1 hour', 'pending', ARRAY[v_note], 1)
    ON CONFLICT (user_id, period, window_start) DO NOTHING
    RETURNING id INTO v_digest;
    PERFORM pg_temp.ok(v_digest IS NOT NULL, 'fixture: one pending digest');
    INSERT INTO probe_race VALUES (v_digest, v_note);
END $$;
-- #endregion

-- #region The race
DO $$
DECLARE
    v_id uuid := (SELECT digest_id FROM probe_race);
    v_sql text;
    v_a text;
    v_b text;
    d comms.notification_digests;
BEGIN
    v_sql := format(
        'SELECT count(*) FILTER (WHERE digest_id = %L::uuid)::text FROM comms.fn_claim_digests(500)', v_id);

    -- The flag is committed on by its own autocommitting session, and switched off again below.
    PERFORM extensions.dblink_connect('probe_flag', 'dbname=' || current_database());
    PERFORM extensions.dblink_exec('probe_flag',
        'UPDATE security.feature_flags SET enabled = true WHERE key = ''comms.dispatch_webhook''');

    BEGIN
        PERFORM extensions.dblink_connect('probe_a', 'dbname=' || current_database());
        PERFORM extensions.dblink_connect('probe_b', 'dbname=' || current_database());
        PERFORM extensions.dblink_exec('probe_a', 'BEGIN');
        PERFORM extensions.dblink_exec('probe_b', 'BEGIN');
        -- A claims and holds the row lock; B claims while A is still open, and may not wait for it.
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
        UPDATE comms.notification_digests SET status = 'skipped', skipped_reason = 'probe', claimed_until = NULL
         WHERE id = v_id;
        RAISE;
    END;

    PERFORM extensions.dblink_exec('probe_flag',
        'UPDATE security.feature_flags SET enabled = false WHERE key = ''comms.dispatch_webhook''');
    PERFORM extensions.dblink_disconnect('probe_flag');

    SELECT * INTO d FROM comms.notification_digests WHERE id = v_id;
    PERFORM pg_temp.ok(v_a = '1' AND v_b = '0' AND d.status = 'pending' AND d.attempts = 1
            AND d.claimed_until > now(),
        format('two senders claim one digest: A got %s, B got %s without waiting, leased once (attempts %s)',
               v_a, v_b, d.attempts));
    PERFORM pg_temp.ok(NOT (SELECT enabled FROM security.feature_flags WHERE key = 'comms.dispatch_webhook'),
        'the flag is back off');

    -- Keep the committed digest out of every sweep, and its notice out of the person's inbox.
    UPDATE comms.notification_digests SET status = 'skipped', skipped_reason = 'probe', claimed_until = NULL
     WHERE id = v_id;
    UPDATE comms.notifications SET archived_at = now() WHERE id = (SELECT notification_id FROM probe_race);
END $$;
-- #endregion
