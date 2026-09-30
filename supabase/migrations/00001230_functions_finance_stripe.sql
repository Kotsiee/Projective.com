-- =============================================================================================
-- 00001230_functions_finance_stripe.sql — the Stripe fiat rails, Phase 1 (Category 1: functions).
-- Root CLAUDE.md §8 Decision #125 · SYSTEM_ARCHITECTURE.md §Integration Blueprints → Stripe.
--
-- Projective's `finance.*` tables are the ledger of record; Stripe owns the fiat rails. Every function
-- here is the DATABASE half of one Stripe flow, and every one of them is SECURITY DEFINER with
-- `search_path = ''`, because each writes tables no client role may write.
--
-- Two doors, never mixed:
--
--   * USER doors (EXECUTE → authenticated) authorise the caller with `auth.uid()` and record what
--     they asked for BEFORE anything is sent to Stripe — begin_card_payment / attach_card_payment /
--     abandon_card_payment, payout_account_for / record_payout_account, begin_identity_verification /
--     attach_identity_session / abandon_identity_verification. None of them can mark money received,
--     an account verified or an identity checked: a caller's word is not evidence of any of those.
--
--   * PROCESSOR doors (EXECUTE → service_role only) apply what Stripe REPORTS, reached only from the
--     signature-verified webhook or from a status read the fat service made itself —
--     settle_card_payment, record_card_payment_failure, apply_identity_event, sync_payout_account,
--     record_transfer_created, record_dispute_opened.
--
-- Every processor door is IDEMPOTENT ON THE STRIPE EVENT ID. It claims `stripe:<evt_id>` in
-- finance.idempotency_keys in the SAME transaction as its effects, so a redelivered event (Stripe
-- retries for days) replays the stored outcome instead of moving money twice, and a delivery that
-- failed half-way rolls its claim back with everything else and is simply processed again.
--
-- The charge is NOT a destination charge. The card is charged on the PLATFORM account and the settled
-- amount is credited to a Projective wallet (reason `topup`); an escrow lock then holds the stage's
-- escrow from that wallet through projects.fund_stage — the only implementation of a stage lock. A
-- destination charge would transfer the money to a connected account the moment it is paid, which an
-- escrow held until approval, refundable, and split across a team cannot be (Decision #125).
-- =============================================================================================

-- #region 1. Stripe event claims (webhook idempotency)
-- Claim a Stripe event for processing. TRUE the first time an event id is seen; FALSE when it has
-- already been processed — or is being processed right now by a concurrent delivery, which blocks on
-- the primary key until that transaction ends and then sees its row. Internal: called only from the
-- processor doors below, inside their transaction.
CREATE OR REPLACE FUNCTION finance.fn_claim_stripe_event(p_event_id text, p_event_type text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]{1,250}$' THEN
        RAISE EXCEPTION 'event: expected a Stripe event id' USING ERRCODE = '22023';
    END IF;
    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES (
        'stripe:' || p_event_id,
        'stripe.webhook',
        pg_catalog.md5(COALESCE(p_event_type, '')),
        'in_progress',
        NULL,
        -- Stripe retries a failing delivery for up to three days; thirty keeps every retry deduplicated
        -- with room to spare, and keeps an unmatched event visible to reconciliation for a month.
        pg_catalog.now() + interval '30 days'
    )
    ON CONFLICT (key) DO NOTHING;
    RETURN FOUND;
END;
$$;

-- Record what processing an event did, on its claim. Returns the outcome so a caller can RETURN it.
CREATE OR REPLACE FUNCTION finance.fn_complete_stripe_event(p_event_id text, p_outcome jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE finance.idempotency_keys
       SET status = 'succeeded', response = p_outcome
     WHERE key = 'stripe:' || p_event_id;
    RETURN p_outcome;
END;
$$;

-- The answer for a redelivered event: `replayed`, carrying what the first delivery did.
CREATE OR REPLACE FUNCTION finance.fn_stripe_event_replay(p_event_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'outcome', 'replayed',
        'detail', 'event already processed',
        'first', COALESCE(
            (SELECT k.response FROM finance.idempotency_keys k WHERE k.key = 'stripe:' || p_event_id),
            'null'::jsonb
        )
    );
$$;
-- #endregion

-- #region 2. Card payments — the user doors
-- Start a card payment. Authorises the caller, computes the amount where the database owns it, and
-- records the attempt BEFORE the processor is called, so a PaymentIntent can never exist without a
-- Projective row that says what it is for and who asked.
--
--   wallet_topup — money into a wallet: the payer's own (self-only), or a shared vault the caller
--                  holds `add_funds` on. The amount is the caller's; the currency must be the wallet's.
--   escrow_lock  — fund a stage's escrow by card (the One-Off "upfront" lock, the Pipeline "Buy Now"):
--                  the SAME gates projects.fund_stage applies, evaluated now so nobody is charged for
--                  a lock they could not have made — and again at settlement. The AMOUNT is the sum
--                  finance.fn_hold_ticket_escrow will hold, read from the same columns;
--                  `p_expected_amount` is only what the payer was shown, and a mismatch refuses
--                  rather than charging an amount nobody saw.
--
-- Idempotent on the caller's attempt key (finance.idempotency_keys, scope `card_payment:<uid>`): the
-- same key and request replays the recorded attempt; the same key with a different request refuses.
CREATE OR REPLACE FUNCTION finance.begin_card_payment(
    p_purpose text,
    p_wallet_id uuid,
    p_project_id uuid,
    p_stage_id uuid,
    p_expected_amount bigint,
    p_currency text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
    v_scope text;
    v_hash text;
    v_prior finance.idempotency_keys;
    v_existing finance.inbound_payments;
    v_wallet finance.wallets;
    v_wallet_id uuid;
    v_payer uuid;
    v_owner uuid;
    v_stage_status public.stage_status;
    v_project_currency text;
    v_amount bigint;
    v_payment finance.inbound_payments;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to pay' USING ERRCODE = '42501';
    END IF;
    IF p_purpose IS NULL OR p_purpose NOT IN ('wallet_topup', 'escrow_lock') THEN
        RAISE EXCEPTION 'purpose: expected wallet_topup or escrow_lock' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR pg_catalog.length(p_idempotency_key) < 8
       OR pg_catalog.length(p_idempotency_key) > 120 THEN
        RAISE EXCEPTION 'idempotencyKey: a payment needs an attempt key between 8 and 120 characters'
            USING ERRCODE = '22023';
    END IF;
    IF v_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'currency: expected a three-letter currency code' USING ERRCODE = '22023';
    END IF;

    v_scope := 'card_payment:' || v_uid::text;
    v_hash := pg_catalog.md5(pg_catalog.concat_ws('|',
        p_purpose, p_wallet_id, p_project_id, p_stage_id, p_expected_amount, v_currency));

    SELECT * INTO v_prior FROM finance.idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
        IF v_prior.scope <> v_scope OR v_prior.request_hash <> v_hash THEN
            RAISE EXCEPTION 'idempotencyKey: that attempt key was used for a different request'
                USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_existing FROM finance.inbound_payments WHERE idempotency_key = p_idempotency_key;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'idempotencyKey: that attempt key is already in use' USING ERRCODE = 'PX409';
        END IF;
        RETURN pg_catalog.to_jsonb(v_existing) || pg_catalog.jsonb_build_object('replayed', true);
    END IF;

    IF p_purpose = 'wallet_topup' THEN
        IF p_wallet_id IS NULL THEN
            RAISE EXCEPTION 'walletId: choose the wallet to top up' USING ERRCODE = '22023';
        END IF;
        IF p_project_id IS NOT NULL OR p_stage_id IS NOT NULL THEN
            RAISE EXCEPTION 'stageId: a top-up does not fund a stage' USING ERRCODE = '22023';
        END IF;
        IF p_expected_amount IS NULL OR p_expected_amount <= 0 THEN
            RAISE EXCEPTION 'amountMinor: enter an amount to add' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_wallet FROM finance.wallets WHERE id = p_wallet_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'walletId: that wallet does not exist' USING ERRCODE = 'P0002';
        END IF;
        -- Adding funds is its own capability, distinct from spending: a personal wallet is self-only,
        -- a shared vault needs `add_funds` on THIS wallet (finance-model.md §14).
        IF NOT (
            (v_wallet.owner_type IN ('user', 'freelancer') AND v_wallet.owner_id = v_uid)
            OR (
                v_wallet.owner_type IN ('team', 'business', 'organisation')
                AND finance.fn_has_vault_capability(v_wallet.id, v_uid, 'add_funds'::finance.vault_capability)
            )
        ) THEN
            RAISE EXCEPTION 'auth: you can''t add funds to this wallet' USING ERRCODE = '42501';
        END IF;
        IF pg_catalog.upper(v_wallet.currency) <> v_currency THEN
            RAISE EXCEPTION 'currency: this wallet holds %', pg_catalog.upper(v_wallet.currency)
                USING ERRCODE = '22023';
        END IF;
        v_wallet_id := v_wallet.id;
        v_amount := p_expected_amount;
    ELSE
        IF p_project_id IS NULL OR p_stage_id IS NULL THEN
            RAISE EXCEPTION 'stageId: choose the stage to fund' USING ERRCODE = '22023';
        END IF;
        IF p_wallet_id IS NOT NULL THEN
            RAISE EXCEPTION 'walletId: an escrow lock is paid into the client''s wallet, not a chosen one'
                USING ERRCODE = '22023';
        END IF;
        IF NOT projects.has_project_access(p_project_id) THEN
            RAISE EXCEPTION 'auth: not authorized for this project' USING ERRCODE = '42501';
        END IF;
        -- A business client pays from its wallet; a project with no client business is paid for by its
        -- OWNER as an individual client (PRODUCT_SPEC §Escrow, Wallets & Finance #5 — "zero friction,
        -- no ID verification"), and only that owner may fund it. Mirrors projects.fund_stage.
        SELECT p.client_business_id, p.owner_user_id, p.currency INTO v_payer, v_owner, v_project_currency
          FROM projects.projects p WHERE p.id = p_project_id;
        IF v_payer IS NOT NULL THEN
            IF NOT finance.fn_owner_capability('business', v_payer, 'spend'::finance.vault_capability) THEN
                RAISE EXCEPTION 'auth: only a member who can spend from the client''s wallet can fund this stage'
                    USING ERRCODE = '42501';
            END IF;
        ELSIF v_owner IS NULL OR v_owner IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'auth: only the project''s owner can fund this stage' USING ERRCODE = '42501';
        END IF;
        SELECT ps.status INTO v_stage_status
          FROM projects.project_stages ps
         WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'stageId: stage not found for this project' USING ERRCODE = 'P0002';
        END IF;
        IF v_stage_status <> 'assigned'::public.stage_status THEN
            RAISE EXCEPTION 'stageId: the stage must be assigned before its escrow can be funded (it is %)',
                v_stage_status USING ERRCODE = 'PC409';
        END IF;
        IF pg_catalog.upper(COALESCE(v_project_currency, 'USD')) <> v_currency THEN
            RAISE EXCEPTION 'currency: this project is priced in %', pg_catalog.upper(COALESCE(v_project_currency, 'USD'))
                USING ERRCODE = '22023';
        END IF;
        -- Exactly what fn_hold_ticket_escrow will hold, ticket by ticket: every assigned, unfunded ticket
        -- of the stage at its own price, else the stage's.
        SELECT COALESCE(SUM(COALESCE(t.unit_price_cents, ps.unit_price_cents)), 0) INTO v_amount
          FROM projects.tickets t
          LEFT JOIN projects.project_stages ps ON ps.id = t.current_stage_id
         WHERE t.current_stage_id = p_stage_id
           AND t.current_assignee_id IS NOT NULL
           AND t.payment_status = 'unpaid'::public.payment_status
           AND COALESCE(t.unit_price_cents, ps.unit_price_cents) > 0;
        IF v_amount <= 0 THEN
            RAISE EXCEPTION 'stageId: no assigned, unfunded tickets are waiting for escrow in this stage'
                USING ERRCODE = 'PC409';
        END IF;
        IF p_expected_amount IS DISTINCT FROM v_amount THEN
            RAISE EXCEPTION 'expectedAmountMinor: the amount to fund changed — it is now % minor units of %',
                v_amount, v_currency USING ERRCODE = 'PC409';
        END IF;
        -- The wallet the hold will debit: the paying business's — or the individual owner's own person
        -- wallet (finance.fn_escrow_payer_wallet_type, the type fn_hold_ticket_escrow debits) — in the
        -- project's currency. Created here if it does not exist yet, because fn_wallet_credit is a
        -- silent no-op on a missing wallet.
        v_wallet_id := finance.fn_ensure_wallet(
            finance.fn_escrow_payer_wallet_type(v_payer, CASE WHEN v_payer IS NULL THEN v_owner END),
            COALESCE(v_payer, v_owner),
            COALESCE(v_project_currency, 'USD')
        );
    END IF;

    INSERT INTO finance.inbound_payments (
        purpose, wallet_id, project_stage_id, amount_cents, currency, lock_status, idempotency_key, created_by
    ) VALUES (
        p_purpose,
        v_wallet_id,
        CASE WHEN p_purpose = 'escrow_lock' THEN p_stage_id END,
        v_amount,
        v_currency,
        CASE WHEN p_purpose = 'escrow_lock' THEN 'pending' ELSE 'not_applicable' END,
        p_idempotency_key,
        v_uid
    )
    RETURNING * INTO v_payment;

    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES (
        p_idempotency_key, v_scope, v_hash, 'in_progress',
        pg_catalog.jsonb_build_object('payment_id', v_payment.id),
        pg_catalog.now() + interval '7 days'
    );

    RETURN pg_catalog.to_jsonb(v_payment) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

-- Bind a started payment to the PaymentIntent the processor created for it. The caller must be the
-- payer who started it. Binding is write-once: a second, DIFFERENT intent for one attempt is refused,
-- because two intents for one attempt is exactly how one purchase is charged twice.
CREATE OR REPLACE FUNCTION finance.attach_card_payment(p_payment_id uuid, p_provider_ref text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_payment finance.inbound_payments;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to pay' USING ERRCODE = '42501';
    END IF;
    IF p_provider_ref IS NULL OR p_provider_ref !~ '^pi_[A-Za-z0-9_]{1,250}$' THEN
        RAISE EXCEPTION 'providerRef: expected a Stripe PaymentIntent id' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_payment FROM finance.inbound_payments WHERE id = p_payment_id FOR UPDATE;
    -- Someone else's payment is answered exactly like a missing one: existence is not the caller's to learn.
    IF NOT FOUND OR v_payment.created_by <> v_uid THEN
        RAISE EXCEPTION 'payment: that payment does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_payment.provider_ref IS NOT NULL AND v_payment.provider_ref <> p_provider_ref THEN
        RAISE EXCEPTION 'payment: this payment is already bound to a different PaymentIntent'
            USING ERRCODE = 'PX409';
    END IF;
    IF v_payment.provider_ref IS NULL THEN
        UPDATE finance.inbound_payments
           SET provider_ref = p_provider_ref, updated_at = pg_catalog.now()
         WHERE id = v_payment.id
        RETURNING * INTO v_payment;
    END IF;
    UPDATE finance.idempotency_keys
       SET status = 'succeeded',
           response = pg_catalog.jsonb_build_object('payment_id', v_payment.id, 'provider_ref', p_provider_ref)
     WHERE key = v_payment.idempotency_key;
    RETURN pg_catalog.to_jsonb(v_payment);
END;
$$;

-- Give up on a started payment the processor REFUSED to create (an invalid request, an unsupported
-- currency) — not one that merely timed out, which is retried under the same key instead. Only an
-- unbound attempt can be abandoned: once an intent exists, only its own events may end it.
CREATE OR REPLACE FUNCTION finance.abandon_card_payment(p_payment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_payment finance.inbound_payments;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to pay' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_payment FROM finance.inbound_payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND OR v_payment.created_by <> v_uid THEN
        RAISE EXCEPTION 'payment: that payment does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_payment.provider_ref IS NOT NULL OR v_payment.status <> 'requires_payment' THEN
        RETURN pg_catalog.to_jsonb(v_payment);
    END IF;
    UPDATE finance.inbound_payments
       SET status = 'canceled',
           failure_reason = pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_reason), ''), 'The payment could not be started.'), 400),
           lock_status = CASE WHEN purpose = 'escrow_lock' THEN 'failed' ELSE lock_status END,
           lock_error = CASE WHEN purpose = 'escrow_lock' THEN 'The payment could not be started.' END,
           updated_at = pg_catalog.now()
     WHERE id = v_payment.id
    RETURNING * INTO v_payment;
    UPDATE finance.idempotency_keys
       SET status = 'failed',
           response = pg_catalog.jsonb_build_object('payment_id', v_payment.id, 'failure', v_payment.failure_reason)
     WHERE key = v_payment.idempotency_key;
    RETURN pg_catalog.to_jsonb(v_payment);
END;
$$;
-- #endregion

-- #region 3. Card payments — the processor doors
-- `payment_intent.succeeded`: the money EXISTS. Credit what was actually received to the wallet the
-- attempt named (reason `topup`, the vocabulary the ledger surfaces already read), then — for an
-- escrow lock — hold the stage's escrow from that wallet.
--
-- The lock runs projects.fund_stage AS THE PAYER WHO AUTHORISED IT: `request.jwt.claim.sub` is set to
-- the row's `created_by` for the duration of the call, so fund_stage re-checks that person's project
-- access and spend capability NOW and applies every rule a stage lock has through its one
-- implementation. It runs in a SUBTRANSACTION: a lock refused at settlement (the stage moved on, a
-- spending limit bit, the member lost the right to spend) rolls back only the lock, never the credit —
-- the money stays in the wallet as the payer's funds, and the refusal is recorded on the row.
CREATE OR REPLACE FUNCTION finance.settle_card_payment(
    p_event_id text,
    p_provider_ref text,
    p_amount_received bigint,
    p_currency text,
    p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment finance.inbound_payments;
    v_wallet finance.wallets;
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
    v_tx uuid;
    v_project uuid;
    v_prev_sub text;
    v_lock_status text := 'not_applicable';
    v_lock_error text;
    v_escrows uuid[] := '{}';
BEGIN
    IF NOT finance.fn_claim_stripe_event(p_event_id, 'payment_intent.succeeded') THEN
        RETURN finance.fn_stripe_event_replay(p_event_id);
    END IF;

    SELECT * INTO v_payment
      FROM finance.inbound_payments
     WHERE provider = 'stripe' AND provider_ref = p_provider_ref
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'no inbound payment is bound to this PaymentIntent'));
    END IF;
    IF v_payment.status = 'succeeded' THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'replayed', 'detail', 'this payment was already settled', 'payment_id', v_payment.id));
    END IF;
    -- A settlement in another currency, or of nothing, is a reconciliation case, not a credit: the
    -- ledger records money in the currency it arrived in, and this row does not describe that money.
    IF v_currency <> v_payment.currency OR p_amount_received IS NULL OR p_amount_received <= 0 THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'settled amount or currency does not match the payment',
            'payment_id', v_payment.id));
    END IF;

    SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_payment.wallet_id FOR UPDATE;
    PERFORM finance.fn_wallet_credit(
        v_wallet.owner_id, v_wallet.owner_type, v_wallet.currency, p_amount_received,
        'topup', 'inbound_payments', v_payment.id
    );
    SELECT t.id INTO v_tx
      FROM finance.transactions t
     WHERE t.wallet_id = v_wallet.id
       AND t.ref_table = 'inbound_payments'
       AND t.ref_id = v_payment.id
       AND t.direction = 'credit'
     ORDER BY t.created_at DESC
     LIMIT 1;

    UPDATE finance.inbound_payments
       SET status = 'succeeded',
           amount_received_cents = p_amount_received,
           succeeded_at = pg_catalog.now(),
           transaction_id = v_tx,
           failure_reason = NULL,
           livemode = p_livemode,
           updated_at = pg_catalog.now()
     WHERE id = v_payment.id
    RETURNING * INTO v_payment;

    IF v_payment.purpose = 'escrow_lock' THEN
        IF v_payment.project_stage_id IS NULL THEN
            v_lock_status := 'failed';
            v_lock_error := 'The stage this payment was for no longer exists; the money is in the wallet.';
        ELSIF p_amount_received < v_payment.amount_cents THEN
            v_lock_status := 'failed';
            v_lock_error := 'Less arrived than the stage needs; the money is in the wallet.';
        ELSE
            SELECT ps.project_id INTO v_project
              FROM projects.project_stages ps WHERE ps.id = v_payment.project_stage_id;
            v_prev_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
            BEGIN
                PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_payment.created_by::text, true);
                PERFORM projects.fund_stage(v_project, v_payment.project_stage_id);
                -- now() is the transaction's start instant, so equality picks out exactly the escrows this
                -- settlement created — the ones a chargeback against this payment must freeze.
                SELECT COALESCE(pg_catalog.array_agg(e.id ORDER BY e.id), '{}') INTO v_escrows
                  FROM finance.escrows e
                 WHERE e.project_stage_id = v_payment.project_stage_id
                   AND e.status = 'held'
                   AND e.created_at = pg_catalog.now();
                v_lock_status := 'locked';
            EXCEPTION WHEN OTHERS THEN
                v_lock_status := 'failed';
                v_lock_error := pg_catalog.left(SQLERRM, 400);
            END;
            PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
        END IF;
        UPDATE finance.inbound_payments
           SET lock_status = v_lock_status,
               lock_error = CASE WHEN v_lock_status = 'failed' THEN v_lock_error END,
               locked_escrow_ids = v_escrows,
               updated_at = pg_catalog.now()
         WHERE id = v_payment.id
        RETURNING * INTO v_payment;
    END IF;

    PERFORM comms.fn_notify(
        v_payment.created_by,
        CASE WHEN v_lock_status = 'locked' THEN 'escrow.funded' ELSE 'wallet.topup_succeeded' END,
        CASE
            WHEN v_lock_status = 'locked' THEN 'Stage funded'
            WHEN v_lock_status = 'failed' THEN 'Payment received — stage not funded'
            ELSE 'Top-up received'
        END,
        CASE
            WHEN v_lock_status = 'locked' THEN 'Your card payment arrived and the stage''s escrow is secured.'
            WHEN v_lock_status = 'failed' THEN 'Your card payment is in the wallet, but the stage could not be funded: ' || COALESCE(v_lock_error, 'unknown reason')
            ELSE 'Your card payment has been added to your wallet.'
        END,
        'inbound_payments',
        v_payment.id,
        pg_catalog.jsonb_build_object('amount_cents', p_amount_received, 'currency', v_payment.currency)
    );

    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied',
        'payment_id', v_payment.id,
        'transaction_id', v_tx,
        'lock_status', v_payment.lock_status,
        'locked_escrow_ids', pg_catalog.to_jsonb(v_payment.locked_escrow_ids)
    ));
