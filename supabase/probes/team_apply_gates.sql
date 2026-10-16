-- =============================================================================================
-- Probe: team application gates (Decision #228 (E); TEAMS_AUDIT A3, A4) — both apply doors run
-- projects.fn_assert_team_can_apply: bind_seat → team `active` → two active members → payout-ready.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/team_apply_gates.sql
--
-- Fixture (seeded data, adjusted inside the transaction with triggers off): the seeded two-member team
-- `studiofern` — owner L holds bind_seat, member M does not, every shareholder payout-ready — a live
-- stage S of a public project no member owns, and an open seat posted on S. The team's status and its
-- second membership are flipped between cases. Every case runs and reports; a clean run prints only
-- PASS notices, and any FAIL aborts the run at the end.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, txt text);
CREATE TEMP TABLE probe_fails (label text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.txt(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT txt FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.fail(p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO probe_fails VALUES (p_label);
    RAISE NOTICE 'FAIL % — %', p_label, p_why;
END $$;

-- The team's lifecycle status and whether M is still an active member, set with triggers off
-- (`trg_teams_immutable` forbids a return to draft, which is exactly the state under test).
CREATE FUNCTION pg_temp.set_team(p_status text, p_second_member_active boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    SET LOCAL session_replication_role = replica;
    UPDATE org.teams SET status = p_status WHERE id = pg_temp.id('team');
    UPDATE org.team_members
       SET status = CASE WHEN p_second_member_active THEN 'active' ELSE 'left' END,
           left_at = CASE WHEN p_second_member_active THEN NULL ELSE now() END
     WHERE team_id = pg_temp.id('team') AND user_id = pg_temp.id('member');
    SET LOCAL session_replication_role = origin;
END $$;

CREATE FUNCTION pg_temp.door_sql(p_door text) RETURNS text LANGUAGE sql AS $$
    SELECT CASE p_door
        WHEN 'apply_to_project' THEN format(
            'SELECT projects.apply_to_project(%L, %L, NULL, NULL, %L)',
            pg_temp.txt('project'), pg_temp.txt('stage'), pg_temp.id('team'))
        ELSE format(
            'SELECT projects.apply_to_seat(%L, ''team'', %L, NULL)',
            pg_temp.id('seat'), pg_temp.id('team'))
    END;
$$;

-- Run p_door as p_actor in a subtransaction that is always rolled back, so a filed application never
-- trips a later case's duplicate check. Returns the refusal (state, message), or ('accepted', whether a
-- pending team application from p_actor existed before the rollback).
CREATE FUNCTION pg_temp.attempt(p_actor uuid, p_door text, OUT state text, OUT message text)
LANGUAGE plpgsql AS $$
DECLARE
    v_filed boolean;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE pg_temp.door_sql(p_door);
        v_filed := EXISTS (
            SELECT 1 FROM projects.project_applications pa
             WHERE pa.applicant_type = 'team' AND pa.applicant_profile_id = pg_temp.id('team')
               AND pa.applicant_user_id = p_actor AND pa.status = 'pending'
               AND pa.project_id = pg_temp.id('project')
        );
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS state = RETURNED_SQLSTATE, message = MESSAGE_TEXT;
    END;
    IF state = 'PX000' THEN
        state := 'accepted';
        message := v_filed::text;
    END IF;
END $$;

-- p_door as p_actor must be refused with SQLSTATE p_state and a message LIKE p_message.
CREATE FUNCTION pg_temp.expect_refused(p_label text, p_actor uuid, p_door text, p_state text, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    SELECT a.state, a.message INTO v_state, v_msg FROM pg_temp.attempt(p_actor, p_door) a;
    IF v_state = 'accepted' THEN
        PERFORM pg_temp.fail(p_label, p_door || ' accepted the application');
    ELSIF v_state <> p_state OR v_msg NOT LIKE p_message THEN
        PERFORM pg_temp.fail(p_label, format('%s refused %s "%s" (expected %s "%s")',
            p_door, v_state, v_msg, p_state, p_message));
    ELSE
        RAISE NOTICE 'PASS % (% → % %)', p_label, p_door, v_state, left(v_msg, 60);
    END IF;
END $$;

-- p_door as p_actor must file a pending team application.
CREATE FUNCTION pg_temp.expect_filed(p_label text, p_actor uuid, p_door text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    SELECT a.state, a.message INTO v_state, v_msg FROM pg_temp.attempt(p_actor, p_door) a;
    IF v_state <> 'accepted' THEN
        PERFORM pg_temp.fail(p_label, format('%s refused %s "%s"', p_door, v_state, v_msg));
    ELSIF v_msg <> 'true' THEN
        PERFORM pg_temp.fail(p_label, p_door || ' returned but no pending team application exists');
    ELSE
        RAISE NOTICE 'PASS % (% filed a pending team application)', p_label, p_door;
    END IF;
END $$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_team uuid;
    v_lead uuid;
    v_member uuid;
    v_project uuid;
    v_slug text;
    v_stage uuid;
    v_stage_slug text;
    v_seat uuid;
BEGIN
    SELECT t.id, t.owner_user_id INTO v_team, v_lead FROM org.teams t WHERE t.slug = 'studiofern';
    SELECT m.user_id INTO v_member FROM org.team_members m
     WHERE m.team_id = v_team AND m.status = 'active' AND m.user_id <> v_lead
     ORDER BY m.user_id LIMIT 1;

    SELECT p.id, p.slug, s.id, s.slug INTO v_project, v_slug, v_stage, v_stage_slug
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.status = 'active' AND p.visibility = 'public'
       AND p.owner_team_id IS DISTINCT FROM v_team
       AND s.status = 'open' AND s.hire_trigger_active AND s.archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM org.team_members m WHERE m.team_id = v_team AND m.user_id = p.owner_user_id)
       AND NOT EXISTS (SELECT 1 FROM projects.stage_assignments sa
                        WHERE sa.project_stage_id = s.id AND sa.team_id = v_team)
       AND NOT EXISTS (SELECT 1 FROM projects.project_applications pa
                        WHERE pa.project_id = p.id AND pa.applicant_profile_id = v_team)
     ORDER BY p.slug, s.id
     LIMIT 1;

    IF v_team IS NULL OR v_member IS NULL OR v_project IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture (team %, member %, project %) — deno task db:reset',
            v_team, v_member, v_project;
    END IF;
    IF (SELECT count(*) FROM org.team_members m WHERE m.team_id = v_team AND m.status = 'active') <> 2 THEN
        RAISE EXCEPTION 'FAIL fixture: studiofern no longer has exactly two active members';
    END IF;

    INSERT INTO projects.stage_open_seats (project_stage_id, description_of_need)
    VALUES (v_stage, 'Probe seat') RETURNING id INTO v_seat;

    INSERT INTO probe_ids VALUES
        ('team', v_team, NULL), ('lead', v_lead, NULL), ('member', v_member, NULL),
        ('project', v_project, v_slug), ('stage', v_stage, v_stage_slug), ('seat', v_seat, NULL);

    PERFORM pg_temp.act(v_lead);
    IF NOT org.is_team_lead(v_team) THEN
        RAISE EXCEPTION 'FAIL fixture: the studiofern owner does not hold bind_seat';
    END IF;
    PERFORM pg_temp.act(v_member);
    IF org.is_team_lead(v_team) THEN
        RAISE EXCEPTION 'FAIL fixture: the studiofern member holds bind_seat';
    END IF;
END $$;
-- #endregion

-- #region Cases
DO $$
DECLARE
    v_door text;
    v_status text;
BEGIN
    FOREACH v_door IN ARRAY ARRAY['apply_to_project', 'apply_to_seat'] LOOP
        PERFORM pg_temp.set_team('active', true);
        PERFORM pg_temp.expect_refused('member without bind_seat', pg_temp.id('member'), v_door,
            '42501', 'Only a team member who can commit the team to work may apply on its behalf.');

        FOREACH v_status IN ARRAY ARRAY['draft', 'archived'] LOOP
            PERFORM pg_temp.set_team(v_status, true);
            PERFORM pg_temp.expect_refused(v_status || ' team', pg_temp.id('lead'), v_door,
                '23514', 'team_not_active: only a published team can apply%');
        END LOOP;

        PERFORM pg_temp.set_team('draft', false);
        PERFORM pg_temp.expect_refused('draft one-member team reports status first', pg_temp.id('lead'),
            v_door, '23514', 'team_not_active:%');

        PERFORM pg_temp.set_team('active', false);
        PERFORM pg_temp.expect_refused('active one-member team', pg_temp.id('lead'), v_door,
            '23514', 'Teams must have at least 2 members before applying to client projects.');

        PERFORM pg_temp.set_team('active', true);
        PERFORM pg_temp.expect_filed('active two-member team, bind_seat lead', pg_temp.id('lead'), v_door);
    END LOOP;
END $$;
-- #endregion

-- #region The allowance report carries the status the pre-flight refuses on
DO $$
DECLARE
    v_report jsonb;
BEGIN
    PERFORM pg_temp.set_team('draft', true);
    PERFORM pg_temp.act(pg_temp.id('lead'));
    v_report := finance.get_proposal_allowance(pg_temp.id('team'));
    IF v_report->>'team_status' IS DISTINCT FROM 'draft' THEN
        PERFORM pg_temp.fail('allowance report', format('team_status %s (expected draft)', v_report->'team_status'));
    ELSE
        RAISE NOTICE 'PASS allowance report (team_status draft, team_member_count %)', v_report->>'team_member_count';
    END IF;
    v_report := finance.get_proposal_allowance(NULL);
    IF v_report->'team_status' IS DISTINCT FROM 'null'::jsonb THEN
        PERFORM pg_temp.fail('personal allowance report', format('team_status %s (expected null)', v_report->'team_status'));
    ELSE
        RAISE NOTICE 'PASS personal allowance report (team_status null)';
    END IF;

    BEGIN
        PERFORM finance.record_proposal_denial('team_not_active', pg_temp.id('team'), pg_temp.txt('project'));
        RAISE NOTICE 'PASS record_proposal_denial accepts team_not_active';
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.fail('record_proposal_denial', SQLSTATE || ' ' || SQLERRM);
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
    RAISE NOTICE 'team_apply_gates: all cases PASS';
END $$;

ROLLBACK;
