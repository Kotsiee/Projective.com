-- =============================================================================================
-- Probe: multi-stage ticket prepay (Decision #430) — a `reserved` escrow per later stage.
--   1 the quote: every stage priced, the funding stage `now`, later ones `later`, all fundable
--   2 fund_ticket with a selection: the funding stage held (placed, Ready, its clock), a later one
--     reserved (unbound, no clock), the wallet moved by the sum, the business envelope counted ONCE
--   3 the quote after: funded / prepaid / later, the prepaid stage no longer fundable
--   4 refusals: a stage already paid for, a stage the ticket does not list, all or nothing; one
--     reservation per stage (index) and its shape (CHECK)
--   5 releasing the stage at work leaves the reservation alone; arriving in the prepaid stage holds
--     it with no second debit, bound to the continuing payee, no clock — even with chain reaction off
--   6 reservations alone leave the ticket in New; dropping a stage refunds its reservation
--   7 a cancelled ticket refunds the stages it never reached
--   8 a deleted ticket refunds the stages it never reached
--   9 the TTL sweep returns the prepaid stages with the expired hold
--  10 the basket: two stage lines of one ticket, one order — held and prepaid; a passed stage refused
--  11 a completed ticket refunds the stages it never reached
--  12 the approval threshold judges the whole selection
--  13 an individual client prepays from their own wallet
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/stage_prepay.sql
-- A clean run prints only PASS.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_project uuid;
    v_owner uuid;
    v_biz uuid;
    v_currency text;
    v_fl uuid;
    v_wallet uuid;
    v_sa uuid;
    v_sb uuid;
    v_sc uuid;
    v_sd uuid;
    v_p1 uuid;
    v_p2 uuid;
    v_p3 uuid;
    v_p4 uuid;
    v_p5 uuid;
    v_p6 uuid;
    v_p7 uuid;
    v_escrow uuid;
    v_basket uuid;
    v_la uuid;
    v_lb uuid;
    v_before bigint;
    v_after bigint;
    v_spent bigint;
    v_n integer;
    v_out jsonb;
    v_row record;
    v_ok boolean;
    v_code text;
    v_msg text;
    v_ind_project uuid;
    v_ind_owner uuid;
    v_ind_currency text;
    v_ind_wallet uuid;
    v_ix uuid;
    v_iy uuid;
    v_it uuid;
    r record;
BEGIN
    -- #region Fixture (as postgres)
    FOR r IN
        SELECT p.id, p.owner_user_id, p.client_business_id, upper(COALESCE(p.currency, 'USD')) AS currency
          FROM projects.projects p
         WHERE p.client_business_id IS NOT NULL AND p.format = 'pipeline' AND p.structure_variation = 'standard'
           AND p.source_blueprint_id IS NULL
         ORDER BY p.id
    LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', r.owner_user_id, 'role', 'authenticated')::text, true);
        IF finance.fn_owner_capability('business', r.client_business_id, 'spend'::finance.vault_capability) THEN
            v_project := r.id; v_owner := r.owner_user_id; v_biz := r.client_business_id; v_currency := r.currency;
            EXIT;
        END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no business client project whose owner can spend'; END IF;
    SELECT fp.user_id INTO v_fl FROM org.freelancer_profiles fp
     WHERE fp.user_id <> v_owner AND finance.fn_freelancer_payout_ready(fp.user_id)
     ORDER BY fp.user_id LIMIT 1;
    IF v_fl IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no payout-ready freelancer'; END IF;

    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_biz;
    v_wallet := finance.fn_ensure_wallet('business', v_biz, v_currency);
    UPDATE finance.wallets SET approval_threshold_cents = 100000000 WHERE id = v_wallet;
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 2000000, 'topup', 'inbound_payments', gen_random_uuid());
    INSERT INTO finance.spending_limits (wallet_id, member_user_id, cap_cents, per_transaction_cents, period_interval, spent_cents)
    VALUES (v_wallet, v_owner, NULL, NULL, 'total', 0)
    ON CONFLICT (wallet_id, member_user_id)
        DO UPDATE SET cap_cents = NULL, per_transaction_cents = NULL, period_interval = 'total', spent_cents = 0;

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 430 A', 993, 'open', 40000) RETURNING id INTO v_sa;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 430 B', 994, 'open', 60000) RETURNING id INTO v_sb;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 430 C', 995, 'open', 25000) RETURNING id INTO v_sc;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 430 D', 996, 'open', 10000) RETURNING id INTO v_sd;

    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    SELECT v_project, NULL, 'backlog', 'Probe 430 P' || n, '{"t":"x"}', 'A description.',
           jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0),
                             jsonb_build_object('stage_id', v_sb, 'order', 1),
                             jsonb_build_object('stage_id', v_sc, 'order', 2))
      FROM generate_series(1, 7) n;
    SELECT id INTO v_p1 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 430 P1';
    SELECT id INTO v_p2 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 430 P2';
    SELECT id INTO v_p3 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 430 P3';
    SELECT id INTO v_p4 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 430 P4';
    SELECT id INTO v_p5 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 430 P5';
    SELECT id INTO v_p6 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 430 P6';
    SELECT id INTO v_p7 FROM projects.tickets WHERE project_id = v_project AND title = 'Probe 430 P7';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    -- #endregion

    -- #region 1. The quote before: now / later / later, each priced and fundable
    v_out := projects.get_ticket_funding_quote(v_project, v_p1);
    IF (v_out ->> 'blocked') IS NOT NULL
       OR (v_out -> 'stages' -> 0 ->> 'phase') <> 'now' OR (v_out -> 'stages' -> 1 ->> 'phase') <> 'later'
       OR (v_out -> 'stages' -> 2 ->> 'phase') <> 'later'
       OR (v_out -> 'stages' -> 0 ->> 'fundable')::boolean IS NOT TRUE
       OR (v_out -> 'stages' -> 1 ->> 'fundable')::boolean IS NOT TRUE
       OR (v_out -> 'stages' -> 2 ->> 'fundable')::boolean IS NOT TRUE
       OR (v_out -> 'stages' -> 1 ->> 'amount_cents')::bigint <> 60000 THEN
        RAISE EXCEPTION 'FAIL 1: %', v_out;
    END IF;
    RAISE NOTICE 'PASS 1 quote: A now, B and C later, all three fundable at their own prices';
    -- #endregion

    -- #region 2. fund_ticket with A and B: A held, B reserved, one envelope count
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    v_out := projects.fund_ticket(v_project, v_p1, ARRAY[v_sa, v_sb]);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_before - v_after <> 100000 OR (v_out ->> 'amount_cents')::bigint <> 100000
       OR (v_out ->> 'held')::boolean IS NOT TRUE OR (v_out -> 'reserved_stage_ids') <> to_jsonb(ARRAY[v_sb]) THEN
        RAISE EXCEPTION 'FAIL 2: wallet moved % / %', v_before - v_after, v_out;
    END IF;
    SELECT e.project_stage_id, e.payee_id, e.expires_at INTO v_row
      FROM finance.escrows e WHERE e.ticket_id = v_p1 AND e.status = 'held';
    IF v_row.project_stage_id <> v_sa OR v_row.payee_id IS NOT NULL OR v_row.expires_at IS NULL THEN
        RAISE EXCEPTION 'FAIL 2: the hold %', row_to_json(v_row);
    END IF;
    SELECT e.project_stage_id, e.amount_cents, e.payee_id, e.expires_at INTO v_row
      FROM finance.escrows e WHERE e.ticket_id = v_p1 AND e.status = 'reserved';
    IF v_row.project_stage_id <> v_sb OR v_row.amount_cents <> 60000 OR v_row.payee_id IS NOT NULL
       OR v_row.expires_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 2: the reservation %', row_to_json(v_row);
    END IF;
    IF EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p1 AND project_stage_id = v_sc) THEN
        RAISE EXCEPTION 'FAIL 2: C was paid for though not chosen';
    END IF;
    SELECT count(*) INTO v_n
      FROM finance.transactions t JOIN finance.escrows e ON e.id = t.ref_id
     WHERE t.ref_table = 'escrows' AND e.ticket_id = v_p1 AND t.direction = 'debit';
    IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL 2: % escrow debits, expected 2', v_n; END IF;
    SELECT spent_cents INTO v_spent FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id = v_owner;
    IF v_spent <> 100000 THEN RAISE EXCEPTION 'FAIL 2: the envelope counted % for a 100000 selection', v_spent; END IF;
    SELECT t.current_stage_id, t.status::text AS status, t.payment_status::text AS payment_status INTO v_row
      FROM projects.tickets t WHERE t.id = v_p1;
    IF v_row.current_stage_id <> v_sa OR v_row.status <> 'todo' OR v_row.payment_status <> 'escrow_funded' THEN
        RAISE EXCEPTION 'FAIL 2: the ticket %', row_to_json(v_row);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_p1 AND h.action_type = 'stage_prepaid'
                    AND h.new_stage_id = v_sb AND (h.changes ->> 'amount_minor')::bigint = 60000) THEN
        RAISE EXCEPTION 'FAIL 2: no stage_prepaid history row';
    END IF;
    RAISE NOTICE 'PASS 2 fund_ticket A+B: 100000 moved, A held with its clock, B reserved unbound with none, C untouched, envelope counted once, Ready';
    -- #endregion

    -- #region 3. The quote after: funded / prepaid / later
    v_out := projects.get_ticket_funding_quote(v_project, v_p1);
    IF (v_out ->> 'blocked') IS NOT NULL
       OR (v_out -> 'stages' -> 0 ->> 'phase') <> 'funded' OR (v_out -> 'stages' -> 1 ->> 'phase') <> 'prepaid'
       OR (v_out -> 'stages' -> 2 ->> 'phase') <> 'later'
       OR (v_out -> 'stages' -> 0 ->> 'fundable')::boolean IS NOT FALSE
       OR (v_out -> 'stages' -> 1 ->> 'fundable')::boolean IS NOT FALSE
       OR (v_out -> 'stages' -> 2 ->> 'fundable')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL 3: %', v_out;
    END IF;
    RAISE NOTICE 'PASS 3 quote after: A funded, B prepaid, C later and still fundable, not blocked';
    -- #endregion

    -- #region 4. Refusals, all or nothing, the index and the CHECK
    v_code := NULL;
    BEGIN
        PERFORM projects.fund_ticket(v_project, v_p1, ARRAY[v_sb]);
        v_code := 'ok';
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    IF v_code <> 'PC409' OR v_msg NOT LIKE 'That stage of "%" is already paid for.' THEN
        RAISE EXCEPTION 'FAIL 4: B again % %', v_code, v_msg;
    END IF;
    BEGIN
        PERFORM projects.fund_ticket(v_project, v_p1, ARRAY[v_sa]);
        v_code := 'ok';
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    IF v_code <> 'PC409' OR v_msg NOT LIKE '"%" is already paid for.' THEN
        RAISE EXCEPTION 'FAIL 4: A again % %', v_code, v_msg;
    END IF;
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    BEGIN
        PERFORM projects.fund_ticket(v_project, v_p1, ARRAY[v_sc, v_sd]);
        v_code := 'ok';
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_code <> 'PC409' OR v_msg NOT LIKE '"%" doesn''t run through that stage.' OR v_after <> v_before
       OR EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p1 AND project_stage_id = v_sc) THEN
        RAISE EXCEPTION 'FAIL 4: C+D (unlisted) % % moved %', v_code, v_msg, v_before - v_after;
    END IF;
    BEGIN
        INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_business_id, amount_cents, currency, status)
        VALUES (v_sb, v_p1, v_biz, 1, v_currency, 'reserved');
        v_ok := true;
    EXCEPTION WHEN unique_violation THEN v_ok := false;
    END;
    IF v_ok THEN RAISE EXCEPTION 'FAIL 4: a second reservation for B was accepted'; END IF;
    BEGIN
        INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_business_id, amount_cents, currency, status, expires_at)
        VALUES (v_sc, v_p1, v_biz, 1, v_currency, 'reserved', now());
        v_ok := true;
    EXCEPTION WHEN check_violation THEN v_ok := false;
    END;
    IF v_ok THEN RAISE EXCEPTION 'FAIL 4: a reservation with a refund clock was accepted'; END IF;
    BEGIN
        INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_business_id, payee_type, payee_id, amount_cents, currency, status)
        VALUES (v_sc, v_p1, v_biz, 'freelancer', v_fl, 1, v_currency, 'reserved');
        v_ok := true;
    EXCEPTION WHEN check_violation THEN v_ok := false;
    END;
    IF v_ok THEN RAISE EXCEPTION 'FAIL 4: a bound reservation was accepted'; END IF;
    RAISE NOTICE 'PASS 4 refusals: B and A already paid, an unlisted stage refuses the whole selection with nothing moved; one reservation per stage; a reservation carries no clock and no payee';
    -- #endregion

    -- #region 5. A released, B held from its reservation on arrival — chain reaction off on B
    UPDATE projects.project_stages SET chain_reaction = false WHERE id = v_sb;
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, is_client_managed, status)
    VALUES (v_sa, 'freelancer', v_fl, v_owner, false, 'assigned');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fl, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket(v_p1, v_fl) IS NULL THEN RAISE EXCEPTION 'FAIL 5: the claim was refused'; END IF;
    UPDATE projects.tickets SET status = 'in_progress' WHERE id = v_p1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    IF EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p1 AND status = 'reserved' AND payee_id IS NOT NULL) THEN
        RAISE EXCEPTION 'FAIL 5: the claim bound the reservation';
    END IF;
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    IF projects.force_complete_stage(v_p1) IS DISTINCT FROM v_sb THEN RAISE EXCEPTION 'FAIL 5: did not advance to B'; END IF;
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_after <> v_before THEN RAISE EXCEPTION 'FAIL 5: arriving in B moved the wallet by %', v_before - v_after; END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p1 AND project_stage_id = v_sa
                    AND status = 'released' AND payee_id = v_fl) THEN
        RAISE EXCEPTION 'FAIL 5: A was not released to the payee';
    END IF;
    SELECT e.project_stage_id, e.payee_id, e.expires_at, e.amount_cents INTO v_row
      FROM finance.escrows e WHERE e.ticket_id = v_p1 AND e.status = 'held';
    IF v_row.project_stage_id <> v_sb OR v_row.payee_id IS DISTINCT FROM v_fl OR v_row.expires_at IS NOT NULL
       OR v_row.amount_cents <> 60000 THEN
        RAISE EXCEPTION 'FAIL 5: B %', row_to_json(v_row);
    END IF;
    SELECT t.status::text AS status, t.payment_status::text AS payment_status INTO v_row
      FROM projects.tickets t WHERE t.id = v_p1;
    IF v_row.status <> 'in_progress' OR v_row.payment_status <> 'escrow_funded'
       OR EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p1 AND status = 'reserved') THEN
        RAISE EXCEPTION 'FAIL 5: the ticket % or a reservation left', row_to_json(v_row);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_p1 AND h.action_type = 'prepaid_stage_held'
                    AND h.new_stage_id = v_sb) THEN
        RAISE EXCEPTION 'FAIL 5: no prepaid_stage_held row';
    END IF;
    RAISE NOTICE 'PASS 5 A released to its payee; B held from its reservation on arrival, no debit, bound, no clock, work carries on with chain reaction off';
    -- #endregion

    -- #region 6. Reservations alone: the ticket stays in New; dropping C refunds it
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    v_out := projects.fund_ticket(v_project, v_p2, ARRAY[v_sb, v_sc]);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    SELECT t.current_stage_id, t.status::text AS status, t.payment_status::text AS payment_status INTO v_row
      FROM projects.tickets t WHERE t.id = v_p2;
    IF v_before - v_after <> 85000 OR (v_out ->> 'held')::boolean IS NOT FALSE
       OR jsonb_array_length(v_out -> 'reserved_stage_ids') <> 2
       OR v_row.current_stage_id IS NOT NULL OR v_row.status <> 'backlog' OR v_row.payment_status <> 'unpaid'
       OR EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p2 AND status = 'held') THEN
        RAISE EXCEPTION 'FAIL 6: moved % / % / %', v_before - v_after, v_out, row_to_json(v_row);
    END IF;
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    UPDATE projects.tickets
       SET required_stages = jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0),
                                               jsonb_build_object('stage_id', v_sb, 'order', 1))
     WHERE id = v_p2;
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_after - v_before <> 25000
       OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p2 AND project_stage_id = v_sc AND status = 'refunded')
       OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p2 AND project_stage_id = v_sb AND status = 'reserved') THEN
        RAISE EXCEPTION 'FAIL 6: dropping C returned %', v_after - v_before;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_p2 AND h.action_type = 'prepaid_stage_refunded'
                    AND h.new_stage_id = v_sc AND h.changes ->> 'reason' = 'stage_removed') THEN
        RAISE EXCEPTION 'FAIL 6: no stage_removed refund row';
    END IF;
    RAISE NOTICE 'PASS 6 B+C prepaid with no hold: still in New and unpaid; dropping C returned its 25000, B still prepaid';
    -- #endregion

    -- #region 7. Cancelling refunds what the ticket never reached
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    UPDATE projects.tickets SET status = 'cancelled' WHERE id = v_p2;
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_after - v_before <> 60000 OR EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p2 AND status = 'reserved')
       OR NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_p2
                       AND h.action_type = 'prepaid_stage_refunded' AND h.changes ->> 'reason' = 'ticket_cancelled') THEN
        RAISE EXCEPTION 'FAIL 7: cancelling returned %', v_after - v_before;
    END IF;
    RAISE NOTICE 'PASS 7 a cancelled ticket returned its prepaid B (60000)';
    -- #endregion

    -- #region 8. Deleting refunds what the ticket never reached
    v_out := projects.fund_ticket(v_project, v_p3, ARRAY[v_sb]);
    SELECT id INTO v_escrow FROM finance.escrows WHERE ticket_id = v_p3 AND status = 'reserved';
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    DELETE FROM projects.tickets WHERE id = v_p3;
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    SELECT e.status, e.ticket_id INTO v_row FROM finance.escrows e WHERE e.id = v_escrow;
    IF v_after - v_before <> 60000 OR v_row.status <> 'refunded' OR v_row.ticket_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 8: deleting returned % / %', v_after - v_before, row_to_json(v_row);
    END IF;
    RAISE NOTICE 'PASS 8 a deleted ticket returned its prepaid B (60000); the refunded row outlives it';
    -- #endregion

    -- #region 9. The TTL sweep returns the prepaid stages with the expired hold
    v_out := projects.fund_ticket(v_project, v_p4, ARRAY[v_sa, v_sb, v_sc]);
    IF (SELECT count(*) FROM finance.escrows WHERE ticket_id = v_p4 AND status = 'reserved') <> 2 THEN
        RAISE EXCEPTION 'FAIL 9: % reservations', (SELECT count(*) FROM finance.escrows WHERE ticket_id = v_p4 AND status = 'reserved');
    END IF;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    v_n := finance.fn_sweep_expired_prepaid_escrows(now() + interval '169 hours');
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    IF v_n < 1 OR EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p4 AND status IN ('held', 'reserved')) THEN
        RAISE EXCEPTION 'FAIL 9: swept %, left %', v_n,
            (SELECT count(*) FROM finance.escrows WHERE ticket_id = v_p4 AND status IN ('held', 'reserved'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_p4 AND h.action_type = 'prepaid_ttl_expired'
                    AND (h.changes ->> 'prepaid_stages_refunded')::int = 2) THEN
        RAISE EXCEPTION 'FAIL 9: no prepaid_ttl_expired row counting 2 prepaid stages';
    END IF;
    IF v_after - v_before < 125000 THEN RAISE EXCEPTION 'FAIL 9: the wallet got back % of 125000', v_after - v_before; END IF;
    RAISE NOTICE 'PASS 9 the sweep refunded the expired A and the prepaid B and C (125000), logged with the count';
    -- #endregion

    -- #region 10. The basket: two stage lines of one ticket in one order
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('business', v_biz, 'Probe 430 basket')
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'project_ticket', v_project, v_sb, v_p5, 'Probe 430 P5', 60000, v_currency)
    RETURNING id INTO v_lb;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'project_ticket', v_project, v_sa, v_p5, 'Probe 430 P5', 40000, v_currency)
    RETURNING id INTO v_la;
    BEGIN
        INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
        VALUES (v_basket, 'project_ticket', v_project, v_sa, v_p5, 'Probe 430 P5 again', 40000, v_currency);
        v_ok := true;
    EXCEPTION WHEN unique_violation THEN v_ok := false;
    END;
    IF v_ok THEN RAISE EXCEPTION 'FAIL 10: a second live line for one ticket stage'; END IF;
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    SELECT spent_cents INTO v_spent FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id = v_owner;
    v_out := finance.place_wallet_order(v_basket, ARRAY[v_la, v_lb], v_currency,
        jsonb_build_object(v_la::text, 40000, v_lb::text, 60000), NULL, 'probe-430-order', 100000);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_before - v_after <> 100000 OR (v_out ->> 'charged_minor')::bigint <> 100000 THEN
        RAISE EXCEPTION 'FAIL 10: moved % / %', v_before - v_after, v_out;
    END IF;
    IF (SELECT spent_cents FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id = v_owner) - v_spent <> 100000 THEN
        RAISE EXCEPTION 'FAIL 10: the envelope counted % for a 100000 basket',
            (SELECT spent_cents FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id = v_owner) - v_spent;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p5 AND project_stage_id = v_sa AND status = 'held')
       OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p5 AND project_stage_id = v_sb AND status = 'reserved')
       OR (SELECT current_stage_id FROM projects.tickets WHERE id = v_p5) IS DISTINCT FROM v_sa THEN
        RAISE EXCEPTION 'FAIL 10: escrows or placement wrong';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.order_lines ol WHERE ol.order_id = (v_out ->> 'order_id')::uuid
                    AND ol.stage_id = v_sa AND ol.subtitle = 'Escrow held')
       OR NOT EXISTS (SELECT 1 FROM finance.order_lines ol WHERE ol.order_id = (v_out ->> 'order_id')::uuid
                    AND ol.stage_id = v_sb AND ol.subtitle = 'Stage prepaid') THEN
        RAISE EXCEPTION 'FAIL 10: order lines %',
            (SELECT jsonb_agg(jsonb_build_object('stage', ol.stage_id, 'subtitle', ol.subtitle)) FROM finance.order_lines ol
              WHERE ol.order_id = (v_out ->> 'order_id')::uuid);
    END IF;
    -- P1 sits in B now, so a line for its A is a stage it has passed.
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('business', v_biz, 'Probe 430 basket 2')
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'project_ticket', v_project, v_sa, v_p1, 'Probe 430 P1', 40000, v_currency)
    RETURNING id INTO v_la;
    BEGIN
        PERFORM finance.place_wallet_order(v_basket, ARRAY[v_la], v_currency,
            jsonb_build_object(v_la::text, 40000), NULL, 'probe-430-order-passed', 40000);
        v_code := 'ok';
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    IF v_code <> 'PC409' OR v_msg NOT LIKE '%moved since you added it%' THEN
        RAISE EXCEPTION 'FAIL 10: a passed stage % %', v_code, v_msg;
    END IF;
    RAISE NOTICE 'PASS 10 basket: A held and B prepaid from one order (Escrow held / Stage prepaid), envelope counted once; a duplicate stage line and a passed stage refused';
    -- #endregion

    -- #region 11. Completing refunds what the ticket never reached
    v_out := projects.fund_ticket(v_project, v_p6, ARRAY[v_sa, v_sc]);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fl, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket(v_p6, v_fl) IS NULL THEN RAISE EXCEPTION 'FAIL 11: the claim was refused'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    PERFORM projects.complete_ticket(v_p6);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_after - v_before <> 25000
       OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p6 AND project_stage_id = v_sa AND status = 'released')
       OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p6 AND project_stage_id = v_sc AND status = 'refunded')
       OR NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_p6
                       AND h.action_type = 'prepaid_stage_refunded' AND h.changes ->> 'reason' = 'ticket_completed') THEN
        RAISE EXCEPTION 'FAIL 11: completing returned %', v_after - v_before;
    END IF;
    RAISE NOTICE 'PASS 11 a completed ticket released A to its payee and returned its prepaid C (25000)';
    -- #endregion

    -- #region 12. The approval threshold judges the whole selection
    UPDATE finance.wallets SET approval_threshold_cents = 100000 WHERE id = v_wallet;
    BEGIN
        PERFORM projects.fund_ticket(v_project, v_p7, ARRAY[v_sa, v_sb]);
        v_code := 'ok';
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    IF v_code <> 'PA403' OR v_msg NOT LIKE 'needs_approval:%'
       OR EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_p7) THEN
        RAISE EXCEPTION 'FAIL 12: A+B (100000) at a 100000 threshold % %', v_code, v_msg;
    END IF;
    UPDATE finance.wallets SET approval_threshold_cents = 100000000 WHERE id = v_wallet;
    RAISE NOTICE 'PASS 12 a two-stage selection at the threshold needs approval as one spend';
    -- #endregion

    -- #region 13. An individual client prepays from their own wallet
    SELECT p.id, p.owner_user_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_ind_project, v_ind_owner, v_ind_currency
      FROM projects.projects p
     WHERE p.client_business_id IS NULL AND p.client_user_id IS NULL
       AND p.format = 'pipeline' AND p.structure_variation = 'standard'
       AND p.status NOT IN ('completed', 'cancelled', 'archived') AND NOT p.is_personal
     ORDER BY p.id
     LIMIT 1;
    IF v_ind_project IS NULL THEN
        RAISE NOTICE 'PASS 13 skipped: no individual-owner pipeline project in the seed';
    ELSE
        v_ind_wallet := finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_ind_owner), v_ind_owner, v_ind_currency);
        PERFORM finance.fn_wallet_credit(v_ind_owner, finance.fn_person_wallet_type(v_ind_owner), v_ind_currency,
                                         50000, 'topup', 'inbound_payments', gen_random_uuid());
        INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
        VALUES (v_ind_project, 'Probe 430 X', 997, 'open', 30000) RETURNING id INTO v_ix;
        INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
        VALUES (v_ind_project, 'Probe 430 Y', 998, 'open', 15000) RETURNING id INTO v_iy;
        INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
        VALUES (v_ind_project, NULL, 'backlog', 'Probe 430 I', '{"t":"x"}', 'A description.',
                jsonb_build_array(jsonb_build_object('stage_id', v_ix, 'order', 0),
                                  jsonb_build_object('stage_id', v_iy, 'order', 1)))
        RETURNING id INTO v_it;
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_ind_owner, 'role', 'authenticated')::text, true);
        SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_ind_wallet;
        v_out := projects.fund_ticket(v_ind_project, v_it, ARRAY[v_ix, v_iy]);
        SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_ind_wallet;
        SELECT e.payer_user_id, e.payer_business_id INTO v_row
          FROM finance.escrows e WHERE e.ticket_id = v_it AND e.status = 'reserved';
        IF v_before - v_after <> 45000 OR v_row.payer_user_id IS DISTINCT FROM v_ind_owner OR v_row.payer_business_id IS NOT NULL THEN
            RAISE EXCEPTION 'FAIL 13: moved % / %', v_before - v_after, row_to_json(v_row);
        END IF;
        RAISE NOTICE 'PASS 13 an individual client: X held, Y prepaid from their own wallet (45000)';
    END IF;
    -- #endregion
END
$$;

ROLLBACK;
