-- =============================================================================================
-- Probe: refunds a buyer or provider can start (FINANCE_BUILD_PROMPTS DB21; Decision #337, ruling M8;
-- Decision #470).
--
--   1. finance.cancel_order_line before any download: the buyer gets back what they paid at once
--      (`order_refund`, into the wallet that paid), the seller's still-clearing row closes taken back
--      in full, the fee stops counting, the entitlement reads `refunded`, the line and its one-line
--      order read `cancelled`, and money is conserved.
--   2. Only a member of the buying account may cancel, and only once.
--   3. A delivered line: refused while finance.delivered_refund_refusal is on (set here, rolled
--      back); with it off the cancel runs and the line reads `refunded`.
--   4. Once the seller's money has cleared there is no cancel.
--   5. A line whose promo share the platform funded: the seller's full credit comes back and the
--      platform's promo loss stops counting; money is conserved.
--   6. finance.refund_session_forfeit: a seat the attendee cancelled inside the notice, given back
--      by its provider: from the release still clearing first, the attendee refunded in full, the
--      escrow `refunded`, money conserved; only the payee, and only once.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/product_refunds.sql
--
-- Fixtures are discovered from the seed: a published USD product sold by a person, two adults who do
-- not sell it, and a person-owned project stage for the seat. Purchases go through
-- finance.place_wallet_order, so the credit taken back is the one checkout wrote. Conservation is
-- checked as a change, so a seed that does not conserve does not hide a door that does. A clean run
-- prints only `ok` notices.
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

-- The SQLSTATE and message a statement raises, or 'ok'.
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

CREATE FUNCTION pg_temp.bal(p_owner uuid, p_currency text) RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets
     WHERE owner_id = p_owner AND owner_type = finance.fn_person_wallet_type(p_owner) AND currency = p_currency;
$$;

-- Buy the fixture product from a person's own wallet, as checkout does; the order line id.
CREATE FUNCTION pg_temp.buy(p_buyer uuid, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_product uuid := pg_temp.s('product')::uuid;
    v_price bigint := (SELECT price_cents FROM catalogue.products WHERE id = v_product);
    v_basket uuid;
    v_item uuid;
    v_out jsonb;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES (finance.fn_person_wallet_type(p_buyer), p_buyer, 'Probe DB21') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency,
                                      destination_email, metadata)
    SELECT v_basket, 'digital_product', p.id, p.title, p.price_cents, p.currency, 'probe-db21@example.com',
           '{"deliveryTermsAccepted": true}'::jsonb
      FROM catalogue.products p WHERE p.id = v_product
    RETURNING id INTO v_item;
    PERFORM pg_temp.act(p_buyer);
    v_out := finance.place_wallet_order(v_basket, ARRAY[v_item], 'USD', pg_catalog.jsonb_build_object(v_item::text, v_price),
        NULL, p_key, v_price);
    RETURN (SELECT ol.id FROM finance.order_lines ol
             WHERE ol.order_id = (v_out ->> 'order_id')::uuid AND ol.item_type = 'digital_product');
END $$;
-- #endregion

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_product record;
    v_buyer uuid;
    v_other uuid;
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
    SELECT u.user_id INTO v_other FROM org.users_public u
     WHERE u.user_id NOT IN (v_product.owner_user_id, v_buyer) AND NOT org.fn_is_minor(u.user_id)
     ORDER BY u.user_id DESC LIMIT 1;
    PERFORM pg_temp.ok(v_buyer IS NOT NULL AND v_other IS NOT NULL, 'fixture: two adults who do not sell it');
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_buyer), v_buyer, 'USD');
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', 1000000,
        'topup', 'inbound_payments', gen_random_uuid());
    UPDATE security.feature_flags SET enabled = false WHERE key = 'finance.delivered_refund_refusal';
    PERFORM pg_catalog.set_config('probe.product', v_product.id::text, true);
    PERFORM pg_catalog.set_config('probe.seller', v_product.owner_user_id::text, true);
    PERFORM pg_catalog.set_config('probe.buyer', v_buyer::text, true);
    PERFORM pg_catalog.set_config('probe.other', v_other::text, true);
