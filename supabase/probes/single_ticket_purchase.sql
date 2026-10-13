-- =============================================================================================
-- Probe: single-ticket purchase (Decision #166) — projects.fund_ticket, finance.begin_card_payment /
-- settle_card_payment with p_ticket_id, finance.place_wallet_order ticket lines, and the
-- uq_basket_items_live_ticket dedupe key.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/single_ticket_purchase.sql
--
-- Three tickets are added to one stage of a seeded individual-owner pipeline project; each money path
-- funds ONE of them. After each, exactly that ticket's escrow is held, the wallet moved by exactly its
-- price and the stage's status did not move (it is partially funded). A clean run prints only PASS.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_project uuid;
    v_stage uuid;
    v_stage_status text;
    v_owner uuid;
    v_freelancer uuid;
    v_currency text;
    v_wtype text;
    v_wallet uuid;
    v_a uuid;
    v_b uuid;
    v_c uuid;
    v_bare uuid;
    v_free uuid;
    v_before bigint;
    v_after bigint;
    v_held integer;
    v_payment jsonb;
    v_settled jsonb;
    v_basket uuid;
    v_line uuid;
    v_order jsonb;
    v_out jsonb;
BEGIN
    -- #region Fixture (as postgres, no caller)
    SELECT p.id, ps.id, ps.status::text, p.owner_user_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_project, v_stage, v_stage_status, v_owner, v_currency
      FROM projects.projects p
      JOIN projects.project_stages ps ON ps.project_id = p.id
     WHERE p.client_business_id IS NULL
       AND p.format = 'pipeline' AND p.structure_variation = 'standard'
       AND p.status NOT IN ('completed', 'cancelled', 'archived')
       AND ps.status NOT IN ('approved', 'paid', 'cancelled')
     ORDER BY p.id, ps.sort_order
     LIMIT 1;
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no individual-owner pipeline stage in the seed'; END IF;
    SELECT fp.user_id INTO v_freelancer FROM org.freelancer_profiles fp WHERE fp.user_id <> v_owner ORDER BY fp.user_id LIMIT 1;
    IF v_freelancer IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no freelancer'; END IF;

    UPDATE projects.project_stages SET unit_price_cents = 25000 WHERE id = v_stage;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe A', 'A description.', 10000) RETURNING id INTO v_a;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe B', 'A description.', NULL) RETURNING id INTO v_b;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe C', 'A description.', 30000) RETURNING id INTO v_c;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe bare', '', 5000) RETURNING id INTO v_bare;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, NULL, 'Probe unclaimed', 'A description.', 5000) RETURNING id INTO v_free;

    v_wtype := finance.fn_person_wallet_type(v_owner);
    v_wallet := finance.fn_ensure_wallet(v_wtype, v_owner, v_currency);
    PERFORM finance.fn_wallet_credit(v_owner, v_wtype, v_currency, 100000, 'topup', 'inbound_payments', gen_random_uuid());
    RAISE NOTICE 'fixture project=% stage=% (%) owner=% wallet=% %', v_project, v_stage, v_stage_status, v_owner, v_wallet, v_currency;
    -- #endregion

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

    -- #region 1. projects.fund_ticket — one of three
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    v_out := projects.fund_ticket(v_project, v_b);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF (v_out ->> 'amount_cents')::bigint <> 25000 THEN RAISE EXCEPTION 'FAIL fund_ticket amount %', v_out; END IF;
    IF v_before - v_after <> 25000 THEN RAISE EXCEPTION 'FAIL wallet moved % not 25000', v_before - v_after; END IF;
    SELECT count(*) INTO v_held FROM finance.escrows WHERE ticket_id IN (v_a, v_b, v_c) AND status = 'held';
    IF v_held <> 1 OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_b AND status = 'held' AND amount_cents = 25000) THEN
        RAISE EXCEPTION 'FAIL expected only B held, % held', v_held;
    END IF;
    IF EXISTS (SELECT 1 FROM projects.tickets WHERE id IN (v_a, v_c) AND payment_status::text <> 'unpaid') THEN
        RAISE EXCEPTION 'FAIL A or C changed payment status';
    END IF;
    IF (SELECT status::text FROM projects.project_stages WHERE id = v_stage) <> v_stage_status THEN
        RAISE EXCEPTION 'FAIL the stage status moved';
    END IF;
    RAISE NOTICE 'PASS fund_ticket held only B (25000 from the stage price), wallet -25000, stage still %', v_stage_status;

    BEGIN
        PERFORM projects.fund_ticket(v_project, v_b);
        RAISE EXCEPTION 'FAIL B funded twice';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN RAISE NOTICE 'PASS a funded ticket is refused (PC409)';
    END;
    BEGIN
        PERFORM projects.fund_ticket(v_project, v_bare);
        RAISE EXCEPTION 'FAIL a description-less ticket was funded';
    EXCEPTION WHEN SQLSTATE 'PU422' THEN RAISE NOTICE 'PASS purchasing gate: no description, not purchasable (PU422)';
    END;
    -- No payee yet is a PREPAID hold since Decision #197: held now, its payee bound at the claim.
    v_out := projects.fund_ticket(v_project, v_free);
    IF NOT (v_out ->> 'prepaid')::boolean OR NOT EXISTS (
        SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_free AND e.status = 'held' AND e.payee_id IS NULL
    ) THEN
        RAISE EXCEPTION 'FAIL an unclaimed ticket was not held prepaid: %', v_out;
    END IF;
    RAISE NOTICE 'PASS an unclaimed ticket is held prepaid, payee unbound (Decision #197)';
    -- #endregion

    -- #region 2. A card escrow_lock naming ticket A
    BEGIN
        PERFORM finance.begin_card_payment('escrow_lock', NULL, v_project, v_stage, 99999, v_currency, 'probe-ticket-lock-bad', v_a);
        RAISE EXCEPTION 'FAIL a wrong expected amount was accepted';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN RAISE NOTICE 'PASS begin_card_payment refuses an amount nobody was shown';
    END;
    v_payment := finance.begin_card_payment('escrow_lock', NULL, v_project, v_stage, 10000, v_currency, 'probe-ticket-lock-a', v_a);
    IF (v_payment ->> 'amount_cents')::bigint <> 10000 OR (v_payment ->> 'ticket_id')::uuid <> v_a THEN
        RAISE EXCEPTION 'FAIL begin_card_payment %', v_payment;
    END IF;
    PERFORM finance.attach_card_payment((v_payment ->> 'id')::uuid, 'pi_probe_single_ticket_a');
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    v_settled := finance.settle_card_payment('evt_probe_single_ticket_a', 'pi_probe_single_ticket_a', 10000, v_currency, false);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_settled ->> 'lock_status' <> 'locked' THEN RAISE EXCEPTION 'FAIL settle %', v_settled; END IF;
    IF v_after <> v_before THEN RAISE EXCEPTION 'FAIL card lock should credit and hold the same 10000, wallet moved %', v_after - v_before; END IF;
    IF (v_settled -> 'locked_escrow_ids') <> to_jsonb(ARRAY(SELECT id FROM finance.escrows WHERE ticket_id = v_a AND status = 'held')) THEN
        RAISE EXCEPTION 'FAIL locked_escrow_ids %', v_settled -> 'locked_escrow_ids';
    END IF;
    IF EXISTS (SELECT 1 FROM projects.tickets WHERE id = v_c AND payment_status::text <> 'unpaid') THEN
        RAISE EXCEPTION 'FAIL C was funded by A''s lock';
    END IF;
    RAISE NOTICE 'PASS card lock for A: credited and held exactly 10000, C still unpaid';
    -- #endregion

    -- #region 3. A basket ticket line for C through place_wallet_order
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('user', v_owner, 'Probe basket') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
    VALUES (v_basket, 'project_ticket', v_project, v_stage, v_c, 'Probe C', 30000, v_currency) RETURNING id INTO v_line;
    BEGIN
        INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title, unit_price_minor, currency)
        VALUES (v_basket, 'project_ticket', v_project, v_stage, v_c, 'Probe C again', 30000, v_currency);
        RAISE EXCEPTION 'FAIL a second live line for one ticket';
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'PASS one live line per ticket per basket';
    END;
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    v_order := finance.place_wallet_order(v_basket, ARRAY[v_line], v_currency,
        jsonb_build_object(v_line::text, 30000), NULL, 'probe-ticket-order-c');
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF (v_order ->> 'charged_minor')::bigint <> 30000 OR v_before - v_after <> 30000 THEN
        RAISE EXCEPTION 'FAIL order % moved %', v_order, v_before - v_after;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM finance.order_lines ol
         WHERE ol.order_id = (v_order ->> 'order_id')::uuid AND ol.ticket_id = v_c
           AND ol.fulfilment = 'engagement' AND ol.line_total_minor = 30000
    ) THEN RAISE EXCEPTION 'FAIL no ticket order line'; END IF;
    IF EXISTS (
        SELECT 1 FROM finance.transactions t
         WHERE t.ref_table = 'orders' AND t.ref_id = (v_order ->> 'order_id')::uuid AND t.direction = 'debit'
    ) THEN RAISE EXCEPTION 'FAIL a ticket line was also debited as an order payment'; END IF;
    SELECT count(*) INTO v_held FROM finance.escrows WHERE ticket_id IN (v_a, v_b, v_c) AND status = 'held';
    IF v_held <> 3 THEN RAISE EXCEPTION 'FAIL expected A, B, C held, % held', v_held; END IF;
    IF (SELECT purchased_at FROM finance.basket_items WHERE id = v_line) IS NULL THEN RAISE EXCEPTION 'FAIL line not consumed'; END IF;
    IF (SELECT status::text FROM projects.project_stages WHERE id = v_stage) <> v_stage_status THEN
        RAISE EXCEPTION 'FAIL the stage status moved';
    END IF;
    RAISE NOTICE 'PASS wallet order for C: one engagement line, 30000 held as escrow (no order_payment debit), stage still %', v_stage_status;
    -- #endregion
END $$;

ROLLBACK;
