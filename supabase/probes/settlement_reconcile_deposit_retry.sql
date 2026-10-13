-- =============================================================================================
-- Probe: a deterministic settlement mismatch is acknowledged into reconciliation, and a scheduled
-- deposit whose charge never reached a PaymentIntent is retried, not lost.
-- finance.settle_card_payment (the `settlement_mismatch` outcome), finance.v_ops_unledgered_payments,
-- finance.claim_due_deposit_rules (unbound-run re-offer, expiry, cancel) and
-- finance.fn_deposit_charge_target.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/settlement_reconcile_deposit_retry.sql
--
-- A clean run prints only PASS notices; a broken contract raises `FAIL …`. Each check sits between a
-- SAVEPOINT and a ROLLBACK TO, so running WITHOUT ON_ERROR_STOP reports every failing check. The
-- payer is a seeded `user` wallet's owner (deno task db:reset). `now()` is frozen for the whole
-- transaction, so the passage of time is simulated by moving a run's `created_at` / `updated_at` back.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_wallet finance.wallets;
    v_method uuid;
    v_rule uuid;
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

    -- A saved card on a Stripe Customer, and a weekly rule that fell due a minute ago.
    INSERT INTO finance.payment_methods (owner_type, owner_id, method_role, external_ref, brand, last4)
    VALUES ('user', v_wallet.owner_id, 'funding', 'pm_probe_retry', 'visa', '4242')
    RETURNING id INTO v_method;
    INSERT INTO finance.processor_customers (owner_type, owner_id, customer_ref)
    VALUES ('user', v_wallet.owner_id, 'cus_probe_retry')
    ON CONFLICT (provider, owner_type, owner_id) DO NOTHING;
    INSERT INTO finance.deposit_rules (wallet_id, source_method_id, amount_cents, currency, interval, next_run_at, created_by)
    VALUES (v_wallet.id, v_method, 2000, v_wallet.currency, 'weekly', pg_catalog.now() - interval '1 minute', v_wallet.owner_id)
    RETURNING id INTO v_rule;
    -- The derived-column guard leaves created_by to the door; stamp it as the door would.
    UPDATE finance.deposit_rules SET created_by = v_wallet.owner_id WHERE id = v_rule AND created_by IS NULL;
    PERFORM pg_catalog.set_config('probe.method', v_method::text, true);
    PERFORM pg_catalog.set_config('probe.rule', v_rule::text, true);
    RAISE NOTICE 'fixture wallet=% payer=% currency=% rule=%', v_wallet.id, v_wallet.owner_id, v_wallet.currency, v_rule;
END $$;

-- A bound, processing card payment into the fixture wallet.
CREATE FUNCTION pg_temp.probe_payment(p_ref text, p_amount bigint)
RETURNS uuid
LANGUAGE sql
AS $$
    INSERT INTO finance.inbound_payments (
        purpose, wallet_id, amount_cents, currency, status, lock_status, provider, provider_ref,
        idempotency_key, created_by
    ) VALUES (
        'wallet_topup',
        pg_catalog.current_setting('probe.wallet')::uuid,
        p_amount,
        pg_catalog.current_setting('probe.currency'),
        'processing',
        'not_applicable',
        'stripe',
        p_ref,
        'probe-recon-' || p_ref,
        pg_catalog.current_setting('probe.payer')::uuid
    )
    RETURNING id;
$$;

-- An unbound scheduled run of a rule, claimed `p_age` ago and untouched for `p_idle`.
CREATE FUNCTION pg_temp.probe_run(p_rule uuid, p_key text, p_age interval, p_idle interval)
RETURNS uuid
LANGUAGE sql
AS $$
    INSERT INTO finance.inbound_payments (
        purpose, wallet_id, amount_cents, currency, lock_status, idempotency_key, created_by,
        deposit_rule_id, created_at, updated_at
    ) VALUES (
        'wallet_topup',
        pg_catalog.current_setting('probe.wallet')::uuid,
        2000,
        pg_catalog.current_setting('probe.currency'),
        'not_applicable',
        p_key,
        pg_catalog.current_setting('probe.payer')::uuid,
        p_rule,
        pg_catalog.now() - p_age,
        pg_catalog.now() - p_idle
    )
    RETURNING id;
$$;

CREATE FUNCTION pg_temp.probe_balance()
RETURNS bigint
LANGUAGE sql
AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = pg_catalog.current_setting('probe.wallet')::uuid;
$$;

-- The claim entries for one payment.
CREATE FUNCTION pg_temp.probe_entry(p_claim jsonb, p_payment uuid)
RETURNS jsonb
LANGUAGE sql
AS $$
    SELECT e FROM pg_catalog.jsonb_array_elements(p_claim) e WHERE e -> 'payment' ->> 'id' = p_payment::text;
$$;
-- #endregion