END $$;
-- #endregion

-- #region 1. A cancel before any download
SAVEPOINT s_cancel;
DO $$
DECLARE
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_line finance.order_lines;
    v_id uuid;
    v_row finance.pending_releases;
    v_before bigint;
    v_gap bigint;
    v_out jsonb;
BEGIN
    v_id := pg_temp.buy(v_buyer, 'probe-db21-1');
    SELECT * INTO v_line FROM finance.order_lines WHERE id = v_id;
    SELECT * INTO v_row FROM finance.pending_releases WHERE order_id = v_line.order_id AND reason = 'product_sale';
    PERFORM pg_temp.ok(v_row.state = 'pending' AND v_line.platform_fee_minor > 0,
        'fixture: the sale credited the seller pending and took a fee');
    v_before := pg_temp.bal(v_buyer, 'USD');
    v_gap := pg_temp.imbalance('USD');

    PERFORM pg_temp.act(v_buyer);
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM finance.cancellable_order_lines(ARRAY[v_line.id])),
        'offer: the buyer is offered Cancel while the sale clears');
    PERFORM pg_temp.act(pg_temp.s('other')::uuid);
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.cancellable_order_lines(ARRAY[v_line.id])),
        'offer: nobody outside the buying account is');
    PERFORM pg_temp.act(v_buyer);
    v_out := finance.cancel_order_line(v_line.id);
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.cancellable_order_lines(ARRAY[v_line.id])),
        'offer: a cancelled line is offered nothing');
    PERFORM pg_temp.ok(pg_temp.bal(v_buyer, 'USD') = v_before + v_line.line_total_minor - v_line.promo_discount_minor
        AND EXISTS (SELECT 1 FROM finance.transactions t WHERE t.reason = 'order_refund' AND t.ref_id = v_line.id),
        'cancel: the buyer gets back what they paid at once, as order_refund');
    PERFORM pg_temp.ok((SELECT state = 'available' AND recovered_cents = amount_cents AND transaction_id IS NULL
                          FROM finance.pending_releases WHERE id = v_row.id),
        'cancel: the seller''s still-clearing row closes, taken back in full, with no credit');
    PERFORM pg_temp.ok((SELECT status FROM catalogue.entitlements WHERE order_line_id = v_line.id) = 'refunded',
        'cancel: the entitlement reads refunded, so nothing downloads');
    PERFORM pg_temp.ok((SELECT status FROM finance.order_lines WHERE id = v_line.id) = 'cancelled'
        AND (SELECT status FROM finance.orders WHERE id = v_line.order_id) = 'cancelled' AND v_out ->> 'status' = 'cancelled',
        'cancel: the undelivered line and its one-line order read cancelled');
    PERFORM pg_temp.ok(pg_temp.imbalance('USD') = v_gap, 'cancel: the fee stops counting and money is conserved');
    PERFORM pg_catalog.set_config('probe.line1', v_line.id::text, true);
END $$;

-- 2. Only a member of the buying account, and only once.
DO $$
DECLARE
    v_line uuid := pg_temp.s('line1')::uuid;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('buyer')::uuid);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT finance.cancel_order_line(%L)', v_line)) LIKE 'PO409%',
        'cancel: a second cancel of the same line refuses (PO409)');
    PERFORM pg_temp.act(pg_temp.s('other')::uuid);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT finance.cancel_order_line(%L)', v_line)) LIKE 'P0002%',
        'cancel: someone outside the buying account sees no such purchase (P0002)');
END $$;
ROLLBACK TO SAVEPOINT s_cancel;
RELEASE SAVEPOINT s_cancel;
-- #endregion

