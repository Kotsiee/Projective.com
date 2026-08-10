-- =============================================================================================
-- 00000017_tables_finance.sql — finance schema tables (Category 0), final folded form.
-- Base: 0009_finance_tables.sql. Also: 20260723090000..094000 (fx/kyc/methods/vault/settlement),
--       20260724112000 (plans/entitlements/subscriptions extension), 113000 (allowances).
-- Folded ALTERs:
--   * finance.transactions  += fx_rate, fx_base, fx_as_of                        (20260723090000)
--   * finance.escrows       += fx_rate, fx_base, fx_as_of                        (20260723090000)
--   * finance.subscriptions += subject scoping / plan_id / period / provider cols;
--                              plan SET DEFAULT 'free'                            (20260724112000)
-- Table order is dependency-sorted (e.g. finance.plans precedes finance.subscriptions;
-- org.standing_levels — defined in 00000011 — precedes finance.standing_commission_tiers).
-- =============================================================================================

CREATE TABLE finance.wallets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    currency text NOT NULL,
    balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_wallet_owner_currency UNIQUE (
        owner_type,
        owner_id,
        currency
    )
);

CREATE TABLE finance.transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    direction text NOT NULL CHECK (
        direction IN ('credit', 'debit')
    ),
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency text NOT NULL,
    reason text NOT NULL,
    ref_table text NULL,
    ref_id uuid NULL,
    balance_after_cents bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Folded (20260723090000): FX snapshot captured at commit (NULL when same-currency).
    -- Immutable once written: a statement/invoice reprints the rate that was actually applied, never
    -- today's. `fx_base` defaults to the platform base so a stamped rate is never orphaned from the
    -- currency it was quoted against.
    fx_rate numeric(20, 10),
    fx_base char(3) DEFAULT 'GBP',
    fx_as_of timestamptz
);

CREATE TABLE finance.escrows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    project_stage_id uuid NOT NULL REFERENCES projects.project_stages (id) ON DELETE RESTRICT,
    ticket_id uuid REFERENCES projects.tickets (id) ON DELETE SET NULL,
    payer_business_id uuid NOT NULL REFERENCES org.business_profiles (id) ON DELETE RESTRICT,
    payee_type assignment_type NOT NULL,
    payee_id uuid NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    platform_fee_cents bigint NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
    deadline_bonus_cents bigint NOT NULL DEFAULT 0 CHECK (deadline_bonus_cents >= 0),
    currency text NOT NULL,
    status text NOT NULL DEFAULT 'funded',
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Folded (20260723090000): FX snapshot captured at commit (NULL when same-currency).
    -- Immutable once written — settlement reproduces the escrow at the rate it was funded at.
    fx_rate numeric(20, 10),
    fx_base char(3) DEFAULT 'GBP',
    fx_as_of timestamptz
);

CREATE TABLE finance.payout_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    provider text NOT NULL,
    account_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending_verification',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_payout_accounts_provider_account UNIQUE (provider, account_id)
);

CREATE TABLE finance.invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- Nullable: a consolidated monthly invoice spans many stages (constraint relaxed, not dropped).
    project_stage_id uuid REFERENCES projects.project_stages (id) ON DELETE CASCADE,
    issue_to_business_id uuid NOT NULL REFERENCES org.business_profiles (id) ON DELETE RESTRICT,
    issue_from_profile uuid NOT NULL,
    invoice_type text NOT NULL DEFAULT 'per_stage' CHECK (invoice_type IN ('per_stage', 'consolidated_monthly')),
    billing_period_start timestamptz,
    billing_period_end timestamptz,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    subtotal_cents bigint NOT NULL DEFAULT 0,
    platform_fee_cents bigint NOT NULL DEFAULT 0,
    tax_cents bigint NOT NULL DEFAULT 0,
    total_cents bigint NOT NULL DEFAULT 0,
    currency text NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void')),
    due_date timestamptz,
    paid_at timestamptz,
    pdf_file_id uuid REFERENCES files.items (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    escrow_id uuid NOT NULL REFERENCES finance.escrows (id) ON DELETE CASCADE,
    opened_by_profile uuid NOT NULL,
    reason text NOT NULL,
    status dispute_status NOT NULL DEFAULT 'open',
    resolution_notes text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz NULL
);

