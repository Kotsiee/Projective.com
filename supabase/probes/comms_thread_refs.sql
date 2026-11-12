-- =============================================================================================
-- Probe: the N1 schema window (Decision #339, ruling N1; COMMS MS1). A conversation has one opaque
-- `cht-` address that no caller chooses and nobody can move; each thread carries a derived summary of
-- its newest message that only its trigger advances, never backwards; comms.inbox_tails reads every
-- preview in one call and answers only for the caller's own threads; and a DM is filed under the
-- project its people share, never under one the sender is not on.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/comms_thread_refs.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
CREATE TEMP TABLE probe_rows (k text, id uuid, project_id uuid, masked boolean) ON COMMIT DROP;
CREATE TEMP TABLE probe_json (k text, v jsonb) ON COMMIT DROP;
CREATE TEMP TABLE probe_tails (k text, ord integer, thread_id uuid, id uuid, created_at timestamptz) ON COMMIT DROP;
GRANT ALL ON probe_rows, probe_json, probe_tails TO authenticated;

DO $$
DECLARE
    v_dm uuid;
    v_a uuid;
    v_b uuid;
    v_c uuid;
    v_p uuid;
    v_owner uuid;
    v_free uuid;
    v_q uuid;
    v_x uuid;
    v_channel uuid;
    v_member uuid;
    v_inv record;
    v_f uuid;
    v_pdm uuid;
    v_xdm uuid;
BEGIN
    SELECT p.thread_id INTO v_dm
    FROM comms.dm_participants p JOIN comms.dm_threads t ON t.id = p.thread_id
    WHERE t.kind = 'dm' AND p.deleted_at IS NULL
    GROUP BY p.thread_id HAVING count(*) = 2 ORDER BY p.thread_id LIMIT 1;
    IF v_dm IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no two-person DM (deno task db:reset)'; END IF;
    SELECT min(p.user_id::text)::uuid, max(p.user_id::text)::uuid INTO v_a, v_b
    FROM comms.dm_participants p WHERE p.thread_id = v_dm;
    IF NOT comms.fn_dm_allowed(v_a, v_b) THEN RAISE EXCEPTION 'FAIL no fixture: the seeded DM pair may not message'; END IF;

    SELECT u.user_id INTO v_c FROM org.users_public u
    WHERE u.user_id NOT IN (v_a, v_b) ORDER BY u.user_id LIMIT 1;

    SELECT p.id, p.owner_user_id, sa.freelancer_profile_id INTO v_p, v_owner, v_free
    FROM projects.projects p
    JOIN projects.project_stages ps ON ps.project_id = p.id
    JOIN projects.stage_assignments sa ON sa.project_stage_id = ps.id
    WHERE sa.assignee_type = 'freelancer' AND sa.status NOT IN ('declined', 'cancelled', 'released')
      AND sa.freelancer_profile_id <> p.owner_user_id
      AND projects.is_protected_phase(p.id)
      AND comms.fn_dm_allowed(p.owner_user_id, sa.freelancer_profile_id)
    ORDER BY p.id LIMIT 1;
    IF v_p IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no assigned freelancer on a protected project'; END IF;

    SELECT p.id INTO v_q FROM projects.projects p
    WHERE projects.is_protected_phase(p.id)
      AND p.id NOT IN (SELECT e.project_id FROM projects.fn_engaged_projects(v_owner) e)
    ORDER BY p.id LIMIT 1;
    IF v_q IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no protected project the owner is not on'; END IF;

    SELECT u.user_id INTO v_x FROM org.users_public u
    WHERE u.user_id NOT IN (v_a, v_b)
      AND NOT EXISTS (SELECT 1 FROM projects.fn_engaged_projects(u.user_id))
      AND comms.fn_dm_allowed(u.user_id, v_a)
    ORDER BY u.user_id LIMIT 1;
    IF v_x IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: nobody who is party to no project'; END IF;

    SELECT t.id, p.user_id INTO v_channel, v_member
    FROM comms.dm_threads t JOIN comms.dm_participants p ON p.thread_id = t.id AND p.deleted_at IS NULL
    WHERE t.kind = 'entity_channel' AND t.archived_at IS NULL
    ORDER BY t.id, p.user_id LIMIT 1;
    IF v_channel IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no live entity channel with a member'; END IF;

    SELECT i.project_id, i.inviter_user_id, i.target_user_id INTO v_inv
    FROM projects.project_invitations i
    WHERE i.status = 'pending' AND comms.fn_dm_allowed(i.inviter_user_id, i.target_user_id)
    ORDER BY i.id LIMIT 1;
    IF v_inv.project_id IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no pending invitation'; END IF;

    INSERT INTO comms.dm_threads (created_by_user_id) VALUES (v_a) RETURNING id INTO v_f;
    INSERT INTO comms.dm_participants (thread_id, user_id) VALUES (v_f, v_a), (v_f, v_b);
    INSERT INTO comms.dm_threads (created_by_user_id) VALUES (v_owner) RETURNING id INTO v_pdm;
    INSERT INTO comms.dm_participants (thread_id, user_id) VALUES (v_pdm, v_owner), (v_pdm, v_free);
    INSERT INTO comms.dm_threads (created_by_user_id) VALUES (v_x) RETURNING id INTO v_xdm;
    INSERT INTO comms.dm_participants (thread_id, user_id) VALUES (v_xdm, v_x), (v_xdm, v_a);

    PERFORM set_config('probe.dm', v_dm::text, true);
    PERFORM set_config('probe.a', v_a::text, true);
    PERFORM set_config('probe.b', v_b::text, true);
    PERFORM set_config('probe.c', v_c::text, true);
    PERFORM set_config('probe.p', v_p::text, true);
    PERFORM set_config('probe.owner', v_owner::text, true);
    PERFORM set_config('probe.free', v_free::text, true);
    PERFORM set_config('probe.q', v_q::text, true);
    PERFORM set_config('probe.x', v_x::text, true);
    PERFORM set_config('probe.channel', v_channel::text, true);
    PERFORM set_config('probe.member', v_member::text, true);
    PERFORM set_config('probe.inv_project', v_inv.project_id::text, true);
    PERFORM set_config('probe.inviter', v_inv.inviter_user_id::text, true);
    PERFORM set_config('probe.invitee', v_inv.target_user_id::text, true);
    PERFORM set_config('probe.f', v_f::text, true);
    PERFORM set_config('probe.pdm', v_pdm::text, true);
    PERFORM set_config('probe.xdm', v_xdm::text, true);
    PERFORM set_config('probe.all_threads',
        (SELECT array_agg(t.id ORDER BY t.id)::text FROM comms.dm_threads t), true);
END $$;
-- #endregion

-- #region 1. The cht- ref: minted for every thread, never chosen, never moved
DO $$
DECLARE
    v_total integer;
    v_shaped integer;
    v_ref text;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE t.ref ~ '^cht-[23456789abcdefghjkmnopqrstuvwxyz]{10}$')
      INTO v_total, v_shaped FROM comms.dm_threads t;
    IF v_total = 0 OR v_total <> v_shaped THEN
        RAISE EXCEPTION 'FAIL % of % threads carry a cht- ref', v_shaped, v_total;
    END IF;
    RAISE NOTICE 'PASS every thread (% rows, seeds included) carries a cht- ref', v_total;

    INSERT INTO comms.dm_threads (created_by_user_id, ref)
    VALUES (current_setting('probe.a')::uuid, 'cht-2222222222')
    RETURNING ref INTO v_ref;
    IF v_ref = 'cht-2222222222' OR v_ref !~ '^cht-[23456789abcdefghjkmnopqrstuvwxyz]{10}$' THEN
        RAISE EXCEPTION 'FAIL a supplied ref was kept (%)', v_ref;
    END IF;
    RAISE NOTICE 'PASS a supplied ref is replaced by a minted one';

    BEGIN
        UPDATE comms.dm_threads SET ref = 'cht-3333333333' WHERE id = current_setting('probe.f')::uuid;
        RAISE EXCEPTION 'FAIL a thread''s ref moved';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a ref is permanent (23514)';
    END;

    IF has_table_privilege('authenticated', 'comms.dm_threads', 'UPDATE')
       OR has_table_privilege('authenticated', 'comms.dm_threads', 'INSERT')
       OR NOT has_table_privilege('authenticated', 'comms.dm_threads', 'SELECT') THEN
        RAISE EXCEPTION 'FAIL authenticated may write comms.dm_threads, or cannot read it';
    END IF;
    IF has_function_privilege('authenticated', 'security.fn_ref_guard()', 'EXECUTE')
       OR has_function_privilege('anon', 'security.fn_ref_guard()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL security.fn_ref_guard is a client RPC';
    END IF;
    RAISE NOTICE 'PASS no client role writes a thread or calls the ref guard';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);