-- #region 3. A delivered line, with the refusal on and off
SAVEPOINT s_delivered;
DO $$
DECLARE
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_line uuid := pg_temp.buy(v_buyer, 'probe-db21-3');
BEGIN
    UPDATE catalogue.entitlements SET first_delivered_at = pg_catalog.now(), delivery_terms_accepted_at = pg_catalog.now()
     WHERE order_line_id = v_line;
    UPDATE security.feature_flags SET enabled = true WHERE key = 'finance.delivered_refund_refusal';
    PERFORM pg_temp.act(v_buyer);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT finance.cancel_order_line(%L)', v_line)) LIKE 'PO409%downloaded%',
        'delivered: refused while finance.delivered_refund_refusal is on');
    UPDATE security.feature_flags SET enabled = false WHERE key = 'finance.delivered_refund_refusal';
    PERFORM pg_temp.act(v_buyer);
    PERFORM finance.cancel_order_line(v_line);
    PERFORM pg_temp.ok((SELECT status FROM finance.order_lines WHERE id = v_line) = 'refunded',
        'delivered: with the refusal off it refunds, and the line reads refunded');
END $$;
ROLLBACK TO SAVEPOINT s_delivered;
RELEASE SAVEPOINT s_delivered;
-- #endregion

-- #region 4. Once the sale has cleared
SAVEPOINT s_cleared;
DO $$
DECLARE
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_line uuid := pg_temp.buy(v_buyer, 'probe-db21-4');
BEGIN
    UPDATE finance.pending_releases
       SET released_at = pg_catalog.now() - interval '8 days', available_at = pg_catalog.now() - interval '1 minute'
     WHERE order_id = (SELECT order_id FROM finance.order_lines WHERE id = v_line);
    PERFORM finance.fn_mature_pending_releases(1000);
    PERFORM pg_temp.act(v_buyer);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT finance.cancel_order_line(%L)', v_line)) LIKE 'PO409%no longer clearing%',
        'cleared: once the seller''s money has cleared there is no cancel');
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.cancellable_order_lines(ARRAY[v_line])),
        'cleared: and none is offered');
END $$;
ROLLBACK TO SAVEPOINT s_cleared;
RELEASE SAVEPOINT s_cleared;
-- #endregion

-- #region 5. A promo share the platform funded
SAVEPOINT s_promo;
DO $$
DECLARE
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_line finance.order_lines;
    v_id uuid;
    v_gap bigint;
BEGIN
    v_id := pg_temp.buy(v_buyer, 'probe-db21-5');
    SELECT * INTO v_line FROM finance.order_lines WHERE id = v_id;
    -- Re-stamp the line as a platform-funded share would leave it: the seller paid on the full line,
    -- the buyer the share less, the platform's loss the share. Conservation is read as the change
    -- across the cancel, so the purchase's own figures need not be rewritten.
    UPDATE finance.order_lines SET promo_discount_minor = 100, promo_funded_by = 'platform' WHERE id = v_line.id;
    v_gap := pg_temp.imbalance('USD');
    PERFORM pg_temp.act(v_buyer);
    PERFORM finance.cancel_order_line(v_line.id);
    PERFORM pg_temp.ok((SELECT recovered_cents = v_line.line_total_minor - v_line.platform_fee_minor
                          FROM finance.pending_releases WHERE order_id = v_line.order_id AND reason = 'product_sale'),
        'platform promo: the seller''s full credit comes back');
    PERFORM pg_temp.ok(pg_temp.imbalance('USD') = v_gap,
        'platform promo: the platform''s promo loss stops counting and money is conserved');
END $$;
ROLLBACK TO SAVEPOINT s_promo;
RELEASE SAVEPOINT s_promo;
-- #endregion

-- #region 6. A session forfeit given back
SAVEPOINT s_forfeit;
DO $$
DECLARE
    v_project uuid; v_stage uuid; v_host uuid; v_a uuid;
    v_cohort uuid; v_member uuid; v_event uuid; v_escrow uuid;
