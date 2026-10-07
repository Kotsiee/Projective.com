-- =============================================================================================
-- 00001240_functions_finance_money_movement.sql — the money-movement doors that follow the Stripe
-- fiat rails (root CLAUDE.md §8 Decision #126, after #125).
--
--   1. Dispute resolution   — `charge.dispute.closed`: won unfreezes, lost claws back.
--   2. Withdrawals          — a payout debits the wallet, then leaves as a Stripe Transfer to the
--                             owner's Connect account (Separate Charges & Transfers).
--   3. Saved cards          — the Stripe Customer an owner's cards attach to, and the processor door
--                             that records a card a SetupIntent confirmed.
--   4. Recurring deposits   — a standing top-up rule and the scheduler door that charges it off-session.
--   5. The Income Smoother  — enrolment, gated on earning history, at the platform's fee.
--   6. Verification status  — one read of the caller's KYC and the KYB of the businesses they manage.
--
-- The same two-door split as 00001230: USER doors (EXECUTE → authenticated) authorise the caller
-- through auth.uid() and can never report that money arrived or left; PROCESSOR doors (EXECUTE →
-- service_role only) apply what Stripe reported or what the scheduler decided. Grants: 00002510.
-- =============================================================================================

-- #region 1. Dispute resolution (processor door)
-- `charge.dispute.closed`. `won` (and `warning_closed`, an inquiry that never became a chargeback)
-- returns the frozen escrows to `held` — the capital was never lost. `lost` means the processor has
-- kept the disputed amount, so the platform recovers it from the payer:
--
--   * every escrow the disputed payment funded that is still frozen is returned to the payer's wallet
--     (reason `escrow_refund`, exactly as finance.fn_refund_ticket_escrow returns one) — the work it
--     was holding for is no longer paid for — and its ticket drops back to `unpaid`;
--   * the disputed amount is then debited from that wallet with reason `chargeback`. Whatever the
--     wallet can no longer cover (the payer spent it) is recorded on the case as `unrecovered_cents`,
--     the platform's loss, never forced into a negative balance.
--
-- An escrow the payment funded that was ALREADY RELEASED to the freelancer before the dispute is not
-- clawed back from the freelancer here: that recourse is a product decision (flagged in Decision #126).
CREATE OR REPLACE FUNCTION finance.record_dispute_closed(
    p_event_id text,
    p_dispute_ref text,
    p_status text,
    p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
-- Not '' like its sibling doors: a lost dispute UPDATEs projects.tickets, and the ticket triggers
-- (projects.fn_enforce_ticket_checkout_desc) resolve their enum types unqualified through the caller's
-- search_path. Every name this body writes is still schema-qualified.
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_case finance.chargebacks;
    v_payment finance.inbound_payments;
    v_wallet finance.wallets;
    v_escrow finance.escrows;
    v_escrow_ids uuid[] := '{}';
    v_touched uuid[] := '{}';
    v_payer_wallet text;
    v_recover bigint := 0;
    v_short bigint := 0;
    v_notify uuid;
BEGIN
    IF NOT finance.fn_claim_stripe_event(p_event_id, 'charge.dispute.closed') THEN
        RETURN finance.fn_stripe_event_replay(p_event_id);
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('won', 'lost', 'warning_closed') THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'ignored', 'detail', 'the dispute did not close with a final outcome'));
    END IF;

    SELECT * INTO v_case FROM finance.chargebacks WHERE provider_ref = p_dispute_ref FOR UPDATE;
    IF NOT FOUND THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'no recorded dispute carries this id'));
    END IF;
    IF v_case.status IN ('won', 'lost', 'refunded') THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'replayed', 'detail', 'this dispute is already resolved', 'chargeback_id', v_case.id));
    END IF;

    -- The payment the dispute contests: the one whose ledger credit the case recorded.
    IF v_case.transaction_id IS NOT NULL THEN
        SELECT * INTO v_payment FROM finance.inbound_payments
         WHERE transaction_id = v_case.transaction_id
           FOR UPDATE;
    END IF;
    v_escrow_ids := CASE
        WHEN v_payment.id IS NOT NULL THEN v_payment.locked_escrow_ids
        WHEN v_case.escrow_id IS NOT NULL THEN ARRAY[v_case.escrow_id]
        ELSE '{}'::uuid[]
    END;
    v_notify := v_payment.created_by;

    IF p_status IN ('won', 'warning_closed') THEN
        WITH thawed AS (
            UPDATE finance.escrows SET status = 'held'
             WHERE id = ANY (v_escrow_ids) AND status = 'disputed'
            RETURNING id
        )
        SELECT COALESCE(pg_catalog.array_agg(id ORDER BY id), '{}') INTO v_touched FROM thawed;

        UPDATE finance.chargebacks SET status = 'won', resolved_at = pg_catalog.now() WHERE id = v_case.id;

        IF v_notify IS NOT NULL THEN
            PERFORM comms.fn_notify(
                v_notify, 'chargeback.won', 'Dispute resolved',
                'The dispute on your card payment was resolved in the payment''s favour. Any escrow it funded is released from hold.',
                'chargebacks', v_case.id,
                pg_catalog.jsonb_build_object('released_escrows', pg_catalog.cardinality(v_touched))
            );
        END IF;
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'applied', 'chargeback_id', v_case.id, 'status', 'won',
            'unfrozen_escrow_ids', pg_catalog.to_jsonb(v_touched)));
    END IF;

    -- LOST.
    FOR v_escrow IN
        SELECT * FROM finance.escrows WHERE id = ANY (v_escrow_ids) AND status = 'disputed' FOR UPDATE
    LOOP
        UPDATE finance.escrows SET status = 'refunded' WHERE id = v_escrow.id;
        v_payer_wallet := finance.fn_escrow_payer_wallet_type(v_escrow.payer_business_id, v_escrow.payer_user_id);
        PERFORM finance.fn_ensure_wallet(v_payer_wallet, COALESCE(v_escrow.payer_business_id, v_escrow.payer_user_id), v_escrow.currency);
        PERFORM finance.fn_wallet_credit(
            COALESCE(v_escrow.payer_business_id, v_escrow.payer_user_id), v_payer_wallet, v_escrow.currency,
            v_escrow.amount_cents, 'escrow_refund', 'escrows', v_escrow.id
        );
        IF v_escrow.ticket_id IS NOT NULL THEN
            UPDATE projects.tickets SET payment_status = 'unpaid'::public.payment_status
             WHERE id = v_escrow.ticket_id
               AND NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_escrow.ticket_id AND e.status = 'held');
        END IF;
        v_touched := v_touched || v_escrow.id;
    END LOOP;

    IF v_case.wallet_id IS NOT NULL THEN
        SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_case.wallet_id FOR UPDATE;
    END IF;
    IF v_wallet.id IS NOT NULL AND pg_catalog.upper(v_wallet.currency) = pg_catalog.upper(v_case.currency) THEN
        v_recover := LEAST(v_wallet.balance_cents, v_case.amount_cents);
        IF v_recover > 0 THEN
            PERFORM finance.fn_wallet_debit(
                v_wallet.owner_id, v_wallet.owner_type, v_wallet.currency, v_recover,
                'chargeback', 'chargebacks', v_case.id
            );
        END IF;
    END IF;
    v_short := v_case.amount_cents - v_recover;

    UPDATE finance.chargebacks
       SET status = 'lost', resolved_at = pg_catalog.now(), unrecovered_cents = v_short
     WHERE id = v_case.id;

    IF v_notify IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v_notify, 'chargeback.lost', 'Dispute closed against the payment',
            'Your bank upheld the dispute on a card payment. The disputed amount has been taken back from your wallet, and any stage it funded is no longer paid for.',
            'chargebacks', v_case.id,
            pg_catalog.jsonb_build_object('amount_cents', v_case.amount_cents, 'currency', v_case.currency,
                'recovered_cents', v_recover, 'refunded_escrows', pg_catalog.cardinality(v_touched))
        );
    END IF;

    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied', 'chargeback_id', v_case.id, 'status', 'lost',
        'refunded_escrow_ids', pg_catalog.to_jsonb(v_touched),
        'recovered_cents', v_recover, 'unrecovered_cents', v_short));