END;
$$;

-- `payment_intent.payment_failed` / `payment_intent.canceled`: the attempt did not pay. A FAILED
-- intent is not final — the payer may retry it with another method, and a later
-- `payment_intent.succeeded` still settles it — so only a CANCELED one ends an escrow lock. Nothing
-- here moves money; a failure event after a settlement changes nothing.
CREATE OR REPLACE FUNCTION finance.record_card_payment_failure(
    p_event_id text,
    p_provider_ref text,
    p_status text,
    p_reason text,
    p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment finance.inbound_payments;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('failed', 'canceled') THEN
        RAISE EXCEPTION 'status: expected failed or canceled' USING ERRCODE = '22023';
    END IF;
    IF NOT finance.fn_claim_stripe_event(p_event_id, 'payment_intent.' || p_status) THEN
        RETURN finance.fn_stripe_event_replay(p_event_id);
    END IF;

    SELECT * INTO v_payment
      FROM finance.inbound_payments
     WHERE provider = 'stripe' AND provider_ref = p_provider_ref
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'no inbound payment is bound to this PaymentIntent'));
    END IF;
    IF v_payment.status = 'succeeded' THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'ignored', 'detail', 'the payment had already settled', 'payment_id', v_payment.id));
    END IF;

    UPDATE finance.inbound_payments
       SET status = p_status::finance.inbound_payment_status,
           failure_reason = pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_reason), ''),
               CASE WHEN p_status = 'canceled' THEN 'The payment was canceled.' ELSE 'The payment was declined.' END), 400),
           lock_status = CASE WHEN purpose = 'escrow_lock' AND p_status = 'canceled' THEN 'failed' ELSE lock_status END,
           lock_error = CASE WHEN purpose = 'escrow_lock' AND p_status = 'canceled' THEN 'The payment was canceled.' ELSE lock_error END,
           livemode = p_livemode,
           updated_at = pg_catalog.now()
     WHERE id = v_payment.id
    RETURNING * INTO v_payment;

    IF p_status = 'failed' THEN
        PERFORM comms.fn_notify(
            v_payment.created_by, 'wallet.topup_failed', 'Card payment declined',
            'Your card payment didn''t go through. You can try again with another method.',
            'inbound_payments', v_payment.id,
            pg_catalog.jsonb_build_object('amount_cents', v_payment.amount_cents, 'currency', v_payment.currency)
        );
    END IF;

    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied', 'payment_id', v_payment.id, 'status', v_payment.status));
