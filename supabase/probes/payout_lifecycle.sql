-- =============================================================================================
-- Probe: the withdrawal lifecycle after the Stripe Transfer (Decision #202) — the minimum
-- withdrawal, a validated and recorded destination, `transfer.reversed` (finance.record_transfer_reversed),
-- connected-account `payout.paid` / `payout.failed` (finance.record_bank_payout) and the stale-pending
-- sweep's claim (finance.fn_claim_stale_payouts).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/payout_lifecycle.sql
--
-- A check that does not hold raises `FAIL …` and aborts the run (non-zero exit under ON_ERROR_STOP).
-- A clean run prints only PASS notices. Fixtures come from the seed (deno task db:reset).
-- =============================================================================================

BEGIN;

-- #region 0. Helpers + fixtures (as postgres)
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', p_what; END IF;
    RAISE NOTICE 'PASS %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.act(p_uid text) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.bal() RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = pg_temp.s('wallet')::uuid;
$$;

CREATE FUNCTION pg_temp.payout(p_id text) RETURNS finance.payouts LANGUAGE sql AS $$
    SELECT * FROM finance.payouts WHERE id = p_id::uuid;
$$;

-- Begin a withdrawal as the fixture freelancer; answers `ok:<payout id>` or `refused:<message>`.
CREATE FUNCTION pg_temp.withdraw(p_amount bigint, p_key text, p_destination uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    v := finance.begin_payout(
        pg_temp.s('wallet')::uuid, p_amount, pg_temp.s('currency'), false, p_key, p_destination
    );
    RETURN 'ok:' || (v ->> 'id');
EXCEPTION WHEN OTHERS THEN
    RETURN 'refused:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.withdraw(bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.s(text) TO authenticated;

-- An adult freelancer with a freelancer wallet, made payout-ready with a verified Connect account and
-- an active payout method; a second person's method is the foreign destination.
DO $$
DECLARE r record; v_method text;
BEGIN
    SELECT w.id AS wallet, w.owner_id AS payee, pg_catalog.upper(w.currency) AS currency
      INTO r
      FROM finance.wallets w
      JOIN org.freelancer_profiles fp ON fp.user_id = w.owner_id
     WHERE w.owner_type = 'freelancer' AND NOT org.fn_is_minor(w.owner_id)
     ORDER BY w.id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL fixtures: no adult freelancer wallet (run deno task db:reset)';
    END IF;

    PERFORM pg_catalog.set_config('probe.wallet', r.wallet::text, true);
    PERFORM pg_catalog.set_config('probe.payee', r.payee::text, true);
    PERFORM pg_catalog.set_config('probe.currency', r.currency, true);
    PERFORM pg_catalog.set_config('probe.acct', 'acct_probe' || pg_catalog.substr(pg_catalog.md5(r.payee::text), 1, 12), true);
    PERFORM pg_catalog.set_config('probe.min', finance.fn_min_withdrawal_minor(r.currency)::text, true);

    UPDATE org.freelancer_profiles SET kyc_status = 'verified', payout_ready = true WHERE user_id = r.payee;
    DELETE FROM finance.payout_accounts WHERE owner_id = r.payee;
    INSERT INTO finance.payout_accounts (owner_type, owner_id, provider, account_id, status)
    VALUES ('freelancer', r.payee, 'stripe', pg_temp.s('acct'), 'verified');

    INSERT INTO finance.payment_methods (owner_type, owner_id, method_role, provider, external_ref, label, status)
    VALUES ('freelancer', r.payee, 'payout', 'stripe', 'ba_probe_own', 'Probe bank', 'active')
    RETURNING id::text INTO STRICT v_method;
    PERFORM pg_catalog.set_config('probe.method_own', v_method, true);
    INSERT INTO finance.payment_methods (owner_type, owner_id, method_role, provider, external_ref, label, status)
    VALUES ('freelancer', r.payee, 'payout', 'stripe', 'ba_probe_old', 'Closed bank', 'inactive')
    RETURNING id::text INTO STRICT v_method;
    PERFORM pg_catalog.set_config('probe.method_inactive', v_method, true);
    INSERT INTO finance.payment_methods (owner_type, owner_id, method_role, provider, external_ref, label, status)
    SELECT 'freelancer', fp.user_id, 'payout', 'stripe', 'ba_probe_foreign', 'Someone else', 'active'
      FROM org.freelancer_profiles fp WHERE fp.user_id <> r.payee ORDER BY fp.user_id LIMIT 1
    RETURNING id::text INTO STRICT v_method;
    PERFORM pg_catalog.set_config('probe.method_foreign', v_method, true);

    PERFORM finance.fn_wallet_credit(r.payee, 'freelancer', (SELECT currency FROM finance.wallets WHERE id = r.wallet),
        200000, 'topup', 'probe', NULL);
    RAISE NOTICE 'fixture wallet=% payee=% currency=% min=%', r.wallet, r.payee, r.currency, pg_temp.s('min');
END $$;

SELECT pg_temp.ok(pg_temp.s('min')::bigint > 0, 'min_withdrawal_minor is seeded for the fixture currency');
-- #endregion

-- #region 1. begin_payout: the minimum and the destination
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(pg_temp.s('min')::bigint - 1, 'probe-payout-below-min', NULL), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') LIKE 'refused:amountMinor:%smallest withdrawal%', 'a withdrawal below the minimum is refused: ' || pg_temp.s('out'));

SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(5000, 'probe-payout-foreign', pg_temp.s('method_foreign')::uuid), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') LIKE 'refused:destinationId:%', 'another person''s payout method is refused: ' || pg_temp.s('out'));

SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(5000, 'probe-payout-inactive', pg_temp.s('method_inactive')::uuid), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') LIKE 'refused:destinationId:%', 'an inactive payout method is refused: ' || pg_temp.s('out'));
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.payouts WHERE wallet_id = pg_temp.s('wallet')::uuid AND status = 'pending'),
    'a refused withdrawal leaves no payout behind');

