-- =============================================================================================
-- Probe: a project room carries a per-person read mark, and a project's Private Messages group is
-- read whole (PROJECTS CH3; PRD-E13, PRD-E17; Decision #508 (d), (f), (g)).
--
-- THE DEFECT (2026-11-24): a project room had no read state at all. comms.project_channels carried no
-- per-viewer watermark, so the project tree answered `unread: false` for every stage, team and general
-- room whatever had been said in it (live-detail.ts NO_UNREAD_SIGNAL), and reading a room changed
-- nothing. The Private Messages group was read by scanning at most 500 stamped messages, so one busy
-- thread crowded the others out, and a group thread with stamped messages was never listed.
--
-- What is asserted:
--   1. comms.mark_room_read moves the caller's own mark in a room they can read, once there is
--      something new, and comms.unread_rooms stops listing the room; a message by somebody else lists
--      it again, the caller's own message does not, and a deleted one does not.
--   2. A room the caller never opened counts from their first lane mark on the engagement (the
--      00001145 baseline), so arriving on a project does not light every room with its history.
--   3. A stranger is refused 42501 and lists nothing; nobody writes or reads another person's mark.
--   4. comms.project_dm_threads lists every thread of the caller's that holds a message stamped with
--      the project, each once, however many stamped messages one of them holds, a group included.
--   5. Either participant brings their DM into a project both are on (the owner's ruling on stop 23,
--      Decision #560), and the other is told once; either takes it out, which hides it from both
--      people's group while every stamp stays; bringing it back restores it. A stranger, a person off
--      the project, a group and a direct write are all refused.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/room_read_marks.sql
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
GRANT ALL ON probe_ids TO authenticated;

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
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

-- Whether the acting caller's unread rooms on the fixture project include p_room.
CREATE FUNCTION pg_temp.unread(p_room uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM comms.unread_rooms(pg_temp.id('project')) u WHERE u = p_room);
END $$;

-- mark_room_read as the acting caller: 'true' / 'false', or the SQLSTATE it raised.
CREATE FUNCTION pg_temp.try_mark(p_room uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    RETURN comms.mark_room_read(p_room)::text;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

-- A direct write to the read table as the acting caller: 'ok', or the SQLSTATE it raised.
CREATE FUNCTION pg_temp.try_write(p_room uuid, p_user uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO comms.project_channel_reads (channel_id, user_id, last_read_at)
    VALUES (p_room, p_user, now() + interval '1 day');
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

-- Post into a room as postgres, p_age before now (so marks taken at now() are later or earlier).
CREATE FUNCTION pg_temp.post(p_room uuid, p_sender uuid, p_at timestamptz) RETURNS uuid
LANGUAGE sql AS $$
    INSERT INTO comms.project_messages (channel_id, sender_user_id, body, created_at)
    VALUES (p_room, p_sender, 'probe message', p_at)
    RETURNING id;
$$;

-- bring_dm_into_project as the acting caller: its jsonb answer as text, or the SQLSTATE it raised.
CREATE FUNCTION pg_temp.try_bring(p_other uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    RETURN comms.bring_dm_into_project(pg_temp.id('project'), p_other)::text;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

-- take_dm_out_of_project as the acting caller: 'true' / 'false', or the SQLSTATE it raised.
CREATE FUNCTION pg_temp.try_take(p_thread uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    RETURN comms.take_dm_out_of_project(p_thread, pg_temp.id('project'))::text;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

-- Whether the acting caller's Private Messages group on the fixture project lists p_thread.
CREATE FUNCTION pg_temp.listed(p_thread uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM comms.project_dm_threads(pg_temp.id('project')) t WHERE t.thread_id = p_thread);
END $$;

-- A direct write to the link table as the acting caller: 'ok', or the SQLSTATE it raised.
CREATE FUNCTION pg_temp.try_link(p_thread uuid, p_user uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO comms.dm_thread_projects (thread_id, project_id, brought_in_by, brought_in_at)
    VALUES (p_thread, pg_temp.id('project'), p_user, now());
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

-- Function EXECUTE is deny-by-default (#477), so the helpers are granted to the role the checks run as.
GRANT EXECUTE ON FUNCTION pg_temp.id(text), pg_temp.ok(boolean, text), pg_temp.unread(uuid),
    pg_temp.try_mark(uuid), pg_temp.try_write(uuid, uuid), pg_temp.try_bring(uuid), pg_temp.try_take(uuid),
    pg_temp.listed(uuid), pg_temp.try_link(uuid, uuid) TO authenticated;
-- #endregion

-- #region 0b. The objects exist (the red half of the defect)
SELECT pg_temp.ok(to_regclass('comms.project_channel_reads') IS NOT NULL,
    '0 a project room has a per-person read mark (comms.project_channel_reads)');
SELECT pg_temp.ok(to_regprocedure('comms.mark_room_read(uuid)') IS NOT NULL,
    '0 a door moves it (comms.mark_room_read)');
SELECT pg_temp.ok(to_regprocedure('comms.unread_rooms(uuid)') IS NOT NULL,
    '0 the project tree can ask which rooms are unread (comms.unread_rooms)');
SELECT pg_temp.ok(to_regprocedure('comms.project_dm_threads(uuid)') IS NOT NULL,
    '0 the Private Messages group is read by thread, not by a capped message scan (comms.project_dm_threads)');
SELECT pg_temp.ok(to_regprocedure('comms.bring_dm_into_project(uuid, uuid)') IS NOT NULL
                  AND to_regprocedure('comms.take_dm_out_of_project(uuid, uuid)') IS NOT NULL,
    '0 a pair DM can be brought into a project and taken out (comms.bring_dm_into_project, take_dm_out_of_project)');
-- #endregion

-- #region 1. Fixtures (as postgres)
-- A project with an active assigned freelancer on one of its stages, the project's owner, a stage
-- room both can read, and a stranger party to nothing.
DO $$
DECLARE
    v_p uuid;
    v_stage uuid;
    v_owner uuid;
    v_free uuid;
    v_third uuid;
    v_stranger uuid;
    v_room uuid;
BEGIN
    SELECT p.id, ps.id, p.owner_user_id, sa.freelancer_profile_id
      INTO v_p, v_stage, v_owner, v_free
      FROM projects.projects p
      JOIN projects.project_stages ps ON ps.project_id = p.id AND ps.archived_at IS NULL
      JOIN projects.stage_assignments sa ON sa.project_stage_id = ps.id
     WHERE sa.assignee_type = 'freelancer'
       AND sa.status NOT IN ('declined', 'cancelled', 'released')
       AND sa.freelancer_profile_id <> p.owner_user_id
       AND comms.fn_dm_allowed(p.owner_user_id, sa.freelancer_profile_id)
     ORDER BY p.id, ps.sort_order
     LIMIT 1;
    IF v_p IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: no fixture: no assigned freelancer on a stage'; END IF;

    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE NOT EXISTS (SELECT 1 FROM projects.fn_engaged_projects(u.user_id) e WHERE e.project_id = v_p)
     ORDER BY u.user_id LIMIT 1;
    IF v_stranger IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: no fixture: nobody outside the project'; END IF;

    -- A third person to make a group of. Any third person will do: the probe writes the group's
    -- message as postgres with the project named, and what is under test is the read, not the stamp.
    SELECT u.user_id INTO v_third FROM org.users_public u
     WHERE u.user_id NOT IN (v_owner, v_free, v_stranger)
     ORDER BY u.user_id LIMIT 1;
    IF v_third IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: no fixture: no third person for a group'; END IF;

    SELECT c.id INTO v_room FROM comms.project_channels c
     WHERE c.project_id = v_p AND c.stage_id = v_stage AND c.visibility = 'stage_all'
       AND c.archived_at IS NULL
     ORDER BY c.created_at LIMIT 1;
    IF v_room IS NULL THEN
        INSERT INTO comms.project_channels (project_id, stage_id, name, visibility)
        VALUES (v_p, v_stage, 'Probe stage room', 'stage_all') RETURNING id INTO v_room;
    END IF;

    INSERT INTO probe_ids VALUES
        ('project', v_p), ('stage', v_stage), ('owner', v_owner), ('free', v_free),
        ('third', v_third), ('stranger', v_stranger), ('room', v_room);

    -- Both people start with no mark in the room and a lane mark a day ago: the engagement baseline.
    DELETE FROM comms.project_channel_reads r WHERE r.channel_id = v_room;
    DELETE FROM projects.view_reads r WHERE r.project_id = v_p AND r.user_id IN (v_owner, v_free);
    INSERT INTO projects.view_reads (user_id, project_id, lane_view, seen_at)
    VALUES (v_owner, v_p, 'overview', now() - interval '1 day'),
           (v_free, v_p, 'overview', now() - interval '1 day');
END $$;

SELECT pg_temp.act(pg_temp.id('owner'));
SELECT pg_temp.ok(comms.has_channel_access(pg_temp.id('room')), 'fixture: the owner can read the stage room');
SELECT pg_temp.act(pg_temp.id('free'));
SELECT pg_temp.ok(comms.has_channel_access(pg_temp.id('room')), 'fixture: the freelancer can read the stage room');
-- #endregion

-- #region 2. Reading a stage room marks it read, and only news makes it unread again
-- History from before the owner's first lane mark is not news; a message since it is.
SELECT pg_temp.post(pg_temp.id('room'), pg_temp.id('free'), now() - interval '3 days');
SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT pg_temp.unread(pg_temp.id('room')),
    '2 a message from before the reader first opened the engagement is not unread');
RESET ROLE;

SELECT pg_temp.post(pg_temp.id('room'), pg_temp.id('free'), now() - interval '1 hour');
SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.unread(pg_temp.id('room')),
    '1 a message by somebody else since the baseline makes the stage room unread');
SELECT pg_temp.ok(pg_temp.try_mark(pg_temp.id('room')) = 'true', '1 mark_room_read moves the mark');
SELECT pg_temp.ok(NOT pg_temp.unread(pg_temp.id('room')), '1 and the stage room is no longer unread');
SELECT pg_temp.ok(pg_temp.try_mark(pg_temp.id('room')) = 'false',
    '1 a second mark with nothing new moves nothing');
SELECT pg_temp.ok(
    (SELECT count(*) FROM comms.project_channel_reads r WHERE r.channel_id = pg_temp.id('room')) = 1,
    '1 the reader reads their own mark, and only theirs');
RESET ROLE;

-- The reader's own message is not news to them; a deleted one is news to nobody.
SELECT pg_temp.post(pg_temp.id('room'), pg_temp.id('owner'), now() + interval '1 minute');
INSERT INTO probe_ids
SELECT 'deleted', pg_temp.post(pg_temp.id('room'), pg_temp.id('free'), now() + interval '2 minutes');
UPDATE comms.project_messages SET deleted_at = now() WHERE id = pg_temp.id('deleted');
SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT pg_temp.unread(pg_temp.id('room')),
    '1 neither the reader''s own message nor a deleted one makes the room unread');
RESET ROLE;

SELECT pg_temp.post(pg_temp.id('room'), pg_temp.id('free'), now() + interval '3 minutes');
SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.unread(pg_temp.id('room')), '1 a newer message by somebody else makes it unread again');
RESET ROLE;

-- The freelancer's view of the same room is their own: the owner's mark read nothing for them, and
-- the owner's message is news to them.
SELECT pg_temp.act(pg_temp.id('free'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.unread(pg_temp.id('room')),
    '1 the owner''s mark read nothing for the freelancer, to whom the owner''s message is news');
SELECT pg_temp.ok(
    NOT EXISTS (SELECT 1 FROM comms.project_channel_reads r WHERE r.channel_id = pg_temp.id('room')),
    '1 and the freelancer cannot see the owner''s mark');
RESET ROLE;
-- #endregion

-- #region 2b. With no lane mark at all, nothing is news yet
DELETE FROM projects.view_reads r WHERE r.project_id = pg_temp.id('project') AND r.user_id = pg_temp.id('free');
DELETE FROM comms.project_channel_reads r WHERE r.user_id = pg_temp.id('free');
SELECT pg_temp.act(pg_temp.id('free'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT pg_temp.unread(pg_temp.id('room')),
    '2 a reader who never opened the engagement is shown no history as unread');
RESET ROLE;
-- #endregion

-- #region 3. Strangers and direct writes
SELECT pg_temp.act(pg_temp.id('stranger'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.try_mark(pg_temp.id('room')) = '42501', '3 a stranger cannot mark the room read (42501)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.unread_rooms(pg_temp.id('project'))),
    '3 and lists no unread room on the project');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.project_channel_reads),
    '3 and reads nobody''s mark');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.try_write(pg_temp.id('room'), pg_temp.id('owner')) = '42501',
    '3 the reader cannot write their own mark directly (42501): only the door moves it');
SELECT pg_temp.ok(pg_temp.try_write(pg_temp.id('room'), pg_temp.id('free')) = '42501',
    '3 nor anybody else''s');
RESET ROLE;
-- #endregion

-- #region 4. The Private Messages group, read by thread
-- One pair thread with 600 stamped messages, and a second pair thread with one; the cap of 500 the
-- old scan kept would have dropped the second.
DO $$
DECLARE
    v_busy uuid;
    v_quiet uuid;
    v_group uuid;
    v_third uuid := pg_temp.id('third');
BEGIN
    INSERT INTO comms.dm_threads (created_by_user_id) VALUES (pg_temp.id('owner')) RETURNING id INTO v_busy;
    INSERT INTO comms.dm_participants (thread_id, user_id)
    VALUES (v_busy, pg_temp.id('owner')), (v_busy, pg_temp.id('free'));
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body, created_at)
    SELECT v_busy, pg_temp.id('free'), pg_temp.id('project'), 'busy ' || g, now() - (g || ' seconds')::interval
      FROM generate_series(1, 600) g;

    INSERT INTO comms.dm_threads (created_by_user_id) VALUES (pg_temp.id('owner')) RETURNING id INTO v_quiet;
    INSERT INTO comms.dm_participants (thread_id, user_id)
    VALUES (v_quiet, pg_temp.id('owner')), (v_quiet, pg_temp.id('free'));
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body, created_at)
    VALUES (v_quiet, pg_temp.id('owner'), pg_temp.id('project'), 'quiet', now() - interval '2 hours');

    INSERT INTO probe_ids VALUES ('busy', v_busy), ('quiet', v_quiet);

    INSERT INTO comms.dm_threads (created_by_user_id, kind, title)
    VALUES (pg_temp.id('owner'), 'group', 'Probe group') RETURNING id INTO v_group;
    INSERT INTO comms.dm_participants (thread_id, user_id)
    VALUES (v_group, pg_temp.id('owner')), (v_group, pg_temp.id('free')), (v_group, v_third);
    -- The stamp trigger keeps a project only while every participant is party to it, so the
    -- group's stamp is written after the insert, as the fixture it is.
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, created_at)
    VALUES (v_group, pg_temp.id('free'), 'group', now() - interval '3 hours');
    UPDATE comms.dm_messages SET project_id = pg_temp.id('project') WHERE thread_id = v_group;
    INSERT INTO probe_ids VALUES ('group', v_group);
END $$;

SELECT pg_temp.ok(
    (SELECT count(*) FROM comms.dm_messages m WHERE m.thread_id = pg_temp.id('busy')
        AND m.project_id = pg_temp.id('project')) = 600,
    'fixture: the busy thread holds 600 messages stamped with the project');

SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(
    (SELECT count(*) FROM comms.project_dm_threads(pg_temp.id('project')) t
      WHERE t.thread_id IN (pg_temp.id('busy'), pg_temp.id('quiet'))) = 2,
    '4 both pair threads are listed, each once, whatever the busy one holds');
SELECT pg_temp.ok(
    (SELECT count(*) = count(DISTINCT t.thread_id) FROM comms.project_dm_threads(pg_temp.id('project')) t),
    '4 no thread is listed twice');
SELECT pg_temp.ok(
    (SELECT t.ref FROM comms.project_dm_threads(pg_temp.id('project')) t WHERE t.thread_id = pg_temp.id('busy'))
        ~ '^cht-[23456789abcdefghjkmnopqrstuvwxyz]{10}$',
    '4 each row carries the thread''s cht- address');
SELECT pg_temp.ok(
    EXISTS (
        SELECT 1 FROM comms.project_dm_threads(pg_temp.id('project')) t
         WHERE t.thread_id = pg_temp.id('group') AND t.kind = 'group' AND t.title = 'Probe group'),
    '4 a group with a stamped message is listed, with its kind and name');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('stranger'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.project_dm_threads(pg_temp.id('project'))),
    '4 a stranger lists none of them');
