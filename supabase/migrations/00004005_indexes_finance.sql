-- Indexes: finance (from 0009, 20260723090000, 20260723091000, 20260723092000,
--          20260723093000, 20260723094000, 20260724112000, 20260724113000)

CREATE INDEX IF NOT EXISTS idx_wallets_owner ON finance.wallets (owner_type, owner_id);
-- `(created_at, id)` is the ledger's keyset (finance.list_ledger): the id breaks ties between lines
-- written in the same instant, so a page boundary is one row, never a set of equal timestamps.
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_created ON finance.transactions (wallet_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_escrows_stage ON finance.escrows (project_stage_id);
CREATE INDEX IF NOT EXISTS idx_escrows_ticket ON finance.escrows (ticket_id);
-- One HELD base escrow per ticket (Decision #189). The hold checks, then inserts, so two concurrent holds
-- both passed the check and the payer paid twice; this index is the arbiter, and fn_hold_ticket_escrow
-- reads its violation as "already held". A paid revision round's escrow (revision_id) sits beside the
-- base escrow, and a seat's escrow has no ticket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_escrows_ticket_base_held ON finance.escrows (ticket_id)
    WHERE status = 'held' AND ticket_id IS NOT NULL AND revision_id IS NULL;
-- A paid revision round is paid for once, whatever became of its escrow.
CREATE UNIQUE INDEX IF NOT EXISTS uq_escrows_revision ON finance.escrows (revision_id)
    WHERE revision_id IS NOT NULL;
-- A seat's escrow (Decision #171) — the cancel, join and auto-release reads all start from the seat.
CREATE INDEX IF NOT EXISTS idx_escrows_cohort_membership ON finance.escrows (cohort_membership_id)
    WHERE cohort_membership_id IS NOT NULL;
-- A sitting is paid for once (Decision #211): one escrow per 1-1 sitting, whatever became of it, so a
-- replayed booking cannot debit the payer twice for the same sitting.
CREATE UNIQUE INDEX IF NOT EXISTS uq_escrows_session_event ON finance.escrows (session_event_id)
    WHERE session_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_escrows_payer_business ON finance.escrows (payer_business_id);
CREATE INDEX IF NOT EXISTS idx_escrows_payer_user ON finance.escrows (payer_user_id) WHERE payer_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_escrows_payee ON finance.escrows (payee_type, payee_id);
CREATE INDEX IF NOT EXISTS idx_payout_accounts_owner ON finance.payout_accounts (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_invoices_business ON finance.invoices (
    issue_to_business_id,
    created_at DESC
);
CREATE INDEX IF NOT EXISTS idx_invoices_stage ON finance.invoices (project_stage_id);
CREATE INDEX IF NOT EXISTS idx_disputes_escrow ON finance.disputes (escrow_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON finance.disputes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_dispute_created ON finance.dispute_messages (dispute_id, created_at ASC);
-- One LIVE dispute per escrow (Decision #212): two racing no-show claims cannot both open one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_disputes_escrow_live ON finance.disputes (escrow_id)
WHERE status IN ('open', 'awaiting_response', 'under_review');
CREATE INDEX IF NOT EXISTS idx_disputes_session_event ON finance.disputes (session_event_id)
WHERE session_event_id IS NOT NULL;
-- The sweep's auto-escalation scan.
CREATE INDEX IF NOT EXISTS idx_disputes_respond_by ON finance.disputes (respond_by)
WHERE status = 'awaiting_response';
-- The sweep's review-SLA scan and the operator queue's oldest-due-first order.
CREATE INDEX IF NOT EXISTS idx_disputes_review_by ON finance.disputes (review_by)
WHERE status = 'under_review';
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_message ON finance.dispute_evidence (message_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_file ON finance.dispute_evidence (file_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute ON finance.dispute_evidence (dispute_id);
CREATE INDEX IF NOT EXISTS idx_ratings_ratee ON finance.ratings (ratee_type, ratee_id);
CREATE INDEX IF NOT EXISTS idx_ratings_project ON finance.ratings (project_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_profile ON finance.subscriptions (profile_id, status);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON finance.invoice_line_items (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payout_splits_escrow ON finance.payout_splits (escrow_id);

CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_asof ON finance.fx_rates (base, quote, as_of DESC);

CREATE INDEX IF NOT EXISTS idx_verification_cases_subject ON finance.verification_cases (subject_type, subject_id, status);

CREATE INDEX IF NOT EXISTS idx_payment_methods_owner ON finance.payment_methods (owner_type, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_deposit_rules_wallet ON finance.deposit_rules (wallet_id);
CREATE INDEX IF NOT EXISTS idx_deposit_rules_due ON finance.deposit_rules (next_run_at) WHERE active;
CREATE INDEX IF NOT EXISTS idx_payout_schedules_owner ON finance.payout_schedules (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_wallet_pots_wallet ON finance.wallet_pots (wallet_id);

CREATE INDEX IF NOT EXISTS idx_vault_permissions_wallet ON finance.vault_permissions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_vault_permissions_member ON finance.vault_permissions (member_user_id);
-- One ACTIVE split rule per team: the payout plan (finance.fn_team_split_plan) reads "the" rule, and
-- two active rows would make which one applies an accident of physical order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_split_rules_team_active ON finance.split_rules (team_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_spend_approvals_wallet ON finance.spend_approvals (wallet_id, status);
CREATE INDEX IF NOT EXISTS idx_ledger_audit_wallet ON finance.ledger_audit (wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_releases_wallet ON finance.pending_releases (wallet_id, state);
CREATE INDEX IF NOT EXISTS idx_pending_releases_due ON finance.pending_releases (available_at) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_statements_owner ON finance.statements (owner_type, owner_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_chargebacks_wallet ON finance.chargebacks (wallet_id, status);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expiry ON finance.idempotency_keys (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_default_per_audience
    ON finance.plans (audience) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_plan_entitlements_key ON finance.plan_entitlements (entitlement_key);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subject ON finance.subscriptions (subject_type, subject_id, state);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_active_subject
    ON finance.subscriptions (subject_type, subject_id)
    WHERE subject_type IS NOT NULL AND state IN ('trialing', 'active', 'past_due', 'paused');
CREATE INDEX IF NOT EXISTS idx_subscription_events_subject
    ON finance.subscription_events (subject_type, subject_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entitlement_grants_lookup
    ON finance.entitlement_grants (subject_type, subject_id, entitlement_key, expires_at);
CREATE INDEX IF NOT EXISTS idx_negotiated_rates_subject
    ON finance.negotiated_rates (subject_type, subject_id, status, ends_at);

CREATE INDEX IF NOT EXISTS idx_allowance_periods_lookup
    ON finance.allowance_periods (subject_type, subject_id, entitlement_key, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_allowance_periods_buffer_sweep
    ON finance.allowance_periods (period_end, buffer_refreshed_at);
CREATE INDEX IF NOT EXISTS idx_allowance_ledger_period ON finance.allowance_ledger (period_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_allowance_ledger_ref ON finance.allowance_ledger (ref_table, ref_id);

-- Basket, wishlist & saved cards.
CREATE INDEX IF NOT EXISTS idx_baskets_owner ON finance.baskets (owner_type, owner_id);
-- An owner has AT MOST ONE default basket. Partial, so the many named wishlists beside it are
-- unconstrained — the uniqueness is a property of "default", not of the basket list.
CREATE UNIQUE INDEX IF NOT EXISTS uq_basket_default_per_owner
    ON finance.baskets (owner_type, owner_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_basket_items_basket ON finance.basket_items (basket_id);
-- Answers "is this listing already in one of my baskets?" without scanning every line.
CREATE INDEX IF NOT EXISTS idx_basket_items_item ON finance.basket_items (item_type, item_id);
-- The dedupe key for a ticket line (Decision #166): one LIVE line per ticket per basket, parked or not.
-- Adding a ticket already in the basket re-selects that line instead of a second charge for one hold.
CREATE UNIQUE INDEX IF NOT EXISTS uq_basket_items_live_ticket
    ON finance.basket_items (basket_id, ticket_id)
    WHERE ticket_id IS NOT NULL AND removed_at IS NULL AND purchased_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_saved_cards_owner ON finance.saved_cards (owner_type, owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_card_default_per_owner
    ON finance.saved_cards (owner_type, owner_id) WHERE is_default;

-- The Stripe fiat rails (Decision #125).
-- A wallet's card payments, newest first — the ledger's inbound half.
CREATE INDEX IF NOT EXISTS idx_inbound_payments_wallet
    ON finance.inbound_payments (wallet_id, created_at DESC);
-- The escrow-lock payments a stage has had.
CREATE INDEX IF NOT EXISTS idx_inbound_payments_stage
    ON finance.inbound_payments (project_stage_id) WHERE project_stage_id IS NOT NULL;
-- The card payments a paid revision round has had (Decision #199).
CREATE INDEX IF NOT EXISTS idx_inbound_payments_revision
    ON finance.inbound_payments (revision_id) WHERE revision_id IS NOT NULL;
-- Scheduled deposit runs claimed but never bound to a PaymentIntent — what each deposit sweep
-- re-offers (finance.claim_due_deposit_rules). Empty in steady state.
CREATE INDEX IF NOT EXISTS idx_inbound_payments_unbound_deposits
    ON finance.inbound_payments (created_at)
    WHERE deposit_rule_id IS NOT NULL AND provider_ref IS NULL AND status = 'requires_payment';
-- One ACTIVE Stripe payout account per owner. Partial, so a disabled account's history stays beside
-- its replacement; record_payout_account returns the existing active account rather than racing it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_accounts_owner_active
    ON finance.payout_accounts (owner_type, owner_id, provider) WHERE status <> 'disabled';
-- One verification case per provider session: the webhook finds a case by its session id, and two
-- cases claiming one session would make "which case did Stripe just decide" unanswerable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_cases_provider_ref
    ON finance.verification_cases (provider, provider_ref) WHERE provider_ref IS NOT NULL;
-- One chargeback per processor dispute, and one payout per processor transfer: without them a
-- redelivered event could not be deduplicated on the processor's own id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_chargebacks_provider_ref
    ON finance.chargebacks (provider_ref) WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payouts_provider_ref
    ON finance.payouts (provider, provider_ref) WHERE provider_ref IS NOT NULL;
-- The stale-pending sweep's scan (finance.fn_claim_stale_payouts, Decision #202), and the payouts a
-- connected account's bank payout carried (finance.record_bank_payout).
CREATE INDEX IF NOT EXISTS idx_payouts_pending_initiated
    ON finance.payouts (initiated_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_payouts_bank_payout_ref
    ON finance.payouts (bank_payout_ref) WHERE bank_payout_ref IS NOT NULL;

-- #region Listing analytics and the client pipeline (Decision #217)
-- The lines that bought a listing (fn_seller_order_lines, fn_rollup_listings) are found by the
-- polymorphic item they bought.
CREATE INDEX IF NOT EXISTS idx_order_lines_item
    ON finance.order_lines (item_id, item_type);
-- The daily listing rollup reads one UTC day of orders (placed, or last changed for refunds) and of
-- basket additions.
CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON finance.orders (placed_at);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON finance.orders (updated_at);
CREATE INDEX IF NOT EXISTS idx_basket_items_created_at ON finance.basket_items (created_at);
-- #endregion
