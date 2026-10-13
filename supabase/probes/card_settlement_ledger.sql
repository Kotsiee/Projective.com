-- =============================================================================================
-- Probe: a succeeded card payment always lands in a ledger row, or is flagged — Decision #200.
-- finance.settle_card_payment, finance.fn_release_stripe_event, the `settled_unapplied` status and
-- finance.v_ops_unledgered_payments.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/card_settlement_ledger.sql
--
-- A clean run prints only PASS notices; a broken contract raises `FAIL …`. Each check sits between a
-- SAVEPOINT and a ROLLBACK TO, so running WITHOUT ON_ERROR_STOP reports every failing check. The
-- payer is a seeded `user` wallet's owner (deno task db:reset); payments are inserted as postgres in
-- the shape begin_card_payment + attach_card_payment leave them, so each check isolates the settle door.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_wallet finance.wallets;
BEGIN
    SELECT w.* INTO v_wallet
      FROM finance.wallets w
      JOIN auth.users u ON u.id = w.owner_id
     WHERE w.owner_type = 'user'
     ORDER BY w.id
     LIMIT 1;
    IF v_wallet.id IS NULL THEN
        RAISE EXCEPTION 'FAIL fixtures: no seeded user wallet (run deno task db:reset)';
    END IF;
    PERFORM pg_catalog.set_config('probe.wallet', v_wallet.id::text, true);
    PERFORM pg_catalog.set_config('probe.payer', v_wallet.owner_id::text, true);
    PERFORM pg_catalog.set_config('probe.currency', v_wallet.currency, true);
    RAISE NOTICE 'fixture wallet=% payer=% currency=%', v_wallet.id, v_wallet.owner_id, v_wallet.currency;
END $$;

-- A bound, processing card payment into the fixture wallet.
CREATE FUNCTION pg_temp.probe_payment(p_ref text, p_amount bigint, p_purpose text DEFAULT 'wallet_topup',
    p_checkout jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE sql
AS $$
    INSERT INTO finance.inbound_payments (
        purpose, wallet_id, amount_cents, currency, status, lock_status, provider, provider_ref,
        idempotency_key, created_by, checkout
    ) VALUES (
        p_purpose,
        pg_catalog.current_setting('probe.wallet')::uuid,
        p_amount,
        pg_catalog.current_setting('probe.currency'),
        'processing',
        CASE WHEN p_purpose = 'escrow_lock' THEN 'pending' ELSE 'not_applicable' END,
        'stripe',
        p_ref,
        'probe200-' || p_ref,
        pg_catalog.current_setting('probe.payer')::uuid,
        p_checkout
    )
    RETURNING id;
$$;

CREATE FUNCTION pg_temp.probe_balance()
RETURNS bigint
LANGUAGE sql
AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = pg_catalog.current_setting('probe.wallet')::uuid;
$$;
-- #endregion

-- #region 1. A plain top-up lands in the ledger, and a redelivery is acknowledged WITH that row
SAVEPOINT s_plain;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe200_plain', 1500);
    v_before bigint := pg_temp.probe_balance();
    v_out jsonb;
    v_again jsonb;
    v_p finance.inbound_payments;
    v_t finance.transactions;
BEGIN
    v_out := finance.settle_card_payment('evt_probe200_plain', 'pi_probe200_plain', 1500,
        pg_catalog.current_setting('probe.currency'), false);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_id;
    SELECT * INTO v_t FROM finance.transactions WHERE id = v_p.transaction_id;
    IF v_out ->> 'outcome' <> 'applied' OR v_p.status::text <> 'succeeded' OR v_t.id IS NULL
       OR v_t.amount_cents <> 1500 OR v_t.ref_id <> v_id OR pg_temp.probe_balance() <> v_before + 1500
       OR (v_out ->> 'transaction_id')::uuid IS DISTINCT FROM v_t.id THEN
        RAISE EXCEPTION 'FAIL plain settle: % status=% tx=%', v_out, v_p.status, v_p.transaction_id;
    END IF;
    RAISE NOTICE 'PASS a plain top-up settles into one ledger row and reports its id';

    v_again := finance.settle_card_payment('evt_probe200_plain', 'pi_probe200_plain', 1500,
        pg_catalog.current_setting('probe.currency'), false);
    IF v_again ->> 'outcome' <> 'replayed' OR (v_again ->> 'transaction_id')::uuid IS DISTINCT FROM v_t.id
       OR pg_temp.probe_balance() <> v_before + 1500 THEN
        RAISE EXCEPTION 'FAIL redelivery: % (a replay must carry the ledger row it produced)', v_again;
    END IF;
    RAISE NOTICE 'PASS a redelivery replays with the same transaction_id and credits nothing';
END $$;
ROLLBACK TO SAVEPOINT s_plain;
-- #endregion

-- #region 2. A checkout whose order fails after the credit: settled_unapplied, credit kept, payer told
SAVEPOINT s_order;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe200_order', 2500, 'wallet_topup', pg_catalog.jsonb_build_object(
        'basket_id', pg_catalog.gen_random_uuid(),
        'item_ids', pg_catalog.jsonb_build_array(pg_catalog.gen_random_uuid()),
        'currency', pg_catalog.current_setting('probe.currency'),
        'units', '{}'::jsonb,
        'promo_code', NULL,
        'order_key', 'probe200-order-key'));
    v_before bigint := pg_temp.probe_balance();
    v_out jsonb;
    v_p finance.inbound_payments;
    v_note comms.notifications;
