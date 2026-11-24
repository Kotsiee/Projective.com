-- =============================================================================================
-- Probe: a team's private room and a business's private room exist on every stage they work on,
-- and only their people read them (PROJECTS CH2; PJ-48).
--
-- THE DEFECT (2026-11-24): nothing created `team_private` or `business_private` rooms. Only
-- comms.get_stage_channels could, and nothing called it; the seed wrote `stage_all` rooms only. So a
-- team member opening a team-staffed stage found no team room, and a business client found no
-- business room, although comms.can_access_scope already gated both scopes.
--
-- What is asserted:
--   1. Every live team seat in the seed has its stage's team room, and the team's member reads it;
--      a Session or a Task (one conversation) has no private rooms.
--   2. Every stage of a business-client project has its business room, and a business member reads it.
--   3. comms.can_access_scope, arm by arm: the client (owner), a business member, a team member, a
--      second team's member, a solo freelancer, a released assignee and an outsider, on the three
--      stage scopes. A team room is ONE team's (owner ruling, CH2): a second team on the stage gets
--      its own, and neither team, nor a solo freelancer, reads another's.
--   4. Rooms open when the seat or the client arrives, in the same transaction, once: a team seat
--      going live (inserted live, or moved live from pending_funding), a stage added to a business
--      project, a project re-pointed at a business. A seat that is not live opens nothing.
--   5. A released team's member no longer reads the room or its messages, old ones included (owner
--      ruling, CH2); the room and its messages stay.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   deno task test:probes private_rooms
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
GRANT SELECT ON probe_ids TO authenticated;

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

-- Rooms of one scope on one stage, as the database holds them (archived ones included).
CREATE FUNCTION pg_temp.held(p_stage uuid, p_vis text) RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$
    SELECT count(*) FROM comms.project_channels c WHERE c.stage_id = p_stage AND c.visibility = p_vis;
$$;

-- Rooms of one scope on one stage, as the acting caller reads them under RLS.
CREATE FUNCTION pg_temp.seen(p_stage uuid, p_vis text) RETURNS bigint LANGUAGE sql AS $$
    SELECT count(*) FROM comms.project_channels c WHERE c.stage_id = p_stage AND c.visibility = p_vis;
$$;

-- Messages in one room, as the acting caller reads them under RLS.
CREATE FUNCTION pg_temp.seen_messages(p_channel uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT count(*) FROM comms.project_messages m WHERE m.channel_id = p_channel;
$$;

-- can_access_scope on the three stage scopes, as the acting caller: 'stage_all,team,business' as t/f.
-- The team scope is asked for the fixture team's room (a team room belongs to one team).
CREATE FUNCTION pg_temp.arms(p_stage uuid) RETURNS text LANGUAGE sql AS $$
    SELECT concat_ws(',',
        comms.can_access_scope(pg_temp.id('project'), p_stage, 'stage_all'),
        comms.can_access_scope(pg_temp.id('project'), p_stage, 'team_private', pg_temp.id('team')),
        comms.can_access_scope(pg_temp.id('project'), p_stage, 'business_private'));
$$;

-- A user who is nobody on this project: not its owner, not the business's, not either team's.
CREATE FUNCTION pg_temp.stranger(p_not uuid[]) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
    SELECT fp.user_id FROM org.freelancer_profiles fp
     WHERE fp.user_id <> ALL (p_not)
       AND NOT org.fn_is_minor(fp.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm
                        WHERE tm.user_id = fp.user_id AND tm.team_id IN (pg_temp.id('team'), pg_temp.id('team2')))
       AND NOT EXISTS (SELECT 1 FROM org.business_members bm
                        WHERE bm.user_id = fp.user_id AND bm.business_id = pg_temp.id('business'))
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.profile_id = fp.user_id AND pp.project_id = pg_temp.id('project'))
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                         JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                        WHERE sa.freelancer_profile_id = fp.user_id AND ps.project_id = pg_temp.id('project'))
     ORDER BY fp.user_id LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.id(text), pg_temp.ok(boolean, text), pg_temp.seen(uuid, text),
    pg_temp.seen_messages(uuid), pg_temp.arms(uuid), pg_temp.held(uuid, text) TO authenticated;
