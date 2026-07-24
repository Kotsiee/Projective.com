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

GRANT EXECUTE ON FUNCTION finance.fn_owner_visible(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION finance.fn_can_view_wallet(uuid) TO authenticated;
-- #endregion

-- #region 2. finance.payment_methods — unified funding + payout registry
-- A funding method backs a Stripe PaymentMethod (spend); a payout method backs a Stripe Connect
-- external account (earn); 'both' covers a method usable either way. `external_ref` is the opaque
-- Stripe id — the platform stores no PAN/CVV/expiry (finance-model.md §Payment Methods).
DO $$ BEGIN
    CREATE TYPE finance.method_role AS ENUM ('funding', 'payout', 'both');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.payment_methods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'organisation')),
    owner_id uuid NOT NULL,
    method_role finance.method_role NOT NULL,
    provider text NOT NULL DEFAULT 'stripe',
    external_ref text NOT NULL,            -- Stripe PaymentMethod id (funding) / Connect external account id (payout); XXXX-XXXX in docs
    label text,                            -- user-facing nickname ("Company Visa")
    brand text,                            -- card/bank brand for display only
    last4 char(4),                         -- safe display fragment only
    is_default_funding boolean NOT NULL DEFAULT false,
    is_default_payout boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_owner ON finance.payment_methods (owner_type, owner_id, status);

ALTER TABLE finance.payment_methods ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE finance.payment_methods TO authenticated;
GRANT ALL ON TABLE finance.payment_methods TO service_role;

DROP POLICY IF EXISTS "View own payment methods" ON finance.payment_methods;
CREATE POLICY "View own payment methods" ON finance.payment_methods FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

DROP POLICY IF EXISTS "Manage own payment methods" ON finance.payment_methods;
CREATE POLICY "Manage own payment methods" ON finance.payment_methods FOR ALL TO authenticated
USING (finance.fn_owner_visible (owner_type, owner_id))
WITH CHECK (finance.fn_owner_visible (owner_type, owner_id));
-- #endregion

-- #region 3. finance.deposit_rules — recurring deposits / standing instructions
DO $$ BEGIN
    CREATE TYPE finance.deposit_interval AS ENUM ('weekly', 'monthly');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.deposit_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    source_method_id uuid REFERENCES finance.payment_methods (id) ON DELETE SET NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency char(3) NOT NULL,
    interval finance.deposit_interval NOT NULL,
    next_run_at timestamptz NOT NULL,
    active boolean NOT NULL DEFAULT true,
    failure_count integer NOT NULL DEFAULT 0,   -- consecutive failed charges (drives dunning / auto-pause)
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deposit_rules_wallet ON finance.deposit_rules (wallet_id);
CREATE INDEX IF NOT EXISTS idx_deposit_rules_due ON finance.deposit_rules (next_run_at) WHERE active;

ALTER TABLE finance.deposit_rules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE finance.deposit_rules TO authenticated;
GRANT ALL ON TABLE finance.deposit_rules TO service_role;

DROP POLICY IF EXISTS "View own deposit rules" ON finance.deposit_rules;
CREATE POLICY "View own deposit rules" ON finance.deposit_rules FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

DROP POLICY IF EXISTS "Manage own deposit rules" ON finance.deposit_rules;
CREATE POLICY "Manage own deposit rules" ON finance.deposit_rules FOR ALL TO authenticated
USING (finance.fn_can_view_wallet (wallet_id))
WITH CHECK (finance.fn_can_view_wallet (wallet_id));
-- #endregion

