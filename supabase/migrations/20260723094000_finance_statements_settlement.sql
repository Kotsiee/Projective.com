-- =============================================================================================
-- 20260723094000_finance_statements_settlement.sql
-- Wallet & Finance foundation (5/5) — Fund states, statements, refunds/chargebacks, idempotency,
-- reconciliation.
--
-- ADDITIVE ONLY. New enums, new finance tables, a new read view, new params. No existing object is
-- altered. Authored, NOT applied to any live database.
--
-- ⚠️ Flagged (root CLAUDE.md §8): the wallet balance is MATERIALISED (finance.wallets.balance_cents,
-- maintained by finance.fn_wallet_credit/debit which also write finance.transactions.balance_after_cents)
-- — a per-wallet single-entry running ledger, NOT the derived-double-entry model finance-model.md §7
-- aspires to. The three-state balance (Locked/Pending/Available, + On-hold/Dispute) is a PROJECTION
-- over that ledger + finance.escrows + the new finance.pending_releases below. The "Pending (7-day)"
-- window did not previously exist (escrow release credited Available directly, and
-- org.get_business_finance mislabels DISPUTED escrow as "pending"); finance.pending_releases makes it
-- first-class here. Converting the ledger to true derived-balance double-entry is a future migration
-- flagged for human sign-off — this pass does NOT alter the existing money-movement functions.
-- =============================================================================================

-- #region 1. Fund states + the Pending (7-day) release window & Dispute Lockbox
-- The canonical fund-state vocabulary for the three-state balance projection:
--   locked    → held in finance.escrows (status IN 'funded','held')                — "Escrowed/Locked"
--   pending   → released from escrow, inside the safety window (available_at > now) — "Pending (7-day)"
--   available → the withdrawable wallet balance (finance.wallets.balance_cents)     — "Available"
--   on_hold   → contested funds parked in the Dispute Lockbox (finance.escrows.status='disputed')
DO $$ BEGIN
    CREATE TYPE finance.fund_state AS ENUM ('locked', 'pending', 'available', 'on_hold');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- A row per escrow release inside the safety window. Credited to Available (a real wallet credit)
-- only when available_at elapses with no dispute; a dispute flips it to 'on_hold' (Dispute Lockbox).
CREATE TABLE IF NOT EXISTS finance.pending_releases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    escrow_id uuid NOT NULL REFERENCES finance.escrows (id) ON DELETE CASCADE,
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency char(3) NOT NULL,
    released_at timestamptz NOT NULL DEFAULT now(),
    available_at timestamptz NOT NULL,           -- released_at + pending_release_days
    state finance.fund_state NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_releases_wallet ON finance.pending_releases (wallet_id, state);
CREATE INDEX IF NOT EXISTS idx_pending_releases_due ON finance.pending_releases (available_at) WHERE state = 'pending';

ALTER TABLE finance.pending_releases ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.pending_releases TO authenticated;
GRANT ALL ON TABLE finance.pending_releases TO service_role;

DROP POLICY IF EXISTS "View own pending releases" ON finance.pending_releases;
CREATE POLICY "View own pending releases" ON finance.pending_releases FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));
-- #endregion

-- #region 2. finance.statements — monthly consolidated statement (finance-model.md §Invoicing)
-- The 30-day consolidation (issued on the 1st) — a PDF-ready summary that complements finance.invoices
-- (per-payout billing lines). One statement per owner per period.
DO $$ BEGIN
    CREATE TYPE finance.statement_status AS ENUM ('draft', 'issued', 'final');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.statements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'organisation')),
    owner_id uuid NOT NULL,
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    currency char(3) NOT NULL,
    opening_balance_cents bigint NOT NULL DEFAULT 0,
    closing_balance_cents bigint NOT NULL DEFAULT 0,
    total_in_cents bigint NOT NULL DEFAULT 0,
    total_out_cents bigint NOT NULL DEFAULT 0,
    total_fees_cents bigint NOT NULL DEFAULT 0,
    status finance.statement_status NOT NULL DEFAULT 'draft',
    pdf_file_id uuid REFERENCES files.items (id) ON DELETE SET NULL,
    issued_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_statement_period UNIQUE (owner_type, owner_id, period_start, currency)
);

CREATE INDEX IF NOT EXISTS idx_statements_owner ON finance.statements (owner_type, owner_id, period_start DESC);

ALTER TABLE finance.statements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.statements TO authenticated;
GRANT ALL ON TABLE finance.statements TO service_role;

