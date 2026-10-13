-- =============================================================================================
-- Probe: whole-stage funding is reachable (Decision #197) — prepaid, unbound ticket escrow bound at
-- claim; projects.fund_stage and finance.begin_card_payment agree on the priced set; open · assigned ·
-- in-progress stages; business and individual payers; an unbound escrow is refunded, never released.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/stage_funding_prepaid.sql
--
-- Before #197 every fund_stage below answered "No assigned, unfunded tickets", fund_ticket refused an
-- unclaimed ticket ("Nobody can be paid … yet"), and a card payment for a stage with an unpriced ticket
-- settled into the wallet with no escrow. A clean run prints only PASS.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_project uuid;
    v_owner uuid;
    v_biz uuid;
    v_currency text;
    v_fl uuid;
    v_stage uuid;
    v_s2 uuid;
    v_t1 uuid;
    v_t2 uuid;
    v_t3 uuid;
    v_u1 uuid;
    v_u2 uuid;
    v_q uuid;
    v_qowner uuid;
    v_qstage uuid;
    v_qt uuid;
    v_wtype text;
    v_before bigint;
    v_after bigint;
    v_n integer;
    v_out jsonb;
    v_pay jsonb;
    v_settle jsonb;
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
         ORDER BY p.id
    LOOP
        PERFORM set_config('request.jwt.claims', json_build_object('sub', r.owner_user_id, 'role', 'authenticated')::text, true);
        IF finance.fn_owner_capability('business', r.client_business_id, 'spend'::finance.vault_capability) THEN
            v_project := r.id; v_owner := r.owner_user_id; v_biz := r.client_business_id; v_currency := r.currency;
            EXIT;
        END IF;
    END LOOP;
    PERFORM set_config('request.jwt.claims', '', true);
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no business pipeline project whose owner can spend'; END IF;
    SELECT fp.user_id INTO v_fl FROM org.freelancer_profiles fp
     WHERE fp.user_id <> v_owner AND finance.fn_freelancer_payout_ready(fp.user_id)
     ORDER BY fp.user_id LIMIT 1;
    IF v_fl IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no freelancer'; END IF;

    PERFORM finance.fn_ensure_wallet('business', v_biz, v_currency);
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 1000000, 'topup', 'inbound_payments', gen_random_uuid());

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe stage', 990, 'open', 50000) RETURNING id INTO v_stage;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_project, v_stage, 'Probe T1', '{"t":"x"}', 'A description.') RETURNING id INTO v_t1;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_project, v_stage, 'Probe T2', '{"t":"x"}', 'A description.') RETURNING id INTO v_t2;

    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe unpriced stage', 991, 'assigned', NULL) RETURNING id INTO v_s2;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description, unit_price_cents)
    VALUES (v_project, v_s2, 'Probe U1', '{"t":"x"}', 'A description.', 10000) RETURNING id INTO v_u1;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description, unit_price_cents)
    VALUES (v_project, v_s2, 'Probe U2', '{"t":"x"}', 'A description.', NULL) RETURNING id INTO v_u2;
    -- #endregion

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

    -- #region 1. An OPEN stage nobody is hired on funds every ticket, prepaid
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    v_out := projects.fund_stage(v_project, v_stage);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    IF (v_out ->> 'funded_count')::int <> 2 OR (v_out ->> 'awaiting_claim_count')::int <> 2 THEN
        RAISE EXCEPTION 'FAIL 1: expected 2 funded, 2 awaiting a claim, got %', v_out;
    END IF;
    IF v_before - v_after <> 100000 THEN RAISE EXCEPTION 'FAIL 1: wallet moved % (expected 100000)', v_before - v_after; END IF;
    IF (SELECT status FROM projects.project_stages WHERE id = v_stage) <> 'open' THEN
        RAISE EXCEPTION 'FAIL 1: an open stage must stay open until it is hired';
    END IF;
    SELECT count(*) INTO v_n FROM finance.escrows WHERE ticket_id IN (v_t1, v_t2) AND status = 'held' AND payee_id IS NULL AND payee_type IS NULL;
    IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL 1: expected 2 unbound held escrows, got %', v_n; END IF;
    IF EXISTS (SELECT 1 FROM projects.tickets WHERE id IN (v_t1, v_t2) AND payment_status <> 'escrow_funded') THEN
        RAISE EXCEPTION 'FAIL 1: tickets not marked escrow_funded';
    END IF;
    RAISE NOTICE 'PASS 1 open stage funded: 2 prepaid escrows, wallet -100000, stage still open';
    -- #endregion

    -- #region 2. Nothing left: both doors refuse a second funding
    BEGIN
        PERFORM projects.fund_stage(v_project, v_stage); v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_ok := false; v_code := SQLSTATE;
    END;
    IF v_ok OR v_code <> 'PC409' THEN RAISE EXCEPTION 'FAIL 2: second fund_stage % %', v_ok, v_code; END IF;
    BEGIN
        PERFORM finance.begin_card_payment('escrow_lock', NULL, v_project, v_stage, 50000, v_currency, 'probe-197-key-a'); v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_ok := false; v_code := SQLSTATE;
    END;
    IF v_ok OR v_code <> 'PC409' THEN RAISE EXCEPTION 'FAIL 2: card intent for a funded stage % %', v_ok, v_code; END IF;
    RAISE NOTICE 'PASS 2 a funded stage refuses fund_stage and the card intent (PC409)';
    -- #endregion

    -- #region 3. The claim BINDS the prepaid escrow: no second debit, the work gate passes
    INSERT INTO projects.stage_assignments (project_stage_id, assignee_type, freelancer_profile_id, assigned_by, is_client_managed, status)
    VALUES (v_stage, 'freelancer', v_fl, v_owner, false, 'assigned');
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fl, 'role', 'authenticated')::text, true);
    IF projects.claim_ticket(v_t1, v_fl) IS NULL THEN RAISE EXCEPTION 'FAIL 3: the claim of a prepaid ticket was refused'; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    SELECT e.payee_type::text AS payee_type, e.payee_id, t.status::text AS status INTO v_row
      FROM finance.escrows e JOIN projects.tickets t ON t.id = e.ticket_id
     WHERE e.ticket_id = v_t1 AND e.status = 'held';
    IF v_row.payee_type IS DISTINCT FROM 'freelancer' OR v_row.payee_id IS DISTINCT FROM v_fl OR v_row.status <> 'claimed' THEN
        RAISE EXCEPTION 'FAIL 3: escrow not bound to the claimant: %', row_to_json(v_row);
    END IF;
    IF v_before <> v_after THEN RAISE EXCEPTION 'FAIL 3: the bind debited the wallet again (%)', v_before - v_after; END IF;
    SELECT count(*) INTO v_n FROM finance.escrows WHERE ticket_id = v_t1;
    IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 3: expected one escrow on the ticket, got %', v_n; END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = v_fl AND n.type = 'escrow.funded'
                    AND n.entity_id = v_t1) THEN
        RAISE EXCEPTION 'FAIL 3: the claimant was not told they can start';
    END IF;
    RAISE NOTICE 'PASS 3 claim binds the prepaid escrow to the claimant, no second debit, claimant notified';
    -- #endregion

    -- #region 4. An unbound escrow is refunded, never released to nobody
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    PERFORM finance.fn_release_ticket_escrow(v_t2);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    IF v_after - v_before <> 50000 THEN RAISE EXCEPTION 'FAIL 4: refund moved % (expected +50000)', v_after - v_before; END IF;
    IF (SELECT status FROM finance.escrows WHERE ticket_id = v_t2) <> 'refunded' THEN
        RAISE EXCEPTION 'FAIL 4: unbound escrow not refunded';
    END IF;
    BEGIN
        UPDATE finance.escrows SET status = 'released' WHERE ticket_id = v_t2; v_ok := true;
    EXCEPTION WHEN check_violation THEN v_ok := false;
    END;
    IF v_ok THEN RAISE EXCEPTION 'FAIL 4: an unbound escrow could be marked released'; END IF;
    RAISE NOTICE 'PASS 4 releasing an unbound escrow refunds the payer; ck_escrows_unbound refuses released';
    -- #endregion

    -- #region 5. Unpriced tickets: both doors refuse before anything moves, then agree once priced
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    BEGIN
        PERFORM projects.fund_stage(v_project, v_s2); v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_ok := false; v_code := SQLSTATE; v_msg := SQLERRM;
    END;
    IF v_ok OR v_code <> 'PC409' OR v_msg NOT LIKE '%no price%' THEN RAISE EXCEPTION 'FAIL 5: fund_stage with an unpriced ticket % % %', v_ok, v_code, v_msg; END IF;
    BEGIN
        PERFORM finance.begin_card_payment('escrow_lock', NULL, v_project, v_s2, 10000, v_currency, 'probe-197-key-b'); v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_ok := false; v_code := SQLSTATE; v_msg := SQLERRM;
    END;
    IF v_ok OR v_code <> 'PC409' OR v_msg NOT LIKE '%no price%' THEN RAISE EXCEPTION 'FAIL 5: card intent with an unpriced ticket % % %', v_ok, v_code, v_msg; END IF;
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    IF v_before <> v_after OR EXISTS (SELECT 1 FROM finance.escrows WHERE project_stage_id = v_s2) THEN
        RAISE EXCEPTION 'FAIL 5: a refused stage moved money';
    END IF;

    UPDATE projects.tickets SET unit_price_cents = 15000 WHERE id = v_u2;
    v_out := projects.get_stage_funding_quote(v_project, v_s2);
    IF (v_out ->> 'amount_cents')::bigint <> 25000 OR (v_out ->> 'unpriced_count')::int <> 0
       OR (v_out ->> 'payer_scope') <> 'business' OR NOT (v_out ->> 'fundable')::boolean THEN
        RAISE EXCEPTION 'FAIL 5: quote %', v_out;
    END IF;
    v_pay := finance.begin_card_payment('escrow_lock', NULL, v_project, v_s2, 25000, v_currency, 'probe-197-key-c');
    PERFORM finance.attach_card_payment((v_pay ->> 'id')::uuid, 'pi_probe_197_c');
    PERFORM set_config('request.jwt.claims', '', true);
    v_settle := finance.settle_card_payment('evt_probe_197_c', 'pi_probe_197_c', 25000, v_currency, false);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE owner_type = 'business' AND owner_id = v_biz AND currency = v_currency;
    IF v_settle ->> 'lock_status' <> 'locked' OR jsonb_array_length(v_settle -> 'locked_escrow_ids') <> 2 THEN
        RAISE EXCEPTION 'FAIL 5: settlement %', v_settle;
    END IF;
    IF v_after <> v_before THEN RAISE EXCEPTION 'FAIL 5: card lock left % in the wallet', v_after - v_before; END IF;
    IF (SELECT status FROM projects.project_stages WHERE id = v_s2) <> 'in_progress' THEN
        RAISE EXCEPTION 'FAIL 5: an assigned stage funded by card should be in_progress';
    END IF;
    RAISE NOTICE 'PASS 5 unpriced: both doors refuse up front; priced: quote 25000 = card charge = 2 escrows locked';
    -- #endregion

    -- #region 6. An in-progress stage funds a ticket added since; a finished stage refuses
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description, unit_price_cents)
    VALUES (v_project, v_s2, 'Probe late', '{"t":"x"}', 'A description.', 7000) RETURNING id INTO v_t3;
    v_out := projects.fund_stage(v_project, v_s2);
    IF (v_out ->> 'funded_count')::int <> 1 OR v_out ->> 'stage_status' <> 'in_progress' THEN
        RAISE EXCEPTION 'FAIL 6: in-progress stage %', v_out;
    END IF;
    UPDATE projects.project_stages SET status = 'paid' WHERE id = v_s2;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description, unit_price_cents)
    VALUES (v_project, v_s2, 'Probe after', '{"t":"x"}', 'A description.', 7000);
    BEGIN
        PERFORM projects.fund_stage(v_project, v_s2); v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_ok := false; v_code := SQLSTATE;
    END;
    IF v_ok OR v_code <> '55000' THEN RAISE EXCEPTION 'FAIL 6: a paid stage % %', v_ok, v_code; END IF;
    RAISE NOTICE 'PASS 6 an in-progress stage funds a late ticket; a paid stage refuses (55000)';
    -- #endregion

    -- #region 7. fund_ticket on an unclaimed ticket holds it prepaid
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description, unit_price_cents)
    VALUES (v_project, v_stage, 'Probe single', '{"t":"x"}', 'A description.', 9000) RETURNING id INTO v_t3;
    v_out := projects.fund_ticket(v_project, v_t3);
    IF NOT (v_out ->> 'prepaid')::boolean OR (v_out ->> 'amount_cents')::bigint <> 9000 THEN
        RAISE EXCEPTION 'FAIL 7: fund_ticket %', v_out;
    END IF;
    RAISE NOTICE 'PASS 7 fund_ticket holds an unclaimed ticket prepaid';
    -- #endregion

    -- #region 8. An INDIVIDUAL client funds from their own wallet; a stranger cannot
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT p.id, p.owner_user_id INTO v_q, v_qowner
      FROM projects.projects p
     WHERE p.client_business_id IS NULL AND p.format = 'pipeline' AND p.structure_variation = 'standard'
       AND p.owner_user_id <> v_fl
     ORDER BY p.id LIMIT 1;
    IF v_q IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no individual pipeline project'; END IF;
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_q, 'Probe individual stage', 992, 'open', 12000) RETURNING id INTO v_qstage;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_q, v_qstage, 'Probe Q1', '{"t":"x"}', 'A description.') RETURNING id INTO v_qt;
    v_wtype := finance.fn_person_wallet_type(v_qowner);
    PERFORM finance.fn_ensure_wallet(v_wtype, v_qowner, (SELECT upper(COALESCE(currency, 'USD')) FROM projects.projects WHERE id = v_q));
    PERFORM finance.fn_wallet_credit(v_qowner, v_wtype, (SELECT upper(COALESCE(currency, 'USD')) FROM projects.projects WHERE id = v_q),
        12000, 'topup', 'inbound_payments', gen_random_uuid());

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_fl, 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM projects.fund_stage(v_q, v_qstage); v_ok := true;
    EXCEPTION WHEN OTHERS THEN v_ok := false; v_code := SQLSTATE;
    END;
    IF v_ok OR v_code <> '42501' THEN RAISE EXCEPTION 'FAIL 8: a non-owner funded an individual stage % %', v_ok, v_code; END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_qowner, 'role', 'authenticated')::text, true);
    v_out := projects.get_stage_funding_quote(v_q, v_qstage);
    IF v_out ->> 'payer_scope' <> 'personal' OR (v_out ->> 'wallet_balance_cents')::bigint < 12000 THEN
        RAISE EXCEPTION 'FAIL 8: individual quote %', v_out;
    END IF;
    v_out := projects.fund_stage(v_q, v_qstage);
    IF (v_out ->> 'funded_count')::int <> 1 THEN RAISE EXCEPTION 'FAIL 8: individual fund_stage %', v_out; END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = v_qt AND status = 'held'
                    AND payer_user_id = v_qowner AND payer_business_id IS NULL AND payee_id IS NULL) THEN
        RAISE EXCEPTION 'FAIL 8: individual escrow not held prepaid from the owner';
    END IF;
    RAISE NOTICE 'PASS 8 an individual owner funds an open stage from their own wallet; a non-owner is refused';
    -- #endregion
END $$;

ROLLBACK;
