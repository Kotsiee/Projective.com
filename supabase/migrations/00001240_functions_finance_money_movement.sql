-- =============================================================================================
-- 00001240_functions_finance_money_movement.sql — the money-movement doors that follow the Stripe
-- fiat rails (root CLAUDE.md §8 Decision #126, after #125).
--
--   1. Dispute resolution   — `charge.dispute.closed`: won unfreezes, lost claws back.
--  1b. Refunds by request   — a buyer cancels a digital product line while its sale clears; a
--                             provider gives a session forfeit back (FBP DB21).
--   2. Withdrawals          — a payout debits the wallet, then leaves as a Stripe Transfer to the
--                             owner's Connect account (Separate Charges & Transfers); a reversal,
--                             the bank payout's outcome and the stale-pending sweep (Decision #202);
--                             the payout schedules that withdraw on their author's behalf (M6).
--   3. Saved cards          — the Stripe Customer an owner's cards attach to, and the processor door
--                             that records a card a SetupIntent confirmed.
--   4. Recurring deposits   — a standing top-up rule and the scheduler door that charges it off-session.
--   5. The Income Smoother  — enrolment, gated on earning history, at the platform's fee.
--   6. Verification status  — one read of the caller's KYC and the KYB of the businesses they manage.
--   7. The pending window   — earned credits held for `pending_release_days`, then swept to Available.
--   8. Key retention        — the daily sweep of expired attempt keys (never the Stripe event claims).
--
-- The same two-door split as 00001230: USER doors (EXECUTE → authenticated) authorise the caller
-- through auth.uid() and can never report that money arrived or left; PROCESSOR doors (EXECUTE →
-- service_role only) apply what Stripe reported or what the scheduler decided. Grants: 00002510.
-- =============================================================================================

-- #region 1. Dispute resolution (processor door)
-- `charge.dispute.closed`. `won` (and `warning_closed`, an inquiry that never became a chargeback)
-- returns the frozen escrows to `held` and the payee rows the case froze to `pending` at their
-- unchanged `available_at` — the capital was never lost, and a row whose date has passed matures on
-- the next sweep. `lost` means the processor has kept the disputed amount, so the platform recovers it
-- (Decision #337, ruling M3):
--
--   * every escrow the disputed payment funded that is still frozen is returned to the payer's wallet
--     (reason `escrow_refund`, exactly as finance.fn_refund_ticket_escrow returns one) — the work it
--     was holding for is no longer paid for — and its ticket drops back to `unpaid`;
--   * what those escrows do not cover is taken back first from the payee rows the case froze
--     (`recovered_cents`, oldest first; a row emptied this way closes `available` with no credit, the
--     rest return to `pending` at their own date). That money was still clearing, so no ledger line
--     moves and money that had cleared is never touched;
--   * the rest of the disputed amount is recovered from the payer's wallet: first from its money still
--     in the pending window (finance.fn_recover_from_pending, Decision #191), then debited from its
--     Available balance with reason `chargeback`. Whatever is still uncovered (the payer spent it) is
--     recorded on the case as `unrecovered_cents`, the platform's loss, never forced into a negative
--     balance.
--
-- In any delivery order (FA H4): a dispute Stripe closed before its `.created` arrived has no case
-- yet, so this door records one from the closed dispute's own facts (finance.fn_open_chargeback,
-- without the freeze), resolves it at once and says so in `resolution_note`; the late `.created` then
-- finds it resolved and freezes nothing. Nothing was frozen for it, so a won one thaws nothing, and a
-- lost one takes the payment's still-held escrows and still-pending payee rows as the frozen ones —
-- what the in-order events would have refunded and recovered.
--
-- A thaw that would give a ticket a second held base escrow (the ticket was funded again while the
-- dispute froze the first, uq_escrows_ticket_base_held, FA E3) leaves that escrow `disputed`, notes it
-- in `resolution_note` and writes one ops.log_entries error for a human. It never raises out of the
-- webhook, which would otherwise answer 5xx for every redelivery.
CREATE OR REPLACE FUNCTION finance.record_dispute_closed(
    p_event_id text,
    p_dispute_ref text,
    p_status text,
    p_livemode boolean,
    p_provider_ref text DEFAULT NULL,
    p_amount bigint DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_reason text DEFAULT NULL
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
    v_stuck uuid[] := '{}';
    v_late boolean := false;
    v_note text;
    v_constraint text;
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
    v_recover bigint := 0;
    v_from_pending bigint := 0;
    v_from_payee bigint := 0;
    v_uncovered bigint := 0;
    v_take bigint;
    v_row finance.pending_releases;
    v_unheld integer := 0;
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
        IF p_dispute_ref IS NULL OR p_dispute_ref !~ '^(du|dp)_[A-Za-z0-9_]{1,250}$'
           OR p_amount IS NULL OR p_amount <= 0 OR v_currency !~ '^[A-Z]{3}$' THEN
            RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
                'outcome', 'unmatched',
                'detail', 'no recorded dispute carries this id, and the event cannot record one'));
        END IF;
        v_late := finance.fn_open_chargeback(p_dispute_ref, p_provider_ref, p_amount, v_currency, p_reason, false)
                  IS NOT NULL;
        SELECT * INTO v_case FROM finance.chargebacks WHERE provider_ref = p_dispute_ref FOR UPDATE;
        IF v_late THEN
            v_note := 'Stripe closed this dispute before it reported it opened, so nothing was frozen for it.';
        END IF;
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
        FOR v_escrow IN
            SELECT * FROM finance.escrows
             WHERE id = ANY (v_escrow_ids) AND status = 'disputed'
             ORDER BY id
               FOR UPDATE
        LOOP
            BEGIN
                UPDATE finance.escrows SET status = 'held' WHERE id = v_escrow.id;
                v_touched := v_touched || v_escrow.id;
            EXCEPTION WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
                IF v_constraint IS DISTINCT FROM 'uq_escrows_ticket_base_held' THEN
                    RAISE;
                END IF;
                v_stuck := v_stuck || v_escrow.id;
            END;
        END LOOP;
        IF pg_catalog.cardinality(v_stuck) > 0 THEN
            v_note := pg_catalog.concat_ws(' ', v_note, pg_catalog.format(
                'The dispute was won, but %s escrow(s) stay disputed because their ticket was funded again while it was open: %s. Refund or release each by hand.',
                pg_catalog.cardinality(v_stuck), pg_catalog.array_to_string(v_stuck, ', ')));
            INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
            VALUES (
                'chargeback:' || v_case.id::text, 'error',
                pg_catalog.format('Chargeback %s was won, but %s escrow(s) could not return to held: their ticket already holds a newer escrow', v_case.id, pg_catalog.cardinality(v_stuck)),
                pg_catalog.now(), 'server', 'finance.record_dispute_closed',
                pg_catalog.jsonb_build_object('chargeback_id', v_case.id, 'dispute', p_dispute_ref,
                    'disputed_escrow_ids', pg_catalog.to_jsonb(v_stuck))
            );
        END IF;

        UPDATE finance.pending_releases SET state = 'pending'
         WHERE hold_chargeback_id = v_case.id AND state = 'on_hold';
        GET DIAGNOSTICS v_unheld = ROW_COUNT;
        IF v_unheld > 0 THEN
            PERFORM comms.fn_notify(
                p.owner_id, 'chargeback.won', 'Earnings released from hold',
                'The dispute on a card payment for your work was resolved in the payment''s favour. Your money on hold is clearing again, on its original date.',
                'chargebacks', v_case.id, '{}'::jsonb
            )
              FROM (SELECT DISTINCT w.owner_id
                      FROM finance.pending_releases pr
                      JOIN finance.wallets w ON w.id = pr.wallet_id
                     WHERE pr.hold_chargeback_id = v_case.id AND pr.state = 'pending'
                       AND w.owner_type IN ('user', 'freelancer')) p;
        END IF;

        UPDATE finance.chargebacks
           SET status = 'won', resolved_at = pg_catalog.now(), resolution_note = v_note
         WHERE id = v_case.id;

        IF v_notify IS NOT NULL THEN
            PERFORM comms.fn_notify(
                v_notify, 'chargeback.won', 'Dispute resolved',
                CASE
                    WHEN pg_catalog.cardinality(v_stuck) > 0
                        THEN 'The dispute on your card payment was resolved in the payment''s favour. Part of the escrow it funded stays on hold until our team reviews it.'
                    WHEN v_late
                        THEN 'The dispute on your card payment was resolved in the payment''s favour. Nothing it funded was put on hold.'
                    ELSE 'The dispute on your card payment was resolved in the payment''s favour. Any escrow it funded is released from hold.'
                END,
                'chargebacks', v_case.id,
                pg_catalog.jsonb_build_object('released_escrows', pg_catalog.cardinality(v_touched),
                    'still_disputed_escrows', pg_catalog.cardinality(v_stuck))
            );
        END IF;
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'applied', 'chargeback_id', v_case.id, 'status', 'won', 'late', v_late,
            'unfrozen_escrow_ids', pg_catalog.to_jsonb(v_touched),
            'still_disputed_escrow_ids', pg_catalog.to_jsonb(v_stuck), 'unheld_releases', v_unheld));
    END IF;

    -- LOST. A case this door just recorded froze nothing, so the payment's still-held escrows and
    -- still-pending payee rows stand in for the frozen ones.
    FOR v_escrow IN
        SELECT * FROM finance.escrows
         WHERE id = ANY (v_escrow_ids) AND (status = 'disputed' OR (v_late AND status = 'held'))
           FOR UPDATE
    LOOP
        UPDATE finance.escrows SET status = 'refunded' WHERE id = v_escrow.id;
        PERFORM finance.fn_refund_escrow_to_payer(v_escrow.id, v_escrow.amount_cents, 'escrow_refund');
        IF v_escrow.ticket_id IS NOT NULL THEN
            UPDATE projects.tickets SET payment_status = 'unpaid'::public.payment_status
             WHERE id = v_escrow.ticket_id
               AND NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_escrow.ticket_id AND e.status = 'held');
        END IF;
        v_touched := v_touched || v_escrow.id;
    END LOOP;

    -- What the refunded escrows do not cover comes back first from the payee money still clearing
    -- that the case froze, oldest first; a row it does not empty clears again at its own date.
    v_uncovered := GREATEST(v_case.amount_cents - COALESCE((
        SELECT pg_catalog.sum(e.amount_cents) FROM finance.escrows e
         WHERE e.id = ANY (v_touched) AND pg_catalog.upper(e.currency) = pg_catalog.upper(v_case.currency)), 0), 0);
    FOR v_row IN
        SELECT pr.* FROM finance.pending_releases pr
         WHERE (pr.state = 'on_hold' AND pr.hold_chargeback_id = v_case.id)
            OR (v_late AND v_payment.id IS NOT NULL AND pr.state = 'pending' AND pr.recovered_cents < pr.amount_cents
                AND pg_catalog.upper(pr.currency) = pg_catalog.upper(v_case.currency)
                AND (pr.escrow_id = ANY (v_payment.locked_escrow_ids)
                     OR (v_payment.order_id IS NOT NULL AND pr.order_id = v_payment.order_id)
                     OR (v_payment.order_id IS NOT NULL AND pr.escrow_id IS NOT NULL
                         AND pr.released_at >= (SELECT o.created_at FROM finance.orders o WHERE o.id = v_payment.order_id)
                         AND EXISTS (SELECT 1 FROM finance.order_lines l
                                      WHERE l.id = finance.fn_order_line_of_escrow(pr.escrow_id)
                                        AND l.order_id = v_payment.order_id))))
         ORDER BY pr.released_at, pr.id
           FOR UPDATE
    LOOP
        v_take := LEAST(v_uncovered, v_row.amount_cents - v_row.recovered_cents);
        v_uncovered := v_uncovered - v_take;
        v_from_payee := v_from_payee + v_take;
        UPDATE finance.pending_releases
           SET recovered_cents = recovered_cents + v_take,
               state = CASE WHEN recovered_cents + v_take = amount_cents THEN 'available' ELSE 'pending' END::finance.fund_state,
               matured_at = CASE WHEN recovered_cents + v_take = amount_cents THEN pg_catalog.now() END,
               hold_chargeback_id = CASE WHEN v_take > 0 THEN v_case.id ELSE hold_chargeback_id END
         WHERE id = v_row.id;
    END LOOP;

    IF v_case.wallet_id IS NOT NULL THEN
        SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_case.wallet_id FOR UPDATE;
    END IF;
    IF v_wallet.id IS NOT NULL AND pg_catalog.upper(v_wallet.currency) = pg_catalog.upper(v_case.currency) THEN
        v_from_pending := finance.fn_recover_from_pending(v_wallet.id, v_case.amount_cents - v_from_payee);
        v_recover := LEAST(v_wallet.balance_cents, v_case.amount_cents - v_from_payee - v_from_pending);
        IF v_recover > 0 THEN
            PERFORM finance.fn_wallet_debit(
                v_wallet.owner_id, v_wallet.owner_type, v_wallet.currency, v_recover,
                'chargeback', 'chargebacks', v_case.id
            );
        END IF;
    END IF;
    v_short := v_case.amount_cents - v_from_payee - v_from_pending - v_recover;

    UPDATE finance.chargebacks
       SET status = 'lost', resolved_at = pg_catalog.now(), unrecovered_cents = v_short, resolution_note = v_note
     WHERE id = v_case.id;

    IF v_notify IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v_notify, 'chargeback.lost', 'Dispute closed against the payment',
            CASE WHEN v_from_pending + v_recover > 0
                 THEN 'Your bank upheld the dispute on a card payment. What the work it paid for had not yet cleared has been taken back, the rest from your wallet, and any stage it funded is no longer paid for.'
                 ELSE 'Your bank upheld the dispute on a card payment. It was recovered from the work it paid for, which had not yet cleared, and any stage it funded is no longer paid for.'
            END,
            'chargebacks', v_case.id,
            pg_catalog.jsonb_build_object('amount_cents', v_case.amount_cents, 'currency', v_case.currency,
                'recovered_cents', v_from_pending + v_recover, 'refunded_escrows', pg_catalog.cardinality(v_touched))
        );
    END IF;
    IF v_from_payee > 0 THEN
        PERFORM comms.fn_notify(
            p.owner_id, 'chargeback.lost', 'Earnings taken back',
            'The payer''s bank upheld a dispute on a card payment for your work. The part of it still clearing has been taken back. Money that had cleared is yours.',
            'chargebacks', v_case.id, '{}'::jsonb
        )
          FROM (SELECT DISTINCT w.owner_id
                  FROM finance.pending_releases pr
                  JOIN finance.wallets w ON w.id = pr.wallet_id
                 WHERE pr.hold_chargeback_id = v_case.id AND pr.recovered_cents > 0
                   AND w.owner_type IN ('user', 'freelancer')) p;
    END IF;

    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied', 'chargeback_id', v_case.id, 'status', 'lost', 'late', v_late,
        'refunded_escrow_ids', pg_catalog.to_jsonb(v_touched),
        'recovered_cents', v_from_payee + v_from_pending + v_recover, 'recovered_payee_cents', v_from_payee,
        'recovered_pending_cents', v_from_pending, 'unrecovered_cents', v_short));
END;
$$;
-- #endregion

-- #region 1b. Refunds a buyer or provider can start (FBP DB21; Decision #337, ruling M8)
-- A digital product line its buyer cancels before the sale clears, and a session forfeit its provider
-- gives back. A product dispute (non-delivery, a defective file) is the dispute engine's (00001260).

-- The seller's still-clearing credit for a digital product line: the `product_sale` row of the
-- line's order, in a wallet of the product's owner, of exactly the line's credit (the line, less a
-- promo share the seller funded, less the line's fee: what place_wallet_order credited). Two lines of
-- one seller with the same credit share an order, a wallet, an amount and a date, so either row is
-- that line's. NULL once the sale has cleared, was partly taken back, or is on hold. The cancel door
-- locks the row it names; the offer read (finance.cancellable_order_lines) only asks. Internal.
CREATE OR REPLACE FUNCTION finance.fn_line_sale_release(p_line finance.order_lines)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pr.id
      FROM finance.pending_releases pr
      JOIN finance.wallets w ON w.id = pr.wallet_id
      JOIN catalogue.products p ON p.id = (p_line).item_id
     WHERE pr.order_id = (p_line).order_id AND pr.reason = 'product_sale'
       AND pr.state = 'pending' AND pr.recovered_cents = 0
       AND pr.amount_cents = (p_line).line_total_minor - (p_line).platform_fee_minor
             - CASE WHEN (p_line).promo_funded_by = 'platform' THEN 0 ELSE (p_line).promo_discount_minor END
       AND ((p.owner_team_id IS NOT NULL AND w.owner_type = 'team' AND w.owner_id = p.owner_team_id)
         OR (p.owner_team_id IS NULL AND w.owner_type IN ('freelancer', 'user') AND w.owner_id = p.owner_user_id))
     ORDER BY pr.id
     LIMIT 1;
$$;

-- Which of these lines the caller may cancel now (read; FBP DB21): the lines of orders the caller can
-- see that finance.cancel_order_line would accept, so the order history offers Cancel only where it
-- works. The door re-checks everything under its locks.
CREATE OR REPLACE FUNCTION finance.cancellable_order_lines(p_line_ids uuid[])
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT l.id
      FROM finance.order_lines l
      JOIN finance.orders o ON o.id = l.order_id
      LEFT JOIN catalogue.entitlements e ON e.order_line_id = l.id
     WHERE l.id = ANY (COALESCE(p_line_ids, '{}'))
       AND finance.fn_owner_visible(o.owner_type, o.owner_id)
       AND l.item_type = 'digital_product' AND l.status = 'confirmed'
       AND l.line_total_minor - l.promo_discount_minor > 0
       AND o.fx_conversion_id IS NULL AND o.status <> 'invoiced'
       AND NOT (e.first_delivered_at IS NOT NULL AND e.delivery_terms_accepted_at IS NOT NULL
                AND COALESCE((SELECT f.enabled FROM security.feature_flags f
                               WHERE f.key = 'finance.delivered_refund_refusal'), false))
       AND (l.line_total_minor - l.platform_fee_minor
              - CASE WHEN l.promo_funded_by = 'platform' THEN 0 ELSE l.promo_discount_minor END <= 0
            OR finance.fn_line_sale_release(l) IS NOT NULL);
