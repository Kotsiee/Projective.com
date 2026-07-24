-- =============================================================================================
-- 20260723093000_finance_vault_governance.sql
-- Wallet & Finance foundation (4/5) — Vault permissions, caps, approvals, audit & team split rules.
--
-- ADDITIVE ONLY. New enums, new finance tables, a new capability predicate. No existing object is
-- altered. Authored, NOT applied to any live database. Every new table has RLS + policies; vault
-- capability checks are enforceable IN-DB via finance.fn_has_vault_capability().
--
-- Reuses what already exists (does NOT fork):
--   * Per-member SPENDING CAPS are the existing finance.spending_limits table (migration 0009:
--     wallet_id, member_user_id, cap_cents, period_interval, spent_cents) + finance.fn_check_spending_limit.
--     No new "spending_caps" table — the caps model is formalised in the docs, not duplicated.
--   * Team per-member split shares are the existing finance.contribution_agreements (percent_bp) +
--     finance.payout_splits. finance.split_rules below adds the RULESET TEMPLATE (Co-op / Finder's
--     Fee / Benevolent Dictator + the Vault cut) that RESOLVES INTO those per-member rows.
-- ⚠️ Flagged (root CLAUDE.md §8): the capability set overlaps org.business_permission
-- (manage_billing / manage_escrow) and org.team_permission (manage_finances) — reconcile the two
-- authorities with a human rather than forking silently.
-- =============================================================================================

-- #region 1. finance.vault_permissions — capability GRANTS (not a single role)
-- Fine-grained money capabilities on a shared wallet (Business / Team / Organisation vault). A member
-- holds a SET of capabilities; the app grants sensible bundles that map to Owner/Admin/PM roles.
DO $$ BEGIN
    CREATE TYPE finance.vault_capability AS ENUM (
        'view', 'add_funds', 'spend', 'distribute', 'withdraw', 'manage_members', 'manage_billing'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.vault_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    member_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    capabilities finance.vault_capability[] NOT NULL DEFAULT '{}',
    granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_vault_permission UNIQUE (wallet_id, member_user_id)
);

CREATE INDEX IF NOT EXISTS idx_vault_permissions_wallet ON finance.vault_permissions (wallet_id);
CREATE INDEX IF NOT EXISTS idx_vault_permissions_member ON finance.vault_permissions (member_user_id);

-- In-DB capability check. SECURITY DEFINER so future money-movement RPCs can gate on it without RLS
-- recursion. An owner-level member (manage_members) implicitly has every capability.
CREATE OR REPLACE FUNCTION finance.fn_has_vault_capability(
    p_wallet uuid, p_user uuid, p_cap finance.vault_capability
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR EXISTS (
            SELECT 1 FROM finance.vault_permissions vp
            WHERE vp.wallet_id = p_wallet
              AND vp.member_user_id = p_user
              AND (p_cap = ANY (vp.capabilities) OR 'manage_members'::finance.vault_capability = ANY (vp.capabilities))
        );
$$;

ALTER TABLE finance.vault_permissions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.vault_permissions TO authenticated;
GRANT ALL ON TABLE finance.vault_permissions TO service_role;

-- Any member who can view the wallet may read the grant list; mutations flow through a
-- manage_members-gated SECURITY DEFINER RPC (deferred), so no INSERT/UPDATE policy is opened here.
DROP POLICY IF EXISTS "View vault permissions" ON finance.vault_permissions;
CREATE POLICY "View vault permissions" ON finance.vault_permissions FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

GRANT EXECUTE ON FUNCTION finance.fn_has_vault_capability(uuid, uuid, finance.vault_capability) TO authenticated;
-- #endregion

-- #region 2. finance.split_rules — team smart-split RULESET templates (finance-model.md §5)
-- The template that resolves into finance.contribution_agreements (per-member percent_bp). Exactly
-- one active rule per team. `vault_bp` is the Team Vault cut taken first; the remainder is split per
-- the template. Deterministic remainder rounding: any leftover minor unit after integer division goes
-- to the Team Vault, so the ledger always sums to zero (documented in finance-model.md §5).
DO $$ BEGIN
    CREATE TYPE finance.split_rule_type AS ENUM ('co_op', 'finders_fee', 'benevolent_dictator');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.split_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    team_id uuid NOT NULL REFERENCES org.teams (id) ON DELETE CASCADE,
    rule_type finance.split_rule_type NOT NULL DEFAULT 'co_op',
    vault_bp integer NOT NULL DEFAULT 0 CHECK (vault_bp BETWEEN 0 AND 10000),   -- Team Vault cut, taken first
    finder_user_id uuid REFERENCES org.users_public (user_id) ON DELETE SET NULL, -- finders_fee: the originator
    finder_bp integer CHECK (finder_bp IS NULL OR finder_bp BETWEEN 0 AND 10000),  -- finders_fee: their fixed cut
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_split_rules_team ON finance.split_rules (team_id) WHERE active;

ALTER TABLE finance.split_rules ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.split_rules TO authenticated;
GRANT ALL ON TABLE finance.split_rules TO service_role;

-- Team members may read their team's split ruleset; edits go through a manage_finances-gated RPC.
DROP POLICY IF EXISTS "View team split rules" ON finance.split_rules;
CREATE POLICY "View team split rules" ON finance.split_rules FOR
SELECT TO authenticated USING (org.is_active_team_member (team_id) OR security.is_admin ());
-- #endregion

-- #region 3. finance.spend_approvals — approval thresholds + queue (over-cap second sign-off)
-- A spend/distribution over a member's cap (or over a wallet's approval threshold) parks here pending
-- a second approver. Documented threshold rule in finance-model.md §Vault Permissions, Caps & Approvals.
DO $$ BEGIN
    CREATE TYPE finance.approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.spend_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency char(3) NOT NULL,
    reason text NOT NULL,
    ref_table text,
    ref_id uuid,
    status finance.approval_status NOT NULL DEFAULT 'pending',
    approver_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    decided_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spend_approvals_wallet ON finance.spend_approvals (wallet_id, status);

