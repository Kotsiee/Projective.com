-- =============================================================================================
-- Probe: a product sale pays its seller's Standing-tapered commission (Decision #337, ruling M1;
-- FINANCE_COMPLETENESS_AUDIT N3, N19).
--
-- finance.place_wallet_order charged every product sale the BUYER's platform fee (Decision #187's payer
-- rate), and finance.fn_effective_commission_bp, the seller's 8% → 6.5% taper, had no caller. Ruling
-- M1: a product sale pays the seller's own commission at their Standing rung, recorded on the order
-- line (`platform_fee_bp`, `platform_fee_minor`); #187's payer rate covers escrow fees only. The
-- paying business holds a negotiated contract (300 bp fee, 100 bp commission) throughout, so a
-- product line charged anything but its seller's rate shows up as 300 or 100. Asserted:
--   1. The same 1,055 sale costs an L1 seller 84 (8%, 84.4 truncated) and an L5 seller 68 (6.5%,
--      68.575 truncated, never 69), and each is credited the rest.
--   2. A mixed basket charges each seller their own rate; the order's fee is the lines' sum.
--   3. An escrow line beside a product takes no fee at purchase and records no rate; the order keeps
--      the payer's rate, which the escrow is charged at release.
--   4. A promo is shared across the lines, each share recorded, and each fee is charged on what was
--      paid after its share.
--   5. finance.get_seller_commission, called as `authenticated`, tells the seller the rate their next
--      sale is charged (the rate that sale then records) and what their recorded sales paid, per
--      currency, with the next rung's price of the same lines; a team's members read the team's;
--      a stranger and a signed-out caller are refused 42501, a buyer-only subject 22023.
--   6. An Agency's contract (Decision #252, ruled 2026-10-31: option B): a team's
--      `marketplace_commission_bp` replaces its rung's rate on its own sales and in its preview, and
--      its `platform_fee_bp` is the payer rate stamped on what it buys; the seller it buys from still
--      pays their own commission.
--
-- Rollback-safe: one transaction, ends in ROLLBACK. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/product_commission.sql
--
-- Fixture (seeded): the first open business pipeline project owned by a member other than the
-- business's owner; the owner buys as the business, which is made KYB-verified and funded inside the
-- transaction. Seller A is the first single-owner published product in the project's currency; seller
-- T the first team-owned one whose team the buyer is not in. Their Standing rungs are set per case.
-- A clean run prints only `ok` notices; the first failed assertion ends the run with PROBE FAIL.
-- =============================================================================================
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

-- #region Helpers
CREATE TEMP SEQUENCE probe_seq;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

-- Put a seller on a Standing rung: the cached row finance.fn_subject_standing_level reads.
CREATE FUNCTION pg_temp.rung(p_type org.standing_subject, p_id uuid, p_level smallint) RETURNS void
LANGUAGE sql AS $$
    INSERT INTO org.entity_standing (subject_type, subject_id, level)
    VALUES (p_type, p_id, p_level)
    ON CONFLICT (subject_type, subject_id) DO UPDATE SET level = EXCLUDED.level;
$$;

-- A fresh, empty basket of the paying business.
CREATE FUNCTION pg_temp.basket() RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES ('business', pg_temp.s('biz')::uuid, 'Probe M1 ' || nextval('pg_temp.probe_seq'))
    RETURNING id;
$$;

-- A product line at its catalogue price.
CREATE FUNCTION pg_temp.product_line(p_basket uuid, p_product uuid, p_position integer) RETURNS uuid
LANGUAGE sql AS $$
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency,
                                      destination_email, position)
    SELECT p_basket, 'digital_product', p.id, 'Probe product', p.price_cents, upper(p.currency),
           'probe@example.com', p_position
      FROM catalogue.products p WHERE p.id = p_product
    RETURNING id;
$$;