END;
$$;
-- #endregion

-- #region 2. Withdrawals
-- The destination a wallet pays out to: its owner's VERIFIED Stripe Connect account (a person's own
-- account for a person wallet, whichever person type they hold). NULL when there is none. Internal.
CREATE OR REPLACE FUNCTION finance.fn_payout_destination(p_wallet finance.wallets)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT a.account_id
      FROM finance.payout_accounts a
     WHERE a.provider = 'stripe' AND a.status = 'verified'
       AND a.owner_id = p_wallet.owner_id
       AND (
            a.owner_type = p_wallet.owner_type
            OR (p_wallet.owner_type IN ('user', 'freelancer') AND a.owner_type IN ('user', 'freelancer'))
       )
     ORDER BY a.updated_at DESC
     LIMIT 1;
$$;

-- Start a withdrawal (user door). Authorises the caller — a person wallet is self-only, a shared vault
-- needs `withdraw` on THIS wallet — applies the earning gates (a freelancer's KYC + payout readiness,
-- a business's KYB), requires a verified payout account, and DEBITS the wallet at once (reason
-- `payout`), so money on its way out can never be spent twice while the transfer is in flight. The
-- fat service then creates the Stripe Transfer and closes the payout through complete_payout, or
-- returns the money through fail_payout when Stripe definitively refused.
--
-- Idempotent on the caller's attempt key (scope `payout:<uid>`), exactly like begin_card_payment.
-- An Instant payout is recorded (`instant`) but carries no fee here: the Instant Payout fee magnitude
-- is still undecided platform-wide (Decision #55(c)), and a fee nobody set must not be charged.
CREATE OR REPLACE FUNCTION finance.begin_payout(
    p_wallet_id uuid,
    p_amount bigint,
    p_currency text,
    p_instant boolean,
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
    v_wallet finance.wallets;
    v_destination text;
    v_payout finance.payouts;
    v_tx uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to withdraw' USING ERRCODE = '42501';
    END IF;
    IF p_idempotency_key IS NULL OR pg_catalog.length(p_idempotency_key) < 8
       OR pg_catalog.length(p_idempotency_key) > 120 THEN
        RAISE EXCEPTION 'idempotencyKey: a withdrawal needs an attempt key between 8 and 120 characters'
            USING ERRCODE = '22023';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amountMinor: enter an amount to withdraw' USING ERRCODE = '22023';
    END IF;
    IF v_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'currency: expected a three-letter currency code' USING ERRCODE = '22023';
    END IF;

    v_scope := 'payout:' || v_uid::text;
    v_hash := pg_catalog.md5(pg_catalog.concat_ws('|', p_wallet_id, p_amount, v_currency, COALESCE(p_instant, false)));
    SELECT * INTO v_prior FROM finance.idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
        IF v_prior.scope <> v_scope OR v_prior.request_hash <> v_hash THEN
            RAISE EXCEPTION 'idempotencyKey: that attempt key was used for a different request'
                USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_payout FROM finance.payouts WHERE id = (v_prior.response ->> 'payout_id')::uuid;
        SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_payout.wallet_id;
        RETURN pg_catalog.to_jsonb(v_payout)
            || pg_catalog.jsonb_build_object('destination', finance.fn_payout_destination(v_wallet), 'replayed', true);
    END IF;

    SELECT * INTO v_wallet FROM finance.wallets WHERE id = p_wallet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'walletId: that wallet does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF NOT (
        (v_wallet.owner_type IN ('user', 'freelancer') AND v_wallet.owner_id = v_uid)
        OR (
            v_wallet.owner_type IN ('team', 'business', 'organisation')
            AND finance.fn_has_vault_capability(v_wallet.id, v_uid, 'withdraw'::finance.vault_capability)
        )
    ) THEN
        RAISE EXCEPTION 'auth: you can''t withdraw from this wallet' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.upper(v_wallet.currency) <> v_currency THEN
        RAISE EXCEPTION 'currency: this wallet holds %', pg_catalog.upper(v_wallet.currency) USING ERRCODE = '22023';
    END IF;
    IF v_wallet.owner_type = 'freelancer' AND NOT finance.fn_freelancer_payout_ready(v_uid) THEN
        RAISE EXCEPTION 'verification: verify your identity and set up payouts before withdrawing'
            USING ERRCODE = 'PK403';
    END IF;
    IF v_wallet.owner_type = 'business' AND NOT finance.fn_business_kyb_verified(v_wallet.owner_id) THEN
        RAISE EXCEPTION 'verification: this business must be verified (KYB) before its vault can pay out'
            USING ERRCODE = 'PK403';
    END IF;
    v_destination := finance.fn_payout_destination(v_wallet);
    IF v_destination IS NULL THEN
        RAISE EXCEPTION 'destinationId: set up a verified payout account before withdrawing'
            USING ERRCODE = 'PA403';
    END IF;
    IF v_wallet.balance_cents < p_amount THEN
        RAISE EXCEPTION 'amountMinor: that is more than this wallet holds' USING ERRCODE = 'PF402';
    END IF;

    INSERT INTO finance.payouts (wallet_id, amount_cents, currency, status, instant, provider)
    VALUES (v_wallet.id, p_amount, v_currency, 'pending', COALESCE(p_instant, false), 'stripe')
    RETURNING * INTO v_payout;

    PERFORM finance.fn_wallet_debit(
        v_wallet.owner_id, v_wallet.owner_type, v_wallet.currency, p_amount, 'payout', 'payouts', v_payout.id
    );
    SELECT t.id INTO v_tx FROM finance.transactions t
     WHERE t.wallet_id = v_wallet.id AND t.ref_table = 'payouts' AND t.ref_id = v_payout.id
       AND t.direction = 'debit'
     ORDER BY t.created_at DESC LIMIT 1;
    UPDATE finance.payouts SET transaction_id = v_tx WHERE id = v_payout.id RETURNING * INTO v_payout;

    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES (
        p_idempotency_key, v_scope, v_hash, 'in_progress',
        pg_catalog.jsonb_build_object('payout_id', v_payout.id),
        pg_catalog.now() + interval '7 days'
    );

    RETURN pg_catalog.to_jsonb(v_payout)
        || pg_catalog.jsonb_build_object('destination', v_destination, 'replayed', false);
END;
$$;

-- The transfer exists (processor door): the payout has left the platform for the owner's Connect
-- account, which pays it to their bank on the processor's own schedule. Idempotent.
CREATE OR REPLACE FUNCTION finance.complete_payout(p_payout_id uuid, p_transfer_ref text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payout finance.payouts;
    v_owner uuid;
BEGIN
    IF p_transfer_ref IS NULL OR p_transfer_ref !~ '^tr_[A-Za-z0-9_]{1,250}$' THEN
        RAISE EXCEPTION 'transfer: expected a Stripe transfer id' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_payout FROM finance.payouts WHERE id = p_payout_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'payout: not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_payout.status = 'paid' THEN
        IF v_payout.provider_ref IS DISTINCT FROM p_transfer_ref THEN
            RAISE EXCEPTION 'payout: already paid through a different transfer' USING ERRCODE = 'PX409';
        END IF;
        RETURN pg_catalog.to_jsonb(v_payout) || pg_catalog.jsonb_build_object('replayed', true);
    END IF;
    IF v_payout.status <> 'pending' THEN
        RAISE EXCEPTION 'payout: a % payout cannot be completed', v_payout.status USING ERRCODE = 'PX409';
    END IF;
    UPDATE finance.payouts
       SET status = 'paid', settled_at = pg_catalog.now(), provider_ref = p_transfer_ref
     WHERE id = v_payout.id
    RETURNING * INTO v_payout;

    SELECT CASE WHEN w.owner_type IN ('user', 'freelancer') THEN w.owner_id END INTO v_owner
      FROM finance.wallets w WHERE w.id = v_payout.wallet_id;
    IF v_owner IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v_owner, 'payout.sent', 'Payout on its way',
            'Your withdrawal has left Projective for your payout account.',
            'payouts', v_payout.id,
            pg_catalog.jsonb_build_object('amount_cents', v_payout.amount_cents, 'currency', v_payout.currency)
        );
    END IF;
    RETURN pg_catalog.to_jsonb(v_payout) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

-- The processor definitively refused the transfer (processor door): return the debited money to the
-- wallet (reason `payout_reversal`) and record the reason. Only a still-pending payout can fail — a
-- paid one is reversed through the processor, never here. Idempotent.
CREATE OR REPLACE FUNCTION finance.fail_payout(p_payout_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payout finance.payouts;
    v_wallet finance.wallets;
BEGIN
    SELECT * INTO v_payout FROM finance.payouts WHERE id = p_payout_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'payout: not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_payout.status = 'failed' THEN
        RETURN pg_catalog.to_jsonb(v_payout) || pg_catalog.jsonb_build_object('replayed', true);
    END IF;
    IF v_payout.status <> 'pending' THEN
        RAISE EXCEPTION 'payout: a % payout cannot fail', v_payout.status USING ERRCODE = 'PX409';
    END IF;
    SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_payout.wallet_id FOR UPDATE;
    IF v_payout.transaction_id IS NOT NULL THEN
        PERFORM finance.fn_wallet_credit(
            v_wallet.owner_id, v_wallet.owner_type, v_wallet.currency, v_payout.amount_cents,
            'payout_reversal', 'payouts', v_payout.id
        );
    END IF;
    UPDATE finance.payouts
       SET status = 'failed',
           failure_reason = NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_reason, '')), 400), '')
     WHERE id = v_payout.id
    RETURNING * INTO v_payout;
    RETURN pg_catalog.to_jsonb(v_payout) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;
