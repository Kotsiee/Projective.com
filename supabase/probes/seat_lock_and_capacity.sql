-- =============================================================================================
-- Probe: a taken seat cannot be un-taken, a pin needs a seat, and capacity counts what is held
-- (PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md X4, X8; DECISION_LOG W7). PM-WP2.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/seat_lock_and_capacity.sql
--
-- THE DEFECTS, found by reading on 2026-10-29:
--   • stage_assignments.status was free text, and the owner's FOR ALL policy let a taken seat be
--     flipped to `declined`, re-pointed or deleted — which lifted the shape and price locks that read
--     it;
--   • assign_ticket_manual pinned anyone, hired on the stage or not;
--   • check_ticket_capacity left `reported_hidden` tickets out of the sums (a reporter freed their own
--     capacity), read them unlocked (two concurrent claims could both pass), and labelled a stage-cap
--     refusal `project`.
--
-- A clean run prints only PASS notices; the first failed check raises `FAIL …`. Fixtures are
-- discovered from the seed (deno task db:reset) or created inside the transaction.
-- =============================================================================================

BEGIN;

-- #region 0. Helpers and fixtures (as postgres)
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_state text, p_label text, p_like text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'FAIL % — the statement succeeded', p_label;
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
    IF p_state IS NOT NULL AND SQLSTATE <> p_state THEN
        RAISE EXCEPTION 'FAIL % — expected %, got % %', p_label, p_state, SQLSTATE, SQLERRM;
    END IF;
    IF p_like IS NOT NULL AND SQLERRM NOT LIKE p_like THEN
        RAISE EXCEPTION 'FAIL % — unexpected message: %', p_label, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

DO $$
DECLARE
    c record;
BEGIN
    SELECT sa.id AS seat, sa.project_stage_id AS stage, sa.freelancer_profile_id AS freelancer,
           p.id AS project, p.owner_user_id AS owner,
           (SELECT s.id FROM projects.project_stages s
             WHERE s.project_id = p.id AND s.id <> sa.project_stage_id ORDER BY s.sort_order LIMIT 1) AS sibling
      INTO c
      FROM projects.stage_assignments sa
      JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
      JOIN projects.projects p ON p.id = ps.project_id
     WHERE sa.assignee_type = 'freelancer' AND sa.status = 'accepted'
       AND p.format = 'pipeline' AND sa.freelancer_profile_id <> p.owner_user_id
     ORDER BY sa.id LIMIT 1;
    IF c.seat IS NULL OR c.sibling IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need an accepted freelancer seat on a multi-stage pipeline';
    END IF;
    PERFORM set_config('probe.seat', c.seat::text, true);
    PERFORM set_config('probe.stage', c.stage::text, true);
    PERFORM set_config('probe.sibling', c.sibling::text, true);
    PERFORM set_config('probe.freelancer', c.freelancer::text, true);
    PERFORM set_config('probe.project', c.project::text, true);
    PERFORM set_config('probe.owner', c.owner::text, true);
    -- A freelancer with no seat anywhere on this project.
    PERFORM set_config('probe.stranger', (
        SELECT fp.user_id::text FROM org.freelancer_profiles fp
         WHERE fp.user_id <> c.owner AND NOT EXISTS (
             SELECT 1 FROM projects.stage_assignments x
               JOIN projects.project_stages s ON s.id = x.project_stage_id
              WHERE s.project_id = c.project AND x.freelancer_profile_id = fp.user_id)
         ORDER BY fp.user_id LIMIT 1), true);
    RAISE NOTICE 'fixture seat=% stage=% project=% owner=% freelancer=%',
        c.seat, c.stage, c.project, c.owner, c.freelancer;
END $$;
-- #endregion

-- #region 1. X8 — the seat vocabulary and the taken-seat guard
SELECT pg_temp.expect_error(format(
    $q$INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
       VALUES (%L, 'freelancer', %L, %L, 'active')$q$,
    current_setting('probe.sibling'), current_setting('probe.freelancer'), current_setting('probe.owner')),
    '23514', 'an unknown seat status is refused by ck_stage_assignments_status');

SELECT pg_temp.expect_error(format(
    'UPDATE projects.stage_assignments SET status = ''declined'' WHERE id = %L', current_setting('probe.seat')),
    '23514', 'a taken seat cannot be flipped to declined', '%cannot be returned%');
SELECT pg_temp.expect_error(format(
    'UPDATE projects.stage_assignments SET status = ''pending_funding'' WHERE id = %L', current_setting('probe.seat')),
    '23514', 'a taken seat cannot be parked back at pending_funding');
SELECT pg_temp.expect_error(format(
    'UPDATE projects.stage_assignments SET project_stage_id = %L WHERE id = %L',
    current_setting('probe.sibling'), current_setting('probe.seat')),
    '23514', 'a taken seat cannot be re-pointed at another stage', '%stays on its stage%');
SELECT pg_temp.expect_error(format(
    'DELETE FROM projects.stage_assignments WHERE id = %L', current_setting('probe.seat')),
    '23514', 'a taken seat cannot be deleted', '%cannot be deleted%');

DO $$
DECLARE
    v_free uuid;
