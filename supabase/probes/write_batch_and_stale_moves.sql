-- =============================================================================================
-- Probe: PM-WP7 — orphaned submissions close, a stale move is refused, and a setup save or ticket
-- commit is one transaction (PROJECT_MANAGEMENT_DECISION_LOG.md S4, S7, S8).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/write_batch_and_stale_moves.sql
--
-- THE DEFECTS, found by reading on 2026-10-29:
--   • S4: a ticket leaving Review by a move or `complete_ticket` left its `pending_review` submission
--     open, so the explorer and the card summary said "awaiting review" forever;
--   • S8: a move carried no reading of the row, so a drag on a stale board overwrote a move made
--     elsewhere (last writer wins);
--   • S7: `applyProjectUpdate` and `commitTicketRow` wrote over several requests, so a refusal
--     part-way left the earlier writes committed.
--
-- A clean run prints only PASS notices; the first failed check raises `FAIL …`.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A ticket in Review with a pending submission, and its project's owner.
DO $$
DECLARE
    c record;
BEGIN
    SELECT t.id AS ticket, t.project_id AS project, p.owner_user_id AS owner, t.current_stage_id AS stage
      INTO c
      FROM projects.tickets t
      JOIN projects.projects p ON p.id = t.project_id
     WHERE t.status = 'in_review' AND t.current_assignee_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM projects.stage_submissions s
                    WHERE s.ticket_id = t.id AND s.status = 'pending_review')
     ORDER BY t.id LIMIT 1;
    IF c.ticket IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need an in_review ticket with a pending_review submission';
    END IF;
    PERFORM set_config('probe.ticket', c.ticket::text, true);
    PERFORM set_config('probe.project', c.project::text, true);
    PERFORM set_config('probe.owner', c.owner::text, true);
    PERFORM set_config('probe.stage', c.stage::text, true);
    RAISE NOTICE 'fixture ticket=% project=% owner=%', c.ticket, c.project, c.owner;
END $$;

CREATE FUNCTION pg_temp.as_owner() RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims',
        json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
$$;
-- #endregion

-- #region 1. S4 — leaving Review closes what was awaiting review
SAVEPOINT s4;
DO $$
DECLARE
    v_round uuid;
BEGIN
    -- A paid round raised on the pending submission and never paid.
    INSERT INTO projects.stage_revision_requests
        (project_stage_id, ticket_id, requested_by, request_type, reason, status, submission_id, price_cents)
    SELECT s.project_stage_id, s.ticket_id, current_setting('probe.owner')::uuid, 'paid_revision',
           'probe', 'awaiting_payment', s.id, 100
      FROM projects.stage_submissions s
     WHERE s.ticket_id = current_setting('probe.ticket')::uuid AND s.status = 'pending_review'
     LIMIT 1
    RETURNING id INTO v_round;

    PERFORM pg_temp.as_owner();
    PERFORM projects.move_ticket(current_setting('probe.ticket')::uuid, 'in_progress'::ticket_status);
    IF (SELECT r.status FROM projects.stage_revision_requests r WHERE r.id = v_round) <> 'cancelled' THEN
        RAISE EXCEPTION 'FAIL an unpaid round outlived the submission it was raised on';
    END IF;
    RAISE NOTICE 'PASS closing the submission cancels its unpaid paid round';
    IF EXISTS (SELECT 1 FROM projects.stage_submissions s
                WHERE s.ticket_id = current_setting('probe.ticket')::uuid AND s.status = 'pending_review') THEN
        RAISE EXCEPTION 'FAIL a submission stayed pending_review after its ticket left Review';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.stage_submissions s
                    WHERE s.ticket_id = current_setting('probe.ticket')::uuid
                      AND s.status = 'revisions_requested' AND s.reviewed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'FAIL sending the ticket back did not mark its submission revisions_requested';
    END IF;
    RAISE NOTICE 'PASS a ticket sent back out of Review closes its pending submission as revisions_requested';
END $$;
ROLLBACK TO SAVEPOINT s4;

DO $$
BEGIN
    PERFORM pg_temp.as_owner();
    PERFORM projects.complete_ticket(current_setting('probe.ticket')::uuid);
    IF NOT EXISTS (SELECT 1 FROM projects.stage_submissions s
                    WHERE s.ticket_id = current_setting('probe.ticket')::uuid AND s.status = 'accepted')
        OR EXISTS (SELECT 1 FROM projects.stage_submissions s
                    WHERE s.ticket_id = current_setting('probe.ticket')::uuid AND s.status = 'pending_review') THEN
        RAISE EXCEPTION 'FAIL completing the ticket did not accept its pending submission';
    END IF;
    RAISE NOTICE 'PASS a ticket completed out of Review accepts its pending submission';
END $$;
ROLLBACK TO SAVEPOINT s4;
-- #endregion

-- #region 2. S8 — a stale move is refused, a current one passes
DO $$
DECLARE
    v_ticket uuid;
    v_seen timestamptz;