SELECT pg_catalog.set_config('probe.b0', pg_temp.bal()::text, true);
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(5000, 'probe-payout-one', pg_temp.s('method_own')::uuid), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') LIKE 'ok:%', 'the caller''s own active payout method is accepted: ' || pg_temp.s('out'));
SELECT pg_catalog.set_config('probe.p1', pg_catalog.substr(pg_temp.s('out'), 4), true);
SELECT pg_temp.ok((pg_temp.payout(pg_temp.s('p1'))).destination_method_id = pg_temp.s('method_own')::uuid,
    'the payout records the chosen destination');
SELECT pg_temp.ok((pg_temp.payout(pg_temp.s('p1'))).destination_account = pg_temp.s('acct'),
    'the payout records the connected account it is sent to');
SELECT pg_temp.ok(pg_temp.bal() = pg_temp.s('b0')::bigint - 5000, 'the wallet is debited once');

SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.out', pg_temp.withdraw(5000, 'probe-payout-one', NULL), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') LIKE 'refused:idempotencyKey:%',
    'the attempt key binds the destination: the same key with another destination is refused');
-- #endregion

-- #region 2. transfer.reversed — idempotent by value, partial then full
SET LOCAL ROLE service_role;
SELECT finance.complete_payout(pg_temp.s('p1')::uuid, 'tr_probe_one');
SELECT pg_catalog.set_config('probe.out', finance.record_transfer_reversed('evt_probe_rev_1', 'tr_probe_one',
    pg_temp.s('acct'), 5000, 2000, pg_temp.s('currency'), pg_temp.s('p1')::uuid, false) ->> 'outcome', true);
SELECT pg_catalog.set_config('probe.out2', finance.record_transfer_reversed('evt_probe_rev_1', 'tr_probe_one',
    pg_temp.s('acct'), 5000, 2000, pg_temp.s('currency'), pg_temp.s('p1')::uuid, false) ->> 'outcome', true);
