-- =============================================================================================
-- Probe: a message's author edits and deletes it only through comms.edit_message and
-- comms.delete_message, every replaced text is kept, and an archived or disputed room's messages
-- cannot change (PROJECTS CH1; CAS M11; the owner's rulings 2026-11-24: an edit within the
-- `message_edit_window_minutes` dial (15) of sending, any number of times; delete for everyone at any
-- time while the room is live; the disputed stage's rooms and the project's General room freeze).
--
-- THE DEFECT (2026-11-24): no door existed. A stage room's sender could rewrite their own message with
-- a raw PostgREST UPDATE (the `edit_own_messages` policy and the body / body_delta / edited_at /
-- deleted_at column grant), at any age, in an archived room or during a dispute, and the words they
-- replaced were gone; a DM could not be edited or deleted at all.
--
-- What is asserted, as the room's or thread's people unless named:
--   1. A direct UPDATE of a message, in a room or a DM, is refused 42501: the doors are the only path.
--   2. The author edits a fresh room message, twice: the row reads the new words and `edited_at`, and
--      each replaced text is a revision (`edit`), the original first. An edit that changes nothing
--      writes nothing; an empty or over-8,000-character body is refused 22023.
--   3. Somebody else in the room is refused 42501; somebody outside it, or a message that does not
--      exist, P0002 (nothing says the message is there).
--   4. Past the window the author's edit is refused PM410; the delete still works.
--   5. A delete leaves a tombstone: `deleted_at`, an empty body, no Delta, the text kept as a `delete`
--      revision; a second delete, or an edit after it, is refused PM409.
--   6. An edit in a protected engagement is masked again, as a send is.
--   7. Revisions are evidence: a client reads none (42501), nobody rewrites or removes one, and only
--      an operator reads them through comms.get_message_revisions.
--   8. The same rules hold in a DM (`edited_at` on comms.dm_messages).
--   9. comms.message_edit_rules tells a room's reader the window and whether the room is frozen.
--  10. A live dispute on the stage freezes its room and the project's General room (PM423), and leaves
--      a DM editable; an archived room or thread is frozen too.
--  11. The Evidence Vault's manifest carries each message's revision trail (act, times, author, the
--      SHA-256 of the words) and never the words, which only operators read.
--  12. The doors are callable by `authenticated` only.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/message_edit.sql
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.u(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key)::uuid;
$$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- Runs p_sql; 'ok' when it succeeds, else its SQLSTATE and message. Every door call goes through here,
-- so the file still parses, and fails on its first assertion, against a database with no doors.
CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.edit(p_id uuid, p_body text, p_delta jsonb DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
    SELECT pg_temp.try(pg_catalog.format('SELECT comms.edit_message(%L::uuid, %L::text, %L::jsonb)',
        p_id, p_body, p_delta));
$$;

CREATE FUNCTION pg_temp.del(p_id uuid) RETURNS text LANGUAGE sql AS $$
    SELECT pg_temp.try(pg_catalog.format('SELECT comms.delete_message(%L::uuid)', p_id));
$$;

-- The SQLSTATE alone of a refusal ('ok' when the statement succeeded).
CREATE FUNCTION pg_temp.code(p_outcome text) RETURNS text LANGUAGE sql AS $$
    SELECT CASE WHEN p_outcome = 'ok' THEN 'ok' ELSE pg_catalog.split_part(p_outcome, ' ', 1) END;
$$;

-- The revisions kept for one message, read as postgres (the table has no client grant).
CREATE FUNCTION pg_temp.revisions(p_id uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
    IF pg_catalog.to_regclass('comms.message_revisions') IS NULL THEN RETURN NULL; END IF;
    EXECUTE 'SELECT count(*)::integer FROM comms.message_revisions WHERE message_id = $1' INTO v USING p_id;
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.revision(p_id uuid, p_nth integer, p_field text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
    EXECUTE pg_catalog.format(
        'SELECT %I::text FROM comms.message_revisions WHERE message_id = $1 ORDER BY revised_at, id OFFSET $2 LIMIT 1',
        p_field) INTO v USING p_id, p_nth - 1;
    RETURN v;
END $$;

-- The edit rules a reader is told for a room, or the refusal.
CREATE FUNCTION pg_temp.rules(p_room uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    EXECUTE 'SELECT comms.message_edit_rules($1)' INTO v USING p_room;
    RETURN v::text;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text), pg_temp.s(text), pg_temp.u(text), pg_temp.act(uuid),
    pg_temp.try(text), pg_temp.edit(uuid, text, jsonb), pg_temp.del(uuid), pg_temp.code(text),
    pg_temp.rules(uuid) TO authenticated;
-- #endregion

-- #region 1. Fixtures (as postgres)
-- A live stage room of a protected engagement whose stage holds escrow with no live dispute, the
-- project's General room, the project's owner (A, who reads both), somebody else who reads the stage
-- room (B), and somebody who reads neither (C). A live pair DM between two people (P1, P2) C is not in.
DO $$
DECLARE
    c record;
    v_window integer;
    v_b uuid;
    v_c uuid;
    v_u uuid;
    v_t record;
BEGIN
    v_window := COALESCE((SELECT (p.value #>> '{}')::integer FROM security.platform_params p
                           WHERE p.key = 'message_edit_window_minutes'), 15);

    FOR c IN
        SELECT r.id AS room, r.project_id AS project, r.stage_id AS stage, p.owner_user_id AS owner,
               g.id AS general, e.id AS escrow
          FROM comms.project_channels r
          JOIN projects.projects p ON p.id = r.project_id
          JOIN comms.project_channels g ON g.project_id = r.project_id AND g.stage_id IS NULL
                                       AND g.archived_at IS NULL
          JOIN LATERAL (
              SELECT e.id FROM finance.escrows e
               WHERE e.project_stage_id = r.stage_id
                 AND NOT EXISTS (SELECT 1 FROM finance.disputes d WHERE d.escrow_id = e.id
                                    AND d.status IN ('open', 'awaiting_response', 'under_review'))
               ORDER BY e.id LIMIT 1) e ON true
         WHERE r.stage_id IS NOT NULL AND r.visibility = 'stage_all' AND r.archived_at IS NULL
           AND projects.is_protected_phase(r.project_id)
           AND NOT EXISTS (
               SELECT 1 FROM finance.disputes d
                 JOIN finance.escrows de ON de.id = d.escrow_id
                 JOIN projects.project_stages ds ON ds.id = de.project_stage_id
                WHERE ds.project_id = r.project_id
                  AND d.status IN ('open', 'awaiting_response', 'under_review'))
         ORDER BY r.id
    LOOP
        PERFORM pg_temp.act(c.owner);
        CONTINUE WHEN NOT comms.has_channel_access(c.room) OR NOT comms.has_channel_access(c.general);

        v_b := NULL;
        SELECT x.uid INTO v_b FROM (
            SELECT m.sender_user_id AS uid FROM comms.project_messages m WHERE m.channel_id = c.room
            UNION
            SELECT sa.freelancer_profile_id FROM projects.stage_assignments sa
             WHERE sa.project_stage_id = c.stage AND sa.freelancer_profile_id IS NOT NULL
        ) x WHERE x.uid IS NOT NULL AND x.uid <> c.owner ORDER BY x.uid LIMIT 1;
        CONTINUE WHEN v_b IS NULL;
        PERFORM pg_temp.act(v_b);
        CONTINUE WHEN NOT comms.has_channel_access(c.room);

        v_c := NULL;
        FOR v_u IN SELECT u.user_id FROM org.users_public u WHERE u.user_id NOT IN (c.owner, v_b) ORDER BY u.user_id LOOP
            PERFORM pg_temp.act(v_u);
            IF NOT comms.has_channel_access(c.room) AND NOT comms.has_channel_access(c.general) THEN
                v_c := v_u;
                EXIT;
            END IF;
        END LOOP;
        CONTINUE WHEN v_c IS NULL;

        SELECT t.id AS thread, min(pp.user_id::text)::uuid AS p1, max(pp.user_id::text)::uuid AS p2
          INTO v_t
          FROM comms.dm_threads t
          JOIN comms.dm_participants pp ON pp.thread_id = t.id AND pp.deleted_at IS NULL
         WHERE t.kind = 'dm' AND t.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM comms.dm_participants x WHERE x.thread_id = t.id AND x.user_id = v_c)
         GROUP BY t.id HAVING count(*) = 2
         ORDER BY t.id LIMIT 1;
        CONTINUE WHEN v_t.thread IS NULL;

        PERFORM pg_catalog.set_config('probe.room', c.room::text, true);
        PERFORM pg_catalog.set_config('probe.general', c.general::text, true);
        PERFORM pg_catalog.set_config('probe.escrow', c.escrow::text, true);
        PERFORM pg_catalog.set_config('probe.a', c.owner::text, true);
        PERFORM pg_catalog.set_config('probe.b', v_b::text, true);
        PERFORM pg_catalog.set_config('probe.c', v_c::text, true);
        PERFORM pg_catalog.set_config('probe.thread', v_t.thread::text, true);
        PERFORM pg_catalog.set_config('probe.p1', v_t.p1::text, true);
        PERFORM pg_catalog.set_config('probe.p2', v_t.p2::text, true);
        PERFORM pg_catalog.set_config('probe.window', v_window::text, true);
        RAISE NOTICE 'fixture room=% general=% a=% b=% c=% thread=% window=%min',
            c.room, c.general, c.owner, v_b, v_c, v_t.thread, v_window;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'PROBE FAIL: no fixture: need a protected project with a stage room, its General room, escrow on the stage and a live pair DM (deno task db:reset)';
END $$;

-- Messages written for the probe, the fresh ones by the room's own send path (an INSERT as the
-- author); the old one as postgres, one minute past the window.
SELECT pg_temp.act(pg_temp.u('a'));
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid;
BEGIN
    INSERT INTO comms.project_messages (channel_id, sender_user_id, body)
    VALUES (pg_temp.u('room'), pg_temp.u('a'), 'Probe: the first draft') RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.m_edit', v::text, true);
    INSERT INTO comms.project_messages (channel_id, sender_user_id, body)
    VALUES (pg_temp.u('room'), pg_temp.u('a'), 'Probe: say it then take it back') RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.m_delete', v::text, true);
    INSERT INTO comms.project_messages (channel_id, sender_user_id, body)
    VALUES (pg_temp.u('room'), pg_temp.u('a'), 'Probe: written before the dispute') RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.m_frozen', v::text, true);
    INSERT INTO comms.project_messages (channel_id, sender_user_id, body)
    VALUES (pg_temp.u('general'), pg_temp.u('a'), 'Probe: a General room note') RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.g_frozen', v::text, true);
END $$;
RESET ROLE;

SELECT pg_temp.act(pg_temp.u('p1'));
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid;
BEGIN
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES (pg_temp.u('thread'), pg_temp.u('p1'), 'Probe: a DM to edit') RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.d_edit', v::text, true);
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES (pg_temp.u('thread'), pg_temp.u('p1'), 'Probe: a DM to delete') RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.d_delete', v::text, true);
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES (pg_temp.u('thread'), pg_temp.u('p1'), 'Probe: a DM during the dispute') RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.d_free', v::text, true);
END $$;
RESET ROLE;

DO $$
DECLARE v uuid;
BEGIN
    INSERT INTO comms.project_messages (channel_id, sender_user_id, body, created_at)
    VALUES (pg_temp.u('room'), pg_temp.u('a'), 'Probe: sent a while ago',
            now() - pg_catalog.make_interval(mins => pg_temp.s('window')::integer + 1))
    RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.m_old', v::text, true);
    INSERT INTO comms.project_messages (channel_id, sender_user_id, body, created_at)
    VALUES (pg_temp.u('room'), pg_temp.u('a'), 'Probe: sent a moment ago',
            now() - pg_catalog.make_interval(mins => pg_temp.s('window')::integer - 1))
    RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.m_recent', v::text, true);
END $$;
-- #endregion

-- #region 2. A direct UPDATE is refused: the doors are the only path
SELECT pg_temp.act(pg_temp.u('a'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.try(pg_catalog.format(
    'UPDATE comms.project_messages SET body = %L, edited_at = now() WHERE id = %L',
    'Probe: rewritten behind the door', pg_temp.s('m_edit')))) = '42501',
    '1 a direct UPDATE of a room message''s body by its author is refused 42501');
SELECT pg_temp.ok(pg_temp.code(pg_temp.try(pg_catalog.format(
    'UPDATE comms.project_messages SET deleted_at = now() WHERE id = %L', pg_temp.s('m_delete')))) = '42501',
    '1 a direct soft delete of a room message by its author is refused 42501');
RESET ROLE;

SELECT pg_temp.act(pg_temp.u('p1'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.try(pg_catalog.format(
    'UPDATE comms.dm_messages SET body = %L WHERE id = %L', 'Probe: rewritten', pg_temp.s('d_edit')))) = '42501',
    '1 a direct UPDATE of a DM by its author is refused 42501, not silently matched to no row');
RESET ROLE;

SELECT pg_temp.ok(
    (SELECT body FROM comms.project_messages WHERE id = pg_temp.u('m_edit')) = 'Probe: the first draft'
    AND (SELECT deleted_at FROM comms.project_messages WHERE id = pg_temp.u('m_delete')) IS NULL,
    '1 neither direct write changed anything');
-- #endregion

-- #region 3. The author edits a room message, twice
SELECT pg_temp.act(pg_temp.u('a'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.edit(pg_temp.u('m_edit'), 'Probe: the second draft') = 'ok',
    '2 the author edits a fresh room message through comms.edit_message');
SELECT pg_temp.ok(pg_temp.edit(pg_temp.u('m_edit'), 'Probe: the final draft',
    '{"ops":[{"insert":"Probe: the "},{"insert":"final","attributes":{"bold":true}},{"insert":" draft"}]}') = 'ok',
    '2 and edits it again, with formatting');
SELECT pg_temp.ok(pg_temp.edit(pg_temp.u('m_edit'), 'Probe: the final draft',
    '{"ops":[{"insert":"Probe: the "},{"insert":"final","attributes":{"bold":true}},{"insert":" draft"}]}') = 'ok',
    '2 an edit that changes nothing is accepted');
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('m_edit'), '   ')) = '22023',
    '2 an empty body is refused 22023 (delete the message instead)');
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('m_edit'), pg_catalog.repeat('x', 8001))) = '22023',
    '2 a body over 8,000 characters is refused 22023');
