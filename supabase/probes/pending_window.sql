-- =============================================================================================
-- Probe: earned credits clear the 7-day pending window before they reach the available balance
-- (finance.pending_releases, finance.fn_wallet_credit_pending, finance.fn_mature_pending_releases,
-- the lost-chargeback recovery in finance.record_dispute_closed) — Decision #191.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/pending_window.sql
--
-- A clean run prints only PASS notices. Without ON_ERROR_STOP, ON_ERROR_ROLLBACK keeps the run going
-- past a failed check, so every failing check is reported rather than the first. Fixtures come from
-- the seed (deno task db:reset): a ticket holding escrow for an individual payee.
-- =============================================================================================

\set ON_ERROR_ROLLBACK on
BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_ticket uuid;
    v_payee uuid;
    v_currency text;
    v_type text;
    v_wallet uuid;
    v_expected bigint;
BEGIN
    SELECT e.ticket_id, e.payee_id, e.currency INTO v_ticket, v_payee, v_currency
      FROM finance.escrows e
     WHERE e.status = 'held' AND e.ticket_id IS NOT NULL AND e.payee_type <> 'team'::assignment_type
       AND NOT EXISTS (
            SELECT 1 FROM finance.escrows o
             WHERE o.ticket_id = e.ticket_id AND o.status = 'held'
               AND (o.payee_type = 'team'::assignment_type OR o.payee_id <> e.payee_id OR o.currency <> e.currency))
     ORDER BY e.created_at
     LIMIT 1;
    IF v_ticket IS NULL THEN
        RAISE EXCEPTION 'FAIL fixtures: no ticket holds escrow for an individual payee (run deno task db:reset)';
    END IF;

    v_type := finance.fn_person_wallet_type(v_payee);
    PERFORM finance.fn_ensure_wallet(v_type, v_payee, v_currency);
    SELECT id INTO v_wallet FROM finance.wallets
     WHERE owner_type = v_type AND owner_id = v_payee AND currency = v_currency;

    SELECT pg_catalog.sum(GREATEST(e.amount_cents + COALESCE(e.deadline_bonus_cents, 0)
             - (e.amount_cents * finance.fn_escrow_fee_bp(e.payer_business_id, e.payer_user_id)) / 10000, 0))
      INTO v_expected
      FROM finance.escrows e WHERE e.ticket_id = v_ticket AND e.status = 'held';

    PERFORM pg_catalog.set_config('probe.ticket', v_ticket::text, true);
    PERFORM pg_catalog.set_config('probe.wallet', v_wallet::text, true);
    PERFORM pg_catalog.set_config('probe.expected', v_expected::text, true);
    PERFORM pg_catalog.set_config('probe.balance_before',
        (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet)::text, true);
    RAISE NOTICE 'fixture ticket=% wallet=% expected_payout=%', v_ticket, v_wallet, v_expected;
END $$;
-- #endregion

-- #region 1. A release lands in the pending window, not in the available balance
SAVEPOINT s_release;
DO $$
DECLARE
    v_wallet uuid := pg_catalog.current_setting('probe.wallet')::uuid;
    v_before bigint := pg_catalog.current_setting('probe.balance_before')::bigint;
    v_expected bigint := pg_catalog.current_setting('probe.expected')::bigint;
    v_balance bigint;
    v_pending bigint;
    v_days integer;
    v_off integer;
