-- =============================================================================================
-- Probe: checkout charges exactly the total the buyer saw (FINANCE_BUILD_PROMPTS DB7; audit CO4, CO6,
-- CO10, CO11, CO13, CO18).
--
--   1. finance.place_wallet_order with p_expected_minor 1p under / over the re-priced net refuses PC409
--      `price_changed:` and moves nothing; the exact net places the order.
--   2. A promo is recorded on the order (`orders.promo_code`) and redeemed once; a code at its
--      max_redemptions refuses PC409 `promo_exhausted:` (the concurrent race is
--      promo_redemption_concurrency.sql).
--   3. A product owned by a team the buyer is an active member of is the buyer's own listing: PU422.
--   4. A second card checkout for lines another live top-up already pays for is refused by
--      finance.attach_checkout_order: PC409 `payment_in_progress:`, DETAIL naming the live payment.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/checkout_charge_assert.sql
--
-- Fixture (seeded): the first KYB-verified business with a funded wallet, its owner as the buyer, and a
-- published single-owner product in the wallet's currency, repriced to 1,000 inside the transaction. A
-- clean run prints only PASS notices; any failure ends the run in an error listing every failed case.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

-- A fresh basket for the owner holding one line of the product; the line id.
CREATE FUNCTION pg_temp.line(p_owner_type text, p_owner uuid, p_product uuid, p_currency text, p_promo text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_basket uuid;
    v_line uuid;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name, promo_code)
    VALUES (p_owner_type, p_owner, 'Probe DB7', p_promo) RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, destination_email)
    VALUES (v_basket, 'digital_product', p_product, 'Probe product', 1000, p_currency, 'probe@example.com')
    RETURNING id INTO v_line;
    RETURN v_line;
END $$;

CREATE FUNCTION pg_temp.basket_of(p_line uuid) RETURNS uuid LANGUAGE sql AS $$
    SELECT basket_id FROM finance.basket_items WHERE id = p_line;
$$;
-- #endregion

DO $$
DECLARE
    v_biz uuid;
    v_buyer uuid;
    v_currency text;
    v_product uuid;
    v_wallet uuid;
    v_line uuid;
    v_b0 bigint;
    v_out jsonb;
    v_member uuid;
    v_team uuid;
    v_pay1 jsonb;
    v_pay2 jsonb;
    v_expected int;
    v_state text;
    v_msg text;
    v_detail text;
    v_fail text[] := '{}';
    v_case text;
