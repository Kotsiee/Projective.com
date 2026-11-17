-- =============================================================================================
-- Probe: a card top-up made for a purchase reaches that purchase before a business's From-wallet
-- auto-fund queue does (finance.fn_wallet_watch, finance.settle_card_payment).
--
--   1. A card checkout settles into an empty wallet while a ticket waits in the queue for the same
--      amount: the order is placed, the payment is `succeeded`, and the ticket still waits.
--   2. What the purchase leaves goes to the queue: a wallet already holding the ticket's price pays the
--      order from the top-up, then funds the ticket.
--   3. A refused order leaves the whole top-up to the queue: `settled_unapplied`, and the ticket funded.
--   4. A top-up made for no purchase still retries the queue on its own credit.
--   5. A card escrow lock holds its own ticket before the queue's older ticket is funded.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/autofund_bound_topup.sql
--
-- Fixture (seeded): the first KYB-verified, active business with a standard project in its wallet's
-- currency holding a staffed ticket, its owner as the buyer; that project alone is auto-funded From
-- wallet. A queued ticket is cloned from the staffed one, and a published single-owner product from
-- outside the business is repriced to the ticket's price. Approval thresholds are lifted. Each case sits
-- between a SAVEPOINT and a ROLLBACK TO. A clean run prints only `ok` notices.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, n bigint, t text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.price() RETURNS bigint LANGUAGE sql AS $$
    SELECT n FROM probe_ids WHERE k = 'price';
$$;

CREATE FUNCTION pg_temp.ccy() RETURNS text LANGUAGE sql AS $$
    SELECT t FROM probe_ids WHERE k = 'wallet';
$$;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Act as p_uid in a fresh request (NULL: the webhook), with the spend gate's carrier cleared.
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('finance.spend_cover', '', true),
           pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

-- A fresh business basket holding one line of the product at the queued ticket's price; the line id.
CREATE FUNCTION pg_temp.line() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_basket uuid;
    v_line uuid;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES ('business', pg_temp.id('business'), 'Probe bound top-up') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, destination_email)
    VALUES (v_basket, 'digital_product', pg_temp.id('product'), 'Probe product', pg_temp.price(), pg_temp.ccy(),
            'probe@example.com')
    RETURNING id INTO v_line;
    RETURN v_line;
END $$;

-- A card top-up of the price into the business wallet, as the buyer; with p_line, paying for that line.
CREATE FUNCTION pg_temp.topup(p_key text, p_line uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_pay jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('buyer'));
    v_pay := finance.begin_card_payment('wallet_topup', pg_temp.id('wallet'), NULL, NULL, pg_temp.price(),
        pg_temp.ccy(), p_key);
    IF p_line IS NOT NULL THEN
        PERFORM finance.attach_checkout_order((v_pay ->> 'id')::uuid, pg_catalog.jsonb_build_object(
            'basket_id', (SELECT basket_id FROM finance.basket_items WHERE id = p_line),
            'item_ids', pg_catalog.jsonb_build_array(p_line),
            'currency', pg_temp.ccy(),
            'units', pg_catalog.jsonb_build_object(p_line::text, pg_temp.price()),
            'order_key', p_key || '-order'));
    END IF;
    PERFORM pg_temp.act(NULL);
    RETURN (v_pay ->> 'id')::uuid;
END $$;

-- The webhook settling a payment in full; the payment as it then stands.
CREATE FUNCTION pg_temp.settle(p_payment uuid) RETURNS finance.inbound_payments LANGUAGE plpgsql AS $$
DECLARE
    v_p finance.inbound_payments;
BEGIN
    UPDATE finance.inbound_payments
       SET provider_ref = 'pi_probe_af_' || pg_catalog.replace(p_payment::text, '-', ''), status = 'processing'
     WHERE id = p_payment
    RETURNING * INTO v_p;
    PERFORM pg_temp.act(NULL);
    PERFORM finance.settle_card_payment('evt_probe_af_' || pg_catalog.replace(p_payment::text, '-', ''),
        v_p.provider_ref, v_p.amount_cents, v_p.currency, false, v_p.id);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = p_payment;
    RETURN v_p;
END $$;

-- Whether the queued ticket is still waiting: unfunded, with no escrow held for it.
CREATE FUNCTION pg_temp.queued() RETURNS boolean LANGUAGE sql AS $$
    SELECT t.payment_status = 'needs_funding'::public.payment_status
           AND NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = t.id AND e.status = 'held')
      FROM projects.tickets t WHERE t.id = pg_temp.id('queued');
$$;

-- Whether the queue funded the queued ticket from the wallet.
CREATE FUNCTION pg_temp.auto_funded() RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (SELECT 1 FROM finance.escrows e
                    WHERE e.ticket_id = pg_temp.id('queued') AND e.status = 'held' AND e.auto_funded);