END;
$$;
-- #endregion

-- #region 4. Identity (Stripe Identity, freelancer Level-2 KYC)
-- Open a verification case for the calling freelancer. The KYC gate is the earner's (finance-model.md
-- §10): a client never needs one, so a caller with no freelancer profile is refused. Bounded per day
-- (`identity_sessions_per_day`) in the DATABASE, because every Stripe Identity check is billed and a
-- per-process limiter is not a ceiling. The profile's `kyc_status` is NOT touched here — opening a
-- session is not a submission; only the processor's decision moves it.
CREATE OR REPLACE FUNCTION finance.begin_identity_verification()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_status finance.kyc_status;
    v_recent integer;
    v_limit integer;
    v_case finance.verification_cases;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to verify your identity' USING ERRCODE = '42501';
    END IF;
    SELECT fp.kyc_status INTO v_status FROM org.freelancer_profiles fp WHERE fp.user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'identity: identity checks are for freelancers — set up your freelancer profile first'
            USING ERRCODE = 'PK403';
    END IF;
    IF v_status = 'verified'::finance.kyc_status THEN
        RAISE EXCEPTION 'identity: your identity is already verified' USING ERRCODE = 'PX409';
    END IF;

    SELECT COALESCE((p.value #>> '{}')::integer, 5) INTO v_limit
      FROM security.platform_params p WHERE p.key = 'identity_sessions_per_day';
    v_limit := COALESCE(v_limit, 5);
    SELECT pg_catalog.count(*) INTO v_recent
      FROM finance.verification_cases c
     WHERE c.subject_type = 'freelancer' AND c.subject_id = v_uid
       AND c.kind = 'kyc' AND c.provider = 'stripe_identity'
       AND c.created_at > pg_catalog.now() - interval '24 hours';
    IF v_recent >= v_limit THEN
        RAISE EXCEPTION 'identity: you have started % identity checks today — try again tomorrow', v_recent
            USING ERRCODE = 'PR429';
    END IF;

    INSERT INTO finance.verification_cases (subject_type, subject_id, kind, status, tier, provider, submitted_at)
    VALUES ('freelancer', v_uid, 'kyc', 'pending', 2, 'stripe_identity', pg_catalog.now())
    RETURNING * INTO v_case;

    RETURN pg_catalog.to_jsonb(v_case);
END;
$$;

-- Bind an open case to the verification session the processor created for it (write-once, own case).
CREATE OR REPLACE FUNCTION finance.attach_identity_session(p_case_id uuid, p_session_ref text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_case finance.verification_cases;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to verify your identity' USING ERRCODE = '42501';
    END IF;
    IF p_session_ref IS NULL OR p_session_ref !~ '^vs_[A-Za-z0-9_]{1,250}$' THEN
        RAISE EXCEPTION 'providerRef: expected a Stripe verification session id' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_case FROM finance.verification_cases WHERE id = p_case_id FOR UPDATE;
    IF NOT FOUND OR v_case.subject_type <> 'freelancer' OR v_case.subject_id <> v_uid
       OR v_case.provider <> 'stripe_identity' THEN
        RAISE EXCEPTION 'identity: that verification does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_case.provider_ref IS NOT NULL AND v_case.provider_ref <> p_session_ref THEN
        RAISE EXCEPTION 'identity: this verification is already bound to a different session'
            USING ERRCODE = 'PX409';
    END IF;
    IF v_case.provider_ref IS NULL THEN
        UPDATE finance.verification_cases SET provider_ref = p_session_ref WHERE id = v_case.id
        RETURNING * INTO v_case;
        UPDATE org.freelancer_profiles
           SET identity_provider_ref = p_session_ref
         WHERE user_id = v_uid AND kyc_status <> 'verified'::finance.kyc_status;
    END IF;
    RETURN pg_catalog.to_jsonb(v_case);
END;
$$;

-- Close a case the processor refused to open a session for. Only an unbound, still-open case.
CREATE OR REPLACE FUNCTION finance.abandon_identity_verification(p_case_id uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_case finance.verification_cases;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to verify your identity' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_case FROM finance.verification_cases WHERE id = p_case_id FOR UPDATE;
    IF NOT FOUND OR v_case.subject_type <> 'freelancer' OR v_case.subject_id <> v_uid THEN
        RAISE EXCEPTION 'identity: that verification does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF v_case.provider_ref IS NULL AND v_case.status = 'pending'::finance.kyc_status THEN
        UPDATE finance.verification_cases
           SET status = 'expired', decided_at = pg_catalog.now(),
               notes = pg_catalog.left(COALESCE(NULLIF(pg_catalog.btrim(p_note), ''), 'The check could not be started.'), 400)
         WHERE id = v_case.id
        RETURNING * INTO v_case;
    END IF;
    RETURN pg_catalog.to_jsonb(v_case);
END;
$$;

-- `identity.verification_session.{verified,requires_input,canceled}` — the processor's decision.
--   verified       → case verified; the profile's KYC cache verified at tier 2 (the Level-2 gate).
--   requires_input → case rejected with the processor's error CODE (never its extracted data); the
--                    profile shows rejected unless it is already verified. Not final at Stripe: the
--                    person may resubmit the same session, and a later `verified` supersedes this.
--   canceled       → case expired.
-- A verified case never regresses on a late or reordered event.
CREATE OR REPLACE FUNCTION finance.apply_identity_event(
    p_event_id text,
    p_event_type text,
    p_session_ref text,
    p_error_code text,
    p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_case finance.verification_cases;
    v_code text := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_error_code, '')), 80), '');
BEGIN
    IF p_event_type NOT IN (
        'identity.verification_session.verified',
        'identity.verification_session.requires_input',
        'identity.verification_session.canceled'
    ) THEN
        RAISE EXCEPTION 'event: not an identity decision event' USING ERRCODE = '22023';
    END IF;
    IF NOT finance.fn_claim_stripe_event(p_event_id, p_event_type) THEN
        RETURN finance.fn_stripe_event_replay(p_event_id);
    END IF;

    SELECT * INTO v_case
      FROM finance.verification_cases
     WHERE provider = 'stripe_identity' AND provider_ref = p_session_ref
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'no verification case is bound to this session'));
    END IF;
    IF v_case.status = 'verified'::finance.kyc_status THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', CASE WHEN p_event_type = 'identity.verification_session.verified' THEN 'replayed' ELSE 'ignored' END,
            'detail', 'the case is already verified', 'case_id', v_case.id));
    END IF;

    IF p_event_type = 'identity.verification_session.verified' THEN
        UPDATE finance.verification_cases
           SET status = 'verified', tier = 2, decided_at = pg_catalog.now(), notes = NULL
         WHERE id = v_case.id
        RETURNING * INTO v_case;
        IF v_case.subject_type IN ('freelancer', 'user') THEN
            UPDATE org.freelancer_profiles
               SET kyc_status = 'verified',
                   kyc_tier = GREATEST(COALESCE(kyc_tier, 0), 2),
                   kyc_verified_at = pg_catalog.now(),
                   identity_provider_ref = p_session_ref
             WHERE user_id = v_case.subject_id;
            PERFORM comms.fn_notify(
                v_case.subject_id, 'account.kyc_verified', 'Identity verified',
                'Your identity check passed. Once your payout account is ready you can take on paid work.',
                'verification_cases', v_case.id
            );
        END IF;
    ELSIF p_event_type = 'identity.verification_session.requires_input' THEN
        UPDATE finance.verification_cases
           SET status = 'rejected', decided_at = pg_catalog.now(),
               notes = 'Stripe Identity: ' || COALESCE(v_code, 'more information is needed')
         WHERE id = v_case.id
        RETURNING * INTO v_case;
        IF v_case.subject_type IN ('freelancer', 'user') THEN
            UPDATE org.freelancer_profiles
               SET kyc_status = 'rejected'
             WHERE user_id = v_case.subject_id AND kyc_status <> 'verified'::finance.kyc_status;
            PERFORM comms.fn_notify(
                v_case.subject_id, 'account.kyc_rejected', 'Identity check needs another try',
                'Your identity check couldn''t be completed. Open it again to retry.',
                'verification_cases', v_case.id,
                pg_catalog.jsonb_build_object('error_code', v_code)
            );
        END IF;
    ELSE
        UPDATE finance.verification_cases
           SET status = 'expired', decided_at = pg_catalog.now(), notes = 'Stripe Identity: canceled'
         WHERE id = v_case.id
        RETURNING * INTO v_case;
    END IF;

    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied', 'case_id', v_case.id, 'status', v_case.status));
