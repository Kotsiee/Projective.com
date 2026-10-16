-- =============================================================================================
-- Probe: a team with money held for its work cannot be archived (TEAMS_AUDIT S3; Decision #197 flag (b)).
-- org.set_workspace_status refuses `archived` (55000, "money is held in escrow …") while a `held` escrow
-- is owed to the team, AND while a `held` escrow on a stage the team is assigned to is bound to one of
-- its members or not bound yet — the team-seat payee rule can bind a member's claim to that member,
-- and a prepaid escrow names nobody until the claim.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/team_archive_escrow_guard.sql
--
-- Fixture (seeded data, adjusted inside the transaction with triggers off): the seeded team
-- `studiofern` — owner L (holds archive_entity), member M — a stranger freelancer N, and a ticket T on
-- a stage S of a project no member owns. The team is given a `completed` assignment on S, so the
-- live-assignment blocker stays quiet and only the escrow guard is under test. Each case inserts one
-- held escrow on S, tries the archive as L, and rolls both back.
-- =============================================================================================

BEGIN;

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

-- The team's assignment on S, set with triggers off.
CREATE FUNCTION pg_temp.set_assignment(p_status text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE projects.stage_assignments SET status = p_status WHERE id = pg_temp.id('assignment');
    SET LOCAL session_replication_role = origin;
END $$;

-- In a subtransaction that is always rolled back: hold one escrow on S for p_payee_type / p_payee
-- (both NULL = unbound, on T), then archive the team as L. Returns the refusal, or 'accepted'.
CREATE FUNCTION pg_temp.attempt(p_payee_type assignment_type, p_payee uuid, OUT state text, OUT message text)
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        SET LOCAL session_replication_role = replica;
        INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_business_id, payer_user_id,
                                     payee_type, payee_id, amount_cents, currency, status)
        VALUES (pg_temp.id('stage'), pg_temp.id('ticket'), pg_temp.id('payer_business'),
                CASE WHEN pg_temp.id('payer_business') IS NULL THEN pg_temp.id('payer') END,
                p_payee_type, p_payee, 25000, 'USD', 'held');
        SET LOCAL session_replication_role = origin;

        PERFORM pg_temp.act(pg_temp.id('lead'));
        PERFORM org.set_workspace_status('team', pg_temp.id('team'), 'archived');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, message = MESSAGE_TEXT;
    END;
    IF state = 'PX000' THEN
        state := 'accepted';
        message := NULL;
    END IF;
END $$;

CREATE FUNCTION pg_temp.expect_refused(p_label text, p_payee_type assignment_type, p_payee uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    SELECT a.state, a.message INTO v_state, v_msg FROM pg_temp.attempt(p_payee_type, p_payee) a;
    IF v_state = 'accepted' THEN
        PERFORM pg_temp.fail(p_label, 'the team was archived with the escrow held');
    ELSIF v_state <> '55000' OR v_msg <> 'status: money is held in escrow for this team — let it release first' THEN
        PERFORM pg_temp.fail(p_label, format('refused %s "%s" (expected the 55000 escrow refusal)', v_state, v_msg));
    ELSE
        RAISE NOTICE 'PASS % (% %)', p_label, v_state, v_msg;
    END IF;
END $$;

CREATE FUNCTION pg_temp.expect_archived(p_label text, p_payee_type assignment_type, p_payee uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    SELECT a.state, a.message INTO v_state, v_msg FROM pg_temp.attempt(p_payee_type, p_payee) a;
    IF v_state <> 'accepted' THEN
        PERFORM pg_temp.fail(p_label, format('refused %s "%s" (expected the archive to go through)', v_state, v_msg));
    ELSE
        RAISE NOTICE 'PASS % (archived)', p_label;
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

    SELECT s.id, tk.id, p.owner_user_id, p.client_business_id INTO v_stage, v_ticket, v_payer, v_payer_business
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id
      JOIN projects.tickets tk ON tk.current_stage_id = s.id
     WHERE p.owner_user_id IS DISTINCT FROM v_stranger
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = p.owner_user_id)
       AND NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.project_stage_id = s.id AND e.status = 'held')
     ORDER BY s.id, tk.id
     LIMIT 1;

    IF v_team IS NULL OR v_member IS NULL OR v_stranger IS NULL OR v_stage IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %, stranger %, stage %) — deno task db:reset',
            v_team, v_member, v_stranger, v_stage;
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
        ('stage', v_stage), ('ticket', v_ticket), ('payer', v_payer),
        ('payer_business', v_payer_business), ('assignment', v_assignment);
END $$;
-- #endregion

-- #region Cases
DO $$
BEGIN
    PERFORM pg_temp.set_assignment('completed');
    PERFORM pg_temp.expect_refused('held escrow owed to the team', 'team', pg_temp.id('team'));
    PERFORM pg_temp.expect_refused('held escrow bound to a member, team-assigned stage', 'freelancer', pg_temp.id('member'));
    PERFORM pg_temp.expect_refused('held escrow not bound yet, team-assigned stage', NULL, NULL);
    PERFORM pg_temp.expect_archived('held escrow bound to a non-member on the stage', 'freelancer', pg_temp.id('stranger'));

    PERFORM pg_temp.set_assignment('assigned');
    PERFORM pg_temp.expect_refused('member-bound escrow, assignment still assigned', 'freelancer', pg_temp.id('member'));

    -- A team that handed the stage back holds nothing on it: the stage's money is its next assignee's.
    PERFORM pg_temp.set_assignment('released');
    PERFORM pg_temp.expect_archived('member-bound escrow, team released the stage', 'freelancer', pg_temp.id('member'));
    PERFORM pg_temp.expect_archived('unbound escrow, team released the stage', NULL, NULL);
END $$;

DO $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.set_assignment('completed');
    PERFORM pg_temp.act(pg_temp.id('lead'));
    BEGIN
        PERFORM org.set_workspace_status('team', pg_temp.id('team'), 'archived');
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    IF v_state <> 'PX000' THEN
        PERFORM pg_temp.fail('no held escrow', format('refused %s "%s" (expected the archive to go through)', v_state, v_msg));
    ELSE
        RAISE NOTICE 'PASS no held escrow (archived)';
    END IF;
END $$;
-- #endregion

DO $$
DECLARE
    v_fails integer := (SELECT count(*) FROM probe_fails);
BEGIN
    IF v_fails > 0 THEN
        RAISE EXCEPTION 'FAIL % case(s): %', v_fails, (SELECT string_agg(label, '; ') FROM probe_fails);
    END IF;
    RAISE NOTICE 'team_archive_escrow_guard: all cases PASS';
END $$;

ROLLBACK;