-- #endregion

-- #region 1. Fixtures (as postgres)
-- A business-client project with a live team seat, a member of that team who is nobody else on it, and
-- a member of the business who is not its owner.
INSERT INTO probe_ids
SELECT 'seat', x.seat FROM (
    SELECT sa.id AS seat
      FROM projects.stage_assignments sa
      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id AND ps.archived_at IS NULL
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE sa.assignee_type = 'team' AND sa.status IN ('assigned', 'accepted')
       AND p.client_business_id IS NOT NULL AND p.format::text <> 'session'
       AND EXISTS (SELECT 1 FROM org.team_members tm
                    WHERE tm.team_id = sa.team_id AND tm.status = 'active' AND tm.user_id <> p.owner_user_id
                      AND NOT EXISTS (SELECT 1 FROM org.business_members bm
                                       WHERE bm.user_id = tm.user_id AND bm.business_id = p.client_business_id))
       AND EXISTS (SELECT 1 FROM org.business_members bm
                    WHERE bm.business_id = p.client_business_id AND bm.status = 'active'
                      AND bm.user_id <> p.owner_user_id)
     ORDER BY sa.created_at, sa.id LIMIT 1) x;

INSERT INTO probe_ids
SELECT 'stage', sa.project_stage_id FROM projects.stage_assignments sa WHERE sa.id = pg_temp.id('seat');
INSERT INTO probe_ids
SELECT 'team', sa.team_id FROM projects.stage_assignments sa WHERE sa.id = pg_temp.id('seat');
INSERT INTO probe_ids
SELECT 'project', ps.project_id FROM projects.project_stages ps WHERE ps.id = pg_temp.id('stage');
INSERT INTO probe_ids SELECT 'owner', p.owner_user_id FROM projects.projects p WHERE p.id = pg_temp.id('project');
INSERT INTO probe_ids
SELECT 'business', p.client_business_id FROM projects.projects p WHERE p.id = pg_temp.id('project');
INSERT INTO probe_ids
SELECT 'teammate', tm.user_id FROM org.team_members tm
 WHERE tm.team_id = pg_temp.id('team') AND tm.status = 'active' AND tm.user_id <> pg_temp.id('owner')
   AND NOT EXISTS (SELECT 1 FROM org.business_members bm
                    WHERE bm.user_id = tm.user_id AND bm.business_id = pg_temp.id('business'))
 ORDER BY tm.user_id LIMIT 1;
INSERT INTO probe_ids
SELECT 'bizmember', bm.user_id FROM org.business_members bm
 WHERE bm.business_id = pg_temp.id('business') AND bm.status = 'active' AND bm.user_id <> pg_temp.id('owner')
   AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.user_id = bm.user_id AND tm.team_id = pg_temp.id('team'))
 ORDER BY bm.user_id LIMIT 1;
-- A second team, and a member of it who is in neither the first team nor the business.
INSERT INTO probe_ids
SELECT 'team2', tm.team_id FROM org.team_members tm
 WHERE tm.team_id <> pg_temp.id('team') AND tm.status = 'active'
   AND tm.user_id NOT IN (pg_temp.id('owner'), pg_temp.id('teammate'), pg_temp.id('bizmember'))
   AND NOT EXISTS (SELECT 1 FROM org.team_members t1 WHERE t1.user_id = tm.user_id AND t1.team_id = pg_temp.id('team'))
   AND NOT EXISTS (SELECT 1 FROM org.business_members bm
                    WHERE bm.user_id = tm.user_id AND bm.business_id = pg_temp.id('business'))
 ORDER BY tm.team_id, tm.user_id LIMIT 1;
