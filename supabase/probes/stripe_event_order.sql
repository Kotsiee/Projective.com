-- =============================================================================================
-- Probe: every Stripe money event is ledgered, in any delivery order (FINANCE_AUDIT H3, H4, E3;
-- FINANCE_BUILD_PROMPTS DB2).
--
--   1. charge.dispute.closed before .created (won): a resolved case is recorded from the closed
--      dispute's own facts; the late .created freezes nothing.
--   2. The same, lost: the payment's still-held escrow is refunded and the amount recovered, as the
--      in-order events would have done; the late .created freezes nothing.
--   3. In order: .updated moves the case to under_review (never back), funds_withdrawn and
--      funds_reinstated are recorded on the case, and none of them, nor any replay, moves money.
--   4. .updated before .created opens (and freezes) the case itself; the late .created changes nothing.
--      An event of a dispute Stripe has already closed records nothing.
--   5. A won thaw that would give a ticket a second held base escrow (uq_escrows_ticket_base_held)
--      leaves the escrow disputed, notes the case and writes ops, without raising.
--   6. charge.refunded: a partial refund twice (5, then 8 cumulative) debits 5, then 3; a replay and an
--      older, lower total debit nothing.
--   7. A refund the wallet cannot cover debits what is there and records the rest; never negative.
--   8. A refund of an unsettled payment releases its claim for Stripe's retry; one held for
--      reconciliation, or of a charge Projective did not create, moves nothing and is not retried.
--   9. payout.canceled records the bank outcome and moves no money; a late paid for it changes
--      nothing; a later bank payout that re-pays it marks it paid.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/stripe_event_order.sql
--
-- Fixtures: the first seeded held base ticket escrow paid by a business (its business wallet), and the
-- first seeded `user` wallet. Card payments are inserted as postgres in the shape settle_card_payment
-- leaves them. Each section sits between a SAVEPOINT and a ROLLBACK TO. A clean run prints only `ok`.
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

