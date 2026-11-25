-- digest_claim.sql — the notification digest is claimed once and mailed, titles and links only
-- (PROJECTS NO2; PRD-E15; Decision #344 (a), #339 ruling N3 (b)).
--
--   0. Grants: comms.fn_claim_digests and comms.fn_record_digest_result are service role only, and
--      the comms-digest-send job is registered on the dispatcher's bearer.
--   1. The claim: with comms.dispatch_webhook off nothing is claimed; on, a built digest is leased
--      for 15 minutes (attempts 1) with its person's primary verified address, its counts by category
--      and its items as a title, a link and a category, never a body; a second claim inside the lease
--      takes nothing. Quiet hours do not hold it (PRODUCT_SPEC rule 2: push and SMS only).
--   2. The result: sent once, and a replay answers false; a failure backs off 2^attempts minutes and
--      the fifth closes the digest failed; a lease that lapses at the fifth attempt closes it failed.
--   3. Who is not mailed: a hard-bounced address (suppressed_destination), and a marketing-only
--      suppression drops the Marketing items only; no verified address (no_target); a snooze
--      (snoozed); a category whose email was turned off after the build, a type since muted for email
--      and an archived notice drop out, and a digest left empty closes (no_items); a digest more than
--      a day old closes (expired).
--
-- Every section runs in a transaction that is ROLLED BACK, so this is safe on the shared local DB.
-- The two-session claim race is digest_claim_race.sql (it commits).
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/digest_claim.sql
\set ON_ERROR_STOP on
\set QUIET on

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;
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

-- Digestible probe types in three categories, email on by default.
CREATE FUNCTION pg_temp.types() RETURNS void LANGUAGE sql AS $$
    INSERT INTO comms.notification_types (key, category, urgency, default_channels, mandatory, digestible)
    VALUES ('probe.digest_work', 'work', 'low', '{in_app,email}', false, true),
           ('probe.digest_messages', 'messages', 'low', '{in_app,email}', false, true),
           ('probe.digest_marketing', 'marketing', 'low', '{in_app,email}', false, true)
    ON CONFLICT (key) DO NOTHING;
$$;

CREATE FUNCTION pg_temp.flag(p_on boolean) RETURNS void LANGUAGE sql AS $$
    UPDATE security.feature_flags SET enabled = p_on WHERE key = 'comms.dispatch_webhook';
$$;

-- A clean slate for one person: a daily digest due this UTC hour, email on, no snooze, no quiet hours,
-- no category rows, no mutes, no suppression, no seeded notice in the window, and no digest already
-- built for this window.
CREATE FUNCTION pg_temp.reset(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE comms.notifications SET archived_at = now() WHERE user_id = p_user AND archived_at IS NULL;
    UPDATE comms.notification_prefs
       SET digest_frequency = 'daily', digest_hour = EXTRACT(HOUR FROM now() AT TIME ZONE 'UTC')::smallint,
           timezone = 'UTC', email = true, muted_until = NULL, quiet_hours_enabled = false, quiet_hours = NULL
     WHERE user_id = p_user;
    DELETE FROM comms.notification_category_prefs WHERE user_id = p_user;
    DELETE FROM comms.notification_type_mutes WHERE user_id = p_user;
    UPDATE comms.channel_suppressions SET lifted_at = now(), lifted_reason = 'probe'
     WHERE lower(destination) = lower(pg_temp.address(p_user)) AND lifted_at IS NULL;
    DELETE FROM comms.notification_digests
     WHERE user_id = p_user AND period = 'daily' AND window_end = date_trunc('hour', now());
END $$;

-- One notice per type, made two hours ago (inside the window that ends at the top of this hour), then
-- the daily build. Answers the person's digest for this window.
CREATE FUNCTION pg_temp.build(p_user uuid, p_types text[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_type text;
    v_id uuid;
BEGIN
    PERFORM pg_temp.types();
    FOREACH v_type IN ARRAY p_types LOOP
        v_id := comms.fn_notify(p_user, v_type, 'Probe title ' || v_type, 'PROBE-SECRET-BODY', NULL, NULL,
            '{}'::jsonb, NULL, NULL, NULL, NULL, '/projects');
        UPDATE comms.notifications SET created_at = now() - interval '2 hours' WHERE id = v_id;
    END LOOP;
    PERFORM comms.fn_build_digests('daily');
    RETURN (SELECT id FROM comms.notification_digests
             WHERE user_id = p_user AND period = 'daily' AND window_end = date_trunc('hour', now()));
END $$;

-- The person's row of one claim pass, as jsonb (NULL when the pass did not return it).
CREATE FUNCTION pg_temp.claim(p_digest uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT to_jsonb(c) FROM comms.fn_claim_digests(500) c WHERE c.digest_id = p_digest;
$$;

CREATE FUNCTION pg_temp.digest(p_id uuid) RETURNS comms.notification_digests LANGUAGE sql AS $$
    SELECT * FROM comms.notification_digests WHERE id = p_id;
$$;

DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.person(8) IS NOT NULL, 'fixture: eight seeded people with a primary verified email');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM security.feature_flags WHERE key = 'comms.dispatch_webhook'),
        'fixture: the comms.dispatch_webhook flag exists');
END $$;
-- #endregion

-- #region 0. Grants and the job — service role only
DO $$
DECLARE
    v_fn text;
BEGIN
    PERFORM pg_temp.ok(to_regprocedure('comms.fn_claim_digests(integer)') IS NOT NULL,
        'the digest claim comms.fn_claim_digests(integer) exists');
    PERFORM pg_temp.ok(to_regprocedure('comms.fn_record_digest_result(uuid,boolean,text,text)') IS NOT NULL,
        'the digest result door comms.fn_record_digest_result(uuid, boolean, text, text) exists');
    FOREACH v_fn IN ARRAY ARRAY['comms.fn_claim_digests(integer)', 'comms.fn_record_digest_result(uuid,boolean,text,text)'] LOOP
        PERFORM pg_temp.ok(
            has_function_privilege('service_role', v_fn, 'EXECUTE')
            AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
            AND NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
            v_fn || ' is executable by service_role only');
    END LOOP;
    PERFORM pg_temp.ok(EXISTS (
            SELECT 1 FROM ops.scheduled_jobs
             WHERE name = 'comms-digest-send' AND kind = 'http'
               AND path = '/api/comms/cron/digests?limit=50' AND secret_name = 'COMMS_DISPATCH_SECRET'),
        'comms-digest-send is registered: http, on COMMS_DISPATCH_SECRET');
END $$;

BEGIN;
SET LOCAL ROLE service_role;
DO $$
BEGIN
    PERFORM pg_temp.ok((SELECT count(*) FROM comms.fn_claim_digests(10)) >= 0,
        'as service_role: fn_claim_digests answers');
    PERFORM pg_temp.ok(NOT comms.fn_record_digest_result('00000000-0000-4000-8000-000000000000', true, 'probe', NULL),
        'as service_role: fn_record_digest_result answers (an unknown digest moves nothing)');
END $$;
ROLLBACK;
-- #endregion

-- #region 1. The claim — once, with titles and links
BEGIN;
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_id uuid;
    v_row jsonb;
    v_lease timestamptz;
BEGIN
    PERFORM pg_temp.reset(v_user);
    -- Quiet hours all day: they withhold push and SMS, never the email digest.
    UPDATE comms.notification_prefs
       SET quiet_hours_enabled = true, quiet_hours_start = '00:00', quiet_hours_end = '23:59'
     WHERE user_id = v_user;
    v_id := pg_temp.build(v_user, ARRAY['probe.digest_work', 'probe.digest_work', 'probe.digest_messages']);
    PERFORM pg_temp.ok((pg_temp.digest(v_id)).status = 'pending' AND (pg_temp.digest(v_id)).item_count = 3,
        'fixture: a pending daily digest of three notices');

    PERFORM pg_temp.flag(false);
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.fn_claim_digests(500)),
        'flag off: nothing is claimed');
    PERFORM pg_temp.ok((pg_temp.digest(v_id)).attempts = 0, 'flag off: the digest is untouched');

    PERFORM pg_temp.flag(true);
    v_row := pg_temp.claim(v_id);
    PERFORM pg_temp.ok(v_row IS NOT NULL AND v_row ->> 'status' = 'pending' AND (v_row ->> 'attempts')::int = 1,
        'flag on: the built digest is leased (attempts 1), inside quiet hours too');
    v_lease := (pg_temp.digest(v_id)).claimed_until;
    PERFORM pg_temp.ok(v_lease BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes',
        'the lease runs 15 minutes');
    PERFORM pg_temp.ok(v_row ->> 'address' = pg_temp.address(v_user), 'it carries the primary verified address');
    PERFORM pg_temp.ok((v_row ->> 'total')::int = 3 AND v_row -> 'counts' = '{"work": 2, "messages": 1}'::jsonb
            AND jsonb_array_length(v_row -> 'items') = 3,
        'three items, counted by category');
    PERFORM pg_temp.ok(NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_row -> 'items') i
             WHERE (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(i) k) <> ARRAY['action_url', 'category', 'title']),
        'each item is a title, a link and a category');
    PERFORM pg_temp.ok((v_row -> 'items' -> 0 ->> 'action_url') = '/projects', 'an item keeps its same-origin link');
    PERFORM pg_temp.ok(position('PROBE-SECRET-BODY' IN v_row::text) = 0, 'no body reaches the claim');
    PERFORM pg_temp.ok(v_row ->> 'marketing' = 'false', 'no Marketing item, so no unsubscribe is owed');
    PERFORM pg_temp.ok(pg_temp.claim(v_id) IS NULL, 'a second claim inside the lease takes nothing');
