-- =============================================================================================
-- Probe: a team's archive blockers are answered BEFORE the confirm (Teams C6; TEAMS_AUDIT S3, S4).
-- org.fn_team_archive_blockers lists what would refuse an archive — `escrow_held` (money held for the
-- team's work) and `live_assignments` (a live stage assignment on an active / on-hold project) — and
-- org.get_workspace_detail answers that list as `archive_blockers` to an `archive_entity` holder only,
-- so Settings shows the blocker instead of an Archive button that would fail. The archive door refuses
-- on the first blocker with its `status:` sentence unchanged and every blocker in DETAIL.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/team_archive_blockers.sql
--
-- Fixture (seeded data, adjusted inside the transaction with triggers off): the seeded team
-- `studiofern` — owner L (holds archive_entity), member M (does not) — a stranger freelancer N, and a
-- ticket T on a stage S of a project no member owns. The team is given an assignment on S whose status
-- each case sets; each case inserts at most one held escrow on S and rolls it back.
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

-- The team's assignment on S and its project's status, set with triggers off.
CREATE FUNCTION pg_temp.set_assignment(p_status text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE projects.stage_assignments SET status = p_status WHERE id = pg_temp.id('assignment');
    SET LOCAL session_replication_role = origin;
END $$;

-- One held escrow on S for p_payee_type / p_payee (both NULL = unbound, on T), triggers off.
CREATE FUNCTION pg_temp.hold(p_payee_type assignment_type, p_payee uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    SET LOCAL session_replication_role = replica;
    INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_business_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (pg_temp.id('stage'), pg_temp.id('ticket'), pg_temp.id('payer_business'),
            CASE WHEN pg_temp.id('payer_business') IS NULL THEN pg_temp.id('payer') END,
            p_payee_type, p_payee, 25000, 'USD', 'held');
    SET LOCAL session_replication_role = origin;
END $$;

-- The detail's `archive_blockers` as the given viewer.
CREATE FUNCTION pg_temp.blockers(p_viewer uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_viewer);
    RETURN org.get_workspace_detail('team', 'studiofern')->'archive_blockers';
END $$;

-- Archive the team as L in a subtransaction that is always rolled back: the refusal, or 'accepted'.
CREATE FUNCTION pg_temp.attempt(OUT state text, OUT message text, OUT detail text) LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        PERFORM pg_temp.act(pg_temp.id('lead'));
        PERFORM org.set_workspace_status('team', pg_temp.id('team'), 'archived');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, message = MESSAGE_TEXT, detail = PG_EXCEPTION_DETAIL;
    END;
    IF state = 'PX000' THEN
        state := 'accepted';
        message := NULL;
        detail := NULL;
    END IF;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_lead uuid;
    v_member uuid;
    v_stranger uuid;
    v_stage uuid;
    v_ticket uuid;
    v_project uuid;
    v_payer uuid;
    v_payer_business uuid;
    v_assignment uuid;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_lead FROM org.teams t WHERE t.slug = 'studiofern';
    SELECT m.user_id INTO v_member FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active' AND m.user_id <> v_lead
     ORDER BY m.user_id LIMIT 1;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;

    SELECT s.id, tk.id, p.id, p.owner_user_id, p.client_business_id
      INTO v_stage, v_ticket, v_project, v_payer, v_payer_business
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id
      JOIN projects.tickets tk ON tk.current_stage_id = s.id
     WHERE p.owner_user_id IS DISTINCT FROM v_stranger
       AND p.status IN ('active', 'on_hold')
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = p.owner_user_id)
       AND NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.project_stage_id = s.id AND e.status = 'held')
     ORDER BY s.id, tk.id
     LIMIT 1;

    IF v_team IS NULL OR v_member IS NULL OR v_stranger IS NULL OR v_stage IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %, stranger %, stage %) — deno task db:reset',
            v_team, v_member, v_stranger, v_stage;
    END IF;
    IF org.fn_member_can('team', v_team, 'archive_entity') IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: org.fn_member_can is missing';
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e WHERE e.status = 'held' AND e.payee_type = 'team' AND e.payee_id = v_team)
        OR EXISTS (SELECT 1 FROM projects.stage_assignments sa WHERE sa.team_id = v_team) THEN
        RAISE EXCEPTION 'FAIL fixture: studiofern already holds an escrow or an assignment';
    END IF;

    SET LOCAL session_replication_role = replica;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, team_id, assigned_by, status)
    VALUES (v_stage, 'team', v_team, v_payer, 'completed')
    RETURNING id INTO v_assignment;
    SET LOCAL session_replication_role = origin;

    INSERT INTO probe_ids VALUES
        ('team', v_team), ('lead', v_lead), ('member', v_member), ('stranger', v_stranger),
        ('stage', v_stage), ('ticket', v_ticket), ('project', v_project), ('payer', v_payer),
        ('payer_business', v_payer_business), ('assignment', v_assignment);