CREATE TABLE finance.dispute_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    dispute_id uuid NOT NULL REFERENCES finance.disputes (id) ON DELETE CASCADE,
    sender_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.ratings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    project_id uuid NOT NULL REFERENCES projects.projects (id) ON DELETE CASCADE,
    rater_profile uuid NOT NULL,
    ratee_type text NOT NULL,
    ratee_id uuid NOT NULL,
    score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- finance.plans precedes finance.subscriptions (subscriptions.plan_id references it after folding).
CREATE TABLE finance.plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    code text NOT NULL UNIQUE,
    label text NOT NULL,
    audience finance.plan_audience NOT NULL,
    tier finance.plan_tier NOT NULL,
    price_cents bigint CHECK (price_cents IS NULL OR price_cents >= 0),
    currency char(3) NOT NULL DEFAULT 'GBP',
    billing_interval finance.billing_interval NOT NULL DEFAULT 'monthly',
    is_custom_priced boolean NOT NULL DEFAULT false,
    per_seat_cents bigint CHECK (per_seat_cents IS NULL OR per_seat_cents >= 0),
    is_default boolean NOT NULL DEFAULT false,
    is_public boolean NOT NULL DEFAULT true,
    sort_order smallint NOT NULL DEFAULT 0,
    provider text NOT NULL DEFAULT 'stripe',
    provider_price_ref text,
    pricing_note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    profile_id uuid NOT NULL,
    -- Folded (20260724112000): plan SET DEFAULT 'free'.
    plan text NOT NULL DEFAULT 'free',
    status text NOT NULL DEFAULT 'active',
    started_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz NULL,
    -- Folded (20260724112000): additive subject-scoped extension of the 0009 skeleton.
    subject_type text,
    subject_id uuid,
    plan_id uuid REFERENCES finance.plans (id) ON DELETE RESTRICT,
    state finance.subscription_state NOT NULL DEFAULT 'active',
    billing_interval finance.billing_interval NOT NULL DEFAULT 'monthly',
    current_period_start timestamptz,
    current_period_end timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    trial_ends_at timestamptz,
    seats integer CHECK (seats IS NULL OR seats > 0),
    price_cents bigint CHECK (price_cents IS NULL OR price_cents >= 0),
    currency char(3),
    provider text NOT NULL DEFAULT 'stripe',
    provider_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.spending_limits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    member_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    cap_cents bigint NOT NULL CHECK (cap_cents >= 0),
    period_interval text NOT NULL DEFAULT 'monthly' CHECK (period_interval IN ('weekly', 'monthly', 'total')),
    spent_cents bigint NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
    resets_at timestamptz,
    CONSTRAINT uq_spending_limit UNIQUE (wallet_id, member_user_id)
);

CREATE TABLE finance.invoice_line_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    invoice_id uuid NOT NULL REFERENCES finance.invoices (id) ON DELETE CASCADE,
    ref_type text NOT NULL CHECK (ref_type IN ('escrow', 'bonus', 'platform_fee', 'refund', 'tax')),
    ref_id uuid,
    description text NOT NULL,
    amount_cents bigint NOT NULL,
    currency text NOT NULL
);

CREATE TABLE finance.contribution_agreements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    team_id uuid NOT NULL REFERENCES org.teams (id) ON DELETE CASCADE,
    member_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    percent_bp integer NOT NULL CHECK (percent_bp BETWEEN 0 AND 10000),
    CONSTRAINT uq_contribution_member UNIQUE (team_id, member_user_id)
);

CREATE TABLE finance.payout_splits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    escrow_id uuid NOT NULL REFERENCES finance.escrows (id) ON DELETE CASCADE,
    member_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    amount_cents bigint NOT NULL,
    currency text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- #region Multi-currency FX (20260723090000_finance_currency_fx.sql)
CREATE TABLE finance.fx_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    base char(3) NOT NULL,           -- ISO-4217, e.g. 'GBP'
    quote char(3) NOT NULL,          -- ISO-4217, e.g. 'USD'
    rate numeric(20, 10) NOT NULL CHECK (rate > 0),
    as_of timestamptz NOT NULL,      -- the observation instant this rate is valid as-of
    provider text NOT NULL DEFAULT 'manual',  -- rate source (Stripe FX / ECB / provider slug); XXXX-XXXX in docs
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_fx_rate_observation UNIQUE (base, quote, as_of)
);
-- #endregion