END $$;
ROLLBACK;
-- #endregion

-- #region 2. The result — sent once; failures back off, then fail
BEGIN;
DO $$
DECLARE
    v_a uuid := pg_temp.person(1);
    v_b uuid := pg_temp.person(2);
    v_c uuid := pg_temp.person(3);
    v_ida uuid;
    v_idb uuid;
    v_idc uuid;
    v_row jsonb;
    d comms.notification_digests;
BEGIN
    -- One at a time: a build also builds (empty, skipped) for everyone else due, and reset clears it.
    PERFORM pg_temp.reset(v_a);
    v_ida := pg_temp.build(v_a, ARRAY['probe.digest_work']);
    PERFORM pg_temp.reset(v_b);
    v_idb := pg_temp.build(v_b, ARRAY['probe.digest_work']);
    PERFORM pg_temp.reset(v_c);
    v_idc := pg_temp.build(v_c, ARRAY['probe.digest_work']);
    PERFORM pg_temp.flag(true);
    PERFORM pg_temp.ok(NOT comms.fn_record_digest_result(v_ida, true, 're_probe', NULL),
        'a digest never claimed cannot be recorded sent');
    PERFORM comms.fn_claim_digests(500);

    PERFORM pg_temp.ok(comms.fn_record_digest_result(v_ida, true, 're_probe', NULL), 'a send is recorded');
    d := pg_temp.digest(v_ida);
    PERFORM pg_temp.ok(d.status = 'sent' AND d.sent_at IS NOT NULL AND d.provider_ref = 're_probe'
            AND d.claimed_until IS NULL AND d.last_error IS NULL,
        'sent: sent_at, the provider''s message id, the lease released');
    PERFORM pg_temp.ok(NOT comms.fn_record_digest_result(v_ida, false, NULL, 'late'), 'a replayed result changes nothing');
    PERFORM pg_temp.ok((pg_temp.digest(v_ida)).status = 'sent', 'still sent');
    PERFORM pg_temp.ok(pg_temp.claim(v_ida) IS NULL, 'a sent digest is never claimed again');

    PERFORM pg_temp.ok(comms.fn_record_digest_result(v_idb, false, NULL, 'Resend answered 500'), 'a failure is recorded');
    d := pg_temp.digest(v_idb);
    PERFORM pg_temp.ok(d.status = 'pending' AND d.attempts = 1 AND d.last_error = 'Resend answered 500'
            AND d.claimed_until BETWEEN now() + interval '119 seconds' AND now() + interval '121 seconds',
        'a first failure stays pending and waits 2 minutes');
    PERFORM pg_temp.ok(pg_temp.claim(v_idb) IS NULL, 'not offered again inside its backoff');
    UPDATE comms.notification_digests SET claimed_until = now() - interval '1 second', attempts = 4 WHERE id = v_idb;
    v_row := pg_temp.claim(v_idb);
    PERFORM pg_temp.ok((v_row ->> 'attempts')::int = 5, 'past its backoff it is leased again (attempt 5)');
    PERFORM pg_temp.ok(comms.fn_record_digest_result(v_idb, false, NULL, 'Resend answered 500')
            AND (pg_temp.digest(v_idb)).status = 'failed' AND (pg_temp.digest(v_idb)).claimed_until IS NULL,
        'the fifth failure closes it failed');
    PERFORM pg_temp.ok(pg_temp.claim(v_idb) IS NULL, 'a failed digest is never claimed again');

    -- A sender that died holding the fifth lease: the next pass closes the digest failed.
    UPDATE comms.notification_digests SET claimed_until = now() - interval '1 second', attempts = 5 WHERE id = v_idc;
    v_row := pg_temp.claim(v_idc);
    PERFORM pg_temp.ok(v_row ->> 'status' = 'failed' AND v_row ->> 'reason' = 'lease_lapsed' AND v_row ->> 'address' IS NULL
            AND (pg_temp.digest(v_idc)).status = 'failed',
        'a lease lapsed at the fifth attempt closes failed (lease_lapsed), with no address');
