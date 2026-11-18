-- =============================================================================================
-- Probe: a person downloads a copy of their own data (Decision #450, migration 00001061).
--
--   * the request door wants a sign-in from the last 10 minutes (the token's `amr`), and asks for it
--     only once nothing else refuses;
--   * one open request at a time; at most one per 24 hours, a failed one not counted;
--   * refused while an account erasure is scheduled;
--   * nobody reads, writes or builds another person's request: owner-only RLS, no client write, and
--     every job door is the service role's alone;
--   * the job's doors: claim counts attempts, collect reads only a building request and only the
--     person's own messages, complete checks the archive path and announces it, release retries
--     then fails, the expiry sweep lists and expires;
--   * an erasure fails an open request and brings a ready archive's expiry forward.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/data_export.sql
--
-- A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

CREATE FUNCTION pg_temp.check(p_label text, p_ok boolean, p_got text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'FAIL % — got %', p_label, p_got;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

-- Act as p_user, signed in p_minutes ago (NULL: a token with no `amr` at all).
CREATE FUNCTION pg_temp.act(p_user uuid, p_minutes integer) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object(
        'sub', p_user, 'role', 'authenticated',
        'amr', CASE WHEN p_minutes IS NOT NULL THEN jsonb_build_array(jsonb_build_object(
            'method', 'password',
            'timestamp', floor(extract(epoch FROM now() - make_interval(mins => p_minutes)))::bigint)) END))::text, true);
$$;

-- What a statement raises, as `SQLSTATE message`, or `ok`.
CREATE FUNCTION pg_temp.attempt(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- The DETAIL a statement raises with, or NULL.
CREATE FUNCTION pg_temp.detail(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_detail text;
BEGIN
    EXECUTE p_sql;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN v_detail;
END $$;

CREATE FUNCTION pg_temp.latest(p_user uuid) RETURNS org.data_export_requests LANGUAGE sql AS $$
    SELECT * FROM org.data_export_requests r WHERE r.user_id = p_user ORDER BY r.requested_at DESC, r.id DESC LIMIT 1;
$$;

CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
GRANT SELECT ON probe_ids TO authenticated, service_role;
-- What the job's doors answered, checked afterwards as the table owner (the service role holds no
-- grant on the tables a collector reads).
CREATE TEMP TABLE probe_out (k text PRIMARY KEY, v jsonb);
GRANT SELECT, INSERT ON probe_out TO service_role;

-- #region Fixtures: two seeded freelancers, with nothing requested and nothing scheduled
DO $$
DECLARE
    v_a uuid := (SELECT u.user_id FROM org.users_public u WHERE u.username = 'marisdelacroix');
    v_b uuid := (SELECT u.user_id FROM org.users_public u WHERE u.username = 'kwamemensah');
BEGIN
    PERFORM pg_temp.check('fixtures: two seeded freelancers', v_a IS NOT NULL AND v_b IS NOT NULL, concat(v_a, ' ', v_b));
    DELETE FROM org.data_export_requests WHERE user_id IN (v_a, v_b);
    PERFORM pg_temp.check('fixtures: no erasure scheduled for either',
        NOT EXISTS (SELECT 1 FROM org.deletion_requests d WHERE d.user_id IN (v_a, v_b) AND d.status = 'scheduled'), 'scheduled');
    INSERT INTO probe_ids VALUES ('A', v_a), ('B', v_b);
END $$;
-- #endregion

-- #region 1. A fresh sign-in is required, and asked for last
DO $$
DECLARE
    v_a uuid := (SELECT id FROM probe_ids WHERE k = 'A');
    v_got text;
BEGIN
    PERFORM pg_temp.act(v_a, 20);
    v_got := pg_temp.attempt('SELECT org.request_data_export()');
    PERFORM pg_temp.check('1a a sign-in 20 minutes old is refused reauth_required', v_got = 'P0001 reauth_required', v_got);
    PERFORM pg_temp.check('1b get_data_export says the sign-in is stale',
        (org.get_data_export() ->> 'sign_in_fresh')::boolean = false, org.get_data_export()::text);

    PERFORM pg_temp.act(v_a, NULL);
    v_got := pg_temp.attempt('SELECT org.request_data_export()');
    PERFORM pg_temp.check('1c a token with no amr is refused reauth_required', v_got = 'P0001 reauth_required', v_got);
    PERFORM pg_temp.check('1d nothing was filed', NOT EXISTS (SELECT 1 FROM org.data_export_requests WHERE user_id = v_a), 'a row');

    PERFORM set_config('request.jwt.claims', '', true);
    v_got := pg_temp.attempt('SELECT org.request_data_export()');
    PERFORM pg_temp.check('1e a guest is refused 28000', v_got LIKE '28000 %', v_got);
END $$;
-- #endregion

-- #region 2. One open request at a time
DO $$
DECLARE
    v_a uuid := (SELECT id FROM probe_ids WHERE k = 'A');
    v_state jsonb;
    v_got text;
BEGIN
    PERFORM pg_temp.act(v_a, 2);
    v_state := org.request_data_export();
    PERFORM pg_temp.check('2a a fresh sign-in files a pending request',
        v_state -> 'latest' ->> 'status' = 'pending' AND (v_state ->> 'sign_in_fresh')::boolean, v_state::text);
    PERFORM pg_temp.check('2b the request is audited',
        EXISTS (SELECT 1 FROM security.audit_logs l WHERE l.user_id = v_a AND l.action = 'account.data_export_requested'
                   AND l.entity_id = (v_state -> 'latest' ->> 'id')::uuid), 'no audit row');
    INSERT INTO probe_ids VALUES ('R1', (v_state -> 'latest' ->> 'id')::uuid);

    v_got := pg_temp.attempt('SELECT org.request_data_export()');
    PERFORM pg_temp.check('2c a second request while one is pending is refused already_pending',
        v_got = 'P0001 already_pending', v_got);

    UPDATE org.data_export_requests SET status = 'building', started_at = now(), attempts = 1
     WHERE id = (SELECT id FROM probe_ids WHERE k = 'R1');
    v_got := pg_temp.attempt('SELECT org.request_data_export()');
    PERFORM pg_temp.check('2d … and while one is building', v_got = 'P0001 already_pending', v_got);
    v_got := pg_temp.attempt('INSERT INTO org.data_export_requests (user_id) VALUES (' || quote_literal(v_a) || ')');
    PERFORM pg_temp.check('2e the unique index holds even past the door', v_got LIKE '23505 %', v_got);
    UPDATE org.data_export_requests SET status = 'pending', started_at = NULL, attempts = 0
     WHERE id = (SELECT id FROM probe_ids WHERE k = 'R1');
END $$;
-- #endregion

-- #region 3. Nobody reaches another person's request
SAVEPOINT s3;
DO $$
BEGIN
    PERFORM pg_temp.act((SELECT id FROM probe_ids WHERE k = 'B'), 2);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_r1 uuid := (SELECT id FROM probe_ids WHERE k = 'R1');
    v_got text;
BEGIN
    PERFORM pg_temp.check('3a another person sees none of A''s rows',
        NOT EXISTS (SELECT 1 FROM org.data_export_requests WHERE id = v_r1), 'visible');
    PERFORM pg_temp.check('3b another person''s get_data_export shows only their own (none)',
        org.get_data_export() -> 'latest' = 'null'::jsonb, org.get_data_export()::text);
    v_got := pg_temp.attempt('UPDATE org.data_export_requests SET status = ''failed'' WHERE id = ' || quote_literal(v_r1));
    PERFORM pg_temp.check('3c a client cannot UPDATE a request', v_got LIKE '42501 %', v_got);
    v_got := pg_temp.attempt('DELETE FROM org.data_export_requests WHERE id = ' || quote_literal(v_r1));
    PERFORM pg_temp.check('3d a client cannot DELETE a request', v_got LIKE '42501 %', v_got);
    v_got := pg_temp.attempt('INSERT INTO org.data_export_requests (user_id) VALUES (auth.uid())');
    PERFORM pg_temp.check('3e a client cannot INSERT past the door', v_got LIKE '42501 %', v_got);
    v_got := pg_temp.attempt('SELECT security.collect_data_export(' || quote_literal(v_r1) || ', ''messages'')');
    PERFORM pg_temp.check('3f a client cannot read a domain through the job''s door', v_got LIKE '42501 %', v_got);
    v_got := pg_temp.attempt('SELECT org.fn_export_messages(' || quote_literal(v_r1) || ')');
    PERFORM pg_temp.check('3g a client cannot call a collector', v_got LIKE '42501 %', v_got);
    v_got := pg_temp.attempt('SELECT security.claim_data_exports(5)');
    PERFORM pg_temp.check('3h a client cannot claim requests', v_got LIKE '42501 %', v_got);
    v_got := pg_temp.attempt('SELECT security.complete_data_export(' || quote_literal(v_r1) || ', ''x'', 1, 1)');
    PERFORM pg_temp.check('3i a client cannot settle a request', v_got LIKE '42501 %', v_got);
END $$;
RESET ROLE;
DO $$
BEGIN
    PERFORM pg_temp.act((SELECT id FROM probe_ids WHERE k = 'A'), 2);
END $$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM pg_temp.check('3j the owner reads their own request',
        EXISTS (SELECT 1 FROM org.data_export_requests WHERE id = (SELECT id FROM probe_ids WHERE k = 'R1')), 'hidden');
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT s3;
-- #endregion

-- #region 4. Refused while an erasure is scheduled
SAVEPOINT s4;
DO $$
DECLARE
    v_b uuid := (SELECT id FROM probe_ids WHERE k = 'B');
    v_got text;
BEGIN
    INSERT INTO org.deletion_requests (user_id, scope, scheduled_for) VALUES (v_b, 'account', now() + interval '30 days');
    PERFORM pg_temp.act(v_b, 2);
    v_got := pg_temp.attempt('SELECT org.request_data_export()');
    PERFORM pg_temp.check('4a a request during a scheduled erasure is refused account_closing',
        v_got = 'P0001 account_closing', v_got);
    PERFORM pg_temp.act(v_b, 30);
    v_got := pg_temp.attempt('SELECT org.request_data_export()');
    PERFORM pg_temp.check('4b … before the sign-in is asked for', v_got = 'P0001 account_closing', v_got);
    PERFORM pg_temp.check('4c get_data_export says the account is closing',
        (org.get_data_export() ->> 'account_closing')::boolean, org.get_data_export()::text);
END $$;
ROLLBACK TO SAVEPOINT s4;
-- #endregion

-- #region 5. The job: claim, collect, complete
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_a uuid := (SELECT id FROM probe_ids WHERE k = 'A');
    v_r1 uuid := (SELECT id FROM probe_ids WHERE k = 'R1');
    v_claims jsonb := security.claim_data_exports(50);
    v_got text;
    v_messages jsonb;
BEGIN
    PERFORM pg_temp.check('5a the claim takes A''s pending request with its first attempt',
        v_claims @> jsonb_build_array(jsonb_build_object('id', v_r1, 'user_id', v_a, 'attempts', 1)), v_claims::text);
    v_got := pg_temp.attempt('SELECT security.collect_data_export(' || quote_literal(v_r1) || ', ''bogus'')');
    PERFORM pg_temp.check('5b an unknown domain is refused', v_got = '22023 domain_invalid', v_got);
    v_got := pg_temp.attempt('SELECT security.collect_data_export(gen_random_uuid(), ''profile'')');
    PERFORM pg_temp.check('5c a request that is not building reads nothing', v_got = 'P0002 not_building', v_got);
    INSERT INTO probe_out
    SELECT d, security.collect_data_export(v_r1, d) FROM unnest(ARRAY['messages', 'wallet', 'files']) AS d;

    v_got := pg_temp.attempt('SELECT security.complete_data_export(' || quote_literal(v_r1) || ', ''someone/else.zip'', 10, 1)');
    PERFORM pg_temp.check('5d a completion naming another path is refused', v_got = '22023 path_mismatch', v_got);
    PERFORM pg_temp.check('5e a completion at the request''s own path settles it',
        security.complete_data_export(v_r1, v_a::text || '/' || v_r1::text || '.zip', 2048, 1), 'false');
    PERFORM pg_temp.check('5f … only once', NOT security.complete_data_export(v_r1, v_a::text || '/' || v_r1::text || '.zip', 2048, 1), 'true');
END $$;
RESET ROLE;
DO $$
DECLARE
    v_a uuid := (SELECT id FROM probe_ids WHERE k = 'A');
    v_messages jsonb := (SELECT v FROM probe_out WHERE k = 'messages');
    v_wallet jsonb := (SELECT v FROM probe_out WHERE k = 'wallet');
    v_files jsonb := (SELECT v FROM probe_out WHERE k = 'files');
BEGIN
    PERFORM pg_temp.check('5g messages: every direct message is one A sent, and all of them',
        jsonb_array_length(v_messages -> 'direct') = (SELECT count(*) FROM comms.dm_messages m WHERE m.sender_user_id = v_a)
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_messages -> 'direct') e
              JOIN comms.dm_messages m ON m.id = (e ->> 'id')::uuid
             WHERE m.sender_user_id IS DISTINCT FROM v_a),
        jsonb_array_length(v_messages -> 'direct')::text);
    PERFORM pg_temp.check('5h messages: every channel message is one A sent',
        NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_messages -> 'channel') e
              JOIN comms.project_messages m ON m.id = (e ->> 'id')::uuid
             WHERE m.sender_user_id IS DISTINCT FROM v_a), 'another sender');
    PERFORM pg_temp.check('5i messages: participants are handles, never A''s own',
        NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_messages -> 'threads') t, jsonb_array_elements_text(t -> 'participants') h
             WHERE h = (SELECT username FROM org.users_public WHERE user_id = v_a)), 'A listed');
    PERFORM pg_temp.check('5j wallet: only A''s own wallets',
        jsonb_array_length(v_wallet) > 0 AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_wallet) w
              JOIN finance.wallets fw ON fw.id = (w ->> 'id')::uuid
             WHERE fw.owner_id <> v_a OR fw.owner_type NOT IN ('user', 'freelancer')), v_wallet::text);
    PERFORM pg_temp.check('5k files: no storage path or share slug leaves the database',
        jsonb_array_length(v_files) > 0
        AND position('storage_path' IN v_files::text) = 0 AND position('share_slug' IN v_files::text) = 0, 'a secret key');