SELECT pg_catalog.set_config('probe.out3', finance.record_transfer_reversed('evt_probe_rev_dup', 'tr_probe_one',
    pg_temp.s('acct'), 5000, 2000, pg_temp.s('currency'), pg_temp.s('p1')::uuid, false) ->> 'outcome', true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') = 'applied' AND pg_temp.s('out2') = 'replayed',
    'transfer.reversed: applied, then replayed by event id');
SELECT pg_temp.ok(pg_temp.bal() = pg_temp.s('b0')::bigint - 3000,
    'a partial reversal credits only the reversed amount, once (a second event at the same total credits nothing)');
SELECT pg_temp.ok((pg_temp.payout(pg_temp.s('p1'))).status = 'paid' AND (pg_temp.payout(pg_temp.s('p1'))).reversed_cents = 2000,
    'a partially reversed payout stays paid with reversed_cents');

SET LOCAL ROLE service_role;
SELECT finance.record_transfer_reversed('evt_probe_rev_2', 'tr_probe_one',
    pg_temp.s('acct'), 5000, 5000, pg_temp.s('currency'), pg_temp.s('p1')::uuid, false);
SELECT finance.record_transfer_reversed('evt_probe_rev_stale', 'tr_probe_one',
    pg_temp.s('acct'), 5000, 2000, pg_temp.s('currency'), pg_temp.s('p1')::uuid, false);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.bal() = pg_temp.s('b0')::bigint, 'a full reversal returns the whole amount, and a late lower total credits nothing');
SELECT pg_temp.ok((pg_temp.payout(pg_temp.s('p1'))).status = 'reversed', 'a fully reversed payout is reversed');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications WHERE user_id = pg_temp.s('payee')::uuid
    AND type = 'payout.reversed' AND entity_id = pg_temp.s('p1')::uuid), 'the owner is told the payout came back');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('probe.out', finance.record_transfer_reversed('evt_probe_rev_wrong', 'tr_probe_other',
    pg_temp.s('acct'), 5000, 5000, pg_temp.s('currency'), pg_temp.s('p1')::uuid, false) ->> 'outcome', true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') = 'unmatched', 'a reversal of a different transfer than the payout''s is unmatched');
-- #endregion

-- #region 3. Connected-account payout.failed / payout.paid
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.p2', pg_catalog.substr(pg_temp.withdraw(4000, 'probe-payout-two', NULL), 4), true);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT finance.complete_payout(pg_temp.s('p2')::uuid, 'tr_probe_two');
SELECT pg_catalog.set_config('probe.out', finance.record_bank_payout('evt_probe_po_failed', 'payout.failed',
    pg_temp.s('acct'), 'po_probe_1', 'failed', 'account_closed', ARRAY['tr_probe_two'], ARRAY[]::text[], false) ->> 'outcome', true);
SELECT finance.record_bank_payout('evt_probe_po_paid_late', 'payout.paid',
    pg_temp.s('acct'), 'po_probe_1', 'paid', NULL, ARRAY['tr_probe_two'], ARRAY[]::text[], false);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') = 'applied', 'payout.failed for a connected account is applied');
SELECT pg_temp.ok((pg_temp.payout(pg_temp.s('p2'))).bank_status = 'failed'
    AND (pg_temp.payout(pg_temp.s('p2'))).bank_failure_code = 'account_closed'
    AND (pg_temp.payout(pg_temp.s('p2'))).status = 'paid',
    'the bank failure is recorded beside a still-paid payout (the money sits in the connected account)');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications WHERE user_id = pg_temp.s('payee')::uuid
    AND type = 'payout.failed'), 'the owner is told the bank payout failed');
SELECT pg_temp.ok(pg_temp.bal() = pg_temp.s('b0')::bigint - 4000, 'a bank failure moves nothing in the ledger');

