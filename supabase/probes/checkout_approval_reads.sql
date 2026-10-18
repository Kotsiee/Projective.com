-- =============================================================================================
-- Probe: what a business checkout's spend pre-flight reads agrees with what the database's gate
-- decides (BP2 review, Decision #243).
--
-- `live-buyer.spendPositionFor` reads, AS THE MEMBER: the wallet's threshold with the platform's
-- `vault_approval_threshold_cents` behind a NULL column (`finance.fn_business_threshold`), the member's
-- envelope rolled at `resets_at` (`finance.fn_check_spending_limit`), and the member's own unspent
-- requests for the basket (`requested_by = self AND consumed_at IS NULL`). `requestApproval` answers
-- a PC409 the session cannot show as the member's own as ANOTHER member's request. This probe pins
-- each of those against `finance.request_spend_approval`, the door the checkout files through.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/checkout_approval_reads.sql
--
-- Fixture (seeded data): a KYB-verified business with a USD wallet, its owner O and a second member H
-- holding vault `spend` + `approve_spend` with a capped envelope. Two fresh probe baskets. A clean run
-- prints only PASS notices.
-- =============================================================================================

BEGIN;

-- #region Fixture
-- Ids travel as transaction-local settings, which every role can read (the RLS reads below run as
-- `authenticated`, which cannot see a superuser's temp tables).
DO $$
DECLARE
    v_business uuid;
    v_wallet uuid;
    v_owner uuid;
    v_admin uuid;
    v_limit uuid;
BEGIN
    SELECT b.id, b.owner_user_id, w.id INTO v_business, v_owner, v_wallet
      FROM org.business_profiles b
      JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id AND w.currency = 'USD'
     WHERE b.kyb_status = 'verified'
     ORDER BY b.id LIMIT 1;
    IF v_wallet IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no verified business with a USD wallet'; END IF;

    SELECT vp.member_user_id, sl.id INTO v_admin, v_limit
      FROM finance.vault_permissions vp
      JOIN finance.spending_limits sl ON sl.wallet_id = vp.wallet_id AND sl.member_user_id = vp.member_user_id
     WHERE vp.wallet_id = v_wallet AND vp.member_user_id <> v_owner
       AND 'spend'::finance.vault_capability = ANY (vp.capabilities)
       AND 'approve_spend'::finance.vault_capability = ANY (vp.capabilities)
       AND sl.cap_cents IS NOT NULL
     ORDER BY vp.member_user_id LIMIT 1;
    IF v_admin IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no second spend+approve member with a capped envelope'; END IF;

    -- A roomy, current envelope to start from: nothing below needs approval for the envelope's sake.
    UPDATE finance.spending_limits
       SET cap_cents = 10000000, per_transaction_cents = 10000000, spent_cents = 0,
           period_interval = 'monthly', resets_at = now() + interval '10 days'
     WHERE id = v_limit;

    PERFORM set_config('probe.business', v_business::text, true);
    PERFORM set_config('probe.wallet', v_wallet::text, true);
    PERFORM set_config('probe.owner', v_owner::text, true);
    PERFORM set_config('probe.admin', v_admin::text, true);
    PERFORM set_config('probe.limit', v_limit::text, true);
    PERFORM set_config('probe.basket_b', gen_random_uuid()::text, true);
    PERFORM set_config('probe.basket_c', gen_random_uuid()::text, true);
    INSERT INTO finance.baskets (id, owner_type, owner_id, name) VALUES
        (current_setting('probe.basket_b')::uuid, 'business', v_business, 'BP2 probe B'),
        (current_setting('probe.basket_c')::uuid, 'business', v_business, 'BP2 probe C');
END $$;
-- #endregion

-- #region 1. The platform threshold stands behind a NULL wallet threshold — and a member can read it
UPDATE finance.wallets SET approval_threshold_cents = NULL WHERE id = current_setting('probe.wallet')::uuid;
UPDATE security.platform_params SET value = '50000'::jsonb WHERE key = 'vault_approval_threshold_cents';

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_value jsonb;
    v_rows int;
    v_resets timestamptz;
BEGIN
    SELECT value INTO v_value FROM security.platform_params WHERE key = 'vault_approval_threshold_cents';
    IF v_value IS NULL OR (v_value #>> '{}')::bigint <> 50000 THEN
        RAISE EXCEPTION 'FAIL a member cannot read the platform threshold (read %)', v_value;
    END IF;
    RAISE NOTICE 'PASS a member reads the platform threshold (%)', v_value;

    SELECT count(*), max(resets_at) INTO v_rows, v_resets FROM finance.spending_limits
     WHERE member_user_id = current_setting('probe.admin')::uuid
       AND wallet_id = current_setting('probe.wallet')::uuid;
    IF v_rows <> 1 OR v_resets IS NULL THEN
        RAISE EXCEPTION 'FAIL a member cannot read their own envelope with resets_at (% rows)', v_rows;
    END IF;
    RAISE NOTICE 'PASS a member reads their own envelope and its resets_at';

    -- Under the platform threshold: the door files nothing (the pre-flight reads it allowed too).
    BEGIN
        PERFORM finance.request_spend_approval(current_setting('probe.wallet')::uuid, 40000, 'Probe',
            'baskets', current_setting('probe.basket_c')::uuid);
        RAISE EXCEPTION 'FAIL a 400.00 request under a 500.00 platform threshold was filed';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS under the platform threshold needs no approval (22023)';
    END;

    -- At or above it: the door files (the pre-flight reads needs_approval).
    PERFORM finance.request_spend_approval(current_setting('probe.wallet')::uuid, 60000, 'Probe',
        'baskets', current_setting('probe.basket_b')::uuid);
    RAISE NOTICE 'PASS at the platform threshold the request is filed, bound to the basket';
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The member reads their own pending request; another member's PC409 reads as nobody's own
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_state text;
BEGIN
    SELECT status::text INTO v_state FROM finance.spend_approvals
     WHERE wallet_id = current_setting('probe.wallet')::uuid AND ref_table = 'baskets'
       AND ref_id = current_setting('probe.basket_b')::uuid
       AND requested_by = current_setting('probe.admin')::uuid AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
    IF v_state IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'FAIL the requester does not read their pending request (read %)', v_state;
    END IF;
    RAISE NOTICE 'PASS the requester reads their own pending request for the basket';
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.owner'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_own int;
BEGIN
    BEGIN
        PERFORM finance.request_spend_approval(current_setting('probe.wallet')::uuid, 60000, 'Probe',
            'baskets', current_setting('probe.basket_b')::uuid);
        RAISE EXCEPTION 'FAIL a second open request on the basket was filed';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'PASS another member filing on the same basket is refused PC409';
    END;
    SELECT count(*) INTO v_own FROM finance.spend_approvals
     WHERE wallet_id = current_setting('probe.wallet')::uuid AND ref_table = 'baskets'
       AND ref_id = current_setting('probe.basket_b')::uuid
       AND requested_by = current_setting('probe.owner')::uuid AND consumed_at IS NULL;
    IF v_own <> 0 THEN RAISE EXCEPTION 'FAIL the refused member reads a request of their own'; END IF;
    RAISE NOTICE 'PASS the refused member reads no request of their own (the checkout names another member''s)';

    PERFORM finance.decide_spend_approval(
        (SELECT id FROM finance.spend_approvals
          WHERE ref_id = current_setting('probe.basket_b')::uuid AND status = 'pending'), 'approve');
    RAISE NOTICE 'PASS the owner approves the member''s request';
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.admin'), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_state text;
BEGIN
    SELECT status::text INTO v_state FROM finance.spend_approvals
     WHERE wallet_id = current_setting('probe.wallet')::uuid AND ref_table = 'baskets'
       AND ref_id = current_setting('probe.basket_b')::uuid
       AND requested_by = current_setting('probe.admin')::uuid AND consumed_at IS NULL;
    IF v_state IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'FAIL the requester does not read the approval (read %)', v_state;
    END IF;
    RAISE NOTICE 'PASS the requester reads the approved, unspent request';
END $$;
RESET ROLE;
-- #endregion

-- #region 3. A lapsed envelope window counts nothing, as the pre-flight now reads it
UPDATE finance.wallets SET approval_threshold_cents = 100000000 WHERE id = current_setting('probe.wallet')::uuid;
UPDATE security.platform_params SET value = '0'::jsonb WHERE key = 'vault_approval_threshold_cents';
UPDATE finance.spending_limits
   SET cap_cents = 100000, spent_cents = 100000, resets_at = now() - interval '1 day'
 WHERE id = current_setting('probe.limit')::uuid;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
    BEGIN
        PERFORM finance.request_spend_approval(current_setting('probe.wallet')::uuid, 60000, 'Probe',
            'baskets', current_setting('probe.basket_c')::uuid);
        RAISE EXCEPTION 'FAIL a lapsed, fully spent envelope still needed approval';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS a lapsed window counts nothing — no approval needed (22023)';
    END;
END $$;
RESET ROLE;

UPDATE finance.spending_limits SET resets_at = now() + interval '1 day'
 WHERE id = current_setting('probe.limit')::uuid;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
    PERFORM finance.request_spend_approval(current_setting('probe.wallet')::uuid, 60000, 'Probe',
        'baskets', current_setting('probe.basket_c')::uuid);
    RAISE NOTICE 'PASS the same spend against a current, fully spent window needs approval (filed)';
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
