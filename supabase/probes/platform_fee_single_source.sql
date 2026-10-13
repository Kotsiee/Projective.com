-- =============================================================================================
-- Probe: one platform fee rate, one rounding rule (Decision #187).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/platform_fee_single_source.sql
--
-- A KYB-verified business is given an active negotiated rate of 300 bp. Then:
--   1. finance.place_wallet_order charges each seller the PAYER's effective rate, truncated: a 1,050
--      line at 300 bp is a fee of 31 (31.5 truncated), never 500 bp and never half-up (53 / 32).
--   2. finance.get_purchase_owner hands that rate to a member of the payer, and to nobody else.
--   3. finance.preview_team_split projects a team release with the escrow payer's effective rate,
--      exactly as finance.fn_release_ticket_escrow would charge it.
-- A clean run prints only PASS.
-- =============================================================================================

BEGIN;

CREATE TEMP TABLE probe_ctx (
    business uuid,
    buyer uuid,
    outsider uuid,
    currency text,
    product uuid,
    seller uuid
) ON COMMIT DROP;

-- #region 1. place_wallet_order
DO $$
DECLARE
    v_business uuid;
    v_buyer uuid;
    v_currency text;
    v_product uuid;
    v_seller uuid;
    v_outsider uuid;
    v_basket uuid;
    v_line uuid;
    v_order jsonb;
    v_fee bigint;
    v_fee_bp integer;
    v_credit bigint;
BEGIN
    SELECT b.id, b.owner_user_id, w.currency
      INTO v_business, v_buyer, v_currency
      FROM org.business_profiles b
      JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id AND w.balance_cents >= 10000
     WHERE b.kyb_status = 'verified' AND b.owner_user_id IS NOT NULL
     ORDER BY b.id
     LIMIT 1;
    IF v_business IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no verified business with a funded wallet'; END IF;

    SELECT p.id, p.owner_user_id INTO v_product, v_seller
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NULL AND p.owner_user_id <> v_buyer AND upper(p.currency) = v_currency
     ORDER BY p.id
     LIMIT 1;
    IF v_product IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published single-owner product in %', v_currency; END IF;

    v_outsider := CASE WHEN NOT EXISTS (
        SELECT 1 FROM org.business_members m WHERE m.business_id = v_business AND m.user_id = v_seller
    ) THEN v_seller END;

    INSERT INTO probe_ctx VALUES (v_business, v_buyer, v_outsider, v_currency, v_product, v_seller);

    UPDATE catalogue.products SET price_cents = 1050 WHERE id = v_product;
    INSERT INTO finance.negotiated_rates (subject_type, subject_id, platform_fee_bp, contract_ref, starts_at)
    VALUES ('business', v_business, 300, 'PROBE-187', now() - interval '1 day');

    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('business', v_business, 'Probe 187')
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, destination_email)
    VALUES (v_basket, 'digital_product', v_product, 'Probe product', 1050, v_currency, 'probe@example.com')
    RETURNING id INTO v_line;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role', 'authenticated')::text, true);
    v_order := finance.place_wallet_order(v_basket, ARRAY[v_line], v_currency,
        jsonb_build_object(v_line::text, 1050), NULL, 'probe-187-' || gen_random_uuid());
    PERFORM set_config('request.jwt.claims', NULL, true);

    SELECT o.platform_fee_minor, o.platform_fee_bp INTO v_fee, v_fee_bp
      FROM finance.orders o WHERE o.id = (v_order ->> 'order_id')::uuid;
    -- A product sale is an earned credit: it waits out the pending window in finance.pending_releases
    -- (Decision #191) and reaches finance.transactions only at maturity, so read both, once each.
    SELECT (SELECT COALESCE(SUM(pr.amount_cents), 0) FROM finance.pending_releases pr
             WHERE pr.order_id = (v_order ->> 'order_id')::uuid AND pr.reason = 'product_sale')
         + (SELECT COALESCE(SUM(t.amount_cents), 0) FROM finance.transactions t
             WHERE t.ref_table = 'orders' AND t.ref_id = (v_order ->> 'order_id')::uuid
               AND t.reason = 'product_sale' AND t.direction = 'credit'
               AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.transaction_id = t.id))
      INTO v_credit;

    IF v_fee_bp = 300 THEN
        RAISE NOTICE 'PASS place_wallet_order records the payer''s negotiated rate (300 bp)';
    ELSE
        RAISE NOTICE 'FAIL place_wallet_order recorded % bp, expected the negotiated 300', v_fee_bp;
    END IF;
    IF v_fee = 31 THEN
        RAISE NOTICE 'PASS place_wallet_order fee on 1050 at 300 bp is 31 (truncated)';
    ELSE
        RAISE NOTICE 'FAIL place_wallet_order fee on 1050 is %, expected 31 (300 bp, truncated)', v_fee;
    END IF;
    IF v_credit = 1050 - 31 THEN
        RAISE NOTICE 'PASS the seller is credited 1019';
    ELSE
        RAISE NOTICE 'FAIL the seller is credited %, expected 1019', v_credit;
    END IF;