CREATE FUNCTION pg_temp.lines(p_wallet uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM finance.transactions WHERE wallet_id = p_wallet;
$$;

-- The finance_invariants identity for one wallet: balance = Σ signed ledger = newest balance_after.
CREATE FUNCTION pg_temp.ledger_ok(p_wallet uuid) RETURNS boolean LANGUAGE sql AS $$
    SELECT w.balance_cents >= 0
       AND w.balance_cents = COALESCE((
            SELECT pg_catalog.sum(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END)
              FROM finance.transactions t WHERE t.wallet_id = w.id), 0)
       AND w.balance_cents = COALESCE((
            SELECT t.balance_after_cents FROM finance.transactions t
             WHERE t.wallet_id = w.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1), 0)
      FROM finance.wallets w WHERE w.id = p_wallet;
$$;

-- A settled card payment into `p_wallet`, credited through fn_wallet_credit exactly as
-- settle_card_payment credits one; an escrow lock names the escrows it funded.
CREATE FUNCTION pg_temp.settled(p_key text, p_wallet uuid, p_amount bigint, p_pi text, p_escrows uuid[] DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_w finance.wallets;
    v_id uuid;
    v_tx uuid;
BEGIN
    SELECT * INTO v_w FROM finance.wallets WHERE id = p_wallet;
    INSERT INTO finance.inbound_payments (purpose, wallet_id, amount_cents, currency, status, lock_status,
        provider, provider_ref, idempotency_key, created_by)
    VALUES (CASE WHEN p_escrows IS NULL THEN 'wallet_topup' ELSE 'escrow_lock' END, p_wallet, p_amount,
        pg_catalog.upper(v_w.currency), 'processing',
        CASE WHEN p_escrows IS NULL THEN 'not_applicable' ELSE 'pending' END,
        'stripe', p_pi, 'probe-db2-' || p_key, pg_temp.s('payer')::uuid)
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

CREATE FUNCTION pg_temp.escrow(p_id text) RETURNS text LANGUAGE sql AS $$
    SELECT status FROM finance.escrows WHERE id = p_id::uuid;
$$;

CREATE FUNCTION pg_temp.chargeback(p_ref text) RETURNS finance.chargebacks LANGUAGE sql AS $$
    SELECT * FROM finance.chargebacks WHERE provider_ref = p_ref;
$$;

DO $$
DECLARE
    v_e finance.escrows;
    v_bw uuid;
    v_uw finance.wallets;
BEGIN
    SELECT * INTO v_e FROM finance.escrows
     WHERE status = 'held' AND ticket_id IS NOT NULL AND revision_id IS NULL AND payer_business_id IS NOT NULL
     ORDER BY id LIMIT 1;
    IF v_e.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures: no seeded held ticket escrow paid by a business (run deno task db:reset)';
    END IF;
    SELECT w.id INTO v_bw FROM finance.wallets w
     WHERE w.owner_type = 'business' AND w.owner_id = v_e.payer_business_id AND w.currency = v_e.currency;
    SELECT w.* INTO v_uw FROM finance.wallets w
      JOIN auth.users u ON u.id = w.owner_id
     WHERE w.owner_type = 'user' ORDER BY w.id LIMIT 1;
    IF v_bw IS NULL OR v_uw.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixtures: the escrow''s business wallet or a seeded user wallet is missing';
    END IF;
    PERFORM pg_catalog.set_config('probe.escrow', v_e.id::text, true);
    PERFORM pg_catalog.set_config('probe.escrow_amount', v_e.amount_cents::text, true);
    PERFORM pg_catalog.set_config('probe.escrow_currency', pg_catalog.upper(v_e.currency), true);
    PERFORM pg_catalog.set_config('probe.bwallet', v_bw::text, true);
    PERFORM pg_catalog.set_config('probe.uwallet', v_uw.id::text, true);
    PERFORM pg_catalog.set_config('probe.user', v_uw.owner_id::text, true);
    PERFORM pg_catalog.set_config('probe.ucurrency', pg_catalog.upper(v_uw.currency), true);
    PERFORM pg_catalog.set_config('probe.payer', v_uw.owner_id::text, true);
END $$;
-- #endregion

-- #region 1. Closed (won) before created: a resolved case, nothing frozen
SAVEPOINT s_won_first;
DO $$
DECLARE
    v_e text := pg_temp.s('escrow');
    v_amt bigint := pg_temp.s('escrow_amount')::bigint;
    v_cur text := pg_temp.s('escrow_currency');
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_pay uuid := pg_temp.settled('won-first', v_bw, v_amt, 'pi_probe_db2_wonfirst', ARRAY[v_e::uuid]);
    v_bal bigint := pg_temp.bal(v_bw);
    v_lines bigint := pg_temp.lines(v_bw);
    v_out jsonb;
    v_cb finance.chargebacks;
BEGIN
    v_out := finance.record_dispute_closed('evt_probe_db2_1_closed', 'du_probe_db2_1', 'won', false,
        'pi_probe_db2_wonfirst', v_amt, v_cur, 'fraudulent');
    v_cb := pg_temp.chargeback('du_probe_db2_1');
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND (v_out ->> 'late')::boolean
        AND v_cb.status::text = 'won' AND v_cb.resolved_at IS NOT NULL AND v_cb.resolution_note IS NOT NULL
        AND v_cb.transaction_id IS NOT NULL,
        '1 a dispute closed before it was created is recorded resolved, linked to its payment, with a note');

    v_out := finance.record_dispute_opened('evt_probe_db2_1_created', 'du_probe_db2_1', 'pi_probe_db2_wonfirst',
        v_amt, v_cur, 'fraudulent', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed' AND pg_temp.escrow(v_e) = 'held'
        AND (pg_temp.chargeback('du_probe_db2_1')).status::text = 'won',
        '1 the late .created sees it resolved and freezes nothing (the escrow stays held)');

    v_out := finance.record_dispute_closed('evt_probe_db2_1_closed', 'du_probe_db2_1', 'won', false,
        'pi_probe_db2_wonfirst', v_amt, v_cur, 'fraudulent');
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed' AND pg_temp.bal(v_bw) = v_bal
        AND pg_temp.lines(v_bw) = v_lines AND pg_temp.ledger_ok(v_bw),
        '1 replaying either event moves nothing; the ledger identity holds');
    PERFORM pg_temp.ok(
        NOT EXISTS (SELECT 1 FROM finance.escrows e
                      JOIN finance.inbound_payments p ON e.id = ANY (p.locked_escrow_ids)
                     WHERE p.id = v_pay AND e.status = 'disputed'),
        '1 nothing the payment funded is left disputed');
END $$;
ROLLBACK TO SAVEPOINT s_won_first;
-- #endregion