INSERT INTO probe_json SELECT 'opened', comms.get_or_create_dm_thread(current_setting('probe.b')::uuid);

DO $$
DECLARE
    v_opened jsonb := (SELECT v FROM probe_json WHERE k = 'opened');
BEGIN
    IF v_opened ->> 'thread_ref' IS DISTINCT FROM (
        SELECT t.ref FROM comms.dm_threads t WHERE t.id = (v_opened ->> 'thread_id')::uuid
    ) THEN
        RAISE EXCEPTION 'FAIL get_or_create_dm_thread answered % without its own ref', v_opened;
    END IF;
    RAISE NOTICE 'PASS get_or_create_dm_thread answers the thread and its ref';

    BEGIN
        UPDATE comms.dm_threads SET ref = 'cht-4444444444' WHERE id = current_setting('probe.dm')::uuid;
        RAISE EXCEPTION 'FAIL a participant rewrote a thread''s ref';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a participant cannot write a ref (42501)';
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The thread summary: newest message, never backwards, never a client's
DO $$
DECLARE
    v_f uuid := current_setting('probe.f')::uuid;
    v_a uuid := current_setting('probe.a')::uuid;
    v_mid uuid;
    v_new uuid;
    v_old uuid;
    v_at timestamptz;
    v_last uuid;
    v_bad integer;