-- A one-ticket line on a new stage of the fixture project (Decision #166): settled as an escrow hold.
CREATE FUNCTION pg_temp.ticket_line(p_basket uuid, p_price bigint, p_position integer) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_n int := nextval('pg_temp.probe_seq')::int;
    v_project uuid := pg_temp.s('project')::uuid;
    v_stage uuid;
    v_ticket uuid;
    v_line uuid;
BEGIN
    INSERT INTO projects.project_stages (project_id, name, sort_order, status, unit_price_cents)
    VALUES (v_project, 'Probe M1 ' || v_n, 900 + v_n, 'open', p_price) RETURNING id INTO v_stage;
    INSERT INTO projects.tickets (project_id, current_stage_id, title, description, text_description)
    VALUES (v_project, v_stage, 'Probe M1 T' || v_n, '{"t":"x"}', 'A description.') RETURNING id INTO v_ticket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, stage_id, ticket_id, title,
                                      unit_price_minor, currency, position)
    VALUES (p_basket, 'project_ticket', v_project, v_stage, v_ticket, 'Probe ticket', p_price,
            pg_temp.s('currency'), p_position)
    RETURNING id INTO v_line;
    RETURN v_line;
END $$;

-- Pay for every line of a basket as one member of its owner, each at its basket price; the order id.
CREATE FUNCTION pg_temp.pay_as(p_basket uuid, p_actor uuid, p_promo text, p_expected bigint) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_ids uuid[];
    v_units jsonb;
    v_out jsonb;
BEGIN
    SELECT pg_catalog.array_agg(bi.id ORDER BY bi.position),
           pg_catalog.jsonb_object_agg(bi.id::text, bi.unit_price_minor)
      INTO v_ids, v_units
      FROM finance.basket_items bi WHERE bi.basket_id = p_basket;
    PERFORM pg_temp.act(p_actor);
    v_out := finance.place_wallet_order(p_basket, v_ids, pg_temp.s('currency'), v_units, p_promo,
        'probe-m1-' || gen_random_uuid(), p_expected);
    PERFORM pg_temp.act(NULL);
    RETURN (v_out ->> 'order_id')::uuid;
END $$;

-- The same, as the business owner.
CREATE FUNCTION pg_temp.pay(p_basket uuid, p_promo text, p_expected bigint) RETURNS uuid LANGUAGE sql AS $$
    SELECT pg_temp.pay_as(p_basket, pg_temp.s('buyer')::uuid, p_promo, p_expected);
$$;

CREATE FUNCTION pg_temp.line_of(p_order uuid, p_item uuid) RETURNS finance.order_lines LANGUAGE sql AS $$
    SELECT * FROM finance.order_lines WHERE order_id = p_order AND item_id = p_item ORDER BY position LIMIT 1;
$$;

CREATE FUNCTION pg_temp.order_of(p_order uuid) RETURNS finance.orders LANGUAGE sql AS $$
    SELECT * FROM finance.orders WHERE id = p_order;
$$;

-- What one order credited one seller: still pending (Decision #191), plus anything already matured.
CREATE FUNCTION pg_temp.credited(p_order uuid, p_owner uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT ((SELECT COALESCE(sum(pr.amount_cents), 0) FROM finance.pending_releases pr
               JOIN finance.wallets w ON w.id = pr.wallet_id
              WHERE pr.order_id = p_order AND pr.reason = 'product_sale' AND w.owner_id = p_owner)
          + (SELECT COALESCE(sum(t.amount_cents), 0) FROM finance.transactions t
               JOIN finance.wallets w ON w.id = t.wallet_id
              WHERE t.ref_table = 'orders' AND t.ref_id = p_order AND t.reason = 'product_sale'
                AND t.direction = 'credit' AND w.owner_id = p_owner
                AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.transaction_id = t.id)))::bigint;
$$;

-- One currency's entry of a get_seller_commission answer; zeros when the seller has none yet.
CREATE FUNCTION pg_temp.window_of(p_out jsonb, p_currency text) RETURNS jsonb LANGUAGE sql AS $$
    SELECT COALESCE(
        (SELECT e FROM pg_catalog.jsonb_array_elements(p_out -> 'currencies') e WHERE e ->> 'currency' = p_currency),
        '{"lines": 0, "paid_minor": 0, "fee_minor": 0, "at_next_minor": 0}'::jsonb);
$$;

-- Read as `authenticated` below, so the grant on finance.get_seller_commission is what is tested.
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean, text), pg_temp.act(uuid), pg_temp.s(text),
    pg_temp.window_of(jsonb, text) TO authenticated;
-- #endregion