BEGIN
    v_out := finance.settle_card_payment('evt_probe200_order', 'pi_probe200_order', 2500,
        pg_catalog.current_setting('probe.currency'), false);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_id;
    IF v_p.status::text <> 'settled_unapplied' THEN
        RAISE EXCEPTION 'FAIL order refused: status % (want settled_unapplied), order_error %', v_p.status, v_p.order_error;
    END IF;
    IF v_p.transaction_id IS NULL OR pg_temp.probe_balance() <> v_before + 2500 OR v_p.order_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL order refused: the credit did not survive (tx %, balance %)', v_p.transaction_id, pg_temp.probe_balance();
    END IF;
    IF (pg_catalog.to_jsonb(v_p) ->> 'unapplied_reason') IS NULL OR v_p.order_error IS NULL THEN
        RAISE EXCEPTION 'FAIL order refused: no unapplied_reason recorded';
    END IF;
    IF v_out ->> 'outcome' <> 'applied' OR v_out ->> 'status' <> 'settled_unapplied'
       OR (v_out ->> 'transaction_id')::uuid IS DISTINCT FROM v_p.transaction_id THEN
        RAISE EXCEPTION 'FAIL order refused: outcome %', v_out;
    END IF;
    SELECT * INTO v_note FROM comms.notifications
     WHERE entity_table = 'inbound_payments' AND entity_id = v_id AND user_id = v_p.created_by;
    IF v_note.id IS NULL OR v_note.title !~* 'wallet' OR v_note.body !~* 'in your wallet' THEN
        RAISE EXCEPTION 'FAIL order refused: payer notification % / %', v_note.title, v_note.body;
    END IF;
    RAISE NOTICE 'PASS a refused order leaves the credit, marks settled_unapplied (%), tells the payer', (pg_catalog.to_jsonb(v_p) ->> 'unapplied_reason');
END $$;
ROLLBACK TO SAVEPOINT s_order;
-- #endregion

-- #region 3. An escrow lock that cannot be held after the credit: settled_unapplied, credit kept
SAVEPOINT s_lock;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe200_lock', 3500, 'escrow_lock');
    v_before bigint := pg_temp.probe_balance();
    v_out jsonb;
    v_p finance.inbound_payments;
BEGIN
    v_out := finance.settle_card_payment('evt_probe200_lock', 'pi_probe200_lock', 3500,
        pg_catalog.current_setting('probe.currency'), false);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_id;
    IF v_p.status::text <> 'settled_unapplied' OR v_p.lock_status <> 'failed'
       OR (pg_catalog.to_jsonb(v_p) ->> 'unapplied_reason') IS NULL
       OR v_p.transaction_id IS NULL OR pg_temp.probe_balance() <> v_before + 3500 THEN
        RAISE EXCEPTION 'FAIL failed lock: status % lock % tx %', v_p.status, v_p.lock_status, v_p.transaction_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications n
                    WHERE n.entity_table = 'inbound_payments' AND n.entity_id = v_id AND n.body ~* 'in your wallet') THEN
        RAISE EXCEPTION 'FAIL failed lock: payer not told the funds are in the wallet';
    END IF;
    RAISE NOTICE 'PASS a lock refused after the credit keeps the money and marks settled_unapplied';
