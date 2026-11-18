-- =============================================================================================
-- Probe: a pair's thread is only ever the pair's (PRD-C27). A DM or a service inquiry is the ONE
-- thread two people share, so "message this person" (comms.get_or_create_dm_thread) and a hiring
-- request (comms.send_request_message) reuse it. If a participant could widen that thread to a third
-- person without it ceasing to be the pair's, the pair lookup — which joins on the two people only —
-- would hand it to ANY two of its members: stranger A opens an inquiry on seller B's listing, adds C,
-- and from then on B's and C's "message this person" lands where A reads it. Decision #482 (owner
-- ruling): a service inquiry takes nobody, so every dm and service_inquiry holds exactly its pair; a
-- DM still widens by becoming a group (PRODUCT_SPEC §Messaging 2.E), which no pair lookup returns.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/dm_pair_isolation.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A seller B with a published listing, and a pending invitation between B and C — so the hiring-request
-- door has a real request to send — where B and C share no thread yet. A is a stranger to both.
CREATE TEMP TABLE probe_json (k text, v jsonb) ON COMMIT DROP;
GRANT ALL ON probe_json TO authenticated;

DO $$
DECLARE
    v_fx record;
    v_a uuid;
BEGIN
    SELECT l.id AS listing, l.owner_user_id AS b, i.project_id,
           i.inviter_user_id AS inviter, i.target_user_id AS target,
           CASE WHEN i.inviter_user_id = l.owner_user_id THEN i.target_user_id ELSE i.inviter_user_id END AS c
      INTO v_fx
      FROM catalogue.listings l
      JOIN projects.project_invitations i
        ON i.status = 'pending' AND l.owner_user_id IN (i.inviter_user_id, i.target_user_id)
     WHERE l.status = 'published'::catalogue.listing_status
       AND comms.fn_dm_allowed(i.inviter_user_id, i.target_user_id)
       AND NOT EXISTS (
           SELECT 1 FROM comms.dm_threads t
             JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = i.inviter_user_id
             JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = i.target_user_id
            WHERE t.kind IN ('dm', 'service_inquiry'))
     ORDER BY l.id, i.id LIMIT 1;
    IF v_fx.listing IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: no seller with a published listing and a pending invitation to someone they share no thread with (deno task db:reset)';
    END IF;

    SELECT u.user_id INTO v_a
      FROM org.users_public u
     WHERE u.user_id NOT IN (v_fx.b, v_fx.c)
       AND comms.fn_dm_allowed(u.user_id, v_fx.b)
       AND comms.fn_dm_allowed(u.user_id, v_fx.c)
       AND NOT EXISTS (
           SELECT 1 FROM comms.dm_threads t
             JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = u.user_id
             JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = v_fx.b
            WHERE t.kind IN ('dm', 'service_inquiry'))
     ORDER BY u.user_id LIMIT 1;
    IF v_a IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no stranger to the seller'; END IF;

    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.b', v_fx.b::text, true);
    PERFORM set_config('probe.c', v_fx.c::text, true);
    PERFORM set_config('probe.listing', v_fx.listing::text, true);
    PERFORM set_config('probe.project', v_fx.project_id::text, true);
    PERFORM set_config('probe.inviter', v_fx.inviter::text, true);
    PERFORM set_config('probe.target', v_fx.target::text, true);
    RAISE NOTICE 'fixture: stranger %, seller % (listing %), their counterpart %', v_a, v_fx.b, v_fx.listing, v_fx.c;
END $$;
-- #endregion

-- #region 1. A opens an inquiry on B's listing; both write in it
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'inquiry',
    comms.get_or_create_dm_thread(current_setting('probe.b')::uuid, current_setting('probe.listing')::uuid);
INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
SELECT (v ->> 'thread_id')::uuid, current_setting('probe.a')::uuid, 'probe: is this available in French?'
  FROM probe_json WHERE k = 'inquiry';

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.b'), 'role', 'authenticated')::text, true);
INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
SELECT (v ->> 'thread_id')::uuid, current_setting('probe.b')::uuid, 'probe: yes, for a 20% surcharge'
  FROM probe_json WHERE k = 'inquiry';