-- #region KYC / KYB (20260723091000_finance_verification_kyc.sql)
CREATE TABLE finance.verification_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('freelancer', 'business', 'organisation', 'user')),
    subject_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('kyc', 'kyb')),
    status finance.kyc_status NOT NULL DEFAULT 'pending',
    tier smallint CHECK (tier BETWEEN 1 AND 3),
    provider text NOT NULL DEFAULT 'stripe_identity',   -- 'stripe_identity' | 'stripe_connect' | ...
    provider_ref text,                                  -- external verification-session / account id (placeholder XXXX-XXXX in docs)
    submitted_at timestamptz,
    decided_at timestamptz,
    notes text,                                         -- reviewer/system note (no PII)
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region Payment methods & money-movement rules (20260723092000)
CREATE TABLE finance.payment_methods (
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

CREATE TABLE finance.deposit_rules (
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

CREATE TABLE finance.payout_schedules (
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

CREATE TABLE finance.income_smoothing (
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

CREATE TABLE finance.wallet_pots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    purpose finance.pot_purpose NOT NULL DEFAULT 'general',
    name text NOT NULL,
    balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    currency char(3) NOT NULL,
    auto_allocate_bp integer NOT NULL DEFAULT 0 CHECK (auto_allocate_bp BETWEEN 0 AND 10000),  -- % of inbound payouts skimmed
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region Vault governance (20260723093000)
CREATE TABLE finance.vault_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    member_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    capabilities finance.vault_capability[] NOT NULL DEFAULT '{}',
    granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_vault_permission UNIQUE (wallet_id, member_user_id)
);

CREATE TABLE finance.split_rules (
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

CREATE TABLE finance.spend_approvals (
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

CREATE TABLE finance.ledger_audit (
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
-- #endregion

-- #region Statements & settlement (20260723094000)
CREATE TABLE finance.pending_releases (
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

CREATE TABLE finance.statements (
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

CREATE TABLE finance.chargebacks (
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

CREATE TABLE finance.idempotency_keys (
    key text PRIMARY KEY,
    scope text NOT NULL,                          -- logical operation ('escrow.hold', 'payout.create', ...)
    request_hash text NOT NULL,                   -- hash of the request payload (mismatch on same key = conflict)
    status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'succeeded', 'failed')),
    response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz
);
-- #endregion

-- #region Billing plans & entitlements (20260724112000)
CREATE TABLE finance.plan_entitlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    plan_id uuid NOT NULL REFERENCES finance.plans (id) ON DELETE CASCADE,
    entitlement_key finance.entitlement_key NOT NULL,
    kind finance.entitlement_kind NOT NULL DEFAULT 'limit',
    limit_value integer CHECK (limit_value IS NULL OR limit_value >= 0),
    is_unlimited boolean NOT NULL DEFAULT false,
    flag_value boolean NOT NULL DEFAULT false,
    scaling finance.entitlement_scaling NOT NULL DEFAULT 'none',
    multiplier_bp integer NOT NULL DEFAULT 10000 CHECK (multiplier_bp >= 0),
    note text,
    CONSTRAINT uq_plan_entitlement UNIQUE (plan_id, entitlement_key),
    CONSTRAINT plan_entitlement_value_present CHECK (
        kind = 'flag' OR is_unlimited OR limit_value IS NOT NULL OR scaling <> 'none'
    )
);

CREATE TABLE finance.subscription_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subscription_id uuid REFERENCES finance.subscriptions (id) ON DELETE SET NULL,
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'freelancer', 'business', 'team', 'organisation')),
    subject_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN
        ('started', 'upgraded', 'downgraded', 'renewed', 'payment_failed', 'paused', 'resumed', 'cancelled', 'expired')),
    from_plan_id uuid REFERENCES finance.plans (id) ON DELETE SET NULL,
    to_plan_id uuid REFERENCES finance.plans (id) ON DELETE SET NULL,
    amount_cents bigint,
    currency char(3),
    provider_ref text,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.entitlement_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'freelancer', 'business', 'team', 'organisation')),
    subject_id uuid NOT NULL,
    entitlement_key finance.entitlement_key NOT NULL,
    limit_value integer CHECK (limit_value IS NULL OR limit_value >= 0),
    is_unlimited boolean NOT NULL DEFAULT false,
    flag_value boolean,
    reason text NOT NULL,
    granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    starts_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.standing_commission_tiers (
    level smallint PRIMARY KEY REFERENCES org.standing_levels (level) ON DELETE CASCADE,
    marketplace_commission_bp integer NOT NULL CHECK (marketplace_commission_bp BETWEEN 0 AND 10000),
    platform_fee_bp integer CHECK (platform_fee_bp IS NULL OR platform_fee_bp BETWEEN 0 AND 10000),
    note text
);

CREATE TABLE finance.negotiated_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('business', 'organisation')),
    subject_id uuid NOT NULL,
    platform_fee_bp integer NOT NULL CHECK (platform_fee_bp BETWEEN 0 AND 10000),
    marketplace_commission_bp integer CHECK (marketplace_commission_bp IS NULL OR marketplace_commission_bp BETWEEN 0 AND 10000),
    minimum_volume_cents bigint CHECK (minimum_volume_cents IS NULL OR minimum_volume_cents >= 0),
    currency char(3),
    contract_ref text,
    approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'expired', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region Allowances & enforcement (20260724113000)