$$;

-- Cancel a digital product line (user door; FBP DB21 step 1): a member of the buying account (the
-- order's own read rule, finance.fn_owner_visible), on a confirmed line whose seller's credit is still
-- clearing. The buyer gets back what they paid for the line at once, into the wallet that paid
-- (`order_refund`); the seller's pending row closes, taken back in full (no ledger line: that money
-- never cleared); the line's fee, and a promo share the platform funded, stop counting
-- (finance.v_conservation_identity); the entitlement becomes `refunded`, so the download route stops
-- serving it; the line reads `cancelled`, or `refunded` when a file had been delivered; and the
-- seller is told. ⚖️ A delivered line the buyer accepted the delivery terms for is refused while
-- finance.delivered_refund_refusal is on (ruling A8, off until counsel). Once the sale has cleared there
-- is no cancel: a product dispute in the same window is the route for a faulty or missing file.
-- shortcut: an order paid through a currency conversion, or on account, is refused; build its refund
-- path when either is switched on for products.
CREATE OR REPLACE FUNCTION finance.cancel_order_line(p_line_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    l finance.order_lines;
    o finance.orders;
    e catalogue.entitlements;
    r finance.pending_releases;
    w finance.wallets;
    p catalogue.products;
    v_paid bigint;
    v_credit bigint;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to cancel a purchase' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO l FROM finance.order_lines WHERE id = p_line_id FOR UPDATE;
    IF FOUND THEN
        SELECT * INTO o FROM finance.orders WHERE id = l.order_id FOR UPDATE;
    END IF;
    IF o.id IS NULL OR NOT finance.fn_owner_visible(o.owner_type, o.owner_id) THEN
        RAISE EXCEPTION 'That purchase doesn''t exist' USING ERRCODE = 'P0002';
    END IF;
    IF l.item_type <> 'digital_product' THEN
        RAISE EXCEPTION 'Only a digital product can be cancelled here' USING ERRCODE = '22023';
    END IF;
    IF l.status <> 'confirmed' THEN
        RAISE EXCEPTION 'This purchase was already refunded or cancelled' USING ERRCODE = 'PO409';
    END IF;
    v_paid := GREATEST(l.line_total_minor - l.promo_discount_minor, 0);
    IF v_paid = 0 THEN
        RAISE EXCEPTION 'Nothing was paid for this, so there is nothing to refund' USING ERRCODE = 'PO409';
    END IF;
    IF o.fx_conversion_id IS NOT NULL OR o.status = 'invoiced' THEN
        RAISE EXCEPTION 'This order was paid in another currency or on account, so it can''t be cancelled here. Contact support.'
            USING ERRCODE = 'PO409';
    END IF;
    SELECT * INTO e FROM catalogue.entitlements WHERE order_line_id = l.id FOR UPDATE;
    IF e.first_delivered_at IS NOT NULL AND e.delivery_terms_accepted_at IS NOT NULL
       AND COALESCE((SELECT f.enabled FROM security.feature_flags f WHERE f.key = 'finance.delivered_refund_refusal'), false) THEN
        RAISE EXCEPTION 'This file has been downloaded, so it can''t be cancelled. If it didn''t arrive whole or is faulty, report a problem.'
            USING ERRCODE = 'PO409';
    END IF;

    v_credit := l.line_total_minor - l.platform_fee_minor
                - CASE WHEN l.promo_funded_by = 'platform' THEN 0 ELSE l.promo_discount_minor END;
    IF v_credit > 0 THEN
        SELECT * INTO r FROM finance.pending_releases
         WHERE id = finance.fn_line_sale_release(l) AND state = 'pending' AND recovered_cents = 0
           FOR UPDATE;
        IF r.id IS NULL THEN
            RAISE EXCEPTION 'The seller''s earnings from this sale are no longer clearing, so it can''t be cancelled here'
                USING ERRCODE = 'PO409';
        END IF;
        UPDATE finance.pending_releases
           SET recovered_cents = amount_cents, state = 'available', matured_at = pg_catalog.now()
         WHERE id = r.id;
    END IF;

    SELECT x.* INTO w
      FROM finance.transactions t
      JOIN finance.wallets x ON x.id = t.wallet_id
     WHERE t.ref_table = 'orders' AND t.ref_id = o.id AND t.reason = 'order_payment' AND t.direction = 'debit'
     ORDER BY t.created_at, t.id
     LIMIT 1;
    IF w.id IS NULL OR pg_catalog.upper(w.currency) <> pg_catalog.upper(l.currency) THEN
        RAISE EXCEPTION 'This order wasn''t paid from a wallet in its own currency, so it can''t be cancelled here. Contact support.'
            USING ERRCODE = 'PO409';
    END IF;
    PERFORM finance.fn_wallet_credit(w.owner_id, w.owner_type, w.currency, v_paid, 'order_refund', 'order_lines', l.id);
    UPDATE catalogue.entitlements SET status = 'refunded', updated_at = pg_catalog.now() WHERE id = e.id;
    PERFORM finance.fn_record_line_refund(l.id, v_paid);

    SELECT * INTO p FROM catalogue.products WHERE id = l.item_id;
    IF p.owner_user_id IS NOT NULL THEN
        PERFORM comms.fn_notify(
            p.owner_user_id, 'order.line_refunded', 'A purchase was cancelled',
            pg_catalog.format('A buyer cancelled their purchase of "%s" before the sale cleared, so it was refunded and its earnings will not reach your wallet.', l.title),
            'order_lines', l.id,
            pg_catalog.jsonb_build_object('amount_minor', v_paid, 'currency', l.currency)
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'line_id', l.id,
        'status', (SELECT x.status FROM finance.order_lines x WHERE x.id = l.id),
        'refunded_minor', v_paid, 'currency', l.currency);
END;
$$;

-- Give a session forfeit back (user door; FBP DB21 step 3; ruling M8, voluntary): the escrow a seat or
-- sitting paid its provider because the attendee cancelled inside the notice (cancel_cohort_membership:
-- the escrow released, its seat cancelled, its sitting `cancelled_by_client`). Its payee, a person (a
-- team's forfeit is refused until a team can decide one), returns what it paid them: from the release's
-- rows still clearing first (`recovered_cents`), then their Available balance (`forfeit_refund`; the
-- money is theirs to give, so pots are respected and a short balance refuses). The attendee gets the
-- whole price back, the fee included (`escrow_refund`, finance.fn_refund_escrow_to_payer, which also
-- records the order line refunded); the escrow reads `refunded`, so its fee stops counting; and the
-- attendee is told. A forfeit already given back refuses.
CREATE OR REPLACE FUNCTION finance.refund_session_forfeit(p_escrow_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    e finance.escrows;
    r finance.pending_releases;
    w finance.wallets;
    v_left bigint;
    v_take bigint;
    v_from_pending bigint := 0;
    v_back bigint;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to refund a session' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO e FROM finance.escrows WHERE id = p_escrow_id FOR UPDATE;
    IF NOT FOUND OR e.payee_id IS DISTINCT FROM v_uid OR e.payee_type = 'team'::public.assignment_type THEN
        RAISE EXCEPTION 'That session payment doesn''t exist' USING ERRCODE = 'P0002';
    END IF;
    IF e.status <> 'released' OR e.cohort_membership_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM projects.cohort_memberships m WHERE m.id = e.cohort_membership_id AND m.status = 'cancelled')
       OR (e.session_event_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM projects.session_events se
             WHERE se.id = e.session_event_id AND se.status = 'cancelled_by_client'::projects.session_event_status)) THEN
        RAISE EXCEPTION 'Only a session the attendee cancelled inside the notice can be refunded here, once'
            USING ERRCODE = 'PO409';
    END IF;

    v_left := GREATEST(e.amount_cents - e.platform_fee_cents, 0);
    FOR r IN
        SELECT * FROM finance.pending_releases
         WHERE escrow_id = e.id AND state = 'pending' AND recovered_cents < amount_cents
         ORDER BY released_at, id
           FOR UPDATE
    LOOP
        EXIT WHEN v_left = 0;
        v_take := LEAST(v_left, r.amount_cents - r.recovered_cents);
        UPDATE finance.pending_releases
           SET recovered_cents = recovered_cents + v_take,
               state = CASE WHEN recovered_cents + v_take = amount_cents THEN 'available'::finance.fund_state ELSE state END,
               matured_at = CASE WHEN recovered_cents + v_take = amount_cents THEN pg_catalog.now() ELSE matured_at END
         WHERE id = r.id;
        v_left := v_left - v_take;
        v_from_pending := v_from_pending + v_take;
    END LOOP;
    IF v_left > 0 THEN
        SELECT x.* INTO w FROM finance.wallets x
         WHERE x.id = COALESCE(
            (SELECT pr.wallet_id FROM finance.pending_releases pr WHERE pr.escrow_id = e.id ORDER BY pr.released_at LIMIT 1),
            (SELECT t.wallet_id FROM finance.transactions t
              WHERE t.ref_table = 'escrows' AND t.ref_id = e.id AND t.direction = 'credit' AND t.reason = 'escrow_release'
              ORDER BY t.created_at LIMIT 1));
        IF w.id IS NULL THEN
            RAISE EXCEPTION 'escrow: % paid no wallet this door can find', e.id USING ERRCODE = 'PL409';
        END IF;
        PERFORM finance.fn_wallet_debit(w.owner_id, w.owner_type, w.currency, v_left, 'forfeit_refund', 'escrows', e.id);
    END IF;

    UPDATE finance.escrows SET status = 'refunded' WHERE id = e.id;
    v_back := finance.fn_refund_escrow_to_payer(e.id, e.amount_cents, 'escrow_refund');
    IF e.payer_user_id IS NOT NULL THEN
        PERFORM comms.fn_notify(
            e.payer_user_id, 'escrow.refunded', 'Session refunded',
            'The provider refunded a session you cancelled inside the notice, in full.',
            'escrows', e.id,
            pg_catalog.jsonb_build_object('amount_minor', v_back, 'currency', e.currency)
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'escrow_id', e.id, 'refunded_minor', v_back, 'currency', e.currency,
        'recovered_pending_cents', v_from_pending, 'debited_cents', v_left);
END;
$$;

-- The forfeits the caller could give back in one project (read; FBP DB21): what
-- finance.refund_session_forfeit would accept, newest first, as `[{escrow_id, title, amount_minor,
-- currency, cancelled_at}]`. Empty for anyone but their payee.
CREATE OR REPLACE FUNCTION finance.session_forfeits(p_project_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'escrow_id', f.id, 'title', f.title, 'amount_minor', f.amount_cents,
               'currency', f.currency, 'cancelled_at', f.cancelled_at) ORDER BY f.cancelled_at DESC), '[]'::jsonb)
      FROM (
        SELECT e.id, COALESCE(se.title, c.name) AS title, e.amount_cents, e.currency, m.cancelled_at
          FROM finance.escrows e
          JOIN projects.cohort_memberships m ON m.id = e.cohort_membership_id AND m.status = 'cancelled'
          JOIN projects.cohorts c ON c.id = m.cohort_id AND c.project_id = p_project_id
          LEFT JOIN projects.session_events se ON se.id = e.session_event_id
         WHERE e.payee_id = auth.uid() AND e.payee_type <> 'team'::public.assignment_type
           AND e.status = 'released'
           AND (e.session_event_id IS NULL OR se.status = 'cancelled_by_client'::projects.session_event_status)
      ) f;
$$;
-- #endregion

-- #region 2. Withdrawals
-- The smallest withdrawal in a currency, in its minor units (`security.platform_params.min_withdrawal_minor`,
-- an object keyed by currency with a `default`; Decision #202). 0 when unset. Internal.
CREATE OR REPLACE FUNCTION finance.fn_min_withdrawal_minor(p_currency text)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT GREATEST(COALESCE(
        (SELECT (pp.value ->> pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, ''))))::bigint
           FROM security.platform_params pp WHERE pp.key = 'min_withdrawal_minor'),
        (SELECT (pp.value ->> 'default')::bigint
           FROM security.platform_params pp WHERE pp.key = 'min_withdrawal_minor'),
        0
    ), 0);
$$;