-- #endregion

-- #region 3. Saved cards
-- Whose card is being saved, whether the caller may, and the processor Customer it attaches to (user
-- door). `personal` is the caller, under the person type their wallet uses; `team` / `business` is an
-- entity the caller holds `manage_billing` on. Returns the Customer id when one exists, the caller's
-- own sign-in address (handed to Stripe, never stored) and a display name.
CREATE OR REPLACE FUNCTION finance.card_owner_for(p_scope text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_type text;
    v_id uuid;
    v_customer text;
    v_email text;
    v_name text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to save a card' USING ERRCODE = '42501';
    END IF;
    IF p_scope = 'personal' THEN
        v_type := finance.fn_person_wallet_type(v_uid);
        v_id := v_uid;
        SELECT COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', u.first_name, u.last_name)), ''), u.username)
          INTO v_name FROM org.users_public u WHERE u.user_id = v_uid;
    ELSIF p_scope IN ('team', 'business') THEN
        IF p_entity_id IS NULL THEN
            RAISE EXCEPTION 'contextId: choose the account the card is for' USING ERRCODE = '22023';
        END IF;
        IF NOT finance.fn_owner_capability(p_scope, p_entity_id, 'manage_billing'::finance.vault_capability) THEN
            RAISE EXCEPTION 'auth: only a member who manages billing can save a card here' USING ERRCODE = '42501';
        END IF;
        v_type := p_scope;
        v_id := p_entity_id;
        IF p_scope = 'team' THEN
            SELECT t.name INTO v_name FROM org.teams t WHERE t.id = p_entity_id;
        ELSE
            SELECT b.name INTO v_name FROM org.business_profiles b WHERE b.id = p_entity_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'scope: expected personal, team or business' USING ERRCODE = '22023';
    END IF;

    SELECT c.customer_ref INTO v_customer
      FROM finance.processor_customers c
     WHERE c.provider = 'stripe' AND c.owner_type = v_type AND c.owner_id = v_id;
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;

    RETURN pg_catalog.jsonb_build_object(
        'owner_type', v_type,
        'owner_id', v_id,
        'customer_ref', v_customer,
        'contact_email', v_email,
        'display_name', pg_catalog.left(COALESCE(v_name, ''), 120)
    );
END;
$$;

-- Record the Customer the processor created for an owner (user door, re-authorised). One per owner:
-- when two requests raced, the first recorded Customer wins and is returned.
CREATE OR REPLACE FUNCTION finance.record_processor_customer(p_scope text, p_entity_id uuid, p_customer_ref text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner jsonb;
    v_row finance.processor_customers;
BEGIN
    IF p_customer_ref IS NULL OR p_customer_ref !~ '^cus_[A-Za-z0-9]{1,250}$' THEN
        RAISE EXCEPTION 'customer: expected a Stripe customer id' USING ERRCODE = '22023';
    END IF;
    v_owner := finance.card_owner_for(p_scope, p_entity_id);
    INSERT INTO finance.processor_customers (owner_type, owner_id, provider, customer_ref)
    VALUES (v_owner ->> 'owner_type', (v_owner ->> 'owner_id')::uuid, 'stripe', p_customer_ref)
    ON CONFLICT (provider, owner_type, owner_id) DO NOTHING;
    SELECT * INTO v_row FROM finance.processor_customers
     WHERE provider = 'stripe' AND owner_type = v_owner ->> 'owner_type' AND owner_id = (v_owner ->> 'owner_id')::uuid;
    RETURN pg_catalog.to_jsonb(v_row);
END;
$$;

-- Record a card a SetupIntent confirmed (processor door): the funding instrument
-- (finance.payment_methods) and its display projection (finance.saved_cards), linked, from what the
-- processor returned — brand, last four, expiry — and never anything that could charge the card.
-- Idempotent on (owner, payment method id). The first card an owner saves becomes their default.
--
-- A card saved to a TEAM, BUSINESS or ORGANISATION is recorded as that entity's business card
-- (Decision #153). It can only get here through finance.card_owner_for, which requires the saver to
-- hold manage_billing on the entity — so it is the entity's own instrument by ownership and by who put
-- it there. Without this, `availableProviders` (an entity pays only by business card) refused every
-- card a business added at checkout, and "Add card" was a control that could never lead to paying.
-- The processor reports no reliable consumer/commercial flag to read instead; `is_business_card` stays
-- immutable after insert (00001830).
CREATE OR REPLACE FUNCTION finance.record_saved_card(
    p_owner_type text,
    p_owner_id uuid,
    p_payment_method_ref text,
    p_brand text,
    p_last4 text,
    p_exp_month integer,
    p_exp_year integer,
    p_created_by uuid,
    p_make_default boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_method finance.payment_methods;
    v_card finance.saved_cards;
    v_brand finance.card_brand;
    v_default boolean;
BEGIN
    IF p_owner_type IS NULL OR p_owner_type NOT IN ('user', 'freelancer', 'business', 'team', 'organisation')
       OR p_owner_id IS NULL THEN
        RAISE EXCEPTION 'owner: not a finance owner' USING ERRCODE = '22023';
    END IF;
    IF p_payment_method_ref IS NULL OR p_payment_method_ref !~ '^pm_[A-Za-z0-9_]{1,250}$' THEN
        RAISE EXCEPTION 'paymentMethod: expected a Stripe payment method id' USING ERRCODE = '22023';
    END IF;
    IF p_last4 IS NOT NULL AND p_last4 !~ '^[0-9]{4}$' THEN
        RAISE EXCEPTION 'last4: expected four digits' USING ERRCODE = '22023';
    END IF;
    v_brand := CASE WHEN p_brand IN ('visa', 'mastercard', 'amex', 'discover', 'unionpay')
                    THEN p_brand::finance.card_brand ELSE 'unknown'::finance.card_brand END;

    SELECT * INTO v_method FROM finance.payment_methods
     WHERE provider = 'stripe' AND external_ref = p_payment_method_ref
       AND owner_type = p_owner_type AND owner_id = p_owner_id;
    IF NOT FOUND THEN
        v_default := COALESCE(p_make_default, false) OR NOT EXISTS (
            SELECT 1 FROM finance.payment_methods m
             WHERE m.owner_type = p_owner_type AND m.owner_id = p_owner_id
               AND m.is_default_funding AND m.status = 'active'
        );
        IF v_default THEN
            UPDATE finance.payment_methods SET is_default_funding = false
             WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND is_default_funding;
        END IF;
        INSERT INTO finance.payment_methods (
            owner_type, owner_id, method_role, provider, external_ref, brand, last4, is_default_funding, status
        ) VALUES (
            p_owner_type, p_owner_id, 'funding', 'stripe', p_payment_method_ref, v_brand::text, p_last4, v_default, 'active'
        )
        RETURNING * INTO v_method;
    END IF;

    SELECT * INTO v_card FROM finance.saved_cards
     WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND stripe_payment_method_id = p_payment_method_ref;
    IF NOT FOUND THEN
        IF v_method.is_default_funding THEN
            UPDATE finance.saved_cards SET is_default = false
             WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND is_default;
        END IF;
        INSERT INTO finance.saved_cards (
            owner_type, owner_id, payment_method_id, stripe_payment_method_id, brand, last4,
            exp_month, exp_year, created_by_user_id, is_default, is_business_card
        ) VALUES (
            p_owner_type, p_owner_id, v_method.id, p_payment_method_ref, v_brand, p_last4,
            CASE WHEN p_exp_month BETWEEN 1 AND 12 THEN p_exp_month END,
            CASE WHEN p_exp_year BETWEEN 2000 AND 2100 THEN p_exp_year END,
            p_created_by, v_method.is_default_funding,
            p_owner_type IN ('team', 'business', 'organisation')
        )
        RETURNING * INTO v_card;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'method_id', v_method.id,
        'card_id', v_card.id,
        'brand', v_card.brand,
        'last4', v_card.last4,
        'exp_month', v_card.exp_month,
        'exp_year', v_card.exp_year,
        'is_default', v_card.is_default
    );
END;
$$;
-- #endregion

-- #region 4. Recurring deposits
-- Create a standing top-up (user door). The caller must be able to move money into the wallet; the
-- source must be an ACTIVE Stripe funding card belonging to the wallet's owner or to the caller
-- personally; the rule charges in the wallet's own currency. The first charge is one interval from
-- now — a rule created today is not a charge made today. `created_by` is stamped here and only here.
CREATE OR REPLACE FUNCTION finance.create_deposit_rule(
    p_wallet_id uuid,
    p_amount bigint,
    p_currency text,
    p_interval finance.deposit_interval,
    p_source_method_id uuid
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
    v_wallet finance.wallets;
    v_method finance.payment_methods;
    v_rule finance.deposit_rules;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to set up a recurring deposit' USING ERRCODE = '42501';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amountMinor: enter an amount to deposit' USING ERRCODE = '22023';
    END IF;
    IF p_interval IS NULL THEN
        RAISE EXCEPTION 'interval: choose how often' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_wallet FROM finance.wallets WHERE id = p_wallet_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'walletId: that wallet does not exist' USING ERRCODE = 'P0002';
    END IF;
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
        RAISE EXCEPTION 'currency: this wallet holds %', pg_catalog.upper(v_wallet.currency) USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_method FROM finance.payment_methods WHERE id = p_source_method_id;
    IF NOT FOUND OR v_method.status <> 'active' OR v_method.provider <> 'stripe'
       OR v_method.method_role NOT IN ('funding', 'both') THEN
        RAISE EXCEPTION 'sourceMethodId: choose a saved card to charge' USING ERRCODE = '22023';
    END IF;
    IF NOT (
        (v_method.owner_type = v_wallet.owner_type AND v_method.owner_id = v_wallet.owner_id)
        OR (v_method.owner_type IN ('user', 'freelancer') AND v_method.owner_id = v_uid)
    ) THEN
        RAISE EXCEPTION 'sourceMethodId: that card is not yours to charge' USING ERRCODE = '42501';
    END IF;

    INSERT INTO finance.deposit_rules (
        wallet_id, source_method_id, amount_cents, currency, interval, next_run_at, active, created_by
    ) VALUES (
        v_wallet.id, v_method.id, p_amount, v_currency, p_interval,
        pg_catalog.now() + CASE p_interval WHEN 'weekly' THEN interval '1 week' ELSE interval '1 month' END,
        true, v_uid
    )
    RETURNING * INTO v_rule;
    RETURN pg_catalog.to_jsonb(v_rule);
END;
$$;

-- Claim the rules that are due (processor door, run by the scheduler). For each, re-authorises the
-- rule's author AS THEM at the moment of the charge (they may have lost the right to move this
-- wallet's money since), records the run as an inbound payment made by them, and advances the rule
-- past `now()` — missed periods are SKIPPED, never charged in a burst. The attempt key is the rule and
-- the period it is for, so a scheduler that runs twice cannot charge a period twice. Returns what the
-- fat service needs to create each off-session PaymentIntent.
CREATE OR REPLACE FUNCTION finance.claim_due_deposit_rules(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r finance.deposit_rules;
    v_method finance.payment_methods;
    v_wallet finance.wallets;
    v_customer text;
    v_key text;
    v_next timestamptz;
    v_step interval;
    v_payment finance.inbound_payments;
    v_prev_sub text;
    v_allowed boolean;
    v_out jsonb := '[]'::jsonb;
BEGIN
    FOR r IN
        SELECT * FROM finance.deposit_rules d
         WHERE d.active AND d.next_run_at <= pg_catalog.now()
         ORDER BY d.next_run_at
         LIMIT GREATEST(COALESCE(p_limit, 50), 1)
           FOR UPDATE SKIP LOCKED
    LOOP
        v_step := CASE r.interval WHEN 'weekly' THEN interval '1 week' ELSE interval '1 month' END;
        v_next := r.next_run_at + v_step;
        WHILE v_next <= pg_catalog.now() LOOP
            v_next := v_next + v_step;
        END LOOP;
        v_key := 'deposit:' || r.id::text || ':' || pg_catalog.to_char(r.next_run_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');

        SELECT * INTO v_wallet FROM finance.wallets WHERE id = r.wallet_id;
        SELECT * INTO v_method FROM finance.payment_methods WHERE id = r.source_method_id;
        IF r.created_by IS NULL OR v_method.id IS NULL OR v_method.status <> 'active' THEN
            UPDATE finance.deposit_rules
               SET active = false, next_run_at = v_next,
                   last_error = 'Paused: the card or the person who set this up is no longer available.'
             WHERE id = r.id;
            CONTINUE;
        END IF;

        v_prev_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
        PERFORM pg_catalog.set_config('request.jwt.claim.sub', r.created_by::text, true);
        v_allowed := (v_wallet.owner_type IN ('user', 'freelancer') AND v_wallet.owner_id = r.created_by)
            OR finance.fn_has_vault_capability(v_wallet.id, r.created_by, 'add_funds'::finance.vault_capability);
        v_allowed := v_allowed AND (
            (v_method.owner_type = v_wallet.owner_type AND v_method.owner_id = v_wallet.owner_id)
            OR (v_method.owner_type IN ('user', 'freelancer') AND v_method.owner_id = r.created_by)
        );
        PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
        IF NOT v_allowed THEN
            UPDATE finance.deposit_rules
               SET active = false, next_run_at = v_next,
                   last_error = 'Paused: the person who set this up can no longer add funds to this wallet.'
             WHERE id = r.id;
            CONTINUE;
        END IF;

        SELECT c.customer_ref INTO v_customer FROM finance.processor_customers c
         WHERE c.provider = 'stripe' AND c.owner_type = v_method.owner_type AND c.owner_id = v_method.owner_id;
        IF v_customer IS NULL THEN
            UPDATE finance.deposit_rules
               SET active = false, next_run_at = v_next,
                   last_error = 'Paused: the saved card is not attached to a billing profile.'
             WHERE id = r.id;
            CONTINUE;
        END IF;

        INSERT INTO finance.inbound_payments (
            purpose, wallet_id, amount_cents, currency, lock_status, idempotency_key, created_by, deposit_rule_id
        ) VALUES (
            'wallet_topup', r.wallet_id, r.amount_cents, pg_catalog.upper(r.currency), 'not_applicable', v_key,
            r.created_by, r.id
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING * INTO v_payment;
        UPDATE finance.deposit_rules SET next_run_at = v_next WHERE id = r.id;
        IF v_payment.id IS NULL THEN
            CONTINUE;
        END IF;

        v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'payment', pg_catalog.to_jsonb(v_payment),
            'rule_id', r.id,
            'customer_ref', v_customer,
            'payment_method_ref', v_method.external_ref
        ));
    END LOOP;
    RETURN v_out;
END;
$$;

-- Bind a scheduled run to the PaymentIntent the processor created for it, or record that the
-- processor refused it (processor door). A refusal fails the payment and counts against the rule;
-- three consecutive failures pause it. A success clears the rule's failure count.
CREATE OR REPLACE FUNCTION finance.bind_scheduled_payment(p_payment_id uuid, p_provider_ref text, p_error text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_payment finance.inbound_payments;
BEGIN
    SELECT * INTO v_payment FROM finance.inbound_payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND OR v_payment.deposit_rule_id IS NULL THEN
        RAISE EXCEPTION 'payment: not a scheduled deposit' USING ERRCODE = 'P0002';
    END IF;
    IF p_error IS NULL THEN
        IF p_provider_ref IS NULL OR p_provider_ref !~ '^pi_[A-Za-z0-9_]{1,250}$' THEN
            RAISE EXCEPTION 'provider: expected a PaymentIntent id' USING ERRCODE = '22023';
        END IF;
        IF v_payment.provider_ref IS NOT NULL AND v_payment.provider_ref <> p_provider_ref THEN
            RAISE EXCEPTION 'provider: this run is already bound to a different PaymentIntent' USING ERRCODE = 'PX409';
        END IF;
        UPDATE finance.inbound_payments
           SET provider_ref = p_provider_ref,
               status = CASE WHEN status = 'requires_payment' THEN 'processing'::finance.inbound_payment_status ELSE status END,
               updated_at = pg_catalog.now()
         WHERE id = v_payment.id
        RETURNING * INTO v_payment;
        UPDATE finance.deposit_rules SET failure_count = 0, last_error = NULL WHERE id = v_payment.deposit_rule_id;
    ELSE
        IF v_payment.status NOT IN ('succeeded') THEN
            UPDATE finance.inbound_payments
               SET status = 'failed', failure_reason = pg_catalog.left(p_error, 400), updated_at = pg_catalog.now(),
                   provider_ref = COALESCE(provider_ref, NULLIF(p_provider_ref, ''))
             WHERE id = v_payment.id
            RETURNING * INTO v_payment;
        END IF;
        UPDATE finance.deposit_rules
           SET failure_count = failure_count + 1,
               last_error = pg_catalog.left(p_error, 400),
               active = CASE WHEN failure_count + 1 >= 3 THEN false ELSE active END
         WHERE id = v_payment.deposit_rule_id;
    END IF;
    RETURN pg_catalog.to_jsonb(v_payment);
END;
$$;
-- #endregion

-- #region 5. The Income Smoother
-- Enrol in, or leave, the Income Smoother (user door). Enrolment is an eligibility decision made
-- here, never by the client (the table has no client write policy): the caller needs at least
-- `income_smoother_min_months` distinct calendar months of earnings in that currency and at least
-- `income_smoother_min_volume_cents` earned in it. The fee is the platform's current
-- `income_smoother_fee_bp`, captured on the row at enrolment. Leaving is always allowed.
CREATE OR REPLACE FUNCTION finance.set_income_smoother(
    p_currency text,
    p_target_monthly_cents bigint,
    p_enrol boolean
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
    v_months integer;
    v_volume bigint;
    v_min_months integer;
    v_min_volume bigint;
    v_fee integer;
    v_row finance.income_smoothing;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to use the Income Smoother' USING ERRCODE = '42501';
    END IF;
    IF v_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'currency: expected a three-letter currency code' USING ERRCODE = '22023';
    END IF;

    IF NOT COALESCE(p_enrol, false) THEN
        UPDATE finance.income_smoothing SET enrolled = false
         WHERE user_id = v_uid AND currency = v_currency
        RETURNING * INTO v_row;
        RETURN COALESCE(pg_catalog.to_jsonb(v_row), pg_catalog.jsonb_build_object('enrolled', false));
    END IF;

    IF p_target_monthly_cents IS NULL OR p_target_monthly_cents <= 0 THEN
        RAISE EXCEPTION 'targetMonthlyMinor: enter the monthly figure you want' USING ERRCODE = '22023';
    END IF;

    SELECT COUNT(DISTINCT pg_catalog.date_trunc('month', t.created_at))::integer, COALESCE(SUM(t.amount_cents), 0)
      INTO v_months, v_volume
      FROM finance.transactions t
      JOIN finance.wallets w ON w.id = t.wallet_id
     WHERE w.owner_id = v_uid AND w.owner_type IN ('user', 'freelancer')
       AND pg_catalog.upper(t.currency) = v_currency
       AND t.direction = 'credit'
       AND t.reason IN ('escrow_release', 'team_split', 'team_finder_fee', 'fair_exit_release', 'product_sale');
    SELECT COALESCE((value #>> '{}')::integer, 3) INTO v_min_months FROM security.platform_params WHERE key = 'income_smoother_min_months';
    SELECT COALESCE((value #>> '{}')::bigint, 0) INTO v_min_volume FROM security.platform_params WHERE key = 'income_smoother_min_volume_cents';
    SELECT COALESCE((value #>> '{}')::integer, 50) INTO v_fee FROM security.platform_params WHERE key = 'income_smoother_fee_bp';
    v_min_months := COALESCE(v_min_months, 3);
    v_min_volume := COALESCE(v_min_volume, 0);
    v_fee := COALESCE(v_fee, 50);

    IF v_months < v_min_months OR v_volume < v_min_volume THEN
        RAISE EXCEPTION 'eligibility: the Income Smoother needs % months of earnings in % — you have %',
            v_min_months, v_currency, v_months USING ERRCODE = 'PK403';
    END IF;

    INSERT INTO finance.income_smoothing (user_id, enrolled, target_monthly_cents, currency, fee_bp, eligibility_met, enrolled_at)
    VALUES (v_uid, true, p_target_monthly_cents, v_currency, v_fee, true, pg_catalog.now())
    ON CONFLICT (user_id, currency) DO UPDATE
       SET enrolled = true,
           target_monthly_cents = EXCLUDED.target_monthly_cents,
           fee_bp = EXCLUDED.fee_bp,
           eligibility_met = true,
           enrolled_at = COALESCE(finance.income_smoothing.enrolled_at, EXCLUDED.enrolled_at)
    RETURNING * INTO v_row;
    RETURN pg_catalog.to_jsonb(v_row);
END;
$$;
-- #endregion

-- #region 6. Verification status
-- The caller's verification picture in one read (user door): their own freelancer KYC (status, tier,
-- payout readiness, the latest identity case) and the KYB state of every business they are an active
-- member of — `org.business_profiles` has no client read policy, so this is the only way the settings
-- page can show it. Reports status only: no provider reference, no document, no PII.
CREATE OR REPLACE FUNCTION finance.my_verification_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_fp org.freelancer_profiles;
    v_case finance.verification_cases;
    v_business jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to see your verification' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_fp FROM org.freelancer_profiles WHERE user_id = v_uid;
    SELECT * INTO v_case FROM finance.verification_cases c
     WHERE c.subject_type = 'freelancer' AND c.subject_id = v_uid AND c.kind = 'kyc'
     ORDER BY c.created_at DESC LIMIT 1;

    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', b.id,
               'name', b.name,
               'kyb_status', b.kyb_status,
               'kyb_verified_at', b.kyb_verified_at,
               'can_manage', finance.fn_owner_capability('business', b.id, 'manage_billing'::finance.vault_capability)
           ) ORDER BY b.name), '[]'::jsonb)
      INTO v_business
      FROM org.business_profiles b
     WHERE org.is_active_business_member(b.id);

    RETURN pg_catalog.jsonb_build_object(
        'is_freelancer', v_fp.user_id IS NOT NULL,
        'kyc_status', COALESCE(v_fp.kyc_status::text, 'unverified'),
        'kyc_tier', v_fp.kyc_tier,
        'payout_ready', COALESCE(v_fp.payout_ready, false),
        'latest_case', CASE WHEN v_case.id IS NULL THEN 'null'::jsonb ELSE pg_catalog.jsonb_build_object(
            'status', v_case.status, 'created_at', v_case.created_at, 'decided_at', v_case.decided_at) END,
        'businesses', v_business
    );
END;
$$;
-- #endregion

-- #region 7. Card checkout — the buyer's wallet
-- The wallet a card checkout tops up before the order is paid from it (user door). A card purchase is
-- charged as a top-up of the paying account's wallet, then settled from the wallet exactly as a wallet
-- purchase is — one charge path, one ledger. A person's wallet is theirs (under the person type they
-- hold); an entity's needs the same `spend` authority a basket checkout does (fn_can_manage_basket).
-- Creates the wallet in that currency when it does not exist yet, because a top-up credit onto a
-- missing wallet would vanish.
CREATE OR REPLACE FUNCTION finance.ensure_purchase_wallet(p_owner_type text, p_owner_id uuid, p_currency text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
    v_type text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to pay' USING ERRCODE = '42501';
    END IF;
    IF v_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'currency: expected a three-letter currency code' USING ERRCODE = '22023';
    END IF;
    IF p_owner_type IN ('user', 'freelancer') THEN
        IF p_owner_id IS DISTINCT FROM v_uid THEN
            RAISE EXCEPTION 'auth: you can only pay from your own wallet' USING ERRCODE = '42501';
        END IF;
        v_type := finance.fn_person_wallet_type(v_uid);
    ELSIF p_owner_type IN ('business', 'team', 'organisation') THEN
        IF NOT finance.fn_can_manage_basket(p_owner_type, p_owner_id) THEN
            RAISE EXCEPTION 'auth: only a member who can spend from this account can pay from it' USING ERRCODE = '42501';
        END IF;
        v_type := p_owner_type;
    ELSE
        RAISE EXCEPTION 'owner: not an account that can pay' USING ERRCODE = '22023';
    END IF;
    RETURN finance.fn_ensure_wallet(v_type, p_owner_id, v_currency);
END;
$$;
-- #endregion