RESET ROLE;

-- A thread the reader deleted for themselves stays out of the project as it does the inbox.
UPDATE comms.dm_participants SET deleted_at = now()
 WHERE thread_id = pg_temp.id('quiet') AND user_id = pg_temp.id('owner');
SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM comms.project_dm_threads(pg_temp.id('project')) t WHERE t.thread_id = pg_temp.id('quiet')),
    '4 a thread the reader deleted for themselves is not listed');
RESET ROLE;
-- #endregion

-- #region 5. Bringing a DM into the project, and taking it out (stop 23 as ruled, Decision #560)
-- The pair's one DM is whichever thread comms.get_or_create_dm_thread answers for them: the seed's, or
-- one of section 4's (they tie on created_at, so which is not fixed). Whichever it is, the owner first
-- deletes it for themselves, then opens it from the project, then takes it out, so the bring-in
-- below starts from the same state every run.
SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
INSERT INTO probe_ids
SELECT 'pair', (comms.get_or_create_dm_thread(pg_temp.id('free')) ->> 'thread_id')::uuid;
RESET ROLE;
UPDATE comms.dm_participants SET deleted_at = now()
 WHERE thread_id = pg_temp.id('pair') AND user_id = pg_temp.id('owner');
SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((pg_temp.try_bring(pg_temp.id('free'))::jsonb ->> 'thread_id')::uuid = pg_temp.id('pair'),
    '5 opening the DM from the project answers the pair''s own thread');