END $$;
-- #endregion

-- #region A. Nothing in flight — no blocker, and the archive goes through
DO $$
DECLARE
    a record;
BEGIN
    PERFORM pg_temp.set_assignment('completed');
    PERFORM pg_temp.expect('A1 a completed assignment and no escrow block nothing',
        pg_temp.blockers(pg_temp.id('lead')) = '[]'::jsonb,
        format('archive_blockers = %s', pg_temp.blockers(pg_temp.id('lead'))));
    SELECT * INTO a FROM pg_temp.attempt();
    PERFORM pg_temp.expect('A2 … and the archive goes through', a.state = 'accepted',
        format('refused %s "%s"', a.state, a.message));
END $$;
-- #endregion

-- #region B. A held escrow — the blocker before the confirm, the same refusal at the door
DO $$
DECLARE
    a record;
    v_owner jsonb;
    v_member jsonb;
    v_lost text[];
BEGIN
    BEGIN
        PERFORM pg_temp.set_assignment('completed');
        PERFORM pg_temp.hold('team', pg_temp.id('team'));
        v_owner := pg_temp.blockers(pg_temp.id('lead'));
        v_member := pg_temp.blockers(pg_temp.id('member'));
        PERFORM pg_temp.expect('B1 an escrow owed to the team is listed to the archive holder',
            v_owner = '[{"code": "escrow_held", "count": 1}]'::jsonb, format('archive_blockers = %s', v_owner));
        PERFORM pg_temp.expect('B2 … and to nobody without archive_entity', v_member = '[]'::jsonb,
            format('member sees %s', v_member));
        SELECT * INTO a FROM pg_temp.attempt();
        PERFORM pg_temp.expect('B3 the door refuses with the escrow sentence, unchanged',
            a.state = '55000' AND a.message = 'status: money is held in escrow for this team — let it release first',
            format('refused %s "%s"', a.state, a.message));
        PERFORM pg_temp.expect('B4 … and every blocker in DETAIL',
            COALESCE(NULLIF(a.detail, ''), 'null')::jsonb = '{"blockers": [{"code": "escrow_held", "count": 1}]}'::jsonb,
            format('DETAIL %s', a.detail));
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
END $$;

DO $$
DECLARE
    v jsonb;
    v_lost text[];
