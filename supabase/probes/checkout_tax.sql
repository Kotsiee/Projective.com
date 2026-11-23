-- =============================================================================================
-- Probe: tax at checkout, behind a switch that stays off (MARKETPLACE_BUILD_PROMPTS CK4; Decision
-- #490).
--
--   1. Switched off (as seeded): an order is placed exactly as before — no tax, total = net — and a
--      tax calculation sent with it is ignored.
--   2. Switched on, a digital product line needs a recorded calculation: none, another basket's, a
--      used one or one for a different amount is refused (PC409 price_changed) before money moves.
--   3. Switched on, with the calculation: the order and its line carry the tax, the jurisdiction and
--      the calculation; the buyer pays net + tax; the seller's credit is unchanged (tax-exclusive);
--      the calculation is consumed; money is conserved (the `tax_payable` term).
--   4. Only the service role records a calculation, a tax transaction or a reversal; the order is due
--      a transaction until one is recorded, once (finance.idempotency_keys).
--   5. A refund (finance.cancel_order_line) gives the buyer the tax back, the payable falls, the line
--      is due a reversal until one is recorded; money is conserved.
--   6. The consolidated invoice sums the stored tax lines (`v_tax` ≠ 0), one `tax` line per order.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/checkout_tax.sql
--
-- Fixtures are discovered from the seed: a published USD product sold by a person, an adult who
-- does not sell it, and a business. Conservation is checked as a change. A clean run prints only
-- `ok` notices.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ': ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.imbalance(p_currency text) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE((SELECT imbalance_minor FROM finance.v_conservation_identity WHERE currency = p_currency), 0);
$$;

CREATE FUNCTION pg_temp.payable(p_currency text) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE((SELECT tax_payable_minor FROM finance.v_conservation_identity WHERE currency = p_currency), 0);
$$;

CREATE FUNCTION pg_temp.bal(p_owner uuid, p_currency text) RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets
     WHERE owner_id = p_owner AND owner_type = finance.fn_person_wallet_type(p_owner) AND currency = p_currency;
$$;

-- A basket holding the fixture product for the buyer; its line id. The basket id is `probe.basket`.
CREATE FUNCTION pg_temp.basket() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_basket uuid;
    v_item uuid;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES (finance.fn_person_wallet_type(v_buyer), v_buyer, 'Probe CK4') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency,
                                      destination_email, metadata)
    SELECT v_basket, 'digital_product', p.id, p.title, p.price_cents, p.currency, 'probe-ck4@example.com',
           '{"deliveryTermsAccepted": true}'::jsonb
      FROM catalogue.products p WHERE p.id = pg_temp.s('product')::uuid
    RETURNING id INTO v_item;
    PERFORM pg_catalog.set_config('probe.basket', v_basket::text, true);
    RETURN v_item;
END $$;

-- Record a Stripe Tax calculation for one line, as the checkout service does (service role, here
-- postgres): `p_amount` taxed at `p_tax`.
CREATE FUNCTION pg_temp.calc(p_ref text, p_basket uuid, p_item uuid, p_amount bigint, p_tax bigint)
RETURNS uuid LANGUAGE sql AS $$
    SELECT finance.record_tax_calculation(
        p_ref, p_basket, finance.fn_person_wallet_type(pg_temp.s('buyer')::uuid), pg_temp.s('buyer')::uuid,
        'USD', 'probe-hash-' || p_ref,
        pg_catalog.jsonb_build_object(p_item::text, pg_catalog.jsonb_build_object('amount', p_amount, 'tax', p_tax)),
        p_tax, 'Probe State Sales Tax 8.25%', NULL, false, pg_catalog.now() + interval '90 days');
$$;