RESET ROLE;

SELECT pg_temp.ok(
    (SELECT body = 'Probe: the final draft' AND body_delta IS NOT NULL AND edited_at IS NOT NULL
            AND deleted_at IS NULL
       FROM comms.project_messages WHERE id = pg_temp.u('m_edit')),
    '2 the row reads the last words, their formatting and edited_at');
SELECT pg_temp.ok(pg_temp.revisions(pg_temp.u('m_edit')) = 2,
    '2 two edits kept two revisions; the no-op and the refusals kept none');
SELECT pg_temp.ok(pg_temp.revision(pg_temp.u('m_edit'), 1, 'body') = 'Probe: the first draft'
    AND pg_temp.revision(pg_temp.u('m_edit'), 2, 'body') = 'Probe: the second draft',
    '2 the original is the first revision, the replaced draft the second');
SELECT pg_temp.ok(pg_temp.revision(pg_temp.u('m_edit'), 1, 'message_table') = 'comms.project_messages'
    AND pg_temp.revision(pg_temp.u('m_edit'), 1, 'action') = 'edit'
    AND pg_temp.revision(pg_temp.u('m_edit'), 1, 'revised_by') = pg_temp.s('a'),
    '2 a revision names its table, the act and who made it');
SELECT pg_temp.ok(pg_temp.revision(pg_temp.u('m_edit'), 1, 'authored_at')::timestamptz
        = (SELECT created_at FROM comms.project_messages WHERE id = pg_temp.u('m_edit')),
    '2 the original revision is dated when it was sent');
