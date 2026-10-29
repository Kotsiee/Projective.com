-- =============================================================================================
-- Probe: the projects integrity constraints of PM-WP3 (PROJECT_MANAGEMENT_COMPLETENESS_AUDIT.md
-- §5.1, X17, C4; DECISION_LOG S6).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/projects_integrity_constraints.sql
--
-- THE DEFECTS, found by reading on 2026-10-29:
--   • a zero or negative W_i and a negative ticket price were storable, and W_i lowers the cap sums;
--   • `stage_submissions.status` was nullable and its per-stage `number` repeatable;
--   • `pipeline` + `one_off` (any format × structure) was storable;
--   • `tickets.workload_report_id` had no foreign key;
--   • two stages could hold one position, and `reorder_stages` accepted a partial list, skipped
--     foreign ids and renumbered only what it was given;
--   • a direct DELETE of a stage another stage waited on failed on the dependency FK
--     (`fn_stage_delete_cascade` did not detach dependants, though Tables.md said it did);
--   • the Task / One-off caps held at INSERT only, so switching the shape kept the extra rows.
--
-- A clean run prints only PASS notices; the first failed check raises `FAIL …`.
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

-- A ticket and a submission to write against, and a fresh unstaffed draft pipeline of three stages
-- for the order and shape checks (nothing seated, so no lock stands in the way).
DO $$
DECLARE
    v_owner uuid;
    v_project uuid;
    v_stage uuid;
    v_ticket uuid;
BEGIN
    SELECT t.id, t.current_stage_id INTO STRICT v_ticket, v_stage
      FROM projects.tickets t WHERE t.current_stage_id IS NOT NULL ORDER BY t.id LIMIT 1;
    PERFORM set_config('probe.ticket', v_ticket::text, true);
    PERFORM set_config('probe.ticket_stage', v_stage::text, true);

    SELECT p.owner_user_id INTO STRICT v_owner FROM projects.projects p ORDER BY p.created_at LIMIT 1;
    PERFORM set_config('probe.owner', v_owner::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    v_project := (projects.create_project(jsonb_build_object(
        'title', 'probe: integrity', 'format', 'pipeline', 'structure_variation', 'standard',
        'stages', jsonb_build_array(
            jsonb_build_object('name', 'One'), jsonb_build_object('name', 'Two'),
            jsonb_build_object('name', 'Three')))) ->> 'id')::uuid;
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('probe.project', v_project::text, true);
    PERFORM set_config('probe.stages', (
        SELECT string_agg(s.id::text, ',' ORDER BY s.sort_order)
          FROM projects.project_stages s WHERE s.project_id = v_project), true);
    IF (SELECT count(*) FROM projects.project_stages s WHERE s.project_id = v_project) <> 3 THEN
        RAISE EXCEPTION 'FAIL fixture: create_project did not make three stages';
    END IF;
    RAISE NOTICE 'fixture project=% stages=%', v_project, current_setting('probe.stages');
END $$;
-- #endregion

-- #region 1. CHECKs and NOT NULL
SELECT pg_temp.expect_error(format('UPDATE projects.tickets SET workload_intensity = 0 WHERE id = %L',
    current_setting('probe.ticket')), '23514', 'W_i of 0 is refused (ck_tickets_workload_intensity)');
SELECT pg_temp.expect_error(format('UPDATE projects.tickets SET workload_intensity = -1 WHERE id = %L',
    current_setting('probe.ticket')), '23514', 'a negative W_i is refused');
SELECT pg_temp.expect_error(format('UPDATE projects.tickets SET unit_price_cents = -1 WHERE id = %L',
    current_setting('probe.ticket')), '23514', 'a negative ticket price is refused (ck_tickets_unit_price_cents)');
SELECT pg_temp.expect_error(format(
    'UPDATE projects.projects SET structure_variation = ''one_off'' WHERE id = %L', current_setting('probe.project')),
    '23514', 'pipeline + one_off is refused (ck_projects_format_structure)');
SELECT pg_temp.expect_error(format(
    'UPDATE projects.projects SET format = ''session'', structure_variation = ''single_stage'' WHERE id = %L',
    current_setting('probe.project')), '23514', 'session + single_stage is refused');
SELECT pg_temp.expect_error(format(
    $q$INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status)
       VALUES (%L, %L, %L, 'probe', NULL)$q$,
    current_setting('probe.ticket_stage'), current_setting('probe.ticket'), current_setting('probe.owner')),
    '23502', 'a submission with no status is refused (NOT NULL)');
SELECT pg_temp.expect_error(format(
    'UPDATE projects.tickets SET workload_report_id = gen_random_uuid() WHERE id = %L', current_setting('probe.ticket')),
    '23503', 'workload_report_id must name a report (tickets_workload_report_id_fkey)');
-- #endregion

-- #region 2. UNIQUE (project_stage_id, number) and (project_id, sort_order)
DO $$
BEGIN
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status, number)
    VALUES (current_setting('probe.ticket_stage')::uuid, current_setting('probe.ticket')::uuid,
            current_setting('probe.owner')::uuid, 'probe one', 'draft', 9001);
    BEGIN
        INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status, number)
        VALUES (current_setting('probe.ticket_stage')::uuid, current_setting('probe.ticket')::uuid,
                current_setting('probe.owner')::uuid, 'probe two', 'draft', 9001);
        RAISE EXCEPTION 'FAIL a second submission took number 9001 on the stage';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS a submission number names one row per stage';
    END;
    -- NULL numbers stay repeatable.
    INSERT INTO projects.stage_submissions (project_stage_id, ticket_id, submitted_by, title, status, number)
    VALUES (current_setting('probe.ticket_stage')::uuid, current_setting('probe.ticket')::uuid,
            current_setting('probe.owner')::uuid, 'probe three', 'draft', NULL),
           (current_setting('probe.ticket_stage')::uuid, current_setting('probe.ticket')::uuid,
            current_setting('probe.owner')::uuid, 'probe four', 'draft', NULL);
    RAISE NOTICE 'PASS unnumbered submissions may repeat';
