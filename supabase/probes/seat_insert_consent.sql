-- =============================================================================================
-- Probe: no project owner writes a freelancer's seat or a participant row directly; seats and
-- participants are written only through their doors (PROJECTS ST5; PRODUCT_SPEC §Stage invitations,
-- Decision #139: "a stage is never assigned without the freelancer's acceptance").
--
--   1. Under the owner's JWT, every direct write is refused with 42501: INSERT a seat (taken or
--      parked) for a freelancer who never accepted, flip a parked seat to `assigned`, delete it;
--      INSERT a participant row, change a participant's role, remove one.
--   2. The owner still reads the project's seats and participants, and a seated freelancer still
--      reads their own participant row.
--   3. The catalogue agrees: neither table carries a policy other than SELECT, and no client role
--      holds INSERT, UPDATE or DELETE on it (the service role keeps them for its doors).
--
-- The doors themselves (assign_from_application, fn_apply_invitation_decision, the stage-invite and
-- instantiation paths) are SECURITY DEFINER and are exercised by seat_fill_concurrency,
-- business_authority and payout_ready_gate.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/seat_insert_consent.sql
--
-- Every check runs, then one `PROBE FAIL` names how many failed, so a red run shows the whole hole.
-- A clean run prints only `ok` notices.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS TRUE THEN
        RAISE NOTICE 'ok  %', p_what;
    ELSE
        PERFORM pg_catalog.set_config('probe.fails',
            (COALESCE(NULLIF(pg_catalog.current_setting('probe.fails', true), ''), '0')::int + 1)::text, true);
        RAISE NOTICE 'FAIL %', p_what;
    END IF;
END $$;

-- Runs p_sql and rolls its effect back whatever happens; ok only when it is refused with 42501.
CREATE FUNCTION pg_temp.refused(p_sql text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_got text;
BEGIN
    BEGIN
        EXECUTE p_sql;
        RAISE EXCEPTION 'probe: the statement succeeded';
    EXCEPTION WHEN OTHERS THEN
        v_got := SQLSTATE || ' ' || SQLERRM;
    END;
    PERFORM pg_temp.ok(v_got LIKE '42501 %', p_what || ' (got: ' || v_got || ')');
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.act(p_uid text) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text), pg_temp.refused(text, text), pg_temp.s(text),
    pg_temp.act(text) TO authenticated;
-- #endregion

-- #region Fixtures (as postgres): a non-personal project with an accepted freelancer seat whose holder
-- is on the roster, its owner, and two adult freelancers with no seat or roster row there.
DO $$
DECLARE
    c record;
    v_stranger uuid;
    v_holder uuid;
    v_parked uuid;
BEGIN
    SELECT sa.id AS seat, sa.project_stage_id AS stage, sa.freelancer_profile_id AS freelancer,
           p.id AS project, p.owner_user_id AS owner, pp.id AS participant
      INTO c
      FROM projects.stage_assignments sa
      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
      JOIN projects.projects p ON p.id = ps.project_id
      JOIN projects.project_participants pp
        ON pp.project_id = p.id AND pp.profile_type = 'freelancer' AND pp.profile_id = sa.freelancer_profile_id
     WHERE sa.assignee_type = 'freelancer' AND sa.status = 'accepted'
       AND sa.freelancer_profile_id <> p.owner_user_id
       AND NOT projects.fn_is_personal_project(p.id)
     ORDER BY sa.id LIMIT 1;
    IF c.seat IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: need an accepted freelancer seat whose holder is on the roster';
    END IF;

    SELECT pg_catalog.min(fp.user_id::text)::uuid,
           (pg_catalog.array_agg(fp.user_id ORDER BY fp.user_id))[2]
      INTO v_stranger, v_holder
      FROM org.freelancer_profiles fp
     WHERE fp.user_id <> c.owner
       AND NOT org.fn_is_minor(fp.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments x
                         JOIN projects.project_stages s ON s.id = x.project_stage_id
                        WHERE s.project_id = c.project AND x.freelancer_profile_id = fp.user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants x
                        WHERE x.project_id = c.project AND x.profile_id = fp.user_id);
    IF v_holder IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: need two adult freelancers with no place on project %', c.project;
    END IF;

    -- A parked seat (never taken) for a second freelancer, so the taken-seat guard lets it move and
    -- only the grant decides.
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
    VALUES (c.stage, 'freelancer', v_holder, c.owner, 'pending_funding')
    RETURNING id INTO v_parked;

    PERFORM pg_catalog.set_config('probe.seat', c.seat::text, true);
    PERFORM pg_catalog.set_config('probe.stage', c.stage::text, true);
    PERFORM pg_catalog.set_config('probe.freelancer', c.freelancer::text, true);
    PERFORM pg_catalog.set_config('probe.project', c.project::text, true);
    PERFORM pg_catalog.set_config('probe.owner', c.owner::text, true);
    PERFORM pg_catalog.set_config('probe.participant', c.participant::text, true);
    PERFORM pg_catalog.set_config('probe.stranger', v_stranger::text, true);
    PERFORM pg_catalog.set_config('probe.parked', v_parked::text, true);
    PERFORM pg_catalog.set_config('probe.fails', '0', true);
    RAISE NOTICE 'fixture project=% owner=% seat=% stranger=%', c.project, c.owner, c.seat, v_stranger;