-- Place the basket's one line from the buyer's wallet; the order id.
CREATE FUNCTION pg_temp.place(p_item uuid, p_key text, p_expected bigint, p_calc text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('buyer')::uuid);
    v_out := finance.place_wallet_order(pg_temp.s('basket')::uuid, ARRAY[p_item], 'USD',
        pg_catalog.jsonb_build_object(p_item::text, pg_temp.s('price')::bigint), NULL, p_key, p_expected,
        NULL, p_calc);
    PERFORM pg_temp.act(NULL);
    RETURN (v_out ->> 'order_id')::uuid;
END $$;
-- #endregion

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_product record;
    v_buyer uuid;
BEGIN
    SELECT p.id, p.price_cents, p.owner_user_id INTO v_product
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.currency = 'USD' AND p.price_cents > 0 AND p.owner_team_id IS NULL
     ORDER BY p.id LIMIT 1;
    PERFORM pg_temp.ok(v_product.id IS NOT NULL, 'fixture: a published USD product sold by a person (deno task db:reset)');
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id <> v_product.owner_user_id AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    PERFORM pg_temp.ok(v_buyer IS NOT NULL, 'fixture: an adult who does not sell it');
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_buyer), v_buyer, 'USD');
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', 1000000,
        'topup', 'inbound_payments', gen_random_uuid());
    UPDATE security.feature_flags SET enabled = false WHERE key = 'finance.delivered_refund_refusal';
    PERFORM pg_catalog.set_config('probe.product', v_product.id::text, true);
    PERFORM pg_catalog.set_config('probe.price', v_product.price_cents::text, true);
    PERFORM pg_catalog.set_config('probe.seller', v_product.owner_user_id::text, true);
    PERFORM pg_catalog.set_config('probe.buyer', v_buyer::text, true);
    PERFORM pg_temp.ok(
        (SELECT value FROM security.platform_params WHERE key = 'tax_collection_enabled') = 'false'::jsonb
        AND (SELECT value FROM security.platform_params WHERE key = 'tax_collected_kinds') = '["digital_product"]'::jsonb,
        'seed: tax_collection_enabled is off; tax_collected_kinds is {digital_product}');
END $$;
-- #endregion

-- #region 1. Switched off: today's behaviour exactly
SAVEPOINT s_off;
DO $$
DECLARE
    v_item uuid := pg_temp.basket();
    v_price bigint := pg_temp.s('price')::bigint;
    v_order finance.orders;
    v_id uuid;
BEGIN
    PERFORM pg_temp.calc('taxcalc_probe_off', pg_temp.s('basket')::uuid, v_item, v_price, 99);
    -- Placed first, read after: a statement's snapshot cannot see a row its own WHERE clause wrote.
    v_id := pg_temp.place(v_item, 'probe-ck4-off-1', v_price, 'taxcalc_probe_off');
    SELECT * INTO v_order FROM finance.orders WHERE id = v_id;
    PERFORM pg_temp.ok(v_order.tax_minor = 0 AND v_order.total_minor = v_price AND v_order.tax_calculation_ref IS NULL
        AND v_order.tax_jurisdiction IS NULL,
        'off: the order carries no tax and totals the net, though a calculation was sent');
    PERFORM pg_temp.ok((SELECT pg_catalog.sum(tax_minor) FROM finance.order_lines WHERE order_id = v_order.id) = 0,
        'off: its line carries no tax');
END $$;
ROLLBACK TO SAVEPOINT s_off;
-- #endregion

-- #region 2. Switched on: no calculation, no order
SAVEPOINT s_refused;
UPDATE security.platform_params SET value = 'true'::jsonb WHERE key = 'tax_collection_enabled';
DO $$
DECLARE
    v_item uuid := pg_temp.basket();
    v_price bigint := pg_temp.s('price')::bigint;
    v_tax bigint := (pg_temp.s('price')::bigint * 825) / 10000;
    v_other uuid;
    v_before bigint := pg_temp.bal(pg_temp.s('buyer')::uuid, 'USD');
    v_got text;
