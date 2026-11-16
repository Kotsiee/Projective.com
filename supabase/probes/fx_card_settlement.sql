-- =============================================================================================
-- Probe: card payments in the buyer's own currency (Decision #435) — finance.begin_card_payment with
-- p_fx_quote_id, finance.attach_checkout_order with `fx_quote_id`, and finance.settle_card_payment.
--
--   1. An escrow lock is charged the quote's amount in the payer's currency into their wallet in that
--      currency; settlement converts it and holds the ticket's escrow in the project's currency, stamped
--      with the conversion; both wallets net to zero and nothing drifts. A charge or currency other than
--      the quote's refuses before anything exists.
--   2. A quote a card payment was started on is honoured at settlement after it expires.
--   3. A card checkout attaches its quote; settlement converts and places the order, which names the
--      conversion. A payment that does not match its quote cannot attach it.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/fx_card_settlement.sql
--
-- Fixture: a seeded individual-owner pipeline stage with tickets added inside the transaction, its owner
-- as the payer paying in GBP (EUR when the project is in GBP), a published product repriced into the
-- project's currency, fresh GBP-based rates and the feature switched on. A clean run prints only PASS.
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
    v_product uuid;
    v_basket uuid;
    v_line uuid;
    v_q jsonb;
    v_pay_row jsonb;
    v_out jsonb;
    v_payment finance.inbound_payments;
    v_conv finance.fx_conversions;
    v_escrow finance.escrows;
    m record;
    v_quote_id uuid;
    v_payment_id uuid;
    v_pay_before bigint;
    v_ccy_before bigint;
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
    VALUES (v_project, v_stage, v_freelancer, 'Probe FX A', 'A description.', 10000) RETURNING id INTO v_a;
    INSERT INTO projects.tickets (project_id, current_stage_id, current_assignee_id, title, text_description, unit_price_cents)
    VALUES (v_project, v_stage, v_freelancer, 'Probe FX B', 'A description.', 10000) RETURNING id INTO v_b;
    INSERT INTO finance.fx_rates (base, quote, rate, as_of, provider)
    SELECT 'GBP', c, r, pg_catalog.now(), 'probe'
      FROM (VALUES ('EUR', 1.1700000000), ('USD', 1.2700000000), ('CAD', 1.7300000000), ('AUD', 1.9300000000),
                   ('JPY', 192.0000000000), ('SGD', 1.7000000000), ('CHF', 1.1200000000), ('ZAR', 23.1000000000)) AS x (c, r);
    UPDATE security.platform_params SET value = 'true'::jsonb WHERE key = 'fx_checkout_enabled';
    UPDATE security.platform_params SET value = '{"default": 150}'::jsonb WHERE key = 'fx_spread_bp';
    -- #endregion

    -- #region 1. An escrow lock charged in the payer's currency
    PERFORM pg_temp.act(v_owner);
    v_q := finance.quote_fx_conversion(v_type, v_owner, v_pay, v_ccy, 10000, 'escrow_lock', 'tickets', v_a);
    PERFORM pg_temp.act(NULL);
    v_r := pg_temp.try_as(v_owner, pg_catalog.format(
        'SELECT finance.begin_card_payment(%L, NULL, %L, %L, %s, %L, %L, %L, NULL, %L)',
        'escrow_lock', v_project, v_stage, (v_q ->> 'from_minor')::bigint + 1, v_pay, 'fxprobe-lock-wrong', v_a, v_q ->> 'id'));
    IF v_r NOT LIKE 'PC409:%' THEN v_fail := v_fail || ('wrong charge: ' || v_r); END IF;
    v_r := pg_temp.try_as(v_owner, pg_catalog.format(
        'SELECT finance.begin_card_payment(%L, NULL, %L, %L, %s, %L, %L, %L, NULL, %L)',
        'escrow_lock', v_project, v_stage, (v_q ->> 'from_minor')::bigint, v_ccy, 'fxprobe-lock-ccy', v_a, v_q ->> 'id'));
    IF v_r NOT LIKE 'PC409:%' THEN v_fail := v_fail || ('wrong currency: ' || v_r); END IF;

    PERFORM pg_temp.act(v_owner);
    v_pay_row := finance.begin_card_payment('escrow_lock', NULL, v_project, v_stage, (v_q ->> 'from_minor')::bigint,
        v_pay, 'fxprobe-lock-1', v_a, NULL, (v_q ->> 'id')::uuid);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_payment FROM finance.inbound_payments WHERE id = (v_pay_row ->> 'id')::uuid;
    IF v_payment.currency <> v_pay OR v_payment.amount_cents <> (v_q ->> 'from_minor')::bigint
       OR v_payment.fx_quote_id IS DISTINCT FROM (v_q ->> 'id')::uuid
       OR (SELECT w.currency FROM finance.wallets w WHERE w.id = v_payment.wallet_id) <> v_pay THEN
        v_fail := v_fail || ('lock payment: ' || pg_catalog.to_jsonb(v_payment)::text);
    END IF;
    UPDATE finance.inbound_payments SET provider_ref = 'pi_fxprobe_lock', status = 'processing' WHERE id = v_payment.id;
    v_pay_before := (SELECT balance_cents FROM finance.wallets WHERE id = v_payment.wallet_id);
    v_ccy_before := COALESCE((SELECT w.balance_cents FROM finance.wallets w
                               WHERE w.owner_id = v_owner AND w.owner_type = v_type AND w.currency = v_ccy), 0);
    v_out := finance.settle_card_payment('evt_fxprobe_lock', 'pi_fxprobe_lock', v_payment.amount_cents, v_pay, false, v_payment.id);
    SELECT * INTO v_payment FROM finance.inbound_payments WHERE id = v_payment.id;
    SELECT * INTO v_conv FROM finance.fx_conversions WHERE quote_id = (v_q ->> 'id')::uuid;
    SELECT * INTO v_escrow FROM finance.escrows WHERE ticket_id = v_a AND status = 'held';
    IF v_payment.lock_status <> 'locked' OR v_escrow.id IS NULL OR v_escrow.amount_cents <> 10000 OR v_escrow.currency <> v_ccy
       OR v_escrow.fx_conversion_id IS DISTINCT FROM v_conv.id OR v_escrow.fx_source_minor <> v_payment.amount_cents
       OR v_escrow.fx_base <> v_pay OR v_conv.ref_table <> 'inbound_payments' OR v_conv.ref_id <> v_payment.id
       OR NOT (v_escrow.id = ANY (v_payment.locked_escrow_ids)) THEN
        v_fail := v_fail || ('lock settled: ' || v_out::text || ' escrow ' || COALESCE(pg_catalog.to_jsonb(v_escrow)::text, 'none'));
    END IF;
    IF (SELECT balance_cents FROM finance.wallets WHERE id = v_conv.from_wallet_id) <> v_pay_before
       OR (SELECT balance_cents FROM finance.wallets WHERE id = v_conv.to_wallet_id) <> v_ccy_before THEN
        v_fail := v_fail || 'the charge did not pass through both wallets net of zero'::text;
    END IF;
    -- #endregion

    -- #region 2. An expired quote a payment was started on is honoured at settlement
    SELECT * INTO m FROM finance.fn_fx_quote_minor(10000, v_pay, v_ccy,
        (v_q ->> 'from_rate')::numeric, (v_q ->> 'to_rate')::numeric, 150);
    INSERT INTO finance.fx_quotes (owner_type, owner_id, purpose, ref_table, ref_id, from_currency, to_currency, to_minor,
        principal_minor, spread_bp, spread_minor, from_minor, from_rate, to_rate, mid_rate, rate_as_of, rate_provider,
        created_by, created_at, expires_at)
    VALUES (v_type, v_owner, 'escrow_lock', 'tickets', v_b, v_pay, v_ccy, 10000, m.principal_minor, 150, m.spread_minor,
        m.from_minor, (v_q ->> 'from_rate')::numeric, (v_q ->> 'to_rate')::numeric, (v_q ->> 'mid_rate')::numeric,
        pg_catalog.now(), 'probe', v_owner, pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '1 hour')
    RETURNING id INTO v_quote_id;
    INSERT INTO finance.inbound_payments (purpose, wallet_id, project_stage_id, ticket_id, amount_cents, currency, status,
        lock_status, provider, provider_ref, idempotency_key, created_by, fx_quote_id)
    VALUES ('escrow_lock', v_conv.from_wallet_id, v_stage, v_b, m.from_minor, v_pay, 'processing', 'pending', 'stripe',
        'pi_fxprobe_late', 'fxprobe-lock-late', v_owner, v_quote_id)
    RETURNING id INTO v_payment_id;
    v_out := finance.settle_card_payment('evt_fxprobe_late', 'pi_fxprobe_late', m.from_minor, v_pay, false, v_payment_id);
    IF (SELECT lock_status FROM finance.inbound_payments WHERE id = v_payment_id) <> 'locked'
       OR NOT EXISTS (SELECT 1 FROM finance.escrows e
                       WHERE e.ticket_id = v_b AND e.status = 'held' AND e.fx_conversion_id IS NOT NULL) THEN
        v_fail := v_fail || ('expired quote not honoured: ' || v_out::text);
    END IF;
    -- #endregion

    -- #region 3. A card checkout converts and places the order
    SELECT p.id INTO v_product
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NULL AND p.owner_user_id <> v_owner
     ORDER BY p.id LIMIT 1;
    UPDATE catalogue.products SET price_cents = 9000, currency = v_ccy WHERE id = v_product;
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES (v_type, v_owner, 'Probe FX card') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, destination_email)
    VALUES (v_basket, 'digital_product', v_product, 'Probe FX product', 9000, v_ccy, 'probe@example.com') RETURNING id INTO v_line;
    PERFORM pg_temp.act(v_owner);
    v_q := finance.quote_fx_conversion(v_type, v_owner, v_pay, v_ccy, 9000, 'checkout', 'baskets', v_basket);
    v_pay_row := finance.begin_card_payment('wallet_topup', v_conv.from_wallet_id, NULL, NULL,
        (v_q ->> 'from_minor')::bigint, v_pay, 'fxprobe-topup-1');
    PERFORM pg_temp.act(NULL);
    v_r := pg_temp.try_as(v_owner, pg_catalog.format('SELECT finance.attach_checkout_order(%L, %L::jsonb)',
        v_pay_row ->> 'id', pg_catalog.jsonb_build_object('basket_id', v_basket, 'item_ids', pg_catalog.jsonb_build_array(v_line),
            'currency', v_ccy, 'units', pg_catalog.jsonb_build_object(v_line::text, 9000), 'order_key', 'fxprobe-order-1',
            'fx_quote_id', v_quote_id)::text));
    IF v_r NOT LIKE '22023:%' THEN v_fail := v_fail || ('foreign quote attached: ' || v_r); END IF;
    PERFORM pg_temp.act(v_owner);
    PERFORM finance.attach_checkout_order((v_pay_row ->> 'id')::uuid, pg_catalog.jsonb_build_object(
        'basket_id', v_basket, 'item_ids', pg_catalog.jsonb_build_array(v_line), 'currency', v_ccy,
        'units', pg_catalog.jsonb_build_object(v_line::text, 9000), 'order_key', 'fxprobe-order-1',
        'fx_quote_id', v_q ->> 'id'));
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_payment FROM finance.inbound_payments WHERE id = (v_pay_row ->> 'id')::uuid;
    IF v_payment.fx_quote_id IS DISTINCT FROM (v_q ->> 'id')::uuid OR v_payment.checkout ->> 'currency' <> v_ccy
       OR v_payment.checkout ->> 'fx_quote_id' <> v_q ->> 'id' THEN
        v_fail := v_fail || ('attach: ' || COALESCE(v_payment.checkout::text, 'none'));
    END IF;
    UPDATE finance.inbound_payments SET provider_ref = 'pi_fxprobe_order', status = 'processing' WHERE id = v_payment.id;
    v_out := finance.settle_card_payment('evt_fxprobe_order', 'pi_fxprobe_order', v_payment.amount_cents, v_pay, false, v_payment.id);
    SELECT * INTO v_payment FROM finance.inbound_payments WHERE id = v_payment.id;
    SELECT * INTO v_conv FROM finance.fx_conversions WHERE quote_id = (v_q ->> 'id')::uuid;
    IF v_payment.order_id IS NULL OR v_payment.order_error IS NOT NULL
       OR (SELECT o.fx_conversion_id FROM finance.orders o WHERE o.id = v_payment.order_id) IS DISTINCT FROM v_conv.id
       OR (SELECT o.currency FROM finance.orders o WHERE o.id = v_payment.order_id) <> v_ccy
       OR v_conv.ref_table <> 'orders' THEN
        v_fail := v_fail || ('card checkout: ' || v_out::text || ' ' || COALESCE(v_payment.order_error, ''));
    END IF;
    -- #endregion

    IF EXISTS (SELECT 1 FROM finance.v_fx_conversion_reconciliation)
       OR EXISTS (SELECT 1 FROM finance.v_wallet_reconciliation r
                   WHERE r.owner_id = v_owner AND r.drift_cents <> 0) THEN
        v_fail := v_fail || 'drift'::text;
    END IF;
    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'PROBE FAIL: %', pg_catalog.array_to_string(v_fail, ' | ');
    END IF;
    RAISE NOTICE 'PASS card payments in the payer''s currency: lock converted and stamped, expired quote honoured, checkout placed';
END $$;

ROLLBACK;