$$;

CREATE FUNCTION pg_temp.balance() RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = pg_temp.id('wallet');
$$;
-- #endregion

-- #region Fixture (as postgres)
DO $$
DECLARE
    v_biz uuid;
    v_buyer uuid;
    v_wallet uuid;
    v_ccy text;
    v_project uuid;
    v_staffed uuid;
    v_product uuid;
    v_queued uuid;
    v_price bigint;
BEGIN
    SELECT b.id, b.owner_user_id, w.id, upper(w.currency), p.id, t.id
      INTO v_biz, v_buyer, v_wallet, v_ccy, v_project, v_staffed
      FROM org.business_profiles b
      JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id
      JOIN projects.projects p ON p.client_business_id = b.id
                              AND upper(COALESCE(p.currency, 'USD')) = upper(w.currency)
      JOIN projects.tickets t ON t.project_id = p.id
                             AND t.current_stage_id IS NOT NULL AND t.current_assignee_id IS NOT NULL
     WHERE b.kyb_status = 'verified' AND b.status = 'active' AND b.owner_user_id IS NOT NULL
       AND p.status NOT IN ('completed', 'cancelled', 'archived')
       AND p.structure_variation = 'standard'
     ORDER BY b.id, p.id, t.id
     LIMIT 1;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures: no verified business project with a staffed ticket — run deno task db:reset';
    END IF;

    SELECT pr.id INTO v_product
      FROM catalogue.products pr
      JOIN catalogue.listings l ON l.product_id = pr.id AND l.status = 'published'
     WHERE pr.owner_team_id IS NULL AND upper(pr.currency) = v_ccy
       AND NOT EXISTS (SELECT 1 FROM org.business_members m WHERE m.business_id = v_biz AND m.user_id = pr.owner_user_id)
     ORDER BY pr.id LIMIT 1;
    IF v_product IS NULL THEN RAISE EXCEPTION 'PROBE FAIL: fixtures: no published % product from outside the business', v_ccy; END IF;

    UPDATE org.business_profiles SET auto_fund_mode = 'off' WHERE id = v_biz;
    UPDATE projects.projects SET auto_fund_override = 'off' WHERE client_business_id = v_biz AND id <> v_project;
    UPDATE projects.projects SET auto_fund_override = 'from_wallet' WHERE id = v_project;
    UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = v_wallet;
    UPDATE security.platform_params SET value = '{"default": 0}'::jsonb WHERE key = 'vault_approval_threshold_cents';

    INSERT INTO projects.tickets (project_id, title, description, text_description, current_stage_id, current_assignee_id,
                                  unit_price_cents, payment_status, created_at)
    SELECT t.project_id, 'Probe queued ticket', t.description, t.text_description, t.current_stage_id, t.current_assignee_id,
           20000, 'needs_funding', pg_catalog.now() - interval '1 hour'
      FROM projects.tickets t WHERE t.id = v_staffed
    RETURNING id INTO v_queued;
    SELECT projects.fn_ticket_stage_price(t.required_stages, t.unit_price_cents, ps) INTO v_price
      FROM projects.tickets t LEFT JOIN projects.project_stages ps ON ps.id = t.current_stage_id
     WHERE t.id = v_queued;
    IF v_price IS NULL OR v_price <= 0 THEN RAISE EXCEPTION 'PROBE FAIL: fixtures: the queued ticket prices at %', v_price; END IF;
    UPDATE catalogue.products SET price_cents = v_price WHERE id = v_product;

    INSERT INTO probe_ids (k, id, n, t) VALUES
        ('business', v_biz, NULL, NULL), ('buyer', v_buyer, NULL, NULL), ('wallet', v_wallet, NULL, v_ccy),
        ('project', v_project, NULL, NULL), ('staffed', v_staffed, NULL, NULL), ('product', v_product, NULL, NULL),
        ('queued', v_queued, NULL, NULL), ('price', NULL, v_price, NULL);
    RAISE NOTICE 'fixture business=% project=% queued=% price=% %', v_biz, v_project, v_queued, v_price, v_ccy;
END $$;
-- #endregion

-- #region 1. The checkout is paid before the queue
SAVEPOINT s_1;
DO $$
DECLARE
    v_p finance.inbound_payments;
BEGIN
    UPDATE finance.wallets SET balance_cents = 0 WHERE id = pg_temp.id('wallet');
    v_p := pg_temp.settle(pg_temp.topup('probe-af-1', pg_temp.line()));
    PERFORM pg_temp.ok(v_p.status = 'succeeded' AND v_p.order_id IS NOT NULL AND v_p.order_error IS NULL,
        '1 the card checkout places its order: ' || v_p.status || ' ' || COALESCE(v_p.order_error, ''));
    PERFORM pg_temp.ok(pg_temp.queued() AND pg_temp.balance() = 0,
        '1 and the queued ticket still waits on an empty wallet');
