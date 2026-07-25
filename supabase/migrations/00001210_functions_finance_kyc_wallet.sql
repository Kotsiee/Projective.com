-- ============================================================================
-- 00001210 functions finance kyc wallet
-- Consolidated verbatim from: 20260723091000_finance_verification_kyc.sql, 20260723092000_finance_payment_methods_money_movement.sql, 20260723093000_finance_vault_governance.sql
-- ============================================================================

-- Stripe Connect account id (placeholder; no PII)
-- #endregion

-- #region 5. Gating predicates (the checks the hire/join/fund functions MUST enforce)
-- These are the in-DB gates. They are provided as pure, reusable predicates; wiring them INTO the
-- existing money-movement functions (projects.claim_ticket / finance.fn_hold_ticket_escrow /
-- projects.fund_stage and the hire/join RPCs) is a behavioural change to escrow/stage flow and is
-- FLAGGED for human sign-off (root CLAUDE.md §8) rather than applied here.

-- A freelancer may earn (land a gig / join a team) only when KYC-verified AND payout-ready.
CREATE OR REPLACE FUNCTION finance.fn_freelancer_payout_ready(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, public
AS $$
    SELECT COALESCE((
        SELECT fp.kyc_status = 'verified'::finance.kyc_status AND fp.payout_ready
        FROM org.freelancer_profiles fp
        WHERE fp.user_id = p_user
    ), false);
$$;

-- A pooled Business Wallet may be operated (funds spent/held) only once the business is KYB-verified.
CREATE OR REPLACE FUNCTION finance.fn_business_kyb_verified(p_business uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, public
AS $$
    SELECT COALESCE((
        SELECT bp.kyb_status = 'verified'::finance.kyc_status
        FROM org.business_profiles bp
        WHERE bp.id = p_business
    ), false);
$$;

-- =============================================================================================
-- 20260723092000_finance_payment_methods_money_movement.sql
-- Wallet & Finance foundation (3/5) — Payment methods (spend vs earn) + money-movement rules.
--
-- ADDITIVE ONLY. New enums, new finance tables, new SECURITY DEFINER wallet-visibility helpers, new
-- platform params. No existing object is altered. Authored, NOT applied to any live database.
--
-- Card data is Stripe-owned and NEVER stored here — only an opaque provider reference + safe display
-- fragments (brand, last4). See finance-model.md §Payment Methods and §Money-Movement Rules.
-- =============================================================================================

-- #region 1. Wallet-visibility helpers (reused by every wallet-scoped RLS policy in 3/4/5)
-- finance.wallets has no RLS policy (definer-only), so a SECURITY DEFINER helper can read it without
-- recursion and resolve "can this caller see/manage this owner's money" once, consistently.

-- Can the current user SEE this owner's finances? (owner scope → membership.)
CREATE OR REPLACE FUNCTION finance.fn_owner_visible(p_owner_type text, p_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_owner_type IN ('user', 'freelancer') AND p_owner_id = auth.uid ())
        OR (p_owner_type = 'business' AND org.is_active_business_member (p_owner_id))
        OR (p_owner_type = 'team' AND org.is_active_team_member (p_owner_id))
        OR (p_owner_type = 'organisation' AND org.is_organisation_member (p_owner_id));
$$;

-- Same question for a wallet id (resolves the wallet's owner, then defers to fn_owner_visible).
CREATE OR REPLACE FUNCTION finance.fn_can_view_wallet(p_wallet uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = finance, org, security, public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM finance.wallets w
        WHERE w.id = p_wallet
          AND finance.fn_owner_visible (w.owner_type, w.owner_id)
    );
$$;

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
