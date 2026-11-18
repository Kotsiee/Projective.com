-- =============================================================================================
-- Probe: a group newcomer reads only what was written after they joined (PRD-C33, Decision #482 (b)).
-- The people already in a group wrote for one another, so someone added later — to a group, or to a
-- DM that their arrival turns into one — reads its messages from their own
-- `comms.dm_participants.joined_at`, never before. An entity channel is the workspace's record and
-- keeps its whole history for a member who joins it; a DM and a service inquiry hold only their two
-- founding people (#482 (a)). PRODUCT_SPEC §Messaging 2.E "What a newcomer reads".
--
-- Every read a member has of a message is checked from the newcomer's side and from a founder's:
-- the message rows, the inbox preview (`comms.inbox_tails`, whose k = 1 path reads through the thread
-- summary `dm_threads.last_message_id`), `comms.can_read_message` and the reactions / pins /
-- favourites it gates, the attachment link rows, the thread's Files register (`comms.channel_files`),
-- the file itself (`files.fn_can_read`), the bytes in the `messages` bucket, and a reply's quoted
-- original. Then the seeded threads: every founding member of a seeded DM, inquiry or group, and
-- every member of a seeded entity channel (all of whom joined after its messages), reads it whole.
--
-- `now()` is fixed inside one transaction, so the founders' history is backdated as postgres: the
-- group is created, its founders' `joined_at` and its first messages are moved into the past, and only
-- then is the newcomer added (at now()). A message written after that carries now() too, so it also
-- proves that a message written at the instant someone joins is theirs to read.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/dm_newcomer_history.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;
-- Since #477 a function is EXECUTE-denied to every client role unless 00002510 names it, so the
-- pg_temp helper below, called as `authenticated`, needs its PUBLIC grant back (rolled back).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
-- @prelude (in-flight definitions are spliced here when probing before a reset)

CREATE TEMP TABLE probe_json (k text, v jsonb) ON COMMIT DROP;
GRANT ALL ON probe_json TO authenticated;

-- #region 0. The seeded threads: every founding member, and every channel member, reads it whole
-- Run before any fixture exists, so it covers the seed alone. A seeded channel's members were synced
-- in at seed time, after its backdated messages, so a bound that reached channels fails here.
DO $$
DECLARE
    r record;
    v_seen bigint;
    v_fail text[] := '{}';
    v_checked integer := 0;
    v_channel_late integer := 0;
BEGIN
    FOR r IN
        SELECT p.thread_id, p.user_id, t.kind,
               (SELECT count(*) FROM comms.dm_messages m WHERE m.thread_id = p.thread_id) AS total,
               (SELECT count(*) FROM comms.dm_messages m
                 WHERE m.thread_id = p.thread_id AND m.created_at < p.joined_at) AS before_join
          FROM comms.dm_participants p
          JOIN comms.dm_threads t ON t.id = p.thread_id
         WHERE p.deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM comms.dm_messages m WHERE m.thread_id = p.thread_id)
         ORDER BY t.kind, p.thread_id, p.user_id
    LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
        SELECT count(*) INTO v_seen FROM comms.dm_messages m WHERE m.thread_id = r.thread_id;
        PERFORM set_config('role', 'postgres', true);

        v_checked := v_checked + 1;
        IF r.kind = 'entity_channel' AND r.before_join > 0 THEN
            v_channel_late := v_channel_late + 1;
        END IF;
        IF r.kind <> 'group' OR r.before_join = 0 THEN
            IF v_seen <> r.total THEN
                v_fail := array_append(v_fail, format('%s member %s of seeded %s %s reads %s of its %s messages',
                    CASE WHEN r.before_join > 0 THEN 'channel' ELSE 'founding' END,
                    r.user_id, r.kind, r.thread_id, v_seen, r.total));
            END IF;
        END IF;
    END LOOP;

    IF v_checked = 0 THEN
        RAISE EXCEPTION 'FAIL no fixture: no seeded thread holds a message (deno task db:reset)';
    END IF;
    IF v_channel_late = 0 THEN
        RAISE EXCEPTION 'FAIL no fixture: no seeded channel member joined after the channel''s messages';
    END IF;
    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, E'\n  FAIL ');
    END IF;
    RAISE NOTICE 'PASS all % seeded memberships read their thread whole (% channel members who joined after its messages)',
        v_checked, v_channel_late;