BEGIN
    v_got := pg_temp.try(pg_catalog.format('SELECT pg_temp.place(%L, %L, %s, NULL)', v_item, 'probe-ck4-none-1', v_price));
    PERFORM pg_temp.ok(v_got LIKE 'PC409: price_changed%', 'on: a taxable line with no calculation is price_changed (' || v_got || ')');
    -- Another basket's calculation.
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES (finance.fn_person_wallet_type(pg_temp.s('buyer')::uuid), pg_temp.s('buyer')::uuid, 'Probe CK4 other')
    RETURNING id INTO v_other;
    PERFORM pg_temp.calc('taxcalc_probe_foreign', v_other, v_item, v_price, v_tax);
    v_got := pg_temp.try(pg_catalog.format('SELECT pg_temp.place(%L, %L, %s, %L)', v_item, 'probe-ck4-none-2',
        v_price + v_tax, 'taxcalc_probe_foreign'));
    PERFORM pg_temp.ok(v_got LIKE 'PC409: price_changed%', 'on: another basket''s calculation is refused');
    -- A calculation for a different amount than the line is paid.
    PERFORM pg_temp.calc('taxcalc_probe_wrong', pg_temp.s('basket')::uuid, v_item, v_price - 1, v_tax);
    v_got := pg_temp.try(pg_catalog.format('SELECT pg_temp.place(%L, %L, %s, %L)', v_item, 'probe-ck4-none-3',
        v_price + v_tax, 'taxcalc_probe_wrong'));
    PERFORM pg_temp.ok(v_got LIKE 'PC409: price_changed%', 'on: a calculation for another amount is refused');
    -- The right calculation, but a charge that leaves the tax out.
    PERFORM pg_temp.calc('taxcalc_probe_short', pg_temp.s('basket')::uuid, v_item, v_price, v_tax);
    v_got := pg_temp.try(pg_catalog.format('SELECT pg_temp.place(%L, %L, %s, %L)', v_item, 'probe-ck4-none-4',
        v_price, 'taxcalc_probe_short'));
    PERFORM pg_temp.ok(v_got LIKE 'PC409: price_changed%', 'on: a charge without the tax is refused');
    PERFORM pg_temp.ok(pg_temp.bal(pg_temp.s('buyer')::uuid, 'USD') = v_before, 'on: no refusal moved money');
END $$;
ROLLBACK TO SAVEPOINT s_refused;
-- #endregion

-- #region 3–5. Switched on: collected, recorded, refunded
SAVEPOINT s_on;
UPDATE security.platform_params SET value = 'true'::jsonb WHERE key = 'tax_collection_enabled';
DO $$
DECLARE
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_item uuid := pg_temp.basket();
    v_price bigint := pg_temp.s('price')::bigint;
    v_tax bigint := (pg_temp.s('price')::bigint * 825) / 10000;
    v_before bigint := pg_temp.bal(v_buyer, 'USD');
    v_gap bigint := pg_temp.imbalance('USD');
    v_payable bigint := pg_temp.payable('USD');
    v_order finance.orders;
    v_line finance.order_lines;
    v_credit bigint;
    v_got text;
    v_due jsonb;
    v_id uuid;