-- #region Fixture (as postgres)
DO $$
DECLARE
    v_project uuid;
    v_biz uuid;
    v_buyer uuid;
    v_currency text;
    v_wallet uuid;
    v_seller uuid;
    v_product uuid;
    v_team uuid;
    v_team_product uuid;
    v_member uuid;
    v_team_owner uuid;
BEGIN
    SELECT p.id, p.client_business_id, bp.owner_user_id, upper(COALESCE(p.currency, 'USD'))
      INTO v_project, v_biz, v_buyer, v_currency
      FROM projects.projects p
      JOIN org.business_profiles bp ON bp.id = p.client_business_id
     WHERE p.owner_user_id <> bp.owner_user_id
       AND p.format = 'pipeline' AND p.structure_variation = 'standard'
       AND p.status NOT IN ('completed', 'cancelled', 'archived')
     ORDER BY p.id LIMIT 1;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture — no business pipeline project owned by a member other than the business owner; run deno task db:reset';
    END IF;

    SELECT p.id, p.owner_user_id INTO v_product, v_seller
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NULL AND p.owner_user_id <> v_buyer AND upper(p.currency) = v_currency
     ORDER BY p.id LIMIT 1;
    SELECT p.id, p.owner_team_id INTO v_team_product, v_team
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NOT NULL AND upper(p.currency) = v_currency
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm
                        WHERE tm.team_id = p.owner_team_id AND tm.user_id = v_buyer AND tm.status = 'active')
     ORDER BY p.id LIMIT 1;
    SELECT tm.user_id INTO v_member FROM org.team_members tm
     WHERE tm.team_id = v_team AND tm.status = 'active'
     ORDER BY tm.user_id LIMIT 1;
    -- The owner spends for the team in case 6: their seat is what the vault projects `spend` from.
    SELECT t.owner_user_id INTO v_team_owner FROM org.teams t
     WHERE t.id = v_team
       AND EXISTS (SELECT 1 FROM org.team_members tm
                    WHERE tm.team_id = t.id AND tm.user_id = t.owner_user_id AND tm.status = 'active');
    IF v_product IS NULL OR v_team_product IS NULL OR v_member IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture — need a single-owner and a team-owned published product in % (team with an active member)', v_currency;
    END IF;
    IF v_team_owner IS NULL OR v_team_owner = v_seller THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture — the team needs an owner with an active seat, other than seller A, to buy from A in case 6';
    END IF;

    INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
    SELECT v_project, 'business', v_biz, 'client'
     WHERE NOT EXISTS (SELECT 1 FROM projects.project_participants pp
                        WHERE pp.project_id = v_project AND pp.profile_type = 'business' AND pp.profile_id = v_biz);
    UPDATE org.business_profiles SET kyb_status = 'verified' WHERE id = v_biz;
    v_wallet := finance.fn_ensure_wallet('business', v_biz, v_currency);
    UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = v_wallet;
    UPDATE security.platform_params SET value = '{"default": 0}'::jsonb WHERE key = 'vault_approval_threshold_cents';
    DELETE FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id = v_buyer;
    PERFORM finance.fn_wallet_credit(v_biz, 'business', v_currency, 500000, 'topup', 'inbound_payments', gen_random_uuid());
    -- The BUYER's contract: its fee rate is the payer's rate an escrow is charged; its commission term
    -- is the business's own, and must never lower what an unrelated seller pays.
    INSERT INTO finance.negotiated_rates (subject_type, subject_id, platform_fee_bp, marketplace_commission_bp,
                                          contract_ref, starts_at)
    VALUES ('business', v_biz, 300, 100, 'PROBE-M1', now() - interval '1 day');

    UPDATE catalogue.products SET price_cents = 1055 WHERE id = v_product;
    UPDATE catalogue.products SET price_cents = 2000 WHERE id = v_team_product;
    INSERT INTO finance.promo_codes (code, label, kind, value_bp) VALUES ('PROBEM1', 'Probe 10% off', 'percent', 1000);

    PERFORM pg_catalog.set_config('probe.project', v_project::text, true);
    PERFORM pg_catalog.set_config('probe.biz', v_biz::text, true);
    PERFORM pg_catalog.set_config('probe.buyer', v_buyer::text, true);
    PERFORM pg_catalog.set_config('probe.currency', v_currency, true);
    PERFORM pg_catalog.set_config('probe.seller', v_seller::text, true);
    PERFORM pg_catalog.set_config('probe.product', v_product::text, true);
    PERFORM pg_catalog.set_config('probe.team', v_team::text, true);
    PERFORM pg_catalog.set_config('probe.team_product', v_team_product::text, true);
    PERFORM pg_catalog.set_config('probe.member', v_member::text, true);
    PERFORM pg_catalog.set_config('probe.team_owner', v_team_owner::text, true);

    -- What each seller's recorded sales already paid, read at the rungs case 5 reads them at, so case 5
    -- can count exactly what this probe's sales added.
    PERFORM pg_temp.rung('freelancer', v_seller, 3::smallint);
    PERFORM pg_temp.rung('team', v_team, 5::smallint);
    PERFORM pg_temp.act(v_seller);
    PERFORM pg_catalog.set_config('probe.base_seller',
        pg_temp.window_of(finance.get_seller_commission('freelancer', v_seller), v_currency)::text, true);
    PERFORM pg_temp.act(v_member);
    PERFORM pg_catalog.set_config('probe.base_team',
        pg_temp.window_of(finance.get_seller_commission('team', v_team), v_currency)::text, true);
    PERFORM pg_temp.act(NULL);

    RAISE NOTICE 'fixture project=% business=% buyer=% seller=% team=% %', v_project, v_biz, v_buyer, v_seller, v_team, v_currency;