CREATE TABLE finance.allowance_periods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'freelancer', 'team', 'business', 'organisation')),
    subject_id uuid NOT NULL,
    entitlement_key finance.entitlement_key NOT NULL,
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    granted_units integer NOT NULL DEFAULT 0 CHECK (granted_units >= 0),
    consumed_units integer NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
    base_units integer NOT NULL DEFAULT 0,
    standing_bonus_units integer NOT NULL DEFAULT 0,
    buffer_units integer NOT NULL DEFAULT 0 CHECK (buffer_units >= 0),
    buffer_cap integer NOT NULL DEFAULT 0 CHECK (buffer_cap >= 0),
    buffer_refreshed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_allowance_period UNIQUE (subject_type, subject_id, entitlement_key, period_start)
);

CREATE TABLE finance.allowance_ledger (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    period_id uuid NOT NULL REFERENCES finance.allowance_periods (id) ON DELETE CASCADE,
    subject_type text NOT NULL,
    subject_id uuid NOT NULL,
    entitlement_key finance.entitlement_key NOT NULL,
    units integer NOT NULL,                        -- negative = refund (a withdrawn proposal)
    reason text NOT NULL,
    ref_table text,
    ref_id uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region Basket, wishlist & saved cards (pre-transaction state)
-- These three tables sit BEFORE the ledger, not inside it: a basket line is an INTENT to buy, not a
-- movement of money. Nothing here debits, credits or reserves anything — checkout is the moment a
-- basket becomes escrow, and that path stays in the SECURITY DEFINER money functions.
--
-- Order is dependency-driven: finance.baskets precedes finance.basket_items (FK), and
-- finance.saved_cards follows finance.payment_methods (FK), so the file stays layered.

-- A named collection of purchasable intents. A "wishlist" is not a separate table or a separate
-- kind — it is simply a non-default basket with its own name ('3D Asset Wishlist'), which is why
-- there is no `kind` column: one owner may hold many baskets and exactly one of them is the default.
--
-- ⚠️ `owner_type` is the WIDE finance owner axis, deliberately matching finance.payment_methods /
-- finance.payout_schedules / finance.statements. A narrower ('user','business') pair could not
-- express a TEAM basket, and the app's context switcher (root CLAUDE.md Decisions #16/#61) switches
-- between personal / team / business / organisation — the basket must re-scope with it.
CREATE TABLE finance.baskets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'organisation')),
    owner_id uuid NOT NULL,
    name text NOT NULL DEFAULT 'Main Basket',      -- 'Main Basket' / '3D Asset Wishlist' / …
    is_default boolean NOT NULL DEFAULT false,     -- at most one per owner (partial UNIQUE index, cat 4)
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()  -- app/service maintained; no touch trigger (schema convention)
);

COMMENT ON TABLE finance.baskets IS
'A named collection of purchasable intents for one owner (personal, team, business or organisation).
A wishlist is a non-default basket, not a separate entity. Holds no money and reserves no capacity.';

