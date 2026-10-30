-- =============================================================================================
-- Probe: an archived business takes no money in (Decision #248 (k), ruled 2026-10-18); a draft and an
-- active business still do (#236 (f) stands — a draft's setup asks for money before Publish).
--
--   A. A draft business: a card top-up begins (one attempt is kept for B to replay), a transfer in from
--      a member's own wallet lands, a recurring deposit is set up and its due run is charged, the
--      developer simulator credits it, and a settled card top-up is credited. An active business
--      (heliafinance): a card top-up begins.
--   B. The same business archived: every money-in door refuses 55000 with org.fn_assert_business_active's
--      archived wording (`business_not_active: this business is archived — restore it first`) —
--      finance.begin_card_payment (wallet_topup, and a replay of the attempt begun while it was a draft),
--      finance.transfer_funds (a contribution landing in it), finance.create_deposit_rule,
--      finance.simulate_wallet_transaction — a due recurring run is paused and charged nothing
--      (finance.fn_deposit_charge_target, finance.claim_due_deposit_rules), and a card already captured
--      for it is NOT credited by finance.settle_card_payment: the settlement is acknowledged into
--      reconciliation (`business_archived`, the claim kept, one ops error row, the payment left in its
--      unsettled status — `requires_payment` for a browser top-up), a redelivery replays it, and
--      finance.v_ops_unledgered_payments lists it for a human — a success after a declined (`failed`)
--      attempt too. Money out stays refused by the spend gate (BB5, unchanged).
--   C. Restored to draft, it takes money in again, and the kept attempt replays again.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/business_archived_topup.sql
--
-- The prelude re-creates the changed definitions from the migration text, inside the transaction, when
-- the database predates them (no org.fn_assert_business_not_archived yet) — the shared local DB is not
-- reset for every change. On a database reset past this change it is skipped and the live definitions
-- are what the checks test. Keep it in step with the migrations it copies, or delete it once every
-- database in use has been reset.
--
-- Fixture (seeded): theo creates a business here (a draft with its own wallet); heliafinance (owner
-- priyaraman) is the active business. A failing check prints `FAIL …` and the run ends in an error.
-- =============================================================================================

BEGIN;

-- #region Prelude — the on-disk definitions, applied only to a database that predates them
SELECT pg_catalog.to_regprocedure('org.fn_assert_business_not_archived(uuid)') IS NULL AS probe_needs_prelude \gset
\if :probe_needs_prelude

-- org.fn_assert_business_not_archived — 00001020_functions_org_entities.sql
CREATE OR REPLACE FUNCTION org.fn_assert_business_not_archived(p_business uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_business IS NULL THEN
        RETURN;
    END IF;
    SELECT b.status INTO v_status FROM org.business_profiles b WHERE b.id = p_business FOR SHARE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'workspace: not found';
    END IF;
    IF v_status = 'archived' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'business_not_active: this business is archived — restore it first',
            DETAIL = pg_catalog.jsonb_build_object('business_id', p_business, 'status', v_status)::text;
    END IF;
END;
$$;

-- finance.begin_card_payment — 00001230_functions_finance_stripe.sql
CREATE OR REPLACE FUNCTION finance.begin_card_payment(
    p_purpose text,
    p_wallet_id uuid,
    p_project_id uuid,
    p_stage_id uuid,
    p_expected_amount bigint,
    p_currency text,
    p_idempotency_key text,
    p_ticket_id uuid DEFAULT NULL,
    p_revision_id uuid DEFAULT NULL
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
    v_ticket record;
    v_round record;
    v_payment finance.inbound_payments;
    v_need jsonb;
    v_unpriced int;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to pay' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
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
    -- concat_ws skips NULLs, so a stage or top-up attempt hashes exactly as it did before p_ticket_id
    -- and p_revision_id.
    v_hash := pg_catalog.md5(pg_catalog.concat_ws('|',
        p_purpose, p_wallet_id, p_project_id, p_stage_id, p_expected_amount, v_currency, p_ticket_id,
        p_revision_id));

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
        -- A replay hands back an attempt a card can still pay (`requires_payment`, or `failed`, which a
        -- retry may still pay); into the wallet of a business archived since it began, it is refused
        -- as a new attempt is (Decision #248 (k)), so the replay charges nobody.
        IF v_existing.status IN ('requires_payment', 'failed') THEN
            SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_existing.wallet_id;
            IF v_wallet.owner_type = 'business' THEN
                PERFORM org.fn_assert_business_not_archived(v_wallet.owner_id);
            END IF;
        END IF;
        RETURN pg_catalog.to_jsonb(v_existing) || pg_catalog.jsonb_build_object('replayed', true);
    END IF;

    IF p_purpose = 'wallet_topup' THEN
        IF p_wallet_id IS NULL THEN
            RAISE EXCEPTION 'walletId: choose the wallet to top up' USING ERRCODE = '22023';
        END IF;
        IF p_project_id IS NOT NULL OR p_stage_id IS NOT NULL OR p_ticket_id IS NOT NULL
           OR p_revision_id IS NOT NULL THEN
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
                v_wallet.owner_type IN ('team', 'business', 'enterprise')
                AND finance.fn_has_vault_capability(v_wallet.id, v_uid, 'add_funds'::finance.vault_capability)
            )
        ) THEN
            RAISE EXCEPTION 'auth: you can''t add funds to this wallet' USING ERRCODE = '42501';
        END IF;
        -- Nobody is charged for money an archived business could not take in (Decision #248 (k)); a
        -- draft is funded before it publishes (#236 (f)). Settlement checks again.
        IF v_wallet.owner_type = 'business' THEN
            PERFORM org.fn_assert_business_not_archived(v_wallet.owner_id);
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
        -- A business client pays from its wallet; a project with no client business is paid for by its
        -- OWNER as an individual client (PRODUCT_SPEC §Escrow, Wallets & Finance #5 — "zero friction,
        -- no ID verification"), and only that owner may fund it. The funder predicate fund_stage,
        -- fund_ticket and fund_paid_revision ask too (BB2), so nobody is charged for a lock they refuse.
        IF NOT projects.fn_can_fund_project(p_project_id) THEN
            RAISE EXCEPTION 'not_funder: only a member who can spend from the client''s wallet can fund this stage'
                USING ERRCODE = 'PK403';
        END IF;
        SELECT p.client_business_id, p.owner_user_id, p.currency INTO v_payer, v_owner, v_project_currency
          FROM projects.projects p WHERE p.id = p_project_id;
        IF p_revision_id IS NOT NULL THEN
            -- ONE paid revision round (Decision #199): projects.fund_paid_revision's gates, evaluated now
            -- so nobody is charged for a round that could not open — and again at settlement.
            IF p_ticket_id IS NOT NULL THEN
                RAISE EXCEPTION 'ticketId: a revision is paid for on its own, not with a ticket'
                    USING ERRCODE = '22023';
            END IF;
            SELECT rv.status, rv.request_type, rv.price_cents, rv.ticket_id,
                   ps.extra_revision_price_cents AS stage_price, ss.status AS submission_status,
                   tk.current_assignee_id AS assignee,
                   EXISTS (
                       SELECT 1 FROM projects.stage_assignments sa
                        WHERE sa.project_stage_id = ps.id AND sa.assignee_type = 'team'
                          AND sa.status = 'accepted' AND sa.team_id IS NOT NULL
                   ) AS team_seated
              INTO v_round
              FROM projects.stage_revision_requests rv
              JOIN projects.project_stages ps ON ps.id = rv.project_stage_id
              JOIN projects.tickets tk ON tk.id = rv.ticket_id
              LEFT JOIN projects.stage_submissions ss ON ss.id = rv.submission_id
             WHERE rv.id = p_revision_id AND ps.id = p_stage_id AND ps.project_id = p_project_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'revisionId: that revision is not in this stage' USING ERRCODE = 'P0002';
            END IF;
            IF v_round.status <> 'awaiting_payment' THEN
                RAISE EXCEPTION 'revisionId: this revision is already paid for or was withdrawn' USING ERRCODE = 'PC409';
            END IF;
            IF v_round.submission_status IS DISTINCT FROM 'pending_review' THEN
                RAISE EXCEPTION 'revisionId: the submission this revision was for has already been decided'
                    USING ERRCODE = 'PC409';
            END IF;
            IF v_round.request_type <> 'paid_revision' OR v_round.price_cents IS DISTINCT FROM v_round.stage_price THEN
                RAISE EXCEPTION 'revisionId: this revision''s price no longer matches the stage''s terms — raise it again'
                    USING ERRCODE = 'PC409';
            END IF;
            IF v_round.assignee IS NULL AND NOT v_round.team_seated THEN
                RAISE EXCEPTION 'revisionId: this ticket has nobody to pay for the revision' USING ERRCODE = 'PC409';
            END IF;
            v_amount := COALESCE(v_round.price_cents, 0);
            IF v_amount <= 0 THEN
                RAISE EXCEPTION 'revisionId: this revision isn''t priced' USING ERRCODE = 'PC409';
            END IF;
            IF pg_catalog.upper(COALESCE(v_project_currency, 'USD')) <> v_currency THEN
                RAISE EXCEPTION 'currency: this project is priced in %', pg_catalog.upper(COALESCE(v_project_currency, 'USD'))
                    USING ERRCODE = '22023';
            END IF;
            IF p_expected_amount IS DISTINCT FROM v_amount THEN
                RAISE EXCEPTION 'expectedAmountMinor: the amount to fund changed — it is now % minor units of %',
                    v_amount, v_currency USING ERRCODE = 'PC409';
            END IF;
        ELSIF p_ticket_id IS NOT NULL THEN
            -- ONE ticket (Decision #166): projects.fund_ticket's gates, evaluated now so nobody is charged
            -- for a hold that could not be made — and again at settlement. Its own price, else its stage's.
            SELECT tk.text_description, tk.payment_status::text AS payment_status,
                   tk.current_assignee_id AS assignee, ps.status::text AS stage_status,
                   COALESCE(tk.unit_price_cents, ps.unit_price_cents) AS amount
              INTO v_ticket
              FROM projects.tickets tk
              JOIN projects.project_stages ps ON ps.id = tk.current_stage_id
             WHERE tk.id = p_ticket_id AND tk.project_id = p_project_id AND tk.current_stage_id = p_stage_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'ticketId: that ticket is not in this stage' USING ERRCODE = 'P0002';
            END IF;
            IF pg_catalog.btrim(v_ticket.text_description) = '' THEN
                RAISE EXCEPTION 'ticketId: add a description before this ticket can be bought' USING ERRCODE = 'PC409';
            END IF;
            IF v_ticket.payment_status NOT IN ('unpaid', 'needs_funding') OR EXISTS (
                SELECT 1 FROM finance.escrows e WHERE e.ticket_id = p_ticket_id AND e.status = 'held'
            ) THEN
                RAISE EXCEPTION 'ticketId: this ticket is already paid for' USING ERRCODE = 'PC409';
            END IF;
            IF v_ticket.stage_status IN ('approved', 'paid', 'cancelled') THEN
                RAISE EXCEPTION 'stageId: that stage has finished' USING ERRCODE = 'PC409';
            END IF;
            v_amount := COALESCE(v_ticket.amount, 0);
            IF v_amount <= 0 THEN
                RAISE EXCEPTION 'ticketId: this ticket has no price yet' USING ERRCODE = 'PC409';
            END IF;
            IF pg_catalog.upper(COALESCE(v_project_currency, 'USD')) <> v_currency THEN
                RAISE EXCEPTION 'currency: this project is priced in %', pg_catalog.upper(COALESCE(v_project_currency, 'USD'))
                    USING ERRCODE = '22023';
            END IF;
            IF p_expected_amount IS DISTINCT FROM v_amount THEN
                RAISE EXCEPTION 'expectedAmountMinor: the amount to fund changed — it is now % minor units of %',
                    v_amount, v_currency USING ERRCODE = 'PC409';
            END IF;
        ELSE
        -- The whole stage, unchanged.
        SELECT ps.status INTO v_stage_status
          FROM projects.project_stages ps
         WHERE ps.id = p_stage_id AND ps.project_id = p_project_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'stageId: stage not found for this project' USING ERRCODE = 'P0002';
        END IF;
        IF v_stage_status NOT IN ('open'::public.stage_status, 'assigned'::public.stage_status,
                                  'in_progress'::public.stage_status) THEN
            RAISE EXCEPTION 'stageId: only an open, assigned or in-progress stage can be funded (this one is %)',
                v_stage_status USING ERRCODE = 'PC409';
        END IF;
        IF pg_catalog.upper(COALESCE(v_project_currency, 'USD')) <> v_currency THEN
            RAISE EXCEPTION 'currency: this project is priced in %', pg_catalog.upper(COALESCE(v_project_currency, 'USD'))
                USING ERRCODE = '22023';
        END IF;
        -- Exactly what projects.fund_stage will hold — the one definition both read (Decision #197). A
        -- ticket without a price is refused HERE, before anything is charged: fund_stage refuses the same
        -- stage, and a payment it refused at settlement would only land in the wallet.
        v_need := projects.fn_stage_funding_need(p_stage_id);
        v_unpriced := (v_need ->> 'unpriced_count')::int;
        IF v_unpriced > 0 THEN
            RAISE EXCEPTION 'stageId: % — price % before funding the stage',
                CASE WHEN v_unpriced = 1 THEN 'a ticket in this stage has no price yet'
                     ELSE v_unpriced || ' tickets in this stage have no price yet' END,
                CASE WHEN v_unpriced = 1 THEN 'it' ELSE 'them' END
                USING ERRCODE = 'PC409';
        END IF;
        v_amount := (v_need ->> 'amount_cents')::bigint;
        IF v_amount <= 0 THEN
            RAISE EXCEPTION 'stageId: nothing in this stage is waiting for funding' USING ERRCODE = 'PC409';
        END IF;
        IF p_expected_amount IS DISTINCT FROM v_amount THEN
            RAISE EXCEPTION 'expectedAmountMinor: the amount to fund changed — it is now % minor units of %',
                v_amount, v_currency USING ERRCODE = 'PC409';
        END IF;
        END IF;
        -- The wallet the hold will debit: the paying business's — or the individual owner's own person
        -- wallet (finance.fn_escrow_payer_wallet_type, the type fn_hold_ticket_escrow debits) — in the
        -- project's currency. Created here if it does not exist yet: settlement credits it, and
        -- fn_wallet_credit refuses a wallet that does not exist (PW404).
        v_wallet_id := finance.fn_ensure_wallet(
            finance.fn_escrow_payer_wallet_type(v_payer, CASE WHEN v_payer IS NULL THEN v_owner END),
            COALESCE(v_payer, v_owner),
            COALESCE(v_project_currency, 'USD')
        );
        -- The business spend gate as a CHECK (BB3): nobody is charged for a lock KYB or the threshold
        -- would refuse. Nothing is counted or consumed here — the settlement's fund_stage / fund_ticket /
        -- fund_paid_revision run the real gate as the payer, and re-check all of it.
        IF v_payer IS NOT NULL THEN
            PERFORM finance.fn_assert_business_spend(
                v_wallet_id, v_uid, v_amount,
                CASE WHEN p_revision_id IS NOT NULL THEN 'revisions'
                     WHEN p_ticket_id IS NOT NULL THEN 'tickets'
                     ELSE 'project_stages' END,
                COALESCE(p_revision_id, p_ticket_id, p_stage_id),
                false
            );
        END IF;
    END IF;

    INSERT INTO finance.inbound_payments (
        purpose, wallet_id, project_stage_id, ticket_id, revision_id, amount_cents, currency, lock_status,
        idempotency_key, created_by
    ) VALUES (
        p_purpose,
        v_wallet_id,
        CASE WHEN p_purpose = 'escrow_lock' THEN p_stage_id END,
        p_ticket_id,
        p_revision_id,
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

-- finance.settle_card_payment — 00001230_functions_finance_stripe.sql
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
    v_order jsonb;
    v_order_id uuid;
    v_order_error text;
    v_unapplied text;
    v_reconciliation text;
    v_business_status text;
BEGIN
    IF NOT finance.fn_claim_stripe_event(p_event_id, 'payment_intent.succeeded') THEN
        -- A completed claim. It is answered with the ledger row it produced; one without (an earlier
        -- build acknowledged unmatched settlements) is released and processed now — the payment row's
        -- status below, not the claim, is what stops a second credit.
        SELECT p.transaction_id INTO v_tx
          FROM finance.inbound_payments p
         WHERE p.provider = 'stripe' AND p.provider_ref = p_provider_ref;
        IF v_tx IS NOT NULL THEN
            RETURN finance.fn_stripe_event_replay(p_event_id)
                || pg_catalog.jsonb_build_object('transaction_id', v_tx);
        END IF;
        -- A mismatch (or an archived business's payment) already handed to reconciliation stays there:
        -- replayed and acknowledged, never re-processed (which would log it again on every delivery and
        -- change nothing).
        SELECT k.response ->> 'reconciliation' INTO v_reconciliation
          FROM finance.idempotency_keys k
         WHERE k.key = 'stripe:' || p_event_id
           AND k.status = 'succeeded'
           AND k.response ->> 'reconciliation' IN ('settlement_mismatch', 'business_archived');
        IF v_reconciliation IS NOT NULL THEN
            RETURN finance.fn_stripe_event_replay(p_event_id)
                || pg_catalog.jsonb_build_object('reconciliation', v_reconciliation, 'transaction_id', NULL);
        END IF;
        PERFORM finance.fn_release_stripe_event(p_event_id);
        IF NOT finance.fn_claim_stripe_event(p_event_id, 'payment_intent.succeeded') THEN
            RAISE EXCEPTION 'event: % could not be re-claimed', p_event_id USING ERRCODE = '40001';
        END IF;
    END IF;

    SELECT * INTO v_payment
      FROM finance.inbound_payments
     WHERE provider = 'stripe' AND provider_ref = p_provider_ref
       FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM finance.fn_release_stripe_event(p_event_id);
        RETURN pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'no inbound payment is bound to this PaymentIntent yet',
            'transaction_id', NULL);
    END IF;
    IF v_payment.status IN ('succeeded', 'settled_unapplied') THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'replayed', 'detail', 'this payment was already settled', 'payment_id', v_payment.id,
            'status', v_payment.status, 'transaction_id', v_payment.transaction_id));
    END IF;
    -- A settlement in another currency, or of nothing, is a reconciliation case, not a credit: the
    -- ledger records money in the currency it arrived in, and this row does not describe that money.
    -- It is deterministic — every redelivery carries the same figures — so retrying it only repeats
    -- the miss for Stripe's whole retry window. The claim is COMPLETED (redeliveries replay it), one
    -- ops row is written for a human (keyed on the event, so nothing writes it twice), and the payment
    -- is left unsettled for finance.v_ops_unledgered_payments to list (`settlement_mismatch`).
    IF v_currency <> v_payment.currency OR p_amount_received IS NULL OR p_amount_received <= 0 THEN
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        SELECT
            'stripe:' || p_event_id,
            'error',
            pg_catalog.format('Card payment %s settled as %s %s but was started as %s %s; nothing was credited — reconcile it by hand',
                v_payment.id, COALESCE(p_amount_received::text, 'nothing'), v_currency,
                v_payment.amount_cents, v_payment.currency),
            pg_catalog.now(),
            'server',
            'finance.settle_card_payment',
            pg_catalog.jsonb_build_object(
                'event_id', p_event_id,
                'payment_id', v_payment.id,
                'provider_ref', p_provider_ref,
                'amount_received_cents', p_amount_received,
                'currency_received', v_currency,
                'amount_cents', v_payment.amount_cents,
                'currency', v_payment.currency,
                'reconciliation', 'settlement_mismatch'
            )
        WHERE NOT EXISTS (
            SELECT 1 FROM ops.log_entries l
             WHERE l.scope = 'finance.settle_card_payment' AND l.client_id = 'stripe:' || p_event_id
        );
        RAISE WARNING 'finance.settle_card_payment: payment % does not match event % — acknowledged for reconciliation', v_payment.id, p_event_id;
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'settled amount or currency does not match the payment; held for reconciliation',
            'reconciliation', 'settlement_mismatch',
            'payment_id', v_payment.id, 'transaction_id', NULL,
            'amount_received_cents', p_amount_received, 'currency_received', v_currency));
    END IF;

    SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_payment.wallet_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet: payment % names no wallet to credit', v_payment.id USING ERRCODE = 'PW404';
    END IF;
    IF finance.fn_ensure_wallet(v_wallet.owner_type, v_wallet.owner_id, v_payment.currency) IS DISTINCT FROM v_wallet.id THEN
        RAISE EXCEPTION 'wallet: payment % is in % but its wallet is not', v_payment.id, v_payment.currency
            USING ERRCODE = 'PW404';
    END IF;
    -- An archived business takes no money in (Decision #248 (k)): a reconciliation case, as a mismatch
    -- is — nothing credited, the claim completed, one ops row for a human, the payment left unsettled.
    IF v_wallet.owner_type = 'business' THEN
        SELECT b.status INTO v_business_status
          FROM org.business_profiles b WHERE b.id = v_wallet.owner_id FOR SHARE;
    END IF;
    IF v_business_status = 'archived' THEN
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        SELECT
            'stripe:' || p_event_id,
            'error',
            pg_catalog.format('Card payment %s settled %s %s for business %s, which is archived; nothing was credited — refund it, or settle it by hand once the business is restored',
                v_payment.id, p_amount_received, v_currency, v_wallet.owner_id),
            pg_catalog.now(),
            'server',
            'finance.settle_card_payment',
            pg_catalog.jsonb_build_object(
                'event_id', p_event_id,
                'payment_id', v_payment.id,
                'provider_ref', p_provider_ref,
                'purpose', v_payment.purpose,
                'wallet_id', v_wallet.id,
                'business_id', v_wallet.owner_id,
                'amount_received_cents', p_amount_received,
                'currency_received', v_currency,
                'reconciliation', 'business_archived'
            )
        WHERE NOT EXISTS (
            SELECT 1 FROM ops.log_entries l
             WHERE l.scope = 'finance.settle_card_payment' AND l.client_id = 'stripe:' || p_event_id
        );
        RAISE WARNING 'finance.settle_card_payment: payment % is for archived business % — acknowledged for reconciliation', v_payment.id, v_wallet.owner_id;
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'the business this payment is for is archived; held for reconciliation',
            'reconciliation', 'business_archived',
            'payment_id', v_payment.id, 'transaction_id', NULL,
            'amount_received_cents', p_amount_received, 'currency_received', v_currency));
    END IF;
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
    IF v_tx IS NULL THEN
        RAISE EXCEPTION 'ledger: the credit for payment % left no ledger row', v_payment.id USING ERRCODE = 'PL404';
    END IF;
    -- A card top-up of a shared wallet is a contribution, recorded exactly as finance.transfer_funds
    -- records one (`add_funds`, the payer as the actor, what actually arrived) and in the same
    -- transaction as the credit — so the contribution ledger never misses card money (BUSINESSES_AUDIT
    -- BF25). An escrow lock's credit is not a contribution: it is held for the stage at once.
    IF v_payment.purpose = 'wallet_topup' AND v_wallet.owner_type IN ('team', 'business', 'enterprise') THEN
        INSERT INTO finance.ledger_audit (wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata)
        VALUES (v_wallet.id, v_payment.created_by, 'add_funds', p_amount_received, v_wallet.currency,
                'inbound_payments', v_payment.id, pg_catalog.jsonb_build_object('kind', 'card_topup'));
    END IF;

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
                IF v_payment.revision_id IS NOT NULL THEN
                    -- One paid revision round (Decision #199): its escrow is held and the round opens.
                    v_escrows := ARRAY[(projects.fund_paid_revision(v_payment.revision_id) ->> 'escrow_id')::uuid];
                ELSIF v_payment.ticket_id IS NOT NULL THEN
                    -- One ticket (Decision #166): only its escrow is held; the stage's status is untouched.
                    v_escrows := ARRAY[(projects.fund_ticket(v_project, v_payment.ticket_id) ->> 'escrow_id')::uuid];
                ELSE
                    PERFORM projects.fund_stage(v_project, v_payment.project_stage_id);
                    -- now() is the transaction's start instant, so equality picks out exactly the escrows
                    -- this settlement created — the ones a chargeback against this payment must freeze.
                    SELECT COALESCE(pg_catalog.array_agg(e.id ORDER BY e.id), '{}') INTO v_escrows
                      FROM finance.escrows e
                     WHERE e.project_stage_id = v_payment.project_stage_id
                       AND e.status = 'held'
                       AND e.created_at = pg_catalog.now();
                END IF;
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

    -- A top-up that pays for a checkout (Decision #153) places that order now, AS THE PAYER, under the
    -- order key the browser would use — the same claim swap and subtransaction as the escrow lock above.
    -- If the browser placed it first (or places it later), place_wallet_order replays on the key and no
    -- second order exists. A refusal (a price that moved, a line no longer for sale, a spending limit)
    -- rolls back only the order: the money stays in the wallet, the reason is recorded, and the
    -- browser's own attempt re-asks under the same key and shows it.
    IF v_payment.purpose = 'wallet_topup' AND v_payment.checkout IS NOT NULL THEN
        v_prev_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
        BEGIN
            PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_payment.created_by::text, true);
            v_order := finance.place_wallet_order(
                (v_payment.checkout ->> 'basket_id')::uuid,
                ARRAY(SELECT pg_catalog.jsonb_array_elements_text(v_payment.checkout -> 'item_ids')::uuid),
                v_payment.checkout ->> 'currency',
                v_payment.checkout -> 'units',
                v_payment.checkout ->> 'promo_code',
                v_payment.checkout ->> 'order_key',
                v_payment.amount_cents
            );
            v_order_id := (v_order ->> 'order_id')::uuid;
            IF v_order_id IS NULL THEN
                v_order_error := 'The order could not be confirmed.';
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_order_error := pg_catalog.left(SQLERRM, 400);
        END;
        PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
        UPDATE finance.inbound_payments
           SET order_id = v_order_id,
               order_error = v_order_error,
               updated_at = pg_catalog.now()
         WHERE id = v_payment.id
        RETURNING * INTO v_payment;
    END IF;

    v_unapplied := CASE
        WHEN v_lock_status = 'failed' THEN 'The escrow could not be held: ' || COALESCE(v_lock_error, 'unknown reason')
        WHEN v_order_error IS NOT NULL THEN 'The order could not be placed: ' || v_order_error
    END;
    IF v_unapplied IS NOT NULL THEN
        UPDATE finance.inbound_payments
           SET status = 'settled_unapplied',
               unapplied_reason = pg_catalog.left(v_unapplied, 400),
               updated_at = pg_catalog.now()
         WHERE id = v_payment.id
        RETURNING * INTO v_payment;
    END IF;

    PERFORM comms.fn_notify(
        v_payment.created_by,
        CASE WHEN v_lock_status = 'locked' THEN 'escrow.funded' ELSE 'wallet.topup_succeeded' END,
        CASE
            WHEN v_lock_status = 'locked' THEN 'Stage funded'
            WHEN v_unapplied IS NOT NULL THEN 'Payment received — the funds are in your wallet'
            WHEN v_order_id IS NOT NULL THEN 'Payment received — order placed'
            ELSE 'Top-up received'
        END,
        CASE
            WHEN v_lock_status = 'locked' THEN 'Your card payment arrived and the stage''s escrow is secured.'
            WHEN v_lock_status = 'failed' THEN 'Your card payment arrived and the funds are in your wallet, but the escrow could not be held: ' || COALESCE(v_lock_error, 'unknown reason')
            WHEN v_order_error IS NOT NULL THEN 'Your payment arrived and the funds are in your wallet, but the order could not be placed: ' || v_order_error
            WHEN v_order_id IS NOT NULL THEN 'Your payment arrived and your order has been placed.'
            ELSE 'Your card payment has been added to your wallet.'
        END,
        'inbound_payments',
        v_payment.id,
        pg_catalog.jsonb_build_object('amount_cents', p_amount_received, 'currency', v_payment.currency,
            'status', v_payment.status)
    );

    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied',
        'payment_id', v_payment.id,
        'transaction_id', v_tx,
        'status', v_payment.status,
        'unapplied_reason', v_payment.unapplied_reason,
        'lock_status', v_payment.lock_status,
        'locked_escrow_ids', pg_catalog.to_jsonb(v_payment.locked_escrow_ids),
        'order_id', v_payment.order_id,
        'order_error', v_payment.order_error
    ));
END;
$$;

-- finance.transfer_funds — 00001210_functions_finance_kyc_wallet.sql
CREATE OR REPLACE FUNCTION finance.transfer_funds(
    p_from_wallet uuid,
    p_to_wallet uuid,
    p_amount bigint,
    p_note text,
    p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_scope text;
    v_hash text;
    v_prior finance.idempotency_keys;
    v_from finance.wallets;
    v_to finance.wallets;
    v_note text := NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '');
    v_result jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to move money' USING ERRCODE = '42501';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Enter an amount to transfer' USING ERRCODE = '22023';
    END IF;
    IF p_from_wallet IS NULL OR p_to_wallet IS NULL OR p_from_wallet = p_to_wallet THEN
        RAISE EXCEPTION 'Choose a different wallet to transfer to' USING ERRCODE = '22023';
    END IF;
    IF p_idempotency_key IS NULL OR pg_catalog.length(p_idempotency_key) < 8
       OR pg_catalog.length(p_idempotency_key) > 120 THEN
        RAISE EXCEPTION 'A transfer needs an attempt key between 8 and 120 characters' USING ERRCODE = '22023';
    END IF;

    v_scope := 'transfer:' || v_uid::text;
    v_hash := pg_catalog.md5(pg_catalog.concat_ws('|', p_from_wallet, p_to_wallet, p_amount));
    SELECT * INTO v_prior FROM finance.idempotency_keys WHERE key = p_idempotency_key;
    IF FOUND THEN
        IF v_prior.scope <> v_scope OR v_prior.request_hash <> v_hash THEN
            RAISE EXCEPTION 'That attempt key was used for a different request' USING ERRCODE = '22023';
        END IF;
        RETURN v_prior.response || pg_catalog.jsonb_build_object('replayed', true);
    END IF;

    -- Both rows locked in id order, so two transfers crossing each other cannot deadlock.
    PERFORM 1 FROM finance.wallets WHERE id IN (p_from_wallet, p_to_wallet) ORDER BY id FOR UPDATE;
    SELECT * INTO v_from FROM finance.wallets WHERE id = p_from_wallet;
    SELECT * INTO v_to FROM finance.wallets WHERE id = p_to_wallet;
    IF v_from.id IS NULL OR v_to.id IS NULL THEN
        RAISE EXCEPTION 'That wallet no longer exists' USING ERRCODE = 'PB404';
    END IF;

    IF NOT (
        (v_from.owner_type IN ('user', 'freelancer') AND v_from.owner_id = v_uid)
        OR (v_from.owner_type IN ('team', 'business', 'enterprise')
            AND finance.fn_has_vault_capability (v_from.id, v_uid, 'withdraw'::finance.vault_capability))
    ) THEN
        RAISE EXCEPTION 'You can''t move money out of that wallet' USING ERRCODE = '42501';
    END IF;
    IF NOT (
        (v_to.owner_type IN ('user', 'freelancer') AND v_to.owner_id = v_uid)
        OR (v_to.owner_type IN ('team', 'business', 'enterprise')
            AND finance.fn_owner_visible (v_to.owner_type, v_to.owner_id))
    ) THEN
        RAISE EXCEPTION 'You can only transfer between your own wallets' USING ERRCODE = '42501';
    END IF;
    -- Money landing in a business wallet is a contribution: a draft takes it, an archived business
    -- takes nothing in (Decision #248 (k)).
    IF v_to.owner_type = 'business' THEN
        PERFORM org.fn_assert_business_not_archived (v_to.owner_id);
    END IF;
    IF v_from.currency <> v_to.currency THEN
        RAISE EXCEPTION 'Both wallets must hold % — a transfer is not a currency conversion', v_from.currency
            USING ERRCODE = 'PX409';
    END IF;
    -- Money leaving a pooled business wallet passes the spend gate (BB3): KYB (finance-model.md §KYC/KYB
    -- Gating), the mover's envelope and the threshold, an approval bound to the destination wallet. A
    -- team or enterprise vault keeps its envelope only.
    IF v_from.owner_type = 'business' THEN
        PERFORM finance.fn_assert_business_spend (v_from.id, v_uid, p_amount, 'transfers', v_to.id);
    ELSIF v_from.owner_type IN ('team', 'enterprise')
       AND NOT finance.fn_check_spending_limit (v_from.id, v_uid, p_amount) THEN
        RAISE EXCEPTION 'That is over your spending limit on this account' USING ERRCODE = 'PA403';
    END IF;
    IF v_from.balance_cents < p_amount THEN
        RAISE EXCEPTION 'That wallet doesn''t hold enough for this transfer' USING ERRCODE = 'PF402';
    END IF;

    -- Each side's ledger line points at the OTHER wallet, so either reader can say where it went.
    PERFORM finance.fn_wallet_debit (v_from.owner_id, v_from.owner_type, v_from.currency, p_amount,
        'transfer_out', 'wallets', v_to.id);
    PERFORM finance.fn_wallet_credit (v_to.owner_id, v_to.owner_type, v_to.currency, p_amount,
        'transfer_in', 'wallets', v_from.id);

    IF v_from.owner_type IN ('team', 'business', 'enterprise') THEN
        INSERT INTO finance.ledger_audit (wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata)
        VALUES (v_from.id, v_uid, 'withdraw', p_amount, v_from.currency, 'wallets', v_to.id,
                pg_catalog.jsonb_build_object('kind', 'transfer_out', 'note', v_note));
    END IF;
    IF v_to.owner_type IN ('team', 'business', 'enterprise') THEN
        INSERT INTO finance.ledger_audit (wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata)
        VALUES (v_to.id, v_uid, 'add_funds', p_amount, v_to.currency, 'wallets', v_from.id,
                pg_catalog.jsonb_build_object('kind', 'transfer_in', 'note', v_note));
    END IF;

    v_result := pg_catalog.jsonb_build_object(
        'amount_minor', p_amount, 'currency', v_from.currency,
        'from_wallet', v_from.id, 'to_wallet', v_to.id, 'replayed', false
    );
    INSERT INTO finance.idempotency_keys (key, scope, request_hash, status, response, expires_at)
    VALUES (p_idempotency_key, v_scope, v_hash, 'succeeded', v_result, pg_catalog.now() + interval '7 days');
    RETURN v_result;
END;
$$;

-- finance.simulate_wallet_transaction — 00001210_functions_finance_kyc_wallet.sql
CREATE OR REPLACE FUNCTION finance.simulate_wallet_transaction(
    p_from_wallet_id uuid,
    p_to_wallet_id uuid,
    p_amount_minor bigint,
    p_currency text,
    p_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_enabled boolean;
    v_caller uuid;
    v_needs_source boolean;
    v_needs_dest boolean;
    v_action finance.vault_action;
    v_reason text;
    v_from record;
    v_to record;
    v_from_after bigint;
    v_to_after bigint;
    v_from_tx uuid;
    v_to_tx uuid;
    v_from_json jsonb := NULL;
    v_to_json jsonb := NULL;
BEGIN
    -- Gate 1: the kill switch.
    SELECT (p.value #>> '{}')::boolean INTO v_enabled
    FROM security.platform_params p
    WHERE p.key = 'finance_simulation_enabled';

    -- FAIL CLOSED: an absent param, a malformed param and an explicit false all mean "refuse".
    IF COALESCE(v_enabled, false) IS NOT TRUE THEN
        RAISE EXCEPTION
            'Wallet simulation is disabled (security.platform_params.finance_simulation_enabled).'
            USING ERRCODE = '42501';
    END IF;

    -- Gate 2: an authenticated caller with an owner identity to check.
    v_caller := auth.uid();
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Wallet simulation requires an authenticated caller.'
            USING ERRCODE = '42501';
    END IF;

    IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
        RAISE EXCEPTION 'Simulated amount must be a positive minor-unit value.'
            USING ERRCODE = '22023';
    END IF;

    IF p_currency IS NULL OR pg_catalog.length(p_currency) <> 3 THEN
        RAISE EXCEPTION 'Simulated currency must be a 3-letter ISO-4217 code.'
            USING ERRCODE = '22023';
    END IF;

    -- The direction matrix. Which side of a movement a type touches is not a caller decision.
    CASE p_type
        WHEN 'escrow_lock' THEN
            v_needs_source := true;  v_needs_dest := false; v_action := 'spend';
        WHEN 'escrow_release' THEN
            v_needs_source := false; v_needs_dest := true;  v_action := 'add_funds';
        WHEN 'platform_fee' THEN
            v_needs_source := true;  v_needs_dest := false; v_action := 'spend';
        WHEN 'split_payout' THEN
            v_needs_source := true;  v_needs_dest := true;  v_action := 'distribute';
        WHEN 'top_up' THEN
            v_needs_source := false; v_needs_dest := true;  v_action := 'add_funds';
        WHEN 'refund' THEN
            v_needs_source := false; v_needs_dest := true;  v_action := 'add_funds';
        ELSE
            RAISE EXCEPTION
                'Unknown simulation type %. Expected escrow_lock, escrow_release, platform_fee, split_payout, top_up or refund.',
                p_type USING ERRCODE = '22023';
    END CASE;

    IF v_needs_source AND p_from_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Simulation type % requires a source wallet.', p_type USING ERRCODE = '22023';
    END IF;

    IF v_needs_dest AND p_to_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Simulation type % requires a destination wallet.', p_type USING ERRCODE = '22023';
    END IF;

    IF p_from_wallet_id IS NULL AND p_to_wallet_id IS NULL THEN
        RAISE EXCEPTION 'A simulation must touch at least one wallet.' USING ERRCODE = '22023';
    END IF;

    IF p_from_wallet_id IS NOT NULL AND p_from_wallet_id = p_to_wallet_id THEN
        RAISE EXCEPTION 'Source and destination wallet must differ.' USING ERRCODE = '22023';
    END IF;

    -- Lock both rows in a deterministic order so two concurrent simulations cannot deadlock.
    PERFORM 1 FROM finance.wallets w
    WHERE w.id IN (p_from_wallet_id, p_to_wallet_id)
    ORDER BY w.id
    FOR UPDATE;

    -- Gate 3a: the source wallet — exists, matches currency, is the caller's to spend, and holds
    -- enough. The balance is checked explicitly so the caller gets a legible refusal rather than an
    -- opaque `balance_cents >= 0` check violation.
    IF p_from_wallet_id IS NOT NULL THEN
        SELECT w.id, w.owner_type, w.owner_id, w.currency, w.balance_cents
        INTO v_from
        FROM finance.wallets w
        WHERE w.id = p_from_wallet_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Source wallet % not found.', p_from_wallet_id USING ERRCODE = '23503';
        END IF;

        IF v_from.currency <> p_currency THEN
            RAISE EXCEPTION
                'Source wallet is in % but the simulation is in %. The simulator never converts.',
                v_from.currency, p_currency USING ERRCODE = '22023';
        END IF;

        IF NOT finance.fn_can_move_wallet_funds(v_from.id) THEN
            RAISE EXCEPTION 'Not authorised to move funds out of this wallet.' USING ERRCODE = '42501';
        END IF;

        IF v_from.balance_cents < p_amount_minor THEN
            RAISE EXCEPTION
                'Insufficient balance: % available, % requested.',
                v_from.balance_cents, p_amount_minor USING ERRCODE = '23514';
        END IF;
    END IF;

    -- Gate 3b: the destination wallet. Checked with the same predicate, so a credit-only type can
    -- never mint balance into a wallet the caller does not control.
    IF p_to_wallet_id IS NOT NULL THEN
        SELECT w.id, w.owner_type, w.owner_id, w.currency, w.balance_cents
        INTO v_to
        FROM finance.wallets w
        WHERE w.id = p_to_wallet_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Destination wallet % not found.', p_to_wallet_id USING ERRCODE = '23503';
        END IF;

        IF v_to.currency <> p_currency THEN
            RAISE EXCEPTION
                'Destination wallet is in % but the simulation is in %. The simulator never converts.',
                v_to.currency, p_currency USING ERRCODE = '22023';
        END IF;

        IF NOT finance.fn_can_move_wallet_funds(v_to.id) THEN
            RAISE EXCEPTION 'Not authorised to move funds into this wallet.' USING ERRCODE = '42501';
        END IF;

        -- A simulation never reaches a state the real doors refuse: an archived business takes no
        -- money in (Decision #248 (k)).
        IF v_to.owner_type = 'business' THEN
            PERFORM org.fn_assert_business_not_archived(v_to.owner_id);
        END IF;
    END IF;

    v_reason := 'simulated_' || p_type;

    IF p_from_wallet_id IS NOT NULL THEN
        UPDATE finance.wallets
        SET balance_cents = balance_cents - p_amount_minor
        WHERE id = v_from.id
        RETURNING balance_cents INTO v_from_after;

        INSERT INTO finance.transactions (
            wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents
        )
        VALUES (
            v_from.id, 'debit', p_amount_minor, p_currency, v_reason, 'simulation', NULL, v_from_after
        )
        RETURNING id INTO v_from_tx;

        INSERT INTO finance.ledger_audit (
            wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata
        )
        VALUES (
            v_from.id, v_caller, v_action, -p_amount_minor, p_currency::char(3), 'simulation', v_from_tx,
            pg_catalog.jsonb_build_object('simulated', true, 'type', p_type, 'side', 'debit')
        );

        v_from_json := pg_catalog.jsonb_build_object(
            'wallet_id', v_from.id,
            'owner_type', v_from.owner_type,
            'owner_id', v_from.owner_id,
            'currency', v_from.currency,
            'balance_before_cents', v_from.balance_cents,
            'balance_after_cents', v_from_after,
            'transaction_id', v_from_tx
        );
    END IF;

    IF p_to_wallet_id IS NOT NULL THEN
        UPDATE finance.wallets
        SET balance_cents = balance_cents + p_amount_minor
        WHERE id = v_to.id
        RETURNING balance_cents INTO v_to_after;

        INSERT INTO finance.transactions (
            wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents
        )
        VALUES (
            v_to.id, 'credit', p_amount_minor, p_currency, v_reason, 'simulation', NULL, v_to_after
        )
        RETURNING id INTO v_to_tx;

        INSERT INTO finance.ledger_audit (
            wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata
        )
        VALUES (
            v_to.id, v_caller, v_action, p_amount_minor, p_currency::char(3), 'simulation', v_to_tx,
            pg_catalog.jsonb_build_object('simulated', true, 'type', p_type, 'side', 'credit')
        );

        v_to_json := pg_catalog.jsonb_build_object(
            'wallet_id', v_to.id,
            'owner_type', v_to.owner_type,
            'owner_id', v_to.owner_id,
            'currency', v_to.currency,
            'balance_before_cents', v_to.balance_cents,
            'balance_after_cents', v_to_after,
            'transaction_id', v_to_tx
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'simulated', true,
        'type', p_type,
        'amount_minor', p_amount_minor,
        'currency', p_currency,
        'executed_at', pg_catalog.now(),
        'from', v_from_json,
        'to', v_to_json
    );
END;
$$;

-- finance.create_deposit_rule — 00001240_functions_finance_money_movement.sql
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
            v_wallet.owner_type IN ('team', 'business', 'enterprise')
            AND finance.fn_has_vault_capability(v_wallet.id, v_uid, 'add_funds'::finance.vault_capability)
        )
    ) THEN
        RAISE EXCEPTION 'auth: you can''t add funds to this wallet' USING ERRCODE = '42501';
    END IF;
    IF v_wallet.owner_type = 'business' THEN
        PERFORM org.fn_assert_business_not_archived(v_wallet.owner_id);
    END IF;
    IF pg_catalog.upper(v_wallet.currency) <> v_currency THEN
        RAISE EXCEPTION 'currency: this wallet holds %', pg_catalog.upper(v_wallet.currency) USING ERRCODE = '22023';
    END IF;
    -- A floor top-up runs when the balance crosses the business's floor (finance.fn_wallet_watch), so
    -- it needs a business wallet in the default currency with a floor set.
    IF p_interval = 'below_floor' AND NOT EXISTS (
        SELECT 1 FROM org.business_profiles b
         WHERE v_wallet.owner_type = 'business' AND b.id = v_wallet.owner_id
           AND b.low_balance_floor_cents IS NOT NULL
           AND pg_catalog.upper(COALESCE(b.default_currency, 'USD')) = pg_catalog.upper(v_wallet.currency)
    ) THEN
        RAISE EXCEPTION 'interval: set a balance floor on this business wallet first' USING ERRCODE = '22023';
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
        CASE p_interval
            WHEN 'weekly' THEN pg_catalog.now() + interval '1 week'
            WHEN 'below_floor' THEN 'infinity'::timestamptz
            ELSE pg_catalog.now() + interval '1 month'
        END,
        true, v_uid
    )
    RETURNING * INTO v_rule;
    RETURN pg_catalog.to_jsonb(v_rule);
END;
$$;

-- finance.fn_deposit_charge_target — 00001240_functions_finance_money_movement.sql
CREATE OR REPLACE FUNCTION finance.fn_deposit_charge_target(
    p_rule finance.deposit_rules,
    OUT customer_ref text,
    OUT payment_method_ref text,
    OUT refusal text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_method finance.payment_methods;
    v_wallet finance.wallets;
    v_prev_sub text;
    v_allowed boolean;
BEGIN
    SELECT * INTO v_wallet FROM finance.wallets WHERE id = p_rule.wallet_id;
    SELECT * INTO v_method FROM finance.payment_methods WHERE id = p_rule.source_method_id;
    IF p_rule.created_by IS NULL OR v_method.id IS NULL OR v_method.status <> 'active' THEN
        refusal := 'Paused: the card or the person who set this up is no longer available.';
        RETURN;
    END IF;

    v_prev_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_rule.created_by::text, true);
    v_allowed := (v_wallet.owner_type IN ('user', 'freelancer') AND v_wallet.owner_id = p_rule.created_by)
        OR finance.fn_has_vault_capability(v_wallet.id, p_rule.created_by, 'add_funds'::finance.vault_capability);
    v_allowed := v_allowed AND (
        (v_method.owner_type = v_wallet.owner_type AND v_method.owner_id = v_wallet.owner_id)
        OR (v_method.owner_type IN ('user', 'freelancer') AND v_method.owner_id = p_rule.created_by)
    );
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
    IF NOT v_allowed THEN
        refusal := 'Paused: the person who set this up can no longer add funds to this wallet.';
        RETURN;
    END IF;
    IF v_wallet.owner_type = 'business' AND EXISTS (
        SELECT 1 FROM org.business_profiles b WHERE b.id = v_wallet.owner_id AND b.status = 'archived'
    ) THEN
        refusal := 'Paused: this business is archived — restore it before money is added again.';
        RETURN;
    END IF;

    SELECT c.customer_ref INTO customer_ref FROM finance.processor_customers c
     WHERE c.provider = 'stripe' AND c.owner_type = v_method.owner_type AND c.owner_id = v_method.owner_id;
    IF customer_ref IS NULL THEN
        refusal := 'Paused: the saved card is not attached to a billing profile.';
        RETURN;
    END IF;
    payment_method_ref := v_method.external_ref;
END;
$$;

-- finance.v_ops_unledgered_payments — 00003004_views_finance_integrations_analytics.sql
CREATE OR REPLACE VIEW finance.v_ops_unledgered_payments AS
SELECT
    p.id AS payment_id,
    p.status,
    p.purpose,
    p.wallet_id,
    p.created_by,
    p.provider_ref,
    p.amount_cents,
    p.amount_received_cents,
    p.currency,
    p.transaction_id,
    p.unapplied_reason,
    p.succeeded_at,
    CASE WHEN t.id IS NULL THEN 'no_ledger_row' ELSE 'ledger_row_mismatch' END AS problem,
    NULL::text AS stripe_event_id,
    NULL::bigint AS reported_amount_cents,
    NULL::text AS reported_currency
FROM finance.inbound_payments p
LEFT JOIN finance.transactions t ON t.id = p.transaction_id
WHERE p.status IN ('succeeded', 'settled_unapplied')
  AND (
        t.id IS NULL
     OR t.wallet_id <> p.wallet_id
     OR t.direction <> 'credit'
     OR t.amount_cents IS DISTINCT FROM p.amount_received_cents
     OR t.ref_table IS DISTINCT FROM 'inbound_payments'
     OR t.ref_id IS DISTINCT FROM p.id
  )
UNION ALL
SELECT
    p.id AS payment_id,
    p.status,
    p.purpose,
    p.wallet_id,
    p.created_by,
    p.provider_ref,
    p.amount_cents,
    p.amount_received_cents,
    p.currency,
    p.transaction_id,
    p.unapplied_reason,
    p.succeeded_at,
    k.response ->> 'reconciliation' AS problem,
    substr(k.key, 8) AS stripe_event_id,
    (k.response ->> 'amount_received_cents')::bigint AS reported_amount_cents,
    k.response ->> 'currency_received' AS reported_currency
FROM finance.idempotency_keys k
JOIN finance.inbound_payments p ON p.id::text = k.response ->> 'payment_id'
WHERE k.scope = 'stripe.webhook'
  AND k.status = 'succeeded'
  AND k.response ->> 'reconciliation' IN ('settlement_mismatch', 'business_archived')
  AND p.status IN ('requires_payment', 'processing', 'failed');
\endif
-- #endregion

-- #region Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid);
-- Failures are counted on a sequence: nextval survives the savepoint rollbacks the settlement checks
-- run under, so a failure inside one is still counted at the end (its NOTICE names it).
CREATE TEMP SEQUENCE probe_fails;

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

-- Act as a user: auth.uid() reads the claims, a settlement's lock swap reads claim.sub.
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE sql AS $$
    SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true),
           set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
$$;

CREATE FUNCTION pg_temp.fail(p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM nextval('probe_fails');
    RAISE NOTICE 'FAIL % — %', p_label, p_why;
END $$;

CREATE FUNCTION pg_temp.pass(p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    RAISE NOTICE 'ok   %', p_label;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text, p_why text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS TRUE THEN PERFORM pg_temp.pass(p_label); ELSE PERFORM pg_temp.fail(p_label, p_why); END IF;
END $$;

-- Run p_sql as p_actor in a subtransaction that is always rolled back. Returns 'ok', or
-- '<SQLSTATE> <message>' for the refusal.
CREATE FUNCTION pg_temp.try(p_actor uuid, p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_state text;
    v_msg text;
BEGIN
    BEGIN
        PERFORM pg_temp.act(p_actor);
        EXECUTE p_sql;
        RAISE EXCEPTION USING ERRCODE = 'PX000', MESSAGE = 'probe_rollback';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    END;
    PERFORM pg_temp.act(NULL);
    RETURN CASE WHEN v_state = 'PX000' THEN 'ok' ELSE v_state || ' ' || v_msg END;
END $$;

-- The door refuses an archived business exactly as org.fn_assert_business_active words it.
CREATE FUNCTION pg_temp.expect_archived(p_label text, p_actor uuid, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v text := pg_temp.try(p_actor, p_sql);
BEGIN
    PERFORM pg_temp.check(
        v = '55000 business_not_active: this business is archived — restore it first',
        p_label, 'expected 55000 business_not_active (archived), got ' || v);
END $$;

-- The door accepts (it may refuse for something unrelated to the business's status, which fails too).
CREATE FUNCTION pg_temp.expect_ok(p_label text, p_actor uuid, p_sql text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v text := pg_temp.try(p_actor, p_sql);
BEGIN
    PERFORM pg_temp.check(v = 'ok', p_label, 'expected the door to accept, got ' || v);
END $$;

-- A bound card top-up into a wallet, as the processor would find it at settlement: a browser top-up is
-- still `requires_payment` (finance.attach_card_payment only binds the intent; only a scheduled deposit's
-- bind moves it to `processing`).
CREATE FUNCTION pg_temp.bound_topup(p_wallet uuid, p_payer uuid, p_ref text, p_amount bigint) RETURNS uuid
LANGUAGE sql AS $$
    INSERT INTO finance.inbound_payments (
        purpose, wallet_id, amount_cents, currency, status, lock_status, provider, provider_ref,
        idempotency_key, created_by
    )
    SELECT 'wallet_topup', w.id, p_amount, w.currency, 'requires_payment', 'not_applicable', 'stripe', p_ref,
           'probe-k-' || p_ref, p_payer
      FROM finance.wallets w WHERE w.id = p_wallet
    RETURNING id;
$$;

CREATE FUNCTION pg_temp.balance(p_wallet uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT balance_cents FROM finance.wallets WHERE id = p_wallet;
$$;
-- #endregion

-- #region Fixture
-- theo creates a business (a draft, with its own wallet and owner vault rights); helia is the seed's
-- active business (owner priyaraman). theo's personal wallet in the new business's currency is the
-- transfer source; a saved card on a Stripe Customer funds his recurring deposits.
INSERT INTO probe_ids VALUES
    ('theo',  (SELECT user_id FROM org.users_public WHERE username = 'theo')),
    ('priya', (SELECT user_id FROM org.users_public WHERE username = 'priyaraman')),
    ('helia', (SELECT id FROM org.business_profiles WHERE slug = 'heliafinance'));
SELECT pg_temp.act(pg_temp.id('theo'));
INSERT INTO probe_ids VALUES
    ('biz', (org.create_workspace('business', 'Probe Archived Topup', 'probe-k-archived-topup') ->> 'id')::uuid);
SELECT pg_temp.act(NULL);
INSERT INTO probe_ids VALUES
    ('wallet', (SELECT w.id FROM finance.wallets w WHERE w.owner_type = 'business' AND w.owner_id = pg_temp.id('biz')
                 ORDER BY w.created_at LIMIT 1)),
    ('helia_wallet', (SELECT w.id FROM finance.wallets w WHERE w.owner_type = 'business'
                       AND w.owner_id = pg_temp.id('helia') AND w.currency = 'USD'));
INSERT INTO probe_ids VALUES
    ('personal', finance.fn_ensure_wallet('user', pg_temp.id('theo'),
                    (SELECT currency FROM finance.wallets WHERE id = pg_temp.id('wallet'))));
SELECT finance.fn_wallet_credit(pg_temp.id('theo'), 'user', w.currency, 50000, 'topup', NULL, NULL)
  FROM finance.wallets w WHERE w.id = pg_temp.id('personal');

INSERT INTO finance.payment_methods (owner_type, owner_id, method_role, external_ref, brand, last4)
VALUES ('user', pg_temp.id('theo'), 'funding', 'pm_probe_k', 'visa', '4242');
INSERT INTO probe_ids VALUES
    ('card', (SELECT id FROM finance.payment_methods WHERE external_ref = 'pm_probe_k'));
INSERT INTO finance.processor_customers (owner_type, owner_id, customer_ref)
VALUES ('user', pg_temp.id('theo'), 'cus_probe_k')
ON CONFLICT (provider, owner_type, owner_id) DO NOTHING;
-- A weekly rule into the business wallet that fell due a minute ago (stamped as the door would).
INSERT INTO finance.deposit_rules (wallet_id, source_method_id, amount_cents, currency, interval, next_run_at, created_by)
SELECT w.id, pg_temp.id('card'), 2000, w.currency, 'weekly', now() - interval '1 minute', pg_temp.id('theo')
  FROM finance.wallets w WHERE w.id = pg_temp.id('wallet');
UPDATE finance.deposit_rules SET created_by = pg_temp.id('theo')
 WHERE wallet_id = pg_temp.id('wallet') AND created_by IS NULL;
INSERT INTO probe_ids VALUES
    ('rule', (SELECT id FROM finance.deposit_rules WHERE wallet_id = pg_temp.id('wallet') ORDER BY created_at LIMIT 1));

-- The developer simulator is fail-closed; switched on for this transaction only.
UPDATE security.platform_params SET value = to_jsonb(true) WHERE key = 'finance_simulation_enabled';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM probe_ids WHERE id IS NULL) THEN
        RAISE EXCEPTION 'fixture missing: %', (SELECT string_agg(k, ', ') FROM probe_ids WHERE id IS NULL);
    END IF;
    IF (SELECT status FROM org.business_profiles WHERE id = pg_temp.id('biz')) <> 'draft'
       OR (SELECT status FROM org.business_profiles WHERE id = pg_temp.id('helia')) <> 'active' THEN
        RAISE EXCEPTION 'fixture: expected a draft probe business and an active helia';
    END IF;
END $$;

-- The SQL of each money-in door, against a wallet.
CREATE FUNCTION pg_temp.sql_begin(p_wallet uuid, p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT finance.begin_card_payment(%L, %L::uuid, NULL, NULL, 1500, %L, %L)',
                  'wallet_topup', p_wallet, (SELECT currency FROM finance.wallets WHERE id = p_wallet), p_key);
$$;
CREATE FUNCTION pg_temp.sql_transfer(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT finance.transfer_funds(%L::uuid, %L::uuid, 700, %L, %L)',
                  pg_temp.id('personal'), pg_temp.id('wallet'), 'probe', p_key);
$$;
CREATE FUNCTION pg_temp.sql_rule() RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT finance.create_deposit_rule(%L::uuid, 2500, %L, %L::finance.deposit_interval, %L::uuid)',
                  pg_temp.id('wallet'), (SELECT currency FROM finance.wallets WHERE id = pg_temp.id('wallet')),
                  'monthly', pg_temp.id('card'));
$$;
CREATE FUNCTION pg_temp.sql_simulate() RETURNS text LANGUAGE sql AS $$
    SELECT format('SELECT finance.simulate_wallet_transaction(NULL, %L::uuid, 900, %L, %L)',
                  pg_temp.id('wallet'), (SELECT currency FROM finance.wallets WHERE id = pg_temp.id('wallet')),
                  'top_up');
$$;
-- #endregion

-- #region A. A draft and an active business still take money in (#236 (f) stands)
SELECT pg_temp.expect_ok('draft: card top-up begins', pg_temp.id('theo'), pg_temp.sql_begin(pg_temp.id('wallet'), 'probe-k-draft-begin'));
SELECT pg_temp.expect_ok('active: card top-up begins', pg_temp.id('priya'), pg_temp.sql_begin(pg_temp.id('helia_wallet'), 'probe-k-active-begin'));
-- One attempt begun while the business is a draft is KEPT (outside pg_temp.try) for B to replay.
DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.id('theo'));
    EXECUTE pg_temp.sql_begin(pg_temp.id('wallet'), 'probe-k-replay');
    PERFORM pg_temp.act(NULL);
END $$;
SELECT pg_temp.expect_ok('draft: transfer in from a personal wallet', pg_temp.id('theo'), pg_temp.sql_transfer('probe-k-draft-transfer'));
SELECT pg_temp.expect_ok('draft: recurring deposit set up', pg_temp.id('theo'), pg_temp.sql_rule());
SELECT pg_temp.expect_ok('draft: simulated top-up', pg_temp.id('theo'), pg_temp.sql_simulate());
SELECT pg_temp.check(
    (SELECT t.refusal IS NULL AND t.payment_method_ref = 'pm_probe_k'
       FROM finance.fn_deposit_charge_target((SELECT r FROM finance.deposit_rules r WHERE r.id = pg_temp.id('rule'))) t),
    'draft: a due deposit run is charged', 'fn_deposit_charge_target refused a draft business''s run');

SAVEPOINT s_draft_settle;
DO $$
DECLARE
    v_wallet uuid := pg_temp.id('wallet');
    v_before bigint := pg_temp.balance(v_wallet);
    v_id uuid := pg_temp.bound_topup(v_wallet, pg_temp.id('theo'), 'pi_probe_k_draft', 4200);
    v_out jsonb := finance.settle_card_payment('evt_probe_k_draft', 'pi_probe_k_draft', 4200,
                                               (SELECT currency FROM finance.wallets WHERE id = v_wallet), false);
BEGIN
    PERFORM pg_temp.check(
        v_out ->> 'outcome' = 'applied' AND v_out ->> 'transaction_id' IS NOT NULL
        AND pg_temp.balance(v_wallet) = v_before + 4200
        AND (SELECT status::text FROM finance.inbound_payments WHERE id = v_id) = 'succeeded',
        'draft: a settled card top-up is credited', 'settle answered ' || v_out::text);
END $$;
ROLLBACK TO SAVEPOINT s_draft_settle;
-- #endregion

-- #region B. An archived business takes no money in
UPDATE org.business_profiles SET status = 'archived' WHERE id = pg_temp.id('biz');

SELECT pg_temp.expect_archived('archived: card top-up refused at begin', pg_temp.id('theo'), pg_temp.sql_begin(pg_temp.id('wallet'), 'probe-k-archived-begin'));
-- A replay of the attempt begun as a draft, still payable (`requires_payment`), would hand back an
-- intent a card could pay: refused as a new attempt is.
SELECT pg_temp.expect_archived('archived: a replayed, still-payable top-up attempt is refused', pg_temp.id('theo'), pg_temp.sql_begin(pg_temp.id('wallet'), 'probe-k-replay'));
SELECT pg_temp.expect_archived('archived: transfer in refused (contribution)', pg_temp.id('theo'), pg_temp.sql_transfer('probe-k-archived-transfer'));
SELECT pg_temp.expect_archived('archived: recurring deposit refused', pg_temp.id('theo'), pg_temp.sql_rule());
SELECT pg_temp.expect_archived('archived: simulated top-up refused', pg_temp.id('theo'), pg_temp.sql_simulate());
-- Money still leaves nothing: the spend gate keeps refusing a transfer out (BB5, unchanged).
SELECT pg_temp.check(
    pg_temp.try(pg_temp.id('theo'), format('SELECT finance.transfer_funds(%L::uuid, %L::uuid, 1, NULL, %L)',
        pg_temp.id('wallet'), pg_temp.id('personal'), 'probe-k-archived-out')) LIKE '55000 business_not_active:%',
    'archived: transfer out still refused by the spend gate', 'the spend gate let money leave an archived business');

SELECT pg_temp.check(
    (SELECT t.refusal LIKE 'Paused:%archived%' AND t.customer_ref IS NULL AND t.payment_method_ref IS NULL
       FROM finance.fn_deposit_charge_target((SELECT r FROM finance.deposit_rules r WHERE r.id = pg_temp.id('rule'))) t),
    'archived: a due deposit run is not charged', 'fn_deposit_charge_target answered a charge target');

SAVEPOINT s_claim;
DO $$
DECLARE
    v_claim jsonb := finance.claim_due_deposit_rules(500);
    v_rule finance.deposit_rules;
BEGIN
    SELECT * INTO v_rule FROM finance.deposit_rules WHERE id = pg_temp.id('rule');
    PERFORM pg_temp.check(
        NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_claim) e WHERE e ->> 'rule_id' = pg_temp.id('rule')::text)
        AND NOT EXISTS (SELECT 1 FROM finance.inbound_payments p WHERE p.deposit_rule_id = pg_temp.id('rule'))
        AND NOT v_rule.active AND v_rule.last_error LIKE 'Paused:%archived%',
        'archived: the scheduler pauses the rule and charges nothing',
        format('active %s, last_error %s', v_rule.active, v_rule.last_error));
END $$;
ROLLBACK TO SAVEPOINT s_claim;

-- A card already captured for an archived business is not credited: the settlement is acknowledged
-- into reconciliation (as a settlement mismatch is), one ops error row, listed by the ops view.
SAVEPOINT s_settle;
DO $$
DECLARE
    v_wallet uuid := pg_temp.id('wallet');
    v_currency text := (SELECT currency FROM finance.wallets WHERE id = v_wallet);
    v_before bigint := pg_temp.balance(v_wallet);
    v_id uuid := pg_temp.bound_topup(v_wallet, pg_temp.id('theo'), 'pi_probe_k_archived', 4200);
    v_out jsonb;
    v_again jsonb;
    v_p finance.inbound_payments;
    v_claim finance.idempotency_keys;
    v_rows int;
    v_view record;
BEGIN
    v_out := finance.settle_card_payment('evt_probe_k_archived', 'pi_probe_k_archived', 4200, v_currency, false);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_id;
    SELECT * INTO v_claim FROM finance.idempotency_keys WHERE key = 'stripe:evt_probe_k_archived';
    PERFORM pg_temp.check(
        v_out ->> 'outcome' = 'unmatched' AND v_out ->> 'reconciliation' = 'business_archived'
        AND v_out ->> 'transaction_id' IS NULL AND v_out ->> 'payment_id' = v_id::text,
        'archived: settlement answers reconciliation business_archived', v_out::text);
    PERFORM pg_temp.check(
        pg_temp.balance(v_wallet) = v_before AND v_p.status::text = 'requires_payment' AND v_p.transaction_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM finance.transactions t WHERE t.ref_table = 'inbound_payments' AND t.ref_id = v_id),
        'archived: nothing is credited and the payment keeps its unsettled status',
        format('balance %s→%s, status %s, tx %s', v_before, pg_temp.balance(v_wallet), v_p.status, v_p.transaction_id));
    PERFORM pg_temp.check(
        v_claim.key IS NOT NULL AND v_claim.status::text = 'succeeded',
        'archived: the event claim is kept (Stripe stops retrying)', format('claim status %s', v_claim.status));
    SELECT count(*) INTO v_rows FROM ops.log_entries l
     WHERE l.scope = 'finance.settle_card_payment' AND l.level = 'error' AND l.data ->> 'payment_id' = v_id::text
       AND l.data ->> 'reconciliation' = 'business_archived';
    PERFORM pg_temp.check(v_rows = 1, 'archived: one ops error row for a human', format('%s rows', v_rows));

    v_again := finance.settle_card_payment('evt_probe_k_archived', 'pi_probe_k_archived', 4200, v_currency, false);
    SELECT count(*) INTO v_rows FROM ops.log_entries l
     WHERE l.scope = 'finance.settle_card_payment' AND l.data ->> 'payment_id' = v_id::text;
    PERFORM pg_temp.check(
        v_again ->> 'outcome' = 'replayed' AND v_again ->> 'reconciliation' = 'business_archived'
        AND v_rows = 1 AND pg_temp.balance(v_wallet) = v_before,
        'archived: a redelivery replays the reconciliation and writes nothing', v_again::text);

    EXECUTE 'SELECT problem, stripe_event_id, reported_amount_cents, reported_currency
               FROM finance.v_ops_unledgered_payments WHERE payment_id = $1' INTO v_view USING v_id;
    PERFORM pg_temp.check(
        v_view.problem = 'business_archived' AND v_view.stripe_event_id = 'evt_probe_k_archived'
        AND v_view.reported_amount_cents = 4200 AND v_view.reported_currency = v_currency,
        'archived: the ops view lists it until a human resolves it', COALESCE(v_view::text, 'not listed'));
END $$;
ROLLBACK TO SAVEPOINT s_settle;

-- `failed` is not final: a declined first attempt, then a success on the same intent after the archive,
-- is held the same way — and still listed for a human although the payment row reads `failed`.
SAVEPOINT s_failed_then_settled;
DO $$
DECLARE
    v_wallet uuid := pg_temp.id('wallet');
    v_currency text := (SELECT currency FROM finance.wallets WHERE id = v_wallet);
    v_before bigint := pg_temp.balance(v_wallet);
    v_id uuid := pg_temp.bound_topup(v_wallet, pg_temp.id('theo'), 'pi_probe_k_failed', 3100);
    v_out jsonb;
    v_view record;
BEGIN
    PERFORM finance.record_card_payment_failure('evt_probe_k_declined', 'pi_probe_k_failed', 'failed',
                                                'card_declined', false);
    v_out := finance.settle_card_payment('evt_probe_k_failed', 'pi_probe_k_failed', 3100, v_currency, false);
    EXECUTE 'SELECT problem, status::text AS status FROM finance.v_ops_unledgered_payments WHERE payment_id = $1'
       INTO v_view USING v_id;
    PERFORM pg_temp.check(
        v_out ->> 'reconciliation' = 'business_archived' AND pg_temp.balance(v_wallet) = v_before
        AND (SELECT status::text FROM finance.inbound_payments WHERE id = v_id) = 'failed'
        AND v_view.problem = 'business_archived' AND v_view.status = 'failed',
        'archived: a success after a declined attempt is held and the ops view lists it',
        format('settle %s, view %s', v_out, COALESCE(v_view::text, 'not listed')));
END $$;
ROLLBACK TO SAVEPOINT s_failed_then_settled;
-- #endregion

-- #region C. Restored, it takes money in again
UPDATE org.business_profiles SET status = 'draft' WHERE id = pg_temp.id('biz');
SELECT pg_temp.expect_ok('restored to draft: card top-up begins again', pg_temp.id('theo'), pg_temp.sql_begin(pg_temp.id('wallet'), 'probe-k-restored-begin'));
SELECT pg_temp.expect_ok('restored to draft: transfer in again', pg_temp.id('theo'), pg_temp.sql_transfer('probe-k-restored-transfer'));
SELECT pg_temp.expect_ok('restored to draft: the kept attempt replays again', pg_temp.id('theo'), pg_temp.sql_begin(pg_temp.id('wallet'), 'probe-k-replay'));
-- #endregion

DO $$
DECLARE
    v_failed record;
BEGIN
    SELECT last_value, is_called INTO v_failed FROM probe_fails;
    IF v_failed.is_called THEN
        RAISE EXCEPTION 'PROBE FAILED: % check(s) — see the FAIL notices', v_failed.last_value;
    END IF;
    RAISE NOTICE 'business_archived_topup: every check passed';
END $$;
ROLLBACK;
