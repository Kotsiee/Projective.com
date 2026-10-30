-- =============================================================================================
-- Probe: the ledger invariants every finance change must keep (FINANCE_BUILD_PROMPTS DB1 §5).
--
--   1. Every wallet's cached balance equals the signed sum of its ledger rows, and equals the
--      `balance_after_cents` of its newest row (0 for a wallet with no rows) — the same identity
--      finance.fn_reconcile_wallets checks nightly, asserted here instead of logged.
--   2. A wallet's pots never hold more than the wallet: Σ wallet_pots.balance_cents ≤ balance_cents.
--   3. A pending release still `pending` / `on_hold` has not been credited yet: no ledger credit on its
--      wallet carries its reason and its source (the escrow or order), which is exactly the row the
--      maturity sweep writes when it matures it. A credit here means the money was paid twice.
--
-- Read-only: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated (seeded or
-- live) DB after any SQL change, and in every finance SQL prompt's acceptance:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/finance_invariants.sql
--
-- A clean run prints one `ok` notice per invariant. Any violation lists every offending row as a
-- WARNING and ends the run with `ASSERT FAILED` (psql exits non-zero under ON_ERROR_STOP).
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    r record;
    v_fail int := 0;
    v_n int;
BEGIN
    -- #region 1. Cached balance = Σ signed ledger = newest balance_after
    v_n := 0;
    FOR r IN
        SELECT w.id, w.balance_cents,
               COALESCE(s.ledger_sum, 0) AS ledger_sum,
               COALESCE(latest.balance_after_cents, 0) AS latest_after
          FROM finance.wallets w
          LEFT JOIN LATERAL (
                SELECT SUM(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END) AS ledger_sum
                  FROM finance.transactions t WHERE t.wallet_id = w.id
          ) s ON true
          LEFT JOIN LATERAL (
                SELECT t.balance_after_cents
                  FROM finance.transactions t
                 WHERE t.wallet_id = w.id
                 ORDER BY t.created_at DESC, t.id DESC
                 LIMIT 1
          ) latest ON true
         WHERE w.balance_cents <> COALESCE(s.ledger_sum, 0)
            OR w.balance_cents <> COALESCE(latest.balance_after_cents, 0)
    LOOP
        v_n := v_n + 1;
        RAISE WARNING 'wallet %: balance %, ledger sum %, newest balance_after %',
            r.id, r.balance_cents, r.ledger_sum, r.latest_after;
    END LOOP;
    IF v_n = 0 THEN
        RAISE NOTICE 'ok  1 every wallet''s balance equals its ledger sum and its newest balance_after (% wallets)',
            (SELECT count(*) FROM finance.wallets);
    END IF;
    v_fail := v_fail + v_n;
    -- #endregion

    -- #region 2. Σ pots ≤ wallet balance
    v_n := 0;
    FOR r IN
        SELECT w.id, w.balance_cents, SUM(p.balance_cents) AS pots
          FROM finance.wallets w
          JOIN finance.wallet_pots p ON p.wallet_id = w.id
         GROUP BY w.id, w.balance_cents
        HAVING SUM(p.balance_cents) > w.balance_cents
    LOOP
        v_n := v_n + 1;
        RAISE WARNING 'wallet %: pots hold % but the wallet holds %', r.id, r.pots, r.balance_cents;
    END LOOP;
    IF v_n = 0 THEN
        RAISE NOTICE 'ok  2 no wallet''s pots exceed its balance (% pots)', (SELECT count(*) FROM finance.wallet_pots);
    END IF;
    v_fail := v_fail + v_n;
    -- #endregion

    -- #region 3. An unmatured release has no credit yet
    v_n := 0;
    FOR r IN
        SELECT pr.id, pr.state, pr.wallet_id, pr.reason, t.id AS tx
          FROM finance.pending_releases pr
          JOIN finance.transactions t
            ON t.wallet_id = pr.wallet_id
           AND t.direction = 'credit'
           AND t.reason = pr.reason
           AND t.ref_table = CASE WHEN pr.escrow_id IS NOT NULL THEN 'escrows' ELSE 'orders' END
           AND t.ref_id = COALESCE(pr.escrow_id, pr.order_id)
         WHERE pr.state IN ('pending', 'on_hold')
    LOOP
        v_n := v_n + 1;
        RAISE WARNING 'pending release % (%) on wallet % is already credited by transaction % (%)',
            r.id, r.state, r.wallet_id, r.tx, r.reason;
    END LOOP;
    IF v_n = 0 THEN
        RAISE NOTICE 'ok  3 no pending / on-hold release has been credited (% unmatured)',
            (SELECT count(*) FROM finance.pending_releases WHERE state IN ('pending', 'on_hold'));
    END IF;
    v_fail := v_fail + v_n;
    -- #endregion

    IF v_fail > 0 THEN
        RAISE EXCEPTION 'ASSERT FAILED: % finance invariant violation(s); see the warnings above', v_fail;
    END IF;
END $$;

ROLLBACK;