BEGIN
    -- #region Fixture (as postgres)
    SELECT b.id, b.owner_user_id, w.currency, w.id INTO v_biz, v_buyer, v_currency, v_wallet
      FROM org.business_profiles b
      JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id AND w.balance_cents >= 10000
     WHERE b.kyb_status = 'verified' AND b.owner_user_id IS NOT NULL
     ORDER BY b.id LIMIT 1;
    IF v_biz IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no verified business with a funded wallet — run deno task db:reset'; END IF;
    SELECT p.id INTO v_product
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NULL AND p.owner_user_id <> v_buyer AND upper(p.currency) = v_currency
     ORDER BY p.id LIMIT 1;
    IF v_product IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published single-owner product in %', v_currency; END IF;
    UPDATE catalogue.products SET price_cents = 1000 WHERE id = v_product;
    UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = v_wallet;
    UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'vault_approval_threshold_cents';
    INSERT INTO finance.promo_codes (code, label, kind, value_bp, max_redemptions)
    VALUES ('PROBEDB7', 'Probe 10% off', 'percent', 1000, 1);
    RAISE NOTICE 'fixture business=% buyer=% product=% %', v_biz, v_buyer, v_product, v_currency;
    -- #endregion

    PERFORM pg_temp.act(v_buyer);

    -- #region 1. The expected total must be the net
    FOREACH v_expected IN ARRAY ARRAY[999, 1001] LOOP
        v_case := format('1 expected %s against a net of 1000', v_expected);
        v_line := pg_temp.line('business', v_biz, v_product, v_currency, NULL);
        v_b0 := (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet);
        BEGIN
            PERFORM finance.place_wallet_order(pg_temp.basket_of(v_line), ARRAY[v_line], v_currency,
                jsonb_build_object(v_line::text, 1000), NULL, 'probe-db7-1-' || v_expected, v_expected);
            v_fail := v_fail || format('%s: accepted', v_case);
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE = 'PC409' AND SQLERRM LIKE 'price_changed:%' THEN
                RAISE NOTICE 'PASS %: % %', v_case, SQLSTATE, SQLERRM;
            ELSE
                v_fail := v_fail || format('%s: refused %s %s (expected PC409 price_changed)', v_case, SQLSTATE, SQLERRM);
            END IF;
        END;
        IF (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet) <> v_b0 THEN
            v_fail := v_fail || format('%s: the wallet moved', v_case);
        END IF;
    END LOOP;

    v_case := '1 the exact net pays';
    v_line := pg_temp.line('business', v_biz, v_product, v_currency, NULL);
    BEGIN
        v_out := finance.place_wallet_order(pg_temp.basket_of(v_line), ARRAY[v_line], v_currency,
            jsonb_build_object(v_line::text, 1000), NULL, 'probe-db7-1-exact', 1000);
        IF (v_out ->> 'charged_minor')::bigint = 1000 THEN
            RAISE NOTICE 'PASS %: order % charged 1000', v_case, v_out ->> 'reference';
        ELSE
            v_fail := v_fail || format('%s: answered %s', v_case, v_out);
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    -- #endregion

    -- #region 2. A promo is recorded and redeemed once; the capped code then refuses
    v_case := '2 promo recorded on the order';
    v_line := pg_temp.line('business', v_biz, v_product, v_currency, 'PROBEDB7');
    BEGIN
        v_out := finance.place_wallet_order(pg_temp.basket_of(v_line), ARRAY[v_line], v_currency,
            jsonb_build_object(v_line::text, 1000), 'probedb7', 'probe-db7-2a', 900);
        IF (SELECT promo_code FROM finance.orders WHERE id = (v_out ->> 'order_id')::uuid) = 'PROBEDB7'
           AND (SELECT promo_discount_minor FROM finance.orders WHERE id = (v_out ->> 'order_id')::uuid) = 100
           AND (SELECT redemption_count FROM finance.promo_codes WHERE code = 'PROBEDB7') = 1 THEN
            RAISE NOTICE 'PASS %: PROBEDB7, 100 off, redeemed once', v_case;
        ELSE
            v_fail := v_fail || format('%s: promo_code %s, redemptions %s', v_case,
                (SELECT promo_code FROM finance.orders WHERE id = (v_out ->> 'order_id')::uuid),
                (SELECT redemption_count FROM finance.promo_codes WHERE code = 'PROBEDB7'));
        END IF;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;

    v_case := '2 an exhausted code refuses';
    v_line := pg_temp.line('business', v_biz, v_product, v_currency, 'PROBEDB7');
    BEGIN
        PERFORM finance.place_wallet_order(pg_temp.basket_of(v_line), ARRAY[v_line], v_currency,
            jsonb_build_object(v_line::text, 1000), 'PROBEDB7', 'probe-db7-2b', 900);
        v_fail := v_fail || format('%s: accepted past max_redemptions', v_case);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'PC409' AND SQLERRM LIKE 'promo_exhausted:%' THEN
            RAISE NOTICE 'PASS %: % %', v_case, SQLSTATE, SQLERRM;
        ELSE
            v_fail := v_fail || format('%s: refused %s %s (expected PC409 promo_exhausted)', v_case, SQLSTATE, SQLERRM);
        END IF;
    END;
    IF (SELECT redemption_count FROM finance.promo_codes WHERE code = 'PROBEDB7') <> 1 THEN
        v_fail := v_fail || format('%s: redemption_count moved past the cap', v_case);
    END IF;
    -- #endregion

    -- #region 3. A team member cannot buy the team's own listing
    v_case := '3 team-owned listing is your own';
    PERFORM pg_temp.act(NULL);
    SELECT tm.user_id, tm.team_id INTO v_member, v_team
      FROM org.team_members tm WHERE tm.status = 'active' ORDER BY tm.team_id, tm.user_id LIMIT 1;
    IF v_member IS NULL THEN
        v_fail := v_fail || format('%s: no active team member seeded', v_case);
    ELSE
        UPDATE catalogue.products SET owner_team_id = v_team WHERE id = v_product;
        v_line := pg_temp.line('user', v_member, v_product, v_currency, NULL);
        PERFORM pg_temp.act(v_member);
        BEGIN
            PERFORM finance.place_wallet_order(pg_temp.basket_of(v_line), ARRAY[v_line], v_currency,
                jsonb_build_object(v_line::text, 1000), NULL, 'probe-db7-3', 1000);
            v_fail := v_fail || format('%s: accepted', v_case);
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE = 'PU422' THEN
                RAISE NOTICE 'PASS %: % %', v_case, SQLSTATE, SQLERRM;
            ELSE
                v_fail := v_fail || format('%s: refused %s %s (expected PU422)', v_case, SQLSTATE, SQLERRM);
            END IF;
        END;
        PERFORM pg_temp.act(NULL);
        UPDATE catalogue.products SET owner_team_id = NULL WHERE id = v_product;
    END IF;
    -- #endregion

    -- #region 4. A second tab is refused while a payment for the same lines is live
    v_case := '4 second tab refused';
    PERFORM pg_temp.act(v_buyer);
    v_line := pg_temp.line('business', v_biz, v_product, v_currency, NULL);
    BEGIN
        v_pay1 := finance.begin_card_payment('wallet_topup', v_wallet, NULL, NULL, 1000, v_currency, 'probe-db7-4-tab1');
        v_pay2 := finance.begin_card_payment('wallet_topup', v_wallet, NULL, NULL, 1000, v_currency, 'probe-db7-4-tab2');
        PERFORM finance.attach_checkout_order((v_pay1 ->> 'id')::uuid, jsonb_build_object(
            'basket_id', pg_temp.basket_of(v_line), 'item_ids', jsonb_build_array(v_line), 'currency', v_currency,
            'units', jsonb_build_object(v_line::text, 1000), 'order_key', 'probe-db7-4-order1'));
        BEGIN
            PERFORM finance.attach_checkout_order((v_pay2 ->> 'id')::uuid, jsonb_build_object(
                'basket_id', pg_temp.basket_of(v_line), 'item_ids', jsonb_build_array(v_line), 'currency', v_currency,
                'units', jsonb_build_object(v_line::text, 1000), 'order_key', 'probe-db7-4-order2'));
            v_fail := v_fail || format('%s: the second tab attached', v_case);
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
            IF v_state = 'PC409' AND v_msg LIKE 'payment_in_progress:%'
               AND (v_detail::jsonb ->> 'payment_id') = v_pay1 ->> 'id' THEN
                RAISE NOTICE 'PASS %: % names payment %', v_case, v_state, v_pay1 ->> 'id';
            ELSE
                v_fail := v_fail || format('%s: refused %s %s / %s', v_case, v_state, v_msg, v_detail);
            END IF;
        END;
    EXCEPTION WHEN OTHERS THEN v_fail := v_fail || format('%s: setup refused %s %s', v_case, SQLSTATE, SQLERRM);
    END;
    -- #endregion

    PERFORM pg_temp.act(NULL);
    IF cardinality(v_fail) > 0 THEN
        RAISE EXCEPTION 'FAIL %', array_to_string(v_fail, E'\n     ');
    END IF;
END $$;

ROLLBACK;