-- #region 2. Closed (lost) before created: refunded and recovered as in order
SAVEPOINT s_lost_first;
DO $$
DECLARE
    v_e text := pg_temp.s('escrow');
    v_amt bigint := pg_temp.s('escrow_amount')::bigint;
    v_cur text := pg_temp.s('escrow_currency');
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_pay uuid := pg_temp.settled('lost-first', v_bw, v_amt, 'pi_probe_db2_lostfirst', ARRAY[v_e::uuid]);
    v_out jsonb;
    v_cb finance.chargebacks;
BEGIN
    v_out := finance.record_dispute_closed('evt_probe_db2_2_closed', 'du_probe_db2_2', 'lost', false,
        'pi_probe_db2_lostfirst', v_amt, v_cur, 'fraudulent');
    v_cb := pg_temp.chargeback('du_probe_db2_2');
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND v_cb.status::text = 'lost'
        AND pg_temp.escrow(v_e) = 'refunded' AND v_cb.unrecovered_cents = 0
        AND (v_out ->> 'recovered_cents')::bigint = v_amt,
        '2 a lost dispute closed first refunds the still-held escrow and recovers the amount in full');
    PERFORM pg_temp.ok(
        EXISTS (SELECT 1 FROM finance.transactions WHERE wallet_id = v_bw AND reason = 'escrow_refund'
                 AND ref_table = 'escrows' AND ref_id = v_e::uuid)
        AND pg_temp.ledger_ok(v_bw),
        '2 the refund and the clawback are ledger lines; the identity holds');

    v_out := finance.record_dispute_opened('evt_probe_db2_2_created', 'du_probe_db2_2', 'pi_probe_db2_lostfirst',
        v_amt, v_cur, 'fraudulent', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed' AND pg_temp.escrow(v_e) = 'refunded'
        AND (pg_temp.chargeback('du_probe_db2_2')).status::text = 'lost',
        '2 the late .created changes nothing');
END $$;
ROLLBACK TO SAVEPOINT s_lost_first;
-- #endregion

-- #region 3. In order, with .updated and the funds events: facts only, no money
SAVEPOINT s_in_order;
DO $$
DECLARE
    v_e text := pg_temp.s('escrow');
    v_amt bigint := pg_temp.s('escrow_amount')::bigint;
    v_cur text := pg_temp.s('escrow_currency');
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_pay uuid := pg_temp.settled('in-order', v_bw, v_amt, 'pi_probe_db2_inorder', ARRAY[v_e::uuid]);
    v_bal bigint;
    v_lines bigint;
    v_out jsonb;
    v_cb finance.chargebacks;
