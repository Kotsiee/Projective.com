-- =============================================================================================
-- Probe: a client brief cannot be cancelled or archived with money still held (Decision #467,
-- PRD-F22 for briefs; the services rule of #456 for every project kind).
--
-- A seeded business brief holding a claimed ticket in review gets one more ticket the client funds and
-- nobody claims: held on one stage, reserved on the next (Decision #430). Then:
--   1 a plain archive or cancel is refused while anything is held (PF409, HINT 'cancel'); nothing moves
--   2 the preview: one stage to settle at a tier, the unclaimed hold and the reservation back at once
--   3 refusals: a stranger, the freelancer, a missing or bad tier, cancel_service on a brief; nothing moves
--   4 an open dispute refuses the cancel with PD409 and the preview says `dispute`
--   5 a session's sitting escrow refuses the cancel (PF409 `sittings`); the preview says `sittings`
--   6 archive passes once the money is settled (each stage Fair-Exited), refused before
--   7 the client cancels at 50%: the unclaimed ticket back whole, the claimed work settled at the
--     tier, every ticket and stage closed, then Cancelled; the seated freelancers told
--   8 conservation: every escrow held before is paid + fee + refunded to the unit, in the ledger
--     (FBP DB16's conservation_identity.sql does not exist yet, so it is asserted here)
--   9 an ended brief takes no new escrow and cancels once
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a seeded local DB:
--   deno task test:probes brief_cancel
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_project uuid;
    v_owner uuid;
    v_biz uuid;
    v_currency text;
    v_claimed_ticket uuid;
    v_freelancer uuid;
    v_stranger uuid;
    v_s1 uuid;
    v_sa uuid;
    v_sb uuid;
    v_tu uuid;
    v_tlate uuid;
    v_escrows uuid[];
    v_claimed_escrow uuid;
    v_out jsonb;
    v_preview jsonb;
    v_expected_return bigint;
    v_held_before bigint;
    v_before bigint;
    v_after bigint;
    v_detail text;
    v_hint text;
    v_n integer;
    r record;
BEGIN
    -- #region 0. Fixtures (as postgres)
    SELECT p.id, p.owner_user_id, p.client_business_id, upper(COALESCE(p.currency, 'USD')), tk.id,
           tk.current_assignee_id, ps.id
      INTO v_project, v_owner, v_biz, v_currency, v_claimed_ticket, v_freelancer, v_s1
      FROM projects.projects p
      JOIN projects.tickets tk ON tk.project_id = p.id
      JOIN finance.escrows e ON e.ticket_id = tk.id AND e.status = 'held' AND e.payee_id IS NOT NULL
      JOIN projects.project_stages ps ON ps.id = e.project_stage_id
     WHERE p.client_user_id IS NULL AND p.source_blueprint_id IS NULL AND p.status = 'active'
       AND p.client_business_id IS NOT NULL AND p.format = 'pipeline'
       AND tk.status = 'in_review' AND tk.current_assignee_id IS NOT NULL
       AND ps.status IN ('open', 'assigned', 'in_progress', 'submitted', 'revisions')
     ORDER BY p.id, tk.id
     LIMIT 1;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: no active business brief holding a claimed ticket in review';
    END IF;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_owner, v_freelancer)
       AND NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = v_project AND pp.profile_id = u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.business_members bm WHERE bm.business_id = v_biz AND bm.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_stranger IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no stranger'; END IF;

    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_biz;
    PERFORM finance.fn_ensure_wallet('business', v_biz, v_currency);
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 5000000, 'topup', 'inbound_payments', gen_random_uuid());

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 467 A', 990, 'open', 40000) RETURNING id INTO v_sa;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 467 B', 991, 'open', 60000) RETURNING id INTO v_sb;
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, v_sa, 'backlog', 'Probe 467 unclaimed', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0), jsonb_build_object('stage_id', v_sb, 'order', 1)))
    RETURNING id INTO v_tu;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    IF NOT projects.can_review_project(v_project) THEN RAISE EXCEPTION 'FAIL fixture: the owner cannot review'; END IF;
    v_out := projects.fund_ticket(v_project, v_tu, ARRAY[v_sa, v_sb]);
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_tu AND status = 'held' AND project_stage_id = v_sa AND payee_id IS NULL)
        OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_tu AND status = 'reserved' AND project_stage_id = v_sb) THEN
        RAISE EXCEPTION 'FAIL fixture: the unclaimed ticket is not held prepaid on A and reserved on B: %', v_out;
    END IF;

    SELECT array_agg(e.id ORDER BY e.id) INTO v_escrows
      FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
     WHERE ps.project_id = v_project AND e.status IN ('held', 'reserved');
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_held_before FROM finance.escrows WHERE id = ANY (v_escrows);
    SELECT e.id INTO v_claimed_escrow FROM finance.escrows e
     WHERE e.ticket_id = v_claimed_ticket AND e.status = 'held' ORDER BY e.id LIMIT 1;
    RAISE NOTICE 'fixture project=% owner=% freelancer=% stage=% held+reserved=% % over % escrows',
        v_project, v_owner, v_freelancer, v_s1, v_held_before, v_currency, cardinality(v_escrows);
    -- #endregion

    -- #region 1. A plain archive or cancel is refused while money is held
    BEGIN
        PERFORM projects.set_project_status(v_project, 'archived'::project_status);
        RAISE EXCEPTION 'FAIL 1 a brief holding escrow was archived';
    EXCEPTION WHEN SQLSTATE 'PF409' THEN
        GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_detail = PG_EXCEPTION_DETAIL;
        IF v_hint <> 'cancel' OR (v_detail::jsonb->>'reason') <> 'escrow_held' THEN
            RAISE EXCEPTION 'FAIL 1 archive refusal hint=% detail=%', v_hint, v_detail;
        END IF;
        RAISE NOTICE 'PASS 1 archive refused while money is held (PF409, HINT cancel): %', SQLERRM;
    END;
    BEGIN
        PERFORM projects.set_project_status(v_project, 'cancelled'::project_status);
        RAISE EXCEPTION 'FAIL 1 a brief holding escrow was cancelled without settling';
    EXCEPTION WHEN SQLSTATE 'PF409' THEN
        RAISE NOTICE 'PASS 1 a plain cancel refused while money is held (PF409)';
    END;
    -- #endregion

    -- #region 2. The preview
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_expected_return
      FROM finance.escrows WHERE ticket_id = v_tu AND status IN ('held', 'reserved');
    v_preview := projects.preview_project_cancel(v_project);
    IF v_preview->>'kind' <> 'project' OR (v_preview->>'cancellable')::boolean IS NOT TRUE
        OR v_preview->>'blocked' IS NOT NULL
        OR jsonb_array_length(v_preview->'stages') <> 1
        OR (v_preview->'stages'->0->>'stage_id')::uuid <> v_s1
        OR jsonb_array_length(v_preview->'stages'->0->'tiers') <> 3
        OR (v_preview->>'returned_cents')::bigint <> v_expected_return
        OR (v_preview->>'tickets_to_cancel')::integer <> (SELECT count(*) FROM projects.tickets
                                                           WHERE project_id = v_project
                                                             AND status NOT IN ('completed', 'cancelled')) THEN
        RAISE EXCEPTION 'FAIL 2 preview: % (expected % back, stage %)', v_preview, v_expected_return, v_s1;
    END IF;
    IF (v_preview->>'returned_cents')::bigint
        + (v_preview->'stages'->0->'tiers'->1->>'freelancer_paid_cents')::bigint
        + (v_preview->'stages'->0->'tiers'->1->>'fee_cents')::bigint
        + (v_preview->'stages'->0->'tiers'->1->>'client_refunded_cents')::bigint <> v_held_before THEN
        RAISE EXCEPTION 'FAIL 2 the preview at 50%% does not account for % held: %', v_held_before, v_preview;
    END IF;
    RAISE NOTICE 'PASS 2 preview: stage % needs a tier, % back at once, the 50%% quote accounts for all % held',
        v_s1, v_expected_return, v_held_before;
    -- #endregion

    -- #region 3. Refusals — nothing moves
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.cancel_project(v_project, jsonb_build_object(v_s1::text, 50));
        RAISE EXCEPTION 'FAIL 3 a stranger cancelled the brief';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS 3 a stranger cannot cancel';
    END;
    BEGIN
        PERFORM projects.preview_project_cancel(v_project);
        RAISE EXCEPTION 'FAIL 3 a stranger read the preview';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS 3 a stranger cannot read the preview';
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_freelancer, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.cancel_project(v_project, jsonb_build_object(v_s1::text, 75));
        RAISE EXCEPTION 'FAIL 3 the freelancer cancelled the client''s brief and picked their own tier';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS 3 the freelancer cannot cancel';
    END;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.cancel_project(v_project, '{}'::jsonb);
        RAISE EXCEPTION 'FAIL 3 claimed work was cancelled with no tier';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        IF (v_detail::jsonb->>'reason') <> 'tier_required'
            OR (v_detail::jsonb->'stages'->0->>'stage_id')::uuid <> v_s1 THEN
            RAISE EXCEPTION 'FAIL 3 tier refusal detail: %', v_detail;
        END IF;
        RAISE NOTICE 'PASS 3 a missing tier is refused, naming the claimed stage';
    END;
    BEGIN
        PERFORM projects.cancel_project(v_project, jsonb_build_object(v_s1::text, 60));
        RAISE EXCEPTION 'FAIL 3 a 60%% tier was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS 3 a tier outside 25/50/75 is refused';
    END;
    BEGIN
        PERFORM projects.cancel_service(v_project, jsonb_build_object(v_s1::text, 50));
        RAISE EXCEPTION 'FAIL 3 cancel_service took a brief';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS 3 cancel_service stays a bought service''s door';
    END;
    IF (SELECT COALESCE(SUM(amount_cents), 0) FROM finance.escrows
         WHERE id = ANY (v_escrows) AND status IN ('held', 'reserved')) <> v_held_before THEN
        RAISE EXCEPTION 'FAIL 3 a refusal moved money';
    END IF;
    RAISE NOTICE 'PASS 3 every refusal left % held', v_held_before;
    -- #endregion

    -- #region 4. An open dispute refuses the cancel (PD409) instead of settling around it
    BEGIN
        PERFORM set_config('request.jwt.claims', '', true);
        INSERT INTO finance.disputes (escrow_id, opened_by_profile, reason)
        VALUES (v_claimed_escrow, v_owner, 'Probe 467: the work in review is disputed');
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
        v_preview := projects.preview_project_cancel(v_project);
        IF (v_preview->>'cancellable')::boolean OR v_preview->>'blocked' <> 'dispute' THEN
            RAISE EXCEPTION 'FAIL 4 the preview did not report the dispute: %', v_preview;
        END IF;
        RAISE NOTICE 'PASS 4 the preview reports blocked = dispute';
        PERFORM projects.cancel_project(v_project, jsonb_build_object(v_s1::text, 50));
        RAISE EXCEPTION 'FAIL 4 a disputed brief was cancelled';
    EXCEPTION WHEN SQLSTATE 'PD409' THEN
        RAISE NOTICE 'PASS 4 an open dispute refuses the cancel (PD409): %', SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    IF (SELECT COALESCE(SUM(amount_cents), 0) FROM finance.escrows
         WHERE id = ANY (v_escrows) AND status IN ('held', 'reserved')) <> v_held_before THEN
        RAISE EXCEPTION 'FAIL 4 the disputed cancel moved money';
    END IF;
    -- #endregion

    -- #region 5. A session's sitting escrow is not this door's to split
    BEGIN
        PERFORM set_config('request.jwt.claims', '', true);
        INSERT INTO finance.escrows (project_stage_id, payer_business_id, payee_type, payee_id, amount_cents, currency, status)
        VALUES (v_sa, v_biz, 'freelancer', v_freelancer, 1000, v_currency, 'held');
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
        IF projects.preview_project_cancel(v_project)->>'blocked' <> 'sittings' THEN
            RAISE EXCEPTION 'FAIL 5 the preview did not report sitting escrow';
        END IF;
        PERFORM projects.cancel_project(v_project, jsonb_build_object(v_s1::text, 50));
        RAISE EXCEPTION 'FAIL 5 a ticketless hold was cancelled around';
    EXCEPTION WHEN SQLSTATE 'PF409' THEN
        GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
        IF v_hint <> 'sittings' THEN RAISE EXCEPTION 'FAIL 5 sittings refusal hint %', v_hint; END IF;
        RAISE NOTICE 'PASS 5 a ticketless (sitting) hold refuses the cancel (PF409 sittings); the preview says so';
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    -- #endregion

    -- #region 6. Archive passes once the money is settled
    BEGIN
        PERFORM projects.cancel_stage_fair_exit(v_project, v_s1, 50);
        PERFORM projects.cancel_stage_fair_exit(v_project, v_sa, 50);
        PERFORM finance.fn_refund_ticket_reservations(v_tu, NULL, 'probe');
        IF EXISTS (SELECT 1 FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
                    WHERE ps.project_id = v_project AND e.status IN ('held', 'reserved')) THEN
            RAISE EXCEPTION 'FAIL 6 fixture: money still held after settling each stage';
        END IF;
        PERFORM projects.set_project_status(v_project, 'archived'::project_status, 'Settled stage by stage');
        IF (SELECT status FROM projects.projects WHERE id = v_project) <> 'archived'::project_status THEN
            RAISE EXCEPTION 'FAIL 6 the settled brief did not archive';
        END IF;
        RAISE EXCEPTION 'probe-rollback' USING ERRCODE = 'P0001';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM <> 'probe-rollback' THEN RAISE; END IF;
        RAISE NOTICE 'PASS 6 once every stage is settled the brief archives (rolled back)';
    END;
    -- #endregion

    -- #region 7. The client cancels: settled, then Cancelled
    SELECT balance_cents INTO v_before FROM finance.wallets
     WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    v_preview := projects.preview_project_cancel(v_project);
    v_out := projects.cancel_project(v_project, jsonb_build_object(v_s1::text, 50), 'We are stopping the project');
    SELECT balance_cents INTO v_after FROM finance.wallets
     WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;

    IF v_out->>'status' <> 'cancelled' OR v_out->>'kind' <> 'project'
        OR (SELECT status FROM projects.projects WHERE id = v_project) <> 'cancelled'::project_status
        OR NOT EXISTS (SELECT 1 FROM projects.project_status_history h
                        WHERE h.project_id = v_project AND h.to_status = 'cancelled'
                          AND h.reason = 'We are stopping the project' AND h.actor_user_id = v_owner) THEN
        RAISE EXCEPTION 'FAIL 7 the brief did not land cancelled: %', v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
                WHERE ps.project_id = v_project AND e.status IN ('held', 'reserved')) THEN
        RAISE EXCEPTION 'FAIL 7 escrow is still held or reserved after the cancellation';
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_tu AND status <> 'refunded') THEN
        RAISE EXCEPTION 'FAIL 7 the unclaimed ticket''s hold and reservation did not both come back whole';
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows WHERE id = ANY (v_escrows) AND ticket_id <> v_tu AND status <> 'released') THEN
        RAISE EXCEPTION 'FAIL 7 claimed work was not settled under Fair Exit';
    END IF;
    IF (v_out->>'freelancer_paid_cents')::bigint <> (v_preview->'stages'->0->'tiers'->1->>'freelancer_paid_cents')::bigint
        OR (v_out->>'freelancer_paid_cents')::bigint <= 0
        OR (v_out->'stages'->0->>'tier')::integer <> 50 THEN
        RAISE EXCEPTION 'FAIL 7 paid % at tier % but the 50%% quote said %',
            v_out->>'freelancer_paid_cents', v_out->'stages'->0->>'tier',
            v_preview->'stages'->0->'tiers'->1->>'freelancer_paid_cents';
    END IF;
    IF v_after - v_before <> (v_out->>'client_refunded_cents')::bigint THEN
        RAISE EXCEPTION 'FAIL 7 the business wallet moved % but the door reports % refunded',
            v_after - v_before, v_out->>'client_refunded_cents';
    END IF;
    SELECT count(*) INTO v_n FROM projects.tickets
     WHERE project_id = v_project AND status <> 'cancelled'::ticket_status AND status <> 'completed'::ticket_status;
    IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 7 % tickets still open on a cancelled brief', v_n; END IF;
    IF EXISTS (SELECT 1 FROM projects.project_stages WHERE project_id = v_project
                AND status IN ('open', 'assigned', 'in_progress', 'submitted', 'revisions')) THEN
        RAISE EXCEPTION 'FAIL 7 a stage is still open on a cancelled brief';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.user_id = v_freelancer AND n.entity_id = v_project
                      AND n.type IN ('project_cancelled', 'project.cancelled')) THEN
        RAISE EXCEPTION 'FAIL 7 the seated freelancer was not told the brief was cancelled';
    END IF;
    RAISE NOTICE 'PASS 7 cancelled at 50%%: paid %, fee %, % back to the business wallet; tickets and stages closed; the freelancer told',
        v_out->>'freelancer_paid_cents', v_out->>'fee_cents', v_out->>'client_refunded_cents';
    -- #endregion

    -- #region 8. Conservation, per escrow, from the ledger
    IF (v_out->>'freelancer_paid_cents')::bigint + (v_out->>'fee_cents')::bigint
        + (v_out->>'client_refunded_cents')::bigint <> v_held_before THEN
        RAISE EXCEPTION 'FAIL 8 the door: paid % + fee % + refunded % <> held %',
            v_out->>'freelancer_paid_cents', v_out->>'fee_cents', v_out->>'client_refunded_cents', v_held_before;
    END IF;
    FOR r IN
        SELECT e.id, e.amount_cents, e.platform_fee_cents,
               (SELECT COALESCE(SUM(t.amount_cents), 0) FROM finance.transactions t
                 WHERE t.direction = 'credit' AND t.ref_table = 'escrows' AND t.ref_id = e.id
                   AND t.reason IN ('escrow_refund', 'fair_exit_refund')) AS refunded,
               (SELECT COALESCE(SUM(pr.amount_cents), 0) FROM finance.pending_releases pr WHERE pr.escrow_id = e.id)
             + (SELECT COALESCE(SUM(t.amount_cents), 0) FROM finance.transactions t
                 WHERE t.direction = 'credit' AND t.ref_table = 'escrows' AND t.ref_id = e.id
                   AND t.reason NOT IN ('escrow_refund', 'fair_exit_refund')
                   AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.transaction_id = t.id)) AS paid
          FROM finance.escrows e
         WHERE e.id = ANY (v_escrows)
    LOOP
        IF r.paid + r.platform_fee_cents + r.refunded <> r.amount_cents THEN
            RAISE EXCEPTION 'FAIL 8 escrow %: paid % + fee % + refunded % <> %',
                r.id, r.paid, r.platform_fee_cents, r.refunded, r.amount_cents;
        END IF;
    END LOOP;
    IF (SELECT SUM(amount_cents) FROM finance.transactions t
         WHERE t.direction = 'credit' AND t.ref_table = 'escrows' AND t.ref_id = ANY (v_escrows)
           AND t.reason IN ('escrow_refund', 'fair_exit_refund')) <> (v_out->>'client_refunded_cents')::bigint THEN
        RAISE EXCEPTION 'FAIL 8 the ledger''s refunds differ from the door''s figure';
    END IF;
    RAISE NOTICE 'PASS 8 conservation: each of % escrows is paid + fee + refunded to the unit in the ledger (% held in all)',
        cardinality(v_escrows), v_held_before;
    -- #endregion

    -- #region 9. An ended brief takes no new money and cancels once
    BEGIN
        PERFORM projects.cancel_project(v_project, jsonb_build_object(v_s1::text, 50));
        RAISE EXCEPTION 'FAIL 9 a cancelled brief was cancelled again';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        RAISE NOTICE 'PASS 9 a second cancellation is refused';
    END;
    BEGIN
        PERFORM projects.set_project_status(v_project, 'archived'::project_status);
        RAISE EXCEPTION 'FAIL 9 a cancelled brief changed state';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS 9 Cancelled is terminal';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO projects.tickets (project_id, owner_user_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, v_owner, v_sa, 'todo', 'Probe 467 late', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0)))
    RETURNING id INTO v_tlate;
    BEGIN
        PERFORM finance.fn_hold_ticket_escrow(v_tlate);
        RAISE EXCEPTION 'FAIL 9 escrow was held on a cancelled brief';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        RAISE NOTICE 'PASS 9 a cancelled brief takes no new escrow (%)', SQLERRM;
    END;
    -- #endregion
END $$;

ROLLBACK;