END;
$$;
-- #endregion

-- #region 5. Payout accounts (Stripe Connect)
-- Resolve whose payout account a request is about, and whether the caller may manage it. `personal`
-- is the caller themselves, under the owner type their wallet uses (freelancer, else user); `team` is
-- a team the caller holds `manage_billing` on — the same grant that governs a shared entity's payment
-- instruments, so an ordinary member cannot re-route the team's payouts. `business` is a client
-- business the caller holds `manage_billing` on: its Connect onboarding is the Level-3 KYB check
-- (finance.sync_payout_account mirrors a verified account onto org.business_profiles.kyb_status).
-- `p_team_id` names the ENTITY for both shared scopes — the parameter predates the business scope and
-- a function's parameters cannot be renamed in place. Internal.
CREATE OR REPLACE FUNCTION finance.fn_payout_owner(p_scope text, p_team_id uuid)
RETURNS TABLE (owner_type text, owner_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to set up payouts' USING ERRCODE = '42501';
    END IF;
    IF p_scope = 'personal' THEN
        owner_type := finance.fn_person_wallet_type(v_uid);
        owner_id := v_uid;
    ELSIF p_scope = 'team' THEN
        IF p_team_id IS NULL THEN
            RAISE EXCEPTION 'teamId: choose the team' USING ERRCODE = '22023';
        END IF;
        IF NOT finance.fn_owner_capability('team', p_team_id, 'manage_billing'::finance.vault_capability) THEN
            RAISE EXCEPTION 'auth: only a team owner can set up the team''s payouts' USING ERRCODE = '42501';
        END IF;
        owner_type := 'team';
        owner_id := p_team_id;
    ELSIF p_scope = 'business' THEN
        IF p_team_id IS NULL THEN
            RAISE EXCEPTION 'businessId: choose the business' USING ERRCODE = '22023';
        END IF;
        IF NOT finance.fn_owner_capability('business', p_team_id, 'manage_billing'::finance.vault_capability) THEN
            RAISE EXCEPTION 'auth: only a business owner can verify the business' USING ERRCODE = '42501';
        END IF;
        owner_type := 'business';
        owner_id := p_team_id;
    ELSE
        RAISE EXCEPTION 'scope: expected personal, team or business' USING ERRCODE = '22023';
    END IF;
    RETURN NEXT;
END;
$$;

-- The caller's (or their team's) current Stripe payout account, if any, whether it is payable, and
-- the name the connected account should carry in the processor's dashboard (the person's name, or
-- the team's) — a label, never an identity claim; the processor's onboarding collects the real one.
CREATE OR REPLACE FUNCTION finance.payout_account_for(p_scope text, p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner record;
    v_account finance.payout_accounts;
    v_name text;
    v_email text;
BEGIN
    SELECT * INTO v_owner FROM finance.fn_payout_owner(p_scope, p_team_id);
    -- The CALLER's own sign-in address — the person completing onboarding is the account's contact,
    -- for a team too. Stripe requires one on any account with the recipient configuration. It is
    -- handed to Stripe and never stored here (no PII in finance.*).
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = auth.uid();
    SELECT * INTO v_account
      FROM finance.payout_accounts a
     WHERE a.owner_type = v_owner.owner_type AND a.owner_id = v_owner.owner_id
       AND a.provider = 'stripe' AND a.status <> 'disabled'
     ORDER BY a.created_at DESC
     LIMIT 1;
    IF v_owner.owner_type = 'team' THEN
        SELECT t.name INTO v_name FROM org.teams t WHERE t.id = v_owner.owner_id;
    ELSIF v_owner.owner_type = 'business' THEN
        SELECT b.name INTO v_name FROM org.business_profiles b WHERE b.id = v_owner.owner_id;
    ELSE
        SELECT COALESCE(
                   NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', u.first_name, u.last_name)), ''),
                   u.username
               )
          INTO v_name
          FROM org.users_public u WHERE u.user_id = v_owner.owner_id;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'owner_type', v_owner.owner_type,
        'owner_id', v_owner.owner_id,
        'display_name', pg_catalog.left(COALESCE(v_name, ''), 120),
        'contact_email', v_email,
        'account', CASE WHEN v_account.id IS NULL THEN 'null'::jsonb ELSE pg_catalog.to_jsonb(v_account) END,
        'payout_ready', COALESCE(v_account.status = 'verified', false)
    );