END $$;
-- #endregion

-- #region 1. The same sale at L1 and at L5
DO $$
DECLARE
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_product uuid := pg_temp.s('product')::uuid;
    v_basket uuid;
    v_order uuid;
    v_line finance.order_lines;
BEGIN
    PERFORM pg_temp.rung('freelancer', v_seller, 1::smallint);
    v_basket := pg_temp.basket();
    PERFORM pg_temp.product_line(v_basket, v_product, 0);
    v_order := pg_temp.pay(v_basket, NULL, 1055);
    v_line := pg_temp.line_of(v_order, v_product);
    PERFORM pg_temp.ok(v_line.platform_fee_bp = 800,
        format('1 an L1 seller''s line records 800 bp, not the buyer''s 300 or 100 (got %s)', v_line.platform_fee_bp));
    PERFORM pg_temp.ok(v_line.platform_fee_minor = 84,
        format('1 an L1 seller pays 84 on 1,055 (84.4 truncated; got %s)', v_line.platform_fee_minor));
    PERFORM pg_temp.ok(pg_temp.credited(v_order, v_seller) = 971,
        format('1 the L1 seller is credited 971 (got %s)', pg_temp.credited(v_order, v_seller)));
    PERFORM pg_temp.ok((pg_temp.order_of(v_order)).platform_fee_minor = 84,
        format('1 the order''s fee is its line''s, 84 (got %s)', (pg_temp.order_of(v_order)).platform_fee_minor));

    PERFORM pg_temp.rung('freelancer', v_seller, 5::smallint);
    v_basket := pg_temp.basket();
    PERFORM pg_temp.product_line(v_basket, v_product, 0);
    v_order := pg_temp.pay(v_basket, NULL, 1055);
    v_line := pg_temp.line_of(v_order, v_product);
    PERFORM pg_temp.ok(v_line.platform_fee_bp = 650,
        format('1 an L5 seller''s line records 650 bp (got %s)', v_line.platform_fee_bp));
    PERFORM pg_temp.ok(v_line.platform_fee_minor = 68,
        format('1 an L5 seller pays 68 on 1,055 (68.575 truncated, never 69; got %s)', v_line.platform_fee_minor));
    PERFORM pg_temp.ok(pg_temp.credited(v_order, v_seller) = 987,
        format('1 the L5 seller is credited 987 (got %s)', pg_temp.credited(v_order, v_seller)));
END $$;
-- #endregion

-- #region 2. A mixed basket charges each seller their own rate
DO $$
DECLARE
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_product uuid := pg_temp.s('product')::uuid;
    v_team uuid := pg_temp.s('team')::uuid;
    v_team_product uuid := pg_temp.s('team_product')::uuid;
    v_basket uuid;
    v_order uuid;
    v_a finance.order_lines;
    v_t finance.order_lines;
