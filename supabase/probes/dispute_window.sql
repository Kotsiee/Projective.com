-- =============================================================================================
-- Probe: a card dispute inside the 7-day clearing window freezes the payee's money it funded, and a
-- lost one recovers from that money first (Decision #337, ruling M3; FINANCE_BUILD_PROMPTS DB6).
--
--   1. Opened: the payee's pending rows the disputed payment funded go `on_hold`, keyed to the case;
--      a sweep past their date matures nothing, and the payee's available balance does not move.
--   2. Lost: recovered from those rows first, then from the payer, and only the rest is a loss; the
--      payee's available balance is untouched and money is conserved.
--   3. Won: each row is `pending` again at its original `available_at`, and the next sweep matures it.
--   4. A row that has already cleared (Available) is never frozen, and a lost dispute leaves it alone.
--   5. A plain top-up funded nothing in particular: its dispute freezes no payee row.
--   6. An escrow the payment still holds covers its own part: a dispute no larger than it freezes no
--      payee row and takes nothing from the payee; a full one freezes the rest and recovers it.
--   7. Closed before Stripe reported it opened (lost): the payment's still-pending rows stand in for
--      the frozen ones, as its still-held escrows already do.
--   8. A card-paid checkout (a top-up that placed an order): the payee rows of an escrow bought on one
--      of its lines freeze, and a lost dispute recovers from them.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/dispute_window.sql
--
-- Fixtures (seeded): two tickets of one business, each holding a single base escrow for an individual
-- payee, in one currency. Card payments are inserted as postgres in the shape settle_card_payment
-- leaves them (as stripe_event_order.sql does). Each section sits between a SAVEPOINT and a ROLLBACK
-- TO. A clean run prints only `ok`.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers + fixtures (as postgres)
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.bal(p_wallet uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = p_wallet;
$$;

-- What is still clearing on the rows an escrow released, in the given states.
CREATE FUNCTION pg_temp.rows_left(p_escrow uuid, p_states text[]) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE(pg_catalog.sum(amount_cents - recovered_cents), 0)::bigint
      FROM finance.pending_releases WHERE escrow_id = p_escrow AND state::text = ANY (p_states);
$$;

CREATE FUNCTION pg_temp.rows_in(p_escrow uuid, p_state text) RETURNS bigint LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM finance.pending_releases WHERE escrow_id = p_escrow AND state::text = p_state;
$$;

CREATE FUNCTION pg_temp.imbalance(p_currency text) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE((SELECT imbalance_minor FROM finance.v_conservation_identity WHERE currency = pg_catalog.upper(p_currency)), 0);
$$;

-- The finance_invariants identity for one wallet: balance = Σ signed ledger = newest balance_after.
CREATE FUNCTION pg_temp.ledger_ok(p_wallet uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT w.balance_cents >= 0
       AND w.balance_cents = COALESCE((
            SELECT pg_catalog.sum(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END)
              FROM finance.transactions t WHERE t.wallet_id = w.id), 0)
      FROM finance.wallets w WHERE w.id = p_wallet;
$$;

-- A settled card payment into the business wallet, credited through fn_wallet_credit exactly as
-- settle_card_payment credits one; an escrow lock names the escrows it funded.
CREATE FUNCTION pg_temp.settled(p_key text, p_amount bigint, p_escrows uuid[] DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_w finance.wallets;
    v_id uuid;
    v_tx uuid;
BEGIN
    SELECT * INTO v_w FROM finance.wallets WHERE id = pg_temp.s('bwallet')::uuid;
    INSERT INTO finance.inbound_payments (purpose, wallet_id, amount_cents, currency, status, lock_status,
        provider, provider_ref, idempotency_key, created_by)
    VALUES (CASE WHEN p_escrows IS NULL THEN 'wallet_topup' ELSE 'escrow_lock' END, v_w.id, p_amount,
        pg_catalog.upper(v_w.currency), 'processing',
        CASE WHEN p_escrows IS NULL THEN 'not_applicable' ELSE 'pending' END,
        'stripe', 'pi_probe_db6_' || p_key, 'probe-db6-' || p_key, pg_temp.s('payer')::uuid)
    RETURNING id INTO v_id;
    PERFORM finance.fn_wallet_credit(v_w.owner_id, v_w.owner_type, v_w.currency, p_amount, 'topup', 'inbound_payments', v_id);
    SELECT t.id INTO v_tx FROM finance.transactions t
     WHERE t.ref_table = 'inbound_payments' AND t.ref_id = v_id ORDER BY t.created_at DESC LIMIT 1;
    UPDATE finance.inbound_payments
       SET status = 'succeeded', succeeded_at = pg_catalog.now(), transaction_id = v_tx,
           amount_received_cents = p_amount,
           lock_status = CASE WHEN p_escrows IS NULL THEN 'not_applicable' ELSE 'locked' END,
           locked_escrow_ids = COALESCE(p_escrows, '{}')
     WHERE id = v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.opened(p_key text, p_amount bigint) RETURNS jsonb LANGUAGE sql AS $$
    SELECT finance.record_dispute_opened('evt_probe_db6_' || p_key || '_created', 'du_probe_db6_' || p_key,
        'pi_probe_db6_' || p_key, p_amount, pg_temp.s('currency'), 'fraudulent', false);
$$;

CREATE FUNCTION pg_temp.closed(p_key text, p_status text, p_amount bigint DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
    SELECT finance.record_dispute_closed('evt_probe_db6_' || p_key || '_closed', 'du_probe_db6_' || p_key, p_status, false,
        'pi_probe_db6_' || p_key, p_amount, pg_temp.s('currency'), 'fraudulent');
$$;

-- Push an escrow's pending rows past their clearing date, as eight days passing would.
CREATE FUNCTION pg_temp.age(p_escrow uuid) RETURNS void LANGUAGE sql AS $$
    UPDATE finance.pending_releases
       SET released_at = pg_catalog.now() - interval '8 days', available_at = pg_catalog.now() - interval '1 minute'
     WHERE escrow_id = p_escrow AND state <> 'available';
$$;

DO $$
DECLARE
    v_a finance.escrows;
    v_b finance.escrows;
    v_bw uuid;
    v_owner uuid;
    v_pw uuid;
BEGIN
    SELECT * INTO v_a FROM finance.escrows e
     WHERE e.status = 'held' AND e.ticket_id IS NOT NULL AND e.revision_id IS NULL AND e.payer_business_id IS NOT NULL
       AND e.payee_type <> 'team'::assignment_type
       AND NOT EXISTS (SELECT 1 FROM finance.escrows o WHERE o.ticket_id = e.ticket_id AND o.status = 'held' AND o.id <> e.id)
       AND EXISTS (
            SELECT 1 FROM finance.escrows b
             WHERE b.status = 'held' AND b.ticket_id IS NOT NULL AND b.ticket_id <> e.ticket_id AND b.revision_id IS NULL
               AND b.payer_business_id = e.payer_business_id AND b.currency = e.currency
               AND b.payee_type <> 'team'::assignment_type
               AND NOT EXISTS (SELECT 1 FROM finance.escrows o WHERE o.ticket_id = b.ticket_id AND o.status = 'held' AND o.id <> b.id))
     ORDER BY e.id LIMIT 1;
    IF v_a.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures: no business holds two single-escrow tickets for individual payees (run deno task db:reset)';
    END IF;
    SELECT * INTO v_b FROM finance.escrows b
     WHERE b.status = 'held' AND b.ticket_id IS NOT NULL AND b.ticket_id <> v_a.ticket_id AND b.revision_id IS NULL
       AND b.payer_business_id = v_a.payer_business_id AND b.currency = v_a.currency
       AND b.payee_type <> 'team'::assignment_type
       AND NOT EXISTS (SELECT 1 FROM finance.escrows o WHERE o.ticket_id = b.ticket_id AND o.status = 'held' AND o.id <> b.id)
     ORDER BY b.id LIMIT 1;
    SELECT w.id INTO v_bw FROM finance.wallets w
     WHERE w.owner_type = 'business' AND w.owner_id = v_a.payer_business_id AND w.currency = v_a.currency;
    SELECT bp.owner_user_id INTO v_owner FROM org.business_profiles bp WHERE bp.id = v_a.payer_business_id;
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_a.payee_id), v_a.payee_id, v_a.currency);
    SELECT w.id INTO v_pw FROM finance.wallets w
     WHERE w.owner_type = finance.fn_person_wallet_type(v_a.payee_id) AND w.owner_id = v_a.payee_id AND w.currency = v_a.currency;
    IF v_bw IS NULL OR v_owner IS NULL OR v_pw IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures: the business wallet, its owner or the payee wallet is missing';
    END IF;
    PERFORM pg_catalog.set_config('probe.a', v_a.id::text, true);
    PERFORM pg_catalog.set_config('probe.a_ticket', v_a.ticket_id::text, true);
    PERFORM pg_catalog.set_config('probe.a_amount', v_a.amount_cents::text, true);
    PERFORM pg_catalog.set_config('probe.b', v_b.id::text, true);
    PERFORM pg_catalog.set_config('probe.b_amount', v_b.amount_cents::text, true);
    PERFORM pg_catalog.set_config('probe.currency', pg_catalog.upper(v_a.currency), true);
    PERFORM pg_catalog.set_config('probe.bwallet', v_bw::text, true);
    PERFORM pg_catalog.set_config('probe.pwallet', v_pw::text, true);
    PERFORM pg_catalog.set_config('probe.payer', v_owner::text, true);
END $$;
-- #endregion

-- #region 1–3. Opened → frozen; lost → recovered from the payee first; won → pending at its date
SAVEPOINT s_main;
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_amount bigint := pg_temp.s('a_amount')::bigint;
    v_pw uuid := pg_temp.s('pwallet')::uuid;
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_cur text := pg_temp.s('currency');
    v_payee_left bigint;
    v_pw_before bigint;
    v_bw_before bigint;
    v_gap bigint;
    v_case finance.chargebacks;
    v_out jsonb;
BEGIN
    PERFORM pg_temp.settled('main', v_amount, ARRAY[v_a]);
    PERFORM finance.fn_release_ticket_escrow(pg_temp.s('a_ticket')::uuid);
    v_payee_left := pg_temp.rows_left(v_a, ARRAY['pending']);
    PERFORM pg_temp.ok(v_payee_left > 0 AND v_payee_left < v_amount,
        pg_catalog.format('fixture: the release left %s of %s clearing for the payee', v_payee_left, v_amount));

    -- 1. Opened.
    v_out := pg_temp.opened('main', v_amount);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied', 'dispute opened: applied');
    PERFORM pg_temp.ok(pg_temp.rows_in(v_a, 'pending') = 0 AND pg_temp.rows_in(v_a, 'on_hold') > 0,
        'opened: every pending row the payment funded is on_hold');
    SELECT * INTO v_case FROM finance.chargebacks WHERE provider_ref = 'du_probe_db6_main';
    PERFORM pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM finance.pending_releases
         WHERE escrow_id = v_a AND hold_chargeback_id IS DISTINCT FROM v_case.id),
        'opened: each frozen row names the case that froze it');

    PERFORM pg_temp.age(v_a);
    PERFORM pg_catalog.set_config('probe.available_at',
        (SELECT pg_catalog.max(available_at) FROM finance.pending_releases WHERE escrow_id = v_a)::text, true);
    v_pw_before := pg_temp.bal(v_pw);
    PERFORM finance.fn_mature_pending_releases(1000);
    PERFORM pg_temp.ok(pg_temp.rows_in(v_a, 'on_hold') > 0 AND pg_temp.rows_in(v_a, 'available') = 0
        AND pg_temp.bal(v_pw) = v_pw_before,
        'frozen past its date: the sweep matures nothing and the payee''s available balance holds');
    PERFORM pg_catalog.set_config('probe.pw_before', v_pw_before::text, true);
    PERFORM pg_catalog.set_config('probe.payee_left', v_payee_left::text, true);
END $$;

-- 2. Lost.
SAVEPOINT s_lost;
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_amount bigint := pg_temp.s('a_amount')::bigint;
    v_pw uuid := pg_temp.s('pwallet')::uuid;
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_cur text := pg_temp.s('currency');
    v_payee_left bigint := pg_temp.s('payee_left')::bigint;
    v_bw_before bigint := pg_temp.bal(v_bw);
    v_gap bigint := pg_temp.imbalance(v_cur);
    v_case finance.chargebacks;
    v_out jsonb;
BEGIN
    v_out := pg_temp.closed('main', 'lost');
    SELECT * INTO v_case FROM finance.chargebacks WHERE provider_ref = 'du_probe_db6_main';
    PERFORM pg_temp.ok(v_case.status = 'lost', 'lost: the case is lost');
    PERFORM pg_temp.ok(pg_temp.rows_left(v_a, ARRAY['pending', 'on_hold']) = 0
        AND pg_temp.rows_in(v_a, 'on_hold') = 0
        AND NOT EXISTS (SELECT 1 FROM finance.pending_releases WHERE escrow_id = v_a AND transaction_id IS NOT NULL),
        pg_catalog.format('lost: the payee''s %s still clearing is recovered first, and those rows close with no credit', v_payee_left));
    PERFORM pg_temp.ok(pg_temp.bal(v_pw) = pg_temp.s('pw_before')::bigint,
        'lost: the payee''s available balance is untouched');
    PERFORM pg_temp.ok(v_bw_before - pg_temp.bal(v_bw) + v_case.unrecovered_cents = v_amount - v_payee_left,
        pg_catalog.format('lost: the payer covers the rest (%s), and only what it cannot is a loss (%s)',
            v_amount - v_payee_left, v_case.unrecovered_cents));
    PERFORM pg_temp.ok((v_out ->> 'recovered_payee_cents')::bigint = v_payee_left,
        'lost: the outcome reports what came back from the payee');
    PERFORM pg_temp.ok(pg_temp.imbalance(v_cur) = v_gap, 'lost: money is conserved');
    PERFORM pg_temp.ok(pg_temp.ledger_ok(v_pw) AND pg_temp.ledger_ok(v_bw), 'lost: both wallets reconcile');
END $$;
ROLLBACK TO SAVEPOINT s_lost;
RELEASE SAVEPOINT s_lost;

-- 3. Won.
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_pw uuid := pg_temp.s('pwallet')::uuid;
    v_payee_left bigint := pg_temp.s('payee_left')::bigint;
    v_out jsonb;
BEGIN
    v_out := pg_temp.closed('main', 'won');
    PERFORM pg_temp.ok(pg_temp.rows_in(v_a, 'on_hold') = 0 AND pg_temp.rows_in(v_a, 'pending') > 0
        AND NOT EXISTS (SELECT 1 FROM finance.pending_releases WHERE escrow_id = v_a
                         AND available_at <> pg_temp.s('available_at')::timestamptz),
        'won: each row is pending again at its original available_at');
    PERFORM finance.fn_mature_pending_releases(1000);
    PERFORM pg_temp.ok(pg_temp.rows_in(v_a, 'pending') = 0
        AND pg_temp.bal(v_pw) = pg_temp.s('pw_before')::bigint + v_payee_left,
        'won: a row whose date has passed matures on the next sweep, in full');
END $$;
ROLLBACK TO SAVEPOINT s_main;
RELEASE SAVEPOINT s_main;
-- #endregion

-- #region 4. Cleared money is never touched
SAVEPOINT s_cleared;
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_amount bigint := pg_temp.s('a_amount')::bigint;
    v_pw uuid := pg_temp.s('pwallet')::uuid;
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_pw_before bigint;
    v_bw_before bigint;
    v_case finance.chargebacks;
BEGIN
    PERFORM pg_temp.settled('cleared', v_amount, ARRAY[v_a]);
    PERFORM finance.fn_release_ticket_escrow(pg_temp.s('a_ticket')::uuid);
    PERFORM pg_temp.age(v_a);
    PERFORM finance.fn_mature_pending_releases(1000);
    PERFORM pg_temp.ok(pg_temp.rows_in(v_a, 'pending') = 0, 'fixture: the release has cleared');
    v_pw_before := pg_temp.bal(v_pw);
    v_bw_before := pg_temp.bal(v_bw);

    PERFORM pg_temp.opened('cleared', v_amount);
    PERFORM pg_temp.ok(pg_temp.rows_in(v_a, 'on_hold') = 0, 'cleared: an Available row is never frozen');
    PERFORM pg_temp.closed('cleared', 'lost');
    SELECT * INTO v_case FROM finance.chargebacks WHERE provider_ref = 'du_probe_db6_cleared';
    PERFORM pg_temp.ok(pg_temp.bal(v_pw) = v_pw_before, 'cleared: a lost dispute takes nothing from the payee');
    PERFORM pg_temp.ok(v_bw_before - pg_temp.bal(v_bw) + v_case.unrecovered_cents = v_amount,
        'cleared: the payer covers it all, as before');
END $$;
ROLLBACK TO SAVEPOINT s_cleared;
RELEASE SAVEPOINT s_cleared;
-- #endregion

-- #region 5. A plain top-up freezes no payee row
SAVEPOINT s_topup;
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
BEGIN
    PERFORM finance.fn_release_ticket_escrow(pg_temp.s('a_ticket')::uuid);
    PERFORM pg_temp.settled('topup', 5000);
    PERFORM pg_temp.opened('topup', 5000);
    PERFORM pg_temp.ok(pg_temp.rows_in(v_a, 'on_hold') = 0 AND pg_temp.rows_in(v_a, 'pending') > 0,
        'top-up: its dispute freezes no payee row');
END $$;
ROLLBACK TO SAVEPOINT s_topup;
RELEASE SAVEPOINT s_topup;
-- #endregion

-- #region 6. A held escrow covers its own part of the dispute
SAVEPOINT s_mixed;
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_b uuid := pg_temp.s('b')::uuid;
    v_a_amount bigint := pg_temp.s('a_amount')::bigint;
    v_b_amount bigint := pg_temp.s('b_amount')::bigint;
    v_left bigint;
BEGIN
    PERFORM pg_temp.settled('mixed', v_a_amount + v_b_amount, ARRAY[v_a, v_b]);
    PERFORM finance.fn_release_ticket_escrow(pg_temp.s('a_ticket')::uuid);
    v_left := pg_temp.rows_left(v_a, ARRAY['pending']);
    PERFORM pg_catalog.set_config('probe.mixed_left', v_left::text, true);
END $$;

-- 6a. A dispute no larger than the escrow still held.
SAVEPOINT s_mixed_small;
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_b uuid := pg_temp.s('b')::uuid;
    v_b_amount bigint := pg_temp.s('b_amount')::bigint;
    v_left bigint := pg_temp.s('mixed_left')::bigint;
    v_pw uuid := pg_temp.s('pwallet')::uuid;
    v_cur text := pg_temp.s('currency');
    v_pw_before bigint;
    v_gap bigint;
BEGIN
    PERFORM pg_temp.opened('mixed', v_b_amount);
    PERFORM pg_temp.ok((SELECT status FROM finance.escrows WHERE id = v_b) = 'disputed'
        AND pg_temp.rows_in(v_a, 'on_hold') = 0,
        'partial: the held escrow freezes, and no payee row does');
    v_pw_before := pg_temp.bal(v_pw);
    v_gap := pg_temp.imbalance(v_cur);
    PERFORM pg_temp.closed('mixed', 'lost');
    PERFORM pg_temp.ok(pg_temp.rows_left(v_a, ARRAY['pending']) = v_left AND pg_temp.bal(v_pw) = v_pw_before,
        'partial lost: nothing is taken from the payee');
    PERFORM pg_temp.ok(pg_temp.imbalance(v_cur) = v_gap, 'partial lost: money is conserved');
END $$;
ROLLBACK TO SAVEPOINT s_mixed_small;
RELEASE SAVEPOINT s_mixed_small;

DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_b uuid := pg_temp.s('b')::uuid;
    v_total bigint := pg_temp.s('a_amount')::bigint + pg_temp.s('b_amount')::bigint;
    v_left bigint := pg_temp.s('mixed_left')::bigint;
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_cur text := pg_temp.s('currency');
    v_bw_before bigint;
    v_gap bigint;
    v_case finance.chargebacks;
BEGIN
    -- 6b. The whole payment disputed.
    PERFORM pg_temp.opened('mixed', v_total);
    PERFORM pg_temp.ok((SELECT status FROM finance.escrows WHERE id = v_b) = 'disputed'
        AND pg_temp.rows_in(v_a, 'on_hold') > 0,
        'full: the held escrow and the released one''s pending rows both freeze');
    v_bw_before := pg_temp.bal(v_bw);
    v_gap := pg_temp.imbalance(v_cur);
    PERFORM pg_temp.closed('mixed', 'lost');
    SELECT * INTO v_case FROM finance.chargebacks WHERE provider_ref = 'du_probe_db6_mixed';
    PERFORM pg_temp.ok(pg_temp.rows_left(v_a, ARRAY['pending', 'on_hold']) = 0
        AND (SELECT status FROM finance.escrows WHERE id = v_b) = 'refunded',
        'full lost: the payee''s rows are recovered and the held escrow goes back to the payer');
    PERFORM pg_temp.ok(
        v_bw_before + pg_temp.s('b_amount')::bigint - pg_temp.bal(v_bw) + v_case.unrecovered_cents = v_total - v_left,
        'full lost: the payer covers what the payee''s rows did not');
    PERFORM pg_temp.ok(pg_temp.imbalance(v_cur) = v_gap, 'full lost: money is conserved');
END $$;
ROLLBACK TO SAVEPOINT s_mixed;
RELEASE SAVEPOINT s_mixed;
-- #endregion

-- #region 7. Closed before it was reported opened
SAVEPOINT s_late;
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_amount bigint := pg_temp.s('a_amount')::bigint;
    v_cur text := pg_temp.s('currency');
    v_gap bigint;
    v_out jsonb;
BEGIN
    PERFORM pg_temp.settled('late', v_amount, ARRAY[v_a]);
    PERFORM finance.fn_release_ticket_escrow(pg_temp.s('a_ticket')::uuid);
    v_gap := pg_temp.imbalance(v_cur);
    v_out := pg_temp.closed('late', 'lost', v_amount);
    PERFORM pg_temp.ok((v_out ->> 'late')::boolean AND pg_temp.rows_left(v_a, ARRAY['pending', 'on_hold']) = 0,
        'late lost: the payment''s still-pending rows are recovered as the frozen ones would have been');
    PERFORM pg_temp.ok(pg_temp.imbalance(v_cur) = v_gap, 'late lost: money is conserved');
END $$;
ROLLBACK TO SAVEPOINT s_late;
RELEASE SAVEPOINT s_late;
-- #endregion

-- #region 8. A card-paid checkout: the payee rows of an escrow bought on its order freeze
SAVEPOINT s_order;
DO $$
DECLARE
    v_a uuid := pg_temp.s('a')::uuid;
    v_amount bigint := pg_temp.s('a_amount')::bigint;
    v_cur text := pg_temp.s('currency');
    v_order uuid;
    v_pay uuid;
    v_gap bigint;
BEGIN
    INSERT INTO finance.orders (reference, owner_type, owner_id, currency, subtotal_minor, platform_fee_bp, total_minor,
        idempotency_key)
    SELECT 'PRB-DB6-ORDER', w.owner_type, w.owner_id, v_cur, v_amount, 0, v_amount, 'probe-db6-order'
      FROM finance.wallets w WHERE w.id = pg_temp.s('bwallet')::uuid
    RETURNING id INTO v_order;
    INSERT INTO finance.order_lines (order_id, item_type, item_id, title, line_total_minor, currency, escrow_id)
    VALUES (v_order, 'one_off_project', gen_random_uuid(), 'Probe One-Off', v_amount, v_cur, v_a);
    v_pay := pg_temp.settled('order', v_amount);
    UPDATE finance.inbound_payments
       SET checkout = pg_catalog.jsonb_build_object('order_key', 'probe-db6-order'), order_id = v_order
     WHERE id = v_pay;
    PERFORM finance.fn_release_ticket_escrow(pg_temp.s('a_ticket')::uuid);

    PERFORM pg_temp.opened('order', v_amount);
    PERFORM pg_temp.ok(pg_temp.rows_in(v_a, 'pending') = 0 AND pg_temp.rows_in(v_a, 'on_hold') > 0,
        'card-paid order: the payee rows of the escrow bought on its line freeze');
    v_gap := pg_temp.imbalance(v_cur);
    PERFORM pg_temp.closed('order', 'lost');
    PERFORM pg_temp.ok(pg_temp.rows_left(v_a, ARRAY['pending', 'on_hold']) = 0 AND pg_temp.imbalance(v_cur) = v_gap,
        'card-paid order lost: recovered from those rows first, and money is conserved');
END $$;
ROLLBACK TO SAVEPOINT s_order;
RELEASE SAVEPOINT s_order;
-- #endregion

ROLLBACK;