END;
$$;

-- Record the connected account the processor created for this owner. One ACTIVE Stripe account per
-- owner (uq_payout_accounts_owner_active): when the owner already holds a different one — two
-- onboarding requests raced past the processor's own idempotency window — the existing account wins
-- and is returned, and the caller carries on with it.
CREATE OR REPLACE FUNCTION finance.record_payout_account(p_scope text, p_team_id uuid, p_account_id text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner record;
    v_account finance.payout_accounts;
BEGIN
    IF p_account_id IS NULL OR p_account_id !~ '^acct_[A-Za-z0-9]{1,250}$' THEN
        RAISE EXCEPTION 'accountId: expected a Stripe connected-account id' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_owner FROM finance.fn_payout_owner(p_scope, p_team_id);

    SELECT * INTO v_account
      FROM finance.payout_accounts a
     WHERE a.provider = 'stripe' AND a.account_id = p_account_id;
    IF FOUND THEN
        IF v_account.owner_type <> v_owner.owner_type OR v_account.owner_id <> v_owner.owner_id THEN
            RAISE EXCEPTION 'accountId: that connected account belongs to someone else' USING ERRCODE = 'PX409';
        END IF;
        RETURN pg_catalog.to_jsonb(v_account);
    END IF;

    SELECT * INTO v_account
      FROM finance.payout_accounts a
     WHERE a.owner_type = v_owner.owner_type AND a.owner_id = v_owner.owner_id
       AND a.provider = 'stripe' AND a.status <> 'disabled'
     ORDER BY a.created_at DESC
     LIMIT 1;
    IF FOUND THEN
        RETURN pg_catalog.to_jsonb(v_account);
    END IF;

    INSERT INTO finance.payout_accounts (owner_type, owner_id, provider, account_id, status)
    VALUES (v_owner.owner_type, v_owner.owner_id, 'stripe', p_account_id, 'pending_verification')
    RETURNING * INTO v_account;
    RETURN pg_catalog.to_jsonb(v_account);
END;
$$;

-- Apply the account status the processor reported (service role only — the fat service calls this
-- after reading the account from Stripe itself). Keeps the person's `payout_ready` cache — the second
-- half of the earning gate, finance.fn_freelancer_payout_ready — true exactly while they hold a
-- verified payout account.
CREATE OR REPLACE FUNCTION finance.sync_payout_account(p_account_id text, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_account finance.payout_accounts;
    v_ready boolean := false;
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('pending_verification', 'verified', 'restricted', 'disabled') THEN
        RAISE EXCEPTION 'status: not a payout account status' USING ERRCODE = '22023';
    END IF;
    UPDATE finance.payout_accounts
       SET status = p_status, updated_at = pg_catalog.now()
     WHERE provider = 'stripe' AND account_id = p_account_id
    RETURNING * INTO v_account;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'accountId: no payout account is recorded for that connected account'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_account.owner_type IN ('freelancer', 'user') THEN
        v_ready := EXISTS (
            SELECT 1 FROM finance.payout_accounts a
             WHERE a.owner_type IN ('freelancer', 'user') AND a.owner_id = v_account.owner_id
               AND a.status = 'verified'
        );
        UPDATE org.freelancer_profiles SET payout_ready = v_ready WHERE user_id = v_account.owner_id;
    ELSIF v_account.owner_type = 'business' THEN
        -- A business's Connect onboarding IS its Level-3 KYB check: a verified account is a verified
        -- business, a restricted one is back in review. Only ever raised from what the processor
        -- reported; never lowered below a verification an admin recorded some other way.
        v_ready := v_account.status = 'verified';
        UPDATE org.business_profiles b
           SET kyb_status = CASE
                   WHEN v_ready THEN 'verified'::finance.kyc_status
                   WHEN b.kyb_status = 'verified' THEN b.kyb_status
                   ELSE 'pending'::finance.kyc_status
               END,
               kyb_verified_at = CASE WHEN v_ready THEN COALESCE(b.kyb_verified_at, pg_catalog.now()) ELSE b.kyb_verified_at END,
               kyb_provider_ref = v_account.account_id
         WHERE b.id = v_account.owner_id;
    ELSE
        v_ready := v_account.status = 'verified';
    END IF;

    RETURN pg_catalog.jsonb_build_object('account', pg_catalog.to_jsonb(v_account), 'payout_ready', v_ready);
END;
$$;
-- #endregion

-- #region 6. Transfers and disputes (the processor doors)
-- `transfer.created`: money left the platform balance for a connected account. A withdrawal
-- (finance.begin_payout, 00001240) creates the transfer and closes its payout through
-- finance.complete_payout; this event is the reconciliation half AND the recovery path when the fat
-- service lost the answer after Stripe created the transfer: a transfer carrying a
-- `projective_payout_id` is bound to that payout ONLY when its destination, amount and currency agree
-- with it, and a still-pending payout is then marked paid (the transfer is the fact). Anything else is
-- recorded as unmatched on the event claim, and nothing moves.
CREATE OR REPLACE FUNCTION finance.record_transfer_created(
    p_event_id text,
    p_transfer_ref text,
    p_destination text,
    p_amount bigint,
    p_currency text,
    p_payout_id uuid,
    p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payout finance.payouts;
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
BEGIN
    IF NOT finance.fn_claim_stripe_event(p_event_id, 'transfer.created') THEN
        RETURN finance.fn_stripe_event_replay(p_event_id);
    END IF;
    IF p_payout_id IS NULL THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'the transfer carries no Projective payout reference',
            'transfer', p_transfer_ref));
    END IF;

    SELECT * INTO v_payout FROM finance.payouts WHERE id = p_payout_id FOR UPDATE;
    IF NOT FOUND
       OR v_payout.provider <> 'stripe'
       OR v_payout.amount_cents <> p_amount
       OR pg_catalog.upper(v_payout.currency) <> v_currency
       OR NOT EXISTS (
            SELECT 1
              FROM finance.payout_accounts a
              JOIN finance.wallets w ON w.id = v_payout.wallet_id
             WHERE a.provider = 'stripe' AND a.account_id = p_destination
               AND a.owner_type = w.owner_type AND a.owner_id = w.owner_id
       ) THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'the transfer does not agree with the payout it names',
            'transfer', p_transfer_ref, 'payout_id', p_payout_id));
    END IF;
    IF v_payout.provider_ref IS NOT NULL AND v_payout.provider_ref <> p_transfer_ref THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'the payout is already bound to a different transfer',
            'transfer', p_transfer_ref, 'payout_id', p_payout_id));
    END IF;

    UPDATE finance.payouts
       SET provider_ref = p_transfer_ref,
           status = CASE WHEN status = 'pending' THEN 'paid'::finance.payout_status ELSE status END,
           settled_at = CASE WHEN status = 'pending' THEN pg_catalog.now() ELSE settled_at END
     WHERE id = v_payout.id;
    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied', 'payout_id', v_payout.id, 'transfer', p_transfer_ref));