SELECT pg_temp.ok(pg_temp.listed(pg_temp.id('pair')),
    '5 a DM the owner had deleted for themselves comes back for them, in the project');
SELECT pg_temp.ok(pg_temp.try_take(pg_temp.id('pair')) = 'true', 'fixture: the pair''s DM is taken out to start');
SELECT pg_temp.ok(NOT pg_temp.listed(pg_temp.id('pair')), 'fixture: the pair''s DM starts out of the group');
RESET ROLE;
SELECT pg_temp.ok(
    (SELECT p.deleted_at IS NULL FROM comms.dm_participants p
      WHERE p.thread_id = pg_temp.id('pair') AND p.user_id = pg_temp.id('owner')),
    '5 and its participant row is undeleted for the owner only');

DELETE FROM comms.notifications n
 WHERE n.user_id = pg_temp.id('free') AND n.type = 'message.brought_into_project';
-- A stamped message, to prove a take-out never touches a stamp.
INSERT INTO comms.dm_messages (thread_id, sender_user_id, project_id, body)
VALUES (pg_temp.id('pair'), pg_temp.id('owner'), pg_temp.id('project'), 'stamped before the take-out');

SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT pg_temp.listed(pg_temp.id('pair')),
    '5 a taken-out thread stays out even after a new stamped message');
