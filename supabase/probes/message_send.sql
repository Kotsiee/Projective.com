-- =============================================================================================
-- Probe: a message and its files are one write, and a voice memo keeps its facts (CAS M15, M18;
-- PROJECTS CH4). comms.send_message (00001300) writes the message, every comms.message_attachments
-- link and every comms.channel_files row in one transaction, as the caller; the memo's duration and
-- waveform land on its own link row (00000016), one memo per message (00004006).
--
-- THE DEFECT (2026-11-24): the send door wrote the message, then its links, then its channel files,
-- as three PostgREST calls, and never read the answer of the second or third. A link the database
-- refused left a delivered message with nothing attached, reported as sent. A memo stored only
-- `is_audio`, so after a reload it was a bare file tile with no duration and no waveform.
--
-- What is asserted, as `authenticated` under each person's JWT unless named:
--   1. A room send with a copy and a link writes one message, both links in attach order and both
--      channel files.
--   2. A room send that names a file the sender cannot read raises PA422 with the send door's
--      sentence, and nothing of it is left: no message, no link, no channel file.
--   3. A DM voice memo lands with is_audio and its duration and waveform on its own link row, and the
--      other participant reads them.
--   4. A malformed memo is refused 22023 before anything is written (not one of the uploads, only a
--      link, over 512 samples, a sample out of 0..1 or not a number, a fractional or negative length,
--      no attachment id).
--   5. The table refuses what the function would never write: a second memo on a message, facts on a
--      link row, half a pair, an envelope out of bounds; and nobody rewrites the facts.
--   6. The function adds no authority: an outsider cannot post into the thread or the room through it.
--   7. EXECUTE is granted to authenticated and not to anon.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/message_send.sql
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON probe_ids TO authenticated;

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM pg_temp.probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Act as p_uid in a fresh request.
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid::text, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Run one statement; 'ok', or the SQLSTATE and message it raised. A raise rolls back only the
-- statement (the EXCEPTION block is a subtransaction), which is what a refused send must leave.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- comms.send_message as the acting caller, returning the new id (NULL when it raised).
CREATE FUNCTION pg_temp.send(
    p_kind text, p_target uuid, p_body text, p_copies uuid[], p_links uuid[], p_audio jsonb
) RETURNS uuid LANGUAGE sql AS $$
    SELECT comms.send_message(p_kind, p_target, p_body, NULL, NULL, NULL, p_copies, p_links, p_audio);
$$;

-- The same call as text for pg_temp.try.
CREATE FUNCTION pg_temp.send_sql(
    p_kind text, p_target uuid, p_body text, p_copies uuid[], p_links uuid[], p_audio jsonb
) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.format(
        'SELECT comms.send_message(%L, %L::uuid, %L, NULL, NULL, NULL, %L::uuid[], %L::uuid[], %L::jsonb)',
        p_kind, p_target, p_body, p_copies, p_links, p_audio);
$$;

-- What a send with body p_body left behind, counted as postgres (RLS off): messages in both tables,
-- their links and the channel files of their files.
CREATE FUNCTION pg_temp.left_by(p_body text) RETURNS integer LANGUAGE sql AS $$
    SELECT (SELECT count(*) FROM comms.project_messages WHERE body = p_body)::integer
         + (SELECT count(*) FROM comms.dm_messages WHERE body = p_body)::integer
         + (SELECT count(*) FROM comms.message_attachments a
             WHERE a.message_id IN (SELECT id FROM comms.project_messages WHERE body = p_body
                                    UNION ALL SELECT id FROM comms.dm_messages WHERE body = p_body))::integer;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.id(text), pg_temp.ok(boolean, text), pg_temp.act(uuid),
    pg_temp.try(text), pg_temp.send(text, uuid, text, uuid[], uuid[], jsonb),
    pg_temp.send_sql(text, uuid, text, uuid[], uuid[], jsonb), pg_temp.left_by(text) TO authenticated;
-- #endregion

-- #region 1. Fixtures (as postgres)
-- A live project room its owner can post in; a two-person DM; an outsider to both; four files: two
-- the room's owner uploaded, a memo the DM's sender recorded, and the outsider's own private file.
DO $$
DECLARE
    c record;
    v_thread uuid;
    v_sender uuid;
    v_reader uuid;
    v_outsider uuid;