-- #region 4. finance.payout_schedules — manual / scheduled / threshold payout cadence
DO $$ BEGIN
    CREATE TYPE finance.payout_mode AS ENUM ('manual', 'scheduled_weekly', 'scheduled_monthly', 'threshold');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.payout_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'organisation')),
    owner_id uuid NOT NULL,
    mode finance.payout_mode NOT NULL DEFAULT 'manual',
    destination_method_id uuid REFERENCES finance.payment_methods (id) ON DELETE SET NULL,
    threshold_cents bigint CHECK (threshold_cents IS NULL OR threshold_cents > 0),  -- for mode='threshold'
    currency char(3) NOT NULL,
    next_run_at timestamptz,
    instant boolean NOT NULL DEFAULT false,   -- opt-in to the Instant Payout fee (finance-model.md §1.4)
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_payout_schedule_owner UNIQUE (owner_type, owner_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_payout_schedules_owner ON finance.payout_schedules (owner_type, owner_id);

ALTER TABLE finance.payout_schedules ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE finance.payout_schedules TO authenticated;
GRANT ALL ON TABLE finance.payout_schedules TO service_role;

DROP POLICY IF EXISTS "View own payout schedule" ON finance.payout_schedules;
CREATE POLICY "View own payout schedule" ON finance.payout_schedules FOR
SELECT TO authenticated USING (finance.fn_owner_visible (owner_type, owner_id));

DROP POLICY IF EXISTS "Manage own payout schedule" ON finance.payout_schedules;
CREATE POLICY "Manage own payout schedule" ON finance.payout_schedules FOR ALL TO authenticated
USING (finance.fn_owner_visible (owner_type, owner_id))
WITH CHECK (finance.fn_owner_visible (owner_type, owner_id));
-- #endregion

-- #region 5. finance.income_smoothing — the AI "Income Smoother" enrolment (finance-model.md §1.4)
-- Buffers earning peaks and tops up troughs into a salary-like monthly figure. Eligibility gate + fee
-- are concrete numbers in finance-model.md (≥3 months earnings history + a minimum volume; ~0.5%).
CREATE TABLE IF NOT EXISTS finance.income_smoothing (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    enrolled boolean NOT NULL DEFAULT false,
    target_monthly_cents bigint CHECK (target_monthly_cents IS NULL OR target_monthly_cents >= 0),
    currency char(3) NOT NULL,
    fee_bp integer NOT NULL DEFAULT 50 CHECK (fee_bp >= 0),   -- ~0.5% micro-fee
    eligibility_met boolean NOT NULL DEFAULT false,           -- ≥ min-months history + min volume (see params)
    enrolled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_income_smoothing_user UNIQUE (user_id, currency)
);

ALTER TABLE finance.income_smoothing ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE finance.income_smoothing TO authenticated;
GRANT ALL ON TABLE finance.income_smoothing TO service_role;

DROP POLICY IF EXISTS "Manage own income smoothing" ON finance.income_smoothing;
CREATE POLICY "Manage own income smoothing" ON finance.income_smoothing FOR ALL TO authenticated
USING (user_id = auth.uid () OR security.is_admin ())
WITH CHECK (user_id = auth.uid ());
-- #endregion

-- #region 6. finance.wallet_pots — sub-wallets / pots (incl. tax set-aside)
-- A pot is a named sub-balance carved out of a wallet (materialized like the wallet balance). A pot
-- with `auto_allocate_bp > 0` skims that fraction of each inbound payout — the tax-pot auto-set-aside.
DO $$ BEGIN
    CREATE TYPE finance.pot_purpose AS ENUM ('tax', 'savings', 'goal', 'general');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS finance.wallet_pots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    purpose finance.pot_purpose NOT NULL DEFAULT 'general',
    name text NOT NULL,
    balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    currency char(3) NOT NULL,
    auto_allocate_bp integer NOT NULL DEFAULT 0 CHECK (auto_allocate_bp BETWEEN 0 AND 10000),  -- % of inbound payouts skimmed
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_pots_wallet ON finance.wallet_pots (wallet_id);

ALTER TABLE finance.wallet_pots ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON TABLE finance.wallet_pots TO authenticated;
GRANT ALL ON TABLE finance.wallet_pots TO service_role;

DROP POLICY IF EXISTS "View own wallet pots" ON finance.wallet_pots;
CREATE POLICY "View own wallet pots" ON finance.wallet_pots FOR
SELECT TO authenticated USING (finance.fn_can_view_wallet (wallet_id));

DROP POLICY IF EXISTS "Manage own wallet pots" ON finance.wallet_pots;
CREATE POLICY "Manage own wallet pots" ON finance.wallet_pots FOR ALL TO authenticated
USING (finance.fn_can_view_wallet (wallet_id))
WITH CHECK (finance.fn_can_view_wallet (wallet_id));
-- #endregion

-- #region 7. Tunable parameters (concrete magnitudes live in finance-model.md)
INSERT INTO security.platform_params (key, value, description) VALUES
    ('instant_payout_fee_bp', '0'::jsonb,
        'Fee in basis points for an Instant Payout (bypassing the standard Stripe clearing window). Magnitude in finance-model.md §1.4; default 0 pending pricing sign-off.'),
    ('income_smoother_fee_bp', '50'::jsonb,
        'Income Smoother micro-fee in basis points (~0.5%). finance-model.md §1.4.'),
    ('income_smoother_min_months', '3'::jsonb,
        'Minimum months of earnings history before Income Smoother enrolment is eligible. finance-model.md §Money-Movement Rules.'),
    ('income_smoother_min_volume_cents', '0'::jsonb,
        'Minimum lifetime earnings volume (minor units) for Income Smoother eligibility. Magnitude in finance-model.md; default 0 pending sign-off.'),
    ('tax_pot_default_bp', '0'::jsonb,
        'Default auto-set-aside percentage (basis points) suggested for a new tax pot. finance-model.md §Money-Movement Rules; default 0 (opt-in).')
ON CONFLICT (key) DO NOTHING;
-- #endregion