-- #region 1. A mismatched settlement is acknowledged once, into reconciliation
SAVEPOINT s_mismatch;
DO $$
DECLARE
    v_id uuid := pg_temp.probe_payment('pi_probe_recon_fx', 5500);
    v_other text := CASE WHEN pg_catalog.current_setting('probe.currency') = 'JPY' THEN 'USD' ELSE 'JPY' END;
    v_before bigint := pg_temp.probe_balance();
    v_out jsonb;
    v_again jsonb;
    v_p finance.inbound_payments;
    v_claim finance.idempotency_keys;
    v_rows integer;
    v_view record;
BEGIN
    v_out := finance.settle_card_payment('evt_probe_recon_fx', 'pi_probe_recon_fx', 5500, v_other, false);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_id;
    SELECT * INTO v_claim FROM finance.idempotency_keys WHERE key = 'stripe:evt_probe_recon_fx';
    IF v_out ->> 'outcome' <> 'unmatched' OR v_out ->> 'reconciliation' IS DISTINCT FROM 'settlement_mismatch'
       OR v_out ->> 'transaction_id' IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL mismatch: outcome %', v_out;
    END IF;
    IF v_claim.key IS NULL OR v_claim.status::text <> 'succeeded' THEN
        RAISE EXCEPTION 'FAIL mismatch: the claim was not kept (status %) — redeliveries would re-error', v_claim.status;
    END IF;
    IF v_p.status::text <> 'processing' OR v_p.transaction_id IS NOT NULL OR pg_temp.probe_balance() <> v_before THEN
        RAISE EXCEPTION 'FAIL mismatch: the payment moved (status %, tx %, balance %)', v_p.status, v_p.transaction_id, pg_temp.probe_balance();
    END IF;
    SELECT pg_catalog.count(*) INTO v_rows FROM ops.log_entries l
     WHERE l.scope = 'finance.settle_card_payment' AND l.level = 'error' AND l.data ->> 'payment_id' = v_id::text;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'FAIL mismatch: % ops rows (want 1)', v_rows;
    END IF;
    RAISE NOTICE 'PASS a mismatch credits nothing, keeps its claim and writes one ops error row';

    v_again := finance.settle_card_payment('evt_probe_recon_fx', 'pi_probe_recon_fx', 5500, v_other, false);
    SELECT pg_catalog.count(*) INTO v_rows FROM ops.log_entries l
     WHERE l.scope = 'finance.settle_card_payment' AND l.data ->> 'payment_id' = v_id::text;
    IF v_again ->> 'outcome' <> 'replayed' OR v_again ->> 'reconciliation' IS DISTINCT FROM 'settlement_mismatch'
       OR v_rows <> 1 OR pg_temp.probe_balance() <> v_before THEN
        RAISE EXCEPTION 'FAIL mismatch redelivery: % (ops rows %)', v_again, v_rows;
    END IF;
    RAISE NOTICE 'PASS a redelivered mismatch replays the reconciliation outcome and writes nothing';

    EXECUTE 'SELECT problem, stripe_event_id, reported_amount_cents, reported_currency
               FROM finance.v_ops_unledgered_payments WHERE payment_id = $1' INTO v_view USING v_id;
    IF v_view.problem IS DISTINCT FROM 'settlement_mismatch' OR v_view.stripe_event_id IS DISTINCT FROM 'evt_probe_recon_fx'
       OR v_view.reported_amount_cents IS DISTINCT FROM 5500 OR v_view.reported_currency IS DISTINCT FROM v_other THEN
        RAISE EXCEPTION 'FAIL ops view: the mismatch reads as %', v_view;
    END IF;
    -- A human closes it: it leaves the view.
    UPDATE finance.inbound_payments SET status = 'canceled', failure_reason = 'reconciled by hand' WHERE id = v_id;
    EXECUTE 'SELECT pg_catalog.count(*) FROM finance.v_ops_unledgered_payments WHERE payment_id = $1' INTO v_rows USING v_id;
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'FAIL ops view: a closed mismatch is still listed';
    END IF;
    RAISE NOTICE 'PASS the ops view lists the mismatch with what Stripe reported, until it is closed';
END $$;
ROLLBACK TO SAVEPOINT s_mismatch;
-- #endregion

-- #region 2. A success that only beat its bind is still transient: claim released, retried
SAVEPOINT s_early;
DO $$
DECLARE
    v_out jsonb;
BEGIN
    v_out := finance.settle_card_payment('evt_probe_recon_early', 'pi_probe_recon_early', 4500,
        pg_catalog.current_setting('probe.currency'), false);
    IF v_out ->> 'outcome' <> 'unmatched' OR v_out ? 'reconciliation'
       OR EXISTS (SELECT 1 FROM finance.idempotency_keys WHERE key = 'stripe:evt_probe_recon_early') THEN
        RAISE EXCEPTION 'FAIL early success: % (an unbound success must release its claim)', v_out;
    END IF;
    RAISE NOTICE 'PASS an unbound success still releases its claim (Stripe retries it)';