BEGIN
    FOR c IN
        SELECT ch.id AS room, p.owner_user_id AS owner
          FROM comms.project_channels ch
          JOIN projects.projects p ON p.id = ch.project_id
         WHERE ch.archived_at IS NULL
         ORDER BY ch.created_at, ch.id
    LOOP
        PERFORM pg_temp.act(c.owner);
        CONTINUE WHEN NOT comms.has_channel_access(c.room);
        INSERT INTO probe_ids VALUES ('room', c.room), ('owner', c.owner);
        EXIT;
    END LOOP;
    IF pg_temp.id('room') IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: no live project room its owner can post in (deno task db:reset)';
    END IF;

    SELECT p.thread_id INTO v_thread
      FROM comms.dm_participants p JOIN comms.dm_threads t ON t.id = p.thread_id
     WHERE t.kind = 'dm' AND t.archived_at IS NULL
     GROUP BY p.thread_id HAVING count(*) = 2 ORDER BY p.thread_id LIMIT 1;
    IF v_thread IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: no live two-person DM (deno task db:reset)';
    END IF;
    SELECT min(p.user_id::text)::uuid, max(p.user_id::text)::uuid INTO v_sender, v_reader
      FROM comms.dm_participants p WHERE p.thread_id = v_thread;

    PERFORM pg_temp.act(v_sender);
    SELECT u.user_id INTO v_outsider FROM org.users_public u
     WHERE u.user_id NOT IN (SELECT p.user_id FROM comms.dm_participants p WHERE p.thread_id = v_thread)
       AND u.user_id <> pg_temp.id('owner')
     ORDER BY u.user_id LIMIT 1;
    IF v_outsider IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: no fixture: no third user'; END IF;
    PERFORM pg_temp.act(v_outsider);
    IF comms.has_channel_access(pg_temp.id('room')) THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: the outsider can already post in the room';
    END IF;

    INSERT INTO probe_ids VALUES ('thread', v_thread), ('sender', v_sender), ('reader', v_reader),
        ('outsider', v_outsider), ('brief', gen_random_uuid()), ('board', gen_random_uuid()),
        ('memo', gen_random_uuid()), ('foreign', gen_random_uuid());

    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, visibility, source, owner_type)
    VALUES
        (pg_temp.id('brief'), pg_temp.id('owner'), 'personal', pg_temp.id('owner') || '/probe-ch4-brief.pdf',
         'probe-ch4-brief.pdf', 'probe-ch4-brief.pdf', 'application/pdf', 1024, 'uploaded', 'private',
         'supabase', 'user'),
        (pg_temp.id('board'), pg_temp.id('owner'), 'personal', pg_temp.id('owner') || '/probe-ch4-board.png',
         'probe-ch4-board.png', 'probe-ch4-board.png', 'image/png', 2048, 'uploaded', 'restricted',
         'supabase', 'user'),
        (pg_temp.id('memo'), v_sender, 'personal', v_sender || '/voice-message-probe-ch4.webm',
         'voice-message-probe-ch4.webm', 'voice-message-probe-ch4.webm', 'audio/webm', 4096, 'uploaded',
         'private', 'supabase', 'user'),
        (pg_temp.id('foreign'), v_outsider, 'personal', v_outsider || '/probe-ch4-foreign.pdf',
         'probe-ch4-foreign.pdf', 'probe-ch4-foreign.pdf', 'application/pdf', 1024, 'uploaded', 'private',
         'supabase', 'user');

    RAISE NOTICE 'fixture room=% owner=% thread=% sender=% reader=% outsider=%',
        pg_temp.id('room'), pg_temp.id('owner'), v_thread, v_sender, v_reader, v_outsider;
END $$;
-- #endregion

-- #region 2. A room send with a copy and a link is one message, both links, both channel files
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.id('owner'));
DO $$
DECLARE
    v_id uuid := pg_temp.send('room', pg_temp.id('room'), 'probe-ch4 room files',
                              ARRAY[pg_temp.id('brief')], ARRAY[pg_temp.id('board')], NULL);
    v_files uuid[];
    v_modes text[];
BEGIN
    PERFORM pg_temp.ok(v_id IS NOT NULL, '2 the room send returns the new message id');
    INSERT INTO probe_ids VALUES ('room_msg', v_id);
    PERFORM pg_temp.ok(
        (SELECT has_attachments AND NOT is_audio AND sender_user_id = auth.uid()
           FROM comms.project_messages WHERE id = v_id),
        '2 the message is the caller''s, with files and no memo');
    SELECT array_agg(a.attachment_id ORDER BY a.created_at, a.id), array_agg(a.mode::text ORDER BY a.created_at, a.id)
      INTO v_files, v_modes
      FROM comms.message_attachments a
     WHERE a.message_table = 'comms.project_messages' AND a.message_id = v_id;
    PERFORM pg_temp.ok(v_files = ARRAY[pg_temp.id('brief'), pg_temp.id('board')]
                       AND v_modes = ARRAY['copy', 'link'],
        '2 both links landed, the copy then the link, in the order attached');
    PERFORM pg_temp.ok(
        (SELECT count(*) FROM comms.channel_files f
          WHERE f.channel_type = 'project' AND f.channel_id = pg_temp.id('room')
            AND f.attachment_id IN (pg_temp.id('brief'), pg_temp.id('board'))) = 2,
        '2 both files are in the room''s Files register');
