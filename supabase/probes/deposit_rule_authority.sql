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
-- A rule is changed only through finance.update_deposit_rule (A13), with the authority that creates
-- one (`add_funds`). A member who holds `spend` but not `add_funds` is refused 42501 by the door as
-- well as by the table. A change that can lead to a charge (a new amount, a resume) makes the caller
-- the rule's author and re-checks the card: a non-author re-pricing a rule on the business's card
-- succeeds and becomes `created_by`; re-pricing a rule on another member's personal card is refused.
-- Pausing or archiving needs no consent and leaves the author alone. A rule's wallet, currency, card
-- and interval never change, for any role (trg_deposit_rules_immutable), and archiving is final.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/deposit_rule_authority.sql
--
-- Fixture (seeded): theo, his USD wallet and a saved card on a processor Customer. For the shared
-- cases, business `heliafinance` (owner `priyaraman`) seats theo and `marisdelacroix` inside the
-- transaction; their vault rows are set to {view, spend} (theo) and {view, add_funds} (maris). Ids
-- reach the `authenticated` blocks through transaction-local settings (`probe.*`). A clean run prints
-- only `ok` notices; the first failure ends the run with `ASSERT FAILED`.
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

-- #region 6. Shared wallet fixture: the owner authors two rules (as postgres, then as the owner)
CREATE FUNCTION pg_temp.uid(p_username text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT user_id FROM org.users_public WHERE username = p_username;
$$;
CREATE FUNCTION pg_temp.act(p_username text) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claim.sub', pg_temp.uid(p_username)::text, true),
           set_config('request.jwt.claims',
               json_build_object('sub', pg_temp.uid(p_username), 'role', 'authenticated')::text, true);
$$;
DO $$
DECLARE
    v_b uuid;
    v_wallet uuid;
    v_role uuid;
BEGIN
    SELECT id INTO STRICT v_b FROM org.business_profiles WHERE slug = 'heliafinance';
    v_wallet := finance.fn_ensure_wallet('business', v_b, 'USD');
    SELECT id INTO STRICT v_role FROM org.business_roles WHERE business_id = v_b AND preset = 'member';
    INSERT INTO org.business_members (business_id, user_id, role_id, status)
    SELECT v_b, pg_temp.uid(u), v_role, 'active' FROM unnest(ARRAY['theo', 'marisdelacroix']) AS u
    ON CONFLICT DO NOTHING;
    INSERT INTO finance.vault_permissions (wallet_id, member_user_id, capabilities)
    VALUES (v_wallet, pg_temp.uid('theo'), ARRAY['view', 'spend']::finance.vault_capability[]),
           (v_wallet, pg_temp.uid('marisdelacroix'), ARRAY['view', 'add_funds']::finance.vault_capability[])
    ON CONFLICT (wallet_id, member_user_id) DO UPDATE SET capabilities = EXCLUDED.capabilities;
    INSERT INTO finance.payment_methods (owner_type, owner_id, method_role, external_ref, brand, last4)
    VALUES ('business', v_b, 'funding', 'pm_probe_dr_biz', 'visa', '4444'),
           ('user', pg_temp.uid('priyaraman'), 'funding', 'pm_probe_dr_own', 'visa', '5555');
    PERFORM set_config('probe.biz_wallet', v_wallet::text, true);
END $$;
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT set_config('probe.biz_rule', (finance.create_deposit_rule(
    current_setting('probe.biz_wallet')::uuid, 5000, 'USD', 'monthly'::finance.deposit_interval,
    (SELECT id FROM finance.payment_methods WHERE external_ref = 'pm_probe_dr_biz')) ->> 'id'), true);
SELECT set_config('probe.own_rule', (finance.create_deposit_rule(
    current_setting('probe.biz_wallet')::uuid, 7000, 'USD', 'weekly'::finance.deposit_interval,
    (SELECT id FROM finance.payment_methods WHERE external_ref = 'pm_probe_dr_own')) ->> 'id'), true);
RESET ROLE;
-- #endregion

-- #region 7. A spend-only member can change a rule neither directly nor through the door
SELECT pg_temp.act('theo');
DO $$
DECLARE v_n int;
BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE finance.deposit_rules SET amount_cents = 9999999 WHERE id = current_setting('probe.biz_rule')::uuid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION 'ASSERT FAILED: a spend-only member''s direct UPDATE was accepted (% row)', v_n;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  7 spend-only member: direct UPDATE refused (%)', SQLERRM;
END $$;
RESET ROLE;
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM finance.update_deposit_rule(current_setting('probe.biz_rule')::uuid, p_amount_cents => 9999999);
    RAISE EXCEPTION 'ASSERT FAILED: a spend-only member re-priced a rule through the door';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  7 spend-only member: door refused (%)', SQLERRM;
END $$;
RESET ROLE;
-- #endregion

-- #region 8. An add_funds member who is not the author re-prices a rule on the business card
SELECT pg_temp.act('marisdelacroix');
SET LOCAL ROLE authenticated;
SELECT finance.update_deposit_rule(current_setting('probe.biz_rule')::uuid, p_amount_cents => 6500);
RESET ROLE;
DO $$
DECLARE r finance.deposit_rules;
BEGIN
    SELECT * INTO r FROM finance.deposit_rules WHERE id = current_setting('probe.biz_rule')::uuid;
    IF r.amount_cents <> 6500 THEN RAISE EXCEPTION 'ASSERT FAILED: the amount is %, not 6500', r.amount_cents; END IF;
    IF r.created_by IS DISTINCT FROM pg_temp.uid('marisdelacroix') THEN
        RAISE EXCEPTION 'ASSERT FAILED: re-pricing did not make the caller the author';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM security.audit_logs a WHERE a.entity_id = r.id AND a.action = 'deposit_rule.updated'
                     AND a.user_id = pg_temp.uid('marisdelacroix')) THEN
        RAISE EXCEPTION 'ASSERT FAILED: the change left no audit row';
    END IF;
    RAISE NOTICE 'ok  8 add_funds non-author re-prices: amount 6500, created_by = caller, audited';