BEGIN
    PERFORM pg_temp.rung('freelancer', v_seller, 1::smallint);
    PERFORM pg_temp.rung('team', v_team, 5::smallint);
    v_basket := pg_temp.basket();
    PERFORM pg_temp.product_line(v_basket, v_product, 0);
    PERFORM pg_temp.product_line(v_basket, v_team_product, 1);
    v_order := pg_temp.pay(v_basket, NULL, 3055);
    v_a := pg_temp.line_of(v_order, v_product);
    v_t := pg_temp.line_of(v_order, v_team_product);
    PERFORM pg_temp.ok(v_a.platform_fee_bp = 800 AND v_a.platform_fee_minor = 84,
        format('2 the L1 person''s line pays 84 at 800 bp (got %s at %s)', v_a.platform_fee_minor, v_a.platform_fee_bp));
    PERFORM pg_temp.ok(v_t.platform_fee_bp = 650 AND v_t.platform_fee_minor = 130,
        format('2 the L5 team''s line pays 130 at 650 bp (got %s at %s)', v_t.platform_fee_minor, v_t.platform_fee_bp));
    PERFORM pg_temp.ok((pg_temp.order_of(v_order)).platform_fee_minor = 214,
        format('2 the order''s fee is the lines'' sum, 214 (got %s)', (pg_temp.order_of(v_order)).platform_fee_minor));
    PERFORM pg_temp.ok(pg_temp.credited(v_order, v_seller) = 971 AND pg_temp.credited(v_order, v_team) = 1870,
        format('2 the person is credited 971 and the team 1,870 (got %s and %s)',
            pg_temp.credited(v_order, v_seller), pg_temp.credited(v_order, v_team)));
END $$;
-- #endregion

-- #region 3. An escrow line keeps the payer's fee, charged at release
DO $$
DECLARE
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_product uuid := pg_temp.s('product')::uuid;
    v_biz uuid := pg_temp.s('biz')::uuid;
    v_basket uuid;
    v_order uuid;
    v_ticket finance.order_lines;
    v_product_line finance.order_lines;
    v_escrow finance.escrows;
BEGIN
    PERFORM pg_temp.rung('freelancer', v_seller, 1::smallint);
    v_basket := pg_temp.basket();
    PERFORM pg_temp.ticket_line(v_basket, 15000, 0);
    PERFORM pg_temp.product_line(v_basket, v_product, 1);
    v_order := pg_temp.pay(v_basket, NULL, 16055);
    SELECT * INTO v_ticket FROM finance.order_lines WHERE order_id = v_order AND ticket_id IS NOT NULL;
    v_product_line := pg_temp.line_of(v_order, v_product);
    SELECT * INTO v_escrow FROM finance.escrows WHERE ticket_id = v_ticket.ticket_id AND status = 'held';

    PERFORM pg_temp.ok(v_ticket.platform_fee_bp IS NULL AND v_ticket.platform_fee_minor = 0,
        format('3 the ticket line takes no fee at purchase and records no rate (got %s at %s)',
            v_ticket.platform_fee_minor, COALESCE(v_ticket.platform_fee_bp::text, 'no rate')));
    PERFORM pg_temp.ok(v_escrow.id IS NOT NULL AND v_escrow.amount_cents = 15000 AND v_escrow.platform_fee_cents = 0,
        format('3 the ticket''s 15,000 escrow is held with no fee taken yet (got %s, fee %s)',
            v_escrow.amount_cents, v_escrow.platform_fee_cents));
    PERFORM pg_temp.ok((pg_temp.order_of(v_order)).platform_fee_bp = 300
            AND finance.fn_escrow_fee_bp(v_biz, NULL) = 300,
        format('3 the order records the payer''s 300 bp, the rate the release charges (got %s / %s)',
            (pg_temp.order_of(v_order)).platform_fee_bp, finance.fn_escrow_fee_bp(v_biz, NULL)));
    PERFORM pg_temp.ok(v_product_line.platform_fee_bp = 800 AND v_product_line.platform_fee_minor = 84,
        format('3 the product beside it still pays its seller''s 84 at 800 bp (got %s at %s)',
            v_product_line.platform_fee_minor, v_product_line.platform_fee_bp));
    PERFORM pg_temp.ok((pg_temp.order_of(v_order)).platform_fee_minor = 84,
        format('3 the order''s fee is the product line''s alone, 84 (got %s)', (pg_temp.order_of(v_order)).platform_fee_minor));
