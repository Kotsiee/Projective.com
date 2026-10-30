-- =============================================================================================
-- Probe: spend approvals bind to what they approve and are spent exactly once (BUSINESSES_AUDIT
-- BF20, BF44, §4.3 — prompt BB4).
--
-- Before: `finance.place_wallet_order` refused at/above the threshold unconditionally and never read
-- `finance.spend_approvals`; the app filed requests with no ref; an approval could not be spent by
-- anything but the auto-fund drain, which reused any approved row for a ticket forever. Now a request
-- names its ref (required, one of baskets · tickets · project_stages · revisions · invoices ·
-- transfers) and amount; the spend gate redeems it through finance.fn_redeem_spend_approval, which
-- stamps `consumed_at` in the money movement's own transaction. Team wallets cannot file (BF44).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/spend_approval_redemption.sql
--
-- Fixture (seeded data): the KYB-verified business Helia, its USD wallet, its owner O and its admin H
-- (vault `spend` + `approve_spend`; a monthly envelope that covers the probe's charges); a published
-- single-owner product sold by someone outside Helia; Helia's project owned by H with a staffed stage;
-- any team wallet and one of its members. The probe sets Helia's approval threshold to 500.00 and
-- prices the product at 600.00. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

-- Act as p_user in what the money doors see as a fresh request: the spend gate's count-once carrier
-- (`finance.spend_cover`, transaction-local) is cleared, as it is between two real API calls.
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('finance.spend_cover', '', true);
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- A fresh 600.00 line in a basket; returns its id.
CREATE FUNCTION pg_temp.line(p_basket uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, destination_email)
    VALUES (p_basket, 'digital_product', pg_temp.id('product'), 'Probe product', 60000, 'USD', 'probe@example.com')
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Pay one fresh 600.00 line of a basket from the business wallet, as p_actor.
CREATE FUNCTION pg_temp.pay_sql(p_basket uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_line uuid := pg_temp.line(p_basket);
BEGIN
    RETURN format(
        'SELECT finance.place_wallet_order(%L, ARRAY[%L]::uuid[], ''USD'', %L::jsonb, NULL, %L, 60000)',
        p_basket, v_line, jsonb_build_object(v_line::text, 60000), 'bb4-probe-' || gen_random_uuid());
END $$;

-- Run p_sql as p_actor; it must be refused with SQLSTATE p_state and a message starting p_prefix.
-- Returns the refusal's DETAIL.
CREATE FUNCTION pg_temp.expect_refused(p_label text, p_actor uuid, p_sql text, p_state text, p_prefix text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
    v_detail text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
    END;
    PERFORM set_config('request.jwt.claims', NULL, true);
    IF v_state IS NULL THEN
        RAISE EXCEPTION 'FAIL % — it went through', p_label;
    END IF;
    IF v_state <> p_state OR v_msg NOT LIKE p_prefix || '%' THEN
        RAISE EXCEPTION 'FAIL % — refused % "%" (expected % %)', p_label, v_state, v_msg, p_state, p_prefix;
    END IF;
    RAISE NOTICE 'PASS % (% %)', p_label, v_state, split_part(v_msg, ':', 1);
    RETURN v_detail;
END $$;

-- Run p_sql as p_actor; it must succeed. Returns its jsonb answer (or NULL).
CREATE FUNCTION pg_temp.expect_ok(p_label text, p_actor uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_out jsonb;
    v_state text;
    v_msg text;
BEGIN
    PERFORM pg_temp.act(p_actor);
    BEGIN
        EXECUTE p_sql INTO v_out;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        PERFORM set_config('request.jwt.claims', NULL, true);
        RAISE EXCEPTION 'FAIL % — refused % "%"', p_label, v_state, v_msg;
    END;
    PERFORM set_config('request.jwt.claims', NULL, true);
    RAISE NOTICE 'PASS %', p_label;
    RETURN v_out;
END $$;

-- File a spend request as p_actor; returns its id.
CREATE FUNCTION pg_temp.request(p_actor uuid, p_amount bigint, p_ref_table text, p_ref uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := pg_temp.expect_ok(format('file %s %s request for %s', p_ref_table, p_amount, p_ref), p_actor,
        format('SELECT finance.request_spend_approval(%L, %s, ''Probe spend'', %L, %L)',
               pg_temp.id('wallet'), p_amount, p_ref_table, p_ref));
    RETURN (v_out ->> 'id')::uuid;
END $$;

CREATE FUNCTION pg_temp.decide_sql(p_approval uuid, p_decision text) RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT finance.decide_spend_approval(%L, %L)', p_approval, p_decision);
$$;
-- #endregion

-- #region Fixture
DO $$
DECLARE
    v_business uuid;
    v_wallet uuid;
    v_owner uuid;
    v_admin uuid;
    v_product uuid;
    v_project uuid;
    v_ticket uuid;
    v_team_wallet uuid;
    v_team_member uuid;
BEGIN
    SELECT b.id, b.owner_user_id, w.id INTO v_business, v_owner, v_wallet
      FROM org.business_profiles b
      JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id AND w.currency = 'USD'
     WHERE b.kyb_status = 'verified' AND w.balance_cents >= 200000
     ORDER BY b.id LIMIT 1;
    IF v_wallet IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no verified business with a funded USD wallet'; END IF;

    SELECT vp.member_user_id INTO v_admin
      FROM finance.vault_permissions vp
     WHERE vp.wallet_id = v_wallet AND vp.member_user_id <> v_owner
       AND 'spend'::finance.vault_capability = ANY (vp.capabilities)
       AND 'approve_spend'::finance.vault_capability = ANY (vp.capabilities)
     ORDER BY vp.member_user_id LIMIT 1;
    IF v_admin IS NULL THEN RAISE EXCEPTION 'FAIL fixture: the business has no second spend+approve member'; END IF;

    SELECT p.id INTO v_product
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.owner_team_id IS NULL AND upper(p.currency) = 'USD'
       AND NOT EXISTS (SELECT 1 FROM org.business_members m WHERE m.business_id = v_business AND m.user_id = p.owner_user_id)
     ORDER BY p.id LIMIT 1;
    IF v_product IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no published USD product from outside the business'; END IF;
    UPDATE catalogue.products SET price_cents = 60000 WHERE id = v_product;

    -- A queued From-wallet ticket on the admin's project: staffed stage, 600.00, needs funding.
    SELECT p.id INTO v_project FROM projects.projects p
     WHERE p.client_business_id = v_business AND p.owner_user_id = v_admin AND upper(COALESCE(p.currency, 'USD')) = 'USD'
     ORDER BY p.id LIMIT 1;
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no business project owned by the admin'; END IF;
    UPDATE projects.projects SET auto_fund_override = 'from_wallet' WHERE id = v_project;
    INSERT INTO projects.tickets (project_id, title, description, text_description, current_stage_id, current_assignee_id,
                                  unit_price_cents, payment_status)
    SELECT t.project_id, 'BB4 probe ticket', t.description, t.text_description, t.current_stage_id, t.current_assignee_id,
           60000, 'needs_funding'
      FROM projects.tickets t
     WHERE t.project_id = v_project AND t.current_stage_id IS NOT NULL AND t.current_assignee_id IS NOT NULL
     ORDER BY t.id LIMIT 1
    RETURNING id INTO v_ticket;
    IF v_ticket IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no staffed ticket on the admin''s project'; END IF;

    SELECT w.id, m.user_id INTO v_team_wallet, v_team_member
      FROM finance.wallets w
      JOIN org.team_members m ON m.team_id = w.owner_id AND m.status = 'active'
     WHERE w.owner_type = 'team'
     ORDER BY w.id LIMIT 1;
    IF v_team_wallet IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no team wallet with an active member'; END IF;

    UPDATE finance.wallets SET approval_threshold_cents = 50000 WHERE id = v_wallet;

    INSERT INTO probe_ids VALUES
        ('business', v_business), ('wallet', v_wallet), ('owner', v_owner), ('admin', v_admin),
        ('product', v_product), ('ticket', v_ticket), ('team_wallet', v_team_wallet),
        ('team_member', v_team_member);
    INSERT INTO probe_ids
    SELECT 'basket_' || k, gen_random_uuid()
      FROM (VALUES ('a'), ('b'), ('c')) AS v (k);
    INSERT INTO finance.baskets (id, owner_type, owner_id, name)
    SELECT id, 'business', v_business, 'BB4 probe ' || k FROM probe_ids WHERE k LIKE 'basket_%';
END $$;
-- #endregion

-- #region 1. Filing: a ref is required, team wallets are refused, one open request per ref
SELECT pg_temp.expect_refused('a request without a ref', pg_temp.id('admin'),
    format('SELECT finance.request_spend_approval(%L, 60000, ''Probe'', NULL, NULL)', pg_temp.id('wallet')),
    '22023', 'refTable:');
SELECT pg_temp.expect_refused('a ref outside the allowed set', pg_temp.id('admin'),
    format('SELECT finance.request_spend_approval(%L, 60000, ''Probe'', ''orders'', %L)', pg_temp.id('wallet'), pg_temp.id('basket_a')),
    '22023', 'refTable:');
SELECT pg_temp.expect_refused('a basket of another account', pg_temp.id('admin'),
    format('SELECT finance.request_spend_approval(%L, 60000, ''Probe'', ''baskets'', %L)', pg_temp.id('wallet'), gen_random_uuid()),
    '22023', 'refId:');
SELECT pg_temp.expect_refused('a team wallet request (BF44)', pg_temp.id('team_member'),
    format('SELECT finance.request_spend_approval(%L, 60000, ''Probe'', ''baskets'', %L)', pg_temp.id('team_wallet'), pg_temp.id('basket_a')),
    'P0002', 'wallet:');
-- #endregion

-- #region 2. No approval: the basket charge at/above the threshold is refused, bound to the basket
DO $$
DECLARE
    v_detail jsonb;
BEGIN
    v_detail := pg_temp.expect_refused('600.00 basket order with no approval', pg_temp.id('admin'),
        pg_temp.pay_sql(pg_temp.id('basket_a')), 'PA403', 'needs_approval')::jsonb;
    IF v_detail ->> 'ref_table' IS DISTINCT FROM 'baskets' OR (v_detail ->> 'ref_id')::uuid IS DISTINCT FROM pg_temp.id('basket_a')
       OR (v_detail ->> 'amount_minor')::bigint IS DISTINCT FROM 60000 THEN
        RAISE EXCEPTION 'FAIL needs_approval DETAIL does not name the basket and the charge: %', v_detail;
    END IF;
    RAISE NOTICE 'PASS needs_approval DETAIL names the basket and the charge';
END $$;
-- #endregion

-- #region 3. An approval for 500.00 does not cover a 600.00 charge
DO $$
DECLARE
    v_small uuid := pg_temp.request(pg_temp.id('admin'), 50000, 'baskets', pg_temp.id('basket_a'));
BEGIN
    PERFORM pg_temp.expect_refused('a second open request for the same basket', pg_temp.id('admin'),
        format('SELECT finance.request_spend_approval(%L, 60000, ''Probe'', ''baskets'', %L)', pg_temp.id('wallet'), pg_temp.id('basket_a')),
        'PC409', 'refId:');
    PERFORM pg_temp.expect_refused('the requester approves their own request', pg_temp.id('admin'),
        pg_temp.decide_sql(v_small, 'approve'), '42501', 'You can''t decide your own');
    PERFORM pg_temp.expect_ok('the owner approves the 500.00 request', pg_temp.id('owner'), pg_temp.decide_sql(v_small, 'approve'));
    PERFORM pg_temp.expect_refused('600.00 order against a 500.00 approval', pg_temp.id('admin'),
        pg_temp.pay_sql(pg_temp.id('basket_a')), 'PA403', 'needs_approval');
    IF (SELECT consumed_at FROM finance.spend_approvals WHERE id = v_small) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL the 500.00 approval was spent by a charge it does not cover';
    END IF;
    RAISE NOTICE 'PASS the 500.00 approval is left unspent';
    INSERT INTO probe_ids VALUES ('approval_small', v_small);
END $$;
-- #endregion

-- #region 4. An approval for 600.00 is spent by the next 600.00 order, and only once
DO $$
DECLARE
    v_big uuid := pg_temp.request(pg_temp.id('admin'), 60000, 'baskets', pg_temp.id('basket_a'));
    v_row finance.spend_approvals;
BEGIN
    PERFORM pg_temp.expect_ok('the owner approves the 600.00 request', pg_temp.id('owner'), pg_temp.decide_sql(v_big, 'approve'));
    PERFORM pg_temp.expect_ok('600.00 order against the 600.00 approval', pg_temp.id('admin'), pg_temp.pay_sql(pg_temp.id('basket_a')));
    SELECT * INTO v_row FROM finance.spend_approvals WHERE id = v_big;
    IF v_row.consumed_at IS NULL OR v_row.consumed_ref_table IS DISTINCT FROM 'baskets'
       OR v_row.consumed_ref_id IS DISTINCT FROM pg_temp.id('basket_a') THEN
        RAISE EXCEPTION 'FAIL the 600.00 approval was not stamped spent by the basket: % % %',
            v_row.consumed_at, v_row.consumed_ref_table, v_row.consumed_ref_id;
    END IF;
    RAISE NOTICE 'PASS the approval is stamped spent by the basket';
    PERFORM pg_temp.expect_refused('a second 600.00 order on the same basket', pg_temp.id('admin'),
        pg_temp.pay_sql(pg_temp.id('basket_a')), 'PA403', 'needs_approval');
    PERFORM pg_temp.expect_refused('re-deciding a spent request', pg_temp.id('owner'),
        pg_temp.decide_sql(v_big, 'reject'), 'PC409', 'That request has already been spent');
END $$;
-- #endregion

-- #region 5. An approval binds to its own basket and expires
DO $$
DECLARE
    v_b uuid := pg_temp.request(pg_temp.id('admin'), 60000, 'baskets', pg_temp.id('basket_b'));
BEGIN
    PERFORM pg_temp.expect_ok('the owner approves basket B', pg_temp.id('owner'), pg_temp.decide_sql(v_b, 'approve'));
    PERFORM pg_temp.expect_refused('basket C cannot spend basket B''s approval', pg_temp.id('admin'),
        pg_temp.pay_sql(pg_temp.id('basket_c')), 'PA403', 'needs_approval');
    UPDATE finance.spend_approvals SET expires_at = now() - interval '1 second' WHERE id = v_b;
    PERFORM pg_temp.expect_refused('an expired approval cannot be redeemed', pg_temp.id('admin'),
        pg_temp.pay_sql(pg_temp.id('basket_b')), 'PA403', 'needs_approval');
    IF (SELECT consumed_at FROM finance.spend_approvals WHERE id = v_b) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL an expired approval was stamped spent';
    END IF;
    RAISE NOTICE 'PASS the expired approval is left unspent';
END $$;

-- An expired pending request cannot be decided, and a stale pending one does not block a new ask.
DO $$
DECLARE
    v_c uuid := pg_temp.request(pg_temp.id('admin'), 60000, 'baskets', pg_temp.id('basket_c'));
    v_out jsonb;
BEGIN
    UPDATE finance.spend_approvals SET expires_at = now() - interval '1 second' WHERE id = v_c;
    v_out := pg_temp.expect_ok('deciding an expired request marks it expired', pg_temp.id('owner'), pg_temp.decide_sql(v_c, 'approve'));
    IF v_out ->> 'status' IS DISTINCT FROM 'expired' THEN
        RAISE EXCEPTION 'FAIL an expired request was decided %', v_out;
    END IF;
    PERFORM pg_temp.expect_refused('re-deciding an expired request', pg_temp.id('owner'),
        pg_temp.decide_sql(v_c, 'approve'), 'PC409', 'That request has expired');
    PERFORM pg_temp.request(pg_temp.id('admin'), 60000, 'baskets', pg_temp.id('basket_c'));
END $$;
-- #endregion

-- #region 6. The redeemer is not a client door
DO $$
BEGIN
    IF has_function_privilege('authenticated', 'finance.fn_redeem_spend_approval(uuid, uuid, bigint, text, uuid, boolean)', 'EXECUTE')
       OR has_function_privilege('anon', 'finance.fn_redeem_spend_approval(uuid, uuid, bigint, text, uuid, boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL a client role may execute finance.fn_redeem_spend_approval';
    END IF;
    RAISE NOTICE 'PASS no client role may execute the redeemer';
END $$;
-- #endregion

-- #region 7. The auto-fund drain funds an approved ticket exactly once
DO $$
DECLARE
    v_moved integer;
    v_approval uuid;
    v_held integer;
BEGIN
    v_moved := finance.fn_auto_fund_drain(pg_temp.id('wallet'));
    SELECT id INTO v_approval FROM finance.spend_approvals
     WHERE wallet_id = pg_temp.id('wallet') AND ref_table = 'tickets' AND ref_id = pg_temp.id('ticket')
       AND status = 'pending';
    IF v_moved <> 0 OR v_approval IS NULL THEN
        RAISE EXCEPTION 'FAIL the drain did not queue an approval for the 600.00 ticket (moved %, approval %)', v_moved, v_approval;
    END IF;
    IF (SELECT requested_by FROM finance.spend_approvals WHERE id = v_approval) IS DISTINCT FROM pg_temp.id('admin') THEN
        RAISE EXCEPTION 'FAIL the drain filed the ticket request as someone other than the project owner';
    END IF;
    RAISE NOTICE 'PASS the drain files one ticket request as the project owner';

    PERFORM finance.fn_auto_fund_drain(pg_temp.id('wallet'));
    IF (SELECT count(*) FROM finance.spend_approvals WHERE ref_table = 'tickets' AND ref_id = pg_temp.id('ticket')) <> 1 THEN
        RAISE EXCEPTION 'FAIL a second drain filed a second request for the same ticket';
    END IF;
    RAISE NOTICE 'PASS a second drain files nothing more';

    -- Approving kicks the drain, which redeems the approval inside the hold.
    PERFORM pg_temp.expect_ok('the owner approves the ticket request', pg_temp.id('owner'), pg_temp.decide_sql(v_approval, 'approve'));
    PERFORM finance.fn_auto_fund_drain(pg_temp.id('wallet'));
    SELECT count(*) INTO v_held FROM finance.escrows
     WHERE ticket_id = pg_temp.id('ticket') AND status = 'held' AND revision_id IS NULL;
    IF v_held <> 1 THEN
        RAISE EXCEPTION 'FAIL the approved ticket holds % escrows, expected exactly 1', v_held;
    END IF;
    IF (SELECT consumed_at FROM finance.spend_approvals WHERE id = v_approval) IS NULL THEN
        RAISE EXCEPTION 'FAIL the ticket approval funded the hold but was not stamped spent';
    END IF;
    RAISE NOTICE 'PASS the approved ticket is funded exactly once and its approval is spent';
END $$;
-- #endregion

ROLLBACK;