-- #endregion

-- #region 4. The author only
SELECT pg_temp.act(pg_temp.u('b'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('m_edit'), 'Probe: words put in A''s mouth')) = '42501',
    '3 somebody else in the room cannot edit it (42501)');
SELECT pg_temp.ok(pg_temp.code(pg_temp.del(pg_temp.u('m_edit'))) = '42501',
    '3 nor delete it (42501)');
RESET ROLE;

SELECT pg_temp.act(pg_temp.u('c'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('m_edit'), 'Probe: a stranger')) = 'P0002',
    '3 somebody outside the room is told there is no such message (P0002)');
SELECT pg_temp.ok(pg_temp.code(pg_temp.del(pg_temp.u('m_edit'))) = 'P0002',
    '3 and cannot delete it (P0002)');
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(gen_random_uuid(), 'Probe: nothing')) = 'P0002',
    '3 a message that does not exist is P0002');
RESET ROLE;

SELECT pg_temp.ok(pg_temp.revisions(pg_temp.u('m_edit')) = 2, '3 the refusals kept no revision');
-- #endregion

-- #region 5. The window, and the tombstone
SELECT pg_temp.act(pg_temp.u('a'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.edit(pg_temp.u('m_recent'), 'Probe: just inside the window') = 'ok',
    '4 a message sent a minute inside the window can still be edited');
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('m_old'), 'Probe: too late')) = 'PM410',
    '4 past the window the author''s edit is refused PM410');