END $$;
ROLLBACK TO SAVEPOINT s_early;
-- #endregion

-- #region 3. A claimed run that never reached a PaymentIntent is re-offered under the same payment
SAVEPOINT s_retry;
DO $$
DECLARE
    v_rule uuid := pg_catalog.current_setting('probe.rule')::uuid;
    v_claim jsonb;
    v_entry jsonb;
    v_payment uuid;
    v_key text;
    v_next timestamptz;
    v_runs integer;
BEGIN
    v_claim := finance.claim_due_deposit_rules(200);
    SELECT e INTO v_entry FROM pg_catalog.jsonb_array_elements(v_claim) e WHERE e ->> 'rule_id' = v_rule::text;
    IF v_entry IS NULL OR (v_entry ->> 'retry')::boolean IS DISTINCT FROM false
       OR v_entry ->> 'customer_ref' IS NULL OR v_entry ->> 'payment_method_ref' <> 'pm_probe_retry' THEN
        RAISE EXCEPTION 'FAIL first claim: %', v_entry;
    END IF;
    v_payment := (v_entry -> 'payment' ->> 'id')::uuid;
    v_key := v_entry -> 'payment' ->> 'idempotency_key';
    SELECT next_run_at INTO v_next FROM finance.deposit_rules WHERE id = v_rule;
    IF v_next <= pg_catalog.now() THEN
        RAISE EXCEPTION 'FAIL first claim: the rule was not advanced past now (%)', v_next;
    END IF;
    RAISE NOTICE 'PASS a due rule is claimed once as a new run (retry = false)';

    -- The charge failed transiently: nothing was bound. Inside the lease it is not re-offered.
    IF pg_temp.probe_entry(finance.claim_due_deposit_rules(200), v_payment) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL lease: a run claimed this instant was re-offered';
    END IF;
    RAISE NOTICE 'PASS a run inside its 15-minute lease is not re-offered';

    -- An hour later, the next sweep.
    UPDATE finance.inbound_payments
       SET created_at = pg_catalog.now() - interval '1 hour', updated_at = pg_catalog.now() - interval '1 hour'
     WHERE id = v_payment;
    v_entry := pg_temp.probe_entry(finance.claim_due_deposit_rules(200), v_payment);
    SELECT pg_catalog.count(*) INTO v_runs FROM finance.inbound_payments WHERE deposit_rule_id = v_rule;
    IF v_entry IS NULL OR (v_entry ->> 'retry')::boolean IS DISTINCT FROM true
       OR v_entry -> 'payment' ->> 'idempotency_key' IS DISTINCT FROM v_key
       OR v_entry ->> 'payment_method_ref' <> 'pm_probe_retry' OR v_entry ->> 'customer_ref' IS NULL THEN
        RAISE EXCEPTION 'FAIL retry: the unbound run was not re-offered as itself: %', v_entry;
    END IF;
    IF v_runs <> 1 OR (SELECT next_run_at FROM finance.deposit_rules WHERE id = v_rule) <> v_next THEN
        RAISE EXCEPTION 'FAIL retry: % runs for the rule, next_run_at moved — the period would be charged twice or skipped', v_runs;
    END IF;
    IF (SELECT updated_at FROM finance.inbound_payments WHERE id = v_payment) <> pg_catalog.now() THEN
        RAISE EXCEPTION 'FAIL retry: re-offering did not take the lease';
    END IF;
    RAISE NOTICE 'PASS the next sweep re-offers the SAME payment (retry = true), no second run, rule untouched';

    -- The retry reached Stripe and was bound: it is never offered again.
    PERFORM finance.bind_scheduled_payment(v_payment, 'pi_probe_retry_1', NULL);
    UPDATE finance.inbound_payments SET updated_at = pg_catalog.now() - interval '1 hour' WHERE id = v_payment;
    IF pg_temp.probe_entry(finance.claim_due_deposit_rules(200), v_payment) IS NOT NULL
       OR (SELECT status::text FROM finance.inbound_payments WHERE id = v_payment) <> 'processing' THEN
        RAISE EXCEPTION 'FAIL retry: a bound run was offered again';
    END IF;
    RAISE NOTICE 'PASS a bound run is never re-offered';
END $$;
ROLLBACK TO SAVEPOINT s_retry;
-- #endregion

-- #region 4. Past the idempotency window an unbound run is failed and flagged, never re-sent
SAVEPOINT s_expired;
DO $$
DECLARE
    v_rule uuid := pg_catalog.current_setting('probe.rule')::uuid;
    v_payment uuid := pg_temp.probe_run(pg_catalog.current_setting('probe.rule')::uuid, 'probe-recon-expired',
        interval '24 hours', interval '1 hour');
    v_p finance.inbound_payments;
    v_failures integer;