ALTER TABLE finance.spend_approvals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON TABLE finance.spend_approvals TO authenticated;
GRANT ALL ON TABLE finance.spend_approvals TO service_role;

-- Anyone who can view the wallet sees its queue (so approvers find pending requests); the requester
-- may file. The approve/reject decision is a manage_billing-gated SECURITY DEFINER RPC (deferred), so
-- no UPDATE policy is opened here.
DROP POLICY IF EXISTS "View wallet spend approvals" ON finance.spend_approvals;
CREATE POLICY "View wallet spend approvals" ON finance.spend_approvals FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

DROP POLICY IF EXISTS "Request a spend approval" ON finance.spend_approvals;
CREATE POLICY "Request a spend approval" ON finance.spend_approvals FOR
INSERT TO authenticated
WITH CHECK (requested_by = auth.uid () AND finance.fn_can_view_wallet (wallet_id));
-- #endregion

-- #region 4. finance.ledger_audit — immutable who/when/amount trail for vault money moves
-- A finance-specific audit line for every add/spend/distribute/withdraw/transfer. Complements the
-- general security.audit_logs (which logs domain mutations broadly) with a money-shaped record the
-- Business/Team finance surfaces read directly. ⚠️ Flagged overlap with security.audit_logs
-- (root CLAUDE.md §8) — kept separate for the amount-typed, wallet-scoped read path; reconcile if a
-- single audit sink is preferred.
DO $$ BEGIN
    CREATE TYPE finance.vault_action AS ENUM ('add_funds', 'spend', 'distribute', 'withdraw', 'transfer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.ledger_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    action finance.vault_action NOT NULL,
    amount_cents bigint NOT NULL,
    currency char(3) NOT NULL,
    ref_table text,
    ref_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_audit_wallet ON finance.ledger_audit (wallet_id, created_at DESC);

ALTER TABLE finance.ledger_audit ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.ledger_audit TO authenticated;
GRANT ALL ON TABLE finance.ledger_audit TO service_role;

-- Read-only to those who can view the wallet; writes are SECURITY DEFINER / service-role only so the
-- trail is append-only and cannot be forged by a member.
DROP POLICY IF EXISTS "View wallet ledger audit" ON finance.ledger_audit;
CREATE POLICY "View wallet ledger audit" ON finance.ledger_audit FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));
-- #endregion

-- #region 5. Approval-threshold parameter
INSERT INTO security.platform_params (key, value, description) VALUES
    ('vault_approval_threshold_cents', '0'::jsonb,
        'Wallet spend amount (minor units) at or above which a second approver is required (in addition to per-member spending caps). Magnitude in finance-model.md §Vault Permissions, Caps & Approvals; default 0 = disabled.')
ON CONFLICT (key) DO NOTHING;
-- #endregion