SELECT pg_temp.ok(pg_temp.del(pg_temp.u('m_old')) = 'ok',
    '4 past the window the author still deletes it for everyone');
SELECT pg_temp.ok(pg_temp.del(pg_temp.u('m_delete')) = 'ok',
    '5 the author deletes a fresh room message for everyone');
SELECT pg_temp.ok(pg_temp.code(pg_temp.del(pg_temp.u('m_delete'))) = 'PM409',
    '5 a second delete is refused PM409');
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('m_delete'), 'Probe: back from the dead')) = 'PM409',
    '5 an edit after the delete is refused PM409');
RESET ROLE;

SELECT pg_temp.ok(
    (SELECT deleted_at IS NOT NULL AND body = '' AND body_delta IS NULL
       FROM comms.project_messages WHERE id = pg_temp.u('m_delete')),
    '5 the row is a tombstone: deleted_at, no words, no formatting');
SELECT pg_temp.ok(pg_temp.revisions(pg_temp.u('m_delete')) = 1
    AND pg_temp.revision(pg_temp.u('m_delete'), 1, 'action') = 'delete'
    AND pg_temp.revision(pg_temp.u('m_delete'), 1, 'body') = 'Probe: say it then take it back',
    '5 the deleted words are kept as a delete revision');
SELECT pg_temp.ok(pg_temp.revision(pg_temp.u('m_old'), 1, 'body') = 'Probe: sent a while ago',
    '5 so are an old message''s');