END $$;
DO $$
DECLARE
    v_a uuid := (SELECT id FROM probe_ids WHERE k = 'A');
    v_req org.data_export_requests := pg_temp.latest(v_a);
BEGIN
    PERFORM pg_temp.check('5l ready for 7 days with its size and manifest version',
        v_req.status = 'ready' AND v_req.expires_at = v_req.ready_at + interval '7 days'
        AND v_req.byte_size = 2048 AND v_req.manifest_version = 1, row_to_json(v_req)::text);
    PERFORM pg_temp.check('5m the person is told in-app, linked to Settings, never to the archive',
        EXISTS (SELECT 1 FROM comms.notifications n
                 WHERE n.user_id = v_a AND n.type = 'account.data_export_ready' AND n.entity_id = v_req.id
                   AND n.action_url = '/settings/account#data-export'), 'no notice');
END $$;
-- #endregion

-- #region 6. The 24-hour limit, a failed request not counted
DO $$
DECLARE
    v_a uuid := (SELECT id FROM probe_ids WHERE k = 'A');
    v_r1 uuid := (SELECT id FROM probe_ids WHERE k = 'R1');
    v_got text;
    v_detail text;
    v_state jsonb;
BEGIN
    PERFORM pg_temp.act(v_a, 2);
    v_got := pg_temp.attempt('SELECT org.request_data_export()');
    PERFORM pg_temp.check('6a a second request inside 24 hours is refused rate_limited', v_got = 'P0001 rate_limited', v_got);
    v_detail := pg_temp.detail('SELECT org.request_data_export()');
    PERFORM pg_temp.check('6b … naming when the next may be filed',
        v_detail::timestamptz = (SELECT requested_at + interval '24 hours' FROM org.data_export_requests WHERE id = v_r1), v_detail);
    PERFORM pg_temp.check('6c get_data_export carries the same moment',
        (org.get_data_export() ->> 'next_request_at')::timestamptz = v_detail::timestamptz, org.get_data_export()::text);

    UPDATE org.data_export_requests SET requested_at = requested_at - interval '25 hours' WHERE id = v_r1;
    v_state := org.request_data_export();
    PERFORM pg_temp.check('6d once 24 hours have passed, the next is filed', v_state -> 'latest' ->> 'status' = 'pending', v_state::text);
    INSERT INTO probe_ids VALUES ('R2', (v_state -> 'latest' ->> 'id')::uuid);
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_r2 uuid := (SELECT id FROM probe_ids WHERE k = 'R2');
BEGIN
    PERFORM security.claim_data_exports(50);
    PERFORM pg_temp.check('6e a too-large archive fails at once', security.release_data_export(v_r2, 'too_large') = 'failed', 'not failed');