-- A minor-unit amount in major units for a refusal sentence, grouped, with its currency's ISO 4217
-- decimals from finance.fn_currency_exponent (00001200): "1,234.56", JPY "1,234", KWD "1.234". Internal.
CREATE OR REPLACE FUNCTION finance.fn_minor_units_text(p_amount bigint, p_currency text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.to_char(
               p_amount / pg_catalog.power(10::numeric, x.e),
               'FM9,999,999,999,999,999,990' || CASE WHEN x.e > 0 THEN '.' || pg_catalog.repeat('0', x.e) ELSE '' END)
      FROM (SELECT finance.fn_currency_exponent(p_currency) AS e) x;
$$;

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
-- The amount must reach the currency's minimum (finance.fn_min_withdrawal_minor). A named destination
-- (`p_destination_method_id`) must be one of the wallet owner's ACTIVE payout methods; it is recorded
-- on the payout and stamped on the transfer. The transfer itself always goes to the owner's verified
-- Connect account, recorded as `destination_account` (Decision #202).
--
-- Idempotent on the caller's attempt key (scope `payout:<uid>`), exactly like begin_card_payment; the
-- key binds the destination too.
-- An Instant payout is recorded (`instant`) but carries no fee here: the Instant Payout fee magnitude
-- is still undecided platform-wide (Decision #55(c)), and a fee nobody set must not be charged.
--
-- AML (Decision #529): a withdrawal that is rapid churn (finance.fn_aml_churn) records a `rapid_churn`
-- signal beside its payout. With the ⚖️ Safety Hold on (`aml_safety_hold_enabled`, off by default) a
-- held withdrawal moves nothing: no payout, no debit, no attempt key, one `safety_hold` signal, and the
-- answer `{held: true, held_until}` rather than an error, so the record of the attempt is kept. Retrying
-- the same key after `held_until` withdraws.
CREATE OR REPLACE FUNCTION finance.begin_payout(
    p_wallet_id uuid,
    p_amount bigint,
    p_currency text,
    p_instant boolean,
    p_idempotency_key text,
    p_destination_method_id uuid DEFAULT NULL
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
    v_method finance.payment_methods;
    v_min bigint;
    v_payout finance.payouts;
    v_tx uuid;
    v_churn record;
    v_churn_facts jsonb;
    v_held_until timestamptz;
    v_hold_triggers text[];
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to withdraw' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
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
    v_hash := pg_catalog.md5(pg_catalog.concat_ws(
        '|', p_wallet_id, p_amount, v_currency, COALESCE(p_instant, false), p_destination_method_id
    ));
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
            v_wallet.owner_type IN ('team', 'business', 'enterprise')
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
    -- Earnings that reached a person's `user` wallet (a team share, a finder's fee) or a team vault
    -- leave only with a verified withdrawer (Decision #196); a buyer's refund balance never needs ID.
    IF v_wallet.owner_type IN ('user', 'team')
       AND finance.fn_wallet_holds_earnings(v_wallet.id)
       AND NOT finance.fn_freelancer_payout_ready(v_uid) THEN
        RAISE EXCEPTION 'verification: verify your identity and set up payouts before withdrawing money you earned'
            USING ERRCODE = 'PK403';
    END IF;
    IF finance.fn_kyb_missing(v_wallet.owner_type, v_wallet.owner_id) THEN
        RAISE EXCEPTION 'verification: this % must be verified (KYB) before its vault can pay out', v_wallet.owner_type
            USING ERRCODE = 'PK403';
    END IF;
    v_destination := finance.fn_payout_destination(v_wallet);
    IF v_destination IS NULL THEN
        RAISE EXCEPTION 'destinationId: set up a verified payout account before withdrawing'
            USING ERRCODE = 'PA403';
    END IF;
    -- A named destination: the wallet owner's own (by the person-type rule fn_payout_destination uses),
    -- and one that can receive payouts. Somebody else's method reads exactly like one that does not exist.
    IF p_destination_method_id IS NOT NULL THEN
        SELECT * INTO v_method FROM finance.payment_methods m
         WHERE m.id = p_destination_method_id
           AND m.owner_id = v_wallet.owner_id
           AND (
                m.owner_type = v_wallet.owner_type
                OR (v_wallet.owner_type IN ('user', 'freelancer') AND m.owner_type IN ('user', 'freelancer'))
           );
        IF NOT FOUND THEN
            RAISE EXCEPTION 'destinationId: choose one of this wallet''s payout accounts' USING ERRCODE = '42501';
        END IF;
        IF v_method.method_role NOT IN ('payout', 'both') OR v_method.status <> 'active' THEN
            RAISE EXCEPTION 'destinationId: that payout account can''t receive payouts — choose another'
                USING ERRCODE = 'PA403';
        END IF;
    END IF;
    -- After the gates, so a person who cannot withdraw at all is told why before being told the amount.
    v_min := finance.fn_min_withdrawal_minor(v_currency);
    IF p_amount < v_min THEN
        RAISE EXCEPTION 'amountMinor: the smallest withdrawal is % %', finance.fn_minor_units_text(v_min, v_currency), v_currency
            USING ERRCODE = '22023';
    END IF;
    IF v_wallet.balance_cents < p_amount THEN
        RAISE EXCEPTION 'amountMinor: that is more than this wallet holds' USING ERRCODE = 'PF402';
    END IF;

    SELECT * INTO v_churn FROM finance.fn_aml_churn(v_uid, v_wallet.id, p_amount, v_currency, pg_catalog.now());
    IF FOUND THEN
        v_churn_facts := pg_catalog.jsonb_build_object(
            'in_minor', v_churn.in_minor, 'payments', v_churn.payments, 'last_in_at', v_churn.last_in_at,
            'min_minor', v_churn.min_minor, 'window_hours', v_churn.window_hours
        );
    END IF;
    SELECT h.held_until, h.triggers INTO v_held_until, v_hold_triggers
      FROM finance.fn_safety_hold(v_uid, v_wallet.id, p_amount, v_currency, pg_catalog.now()) h;
    IF v_held_until IS NOT NULL THEN
        INSERT INTO finance.aml_signals (kind, subject_user_id, wallet_id, amount_minor, currency, facts)
        VALUES ('safety_hold', v_uid, v_wallet.id, p_amount, v_currency, pg_catalog.jsonb_strip_nulls(
            pg_catalog.jsonb_build_object(
                'held_until', v_held_until, 'triggers', pg_catalog.to_jsonb(v_hold_triggers),
                'instant', COALESCE(p_instant, false), 'churn', v_churn_facts
            )
        ));
        RETURN pg_catalog.jsonb_build_object(
            'held', true, 'held_until', v_held_until, 'wallet_id', v_wallet.id,
            'amount_cents', p_amount, 'currency', v_currency, 'replayed', false
        );
    END IF;

    INSERT INTO finance.payouts (
        wallet_id, destination_method_id, amount_cents, currency, status, instant, provider, destination_account
    ) VALUES (
        v_wallet.id, p_destination_method_id, p_amount, v_currency, 'pending', COALESCE(p_instant, false), 'stripe',
        v_destination
    )
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

    IF v_churn_facts IS NOT NULL THEN
        INSERT INTO finance.aml_signals (kind, subject_user_id, wallet_id, payout_id, amount_minor, currency, facts)
        VALUES ('rapid_churn', v_uid, v_wallet.id, v_payout.id, p_amount, v_currency, v_churn_facts);
    END IF;

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

-- The processor definitively refused the transfer, or the stale-payout sweep found none to complete it
-- with (processor door): return the debited money to the wallet (reason `payout_reversal`), record the
-- reason and tell a person owner. Only a still-pending payout can fail — a paid one is reversed
-- through the processor (record_transfer_reversed), never here. A payout a schedule made counts once
-- against that schedule (finance.fn_payout_schedule_strike). Idempotent.
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
    IF v_payout.schedule_id IS NOT NULL THEN
        PERFORM finance.fn_payout_schedule_strike(
            v_payout.schedule_id,
            'Stripe couldn''t send the payout' || COALESCE(' (' || v_payout.failure_reason || ')', '') || '.'
        );
    END IF;
    IF v_wallet.owner_type IN ('user', 'freelancer') THEN
        PERFORM comms.fn_notify(
            v_wallet.owner_id, 'payout.failed', 'Your withdrawal couldn''t be sent',
            'Stripe couldn''t send this withdrawal. The money is back in your wallet.',
            'payouts', v_payout.id,
            pg_catalog.jsonb_build_object('amount_cents', v_payout.amount_cents, 'currency', v_payout.currency)
        );
    END IF;
    RETURN pg_catalog.to_jsonb(v_payout) || pg_catalog.jsonb_build_object('replayed', false);
END;
$$;

-- `transfer.reversed` (processor door): the platform pulled some or all of a payout's transfer back
-- from the connected account. The event carries the transfer's CUMULATIVE `amount_reversed`, so the
-- door credits only what is newly reversed (reason `payout_reversal`) — a replay, a duplicate or an
-- out-of-order lower total credits nothing. A full reversal makes the payout `reversed`; a partial one
-- stays `paid` with `reversed_cents`. The transfer must agree with the payout it names (as in
-- record_transfer_created); a reversal of a payout already returned by fail_payout is logged for ops
-- and moves nothing. Idempotent on the event id and by value (Decision #202).
CREATE OR REPLACE FUNCTION finance.record_transfer_reversed(
    p_event_id text,
    p_transfer_ref text,
    p_destination text,
    p_amount bigint,
    p_amount_reversed bigint,
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
    v_wallet finance.wallets;
    v_currency text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, '')));
    v_total bigint;
    v_delta bigint;
    v_owner uuid;
BEGIN
    IF NOT finance.fn_claim_stripe_event(p_event_id, 'transfer.reversed') THEN
        RETURN finance.fn_stripe_event_replay(p_event_id);
    END IF;

    SELECT * INTO v_payout FROM finance.payouts
     WHERE id = COALESCE(
        (SELECT p.id FROM finance.payouts p WHERE p.provider = 'stripe' AND p.provider_ref = p_transfer_ref),
        p_payout_id
     )
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'the reversed transfer names no Projective payout',
            'transfer', p_transfer_ref));
    END IF;
    IF v_payout.provider <> 'stripe'
       OR v_payout.amount_cents <> p_amount
       OR pg_catalog.upper(v_payout.currency) <> v_currency
       OR p_amount_reversed IS NULL OR p_amount_reversed < 0
       OR (v_payout.provider_ref IS NOT NULL AND v_payout.provider_ref <> p_transfer_ref)
       OR NOT EXISTS (
            SELECT 1
              FROM finance.payout_accounts a
              JOIN finance.wallets w ON w.id = v_payout.wallet_id
             WHERE a.provider = 'stripe' AND a.account_id = p_destination
               AND a.owner_id = w.owner_id
               AND (
                    a.owner_type = w.owner_type
                    OR (w.owner_type IN ('user', 'freelancer') AND a.owner_type IN ('user', 'freelancer'))
               )
       ) THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'the reversed transfer does not agree with the payout it names',
            'transfer', p_transfer_ref, 'payout_id', v_payout.id));
    END IF;
    IF v_payout.status IN ('failed', 'cancelled') THEN
        INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
        VALUES (
            'payout:' || v_payout.id::text, 'error',
            pg_catalog.format('Transfer %s was reversed for payout %s, which was already returned to its wallet', p_transfer_ref, v_payout.id),
            pg_catalog.now(), 'server', 'finance.payouts',
            pg_catalog.jsonb_build_object('payout_id', v_payout.id, 'transfer', p_transfer_ref, 'amount_reversed', p_amount_reversed)
        );
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'the payout was already returned to its wallet',
            'transfer', p_transfer_ref, 'payout_id', v_payout.id));
    END IF;

    v_total := LEAST(p_amount_reversed, v_payout.amount_cents);
    v_delta := v_total - v_payout.reversed_cents;
    IF v_delta <= 0 THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'applied', 'detail', 'nothing more was reversed',
            'transfer', p_transfer_ref, 'payout_id', v_payout.id));
    END IF;

    SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_payout.wallet_id FOR UPDATE;
    PERFORM finance.fn_wallet_credit(
        v_wallet.owner_id, v_wallet.owner_type, v_wallet.currency, v_delta, 'payout_reversal', 'payouts', v_payout.id
    );
    UPDATE finance.payouts
       SET provider_ref = p_transfer_ref,
           reversed_cents = v_total,
           status = CASE WHEN v_total = amount_cents THEN 'reversed'::finance.payout_status
                         ELSE 'paid'::finance.payout_status END,
           settled_at = COALESCE(settled_at, pg_catalog.now())
     WHERE id = v_payout.id
    RETURNING * INTO v_payout;

    IF v_wallet.owner_type IN ('user', 'freelancer') THEN
        v_owner := v_wallet.owner_id;
        PERFORM comms.fn_notify(
            v_owner, 'payout.reversed', 'Payout returned to your wallet',
            CASE WHEN v_payout.status = 'reversed'
                 THEN 'A withdrawal was reversed. The whole amount is back in your wallet.'
                 ELSE 'Part of a withdrawal was reversed. That part is back in your wallet.' END,
            'payouts', v_payout.id,
            pg_catalog.jsonb_build_object('amount_cents', v_delta, 'currency', v_payout.currency)
        );
    END IF;
    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied', 'payout_id', v_payout.id, 'transfer', p_transfer_ref,
        'credited_cents', v_delta, 'status', v_payout.status));
END;
$$;

-- Connect `payout.paid` / `payout.failed` / `payout.canceled` (processor door): the connected
-- account's own payout to its bank. The fat service resolves which transfers that bank payout carried
-- (its balance transactions) and any earlier failed or cancelled bank payouts it re-pays; this door
-- records the outcome on every Projective payout among them that belongs to the account's owner.
-- Nothing moves in the ledger: the money left Projective with the transfer, and a failed or cancelled
-- bank payout returns to the connected account's Stripe balance, where Stripe pays it out again
-- (Decision #337, ruling M9, as built in #202 (a)). It is not the refused-transfer path
-- (finance.fail_payout), which credits the wallet. A failure or a cancellation is final for its own
-- bank payout (a late `paid` for it changes nothing); a later bank payout that re-pays it marks it
-- paid. The account's person owner is told on a failure or a cancellation, and on a payout that
-- landed. Idempotent on the event id (Decision #202).
CREATE OR REPLACE FUNCTION finance.record_bank_payout(
    p_event_id text,
    p_event_type text,
    p_account text,
    p_bank_payout_ref text,
    p_status text,
    p_failure_code text,
    p_transfer_refs text[],
    p_prior_payout_refs text[],
    p_livemode boolean
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_account finance.payout_accounts;
    v_code text := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_failure_code, '')), 80), '');
    v_ids uuid[];
BEGIN
    IF p_status IS NULL OR p_status NOT IN ('paid', 'failed', 'canceled') THEN
        RAISE EXCEPTION 'status: expected paid, failed or canceled' USING ERRCODE = '22023';
    END IF;
    IF p_bank_payout_ref IS NULL OR p_bank_payout_ref !~ '^po_[A-Za-z0-9_]{1,250}$' THEN
        RAISE EXCEPTION 'payout: expected a Stripe payout id' USING ERRCODE = '22023';
    END IF;
    IF NOT finance.fn_claim_stripe_event(p_event_id, p_event_type) THEN
        RETURN finance.fn_stripe_event_replay(p_event_id);
    END IF;

    SELECT * INTO v_account FROM finance.payout_accounts
     WHERE provider = 'stripe' AND account_id = p_account
     ORDER BY updated_at DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'no payout account is recorded for that account',
            'bank_payout', p_bank_payout_ref));
    END IF;

    WITH hit AS (
        UPDATE finance.payouts p
           SET bank_status = p_status,
               bank_payout_ref = p_bank_payout_ref,
               bank_failure_code = CASE WHEN p_status = 'failed' THEN v_code END,
               bank_status_at = pg_catalog.now()
          FROM finance.wallets w
         WHERE w.id = p.wallet_id
           AND p.provider = 'stripe'
           AND p.status IN ('paid', 'reversed')
           AND (
                p.provider_ref = ANY (COALESCE(p_transfer_refs, '{}'::text[]))
                OR p.bank_payout_ref = ANY (COALESCE(p_prior_payout_refs, '{}'::text[]))
                OR p.bank_payout_ref = p_bank_payout_ref
           )
           AND w.owner_id = v_account.owner_id
           AND (
                w.owner_type = v_account.owner_type
                OR (w.owner_type IN ('user', 'freelancer') AND v_account.owner_type IN ('user', 'freelancer'))
           )
           -- A failure or a cancellation is final for its own bank payout, and one of an earlier bank
           -- payout never undoes a later one that paid.
           AND NOT (
                p_status = 'paid' AND COALESCE(p.bank_status, '') IN ('failed', 'canceled')
                AND p.bank_payout_ref IS NOT DISTINCT FROM p_bank_payout_ref
           )
           AND NOT (
                p_status IN ('failed', 'canceled') AND p.bank_status IS NOT DISTINCT FROM 'paid'
                AND p.bank_payout_ref IS DISTINCT FROM p_bank_payout_ref
           )
        RETURNING p.id
    )
    SELECT pg_catalog.array_agg(hit.id) INTO v_ids FROM hit;

    IF v_account.owner_type IN ('user', 'freelancer') THEN
        IF p_status = 'failed' THEN
            PERFORM comms.fn_notify(
                v_account.owner_id, 'payout.failed', 'Your bank couldn''t accept a payout',
                'Stripe couldn''t pay your bank account. Update your payout details — the money waits in your payout account until then.',
                'payouts', v_ids[1],
                pg_catalog.jsonb_build_object('failure_code', v_code, 'payouts', COALESCE(pg_catalog.cardinality(v_ids), 0))
            );
        ELSIF p_status = 'canceled' THEN
            PERFORM comms.fn_notify(
                v_account.owner_id, 'payout.failed', 'A payout to your bank was cancelled',
                'Stripe cancelled a payout to your bank account before it was sent. The money is back in your payout account and is paid out again.',
                'payouts', v_ids[1],
                pg_catalog.jsonb_build_object('bank_status', 'canceled', 'payouts', COALESCE(pg_catalog.cardinality(v_ids), 0))
            );
        ELSIF v_ids IS NOT NULL THEN
            PERFORM comms.fn_notify(
                v_account.owner_id, 'payout.paid', 'Payout arrived at your bank',
                'Your withdrawal has reached your bank account.',
                'payouts', v_ids[1],
                pg_catalog.jsonb_build_object('payouts', pg_catalog.cardinality(v_ids))
            );
        END IF;
    END IF;

    IF v_ids IS NULL AND p_status = 'paid' THEN
        RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
            'outcome', 'unmatched', 'detail', 'the bank payout carried no Projective payout',
            'bank_payout', p_bank_payout_ref));
    END IF;
    RETURN finance.fn_complete_stripe_event(p_event_id, pg_catalog.jsonb_build_object(
        'outcome', 'applied', 'bank_payout', p_bank_payout_ref, 'status', p_status,
        'payouts', COALESCE(pg_catalog.to_jsonb(v_ids), '[]'::jsonb)));
END;
$$;

-- Claim the payouts stuck in `pending` (scheduler door): older than `payout_stale_minutes` and not
-- claimed within that window, oldest first, at most `p_limit` (capped at 200). Each claim takes a
-- lease (`swept_at`) and counts the attempt, under SKIP LOCKED, so two sweeps never work one payout.
-- The fat service then finds the transfer at Stripe and completes or fails each one (Decision #202).
-- Returns the claimed rows with the connected account each was sent to. Service role only.
CREATE OR REPLACE FUNCTION finance.fn_claim_stale_payouts(p_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_minutes integer;
    v_cutoff timestamptz;
    v_rows jsonb;
BEGIN
    SELECT (pp.value #>> '{}')::integer INTO v_minutes
      FROM security.platform_params pp WHERE pp.key = 'payout_stale_minutes';
    v_cutoff := pg_catalog.now() - pg_catalog.make_interval(mins => GREATEST(COALESCE(v_minutes, 15), 1));

    WITH due AS (
        SELECT p.id
          FROM finance.payouts p
         WHERE p.status = 'pending' AND p.provider = 'stripe'
           AND p.initiated_at < v_cutoff
           AND (p.swept_at IS NULL OR p.swept_at < v_cutoff)
         ORDER BY p.initiated_at
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 25), 200), 1)
           FOR UPDATE SKIP LOCKED
    ), claimed AS (
        UPDATE finance.payouts p
           SET swept_at = pg_catalog.now(), sweep_attempts = p.sweep_attempts + 1
          FROM due
         WHERE p.id = due.id
        RETURNING p.*
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', c.id,
               'wallet_id', c.wallet_id,
               'amount_cents', c.amount_cents,
               'currency', c.currency,
               'destination_account', COALESCE(c.destination_account, finance.fn_payout_destination(w)),
               'destination_method_id', c.destination_method_id,
               'initiated_at', c.initiated_at,
               'sweep_attempts', c.sweep_attempts
           ) ORDER BY c.initiated_at), '[]'::jsonb)
      INTO v_rows
      FROM claimed c
      JOIN finance.wallets w ON w.id = c.wallet_id;
    RETURN v_rows;
END;
$$;