SELECT pg_temp.ok((pg_temp.try_bring(pg_temp.id('free'))::jsonb ->> 'moved')::boolean,
    '5 the owner brings the DM into the project');
SELECT pg_temp.ok(pg_temp.listed(pg_temp.id('pair')), '5 and it is in the owner''s group');
SELECT pg_temp.ok(NOT (pg_temp.try_bring(pg_temp.id('free'))::jsonb ->> 'moved')::boolean,
    '5 bringing it again moves nothing');
RESET ROLE;

SELECT pg_temp.ok(
    (SELECT count(*) FROM comms.notifications n
      WHERE n.user_id = pg_temp.id('free') AND n.type = 'message.brought_into_project') = 1,
    '5 the other person is told, once');
SELECT pg_temp.ok(
    (SELECT n.action_url FROM comms.notifications n
      WHERE n.user_id = pg_temp.id('free') AND n.type = 'message.brought_into_project')
        = '/projects/' || (SELECT p.slug FROM projects.projects p WHERE p.id = pg_temp.id('project'))
          || '/' || (SELECT t.ref FROM comms.dm_threads t WHERE t.id = pg_temp.id('pair')),
    '5 and the notice opens the conversation inside the project, by its prj- and cht- addresses');

SELECT pg_temp.act(pg_temp.id('free'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.listed(pg_temp.id('pair')), '5 the DM is in the freelancer''s group too');
SELECT pg_temp.ok(pg_temp.try_take(pg_temp.id('pair')) = 'true', '5 the freelancer takes it out');
SELECT pg_temp.ok(NOT pg_temp.listed(pg_temp.id('pair')), '5 it leaves the freelancer''s group');
SELECT pg_temp.ok(pg_temp.try_take(pg_temp.id('pair')) = 'false', '5 taking it out again moves nothing');
SELECT pg_temp.ok(pg_temp.try_link(pg_temp.id('pair'), pg_temp.id('free')) = '42501',
    '5 nobody writes the link directly (42501): only the doors do');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT pg_temp.listed(pg_temp.id('pair')), '5 and the owner''s, for both people');