END $$;
RESET ROLE;
DO $$
DECLARE
    v_a uuid := (SELECT id FROM probe_ids WHERE k = 'A');
    v_state jsonb;
BEGIN
    PERFORM pg_temp.check('6f the person is told it failed',
        EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = v_a AND n.type = 'account.data_export_failed'
                   AND n.entity_id = (SELECT id FROM probe_ids WHERE k = 'R2')), 'no notice');
    -- One transaction has one now(): step the failed request back so "latest" is the next one.
    UPDATE org.data_export_requests SET requested_at = requested_at - interval '1 minute'
     WHERE id = (SELECT id FROM probe_ids WHERE k = 'R2');
    PERFORM pg_temp.act(v_a, 2);
    v_state := org.request_data_export();
    PERFORM pg_temp.check('6g a failed request does not count toward the 24 hours', v_state -> 'latest' ->> 'status' = 'pending', v_state::text);
    INSERT INTO probe_ids VALUES ('R3', (v_state -> 'latest' ->> 'id')::uuid);
END $$;
-- #endregion

-- #region 7. Retries, then failure
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_r3 uuid := (SELECT id FROM probe_ids WHERE k = 'R3');
    v_i integer;
BEGIN
    FOR v_i IN 1 .. 2 LOOP
        PERFORM security.claim_data_exports(50);
        PERFORM pg_temp.check(format('7a attempt %s of 3 goes back to pending', v_i),
            security.release_data_export(v_r3, 'build_failed') = 'pending', 'not pending');
    END LOOP;
    PERFORM security.claim_data_exports(50);
    PERFORM pg_temp.check('7b the third failed attempt fails the request',
        security.release_data_export(v_r3, 'build_failed') = 'failed', 'not failed');
    PERFORM pg_temp.check('7c a released request is no longer building', security.release_data_export(v_r3, 'build_failed') IS NULL, 'released twice');