-- #endregion

-- #region 6. An edit is masked again
SELECT pg_temp.act(pg_temp.u('a'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.edit(pg_temp.u('m_edit'), 'Probe: call me on +44 7700 900123 or me@example.com') = 'ok',
    '6 the author edits contact details into a message of a protected engagement');
RESET ROLE;
SELECT pg_temp.ok(
    (SELECT body NOT LIKE '%7700%' AND body NOT LIKE '%example.com%' AND pii_masked
            AND pii_categories @> ARRAY['email', 'phone'] AND body_delta IS NULL
       FROM comms.project_messages WHERE id = pg_temp.u('m_edit')),
    '6 the edited words are stored masked, without formatting');
SELECT pg_temp.ok(pg_temp.revision(pg_temp.u('m_edit'), 3, 'body') = 'Probe: the final draft',
    '6 the text it replaced is kept');
-- #endregion

-- #region 7. Revisions are evidence
SELECT pg_temp.act(pg_temp.u('a'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.try('SELECT count(*) FROM comms.message_revisions')) = '42501',
    '7 a client reads no revision, not even its own (42501)');
SELECT pg_temp.ok(pg_temp.code(pg_temp.try(pg_catalog.format(
    'SELECT * FROM comms.get_message_revisions(%L::uuid)', pg_temp.s('m_edit')))) = '42501',
    '7 a party cannot read a message''s revisions through the operator door (42501)');
RESET ROLE;

SELECT pg_temp.ok(pg_temp.code(pg_temp.try(pg_catalog.format(
    'UPDATE comms.message_revisions SET body = %L WHERE message_id = %L', 'Probe: cleaned up', pg_temp.s('m_edit'))))
    NOT IN ('ok'),
    '7 nobody rewrites a revision, the table owner included');
SELECT pg_temp.ok(pg_temp.code(pg_temp.try(pg_catalog.format(
    'DELETE FROM comms.message_revisions WHERE message_id = %L', pg_temp.s('m_edit')))) NOT IN ('ok'),
    '7 nobody removes one');
SELECT pg_temp.ok(pg_temp.revisions(pg_temp.u('m_edit')) = 3, '7 all three are still there');

INSERT INTO ops.admin_users (user_id) VALUES (pg_temp.u('c')) ON CONFLICT DO NOTHING;
SELECT pg_temp.act(pg_temp.u('c'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.try(pg_catalog.format(
    $q$DO $d$ BEGIN IF (SELECT count(*) FROM comms.get_message_revisions(%L::uuid)) <> 4 THEN
        RAISE EXCEPTION 'wrong history'; END IF; END $d$$q$, pg_temp.s('m_edit'))) = 'ok',
    '7 an operator reads the whole history: three revisions and the current text');
RESET ROLE;
DELETE FROM ops.admin_users WHERE user_id = pg_temp.u('c');
-- #endregion

-- #region 8. A DM
SELECT pg_temp.act(pg_temp.u('p1'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.edit(pg_temp.u('d_edit'), 'Probe: a DM, edited') = 'ok',
    '8 the author edits a DM through the same door');
SELECT pg_temp.ok(pg_temp.del(pg_temp.u('d_delete')) = 'ok', '8 and deletes one for everyone');
RESET ROLE;

SELECT pg_temp.ok(
    (SELECT body = 'Probe: a DM, edited' AND edited_at IS NOT NULL FROM comms.dm_messages WHERE id = pg_temp.u('d_edit'))
    AND (SELECT body = '' AND deleted_at IS NOT NULL FROM comms.dm_messages WHERE id = pg_temp.u('d_delete')),
    '8 the DM reads its new words and edited_at; the deleted one is a tombstone');
SELECT pg_temp.ok(pg_temp.revision(pg_temp.u('d_edit'), 1, 'message_table') = 'comms.dm_messages'
    AND pg_temp.revision(pg_temp.u('d_edit'), 1, 'body') = 'Probe: a DM to edit'
    AND pg_temp.revision(pg_temp.u('d_delete'), 1, 'body') = 'Probe: a DM to delete',
    '8 both kept what they replaced');

SELECT pg_temp.act(pg_temp.u('p2'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('d_edit'), 'Probe: not mine')) = '42501',
    '8 the other participant cannot edit it (42501)');
RESET ROLE;
SELECT pg_temp.act(pg_temp.u('c'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.del(pg_temp.u('d_edit'))) = 'P0002',
    '8 somebody outside the thread is P0002');
RESET ROLE;
-- #endregion

-- #region 9. What a reader is told
SELECT pg_temp.act(pg_temp.u('b'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.rules(pg_temp.u('room'))::jsonb
        = pg_catalog.jsonb_build_object('frozen', NULL, 'edit_window_minutes', pg_temp.s('window')::integer),
    '9 a room''s reader is told the window and that the room is not frozen');
RESET ROLE;
SELECT pg_temp.act(pg_temp.u('p2'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((pg_temp.rules(pg_temp.u('thread'))::jsonb ->> 'frozen') IS NULL,
    '9 so is a thread''s');
RESET ROLE;
SELECT pg_temp.act(pg_temp.u('c'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.rules(pg_temp.u('room'))) = 'P0002',
    '9 somebody outside the room is told nothing (P0002)');
RESET ROLE;
-- #endregion

-- #region 10. The freeze
SAVEPOINT before_dispute;
INSERT INTO finance.disputes (escrow_id, opened_by_profile, reason)
VALUES (pg_temp.u('escrow'), pg_temp.u('b'), 'Probe: a live dispute on the stage');

SELECT pg_temp.act(pg_temp.u('a'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('m_frozen'), 'Probe: cleaning up')) = 'PM423',
    '10 during a live dispute the stage room''s messages cannot be edited (PM423)');
SELECT pg_temp.ok(pg_temp.code(pg_temp.del(pg_temp.u('m_frozen'))) = 'PM423',
    '10 nor deleted (PM423)');
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('g_frozen'), 'Probe: cleaning up')) = 'PM423'
    AND pg_temp.code(pg_temp.del(pg_temp.u('g_frozen'))) = 'PM423',
    '10 nor can the project''s General room''s');
SELECT pg_temp.ok(pg_temp.rules(pg_temp.u('room'))::jsonb ->> 'frozen' = 'dispute'
    AND pg_temp.rules(pg_temp.u('general'))::jsonb ->> 'frozen' = 'dispute',
    '10 both rooms read frozen by the dispute');
RESET ROLE;
SELECT pg_temp.act(pg_temp.u('p1'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.edit(pg_temp.u('d_free'), 'Probe: a DM stays editable') = 'ok',
    '10 a pair DM stays editable during the dispute');
RESET ROLE;
ROLLBACK TO SAVEPOINT before_dispute;

-- Only an entity channel (Decision #306) is ever archived (ck_dm_threads_entity_channel), and never its
-- default (ck_dm_threads_default_live): a live one, a message one of its people sent there just now, and
-- then its archive.
DO $$
DECLARE
    v_thread uuid;
    v_member uuid;
    v uuid;
BEGIN
    SELECT t.id, pp.user_id INTO v_thread, v_member
      FROM comms.dm_threads t
      JOIN comms.dm_participants pp ON pp.thread_id = t.id AND pp.deleted_at IS NULL
     WHERE t.kind = 'entity_channel' AND t.archived_at IS NULL AND NOT t.is_default
     ORDER BY t.id, pp.user_id LIMIT 1;
    IF v_thread IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: need a live entity channel with a member (deno task db:reset)';
    END IF;
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES (v_thread, v_member, 'Probe: said in a channel that is about to close') RETURNING id INTO v;
    PERFORM pg_catalog.set_config('probe.channel', v_thread::text, true);
    PERFORM pg_catalog.set_config('probe.channel_member', v_member::text, true);
    PERFORM pg_catalog.set_config('probe.d_channel', v::text, true);
END $$;

UPDATE comms.project_channels SET archived_at = now() WHERE id = pg_temp.u('room');
UPDATE comms.dm_threads SET archived_at = now() WHERE id = pg_temp.s('channel')::uuid;
SELECT pg_temp.act(pg_temp.u('a'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('m_frozen'), 'Probe: in an archived room')) = 'PM423'
    AND pg_temp.code(pg_temp.del(pg_temp.u('m_frozen'))) = 'PM423',
    '10 an archived room''s messages cannot be edited or deleted (PM423)');
SELECT pg_temp.ok(pg_temp.rules(pg_temp.u('room'))::jsonb ->> 'frozen' = 'archived',
    '10 and the room reads frozen by its archive');
RESET ROLE;
SELECT pg_temp.act(pg_temp.u('channel_member'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.code(pg_temp.edit(pg_temp.u('d_channel'), 'Probe: in an archived channel')) = 'PM423'
    AND pg_temp.code(pg_temp.del(pg_temp.u('d_channel'))) = 'PM423',
    '10 nor an archived entity channel''s (PM423)');
SELECT pg_temp.ok(pg_temp.rules(pg_temp.u('channel'))::jsonb ->> 'frozen' = 'archived',
    '10 and the channel reads frozen by its archive');
RESET ROLE;
-- #endregion

-- #region 11. The Evidence Vault takes the trail, never the words (EX3's manifest, version 2)
-- A ticket dispute on the stage (as its door would file it, written as postgres) and the manifest the
-- raise would freeze: the edited message carries its three revisions in order, each with the SHA-256
-- of its words and no words; the deleted one is a tombstone whose one revision is the `delete`.
DO $$
DECLARE
    v_escrow record;
    v_dispute uuid;
    v_manifest jsonb;
    v_edit jsonb;
    v_gone jsonb;
BEGIN
    SELECT e.id, e.ticket_id, e.project_stage_id INTO v_escrow
      FROM finance.escrows e
      JOIN comms.project_channels c ON c.stage_id = e.project_stage_id
     WHERE c.id = pg_temp.u('room') AND e.ticket_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM finance.disputes d WHERE d.escrow_id = e.id
                          AND d.status IN ('open', 'awaiting_response', 'under_review'))
     ORDER BY e.id LIMIT 1;
    IF v_escrow.id IS NULL THEN
        RAISE NOTICE 'skip 11 no ticket escrow on the fixture stage';
        RETURN;
    END IF;
    INSERT INTO finance.disputes (subject_kind, escrow_id, ticket_id, stage_id, claimant_side,
                                  opened_by_profile, reason)
    VALUES ('ticket_escrow', v_escrow.id, v_escrow.ticket_id, v_escrow.project_stage_id, 'payer',
            pg_temp.u('a'), 'Probe: the vault')
    RETURNING id INTO v_dispute;
    v_manifest := finance.fn_dispute_vault_manifest(v_dispute);
    PERFORM pg_temp.ok((v_manifest ->> 'version')::integer = 2, '11 the manifest is version 2');
    SELECT m INTO v_edit FROM pg_catalog.jsonb_array_elements(v_manifest -> 'messages') m
     WHERE m ->> 'id' = pg_temp.s('m_edit');
    SELECT m INTO v_gone FROM pg_catalog.jsonb_array_elements(v_manifest -> 'messages') m
     WHERE m ->> 'id' = pg_temp.s('m_delete');
    PERFORM pg_temp.ok(pg_catalog.jsonb_array_length(v_edit -> 'revisions') = 3
        AND v_edit -> 'revisions' -> 0 ->> 'action' = 'edit'
        AND v_edit -> 'revisions' -> 0 ->> 'body_sha256'
            = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('Probe: the first draft', 'UTF8')), 'hex'),
        '11 an edited message carries its trail, the original first, by the hash of its words');
    PERFORM pg_temp.ok(NOT (v_edit -> 'revisions' -> 0 ? 'body')
        AND v_manifest::text NOT LIKE '%say it then take it back%'
        AND v_manifest::text NOT LIKE '%Probe: the first draft%',
        '11 no replaced or deleted words are in the manifest the parties read');
    PERFORM pg_temp.ok(v_gone ->> 'body' = '' AND v_gone ->> 'deleted_at' IS NOT NULL
        AND v_gone -> 'revisions' -> 0 ->> 'action' = 'delete',
        '11 a deleted message is a tombstone whose trail ends in its delete');
END $$;
-- #endregion

-- #region 12. Grants
SELECT pg_temp.ok(
    has_function_privilege('authenticated', 'comms.edit_message(uuid, text, jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'comms.delete_message(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'comms.message_edit_rules(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'comms.edit_message(uuid, text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'comms.delete_message(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'comms.get_message_revisions(uuid)', 'EXECUTE'),
    '12 the doors are callable by authenticated and not by anon');
SELECT pg_temp.ok(
    NOT has_table_privilege('authenticated', 'comms.message_revisions', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'comms.message_revisions', 'INSERT')
    AND NOT has_column_privilege('authenticated', 'comms.project_messages', 'body', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'comms.dm_messages', 'body', 'UPDATE'),
    '12 no client writes a message or touches a revision directly');
-- #endregion

ROLLBACK;