END $$;
-- #endregion

-- #region 4. A promo: each line's share recorded, each fee on what was paid after it
-- 10% of 3,055 is 306 (the promo rounds half up, as it always has). Shares are pro rata with the
-- remainder on the last line: ⌊306 × 1,055 / 3,055⌋ = 105, then 201. Paid: 950 and 1,799.
-- Fees: ⌊950 × 800 / 10000⌋ = 76 and ⌊1,799 × 650 / 10000⌋ = 116 (116.935).
DO $$
DECLARE
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_product uuid := pg_temp.s('product')::uuid;
    v_team uuid := pg_temp.s('team')::uuid;
    v_team_product uuid := pg_temp.s('team_product')::uuid;
    v_basket uuid;
    v_order uuid;
    v_a finance.order_lines;
    v_t finance.order_lines;
BEGIN
    v_basket := pg_temp.basket();
    UPDATE finance.baskets SET promo_code = 'PROBEM1' WHERE id = v_basket;
    PERFORM pg_temp.product_line(v_basket, v_product, 0);
    PERFORM pg_temp.product_line(v_basket, v_team_product, 1);
    v_order := pg_temp.pay(v_basket, 'PROBEM1', 3055 - 306);
    v_a := pg_temp.line_of(v_order, v_product);
    v_t := pg_temp.line_of(v_order, v_team_product);
    PERFORM pg_temp.ok(v_a.promo_discount_minor = 105 AND v_t.promo_discount_minor = 201
            AND (pg_temp.order_of(v_order)).promo_discount_minor = 306,
        format('4 the lines record their shares 105 + 201 = the order''s 306 (got %s + %s = %s)',
            v_a.promo_discount_minor, v_t.promo_discount_minor, (pg_temp.order_of(v_order)).promo_discount_minor));
    PERFORM pg_temp.ok(v_a.line_total_minor = 1055 AND v_t.line_total_minor = 2000,
        format('4 a line total stays the price before the promo (got %s, %s)', v_a.line_total_minor, v_t.line_total_minor));
    PERFORM pg_temp.ok(v_a.platform_fee_minor = 76 AND v_t.platform_fee_minor = 116,
        format('4 the fees are charged on what was paid, 76 and 116 (got %s and %s)', v_a.platform_fee_minor, v_t.platform_fee_minor));
    PERFORM pg_temp.ok((pg_temp.order_of(v_order)).platform_fee_minor = 192,
        format('4 the order''s fee is 192 (got %s)', (pg_temp.order_of(v_order)).platform_fee_minor));
    PERFORM pg_temp.ok(pg_temp.credited(v_order, v_seller) = 874 AND pg_temp.credited(v_order, v_team) = 1683,
        format('4 the person is credited 874 and the team 1,683 (got %s and %s)',
            pg_temp.credited(v_order, v_seller), pg_temp.credited(v_order, v_team)));
END $$;
-- #endregion

-- #region 5. The seller's read: the rate a sale is charged, and what recorded sales paid
-- The person's six lines paid 1,055 × 5 + 950 = 6,225 and carried 84 + 68 + 84 + 84 + 76 + 79 = 475
-- in commission; at L4's 700 bp, truncated per line, they would carry 73 × 5 + 66 = 431. The team's
-- two lines paid 2,000 + 1,799 = 3,799 and carried 130 + 116 = 246; L5 has no rung above it.
DO $$
DECLARE
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_product uuid := pg_temp.s('product')::uuid;
    v_out jsonb;
    v_basket uuid;
    v_order uuid;