DROP POLICY IF EXISTS "View own statements" ON finance.statements;
CREATE POLICY "View own statements" ON finance.statements FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));
-- #endregion

-- #region 3. finance.chargebacks — refunds & chargebacks tracking (ledger uses negative reasons)
-- Refunds/chargebacks are recorded as NEGATIVE-direction ledger movements via the existing
-- finance.transactions with canonical `reason` codes ('escrow_refund', 'fair_exit_refund', 'refund',
-- 'chargeback') — documented in finance/Tables.md. This table tracks the CHARGEBACK case itself (the
-- Stripe dispute), which the ledger reason line references.
DO $$ BEGIN
    CREATE TYPE finance.chargeback_status AS ENUM ('opened', 'under_review', 'won', 'lost', 'refunded');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.chargebacks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid REFERENCES finance.wallets (id) ON DELETE SET NULL,
    transaction_id uuid REFERENCES finance.transactions (id) ON DELETE SET NULL,
    escrow_id uuid REFERENCES finance.escrows (id) ON DELETE SET NULL,
    provider_ref text,                            -- Stripe dispute id (placeholder XXXX-XXXX in docs)
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency char(3) NOT NULL,
    status finance.chargeback_status NOT NULL DEFAULT 'opened',
    reason text,
    opened_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chargebacks_wallet ON finance.chargebacks (wallet_id, status);

ALTER TABLE finance.chargebacks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.chargebacks TO authenticated;
GRANT ALL ON TABLE finance.chargebacks TO service_role;

-- Visible to those who can see the affected wallet; writes are definer/service (a Stripe webhook owns
-- chargeback lifecycle). A NULL wallet (unlinked) is admin-only.
DROP POLICY IF EXISTS "View wallet chargebacks" ON finance.chargebacks;
CREATE POLICY "View wallet chargebacks" ON finance.chargebacks FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (wallet_id IS NOT NULL AND finance.fn_can_view_wallet (wallet_id))
    );
-- #endregion

-- #region 4. finance.idempotency_keys — retries never double-move money
-- Every money-mutating request presents an idempotency key; the first execution records its result,
-- and a retry with the same key replays the stored response instead of re-executing. System table:
-- RLS on, no policy → definer/service-role only (the app never reads it directly via PostgREST).
CREATE TABLE IF NOT EXISTS finance.idempotency_keys (
    key text PRIMARY KEY,
    scope text NOT NULL,                          -- logical operation ('escrow.hold', 'payout.create', ...)
    request_hash text NOT NULL,                   -- hash of the request payload (mismatch on same key = conflict)
    status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'succeeded', 'failed')),
    response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expiry ON finance.idempotency_keys (expires_at);

ALTER TABLE finance.idempotency_keys ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE finance.idempotency_keys TO service_role;
-- Deliberately NO grant / policy for `authenticated`: definer-only (RLS-enabled, no policy = locked).
-- #endregion

-- #region 5. finance.v_wallet_reconciliation — internal ledger self-consistency view
-- Reconciliation #1 (internal): a wallet's materialised balance vs the running sum of its ledger
-- movements — `drift_cents` must be 0. Reconciliation #2 (external, Stripe balance vs internal escrow
-- pool) is an operational job documented in SYSTEM_ARCHITECTURE.md §Integration Blueprints, not a view.
CREATE OR REPLACE VIEW finance.v_wallet_reconciliation AS
SELECT
    w.id AS wallet_id,
    w.owner_type,
    w.owner_id,
    w.currency,
    w.balance_cents,
    COALESCE(SUM(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0) AS ledger_sum_cents,
    w.balance_cents - COALESCE(SUM(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0) AS drift_cents
FROM finance.wallets w
LEFT JOIN finance.transactions t ON t.wallet_id = w.id
GROUP BY w.id, w.owner_type, w.owner_id, w.currency, w.balance_cents;

-- The view is SECURITY INVOKER by default; it reads finance.wallets/transactions (no RLS policy =
-- definer-only), so it is reachable only via a SECURITY DEFINER wrapper / service-role — matching the
-- hidden-ledger posture. Exposed to service_role for the reconciliation job / admin tooling.
GRANT SELECT ON finance.v_wallet_reconciliation TO service_role;
-- #endregion

-- #region 6. Pending-window parameter
INSERT INTO security.platform_params (key, value, description) VALUES
    ('pending_release_days', '7'::jsonb,
        'Length (days) of the post-escrow-release safety window before funds become Available/withdrawable (finance-model.md §7 "Pending" state).')
ON CONFLICT (key) DO NOTHING;
-- #endregion