END $$;
-- #endregion

-- #region 9. …but cannot re-price a rule that charges another member's own card; may still pause it
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM finance.update_deposit_rule(current_setting('probe.own_rule')::uuid, p_amount_cents => 100);
    RAISE EXCEPTION 'ASSERT FAILED: a non-author re-priced a charge on the author''s personal card';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  9 re-pricing another member''s card refused (%)', SQLERRM;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT finance.update_deposit_rule(current_setting('probe.own_rule')::uuid, p_active => false);
RESET ROLE;
DO $$
DECLARE r finance.deposit_rules;
BEGIN
    SELECT * INTO r FROM finance.deposit_rules WHERE id = current_setting('probe.own_rule')::uuid;
    IF r.active OR r.created_by IS DISTINCT FROM pg_temp.uid('priyaraman') OR r.amount_cents <> 7000 THEN
        RAISE EXCEPTION 'ASSERT FAILED: pause by a non-author: active %, author changed %, amount %',
            r.active, r.created_by IS DISTINCT FROM pg_temp.uid('priyaraman'), r.amount_cents;
    END IF;
    RAISE NOTICE 'ok  9 a non-author pauses the rule; the author and amount are unchanged';
END $$;
-- #endregion

-- #region 10. The author resumes their own rule; a past-due run rolls forward
UPDATE finance.deposit_rules SET next_run_at = now() - interval '3 days', failure_count = 2
 WHERE id = current_setting('probe.own_rule')::uuid;
SELECT pg_temp.act('priyaraman');
SET LOCAL ROLE authenticated;
SELECT finance.update_deposit_rule(current_setting('probe.own_rule')::uuid, p_active => true);
RESET ROLE;
DO $$
DECLARE r finance.deposit_rules;
BEGIN
    SELECT * INTO r FROM finance.deposit_rules WHERE id = current_setting('probe.own_rule')::uuid;
    IF NOT r.active OR r.next_run_at <= now() OR r.failure_count <> 0 THEN
        RAISE EXCEPTION 'ASSERT FAILED: resume: active %, next_run_at %, failure_count %', r.active, r.next_run_at, r.failure_count;
    END IF;
    RAISE NOTICE 'ok 10 the author resumes; the next run is in the future and the failure count is clear';
END $$;
-- #endregion

-- #region 11. Identity columns never change — not even for a definer or the service role
DO $$ BEGIN
    UPDATE finance.deposit_rules SET interval = 'weekly' WHERE id = current_setting('probe.biz_rule')::uuid;
    RAISE EXCEPTION 'ASSERT FAILED: a rule''s interval was changed';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok 11 interval change refused (%)', SQLERRM;
END $$;
DO $$ BEGIN
    UPDATE finance.deposit_rules
       SET source_method_id = (SELECT id FROM finance.payment_methods WHERE external_ref = 'pm_probe_dr_own')
     WHERE id = current_setting('probe.biz_rule')::uuid;
    RAISE EXCEPTION 'ASSERT FAILED: a rule''s card was swapped';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok 11 card swap refused (%)', SQLERRM;
END $$;
UPDATE finance.deposit_rules SET source_method_id = NULL WHERE id = current_setting('probe.biz_rule')::uuid;
DO $$ BEGIN
    RAISE NOTICE 'ok 11 the card going away (ON DELETE SET NULL) still clears source_method_id';
END $$;
-- #endregion

-- #region 12. Archiving is final
SELECT pg_temp.act('marisdelacroix');
SET LOCAL ROLE authenticated;
SELECT finance.update_deposit_rule(current_setting('probe.own_rule')::uuid, p_archive => true);
RESET ROLE;
DO $$
DECLARE r finance.deposit_rules;
BEGIN
    SELECT * INTO r FROM finance.deposit_rules WHERE id = current_setting('probe.own_rule')::uuid;
    IF r.active OR r.archived_at IS NULL THEN
        RAISE EXCEPTION 'ASSERT FAILED: archive left active % archived_at %', r.active, r.archived_at;
    END IF;
    RAISE NOTICE 'ok 12 archived: inactive, archived_at set, row kept';
END $$;
DO $$ BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM finance.update_deposit_rule(current_setting('probe.own_rule')::uuid, p_active => true);
    RAISE EXCEPTION 'ASSERT FAILED: an archived rule was resumed';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    RAISE NOTICE 'ok 12 an archived rule is not resumed (%)', SQLERRM;
END $$;
RESET ROLE;
DO $$ BEGIN
    UPDATE finance.deposit_rules SET active = true WHERE id = current_setting('probe.own_rule')::uuid;
    RAISE EXCEPTION 'ASSERT FAILED: an archived rule was reactivated directly';
EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'ok 12 not even directly (%)', SQLERRM;
END $$;
-- #endregion

ROLLBACK;
