-- Indexes: finance (from 0009, 20260723090000, 20260723091000, 20260723092000,
--          20260723093000, 20260723094000, 20260724112000, 20260724113000)

CREATE INDEX IF NOT EXISTS idx_wallets_owner ON finance.wallets (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_created ON finance.transactions (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escrows_stage ON finance.escrows (project_stage_id);
CREATE INDEX IF NOT EXISTS idx_escrows_ticket ON finance.escrows (ticket_id);
CREATE INDEX IF NOT EXISTS idx_escrows_payer_business ON finance.escrows (payer_business_id);
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
CREATE INDEX IF NOT EXISTS idx_split_rules_team ON finance.split_rules (team_id) WHERE active;
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