-- ── Payout schedules (Decision #337, ruling M6; FINANCE_AUDIT A14) ──────────────────────────────
-- A schedule is the owner's standing withdrawal in one currency: weekly (each Monday, 00:00 UTC),
-- monthly (the 1st, 00:00 UTC) or threshold (whenever Available reaches `threshold_cents`). Clients
-- only read finance.payout_schedules; save_payout_schedule writes it and the scheduler runs it, every
-- run a withdrawal made BY the schedule's author through finance.begin_payout itself.

-- The calendar slot after `p_after` at which a weekly or monthly schedule next runs (UTC); NULL for
-- manual and threshold. Internal.
CREATE OR REPLACE FUNCTION finance.fn_payout_schedule_next_run(p_mode finance.payout_mode, p_after timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_mode
        WHEN 'scheduled_weekly'::finance.payout_mode
            THEN (pg_catalog.date_trunc('week', p_after AT TIME ZONE 'UTC') + interval '1 week') AT TIME ZONE 'UTC'
        WHEN 'scheduled_monthly'::finance.payout_mode
            THEN (pg_catalog.date_trunc('month', p_after AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'
    END;
$$;

-- What a schedule's run pays out of its wallet: the whole of Available, the balance minus what its
-- pots earmark (finance.fn_available_cents, Decision #337, ruling M6). The one place that amount is
-- worked out, so the threshold test and the amount paid can never disagree. Internal.
CREATE OR REPLACE FUNCTION finance.fn_payout_schedule_available(p_wallet finance.wallets)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT GREATEST(COALESCE(finance.fn_available_cents(p_wallet.id), 0), 0);
$$;

-- Count one refused run against a schedule (internal): its reason is kept as a sentence in
-- `last_error`, and the third refusal in a row pauses the schedule (`active = false`) and tells its
-- author. Nothing retries: the next slot (for a threshold, the next sweep) is the next attempt, and a
-- paused schedule runs again only once somebody saves it.
CREATE OR REPLACE FUNCTION finance.fn_payout_schedule_strike(p_schedule uuid, p_reason text)
RETURNS finance.payout_schedules
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_reason text := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_reason, ''), '^[A-Za-z_]+:\s*', ''));
    v_was_active boolean;
    v_row finance.payout_schedules;
BEGIN
    IF v_reason = '' THEN
        v_reason := 'The payout could not be sent.';
    ELSE
        v_reason := pg_catalog.upper(pg_catalog.left(v_reason, 1)) || pg_catalog.substr(v_reason, 2);
        IF v_reason !~ '[.!?]$' THEN
            v_reason := v_reason || '.';
        END IF;
    END IF;
    SELECT s.active INTO v_was_active FROM finance.payout_schedules s WHERE s.id = p_schedule FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'schedule: not found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE finance.payout_schedules s
       SET failure_count = s.failure_count + 1,
           last_error = pg_catalog.left(v_reason, 400),
           active = s.active AND s.failure_count + 1 < 3
     WHERE s.id = p_schedule
    RETURNING * INTO v_row;
    IF v_was_active AND NOT v_row.active AND v_row.created_by IS NOT NULL THEN
        PERFORM comms.fn_notify(
            v_row.created_by, 'payout.schedule_paused', 'Scheduled payouts paused',
            'Three scheduled payouts in a row couldn''t be sent, so payouts are manual until you save the schedule again. '
                || v_row.last_error,
            'payout_schedules', v_row.id,
            pg_catalog.jsonb_build_object(
                'currency', v_row.currency, 'mode', v_row.mode, 'failure_count', v_row.failure_count
            )
        );
    END IF;
    RETURN v_row;
END;
$$;

-- Save the owner's payout schedule for one currency (user door). A schedule IS a standing withdrawal,
-- so it takes a withdrawal's authority (as begin_payout checks it): the owner of a personal wallet,
-- `withdraw` on that currency's shared wallet. A destination must be one of the owner's own ACTIVE
-- payout methods, and a threshold at least the currency's minimum withdrawal. Instant Payouts are
-- Planned (Decision #337, ruling P3), so `p_instant = true` is refused `instant_payout_planned`. The
-- caller becomes the schedule's author (`created_by`), whom every later run withdraws as. A save starts
-- the schedule clean (active, no failures, the next slot of its mode); `manual` is the off switch, and
-- a schedule is never deleted. One row per (owner, currency); writes one security.audit_logs row.
CREATE OR REPLACE FUNCTION finance.save_payout_schedule(
    p_owner_type text,
    p_owner_id uuid,
    p_currency text,
    p_mode finance.payout_mode,
    p_threshold_cents bigint DEFAULT NULL,
    p_destination_method_id uuid DEFAULT NULL,
    p_instant boolean DEFAULT false
)
RETURNS finance.payout_schedules
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
    v_min bigint;
    v_before finance.payout_schedules;
    v_row finance.payout_schedules;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to change payouts' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
    IF p_mode IS NULL THEN
        RAISE EXCEPTION 'mode: choose how payouts run' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_instant, false) THEN
        RAISE EXCEPTION 'instant_payout_planned: Instant payouts are planned and not available yet'
            USING ERRCODE = '0A000';
    END IF;
    IF v_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'currency: expected a three-letter currency code' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_wallet FROM finance.wallets w
     WHERE w.owner_type = p_owner_type AND w.owner_id = p_owner_id
       AND pg_catalog.upper(w.currency) = v_currency;
    IF NOT FOUND THEN
        IF finance.fn_owner_capability(p_owner_type, p_owner_id, 'withdraw'::finance.vault_capability) THEN
            RAISE EXCEPTION 'currency: this account holds no %', v_currency USING ERRCODE = 'P0002';
        END IF;
        RAISE EXCEPTION 'auth: only a member who may withdraw can change payouts' USING ERRCODE = '42501';
    END IF;
    IF NOT (
        (v_wallet.owner_type IN ('user', 'freelancer') AND v_wallet.owner_id = v_uid)
        OR (
            v_wallet.owner_type IN ('team', 'business', 'enterprise')
            AND finance.fn_has_vault_capability(v_wallet.id, v_uid, 'withdraw'::finance.vault_capability)
        )
    ) THEN
        RAISE EXCEPTION 'auth: only a member who may withdraw can change payouts' USING ERRCODE = '42501';
    END IF;
    IF p_destination_method_id IS NOT NULL THEN
        SELECT * INTO v_method FROM finance.payment_methods m
         WHERE m.id = p_destination_method_id
           AND m.owner_id = v_wallet.owner_id
           AND (
                m.owner_type = v_wallet.owner_type
                OR (v_wallet.owner_type IN ('user', 'freelancer') AND m.owner_type IN ('user', 'freelancer'))
           );
        IF NOT FOUND THEN
            RAISE EXCEPTION 'destinationId: choose one of this wallet''s payout accounts' USING ERRCODE = '42501';
        END IF;
        IF v_method.method_role NOT IN ('payout', 'both') OR v_method.status <> 'active' THEN
            RAISE EXCEPTION 'destinationId: that payout account can''t receive payouts — choose another'
                USING ERRCODE = 'PA403';
        END IF;
    END IF;
    IF p_mode = 'threshold' THEN
        IF p_threshold_cents IS NULL OR p_threshold_cents <= 0 THEN
            RAISE EXCEPTION 'thresholdMinor: enter the balance that triggers a payout' USING ERRCODE = '22023';
        END IF;
        v_min := finance.fn_min_withdrawal_minor(v_currency);
        IF p_threshold_cents < v_min THEN
            RAISE EXCEPTION 'thresholdMinor: the smallest payout is % %', finance.fn_minor_units_text(v_min, v_currency), v_currency
                USING ERRCODE = '22023';
        END IF;
    END IF;

    SELECT * INTO v_before FROM finance.payout_schedules s
     WHERE s.owner_type = v_wallet.owner_type AND s.owner_id = v_wallet.owner_id AND s.currency = v_wallet.currency
       FOR UPDATE;
    INSERT INTO finance.payout_schedules AS s (
        owner_type, owner_id, currency, mode, threshold_cents, destination_method_id, instant, active,
        next_run_at, created_by, failure_count, last_error
    ) VALUES (
        v_wallet.owner_type, v_wallet.owner_id, v_wallet.currency, p_mode,
        CASE WHEN p_mode = 'threshold' THEN p_threshold_cents END,
        p_destination_method_id, false, true,
        finance.fn_payout_schedule_next_run(p_mode, pg_catalog.now()), v_uid, 0, NULL
    )
    ON CONFLICT (owner_type, owner_id, currency) DO UPDATE
       SET mode = EXCLUDED.mode,
           threshold_cents = EXCLUDED.threshold_cents,
           destination_method_id = EXCLUDED.destination_method_id,
           instant = false,
           active = true,
           next_run_at = EXCLUDED.next_run_at,
           created_by = EXCLUDED.created_by,
           failure_count = 0,
           last_error = NULL
    RETURNING * INTO v_row;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (
        v_uid, 'payout_schedule.saved', 'finance.payout_schedules', v_row.id,
        pg_catalog.jsonb_build_object(
            'currency', v_row.currency,
            'mode', pg_catalog.jsonb_build_object('from', v_before.mode, 'to', v_row.mode),
            'threshold_cents', pg_catalog.jsonb_build_object('from', v_before.threshold_cents, 'to', v_row.threshold_cents),
            'destination_method_id', pg_catalog.jsonb_build_object(
                'from', v_before.destination_method_id, 'to', v_row.destination_method_id
            ),
            'created_by', pg_catalog.jsonb_build_object('from', v_before.created_by, 'to', v_row.created_by)
        )
    );
    RETURN v_row;
END;
$$;

-- Run the payout schedules that are due (processor door, the scheduler's): each active weekly or
-- monthly schedule whose slot has come (`next_run_at <= now()`) and each active threshold schedule
-- whose Available has reached `threshold_cents`, oldest first, at most `p_limit` (capped at 200), under
-- FOR UPDATE SKIP LOCKED so two sweeps never run one schedule. In this ONE transaction each one:
--   1. advances — `next_run_at` to the next slot after now() (a missed slot is skipped, never paid in a
--      burst: the run pays everything Available) and `last_run_at` to now;
--   2. is skipped (`skipped`, no strike) while Available is below the currency's minimum withdrawal;
--   3. otherwise withdraws the whole of Available AS ITS AUTHOR through finance.begin_payout — adulthood
--      and `withdraw` re-checked now, payout readiness, KYB, a verified payout account, the destination,
--      the minimum, the debit — on the attempt key `payout_schedule:<schedule>:<run_at>`, and tags the
--      payout with the schedule (`payouts.schedule_id`); a paid run clears its failure count;
--   4. on a refusal moves no money and counts it against the schedule (fn_payout_schedule_strike).
-- Returns one entry per schedule claimed; a `begun` entry carries the debited payout and its Connect
-- destination, which the fat service sends as a Stripe Transfer exactly as it sends a manual
-- withdrawal's. The debit is taken in the claim's own transaction, so neither a second sweep nor a
-- spend between the claim and the transfer can pay the same Available twice or turn a run into a
-- refusal.
CREATE OR REPLACE FUNCTION finance.fn_claim_due_payout_schedules(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    s finance.payout_schedules;
    v_wallet finance.wallets;
    v_available bigint;
    v_min bigint;
    v_run_at timestamptz;
    v_key text;
    v_prev_sub text;
    v_begun jsonb;
    v_state text;
    v_message text;
    v_struck finance.payout_schedules;
    v_out jsonb := '[]'::jsonb;
BEGIN
    FOR s IN
        SELECT p.*
          FROM finance.payout_schedules p
          JOIN finance.wallets w
            ON w.owner_type = p.owner_type AND w.owner_id = p.owner_id AND w.currency = p.currency
         WHERE p.active
           AND (
                (p.mode IN ('scheduled_weekly', 'scheduled_monthly') AND p.next_run_at <= pg_catalog.now())
                OR (p.mode = 'threshold' AND finance.fn_payout_schedule_available(w) >= p.threshold_cents)
           )
         ORDER BY COALESCE(p.next_run_at, p.last_run_at, p.created_at), p.id
         LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1)
           FOR UPDATE OF p SKIP LOCKED
    LOOP
        SELECT * INTO v_wallet FROM finance.wallets w
         WHERE w.owner_type = s.owner_type AND w.owner_id = s.owner_id AND w.currency = s.currency
           FOR UPDATE;
        v_run_at := CASE
            WHEN s.mode = 'threshold' THEN pg_catalog.date_trunc('second', pg_catalog.now())
            ELSE s.next_run_at
        END;
        UPDATE finance.payout_schedules
           SET next_run_at = finance.fn_payout_schedule_next_run(s.mode, pg_catalog.now()),
               last_run_at = pg_catalog.now()
         WHERE id = s.id;

        v_available := finance.fn_payout_schedule_available(v_wallet);
        v_min := GREATEST(finance.fn_min_withdrawal_minor(s.currency), 1);
        IF v_available < v_min THEN
            v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'schedule_id', s.id, 'run_at', v_run_at, 'outcome', 'skipped', 'detail', 'below_minimum',
                'amount_cents', v_available, 'currency', s.currency
            ));
            CONTINUE;
        END IF;

        v_key := 'payout_schedule:' || s.id::text || ':'
            || pg_catalog.to_char(v_run_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');
        v_prev_sub := pg_catalog.current_setting('request.jwt.claim.sub', true);
        BEGIN
            IF s.created_by IS NULL THEN
                RAISE EXCEPTION 'auth: the person who set up these payouts is no longer available'
                    USING ERRCODE = '42501';
            END IF;
            PERFORM pg_catalog.set_config('request.jwt.claim.sub', s.created_by::text, true);
            v_begun := finance.begin_payout(v_wallet.id, v_available, s.currency, false, v_key, s.destination_method_id);
            PERFORM pg_catalog.set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
            -- A Safety Hold (Decision #529) moved nothing and is no refusal of the schedule: the run is
            -- skipped, never struck, and the next slot tries again.
            IF COALESCE((v_begun ->> 'held')::boolean, false) THEN
                v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                    'schedule_id', s.id, 'run_at', v_run_at, 'outcome', 'skipped', 'detail', 'safety_hold',
                    'amount_cents', v_available, 'currency', s.currency
                ));
                CONTINUE;
            END IF;
            UPDATE finance.payouts SET schedule_id = s.id WHERE id = (v_begun ->> 'id')::uuid;
            UPDATE finance.payout_schedules SET failure_count = 0, last_error = NULL WHERE id = s.id;
            v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'schedule_id', s.id, 'run_at', v_run_at, 'outcome', 'begun',
                'amount_cents', v_available, 'currency', s.currency,
                'payout', (v_begun - 'destination' - 'replayed') || pg_catalog.jsonb_build_object('schedule_id', s.id),
                'destination', v_begun -> 'destination',
                'replayed', COALESCE((v_begun ->> 'replayed')::boolean, false)
            ));
        EXCEPTION WHEN OTHERS THEN
            -- The block's subtransaction is undone: no payout, no debit, and the claims are the sweep's again.
            GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
            v_struck := finance.fn_payout_schedule_strike(s.id, v_message);
            IF v_state NOT IN ('42501', 'PK403', 'PA403', 'PM403', 'PF402', '22023', 'P0002', '55000') THEN
                INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
                VALUES (
                    'payout_schedule:' || s.id::text, 'error',
                    pg_catalog.format('Payout schedule %s failed unexpectedly (%s): %s', s.id, v_state, v_message),
                    pg_catalog.now(), 'server', 'finance.fn_claim_due_payout_schedules',
                    pg_catalog.jsonb_build_object('schedule_id', s.id, 'sqlstate', v_state, 'run_at', v_run_at)
                );
            END IF;
            v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                'schedule_id', s.id, 'run_at', v_run_at, 'outcome', 'refused',
                'detail', v_struck.last_error, 'code', v_state, 'paused', NOT v_struck.active,
                'amount_cents', v_available, 'currency', s.currency
            ));
        END;
    END LOOP;
    RETURN v_out;
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
-- A card saved to a TEAM, BUSINESS or ENTERPRISE is recorded as that entity's business card
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
    IF p_owner_type IS NULL OR p_owner_type NOT IN ('user', 'freelancer', 'business', 'team', 'enterprise')
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
            p_owner_type IN ('team', 'business', 'enterprise')
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
-- An archived business's wallet takes no standing top-up (55000 `business_not_active:`, Decision
-- #248 (k)); each run is re-checked when it falls due (finance.fn_deposit_charge_target).
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

