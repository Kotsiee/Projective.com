-- =============================================================================================
-- Probe: refunds of FX-funded escrow return the exact amount paid (Decision #435 (D)) —
-- finance.fund_with_conversion, finance.fn_refund_escrow_to_payer through the real refund doors
-- (fn_refund_ticket_escrow, fn_fair_exit_release), and finance.v_fx_exposure.
--
--   1. A ticket funded from the payer's own currency is held in the project's, stamped with the
--      conversion and its exact cost, and shows in the exposure view.
--   2. After the market rate moves, refunding it returns exactly what it cost, in the payer's currency,
--      to the wallet that paid, as one `unwind` conversion; the escrow currency's wallet is untouched.
--   3. A 50% Fair Exit returns half the cost, rounded up in the payer's favour.
--   4. An escrow held from a balance in its own currency refunds in it, as before, with no FX stamp.
--   5. A quote that does not price the door's amount, or names another ticket, refuses.
--   Every wallet matches its ledger and finance.v_fx_conversion_reconciliation stays empty.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/fx_refund_pinning.sql
--
-- Fixture: a seeded individual-owner pipeline stage with tickets added inside the transaction, its owner
-- paying in GBP (EUR when the project is in GBP) from a funded wallet, fresh GBP-based rates and the
-- feature switched on. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.try_as(p_uid uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_uid);
    EXECUTE p_sql;
    PERFORM pg_temp.act(NULL);
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM pg_temp.act(NULL);
    RETURN v_state || ': ' || v_msg;
END $$;

CREATE FUNCTION pg_temp.fund(p_owner uuid, p_type text, p_pay text, p_ccy text, p_project uuid, p_stage uuid, p_ticket uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_q jsonb;
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act(p_owner);
    v_q := finance.quote_fx_conversion(p_type, p_owner, p_pay, p_ccy, 10000, 'funding', 'tickets', p_ticket);
    v_out := finance.fund_with_conversion((v_q ->> 'id')::uuid, p_project, p_stage, p_ticket, NULL);
    PERFORM pg_temp.act(NULL);
    RETURN v_out || pg_catalog.jsonb_build_object('quote', v_q);
END $$;

DO $$
DECLARE
    v_project uuid;
    v_stage uuid;
    v_owner uuid;
    v_freelancer uuid;
    v_ccy text;
    v_pay text;
    v_type text;
    v_a uuid;
    v_b uuid;
    v_c uuid;
    v_d uuid;
    v_pay_wallet uuid;
    v_ccy_wallet uuid;
    v_out jsonb;
    v_e finance.escrows;
    v_pay_before bigint;
    v_ccy_before bigint;
    v_n integer;
    v_q jsonb;
    v_r text;
    v_fail text[] := '{}';
BEGIN
    -- #region Fixture (as postgres)
    SELECT p.id, ps.id, p.owner_user_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_project, v_stage, v_owner, v_ccy
      FROM projects.projects p
      JOIN projects.project_stages ps ON ps.project_id = p.id
      JOIN org.users_public up ON up.user_id = p.owner_user_id
     WHERE p.client_business_id IS NULL AND p.client_user_id IS NULL
       AND p.format = 'pipeline' AND p.structure_variation = 'standard'
       AND p.status NOT IN ('completed', 'cancelled', 'archived')
       AND ps.status NOT IN ('approved', 'paid', 'cancelled')
       AND up.dob <= current_date - interval '18 years'
     ORDER BY p.id, ps.sort_order
     LIMIT 1;
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no individual-owner pipeline stage in the seed'; END IF;
    SELECT fp.user_id INTO v_freelancer FROM org.freelancer_profiles fp WHERE fp.user_id <> v_owner ORDER BY fp.user_id LIMIT 1;
    v_pay := CASE WHEN v_ccy = 'GBP' THEN 'EUR' ELSE 'GBP' END;
    v_type := finance.fn_person_wallet_type(v_owner);
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe FX refund A', 'A description.', 10000) RETURNING id INTO v_a;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe FX refund B', 'A description.', 10000) RETURNING id INTO v_b;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe FX refund C', 'A description.', 10000) RETURNING id INTO v_c;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe FX refund D', 'A description.', 10000) RETURNING id INTO v_d;
    v_pay_wallet := finance.fn_ensure_wallet(v_type, v_owner, v_pay);
    PERFORM finance.fn_wallet_credit(v_owner, v_type, v_pay, 100000, 'topup', 'probe', NULL);
    INSERT INTO finance.fx_rates (base, quote, rate, as_of, provider)
    SELECT 'GBP', c, r, pg_catalog.now(), 'probe'
      FROM (VALUES ('EUR', 1.1700000000), ('USD', 1.2700000000), ('CAD', 1.7300000000), ('AUD', 1.9300000000),
                   ('JPY', 192.0000000000), ('SGD', 1.7000000000), ('CHF', 1.1200000000), ('ZAR', 23.1000000000)) AS x (c, r);
    UPDATE security.platform_params SET value = 'true'::jsonb WHERE key = 'fx_checkout_enabled';
    UPDATE security.platform_params SET value = '{"default": 150}'::jsonb WHERE key = 'fx_spread_bp';
    -- #endregion

    -- #region 1. Funded from the payer's own currency
    SELECT balance_cents INTO v_pay_before FROM finance.wallets WHERE id = v_pay_wallet;
    v_out := pg_temp.fund(v_owner, v_type, v_pay, v_ccy, v_project, v_stage, v_a);
    SELECT * INTO v_e FROM finance.escrows WHERE ticket_id = v_a AND status = 'held';
    v_ccy_wallet := (SELECT c.to_wallet_id FROM finance.fx_conversions c WHERE c.id = (v_out ->> 'fx_conversion_id')::uuid);
    IF v_e.id IS NULL OR v_e.amount_cents <> 10000 OR v_e.currency <> v_ccy OR v_e.fx_base <> v_pay
       OR v_e.fx_source_minor <> (v_out -> 'quote' ->> 'from_minor')::bigint
       OR (SELECT balance_cents FROM finance.wallets WHERE id = v_pay_wallet) <> v_pay_before - v_e.fx_source_minor THEN
        v_fail := v_fail || ('funded: ' || v_out::text);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.v_fx_exposure x
                    WHERE x.paid_currency = v_pay AND x.owed_currency = v_ccy AND x.owed_minor >= 10000) THEN
        v_fail := v_fail || 'exposure view misses the held escrow'::text;
    END IF;
    -- #endregion

    -- #region 2. The rate moves, and a refund still returns exactly what it cost
    INSERT INTO finance.fx_rates (base, quote, rate, as_of, provider)
    VALUES ('GBP', CASE WHEN v_ccy = 'GBP' THEN v_pay ELSE v_ccy END, 1.4000000000, pg_catalog.clock_timestamp(), 'probe');
    SELECT balance_cents INTO v_pay_before FROM finance.wallets WHERE id = v_pay_wallet;
    SELECT balance_cents INTO v_ccy_before FROM finance.wallets WHERE id = v_ccy_wallet;
    PERFORM finance.fn_refund_ticket_escrow(v_a);
    IF (SELECT balance_cents FROM finance.wallets WHERE id = v_pay_wallet) <> v_pay_before + v_e.fx_source_minor
       OR (SELECT balance_cents FROM finance.wallets WHERE id = v_ccy_wallet) <> v_ccy_before THEN
        v_fail := v_fail || 'whole refund did not return exactly the cost to the paying wallet'::text;
    END IF;
    SELECT pg_catalog.count(*) INTO v_n FROM finance.transactions t
     WHERE t.wallet_id = v_pay_wallet AND t.direction = 'credit' AND t.reason = 'escrow_refund'
       AND t.ref_table = 'escrows' AND t.ref_id = v_e.id AND t.amount_cents = v_e.fx_source_minor
       AND t.fx_rate = v_e.fx_rate AND t.fx_base = v_pay;
    IF v_n <> 1 THEN v_fail := v_fail || ('refund credit stamped at the pinned rate: ' || v_n); END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.fx_conversions u
                    WHERE u.kind = 'unwind' AND u.parent_id = v_e.fx_conversion_id AND u.ref_id = v_e.id
                      AND u.from_minor = 10000 AND u.to_minor = v_e.fx_source_minor AND u.from_wallet_id IS NULL) THEN
        v_fail := v_fail || 'no unwind conversion recorded'::text;
    END IF;
    -- #endregion

    -- #region 3. A 50% Fair Exit returns half the cost, rounded up
    v_out := pg_temp.fund(v_owner, v_type, v_pay, v_ccy, v_project, v_stage, v_b);
    SELECT * INTO v_e FROM finance.escrows WHERE ticket_id = v_b AND status = 'held';
    SELECT balance_cents INTO v_pay_before FROM finance.wallets WHERE id = v_pay_wallet;
    PERFORM finance.fn_fair_exit_release(v_b, 5000);
    IF (SELECT balance_cents FROM finance.wallets WHERE id = v_pay_wallet)
       <> v_pay_before + finance.fn_fx_refund_minor(5000, 10000, v_e.fx_source_minor)
       OR finance.fn_fx_refund_minor(5000, 10000, v_e.fx_source_minor) * 2 < v_e.fx_source_minor THEN
        v_fail := v_fail || 'fair exit refund is not half the cost rounded up'::text;
    END IF;
    -- #endregion

    -- #region 4. An escrow held in its own currency refunds in it, unstamped
    PERFORM finance.fn_wallet_credit(v_owner, v_type, v_ccy, 10000, 'topup', 'probe', NULL);
    PERFORM pg_temp.act(v_owner);
    PERFORM projects.fund_ticket(v_project, v_c);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_e FROM finance.escrows WHERE ticket_id = v_c AND status = 'held';
    SELECT balance_cents INTO v_ccy_before FROM finance.wallets WHERE id = v_ccy_wallet;
    PERFORM finance.fn_refund_ticket_escrow(v_c);
    IF v_e.fx_conversion_id IS NOT NULL
       OR (SELECT balance_cents FROM finance.wallets WHERE id = v_ccy_wallet) <> v_ccy_before + 10000
       OR EXISTS (SELECT 1 FROM finance.transactions t WHERE t.ref_table = 'escrows' AND t.ref_id = v_e.id AND t.fx_rate IS NOT NULL) THEN
        v_fail := v_fail || 'an unconverted escrow did not refund in its own currency'::text;
    END IF;
    -- #endregion

    -- #region 5. A quote must price the door's amount, for the ticket it names
    PERFORM pg_temp.act(v_owner);
    v_q := finance.quote_fx_conversion(v_type, v_owner, v_pay, v_ccy, 9999, 'funding', 'tickets', v_d);
    PERFORM pg_temp.act(NULL);
    v_r := pg_temp.try_as(v_owner, pg_catalog.format('SELECT finance.fund_with_conversion(%L, %L, %L, %L, NULL)',
        v_q ->> 'id', v_project, v_stage, v_d));
    IF v_r NOT LIKE 'PC409:%' THEN v_fail := v_fail || ('mispriced: ' || v_r); END IF;
    v_r := pg_temp.try_as(v_owner, pg_catalog.format('SELECT finance.fund_with_conversion(%L, %L, %L, %L, NULL)',
        v_q ->> 'id', v_project, v_stage, v_c));
    IF v_r NOT LIKE '22023:%' THEN v_fail := v_fail || ('another ticket: ' || v_r); END IF;
    -- #endregion

    IF EXISTS (SELECT 1 FROM finance.v_fx_conversion_reconciliation)
       OR EXISTS (SELECT 1 FROM finance.v_wallet_reconciliation r WHERE r.owner_id = v_owner AND r.drift_cents <> 0) THEN
        v_fail := v_fail || 'drift'::text;
    END IF;
    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'PROBE FAIL: %', pg_catalog.array_to_string(v_fail, ' | ');
    END IF;
    RAISE NOTICE 'PASS refunds return what was paid at the pinned figure; unconverted escrow refunds as before; no drift';
END $$;

ROLLBACK;