RESET ROLE;

DO $$
DECLARE
    v_t uuid := (SELECT (v ->> 'thread_id')::uuid FROM probe_json WHERE k = 'inquiry');
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM comms.dm_threads t
         WHERE t.id = v_t AND t.kind = 'service_inquiry'
           AND t.subject_listing_id = current_setting('probe.listing')::uuid
    ) THEN
        RAISE EXCEPTION 'FAIL the listing contact did not open a service inquiry about it';
    END IF;
    PERFORM set_config('probe.t', v_t::text, true);
    RAISE NOTICE 'PASS A''s contact opened a service inquiry about B''s listing';
END $$;
-- #endregion

-- #region 2. A tries to widen the inquiry to C
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    INSERT INTO probe_json VALUES ('widen', jsonb_build_object('added',
        comms.add_dm_thread_members(current_setting('probe.t')::uuid, ARRAY[current_setting('probe.c')::uuid])));
EXCEPTION WHEN OTHERS THEN
    INSERT INTO probe_json VALUES ('widen', jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM));
END $$;
RESET ROLE;
-- #endregion

-- #region 3. B and C reach each other: neither door may hand them A's thread
-- The hiring request first, while B and C still share nothing else: its lookup is the one a widened
-- thread would win. Then "message this person" from each side.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.inviter'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'request',
    comms.send_request_message(current_setting('probe.target')::uuid, 'probe: an intro for the invitation',
                               current_setting('probe.project')::uuid);

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.b'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'b_to_c', comms.get_or_create_dm_thread(current_setting('probe.c')::uuid);

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.c'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'c_to_b', comms.get_or_create_dm_thread(current_setting('probe.b')::uuid);
INSERT INTO probe_json SELECT 'c_reads_inquiry', jsonb_build_object('n', count(*))
  FROM comms.dm_messages m WHERE m.thread_id = current_setting('probe.t')::uuid;
RESET ROLE;

DO $$
DECLARE
    v_t uuid := current_setting('probe.t')::uuid;
    v_widen jsonb := (SELECT v FROM probe_json WHERE k = 'widen');
    v_request uuid := (SELECT (v ->> 'thread_id')::uuid FROM probe_json WHERE k = 'request');
    v_b_to_c uuid := (SELECT (v ->> 'thread_id')::uuid FROM probe_json WHERE k = 'b_to_c');
    v_c_to_b uuid := (SELECT (v ->> 'thread_id')::uuid FROM probe_json WHERE k = 'c_to_b');
    v_c_reads integer := (SELECT (v ->> 'n')::integer FROM probe_json WHERE k = 'c_reads_inquiry');
    v_fail text[] := '{}';
BEGIN
    IF v_widen ->> 'sqlstate' IS DISTINCT FROM '22023' THEN
        v_fail := array_append(v_fail, format('adding C to A''s inquiry was not refused 22023 (answered %s)', v_widen));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM comms.dm_threads t
         WHERE t.id = v_t AND t.kind = 'service_inquiry'
           AND t.subject_listing_id = current_setting('probe.listing')::uuid
    ) OR (SELECT array_agg(p.user_id ORDER BY p.user_id) FROM comms.dm_participants p WHERE p.thread_id = v_t)
         IS DISTINCT FROM (SELECT array_agg(u ORDER BY u) FROM unnest(ARRAY[
             current_setting('probe.a')::uuid, current_setting('probe.b')::uuid]) AS u) THEN
        v_fail := array_append(v_fail, 'A''s inquiry is no longer an inquiry about the listing between A and B alone');
    END IF;
    IF v_request = v_t THEN
        v_fail := array_append(v_fail, 'the hiring request between B and C was posted into A''s inquiry, where A reads it');
    END IF;
    IF v_b_to_c = v_t THEN
        v_fail := array_append(v_fail, 'B''s "message this person" to C opened A''s inquiry');
    END IF;
    IF v_c_to_b = v_t THEN
        v_fail := array_append(v_fail, 'C''s "message this person" to B opened A''s inquiry');
    END IF;
    IF v_request IS DISTINCT FROM v_b_to_c OR v_b_to_c IS DISTINCT FROM v_c_to_b THEN
        v_fail := array_append(v_fail, format('B and C do not share one thread (request %s, B→C %s, C→B %s)',
                                   v_request, v_b_to_c, v_c_to_b));
    END IF;
    IF v_c_reads > 0 THEN
        v_fail := array_append(v_fail, format('C, added by A, reads the %s messages A and B exchanged before C was there', v_c_reads));
    END IF;
    IF EXISTS (
        SELECT 1 FROM comms.dm_threads t
         WHERE t.kind IN ('dm', 'service_inquiry')
           AND (SELECT count(*) FROM comms.dm_participants p WHERE p.thread_id = t.id) > 2
    ) THEN
        v_fail := array_append(v_fail, 'a DM or service inquiry holds more than two people');
    END IF;

    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, E'\n  FAIL ');
    END IF;
    RAISE NOTICE 'PASS adding a third person to an inquiry is refused (22023); it stays A and B''s, about the listing';
    RAISE NOTICE 'PASS the hiring request and both "message this person" doors open B and C''s own thread, never A''s';
    RAISE NOTICE 'PASS C reads nothing of A''s inquiry';
    RAISE NOTICE 'PASS no DM or service inquiry holds more than two people';
