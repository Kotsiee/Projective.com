-- =============================================================================================
-- Probe: the claim needs a live seat on the ticket's stage and an open ticket; nobody writes an
-- assignee directly; a staffed price is frozen in the database (Decision #338 (i), (j)).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/claim_seat_and_price_lock.sql
--
-- THE DEFECTS, found by reading on 2026-10-29 (PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md X3, X9, X12):
--   • projects.claim_ticket asked only has_project_access, so a freelancer seated on one stage could
--     claim a funded ticket on another (and hold the client's money for it), and any unclaimed
--     ticket could be claimed whatever its status, a completed or cancelled one included;
--   • fn_ticket_immutability_guard returned early for an unclaimed ticket, so review authority could
--     PATCH an assignee straight onto it, past the stage seat, the caps, the age and payout gates and
--     the routing mode;
--   • a staffed stage's ticket price, and a Task's project budget, were frozen only by the setup
--     service (lockedStagePriceIds / projectPriceLocked); a direct write changed them.
--
-- What is asserted: a seat-less claim is refused 42501; a claim on a completed ticket is refused as
-- not open; the seated claim passes both checks (it may still meet the payout, cap or funding gates,
-- which are not this probe's); a direct assignee UPDATE or INSERT is refused 42501, while a direct
-- release (assignee → NULL) still passes; a staffed stage's price is refused, a stage nobody joined
-- is repriced freely; a staffed Task refuses both its budget and its stage price. A clean run prints
-- only PASS notices; the first failed check raises `FAIL …`. Fixtures are discovered from the seed
-- (deno task db:reset); no ids are hard-coded.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A pipeline stage A where freelancer F holds a live seat, and a sibling stage B where F holds none.
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT p.id AS project, p.owner_user_id AS owner, sa.project_stage_id AS stage_a,
               sa.freelancer_profile_id AS freelancer,
               (SELECT s.id FROM projects.project_stages s
                 WHERE s.project_id = p.id AND s.id <> sa.project_stage_id AND s.archived_at IS NULL
                   AND NOT EXISTS (
                       SELECT 1 FROM projects.stage_assignments x
                       WHERE x.project_stage_id = s.id
                         AND x.freelancer_profile_id = sa.freelancer_profile_id
                         AND x.status IN ('assigned', 'accepted'))
                 ORDER BY s.sort_order, s.id LIMIT 1) AS stage_b
        FROM projects.stage_assignments sa
        JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
        JOIN projects.projects p ON p.id = ps.project_id
        WHERE sa.assignee_type = 'freelancer' AND sa.status IN ('assigned', 'accepted')
            AND p.structure_variation = 'standard' AND p.status = 'active'
            AND sa.freelancer_profile_id <> p.owner_user_id
            AND NOT projects.fn_is_personal_project(p.id)
        ORDER BY p.id, sa.id
    LOOP
        CONTINUE WHEN c.stage_b IS NULL;
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', c.freelancer, 'role', 'authenticated')::text, true);
        CONTINUE WHEN NOT projects.has_project_access(c.project) OR projects.can_review_project(c.project);
        PERFORM set_config('request.jwt.claims', '', true);

        PERFORM set_config('probe.project', c.project::text, true);
        PERFORM set_config('probe.owner', c.owner::text, true);
        PERFORM set_config('probe.freelancer', c.freelancer::text, true);
        PERFORM set_config('probe.stage_a', c.stage_a::text, true);
        PERFORM set_config('probe.stage_b', c.stage_b::text, true);
        UPDATE projects.project_stages SET assignment_mode = 'open_pull'
        WHERE id IN (c.stage_a, c.stage_b);
        RAISE NOTICE 'fixture project=% owner=% freelancer=% stage_a=% stage_b=%',
            c.project, c.owner, c.freelancer, c.stage_a, c.stage_b;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need an active pipeline with a freelancer seated on one stage and not on another (deno task db:reset)';
END $$;

-- Three described, unclaimed tickets: open on B, open on A, completed on A.
DO $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO projects.tickets (project_id, title, status, current_stage_id, text_description, description)
    VALUES (current_setting('probe.project')::uuid, 'Probe: open on B', 'todo',
            current_setting('probe.stage_b')::uuid, 'Probe ticket', '{"html": "<p>Probe ticket</p>"}'::jsonb)
    RETURNING id INTO v_id;
    PERFORM set_config('probe.ticket_b', v_id::text, true);

    INSERT INTO projects.tickets (project_id, title, status, current_stage_id, text_description, description)
    VALUES (current_setting('probe.project')::uuid, 'Probe: open on A', 'todo',
            current_setting('probe.stage_a')::uuid, 'Probe ticket', '{"html": "<p>Probe ticket</p>"}'::jsonb)
    RETURNING id INTO v_id;
    PERFORM set_config('probe.ticket_a', v_id::text, true);

    INSERT INTO projects.tickets (project_id, title, status, current_stage_id, text_description, description)
    VALUES (current_setting('probe.project')::uuid, 'Probe: completed on A', 'completed',
            current_setting('probe.stage_a')::uuid, 'Probe ticket', '{"html": "<p>Probe ticket</p>"}'::jsonb)
    RETURNING id INTO v_id;
    PERFORM set_config('probe.ticket_done', v_id::text, true);
END $$;

-- Run one statement as `p_who` (a probe.* setting holding a user id), signed in.
CREATE FUNCTION pg_temp.run_as(p_who text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.' || p_who), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE p_sql;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- `p_who` running `p_sql` must fail with `p_state` and a message containing `p_needle`.
CREATE FUNCTION pg_temp.refused(p_who text, p_sql text, p_state text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        PERFORM pg_temp.run_as(p_who, p_sql);
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', '', true);
        IF SQLSTATE <> p_state OR position(p_needle IN SQLERRM) = 0 THEN
            RAISE EXCEPTION 'FAIL % got [%] %, expected [%] "%": %', p_who, SQLSTATE, SQLERRM, p_state, p_needle, p_sql;
        END IF;
        RAISE NOTICE 'PASS % refused [%] %', p_who, SQLSTATE, SQLERRM;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL % was not refused: %', p_who, p_sql;
END $$;

-- `p_who` running `p_sql` must succeed.
CREATE FUNCTION pg_temp.allowed(p_who text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.run_as(p_who, p_sql);
    RAISE NOTICE 'PASS % allowed: %', p_who, p_sql;
EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'FAIL % was refused [%] %: %', p_who, SQLSTATE, SQLERRM, p_sql;
END $$;
-- #endregion

-- #region 1. The claim asks for a live seat and an open ticket
SELECT pg_temp.refused('freelancer',
    format('SELECT projects.claim_ticket(%L, %L)', current_setting('probe.ticket_b'), current_setting('probe.freelancer')),
    '42501', 'not hired on this ticket''s stage');

SELECT pg_temp.refused('freelancer',
    format('SELECT projects.claim_ticket(%L, %L)', current_setting('probe.ticket_done'), current_setting('probe.freelancer')),
    '23514', 'not open to claim');

-- The seated claim of an open ticket clears both new checks. Whatever it meets next (payout
-- readiness, a cap, a refused hold that answers NULL) belongs to other gates and other probes.
SAVEPOINT seated_claim;
DO $$
BEGIN
    BEGIN
        PERFORM pg_temp.run_as('freelancer',
            format('SELECT projects.claim_ticket(%L, %L)', current_setting('probe.ticket_a'), current_setting('probe.freelancer')));
        RAISE NOTICE 'PASS the seated freelancer claimed an open ticket on their stage';
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        IF position('not hired' IN SQLERRM) > 0 OR position('not open to claim' IN SQLERRM) > 0 THEN
            RAISE EXCEPTION 'FAIL the seated claim was refused by the new checks: %', SQLERRM;
        END IF;
        RAISE NOTICE 'PASS the seated claim cleared the seat and status checks (then met another gate: [%] %)', SQLSTATE, SQLERRM;
    END;
END $$;
ROLLBACK TO SAVEPOINT seated_claim;
-- #endregion

-- #region 2. Nobody writes an assignee directly
SELECT pg_temp.refused('owner',
    format('UPDATE projects.tickets SET current_assignee_id = %L, status = ''claimed'' WHERE id = %L',
        current_setting('probe.freelancer'), current_setting('probe.ticket_a')),
    '42501', 'claimed or assigned through the board');

SELECT pg_temp.refused('owner',
    format('INSERT INTO projects.tickets (project_id, title, current_stage_id, current_assignee_id) VALUES (%L, %L, %L, %L)',
        current_setting('probe.project'), 'Probe: pre-assigned', current_setting('probe.stage_a'), current_setting('probe.freelancer')),
    '42501', 'claimed or assigned through the board');

-- A release (the owner's removal) is still a direct statement the guard admits.
SAVEPOINT release;
DO $$
DECLARE
    c record;
BEGIN
    SELECT t.id, p.owner_user_id AS owner INTO c
    FROM projects.tickets t JOIN projects.projects p ON p.id = t.project_id
    WHERE t.current_assignee_id IS NOT NULL AND t.current_assignee_id <> p.owner_user_id
        AND t.status IN ('claimed', 'in_progress') AND NOT projects.fn_is_personal_project(p.id)
    ORDER BY t.id LIMIT 1;
    IF c.id IS NULL THEN
        RAISE NOTICE 'SKIP no seeded ticket under way to release';
        RETURN;
    END IF;
    PERFORM set_config('probe.release_owner', c.owner::text, true);
    PERFORM pg_temp.allowed('release_owner',
        format('UPDATE projects.tickets SET current_assignee_id = NULL WHERE id = %L', c.id));
END $$;
ROLLBACK TO SAVEPOINT release;
-- #endregion

-- #region 3. A staffed price is frozen in the database
SELECT pg_temp.refused('owner',
    format('UPDATE projects.project_stages SET unit_price_cents = COALESCE(unit_price_cents, 0) + 100 WHERE id = %L',
        current_setting('probe.stage_a')),
    '23514', 'onboarded onto this stage');

DO $$
DECLARE
    c record;
BEGIN
    SELECT s.id, p.owner_user_id AS owner INTO c
    FROM projects.project_stages s JOIN projects.projects p ON p.id = s.project_id
    WHERE p.structure_variation IN ('standard', 'one_off') AND NOT projects.fn_is_personal_project(p.id)
        AND NOT EXISTS (
            SELECT 1 FROM projects.stage_assignments sa
            WHERE sa.project_stage_id = s.id AND sa.status NOT IN ('declined', 'pending_funding'))
    ORDER BY s.id LIMIT 1;
    PERFORM set_config('probe.free_owner', c.owner::text, true);
    PERFORM pg_temp.allowed('free_owner',
        format('UPDATE projects.project_stages SET unit_price_cents = COALESCE(unit_price_cents, 0) + 100 WHERE id = %L', c.id));
END $$;

-- A Task: a seat-less pipeline turned flat, then staffed on its first stage (as postgres).
DO $$
DECLARE
    v_project uuid;
    v_owner   uuid;
    v_stage   uuid;
BEGIN
    SELECT p.id, p.owner_user_id INTO v_project, v_owner
    FROM projects.projects p
    WHERE p.structure_variation = 'standard' AND NOT projects.fn_is_personal_project(p.id)
        AND NOT EXISTS (
            SELECT 1 FROM projects.stage_assignments sa
            JOIN projects.project_stages s ON s.id = sa.project_stage_id WHERE s.project_id = p.id)
    ORDER BY p.id LIMIT 1;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a seat-less pipeline to stage a Task on';
    END IF;
    SELECT id INTO v_stage FROM projects.project_stages
    WHERE project_id = v_project ORDER BY sort_order, id LIMIT 1;

    UPDATE projects.projects SET structure_variation = 'single_task' WHERE id = v_project;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, is_client_managed, status)
    VALUES (v_stage, 'freelancer', current_setting('probe.freelancer')::uuid, v_owner, false, 'assigned');

    PERFORM set_config('probe.task', v_project::text, true);
    PERFORM set_config('probe.task_owner', v_owner::text, true);
    PERFORM set_config('probe.task_stage', v_stage::text, true);
END $$;

SELECT pg_temp.refused('task_owner',
    format('UPDATE projects.projects SET budget_amount_cents = COALESCE(budget_amount_cents, 0) + 100 WHERE id = %L',
        current_setting('probe.task')),
    '23514', 'onboarded onto this project');

SELECT pg_temp.refused('task_owner',
    format('UPDATE projects.project_stages SET unit_price_cents = COALESCE(unit_price_cents, 0) + 100 WHERE id = %L',
        current_setting('probe.task_stage')),
    '23514', 'onboarded onto this project');
-- #endregion

ROLLBACK;
