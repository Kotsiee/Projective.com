-- stripe-smoke.sql — the money half of `deno task smoke:stripe` (scripts/stripe-smoke.ts).
--
-- Drives the finance doors exactly as the Stripe rails do — user doors as `authenticated` with the
-- payer's claims, processor doors as `service_role` — across the card-escrow round trip (step 3) and
-- the release → payout-gate → transfer path (step 5), then checks reconciliation. Everything runs in
-- ONE transaction that is ROLLED BACK, so the seeded database is left exactly as it was.
--
-- psql variables (set by the runner): pi (a PaymentIntent id stripe-mock created through
-- createPaymentIntent), and tr / tr2 (Transfer ids it created through createTransfer; tr2 carries the
-- payout transfer group, Decision #202).
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'SMOKE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Act as a signed-in person for the next user-door call (claims first, then SET LOCAL ROLE).
CREATE FUNCTION pg_temp.act(p_uid text) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('smoke.' || p_key);
$$;

CREATE FUNCTION pg_temp.bal(p_wallet text) RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = p_wallet::uuid;
$$;

CREATE FUNCTION pg_temp.held() RETURNS bigint LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM finance.escrows
     WHERE project_stage_id = pg_temp.s('stage')::uuid AND status = 'held';
$$;
-- #endregion

-- #region Fixture: an assigned stage of an individual client's project, with an assigned unpaid ticket
SELECT pg_catalog.set_config('smoke.pi', :'pi', true), pg_catalog.set_config('smoke.tr', :'tr', true);
DO $$
DECLARE r record;
BEGIN
    SELECT ps.id AS stage, p.id AS project, p.owner_user_id AS owner, t.id AS ticket,
           t.current_assignee_id AS payee
      INTO r
      FROM projects.project_stages ps
      JOIN projects.projects p ON p.id = ps.project_id
      JOIN projects.tickets t ON t.current_stage_id = ps.id
     WHERE ps.status = 'assigned' AND p.client_business_id IS NULL AND p.currency = 'USD'
       AND t.current_assignee_id IS NOT NULL AND t.payment_status = 'unpaid'
       AND finance.fn_person_wallet_type(t.current_assignee_id) = 'freelancer'
     ORDER BY ps.id LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'SMOKE FAIL: no fixture stage — run `deno task db:reset` for the seeded world';
    END IF;
    PERFORM pg_catalog.set_config('smoke.stage', r.stage::text, true);
    PERFORM pg_catalog.set_config('smoke.project', r.project::text, true);
    PERFORM pg_catalog.set_config('smoke.owner', r.owner::text, true);
    PERFORM pg_catalog.set_config('smoke.ticket', r.ticket::text, true);
    PERFORM pg_catalog.set_config('smoke.payee', r.payee::text, true);
    PERFORM pg_catalog.set_config('smoke.acct', 'acct_smoke' || pg_catalog.md5(pg_catalog.random()::text), true);
    -- The payee starts NOT payable, so the gate below is exercised whatever the seed says.
    UPDATE org.freelancer_profiles SET payout_ready = false, kyc_status = 'pending' WHERE user_id = r.payee;
    -- The amount the payer is shown is the amount the database will hold.
    PERFORM pg_catalog.set_config('smoke.amount', (
        SELECT SUM(COALESCE(t.unit_price_cents, ps.unit_price_cents))::text
          FROM projects.tickets t JOIN projects.project_stages ps ON ps.id = t.current_stage_id
         WHERE t.current_stage_id = r.stage AND t.current_assignee_id IS NOT NULL
           AND t.payment_status = 'unpaid'), true);
END $$;
-- #endregion

-- Start an escrow-lock card payment as the owner and bind it to a PaymentIntent (the
-- POST /api/finance/escrow/intent order: begin_card_payment → Stripe → attach_card_payment).
CREATE FUNCTION pg_temp.begin_lock(p_pi text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    v := finance.begin_card_payment('escrow_lock', NULL, pg_temp.s('project')::uuid, pg_temp.s('stage')::uuid,
        pg_temp.s('amount')::bigint, 'USD', 'smoke-' || p_pi);
    PERFORM finance.attach_card_payment((v ->> 'id')::uuid, p_pi);
    PERFORM pg_catalog.set_config('smoke.payment', v ->> 'id', true);
    PERFORM pg_catalog.set_config('smoke.wallet', v ->> 'wallet_id', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.begin_lock(text), pg_temp.s(text) TO authenticated;

-- #region 3a. Decline (4000 0000 0000 9995): failed is not final; canceled ends the lock
SAVEPOINT decline;
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_temp.begin_lock('pi_smoke_decline');
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('smoke.b0', pg_temp.bal(pg_temp.s('wallet'))::text, true);
SELECT finance.record_card_payment_failure('evt_smoke_decline', 'pi_smoke_decline', 'failed', 'insufficient_funds', false);
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'failed' AND lock_status = 'pending' AND failure_reason = 'insufficient_funds'
    FROM finance.inbound_payments WHERE id = pg_temp.s('payment')::uuid),
    'decline: payment failed, lock still pending (the payer may retry)');
SET LOCAL ROLE service_role;
SELECT finance.record_card_payment_failure('evt_smoke_cancel', 'pi_smoke_decline', 'canceled', NULL, false);
RESET ROLE;
SELECT pg_temp.ok((SELECT lock_status = 'failed' AND lock_error = 'The payment was canceled.'
    FROM finance.inbound_payments WHERE id = pg_temp.s('payment')::uuid), 'cancel: lock failed with a readable reason');
SELECT pg_temp.ok(pg_temp.bal(pg_temp.s('wallet')) = pg_temp.s('b0')::bigint AND pg_temp.held() = 0,
    'decline/cancel: no money moved, nothing held');
ROLLBACK TO SAVEPOINT decline;
-- #endregion

-- #region 3b. "Less arrived than the stage needs": the money lands in the wallet, lock_error is readable
SAVEPOINT short;
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_temp.begin_lock('pi_smoke_short');
RESET ROLE;
SELECT pg_catalog.set_config('smoke.b0', pg_temp.bal(pg_temp.s('wallet'))::text, true);
SET LOCAL ROLE service_role;
SELECT finance.settle_card_payment('evt_smoke_short', 'pi_smoke_short', pg_temp.s('amount')::bigint - 100, 'USD', false);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.bal(pg_temp.s('wallet')) = pg_temp.s('b0')::bigint + pg_temp.s('amount')::bigint - 100,
    'short: the amount received is credited to the wallet');