INSERT INTO probe_ids
SELECT 'team2member', tm.user_id FROM org.team_members tm
 WHERE tm.team_id = pg_temp.id('team2') AND tm.status = 'active'
   AND tm.user_id NOT IN (pg_temp.id('owner'), pg_temp.id('teammate'), pg_temp.id('bizmember'))
   AND NOT EXISTS (SELECT 1 FROM org.team_members t1 WHERE t1.user_id = tm.user_id AND t1.team_id = pg_temp.id('team'))
   AND NOT EXISTS (SELECT 1 FROM org.business_members bm
                    WHERE bm.user_id = tm.user_id AND bm.business_id = pg_temp.id('business'))
 ORDER BY tm.user_id LIMIT 1;

INSERT INTO probe_ids SELECT 'solo', pg_temp.stranger(ARRAY[pg_temp.id('owner'), pg_temp.id('bizmember')]);
INSERT INTO probe_ids
SELECT 'released', pg_temp.stranger(ARRAY[pg_temp.id('owner'), pg_temp.id('bizmember'), pg_temp.id('solo')]);
INSERT INTO probe_ids
SELECT 'outsider', pg_temp.stranger(ARRAY[pg_temp.id('owner'), pg_temp.id('bizmember'), pg_temp.id('solo'),
                                          pg_temp.id('released')]);

SELECT pg_temp.ok((SELECT count(*) FROM probe_ids WHERE id IS NOT NULL) = 13,
    'fixtures: a business project with a live team seat, a teammate, a business member, a second team''s member and three strangers');

-- A solo freelancer holding a live seat on the stage, and one whose seat there was released.
INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
VALUES (pg_temp.id('stage'), 'freelancer', pg_temp.id('solo'), pg_temp.id('owner'), 'assigned'),
       (pg_temp.id('stage'), 'freelancer', pg_temp.id('released'), pg_temp.id('owner'), 'released');
-- #endregion

-- #region 2. The seed's rooms
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM projects.stage_assignments sa
      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id AND ps.archived_at IS NULL
      JOIN projects.projects p ON p.id = ps.project_id AND p.format::text <> 'session'
     WHERE sa.assignee_type = 'team' AND sa.status IN ('assigned', 'accepted')
       AND NOT EXISTS (SELECT 1 FROM comms.project_channels c
                        WHERE c.stage_id = ps.id AND c.visibility = 'team_private')),
    'every live team seat in the seed has its stage''s team room');

SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM projects.project_stages ps
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE p.client_business_id IS NOT NULL AND p.format::text <> 'session' AND ps.archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM comms.project_channels c
                        WHERE c.stage_id = ps.id AND c.visibility = 'business_private')),
    'every stage of a business-client project in the seed has its business room');

SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM comms.project_channels c JOIN projects.projects p ON p.id = c.project_id
     WHERE (p.format::text = 'session'
            OR (p.format::text = 'one_off' AND p.structure_variation::text IN ('single_stage', 'single_task')))
       AND c.visibility IN ('team_private', 'business_private')),
    'a Session or a Task keeps its one conversation: no private rooms on either');

SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM comms.project_channels c
     WHERE c.visibility = 'team_private'
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                        WHERE sa.project_stage_id = c.stage_id AND sa.assignee_type = 'team'
                          AND sa.team_id = c.team_id)),
    'every team room names a team that holds a seat on its stage');
-- #endregion