BEGIN
    SELECT t.last_message_id, t.last_message_at INTO v_last, v_at FROM comms.dm_threads t WHERE t.id = v_f;
    IF v_last IS NOT NULL OR v_at IS NOT NULL THEN RAISE EXCEPTION 'FAIL an empty thread has a summary'; END IF;
    RAISE NOTICE 'PASS an empty thread''s summary is NULL';

    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, created_at)
    VALUES (v_f, v_a, 'second', now() + interval '2 hours') RETURNING id INTO v_mid;
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, created_at)
    VALUES (v_f, v_a, 'third', now() + interval '3 hours') RETURNING id INTO v_new;
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, created_at)
    VALUES (v_f, v_a, 'first', now() + interval '1 hour') RETURNING id INTO v_old;
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, created_at)
    VALUES (v_f, v_a, 'long ago', now() - interval '1000 hours');
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, created_at, deleted_at)
    VALUES (v_f, v_a, 'gone', now() + interval '4 hours', now());

    SELECT t.last_message_id, t.last_message_at INTO v_last, v_at FROM comms.dm_threads t WHERE t.id = v_f;
    IF v_last IS DISTINCT FROM v_new OR v_at IS DISTINCT FROM now() + interval '3 hours' THEN
        RAISE EXCEPTION 'FAIL after out-of-order inserts the summary is % at %, not the newest', v_last, v_at;
    END IF;
    RAISE NOTICE 'PASS out-of-order, older and deleted inserts leave the summary on the newest message';

    PERFORM set_config('probe.m_new', v_new::text, true);
    PERFORM set_config('probe.m_mid', v_mid::text, true);
    PERFORM set_config('probe.m_old', v_old::text, true);

    SELECT count(*) INTO v_bad FROM comms.dm_threads t
    WHERE t.last_message_id IS DISTINCT FROM (
        SELECT m.id FROM comms.dm_messages m
         WHERE m.thread_id = t.id AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1
    );
    IF v_bad > 0 THEN RAISE EXCEPTION 'FAIL % threads'' summaries are not their newest message', v_bad; END IF;
    RAISE NOTICE 'PASS every thread''s summary (seeds included) is its newest undeleted message';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        UPDATE comms.dm_threads SET last_message_at = now() WHERE id = current_setting('probe.f')::uuid;
        RAISE EXCEPTION 'FAIL a participant moved last_message_at';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS a client UPDATE of last_message_at is refused (42501)';
    END;
END $$;
RESET ROLE;

-- Defence in depth: even with a write privilege and an UPDATE policy, the derived guard holds.
SAVEPOINT guard_depth;
GRANT UPDATE ON TABLE comms.dm_threads TO authenticated;
CREATE POLICY probe_dm_threads_update ON comms.dm_threads FOR UPDATE TO authenticated
    USING (comms.is_dm_participant(id));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