END $$;
RESET ROLE;
DO $$
DECLARE
    v_req org.data_export_requests := (SELECT r FROM org.data_export_requests r WHERE r.id = (SELECT id FROM probe_ids WHERE k = 'R3'));
BEGIN
    PERFORM pg_temp.check('7d failed with build_failed after 3 attempts',
        v_req.status = 'failed' AND v_req.failure_reason = 'build_failed' AND v_req.attempts = 3, row_to_json(v_req)::text);
END $$;
-- #endregion

-- #region 8. Expiry
DO $$
DECLARE
    v_r1 uuid := (SELECT id FROM probe_ids WHERE k = 'R1');
    v_b uuid := (SELECT id FROM probe_ids WHERE k = 'B');
    v_state jsonb;
BEGIN
    UPDATE org.data_export_requests
       SET ready_at = ready_at - interval '8 days', expires_at = now() - interval '1 minute'
     WHERE id = v_r1;
    INSERT INTO org.data_export_requests (user_id, status, requested_at, started_at, attempts, ready_at, expires_at,
                                          storage_path, byte_size, manifest_version)
    VALUES (v_b, 'ready', now() - interval '8 days', now() - interval '8 days', 1, now() - interval '8 days',
            now() - interval '1 day', v_b::text || '/y.zip', 10, 1);
    v_state := org.fn_data_export_state(v_b);
    PERFORM pg_temp.check('8a a ready archive past its expiry reads expired before the sweep removes it',
        v_state -> 'latest' ->> 'status' = 'expired', v_state::text);
    DELETE FROM org.data_export_requests WHERE user_id = v_b;
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_r1 uuid := (SELECT id FROM probe_ids WHERE k = 'R1');
BEGIN
    PERFORM pg_temp.check('8b the sweep lists it with its path',
        security.due_data_export_expiries(500) @> jsonb_build_array(jsonb_build_object('id', v_r1)), 'missing');
    PERFORM pg_temp.check('8c and expires it once removed', security.expire_data_export(v_r1), 'false');
    PERFORM pg_temp.check('8d only once', NOT security.expire_data_export(v_r1), 'true');