BEGIN
    PERFORM pg_temp.calc('taxcalc_probe_on', pg_temp.s('basket')::uuid, v_item, v_price, v_tax);
    v_id := pg_temp.place(v_item, 'probe-ck4-on-1', v_price + v_tax, 'taxcalc_probe_on');
    SELECT * INTO v_order FROM finance.orders WHERE id = v_id;
    SELECT * INTO v_line FROM finance.order_lines WHERE order_id = v_order.id;

    -- 3. Collected.
    PERFORM pg_temp.ok(v_order.tax_minor = v_tax AND v_order.total_minor = v_price + v_tax
        AND v_order.charged_minor = v_price + v_tax AND v_order.subtotal_minor = v_price,
        'on: the order carries the tax and totals net + tax');
    PERFORM pg_temp.ok(v_order.tax_calculation_ref = 'taxcalc_probe_on'
        AND v_order.tax_jurisdiction = 'Probe State Sales Tax 8.25%' AND v_order.tax_transaction_ref IS NULL,
        'on: the order names its calculation and jurisdiction; no transaction yet');
    PERFORM pg_temp.ok(v_line.tax_minor = v_tax AND v_line.line_total_minor = v_price,
        'on: the line carries its tax beside its unchanged price');
    PERFORM pg_temp.ok(pg_temp.bal(v_buyer, 'USD') = v_before - v_price - v_tax, 'on: the buyer paid net + tax');
    SELECT amount_cents INTO v_credit FROM finance.pending_releases
     WHERE order_id = v_order.id AND reason = 'product_sale';
    PERFORM pg_temp.ok(v_credit = v_line.line_total_minor - v_line.platform_fee_minor,
        'on: the seller is credited the price less their commission, never the tax');
    PERFORM pg_temp.ok((SELECT order_id FROM finance.tax_calculations WHERE calculation_ref = 'taxcalc_probe_on') = v_order.id,
        'on: the calculation is consumed by the order');
    PERFORM pg_temp.ok(pg_temp.payable('USD') - v_payable = v_tax, 'on: tax_payable rose by the tax');
    PERFORM pg_temp.ok(pg_temp.imbalance('USD') = v_gap, 'on: money is conserved');
    v_got := pg_temp.try(pg_catalog.format('SELECT pg_temp.place(%L, %L, %s, %L)', pg_temp.basket(), 'probe-ck4-on-2',
        v_price + v_tax, 'taxcalc_probe_on'));
    PERFORM pg_temp.ok(v_got LIKE 'PC409: price_changed%', 'on: a used calculation is never spent twice');

    -- 4. Recorded at Stripe, once, by the service role only.
    PERFORM pg_temp.ok(
        NOT pg_catalog.has_function_privilege('authenticated', 'finance.record_tax_transaction(uuid, text, jsonb)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated',
            'finance.record_tax_calculation(text, uuid, text, uuid, text, text, jsonb, bigint, text, text, boolean, timestamptz)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'finance.record_tax_reversal(uuid, text)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('authenticated', 'finance.tax_records_due(integer)', 'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('anon', 'finance.tax_calculation_for(uuid, text)', 'EXECUTE')
        AND NOT pg_catalog.has_table_privilege('authenticated', 'finance.tax_calculations', 'SELECT')
        AND pg_catalog.has_function_privilege('service_role', 'finance.record_tax_transaction(uuid, text, jsonb)', 'EXECUTE'),
        'only the service role records a calculation, a transaction or a reversal, or reads what is due');
    SELECT pg_catalog.jsonb_agg(d) INTO v_due FROM finance.tax_records_due(500) d WHERE d.order_id = v_order.id;
    PERFORM pg_temp.ok(v_due -> 0 ->> 'kind' = 'transaction' AND v_due -> 0 ->> 'calculation_ref' = 'taxcalc_probe_on'
        AND v_due -> 0 ->> 'reference' = v_order.reference,
        'the order is due its tax transaction, referenced by the order');
    PERFORM finance.record_tax_transaction(v_order.id, 'tax_probe_1',
        pg_catalog.jsonb_build_object(v_item::text, 'tax_li_probe_1'));
    PERFORM pg_temp.ok((SELECT tax_transaction_ref FROM finance.orders WHERE id = v_order.id) = 'tax_probe_1'
        AND (SELECT tax_line_ref FROM finance.order_lines WHERE id = v_line.id) = 'tax_li_probe_1'
        AND (SELECT status FROM finance.idempotency_keys WHERE key = 'tax_transaction:' || v_order.id) = 'succeeded',
        'the transaction is recorded on the order and its line, its key claimed');
    PERFORM finance.record_tax_transaction(v_order.id, 'tax_probe_1', pg_catalog.jsonb_build_object(v_item::text, 'tax_li_probe_1'));
    v_got := pg_temp.try(pg_catalog.format('SELECT finance.record_tax_transaction(%L, %L, %L)', v_order.id, 'tax_probe_2', '{}'));
    PERFORM pg_temp.ok(v_got LIKE 'PX409%', 'the same transaction replays; a second one is refused (' || v_got || ')');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.tax_records_due(500) d WHERE d.order_id = v_order.id),
        'nothing is due once it is recorded');

    -- 5. Refunded: the tax goes back with the price.
    v_before := pg_temp.bal(v_buyer, 'USD');
    PERFORM pg_temp.act(v_buyer);
    PERFORM finance.cancel_order_line(v_line.id);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.ok(pg_temp.bal(v_buyer, 'USD') = v_before + v_price + v_tax, 'refund: the buyer gets the price and the tax back');
    PERFORM pg_temp.ok(pg_temp.payable('USD') = v_payable, 'refund: tax_payable falls back');
    PERFORM pg_temp.ok(pg_temp.imbalance('USD') = v_gap, 'refund: money is conserved');
    SELECT pg_catalog.to_jsonb(d) INTO v_due FROM finance.tax_records_due(500) d WHERE d.line_id = v_line.id;
    PERFORM pg_temp.ok(v_due ->> 'kind' = 'reversal' AND v_due ->> 'transaction_ref' = 'tax_probe_1'
        AND v_due ->> 'line_ref' = 'tax_li_probe_1' AND (v_due ->> 'amount_minor')::bigint = v_price
        AND (v_due ->> 'tax_minor')::bigint = v_tax,
        'refund: the line is due its reversal, for its price and its tax');
    PERFORM finance.record_tax_reversal(v_line.id, 'tax_probe_rev_1');
    PERFORM pg_temp.ok((SELECT tax_reversal_ref FROM finance.order_lines WHERE id = v_line.id) = 'tax_probe_rev_1'
        AND NOT EXISTS (SELECT 1 FROM finance.tax_records_due(500) d WHERE d.line_id = v_line.id),
        'refund: the reversal is recorded, and nothing more is due');