END $$;
-- #endregion

-- #region 3. A file the sender cannot read fails the whole send
SELECT pg_temp.ok(
    pg_temp.try(pg_temp.send_sql('room', pg_temp.id('room'), 'probe-ch4 refused file',
        ARRAY[pg_temp.id('brief'), pg_temp.id('foreign')], '{}', NULL))
        LIKE 'PA422 A file could not be attached to this message, so nothing was sent.%',
    '3 a send naming somebody else''s private file is refused PA422 in the send door''s words');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.left_by('probe-ch4 refused file') = 0,
    '3 and nothing of it is left: no message, no link');
SELECT pg_temp.ok(
    (SELECT count(*) FROM comms.channel_files f
      WHERE f.channel_type = 'project' AND f.channel_id = pg_temp.id('room')
        AND f.attachment_id = pg_temp.id('brief')) = 1,
    '3 and no second channel file for the file that would have linked');
-- #endregion

-- #region 4. A DM voice memo keeps its duration and waveform, and the other participant reads them
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.id('sender'));
DO $$
DECLARE
    v_id uuid := pg_temp.send('dm', pg_temp.id('thread'), 'probe-ch4 memo', ARRAY[pg_temp.id('memo')], '{}',
        jsonb_build_object('attachmentId', pg_temp.id('memo'), 'durationMs', 42000,
                           'peaks', jsonb_build_array(0.125, 0.5, 0.875, 0)));
BEGIN
    PERFORM pg_temp.ok(v_id IS NOT NULL, '4 the memo send returns the new message id');
    INSERT INTO probe_ids VALUES ('memo_msg', v_id);
    PERFORM pg_temp.ok((SELECT is_audio AND has_attachments FROM comms.dm_messages WHERE id = v_id),
        '4 the DM is marked as a voice memo with a file');
    PERFORM pg_temp.ok(
        (SELECT a.audio_duration_ms = 42000 AND a.audio_peaks = ARRAY[0.125, 0.5, 0.875, 0]::real[]
           FROM comms.message_attachments a
          WHERE a.message_table = 'comms.dm_messages' AND a.message_id = v_id
            AND a.attachment_id = pg_temp.id('memo')),
        '4 the memo''s link row holds its duration and waveform');
END $$;

SELECT pg_temp.act(pg_temp.id('reader'));
SELECT pg_temp.ok(
    (SELECT a.audio_duration_ms = 42000 AND cardinality(a.audio_peaks) = 4
       FROM comms.message_attachments a
      WHERE a.message_table = 'comms.dm_messages' AND a.message_id = pg_temp.id('memo_msg')),
    '4 the other participant reads the memo''s facts');
-- #endregion

-- #region 5. A malformed memo is refused before anything is written
SELECT pg_temp.act(pg_temp.id('sender'));
DO $$
DECLARE
    v_memo uuid := pg_temp.id('memo');
    v_case record;
BEGIN
    FOR v_case IN
        SELECT * FROM (VALUES
            ('not one of the uploads', '{}'::uuid[], ARRAY[v_memo],
             jsonb_build_object('attachmentId', v_memo, 'durationMs', 1000, 'peaks', '[0.5]'::jsonb)),
            ('no attachment id', ARRAY[v_memo], '{}'::uuid[],
             jsonb_build_object('durationMs', 1000, 'peaks', '[0.5]'::jsonb)),
            ('over 512 samples', ARRAY[v_memo], '{}'::uuid[],
             jsonb_build_object('attachmentId', v_memo, 'durationMs', 1000,
                                'peaks', (SELECT jsonb_agg(0.5) FROM generate_series(1, 513)))),
            ('a sample above 1', ARRAY[v_memo], '{}'::uuid[],
             jsonb_build_object('attachmentId', v_memo, 'durationMs', 1000, 'peaks', '[0.5, 1.5]'::jsonb)),
            ('a sample that is not a number', ARRAY[v_memo], '{}'::uuid[],
             jsonb_build_object('attachmentId', v_memo, 'durationMs', 1000, 'peaks', '[0.5, "loud"]'::jsonb)),
            ('a negative length', ARRAY[v_memo], '{}'::uuid[],
             jsonb_build_object('attachmentId', v_memo, 'durationMs', -1, 'peaks', '[0.5]'::jsonb)),
            ('a fractional length', ARRAY[v_memo], '{}'::uuid[],
             jsonb_build_object('attachmentId', v_memo, 'durationMs', 10.5, 'peaks', '[0.5]'::jsonb))
        ) AS t(label, copies, links, audio)
    LOOP
        PERFORM pg_temp.ok(
            pg_temp.try(pg_temp.send_sql('dm', pg_temp.id('thread'), 'probe-ch4 bad memo', v_case.copies,
                                         v_case.links, v_case.audio)) LIKE '22023 audio: %',
            '5 a memo with ' || v_case.label || ' is refused 22023');
    END LOOP;