-- Pause, resume, re-price or archive a standing top-up (user door, FINANCE_COMPLETENESS_AUDIT A13).
-- Clients hold SELECT only on finance.deposit_rules (00002013), so this is the one way to change a
-- rule. It takes the authority that creates one: the owner of a personal wallet, `add_funds` on a
-- shared one. What it may change is the amount and whether the rule runs; the wallet, currency, card
-- and interval are the rule's identity (trg_deposit_rules_immutable) — a different one is a new rule.
--
-- A rule charges its AUTHOR's card, so a change that can lead to a charge — a new amount, or resuming
-- a paused rule — is the caller's consent to that charge: `created_by` becomes the caller and the card
-- is re-checked as it is at creation (the wallet owner's card, or the caller's own). A member whose
-- name is not on the card therefore cannot re-price or restart a charge on it. Stopping a charge needs
-- no such consent: any member with the authority may pause or archive a rule without becoming its
-- author. Archiving is final (`archived_at`; the row is never deleted). Every change writes one
-- security.audit_logs row; a call that changes nothing writes none and returns the rule as it is.
CREATE OR REPLACE FUNCTION finance.update_deposit_rule(
    p_rule uuid,
    p_active boolean DEFAULT NULL,
    p_amount_cents bigint DEFAULT NULL,
    p_archive boolean DEFAULT false
)
RETURNS finance.deposit_rules
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_rule finance.deposit_rules;
    v_before finance.deposit_rules;
    v_wallet finance.wallets;
    v_method finance.payment_methods;
    v_archive boolean := COALESCE(p_archive, false);
    v_reprices boolean;
    v_resumes boolean;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to change a recurring deposit' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_rule FROM finance.deposit_rules WHERE id = p_rule FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'rule: that recurring deposit does not exist' USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_rule.wallet_id;
    IF NOT (
        (v_wallet.owner_type IN ('user', 'freelancer') AND v_wallet.owner_id = v_uid)
        OR (
            v_wallet.owner_type IN ('team', 'business', 'enterprise')
            AND finance.fn_has_vault_capability(v_wallet.id, v_uid, 'add_funds'::finance.vault_capability)
        )
    ) THEN
        RAISE EXCEPTION 'auth: you can''t change recurring deposits on this wallet' USING ERRCODE = '42501';
    END IF;
    IF v_rule.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'rule: this recurring deposit is archived — set up a new one' USING ERRCODE = '55000';
    END IF;
    IF p_amount_cents IS NOT NULL AND p_amount_cents <= 0 THEN
        RAISE EXCEPTION 'amountMinor: enter an amount to deposit' USING ERRCODE = '22023';
    END IF;
    IF v_archive AND (p_active IS TRUE OR p_amount_cents IS NOT NULL) THEN
        RAISE EXCEPTION 'archive: archiving a recurring deposit changes nothing else' USING ERRCODE = '22023';
    END IF;

    v_reprices := p_amount_cents IS NOT NULL AND p_amount_cents <> v_rule.amount_cents;
    v_resumes := NOT v_archive AND p_active IS TRUE AND NOT v_rule.active;
    IF NOT v_archive AND NOT v_reprices AND NOT v_resumes
       AND (p_active IS NULL OR p_active = v_rule.active) THEN
        RETURN v_rule;
    END IF;

    IF v_reprices OR v_resumes THEN
        IF v_wallet.owner_type = 'business' THEN
            PERFORM org.fn_assert_business_not_archived(v_wallet.owner_id);
        END IF;
        SELECT * INTO v_method FROM finance.payment_methods WHERE id = v_rule.source_method_id;
        IF NOT FOUND OR v_method.status <> 'active' OR v_method.provider <> 'stripe'
           OR v_method.method_role NOT IN ('funding', 'both') THEN
            RAISE EXCEPTION 'sourceMethodId: the card this deposit charged is gone — set up a new one'
                USING ERRCODE = '55000';
        END IF;
        IF NOT (
            (v_method.owner_type = v_wallet.owner_type AND v_method.owner_id = v_wallet.owner_id)
            OR (v_method.owner_type IN ('user', 'freelancer') AND v_method.owner_id = v_uid)
        ) THEN
            RAISE EXCEPTION 'sourceMethodId: this deposit charges another member''s card — set up your own instead'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    v_before := v_rule;
    UPDATE finance.deposit_rules d
       SET amount_cents = COALESCE(p_amount_cents, d.amount_cents),
           active = CASE WHEN v_archive THEN false ELSE COALESCE(p_active, d.active) END,
           archived_at = CASE WHEN v_archive THEN pg_catalog.now() END,
           created_by = CASE WHEN v_reprices OR v_resumes THEN v_uid ELSE d.created_by END,
           -- A resumed rule starts clean and is not charged for the periods it sat paused.
           failure_count = CASE WHEN v_resumes THEN 0 ELSE d.failure_count END,
           last_error = CASE WHEN v_resumes THEN NULL ELSE d.last_error END,
           next_run_at = CASE
               WHEN v_resumes AND d.interval <> 'below_floor' AND d.next_run_at <= pg_catalog.now()
                   THEN pg_catalog.now()
                        + CASE d.interval WHEN 'weekly' THEN interval '1 week' ELSE interval '1 month' END
               ELSE d.next_run_at
           END
     WHERE d.id = v_rule.id
    RETURNING * INTO v_rule;

    INSERT INTO security.audit_logs (user_id, action, entity_table, entity_id, metadata)
    VALUES (
        v_uid,
        CASE WHEN v_archive THEN 'deposit_rule.archived' ELSE 'deposit_rule.updated' END,
        'finance.deposit_rules',
        v_rule.id,
        pg_catalog.jsonb_build_object(
            'wallet_id', v_rule.wallet_id,
            'amount_cents', pg_catalog.jsonb_build_object('from', v_before.amount_cents, 'to', v_rule.amount_cents),
            'active', pg_catalog.jsonb_build_object('from', v_before.active, 'to', v_rule.active),
            'created_by', pg_catalog.jsonb_build_object('from', v_before.created_by, 'to', v_rule.created_by)
        )
    );
    RETURN v_rule;
END;
$$;

-- BEFORE UPDATE on finance.deposit_rules, for EVERY role (the door and the scheduler included): a
-- rule's wallet, currency, card and interval are what its author consented to, so none of them changes
-- — a different one is a new rule. The one exception is the card going away: the foreign key's
-- ON DELETE SET NULL clears `source_method_id`, and the next run pauses the rule for want of a card.
-- Archiving is final: `archived_at` is never cleared and an archived rule never runs again.
CREATE OR REPLACE FUNCTION finance.fn_deposit_rules_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.interval IS DISTINCT FROM OLD.interval
       OR (NEW.source_method_id IS DISTINCT FROM OLD.source_method_id AND NEW.source_method_id IS NOT NULL) THEN
        RAISE EXCEPTION 'deposit_rules: a recurring deposit''s wallet, currency, card and interval never change — set up a new one'
            USING ERRCODE = '42501';
    END IF;
    IF OLD.archived_at IS NOT NULL AND (NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.active) THEN
        RAISE EXCEPTION 'deposit_rules: an archived recurring deposit stays archived' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