SET LOCAL ROLE service_role;
SELECT finance.record_bank_payout('evt_probe_po_repaid', 'payout.paid',
    pg_temp.s('acct'), 'po_probe_2', 'paid', NULL, ARRAY[]::text[], ARRAY['po_probe_1'], false);
SELECT pg_catalog.set_config('probe.out', finance.record_bank_payout('evt_probe_po_unknown', 'payout.paid',
    'acct_probe_nobody', 'po_probe_9', 'paid', NULL, ARRAY[]::text[], ARRAY[]::text[], false) ->> 'outcome', true);
RESET ROLE;
SELECT pg_temp.ok((pg_temp.payout(pg_temp.s('p2'))).bank_status = 'paid'
    AND (pg_temp.payout(pg_temp.s('p2'))).bank_payout_ref = 'po_probe_2',
    'a later payout that re-pays the failed one marks it paid');
SELECT pg_temp.ok(pg_temp.s('out') = 'unmatched', 'a payout for an account Projective does not know is unmatched');
-- #endregion

-- #region 4. The stale-pending sweep's claim
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('probe.p3', pg_catalog.substr(pg_temp.withdraw(3000, 'probe-payout-three', NULL), 4), true);
SELECT pg_catalog.set_config('probe.p4', pg_catalog.substr(pg_temp.withdraw(3000, 'probe-payout-four', NULL), 4), true);
RESET ROLE;
UPDATE finance.payouts SET initiated_at = pg_catalog.now() - interval '2 hours' WHERE id = pg_temp.s('p3')::uuid;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('probe.claim', finance.fn_claim_stale_payouts(50)::text, true);
SELECT pg_catalog.set_config('probe.claim2', finance.fn_claim_stale_payouts(50)::text, true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('claim')::jsonb @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', pg_temp.s('p3'), 'destination_account', pg_temp.s('acct'))),
    'a pending payout older than the window is claimed with its destination');
SELECT pg_temp.ok(NOT pg_temp.s('claim')::jsonb @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', pg_temp.s('p4'))),
    'a fresh pending payout is not claimed');
SELECT pg_temp.ok(NOT pg_temp.s('claim2')::jsonb @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', pg_temp.s('p3'))),
    'a claimed payout is leased: an immediate second sweep skips it');
SELECT pg_temp.ok((pg_temp.payout(pg_temp.s('p3'))).sweep_attempts = 1, 'the claim counts the attempt');
-- #endregion

-- #region 5. Who may call the doors
SELECT pg_temp.ok(
    has_function_privilege('authenticated', 'finance.begin_payout(uuid, bigint, text, boolean, text, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'finance.begin_payout(uuid, bigint, text, boolean, text, uuid)', 'EXECUTE'),
    'begin_payout (with its destination) is a user door');
SELECT pg_temp.ok(
    NOT has_function_privilege('authenticated', 'finance.record_transfer_reversed(text, text, text, bigint, bigint, text, uuid, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'finance.record_bank_payout(text, text, text, text, text, text, text[], text[], boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'finance.fn_claim_stale_payouts(integer)', 'EXECUTE')
    AND has_function_privilege('service_role', 'finance.record_transfer_reversed(text, text, text, bigint, bigint, text, uuid, boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'finance.record_bank_payout(text, text, text, text, text, text, text[], text[], boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'finance.fn_claim_stale_payouts(integer)', 'EXECUTE'),
    'the reversal, bank-payout and sweep doors are the service role''s only');
SELECT pg_temp.ok(NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'finance' AND p.proname = 'begin_payout' AND p.pronargs <> 6),
    'begin_payout has one signature');
-- #endregion

-- #region 6. Reconciliation
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.v_wallet_reconciliation
    WHERE wallet_id = pg_temp.s('wallet')::uuid AND drift_cents <> 0), 'the fixture wallet reconciles');
-- #endregion

ROLLBACK;