END $$;
RESET ROLE;
SELECT pg_temp.ok(pg_temp.left_by('probe-ch4 bad memo') = 0, '5 and no refused memo left a message or a link');
-- #endregion

-- #region 6. The table refuses what the function never writes, and nobody rewrites the facts
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(pg_temp.id('sender'));
SELECT pg_temp.ok(
    pg_temp.try(pg_catalog.format(
        'INSERT INTO comms.message_attachments (message_table, message_id, attachment_id, mode, audio_duration_ms, audio_peaks) '
        || 'VALUES (%L, %L::uuid, %L::uuid, %L, 1000, %L::real[])',
        'comms.dm_messages', pg_temp.id('memo_msg'), pg_temp.id('memo'), 'copy', '{0.5}'))
        LIKE '23505 %',
    '6 a second memo on one message is refused 23505');
SELECT pg_temp.ok(
    pg_temp.try(pg_catalog.format(
        'INSERT INTO comms.message_attachments (message_table, message_id, attachment_id, mode, audio_duration_ms, audio_peaks) '
        || 'VALUES (%L, %L::uuid, %L::uuid, %L, 1000, %L::real[])',
        'comms.dm_messages', pg_temp.id('memo_msg'), pg_temp.id('memo'), 'link', '{0.5}'))
        LIKE '23514 %',
    '6 memo facts on a link row are refused 23514');
SELECT pg_temp.ok(
    pg_temp.try(pg_catalog.format(
        'INSERT INTO comms.message_attachments (message_table, message_id, attachment_id, mode, audio_duration_ms) '
        || 'VALUES (%L, %L::uuid, %L::uuid, %L, 1000)',
        'comms.dm_messages', pg_temp.id('memo_msg'), pg_temp.id('memo'), 'copy'))
        LIKE '23514 %',
    '6 a duration without a waveform is refused 23514');
SELECT pg_temp.ok(
    pg_temp.try(pg_catalog.format(
        'INSERT INTO comms.message_attachments (message_table, message_id, attachment_id, mode, audio_duration_ms, audio_peaks) '
        || 'VALUES (%L, %L::uuid, %L::uuid, %L, 1000, %L::real[])',
        'comms.dm_messages', pg_temp.id('memo_msg'), pg_temp.id('memo'), 'copy', '{0.5,2}'))
        LIKE '23514 %',
    '6 a sample above 1 is refused 23514 by the table too');
DO $$
DECLARE v_rows integer;
BEGIN
    UPDATE comms.message_attachments SET audio_peaks = '{1}'::real[], audio_duration_ms = 1
     WHERE message_id = pg_temp.id('memo_msg');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM pg_temp.ok(v_rows = 0, '6 the sender cannot rewrite a memo''s facts');
END $$;
-- #endregion

-- #region 7. No new authority: an outsider cannot post through the function
SELECT pg_temp.act(pg_temp.id('outsider'));
SELECT pg_temp.ok(
    pg_temp.try(pg_temp.send_sql('dm', pg_temp.id('thread'), 'probe-ch4 outsider', '{}', '{}', NULL))
        LIKE '42501 %',
    '7 an outsider cannot post into the thread (42501)');
SELECT pg_temp.ok(
    pg_temp.try(pg_temp.send_sql('room', pg_temp.id('room'), 'probe-ch4 outsider', '{}', '{}', NULL))
        LIKE '42501 %',
    '7 an outsider cannot post into the room (42501)');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.left_by('probe-ch4 outsider') = 0, '7 and nothing was written');
-- #endregion

-- #region 8. EXECUTE
SELECT pg_temp.ok(
    has_function_privilege('authenticated',
        'comms.send_message(text, uuid, text, jsonb, uuid, uuid, uuid[], uuid[], jsonb)', 'EXECUTE'),
    '8 authenticated may call comms.send_message');
SELECT pg_temp.ok(
    NOT has_function_privilege('anon',
        'comms.send_message(text, uuid, text, jsonb, uuid, uuid, uuid[], uuid[], jsonb)', 'EXECUTE'),
    '8 anon may not');
-- #endregion

ROLLBACK;