END $$;
-- #endregion

-- #region 1. Fixtures (as postgres)
-- A, B, C, D: four people each free to message the others (comms.fn_dm_allowed), where A and D share
-- no DM yet, so A's "message D" opens a fresh one.
DO $$
DECLARE
    v_ids uuid[];
    v_d uuid;
BEGIN
    SELECT ARRAY[a.user_id, b.user_id, c.user_id] INTO v_ids
      FROM org.users_public a
      JOIN org.users_public b ON b.user_id > a.user_id
      JOIN org.users_public c ON c.user_id > b.user_id
     WHERE comms.fn_dm_allowed(a.user_id, b.user_id)
       AND comms.fn_dm_allowed(a.user_id, c.user_id)
       AND comms.fn_dm_allowed(b.user_id, c.user_id)
     ORDER BY a.user_id, b.user_id, c.user_id
     LIMIT 1;
    IF v_ids IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: three people free to message one another'; END IF;

    SELECT u.user_id INTO v_d
      FROM org.users_public u
     WHERE u.user_id <> ALL (v_ids)
       AND comms.fn_dm_allowed(u.user_id, v_ids[1])
       AND comms.fn_dm_allowed(u.user_id, v_ids[3])
       AND NOT EXISTS (
           SELECT 1 FROM comms.dm_threads t
             JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = u.user_id
             JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = v_ids[1]
            WHERE t.kind IN ('dm', 'service_inquiry'))
     ORDER BY u.user_id LIMIT 1;
    IF v_d IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: a fourth person A shares no DM with'; END IF;

    PERFORM set_config('probe.a', v_ids[1]::text, true);
    PERFORM set_config('probe.b', v_ids[2]::text, true);
    PERFORM set_config('probe.c', v_ids[3]::text, true);
    PERFORM set_config('probe.d', v_d::text, true);
    RAISE NOTICE 'fixture: founders A % and B %, newcomer C %, A''s DM counterpart D %', v_ids[1], v_ids[2], v_ids[3], v_d;
END $$;

-- What one viewer can see of the probe group G, through every read path a member has.
CREATE FUNCTION pg_temp.probe_view() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT jsonb_build_object(
        'thread', (SELECT count(*) FROM comms.dm_threads t WHERE t.id = current_setting('probe.g')::uuid),
        'messages', (SELECT count(*) FROM comms.dm_messages m WHERE m.thread_id = current_setting('probe.g')::uuid),
        'pre_join', (SELECT count(*) FROM comms.dm_messages m
                      WHERE m.id IN (current_setting('probe.m1')::uuid, current_setting('probe.m2')::uuid)),
        'tail1', (SELECT coalesce(jsonb_agg(x.id), '[]') FROM comms.inbox_tails(ARRAY[current_setting('probe.g')::uuid], 1) x),
        'tail20', (SELECT coalesce(jsonb_agg(x.id ORDER BY x.created_at, x.id), '[]')
                     FROM comms.inbox_tails(ARRAY[current_setting('probe.g')::uuid], 20) x),
        'can_read_m1', comms.can_read_message('comms.dm_messages', current_setting('probe.m1')::uuid),
        'can_read_m3', CASE WHEN current_setting('probe.m3', true) <> ''
                            THEN comms.can_read_message('comms.dm_messages', current_setting('probe.m3')::uuid) END,
        'reactions_m1', (SELECT count(*) FROM comms.message_reactions r
                          WHERE r.message_table = 'comms.dm_messages' AND r.message_id = current_setting('probe.m1')::uuid),
        'pins_m1', (SELECT count(*) FROM comms.message_pins p
                     WHERE p.message_table = 'comms.dm_messages' AND p.message_id = current_setting('probe.m1')::uuid),
        'attachments', (SELECT coalesce(jsonb_agg(a.attachment_id ORDER BY a.created_at), '[]')
                          FROM comms.message_attachments a
                         WHERE a.message_table = 'comms.dm_messages'
                           AND a.message_id IN (SELECT m.id FROM comms.dm_messages m
                                                 WHERE m.thread_id = current_setting('probe.g')::uuid)
                            OR (a.message_table = 'comms.dm_messages'
                                AND a.message_id = current_setting('probe.m1')::uuid)),
        'channel_files', (SELECT count(*) FROM comms.channel_files f
                           WHERE f.channel_type = 'dm' AND f.channel_id = current_setting('probe.g')::uuid),
        'file_f', files.fn_can_read(current_setting('probe.f')::uuid),
        'file_f2', CASE WHEN current_setting('probe.f2', true) <> ''
                        THEN files.fn_can_read(current_setting('probe.f2')::uuid) END,
        'objects', (SELECT count(*) FROM storage.objects o
                     WHERE o.bucket_id = 'messages' AND o.name LIKE current_setting('probe.g') || '/%')
    );