-- #region 3. can_access_scope, arm by arm (stage_all, team_private, business_private)
SELECT pg_temp.act(pg_temp.id('owner'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.arms(pg_temp.id('stage')) = 't,f,t',
    'the client (owner) reaches the stage room and the business room, never the team room');
SELECT pg_temp.ok(pg_temp.seen(pg_temp.id('stage'), 'team_private') = 0,
    'the client reads no team room');
SELECT pg_temp.ok(pg_temp.seen(pg_temp.id('stage'), 'business_private') = 1,
    'the client reads the business room');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('bizmember'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.arms(pg_temp.id('stage')) = 't,f,t',
    'a business member reaches the stage room and the business room, never the team room');
SELECT pg_temp.ok(pg_temp.seen(pg_temp.id('stage'), 'business_private') = 1
              AND pg_temp.seen(pg_temp.id('stage'), 'team_private') = 0,
    'a business member reads the business room and no team room');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('teammate'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.arms(pg_temp.id('stage')) = 't,t,f',
    'a team member reaches the stage room and the team room, never the business room');
SELECT pg_temp.ok(pg_temp.seen(pg_temp.id('stage'), 'team_private') = 1,
    'a team member opening the team-staffed stage finds its team room');
SELECT pg_temp.ok(pg_temp.seen(pg_temp.id('stage'), 'business_private') = 0,
    'a team member reads no business room');
SELECT pg_temp.ok((SELECT pg_catalog.string_agg(g.visibility || ':' || g.accessible, ',' ORDER BY g.visibility)
                     FROM comms.get_stage_channels(pg_temp.id('stage')) g)
                  = 'business_private:false,stage_all:true,team_private:true',
    'the lazy opener lists the stage''s rooms with the team member''s own access');
RESET ROLE;

-- A second team seated live on the same stage gets a room of its own; neither team reads the other's.
INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, team_id, assigned_by, status)
VALUES (pg_temp.id('stage'), 'team', pg_temp.id('team2'), pg_temp.id('owner'), 'accepted');
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage'), 'team_private') = 2,
    'a second team on the stage gets its own team room');

SELECT pg_temp.act(pg_temp.id('teammate'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.seen(pg_temp.id('stage'), 'team_private') = 1
              AND NOT comms.can_access_scope(pg_temp.id('project'), pg_temp.id('stage'), 'team_private',
                                             pg_temp.id('team2')),
    'the first team''s member reads their own team room and not the second team''s');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('team2member'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.arms(pg_temp.id('stage')) = 't,f,f'
              AND pg_temp.seen(pg_temp.id('stage'), 'team_private') = 1
              AND comms.can_access_scope(pg_temp.id('project'), pg_temp.id('stage'), 'team_private',
                                         pg_temp.id('team2')),
    'the second team''s member reads their own team room and not the first team''s');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('solo'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.arms(pg_temp.id('stage')) = 't,f,f'
              AND pg_temp.seen(pg_temp.id('stage'), 'team_private') = 0
              AND NOT comms.can_access_scope(pg_temp.id('project'), pg_temp.id('stage'), 'team_private', NULL),
    'a solo freelancer on the stage reaches its stage room, never a team''s room or the business room');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('released'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.arms(pg_temp.id('stage')) = 'f,f,f',
    'a released assignee reaches none of the stage''s rooms');
RESET ROLE;

SELECT pg_temp.act(pg_temp.id('outsider'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.arms(pg_temp.id('stage')) = 'f,f,f'
              AND pg_temp.seen(pg_temp.id('stage'), 'team_private') = 0
              AND pg_temp.seen(pg_temp.id('stage'), 'business_private') = 0,
    'an outsider reaches and reads none of them');
RESET ROLE;
-- #endregion

-- #region 4. Rooms open when the seat or the client arrives, once
-- A second stage of the business project, added by its owner through the stage door.
SELECT pg_temp.act(pg_temp.id('owner'));
INSERT INTO probe_ids SELECT 'stage2', projects.create_stage(pg_temp.id('project'), 'Probe stage');
SELECT pg_catalog.set_config('request.jwt.claims', '', true), pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage2'), 'stage_all') = 1
              AND pg_temp.held(pg_temp.id('stage2'), 'business_private') = 1,
    'a stage added to a business project opens its General room and its business room');
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage2'), 'team_private') = 0,
    'a stage nobody holds yet has no team room');

-- A seat parked on the stage opens nothing; the seat going live opens the team room, once.
INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, team_id, assigned_by, status)
VALUES (pg_temp.id('stage2'), 'team', pg_temp.id('team'), pg_temp.id('owner'), 'pending_funding');
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage2'), 'team_private') = 0,
    'a team seat pending funding opens no room');
