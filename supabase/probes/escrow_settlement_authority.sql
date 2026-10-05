-- =============================================================================================
-- Probe: escrow settlement authority (projects.complete_ticket / delete_ticket / force_complete_stage
-- / approve_stage / cancel_stage_fair_exit, projects.fn_release_expired_claims, and the
-- trg_ticket_authority_guard table path).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/escrow_settlement_authority.sql
--
-- Every expected refusal is asserted: a call that SUCCEEDS where it must be refused raises
-- `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run prints only PASS
-- notices. Fixtures are discovered from the seed (deno task db:reset) — no ids are hard-coded.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A ticket with HELD escrow whose assignee holds no review authority on its project, and — for the
-- complete_ticket happy path — a second held ticket of the same owner on a different stage.
DO $$
DECLARE
    c  record;
    r2 record;
BEGIN
    FOR c IN
        SELECT t.id AS ticket, t.project_id AS project, e.project_stage_id AS stage,
               t.current_assignee_id AS assignee, p.owner_user_id AS owner
        FROM finance.escrows e
        JOIN projects.tickets t ON t.id = e.ticket_id
        JOIN projects.projects p ON p.id = t.project_id
        WHERE e.status = 'held'
            AND t.current_assignee_id IS NOT NULL
            AND t.current_assignee_id <> p.owner_user_id
        ORDER BY t.id
    LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', c.assignee, 'role', 'authenticated')::text, true);
        CONTINUE WHEN projects.can_review_project(c.project);

        PERFORM set_config('probe.ticket', c.ticket::text, true);
        PERFORM set_config('probe.project', c.project::text, true);
        PERFORM set_config('probe.stage', c.stage::text, true);
        PERFORM set_config('probe.assignee', c.assignee::text, true);
        PERFORM set_config('probe.owner', c.owner::text, true);

        SELECT t.id AS ticket INTO r2
        FROM finance.escrows e
        JOIN projects.tickets t ON t.id = e.ticket_id
        JOIN projects.projects p ON p.id = t.project_id
        WHERE e.status = 'held' AND p.owner_user_id = c.owner
            AND e.project_stage_id <> c.stage AND t.id <> c.ticket
        ORDER BY t.id
        LIMIT 1;
        PERFORM set_config('probe.ticket2', COALESCE(r2.ticket::text, ''), true);

        PERFORM set_config('request.jwt.claims', '', true);
        RAISE NOTICE 'fixture ticket=% project=% stage=% assignee=% owner=% ticket2=%',
            c.ticket, c.project, c.stage, c.assignee, c.owner, r2.ticket;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need a seeded ticket with held escrow and a non-reviewer assignee (deno task db:reset)';
END $$;
-- #endregion

-- #region 1. Unauthenticated caller (anon) — refused by the grant before any body runs
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('SELECT projects.complete_ticket(%L)', current_setting('probe.ticket')),
        format('SELECT projects.delete_ticket(%L)', current_setting('probe.ticket')),
        format('SELECT projects.force_complete_stage(%L)', current_setting('probe.ticket')),
        format('SELECT projects.approve_stage(%L, %L)', current_setting('probe.project'), current_setting('probe.stage')),
        format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', current_setting('probe.project'), current_setting('probe.stage')),
        'SELECT projects.fn_release_expired_claims(''2999-01-01''::timestamptz)'
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL anon executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS anon refused [%]: %', SQLERRM, v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;
-- #endregion

-- #region 2. `authenticated` with no subject — refused by the body's own auth.uid() check
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('SELECT projects.complete_ticket(%L)', current_setting('probe.ticket')),
        format('SELECT projects.delete_ticket(%L)', current_setting('probe.ticket')),
        format('SELECT projects.force_complete_stage(%L)', current_setting('probe.ticket')),
        format('SELECT projects.approve_stage(%L, %L)', current_setting('probe.project'), current_setting('probe.stage')),
        format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', current_setting('probe.project'), current_setting('probe.stage'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL subject-less caller executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS no-subject refused [%]: %', SQLERRM, v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;
-- #endregion

-- #region 3. The assigned freelancer (the payee) — every settlement door and the table path refused
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.assignee'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_sql text;
BEGIN
    IF NOT projects.has_project_access(current_setting('probe.project')::uuid) THEN
        RAISE EXCEPTION 'FAIL fixture: the assignee should HAVE project access (that is the old, broken guard)';
    END IF;

    FOREACH v_sql IN ARRAY ARRAY[
        format('SELECT projects.complete_ticket(%L)', current_setting('probe.ticket')),
        format('SELECT projects.delete_ticket(%L)', current_setting('probe.ticket')),
        format('SELECT projects.force_complete_stage(%L)', current_setting('probe.ticket')),
        format('SELECT projects.approve_stage(%L, %L)', current_setting('probe.project'), current_setting('probe.stage')),
        format('SELECT projects.cancel_stage_fair_exit(%L, %L, 50)', current_setting('probe.project'), current_setting('probe.stage')),
        'SELECT projects.fn_release_expired_claims(''2999-01-01''::timestamptz)',
        -- The direct table path: "Manage tickets" admits the assignee, trg_ticket_authority_guard refuses.
        format('UPDATE projects.tickets SET status = ''completed'' WHERE id = %L', current_setting('probe.ticket')),
        format('DELETE FROM projects.tickets WHERE id = %L', current_setting('probe.ticket'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL assignee executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS assignee refused [%]: %', SQLERRM, v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;

-- Nothing moved: the escrow is still held and the ticket still exists, uncompleted.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM finance.escrows
        WHERE ticket_id = current_setting('probe.ticket')::uuid AND status = 'held'
    ) THEN
        RAISE EXCEPTION 'FAIL escrow for the probe ticket is no longer held after the refusals';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM projects.tickets
        WHERE id = current_setting('probe.ticket')::uuid AND status <> 'completed'
    ) THEN
        RAISE EXCEPTION 'FAIL probe ticket was deleted or completed by a refused caller';
    END IF;
    RAISE NOTICE 'PASS escrow still held and ticket intact after every refused attempt';
END $$;

-- The guard is narrow: the assignee's ordinary column moves are untouched.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.assignee'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_rows integer;
BEGIN
    UPDATE projects.tickets
    SET status = CASE WHEN status = 'in_review' THEN 'in_progress'::ticket_status ELSE 'in_review'::ticket_status END
    WHERE id = current_setting('probe.ticket')::uuid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'FAIL assignee could not make an ordinary (non-settling) status move';
    END IF;
    RAISE NOTICE 'PASS assignee ordinary status move still allowed';
END $$;
RESET ROLE;
-- #endregion

-- #region 4. The project owner — the legitimate path succeeds and actually moves the money
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_result jsonb;
BEGIN
    v_result := projects.approve_stage(current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid);
    RAISE NOTICE 'PASS owner approve_stage → %', v_result;

    IF current_setting('probe.ticket2') <> '' THEN
        PERFORM projects.complete_ticket(current_setting('probe.ticket2')::uuid);
        RAISE NOTICE 'PASS owner complete_ticket(%)', current_setting('probe.ticket2');
    ELSE
        RAISE NOTICE 'SKIP owner complete_ticket: the seed has no second held ticket for this owner';
    END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM finance.escrows
        WHERE project_stage_id = current_setting('probe.stage')::uuid AND status = 'held'
    ) THEN
        RAISE EXCEPTION 'FAIL approve_stage returned but the stage still has held escrow';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM projects.project_stages
        WHERE id = current_setting('probe.stage')::uuid AND status = 'paid'
    ) THEN
        RAISE EXCEPTION 'FAIL approve_stage returned but the stage is not paid';
    END IF;
    RAISE NOTICE 'PASS stage escrow released and stage paid';

    IF current_setting('probe.ticket2') <> '' THEN
        IF EXISTS (
            SELECT 1 FROM finance.escrows
            WHERE ticket_id = current_setting('probe.ticket2')::uuid AND status = 'held'
        ) OR NOT EXISTS (
            SELECT 1 FROM projects.tickets
            WHERE id = current_setting('probe.ticket2')::uuid AND status = 'completed'
        ) THEN
            RAISE EXCEPTION 'FAIL complete_ticket returned but its escrow/status did not settle';
        END IF;
        RAISE NOTICE 'PASS ticket2 completed and its escrow released';
    END IF;
END $$;
-- #endregion

ROLLBACK;