BEGIN
    BEGIN
        PERFORM pg_temp.set_assignment('accepted');
        SET LOCAL session_replication_role = replica;
        UPDATE projects.projects SET status = 'completed' WHERE id = pg_temp.id('project');
        SET LOCAL session_replication_role = origin;
        PERFORM pg_temp.hold('freelancer', pg_temp.id('member'));
        v := pg_temp.blockers(pg_temp.id('lead'));
        PERFORM pg_temp.expect('B5 an escrow bound to a member on a team-assigned stage is the team''s',
            v = '[{"code": "escrow_held", "count": 1}]'::jsonb, format('archive_blockers = %s', v));
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
    BEGIN
        PERFORM pg_temp.set_assignment('completed');
        PERFORM pg_temp.hold(NULL, NULL);
        v := pg_temp.blockers(pg_temp.id('lead'));
        PERFORM pg_temp.expect('B6 an unbound escrow on a team-assigned stage is the team''s',
            v = '[{"code": "escrow_held", "count": 1}]'::jsonb, format('archive_blockers = %s', v));
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
    BEGIN
        PERFORM pg_temp.set_assignment('completed');
        PERFORM pg_temp.hold('freelancer', pg_temp.id('stranger'));
        v := pg_temp.blockers(pg_temp.id('lead'));
        PERFORM pg_temp.expect('B7 a non-member''s escrow on a shared stage is not the team''s',
            v = '[]'::jsonb, format('archive_blockers = %s', v));
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
    BEGIN
        PERFORM pg_temp.set_assignment('released');
        PERFORM pg_temp.hold('freelancer', pg_temp.id('member'));
        v := pg_temp.blockers(pg_temp.id('lead'));
        PERFORM pg_temp.expect('B8 a stage the team handed back holds nothing of the team''s',
            v = '[]'::jsonb, format('archive_blockers = %s', v));
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
END $$;
-- #endregion

-- #region C. A live assignment — listed, and both blockers in the door's order
DO $$
DECLARE
    a record;
    v jsonb;
    v_lost text[];
BEGIN
    BEGIN
        PERFORM pg_temp.set_assignment('accepted');
        v := pg_temp.blockers(pg_temp.id('lead'));
        PERFORM pg_temp.expect('C1 a live stage assignment is listed',
            v = '[{"code": "live_assignments", "count": 1}]'::jsonb, format('archive_blockers = %s', v));
        SELECT * INTO a FROM pg_temp.attempt();
        PERFORM pg_temp.expect('C2 the door refuses with the live-work sentence, unchanged',
            a.state = '55000' AND a.message = 'status: this team is still assigned to live work — finish or hand it back first'
                AND COALESCE(NULLIF(a.detail, ''), 'null')::jsonb = jsonb_build_object('blockers', v),
            format('refused %s "%s" DETAIL %s', a.state, a.message, a.detail));

        PERFORM pg_temp.hold('team', pg_temp.id('team'));
        v := pg_temp.blockers(pg_temp.id('lead'));
        PERFORM pg_temp.expect('C3 both blockers, escrow first',
            v = '[{"code": "escrow_held", "count": 1}, {"code": "live_assignments", "count": 1}]'::jsonb,
            format('archive_blockers = %s', v));
        SELECT * INTO a FROM pg_temp.attempt();
        PERFORM pg_temp.expect('C4 the door leads with the escrow and carries both',
            a.state = '55000' AND a.message LIKE 'status: money is held in escrow%'
                AND COALESCE(NULLIF(a.detail, ''), 'null')::jsonb = jsonb_build_object('blockers', v),
            format('refused %s "%s" DETAIL %s', a.state, a.message, a.detail));
        SELECT array_agg(label) INTO v_lost FROM probe_fails;
        RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'case_rollback';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
        INSERT INTO probe_fails SELECT l FROM unnest(v_lost) l WHERE l NOT IN (SELECT label FROM probe_fails);
    END;
END $$;
-- #endregion

-- #region D. A business keeps its own list and its coded refusal
DO $$
DECLARE
    v_owner uuid;
    v jsonb;
BEGIN
    SELECT b.owner_user_id INTO v_owner FROM org.business_profiles b WHERE b.slug = 'heliafinance';
    PERFORM pg_temp.act(v_owner);
    v := org.get_workspace_detail('business', 'heliafinance')->'archive_blockers';
    PERFORM pg_temp.expect('D1 a business''s blockers still come from fn_business_archive_blockers',
        v = org.fn_business_archive_blockers((SELECT b.id FROM org.business_profiles b WHERE b.slug = 'heliafinance')),
        format('archive_blockers = %s', v));
END $$;
-- #endregion

DO $$
DECLARE
    v_fails integer := (SELECT count(*) FROM probe_fails);
BEGIN
    IF v_fails > 0 THEN
        RAISE EXCEPTION 'FAIL % case(s): %', v_fails, (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'team_archive_blockers: all cases PASS';
END $$;

ROLLBACK;