END $$;
-- #endregion

-- #region 4. A DM still widens, by becoming a group that is nobody's DM
-- PRODUCT_SPEC §Messaging 2.E: adding people to a DM converts it into a group. The pair lookup then
-- skips the group and opens the pair a fresh DM.
DO $$
DECLARE
    v_a uuid := current_setting('probe.a')::uuid;
    v_c uuid := current_setting('probe.c')::uuid;
    v_d uuid;
BEGIN
    SELECT u.user_id INTO v_d
      FROM org.users_public u
     WHERE u.user_id NOT IN (v_a, v_c, current_setting('probe.b')::uuid)
       AND comms.fn_dm_allowed(u.user_id, v_a)
       AND comms.fn_dm_allowed(u.user_id, v_c)
       AND NOT EXISTS (
           SELECT 1 FROM comms.dm_threads t
             JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = u.user_id
             JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = v_a
            WHERE t.kind IN ('dm', 'service_inquiry'))
     ORDER BY u.user_id LIMIT 1;
    IF v_d IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: nobody A shares no thread with'; END IF;
    PERFORM set_config('probe.d', v_d::text, true);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'a_to_d', comms.get_or_create_dm_thread(current_setting('probe.d')::uuid);
INSERT INTO probe_json SELECT 'dm_widen', jsonb_build_object('added', comms.add_dm_thread_members(
    (SELECT (v ->> 'thread_id')::uuid FROM probe_json WHERE k = 'a_to_d'), ARRAY[current_setting('probe.c')::uuid]));
INSERT INTO probe_json SELECT 'a_to_d_again', comms.get_or_create_dm_thread(current_setting('probe.d')::uuid);
RESET ROLE;

DO $$
DECLARE
    v_dm uuid := (SELECT (v ->> 'thread_id')::uuid FROM probe_json WHERE k = 'a_to_d');
    v_again uuid := (SELECT (v ->> 'thread_id')::uuid FROM probe_json WHERE k = 'a_to_d_again');
BEGIN
    IF (SELECT (v ->> 'added')::integer FROM probe_json WHERE k = 'dm_widen') <> 1
       OR (SELECT t.kind FROM comms.dm_threads t WHERE t.id = v_dm) <> 'group' THEN
        RAISE EXCEPTION 'FAIL a DM that gained a third person did not become a group';
    END IF;
    RAISE NOTICE 'PASS a DM that gains a third person becomes a group';
    IF v_again = v_dm OR (SELECT t.kind FROM comms.dm_threads t WHERE t.id = v_again) <> 'dm'
       OR (SELECT count(*) FROM comms.dm_participants p WHERE p.thread_id = v_again) <> 2 THEN
        RAISE EXCEPTION 'FAIL after A''s DM with D became a group, "message D" did not open a fresh two-person DM';
    END IF;
    RAISE NOTICE 'PASS the pair lookup skips the group and opens the pair a fresh DM';
END $$;
-- #endregion

ROLLBACK;