BEGIN
    PERFORM pg_temp.rung('freelancer', v_seller, 3::smallint);
    PERFORM pg_temp.act(v_seller);
    v_out := finance.get_seller_commission('freelancer', v_seller);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.ok((v_out ->> 'commission_bp')::int = 750 AND (v_out ->> 'next_commission_bp')::int = 700,
        format('5 an L3 seller is previewed 750 bp, with 700 at the next rung (got %s, %s)',
            v_out ->> 'commission_bp', v_out ->> 'next_commission_bp'));

    v_basket := pg_temp.basket();
    PERFORM pg_temp.product_line(v_basket, v_product, 0);
    v_order := pg_temp.pay(v_basket, NULL, 1055);
    PERFORM pg_temp.ok((pg_temp.line_of(v_order, v_product)).platform_fee_bp = (v_out ->> 'commission_bp')::int
            AND (pg_temp.line_of(v_order, v_product)).platform_fee_minor = 79,
        format('5 the next sale is charged the previewed rate: 79 at 750 bp (got %s at %s)',
            (pg_temp.line_of(v_order, v_product)).platform_fee_minor, (pg_temp.line_of(v_order, v_product)).platform_fee_bp));
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_team uuid := pg_temp.s('team')::uuid;
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_biz uuid := pg_temp.s('biz')::uuid;
    v_cur text := pg_temp.s('currency');
    v_base jsonb := pg_temp.s('base_seller')::jsonb;
    v_base_team jsonb := pg_temp.s('base_team')::jsonb;
    v_now jsonb;
BEGIN
    PERFORM pg_temp.act(v_seller);
    v_now := pg_temp.window_of(finance.get_seller_commission('freelancer', v_seller), v_cur);
    PERFORM pg_temp.ok((v_now ->> 'lines')::bigint - (v_base ->> 'lines')::bigint = 6
            AND (v_now ->> 'paid_minor')::bigint - (v_base ->> 'paid_minor')::bigint = 6225,
        format('5 the person''s read counts the six lines and the 6,225 their buyers paid (got +%s, +%s)',
            (v_now ->> 'lines')::bigint - (v_base ->> 'lines')::bigint,
            (v_now ->> 'paid_minor')::bigint - (v_base ->> 'paid_minor')::bigint));
    PERFORM pg_temp.ok((v_now ->> 'fee_minor')::bigint - (v_base ->> 'fee_minor')::bigint = 475,
        format('5 commission paid is the recorded line fees, 475 (got +%s)',
            (v_now ->> 'fee_minor')::bigint - (v_base ->> 'fee_minor')::bigint));
    PERFORM pg_temp.ok((v_now ->> 'at_next_minor')::bigint - (v_base ->> 'at_next_minor')::bigint = 431,
        format('5 the same lines at the next rung''s 700 bp, truncated per line, are 431 (got +%s)',
            (v_now ->> 'at_next_minor')::bigint - (v_base ->> 'at_next_minor')::bigint));

    PERFORM pg_temp.act(pg_temp.s('member')::uuid);
    v_now := pg_temp.window_of(finance.get_seller_commission('team', v_team), v_cur);
    PERFORM pg_temp.ok((v_now ->> 'fee_minor')::bigint - (v_base_team ->> 'fee_minor')::bigint = 246
            AND (v_now ->> 'paid_minor')::bigint - (v_base_team ->> 'paid_minor')::bigint = 3799,
        format('5 a team member reads the team''s 246 on 3,799 (got +%s on +%s)',
            (v_now ->> 'fee_minor')::bigint - (v_base_team ->> 'fee_minor')::bigint,
            (v_now ->> 'paid_minor')::bigint - (v_base_team ->> 'paid_minor')::bigint));
    PERFORM pg_temp.ok(v_now -> 'at_next_minor' = 'null'::jsonb,
        format('5 an L5 team has no next-rung price (got %s)', v_now -> 'at_next_minor'));

    PERFORM pg_temp.act(v_buyer);
    BEGIN
        PERFORM finance.get_seller_commission('freelancer', v_seller);
        PERFORM pg_temp.ok(false, '5 a stranger read another seller''s commission');
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.ok(true, '5 a stranger is refused 42501');
    END;
    BEGIN
        PERFORM finance.get_seller_commission('team', v_team);
        PERFORM pg_temp.ok(false, '5 a non-member read a team''s commission');
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.ok(true, '5 a non-member of the team is refused 42501');
    END;
    BEGIN
        PERFORM finance.get_seller_commission('business', v_biz);
        PERFORM pg_temp.ok(false, '5 a buyer-only subject was answered');
    EXCEPTION WHEN invalid_parameter_value THEN
        PERFORM pg_temp.ok(true, '5 a business is refused 22023: it pays no commission');
    END;
    PERFORM pg_temp.act(NULL);
    BEGIN
        PERFORM finance.get_seller_commission('freelancer', v_seller);
        PERFORM pg_temp.ok(false, '5 a signed-out caller was answered');
    EXCEPTION WHEN insufficient_privilege THEN
        PERFORM pg_temp.ok(true, '5 a signed-out caller is refused 42501');
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 6. An Agency's contract (Decision #252, ruled 2026-10-31: option B)
-- The team holds a contract of 500 bp commission and 400 bp as a payer. Its own sale pays the
-- contract's 500, not its L5 rung's 650, and its preview says so; when the team buys, its order
-- stamps the 400 while the seller it buys from still pays their own rate.
DO $$
DECLARE
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_product uuid := pg_temp.s('product')::uuid;
    v_team uuid := pg_temp.s('team')::uuid;
    v_team_product uuid := pg_temp.s('team_product')::uuid;
    v_owner uuid := pg_temp.s('team_owner')::uuid;
    v_currency text := pg_temp.s('currency');
    v_wallet uuid;
    v_basket uuid;
    v_order uuid;
    v_line finance.order_lines;
    v_out jsonb;
