-- =============================================================================================
-- Probe: a restore lands where the entity's history says (Decision #250 (c); #236 (d) for a business).
-- org.fn_workspace_restore_target answers `active` for an entity whose status trail
-- (`security.audit_logs` `{kind}.status_changed`, metadata {from, to}) ever touched `active`, else
-- `draft` — and `draft` for an entity with no trail at all (a seeded or hand-written row: no evidence
-- it was ever published). org.set_workspace_status takes `restore` and lands there; naming the other
-- status outright is refused `22023 restore_target:` with DETAIL {target}; `restore` on an entity that
-- is not archived is refused; restoring still needs `archive_entity`. org.get_workspace_detail answers
-- `restore_target` while the entity is archived, `null` otherwise.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/team_restore_target.sql
--
-- Fixture (seeded data, adjusted inside the transaction): the seeded team `studiofern` — owner L
-- (holds archive_entity), member M (does not) — and the seeded business `heliafinance`, owner B. Each
-- case clears the entity's status trail and sets its status with triggers off, so it starts from a
-- known history; the doors under test then run as the caller with triggers on.
-- =============================================================================================

BEGIN;

-- @prelude

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.fail(p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_fails VALUES (p_label);
    RAISE NOTICE 'FAIL % — %', p_label, p_why;
END $$;

CREATE FUNCTION pg_temp.expect(p_label text, p_ok boolean, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok THEN
        RAISE NOTICE 'PASS %', p_label;
    ELSE
        PERFORM pg_temp.fail(p_label, p_why);
    END IF;
END $$;

-- Start an entity from a known history: no status trail, and the given status (triggers off).
CREATE FUNCTION pg_temp.reset(p_kind text, p_id uuid, p_status text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM security.audit_logs a WHERE a.entity_id = p_id AND a.action = p_kind || '.status_changed';
    SET LOCAL session_replication_role = replica;
    IF p_kind = 'team' THEN
        UPDATE org.teams SET status = p_status WHERE id = p_id;
    ELSE
        UPDATE org.business_profiles SET status = p_status WHERE id = p_id;
    END IF;
    SET LOCAL session_replication_role = origin;
END $$;

-- Change the status through the door as the given caller: the status it landed on, or the refusal
-- as `<sqlstate> <message> | <detail>`. Lands for real — the caller's case rolls it back.
CREATE FUNCTION pg_temp.move(p_caller uuid, p_kind text, p_id uuid, p_status text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
    v_detail text;
BEGIN
    PERFORM pg_temp.act(p_caller);
    RETURN org.set_workspace_status(p_kind, p_id, p_status)->>'status';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    RETURN v_state || ' ' || v_msg || ' | ' || COALESCE(v_detail, '');
END $$;

-- The detail's `restore_target` as the given viewer (`null` as the text 'null').
CREATE FUNCTION pg_temp.detail_target(p_viewer uuid, p_kind text, p_handle text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_viewer);
    RETURN COALESCE(org.get_workspace_detail(p_kind, p_handle)->>'restore_target', 'null');
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_lead uuid;
    v_member uuid;
    v_biz uuid;
    v_biz_owner uuid;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_lead FROM org.teams t WHERE t.slug = 'studiofern';
    SELECT m.user_id INTO v_member FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active' AND m.user_id <> v_lead
     ORDER BY m.user_id LIMIT 1;
    SELECT b.id, b.owner_user_id INTO v_biz, v_biz_owner FROM org.business_profiles b WHERE b.slug = 'heliafinance';
    IF v_team IS NULL OR v_member IS NULL OR v_biz IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %, business %) — deno task db:reset', v_team, v_member, v_biz;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e WHERE e.status = 'held' AND e.payee_type = 'team' AND e.payee_id = v_team)
        OR EXISTS (SELECT 1 FROM projects.stage_assignments sa WHERE sa.team_id = v_team) THEN
        RAISE EXCEPTION 'FAIL fixture: studiofern holds an escrow or an assignment, so it cannot archive';
    END IF;
    INSERT INTO probe_ids VALUES
        ('team', v_team), ('lead', v_lead), ('member', v_member), ('biz', v_biz), ('biz_owner', v_biz_owner);
END $$;
-- #endregion

-- #region A. A published team restores to active, and nothing sends it back to draft
DO $$
DECLARE
    v text;
    v_lost text[];
BEGIN
    BEGIN
        PERFORM pg_temp.reset('team', pg_temp.id('team'), 'active');
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'archived');
        PERFORM pg_temp.expect('A1 a published team archives', v = 'archived', v);
        PERFORM pg_temp.expect('A2 its restore target is active',
            org.fn_workspace_restore_target('team', pg_temp.id('team')) = 'active',
            org.fn_workspace_restore_target('team', pg_temp.id('team')));
        v := pg_temp.detail_target(pg_temp.id('lead'), 'team', 'studiofern');
        PERFORM pg_temp.expect('A3 the detail names it before anybody presses Restore', v = 'active', v);
        v := pg_temp.detail_target(pg_temp.id('member'), 'team', 'studiofern');
        PERFORM pg_temp.expect('A4 … for every member (a fact, not a right)', v = 'active', v);
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'draft');
        PERFORM pg_temp.expect('A5 restoring it to draft is refused, the target in DETAIL',
            v LIKE '22023 restore_target: this team was published, so it is restored to active%'
                AND COALESCE(NULLIF(split_part(v, ' | ', 2), ''), 'null')::jsonb = '{"target": "active"}'::jsonb, v);
        v := pg_temp.move(pg_temp.id('member'), 'team', pg_temp.id('team'), 'restore');
        PERFORM pg_temp.expect('A6 a member without archive_entity cannot restore', v LIKE '42501 %', v);
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'restore');
        PERFORM pg_temp.expect('A7 restore lands on active', v = 'active', v);
        PERFORM pg_temp.expect('A8 … and the trail says so', EXISTS (
            SELECT 1 FROM security.audit_logs a
             WHERE a.entity_id = pg_temp.id('team') AND a.action = 'team.status_changed'
               AND a.metadata = '{"from": "archived", "to": "active"}'::jsonb), 'no archived → active row');
        v := pg_temp.detail_target(pg_temp.id('lead'), 'team', 'studiofern');
        PERFORM pg_temp.expect('A9 an active team has no restore target', v = 'null', v);
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'restore');
        PERFORM pg_temp.expect('A10 restore on a team that is not archived is refused',
            v LIKE '22023 status: only an archived team is restored%', v);
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
END $$;
-- #endregion