UPDATE projects.stage_assignments SET status = 'assigned'
 WHERE project_stage_id = pg_temp.id('stage2') AND team_id = pg_temp.id('team');
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage2'), 'team_private') = 1,
    'the team seat going live opens the stage''s team room in the same transaction');
UPDATE projects.stage_assignments SET status = 'accepted'
 WHERE project_stage_id = pg_temp.id('stage2') AND team_id = pg_temp.id('team');
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage2'), 'team_private') = 1,
    'a second live move opens no second room');

-- A team seat inserted live on a third stage.
SELECT pg_temp.act(pg_temp.id('owner'));
INSERT INTO probe_ids SELECT 'stage3', projects.create_stage(pg_temp.id('project'), 'Probe stage three');
SELECT pg_catalog.set_config('request.jwt.claims', '', true), pg_catalog.set_config('request.jwt.claim.sub', '', true);
INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, team_id, assigned_by, status)
VALUES (pg_temp.id('stage3'), 'team', pg_temp.id('team'), pg_temp.id('owner'), 'accepted');
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage3'), 'team_private') = 1,
    'a team seat written live opens the stage''s team room');

-- A solo freelancer's seat is not a team's: it opens no team room.
INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
VALUES (pg_temp.id('stage2'), 'freelancer', pg_temp.id('solo'), pg_temp.id('owner'), 'assigned');
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage2'), 'team_private') = 1,
    'a solo seat on a team-held stage adds no room');

-- A project with no business client gets no business rooms; re-pointed at a business, every stage does.
INSERT INTO probe_ids
SELECT 'solo_project', p.id FROM projects.projects p
 WHERE p.client_business_id IS NULL AND p.format::text <> 'session'
   AND EXISTS (SELECT 1 FROM projects.project_stages ps WHERE ps.project_id = p.id AND ps.archived_at IS NULL)
 ORDER BY p.created_at, p.id LIMIT 1;
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM comms.project_channels c
     WHERE c.project_id = pg_temp.id('solo_project') AND c.visibility = 'business_private'),
    'a project with no business client has no business rooms');
UPDATE projects.projects SET client_business_id = pg_temp.id('business') WHERE id = pg_temp.id('solo_project');
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM projects.project_stages ps
     WHERE ps.project_id = pg_temp.id('solo_project') AND ps.archived_at IS NULL
       AND (SELECT count(*) FROM comms.project_channels c
             WHERE c.stage_id = ps.id AND c.visibility = 'business_private') <> 1),
    'a project re-pointed at a business opens one business room on each of its stages');
-- #endregion

-- #region 5. A released team loses the room; the room and its messages stay
INSERT INTO probe_ids
SELECT 'team_room', c.id FROM comms.project_channels c
 WHERE c.stage_id = pg_temp.id('stage') AND c.visibility = 'team_private' AND c.team_id = pg_temp.id('team');
INSERT INTO comms.project_messages (channel_id, sender_user_id, body)
VALUES (pg_temp.id('team_room'), pg_temp.id('teammate'), 'probe: team-only note');

SELECT pg_temp.act(pg_temp.id('teammate'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.seen_messages(pg_temp.id('team_room')) >= 1,
    'the team member reads the team room''s messages');
RESET ROLE;

UPDATE projects.stage_assignments SET status = 'released' WHERE id = pg_temp.id('seat');

SELECT pg_temp.act(pg_temp.id('teammate'));
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(pg_temp.seen(pg_temp.id('stage'), 'team_private') = 0
              AND pg_temp.seen_messages(pg_temp.id('team_room')) = 0,
    'once the team''s seat is released its member reads neither the room nor its messages');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.held(pg_temp.id('stage'), 'team_private') = 2
              AND (SELECT count(*) FROM comms.project_messages m WHERE m.channel_id = pg_temp.id('team_room')) >= 1,
    'the room and its messages stay (nothing is deleted)');
-- #endregion

ROLLBACK;
