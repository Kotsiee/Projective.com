-- =============================================================================================
-- Probe: a charge Stripe captured is never left uncredited because its bind was lost
-- (FINANCE_COMPLETENESS_AUDIT N1). finance.settle_card_payment(p_payment_id) and
-- finance.claim_unsettled_card_payments.
--
-- A saved card is charged when its PaymentIntent is created (`confirm: true`), before
-- attach_card_payment binds the intent to the payment. If that bind is lost and the browser never
-- retries, no payment carries the intent's id. Now settle_card_payment takes the intent's
-- `metadata.projective_payment_id`: an UNBOUND payment with that id is bound to the intent and
-- settled (a canceled one too — money that arrived is credited); a payment already bound to a
-- DIFFERENT intent is never re-bound. The recovery sweep's worklist leases every card payment still
-- unsettled past its grace period, bound or not, except an unbound scheduled run (which
-- claim_due_deposit_rules re-sends itself).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/card_payment_metadata_bind.sql
--
-- Fixture: the first seeded `user` wallet and its owner; payments are inserted as postgres in the
-- shape begin_card_payment leaves them (unbound) or attach_card_payment leaves them (bound). Each
-- check sits between a SAVEPOINT and a ROLLBACK TO. A clean run prints only PASS notices.
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
END $$;

-- A card top-up into the fixture wallet: bound to `p_ref`, or unbound when it is NULL.
CREATE FUNCTION pg_temp.payment(p_key text, p_amount bigint, p_ref text DEFAULT NULL,
    p_status finance.inbound_payment_status DEFAULT 'requires_payment')
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE v_id uuid;
BEGIN
    INSERT INTO finance.inbound_payments (
        purpose, wallet_id, amount_cents, currency, status, lock_status, provider, provider_ref,
        idempotency_key, created_by
    ) VALUES (
        'wallet_topup', pg_catalog.current_setting('probe.wallet')::uuid, p_amount,
        pg_catalog.current_setting('probe.currency'), p_status, 'not_applicable', 'stripe', p_ref,
        'probe-n1-' || p_key, pg_catalog.current_setting('probe.payer')::uuid
    ) RETURNING id INTO v_id;
    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES ('probe-n1-' || p_key, 'probe', 'x', 'in_progress', pg_catalog.jsonb_build_object('payment_id', v_id),
            pg_catalog.now() + interval '7 days');
    RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.balance() RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = pg_catalog.current_setting('probe.wallet')::uuid;
$$;
-- #endregion

-- #region 1. An unbound payment is bound by its metadata and credited; the real event replays later
SAVEPOINT s_bind;
DO $$
DECLARE
    v_id uuid := pg_temp.payment('bind', 4200);
    v_before bigint := pg_temp.balance();
    v_out jsonb;
    v_p finance.inbound_payments;
BEGIN
    -- Without the metadata the intent matches nothing and the claim is released for Stripe's retry.
    v_out := finance.settle_card_payment('evt_probe_n1_bind', 'pi_probe_n1_bind', 4200,
        pg_catalog.current_setting('probe.currency'), false);
    IF v_out ->> 'outcome' <> 'unmatched' OR pg_temp.balance() <> v_before THEN
        RAISE EXCEPTION 'FAIL no metadata: %', v_out;
    END IF;
    -- The redelivery carries `projective_payment_id`: bound, settled, credited once.
    v_out := finance.settle_card_payment('evt_probe_n1_bind', 'pi_probe_n1_bind', 4200,
        pg_catalog.current_setting('probe.currency'), false, v_id);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_id;
    IF v_out ->> 'outcome' <> 'applied' OR v_p.provider_ref IS DISTINCT FROM 'pi_probe_n1_bind'
       OR v_p.status::text <> 'succeeded' OR v_p.transaction_id IS NULL
       OR pg_temp.balance() <> v_before + 4200 THEN
        RAISE EXCEPTION 'FAIL metadata bind: % (ref %, status %)', v_out, v_p.provider_ref, v_p.status;
    END IF;
    IF (SELECT status FROM finance.idempotency_keys WHERE key = 'probe-n1-bind') <> 'succeeded' THEN
        RAISE EXCEPTION 'FAIL metadata bind: the start key was not closed, so a retry would start over';
    END IF;
    RAISE NOTICE 'PASS an unbound payment is bound by projective_payment_id and credited once';

    -- The sweep (or a second event) for the same intent replays with the same ledger row.
    v_out := finance.settle_card_payment('evt_sweep_pi_probe_n1_bind', 'pi_probe_n1_bind', 4200,
        pg_catalog.current_setting('probe.currency'), false, v_id);
    IF v_out ->> 'outcome' <> 'replayed' OR (v_out ->> 'transaction_id')::uuid IS DISTINCT FROM v_p.transaction_id
       OR pg_temp.balance() <> v_before + 4200 THEN
        RAISE EXCEPTION 'FAIL second settlement: %', v_out;
    END IF;
    RAISE NOTICE 'PASS a second settlement of the same intent replays and credits nothing';
END $$;
ROLLBACK TO SAVEPOINT s_bind;
-- #endregion

