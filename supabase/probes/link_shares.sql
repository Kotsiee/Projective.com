-- =============================================================================================
-- Probe: link shares (Decision #401). A `link`-mode comms.message_attachments row lets the
-- message's readers open the sender's file only while it is not `private`: the owner raises it to
-- `restricted` to share it and sets it back to `private` to take every link share away, while a
-- `copy` row keeps granting. Nobody can rewrite a stored mode, an outsider never reads, and a folder
-- is never `restricted`.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/link_shares.sql
--
-- A clean run prints only PASS notices; any gap raises `FAIL …` and aborts.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_thread uuid;
    v_sender uuid;
    v_reader uuid;
    v_outsider uuid;
    v_item uuid := gen_random_uuid();
BEGIN
    SELECT p.thread_id INTO v_thread
    FROM comms.dm_participants p JOIN comms.dm_threads t ON t.id = p.thread_id
    WHERE t.kind = 'dm' GROUP BY p.thread_id HAVING count(*) = 2 ORDER BY p.thread_id LIMIT 1;
    IF v_thread IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no two-person DM (deno task db:reset)'; END IF;

    SELECT min(p.user_id::text)::uuid, max(p.user_id::text)::uuid INTO v_sender, v_reader
    FROM comms.dm_participants p WHERE p.thread_id = v_thread;

    SELECT u.user_id INTO v_outsider FROM org.users_public u
    WHERE u.user_id NOT IN (SELECT p.user_id FROM comms.dm_participants p WHERE p.thread_id = v_thread)
    ORDER BY u.user_id LIMIT 1;
    IF v_outsider IS NULL THEN RAISE EXCEPTION 'FAIL no fixture: no third user'; END IF;

    INSERT INTO files.items (id, owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, visibility, source, owner_type)
    VALUES (v_item, v_sender, 'personal', v_sender || '/probe-link-share.pdf', 'probe-link-share.pdf',
            'probe-link-share.pdf', 'application/pdf', 1024, 'uploaded', 'private', 'supabase', 'user');

    PERFORM set_config('probe.thread', v_thread::text, true);
    PERFORM set_config('probe.sender', v_sender::text, true);
    PERFORM set_config('probe.reader', v_reader::text, true);
    PERFORM set_config('probe.outsider', v_outsider::text, true);
    PERFORM set_config('probe.item', v_item::text, true);
END $$;

CREATE TEMP TABLE probe_msg (id uuid) ON COMMIT DROP;
GRANT ALL ON probe_msg TO authenticated;
-- #endregion

-- #region 1. The sender posts a message and shares the file in it as a LINK
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.sender'), 'role', 'authenticated')::text, true);

WITH m AS (
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES (current_setting('probe.thread')::uuid, current_setting('probe.sender')::uuid, '')
    RETURNING id
)
INSERT INTO probe_msg SELECT id FROM m;

INSERT INTO comms.message_attachments (message_table, message_id, attachment_id, mode)
SELECT 'comms.dm_messages', id, current_setting('probe.item')::uuid, 'link' FROM probe_msg;
-- #endregion

-- #region 2. A private file's link share opens for nobody else
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.reader'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_item uuid := current_setting('probe.item')::uuid;
    v_rows integer;
BEGIN
    IF files.fn_can_read(v_item) THEN RAISE EXCEPTION 'FAIL a private file opened through a link share'; END IF;
    RAISE NOTICE 'PASS a private file''s link share does not open';

    UPDATE comms.message_attachments SET mode = 'copy' WHERE attachment_id = v_item;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL a reader rewrote a link share into a copy'; END IF;
    RAISE NOTICE 'PASS a stored mode cannot be rewritten';
END $$;
-- #endregion

-- #region 3. Restricted: the readers open it, an outsider does not
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.sender'), 'role', 'authenticated')::text, true);

DO $$
DECLARE v_rows integer;
BEGIN
    UPDATE files.items SET visibility = 'restricted'
    WHERE id = current_setting('probe.item')::uuid AND visibility = 'private';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'FAIL the owner could not raise the file to restricted'; END IF;
    RAISE NOTICE 'PASS the owner raises the file to restricted';
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.reader'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF NOT files.fn_can_read(current_setting('probe.item')::uuid) THEN
        RAISE EXCEPTION 'FAIL the message''s reader cannot open a restricted link share';
    END IF;
    RAISE NOTICE 'PASS the message''s reader opens a restricted link share';
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.outsider'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF files.fn_can_read(current_setting('probe.item')::uuid) THEN
        RAISE EXCEPTION 'FAIL an outsider opened a restricted file';
    END IF;
    RAISE NOTICE 'PASS an outsider does not open a restricted file';
END $$;
-- #endregion

-- #region 4. Back to private takes the link share away; a copy keeps granting
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.sender'), 'role', 'authenticated')::text, true);
UPDATE files.items SET visibility = 'private' WHERE id = current_setting('probe.item')::uuid;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.reader'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF files.fn_can_read(current_setting('probe.item')::uuid) THEN
        RAISE EXCEPTION 'FAIL a link share still opened after the file went back to private';
    END IF;
    RAISE NOTICE 'PASS setting the file back to private takes the link share away';
END $$;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.sender'), 'role', 'authenticated')::text, true);
INSERT INTO comms.message_attachments (message_table, message_id, attachment_id)
SELECT 'comms.dm_messages', id, current_setting('probe.item')::uuid FROM probe_msg;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.reader'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    IF NOT files.fn_can_read(current_setting('probe.item')::uuid) THEN
        RAISE EXCEPTION 'FAIL a copy stopped granting when the file is private';
    END IF;
    RAISE NOTICE 'PASS a copy keeps granting while the file is private';
END $$;
-- #endregion

-- #region 5. A folder is never restricted
RESET ROLE;
DO $$
BEGIN
    BEGIN
        INSERT INTO files.folders (owner_user_id, name, visibility)
        VALUES (current_setting('probe.sender')::uuid, 'probe-link-share', 'restricted');
        RAISE EXCEPTION 'FAIL a folder was stored as restricted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a folder is refused restricted [%]', SQLERRM;
    END;
END $$;
-- #endregion

ROLLBACK;
