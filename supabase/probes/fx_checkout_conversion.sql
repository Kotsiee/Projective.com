-- =============================================================================================
-- Probe: a checkout paid in the buyer's own currency (Decision #435) — finance.place_wallet_order with
-- p_fx_quote_id. The quote converts exactly the order's net out of the buyer's GBP wallet (`fx_conversion`
-- principal + `fx_spread` margin, both stamped with the pair, the rate and its date) into their EUR wallet
-- (`fx_conversion`), the order is paid there and names the conversion, and nothing drifts: every wallet
-- matches its ledger and finance.v_fx_conversion_reconciliation stays empty. A replay answers with the
-- same charge; a used, expired or mispriced quote, or a wallet that cannot cover it, refuses and moves
-- nothing.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/fx_checkout_conversion.sql
--
-- Fixture: a seeded adult person as the buyer with a fresh GBP wallet of £200, a published single-owner
-- product repriced to €90.00, a basket line for it, fresh GBP-based rates and the feature switched on.
-- A clean run prints only PASS notices; any failure ends the run in an error listing every failed case.
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

CREATE FUNCTION pg_temp.line(p_basket uuid, p_product uuid, p_minor bigint) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, destination_email)
    VALUES (p_basket, 'digital_product', p_product, 'Probe FX product', p_minor, 'EUR', 'probe@example.com')
    RETURNING id;
$$;

CREATE FUNCTION pg_temp.quote(p_buyer uuid, p_basket uuid, p_minor bigint) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.act(p_buyer);
    v := finance.quote_fx_conversion('user', p_buyer, 'GBP', 'EUR', p_minor, 'checkout', 'baskets', p_basket);
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.place_sql(p_basket uuid, p_line uuid, p_minor bigint, p_key text, p_quote uuid) RETURNS text
LANGUAGE sql AS $$
    SELECT pg_catalog.format(
        'SELECT finance.place_wallet_order(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, NULL, %L, %s, %L)',
        p_basket, p_line, 'EUR', pg_catalog.jsonb_build_object(p_line::text, p_minor)::text, p_key, p_minor, p_quote);
$$;

DO $$
DECLARE
    v_buyer uuid;
    v_type text;
    v_gbp uuid;
    v_eur uuid;
    v_product uuid;
    v_basket uuid;
    v_line uuid;
    v_q jsonb;
    v_out jsonb;
    v_again jsonb;
    v_conv finance.fx_conversions;
    v_gbp_before bigint;
    v_eur_before bigint;
    v_r text;
    v_n integer;
    v_fail text[] := '{}';