BEGIN
    SELECT failure_count INTO v_failures FROM finance.deposit_rules WHERE id = v_rule;
    IF pg_temp.probe_entry(finance.claim_due_deposit_rules(200), v_payment) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL expiry: a run past the 24-hour key life was re-offered (could charge twice)';
    END IF;
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_payment;
    IF v_p.status::text <> 'failed' OR v_p.failure_reason IS NULL THEN
        RAISE EXCEPTION 'FAIL expiry: status % reason %', v_p.status, v_p.failure_reason;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.log_entries l
                    WHERE l.scope = 'finance.claim_due_deposit_rules' AND l.level = 'error'
                      AND l.client_id = 'deposit:' || v_payment::text) THEN
        RAISE EXCEPTION 'FAIL expiry: no ops error row';
    END IF;
    IF (SELECT failure_count FROM finance.deposit_rules WHERE id = v_rule) <> v_failures THEN
        RAISE EXCEPTION 'FAIL expiry: a processor outage counted against the card';
    END IF;
    RAISE NOTICE 'PASS an unbound run past 23 hours is failed with an ops error row, not re-sent, no strike';
END $$;
ROLLBACK TO SAVEPOINT s_expired;
-- #endregion

-- #region 5. An unbound run whose rule was stopped is canceled, not charged
SAVEPOINT s_stopped;
DO $$
DECLARE
    v_rule uuid := pg_catalog.current_setting('probe.rule')::uuid;
    v_payment uuid := pg_temp.probe_run(pg_catalog.current_setting('probe.rule')::uuid, 'probe-recon-stopped',
        interval '2 hours', interval '1 hour');
    v_p finance.inbound_payments;
BEGIN
    UPDATE finance.deposit_rules SET active = false WHERE id = v_rule;
    IF pg_temp.probe_entry(finance.claim_due_deposit_rules(200), v_payment) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL stopped: a stopped rule''s run was re-offered';
    END IF;
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_payment;
    IF v_p.status::text <> 'canceled' OR v_p.failure_reason IS NULL
       OR NOT EXISTS (SELECT 1 FROM ops.log_entries l
                       WHERE l.scope = 'finance.claim_due_deposit_rules' AND l.level = 'warn'
                         AND l.client_id = 'deposit:' || v_payment::text) THEN
        RAISE EXCEPTION 'FAIL stopped: status % reason %', v_p.status, v_p.failure_reason;
    END IF;
    RAISE NOTICE 'PASS an unbound run of a stopped rule is canceled with an ops warn row';
END $$;
ROLLBACK TO SAVEPOINT s_stopped;
-- #endregion

-- #region 6. A deterministic refusal is unchanged: failed, counted, never re-offered
SAVEPOINT s_refused;
DO $$
DECLARE
    v_rule uuid := pg_catalog.current_setting('probe.rule')::uuid;
    v_payment uuid := pg_temp.probe_run(pg_catalog.current_setting('probe.rule')::uuid, 'probe-recon-refused',
        interval '2 hours', interval '1 hour');
    v_p finance.inbound_payments;
BEGIN
    PERFORM finance.bind_scheduled_payment(v_payment, 'pi_probe_refused', 'card_declined');
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_payment;
    IF v_p.status::text <> 'failed' OR (SELECT failure_count FROM finance.deposit_rules WHERE id = v_rule) <> 1 THEN
        RAISE EXCEPTION 'FAIL refused: status % failures %', v_p.status,
            (SELECT failure_count FROM finance.deposit_rules WHERE id = v_rule);
    END IF;
    IF pg_temp.probe_entry(finance.claim_due_deposit_rules(200), v_payment) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL refused: a declined run was re-offered';
    END IF;
    RAISE NOTICE 'PASS a declined run is failed, counts a strike and is never retried';
END $$;
ROLLBACK TO SAVEPOINT s_refused;
-- #endregion

-- #region 7. Grants: the charge-target helper is internal
SAVEPOINT s_grants;
DO $$
BEGIN
    IF pg_catalog.has_function_privilege('authenticated', 'finance.fn_deposit_charge_target(finance.deposit_rules)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', 'finance.fn_deposit_charge_target(finance.deposit_rules)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', 'finance.fn_deposit_charge_target(finance.deposit_rules)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL fn_deposit_charge_target is callable from outside claim_due_deposit_rules';
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', 'finance.claim_due_deposit_rules(integer)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', 'finance.claim_due_deposit_rules(integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL claim_due_deposit_rules grants';
    END IF;
    RAISE NOTICE 'PASS the charge-target helper is internal; the claim is service-role only';
END $$;
ROLLBACK TO SAVEPOINT s_grants;
-- #endregion

ROLLBACK;