END $$;

DO $$
DECLARE
    v_stages uuid[] := string_to_array(current_setting('probe.stages'), ',')::uuid[];
BEGIN
    BEGIN
        UPDATE projects.project_stages SET sort_order = 0 WHERE id = v_stages[2];
        SET CONSTRAINTS projects.project_stages_project_sort_order_key IMMEDIATE;
        RAISE EXCEPTION 'FAIL two stages hold position 0';
    EXCEPTION WHEN unique_violation THEN
        RAISE NOTICE 'PASS one stage per position (project_stages_project_sort_order_key)';
    END;
END $$;
SET CONSTRAINTS ALL DEFERRED;
-- #endregion

-- #region 3. X17 — reorder_stages takes a full permutation and keeps every slot
DO $$
DECLARE
    v_stages uuid[] := string_to_array(current_setting('probe.stages'), ',')::uuid[];
    v_foreign uuid;
    v_orders int[];
BEGIN
    SELECT s.id INTO v_foreign FROM projects.project_stages s
     WHERE s.project_id <> current_setting('probe.project')::uuid LIMIT 1;
    PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);

    BEGIN
        PERFORM projects.reorder_stages(current_setting('probe.project')::uuid, ARRAY[v_stages[2], v_stages[1]]);
        RAISE EXCEPTION 'FAIL a partial reorder was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a partial reorder is refused';
    END;
    BEGIN
        PERFORM projects.reorder_stages(current_setting('probe.project')::uuid,
            ARRAY[v_stages[3], v_stages[2], v_foreign]);
        RAISE EXCEPTION 'FAIL a reorder naming a foreign stage was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a reorder naming another project''s stage is refused';
    END;
    BEGIN
        PERFORM projects.reorder_stages(current_setting('probe.project')::uuid,
            ARRAY[v_stages[1], v_stages[1], v_stages[2]]);
        RAISE EXCEPTION 'FAIL a reorder repeating a stage was accepted';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a reorder repeating a stage is refused';
    END;

    -- Archive the middle stage: it keeps its slot, and the live two swap within theirs.
    UPDATE projects.project_stages SET archived_at = now() WHERE id = v_stages[2];
    PERFORM projects.reorder_stages(current_setting('probe.project')::uuid, ARRAY[v_stages[3], v_stages[1]]);
    SET CONSTRAINTS projects.project_stages_project_sort_order_key IMMEDIATE;
    SELECT array_agg(s.sort_order ORDER BY array_position(v_stages, s.id)) INTO v_orders
      FROM projects.project_stages s WHERE s.id = ANY (v_stages);
    IF v_orders <> ARRAY[2, 1, 0] THEN
        RAISE EXCEPTION 'FAIL the full reorder left positions %', v_orders;
    END IF;
    RAISE NOTICE 'PASS a full reorder permutes the live stages within their own slots';
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
SET CONSTRAINTS ALL DEFERRED;
-- #endregion

-- #region 4. C4 — deleting a depended-on stage detaches its dependants
DO $$
DECLARE
    v_stages uuid[] := string_to_array(current_setting('probe.stages'), ',')::uuid[];
BEGIN
    UPDATE projects.project_stages SET start_dependency_stage_id = v_stages[1] WHERE id = v_stages[3];
    DELETE FROM projects.project_stages WHERE id = v_stages[1];
    IF (SELECT start_dependency_stage_id FROM projects.project_stages WHERE id = v_stages[3]) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL the dependant still points at the deleted stage';
    END IF;
    RAISE NOTICE 'PASS a direct DELETE of a depended-on stage detaches its dependants';
END $$;
-- #endregion

-- #region 5. S6 — the Task / One-off caps hold when the shape switches
DO $$
DECLARE
    v_stages uuid[] := string_to_array(current_setting('probe.stages'), ',')::uuid[];
BEGIN
    -- Two live stages remain (the third, archived, does not count): a single-stage switch breaks.
    UPDATE projects.project_stages SET archived_at = NULL WHERE id = v_stages[2];
    UPDATE projects.projects SET structure_variation = 'single_stage' WHERE id = current_setting('probe.project')::uuid;
    BEGIN
        SET CONSTRAINTS projects.trg_enforce_structure_variation_switch IMMEDIATE;
        RAISE EXCEPTION 'FAIL a single-stage switch kept two live stages';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a shape switch the remaining stages would break is refused at commit';
    END;
END $$;
SET CONSTRAINTS ALL DEFERRED;

DO $$
DECLARE
    v_stages uuid[] := string_to_array(current_setting('probe.stages'), ',')::uuid[];
BEGIN
    -- The same switch, with the extra stage retired in the same transaction, passes.
    UPDATE projects.projects SET structure_variation = 'single_stage' WHERE id = current_setting('probe.project')::uuid;
    UPDATE projects.project_stages SET archived_at = now() WHERE id = v_stages[2];
    SET CONSTRAINTS projects.trg_enforce_structure_variation_switch IMMEDIATE;
    RAISE NOTICE 'PASS a switch whose extra stage is retired in the same transaction passes';
END $$;
-- #endregion

ROLLBACK;
