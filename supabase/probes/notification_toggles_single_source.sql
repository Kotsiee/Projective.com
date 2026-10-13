-- notification_toggles_single_source.sql — probe for the email/push toggles' one source (Decision #204).
--
-- `comms.notification_prefs.email` / `push` are the only email/push toggles: `org.user_preferences`
-- carries no copy, no function or view reads one, a new account is seeded with the defaults, and the
-- delivery router follows what the person writes through their own (RLS-scoped) session.
-- One transaction, ROLLED BACK, so the seeded database is left as it was. Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/notification_toggles_single_source.sql
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;
-- #endregion

-- #region 1. One copy of the toggles
DO $$
BEGIN
    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'org' AND table_name = 'user_preferences'
           AND column_name IN ('notification_email', 'notification_push')
    ), 'org.user_preferences carries no notification_email / notification_push');

    PERFORM pg_temp.ok((
        SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'comms' AND table_name = 'notification_prefs'
           AND ((column_name = 'email' AND column_default = 'true')
             OR (column_name = 'push' AND column_default = 'false'))
           AND is_nullable = 'NO' AND data_type = 'boolean'
    ) = 2, 'comms.notification_prefs.email (default true) / push (default false) are NOT NULL booleans');

    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND p.prosrc ~ 'notification_(email|push)'
    ), 'no function body reads notification_email / notification_push');

    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_views
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
           AND definition ~ 'notification_(email|push)'
    ), 'no view reads notification_email / notification_push');
END $$;
-- #endregion

-- #region 2. A new account is seeded in comms
DO $$
DECLARE
    v_uid uuid := gen_random_uuid();
    v_tag text := substr(replace(v_uid::text, '-', ''), 1, 10);
BEGIN
    INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    VALUES (v_uid, 'toggles-probe-' || v_tag || '@projective.invalid', 'authenticated', 'authenticated',
            jsonb_build_object('username', 'togprobe_' || v_tag, 'dob', (CURRENT_DATE - interval '30 years')::date,
                               'timezone', 'Europe/London'),
            now());
    PERFORM pg_temp.ok(
        (SELECT email AND NOT push FROM comms.notification_prefs WHERE user_id = v_uid),
        'a new profile is seeded with email on and push off in comms.notification_prefs');
END $$;
-- #endregion

-- #region 3. Delivery follows the person's own write
DO $$
DECLARE
    v_type text;
    v_uid uuid;
    v_out comms.notification_channel[];
BEGIN
    SELECT key INTO v_type FROM comms.notification_types
     WHERE enabled AND NOT mandatory AND 'email' = ANY (default_channels) AND 'push' = ANY (default_channels)
     ORDER BY key LIMIT 1;
    PERFORM pg_temp.ok(v_type IS NOT NULL, 'the catalogue has a non-mandatory type routed to email and push');

    SELECT user_id INTO v_uid FROM comms.notification_prefs ORDER BY user_id LIMIT 1;
    UPDATE comms.notification_prefs
       SET muted_until = NULL, quiet_hours_enabled = false, quiet_hours = NULL, digest_frequency = 'off'
     WHERE user_id = v_uid;
    DELETE FROM comms.notification_category_prefs WHERE user_id = v_uid;
    DELETE FROM comms.notification_type_mutes WHERE user_id = v_uid;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE comms.notification_prefs SET email = false, push = true WHERE user_id = v_uid;
    RESET ROLE;
    v_out := comms.fn_resolve_channels(v_uid, v_type);
    PERFORM pg_temp.ok(NOT ('email' = ANY (v_out)) AND 'push' = ANY (v_out),
        'email off / push on, written by the person, is what the router delivers');

    SET LOCAL ROLE authenticated;
    UPDATE comms.notification_prefs SET email = true, push = false WHERE user_id = v_uid;
    RESET ROLE;
    v_out := comms.fn_resolve_channels(v_uid, v_type);
    PERFORM pg_temp.ok('email' = ANY (v_out) AND NOT ('push' = ANY (v_out)),
        'email on / push off, written by the person, is what the router delivers');
END $$;
-- #endregion

ROLLBACK;
\echo 'notification_toggles_single_source: all checks passed'
