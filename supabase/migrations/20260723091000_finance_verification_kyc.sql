-- =============================================================================================
-- 20260723091000_finance_verification_kyc.sql
-- Wallet & Finance foundation (2/5) — KYC / KYB status, tier & payout-readiness gating.
--
-- ADDITIVE ONLY. Adds one enum, one finance table, and nullable status columns to
-- org.freelancer_profiles + org.business_profiles. No existing column, FK, or function is altered.
-- Authored, NOT applied to any live database.
--
-- The gating rule this encodes (PRODUCT_SPEC.md §Identity Verification (KYC & KYB) + finance-model.md
-- §KYC/KYB Gating):
--   * FREELANCERS (earners): government-ID verification AND a payout-ready wallet are ONBOARDING
--     gates — a freelancer cannot land a gig or join a team until verified + payout-ready. This
--     guarantees no funds ever land in a permanent-escrow / unpayable state.
--   * CLIENTS (individual buyers): NO ID verification and NO wallet required — a tap-and-pay path
--     (Stripe, optional save-card) keeps paying friction-free. (No KYC columns are added for the
--     buyer identity; they are simply never gated.)
--   * BUSINESS OWNERS (and a client who owns a business): wallet verification (KYB) is required to
--     OPERATE the pooled Business Wallet.
--
-- ⚠️ Distinct from EMAIL verification: `org.user_emails.verified_at` (migration 0312) is GoTrue email
-- confirmation, NOT identity/KYC. These are separate concerns and are deliberately not conflated.
--
-- ⚠️ Reconciliation (flagged, root CLAUDE.md §8): this REFINES PRODUCT_SPEC's tiered model
-- (Level 1 Basic / Level 2 Verified Freelancer-Client / Level 3 Business KYB, Decisions #6/#7) — the
-- freelancer Level-2 gate becomes an ONBOARDING gate (not only a payout-time gate), and clients are
-- explicitly exempt (tap-and-pay). Organisations already carry `org.organisation_verification_level`
-- (migration 0314); that enum is the org's KYB cache and is unchanged here.
-- =============================================================================================

-- #region 1. Verification status enum (individual/business identity lifecycle)
DO $$ BEGIN
    CREATE TYPE finance.kyc_status AS ENUM ('unverified', 'pending', 'verified', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- #endregion

-- #region 2. finance.verification_cases — the auditable verification trail (no PII stored)
-- One row per identity/business verification attempt. Only PROVIDER REFERENCES are stored (Stripe
-- Identity verification-session id for KYC, Stripe Connect account id for KYB) — never a passport
-- number, SSN, or document image (PRODUCT_SPEC.md §Data Privacy & The "Vault": PII lives in Supabase
-- Vault / at Stripe, never in a domain table). The denormalized status columns in §3/§4 are the
-- fast-read caches; this table is the append-friendly history.
CREATE TABLE IF NOT EXISTS finance.verification_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('freelancer', 'business', 'organisation', 'user')),
    subject_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('kyc', 'kyb')),
    status finance.kyc_status NOT NULL DEFAULT 'pending',
    -- Tier mirrors the PRODUCT_SPEC ladder: 1 = Basic (email/phone), 2 = Verified (gov ID / liveness),
    -- 3 = Business (KYB / UBO). NULL until a tier is granted.
    tier smallint CHECK (tier BETWEEN 1 AND 3),
    provider text NOT NULL DEFAULT 'stripe_identity',   -- 'stripe_identity' | 'stripe_connect' | ...
    provider_ref text,                                  -- external verification-session / account id (placeholder XXXX-XXXX in docs)
    submitted_at timestamptz,
    decided_at timestamptz,
    notes text,                                         -- reviewer/system note (no PII)
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_cases_subject ON finance.verification_cases (subject_type, subject_id, status);

ALTER TABLE finance.verification_cases ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE finance.verification_cases TO authenticated;
GRANT ALL ON TABLE finance.verification_cases TO service_role;

-- The subject (or its active members) may view its own verification history; admins see all. Writes
-- are SECURITY DEFINER / service-role only (a verification webhook owns status transitions).
DROP POLICY IF EXISTS "View own verification cases" ON finance.verification_cases;
CREATE POLICY "View own verification cases" ON finance.verification_cases FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (subject_type IN ('freelancer', 'user') AND subject_id = auth.uid ())
        OR (subject_type = 'business' AND org.is_active_business_member (subject_id))
        OR (subject_type = 'organisation' AND org.is_organisation_member (subject_id))
    );
-- #endregion

-- #region 3. Freelancer KYC + payout-readiness cache (additive columns)
-- The earner's denormalized status. `payout_ready` is TRUE only once the freelancer is KYC-verified
-- AND has a usable payout method — the two halves of the onboarding gate.
ALTER TABLE org.freelancer_profiles
    ADD COLUMN IF NOT EXISTS kyc_status finance.kyc_status NOT NULL DEFAULT 'unverified',
    ADD COLUMN IF NOT EXISTS kyc_tier smallint,
    ADD COLUMN IF NOT EXISTS kyc_verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS payout_ready boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS identity_provider_ref text;   -- Stripe Identity session id (placeholder; no PII)
-- #endregion

-- #region 4. Business KYB cache (additive columns) — required to OPERATE the pooled Business Wallet
ALTER TABLE org.business_profiles
    ADD COLUMN IF NOT EXISTS kyb_status finance.kyc_status NOT NULL DEFAULT 'unverified',
    ADD COLUMN IF NOT EXISTS kyb_verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS kyb_provider_ref text;         -- Stripe Connect account id (placeholder; no PII)
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

GRANT EXECUTE ON FUNCTION finance.fn_freelancer_payout_ready(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_business_kyb_verified(uuid) TO authenticated;
-- #endregion