BEGIN
    v_out := finance.record_dispute_opened('evt_probe_db2_3_created', 'du_probe_db2_3', 'pi_probe_db2_inorder',
        v_amt, v_cur, 'fraudulent', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND pg_temp.escrow(v_e) = 'disputed',
        '3 .created freezes the escrow the payment funded');
    v_bal := pg_temp.bal(v_bw);
    v_lines := pg_temp.lines(v_bw);

    v_out := finance.record_dispute_updated('evt_probe_db2_3_upd1', 'charge.dispute.updated', 'du_probe_db2_3',
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent', 'needs_response', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND (pg_temp.chargeback('du_probe_db2_3')).status::text = 'opened',
        '3 an .updated still needing a response changes nothing');

    v_out := finance.record_dispute_updated('evt_probe_db2_3_upd2', 'charge.dispute.updated', 'du_probe_db2_3',
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent', 'under_review', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND (pg_temp.chargeback('du_probe_db2_3')).status::text = 'under_review',
        '3 .updated under review moves the case to under_review');

    v_out := finance.record_dispute_updated('evt_probe_db2_3_upd2', 'charge.dispute.updated', 'du_probe_db2_3',
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent', 'under_review', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed', '3 a redelivered .updated replays');

    v_out := finance.record_dispute_updated('evt_probe_db2_3_upd0', 'charge.dispute.updated', 'du_probe_db2_3',
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent', 'needs_response', false);
    PERFORM pg_temp.ok((pg_temp.chargeback('du_probe_db2_3')).status::text = 'under_review',
        '3 an older .updated arriving late never moves the case back');

    v_out := finance.record_dispute_updated('evt_probe_db2_3_wd', 'charge.dispute.funds_withdrawn', 'du_probe_db2_3',
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent', 'under_review', false);
    v_cb := pg_temp.chargeback('du_probe_db2_3');
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND v_out -> 'recorded' ? 'funds_withdrawn'
        AND v_cb.funds_withdrawn_at IS NOT NULL,
        '3 funds_withdrawn is recorded on the case and reads applied');
    v_out := finance.record_dispute_updated('evt_probe_db2_3_wd', 'charge.dispute.funds_withdrawn', 'du_probe_db2_3',
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent', 'under_review', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed', '3 a redelivered funds_withdrawn replays');

    PERFORM pg_temp.ok(pg_temp.bal(v_bw) = v_bal AND pg_temp.lines(v_bw) = v_lines AND pg_temp.escrow(v_e) = 'disputed',
        '3 .updated and funds_withdrawn move no money and leave the freeze in place');

    v_out := finance.record_dispute_closed('evt_probe_db2_3_closed', 'du_probe_db2_3', 'won', false,
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent');
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND NOT (v_out ->> 'late')::boolean
        AND pg_temp.escrow(v_e) = 'held' AND (pg_temp.chargeback('du_probe_db2_3')).resolution_note IS NULL,
        '3 .closed won from under_review returns the escrow to held');
    v_out := finance.record_dispute_closed('evt_probe_db2_3_closed', 'du_probe_db2_3', 'won', false,
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent');
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed', '3 a redelivered .closed replays');

    v_out := finance.record_dispute_updated('evt_probe_db2_3_ri', 'charge.dispute.funds_reinstated', 'du_probe_db2_3',
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent', 'won', false);
    v_cb := pg_temp.chargeback('du_probe_db2_3');
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND v_cb.funds_reinstated_at IS NOT NULL
        AND v_cb.status::text = 'won',
        '3 funds_reinstated after the win is recorded on the resolved case');
    v_out := finance.record_dispute_updated('evt_probe_db2_3_upd3', 'charge.dispute.updated', 'du_probe_db2_3',
        'pi_probe_db2_inorder', v_amt, v_cur, 'fraudulent', 'under_review', false);
    PERFORM pg_temp.ok((pg_temp.chargeback('du_probe_db2_3')).status::text = 'won',
        '3 a stale .updated never reopens a resolved case');

    PERFORM pg_temp.ok(pg_temp.bal(v_bw) = v_bal AND pg_temp.lines(v_bw) = v_lines AND pg_temp.ledger_ok(v_bw),
        '3 no dispute fact after .created, nor any replay, wrote a ledger line');
END $$;
ROLLBACK TO SAVEPOINT s_in_order;
-- #endregion

-- #region 4. .updated before .created opens the case; a closed dispute's event records nothing
SAVEPOINT s_updated_first;
DO $$
DECLARE
    v_e text := pg_temp.s('escrow');
    v_amt bigint := pg_temp.s('escrow_amount')::bigint;
    v_cur text := pg_temp.s('escrow_currency');
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_pay uuid := pg_temp.settled('updated-first', v_bw, v_amt, 'pi_probe_db2_updfirst', ARRAY[v_e::uuid]);
    v_out jsonb;
BEGIN
    v_out := finance.record_dispute_updated('evt_probe_db2_4_upd', 'charge.dispute.updated', 'du_probe_db2_4',
        'pi_probe_db2_updfirst', v_amt, v_cur, 'fraudulent', 'needs_response', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND v_out -> 'recorded' ? 'opened'
        AND pg_temp.escrow(v_e) = 'disputed' AND (pg_temp.chargeback('du_probe_db2_4')).status::text = 'opened',
        '4 an .updated of an open dispute that arrives first opens the case and freezes the escrow');
    v_out := finance.record_dispute_opened('evt_probe_db2_4_created', 'du_probe_db2_4', 'pi_probe_db2_updfirst',
        v_amt, v_cur, 'fraudulent', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed'
        AND (SELECT pg_catalog.count(*) FROM finance.chargebacks WHERE provider_ref = 'du_probe_db2_4') = 1,
        '4 the late .created finds the case and records no second one');

    v_out := finance.record_dispute_updated('evt_probe_db2_4_ri', 'charge.dispute.funds_reinstated', 'du_probe_db2_4x',
        'pi_probe_db2_updfirst', v_amt, v_cur, 'fraudulent', 'won', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'unmatched' AND pg_temp.chargeback('du_probe_db2_4x') IS NULL,
        '4 an event of a dispute Stripe has already closed records no case (.closed will)');
END $$;
ROLLBACK TO SAVEPOINT s_updated_first;
-- #endregion

-- #region 5. A won thaw that collides with a newer held escrow: disputed, noted, logged, no raise
SAVEPOINT s_thaw_collision;
DO $$
DECLARE
    v_e finance.escrows;
    v_amt bigint := pg_temp.s('escrow_amount')::bigint;
    v_cur text := pg_temp.s('escrow_currency');
    v_bw uuid := pg_temp.s('bwallet')::uuid;
    v_pay uuid;
    v_e2 uuid;
    v_out jsonb;
    v_cb finance.chargebacks;
BEGIN
    SELECT * INTO v_e FROM finance.escrows WHERE id = pg_temp.s('escrow')::uuid;
    v_pay := pg_temp.settled('thaw', v_bw, v_amt, 'pi_probe_db2_thaw', ARRAY[v_e.id]);
    PERFORM finance.record_dispute_opened('evt_probe_db2_5_created', 'du_probe_db2_5', 'pi_probe_db2_thaw',
        v_amt, v_cur, 'fraudulent', false);
    INSERT INTO finance.escrows (project_stage_id, ticket_id, payer_business_id, payee_type, payee_id,
        amount_cents, currency, status)
    VALUES (v_e.project_stage_id, v_e.ticket_id, v_e.payer_business_id, v_e.payee_type, v_e.payee_id,
        v_e.amount_cents, v_e.currency, 'held')
    RETURNING id INTO v_e2;

    v_out := finance.record_dispute_closed('evt_probe_db2_5_closed', 'du_probe_db2_5', 'won', false,
        'pi_probe_db2_thaw', v_amt, v_cur, 'fraudulent');
    v_cb := pg_temp.chargeback('du_probe_db2_5');
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND v_out -> 'still_disputed_escrow_ids' ? v_e.id::text
        AND pg_temp.escrow(v_e.id::text) = 'disputed' AND pg_temp.escrow(v_e2::text) = 'held'
        AND v_cb.status::text = 'won' AND v_cb.resolution_note LIKE '%' || v_e.id::text || '%',
        '5 the colliding escrow stays disputed, the newer one held, and the case says why');
    PERFORM pg_temp.ok(EXISTS (
        SELECT 1 FROM ops.log_entries
         WHERE scope = 'finance.record_dispute_closed' AND client_id = 'chargeback:' || v_cb.id::text
           AND level = 'error'),
        '5 one ops row asks a human to settle the stuck escrow');
END $$;
ROLLBACK TO SAVEPOINT s_thaw_collision;
-- #endregion

-- #region 6. charge.refunded: cumulative totals, replays and out-of-order totals
SAVEPOINT s_refund;
DO $$
DECLARE
    v_uw uuid := pg_temp.s('uwallet')::uuid;
    v_cur text := pg_temp.s('ucurrency');
    v_pay uuid := pg_temp.settled('refund', v_uw, 2000, 'pi_probe_db2_refund');
    v_bal bigint := pg_temp.bal(v_uw);
    v_out jsonb;
BEGIN
    v_out := finance.record_charge_refunded('evt_probe_db2_6_a', 'pi_probe_db2_refund', 5, v_cur, 're_probe_1', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND (v_out ->> 'debited_cents')::bigint = 5
        AND pg_temp.bal(v_uw) = v_bal - 5,
        '6 a refund of 5 debits 5');
    v_out := finance.record_charge_refunded('evt_probe_db2_6_a', 'pi_probe_db2_refund', 5, v_cur, 're_probe_1', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed' AND pg_temp.bal(v_uw) = v_bal - 5,
        '6 its replay debits nothing');
    v_out := finance.record_charge_refunded('evt_probe_db2_6_b', 'pi_probe_db2_refund', 8, v_cur, 're_probe_2', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND (v_out ->> 'debited_cents')::bigint = 3
        AND pg_temp.bal(v_uw) = v_bal - 8,
        '6 a second refund, 8 cumulative, debits 3');
    v_out := finance.record_charge_refunded('evt_probe_db2_6_c', 'pi_probe_db2_refund', 5, v_cur, 're_probe_1', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND (v_out ->> 'debited_cents')::bigint = 0
        AND pg_temp.bal(v_uw) = v_bal - 8,
        '6 an older, lower total delivered late debits nothing');
    PERFORM pg_temp.ok(
        (SELECT refunded_cents FROM finance.inbound_payments WHERE id = v_pay) = 8
        AND (SELECT pg_catalog.array_agg(amount_cents ORDER BY created_at) FROM finance.transactions
              WHERE ref_table = 'inbound_payments' AND ref_id = v_pay AND direction = 'debit' AND reason = 'refund')
            = ARRAY[5, 3]::bigint[]
        AND pg_temp.ledger_ok(v_uw),
        '6 the payment records 8 refunded as two refund lines (5, 3); the identity holds');
END $$;
ROLLBACK TO SAVEPOINT s_refund;
-- #endregion

-- #region 7. A refund the wallet cannot cover: debit what is there, record the rest
SAVEPOINT s_refund_short;
DO $$
DECLARE
    v_uw finance.wallets;
    v_cur text := pg_temp.s('ucurrency');
    v_pay uuid;
    v_out jsonb;
    v_p finance.inbound_payments;
BEGIN
    v_pay := pg_temp.settled('short', pg_temp.s('uwallet')::uuid, 1000, 'pi_probe_db2_short');
    SELECT * INTO v_uw FROM finance.wallets WHERE id = pg_temp.s('uwallet')::uuid;
    PERFORM finance.fn_wallet_debit(v_uw.owner_id, v_uw.owner_type, v_uw.currency, v_uw.balance_cents - 100,
        'order_payment', NULL, NULL);
    v_out := finance.record_charge_refunded('evt_probe_db2_7', 'pi_probe_db2_short', 1000, v_cur, NULL, false);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_pay;
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND (v_out ->> 'debited_cents')::bigint = 100
        AND (v_out ->> 'unrecovered_cents')::bigint = 900 AND pg_temp.bal(v_uw.id) = 0
        AND v_p.refunded_cents = 1000 AND v_p.refund_unrecovered_cents = 900 AND pg_temp.ledger_ok(v_uw.id),
        '7 the wallet pays what it holds (100); 900 is recorded unrecovered, never a negative balance');
    PERFORM pg_temp.ok(EXISTS (
        SELECT 1 FROM ops.log_entries
         WHERE scope = 'finance.record_charge_refunded' AND client_id = 'stripe:evt_probe_db2_7' AND level = 'error'),
        '7 the shortfall is written to ops');
