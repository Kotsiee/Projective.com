-- =============================================================================================
-- Probe: the prepaid escrow TTL and funding from New (Decision #428).
--   1 the refund window is 120h for a service, 168h for a client project, tunable
--   2 fund_ticket in New with a stage: prepaid, expires_at = now() + 168h, promoted to Ready
--   3 fund_ticket on a stage-less New ticket: placed in its first stage, Ready, held there
--   4 get_ticket_funding_quote: phases in order, the funding stage's price, the window, blocked
--   5 the claim binds the escrow and clears expires_at; a bound escrow cannot carry one
--   6 the sweep: an unexpired hold stays, an expired one is refunded whole, logged and told
--   7 the Chain Reaction's hold into the next stage is bound, so no prepaid clock runs there
--   8 fund_stage promotes its funded New tickets to Ready
--   9 move_ticket refuses a stage the ticket does not include; one listing none goes anywhere
--  10 the card intent prices a New ticket in its first stage
--  11 the basket's wallet order buys a New ticket in its first stage
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/prepaid_escrow_ttl.sql
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
    v_service uuid;
    v_sa uuid;
    v_sb uuid;
    v_sc uuid;
    v_t1 uuid;
    v_t2 uuid;
    v_t3 uuid;
    v_t4 uuid;
    v_t5 uuid;
    v_t6 uuid;
    v_basket uuid;
    v_line uuid;
    v_before bigint;
    v_after bigint;
    v_n integer;
    v_out jsonb;
    v_row record;
    v_ok boolean;
    v_code text;
    v_msg text;
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
    SELECT p.id INTO v_service FROM projects.projects p WHERE p.source_blueprint_id IS NOT NULL ORDER BY p.id LIMIT 1;

    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_biz;
    PERFORM finance.fn_ensure_wallet('business', v_biz, v_currency);
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 1000000, 'topup', 'inbound_payments', gen_random_uuid());

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 428 A', 990, 'open', 40000) RETURNING id INTO v_sa;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 428 B', 991, 'open', 60000) RETURNING id INTO v_sb;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe 428 C', 992, 'open', 25000) RETURNING id INTO v_sc;

    -- T1: in New, already in stage A, listing A then B.
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, v_sa, 'backlog', 'Probe 428 T1', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0), jsonb_build_object('stage_id', v_sb, 'order', 1)))
    RETURNING id INTO v_t1;
    -- T2: in the stage-less New lane, listing B (order 1) before A (order 0) to prove the order is the ticket's.
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, NULL, 'backlog', 'Probe 428 T2', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_sb, 'order', 1), jsonb_build_object('stage_id', v_sa, 'order', 0)))
    RETURNING id INTO v_t2;
    -- T3, T4: two New tickets in stage C, for fund_stage's promotion.
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, v_sc, 'backlog', 'Probe 428 T3', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_sc, 'order', 0)))
    RETURNING id INTO v_t3;
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, v_sc, 'backlog', 'Probe 428 T4', '{"t":"x"}', 'A description.', '[]'::jsonb)
    RETURNING id INTO v_t4;
    -- T5: stage-less, listing A only — for the card intent.
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, NULL, 'backlog', 'Probe 428 T5', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_sa, 'order', 0)))
    RETURNING id INTO v_t5;
    -- #endregion

    -- #region 1. The refund window by ownership, and tunable
    IF finance.fn_prepaid_escrow_ttl_hours(v_project) <> 168 THEN
        RAISE EXCEPTION 'FAIL 1: a client project should wait 168h, got %', finance.fn_prepaid_escrow_ttl_hours(v_project);
    END IF;
    IF v_service IS NOT NULL AND finance.fn_prepaid_escrow_ttl_hours(v_service) <> 120 THEN
        RAISE EXCEPTION 'FAIL 1: a service should wait 120h, got %', finance.fn_prepaid_escrow_ttl_hours(v_service);
    END IF;
    UPDATE security.platform_params SET value = '72'::jsonb WHERE key = 'prepaid_project_ttl_hours';
    IF finance.fn_prepaid_escrow_ttl_hours(v_project) <> 72 THEN RAISE EXCEPTION 'FAIL 1: the param is not read'; END IF;
    UPDATE security.platform_params SET value = '168'::jsonb WHERE key = 'prepaid_project_ttl_hours';
    RAISE NOTICE 'PASS 1 window: client project 168h, service % , tunable', COALESCE((finance.fn_prepaid_escrow_ttl_hours(v_service))::text || 'h', 'n/a (no service in seed)');
    -- #endregion

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

    -- #region 4a. The quote before funding: A now, B later, the window, nothing blocking
    v_out := projects.get_ticket_funding_quote(v_project, v_t2);
    IF (v_out ->> 'funding_stage_id')::uuid <> v_sa OR (v_out ->> 'amount_cents')::bigint <> 40000
       OR (v_out ->> 'ttl_hours')::int <> 168 OR (v_out ->> 'engagement') <> 'project'
       OR (v_out ->> 'blocked') IS NOT NULL OR (v_out ->> 'prepaid')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL 4a: quote header %', v_out;
    END IF;
    IF (v_out -> 'stages' -> 0 ->> 'stage_id')::uuid <> v_sa OR (v_out -> 'stages' -> 0 ->> 'phase') <> 'now'
       OR (v_out -> 'stages' -> 1 ->> 'stage_id')::uuid <> v_sb OR (v_out -> 'stages' -> 1 ->> 'phase') <> 'later'
       OR (v_out -> 'stages' -> 1 ->> 'amount_cents')::bigint <> 60000 THEN
        RAISE EXCEPTION 'FAIL 4a: quote stages %', v_out -> 'stages';
    END IF;
    RAISE NOTICE 'PASS 4a quote: A now at 40000, B later at 60000, 168h, not blocked';
    -- #endregion

    -- #region 2. fund_ticket in New with a stage: prepaid, the clock, Ready
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    v_out := projects.fund_ticket(v_project, v_t1);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    IF v_before - v_after <> 40000 THEN RAISE EXCEPTION 'FAIL 2: wallet moved %', v_before - v_after; END IF;
    SELECT e.payee_id, e.expires_at, e.project_stage_id, t.status::text AS status INTO v_row
      FROM finance.escrows e JOIN projects.tickets t ON t.id = e.ticket_id
     WHERE e.ticket_id = v_t1 AND e.status = 'held';
    IF v_row.payee_id IS NOT NULL OR v_row.expires_at IS DISTINCT FROM now() + interval '168 hours'
       OR v_row.project_stage_id <> v_sa OR v_row.status <> 'todo' THEN
        RAISE EXCEPTION 'FAIL 2: %', row_to_json(v_row);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_t1 AND h.action_type = 'status_changed'
                    AND h.previous_status = 'backlog' AND h.new_status = 'todo' AND h.changes ->> 'reason' = 'funded') THEN
        RAISE EXCEPTION 'FAIL 2: no promotion history row';
    END IF;
    RAISE NOTICE 'PASS 2 fund_ticket from New: prepaid, expires in 168h, backlog -> todo logged';
    -- #endregion

    -- #region 3. A stage-less New ticket is placed in its first stage and held there
    v_out := projects.fund_ticket(v_project, v_t2);
    SELECT t.current_stage_id, t.status::text AS status, e.project_stage_id AS escrow_stage, e.expires_at INTO v_row
      FROM projects.tickets t JOIN finance.escrows e ON e.ticket_id = t.id AND e.status = 'held'
     WHERE t.id = v_t2;
    IF v_row.current_stage_id <> v_sa OR v_row.status <> 'todo' OR v_row.escrow_stage <> v_sa
       OR v_row.expires_at IS NULL OR (v_out ->> 'placed')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL 3: % / %', row_to_json(v_row), v_out;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_t2 AND h.action_type = 'stage_moved'
                    AND h.previous_stage_id IS NULL AND h.new_stage_id = v_sa) THEN
        RAISE EXCEPTION 'FAIL 3: no placement history row';
    END IF;
    RAISE NOTICE 'PASS 3 stage-less New ticket placed in its first stage (by its own order), Ready, held there';
    -- #endregion

    -- #region 4b. The quote after funding: A funded, B still prepayable (Decision #430), nothing blocked
    v_out := projects.get_ticket_funding_quote(v_project, v_t2);
    IF (v_out -> 'stages' -> 0 ->> 'phase') <> 'funded' OR (v_out -> 'stages' -> 0 ->> 'fundable')::boolean IS NOT FALSE
       OR (v_out -> 'stages' -> 1 ->> 'phase') <> 'later' OR (v_out -> 'stages' -> 1 ->> 'fundable')::boolean IS NOT TRUE
       OR (v_out ->> 'blocked') IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 4b: %', v_out;
    END IF;
    RAISE NOTICE 'PASS 4b quote after funding: A funded, B later and still prepayable, not blocked';
    -- #endregion

    -- #region 5. The claim binds and stops the clock; a bound escrow carries no clock
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, is_client_managed, status)
    VALUES (v_sa, 'freelancer', v_fl, v_owner, false, 'assigned');
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fl, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket(v_t1, v_fl) IS NULL THEN RAISE EXCEPTION 'FAIL 5: the claim was refused'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SELECT e.payee_id, e.expires_at INTO v_row FROM finance.escrows e WHERE e.ticket_id = v_t1 AND e.status = 'held';
    IF v_row.payee_id IS DISTINCT FROM v_fl OR v_row.expires_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 5: %', row_to_json(v_row);
    END IF;
    BEGIN
        UPDATE finance.escrows SET expires_at = now() WHERE ticket_id = v_t1 AND status = 'held';
        v_ok := true;
    EXCEPTION WHEN check_violation THEN v_ok := false;
    END;
    IF v_ok THEN RAISE EXCEPTION 'FAIL 5: a bound escrow accepted an expiry'; END IF;
    RAISE NOTICE 'PASS 5 claim binds the payee and clears expires_at; ck_escrows_expiry_unbound refuses a bound clock';
    -- #endregion

    -- #region 6. The sweep: unexpired stays, expired is refunded whole, logged and told
    PERFORM set_config('request.jwt.claims', '', true);
    v_n := finance.fn_sweep_expired_prepaid_escrows(now() + interval '100 hours');
    IF v_n <> 0 OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_t2 AND status = 'held') THEN
        RAISE EXCEPTION 'FAIL 6: an unexpired hold was swept (%)', v_n;
    END IF;
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    v_n := finance.fn_sweep_expired_prepaid_escrows(now() + interval '169 hours');
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    IF v_n < 1 OR v_after - v_before <> 40000 THEN
        RAISE EXCEPTION 'FAIL 6: swept %, wallet moved %', v_n, v_after - v_before;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_t2 AND status = 'refunded')
       OR (SELECT payment_status::text FROM projects.tickets WHERE id = v_t2) <> 'unpaid' THEN
        RAISE EXCEPTION 'FAIL 6: escrow or ticket not reset';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_t1 AND status = 'held') THEN
        RAISE EXCEPTION 'FAIL 6: the sweep touched a bound escrow';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.ticket_history h WHERE h.ticket_id = v_t2 AND h.action_type = 'prepaid_ttl_expired'
                    AND h.actor_id = v_owner AND (h.changes ->> 'amount_minor')::bigint = 40000) THEN
        RAISE EXCEPTION 'FAIL 6: no prepaid_ttl_expired row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = v_owner AND n.type = 'escrow.refunded'
                    AND n.entity_id = v_t2) THEN
        RAISE EXCEPTION 'FAIL 6: the payer was not told';
    END IF;
    RAISE NOTICE 'PASS 6 sweep: unexpired kept, expired refunded 40000 (no fee), ticket unpaid, logged, payer told, bound untouched';
    -- #endregion

    -- #region 7. The Chain Reaction's next hold is bound: no prepaid clock in the next stage
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fl, 'role', 'authenticated')::text, true);
    UPDATE projects.tickets SET status = 'in_progress' WHERE id = v_t1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    IF projects.force_complete_stage(v_t1) IS DISTINCT FROM v_sb THEN RAISE EXCEPTION 'FAIL 7: did not advance to B'; END IF;
    SELECT e.project_stage_id, e.payee_id, e.expires_at INTO v_row FROM finance.escrows e WHERE e.ticket_id = v_t1 AND e.status = 'held';
    IF v_row.project_stage_id <> v_sb OR v_row.payee_id IS DISTINCT FROM v_fl OR v_row.expires_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 7: %', row_to_json(v_row);
    END IF;
    RAISE NOTICE 'PASS 7 Chain Reaction: B held on arrival, bound to the payee, no prepaid clock';
    -- #endregion

    -- #region 8. fund_stage promotes its funded New tickets to Ready
    v_out := projects.fund_stage(v_project, v_sc);
    SELECT count(*) INTO v_n FROM projects.tickets WHERE id IN (v_t3, v_t4) AND status = 'todo';
    IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL 8: % of 2 promoted', v_n; END IF;
    SELECT count(*) INTO v_n FROM finance.escrows WHERE ticket_id IN (v_t3, v_t4) AND status = 'held'
                                                    AND payee_id IS NULL AND expires_at = now() + interval '168 hours';
    IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL 8: % of 2 clocks', v_n; END IF;
    RAISE NOTICE 'PASS 8 fund_stage: both New tickets Ready, both prepaid with a 168h clock';
    -- #endregion

    -- #region 9. move_ticket keeps a ticket inside the stages it lists
    BEGIN
        PERFORM projects.move_ticket(v_t3, 'todo'::ticket_status, v_sa);
        v_ok := true;
    EXCEPTION WHEN check_violation THEN v_ok := false; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    IF v_ok OR v_msg <> 'This ticket doesn''t include this stage.' THEN
        RAISE EXCEPTION 'FAIL 9: a move into an unlisted stage % (%)', CASE WHEN v_ok THEN 'passed' ELSE 'refused' END, v_msg;
    END IF;
    PERFORM projects.move_ticket(v_t4, 'todo'::ticket_status, v_sa);
    IF (SELECT current_stage_id FROM projects.tickets WHERE id = v_t4) <> v_sa THEN
        RAISE EXCEPTION 'FAIL 9: a ticket listing no stage was refused';
    END IF;
    RAISE NOTICE 'PASS 9 move_ticket: an unlisted stage refused with the shared sentence; a ticket listing none moves';
    -- #endregion

    -- #region 10. The card intent prices a New ticket in its first stage
    v_msg := NULL;
    BEGIN
        v_out := finance.begin_card_payment('escrow_lock', NULL, v_project, v_sa, 40000, v_currency, 'probe-428-card-a', v_t5);
        v_code := 'ok';
    EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    END;
    IF v_code = 'P0002' OR v_code = 'PC409' THEN
        RAISE EXCEPTION 'FAIL 10: the card intent refused a New ticket in its first stage: % %', v_code, v_msg;
    END IF;
    RAISE NOTICE 'PASS 10 card intent for a New ticket in its first stage: % %', v_code, COALESCE(v_msg, '');
    -- #endregion

    -- #region 11. The basket buys a New ticket in its first stage (place_wallet_order -> fund_ticket)
    INSERT INTO projects.tickets (project_id, current_stage_id, status, title, description, text_description, required_stages)
    VALUES (v_project, NULL, 'backlog', 'Probe 428 T6', '{"t":"x"}', 'A description.',
            jsonb_build_array(jsonb_build_object('stage_id', v_sb, 'order', 0)))
    RETURNING id INTO v_t6;
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('business', v_biz, 'Probe 428 basket')
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'project_ticket', v_project, v_sb, v_t6, 'Probe 428 T6', 60000, v_currency)
    RETURNING id INTO v_line;
    v_out := finance.place_wallet_order(v_basket, ARRAY[v_line], v_currency,
        jsonb_build_object(v_line::text, 60000), NULL, 'probe-428-order', 60000);
    SELECT t.current_stage_id, t.status::text AS status, e.project_stage_id AS escrow_stage, e.expires_at INTO v_row
      FROM projects.tickets t JOIN finance.escrows e ON e.ticket_id = t.id AND e.status = 'held'
     WHERE t.id = v_t6;
    IF v_row.current_stage_id IS DISTINCT FROM v_sb OR v_row.status <> 'todo' OR v_row.escrow_stage <> v_sb
       OR v_row.expires_at IS DISTINCT FROM now() + interval '168 hours' THEN
        RAISE EXCEPTION 'FAIL 11: % / %', row_to_json(v_row), v_out;
    END IF;
    RAISE NOTICE 'PASS 11 basket order of a New ticket: placed in its first stage, Ready, prepaid with a 168h clock';
    -- #endregion
END
$$;

ROLLBACK;