END $$;
RESET ROLE;
DO $$
DECLARE
    v_req org.data_export_requests := (SELECT r FROM org.data_export_requests r WHERE r.id = (SELECT id FROM probe_ids WHERE k = 'R1'));
BEGIN
    PERFORM pg_temp.check('8e the row stays, expired', v_req.status = 'expired' AND v_req.expired_at IS NOT NULL, row_to_json(v_req)::text);
END $$;
-- #endregion

-- #region 9. An erasure reaches the exports
SAVEPOINT s9;
DO $$
DECLARE
    v_b uuid := (SELECT id FROM probe_ids WHERE k = 'B');
    v_open uuid;
    v_ready uuid;
BEGIN
    INSERT INTO org.data_export_requests (user_id) VALUES (v_b) RETURNING id INTO v_open;
    INSERT INTO org.data_export_requests (user_id, status, requested_at, started_at, attempts, ready_at, expires_at,
                                          storage_path, byte_size, manifest_version)
    VALUES (v_b, 'ready', now() - interval '2 days', now() - interval '2 days', 1, now() - interval '2 days',
            now() + interval '5 days', v_b::text || '/x.zip', 10, 1)
    RETURNING id INTO v_ready;
    PERFORM org.fn_erase_account(v_b);
    PERFORM pg_temp.check('9a an open request fails account_erased',
        (SELECT status = 'failed' AND failure_reason = 'account_erased' FROM org.data_export_requests WHERE id = v_open), 'open');
    PERFORM pg_temp.check('9b … with no notice to an erased account',
        NOT EXISTS (SELECT 1 FROM comms.notifications n WHERE n.entity_id = v_open), 'noticed');
    PERFORM pg_temp.check('9c a ready archive''s expiry comes forward to now',
        (SELECT expires_at <= now() FROM org.data_export_requests WHERE id = v_ready), 'still live');
    PERFORM pg_temp.check('9d … so the sweep removes it',
        security.due_data_export_expiries(500) @> jsonb_build_array(jsonb_build_object('id', v_ready)), 'not due');
END $$;
ROLLBACK TO SAVEPOINT s9;
-- #endregion

-- #region 10. A minor may export
SAVEPOINT s10;
DO $$
DECLARE
    v_b uuid := (SELECT id FROM probe_ids WHERE k = 'B');
    v_state jsonb;
BEGIN
    UPDATE org.users_public SET dob = (CURRENT_DATE - interval '15 years')::date WHERE user_id = v_b;
    PERFORM pg_temp.act(v_b, 2);
    v_state := org.request_data_export();
    PERFORM pg_temp.check('10 a 15-year-old files a request like anyone else', v_state -> 'latest' ->> 'status' = 'pending', v_state::text);
END $$;
ROLLBACK TO SAVEPOINT s10;
-- #endregion

ROLLBACK;