SELECT pg_temp.ok(pg_temp.held() = 0, 'short: nothing held');
-- Read back as the payer under RLS — what GET /api/finance/payments/[id] returns to the polling UI.
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('smoke.err', (SELECT lock_status || '|' || lock_error
    FROM finance.inbound_payments WHERE id = pg_temp.s('payment')::uuid), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('err') LIKE 'failed|Less arrived than the stage needs%',
    'short: lock_error readable by the payer (RLS)');
ROLLBACK TO SAVEPOINT short;
-- #endregion

-- #region 3c. "The stage no longer exists" (project_stage_id SET NULL by the FK)
SAVEPOINT gone;
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_temp.begin_lock('pi_smoke_gone');
RESET ROLE;
SELECT pg_catalog.set_config('smoke.b0', pg_temp.bal(pg_temp.s('wallet'))::text, true);
UPDATE finance.inbound_payments SET project_stage_id = NULL WHERE id = pg_temp.s('payment')::uuid;
SET LOCAL ROLE service_role;
SELECT finance.settle_card_payment('evt_smoke_gone', 'pi_smoke_gone', pg_temp.s('amount')::bigint, 'USD', false);
RESET ROLE;
SELECT pg_temp.ok((SELECT lock_status = 'failed' AND lock_error LIKE 'The stage this payment was for no longer exists%'
    FROM finance.inbound_payments WHERE id = pg_temp.s('payment')::uuid), 'gone: lock failed with a readable reason');