END $$;
-- #endregion

-- #region 1. The owner's direct writes are refused
SELECT pg_temp.act(pg_temp.s('owner'));
SET LOCAL ROLE authenticated;

SELECT pg_temp.refused(pg_catalog.format(
    $q$INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
       VALUES (%L, 'freelancer', %L, %L, 'accepted')$q$,
    pg_temp.s('stage'), pg_temp.s('stranger'), pg_temp.s('owner')),
    'the owner cannot seat a freelancer who never accepted (accepted)');
SELECT pg_temp.refused(pg_catalog.format(
    $q$INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
       VALUES (%L, 'freelancer', %L, %L, 'pending_funding')$q$,
    pg_temp.s('stage'), pg_temp.s('stranger'), pg_temp.s('owner')),
    'the owner cannot park a seat for a freelancer (pending_funding)');
SELECT pg_temp.refused(pg_catalog.format(
    $q$UPDATE projects.stage_assignments SET status = 'assigned' WHERE id = %L$q$, pg_temp.s('parked')),
    'the owner cannot flip a parked seat to assigned');
SELECT pg_temp.refused(pg_catalog.format(
    $q$DELETE FROM projects.stage_assignments WHERE id = %L$q$, pg_temp.s('parked')),
    'the owner cannot delete a seat');
SELECT pg_temp.refused(pg_catalog.format(
    $q$INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
       VALUES (%L, 'freelancer', %L, 'assignee')$q$,
    pg_temp.s('project'), pg_temp.s('stranger')),
    'the owner cannot add a participant who never accepted');
SELECT pg_temp.refused(pg_catalog.format(
    $q$UPDATE projects.project_participants SET role = 'admin' WHERE id = %L$q$, pg_temp.s('participant')),
    'the owner cannot change a participant''s role outside set_member_role');
SELECT pg_temp.refused(pg_catalog.format(
    $q$DELETE FROM projects.project_participants WHERE id = %L$q$, pg_temp.s('participant')),
    'the owner cannot remove a participant outside remove_project_member');
-- #endregion

-- #region 2. The reads the product needs still answer
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM projects.stage_assignments WHERE id = pg_temp.s('seat')::uuid),
    'the owner still reads the project''s seats');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM projects.project_participants WHERE id = pg_temp.s('participant')::uuid),
    'the owner still reads the project''s participants');

SELECT pg_temp.act(pg_temp.s('freelancer'));
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM projects.project_participants WHERE id = pg_temp.s('participant')::uuid),
    'the seated freelancer still reads their own participant row');
RESET ROLE;
-- #endregion

-- #region 3. The catalogue: SELECT-only policies, no client write grant
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'projects' AND tablename IN ('stage_assignments', 'project_participants')
       AND cmd <> 'SELECT'),
    'neither table carries a policy other than SELECT');
SELECT pg_temp.ok(NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY['anon', 'authenticated']) r(role),
           unnest(ARRAY['projects.stage_assignments', 'projects.project_participants']) t(tbl),
           unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p(priv)
     WHERE pg_catalog.has_table_privilege(r.role, t.tbl, p.priv)),
    'no client role holds INSERT, UPDATE or DELETE on either table');
SELECT pg_temp.ok(
    pg_catalog.has_table_privilege('authenticated', 'projects.stage_assignments', 'SELECT')
    AND pg_catalog.has_table_privilege('authenticated', 'projects.project_participants', 'SELECT'),
    'authenticated keeps SELECT on both tables');
SELECT pg_temp.ok(
    pg_catalog.has_table_privilege('service_role', 'projects.stage_assignments', 'INSERT')
    AND pg_catalog.has_table_privilege('service_role', 'projects.project_participants', 'INSERT'),
    'the service role keeps its writes for the server doors');
-- #endregion

DO $$
BEGIN
    IF pg_catalog.current_setting('probe.fails')::int > 0 THEN
        RAISE EXCEPTION 'PROBE FAIL: % check(s) failed', pg_catalog.current_setting('probe.fails');
    END IF;
END $$;

ROLLBACK;