$$;
GRANT EXECUTE ON FUNCTION pg_temp.probe_view() TO authenticated;
-- #endregion

-- #region 2. A starts a group with B; it has a history before C arrives
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
SELECT set_config('probe.g',
    comms.create_group_thread('probe: the founders', ARRAY[current_setting('probe.b')::uuid])::text, true);
RESET ROLE;

-- The founders' past (as postgres): the group and its founders' membership two hours ago, two messages
-- and a file in between — m1 from A with an attachment, a reaction from B and A's pin; m2 B's reply.
DO $$
DECLARE
    v_g uuid := current_setting('probe.g')::uuid;
    v_a uuid := current_setting('probe.a')::uuid;
    v_b uuid := current_setting('probe.b')::uuid;
    v_m1 uuid;
    v_m2 uuid;
    v_f uuid;
BEGIN
    UPDATE comms.dm_threads SET created_at = now() - interval '2 hours' WHERE id = v_g;
    UPDATE comms.dm_participants SET joined_at = now() - interval '2 hours' WHERE thread_id = v_g;

    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, has_attachments, created_at)
    VALUES (v_g, v_a, 'probe: the founders'' plan, before C', true, now() - interval '90 minutes')
    RETURNING id INTO v_m1;
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, reply_to_id, created_at)
    VALUES (v_g, v_b, 'probe: agreed, between us', v_m1, now() - interval '80 minutes')
    RETURNING id INTO v_m2;

    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type,
                             size_bytes, status, created_at)
    VALUES (v_a, 'personal', format('users/%s/probe/plan.txt', v_a), 'plan.txt', 'plan.txt', 'text/plain',
            1, 'uploaded', now() - interval '90 minutes')
    RETURNING id INTO v_f;
    INSERT INTO comms.message_attachments (message_table, message_id, attachment_id, created_at)
    VALUES ('comms.dm_messages', v_m1, v_f, now() - interval '90 minutes');
    INSERT INTO comms.channel_files (channel_type, channel_id, attachment_id, created_at)
    VALUES ('dm', v_g, v_f, now() - interval '90 minutes');
    INSERT INTO storage.objects (bucket_id, name, owner, created_at, updated_at)
    VALUES ('messages', format('%s/%s/plan.txt', v_g, v_m1), v_a, now() - interval '90 minutes',
            now() - interval '90 minutes');

    INSERT INTO comms.message_reactions (message_table, message_id, user_id, emoji, created_at)
    VALUES ('comms.dm_messages', v_m1, v_b, '👍', now() - interval '85 minutes');
    INSERT INTO comms.message_pins (message_table, message_id, pinned_by_user_id, created_at)
    VALUES ('comms.dm_messages', v_m1, v_a, now() - interval '85 minutes');

    PERFORM set_config('probe.m1', v_m1::text, true);
    PERFORM set_config('probe.m2', v_m2::text, true);
    PERFORM set_config('probe.f', v_f::text, true);
END $$;
-- #endregion

-- #region 3. A adds C; C sees the group and nothing written before they joined
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'add_c', jsonb_build_object('added',
    comms.add_dm_thread_members(current_setting('probe.g')::uuid, ARRAY[current_setting('probe.c')::uuid]));

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.c'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'c_before', pg_temp.probe_view();

