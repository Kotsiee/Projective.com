-- =============================================================================================
-- Probe: the setup form's Remove reaches projects.delete_stage, which hard-deletes only a stage
-- nobody claimed, funded or submitted against and refuses every other stage before anything moves
-- (Decision #338 P2 (b); PROJECTS ST2, Decision #553). projects.stage_removability tells the form
-- which is which, for the configuring side only.
--
-- THE DEFECT (2026-11-24): delete_stage released the held escrow of every claimed ticket on the
-- stage, detached its tickets and only then raised on escrow history, so a touched stage with no
-- escrow (a ticket nobody funded) was hard-deleted with its tickets cut loose, and a funded one
-- "released" money that the raise rolled back. fn_stage_has_history, the rule's own test, was
-- revoked from every caller, so nothing outside the sanitizer could ask it.
--
-- What is asserted, as the project's owner unless named:
--   1. A stage just created (with a staffing role, and a sibling waiting for it) reads removable;
--      delete_stage removes it, its room and its role, and frees the sibling's start dependency.
--   2. A stage holding a ticket reads not removable; delete_stage refuses it 55000 with the setup
--      form's sentence, and the ticket still sits on the stage.
--   3. A stage holding escrow reads not removable; delete_stage refuses it, and every escrow row on it
--      keeps its status.
--   4. The same refusal comes back through apply_write_batch's delete_stage op (the PUT path).
--   5. Anyone who cannot configure the project reads no rows and is refused 42501.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/stage_removal.sql
-- Fixtures are discovered from the seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

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

-- What stage_removability answers for one stage as the acting caller: true, false, or NULL (no row).
CREATE FUNCTION pg_temp.removable(p_stage uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT r.removable FROM projects.stage_removability(pg_temp.id('project')) r WHERE r.stage_id = p_stage;
$$;

-- delete_stage as the acting caller; returns the SQLSTATE and message it raised, or 'ok'.
CREATE FUNCTION pg_temp.try_delete(p_stage uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM projects.delete_stage(pg_temp.id('project'), p_stage);
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- The same delete through the write batch's rpc op, as the setup PUT sends it.
CREATE FUNCTION pg_temp.try_batch_delete(p_stage uuid) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    PERFORM projects.apply_write_batch(pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'kind', 'rpc', 'fn', 'delete_stage', 'field', 'stages',
        'args', pg_catalog.jsonb_build_object('p_project_id', pg_temp.id('project'), 'p_stage_id', p_stage))));
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
-- #endregion

-- #region 1. Fixtures (as postgres)
-- A staged client project whose owner configures it, with one stage holding escrow, and somebody who
-- cannot configure it.
DO $$
DECLARE
    c record;
    v_stranger uuid;
BEGIN
    FOR c IN
        SELECT p.id AS project, p.owner_user_id AS owner, e.project_stage_id AS funded
          FROM finance.escrows e
          JOIN projects.project_stages ps ON ps.id = e.project_stage_id AND ps.archived_at IS NULL
          JOIN projects.projects p ON p.id = ps.project_id
         WHERE p.structure_variation = 'standard' AND p.status = 'active'
           AND p.source_blueprint_id IS NULL AND p.client_user_id IS NULL
         ORDER BY p.id, ps.id
    LOOP
        PERFORM pg_temp.act(c.owner);
        CONTINUE WHEN NOT projects.can_edit_project_details(c.project);
        SELECT u.id INTO v_stranger FROM auth.users u WHERE u.id <> c.owner ORDER BY u.id LIMIT 1;
        PERFORM pg_temp.act(v_stranger);
        CONTINUE WHEN projects.can_edit_project_details(c.project);
        INSERT INTO probe_ids VALUES ('project', c.project), ('owner', c.owner), ('funded', c.funded),
            ('stranger', v_stranger);
        RAISE NOTICE 'fixture project=% owner=% funded=% stranger=%', c.project, c.owner, c.funded, v_stranger;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'PROBE FAIL: no fixture: need an active staged client project with escrow on a stage (deno task db:reset)';
END $$;

-- Three new stages as the owner: P (pristine, with a staffing role), W (waits for P), T (gets a ticket).
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.id('owner'));
    INSERT INTO probe_ids VALUES
        ('pristine', projects.create_stage(pg_temp.id('project'), 'Probe: pristine', '{"html": ""}'::jsonb, '', NULL)),
        ('waiting', projects.create_stage(pg_temp.id('project'), 'Probe: waits', '{"html": ""}'::jsonb, '', NULL)),
        ('touched', projects.create_stage(pg_temp.id('project'), 'Probe: touched', '{"html": ""}'::jsonb, '', NULL));