END $$;
ROLLBACK TO SAVEPOINT s_lock;
-- #endregion

-- #region 4. A success that arrives before its PaymentIntent is bound is NOT swallowed by dedupe
SAVEPOINT s_early;
DO $$
DECLARE
    v_out jsonb;
    v_id uuid;
    v_before bigint;
    v_p finance.inbound_payments;
BEGIN
    v_out := finance.settle_card_payment('evt_probe200_early', 'pi_probe200_early', 4500,
        pg_catalog.current_setting('probe.currency'), false);
    IF v_out ->> 'outcome' <> 'unmatched' THEN
        RAISE EXCEPTION 'FAIL early success: outcome %', v_out;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.idempotency_keys WHERE key = 'stripe:evt_probe200_early') THEN
        RAISE EXCEPTION 'FAIL early success: the claim was kept, so Stripe''s retry will be replayed and never credited';
    END IF;
    RAISE NOTICE 'PASS an unmatched settlement releases its claim';

    -- The deposit runner binds the intent (bind_scheduled_payment); Stripe redelivers the same event.
    v_id := pg_temp.probe_payment('pi_probe200_early', 4500);
    v_before := pg_temp.probe_balance();
    v_out := finance.settle_card_payment('evt_probe200_early', 'pi_probe200_early', 4500,
        pg_catalog.current_setting('probe.currency'), false);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_id;
    IF v_out ->> 'outcome' <> 'applied' OR v_p.transaction_id IS NULL OR pg_temp.probe_balance() <> v_before + 4500 THEN
        RAISE EXCEPTION 'FAIL early success: the redelivery after binding was not credited: %', v_out;
    END IF;
    RAISE NOTICE 'PASS the redelivery after binding is credited';
END $$;
ROLLBACK TO SAVEPOINT s_early;
-- #endregion

-- #region 5. A settlement that does not match its payment is flagged in the ops log, claim released
SAVEPOINT s_mismatch;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe200_fx', 5500);
    v_other text := CASE WHEN pg_catalog.current_setting('probe.currency') = 'JPY' THEN 'USD' ELSE 'JPY' END;
    v_out jsonb;
    v_p finance.inbound_payments;
BEGIN
    v_out := finance.settle_card_payment('evt_probe200_fx', 'pi_probe200_fx', 5500, v_other, false);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_id;
    IF v_out ->> 'outcome' <> 'unmatched' OR v_p.status::text <> 'processing' OR v_p.transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL mismatch: % status %', v_out, v_p.status;
    END IF;
    IF EXISTS (SELECT 1 FROM finance.idempotency_keys WHERE key = 'stripe:evt_probe200_fx') THEN
        RAISE EXCEPTION 'FAIL mismatch: the claim was kept — the event is acknowledged with no ledger row';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.log_entries l
                    WHERE l.scope = 'finance.settle_card_payment' AND l.level = 'error'
                      AND l.data ->> 'payment_id' = v_id::text) THEN
        RAISE EXCEPTION 'FAIL mismatch: nothing written to ops.log_entries';
    END IF;
    RAISE NOTICE 'PASS a mismatched settlement credits nothing, keeps no claim and logs an ops error';
END $$;
ROLLBACK TO SAVEPOINT s_mismatch;
-- #endregion

-- #region 6. A completed claim with no ledger row (an earlier build's acknowledged miss) is reprocessed
SAVEPOINT s_legacy;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe200_legacy', 6500);
    v_before bigint := pg_temp.probe_balance();
    v_out jsonb;
BEGIN
    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES ('stripe:evt_probe200_legacy', 'stripe.webhook', pg_catalog.md5('payment_intent.succeeded'), 'succeeded',
        '{"outcome": "unmatched"}'::jsonb, pg_catalog.now() + interval '30 days');
    v_out := finance.settle_card_payment('evt_probe200_legacy', 'pi_probe200_legacy', 6500,
        pg_catalog.current_setting('probe.currency'), false);
    IF v_out ->> 'outcome' <> 'applied' OR pg_temp.probe_balance() <> v_before + 6500
       OR (SELECT transaction_id FROM finance.inbound_payments WHERE id = v_id) IS NULL THEN
        RAISE EXCEPTION 'FAIL legacy claim: % (the dedupe swallowed a settlement that never landed)', v_out;
    END IF;
    RAISE NOTICE 'PASS a completed claim without a ledger row is released and the event settled';