DECLARE v_rows integer;
BEGIN
    UPDATE comms.dm_threads SET title = title WHERE id = current_setting('probe.f')::uuid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'FAIL the probe policy did not admit the participant''s row'; END IF;
    BEGIN
        UPDATE comms.dm_threads SET last_message_id = current_setting('probe.m_old')::uuid
         WHERE id = current_setting('probe.f')::uuid;
        RAISE EXCEPTION 'FAIL the derived guard let a client move last_message_id';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS with a privilege and a policy, the derived guard still refuses the summary (42501)';
    END;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT guard_depth;
-- #endregion

-- #region 3. comms.inbox_tails: the caller's threads only, newest first, bounded
DO $$
BEGIN
    IF NOT has_function_privilege('authenticated', 'comms.inbox_tails(uuid[],integer)', 'EXECUTE')
       OR has_function_privilege('anon', 'comms.inbox_tails(uuid[],integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL comms.inbox_tails is not executable by authenticated alone';
    END IF;
    IF (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'comms.inbox_tails(uuid[],integer)'::regprocedure) THEN
        RAISE EXCEPTION 'FAIL comms.inbox_tails is SECURITY DEFINER; RLS must be its guard';
    END IF;
    RAISE NOTICE 'PASS inbox_tails is an invoker function, executable by authenticated only';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);

INSERT INTO probe_tails
SELECT 'all', NULL, r.thread_id, r.id, r.created_at
  FROM comms.inbox_tails(current_setting('probe.all_threads')::uuid[]) r;
INSERT INTO probe_tails
SELECT 'k3', row_number() OVER (), r.thread_id, r.id, r.created_at
  FROM comms.inbox_tails(ARRAY[current_setting('probe.f')::uuid], 3) r;
INSERT INTO probe_tails
SELECT 'k1', NULL, r.thread_id, r.id, r.created_at
  FROM comms.inbox_tails(ARRAY[current_setting('probe.f')::uuid, current_setting('probe.f')::uuid]) r;
INSERT INTO probe_tails
SELECT 'k50', NULL, r.thread_id, r.id, r.created_at
  FROM comms.inbox_tails(ARRAY[current_setting('probe.f')::uuid], 50) r;

DO $$
DECLARE
    v_mine integer;
    v_listed integer;
    v_k3 uuid[];
BEGIN
    SELECT count(*) INTO v_listed FROM probe_tails WHERE k = 'all';
    IF v_listed = 0 THEN RAISE EXCEPTION 'FAIL inbox_tails returned nothing for a participant'; END IF;
    IF EXISTS (SELECT 1 FROM probe_tails r WHERE r.k = 'all' AND NOT comms.is_dm_participant(r.thread_id)) THEN
        RAISE EXCEPTION 'FAIL inbox_tails returned a thread the caller is not in';
    END IF;
    SELECT count(DISTINCT m.thread_id) INTO v_mine FROM comms.dm_messages m WHERE m.deleted_at IS NULL;
    IF v_listed <> v_mine OR (SELECT count(DISTINCT thread_id) FROM probe_tails WHERE k = 'all') <> v_listed THEN
        RAISE EXCEPTION 'FAIL k = 1 over every thread: % rows for % of the caller''s threads with a message',
            v_listed, v_mine;
    END IF;
    RAISE NOTICE 'PASS over every thread id, inbox_tails returns one row per thread of the caller''s only (%)', v_listed;

    SELECT array_agg(id ORDER BY ord) INTO v_k3 FROM probe_tails WHERE k = 'k3';
    IF v_k3 IS DISTINCT FROM ARRAY[current_setting('probe.m_new')::uuid, current_setting('probe.m_mid')::uuid,
                                   current_setting('probe.m_old')::uuid] THEN
        RAISE EXCEPTION 'FAIL k = 3 returned % instead of the three newest, newest first', v_k3;
    END IF;
    RAISE NOTICE 'PASS k = 3 returns the three newest messages, newest first';

    IF (SELECT array_agg(id) FROM probe_tails WHERE k = 'k1') IS DISTINCT FROM ARRAY[current_setting('probe.m_new')::uuid] THEN
        RAISE EXCEPTION 'FAIL k = 1 with a repeated id is not the one summary message';
    END IF;
    RAISE NOTICE 'PASS k = 1 reads the summary message, once for a repeated id';

    IF (SELECT count(*) FROM probe_tails WHERE k = 'k50') > 20 THEN
        RAISE EXCEPTION 'FAIL p_k is not clamped to 20';
    END IF;
    RAISE NOTICE 'PASS p_k is clamped';
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.c'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM comms.inbox_tails(
        ARRAY[current_setting('probe.f')::uuid, current_setting('probe.dm')::uuid], 3)) THEN
        RAISE EXCEPTION 'FAIL a non-participant read a thread''s tail';
    END IF;
    RAISE NOTICE 'PASS a non-participant gets zero rows';