END $$;

INSERT INTO projects.stage_staffing_roles (project_stage_id, role_title, quantity, budget_amount_cents)
VALUES (pg_temp.id('pristine'), 'Probe role', 1, 0);
UPDATE projects.project_stages SET start_dependency_stage_id = pg_temp.id('pristine')
 WHERE id = pg_temp.id('waiting');
INSERT INTO projects.tickets (project_id, title, status, current_stage_id, text_description, description)
VALUES (pg_temp.id('project'), 'Probe: ticket on T', 'todo', pg_temp.id('touched'), 'Probe ticket',
        '{"html": "<p>Probe ticket</p>"}'::jsonb);

CREATE TEMP TABLE probe_escrows AS
    SELECT id, status FROM finance.escrows WHERE project_stage_id = pg_temp.id('funded');
-- #endregion

-- #region 2. The owner
SELECT pg_temp.act(pg_temp.id('owner'));

SELECT pg_temp.ok(pg_temp.removable(pg_temp.id('pristine')), 'a stage just created reads removable');
SELECT pg_temp.ok(NOT pg_temp.removable(pg_temp.id('touched')), 'a stage holding a ticket reads not removable');
SELECT pg_temp.ok(NOT pg_temp.removable(pg_temp.id('funded')), 'a stage holding escrow reads not removable');

SELECT pg_temp.ok(
    pg_temp.try_delete(pg_temp.id('touched'))
        = '55000 This stage has work or money on it. It can be archived once archiving ships.',
    'a touched stage is refused 55000 with the setup form''s sentence');
SELECT pg_temp.ok(
    (SELECT count(*) FROM projects.tickets WHERE current_stage_id = pg_temp.id('touched')) = 1,
    'its ticket still sits on it: nothing moved');

SELECT pg_temp.ok(pg_temp.try_delete(pg_temp.id('funded')) LIKE '55000 %', 'a funded stage is refused 55000');
SELECT pg_temp.ok(
    NOT EXISTS (
        SELECT 1 FROM probe_escrows b JOIN finance.escrows e ON e.id = b.id WHERE e.status <> b.status)
    AND (SELECT count(*) FROM finance.escrows WHERE project_stage_id = pg_temp.id('funded'))
        = (SELECT count(*) FROM probe_escrows),
    'every escrow on it keeps its status');

SELECT pg_temp.ok(pg_temp.try_batch_delete(pg_temp.id('touched')) LIKE '55000 This stage has work or money on it.%',
    'the write batch''s delete_stage op is refused the same way');

SELECT pg_temp.ok(pg_temp.try_delete(pg_temp.id('pristine')) = 'ok', 'the pristine stage is deleted');
SELECT pg_temp.ok(
    NOT EXISTS (SELECT 1 FROM projects.project_stages WHERE id = pg_temp.id('pristine'))
    AND NOT EXISTS (SELECT 1 FROM comms.project_channels WHERE stage_id = pg_temp.id('pristine'))
    AND NOT EXISTS (SELECT 1 FROM projects.stage_staffing_roles WHERE project_stage_id = pg_temp.id('pristine')),
    'the stage, its room and its staffing role are gone');
SELECT pg_temp.ok(
    (SELECT start_dependency_stage_id IS NULL FROM projects.project_stages WHERE id = pg_temp.id('waiting')),
    'the stage that waited for it no longer does');
SELECT pg_temp.ok(pg_temp.removable(pg_temp.id('pristine')) IS NULL, 'a deleted stage is no longer listed');
-- #endregion

-- #region 3. Somebody who cannot configure the project
SELECT pg_temp.act(pg_temp.id('stranger'));

SELECT pg_temp.ok(
    NOT EXISTS (SELECT 1 FROM projects.stage_removability(pg_temp.id('project'))),
    'a caller who cannot configure the project reads no rows');
SELECT pg_temp.ok(pg_temp.try_delete(pg_temp.id('waiting')) LIKE '42501 %', 'and is refused 42501');
-- #endregion

ROLLBACK;