END;
$$;

-- `charge.dispute.created`: a cardholder contested a charge, and the processor has already withdrawn
-- the amount from the platform balance. Record the case (finance.chargebacks), linked to the payment,
-- wallet and ledger credit it contests, and FREEZE the escrows that payment funded — `held` →
-- `disputed`, the Dispute Lockbox — so capital that may be clawed back cannot be released meanwhile.
-- Arbitration (won → unfreeze, lost → reverse) is deliberately not decided here (Decision #125).
-- A dispute against a charge Projective did not create is still recorded, unlinked, for reconciliation.
CREATE OR REPLACE FUNCTION finance.record_dispute_opened(
    p_event_id text,
    p_dispute_ref text,
    p_provider_ref text,
    p_amount bigint,
    p_currency text,
    p_reason text,
    p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment finance.inbound_payments;
    v_chargeback uuid;
    v_frozen uuid[] := '{}';
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
BEGIN
    IF NOT finance.fn_claim_stripe_event(p_event_id, 'charge.dispute.created') THEN
        RETURN finance.fn_stripe_event_replay(p_event_id);
    END IF;
    IF p_dispute_ref IS NULL OR p_dispute_ref !~ '^(du|dp)_[A-Za-z0-9_]{1,250}$'
       OR p_amount IS NULL OR p_amount <= 0 OR v_currency !~ '^[A-Z]{3}$' THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'ignored', 'detail', 'the dispute event is missing its id, amount or currency'));
    END IF;
    SELECT c.id INTO v_chargeback FROM finance.chargebacks c WHERE c.provider_ref = p_dispute_ref;
    IF FOUND THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'replayed', 'detail', 'this dispute is already recorded', 'chargeback_id', v_chargeback));
    END IF;

    SELECT * INTO v_payment
      FROM finance.inbound_payments
     WHERE provider = 'stripe' AND provider_ref = p_provider_ref
       FOR UPDATE;

    INSERT INTO finance.chargebacks (wallet_id, transaction_id, escrow_id, provider_ref, amount_cents, currency, status, reason)
    VALUES (
        v_payment.wallet_id,
        v_payment.transaction_id,
        CASE WHEN pg_catalog.cardinality(v_payment.locked_escrow_ids) = 1 THEN v_payment.locked_escrow_ids[1] END,
        p_dispute_ref,
        p_amount,
        v_currency,
        'opened',
        NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_reason, '')), 400), '')
    )
    RETURNING id INTO v_chargeback;

    IF v_payment.id IS NULL THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'dispute recorded against a charge Projective did not create',
            'chargeback_id', v_chargeback));
    END IF;

    WITH frozen AS (
        UPDATE finance.escrows
           SET status = 'disputed'
         WHERE id = ANY (v_payment.locked_escrow_ids) AND status = 'held'
        RETURNING id
    )
    SELECT COALESCE(pg_catalog.array_agg(id ORDER BY id), '{}') INTO v_frozen FROM frozen;

    PERFORM comms.fn_notify(
        v_payment.created_by, 'chargeback.opened', 'Card payment disputed',
        'A card payment you made has been disputed with your bank. Any escrow it funded is on hold while it is resolved.',
        'chargebacks', v_chargeback,
        pg_catalog.jsonb_build_object('amount_cents', p_amount, 'currency', v_currency, 'frozen_escrows', pg_catalog.cardinality(v_frozen)),
        NULL, NULL, NULL, NULL, NULL, 'high'::comms.notification_urgency
    );

    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied', 'chargeback_id', v_chargeback, 'payment_id', v_payment.id,
        'frozen_escrow_ids', pg_catalog.to_jsonb(v_frozen)));
END;
$$;
-- #endregion