BEGIN
    INSERT INTO finance.negotiated_rates (subject_type, subject_id, platform_fee_bp, marketplace_commission_bp,
                                          contract_ref, starts_at)
    VALUES ('team', v_team, 400, 500, 'PROBE-M1-AGENCY', now() - interval '1 day');
    PERFORM pg_temp.rung('team', v_team, 5::smallint);
    PERFORM pg_temp.rung('freelancer', v_seller, 1::smallint);

    v_basket := pg_temp.basket();
    PERFORM pg_temp.product_line(v_basket, v_team_product, 0);
    v_order := pg_temp.pay(v_basket, NULL, 2000);
    v_line := pg_temp.line_of(v_order, v_team_product);
    PERFORM pg_temp.ok(v_line.platform_fee_bp = 500 AND v_line.platform_fee_minor = 100,
        format('6 an Agency''s sale pays its contract''s 100 at 500 bp, not its rung''s 650 (got %s at %s)',
            v_line.platform_fee_minor, v_line.platform_fee_bp));
    PERFORM pg_temp.ok(pg_temp.credited(v_order, v_team) = 1900,
        format('6 the Agency is credited 1,900 (got %s)', pg_temp.credited(v_order, v_team)));

    PERFORM pg_temp.act(pg_temp.s('member')::uuid);
    v_out := finance.get_seller_commission('team', v_team);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.ok((v_out ->> 'commission_bp')::int = 500,
        format('6 a member is previewed the contract''s 500 bp (got %s)', v_out ->> 'commission_bp'));

    v_wallet := finance.fn_ensure_wallet('team', v_team, v_currency);
    UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = v_wallet;
    DELETE FROM finance.spending_limits WHERE wallet_id = v_wallet AND member_user_id = v_owner;
    PERFORM finance.fn_wallet_credit(v_team, 'team', v_currency, 100000, 'topup', 'inbound_payments', gen_random_uuid());
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('team', v_team, 'Probe M1 agency buys')
    RETURNING id INTO v_basket;
    PERFORM pg_temp.product_line(v_basket, v_product, 0);
    v_order := pg_temp.pay_as(v_basket, v_owner, NULL, 1055);
    v_line := pg_temp.line_of(v_order, v_product);
    PERFORM pg_temp.ok((pg_temp.order_of(v_order)).platform_fee_bp = 400,
        format('6 the Agency''s own order stamps its contract''s 400 bp payer rate (got %s)',
            (pg_temp.order_of(v_order)).platform_fee_bp));
    PERFORM pg_temp.ok(v_line.platform_fee_bp = 800 AND v_line.platform_fee_minor = 84,
        format('6 the seller it buys from still pays their own 84 at 800 bp (got %s at %s)',
            v_line.platform_fee_minor, v_line.platform_fee_bp));
END $$;
-- #endregion

ROLLBACK;