END $$;
ROLLBACK TO SAVEPOINT s_1;
-- #endregion

-- #region 2. What the purchase leaves goes to the queue
SAVEPOINT s_2;
DO $$
DECLARE
    v_p finance.inbound_payments;
BEGIN
    UPDATE finance.wallets SET balance_cents = pg_temp.price() WHERE id = pg_temp.id('wallet');
    v_p := pg_temp.settle(pg_temp.topup('probe-af-2', pg_temp.line()));
    PERFORM pg_temp.ok(v_p.status = 'succeeded' AND v_p.order_id IS NOT NULL,
        '2 the card checkout places its order: ' || v_p.status || ' ' || COALESCE(v_p.order_error, ''));
    PERFORM pg_temp.ok(pg_temp.auto_funded() AND pg_temp.balance() = 0,
        '2 then the queue funds the ticket from what the wallet already held');
END $$;
ROLLBACK TO SAVEPOINT s_2;
-- #endregion

-- #region 3. A refused order leaves the whole top-up to the queue
SAVEPOINT s_3;
DO $$
DECLARE
    v_line uuid;
    v_payment uuid;
    v_p finance.inbound_payments;
BEGIN
    UPDATE finance.wallets SET balance_cents = 0 WHERE id = pg_temp.id('wallet');
    v_line := pg_temp.line();
    v_payment := pg_temp.topup('probe-af-3', v_line);
    UPDATE catalogue.products SET price_cents = pg_temp.price() + 100 WHERE id = pg_temp.id('product');
    v_p := pg_temp.settle(v_payment);
    PERFORM pg_temp.ok(v_p.status = 'settled_unapplied' AND v_p.order_id IS NULL AND v_p.order_error IS NOT NULL,
        '3 a moved price refuses the order and keeps the money: ' || v_p.status);
    PERFORM pg_temp.ok(pg_temp.auto_funded() AND pg_temp.balance() = 0,
        '3 then the queue funds the ticket from the top-up');
END $$;
ROLLBACK TO SAVEPOINT s_3;
-- #endregion

-- #region 4. A top-up for no purchase retries the queue on its credit
SAVEPOINT s_4;
DO $$
DECLARE
    v_p finance.inbound_payments;
BEGIN
    UPDATE finance.wallets SET balance_cents = 0 WHERE id = pg_temp.id('wallet');
    v_p := pg_temp.settle(pg_temp.topup('probe-af-4', NULL));
    PERFORM pg_temp.ok(v_p.status = 'succeeded' AND pg_temp.auto_funded() AND pg_temp.balance() = 0,
        '4 a plain top-up funds the queued ticket: ' || v_p.status);
END $$;
ROLLBACK TO SAVEPOINT s_4;
-- #endregion

-- #region 5. A card escrow lock holds its own ticket first
SAVEPOINT s_5;
DO $$
DECLARE
    v_ticket uuid;
    v_stage uuid;
    v_pay jsonb;
    v_p finance.inbound_payments;
BEGIN
    UPDATE finance.wallets SET balance_cents = 0 WHERE id = pg_temp.id('wallet');
    INSERT INTO projects.tickets (project_id, title, description, text_description, current_stage_id, current_assignee_id,
                                  unit_price_cents, payment_status)
    SELECT t.project_id, 'Probe locked ticket', t.description, t.text_description, t.current_stage_id, t.current_assignee_id,
           t.unit_price_cents, 'needs_funding'
      FROM projects.tickets t WHERE t.id = pg_temp.id('queued')
    RETURNING id, current_stage_id INTO v_ticket, v_stage;
    PERFORM pg_temp.act(pg_temp.id('buyer'));
    v_pay := finance.begin_card_payment('escrow_lock', NULL, pg_temp.id('project'), v_stage, pg_temp.price(),
        pg_temp.ccy(), 'probe-af-5', v_ticket);
    PERFORM pg_temp.act(NULL);
    v_p := pg_temp.settle((v_pay ->> 'id')::uuid);
    PERFORM pg_temp.ok(v_p.status = 'succeeded' AND v_p.lock_status = 'locked'
        AND EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_ticket AND e.status = 'held' AND NOT e.auto_funded),
        '5 the card escrow lock holds its own ticket: ' || v_p.status || ' ' || COALESCE(v_p.lock_status, '') || ' '
            || COALESCE(v_p.lock_error, ''));
    PERFORM pg_temp.ok(pg_temp.queued() AND pg_temp.balance() = 0,
        '5 and the older queued ticket still waits');
END $$;
ROLLBACK TO SAVEPOINT s_5;
-- #endregion

ROLLBACK;