BEGIN
    PERFORM finance.fn_release_ticket_escrow(pg_catalog.current_setting('probe.ticket')::uuid);
    SELECT balance_cents INTO v_balance FROM finance.wallets WHERE id = v_wallet;
    IF v_balance <> v_before THEN
        RAISE EXCEPTION 'FAIL release: available balance moved % -> % (a release must not be withdrawable at once)',
            v_before, v_balance;
    END IF;
    RAISE NOTICE 'PASS release leaves the available balance at %', v_balance;

    SELECT COALESCE(pg_catalog.sum(amount_cents), 0) INTO v_pending
      FROM finance.pending_releases WHERE wallet_id = v_wallet AND state = 'pending'
       AND released_at = pg_catalog.now();
    IF v_pending <> v_expected THEN
        RAISE EXCEPTION 'FAIL release: % pending in the window, expected %', v_pending, v_expected;
    END IF;
    RAISE NOTICE 'PASS release opened % pending', v_pending;

    v_days := COALESCE((SELECT (value #>> '{}')::integer FROM security.platform_params WHERE key = 'pending_release_days'), 7);
    SELECT pg_catalog.count(*) INTO v_off FROM finance.pending_releases
     WHERE wallet_id = v_wallet AND released_at = pg_catalog.now()
       AND available_at <> pg_catalog.now() + pg_catalog.make_interval(days => v_days);
    IF v_off > 0 THEN
        RAISE EXCEPTION 'FAIL release: % pending rows do not clear after % days', v_off, v_days;
    END IF;
    RAISE NOTICE 'PASS release clears after % days', v_days;
END $$;
RELEASE SAVEPOINT s_release;
-- #endregion

-- #region 1b. A team release splits into pending shares that conserve the payout, moving no balance
SAVEPOINT s_team;
DO $$
DECLARE
    v_ticket uuid;
    v_escrows uuid[];
    v_payout bigint;
    v_pending bigint;
    v_balances bigint;
    v_after bigint;
BEGIN
    SELECT e.ticket_id INTO v_ticket FROM finance.escrows e
     WHERE e.status = 'held' AND e.ticket_id IS NOT NULL AND e.payee_type = 'team'::assignment_type
     ORDER BY e.created_at LIMIT 1;
    IF v_ticket IS NULL THEN
        RAISE NOTICE 'SKIP team release: no ticket holds escrow for a team';
        RETURN;
    END IF;
    SELECT pg_catalog.array_agg(e.id),
           pg_catalog.sum(GREATEST(e.amount_cents + COALESCE(e.deadline_bonus_cents, 0)
               - (e.amount_cents * finance.fn_escrow_fee_bp(e.payer_business_id, e.payer_user_id)) / 10000, 0))
      INTO v_escrows, v_payout
      FROM finance.escrows e WHERE e.ticket_id = v_ticket AND e.status = 'held';
    SELECT COALESCE(pg_catalog.sum(balance_cents), 0) INTO v_balances FROM finance.wallets;

    PERFORM finance.fn_release_ticket_escrow(v_ticket);

    SELECT COALESCE(pg_catalog.sum(amount_cents), 0) INTO v_pending
      FROM finance.pending_releases WHERE escrow_id = ANY (v_escrows);
    SELECT COALESCE(pg_catalog.sum(balance_cents), 0) INTO v_after FROM finance.wallets;
    IF v_pending <> v_payout OR v_after <> v_balances THEN
        RAISE EXCEPTION 'FAIL team release: % pending of a % payout, wallet total % -> %', v_pending, v_payout, v_balances, v_after;
    END IF;
    RAISE NOTICE 'PASS team release: % pending across % rows, no balance moved', v_pending,
        (SELECT pg_catalog.count(*) FROM finance.pending_releases WHERE escrow_id = ANY (v_escrows));
END $$;
ROLLBACK TO SAVEPOINT s_team;
RELEASE SAVEPOINT s_team;
-- #endregion

-- #region 2. Every earned-credit door routes through the pending window
SAVEPOINT s_doors;
DO $$
DECLARE
    v_door text;
    v_missing text[] := '{}';
BEGIN
    FOREACH v_door IN ARRAY ARRAY[
        'fn_release_ticket_escrow', 'fn_fair_exit_release', 'fn_split_team_payout',
        'fn_release_seat_escrow', 'place_wallet_order'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
              JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'finance' AND p.proname = v_door
               AND p.prosrc LIKE '%fn_wallet_credit_pending%'
        ) THEN
            v_missing := v_missing || v_door;
        END IF;
    END LOOP;
    IF pg_catalog.cardinality(v_missing) > 0 THEN
        RAISE EXCEPTION 'FAIL doors: % still credit earnings straight to available', v_missing;
    END IF;
    RAISE NOTICE 'PASS every earned-credit door credits through the pending window';
END $$;
RELEASE SAVEPOINT s_doors;
-- #endregion

-- #region 3. A lost chargeback recovers from the payer's pending money before their available balance
SAVEPOINT s_claw;
DO $$
DECLARE
    v_wallet uuid := pg_catalog.current_setting('probe.wallet')::uuid;
    v_pending bigint;
    v_balance bigint;
    v_case uuid;
    v_recovered bigint;
    v_after_pending bigint;
    v_after_balance bigint;
BEGIN
    SELECT COALESCE(pg_catalog.sum(amount_cents - recovered_cents), 0) INTO v_pending
      FROM finance.pending_releases WHERE wallet_id = v_wallet AND state = 'pending';
    SELECT balance_cents INTO v_balance FROM finance.wallets WHERE id = v_wallet;
    IF v_pending < 2 THEN
        RAISE EXCEPTION 'FAIL clawback: the release above opened no pending money to recover from';
    END IF;

    INSERT INTO finance.chargebacks (wallet_id, provider_ref, amount_cents, currency)
    SELECT v_wallet, 'dp_probe_191_a', v_pending / 2, w.currency FROM finance.wallets w WHERE w.id = v_wallet
    RETURNING id INTO v_case;
    PERFORM finance.record_dispute_closed('evt_probe_191_a', 'dp_probe_191_a', 'lost', false);

    SELECT COALESCE(pg_catalog.sum(amount_cents - recovered_cents), 0) INTO v_after_pending
      FROM finance.pending_releases WHERE wallet_id = v_wallet AND state = 'pending';
    SELECT balance_cents INTO v_after_balance FROM finance.wallets WHERE id = v_wallet;
    IF v_after_pending <> v_pending - v_pending / 2 OR v_after_balance <> v_balance THEN
        RAISE EXCEPTION 'FAIL clawback: pending % -> %, available % -> % (expected pending to fall by %, available unchanged)',
            v_pending, v_after_pending, v_balance, v_after_balance, v_pending / 2;
    END IF;
    SELECT unrecovered_cents INTO v_recovered FROM finance.chargebacks WHERE id = v_case;
    IF v_recovered <> 0 THEN
        RAISE EXCEPTION 'FAIL clawback: % unrecovered although pending covered it', v_recovered;
    END IF;
    RAISE NOTICE 'PASS lost chargeback took % from pending, available untouched', v_pending / 2;

    INSERT INTO finance.chargebacks (wallet_id, provider_ref, amount_cents, currency)
    SELECT v_wallet, 'dp_probe_191_b', v_after_pending + 1, w.currency FROM finance.wallets w WHERE w.id = v_wallet
    RETURNING id INTO v_case;
    PERFORM finance.record_dispute_closed('evt_probe_191_b', 'dp_probe_191_b', 'lost', false);
    SELECT COALESCE(pg_catalog.sum(amount_cents - recovered_cents), 0) INTO v_pending
      FROM finance.pending_releases WHERE wallet_id = v_wallet AND state = 'pending';
    SELECT balance_cents INTO v_balance FROM finance.wallets WHERE id = v_wallet;
    SELECT unrecovered_cents INTO v_recovered FROM finance.chargebacks WHERE id = v_case;
    IF v_pending <> 0 OR v_balance <> GREATEST(v_after_balance - 1, 0)
       OR v_recovered <> 1 - LEAST(v_after_balance, 1) THEN
        RAISE EXCEPTION 'FAIL clawback overflow: pending %, available % (was %), unrecovered %',
            v_pending, v_balance, v_after_balance, v_recovered;
    END IF;
    RAISE NOTICE 'PASS a chargeback beyond pending empties pending, then takes the rest from available';
END $$;
ROLLBACK TO SAVEPOINT s_claw;
RELEASE SAVEPOINT s_claw;
-- #endregion

-- #region 4. Matured rows move to available with one ledger credit each, exactly once
SAVEPOINT s_mature;
DO $$
DECLARE
    v_wallet uuid := pg_catalog.current_setting('probe.wallet')::uuid;
    v_before bigint;
    v_after bigint;
    v_due bigint;
    v_rows integer;
    v_moved integer;
    v_again integer;
    v_credits integer;
    v_ledger_before bigint;
    v_ledger bigint;
BEGIN
    SELECT balance_cents INTO v_before FROM finance.wallets WHERE id = v_wallet;
    SELECT COALESCE(pg_catalog.sum(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0)
      INTO v_ledger_before FROM finance.transactions t WHERE t.wallet_id = v_wallet;
    SELECT COALESCE(pg_catalog.sum(amount_cents - recovered_cents), 0), pg_catalog.count(*) INTO v_due, v_rows
      FROM finance.pending_releases WHERE wallet_id = v_wallet AND state = 'pending';
    UPDATE finance.pending_releases
       SET released_at = pg_catalog.now() - interval '8 days', available_at = pg_catalog.now() - interval '1 minute'
     WHERE wallet_id = v_wallet AND state = 'pending';

    v_moved := finance.fn_mature_pending_releases(500);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_after <> v_before + v_due THEN
        RAISE EXCEPTION 'FAIL mature: available % -> %, expected +%', v_before, v_after, v_due;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.pending_releases WHERE wallet_id = v_wallet AND state = 'pending') THEN
        RAISE EXCEPTION 'FAIL mature: matured rows are still pending';
    END IF;
    SELECT pg_catalog.count(*) INTO v_credits
      FROM finance.pending_releases pr
      JOIN finance.transactions t ON t.id = pr.transaction_id
     WHERE pr.wallet_id = v_wallet AND pr.matured_at IS NOT NULL AND pr.state = 'available'
       AND t.direction = 'credit' AND t.reason = pr.reason AND t.amount_cents = pr.amount_cents - pr.recovered_cents
       AND t.ref_table = 'escrows' AND t.ref_id = pr.escrow_id AND t.fund_state = 'available';
    IF v_credits <> v_rows THEN
        RAISE EXCEPTION 'FAIL mature: % of % matured rows carry their ledger credit', v_credits, v_rows;
    END IF;
    RAISE NOTICE 'PASS % rows matured (% swept this run), +% available, one ledger credit each', v_rows, v_moved, v_due;

    v_again := finance.fn_mature_pending_releases(500);
    SELECT balance_cents INTO v_after FROM finance.wallets WHERE id = v_wallet;
    IF v_after <> v_before + v_due THEN
        RAISE EXCEPTION 'FAIL mature replay: a second sweep moved the balance to %', v_after;
    END IF;
    RAISE NOTICE 'PASS a second sweep credits nothing twice (% swept)', v_again;

    SELECT COALESCE(pg_catalog.sum(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0)
      INTO v_ledger FROM finance.transactions t WHERE t.wallet_id = v_wallet;
    IF v_ledger - v_ledger_before <> v_after - v_before THEN
        RAISE EXCEPTION 'FAIL reconcile: balance moved % but the ledger moved %', v_after - v_before, v_ledger - v_ledger_before;
    END IF;
    RAISE NOTICE 'PASS the ledger moved exactly as the available balance did (%)', v_ledger - v_ledger_before;
END $$;
RELEASE SAVEPOINT s_mature;
-- #endregion

ROLLBACK;