END $$;
ROLLBACK;
-- #endregion

-- #region 3. Who is not mailed, and what drops out
BEGIN;
DO $$
DECLARE
    v_p uuid[] := ARRAY[pg_temp.person(1), pg_temp.person(2), pg_temp.person(3), pg_temp.person(4),
                        pg_temp.person(5), pg_temp.person(6), pg_temp.person(7), pg_temp.person(8)];
    v_id uuid[] := '{}';
    v_row jsonb;
    i int;
BEGIN
    -- One at a time: a build also builds (empty, skipped) for everyone else due, and reset clears it.
    FOR i IN 1..8 LOOP
        PERFORM pg_temp.reset(v_p[i]);
        IF i = 1 THEN
            -- A hard bounce blocks the address for every category (ruling N3 (b)).
            INSERT INTO comms.channel_suppressions (channel, destination, user_id, reason, marketing_only)
            VALUES ('email', pg_temp.address(v_p[1]), v_p[1], 'hard_bounce', false);
        ELSIF i = 2 THEN
            -- Marketing by its own yes, but the address unsubscribed: Marketing drops, work stays.
            INSERT INTO comms.notification_category_prefs (user_id, category, email) VALUES (v_p[2], 'marketing', true);
            INSERT INTO comms.channel_suppressions (channel, destination, user_id, reason, marketing_only)
            VALUES ('email', pg_temp.address(v_p[2]), v_p[2], 'unsubscribe', true);
        ELSIF i = 3 THEN
            -- Marketing by its own yes and reachable: it stays, and an unsubscribe is owed.
            INSERT INTO comms.notification_category_prefs (user_id, category, email) VALUES (v_p[3], 'marketing', true);
        END IF;
        v_id := v_id || pg_temp.build(v_p[i], CASE WHEN i IN (2, 3)
            THEN ARRAY['probe.digest_work', 'probe.digest_marketing']
            ELSE ARRAY['probe.digest_work', 'probe.digest_messages'] END);
    END LOOP;

    -- After the build: 4 loses a verified address; 5 snoozes; 6 turns Messages email off; 7 mutes the
    -- Messages type for email; 8 archives both notices; and a ninth case, 1's own digest, is not touched.
    UPDATE org.user_emails SET verified_at = NULL WHERE user_id = v_p[4] AND is_primary;
    UPDATE comms.notification_prefs SET muted_until = now() + interval '1 hour' WHERE user_id = v_p[5];
    INSERT INTO comms.notification_category_prefs (user_id, category, email) VALUES (v_p[6], 'messages', false);
    INSERT INTO comms.notification_type_mutes (user_id, type_key, channels)
    VALUES (v_p[7], 'probe.digest_messages', ARRAY['email']::comms.notification_channel[]);
    UPDATE comms.notifications SET archived_at = now() WHERE id = ANY ((pg_temp.digest(v_id[8])).notification_ids);

    PERFORM pg_temp.flag(true);
    CREATE TEMP TABLE probe_claimed ON COMMIT DROP AS
    SELECT to_jsonb(c) AS r FROM comms.fn_claim_digests(500) c WHERE c.digest_id = ANY (v_id);

    SELECT r INTO v_row FROM probe_claimed WHERE r ->> 'digest_id' = v_id[1]::text;
    PERFORM pg_temp.ok(v_row ->> 'status' = 'skipped' AND v_row ->> 'reason' = 'suppressed_destination'
            AND v_row ->> 'address' IS NULL AND (pg_temp.digest(v_id[1])).skipped_reason = 'suppressed_destination',
        'a hard-bounced address is not mailed (skipped, suppressed_destination)');

    SELECT r INTO v_row FROM probe_claimed WHERE r ->> 'digest_id' = v_id[2]::text;
    PERFORM pg_temp.ok(v_row ->> 'status' = 'pending' AND (v_row ->> 'total')::int = 1
            AND v_row -> 'counts' = '{"work": 1}'::jsonb AND v_row ->> 'marketing' = 'false',
        'a marketing-only suppression drops the Marketing item and keeps the rest');

    SELECT r INTO v_row FROM probe_claimed WHERE r ->> 'digest_id' = v_id[3]::text;
    PERFORM pg_temp.ok(v_row ->> 'status' = 'pending' AND (v_row ->> 'total')::int = 2 AND v_row ->> 'marketing' = 'true',
        'an opted-in, reachable Marketing item stays, and the claim says an unsubscribe is owed');

    SELECT r INTO v_row FROM probe_claimed WHERE r ->> 'digest_id' = v_id[4]::text;
    PERFORM pg_temp.ok(v_row ->> 'status' = 'skipped' AND v_row ->> 'reason' = 'no_target',
        'no verified address: skipped (no_target)');

    SELECT r INTO v_row FROM probe_claimed WHERE r ->> 'digest_id' = v_id[5]::text;
    PERFORM pg_temp.ok(v_row ->> 'status' = 'skipped' AND v_row ->> 'reason' = 'snoozed',
        'a snoozed person: skipped (snoozed)');

    SELECT r INTO v_row FROM probe_claimed WHERE r ->> 'digest_id' = v_id[6]::text;
    PERFORM pg_temp.ok(v_row ->> 'status' = 'pending' AND v_row -> 'counts' = '{"work": 1}'::jsonb,
        'a category whose email was turned off after the build drops out');

    SELECT r INTO v_row FROM probe_claimed WHERE r ->> 'digest_id' = v_id[7]::text;
    PERFORM pg_temp.ok(v_row ->> 'status' = 'pending' AND v_row -> 'counts' = '{"work": 1}'::jsonb,
        'a type muted for email drops out');

    SELECT r INTO v_row FROM probe_claimed WHERE r ->> 'digest_id' = v_id[8]::text;
    PERFORM pg_temp.ok(v_row ->> 'status' = 'skipped' AND v_row ->> 'reason' = 'no_items'
            AND (pg_temp.digest(v_id[8])).status = 'skipped',
        'a digest left with nothing closes (skipped, no_items)');
END $$;
ROLLBACK;

-- A digest more than a day old is not news.
BEGIN;
DO $$
DECLARE
    v_user uuid := pg_temp.person(1);
    v_id uuid;
    v_row jsonb;
BEGIN
    PERFORM pg_temp.reset(v_user);
    v_id := pg_temp.build(v_user, ARRAY['probe.digest_work']);
    UPDATE comms.notification_digests SET created_at = now() - interval '25 hours' WHERE id = v_id;
    PERFORM pg_temp.flag(true);
    v_row := pg_temp.claim(v_id);
    PERFORM pg_temp.ok(v_row ->> 'status' = 'skipped' AND v_row ->> 'reason' = 'expired'
            AND (pg_temp.digest(v_id)).status = 'skipped',
        'a digest older than 24 hours closes (skipped, expired)');
END $$;
ROLLBACK;
-- #endregion
