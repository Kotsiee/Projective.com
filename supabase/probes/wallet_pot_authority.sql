-- =============================================================================================
-- Probe: wallet pots are read-only to clients (FINANCE_COMPLETENESS_AUDIT A4).
--
-- A pot is a carve-out of a wallet's money, and its `auto_allocate_bp` decides where future income
-- goes. Before the fix `authenticated` held INSERT/UPDATE on finance.wallet_pots under a FOR ALL
-- policy keyed on `spend`, so any member who could spend from a shared vault could create pots in it
-- and re-weight them (the balance itself was guarded by trg_wallet_pots_derived). Now clients hold
-- SELECT only: every direct INSERT / UPDATE / DELETE is refused 42501, the wallet's own owner
-- included (so a weaker member a fortiori), while the read still works. Pots are written by definer
-- doors (none built yet — A2/A3).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/wallet_pot_authority.sql
--
-- Fixture (seeded, 07_finance.sql): `marisdelacroix`'s USD wallet and its two pots. A clean run
-- prints only `ok` notices; the first failure ends the run with `ASSERT FAILED`.
-- =============================================================================================

BEGIN;
\o /dev/null

-- #region Fixture (as postgres)
SELECT set_config('probe.owner', (SELECT user_id::text FROM org.users_public WHERE username = 'marisdelacroix'), true);
SELECT set_config('probe.pot', (
    SELECT p.id::text FROM finance.wallet_pots p
      JOIN finance.wallets w ON w.id = p.wallet_id
     WHERE w.owner_id = current_setting('probe.owner')::uuid
     ORDER BY p.created_at, p.id LIMIT 1), true);
SELECT set_config('probe.wallet', (SELECT wallet_id::text FROM finance.wallet_pots
                                    WHERE id = current_setting('probe.pot')::uuid), true);
SELECT set_config('request.jwt.claim.sub', current_setting('probe.owner'), true);
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
-- #endregion

-- #region 1. The owner still reads their pots
DO $$
DECLARE v_n int;
BEGIN
    IF current_setting('probe.pot', true) IS NULL OR current_setting('probe.pot') = '' THEN
        RAISE EXCEPTION 'ASSERT FAILED: fixture missing — no seeded pot for marisdelacroix';
    END IF;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM finance.wallet_pots WHERE wallet_id = current_setting('probe.wallet')::uuid;
    RESET ROLE;
    IF v_n = 0 THEN RAISE EXCEPTION 'ASSERT FAILED: the owner cannot read their pots'; END IF;
    RAISE NOTICE 'ok  1 the owner reads their % pots', v_n;
END $$;
-- #endregion

-- #region 2. A direct UPDATE (re-weighting) is refused, even for the wallet's owner
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE finance.wallet_pots SET auto_allocate_bp = 10000, name = 'Probe'
     WHERE id = current_setting('probe.pot')::uuid;
    RAISE EXCEPTION 'ASSERT FAILED: a direct UPDATE was accepted';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  2 direct UPDATE refused (%)', SQLERRM;
END $$;
RESET ROLE;
-- #endregion

-- #region 3. A direct INSERT is refused
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO finance.wallet_pots (wallet_id, purpose, name, currency, auto_allocate_bp)
    VALUES (current_setting('probe.wallet')::uuid, 'savings', 'Probe pot', 'USD', 5000);
    RAISE EXCEPTION 'ASSERT FAILED: a direct INSERT was accepted';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  3 direct INSERT refused (%)', SQLERRM;
END $$;
RESET ROLE;
-- #endregion

-- #region 4. A direct DELETE is refused
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    DELETE FROM finance.wallet_pots WHERE id = current_setting('probe.pot')::uuid;
    RAISE EXCEPTION 'ASSERT FAILED: a direct DELETE was accepted';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  4 direct DELETE refused (%)', SQLERRM;
END $$;
RESET ROLE;
-- #endregion

-- #region 5. No write policy remains on the table
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                WHERE schemaname = 'finance' AND tablename = 'wallet_pots' AND cmd <> 'SELECT') THEN
        RAISE EXCEPTION 'ASSERT FAILED: finance.wallet_pots still has a write policy';
    END IF;
    RAISE NOTICE 'ok  5 finance.wallet_pots has SELECT policies only';
END $$;
-- #endregion

ROLLBACK;