BEGIN
    SELECT p.id, s.id, p.owner_user_id INTO v_project, v_stage, v_host
      FROM projects.projects p JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id IS NOT NULL AND p.owner_team_id IS NULL
     ORDER BY p.id, s.id LIMIT 1;
    v_a := pg_temp.s('buyer')::uuid;
    IF v_a = v_host THEN v_a := pg_temp.s('other')::uuid; END IF;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name)
    VALUES (v_project, v_stage, 'Probe DB21 forfeit') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_a) RETURNING id INTO v_member;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, status)
    VALUES (v_cohort, 'Probe DB21 forfeit', now() + interval '2 hours', now() + interval '3 hours', 'scheduled')
    RETURNING id INTO v_event;
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, session_event_id, payer_user_id,
                                 payee_type, payee_id, amount_cents, currency, status)
    VALUES (v_stage, v_member, v_event, v_a, 'freelancer', v_host, 10000, 'GBP', 'held')
    RETURNING id INTO v_escrow;
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_host), v_host, 'GBP');
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_a), v_a, 'GBP');
    PERFORM pg_temp.act(v_a);
    PERFORM projects.cancel_cohort_membership(v_member);
    PERFORM pg_temp.ok((SELECT status FROM finance.escrows WHERE id = v_escrow) = 'released',
        'fixture: the attendee''s late cancel forfeits the seat to the host');
    PERFORM pg_catalog.set_config('probe.host', v_host::text, true);
    PERFORM pg_catalog.set_config('probe.attendee', v_a::text, true);
    PERFORM pg_catalog.set_config('probe.forfeit', v_escrow::text, true);
    PERFORM pg_catalog.set_config('probe.project', v_project::text, true);
END $$;

DO $$
DECLARE
    v_escrow uuid := pg_temp.s('forfeit')::uuid;
    v_project uuid := pg_temp.s('project')::uuid;
    v_a uuid := pg_temp.s('attendee')::uuid;
    v_before bigint := pg_temp.bal(pg_temp.s('attendee')::uuid, 'GBP');
    v_gap bigint := pg_temp.imbalance('GBP');
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act(v_a);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT finance.refund_session_forfeit(%L)', v_escrow)) LIKE 'P0002%',
        'forfeit: only its payee can give it back (P0002 for the attendee)');
    PERFORM pg_temp.ok(finance.session_forfeits(v_project) = '[]'::jsonb,
        'forfeit: the attendee is listed no forfeit to give back');
    PERFORM pg_temp.act(pg_temp.s('host')::uuid);
    PERFORM pg_temp.ok(finance.session_forfeits(v_project) -> 0 ->> 'escrow_id' = v_escrow::text,
        'forfeit: its host is listed it');
    v_out := finance.refund_session_forfeit(v_escrow);
    PERFORM pg_temp.ok(finance.session_forfeits(v_project) = '[]'::jsonb,
        'forfeit: once given back it leaves the list');
    PERFORM pg_temp.ok(pg_temp.bal(v_a, 'GBP') = v_before + 10000 AND (v_out ->> 'refunded_minor')::bigint = 10000,
        'forfeit: the attendee is refunded the whole price, fee included');
    PERFORM pg_temp.ok((v_out ->> 'recovered_pending_cents')::bigint > 0 AND (v_out ->> 'debited_cents')::bigint = 0
        AND NOT EXISTS (SELECT 1 FROM finance.pending_releases WHERE escrow_id = v_escrow AND state = 'pending'),
        'forfeit: the host gives it back from the release still clearing');
    PERFORM pg_temp.ok((SELECT status FROM finance.escrows WHERE id = v_escrow) = 'refunded',
        'forfeit: the escrow reads refunded');
    PERFORM pg_temp.ok(pg_temp.imbalance('GBP') = v_gap, 'forfeit: the fee stops counting and money is conserved');
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT finance.refund_session_forfeit(%L)', v_escrow)) LIKE 'PO409%',
        'forfeit: a forfeit already given back refuses');
END $$;
ROLLBACK TO SAVEPOINT s_forfeit;
RELEASE SAVEPOINT s_forfeit;
-- #endregion

ROLLBACK;