END $$;
ROLLBACK TO SAVEPOINT s_refund_short;
-- #endregion

-- #region 8. Refunds that cannot be ledgered yet, or ever
SAVEPOINT s_refund_unsettled;
DO $$
DECLARE
    v_uw uuid := pg_temp.s('uwallet')::uuid;
    v_cur text := pg_temp.s('ucurrency');
    v_bal bigint := pg_temp.bal(v_uw);
    v_pay uuid;
    v_out jsonb;
BEGIN
    INSERT INTO finance.inbound_payments (purpose, wallet_id, amount_cents, currency, status, lock_status,
        provider, provider_ref, idempotency_key, created_by)
    VALUES ('wallet_topup', v_uw, 700, v_cur, 'processing', 'not_applicable', 'stripe',
        'pi_probe_db2_unsettled', 'probe-db2-unsettled', pg_temp.s('payer')::uuid)
    RETURNING id INTO v_pay;

    v_out := finance.record_charge_refunded('evt_probe_db2_8_a', 'pi_probe_db2_unsettled', 700, v_cur, NULL, false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'unmatched' AND (v_out ->> 'retry')::boolean
        AND NOT EXISTS (SELECT 1 FROM finance.idempotency_keys WHERE key = 'stripe:evt_probe_db2_8_a')
        AND pg_temp.bal(v_uw) = v_bal,
        '8 a refund of an unsettled payment releases its claim for Stripe''s retry and moves nothing');

    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES ('stripe:evt_probe_db2_8_mismatch', 'stripe.webhook', 'x', 'succeeded',
        pg_catalog.jsonb_build_object('outcome', 'unmatched', 'reconciliation', 'settlement_mismatch',
            'payment_id', v_pay), pg_catalog.now() + interval '30 days');
    v_out := finance.record_charge_refunded('evt_probe_db2_8_b', 'pi_probe_db2_unsettled', 700, v_cur, NULL, false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'unmatched' AND v_out ->> 'retry' IS NULL
        AND EXISTS (SELECT 1 FROM finance.idempotency_keys WHERE key = 'stripe:evt_probe_db2_8_b')
        AND EXISTS (SELECT 1 FROM ops.log_entries WHERE client_id = 'stripe:evt_probe_db2_8_b')
        AND pg_temp.bal(v_uw) = v_bal,
        '8 a refund of a payment held for reconciliation debits nothing, is not retried, and tells ops');

    v_out := finance.record_charge_refunded('evt_probe_db2_8_c', 'pi_probe_db2_unknown', 700, v_cur, NULL, false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'unmatched' AND pg_temp.bal(v_uw) = v_bal,
        '8 a refund of a charge Projective did not create is unmatched');