-- #region 2. A payment bound to a different intent is never re-bound
SAVEPOINT s_other;
DO $$
DECLARE
    v_id uuid := pg_temp.payment('other', 1800, 'pi_probe_n1_first', 'processing');
    v_before bigint := pg_temp.balance();
    v_out jsonb;
BEGIN
    v_out := finance.settle_card_payment('evt_probe_n1_other', 'pi_probe_n1_second', 1800,
        pg_catalog.current_setting('probe.currency'), false, v_id);
    IF v_out ->> 'outcome' <> 'unmatched' OR pg_temp.balance() <> v_before
       OR (SELECT provider_ref FROM finance.inbound_payments WHERE id = v_id) <> 'pi_probe_n1_first' THEN
        RAISE EXCEPTION 'FAIL re-bind: % (ref now %)', v_out, (SELECT provider_ref FROM finance.inbound_payments WHERE id = v_id);
    END IF;
    RAISE NOTICE 'PASS metadata never moves a payment off the intent it is bound to';
END $$;
ROLLBACK TO SAVEPOINT s_other;
-- #endregion

-- #region 3. A canceled, unbound payment that Stripe charged anyway is credited
SAVEPOINT s_canceled;
DO $$
DECLARE
    v_id uuid := pg_temp.payment('canceled', 2600, NULL, 'canceled');
    v_before bigint := pg_temp.balance();
    v_out jsonb;
BEGIN
    v_out := finance.settle_card_payment('evt_probe_n1_canceled', 'pi_probe_n1_canceled', 2600,
        pg_catalog.current_setting('probe.currency'), false, v_id);
    IF v_out ->> 'outcome' <> 'applied' OR pg_temp.balance() <> v_before + 2600 THEN
        RAISE EXCEPTION 'FAIL canceled payment: %', v_out;
    END IF;
    RAISE NOTICE 'PASS money that arrived for a canceled payment is credited, not dropped';
END $$;
ROLLBACK TO SAVEPOINT s_canceled;
-- #endregion

-- #region 4. The sweep's worklist: aged, unsettled, leased once per window
SAVEPOINT s_sweep;
DO $$
DECLARE
    v_unbound uuid := pg_temp.payment('sweep-unbound', 1000);
    v_bound uuid := pg_temp.payment('sweep-bound', 1100, 'pi_probe_n1_sweep', 'processing');
    v_young uuid := pg_temp.payment('sweep-young', 1200);
    v_rule_run uuid := pg_temp.payment('sweep-rule', 1300);
    v_rule uuid;
    v_out jsonb;
    v_ids uuid[];
BEGIN
    INSERT INTO finance.deposit_rules (wallet_id, amount_cents, currency, interval, next_run_at, created_by)
    VALUES (pg_catalog.current_setting('probe.wallet')::uuid, 1300, pg_catalog.current_setting('probe.currency'),
            'monthly', 'infinity', pg_catalog.current_setting('probe.payer')::uuid)
    RETURNING id INTO v_rule;
    UPDATE finance.inbound_payments SET deposit_rule_id = v_rule WHERE id = v_rule_run;
    UPDATE finance.inbound_payments SET updated_at = pg_catalog.now() - interval '1 hour'
     WHERE id IN (v_unbound, v_bound, v_rule_run);

    v_out := finance.claim_unsettled_card_payments(interval '15 minutes', 200);
    SELECT COALESCE(pg_catalog.array_agg((e ->> 'payment_id')::uuid), '{}') INTO v_ids
      FROM pg_catalog.jsonb_array_elements(v_out) e;
    IF NOT (v_unbound = ANY (v_ids)) OR NOT (v_bound = ANY (v_ids)) THEN
        RAISE EXCEPTION 'FAIL sweep: an aged unsettled payment was not leased (%)', v_out;
    END IF;
    IF v_young = ANY (v_ids) OR v_rule_run = ANY (v_ids) THEN
        RAISE EXCEPTION 'FAIL sweep: leased a payment inside its grace period, or an unbound scheduled run';
    END IF;
    IF (SELECT e ->> 'provider_ref' FROM pg_catalog.jsonb_array_elements(v_out) e
         WHERE (e ->> 'payment_id')::uuid = v_unbound) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL sweep: the unbound payment reported a provider_ref';
    END IF;
    RAISE NOTICE 'PASS the sweep leases aged unsettled payments, bound or not, and skips the young and unbound scheduled runs';

    v_out := finance.claim_unsettled_card_payments(interval '15 minutes', 200);
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_out) e
                WHERE (e ->> 'payment_id')::uuid IN (v_unbound, v_bound)) THEN
        RAISE EXCEPTION 'FAIL sweep: a payment was leased twice in one window';
    END IF;
    RAISE NOTICE 'PASS a leased payment is not offered again until a grace period has passed';
END $$;
ROLLBACK TO SAVEPOINT s_sweep;
-- #endregion

-- #region 5. No client role reaches either door
DO $$ BEGIN
    IF pg_catalog.has_function_privilege('authenticated',
           'finance.settle_card_payment(text, text, bigint, text, boolean, uuid)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',
           'finance.claim_unsettled_card_payments(interval, integer)', 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',
           'finance.claim_unsettled_card_payments(interval, integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL grants: a client role can execute a processor door';
    END IF;
    RAISE NOTICE 'PASS both doors are service_role only';
END $$;
-- #endregion

ROLLBACK;