END $$;
RESET ROLE;

UPDATE comms.dm_messages SET deleted_at = now() WHERE id = current_setting('probe.m_new')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF (SELECT array_agg(r.id) FROM comms.inbox_tails(ARRAY[current_setting('probe.f')::uuid]) r)
       IS DISTINCT FROM ARRAY[current_setting('probe.m_mid')::uuid] THEN
        RAISE EXCEPTION 'FAIL k = 1 did not fall back past a deleted summary message';
    END IF;
    RAISE NOTICE 'PASS k = 1 falls back to the newest undeleted message when the summary''s is deleted';
END $$;
RESET ROLE;

DO $$
DECLARE
    v_plan text := '';
    v_line text;
BEGIN
    SET LOCAL enable_seqscan = off;
    FOR v_line IN EXECUTE format(
        'EXPLAIN SELECT d.id FROM comms.dm_messages d WHERE d.thread_id = %L AND d.deleted_at IS NULL '
        'ORDER BY d.created_at DESC, d.id DESC LIMIT 3', current_setting('probe.f'))
    LOOP v_plan := v_plan || v_line || E'\n'; END LOOP;
    IF position('idx_dm_messages_thread_recent' IN v_plan) = 0 THEN
        RAISE EXCEPTION 'FAIL the k > 1 walk does not use idx_dm_messages_thread_recent:%', v_plan;
    END IF;
    v_plan := '';
    FOR v_line IN EXECUTE format(
        'EXPLAIN SELECT DISTINCT m.thread_id FROM comms.dm_messages m WHERE m.project_id = %L',
        current_setting('probe.p'))
    LOOP v_plan := v_plan || v_line || E'\n'; END LOOP;
    IF position('idx_dm_messages_project' IN v_plan) = 0 THEN
        RAISE EXCEPTION 'FAIL the project''s DM group does not use idx_dm_messages_project:%', v_plan;
    END IF;
    RESET enable_seqscan;
    RAISE NOTICE 'PASS the tail walk and the project''s DM group read their indexes';
END $$;
-- #endregion

-- #region 4. project_id: stamped from the people, never forged
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);

WITH m AS (
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES (current_setting('probe.pdm')::uuid, current_setting('probe.owner')::uuid,
            'Write to me at probe.owner@example.com')
    RETURNING id, project_id, pii_masked
) INSERT INTO probe_rows SELECT 'derived', id, project_id, pii_masked FROM m;

WITH m AS (
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body)
    VALUES (current_setting('probe.pdm')::uuid, current_setting('probe.owner')::uuid,
            current_setting('probe.p')::uuid, 'About the project')
    RETURNING id, project_id, pii_masked
) INSERT INTO probe_rows SELECT 'kept', id, project_id, pii_masked FROM m;

WITH m AS (
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body)
    VALUES (current_setting('probe.pdm')::uuid, current_setting('probe.owner')::uuid,
            current_setting('probe.q')::uuid, 'About somebody else''s project')
    RETURNING id, project_id, pii_masked
) INSERT INTO probe_rows SELECT 'forged', id, project_id, pii_masked FROM m;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.x'), 'role', 'authenticated')::text, true);

WITH m AS (
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES (current_setting('probe.xdm')::uuid, current_setting('probe.x')::uuid, 'Hello there')
    RETURNING id, project_id, pii_masked
) INSERT INTO probe_rows SELECT 'unrelated', id, project_id, pii_masked FROM m;

WITH m AS (
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body)
    VALUES (current_setting('probe.xdm')::uuid, current_setting('probe.x')::uuid,
            current_setting('probe.p')::uuid, 'Mail me at probe.x@example.com')
    RETURNING id, project_id, pii_masked
) INSERT INTO probe_rows SELECT 'unrelated_forged', id, project_id, pii_masked FROM m;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.inviter'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'request', comms.send_request_message(
    current_setting('probe.invitee')::uuid, 'An introduction', current_setting('probe.inv_project')::uuid);