END $$;
ROLLBACK TO SAVEPOINT s_on;
-- #endregion

-- #region 6. The consolidated invoice sums the stored tax
SAVEPOINT s_invoice;
DO $$
DECLARE
    v_business uuid;
    v_order uuid := gen_random_uuid();
    v_ids uuid[];
    v_invoice finance.invoices;
BEGIN
    SELECT b.id INTO v_business FROM org.business_profiles b ORDER BY b.id LIMIT 1;
    PERFORM pg_temp.ok(v_business IS NOT NULL, 'fixture: a business');
    INSERT INTO finance.orders (id, reference, status, owner_type, owner_id, currency, subtotal_minor,
        platform_fee_bp, tax_minor, total_minor, charged_minor, idempotency_key, placed_at, tax_jurisdiction,
        tax_calculation_ref)
    VALUES (v_order, 'PJ-PROBE-CK4', 'confirmed', 'business', v_business, 'GBP', 1000, 500, 200, 1200, 1200,
        'probe-ck4-invoice', '2031-01-10', 'United Kingdom VAT 20%', 'taxcalc_probe_inv');
    v_ids := finance.fn_generate_consolidated_invoice(v_business, '2031-01-01', '2031-02-01');
    SELECT * INTO v_invoice FROM finance.invoices WHERE id = ANY (v_ids) AND currency = 'GBP';
    PERFORM pg_temp.ok(v_invoice.tax_cents = 200 AND v_invoice.total_cents = v_invoice.subtotal_cents + 200,
        'invoice: v_tax is the period''s stored tax, and the total includes it');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM finance.invoice_line_items li
        WHERE li.invoice_id = v_invoice.id AND li.ref_type = 'tax' AND li.ref_id = v_order AND li.amount_cents = 200),
        'invoice: one tax line for the order');
END $$;
ROLLBACK TO SAVEPOINT s_invoice;
-- #endregion

ROLLBACK;