END;
$$;
-- #endregion

-- #region 2. get_purchase_owner
DO $$
DECLARE
    c probe_ctx;
    v_out jsonb;
BEGIN
    SELECT * INTO c FROM probe_ctx;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', c.buyer, 'role', 'authenticated')::text, true);
    v_out := finance.get_purchase_owner('business', c.business);
    IF (v_out ->> 'platform_fee_bp')::integer IS NOT DISTINCT FROM 300 THEN
        RAISE NOTICE 'PASS get_purchase_owner hands a member the effective rate (300)';
    ELSE
        RAISE NOTICE 'FAIL get_purchase_owner gave a member platform_fee_bp=%, expected 300', v_out ->> 'platform_fee_bp';
    END IF;

    v_out := finance.get_purchase_owner('user', c.buyer);
    IF (v_out ->> 'platform_fee_bp')::integer IS NOT DISTINCT FROM
       (SELECT (value #>> '{}')::integer FROM security.platform_params WHERE key = 'platform_fee_bp') THEN
        RAISE NOTICE 'PASS a personal owner gets the platform param';
    ELSE
        RAISE NOTICE 'FAIL a personal owner got platform_fee_bp=%', v_out ->> 'platform_fee_bp';
    END IF;

    IF c.outsider IS NOT NULL THEN
        PERFORM set_config('request.jwt.claims', json_build_object('sub', c.outsider, 'role', 'authenticated')::text, true);
        v_out := finance.get_purchase_owner('business', c.business);
        IF v_out IS NOT NULL AND v_out ->> 'platform_fee_bp' IS NULL THEN
            RAISE NOTICE 'PASS a non-member sees the public face without the negotiated rate';
        ELSE
            RAISE NOTICE 'FAIL a non-member saw platform_fee_bp=% (owner %)', v_out ->> 'platform_fee_bp', v_out IS NOT NULL;
        END IF;
    END IF;
    PERFORM set_config('request.jwt.claims', NULL, true);
END;
$$;
-- #endregion

-- #region 3. preview_team_split
DO $$
DECLARE
    v_team uuid;
    v_payer uuid;
    v_member uuid;
    v_amount bigint;
    v_out jsonb;
    v_rate integer;
BEGIN
    SELECT DISTINCT ON (e.payee_id) e.payee_id, e.payer_business_id, e.amount_cents
      INTO v_team, v_payer, v_amount
      FROM finance.escrows e
     WHERE e.payee_type = 'team' AND e.status = 'held'
     ORDER BY e.payee_id, e.created_at, e.id;
    IF v_team IS NULL OR v_payer IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: no team whose oldest held escrow has a business payer';
    END IF;
    SELECT m.user_id INTO v_member FROM org.team_members m WHERE m.team_id = v_team ORDER BY m.user_id LIMIT 1;

    IF NOT EXISTS (SELECT 1 FROM finance.negotiated_rates n WHERE n.subject_id = v_payer AND n.contract_ref = 'PROBE-187') THEN
        INSERT INTO finance.negotiated_rates (subject_type, subject_id, platform_fee_bp, contract_ref, starts_at)
        VALUES ('business', v_payer, 300, 'PROBE-187', now() - interval '1 day');
    END IF;
    v_rate := finance.fn_escrow_fee_bp(v_payer, NULL);

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    v_out := finance.preview_team_split(v_team);
    PERFORM set_config('request.jwt.claims', NULL, true);

    IF (v_out ->> 'fee_minor')::bigint = (v_amount * v_rate) / 10000 AND v_rate = 300 THEN
        RAISE NOTICE 'PASS preview_team_split fee % = % at the payer''s 300 bp', v_out ->> 'fee_minor', v_amount;
    ELSE
        RAISE NOTICE 'FAIL preview_team_split fee % on %, the release would charge % (% bp)',
            v_out ->> 'fee_minor', v_amount, (v_amount * v_rate) / 10000, v_rate;
    END IF;
    IF (v_out ->> 'fee_bp')::integer IS NOT DISTINCT FROM v_rate THEN
        RAISE NOTICE 'PASS preview_team_split reports fee_bp %', v_rate;
    ELSE
        RAISE NOTICE 'FAIL preview_team_split reports fee_bp %, expected %', v_out ->> 'fee_bp', v_rate;
    END IF;
END;
$$;
-- #endregion

ROLLBACK;