BEGIN
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, status)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
            'probe: stale move', '{"html":"<p>x</p>"}'::jsonb, 'backlog')
    RETURNING id, updated_at INTO v_ticket, v_seen;
    PERFORM pg_temp.as_owner();

    BEGIN
        PERFORM projects.move_ticket(v_ticket, 'todo'::ticket_status, NULL, NULL, v_seen - interval '1 second');
        RAISE EXCEPTION 'FAIL a move against an older reading was accepted';
    EXCEPTION WHEN SQLSTATE 'PS409' THEN
        RAISE NOTICE 'PASS a move against a stale reading is refused PS409';
    END;

    PERFORM projects.move_ticket(v_ticket, 'todo'::ticket_status, NULL, NULL, v_seen);
    RAISE NOTICE 'PASS a move against the current reading passes';
    PERFORM projects.move_ticket(v_ticket, 'backlog'::ticket_status);
    RAISE NOTICE 'PASS a move with no reading keeps last-writer-wins';
END $$;
-- #endregion

-- #region 3. S7 — the write batch is one transaction
DO $$
DECLARE
    v_title text;
    v_result jsonb;
    v_stage uuid;
BEGIN
    SELECT p.title INTO v_title FROM projects.projects p WHERE p.id = current_setting('probe.project')::uuid;
    PERFORM pg_temp.as_owner();

    -- A failing op rolls back the ops before it.
    BEGIN
        PERFORM projects.apply_write_batch(jsonb_build_array(
            jsonb_build_object('kind', 'update', 'table', 'projects', 'id', current_setting('probe.project'),
                'patch', jsonb_build_object('title', 'probe: half a save')),
            jsonb_build_object('kind', 'update', 'table', 'project_stages', 'id', gen_random_uuid(),
                'patch', jsonb_build_object('milestone', 'x'), 'field', 'stages')));
        RAISE EXCEPTION 'FAIL a batch with an unwritable op succeeded';
    EXCEPTION WHEN SQLSTATE 'PW403' THEN
        NULL;
    END;
    IF (SELECT p.title FROM projects.projects p WHERE p.id = current_setting('probe.project')::uuid) <> v_title THEN
        RAISE EXCEPTION 'FAIL the first op of a refused batch stayed committed';
    END IF;
    RAISE NOTICE 'PASS a refused batch leaves nothing behind';

    -- A failure names the section of the op that failed.
    BEGIN
        PERFORM projects.apply_write_batch(jsonb_build_array(
            jsonb_build_object('kind', 'update', 'table', 'project_stages', 'id', gen_random_uuid(),
                'patch', jsonb_build_object('milestone', 'x'), 'field', 'stages')));
    EXCEPTION WHEN SQLSTATE 'PW403' THEN
        DECLARE v_hint text;
        BEGIN
            GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
            IF v_hint <> 'field:stages' THEN
                RAISE EXCEPTION 'FAIL the batch failure hint was %', v_hint;
            END IF;
        END;
    END;
    RAISE NOTICE 'PASS a batch failure carries its field hint';

    -- References: a stage created in the batch is patched by its reference in the same batch.
    v_result := projects.apply_write_batch(jsonb_build_array(
        jsonb_build_object('kind', 'rpc', 'fn', 'create_stage', 'ref', 'new_stage', 'field', 'stages',
            'args', jsonb_build_object('p_project_id', current_setting('probe.project'), 'p_name', 'probe: batched')),
        jsonb_build_object('kind', 'update', 'table', 'project_stages', 'id', jsonb_build_object('$ref', 'new_stage'),
            'patch', jsonb_build_object('milestone', 'probe milestone'), 'field', 'stages')));
    v_stage := (v_result #>> '{refs,new_stage}')::uuid;
    IF v_stage IS NULL OR (SELECT s.milestone FROM projects.project_stages s WHERE s.id = v_stage)
        IS DISTINCT FROM 'probe milestone' THEN
        RAISE EXCEPTION 'FAIL the batch did not bind its reference: %', v_result;
    END IF;
    RAISE NOTICE 'PASS a reference binds a row created earlier in the same batch';

    -- The allowlists: no table or function outside them.
    BEGIN
        PERFORM projects.apply_write_batch(jsonb_build_array(
            jsonb_build_object('kind', 'delete', 'table', 'tickets', 'match', jsonb_build_object('id', gen_random_uuid()))));
        RAISE EXCEPTION 'FAIL the batch deleted from tickets';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS the batch refuses a table outside its allowlist';
    END;
    BEGIN
        PERFORM projects.apply_write_batch(jsonb_build_array(
            jsonb_build_object('kind', 'rpc', 'fn', 'complete_ticket', 'args', jsonb_build_object())));
        RAISE EXCEPTION 'FAIL the batch called complete_ticket';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS the batch refuses a function outside its allowlist';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- It runs as the caller: a stranger's update reaches no row and is refused as not written.
DO $$
DECLARE
    v_stranger uuid;
BEGIN
    FOR v_stranger IN SELECT u.user_id FROM org.users_public u ORDER BY u.user_id LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
        EXIT WHEN NOT projects.has_project_access(current_setting('probe.project')::uuid);
    END LOOP;
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM projects.apply_write_batch(jsonb_build_array(
            jsonb_build_object('kind', 'update', 'table', 'projects', 'id', current_setting('probe.project'),
                'patch', jsonb_build_object('title', 'probe: hijack'))));
        RAISE EXCEPTION 'FAIL a stranger''s batch wrote the project';
    EXCEPTION WHEN SQLSTATE 'PW403' OR insufficient_privilege THEN
        RAISE NOTICE 'PASS the batch meets the caller''s own RLS';
    END;
    RESET ROLE;
END $$;
-- #endregion

ROLLBACK;