END $$;
ROLLBACK TO SAVEPOINT s_legacy;
-- #endregion

-- #region 7. The table refuses a settled payment without a ledger row, and settled_unapplied without a reason
SAVEPOINT s_check_ledger;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe200_check', 7500);
BEGIN
    BEGIN
        UPDATE finance.inbound_payments
           SET status = 'succeeded', succeeded_at = pg_catalog.now(), amount_received_cents = 7500
         WHERE id = v_id;
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS a succeeded payment with a NULL transaction_id is refused (23514)';
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL a succeeded payment with a NULL transaction_id was stored';
END $$;
ROLLBACK TO SAVEPOINT s_check_ledger;

SAVEPOINT s_check_reason;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe200_reason', 8500);
BEGIN
    PERFORM finance.settle_card_payment('evt_probe200_reason', 'pi_probe200_reason', 8500,
        pg_catalog.current_setting('probe.currency'), false);
    BEGIN
        EXECUTE 'UPDATE finance.inbound_payments SET status = ''settled_unapplied'' WHERE id = $1' USING v_id;
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS settled_unapplied without an unapplied_reason is refused (23514)';
        RETURN;
    END;
    RAISE EXCEPTION 'FAIL settled_unapplied stored without a reason';
END $$;
ROLLBACK TO SAVEPOINT s_check_reason;
-- #endregion

-- #region 8. The ops view lists a settled payment whose ledger row is missing or does not match
SAVEPOINT s_view;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe200_view', 9500);
    v_ok uuid := pg_temp.probe_payment('pi_probe200_view_ok', 9600);
    v_foreign uuid;
    v_problem text;
BEGIN
    PERFORM finance.settle_card_payment('evt_probe200_view', 'pi_probe200_view', 9500,
        pg_catalog.current_setting('probe.currency'), false);
    PERFORM finance.settle_card_payment('evt_probe200_view_ok', 'pi_probe200_view_ok', 9600,
        pg_catalog.current_setting('probe.currency'), false);
    -- Point the first at another wallet's ledger row (only postgres can; no door does).
    SELECT t.id INTO v_foreign FROM finance.transactions t
     WHERE t.wallet_id <> pg_catalog.current_setting('probe.wallet')::uuid ORDER BY t.id LIMIT 1;
    UPDATE finance.inbound_payments SET transaction_id = v_foreign WHERE id = v_id;

    EXECUTE 'SELECT problem FROM finance.v_ops_unledgered_payments WHERE payment_id = $1' INTO v_problem USING v_id;
    IF v_problem IS DISTINCT FROM 'ledger_row_mismatch' THEN
        RAISE EXCEPTION 'FAIL ops view: a mislinked ledger row reads as %', v_problem;
    END IF;
    EXECUTE 'SELECT problem FROM finance.v_ops_unledgered_payments WHERE payment_id = $1' INTO v_problem USING v_ok;
    IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL ops view: a correctly ledgered payment is listed (%)', v_problem;
    END IF;
    RAISE NOTICE 'PASS the ops view lists the mislinked payment and not the ledgered one';
END $$;
ROLLBACK TO SAVEPOINT s_view;
-- #endregion

-- #region 9. Grants: the claim release is internal; the ops view is service-role only
SAVEPOINT s_grants;
DO $$
BEGIN
    IF pg_catalog.has_function_privilege('authenticated', 'finance.fn_release_stripe_event(text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', 'finance.fn_release_stripe_event(text)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'finance.fn_release_stripe_event(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL fn_release_stripe_event is callable from outside the processor doors';
    END IF;
    IF pg_catalog.has_table_privilege('authenticated', 'finance.v_ops_unledgered_payments', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'finance.v_ops_unledgered_payments', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role', 'finance.v_ops_unledgered_payments', 'SELECT') THEN
        RAISE EXCEPTION 'FAIL v_ops_unledgered_payments grants';
    END IF;
    RAISE NOTICE 'PASS release is internal; the ops view reads as service_role only';
END $$;
ROLLBACK TO SAVEPOINT s_grants;
-- #endregion

ROLLBACK;