RESET ROLE;

INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body)
VALUES (current_setting('probe.channel')::uuid, current_setting('probe.member')::uuid,
        current_setting('probe.p')::uuid, 'Channel chatter');

DO $$
DECLARE
    v_shared uuid[] := ARRAY(
        SELECT p.id FROM projects.projects p
         WHERE projects.is_protected_phase(p.id)
           AND p.id IN (SELECT e.project_id FROM projects.fn_engaged_projects(current_setting('probe.owner')::uuid) e)
           AND p.id IN (SELECT e.project_id FROM projects.fn_engaged_projects(current_setting('probe.free')::uuid) e)
    );
    r record;
    v_req jsonb := (SELECT v FROM probe_json WHERE k = 'request');
BEGIN
    IF cardinality(v_shared) = 0 THEN RAISE EXCEPTION 'FAIL fixture: the pair shares no protected project'; END IF;

    SELECT * INTO r FROM probe_rows WHERE k = 'derived';
    IF r.project_id IS NULL OR NOT r.project_id = ANY (v_shared) OR NOT r.masked THEN
        RAISE EXCEPTION 'FAIL a DM between two parties was stamped % (shared: %), masked %', r.project_id, v_shared, r.masked;
    END IF;
    RAISE NOTICE 'PASS a DM between two parties of a protected project is stamped with it, and masked';

    SELECT * INTO r FROM probe_rows WHERE k = 'kept';
    IF r.project_id IS DISTINCT FROM current_setting('probe.p')::uuid THEN
        RAISE EXCEPTION 'FAIL a project both people are party to was not kept (%)', r.project_id;
    END IF;
    RAISE NOTICE 'PASS a supplied project both people are party to is kept';

    SELECT * INTO r FROM probe_rows WHERE k = 'forged';
    IF r.project_id IS NULL OR r.project_id = current_setting('probe.q')::uuid OR NOT r.project_id = ANY (v_shared) THEN
        RAISE EXCEPTION 'FAIL a forged project_id from a non-party was stored as %', r.project_id;
    END IF;
    RAISE NOTICE 'PASS a forged project_id from a non-party is replaced by the derived one';

    SELECT * INTO r FROM probe_rows WHERE k = 'unrelated';
    IF r.project_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL a DM with no shared project was stamped %', r.project_id;
    END IF;
    SELECT * INTO r FROM probe_rows WHERE k = 'unrelated_forged';
    IF r.project_id IS NOT NULL OR r.masked THEN
        RAISE EXCEPTION 'FAIL a forged project on an unrelated DM stuck (%), or the mask read it (masked %)', r.project_id, r.masked;
    END IF;
    RAISE NOTICE 'PASS a DM with no shared project stays NULL, forged or not, and the mask reads the settled NULL';

    IF EXISTS (SELECT 1 FROM comms.dm_messages m
                WHERE m.thread_id = current_setting('probe.channel')::uuid
                  AND m.body = 'Channel chatter' AND m.project_id IS NOT NULL) THEN
        RAISE EXCEPTION 'FAIL an entity-channel message carries a project';
    END IF;
    RAISE NOTICE 'PASS an entity-channel message carries no project';

    IF v_req ->> 'thread_ref' IS DISTINCT FROM (
        SELECT t.ref FROM comms.dm_threads t WHERE t.id = (v_req ->> 'thread_id')::uuid
    ) THEN
        RAISE EXCEPTION 'FAIL send_request_message answered % without its thread''s ref', v_req;
    END IF;
    IF (SELECT m.project_id FROM comms.dm_messages m WHERE m.id = (v_req ->> 'message_id')::uuid)
       IS DISTINCT FROM current_setting('probe.inv_project')::uuid THEN
        RAISE EXCEPTION 'FAIL a hiring request lost its project';
    END IF;
    RAISE NOTICE 'PASS send_request_message answers its thread''s ref and keeps the request''s project';

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger g
         WHERE g.tgrelid = 'comms.dm_messages'::regclass AND g.tgname = 'trg_dm_messages_bind_project'
           AND g.tgname::text COLLATE "C" < 'trg_dm_messages_mask_pii'
    ) THEN
        RAISE EXCEPTION 'FAIL trg_dm_messages_bind_project is missing or sorts after the mask';
    END IF;
    RAISE NOTICE 'PASS the project stamp fires before the PII mask';
END $$;
-- #endregion

ROLLBACK;
