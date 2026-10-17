-- =============================================================================================
-- Probe: a claimed ticket's money terms are not the payee's to rewrite (Decision #291).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/ticket_terms_payee_lock.sql
--
-- THE DEFECT, reproduced by execution on 2026-10-17 against the seed (rolled back).
-- projects.fn_ticket_immutability_guard locked a claimed ticket's title, description, price, stage
-- sequence and W_i against everybody EXCEPT its assignee, and the "Manage tickets" policy admits the
-- assignee to UPDATE (and INSERT a ticket naming themselves). finance.fn_hold_ticket_escrow prices a
-- hold as COALESCE(ticket.unit_price_cents, current stage's price), and approving a stage of a
-- multi-stage ticket holds the next one at once from the client's wallet (the Chain Reaction, Decision
-- #210). So the payee could raise unit_price_cents tenfold with one PATCH and the client's next stage
-- was held at the payee's figure. The same door let the payee repoint current_stage_id (directly or
-- through projects.move_ticket — the hold reads that stage's price and the chain counts the next
-- installment from it), mark the ticket needs_funding (the auto-fund drain holds such a ticket from a
-- business wallet), and INSERT a self-assigned ticket at any price into the client's project.
-- PRODUCT_SPEC §Editing & Reordering Restrictions: once claimed, ticket details (title, description,
-- budget) are locked; §Post-Onboarding Immutability: the ticket price is frozen as each stage is staffed.
--
-- What is asserted: approving a stage holds the next one at the price the client agreed, whatever the
-- payee tried first; every write by the payee to the terms, the stage pointer or the payment
-- bookkeeping is refused (42501) on the table path and through move_ticket, and so is a self-assigned
-- INSERT; another freelancer on the project cannot move the ticket to another stage through
-- move_ticket either; the payee's restated row and status moves within the stage still pass; the client is still
-- held to the claimed terms, may still compose an unassigned ticket, and may not write the bookkeeping
-- either; one person on both sides and the platform are not gated. A clean run prints only PASS
-- notices; the first failed check raises `FAIL …` and aborts the run. Fixtures are discovered from the
-- seed (deno task db:reset); no ids are hard-coded.
-- =============================================================================================

BEGIN;
-- @prelude (in-flight definitions are spliced here when probing before a reset)

-- #region 0. Fixtures (as postgres)
-- A ticket under way holding a base escrow for an individual payee who holds no review authority, on a
-- project with another open stage the ticket can chain into, and carrying a description.
DO $$
DECLARE
    c record;
    v_wallet uuid;
BEGIN
    FOR c IN
        SELECT t.id AS ticket, t.project_id AS project, t.current_stage_id AS stage,
               t.current_assignee_id AS assignee, p.owner_user_id AS owner,
               t.unit_price_cents AS ticket_price,
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
        -- What the client agreed to hold for the next stage: the hold's own pricing rule.
        PERFORM set_config('probe.agreed', COALESCE(c.ticket_price,
            (SELECT s.unit_price_cents FROM projects.project_stages s WHERE s.id = c.next_stage))::text, true);

        -- The chain's hold is a business spend like any other (BB3); this probe is about the price it
        -- holds, so the payer's vault carries no approval threshold and the owner no envelope here
        -- (business_spend_gate.sql covers both), and the wallet could cover ten times the agreed price:
        -- a payee's tenfold edit would then be HELD rather than only asked for, the defect at its worst.
        SELECT w.id INTO v_wallet
        FROM finance.wallets w
        JOIN projects.projects p ON p.id = c.project
        WHERE w.currency = upper(COALESCE(p.currency, 'USD'))
            AND w.owner_id = COALESCE(p.client_business_id, p.owner_user_id)
            AND w.owner_type = finance.fn_escrow_payer_wallet_type(p.client_business_id,
                    CASE WHEN p.client_business_id IS NULL THEN p.owner_user_id END);
        UPDATE finance.wallets
           SET approval_threshold_cents = NULL,
               balance_cents = balance_cents + 10 * current_setting('probe.agreed')::bigint
         WHERE id = v_wallet;
        DELETE FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id = c.owner;
        UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'vault_approval_threshold_cents';

        -- Two installments: the stage under way, then the next one.
        UPDATE projects.tickets
           SET required_stages = jsonb_build_array(
                   jsonb_build_object('stage_id', c.stage, 'order', 1),
                   jsonb_build_object('stage_id', c.next_stage, 'order', 2))
         WHERE id = c.ticket;

        RAISE NOTICE 'fixture ticket=% project=% stage=% next_stage=% assignee=% owner=% agreed=%',
            c.ticket, c.project, c.stage, c.next_stage, c.assignee, c.owner,
            current_setting('probe.agreed');
        RETURN;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need a seeded ticket under way, holding escrow for a non-reviewer freelancer, on a project with another open stage (deno task db:reset)';
END $$;

-- The terms and bookkeeping the payee must not move, read back as one string.
CREATE FUNCTION pg_temp.probe_terms() RETURNS text LANGUAGE sql AS $$
    SELECT concat_ws(' | ', t.title, md5(t.description::text), md5(t.text_description), t.unit_price_cents,
                     t.required_stages::text, t.workload_intensity, t.current_stage_id, t.payment_status,
                     t.total_amount_paid)
    FROM projects.tickets t WHERE t.id = current_setting('probe.ticket')::uuid;
$$;
SELECT set_config('probe.terms', pg_temp.probe_terms(), true);
-- #endregion

-- #region 1. The Chain Reaction holds the next stage at the price the client agreed
SAVEPOINT chain;

-- The payee tries to raise the price before the client approves the stage under way.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.assignee'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        UPDATE projects.tickets
           SET unit_price_cents = COALESCE(unit_price_cents, current_setting('probe.agreed')::bigint) * 10
         WHERE id = current_setting('probe.ticket')::uuid;
        PERFORM set_config('probe.inflate', 'accepted', true);
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM set_config('probe.inflate', 'refused', true);
    END;
END $$;
RESET ROLE;

-- The client approves it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
SELECT projects.force_complete_stage(current_setting('probe.ticket')::uuid) IS NOT NULL AS advanced;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

DO $$
DECLARE
    v_held bigint;
    v_asked text;
    v_ticket record;
BEGIN
    SELECT e.amount_cents INTO v_held
    FROM finance.escrows e
    WHERE e.ticket_id = current_setting('probe.ticket')::uuid
        AND e.project_stage_id = current_setting('probe.next_stage')::uuid
        AND e.status = 'held' AND e.revision_id IS NULL;
    SELECT n.payload->>'amount_minor' INTO v_asked
    FROM comms.notifications n
    WHERE n.entity_id = current_setting('probe.ticket')::uuid AND n.type = 'escrow.needs_funding'
    ORDER BY n.created_at DESC LIMIT 1;

    IF v_held IS DISTINCT FROM current_setting('probe.agreed')::bigint THEN
        RAISE EXCEPTION 'FAIL the payee''s price edit was %, and the client''s next stage was held at % (asked to fund %), not the agreed %',
            current_setting('probe.inflate'), COALESCE(v_held::text, 'nothing'), COALESCE(v_asked, '-'),
            current_setting('probe.agreed');
    END IF;
    IF current_setting('probe.inflate') <> 'refused' THEN
        RAISE EXCEPTION 'FAIL the payee''s price edit was accepted';
    END IF;
    RAISE NOTICE 'PASS the payee''s price edit was refused and the next stage was held at the agreed %', v_held;

    -- The escrow functions still keep the bookkeeping the client's statement set off.
    SELECT payment_status, total_amount_paid, current_stage_id INTO v_ticket
    FROM projects.tickets WHERE id = current_setting('probe.ticket')::uuid;
    IF v_ticket.payment_status <> 'escrow_funded'::payment_status
        OR v_ticket.total_amount_paid <= 0
        OR v_ticket.current_stage_id IS DISTINCT FROM current_setting('probe.next_stage')::uuid THEN
        RAISE EXCEPTION 'FAIL the approval''s own bookkeeping did not land: %', row_to_json(v_ticket);
    END IF;
    RAISE NOTICE 'PASS the release and the next hold still write payment_status and total_amount_paid';
END $$;

ROLLBACK TO chain;
-- #endregion

-- #region 2. The payee may not write a term, the stage pointer or the bookkeeping — any path
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.assignee'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_sql text;
    v_t text := quote_literal(current_setting('probe.ticket'));
BEGIN
    IF NOT projects.has_project_access(current_setting('probe.project')::uuid) THEN
        RAISE EXCEPTION 'FAIL fixture: the assignee should have project access (move_ticket''s own guard)';
    END IF;

    FOREACH v_sql IN ARRAY ARRAY[
        'UPDATE projects.tickets SET unit_price_cents = COALESCE(unit_price_cents, 1) * 10 WHERE id = ' || v_t,
        'UPDATE projects.tickets SET unit_price_cents = NULL WHERE id = ' || v_t,
        format('UPDATE projects.tickets SET required_stages = jsonb_build_array(jsonb_build_object(''stage_id'', %L, ''order'', 1)) WHERE id = %s',
            current_setting('probe.next_stage'), v_t),
        format('UPDATE projects.tickets SET current_stage_id = %L WHERE id = %s', current_setting('probe.next_stage'), v_t),
        format('SELECT projects.move_ticket(%s, ''in_progress'', %L)', v_t, current_setting('probe.next_stage')),
        'UPDATE projects.tickets SET title = title || '' (payee)'' WHERE id = ' || v_t,
        'UPDATE projects.tickets SET description = jsonb_build_object(''html'', ''<p>less</p>''), text_description = ''less'' WHERE id = ' || v_t,
        'UPDATE projects.tickets SET workload_intensity = workload_intensity / 2 WHERE id = ' || v_t,
        'UPDATE projects.tickets SET payment_status = ''needs_funding'' WHERE id = ' || v_t,
        'UPDATE projects.tickets SET total_amount_paid = total_amount_paid + 1 WHERE id = ' || v_t,
        format('INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents) VALUES (%L, %L, %L, ''payee-made'', ''x'', 99999999)',
            current_setting('probe.project'), current_setting('probe.stage'), current_setting('probe.assignee')),
        format('INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description) VALUES (%L, %L, %L, ''payee-made'', ''x'')',
            current_setting('probe.project'), current_setting('probe.stage'), current_setting('probe.assignee'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL the payee wrote: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS payee refused [%]: %', SQLERRM, v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF pg_temp.probe_terms() IS DISTINCT FROM current_setting('probe.terms') THEN
        RAISE EXCEPTION 'FAIL the terms moved: before [%] after [%]', current_setting('probe.terms'), pg_temp.probe_terms();
    END IF;
    RAISE NOTICE 'PASS the ticket''s terms and bookkeeping are as the fixture read them';
END $$;
-- #endregion

-- #region 2b. Nor may another freelancer on the project — move_ticket admits any project access
SAVEPOINT bystander;
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
            RETURN;
        END IF;
        PERFORM set_config('request.jwt.claims', '', true);
        DELETE FROM projects.project_participants
        WHERE project_id = current_setting('probe.project')::uuid AND profile_id = v_user;
    END LOOP;
    RAISE EXCEPTION 'FAIL no fixture: need a seeded freelancer who can join the project without review authority';
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.bystander'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM projects.move_ticket(current_setting('probe.ticket')::uuid, 'in_progress'::ticket_status,
            current_setting('probe.next_stage')::uuid);
        RAISE EXCEPTION 'FAIL another freelancer on the project moved the claimed ticket to another stage';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS another freelancer refused the stage move [%]', SQLERRM;
    END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
ROLLBACK TO bystander;
-- #endregion

-- #region 3. What the payee still does: restate the row, move it between work columns of its stage
SAVEPOINT payee_work;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.assignee'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_t uuid := current_setting('probe.ticket')::uuid;
BEGIN
    -- PostgREST PATCHing the whole row back moves nothing, so it passes.
    UPDATE projects.tickets
       SET title = title, unit_price_cents = unit_price_cents, required_stages = required_stages,
           current_stage_id = current_stage_id, payment_status = payment_status,
           total_amount_paid = total_amount_paid, tasks = tasks
     WHERE id = v_t;
    RAISE NOTICE 'PASS the payee''s restated row passes';

    PERFORM projects.move_ticket(v_t, 'todo'::ticket_status, current_setting('probe.stage')::uuid);
    PERFORM projects.move_ticket(v_t, 'in_progress'::ticket_status, NULL);
    IF (SELECT status FROM projects.tickets WHERE id = v_t) <> 'in_progress'::ticket_status THEN
        RAISE EXCEPTION 'FAIL the payee''s column moves did not land';
    END IF;
    RAISE NOTICE 'PASS the payee still moves the ticket between work columns of its own stage';
END $$;
RESET ROLE;
ROLLBACK TO payee_work;
-- #endregion

-- #region 4. The client side: held to the claimed terms, composes, keeps off the bookkeeping
SAVEPOINT client;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_sql text;
    v_new uuid;
BEGIN
    BEGIN
        UPDATE projects.tickets SET unit_price_cents = COALESCE(unit_price_cents, 1) + 1
         WHERE id = current_setting('probe.ticket')::uuid;
        RAISE EXCEPTION 'FAIL the client repriced a claimed ticket';
    EXCEPTION WHEN raise_exception THEN
        RAISE NOTICE 'PASS client refused a claimed ticket''s price [%]', SQLERRM;
    END;

    INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description)
    VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid, 'probe compose', 'x')
    RETURNING id INTO v_new;
    RAISE NOTICE 'PASS the client still composes an unassigned ticket (%)', v_new;

    FOREACH v_sql IN ARRAY ARRAY[
        format('UPDATE projects.tickets SET payment_status = ''needs_funding'' WHERE id = %L', current_setting('probe.ticket')),
        format('UPDATE projects.tickets SET payment_status = ''needs_funding'' WHERE id = %L', v_new),
        format('INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description, payment_status) VALUES (%L, %L, ''probe'', ''x'', ''needs_funding'')',
            current_setting('probe.project'), current_setting('probe.stage')),
        format('INSERT INTO projects.tickets (project_id, current_stage_id, title, text_description, total_amount_paid) VALUES (%L, %L, ''probe'', ''x'', 5)',
            current_setting('probe.project'), current_setting('probe.stage'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL the client wrote the bookkeeping: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS client refused [%]: %', SQLERRM, v_sql;
        END;
    END LOOP;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
ROLLBACK TO client;
-- #endregion

-- #region 5. One person on both sides, and the platform, are not gated
SAVEPOINT ungated;
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, status, title, text_description, unit_price_cents)
VALUES (current_setting('probe.project')::uuid, current_setting('probe.stage')::uuid,
        current_setting('probe.owner')::uuid, 'in_progress', 'probe own work', 'x', 1000)
RETURNING set_config('probe.own_ticket', id::text, true) IS NOT NULL AS own_ticket;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    UPDATE projects.tickets SET title = 'probe own work, renamed', unit_price_cents = 2000
     WHERE id = current_setting('probe.own_ticket')::uuid;
    IF (SELECT unit_price_cents FROM projects.tickets WHERE id = current_setting('probe.own_ticket')::uuid) <> 2000 THEN
        RAISE EXCEPTION 'FAIL the owner''s edit of their own claimed ticket did not land';
    END IF;
    RAISE NOTICE 'PASS one person on both sides edits their own claimed ticket';
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);
DO $$
BEGIN
    UPDATE projects.tickets SET unit_price_cents = COALESCE(unit_price_cents, 1) + 1
     WHERE id = current_setting('probe.ticket')::uuid;
    RAISE NOTICE 'PASS the platform (no auth.uid()) is not gated';
END $$;
ROLLBACK TO ungated;
-- #endregion

ROLLBACK;