-- Nor can C act on a message they cannot read: react to it, pin it, favourite it.
DO $$
DECLARE
    v_m1 uuid := current_setting('probe.m1')::uuid;
    v_c uuid := current_setting('probe.c')::uuid;
    v_unpinned integer;
BEGIN
    BEGIN
        INSERT INTO comms.message_reactions (message_table, message_id, user_id, emoji)
        VALUES ('comms.dm_messages', v_m1, v_c, '👀');
        INSERT INTO probe_json VALUES ('c_react_m1', '"allowed"');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO probe_json VALUES ('c_react_m1', to_jsonb(SQLSTATE));
    END;
    -- A DELETE its USING clause hides from removes nothing rather than raising: count what it removed.
    BEGIN
        DELETE FROM comms.message_pins WHERE message_table = 'comms.dm_messages' AND message_id = v_m1;
        GET DIAGNOSTICS v_unpinned = ROW_COUNT;
        INSERT INTO probe_json VALUES ('c_unpin_m1', to_jsonb(v_unpinned));
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO probe_json VALUES ('c_unpin_m1', to_jsonb(SQLSTATE));
    END;
    BEGIN
        INSERT INTO comms.message_favorites (user_id, message_table, message_id)
        VALUES (v_c, 'comms.dm_messages', v_m1);
        INSERT INTO probe_json VALUES ('c_favorite_m1', '"allowed"');
    EXCEPTION WHEN OTHERS THEN
        INSERT INTO probe_json VALUES ('c_favorite_m1', to_jsonb(SQLSTATE));
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 4. B writes after C joined, replying to the founders' first message
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.b'), 'role', 'authenticated')::text, true);
WITH m AS (
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, reply_to_id, has_attachments)
    VALUES (current_setting('probe.g')::uuid, current_setting('probe.b')::uuid,
            'probe: welcome C, here is the brief', current_setting('probe.m1')::uuid, true)
    RETURNING id
)
SELECT set_config('probe.m3', m.id::text, true) FROM m;
RESET ROLE;

-- B's file on the welcome, written at the same instant (as postgres).
DO $$
DECLARE
    v_g uuid := current_setting('probe.g')::uuid;
    v_b uuid := current_setting('probe.b')::uuid;
    v_m3 uuid := current_setting('probe.m3')::uuid;
    v_f2 uuid;
BEGIN
    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type,
                             size_bytes, status)
    VALUES (v_b, 'personal', format('users/%s/probe/brief.txt', v_b), 'brief.txt', 'brief.txt', 'text/plain',
            1, 'uploaded')
    RETURNING id INTO v_f2;
    INSERT INTO comms.message_attachments (message_table, message_id, attachment_id)
    VALUES ('comms.dm_messages', v_m3, v_f2);
    INSERT INTO comms.channel_files (channel_type, channel_id, attachment_id) VALUES ('dm', v_g, v_f2);
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('messages', format('%s/%s/brief.txt', v_g, v_m3), v_b);
    PERFORM set_config('probe.f2', v_f2::text, true);
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.c'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'c_after', pg_temp.probe_view();
-- The reply C reads quotes m1; the quote's original is read like any message, so it is unavailable to C.
INSERT INTO probe_json SELECT 'c_reply_original', jsonb_build_object(
    'reply_to', (SELECT m.reply_to_id FROM comms.dm_messages m WHERE m.id = current_setting('probe.m3')::uuid),
    'original', (SELECT count(*) FROM comms.dm_messages o
                  WHERE o.thread_id = current_setting('probe.g')::uuid
                    AND o.id = (SELECT m.reply_to_id FROM comms.dm_messages m
                                 WHERE m.id = current_setting('probe.m3')::uuid)));
DO $$
BEGIN
    INSERT INTO comms.message_reactions (message_table, message_id, user_id, emoji)
    VALUES ('comms.dm_messages', current_setting('probe.m3')::uuid, current_setting('probe.c')::uuid, '🙌');
    INSERT INTO probe_json VALUES ('c_react_m3', '"allowed"');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO probe_json VALUES ('c_react_m3', to_jsonb(SQLSTATE));
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.b'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'b_after', pg_temp.probe_view();
RESET ROLE;