END $$;
ROLLBACK TO SAVEPOINT s_refund_unsettled;
-- #endregion

-- #region 9. payout.canceled: the bank outcome, no money
SAVEPOINT s_payout_canceled;
DO $$
DECLARE
    v_uw uuid := pg_temp.s('uwallet')::uuid;
    v_user uuid := pg_temp.s('user')::uuid;
    v_payout uuid;
    v_bal bigint;
    v_lines bigint;
    v_out jsonb;
    v_p finance.payouts;
BEGIN
    DELETE FROM finance.payout_accounts WHERE owner_id = v_user;
    INSERT INTO finance.payout_accounts (owner_type, owner_id, provider, account_id, status)
    VALUES ('user', v_user, 'stripe', 'acct_probe_db2', 'verified');
    INSERT INTO finance.payouts (wallet_id, amount_cents, currency, status, provider, provider_ref, settled_at,
        destination_account)
    VALUES (v_uw, 1500, pg_temp.s('ucurrency'), 'paid', 'stripe', 'tr_probe_db2', pg_catalog.now(), 'acct_probe_db2')
    RETURNING id INTO v_payout;
    v_bal := pg_temp.bal(v_uw);
    v_lines := pg_temp.lines(v_uw);

    v_out := finance.record_bank_payout('evt_probe_db2_9_c', 'payout.canceled', 'acct_probe_db2', 'po_probe_db2_c',
        'canceled', NULL, ARRAY['tr_probe_db2'], '{}', false);
    SELECT * INTO v_p FROM finance.payouts WHERE id = v_payout;
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'applied' AND v_p.bank_status = 'canceled'
        AND v_p.bank_payout_ref = 'po_probe_db2_c' AND v_p.bank_failure_code IS NULL AND v_p.status::text = 'paid',
        '9 payout.canceled records the bank outcome on the payout it carried');
    PERFORM pg_temp.ok(pg_temp.bal(v_uw) = v_bal AND pg_temp.lines(v_uw) = v_lines AND pg_temp.ledger_ok(v_uw),
        '9 payout.canceled moves no money');
    PERFORM pg_temp.ok(EXISTS (
        SELECT 1 FROM comms.notifications
         WHERE user_id = v_user AND type = 'payout.failed' AND entity_id = v_payout),
        '9 the owner is told');

    v_out := finance.record_bank_payout('evt_probe_db2_9_c', 'payout.canceled', 'acct_probe_db2', 'po_probe_db2_c',
        'canceled', NULL, ARRAY['tr_probe_db2'], '{}', false);
    PERFORM pg_temp.ok(v_out ->> 'outcome' = 'replayed', '9 its replay changes nothing');

    v_out := finance.record_bank_payout('evt_probe_db2_9_p', 'payout.paid', 'acct_probe_db2', 'po_probe_db2_c',
        'paid', NULL, ARRAY['tr_probe_db2'], '{}', false);
    PERFORM pg_temp.ok((SELECT bank_status FROM finance.payouts WHERE id = v_payout) = 'canceled',
        '9 a late paid for the cancelled bank payout changes nothing');

    v_out := finance.record_bank_payout('evt_probe_db2_9_r', 'payout.paid', 'acct_probe_db2', 'po_probe_db2_r',
        'paid', NULL, '{}', ARRAY['po_probe_db2_c'], false);
    PERFORM pg_temp.ok((SELECT bank_status = 'paid' AND bank_payout_ref = 'po_probe_db2_r'
                          FROM finance.payouts WHERE id = v_payout)
        AND pg_temp.bal(v_uw) = v_bal AND pg_temp.lines(v_uw) = v_lines,
        '9 a later bank payout that re-pays it marks it paid, still without a ledger line');
END $$;
ROLLBACK TO SAVEPOINT s_payout_canceled;
-- #endregion

ROLLBACK;