RESET ROLE;
SELECT pg_temp.ok(
    (SELECT count(*) FROM comms.dm_messages m
      WHERE m.thread_id = pg_temp.id('pair') AND m.project_id = pg_temp.id('project')) >= 1,
    '5 every stamp stays, as evidence');

SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((pg_temp.try_bring(pg_temp.id('free'))::jsonb ->> 'moved')::boolean,
    '5 bringing it back restores it');
SELECT pg_temp.ok(pg_temp.listed(pg_temp.id('pair')), '5 and it is listed again');
SELECT pg_temp.ok(pg_temp.try_bring(pg_temp.id('stranger')) = 'CH409',
    '5 a person who is not on the project cannot be brought in (CH409)');
SELECT pg_temp.ok(pg_temp.try_take(pg_temp.id('group')) = '22023',
    '5 a group cannot be taken out by the pair door (22023)');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('stranger'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.try_bring(pg_temp.id('owner')) = '42501',
    '5 a stranger to the project cannot bring anything into it (42501)');
SELECT pg_temp.ok(pg_temp.try_take(pg_temp.id('pair')) = '42501',
    '5 nor take out a conversation they are not in (42501)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.dm_thread_projects),
    '5 and reads no conversation''s place in a project');
RESET ROLE;
-- #endregion

ROLLBACK;
