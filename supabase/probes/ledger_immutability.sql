-- =============================================================================================
-- Probe: the append-only ledger (finance.transactions), loud wallet primitives
-- (finance.fn_wallet_credit / fn_wallet_debit) and nightly drift detection
-- (finance.fn_reconcile_wallets) — Decision #186.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/ledger_immutability.sql
--
-- Every expected refusal is asserted: a write that SUCCEEDS where it must be refused raises
-- `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP). A clean run prints only PASS
-- notices. Each check sits between a SAVEPOINT and a ROLLBACK TO, so running WITHOUT ON_ERROR_STOP
-- reports every failing check rather than the first. Fixtures come from the seed (deno task db:reset).
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- Three wallets that reconcile today: A carries ledger rows (the immutability target), B and C are
-- the drift subjects. Picked from the data, so the run never depends on a hard-coded id.
DO $$
DECLARE
    v_ids uuid[];
BEGIN
    SELECT pg_catalog.array_agg(id ORDER BY has_rows DESC, id) INTO v_ids
      FROM (
        SELECT w.id, EXISTS (SELECT 1 FROM finance.transactions t WHERE t.wallet_id = w.id) AS has_rows
          FROM finance.wallets w
         WHERE w.balance_cents = COALESCE((
                SELECT pg_catalog.sum(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END)
                  FROM finance.transactions t WHERE t.wallet_id = w.id), 0)
           AND w.balance_cents = COALESCE((
                SELECT t.balance_after_cents FROM finance.transactions t
                 WHERE t.wallet_id = w.id ORDER BY t.created_at DESC, t.id DESC LIMIT 1), 0)
      ) clean;
    IF pg_catalog.cardinality(v_ids) < 3 THEN
        RAISE EXCEPTION 'FAIL fixtures: need three reconciling wallets, found %', COALESCE(pg_catalog.cardinality(v_ids), 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.transactions WHERE wallet_id = v_ids[1]) THEN
        RAISE EXCEPTION 'FAIL fixtures: no wallet with ledger rows (run deno task db:reset)';
    END IF;
    PERFORM pg_catalog.set_config('probe.wallet_a', v_ids[1]::text, true);
    PERFORM pg_catalog.set_config('probe.wallet_b', v_ids[2]::text, true);
    PERFORM pg_catalog.set_config('probe.wallet_c', v_ids[3]::text, true);
    PERFORM pg_catalog.set_config('probe.tx_a',
        (SELECT id FROM finance.transactions WHERE wallet_id = v_ids[1] ORDER BY created_at LIMIT 1)::text, true);
    RAISE NOTICE 'fixture wallet_a=% wallet_b=% wallet_c=%', v_ids[1], v_ids[2], v_ids[3];
END $$;
-- #endregion

-- #region 1. The ledger refuses UPDATE / DELETE / TRUNCATE — for every role, the owner included
SAVEPOINT s_update;
DO $$
BEGIN
    BEGIN
        UPDATE finance.transactions SET amount_cents = amount_cents + 1
         WHERE id = pg_catalog.current_setting('probe.tx_a')::uuid;
    EXCEPTION WHEN SQLSTATE 'PL403' THEN
        RAISE NOTICE 'PASS UPDATE finance.transactions refused (PL403)';
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL UPDATE finance.transactions succeeded — the ledger is mutable';
END $$;
ROLLBACK TO SAVEPOINT s_update;

SAVEPOINT s_delete;
DO $$
BEGIN
    BEGIN
        DELETE FROM finance.transactions WHERE id = pg_catalog.current_setting('probe.tx_a')::uuid;
    EXCEPTION WHEN SQLSTATE 'PL403' THEN
        RAISE NOTICE 'PASS DELETE finance.transactions refused (PL403)';
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL DELETE finance.transactions succeeded — a ledger row can vanish';
END $$;
ROLLBACK TO SAVEPOINT s_delete;

SAVEPOINT s_truncate;
DO $$
BEGIN
    BEGIN
        TRUNCATE finance.transactions CASCADE;
    EXCEPTION WHEN SQLSTATE 'PL403' THEN
        RAISE NOTICE 'PASS TRUNCATE finance.transactions refused (PL403)';
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL TRUNCATE finance.transactions succeeded — row triggers do not see TRUNCATE';
END $$;
ROLLBACK TO SAVEPOINT s_truncate;

-- The service role — the backend's trusted door — is refused too, by grant or by trigger.
SAVEPOINT s_service;
DO $$
BEGIN
    SET LOCAL ROLE service_role;
    BEGIN
        UPDATE finance.transactions SET reason = 'probe'
         WHERE id = pg_catalog.current_setting('probe.tx_a')::uuid;
    EXCEPTION WHEN SQLSTATE 'PL403' OR insufficient_privilege THEN
        RESET ROLE;
        RAISE NOTICE 'PASS service_role UPDATE finance.transactions refused (%)', SQLSTATE;
        RETURN;
    END;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL service_role UPDATE finance.transactions succeeded';
END $$;
ROLLBACK TO SAVEPOINT s_service;

-- Deleting a wallet that carries ledger rows is refused by the foreign key itself (ON DELETE
-- RESTRICT), not merely by the trigger a CASCADE would trip.
SAVEPOINT s_wallet_delete;
DO $$
BEGIN
    BEGIN
        DELETE FROM finance.wallets WHERE id = pg_catalog.current_setting('probe.wallet_a')::uuid;
    EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'PASS DELETE finance.wallets with ledger rows refused (23503)';
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL DELETE finance.wallets succeeded (or was refused for another reason)';
END $$;
ROLLBACK TO SAVEPOINT s_wallet_delete;
-- #endregion

-- #region 2. Credit / debit to a missing wallet raise PW404 instead of returning silently
SAVEPOINT s_credit_missing;
DO $$
DECLARE
    v_owner uuid := pg_catalog.gen_random_uuid();
BEGIN
    BEGIN
        PERFORM finance.fn_wallet_credit(v_owner, 'user', 'USD', 1234, 'topup', 'inbound_payments', pg_catalog.gen_random_uuid());
    EXCEPTION WHEN SQLSTATE 'PW404' THEN
        RAISE NOTICE 'PASS fn_wallet_credit to a missing wallet raised PW404';
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL fn_wallet_credit to a missing wallet returned silently — the money vanished';
END $$;
ROLLBACK TO SAVEPOINT s_credit_missing;

SAVEPOINT s_debit_missing;
DO $$
DECLARE
    v_owner uuid := pg_catalog.gen_random_uuid();
BEGIN
    BEGIN
        PERFORM finance.fn_wallet_debit(v_owner, 'business', 'USD', 1234, 'escrow_hold', 'escrows', pg_catalog.gen_random_uuid());
    EXCEPTION WHEN SQLSTATE 'PW404' THEN
        RAISE NOTICE 'PASS fn_wallet_debit from a missing wallet raised PW404';
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL fn_wallet_debit from a missing wallet returned silently';
END $$;
ROLLBACK TO SAVEPOINT s_debit_missing;

-- A wallet created by fn_ensure_wallet first takes the credit, and the row it appends reconciles.
SAVEPOINT s_credit_ensured;
DO $$
DECLARE
    v_owner uuid := pg_catalog.gen_random_uuid();
    v_wallet uuid;
    v_row finance.transactions;
BEGIN
    v_wallet := finance.fn_ensure_wallet('user', v_owner, 'usd');
    PERFORM finance.fn_wallet_credit(v_owner, 'user', 'USD', 1234, 'topup', 'inbound_payments', pg_catalog.gen_random_uuid());
    SELECT * INTO v_row FROM finance.transactions WHERE wallet_id = v_wallet;
    IF v_row.id IS NULL OR v_row.balance_after_cents <> 1234
       OR (SELECT balance_cents FROM finance.wallets WHERE id = v_wallet) <> 1234 THEN
        RAISE EXCEPTION 'FAIL ensured credit: row % balance_after %', v_row.id, v_row.balance_after_cents;
    END IF;
    RAISE NOTICE 'PASS fn_ensure_wallet then fn_wallet_credit appends a reconciling row';
END $$;
ROLLBACK TO SAVEPOINT s_credit_ensured;
-- #endregion

-- #region 3. Reconciliation flags injected drift, and only the drift
SAVEPOINT s_reconcile;
DO $$
DECLARE
    v_a uuid := pg_catalog.current_setting('probe.wallet_a')::uuid;
    v_b uuid := pg_catalog.current_setting('probe.wallet_b')::uuid;
    v_c uuid := pg_catalog.current_setting('probe.wallet_c')::uuid;
    v_w finance.wallets;
    v_baseline integer;
    v_flagged integer;
    v_row jsonb;
BEGIN
    v_baseline := finance.fn_reconcile_wallets();

    -- A: an honest movement through the primitive — must NOT be flagged.
    SELECT * INTO v_w FROM finance.wallets WHERE id = v_a;
    PERFORM finance.fn_wallet_credit(v_w.owner_id, v_w.owner_type, v_w.currency, 500, 'probe_credit', NULL, NULL);

    -- B: the cached balance moved without a ledger row (the drift the job exists for).
    UPDATE finance.wallets SET balance_cents = balance_cents + 700 WHERE id = v_b;

    -- C: the cache and the ledger SUM agree, but the newest row stamps the wrong running balance.
    UPDATE finance.wallets SET balance_cents = balance_cents + 300 WHERE id = v_c RETURNING * INTO v_w;
    INSERT INTO finance.transactions (wallet_id, direction, amount_cents, currency, reason, balance_after_cents)
    VALUES (v_c, 'credit', 300, v_w.currency, 'probe_misstamped', v_w.balance_cents + 1);

    v_flagged := finance.fn_reconcile_wallets();
    IF v_flagged <> v_baseline + 2 THEN
        RAISE EXCEPTION 'FAIL reconcile: expected % flagged wallets, got %', v_baseline + 2, v_flagged;
    END IF;

    SELECT e.data INTO v_row FROM ops.log_entries e
     WHERE e.scope = 'finance.reconcile_wallets' AND e.level = 'error' AND e.source = 'server'
       AND e.data ->> 'wallet_id' = v_b::text
     ORDER BY e.created_at DESC LIMIT 1;
    IF v_row IS NULL OR (v_row ->> 'balance_cents')::bigint - (v_row ->> 'ledger_sum_cents')::bigint <> 700 THEN
        RAISE EXCEPTION 'FAIL reconcile: no ops.log_entries row describing wallet B''s 700 drift (%)', v_row;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.log_entries e
                    WHERE e.scope = 'finance.reconcile_wallets' AND e.data ->> 'wallet_id' = v_c::text) THEN
        RAISE EXCEPTION 'FAIL reconcile: wallet C''s mis-stamped balance_after was not flagged';
    END IF;
    IF EXISTS (SELECT 1 FROM ops.log_entries e
                WHERE e.scope = 'finance.reconcile_wallets' AND e.data ->> 'wallet_id' = v_a::text) THEN
        RAISE EXCEPTION 'FAIL reconcile: wallet A was flagged after an honest credit';
    END IF;
    RAISE NOTICE 'PASS fn_reconcile_wallets flagged B (cache drift) and C (bad running balance), not A (baseline %)', v_baseline;
END $$;
ROLLBACK TO SAVEPOINT s_reconcile;

-- Only the service role (and the pg_cron owner) may run it.
SAVEPOINT s_reconcile_grants;
DO $$
BEGIN
    IF to_regprocedure('finance.fn_reconcile_wallets()') IS NULL THEN
        RAISE EXCEPTION 'FAIL finance.fn_reconcile_wallets() does not exist';
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', 'finance.fn_reconcile_wallets()', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'finance.fn_reconcile_wallets()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL fn_reconcile_wallets is executable by a client role';
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', 'finance.fn_reconcile_wallets()', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL fn_reconcile_wallets is not executable by service_role';
    END IF;
    RAISE NOTICE 'PASS fn_reconcile_wallets is service_role-only';
END $$;
ROLLBACK TO SAVEPOINT s_reconcile_grants;
-- #endregion

ROLLBACK;