-- What a deposit rule's run would be charged to, re-authorised NOW (internal; revoked from every role).
-- The rule's author is checked AS THEM (they may have lost the right to move this wallet's money), the
-- card must still be active and attached to a Stripe Customer, and a business wallet's business must
-- not be archived (Decision #248 (k) — nobody is charged for money it could not take in). Exactly one
-- of `refusal` or the two refs is set; the refusal is the sentence the rule is paused with.
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

-- Claim the rules that are due (processor door, run by the scheduler). For each, re-authorises the
-- rule's author AS THEM at the moment of the charge (finance.fn_deposit_charge_target), records the
-- run as an inbound payment made by them, and advances the rule past `now()` — missed periods are
-- SKIPPED, never charged in a burst. The attempt key is the rule and the period it is for, so a
-- scheduler that runs twice cannot charge a period twice. Returns what the fat service needs to create
-- each off-session PaymentIntent.
--
-- It ALSO re-offers the runs a previous sweep claimed but never bound to a PaymentIntent (the
-- processor could not be reached, the answer was lost, or the sweep died between claim and charge):
-- a scheduled payment still `requires_payment` with no `provider_ref`. Each is returned with
-- `retry = true` and the SAME payment, so the fat service re-sends it under the same Stripe
-- idempotency key (`scheduled_deposit:<payment id>`) — Stripe answers with the intent it already made,
-- or makes it now, and the period is charged exactly once instead of being lost with the advanced
-- `next_run_at`. `updated_at` is the lease: a run is re-offered only when untouched for 15 minutes,
-- and re-offering stamps it, so overlapping sweeps never send it together. Only inside 23 hours of
-- the claim (Stripe keeps an idempotency key for 24): an older unbound run is failed rather than
-- re-sent — a re-send past the key's life could charge twice — and an ops `error` row asks a human to
-- check Stripe for an intent carrying its `projective_payment_id`. A run whose rule was stopped, or
-- whose card or author no longer passes, is canceled with a `warn` row instead of being charged.
CREATE OR REPLACE FUNCTION finance.claim_due_deposit_rules(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r finance.deposit_rules;
    v_target record;
    v_key text;
    v_next timestamptz;
    v_step interval;
    v_payment finance.inbound_payments;
    v_refusal text;
    v_out jsonb := '[]'::jsonb;
BEGIN
    -- Runs claimed earlier and never bound: re-offered under the same payment (see above).
    FOR v_payment IN
        SELECT p.* FROM finance.inbound_payments p
         WHERE p.deposit_rule_id IS NOT NULL
           AND p.status = 'requires_payment'
           AND p.provider_ref IS NULL
           AND p.updated_at <= pg_catalog.now() - interval '15 minutes'
         ORDER BY p.created_at
         LIMIT GREATEST(COALESCE(p_limit, 50), 1)
           FOR UPDATE SKIP LOCKED
    LOOP
        IF v_payment.created_at <= pg_catalog.now() - interval '23 hours' THEN
            UPDATE finance.inbound_payments
               SET status = 'failed',
                   failure_reason = 'The card processor could not be reached for this scheduled deposit within a day; it was not sent again.',
                   updated_at = pg_catalog.now()
             WHERE id = v_payment.id;
            INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
            VALUES (
                'deposit:' || v_payment.id::text,
                'error',
                pg_catalog.format('Scheduled deposit %s was never bound to a PaymentIntent within its idempotency window; check Stripe for an intent with this projective_payment_id', v_payment.id),
                pg_catalog.now(), 'server', 'finance.claim_due_deposit_rules',
                pg_catalog.jsonb_build_object('payment_id', v_payment.id, 'rule_id', v_payment.deposit_rule_id,
                    'amount_cents', v_payment.amount_cents, 'currency', v_payment.currency,
                    'claimed_at', v_payment.created_at, 'reason', 'unbound_expired')
            );
            RAISE WARNING 'finance.claim_due_deposit_rules: scheduled deposit % expired unbound', v_payment.id;
            CONTINUE;
        END IF;

        SELECT * INTO r FROM finance.deposit_rules WHERE id = v_payment.deposit_rule_id;
        v_refusal := NULL;
        v_target := NULL;
        IF r.id IS NULL OR NOT r.active THEN
            v_refusal := 'The recurring deposit was stopped before this run could be charged.';
        ELSE
            SELECT * INTO v_target FROM finance.fn_deposit_charge_target(r);
            v_refusal := v_target.refusal;
        END IF;
        IF v_refusal IS NOT NULL THEN
            UPDATE finance.inbound_payments
               SET status = 'canceled', failure_reason = v_refusal, updated_at = pg_catalog.now()
             WHERE id = v_payment.id;
            INSERT INTO ops.log_entries (client_id, level, message, occurred_at, source, scope, data)
            VALUES (
                'deposit:' || v_payment.id::text,
                'warn',
                pg_catalog.format('Scheduled deposit %s was canceled before it was bound to a PaymentIntent (%s); its first attempt may have reached Stripe', v_payment.id, v_refusal),
                pg_catalog.now(), 'server', 'finance.claim_due_deposit_rules',
                pg_catalog.jsonb_build_object('payment_id', v_payment.id, 'rule_id', v_payment.deposit_rule_id,
                    'amount_cents', v_payment.amount_cents, 'currency', v_payment.currency,
                    'claimed_at', v_payment.created_at, 'reason', 'unbound_canceled')
            );
            CONTINUE;
        END IF;

        UPDATE finance.inbound_payments SET updated_at = pg_catalog.now() WHERE id = v_payment.id
        RETURNING * INTO v_payment;
        v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'payment', pg_catalog.to_jsonb(v_payment),
            'rule_id', r.id,
            'customer_ref', v_target.customer_ref,
            'payment_method_ref', v_target.payment_method_ref,
            'retry', true
        ));
    END LOOP;

    FOR r IN
        SELECT * FROM finance.deposit_rules d
         WHERE d.active AND d.next_run_at <= pg_catalog.now()
         ORDER BY d.next_run_at
         LIMIT GREATEST(COALESCE(p_limit, 50), 1)
           FOR UPDATE SKIP LOCKED
    LOOP
        IF r.interval = 'below_floor' THEN
            -- Runs once per crossing: fn_wallet_watch sets next_run_at to the crossing, this parks it.
            v_next := 'infinity'::timestamptz;
        ELSE
            v_step := CASE r.interval WHEN 'weekly' THEN interval '1 week' ELSE interval '1 month' END;
            v_next := r.next_run_at + v_step;
            WHILE v_next <= pg_catalog.now() LOOP
                v_next := v_next + v_step;
            END LOOP;
        END IF;
        v_key := 'deposit:' || r.id::text || ':' || pg_catalog.to_char(r.next_run_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS');

        SELECT * INTO v_target FROM finance.fn_deposit_charge_target(r);
        IF v_target.refusal IS NOT NULL THEN
            UPDATE finance.deposit_rules
               SET active = false, next_run_at = v_next, last_error = v_target.refusal
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
            'customer_ref', v_target.customer_ref,
            'payment_method_ref', v_target.payment_method_ref,
            'retry', false
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
        IF v_payment.status NOT IN ('succeeded', 'settled_unapplied') THEN
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
    ELSIF p_owner_type IN ('business', 'team', 'enterprise') THEN
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

-- #region 7b. Paying in one's own currency — FX quotes and conversions (Decision #435)
-- A conversion row is never rewritten or removed; a quote is frozen once written, except that its use
-- is recorded once. Bound in 00001830.
CREATE OR REPLACE FUNCTION finance.fn_fx_conversions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ledger: finance.fx_conversions is append-only — % refused', TG_OP USING ERRCODE = 'PL403';
END;
$$;

CREATE OR REPLACE FUNCTION finance.fn_fx_quotes_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
       AND (pg_catalog.to_jsonb(NEW) - 'consumed_at') = (pg_catalog.to_jsonb(OLD) - 'consumed_at') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ledger: an FX quote is frozen once written; only its use is recorded — % refused', TG_OP
        USING ERRCODE = 'PL403';
END;
$$;

-- The Dev Context Switcher's paying-in-one's-own-currency simulation a request carries (Decision #436):
-- `x-pj-dev-fx-checkout` (PostgREST's `request.headers`), which the app sends only in development —
-- 'on', 'off', or NULL for none.
CREATE OR REPLACE FUNCTION finance.fn_dev_fx_checkout()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT CASE lower(COALESCE(
               (NULLIF(pg_catalog.current_setting('request.headers', true), '')::json) ->> 'x-pj-dev-fx-checkout',
               ''))
        WHEN 'on' THEN 'on'
        WHEN 'off' THEN 'off'
    END;
$$;

-- Does this database honour a development override that loosens a gate? `dev_overrides_honoured`, which
-- only the local seed world sets: a header any client can send to PostgREST is never a key on its own.
CREATE OR REPLACE FUNCTION finance.fn_dev_overrides_honoured()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((SELECT (p.value #>> '{}')::boolean FROM security.platform_params p
                      WHERE p.key = 'dev_overrides_honoured'), false);
$$;

-- Is paying in one's own currency on for this request? `fx_checkout_enabled`, unless the request's
-- development simulation says otherwise. `off` is honoured from any caller: it refuses only its sender.
-- `on` loosens the gate, so it counts only where finance.fn_dev_overrides_honoured().
CREATE OR REPLACE FUNCTION finance.fn_fx_checkout_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE finance.fn_dev_fx_checkout()
        WHEN 'off' THEN false
        WHEN 'on' THEN finance.fn_dev_overrides_honoured()
                       OR COALESCE((SELECT (p.value #>> '{}')::boolean FROM security.platform_params p
                                     WHERE p.key = 'fx_checkout_enabled'), false)
        ELSE COALESCE((SELECT (p.value #>> '{}')::boolean FROM security.platform_params p
                        WHERE p.key = 'fx_checkout_enabled'), false)
    END;
$$;

-- Quote what `p_to_minor` of `p_to_currency` costs the account in `p_from_currency` (user door). The
-- caller pays for the account (themselves; a member who can spend for an entity's basket; a funder of
-- the project), and what is quoted is named: a checkout's basket, or the stage, ticket or revision a
-- card lock or a wallet funding pays for, whose payer is the account. Refused, before anything is
-- written, while paying in another currency is switched off (PX503 `fx_unavailable`), with no margin set
-- (PX500 `fx_spread_not_configured`), for a currency outside `settlement_currencies` (PX422
-- `currency_not_settled`, Decision #423), or on a rate older than `fx_rate_max_age_hours` (PX503
-- `fx_rate_stale`). The margin is the higher of the two currencies' `fx_spread_bp`. Returns the quote,
-- usable for `fx_quote_ttl_minutes`.
CREATE OR REPLACE FUNCTION finance.quote_fx_conversion(
    p_owner_type text,
    p_owner_id uuid,
    p_from_currency text,
    p_to_currency text,
    p_to_minor bigint,
    p_purpose text,
    p_ref_table text,
    p_ref_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_from text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_from_currency, '')));
    v_to text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_to_currency, '')));
    v_basket finance.baskets;
    v_project uuid;
    v_payer uuid;
    v_person uuid;
    v_settle jsonb;
    v_spread bigint;
    v_base text;
    v_from_rate numeric;
    v_from_as_of timestamptz;
    v_from_provider text;
    v_to_rate numeric;
    v_to_as_of timestamptz;
    v_to_provider text;
    v_as_of timestamptz;
    v_max_age integer;
    v_ttl integer;
    m record;
    q finance.fx_quotes;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to pay' USING ERRCODE = '42501';
    END IF;
    IF p_purpose IS NULL OR p_purpose NOT IN ('checkout', 'escrow_lock', 'funding') THEN
        RAISE EXCEPTION 'purpose: expected checkout, escrow_lock or funding' USING ERRCODE = '22023';
    END IF;
    IF v_from !~ '^[A-Z]{3}$' OR v_to !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'currency: expected three-letter currency codes' USING ERRCODE = '22023';
    END IF;
    IF v_from = v_to THEN
        RAISE EXCEPTION 'currency: % needs no conversion', v_to USING ERRCODE = '22023';
    END IF;
    IF p_to_minor IS NULL OR p_to_minor <= 0 THEN
        RAISE EXCEPTION 'amountMinor: nothing to convert' USING ERRCODE = '22023';
    END IF;
    IF p_owner_type IS NULL OR p_owner_type NOT IN ('user', 'freelancer', 'team', 'business', 'enterprise') THEN
        RAISE EXCEPTION 'owner: not an account that can pay' USING ERRCODE = '22023';
    END IF;

    IF p_purpose = 'checkout' THEN
        IF p_ref_table IS DISTINCT FROM 'baskets' OR p_ref_id IS NULL THEN
            RAISE EXCEPTION 'ref: a checkout quote names its basket' USING ERRCODE = '22023';
        END IF;
        SELECT * INTO v_basket FROM finance.baskets b WHERE b.id = p_ref_id;
        IF NOT FOUND OR v_basket.owner_id IS DISTINCT FROM p_owner_id
           OR NOT (v_basket.owner_type = p_owner_type
                   OR (p_owner_type IN ('user', 'freelancer') AND v_basket.owner_type IN ('user', 'freelancer')))
           OR NOT finance.fn_can_manage_basket(v_basket.owner_type, v_basket.owner_id) THEN
            RAISE EXCEPTION 'auth: you can''t pay for that basket' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF p_ref_table IS NULL OR p_ref_table NOT IN ('project_stages', 'tickets', 'revisions') OR p_ref_id IS NULL THEN
            RAISE EXCEPTION 'ref: a funding quote names its stage, ticket or revision' USING ERRCODE = '22023';
        END IF;
        SELECT CASE p_ref_table
                   WHEN 'project_stages' THEN (SELECT ps.project_id FROM projects.project_stages ps WHERE ps.id = p_ref_id)
                   WHEN 'tickets' THEN (SELECT t.project_id FROM projects.tickets t WHERE t.id = p_ref_id)
                   ELSE (SELECT ps.project_id FROM projects.stage_revision_requests rv
                           JOIN projects.project_stages ps ON ps.id = rv.project_stage_id
                          WHERE rv.id = p_ref_id)
               END
          INTO v_project;
        IF v_project IS NULL THEN
            RAISE EXCEPTION 'ref: that % does not exist', p_ref_table USING ERRCODE = 'P0002';
        END IF;
        IF NOT projects.fn_can_fund_project(v_project) THEN
            RAISE EXCEPTION 'not_funder: only a member who can spend from the client''s wallet can fund this'
                USING ERRCODE = 'PK403';
        END IF;
        SELECT p.client_business_id, COALESCE(p.client_user_id, p.owner_user_id) INTO v_payer, v_person
          FROM projects.projects p WHERE p.id = v_project;
        IF COALESCE(v_payer, v_person) IS DISTINCT FROM p_owner_id
           OR (v_payer IS NOT NULL AND p_owner_type <> 'business')
           OR (v_payer IS NULL AND p_owner_type NOT IN ('user', 'freelancer')) THEN
            RAISE EXCEPTION 'auth: this project is paid for by another account' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NOT finance.fn_fx_checkout_enabled() THEN
        RAISE EXCEPTION 'fx_unavailable: paying in another currency is not available yet' USING ERRCODE = 'PX503';
    END IF;
    SELECT pp.value INTO v_settle FROM security.platform_params pp WHERE pp.key = 'settlement_currencies';
    IF v_settle IS NULL OR pg_catalog.jsonb_typeof(v_settle) <> 'array' OR NOT (v_settle ? v_from) OR NOT (v_settle ? v_to) THEN
        RAISE EXCEPTION 'currency_not_settled: % to % is not a pair Projective converts', v_from, v_to
            USING ERRCODE = 'PX422';
    END IF;
    v_spread := GREATEST(finance.fn_param_minor('fx_spread_bp', v_from), finance.fn_param_minor('fx_spread_bp', v_to));
    IF v_spread IS NULL THEN
        RAISE EXCEPTION 'fx_spread_not_configured: the conversion margin is not set' USING ERRCODE = 'PX500';
    END IF;
    IF v_spread < 0 OR v_spread > 2000 THEN
        RAISE EXCEPTION 'fx_spread_not_configured: the conversion margin % is outside 0-2000 bp', v_spread
            USING ERRCODE = 'PX500';
    END IF;

    v_base := COALESCE((SELECT pp.value #>> '{}' FROM security.platform_params pp WHERE pp.key = 'base_currency'), 'GBP');
    IF v_from = v_base THEN
        v_from_rate := 1;
    ELSE
        SELECT r.rate, r.as_of, r.provider INTO v_from_rate, v_from_as_of, v_from_provider
          FROM finance.fx_rates r WHERE r.base = v_base AND r.quote = v_from
         ORDER BY r.as_of DESC, r.created_at DESC LIMIT 1;
    END IF;
    IF v_to = v_base THEN
        v_to_rate := 1;
    ELSE
        SELECT r.rate, r.as_of, r.provider INTO v_to_rate, v_to_as_of, v_to_provider
          FROM finance.fx_rates r WHERE r.base = v_base AND r.quote = v_to
         ORDER BY r.as_of DESC, r.created_at DESC LIMIT 1;
    END IF;
    v_as_of := LEAST(v_from_as_of, v_to_as_of);
    v_max_age := COALESCE((SELECT (pp.value #>> '{}')::integer FROM security.platform_params pp
                            WHERE pp.key = 'fx_rate_max_age_hours'), 24);
    IF v_from_rate IS NULL OR v_to_rate IS NULL OR v_as_of IS NULL THEN
        RAISE EXCEPTION 'fx_rate_unavailable: no exchange rate is recorded for % to %', v_from, v_to
            USING ERRCODE = 'PX503';
    END IF;
    -- A development `on` (Decision #436) quotes on the newest recorded rate whatever its age where the
    -- database honours it: a local database has no rate feed (DB17).
    IF v_as_of < pg_catalog.now() - pg_catalog.make_interval(hours => v_max_age)
       AND NOT (finance.fn_dev_fx_checkout() IS NOT DISTINCT FROM 'on' AND finance.fn_dev_overrides_honoured()) THEN
        RAISE EXCEPTION 'fx_rate_stale: the exchange rate for % to % is out of date', v_from, v_to
            USING ERRCODE = 'PX503';
    END IF;

    SELECT * INTO m FROM finance.fn_fx_quote_minor(p_to_minor, v_from, v_to, v_from_rate, v_to_rate, v_spread::integer);
    IF m.principal_minor IS NULL OR m.principal_minor <= 0 THEN
        RAISE EXCEPTION 'amountMinor: % % is too small to convert', p_to_minor, v_to USING ERRCODE = '22023';
    END IF;
    v_ttl := COALESCE((SELECT (pp.value #>> '{}')::integer FROM security.platform_params pp
                        WHERE pp.key = 'fx_quote_ttl_minutes'), 30);

    INSERT INTO finance.fx_quotes (
        owner_type, owner_id, purpose, ref_table, ref_id, from_currency, to_currency, to_minor,
        principal_minor, spread_bp, spread_minor, from_minor, from_rate, to_rate, mid_rate, rate_as_of,
        rate_provider, created_by, expires_at
    ) VALUES (
        p_owner_type, p_owner_id, p_purpose, p_ref_table, p_ref_id, v_from, v_to, p_to_minor,
        m.principal_minor, v_spread::integer, m.spread_minor, m.from_minor, v_from_rate, v_to_rate,
        pg_catalog.round(v_to_rate / v_from_rate, 10), v_as_of,
        COALESCE(pg_catalog.concat_ws('/', v_from_provider, NULLIF(v_to_provider, v_from_provider)), 'base'),
        v_uid, pg_catalog.now() + pg_catalog.make_interval(mins => GREATEST(v_ttl, 1))
    )
    RETURNING * INTO q;
    RETURN pg_catalog.to_jsonb(q);
END;
$$;

-- Execute a quote: debit the account's wallet in the quote's currency (`fx_conversion` for the
-- principal, `fx_spread` for the margin) and credit its wallet in the target currency (`fx_conversion`)
-- with exactly `to_minor`, every leg stamped with the pair, the rate and its date, and one `purchase`
-- row in finance.fx_conversions. The target wallet is the one the escrow holds debit for the account
-- (finance.fn_person_wallet_type for a person), created if missing. A used quote refuses PC409
-- `quote_used:`; an expired one PC409 `quote_expired:` unless `p_honour_expired` (a card payment started
-- on it). Only the money doors call it, after their own authorisation and spend gate. Internal.
CREATE OR REPLACE FUNCTION finance.fn_execute_fx_quote(
    p_quote_id uuid,
    p_from_wallet uuid,
    p_ref_table text,
    p_ref_id uuid,
    p_honour_expired boolean DEFAULT false
)
RETURNS finance.fx_conversions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    q finance.fx_quotes;
    w finance.wallets;
    v_to_type text;
    v_to_wallet uuid;
    c finance.fx_conversions;
BEGIN
    SELECT * INTO q FROM finance.fx_quotes x WHERE x.id = p_quote_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'quote: that exchange-rate quote does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF q.consumed_at IS NOT NULL THEN
        RAISE EXCEPTION 'quote_used: that exchange-rate quote has already been used — review the total and try again'
            USING ERRCODE = 'PC409';
    END IF;
    IF NOT COALESCE(p_honour_expired, false) AND q.expires_at <= pg_catalog.now() THEN
        RAISE EXCEPTION 'quote_expired: the exchange-rate quote expired — review the new total and try again'
            USING ERRCODE = 'PC409';
    END IF;
    SELECT * INTO w FROM finance.wallets x WHERE x.id = p_from_wallet FOR UPDATE;
    IF NOT FOUND OR w.owner_id IS DISTINCT FROM q.owner_id OR w.currency <> q.from_currency
       OR NOT (w.owner_type = q.owner_type
               OR (q.owner_type IN ('user', 'freelancer') AND w.owner_type IN ('user', 'freelancer'))) THEN
        RAISE EXCEPTION 'quote: that wallet is not the account''s wallet in %', q.from_currency USING ERRCODE = '22023';
    END IF;
    IF w.balance_cents < q.from_minor THEN
        RAISE EXCEPTION 'Your wallet balance doesn''t cover this conversion' USING ERRCODE = 'PF402';
    END IF;
    v_to_type := CASE WHEN q.owner_type IN ('user', 'freelancer') THEN finance.fn_person_wallet_type(q.owner_id)
                      ELSE q.owner_type END;
    v_to_wallet := finance.fn_ensure_wallet(v_to_type, q.owner_id, q.to_currency);

    INSERT INTO finance.fx_conversions (
        kind, quote_id, owner_type, owner_id, from_wallet_id, to_wallet_id, from_currency, to_currency,
        from_minor, principal_minor, spread_bp, spread_minor, to_minor, rate_base, mid_rate, rate_as_of,
        ref_table, ref_id
    ) VALUES (
        'purchase', q.id, w.owner_type, q.owner_id, w.id, v_to_wallet, q.from_currency, q.to_currency,
        q.from_minor, q.principal_minor, q.spread_bp, q.spread_minor, q.to_minor, q.from_currency, q.mid_rate,
        q.rate_as_of, p_ref_table, p_ref_id
    )
    RETURNING * INTO c;

    PERFORM finance.fn_wallet_debit_fx(w.owner_id, w.owner_type, w.currency, q.principal_minor, 'fx_conversion',
        'fx_conversions', c.id, q.from_currency, q.mid_rate, q.rate_as_of);
    PERFORM finance.fn_wallet_debit_fx(w.owner_id, w.owner_type, w.currency, q.spread_minor, 'fx_spread',
        'fx_conversions', c.id, q.from_currency, q.mid_rate, q.rate_as_of);
    PERFORM finance.fn_wallet_credit_fx(q.owner_id, v_to_type, q.to_currency, q.to_minor, 'fx_conversion',
        'fx_conversions', c.id, q.from_currency, q.mid_rate, q.rate_as_of);
    UPDATE finance.fx_quotes SET consumed_at = pg_catalog.now() WHERE id = q.id;
    RETURN c;
END;
$$;

-- Fund a stage, a ticket or a paid revision from the payer's wallet in another currency (user door): the
-- wallet route of projects.fund_stage / fund_ticket / fund_paid_revision when the payer holds their own
-- currency. The caller's own `funding` quote must price exactly what that door will hold, by the same
-- definitions begin_card_payment reads; the spend gate counts what leaves the paying wallet, the quote
-- converts it, and the door holds from the result in the same transaction, so a refused hold takes the
-- conversion back with it. The escrows held are stamped with the conversion. Last it asks for the
-- Escrow Terms, as every client funding door does (LG3, #534; `p_legal` carries the version the dialog
-- showed), so an unaccepted version unwinds the conversion and the hold whole. Returns the door's
-- answer with the conversion and the charge.
CREATE OR REPLACE FUNCTION finance.fund_with_conversion(
    p_fx_quote_id uuid,
    p_project_id uuid,
    p_stage_id uuid,
    p_ticket_id uuid DEFAULT NULL,
    p_revision_id uuid DEFAULT NULL,
    p_legal jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_ref_table text := CASE WHEN p_revision_id IS NOT NULL THEN 'revisions'
                             WHEN p_ticket_id IS NOT NULL THEN 'tickets'
                             ELSE 'project_stages' END;
    v_ref_id uuid := COALESCE(p_revision_id, p_ticket_id, p_stage_id);
    q finance.fx_quotes;
    v_payer uuid;
    v_person uuid;
    v_currency text;
    v_need bigint;
    v_source finance.wallets;
    c finance.fx_conversions;
    v_result jsonb;
    v_escrows uuid[];
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to pay' USING ERRCODE = '42501';
    END IF;
    IF p_project_id IS NULL OR p_stage_id IS NULL THEN
        RAISE EXCEPTION 'stageId: choose the stage to fund' USING ERRCODE = '22023';
    END IF;
    IF p_ticket_id IS NOT NULL AND p_revision_id IS NOT NULL THEN
        RAISE EXCEPTION 'ticketId: a revision is paid for on its own, not with a ticket' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO q FROM finance.fx_quotes x WHERE x.id = p_fx_quote_id;
    IF NOT FOUND OR q.created_by IS DISTINCT FROM v_uid OR q.purpose <> 'funding'
       OR q.ref_table IS DISTINCT FROM v_ref_table OR q.ref_id IS DISTINCT FROM v_ref_id THEN
        RAISE EXCEPTION 'fxQuoteId: that exchange-rate quote is not for this funding' USING ERRCODE = '22023';
    END IF;
    IF NOT projects.fn_can_fund_project(p_project_id) THEN
        RAISE EXCEPTION 'not_funder: only a member who can spend from the client''s wallet can fund this'
            USING ERRCODE = 'PK403';
    END IF;
    SELECT p.client_business_id, COALESCE(p.client_user_id, p.owner_user_id), pg_catalog.upper(COALESCE(p.currency, 'USD'))
      INTO v_payer, v_person, v_currency
      FROM projects.projects p WHERE p.id = p_project_id;
    IF COALESCE(v_payer, v_person) IS DISTINCT FROM q.owner_id OR q.to_currency <> v_currency THEN
        RAISE EXCEPTION 'fxQuoteId: that exchange-rate quote is not for this project''s payer and currency'
            USING ERRCODE = '22023';
    END IF;

    IF p_revision_id IS NOT NULL THEN
        SELECT rv.price_cents INTO v_need
          FROM projects.stage_revision_requests rv
          JOIN projects.project_stages ps ON ps.id = rv.project_stage_id
         WHERE rv.id = p_revision_id AND ps.id = p_stage_id AND ps.project_id = p_project_id;
    ELSIF p_ticket_id IS NOT NULL THEN
        SELECT projects.fn_ticket_stage_price(tk.required_stages, tk.unit_price_cents, ps) INTO v_need
          FROM projects.tickets tk
          JOIN projects.project_stages ps ON ps.id = projects.fn_ticket_funding_stage(tk.id)
         WHERE tk.id = p_ticket_id AND tk.project_id = p_project_id AND ps.id = p_stage_id;
    ELSE
        v_need := (projects.fn_stage_funding_need(p_stage_id) ->> 'amount_cents')::bigint;
    END IF;
    IF v_need IS NULL OR v_need <> q.to_minor THEN
        RAISE EXCEPTION 'expectedAmountMinor: the amount to fund changed — review it and try again' USING ERRCODE = 'PC409';
    END IF;

    SELECT * INTO v_source FROM finance.wallets w
     WHERE w.owner_id = q.owner_id AND w.currency = q.from_currency
       AND w.owner_type = finance.fn_escrow_payer_wallet_type(v_payer, CASE WHEN v_payer IS NULL THEN v_person END);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Your wallet holds no %', q.from_currency USING ERRCODE = 'PF402';
    END IF;
    PERFORM finance.fn_assert_business_spend(v_source.id, v_uid, q.from_minor, v_ref_table, v_ref_id);
    c := finance.fn_execute_fx_quote(q.id, v_source.id, v_ref_table, v_ref_id, false);
    PERFORM finance.fn_carry_spend_cover(v_source.id, c.to_wallet_id, c.to_minor);

    IF p_revision_id IS NOT NULL THEN
        v_result := projects.fund_paid_revision(p_revision_id);
        v_escrows := ARRAY[(v_result ->> 'escrow_id')::uuid];
    ELSIF p_ticket_id IS NOT NULL THEN
        v_result := projects.fund_ticket(p_project_id, p_ticket_id);
        v_escrows := ARRAY[(v_result ->> 'escrow_id')::uuid];
    ELSE
        v_result := projects.fund_stage(p_project_id, p_stage_id);
        SELECT COALESCE(pg_catalog.array_agg(e.id ORDER BY e.id), '{}') INTO v_escrows
          FROM finance.escrows e
         WHERE e.project_stage_id = p_stage_id AND e.status = 'held'
           AND e.created_at = pg_catalog.now() AND e.fx_conversion_id IS NULL;
    END IF;
    PERFORM finance.fn_stamp_escrow_fx(c.id, v_escrows);
    PERFORM finance.fn_close_spend_cover(c.to_wallet_id);
    PERFORM org.fn_require_legal_acceptance('escrow-terms', p_legal);
    RETURN COALESCE(v_result, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'fx_conversion_id', c.id, 'charge_minor', c.from_minor, 'charge_currency', c.from_currency);
END;
$$;
-- #endregion

-- #region 7. The pending window (Decision #191)
-- Earned money clears a safety window before it is Available (finance-model.md §7): an escrow release,
-- each team share / finder fee / vault cut of one, a fair-exit payout, a seat release and a product sale
-- are credited through finance.fn_wallet_credit_pending, which writes a finance.pending_releases row
-- instead of moving the balance. Top-ups, refunds, transfers and returned payouts are the payer's own
-- money and stay immediate. `balance_cents` therefore holds only cleared money, and what a wallet may
-- spend is that minus its pots (region 9): every spend path and finance.begin_payout debit through
-- finance.fn_wallet_debit, which refuses earmarked money. Income is earmarked into pots as it clears.

-- The pending twin of finance.fn_wallet_credit, with the same arguments so a door swaps one name.
-- Holds `p_amount` for `pending_release_days` against its source (`escrows` or `orders`); a window of
-- 0 days credits at once and earmarks it into the wallet's pots, as the sweep does. Only an earned
-- reason (finance.fn_is_income_reason) is accepted. A missing wallet raises PW404, as the primitive
-- does. Internal.
CREATE OR REPLACE FUNCTION finance.fn_wallet_credit_pending(
    p_owner_id uuid, p_owner_type text, p_currency text, p_amount bigint,
    p_reason text, p_ref_table text, p_ref_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_wallet finance.wallets;
    v_days integer;
    v_tx uuid;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN;
    END IF;
    IF p_ref_table NOT IN ('escrows', 'orders') OR p_ref_id IS NULL THEN
        RAISE EXCEPTION 'pending: an earned credit is keyed to an escrow or an order, not %', COALESCE(p_ref_table, 'nothing')
            USING ERRCODE = '22023';
    END IF;
    IF NOT finance.fn_is_income_reason(p_reason) THEN
        RAISE EXCEPTION 'pending: % is not an earned-credit reason; add it to finance.fn_is_income_reason', COALESCE(p_reason, 'nothing')
            USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_wallet FROM finance.wallets
     WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND currency = p_currency;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'wallet: % % holds no % wallet', p_owner_type, p_owner_id, p_currency USING ERRCODE = 'PW404';
    END IF;

    v_days := GREATEST(COALESCE((
        SELECT (pp.value #>> '{}')::integer FROM security.platform_params pp WHERE pp.key = 'pending_release_days'
    ), 7), 0);
    IF v_days = 0 THEN
        PERFORM finance.fn_wallet_credit(p_owner_id, p_owner_type, p_currency, p_amount, p_reason, p_ref_table, p_ref_id);
        SELECT t.id INTO v_tx FROM finance.transactions t
         WHERE t.wallet_id = v_wallet.id AND t.direction = 'credit' AND t.reason = p_reason
           AND t.ref_table = p_ref_table AND t.ref_id = p_ref_id
         ORDER BY t.created_at DESC, t.id DESC LIMIT 1;
        PERFORM finance.fn_apply_pot_allocations(v_wallet.id, p_amount, p_reason, 'transactions', v_tx);
        RETURN;
    END IF;

    INSERT INTO finance.pending_releases (escrow_id, order_id, wallet_id, reason, amount_cents, currency, available_at)
    VALUES (
        CASE WHEN p_ref_table = 'escrows' THEN p_ref_id END,
        CASE WHEN p_ref_table = 'orders' THEN p_ref_id END,
        v_wallet.id, p_reason, p_amount, v_wallet.currency,
        pg_catalog.now() + pg_catalog.make_interval(days => v_days)
    );
END;
$$;

-- Take up to `p_amount` back from a wallet's money still in the window, soonest-to-clear first, and
-- return how much was taken. A row emptied this way closes (`available`, no credit). Called by the
-- lost-chargeback recovery before it touches the Available balance. Internal.
CREATE OR REPLACE FUNCTION finance.fn_recover_from_pending(p_wallet_id uuid, p_amount bigint)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r finance.pending_releases;
    v_left bigint := GREATEST(COALESCE(p_amount, 0), 0);
    v_take bigint;
BEGIN
    FOR r IN
        SELECT * FROM finance.pending_releases
         WHERE wallet_id = p_wallet_id AND state = 'pending' AND recovered_cents < amount_cents
         ORDER BY available_at, id
           FOR UPDATE
    LOOP
        EXIT WHEN v_left = 0;
        v_take := LEAST(v_left, r.amount_cents - r.recovered_cents);
        UPDATE finance.pending_releases
           SET recovered_cents = recovered_cents + v_take,
               state = CASE WHEN recovered_cents + v_take = amount_cents THEN 'available'::finance.fund_state ELSE state END,
               matured_at = CASE WHEN recovered_cents + v_take = amount_cents THEN pg_catalog.now() ELSE matured_at END
         WHERE id = r.id;
        v_left := v_left - v_take;
    END LOOP;
    RETURN GREATEST(COALESCE(p_amount, 0), 0) - v_left;
END;
$$;

-- The sweep: credit every row whose window has passed to its wallet, with the ledger row the immediate
-- credit used to write (same reason, same escrow / order reference), earmark that credit into the
-- wallet's pots (fn_apply_pot_allocations, once per credit), and close it. A batch of at most
-- `p_limit` rows, claimed FOR UPDATE SKIP LOCKED so overlapping runs never take the same row and a
-- replay credits nothing twice. Returns how many rows matured. Service role / pg_cron only.
CREATE OR REPLACE FUNCTION finance.fn_mature_pending_releases(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r record;
    v_amount bigint;
    v_ref_table text;
    v_ref_id uuid;
    v_tx uuid;
    v_count integer := 0;
BEGIN
    FOR r IN
        SELECT pr.*, w.owner_id, w.owner_type
          FROM finance.pending_releases pr
          JOIN finance.wallets w ON w.id = pr.wallet_id
         WHERE pr.state = 'pending' AND pr.available_at <= pg_catalog.now()
         ORDER BY pr.available_at, pr.id
         LIMIT GREATEST(COALESCE(p_limit, 1000), 1)
           FOR UPDATE OF pr SKIP LOCKED
    LOOP
        v_amount := r.amount_cents - r.recovered_cents;
        v_tx := NULL;
        IF v_amount > 0 THEN
            v_ref_table := CASE WHEN r.escrow_id IS NOT NULL THEN 'escrows' ELSE 'orders' END;
            v_ref_id := COALESCE(r.escrow_id, r.order_id);
            PERFORM finance.fn_wallet_credit(r.owner_id, r.owner_type, r.currency, v_amount, r.reason, v_ref_table, v_ref_id);
            SELECT t.id INTO v_tx FROM finance.transactions t
             WHERE t.wallet_id = r.wallet_id AND t.direction = 'credit' AND t.reason = r.reason
               AND t.ref_table = v_ref_table AND t.ref_id = v_ref_id
             ORDER BY t.created_at DESC, t.id DESC LIMIT 1;
            IF finance.fn_is_income_reason(r.reason) THEN
                PERFORM finance.fn_apply_pot_allocations(r.wallet_id, v_amount, r.reason, 'transactions', v_tx);
            END IF;
        END IF;
        UPDATE finance.pending_releases
           SET state = 'available', matured_at = pg_catalog.now(), transaction_id = v_tx
         WHERE id = r.id;
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION finance.fn_mature_pending_releases(integer) IS
'The pending-window sweep (Decision #191): credits each finance.pending_releases row past available_at
to its wallet with the ledger row of its original reason, earmarks that credit into the wallet''s pots
(Decision #337, ruling M6), and closes it. SKIP LOCKED batches; idempotent. Service role / pg_cron only.';

-- Scheduled hourly at :05 as `finance-mature-pending-releases` by the job registry
-- (`ops.scheduled_jobs`, 00005060).
-- #endregion

-- #region 8. Idempotency key retention (FINANCE_AUDIT L8)
-- The key sweep (the scheduler's `finance-sweep-idempotency-keys`, daily at 04:27, which 00005060
-- registers by this name): deletes the attempt keys whose `expires_at` passed more than 30 days ago,
-- in batches of `p_limit`, so finance.idempotency_keys stops growing for ever. Every door that writes a
-- key sets `expires_at` past the longest retry it protects, so a key this old answers no retry anybody
-- will send. A key with no `expires_at` is never swept.
--
-- KEPT: scope `stripe.webhook`, the Stripe event claims. They are the webhook's replay guard — Stripe
-- redelivers for days and an operator can resend an old event from the Dashboard, and an event whose
-- claim is gone would move its money a second time — and they hold the outcomes
-- finance.v_ops_unledgered_payments reads (`settlement_mismatch`, `business_archived`) until a human
-- settles them. Their retention is the webhook delivery ledger's (finance-model.md §17, **Not built
-- yet**), not this sweep's. Returns how many keys were deleted. Service role and scheduler only.
CREATE OR REPLACE FUNCTION finance.fn_sweep_idempotency_keys(p_limit integer DEFAULT 10000)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_count integer;
BEGIN
    WITH due AS (
        SELECT k.key
          FROM finance.idempotency_keys k
         WHERE k.expires_at < pg_catalog.now() - interval '30 days'
           AND k.scope <> 'stripe.webhook'
         ORDER BY k.expires_at
         LIMIT GREATEST(COALESCE(p_limit, 10000), 1)
           FOR UPDATE SKIP LOCKED
    )
    DELETE FROM finance.idempotency_keys k
     USING due
     WHERE k.key = due.key;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
-- #endregion

-- #region 9. Pots — earmarks inside the wallet (Decision #337, ruling M6)
-- A pot labels part of its wallet's own balance (finance.wallet_pots): `finance.wallets.balance_cents`
-- stays the total, and the wallet's Available to spend is that balance minus its active pots. Nothing
-- here moves money between wallets or writes finance.transactions; every change of a pot's balance is
-- a finance.pot_movements row. What a wallet may spend is finance.fn_available_cents, and the earmark is
-- enforced in one place, finance.fn_wallet_debit (both 00001200). Which credits are income, and so
-- earmarked as they mature, is finance.fn_is_income_reason (00001200, beside the debit's lists).

-- Earmark income that has just become Available: each active pot with auto_allocate_bp > 0 takes
-- ⌊p_amount × bp / 10000⌋, in created_at order, and the dust stays Available. Income reasons only. Keyed
-- to the credit it earmarks (`transactions`, the finance.transactions row), so a second call for the
-- same credit earmarks nothing (uq_pot_movements_allocation). Returns the total earmarked. Called by
-- fn_mature_pending_releases and by fn_wallet_credit_pending's zero-day branch; never on a top-up,
-- refund or transfer. Internal.
CREATE OR REPLACE FUNCTION finance.fn_apply_pot_allocations(
    p_wallet uuid, p_amount bigint, p_reason text, p_ref_table text, p_ref_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r finance.wallet_pots;
    v_take bigint;
    v_total bigint := 0;
    v_id uuid;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN 0;
    END IF;
    IF NOT finance.fn_is_income_reason(p_reason) THEN
        RAISE EXCEPTION 'pots: % is not income; only matured earnings are set aside', COALESCE(p_reason, 'nothing')
            USING ERRCODE = '22023';
    END IF;
    IF p_ref_table IS DISTINCT FROM 'transactions' OR p_ref_id IS NULL THEN
        RAISE EXCEPTION 'pots: an allocation is keyed to the ledger credit it sets aside' USING ERRCODE = '22023';
    END IF;

    FOR r IN
        SELECT * FROM finance.wallet_pots
         WHERE wallet_id = p_wallet AND active AND auto_allocate_bp > 0
         ORDER BY created_at, id
           FOR UPDATE
    LOOP
        v_take := pg_catalog.floor(p_amount::numeric * r.auto_allocate_bp / 10000)::bigint;
        CONTINUE WHEN v_take <= 0;
        v_id := NULL;
        INSERT INTO finance.pot_movements (
            pot_id, wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents
        ) VALUES (
            r.id, r.wallet_id, 'in', v_take, r.currency, 'allocation', p_ref_table, p_ref_id, r.balance_cents + v_take
        )
        ON CONFLICT (pot_id, ref_id) WHERE reason = 'allocation' DO NOTHING
        RETURNING id INTO v_id;
        CONTINUE WHEN v_id IS NULL;
        UPDATE finance.wallet_pots SET balance_cents = balance_cents + v_take WHERE id = r.id;
        v_total := v_total + v_take;
    END LOOP;
    RETURN v_total;
END;
$$;

-- May the caller name, weight, archive or move money in this wallet's pots? The owner of a personal
-- wallet; on a shared one `distribute` (workspace manage finances), because a pot steers where the
-- vault's income is set aside as a split steers where it goes. Internal: save_wallet_pot and
-- move_pot_funds ask it, and the wallet service mirrors it only to decide what to offer.
CREATE OR REPLACE FUNCTION finance.fn_can_manage_pots(p_wallet uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM finance.wallets w
         WHERE w.id = p_wallet
           AND (
               (w.owner_type IN ('user', 'freelancer') AND w.owner_id = auth.uid ())
               OR (
                   w.owner_type IN ('business', 'team', 'enterprise')
                   AND finance.fn_has_vault_capability (w.id, auth.uid (), 'distribute'::finance.vault_capability)
               )
           )
    );
$$;

-- Create (p_id NULL) or change one of a wallet's pots, or archive it (p_archive). Authority:
-- fn_can_manage_pots. A wallet's active pots together set aside at most 100% of income
-- (Σ auto_allocate_bp ≤ 10000), checked under the wallet's pots lock so two saves cannot both fit. A
-- share left NULL keeps a pot's own, and on a new pot defaults to `tax_pot_default_bp` for a tax pot
-- (fitted into what the other pots leave), else 0. A wallet holds at most 40 active pots, the most the
-- wallet read lists. Archiving needs an empty pot; an archived pot stays, inactive, and is never
-- changed again. Never deletes. Returns the pot.
CREATE OR REPLACE FUNCTION finance.save_wallet_pot(
    p_wallet uuid,
    p_id uuid,
    p_purpose finance.pot_purpose,
    p_name text,
    p_auto_allocate_bp integer,
    p_goal_cents bigint,
    p_archive boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid ();
    v_wallet finance.wallets;
    v_pot finance.wallet_pots;
    v_name text := pg_catalog.btrim(COALESCE(p_name, ''));
    v_bp integer;
    v_others bigint;
    v_default integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to change pots' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pots:' || COALESCE(p_wallet::text, '')));
    SELECT * INTO v_wallet FROM finance.wallets WHERE id = p_wallet FOR UPDATE;
    IF NOT FOUND OR NOT finance.fn_can_manage_pots(p_wallet) THEN
        RAISE EXCEPTION 'walletId: you can''t change the pots on this wallet' USING ERRCODE = '42501';
    END IF;

    IF p_id IS NOT NULL THEN
        SELECT * INTO v_pot FROM finance.wallet_pots WHERE id = p_id AND wallet_id = p_wallet FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'potId: that pot isn''t on this wallet' USING ERRCODE = 'P0002';
        END IF;
        IF NOT v_pot.active THEN
            RAISE EXCEPTION 'potId: that pot is archived' USING ERRCODE = 'PC409';
        END IF;
    END IF;

    IF COALESCE(p_archive, false) THEN
        IF p_id IS NULL THEN
            RAISE EXCEPTION 'potId: choose the pot to archive' USING ERRCODE = '22023';
        END IF;
        IF v_pot.balance_cents > 0 THEN
            RAISE EXCEPTION 'potId: move the % % in this pot out before archiving it',
                finance.fn_minor_units_text(v_pot.balance_cents, v_pot.currency), v_pot.currency
                USING ERRCODE = 'PC409';
        END IF;
        UPDATE finance.wallet_pots SET active = false, archived_at = pg_catalog.now()
         WHERE id = p_id RETURNING * INTO v_pot;
        RETURN pg_catalog.to_jsonb(v_pot);
    END IF;

    IF p_purpose IS NULL THEN
        RAISE EXCEPTION 'purpose: choose what the pot is for' USING ERRCODE = '22023';
    END IF;
    IF v_name = '' OR pg_catalog.length(v_name) > 120 THEN
        RAISE EXCEPTION 'name: give the pot a name of up to 120 characters' USING ERRCODE = '22023';
    END IF;
    IF p_goal_cents IS NOT NULL AND p_goal_cents <= 0 THEN
        RAISE EXCEPTION 'goalMinor: a goal is an amount above zero' USING ERRCODE = '22023';
    END IF;
    IF p_auto_allocate_bp IS NOT NULL AND (p_auto_allocate_bp < 0 OR p_auto_allocate_bp > 10000) THEN
        RAISE EXCEPTION 'autoAllocateBp: a pot sets aside between 0%% and 100%% of income' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(pg_catalog.sum(p.auto_allocate_bp), 0) INTO v_others
      FROM finance.wallet_pots p
     WHERE p.wallet_id = p_wallet AND p.active AND p.id IS DISTINCT FROM p_id;

    IF p_auto_allocate_bp IS NOT NULL THEN
        v_bp := p_auto_allocate_bp;
    ELSIF p_id IS NOT NULL THEN
        v_bp := v_pot.auto_allocate_bp;
    ELSIF p_purpose = 'tax' THEN
        v_default := LEAST(GREATEST(COALESCE((
            SELECT (pp.value #>> '{}')::integer FROM security.platform_params pp WHERE pp.key = 'tax_pot_default_bp'
        ), 0), 0), 10000);
        v_bp := LEAST(v_default, GREATEST(10000 - v_others, 0))::integer;
    ELSE
        v_bp := 0;
    END IF;

    IF v_others + v_bp > 10000 THEN
        RAISE EXCEPTION 'autoAllocateBp: this wallet''s other pots already set aside % of income, so this one can take at most %',
            pg_catalog.trim_scale(v_others / 100.0)::text || '%',
            pg_catalog.trim_scale(GREATEST(10000 - v_others, 0) / 100.0)::text || '%'
            USING ERRCODE = '22023';
    END IF;

    IF p_id IS NULL THEN
        IF (SELECT pg_catalog.count(*) FROM finance.wallet_pots p WHERE p.wallet_id = p_wallet AND p.active) >= 40 THEN
            RAISE EXCEPTION 'pots: a wallet holds at most 40 pots; archive one first' USING ERRCODE = 'PC409';
        END IF;
        INSERT INTO finance.wallet_pots (wallet_id, purpose, name, currency, auto_allocate_bp, goal_cents)
        VALUES (p_wallet, p_purpose, v_name, v_wallet.currency, v_bp, p_goal_cents)
        RETURNING * INTO v_pot;
    ELSE
        UPDATE finance.wallet_pots
           SET purpose = p_purpose, name = v_name, auto_allocate_bp = v_bp, goal_cents = p_goal_cents
         WHERE id = p_id
        RETURNING * INTO v_pot;
    END IF;
    RETURN pg_catalog.to_jsonb(v_pot);
END;
$$;

COMMENT ON FUNCTION finance.save_wallet_pot(uuid, uuid, finance.pot_purpose, text, integer, bigint, boolean) IS
'Create, change or archive a wallet pot (Decision #337, ruling M6): the owner of a personal wallet,
`distribute` on a shared one; Σ auto_allocate_bp over the active pots ≤ 10000 under the wallet''s pots
lock; archive only at a zero balance; never deletes.';

-- Earmark Available money into a pot (`in`) or release a pot's money back to Available (`out`). The
-- wallet's balance does not change, only how much of it is earmarked. `in` needs that much Available
-- (the balance minus every active pot), `out` that much in the pot. Authority: fn_can_manage_pots. One
-- finance.pot_movements row. Returns the pot's balance and the wallet's Available after.
CREATE OR REPLACE FUNCTION finance.move_pot_funds(p_pot uuid, p_amount bigint, p_direction text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid ();
    v_wallet_id uuid;
    v_wallet finance.wallets;
    v_pot finance.wallet_pots;
    v_available bigint;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth: sign in to move money in a pot' USING ERRCODE = '42501';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amountMinor: move an amount above zero' USING ERRCODE = '22023';
    END IF;
    IF p_direction IS NULL OR p_direction NOT IN ('in', 'out') THEN
        RAISE EXCEPTION 'direction: money moves into a pot (in) or out of it (out)' USING ERRCODE = '22023';
    END IF;

    SELECT wallet_id INTO v_wallet_id FROM finance.wallet_pots WHERE id = p_pot;
    IF v_wallet_id IS NOT NULL THEN
        SELECT * INTO v_wallet FROM finance.wallets WHERE id = v_wallet_id FOR UPDATE;
        SELECT * INTO v_pot FROM finance.wallet_pots WHERE id = p_pot FOR UPDATE;
    END IF;
    IF v_wallet_id IS NULL OR NOT finance.fn_can_manage_pots(v_wallet_id) THEN
        RAISE EXCEPTION 'potId: you can''t move money in this pot' USING ERRCODE = '42501';
    END IF;
    IF NOT v_pot.active THEN
        RAISE EXCEPTION 'potId: that pot is archived' USING ERRCODE = 'PC409';
    END IF;

    IF p_direction = 'in' THEN
        v_available := finance.fn_available_cents(v_wallet.id);
        IF v_available < p_amount THEN
            RAISE EXCEPTION 'amountMinor: only % % is available to set aside', finance.fn_minor_units_text(GREATEST(v_available, 0), v_wallet.currency), v_wallet.currency
                USING ERRCODE = 'PF402';
        END IF;
        UPDATE finance.wallet_pots SET balance_cents = balance_cents + p_amount WHERE id = p_pot RETURNING * INTO v_pot;
    ELSE
        IF v_pot.balance_cents < p_amount THEN
            RAISE EXCEPTION 'amountMinor: this pot holds % %', finance.fn_minor_units_text(v_pot.balance_cents, v_pot.currency), v_pot.currency
                USING ERRCODE = 'PF402';
        END IF;
        UPDATE finance.wallet_pots SET balance_cents = balance_cents - p_amount WHERE id = p_pot RETURNING * INTO v_pot;
    END IF;

    INSERT INTO finance.pot_movements (
        pot_id, wallet_id, direction, amount_cents, currency, reason, balance_after_cents, actor_user_id
    ) VALUES (
        v_pot.id, v_pot.wallet_id, p_direction, p_amount, v_pot.currency,
        CASE p_direction WHEN 'in' THEN 'move_in' ELSE 'move_out' END, v_pot.balance_cents, v_uid
    );
    RETURN pg_catalog.jsonb_build_object(
        'pot_id', v_pot.id,
        'balance_cents', v_pot.balance_cents,
        'available_cents', finance.fn_available_cents(v_pot.wallet_id)
    );
END;
$$;

COMMENT ON FUNCTION finance.move_pot_funds(uuid, bigint, text) IS
'Earmark Available money into a pot or release it (Decision #337, ruling M6). Moves no money between
wallets; one finance.pot_movements row. Same authority as finance.save_wallet_pot.';

-- finance.pot_movements is a pot's ledger: never rewritten or removed, by any role.
CREATE OR REPLACE FUNCTION finance.fn_pot_movements_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'ledger: finance.pot_movements is append-only — % refused; post a compensating movement', TG_OP
        USING ERRCODE = 'PL403';
END;
$$;
-- #endregion
-- #region AML monitoring signals and the Safety Hold (Decision #529; #336 ruling I1 ⚖️, pending counsel)
-- The data half of "AML-ready" (PRODUCT_SPEC §Identity, Taxes & Compliance 3): the money doors record
-- what they saw in finance.aml_signals, and an operator reads it (finance.read_aml_signals). Nothing here
-- decides anything about a person. The one consumer is the Safety Hold in finance.begin_payout, which
-- refuses a withdrawal for a while and moves no money, and which stays off until the owner turns
-- `aml_safety_hold_enabled` on after counsel. Every dial is a security.platform_params row (00005001).

-- A whole-number dial (hours or days), never below 0; the fallback when it is unset or not a number.
-- Internal.
CREATE OR REPLACE FUNCTION finance.fn_aml_dial_int(p_key text, p_fallback integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT GREATEST(0, COALESCE(
        (SELECT CASE WHEN pg_catalog.jsonb_typeof(pp.value) = 'number' THEN (pp.value #>> '{}')::numeric::integer END
           FROM security.platform_params pp WHERE pp.key = p_key),
        p_fallback
    ));
$$;

-- Whether the Safety Hold is on (`aml_safety_hold_enabled`). Anything but a JSON true is off. Internal.
CREATE OR REPLACE FUNCTION finance.fn_safety_hold_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT pp.value = 'true'::jsonb FROM security.platform_params pp WHERE pp.key = 'aml_safety_hold_enabled'),
        false
    );
$$;

-- Who is on both sides of an escrow, and how: the payer side is the paying person, or the paying
-- business's owner and active members; the payee side is the paid freelancer, or the paid team's owner
-- and active members. A person on both sides is one row: `same_account` (the paying person is the paid
-- freelancer), `business_seat` (the paid freelancer holds a seat on the paying business), `team_seat`
-- (the paying person holds a seat on the paid team) or `business_and_team_seat`. No rows when nobody is.
-- shortcut: an enterprise seat over the paying business is not followed; follow it when enterprise
-- members can spend a business's wallet. Internal.
CREATE OR REPLACE FUNCTION finance.fn_aml_round_trip_people(p_escrow finance.escrows)
RETURNS TABLE (person uuid, relation text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH payer AS (
        SELECT p_escrow.payer_user_id AS person WHERE p_escrow.payer_user_id IS NOT NULL
        UNION
        SELECT b.owner_user_id FROM org.business_profiles b WHERE b.id = p_escrow.payer_business_id
        UNION
        SELECT bm.user_id FROM org.business_members bm
         WHERE bm.business_id = p_escrow.payer_business_id AND bm.status = 'active'
    ), payee AS (
        SELECT p_escrow.payee_id AS person WHERE p_escrow.payee_type = 'freelancer'
        UNION
        SELECT t.owner_user_id FROM org.teams t
         WHERE p_escrow.payee_type = 'team' AND t.id = p_escrow.payee_id
        UNION
        SELECT tm.user_id FROM org.team_members tm
         WHERE p_escrow.payee_type = 'team' AND tm.team_id = p_escrow.payee_id AND tm.status = 'active'
    )
    SELECT payer.person,
           CASE
               WHEN p_escrow.payer_user_id IS NOT NULL AND p_escrow.payee_type = 'freelancer' THEN 'same_account'
               WHEN p_escrow.payer_user_id IS NOT NULL THEN 'team_seat'
               WHEN p_escrow.payee_type = 'freelancer' THEN 'business_seat'
               ELSE 'business_and_team_seat'
           END
      FROM payer
      JOIN payee ON payee.person = payer.person
     WHERE payer.person IS NOT NULL;
$$;

-- The round-trip signal (trg_escrows_aml_round_trip_*, 00001830): when an escrow is held for a named
-- payee (funding) or released (release), each person on both sides of it gets one `round_trip` row. A
-- trigger, so every door that holds or releases money (tickets, seats, revisions, the Chain Reaction,
-- Fair Exit, a dispute ruling) records it without one of them being able to forget. A DEFINER, so the
-- write never depends on who the escrow statement ran as. Moves no money.
CREATE OR REPLACE FUNCTION finance.fn_aml_record_round_trip()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_event text;
BEGIN
    IF NEW.payee_id IS NULL THEN
        RETURN NULL;
    END IF;
    IF NEW.status = 'released' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'released') THEN
        v_event := 'release';
    ELSIF NEW.status = 'held'
          AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'held' OR OLD.payee_id IS NULL) THEN
        v_event := 'funding';
    ELSE
        RETURN NULL;
    END IF;
    INSERT INTO finance.aml_signals (kind, subject_user_id, escrow_id, amount_minor, currency, facts)
    SELECT 'round_trip', r.person, NEW.id, NEW.amount_cents, pg_catalog.upper(NEW.currency),
           pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
               'event', v_event,
               'relation', r.relation,
               'payer_user_id', NEW.payer_user_id,
               'payer_business_id', NEW.payer_business_id,
               'payee_type', NEW.payee_type,
               'payee_id', NEW.payee_id,
               'project_stage_id', NEW.project_stage_id,
               'ticket_id', NEW.ticket_id,
               'cohort_membership_id', NEW.cohort_membership_id,
               'revision_id', NEW.revision_id
           ))
      FROM finance.fn_aml_round_trip_people(NEW) r;
    RETURN NULL;
END;
$$;

-- The card money that makes a withdrawal of p_amount rapid churn, judged at p_now: the settled card
-- payments (top-ups and card-funded escrow locks) the person made, or that came into the wallet, inside
-- `aml_churn_window_hours`, in the withdrawal's currency. One row when the withdrawal and that money
-- both reach `aml_churn_min_minor` in that currency, none otherwise (an unset dial reads as no churn).
-- The money can leave only in the currency it came in: no own-wallet conversion exists (FBP DB18).
-- Internal.
CREATE OR REPLACE FUNCTION finance.fn_aml_churn(
    p_user uuid,
    p_wallet uuid,
    p_amount bigint,
    p_currency text,
    p_now timestamptz
)
RETURNS TABLE (in_minor bigint, payments integer, last_in_at timestamptz, min_minor bigint, window_hours integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH dial AS (
        SELECT finance.fn_param_minor('aml_churn_min_minor', p_currency) AS min_minor,
               finance.fn_aml_dial_int('aml_churn_window_hours', 72) AS hours
    ), card AS (
        SELECT COALESCE(SUM(ip.amount_received_cents), 0)::bigint AS in_minor,
               COUNT(*)::integer AS payments,
               MAX(ip.succeeded_at) AS last_in_at
          FROM finance.inbound_payments ip, dial
         WHERE (ip.created_by = p_user OR ip.wallet_id = p_wallet)
           AND ip.succeeded_at > p_now - pg_catalog.make_interval(hours => dial.hours)
           AND ip.currency = pg_catalog.upper(pg_catalog.btrim(p_currency))
    )
    SELECT card.in_minor, card.payments, card.last_in_at, dial.min_minor, dial.hours
      FROM card, dial
     WHERE dial.min_minor > 0
       AND p_amount >= dial.min_minor
       AND card.in_minor >= dial.min_minor;
$$;

-- When the Safety Hold lets p_user withdraw p_amount from p_wallet again, judged at p_now, and which
-- triggers hold it (PRODUCT_SPEC §Identity, Taxes & Compliance 3; Decision #529). NULL and no triggers
-- while `aml_safety_hold_enabled` is off, or when nothing holds it. Each trigger listed in
-- `aml_safety_hold_triggers` holds for `aml_safety_hold_hours` after its own event, and the latest end
-- wins:
--   sign_in_change  the person moved their sign-in (Decision #451 (c)): from the `user.sign_in_changed`
--                   audit row
--   rapid_churn     this withdrawal is rapid churn (finance.fn_aml_churn): from the newest card payment
--   round_trip      a round_trip signal names the person: from the signal
--   new_account     the account is younger than `aml_new_account_days` and card money came in: from
--                   the newest card payment, whatever its size
-- It reads only; it never touches pending_releases or their clock, so it cannot shorten or lengthen the
-- escrow holding period (PRD-F15). Internal; probes call it with a later p_now to prove the hold ends.
CREATE OR REPLACE FUNCTION finance.fn_safety_hold(
    p_user uuid,
    p_wallet uuid,
    p_amount bigint,
    p_currency text,
    p_now timestamptz,
    OUT held_until timestamptz,
    OUT triggers text[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_on jsonb;
    v_hold interval;
    v_at timestamptz;
BEGIN
    triggers := ARRAY[]::text[];
    IF NOT finance.fn_safety_hold_enabled() THEN
        RETURN;
    END IF;
    SELECT pp.value INTO v_on FROM security.platform_params pp WHERE pp.key = 'aml_safety_hold_triggers';
    IF v_on IS NULL OR pg_catalog.jsonb_typeof(v_on) <> 'array' THEN
        RETURN;
    END IF;
    v_hold := pg_catalog.make_interval(hours => finance.fn_aml_dial_int('aml_safety_hold_hours', 72));

    IF v_on ? 'sign_in_change' THEN
        SELECT MAX(a.created_at) INTO v_at
          FROM security.audit_logs a
         WHERE a.user_id = p_user AND a.action = 'user.sign_in_changed'
           AND a.created_at > p_now - v_hold;
        IF v_at IS NOT NULL THEN
            held_until := GREATEST(held_until, v_at + v_hold);
            triggers := triggers || 'sign_in_change'::text;
        END IF;
    END IF;

    IF v_on ? 'rapid_churn' THEN
        SELECT c.last_in_at INTO v_at FROM finance.fn_aml_churn(p_user, p_wallet, p_amount, p_currency, p_now) c;
        IF v_at IS NOT NULL AND v_at + v_hold > p_now THEN
            held_until := GREATEST(held_until, v_at + v_hold);
            triggers := triggers || 'rapid_churn'::text;
        END IF;
    END IF;

    IF v_on ? 'round_trip' THEN
        SELECT MAX(s.created_at) INTO v_at
          FROM finance.aml_signals s
         WHERE s.subject_user_id = p_user AND s.kind = 'round_trip'
           AND s.created_at > p_now - v_hold;
        IF v_at IS NOT NULL THEN
            held_until := GREATEST(held_until, v_at + v_hold);
            triggers := triggers || 'round_trip'::text;
        END IF;
    END IF;

    IF v_on ? 'new_account' AND EXISTS (
        SELECT 1 FROM auth.users u
         WHERE u.id = p_user
           AND u.created_at > p_now - pg_catalog.make_interval(days => finance.fn_aml_dial_int('aml_new_account_days', 30))
    ) THEN
        SELECT MAX(ip.succeeded_at) INTO v_at
          FROM finance.inbound_payments ip
         WHERE (ip.created_by = p_user OR ip.wallet_id = p_wallet)
           AND ip.succeeded_at > p_now - v_hold;
        IF v_at IS NOT NULL THEN
            held_until := GREATEST(held_until, v_at + v_hold);
            triggers := triggers || 'new_account'::text;
        END IF;
    END IF;
END;
$$;

-- finance.aml_signals is a record of what the money doors saw: never rewritten or removed, by any role.
CREATE OR REPLACE FUNCTION finance.fn_aml_signals_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'aml: finance.aml_signals is append-only — % refused', TG_OP
        USING ERRCODE = 'PL403';
END;
$$;

-- The operator door (`/admin/ledger`'s AML signals section): security.is_admin() only. Anyone else gets
-- 42501, which the page answers with a 404, as /admin/disputes does (Decision #212). The newest
-- p_limit signals (1–500, default 200) with their facts and the subject's handle, the count of every
-- kind, and whether the Safety Hold is on. Reads only: there is no review queue to act from (Identity
-- X2's, dormant, Decision #529 (a)).
CREATE OR REPLACE FUNCTION finance.read_aml_signals(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a platform operator can read AML signals' USING ERRCODE = '42501';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'as_of', pg_catalog.now(),
        'hold_enabled', finance.fn_safety_hold_enabled(),
        'counts', (
            SELECT pg_catalog.jsonb_build_object(
                'round_trip', COUNT(*) FILTER (WHERE s.kind = 'round_trip'),
                'rapid_churn', COUNT(*) FILTER (WHERE s.kind = 'rapid_churn'),
                'safety_hold', COUNT(*) FILTER (WHERE s.kind = 'safety_hold')
            )
              FROM finance.aml_signals s
        ),
        'signals', COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'id', s.id,
                'kind', s.kind,
                'subject_user_id', s.subject_user_id,
                'subject_username', u.username,
                'wallet_id', s.wallet_id,
                'escrow_id', s.escrow_id,
                'payout_id', s.payout_id,
                'amount_minor', s.amount_minor,
                'currency', s.currency,
                'facts', s.facts,
                'created_at', s.created_at
            ) ORDER BY s.created_at DESC, s.id)
              FROM (
                  SELECT * FROM finance.aml_signals
                   ORDER BY created_at DESC, id
                   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
              ) s
              LEFT JOIN org.users_public u ON u.user_id = s.subject_user_id
        ), '[]'::jsonb)
    );
END;
$$;

COMMENT ON FUNCTION finance.read_aml_signals(integer) IS
'The operator read of the AML monitoring signals (Decision #529): the newest signals with their facts,
each kind''s count and whether the Safety Hold is on. security.is_admin() only (42501 otherwise). Reads
only; acts on nothing.';
-- #endregion
