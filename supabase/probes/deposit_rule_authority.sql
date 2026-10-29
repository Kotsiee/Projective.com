-- =============================================================================================
-- Probe: a recurring deposit is written only through its door (FINANCE_COMPLETENESS_AUDIT A12).
--
-- A rule charges the card of the member who authorised it (`created_by`, stamped by
-- finance.create_deposit_rule, which requires `add_funds`). Before the fix `authenticated` held
-- INSERT/UPDATE on finance.deposit_rules under a FOR ALL policy keyed on `spend`, so any member who
-- could spend from a shared wallet could rewrite another member's rule — amount, card, wallet,
-- interval, `next_run_at` = now — and the next scheduler run charged the author's card. Now clients
-- hold SELECT only: every direct INSERT / UPDATE / DELETE is refused 42501 for every member, the
-- wallet's own owner included (so a weaker member a fortiori), while the door and the read still
-- work.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/deposit_rule_authority.sql
--
-- Fixture (seeded): theo, his USD wallet and a saved card on a processor Customer. Ids reach the
-- `authenticated` blocks through transaction-local settings (`probe.*`). A clean run prints only
-- `ok` notices; the first failure ends the run with `ASSERT FAILED`.
-- =============================================================================================

BEGIN;
-- Results are fixture plumbing; the checks speak through NOTICEs.
\o /dev/null

-- #region Fixture (as postgres)
SELECT set_config('probe.theo', (SELECT user_id::text FROM org.users_public WHERE username = 'theo'), true);
SELECT set_config('probe.wallet', finance.fn_ensure_wallet('user', current_setting('probe.theo')::uuid, 'USD')::text, true);
INSERT INTO finance.payment_methods (owner_type, owner_id, method_role, external_ref, brand, last4)
VALUES ('user', current_setting('probe.theo')::uuid, 'funding', 'pm_probe_dr', 'visa', '4242');
SELECT set_config('probe.card', (SELECT id::text FROM finance.payment_methods WHERE external_ref = 'pm_probe_dr'), true);
INSERT INTO finance.processor_customers (owner_type, owner_id, customer_ref)
VALUES ('user', current_setting('probe.theo')::uuid, 'cus_probe_dr')
ON CONFLICT (provider, owner_type, owner_id) DO NOTHING;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.theo'), 'role', 'authenticated')::text, true);
-- #endregion

-- #region 1. The door still creates a rule, stamped with its author
SET LOCAL ROLE authenticated;
SELECT set_config('probe.rule', (finance.create_deposit_rule(
    current_setting('probe.wallet')::uuid, 2500, 'USD', 'monthly'::finance.deposit_interval,
    current_setting('probe.card')::uuid) ->> 'id'), true);
RESET ROLE;
DO $$ BEGIN
    IF (SELECT created_by::text FROM finance.deposit_rules WHERE id = current_setting('probe.rule')::uuid)
       IS DISTINCT FROM current_setting('probe.theo') THEN
        RAISE EXCEPTION 'ASSERT FAILED: the door did not create a rule stamped with its author';
    END IF;
    RAISE NOTICE 'ok  1 create_deposit_rule creates the rule, created_by = the caller';
END $$;
-- #endregion

-- #region 2. The member still reads their rule
DO $$
DECLARE v_n int;
BEGIN
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM finance.deposit_rules WHERE id = current_setting('probe.rule')::uuid;
    RESET ROLE;
    IF v_n <> 1 THEN RAISE EXCEPTION 'ASSERT FAILED: the author cannot read their own rule (% rows)', v_n; END IF;
    RAISE NOTICE 'ok  2 the author reads the rule';
END $$;
-- #endregion

-- #region 3. A direct UPDATE of a rule's terms is refused, even for the wallet's owner
DO $$
DECLARE v_n int;
BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE finance.deposit_rules SET amount_cents = 9999999, next_run_at = now()
     WHERE id = current_setting('probe.rule')::uuid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'ASSERT FAILED: a direct UPDATE was accepted (% row)', v_n;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  3 direct UPDATE refused (%)', SQLERRM;
END $$;
RESET ROLE;
DO $$ BEGIN
    IF (SELECT amount_cents FROM finance.deposit_rules WHERE id = current_setting('probe.rule')::uuid) <> 2500 THEN
        RAISE EXCEPTION 'ASSERT FAILED: the rule''s amount changed';
    END IF;
    RAISE NOTICE 'ok  3 the rule still charges 2500';
END $$;
-- #endregion

-- #region 4. A direct INSERT is refused (a rule exists only through the door that stamps its author)
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO finance.deposit_rules (wallet_id, source_method_id, amount_cents, currency, interval, next_run_at)
    VALUES (current_setting('probe.wallet')::uuid, current_setting('probe.card')::uuid, 100, 'USD', 'weekly', now());
    RAISE EXCEPTION 'ASSERT FAILED: a direct INSERT was accepted';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  4 direct INSERT refused (%)', SQLERRM;
END $$;
RESET ROLE;
-- #endregion

-- #region 5. A direct DELETE is refused
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    DELETE FROM finance.deposit_rules WHERE id = current_setting('probe.rule')::uuid;
    RAISE EXCEPTION 'ASSERT FAILED: a direct DELETE was accepted';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  5 direct DELETE refused (%)', SQLERRM;
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
