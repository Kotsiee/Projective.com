-- =============================================================================================
-- Probe: a workload report suspends the ticket and moves no money (Decision #290).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/workload_report_suspension.sql
--
-- THE DEFECT, reproduced by execution on 2026-10-17 against the seed (rolled back). The "File workload
-- report" policy lets a ticket's assignee INSERT into projects.ticket_workload_reports — `projects` is
-- exposed to PostgREST and `authenticated` holds INSERT on the table. trg_open_workload_report →
-- projects.fn_open_workload_report then cleared the ticket's current_assignee_id, and
-- projects.fn_ticket_escrow_sync's "freelancer removed mid-work" branch paid the whole held escrow to
-- that same freelancer through finance.fn_release_ticket_escrow. On the seeded ticket: 800000 held →
-- `released` with a 40000 fee, 760000 queued to the reporter's pending balance, the ticket back in the
-- backlog — one INSERT by the payee, no client action anywhere in the chain. PRODUCT_SPEC §Dispute
-- Mechanism: Workload Intensity Reporting says a report hides the ticket and suspends the work until
-- the client adjusts W_i; nothing in it pays anybody.
--
-- What is asserted: filing suspends the ticket (`reported_hidden`, assignee and held escrow kept,
-- nothing credited); the reporter can neither lift the suspension, move the disputed W_i nor file
-- again; each way out — the client raising W_i, the expiry sweep, a bad-faith dismissal — resumes the
-- work with the escrow still held; Fair Exit and the owner's member removal settle a suspended ticket
-- as they settle any held one. A clean run prints only PASS notices; the first failed check raises
-- `FAIL …` and aborts the run. Fixtures are discovered from the seed (deno task db:reset); no ids are
-- hard-coded. Each way out runs between a SAVEPOINT and a ROLLBACK TO, so none sees another.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A ticket under way (claimed / in_progress) holding escrow bound to an individual payee, whose assignee
-- holds no review authority on the project and which carries a description (resuming into work needs one).
DO $$
DECLARE
    c record;
BEGIN
    FOR c IN
        SELECT t.id AS ticket, t.project_id AS project, t.current_stage_id AS stage,
               t.current_assignee_id AS assignee, p.owner_user_id AS owner, t.workload_intensity AS wi,
               h.payer_user_id, h.payer_business_id
        FROM projects.tickets t
        JOIN projects.projects p ON p.id = t.project_id
        JOIN LATERAL (
            SELECT e.payer_user_id, e.payer_business_id
            FROM finance.escrows e
            WHERE e.ticket_id = t.id AND e.status = 'held'
            ORDER BY e.id
            LIMIT 1
        ) h ON true
        WHERE t.status IN ('claimed'::ticket_status, 'in_progress'::ticket_status)
            AND t.current_assignee_id IS NOT NULL
            AND t.current_assignee_id <> p.owner_user_id
            AND t.workload_intensity IS NOT NULL
            AND NOT projects.fn_is_personal_project(t.project_id)
            AND NOT EXISTS (
                SELECT 1 FROM finance.escrows u
                WHERE u.ticket_id = t.id AND u.status = 'held'
                    AND (u.payee_id IS NULL OR u.payee_type = 'team'::assignment_type)
            )
            AND (NULLIF(btrim(t.text_description), '') IS NOT NULL
                OR (t.description IS NOT NULL AND t.description <> '{}'::jsonb))
        ORDER BY t.id
    LOOP
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', c.assignee, 'role', 'authenticated')::text, true);
        CONTINUE WHEN projects.can_review_project(c.project);
        PERFORM set_config('request.jwt.claims', '', true);

        PERFORM set_config('probe.ticket', c.ticket::text, true);
        PERFORM set_config('probe.project', c.project::text, true);
        PERFORM set_config('probe.stage', c.stage::text, true);
        PERFORM set_config('probe.assignee', c.assignee::text, true);
        PERFORM set_config('probe.owner', c.owner::text, true);
        PERFORM set_config('probe.wi', c.wi::text, true);
        PERFORM set_config('probe.parties', concat_ws(',', c.assignee, c.owner, c.payer_user_id, c.payer_business_id), true);
        RAISE NOTICE 'fixture ticket=% project=% stage=% assignee=% owner=% wi=%',
            c.ticket, c.project, c.stage, c.assignee, c.owner, c.wi;
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need a seeded ticket under way, holding bound escrow, whose assignee is not a reviewer (deno task db:reset)';
END $$;

-- Every money fact the report could touch: the parties' wallet balances, their ledger and pending rows,
-- the ticket's escrows, and the ticket's paid-to-date and payment status.
CREATE FUNCTION pg_temp.probe_money() RETURNS text LANGUAGE sql AS $$
    WITH parties AS (
        SELECT w.id FROM finance.wallets w
        WHERE w.owner_id = ANY (string_to_array(current_setting('probe.parties'), ',')::uuid[])
    )
    SELECT concat_ws(' | ',
        'wallets ' || (SELECT string_agg(w.id || '=' || w.balance_cents, ',' ORDER BY w.id)
                        FROM finance.wallets w WHERE w.id IN (SELECT id FROM parties)),
        'ledger ' || (SELECT count(*) FROM finance.transactions x WHERE x.wallet_id IN (SELECT id FROM parties)),
        'pending ' || (SELECT count(*) FROM finance.pending_releases r WHERE r.wallet_id IN (SELECT id FROM parties)),
        'escrows ' || (SELECT string_agg(e.id || ':' || e.status || ':' || e.amount_cents, ',' ORDER BY e.id)
                        FROM finance.escrows e WHERE e.ticket_id = current_setting('probe.ticket')::uuid),
        'ticket ' || (SELECT t.total_amount_paid || ':' || t.payment_status
                       FROM projects.tickets t WHERE t.id = current_setting('probe.ticket')::uuid)
    );
$$;

SELECT set_config('probe.money', pg_temp.probe_money(), true);

-- The money is unchanged since the fixture was read; `label` names the step in the failure.
CREATE FUNCTION pg_temp.assert_no_money_moved(label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF pg_temp.probe_money() IS DISTINCT FROM current_setting('probe.money') THEN
        RAISE EXCEPTION 'FAIL money moved (%): before [%] after [%]',
            label, current_setting('probe.money'), pg_temp.probe_money();
    END IF;
    RAISE NOTICE 'PASS no money moved (%)', label;
END;
$$;

-- The ticket is back at work with its assignee: `in_progress`, unhidden.
CREATE FUNCTION pg_temp.assert_resumed(label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    t record;
BEGIN
    SELECT status, current_assignee_id, hidden_until INTO t
    FROM projects.tickets WHERE id = current_setting('probe.ticket')::uuid;
    IF t.status <> 'in_progress'::ticket_status
        OR t.current_assignee_id IS DISTINCT FROM current_setting('probe.assignee')::uuid
        OR t.hidden_until IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL ticket did not resume (%): status=% assignee=% hidden_until=%',
            label, t.status, t.current_assignee_id, t.hidden_until;
    END IF;
    RAISE NOTICE 'PASS ticket resumed in_progress with its assignee (%)', label;
END;
$$;
-- #endregion

-- #region 1. Only the assignee files — the owner is refused by the policy
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        INSERT INTO projects.ticket_workload_reports (ticket_id, reporter_user_id, reason)
        VALUES (current_setting('probe.ticket')::uuid, current_setting('probe.owner')::uuid, 'probe: owner');
        RAISE EXCEPTION 'FAIL the project owner filed a workload report on a ticket they do not hold';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS owner refused [%]', SQLERRM;
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The assignee files — through the table, the PostgREST path — and nothing is paid
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.assignee'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_report uuid;
BEGIN
    INSERT INTO projects.ticket_workload_reports (ticket_id, reporter_user_id, reported_intensity, reason)
    VALUES (current_setting('probe.ticket')::uuid, current_setting('probe.assignee')::uuid, NULL,
            'probe: the weighting is too low for the work')
    RETURNING id INTO v_report;
    PERFORM set_config('probe.report', v_report::text, true);
    RAISE NOTICE 'PASS assignee filed report %', v_report;
END $$;
RESET ROLE;

SELECT pg_temp.assert_no_money_moved('report filed');

DO $$
DECLARE
    t record;
    v_report_until timestamptz;
BEGIN
    SELECT status, current_assignee_id, hidden_until, workload_report_id INTO t
    FROM projects.tickets WHERE id = current_setting('probe.ticket')::uuid;
    SELECT hidden_until INTO v_report_until
    FROM projects.ticket_workload_reports WHERE id = current_setting('probe.report')::uuid;

    IF t.status <> 'reported_hidden'::ticket_status THEN
        RAISE EXCEPTION 'FAIL filed ticket is % — expected reported_hidden (suspended)', t.status;
    END IF;
    IF t.current_assignee_id IS DISTINCT FROM current_setting('probe.assignee')::uuid THEN
        RAISE EXCEPTION 'FAIL filing changed the assignee to % — the report must not evict', t.current_assignee_id;
    END IF;
    IF t.hidden_until IS NULL OR t.hidden_until <= now() THEN
        RAISE EXCEPTION 'FAIL filed ticket has no open window (hidden_until=%)', t.hidden_until;
    END IF;
    IF t.workload_report_id IS DISTINCT FROM current_setting('probe.report')::uuid THEN
        RAISE EXCEPTION 'FAIL ticket.workload_report_id=% is not the filed report', t.workload_report_id;
    END IF;
    IF v_report_until IS DISTINCT FROM t.hidden_until THEN
        RAISE EXCEPTION 'FAIL report.hidden_until=% differs from the ticket''s % — the expiry sweep reads the report',
            v_report_until, t.hidden_until;
    END IF;
    RAISE NOTICE 'PASS ticket suspended: reported_hidden, assignee kept, window to %', t.hidden_until;
END $$;
-- #endregion

-- #region 3. The suspension holds against the reporter; the client's W_i stays locked except upward
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.assignee'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('UPDATE projects.tickets SET status = ''in_progress'' WHERE id = %L', current_setting('probe.ticket')),
        format('UPDATE projects.tickets SET status = ''in_review'' WHERE id = %L', current_setting('probe.ticket')),
        format('UPDATE projects.tickets SET workload_intensity = workload_intensity + 1 WHERE id = %L',
               current_setting('probe.ticket'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL reporter lifted their own suspension: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS reporter refused [%]: %', SQLERRM, v_sql;
        END;
    END LOOP;

    BEGIN
        INSERT INTO projects.ticket_workload_reports (ticket_id, reporter_user_id, reason)
        VALUES (current_setting('probe.ticket')::uuid, current_setting('probe.assignee')::uuid, 'probe: again');
        RAISE EXCEPTION 'FAIL a second report was filed on a suspended ticket';
    EXCEPTION WHEN object_not_in_prerequisite_state THEN
        RAISE NOTICE 'PASS second report refused [%]', SQLERRM;
    END;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        UPDATE projects.tickets SET workload_intensity = workload_intensity / 2
        WHERE id = current_setting('probe.ticket')::uuid;
        RAISE EXCEPTION 'FAIL the client LOWERED W_i on a claimed ticket';
    EXCEPTION WHEN raise_exception THEN
        RAISE NOTICE 'PASS client lowering W_i refused [%]', SQLERRM;
    END;
END $$;
RESET ROLE;

SELECT pg_temp.assert_no_money_moved('refused attempts');
SAVEPOINT suspended;
-- #endregion

-- #region 4. Way out (a): the client raises W_i — the report is adjusted and the work resumes
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_rows integer;
BEGIN
    UPDATE projects.tickets SET workload_intensity = workload_intensity + 1
    WHERE id = current_setting('probe.ticket')::uuid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'FAIL the client could not raise W_i on the suspended ticket (rows=%)', v_rows;
    END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
    v_status projects.workload_report_status;
    v_wi numeric;
BEGIN
    SELECT status INTO v_status FROM projects.ticket_workload_reports WHERE id = current_setting('probe.report')::uuid;
    IF v_status <> 'adjusted'::projects.workload_report_status THEN
        RAISE EXCEPTION 'FAIL report is % after the client raised W_i — expected adjusted', v_status;
    END IF;
    SELECT workload_intensity INTO v_wi FROM projects.tickets WHERE id = current_setting('probe.ticket')::uuid;
    IF v_wi <> current_setting('probe.wi')::numeric + 1 THEN
        RAISE EXCEPTION 'FAIL W_i is % — expected the raised %', v_wi, current_setting('probe.wi')::numeric + 1;
    END IF;
    RAISE NOTICE 'PASS report adjusted, W_i now %', v_wi;
END $$;
SELECT pg_temp.assert_resumed('client raised W_i');
SELECT pg_temp.assert_no_money_moved('client raised W_i');
ROLLBACK TO SAVEPOINT suspended;
-- #endregion

-- #region 5. Way out (b): the window lapses — the sweep penalises the client and the work resumes
UPDATE projects.ticket_workload_reports SET hidden_until = now() - interval '1 minute'
WHERE id = current_setting('probe.report')::uuid;
DO $$
DECLARE
    v_n integer;
    v_status projects.workload_report_status;
BEGIN
    v_n := projects.fn_resolve_expired_workload_reports();
    SELECT status INTO v_status FROM projects.ticket_workload_reports WHERE id = current_setting('probe.report')::uuid;
    IF v_n < 1 OR v_status <> 'expired_penalized'::projects.workload_report_status THEN
        RAISE EXCEPTION 'FAIL the expiry sweep resolved % report(s); ours is %', v_n, v_status;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM security.penalties
                    WHERE source_type = 'workload_report' AND source_id = current_setting('probe.report')::uuid) THEN
        RAISE EXCEPTION 'FAIL the expiry sweep recorded no penalty for the report';
    END IF;
    RAISE NOTICE 'PASS expiry sweep resolved the report (expired_penalized, penalty recorded)';
END $$;
SELECT pg_temp.assert_resumed('window lapsed');
SELECT pg_temp.assert_no_money_moved('window lapsed');
ROLLBACK TO SAVEPOINT suspended;
-- #endregion

-- #region 6. Way out (c): the report is dismissed as bad faith — the work resumes at the old W_i
DO $$
DECLARE
    v_status projects.workload_report_status;
BEGIN
    PERFORM projects.fn_flag_bad_faith_report(current_setting('probe.report')::uuid);
    SELECT status INTO v_status FROM projects.ticket_workload_reports WHERE id = current_setting('probe.report')::uuid;
    IF v_status <> 'dismissed_bad_faith'::projects.workload_report_status THEN
        RAISE EXCEPTION 'FAIL report is % after a bad-faith dismissal', v_status;
    END IF;
    RAISE NOTICE 'PASS report dismissed as bad faith';
END $$;
SELECT pg_temp.assert_resumed('dismissed as bad faith');
SELECT pg_temp.assert_no_money_moved('dismissed as bad faith');
ROLLBACK TO SAVEPOINT suspended;
-- #endregion

-- #region 7. The client ends the stage under Fair Exit — the suspended ticket closes with it
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_quote jsonb;
BEGIN
    v_quote := projects.preview_stage_fair_exit(current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid);
    IF (v_quote->>'tickets_to_cancel')::integer < 1 THEN
        RAISE EXCEPTION 'FAIL the Fair Exit preview counts no ticket to cancel: %', v_quote;
    END IF;
    PERFORM projects.cancel_stage_fair_exit(current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid, 50);
END $$;
RESET ROLE;
DO $$
DECLARE
    t record;
BEGIN
    SELECT status, hidden_until INTO t FROM projects.tickets WHERE id = current_setting('probe.ticket')::uuid;
    IF t.status <> 'cancelled'::ticket_status OR t.hidden_until IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL Fair Exit left the suspended ticket % (hidden_until=%) — expected cancelled, unhidden',
            t.status, t.hidden_until;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = current_setting('probe.ticket')::uuid AND status = 'held') THEN
        RAISE EXCEPTION 'FAIL Fair Exit left escrow held on the suspended ticket';
    END IF;
    RAISE NOTICE 'PASS Fair Exit settled and cancelled the suspended ticket';
END $$;
ROLLBACK TO SAVEPOINT suspended;
-- #endregion

-- #region 8. The owner removes the reporter — the suspended ticket is settled like any held one
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_participant uuid;
BEGIN
    SELECT pp.id INTO v_participant
    FROM projects.project_participants pp
    WHERE pp.project_id = current_setting('probe.project')::uuid
        AND pp.profile_id = current_setting('probe.assignee')::uuid
        AND pp.profile_type = 'freelancer'
    ORDER BY pp.id
    LIMIT 1;
    IF v_participant IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: the assignee has no freelancer participant row on the project';
    END IF;
    PERFORM projects.remove_project_member(current_setting('probe.project')::uuid, v_participant,
                                           current_setting('probe.stage')::uuid);
END $$;
RESET ROLE;
DO $$
DECLARE
    t record;
BEGIN
    SELECT status, current_assignee_id INTO t FROM projects.tickets WHERE id = current_setting('probe.ticket')::uuid;
    IF t.status <> 'backlog'::ticket_status OR t.current_assignee_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL removal left the suspended ticket % with assignee % — expected backlog, unassigned',
            t.status, t.current_assignee_id;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = current_setting('probe.ticket')::uuid AND status = 'held') THEN
        RAISE EXCEPTION 'FAIL removal left escrow held on the suspended ticket';
    END IF;
    RAISE NOTICE 'PASS owner removal settled the suspended ticket (PRODUCT_SPEC §Freelancer Removal Mid-Ticket)';
END $$;
ROLLBACK TO SAVEPOINT suspended;
-- #endregion

ROLLBACK;
