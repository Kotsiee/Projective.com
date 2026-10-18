-- =============================================================================================
-- Probe: who may move a claimed ticket between status columns (Decision #293).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/ticket_move_authority.sql
--
-- THE DEFECT, reproduced by execution on 2026-10-17 against the seed (rolled back, with #290/#291's
-- definitions spliced in). projects.move_ticket is SECURITY DEFINER, so RLS never sees its write, and
-- its only guards were has_project_access and, for Done, can_review_project. So:
--   • another freelancer on the project moved someone else's ticket under way to To do, New, Review,
--     Claimed, Cancelled or Hidden — Hidden being the workload-report suspension, after which the
--     real assignee could no longer touch their own work (Decision #290);
--   • the client moved a ticket a freelancer was working (`in_progress`) to any column, any stage or
--     Done, through move_ticket or a direct PATCH — the #94 drag lock lived only on the board;
--   • a move into `claimed` restamps claimed_at, and projects.fn_release_expired_claims refunds an
--     expired claim to the client in full. The client moved a ticket the freelancer had handed back
--     for review to Claimed, and the sweep refunded the whole hold to the client: delivered work,
--     paid nothing;
--   • the assignee moved their own ticket to New, Cancelled or Hidden, on either path.
-- PRODUCT_SPEC §Ticket Movement: the client's drag is locked while a freelancer is working the ticket
-- (#94); §The Claim-and-Commit Protocol: a claimed ticket is soft-locked to its freelancer, who moves
-- it into Doing; §Escrow Lifecycle: the escrow is committed at the Claim, never at a later move.
--
-- What is asserted: delivered work is not refunded through the claim sweep; another freelancer moves
-- nothing; the client waits for the hand-back (#94) on both paths, and its plain save of a working
-- ticket still passes; no move enters Claimed, Cancelled or Hidden; the assignee moves its ticket
-- between To do, In progress and In review, and nowhere else; after the hand-back the client moves it
-- and confirms it Done; one person on both sides, the platform, and the client with an unclaimed
-- ticket are not gated. A clean run prints only PASS notices; the first failed check raises `FAIL …`
-- and aborts the run. Fixtures are discovered from the seed (deno task db:reset); no ids are
-- hard-coded.
-- =============================================================================================

BEGIN;
-- @prelude (in-flight definitions are spliced here when probing before a reset)

-- #region 0. Fixtures (as postgres)
-- A ticket under way holding a base escrow for a freelancer who holds no review authority, on a
-- project with another open stage, and carrying a description.
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT t.id AS ticket, t.project_id AS project, t.current_stage_id AS stage, t.status,
               t.current_assignee_id AS assignee, p.owner_user_id AS owner, e.id AS escrow,
               (SELECT s.id FROM projects.project_stages s
                 WHERE s.project_id = p.id AND s.id <> t.current_stage_id AND s.archived_at IS NULL
                   AND s.status IN ('open', 'assigned', 'in_progress')
                 ORDER BY s.sort_order, s.id LIMIT 1) AS next_stage
        FROM projects.tickets t
        JOIN projects.projects p ON p.id = t.project_id
        JOIN finance.escrows e ON e.ticket_id = t.id AND e.status = 'held' AND e.revision_id IS NULL
        WHERE t.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status)
            AND e.payee_type = 'freelancer'::assignment_type
            AND t.current_assignee_id IS NOT NULL
            AND t.current_assignee_id <> p.owner_user_id
            AND NOT projects.fn_is_personal_project(t.project_id)
            AND (NULLIF(btrim(t.text_description), '') IS NOT NULL
                OR (t.description IS NOT NULL AND t.description <> '{}'::jsonb))
        ORDER BY t.id
    LOOP
        CONTINUE WHEN c.next_stage IS NULL;
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', c.assignee, 'role', 'authenticated')::text, true);
        CONTINUE WHEN projects.can_review_project(c.project);
        PERFORM set_config('request.jwt.claims', '', true);

        PERFORM set_config('probe.ticket', c.ticket::text, true);
        PERFORM set_config('probe.project', c.project::text, true);
        PERFORM set_config('probe.stage', c.stage::text, true);
        PERFORM set_config('probe.next_stage', c.next_stage::text, true);
        PERFORM set_config('probe.assignee', c.assignee::text, true);
        PERFORM set_config('probe.owner', c.owner::text, true);
        PERFORM set_config('probe.escrow', c.escrow::text, true);
        -- Every check starts from the ticket under way.
        UPDATE projects.tickets SET status = 'in_progress'::ticket_status WHERE id = c.ticket;
        RAISE NOTICE 'fixture ticket=% (seeded %) project=% stage=% next_stage=% assignee=% owner=% escrow=%',
            c.ticket, c.status, c.project, c.stage, c.next_stage, c.assignee, c.owner, c.escrow;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need a seeded ticket under way, holding escrow for a non-reviewer freelancer, on a project with another open stage (deno task db:reset)';
END $$;

-- Another freelancer on the project, without review authority.
DO $$
DECLARE
    v_user uuid;
BEGIN
    FOR v_user IN
        SELECT fp.user_id FROM org.freelancer_profiles fp
        WHERE fp.user_id <> current_setting('probe.assignee')::uuid
            AND fp.user_id <> current_setting('probe.owner')::uuid
        ORDER BY fp.user_id
    LOOP
        BEGIN
            INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
            VALUES (current_setting('probe.project')::uuid, 'freelancer', v_user, 'member');
        EXCEPTION WHEN OTHERS THEN
            CONTINUE;
        END;
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
        IF projects.has_project_access(current_setting('probe.project')::uuid)
            AND NOT projects.can_review_project(current_setting('probe.project')::uuid) THEN
            PERFORM set_config('request.jwt.claims', '', true);
            PERFORM set_config('probe.bystander', v_user::text, true);
            RAISE NOTICE 'fixture bystander=%', v_user;
            RETURN;
        END IF;
        PERFORM set_config('request.jwt.claims', '', true);
        DELETE FROM projects.project_participants
        WHERE project_id = current_setting('probe.project')::uuid AND profile_id = v_user;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need a seeded freelancer who can join the project without review authority';
END $$;

-- The ticket's position and its hold, read back as one string.
CREATE FUNCTION pg_temp.probe_state() RETURNS text LANGUAGE sql AS $$
    SELECT concat_ws(' | ', t.status, t.current_stage_id, t.current_assignee_id, e.status, e.amount_cents)
    FROM projects.tickets t
    JOIN finance.escrows e ON e.id = current_setting('probe.escrow')::uuid
    WHERE t.id = current_setting('probe.ticket')::uuid;
$$;

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

-- `p_who` running `p_sql` must be refused with 42501 and leave the ticket where it was.
CREATE FUNCTION pg_temp.refused(p_who text, p_sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_before text := pg_temp.probe_state();
BEGIN
    BEGIN
        PERFORM pg_temp.run_as(p_who, p_sql);
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', '', true);
        IF pg_temp.probe_state() IS DISTINCT FROM v_before THEN
            RAISE EXCEPTION 'FAIL % was refused but the ticket moved: [%] -> [%]', p_who, v_before, pg_temp.probe_state();
        END IF;
        RAISE NOTICE 'PASS % refused [%]: %', p_who, SQLERRM, p_sql;
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL % was allowed: % — ticket now [%], was [%]', p_who, p_sql, pg_temp.probe_state(), v_before;
END $$;

-- `p_who` running `p_sql` must succeed and leave the ticket in `p_status`.
CREATE FUNCTION pg_temp.moves(p_who text, p_sql text, p_status ticket_status) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.run_as(p_who, p_sql);
    IF (SELECT status FROM projects.tickets WHERE id = current_setting('probe.ticket')::uuid) IS DISTINCT FROM p_status THEN
        RAISE EXCEPTION 'FAIL % ran % but the ticket is [%], not %', p_who, p_sql, pg_temp.probe_state(), p_status;
    END IF;
    RAISE NOTICE 'PASS % moved it to %: %', p_who, p_status, p_sql;
END $$;

CREATE FUNCTION pg_temp.mv(p_status text, p_stage text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT projects.move_ticket(%L, %L, %L)', current_setting('probe.ticket'), p_status, p_stage);
$$;
CREATE FUNCTION pg_temp.patch(p_set text) RETURNS text LANGUAGE sql AS $$
    SELECT format('UPDATE projects.tickets SET %s WHERE id = %L', p_set, current_setting('probe.ticket'));
$$;
-- #endregion

-- #region 1. Delivered work is not refunded to the client through the claim sweep
SAVEPOINT clawback;
-- The freelancer hands the work back for review.
SELECT pg_temp.moves('assignee', pg_temp.mv('in_review'), 'in_review');

-- The client tries to put it back in Claimed, which restarts the claim's expiry clock.
DO $$
BEGIN
    BEGIN
        PERFORM pg_temp.run_as('owner', pg_temp.mv('claimed'));
        PERFORM set_config('probe.reclaim', 'accepted', true);
    EXCEPTION WHEN insufficient_privilege THEN
        RESET ROLE;
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('probe.reclaim', 'refused', true);
    END;
END $$;

-- A day and more later the platform's sweep runs.
SELECT projects.fn_release_expired_claims(now() + interval '30 days') >= 0 AS swept;

DO $$
DECLARE
    v_escrow record;
BEGIN
    SELECT e.status, e.amount_cents INTO v_escrow FROM finance.escrows e
    WHERE e.id = current_setting('probe.escrow')::uuid;
    IF v_escrow.status IS DISTINCT FROM 'held' THEN
        RAISE EXCEPTION 'FAIL the client''s move to Claimed was %, and the claim sweep then left the freelancer''s delivered work % (% cents) — ticket now [%]',
            current_setting('probe.reclaim'), v_escrow.status, v_escrow.amount_cents, pg_temp.probe_state();
    END IF;
    IF current_setting('probe.reclaim') <> 'refused' THEN
        RAISE EXCEPTION 'FAIL the client moved delivered work back to Claimed';
    END IF;
    RAISE NOTICE 'PASS the client could not move delivered work to Claimed, and the sweep left the hold (% cents) held',
        v_escrow.amount_cents;
END $$;
ROLLBACK TO clawback;
-- #endregion

-- #region 2. Another freelancer on the project moves nothing
DO $$
DECLARE
    s text;
BEGIN
    FOREACH s IN ARRAY ARRAY['todo', 'backlog', 'in_review', 'claimed', 'cancelled', 'reported_hidden', 'completed'] LOOP
        PERFORM pg_temp.refused('bystander', pg_temp.mv(s));
    END LOOP;
    PERFORM pg_temp.refused('bystander', pg_temp.mv('in_progress', current_setting('probe.next_stage')));
END $$;
-- #endregion

-- #region 3. The client waits for the hand-back while the work is under way (#94), on every path
DO $$
DECLARE
    s text;
BEGIN
    FOREACH s IN ARRAY ARRAY['todo', 'backlog', 'in_review', 'completed'] LOOP
        PERFORM pg_temp.refused('owner', pg_temp.mv(s));
    END LOOP;
    PERFORM pg_temp.refused('owner', pg_temp.mv('in_progress', current_setting('probe.next_stage')));
    PERFORM pg_temp.refused('owner', pg_temp.patch('status = ''backlog'''));
    PERFORM pg_temp.refused('owner', pg_temp.patch('status = ''todo'''));
    PERFORM pg_temp.refused('owner', pg_temp.patch(format('current_stage_id = %L', current_setting('probe.next_stage'))));
END $$;

-- Its plain save of the ticket (commitTicketRow: an UPDATE of the row, then move_ticket to where the
-- ticket already is) still passes.
SAVEPOINT client_save;
SELECT pg_temp.moves('owner', pg_temp.patch('priority = priority, tasks = tasks'), 'in_progress');
SELECT pg_temp.moves('owner', pg_temp.mv('in_progress', current_setting('probe.stage')), 'in_progress');
ROLLBACK TO client_save;
-- #endregion

-- #region 4. No move enters Claimed, Cancelled or Hidden — those are a claim's, a stage's, a report's
DO $$
DECLARE
    s text;
BEGIN
    FOREACH s IN ARRAY ARRAY['claimed', 'cancelled', 'reported_hidden'] LOOP
        PERFORM pg_temp.refused('assignee', pg_temp.mv(s));
        PERFORM pg_temp.refused('owner', pg_temp.mv(s));
    END LOOP;
    PERFORM pg_temp.refused('assignee', pg_temp.patch('status = ''cancelled'''));
    PERFORM pg_temp.refused('assignee', pg_temp.patch('status = ''reported_hidden'''));
END $$;

SAVEPOINT handed_back;
SELECT pg_temp.moves('assignee', pg_temp.mv('in_review'), 'in_review');
DO $$
DECLARE
    s text;
BEGIN
    FOREACH s IN ARRAY ARRAY['claimed', 'cancelled', 'reported_hidden'] LOOP
        PERFORM pg_temp.refused('owner', pg_temp.mv(s));
    END LOOP;
    PERFORM pg_temp.refused('owner', pg_temp.patch('status = ''claimed'''));
    PERFORM pg_temp.refused('owner', pg_temp.patch('status = ''cancelled'''));
END $$;
ROLLBACK TO handed_back;
-- #endregion

-- #region 5. The assignee moves its ticket between To do, In progress and In review — nowhere else
SAVEPOINT payee_work;
SELECT pg_temp.moves('assignee', pg_temp.mv('todo'), 'todo');
SELECT pg_temp.moves('assignee', pg_temp.mv('in_progress'), 'in_progress');
SELECT pg_temp.moves('assignee', pg_temp.patch('status = ''todo'''), 'todo');
SELECT pg_temp.moves('assignee', pg_temp.patch('status = ''in_progress'''), 'in_progress');
SELECT pg_temp.moves('assignee', pg_temp.mv('in_review'), 'in_review');
SELECT pg_temp.moves('assignee', pg_temp.mv('in_progress'), 'in_progress');
DO $$
BEGIN
    PERFORM pg_temp.refused('assignee', pg_temp.mv('backlog'));
    PERFORM pg_temp.refused('assignee', pg_temp.patch('status = ''backlog'''));
    PERFORM pg_temp.refused('assignee', pg_temp.mv('completed'));
    PERFORM pg_temp.refused('assignee', pg_temp.mv('in_progress', current_setting('probe.next_stage')));
END $$;
ROLLBACK TO payee_work;
-- #endregion

-- #region 6. After the hand-back the client moves it: back for revision, anywhere, and Done
SAVEPOINT client_turn;
SELECT pg_temp.moves('assignee', pg_temp.mv('in_review'), 'in_review');
SELECT pg_temp.moves('owner', pg_temp.mv('in_progress'), 'in_progress');
DO $$ BEGIN PERFORM pg_temp.refused('owner', pg_temp.mv('in_review')); END $$;
SELECT pg_temp.moves('assignee', pg_temp.mv('in_review'), 'in_review');
SELECT pg_temp.moves('owner', pg_temp.mv('completed'), 'completed');
DO $$
BEGIN
    IF (SELECT e.status FROM finance.escrows e WHERE e.id = current_setting('probe.escrow')::uuid) IS DISTINCT FROM 'released' THEN
        RAISE EXCEPTION 'FAIL the client confirmed the ticket Done but its hold was not released: [%]', pg_temp.probe_state();
    END IF;
    RAISE NOTICE 'PASS the client''s Done after the hand-back released the hold to the freelancer';
END $$;
ROLLBACK TO client_turn;

SAVEPOINT client_park;
SELECT pg_temp.moves('assignee', pg_temp.mv('in_review'), 'in_review');
SELECT pg_temp.moves('owner', pg_temp.mv('todo'), 'todo');
ROLLBACK TO client_park;
-- #endregion

-- #region 7. One person on both sides, the platform, and an unclaimed ticket are not gated
SAVEPOINT ungated;
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, status, title, text_description, unit_price_cents)
VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
        current_setting('probe.owner')::uuid, 'in_progress', 'probe own work', 'x', 1000)
RETURNING set_config('probe.own_ticket', id::text, true) IS NOT NULL AS own_ticket;
INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description)
VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid, 'probe unclaimed', 'x')
RETURNING set_config('probe.open_ticket', id::text, true) IS NOT NULL AS open_ticket;

DO $$
BEGIN
    PERFORM pg_temp.run_as('owner', format('SELECT projects.move_ticket(%L, ''todo'')', current_setting('probe.own_ticket')));
    PERFORM pg_temp.run_as('owner', format('SELECT projects.move_ticket(%L, ''backlog'')', current_setting('probe.own_ticket')));
    IF (SELECT status FROM projects.tickets WHERE id = current_setting('probe.own_ticket')::uuid) <> 'backlog'::ticket_status THEN
        RAISE EXCEPTION 'FAIL the owner''s moves of their own claimed ticket did not land';
    END IF;
    RAISE NOTICE 'PASS one person on both sides moves their own claimed ticket';

    PERFORM pg_temp.run_as('owner', format('SELECT projects.move_ticket(%L, ''todo'', %L)',
        current_setting('probe.open_ticket'), current_setting('probe.next_stage')));
    IF (SELECT current_stage_id FROM projects.tickets WHERE id = current_setting('probe.open_ticket')::uuid)
        IS DISTINCT FROM current_setting('probe.next_stage')::uuid THEN
        RAISE EXCEPTION 'FAIL the client''s move of an unclaimed ticket did not land';
    END IF;
    RAISE NOTICE 'PASS the client moves an unclaimed ticket to another stage and column at will';
END $$;

SELECT set_config('request.jwt.claims', '', true);
UPDATE projects.tickets SET status = 'todo'::ticket_status WHERE id = current_setting('probe.ticket')::uuid;
DO $$
BEGIN
    IF (SELECT status FROM projects.tickets WHERE id = current_setting('probe.ticket')::uuid) <> 'todo'::ticket_status THEN
        RAISE EXCEPTION 'FAIL the platform''s move did not land';
    END IF;
    RAISE NOTICE 'PASS the platform (no auth.uid()) is not gated';
END $$;
ROLLBACK TO ungated;
-- #endregion

ROLLBACK;