SELECT pg_temp.ok(pg_temp.bal(pg_temp.s('wallet')) = pg_temp.s('b0')::bigint + pg_temp.s('amount')::bigint,
    'gone: the full amount is in the wallet');
ROLLBACK TO SAVEPOINT gone;
-- #endregion

-- #region 3d. Success (4242…, and 3155 after its 3-D Secure challenge): settle → locked, escrows held
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_temp.begin_lock(pg_temp.s('pi'));
RESET ROLE;
SELECT pg_catalog.set_config('smoke.b0', pg_temp.bal(pg_temp.s('wallet'))::text, true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('smoke.out',
    finance.settle_card_payment('evt_smoke_ok', pg_temp.s('pi'), pg_temp.s('amount')::bigint, 'USD', false) ->> 'outcome', true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') = 'applied', 'success: settlement applied');
SELECT pg_temp.ok((SELECT status = 'succeeded' AND lock_status = 'locked' AND lock_error IS NULL
        AND pg_catalog.cardinality(locked_escrow_ids) = pg_temp.held()
    FROM finance.inbound_payments WHERE id = pg_temp.s('payment')::uuid) AND pg_temp.held() > 0,
    'success: inbound_payments.lock_status = locked, its escrows are held');
SELECT pg_temp.ok(pg_temp.bal(pg_temp.s('wallet')) = pg_temp.s('b0')::bigint,
    'success: credit and hold net to zero in the payer wallet');

-- Idempotency: the same event replayed, and a second event for the same PaymentIntent, move nothing.
SELECT pg_catalog.set_config('smoke.tx', (SELECT pg_catalog.count(*) FROM finance.transactions)::text, true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('smoke.out',
    finance.settle_card_payment('evt_smoke_ok', pg_temp.s('pi'), pg_temp.s('amount')::bigint, 'USD', false) ->> 'outcome', true);
SELECT pg_catalog.set_config('smoke.out2',
    finance.settle_card_payment('evt_smoke_ok_dup', pg_temp.s('pi'), pg_temp.s('amount')::bigint, 'USD', false) ->> 'outcome', true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') = 'replayed' AND pg_temp.s('out2') = 'replayed',
    'replay: a redelivered event and a duplicate event both answer replayed');
SELECT pg_temp.ok((SELECT pg_catalog.count(*) FROM finance.transactions) = pg_temp.s('tx')::bigint
        AND pg_temp.bal(pg_temp.s('wallet')) = pg_temp.s('b0')::bigint,
    'replay: no ledger row and no balance change');
-- #endregion

-- #region 4. Wallet top-up by card
SELECT pg_temp.act(pg_temp.s('owner')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('smoke.topup', finance.begin_card_payment('wallet_topup', pg_temp.s('wallet')::uuid,
    NULL, NULL, 5000, 'USD', 'smoke-topup-' || pg_temp.s('pi')) ->> 'id', true);
SELECT finance.attach_card_payment(pg_temp.s('topup')::uuid, 'pi_smoke_topup');
RESET ROLE;
SELECT pg_catalog.set_config('smoke.b0', pg_temp.bal(pg_temp.s('wallet'))::text, true);
SET LOCAL ROLE service_role;
SELECT finance.settle_card_payment('evt_smoke_topup', 'pi_smoke_topup', 5000, 'USD', false);
SELECT finance.settle_card_payment('evt_smoke_topup', 'pi_smoke_topup', 5000, 'USD', false);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.bal(pg_temp.s('wallet')) = pg_temp.s('b0')::bigint + 5000,
    'top-up: credited once, replay ignored');
-- #endregion

-- #region 5. Release → payout gate → transfer
SELECT finance.fn_release_ticket_escrow(pg_temp.s('ticket')::uuid);
SELECT pg_temp.ok(pg_temp.held() = 0, 'release: the held escrow is released');
SELECT pg_catalog.set_config('smoke.pw', (SELECT id::text FROM finance.wallets
    WHERE owner_type = 'freelancer' AND owner_id = pg_temp.s('payee')::uuid AND currency = 'USD'), true);
SELECT pg_temp.ok(pg_temp.bal(pg_temp.s('pw')) >= 1000, 'release: the freelancer wallet is credited');

CREATE FUNCTION pg_temp.try_payout() RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    v := finance.begin_payout(pg_temp.s('pw')::uuid, 1000, 'USD', false, 'smoke-payout-' || pg_temp.s('pi'));
    PERFORM pg_catalog.set_config('smoke.payout', v ->> 'id', true);
    RETURN 'ok:' || (v ->> 'destination');
EXCEPTION WHEN OTHERS THEN
    RETURN 'refused:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.try_payout() TO authenticated;

SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('smoke.out', pg_temp.try_payout(), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') LIKE 'refused:verification:%', 'gate: an unverified freelancer cannot withdraw');

-- Connect onboarding (POST /api/finance/connect/onboarding records the account; account.updated syncs it)
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT finance.record_payout_account('personal', NULL, pg_temp.s('acct'));
SET LOCAL ROLE service_role;
SELECT finance.sync_payout_account(pg_temp.s('acct'), 'verified');
RESET ROLE;
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('smoke.out', pg_temp.try_payout(), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') LIKE 'refused:verification:%',
    'gate: a verified payout account alone is not enough (KYC still pending)');

-- Stripe Identity's verdict (identity.verification_session.verified) completes the gate.
UPDATE org.freelancer_profiles SET kyc_status = 'verified' WHERE user_id = pg_temp.s('payee')::uuid;
SELECT pg_temp.ok(finance.fn_freelancer_payout_ready(pg_temp.s('payee')::uuid), 'gate: fn_freelancer_payout_ready');
SELECT pg_catalog.set_config('smoke.b0', pg_temp.bal(pg_temp.s('pw'))::text, true);
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('smoke.out', pg_temp.try_payout(), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') = 'ok:' || pg_temp.s('acct'), 'payout: begun to the verified connected account');

SET LOCAL ROLE service_role;
SELECT finance.complete_payout(pg_temp.s('payout')::uuid, pg_temp.s('tr'));
SELECT pg_catalog.set_config('smoke.out', finance.record_transfer_created('evt_smoke_tr', pg_temp.s('tr'),
    pg_temp.s('acct'), 1000, 'USD', pg_temp.s('payout')::uuid, false) ->> 'outcome', true);
SELECT pg_catalog.set_config('smoke.out2', finance.record_transfer_created('evt_smoke_tr', pg_temp.s('tr'),
    pg_temp.s('acct'), 1000, 'USD', pg_temp.s('payout')::uuid, false) ->> 'outcome', true);
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'paid' AND provider_ref = pg_temp.s('tr') FROM finance.payouts
    WHERE id = pg_temp.s('payout')::uuid), 'transfer: the payout is paid through the stripe-mock transfer');
SELECT pg_temp.ok(pg_temp.s('out') = 'applied' AND pg_temp.s('out2') = 'replayed', 'transfer.created: applied, then replayed');
SELECT pg_temp.ok(pg_temp.bal(pg_temp.s('pw')) = pg_temp.s('b0')::bigint - 1000, 'transfer: the wallet is debited exactly once');
-- #endregion

-- #region 5b. After the transfer (Decision #202): minimum, reversal, bank payout, stale sweep
SELECT pg_catalog.set_config('smoke.tr2', :'tr2', true);
SELECT finance.fn_wallet_credit(pg_temp.s('payee')::uuid, 'freelancer', 'USD', 10000, 'topup', 'smoke', NULL);
CREATE FUNCTION pg_temp.try_withdraw(p_amount bigint, p_key text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
    v := finance.begin_payout(pg_temp.s('pw')::uuid, p_amount, 'USD', false, p_key || '-' || pg_temp.s('pi'));
    RETURN 'ok:' || (v ->> 'id');
EXCEPTION WHEN OTHERS THEN
    RETURN 'refused:' || SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.try_withdraw(bigint, text) TO authenticated;

SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('smoke.out', pg_temp.try_withdraw(finance.fn_min_withdrawal_minor('USD') - 1, 'smoke-min'), true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') LIKE 'refused:amountMinor:%smallest withdrawal%', 'minimum: a withdrawal below it is refused');

-- transfer.reversed: 400 of the first payout's 1000 comes back, once.
SELECT pg_catalog.set_config('smoke.b1', pg_temp.bal(pg_temp.s('pw'))::text, true);
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('smoke.out', finance.record_transfer_reversed('evt_smoke_rev', pg_temp.s('tr'),
    pg_temp.s('acct'), 1000, 400, 'USD', pg_temp.s('payout')::uuid, false) ->> 'outcome', true);
SELECT pg_catalog.set_config('smoke.out2', finance.record_transfer_reversed('evt_smoke_rev', pg_temp.s('tr'),
    pg_temp.s('acct'), 1000, 400, 'USD', pg_temp.s('payout')::uuid, false) ->> 'outcome', true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('out') = 'applied' AND pg_temp.s('out2') = 'replayed', 'transfer.reversed: applied, then replayed');
SELECT pg_temp.ok(pg_temp.bal(pg_temp.s('pw')) = pg_temp.s('b1')::bigint + 400, 'transfer.reversed: only the reversed part is credited');
SELECT pg_temp.ok((SELECT status = 'paid' AND reversed_cents = 400 FROM finance.payouts WHERE id = pg_temp.s('payout')::uuid),
    'transfer.reversed: a partial reversal stays paid');

-- A connected account's bank payout fails, then a later one re-pays it.
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('smoke.p2', pg_catalog.substr(pg_temp.try_withdraw(1000, 'smoke-payout-2'), 4), true);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT finance.complete_payout(pg_temp.s('p2')::uuid, pg_temp.s('tr2'));
SELECT finance.record_bank_payout('evt_smoke_po_failed', 'payout.failed', pg_temp.s('acct'), 'po_smoke_1', 'failed',
    'account_closed', ARRAY[pg_temp.s('tr2')], ARRAY[]::text[], false);
RESET ROLE;
SELECT pg_temp.ok((SELECT status = 'paid' AND bank_status = 'failed' FROM finance.payouts WHERE id = pg_temp.s('p2')::uuid),
    'payout.failed: the bank failure is recorded, the transfer stands');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications WHERE user_id = pg_temp.s('payee')::uuid AND type = 'payout.failed'),
    'payout.failed: the owner is told');
SET LOCAL ROLE service_role;
SELECT finance.record_bank_payout('evt_smoke_po_paid', 'payout.paid', pg_temp.s('acct'), 'po_smoke_2', 'paid',
    NULL, ARRAY[]::text[], ARRAY['po_smoke_1'], false);
RESET ROLE;
SELECT pg_temp.ok((SELECT bank_status = 'paid' AND bank_payout_ref = 'po_smoke_2' FROM finance.payouts WHERE id = pg_temp.s('p2')::uuid),
    'payout.paid: the re-paying bank payout marks it paid');

-- A payout whose transfer answer was lost is claimed by the sweep once its window passes.
SELECT pg_temp.act(pg_temp.s('payee')); SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('smoke.p3', pg_catalog.substr(pg_temp.try_withdraw(1000, 'smoke-payout-3'), 4), true);
RESET ROLE;
UPDATE finance.payouts SET initiated_at = pg_catalog.now() - interval '1 hour' WHERE id = pg_temp.s('p3')::uuid;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('smoke.claim', finance.fn_claim_stale_payouts(50)::text, true);
RESET ROLE;
SELECT pg_temp.ok(pg_temp.s('claim')::jsonb @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'id', pg_temp.s('p3'), 'destination_account', pg_temp.s('acct'))), 'sweep: the stale payout is claimed with its destination');
-- #endregion

-- #region 6. Reconciliation
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM finance.v_wallet_reconciliation WHERE drift_cents <> 0),
    'reconciliation: v_wallet_reconciliation shows no drift');
-- #endregion

ROLLBACK;