BEGIN
    -- #region Fixture (as postgres)
    SELECT up.user_id INTO v_buyer
      FROM org.users_public up
      JOIN auth.users u ON u.id = up.user_id
     WHERE NOT EXISTS (SELECT 1 FROM org.business_members bm WHERE bm.user_id = up.user_id)
       AND up.dob <= current_date - interval '18 years'
     ORDER BY up.user_id LIMIT 1;
    SELECT p.id INTO v_product
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NULL AND p.owner_user_id <> v_buyer
     ORDER BY p.id LIMIT 1;
    IF v_buyer IS NULL OR v_product IS NULL THEN RAISE EXCEPTION 'FAIL fixture: a buyer and a published product are needed'; END IF;
    UPDATE catalogue.products SET price_cents = 9000, currency = 'EUR' WHERE id = v_product;
    v_type := finance.fn_person_wallet_type(v_buyer);
    v_gbp := finance.fn_ensure_wallet(v_type, v_buyer, 'GBP');
    PERFORM finance.fn_wallet_credit(v_buyer, v_type, 'GBP', 20000, 'topup', 'probe', NULL);
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES (v_type, v_buyer, 'Probe FX checkout') RETURNING id INTO v_basket;
    v_line := pg_temp.line(v_basket, v_product, 9000);
    INSERT INTO finance.fx_rates (base, quote, rate, as_of, provider) VALUES
        ('GBP', 'EUR', 1.1700000000, pg_catalog.now(), 'probe');
    UPDATE security.platform_params SET value = 'true'::jsonb WHERE key = 'fx_checkout_enabled';
    UPDATE security.platform_params SET value = '{"default": 150}'::jsonb WHERE key = 'fx_spread_bp';
    -- #endregion

    -- #region 1. The order is paid in GBP through the conversion
    v_q := pg_temp.quote(v_buyer, v_basket, 9000);
    SELECT balance_cents INTO v_gbp_before FROM finance.wallets WHERE id = v_gbp;
    PERFORM pg_temp.act(v_buyer);
    v_out := finance.place_wallet_order(v_basket, ARRAY[v_line], 'EUR', pg_catalog.jsonb_build_object(v_line::text, 9000),
        NULL, 'fx-probe-order-1', 9000, (v_q ->> 'id')::uuid);
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_conv FROM finance.fx_conversions WHERE quote_id = (v_q ->> 'id')::uuid;
    v_eur := v_conv.to_wallet_id;
    IF (v_out ->> 'charge_minor')::bigint <> 7807 OR v_out ->> 'charge_currency' <> 'GBP'
       OR (v_out ->> 'charged_minor')::bigint <> 9000 OR v_out ->> 'currency' <> 'EUR'
       OR (v_out ->> 'fx_conversion_id')::uuid IS DISTINCT FROM v_conv.id THEN
        v_fail := v_fail || ('result: ' || v_out::text);
    END IF;
    IF (SELECT balance_cents FROM finance.wallets WHERE id = v_gbp) <> v_gbp_before - 7807 THEN
        v_fail := v_fail || 'GBP wallet did not move by the charge'::text;
    END IF;
    SELECT pg_catalog.count(*) INTO v_n FROM finance.transactions t
     WHERE t.wallet_id = v_gbp AND t.ref_table = 'fx_conversions' AND t.ref_id = v_conv.id AND t.direction = 'debit'
       AND t.fx_base = 'GBP' AND t.fx_rate = 1.17 AND t.fx_as_of = pg_catalog.now()
       AND ((t.reason = 'fx_conversion' AND t.amount_cents = 7692) OR (t.reason = 'fx_spread' AND t.amount_cents = 115));
    IF v_n <> 2 THEN v_fail := v_fail || ('GBP legs stamped: ' || v_n); END IF;
    SELECT pg_catalog.count(*) INTO v_n FROM finance.transactions t
     WHERE t.wallet_id = v_eur AND ((t.reason = 'fx_conversion' AND t.direction = 'credit' AND t.amount_cents = 9000
                                     AND t.fx_rate = 1.17 AND t.ref_id = v_conv.id)
                                 OR (t.reason = 'order_payment' AND t.direction = 'debit' AND t.amount_cents = 9000));
    IF v_n <> 2 THEN v_fail := v_fail || ('EUR legs: ' || v_n); END IF;
    IF (SELECT o.fx_conversion_id FROM finance.orders o WHERE o.idempotency_key = 'fx-probe-order-1') IS DISTINCT FROM v_conv.id
       OR (SELECT consumed_at FROM finance.fx_quotes WHERE id = (v_q ->> 'id')::uuid) IS NULL
       OR v_conv.ref_table <> 'orders' THEN
        v_fail := v_fail || 'order or quote not bound to the conversion'::text;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.v_wallet_reconciliation r WHERE r.wallet_id IN (v_gbp, v_eur) AND r.drift_cents <> 0)
       OR EXISTS (SELECT 1 FROM finance.v_fx_conversion_reconciliation) THEN
        v_fail := v_fail || 'drift after the conversion'::text;
    END IF;
    -- #endregion

    -- #region 2. A replay answers with the same charge
    PERFORM pg_temp.act(v_buyer);
    v_again := finance.place_wallet_order(v_basket, ARRAY[v_line], 'EUR', pg_catalog.jsonb_build_object(v_line::text, 9000),
        NULL, 'fx-probe-order-1', 9000, (v_q ->> 'id')::uuid);
    PERFORM pg_temp.act(NULL);
    IF (v_again ->> 'replayed')::boolean IS NOT TRUE OR (v_again ->> 'charge_minor')::bigint <> 7807
       OR v_again ->> 'charge_currency' <> 'GBP' THEN
        v_fail := v_fail || ('replay: ' || v_again::text);
    END IF;
    -- #endregion

    -- #region 3. Refusals move nothing
    v_line := pg_temp.line(v_basket, v_product, 9000);
    SELECT balance_cents INTO v_gbp_before FROM finance.wallets WHERE id = v_gbp;
    SELECT balance_cents INTO v_eur_before FROM finance.wallets WHERE id = v_eur;

    v_r := pg_temp.try_as(v_buyer, pg_temp.place_sql(v_basket, v_line, 9000, 'fx-probe-used', (v_q ->> 'id')::uuid));
    IF v_r NOT LIKE 'PC409: quote_used%' THEN v_fail := v_fail || ('used quote: ' || v_r); END IF;

    v_q := pg_temp.quote(v_buyer, v_basket, 9000);
    UPDATE catalogue.products SET price_cents = 9100 WHERE id = v_product;
    v_r := pg_temp.try_as(v_buyer, pg_temp.place_sql(v_basket, v_line, 9100, 'fx-probe-moved', (v_q ->> 'id')::uuid));
    IF v_r NOT LIKE 'PC409: price_changed%' THEN v_fail := v_fail || ('moved price: ' || v_r); END IF;
    UPDATE catalogue.products SET price_cents = 9000 WHERE id = v_product;

    INSERT INTO finance.fx_quotes (owner_type, owner_id, purpose, ref_table, ref_id, from_currency, to_currency, to_minor,
        principal_minor, spread_bp, spread_minor, from_minor, from_rate, to_rate, mid_rate, rate_as_of, rate_provider,
        created_by, created_at, expires_at)
    VALUES (v_type, v_buyer, 'checkout', 'baskets', v_basket, 'GBP', 'EUR', 9000, 7692, 150, 115, 7807, 1, 1.17, 1.17,
        pg_catalog.now(), 'probe', v_buyer, pg_catalog.now() - interval '2 hours', pg_catalog.now() - interval '1 hour')
    RETURNING pg_catalog.to_jsonb(fx_quotes.*) INTO v_q;
    v_r := pg_temp.try_as(v_buyer, pg_temp.place_sql(v_basket, v_line, 9000, 'fx-probe-expired', (v_q ->> 'id')::uuid));
    IF v_r NOT LIKE 'PC409: quote_expired%' THEN v_fail := v_fail || ('expired quote: ' || v_r); END IF;

    UPDATE catalogue.products SET price_cents = 50000 WHERE id = v_product;
    v_line := pg_temp.line(v_basket, v_product, 50000);
    v_q := pg_temp.quote(v_buyer, v_basket, 50000);
    v_r := pg_temp.try_as(v_buyer, pg_catalog.format(
        'SELECT finance.place_wallet_order(%L, ARRAY[%L]::uuid[], %L, %L::jsonb, NULL, %L, %s, %L)',
        v_basket, v_line, 'EUR', pg_catalog.jsonb_build_object(v_line::text, 50000)::text, 'fx-probe-short', 50000, v_q ->> 'id'));
    IF v_r NOT LIKE 'PF402:%' THEN v_fail := v_fail || ('short wallet: ' || v_r); END IF;

    IF (SELECT balance_cents FROM finance.wallets WHERE id = v_gbp) <> v_gbp_before
       OR (SELECT balance_cents FROM finance.wallets WHERE id = v_eur) <> v_eur_before THEN
        v_fail := v_fail || 'a refusal moved money'::text;
    END IF;
    -- #endregion

    IF pg_catalog.cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'PROBE FAIL: %', pg_catalog.array_to_string(v_fail, ' | ');
    END IF;
    RAISE NOTICE 'PASS place_wallet_order with a quote: converted, stamped, bound, no drift, replayed; refusals move nothing';
END $$;

ROLLBACK;