DO $$
DECLARE
    v_add jsonb := (SELECT v FROM probe_json WHERE k = 'add_c');
    v_c0 jsonb := (SELECT v FROM probe_json WHERE k = 'c_before');
    v_c1 jsonb := (SELECT v FROM probe_json WHERE k = 'c_after');
    v_b1 jsonb := (SELECT v FROM probe_json WHERE k = 'b_after');
    v_reply jsonb := (SELECT v FROM probe_json WHERE k = 'c_reply_original');
    v_m3 text := current_setting('probe.m3');
    v_f text := current_setting('probe.f');
    v_f2 text := current_setting('probe.f2');
    v_fail text[] := '{}';
BEGIN
    IF (v_add ->> 'added')::integer IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'FAIL A could not add C to the group (answered %)', v_add;
    END IF;

    -- C, just added, before anyone writes again.
    IF (v_c0 ->> 'thread')::integer <> 1 THEN
        v_fail := array_append(v_fail, 'C, added to the group, cannot see the group itself');
    END IF;
    IF (v_c0 ->> 'messages')::integer <> 0 THEN
        v_fail := array_append(v_fail, format('C reads %s messages written before they joined', v_c0 ->> 'messages'));
    END IF;
    IF v_c0 -> 'tail1' <> '[]'::jsonb OR v_c0 -> 'tail20' <> '[]'::jsonb THEN
        v_fail := array_append(v_fail, format('C''s inbox preview shows a message from before they joined (k=1 %s, k=20 %s)',
            v_c0 -> 'tail1', v_c0 -> 'tail20'));
    END IF;
    IF (v_c0 ->> 'can_read_m1')::boolean THEN
        v_fail := array_append(v_fail, 'comms.can_read_message lets C read the founders'' first message');
    END IF;
    IF (v_c0 ->> 'reactions_m1')::integer <> 0 OR (v_c0 ->> 'pins_m1')::integer <> 0 THEN
        v_fail := array_append(v_fail, format('C sees the reactions (%s) and pins (%s) on a message from before they joined',
            v_c0 ->> 'reactions_m1', v_c0 ->> 'pins_m1'));
    END IF;
    IF v_c0 -> 'attachments' <> '[]'::jsonb THEN
        v_fail := array_append(v_fail, format('C sees the attachment rows of a message from before they joined (%s)', v_c0 -> 'attachments'));
    END IF;
    IF (v_c0 ->> 'channel_files')::integer <> 0 THEN
        v_fail := array_append(v_fail, 'the group''s Files register lists C a file shared before they joined');
    END IF;
    IF (v_c0 ->> 'file_f')::boolean THEN
        v_fail := array_append(v_fail, 'files.fn_can_read lets C open a file sent before they joined');
    END IF;
    IF (v_c0 ->> 'objects')::integer <> 0 THEN
        v_fail := array_append(v_fail, 'C reads the bytes of an attachment sent before they joined (messages bucket)');
    END IF;
    IF (SELECT v #>> '{}' FROM probe_json WHERE k = 'c_react_m1') = 'allowed' THEN
        v_fail := array_append(v_fail, 'C reacted to a message from before they joined');
    END IF;
    IF (SELECT v #>> '{}' FROM probe_json WHERE k = 'c_unpin_m1') NOT IN ('0', '42501') THEN
        v_fail := array_append(v_fail, 'C unpinned a message from before they joined');
    END IF;
    IF (SELECT v #>> '{}' FROM probe_json WHERE k = 'c_favorite_m1') = 'allowed' THEN
        v_fail := array_append(v_fail, 'C favourited a message from before they joined');
    END IF;

    -- C after B's welcome, written at the instant C joined.
    IF (v_c1 ->> 'messages')::integer <> 1 OR (v_c1 ->> 'pre_join')::integer <> 0 THEN
        v_fail := array_append(v_fail, format('after the welcome C reads %s messages (%s from before joining); wanted the welcome alone',
            v_c1 ->> 'messages', v_c1 ->> 'pre_join'));
    END IF;
    IF v_c1 -> 'tail1' <> jsonb_build_array(v_m3) OR v_c1 -> 'tail20' <> jsonb_build_array(v_m3) THEN
        v_fail := array_append(v_fail, format('C''s inbox preview is not the welcome alone (k=1 %s, k=20 %s)',
            v_c1 -> 'tail1', v_c1 -> 'tail20'));
    END IF;
    IF NOT (v_c1 ->> 'can_read_m3')::boolean THEN
        v_fail := array_append(v_fail, 'a message written the instant C joined is not C''s to read');
    END IF;
    IF v_c1 -> 'attachments' <> jsonb_build_array(v_f2) OR NOT (v_c1 ->> 'file_f2')::boolean
       OR (v_c1 ->> 'file_f')::boolean THEN
        v_fail := array_append(v_fail, format('C''s attachments are not the welcome''s file alone (rows %s, welcome file %s, founders'' file %s)',
            v_c1 -> 'attachments', v_c1 ->> 'file_f2', v_c1 ->> 'file_f'));
    END IF;
    IF (v_c1 ->> 'channel_files')::integer <> 1 OR (v_c1 ->> 'objects')::integer <> 1 THEN
        v_fail := array_append(v_fail, format('C''s Files register (%s) and messages-bucket objects (%s) are not the welcome''s one file',
            v_c1 ->> 'channel_files', v_c1 ->> 'objects'));
    END IF;
    IF v_reply ->> 'reply_to' IS DISTINCT FROM current_setting('probe.m1') OR (v_reply ->> 'original')::integer <> 0 THEN
        v_fail := array_append(v_fail, format('the welcome''s quoted original (from before C joined) reads to C (%s)', v_reply));
    END IF;
    IF (SELECT v #>> '{}' FROM probe_json WHERE k = 'c_react_m3') IS DISTINCT FROM 'allowed' THEN
        v_fail := array_append(v_fail, format('C cannot react to the welcome (%s)',
            (SELECT v FROM probe_json WHERE k = 'c_react_m3')));
    END IF;

    -- B, a founder, keeps everything.
    IF (v_b1 ->> 'messages')::integer <> 3 OR NOT (v_b1 ->> 'can_read_m1')::boolean
       OR (v_b1 ->> 'reactions_m1')::integer <> 1 OR (v_b1 ->> 'pins_m1')::integer <> 1
       OR jsonb_array_length(v_b1 -> 'attachments') <> 2 OR (v_b1 ->> 'channel_files')::integer <> 2
       OR NOT (v_b1 ->> 'file_f')::boolean OR NOT (v_b1 ->> 'file_f2')::boolean
       OR (v_b1 ->> 'objects')::integer <> 2 THEN
        v_fail := array_append(v_fail, format('B, a founder, lost some of the group''s history: %s', v_b1));
    END IF;
    IF jsonb_array_length(v_b1 -> 'tail20') <> 3 OR v_b1 -> 'tail1' <> jsonb_build_array(v_m3) THEN
        v_fail := array_append(v_fail, format('B''s inbox preview is not the group''s whole tail (k=1 %s, k=20 %s)',
            v_b1 -> 'tail1', v_b1 -> 'tail20'));
    END IF;

    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, E'\n  FAIL ');
    END IF;
    RAISE NOTICE 'PASS C, added to a group, sees the group but none of the messages written before they joined';
    RAISE NOTICE 'PASS no preview, reaction, pin, attachment row, Files entry, file or stored object from before C joined reads to C';
    RAISE NOTICE 'PASS C cannot react to, unpin or favourite a message from before they joined';
    RAISE NOTICE 'PASS a message written the instant C joined is C''s, with its file; its quoted original is not';
    RAISE NOTICE 'PASS B, a founder, keeps the whole history';
END $$;
-- #endregion

-- #region 5. A member who deleted the group for themselves and is added back keeps their own history
UPDATE comms.dm_participants SET deleted_at = now()
 WHERE thread_id = current_setting('probe.g')::uuid AND user_id = current_setting('probe.b')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'restore_b', jsonb_build_object('added',
    comms.add_dm_thread_members(current_setting('probe.g')::uuid, ARRAY[current_setting('probe.b')::uuid]));
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.b'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'b_restored', jsonb_build_object('messages',
    (SELECT count(*) FROM comms.dm_messages m WHERE m.thread_id = current_setting('probe.g')::uuid));
RESET ROLE;

DO $$
BEGIN
    IF (SELECT (v ->> 'added')::integer FROM probe_json WHERE k = 'restore_b') <> 1
       OR (SELECT (v ->> 'messages')::integer FROM probe_json WHERE k = 'b_restored') <> 3 THEN
        RAISE EXCEPTION 'FAIL B, restored to the group, does not read its whole history (%, %)',
            (SELECT v FROM probe_json WHERE k = 'restore_b'), (SELECT v FROM probe_json WHERE k = 'b_restored');
    END IF;
    RAISE NOTICE 'PASS a founder restored to the group reads it from their first joining, not from the restore';
END $$;
-- #endregion

-- #region 6. A DM that C's arrival turns into a group: its pair keep their history, C reads from joining
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
SELECT set_config('probe.dm',
    (comms.get_or_create_dm_thread(current_setting('probe.d')::uuid) ->> 'thread_id'), true);
RESET ROLE;

DO $$
DECLARE
    v_dm uuid := current_setting('probe.dm')::uuid;
BEGIN
    UPDATE comms.dm_threads SET created_at = now() - interval '3 hours' WHERE id = v_dm;
    UPDATE comms.dm_participants SET joined_at = now() - interval '3 hours' WHERE thread_id = v_dm;
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, created_at)
    VALUES (v_dm, current_setting('probe.a')::uuid, 'probe: just between A and D', now() - interval '150 minutes'),
           (v_dm, current_setting('probe.d')::uuid, 'probe: noted, just us', now() - interval '140 minutes');
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.a'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'dm_widen', jsonb_build_object('added',
    comms.add_dm_thread_members(current_setting('probe.dm')::uuid, ARRAY[current_setting('probe.c')::uuid]));
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.c'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'dm_c', jsonb_build_object(
    'messages', (SELECT count(*) FROM comms.dm_messages m WHERE m.thread_id = current_setting('probe.dm')::uuid),
    'tail', (SELECT count(*) FROM comms.inbox_tails(ARRAY[current_setting('probe.dm')::uuid], 1)));
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.d'), 'role', 'authenticated')::text, true);
INSERT INTO probe_json SELECT 'dm_d', jsonb_build_object(
    'messages', (SELECT count(*) FROM comms.dm_messages m WHERE m.thread_id = current_setting('probe.dm')::uuid),
    'tail', (SELECT count(*) FROM comms.inbox_tails(ARRAY[current_setting('probe.dm')::uuid], 1)));
RESET ROLE;

DO $$
DECLARE
    v_c jsonb := (SELECT v FROM probe_json WHERE k = 'dm_c');
    v_d jsonb := (SELECT v FROM probe_json WHERE k = 'dm_d');
BEGIN
    IF (SELECT (v ->> 'added')::integer FROM probe_json WHERE k = 'dm_widen') <> 1
       OR (SELECT t.kind FROM comms.dm_threads t WHERE t.id = current_setting('probe.dm')::uuid) <> 'group' THEN
        RAISE EXCEPTION 'FAIL A''s DM with D did not become a group when A added C';
    END IF;
    IF (v_c ->> 'messages')::integer <> 0 OR (v_c ->> 'tail')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL C, whose arrival made A and D''s DM a group, reads its earlier messages (%)', v_c;
    END IF;
    IF (v_d ->> 'messages')::integer <> 2 OR (v_d ->> 'tail')::integer <> 1 THEN
        RAISE EXCEPTION 'FAIL D lost their DM''s history when it became a group (%)', v_d;
    END IF;
    RAISE NOTICE 'PASS a DM that becomes a group keeps its pair''s history; the newcomer reads from joining';
END $$;
-- #endregion

ROLLBACK;