BEGIN
    -- Forward through the taken states is allowed.
    UPDATE projects.stage_assignments SET status = 'completed' WHERE id = current_setting('probe.seat')::uuid;
    UPDATE projects.stage_assignments SET status = 'accepted' WHERE id = current_setting('probe.seat')::uuid;
    RAISE NOTICE 'PASS a taken seat still moves between taken states';

    -- A seat that was never taken stays free to change and to remove.
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status)
    VALUES (current_setting('probe.sibling')::uuid, 'freelancer', current_setting('probe.stranger')::uuid,
            current_setting('probe.owner')::uuid, 'pending_funding')
    RETURNING id INTO v_free;
    UPDATE projects.stage_assignments SET status = 'declined' WHERE id = v_free;
    DELETE FROM projects.stage_assignments WHERE id = v_free;
    RAISE NOTICE 'PASS an untaken seat is declined and deleted freely';
END $$;

-- The shape lock it protects still holds after the refused flips.
SELECT pg_temp.expect_error(format(
    'UPDATE projects.projects SET structure_variation = ''single_stage'' WHERE id = %L', current_setting('probe.project')),
    '23514', 'the shape lock still holds on the staffed project', '%cannot be modified%');
-- #endregion

-- #region 2. X8 / P0 4 — assign_ticket_manual needs a live seat on the ticket's stage
DO $$
DECLARE
    v_ticket uuid;
BEGIN
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, status)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
            'probe: manual pin', '{"html":"<p>work</p>"}'::jsonb, 'todo')
    RETURNING id INTO v_ticket;
    PERFORM set_config('probe.ticket', v_ticket::text, true);
END $$;

DO $$
BEGIN
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.assign_ticket_manual(current_setting('probe.ticket')::uuid, current_setting('probe.stranger')::uuid);
        RAISE EXCEPTION 'FAIL a seat-less pin succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
        IF SQLSTATE <> '23514' OR SQLERRM NOT LIKE '%not hired on this ticket''s stage%' THEN
            RAISE EXCEPTION 'FAIL seat-less pin refused for the wrong reason: % %', SQLSTATE, SQLERRM;
        END IF;
        RAISE NOTICE 'PASS a pin to someone with no seat on the stage is refused';
    END;
    -- The seated freelancer passes the seat check (payout, cap or funding gates may still answer).
    BEGIN
        PERFORM projects.assign_ticket_manual(current_setting('probe.ticket')::uuid, current_setting('probe.freelancer')::uuid);
        RAISE NOTICE 'PASS the seated freelancer is pinned';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%not hired on this ticket''s stage%' THEN
            RAISE EXCEPTION 'FAIL the seated freelancer was refused as seat-less';
        END IF;
        RAISE NOTICE 'PASS the seated freelancer clears the seat check (then: %)', SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
-- #endregion

-- #region 3. X4 / W7 — capacity counts suspended work, is serialised, and names the stage cap
DO $$
DECLARE
    v_held uuid;
    v_open uuid;
    v_verdict jsonb;
    v_cap numeric;
BEGIN
    SELECT COALESCE(fp.max_workload_intensity, 10) INTO v_cap
      FROM org.freelancer_profiles fp WHERE fp.user_id = current_setting('probe.stranger')::uuid;
    v_cap := COALESCE(v_cap, 10);

    -- A suspended ticket the stranger still holds, worth all but one unit of their cap.
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, description,
                                  status, workload_intensity)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.sibling')::uuid,
            current_setting('probe.stranger')::uuid, 'probe: suspended', '{"html":"<p>x</p>"}'::jsonb,
            'reported_hidden', v_cap - 1)
    RETURNING id INTO v_held;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, status, workload_intensity)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
            'probe: open', '{"html":"<p>x</p>"}'::jsonb, 'todo', 2)
    RETURNING id INTO v_open;

    v_verdict := projects.check_ticket_capacity(v_open, current_setting('probe.stranger')::uuid);
    IF (v_verdict ->> 'allowed')::boolean OR v_verdict ->> 'scope' <> 'global' THEN
        RAISE EXCEPTION 'FAIL a reported_hidden ticket was left out of the global sum: %', v_verdict;
    END IF;
    RAISE NOTICE 'PASS a suspended ticket still counts against the global cap';

    IF NOT EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid()) THEN
        RAISE EXCEPTION 'FAIL check_ticket_capacity took no per-user lock';
    END IF;
    IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'projects.check_ticket_capacity(uuid,uuid)'::regprocedure) <> 'v' THEN
        RAISE EXCEPTION 'FAIL check_ticket_capacity is not VOLATILE (a STABLE body reads one snapshot past the lock)';
    END IF;
    RAISE NOTICE 'PASS the check is volatile and serialised per user';

    -- The stage cap: move the suspended ticket onto the open one's stage at a small W_i and cap the stage.
    UPDATE projects.tickets SET workload_intensity = 2, current_stage_id = current_setting('probe.stage')::uuid
     WHERE id = v_held;
    UPDATE projects.project_stages SET max_concurrent_intensity = 3 WHERE id = current_setting('probe.stage')::uuid;
    v_verdict := projects.check_ticket_capacity(v_open, current_setting('probe.stranger')::uuid);
    IF (v_verdict ->> 'allowed')::boolean OR v_verdict ->> 'scope' <> 'stage' THEN
        RAISE EXCEPTION 'FAIL the stage cap did not refuse with scope stage: %', v_verdict;
    END IF;
    RAISE NOTICE 'PASS the stage cap refuses with scope stage, counting the suspended ticket';
END $$;
-- #endregion

ROLLBACK;