-- #region B. A team that was never published restores to draft — until it publishes
DO $$
DECLARE
    v text;
    v_lost text[];
BEGIN
    BEGIN
        PERFORM pg_temp.reset('team', pg_temp.id('team'), 'draft');
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'archived');
        PERFORM pg_temp.expect('B1 a draft team archives', v = 'archived', v);
        v := pg_temp.detail_target(pg_temp.id('lead'), 'team', 'studiofern');
        PERFORM pg_temp.expect('B2 its restore target is draft', v = 'draft', v);
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'active');
        PERFORM pg_temp.expect('B3 restoring it straight to active is refused, the target in DETAIL',
            v LIKE '22023 restore_target: this team was never published, so it is restored as a draft%'
                AND COALESCE(NULLIF(split_part(v, ' | ', 2), ''), 'null')::jsonb = '{"target": "draft"}'::jsonb, v);
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'restore');
        PERFORM pg_temp.expect('B4 restore lands on draft', v = 'draft', v);
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'active');
        PERFORM pg_temp.expect('B5 it publishes from there', v = 'active', v);
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'archived');
        PERFORM pg_temp.expect('B6 … archives again', v = 'archived', v);
        PERFORM pg_temp.expect('B7 … and now restores to active',
            org.fn_workspace_restore_target('team', pg_temp.id('team')) = 'active',
            org.fn_workspace_restore_target('team', pg_temp.id('team')));
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'active');
        PERFORM pg_temp.expect('B8 naming the right target outright is accepted', v = 'active', v);
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
END $$;
-- #endregion

-- #region C. No trail at all — a seeded or hand-written archived row restores to draft
DO $$
DECLARE
    v text;
    v_lost text[];
BEGIN
    BEGIN
        PERFORM pg_temp.reset('team', pg_temp.id('team'), 'archived');
        PERFORM pg_temp.expect('C1 no evidence of publishing is a draft target',
            org.fn_workspace_restore_target('team', pg_temp.id('team')) = 'draft',
            org.fn_workspace_restore_target('team', pg_temp.id('team')));
        v := pg_temp.move(pg_temp.id('lead'), 'team', pg_temp.id('team'), 'restore');
        PERFORM pg_temp.expect('C2 restore lands on draft', v = 'draft', v);
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
END $$;
-- #endregion

-- #region D. A business follows the same rule (#236 (d), ruled as a team's)
DO $$
DECLARE
    v text;
    v_lost text[];
BEGIN
    BEGIN
        PERFORM pg_temp.reset('business', pg_temp.id('biz'), 'archived');
        v := pg_temp.detail_target(pg_temp.id('biz_owner'), 'business', 'heliafinance');
        PERFORM pg_temp.expect('D1 an archived business with no trail restores to draft', v = 'draft', v);
        INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
        VALUES (pg_temp.id('biz_owner'), 'business.status_changed', 'org.business_profiles', pg_temp.id('biz'),
                '{"from": "active", "to": "archived"}'::jsonb);
        v := pg_temp.detail_target(pg_temp.id('biz_owner'), 'business', 'heliafinance');
        PERFORM pg_temp.expect('D2 one that was live restores to active', v = 'active', v);
        PERFORM pg_temp.expect('D3 the trail is kind-scoped — a business''s rows never answer for a team',
            org.fn_workspace_restore_target('team', pg_temp.id('biz')) = 'draft',
            org.fn_workspace_restore_target('team', pg_temp.id('biz')));
        v := pg_temp.move(pg_temp.id('biz_owner'), 'business', pg_temp.id('biz'), 'draft');
        PERFORM pg_temp.expect('D4 restoring it to draft is refused',
            v LIKE '22023 restore_target: this business was published%', v);
        v := pg_temp.move(pg_temp.id('biz_owner'), 'business', pg_temp.id('biz'), 'restore');
        PERFORM pg_temp.expect('D5 restore lands on active', v = 'active', v);
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
END $$;
-- #endregion

DO $$
DECLARE
    v_fails integer := (SELECT count(*) FROM probe_fails);
BEGIN
    IF v_fails > 0 THEN
        RAISE EXCEPTION 'FAIL % case(s): %', v_fails, (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'team_restore_target: all cases PASS';
END $$;

ROLLBACK;