-- One line in a basket. Polymorphic by (item_type, item_id) across the catalogue and the project
-- graph, so `item_id` is deliberately NOT foreign-keyed — its target table is chosen by `item_type`
-- (a digital product, a project, a service, a session) and no single FK can express that.
CREATE TABLE finance.basket_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    basket_id uuid NOT NULL REFERENCES finance.baskets (id) ON DELETE CASCADE,
    item_type finance.purchasable_item_kind NOT NULL,
    item_id uuid NOT NULL,                         -- polymorphic target, resolved by item_type
    -- A stage reference is only meaningful for the ticket kinds; every other kind leaves it NULL.
    -- Because an FK only constrains NON-NULL values, keying it to the one unambiguous target is
    -- both safe and correct — a ticket's stage IS a projects.project_stages row. CASCADE, not SET
    -- NULL: if the stage is gone the line is no longer purchasable, and a stage-less ticket line
    -- would be a silently wrong basket entry rather than an honest absence.
    stage_id uuid REFERENCES projects.project_stages (id) ON DELETE CASCADE,
    -- ⚠️ NOT foreign-keyed, unlike stage_id, because its target is genuinely ambiguous today:
    -- `projects.stage_revision_requests` (a client-requested revision round) and a submission
    -- revision are two different things and the purchasable one has not been settled. Left as a
    -- bare uuid rather than guessing a table; flagged for a human (root CLAUDE.md §8).
    revision_id uuid,
    title text NOT NULL,                           -- display snapshot, so a renamed listing cannot rewrite history
    subtitle text,
    unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
    currency char(3) NOT NULL,
    -- Bounded at both ends. The upper bound mirrors the Zod SSOT (`BasketItemSchema.quantity` is
    -- `.min(1).max(999)`), so a quantity that validates is always storable and a quantity that is
    -- stored always parses; it also keeps `unit_price_minor * quantity` in the discount CHECK below
    -- inside bigint, which an unbounded int4 quantity against a bigint price does not.
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
    discount_code text,
    discount_amount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_amount_minor >= 0),
    is_selected_for_checkout boolean NOT NULL DEFAULT true,
    saved_for_later boolean NOT NULL DEFAULT false,
    -- Gifting: deliver to someone other than the buyer. The structural CHECK is the same shape the
    -- Zod SSOT enforces, so a stored address always parses back out — a read projection that throws
    -- on a malformed address would take the whole basket read down with it.
    destination_email text CHECK (
        destination_email IS NULL OR destination_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- A discount may never exceed the line it discounts, so a basket total can never go negative.
    CONSTRAINT basket_item_discount_within_line CHECK (
        discount_amount_minor <= unit_price_minor * quantity
    )
);

COMMENT ON TABLE finance.basket_items IS
'One purchasable intent in a basket. Prices are a SNAPSHOT for display; checkout re-resolves the
authoritative price server-side, so a stale or tampered line can never set what is actually charged.';

-- The buyer-facing DISPLAY projection of a saved payment instrument.
--
-- ⚠️ Read the table comment below before adding a column here.
CREATE TABLE finance.saved_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'organisation')),
    owner_id uuid NOT NULL,
    -- Ties the display projection back to the money-movement instrument so the two cannot diverge.
    -- Nullable: a card may be saved before its finance.payment_methods row is provisioned, and the
    -- instrument may be retired without erasing the buyer's saved-card list.
    payment_method_id uuid REFERENCES finance.payment_methods (id) ON DELETE SET NULL,
    stripe_payment_method_id text NOT NULL,        -- opaque Stripe PaymentMethod id; XXXX-XXXX in docs
    brand finance.card_brand NOT NULL DEFAULT 'unknown',
    last4 char(4),                                 -- safe display fragment only
    exp_month integer CHECK (exp_month IS NULL OR exp_month BETWEEN 1 AND 12),
    exp_year integer CHECK (exp_year IS NULL OR exp_year BETWEEN 2000 AND 2100),
    cardholder_name text,
    -- The 6-8 digit issuer identification number. Nullable and usually NULL: Stripe only returns an
    -- IIN under an explicitly granted entitlement, so every consumer MUST degrade to `brand` alone.
    bin_number text CHECK (bin_number IS NULL OR bin_number ~ '^[0-9]{6,8}$'),
    is_business_card boolean NOT NULL DEFAULT false,
    created_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    is_default boolean NOT NULL DEFAULT false,     -- at most one per owner (partial UNIQUE index, cat 4)
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_saved_card_owner_provider_ref UNIQUE (owner_type, owner_id, stripe_payment_method_id)
);

COMMENT ON TABLE finance.saved_cards IS
'Display-only projection of a Stripe-held payment instrument. brand / last4 / exp_month / exp_year /
cardholder_name / bin_number are values STRIPE RETURNS to us and are safe to store: they cannot be
used to charge anything. The full card number (PAN) and the CVV are never received by this platform
and are never stored — there is no column for either, and adding one is prohibited. The only thing
here that can move money is stripe_payment_method_id, which is an opaque reference Stripe resolves
against our account, not a credential. Overlaps finance.payment_methods (the funding/payout
instrument registry) and finance.payout_accounts — see documentation/database/finance/Tables.md.';
-- #endregion
