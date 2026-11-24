-- =============================================================================================
-- Probe: ST1 — a setup save carries the version it was made from, and a save made from a stale
-- copy is refused with the current version, never merged (projects.apply_write_batch's `version` op).
--
--   1. Two saves start from the same version: the first lands and advances it; the second is
--      refused PS409 with the current version in DETAIL and `field:form`, and writes nothing.
--   2. A save carrying the current version lands.
--   3. A save that writes only a stage still advances the project's version.
--   4. A caller who may not edit the project is refused as not written, and learns no version.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/setup_stale_write.sql
--
-- Fixture (seeded): the oldest unarchived client project with a stage, its owner, and the first user
-- with no access to it. A clean run prints only `ok` notices.
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

-- Act as p_uid, as the app does: the authenticated role under that user's claims.
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid::text, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.version() RETURNS timestamptz LANGUAGE sql AS $$
    SELECT p.updated_at FROM projects.projects p WHERE p.id = pg_temp.id('project');
$$;

-- A setup save: the version op, then a title write.
CREATE FUNCTION pg_temp.save(p_expected timestamptz, p_title text) RETURNS jsonb LANGUAGE sql AS $$
    SELECT projects.apply_write_batch(pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('kind', 'version', 'id', pg_temp.id('project'),
            'expected', p_expected, 'field', 'form'),
        pg_catalog.jsonb_build_object('kind', 'update', 'table', 'projects', 'id', pg_temp.id('project'),
            'patch', pg_catalog.jsonb_build_object('title', p_title))));
$$;

GRANT EXECUTE ON FUNCTION pg_temp.id(text), pg_temp.ok(boolean, text), pg_temp.version(),
    pg_temp.save(timestamptz, text) TO authenticated;
GRANT SELECT ON probe_ids TO authenticated;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v record;
    v_stranger uuid;
BEGIN
    SELECT p.id AS project, p.owner_user_id AS owner, s.id AS stage
      INTO v
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id AND s.archived_at IS NULL
     WHERE p.archived_at IS NULL AND p.source_blueprint_id IS NULL AND p.is_personal IS NOT TRUE
     ORDER BY p.created_at, p.id, s.sort_order
     LIMIT 1;
    PERFORM pg_temp.ok(v.project IS NOT NULL, 'fixture: a seeded client project with a stage');

    INSERT INTO probe_ids VALUES ('project', v.project), ('owner', v.owner), ('stage', v.stage);

    FOR v_stranger IN SELECT u.user_id FROM org.users_public u ORDER BY u.user_id LOOP
        PERFORM pg_temp.act(v_stranger);
        EXIT WHEN NOT projects.has_project_access(v.project) AND NOT projects.can_review_project(v.project);
        v_stranger := NULL;
    END LOOP;
    PERFORM pg_catalog.set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.ok(v_stranger IS NOT NULL, 'fixture: a user with no access to the project');
    INSERT INTO probe_ids VALUES ('stranger', v_stranger);
END $$;
-- #endregion

-- #region 1. Two saves from one version: the second is refused, the first stands
DO $$
DECLARE
    v_seen timestamptz := pg_temp.version();
    v_state text;
    v_detail text;
    v_hint text;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('owner'));
    SET LOCAL ROLE authenticated;

    PERFORM pg_temp.save(v_seen, 'probe: tab one');
    PERFORM pg_temp.ok(pg_temp.version() > v_seen, 'the first save advances the version');

    BEGIN
        PERFORM pg_temp.save(v_seen, 'probe: tab two');
        v_state := 'none';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;
    END;
    PERFORM pg_temp.ok(v_state = 'PS409', 'a save from the same version is refused PS409 (got ' || v_state || ')');
    PERFORM pg_temp.ok(v_detail::timestamptz = pg_temp.version(), 'the refusal names the current version');
    PERFORM pg_temp.ok(v_hint = 'field:form', 'the refusal is reported against the form');
    PERFORM pg_temp.ok(
        (SELECT p.title FROM projects.projects p WHERE p.id = pg_temp.id('project')) = 'probe: tab one',
        'the stale save wrote nothing over the first');
    RESET ROLE;
END $$;
-- #endregion

-- #region 2. A save carrying the current version lands
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.id('owner'));
    SET LOCAL ROLE authenticated;
    PERFORM pg_temp.save(pg_temp.version(), 'probe: tab one, again');
    PERFORM pg_temp.ok(
        (SELECT p.title FROM projects.projects p WHERE p.id = pg_temp.id('project')) = 'probe: tab one, again',
        'a save from the current version lands');
    RESET ROLE;
END $$;
-- #endregion

-- #region 3. A stage-only save advances the project's version
-- The version is wound back with triggers off (as postgres), because inside one transaction now() does
-- not move and an advance would be invisible.
SET LOCAL session_replication_role = replica;
UPDATE projects.projects SET updated_at = updated_at - interval '1 hour' WHERE id = pg_temp.id('project');
SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    v_seen timestamptz := pg_temp.version();
BEGIN
    PERFORM pg_temp.act(pg_temp.id('owner'));
    SET LOCAL ROLE authenticated;
    PERFORM projects.apply_write_batch(pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('kind', 'version', 'id', pg_temp.id('project'), 'expected', v_seen),
        pg_catalog.jsonb_build_object('kind', 'update', 'table', 'project_stages', 'id', pg_temp.id('stage'),
            'patch', pg_catalog.jsonb_build_object('milestone', 'probe milestone'), 'field', 'stages')));
    PERFORM pg_temp.ok(pg_temp.version() > v_seen, 'a stage-only save advances the project version');
    RESET ROLE;
END $$;
-- #endregion

-- #region 4. A caller who may not edit is refused as not written, and learns no version
DO $$
DECLARE
    v_state text;
    v_detail text;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('stranger'));
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM projects.apply_write_batch(pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('kind', 'version', 'id', pg_temp.id('project'),
                'expected', '2000-01-01T00:00:00Z')));
        v_state := 'none';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_detail = PG_EXCEPTION_DETAIL;
    END;
    PERFORM pg_temp.ok(v_state = 'PW403', 'a stranger''s version op is not written (got ' || v_state || ')');
    PERFORM pg_temp.ok(COALESCE(v_detail, '') = '', 'a stranger is told no version');
    RESET ROLE;
END $$;
-- #endregion

ROLLBACK;
