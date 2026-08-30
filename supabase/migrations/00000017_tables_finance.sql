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
    -- The spend above which a member's purchase needs an approver, for THIS vault only. NULL is a
    -- real and common state, not an unset field: it means "no local override", and the resolver
    -- falls back to the global security.platform_params 'vault_approval_threshold_cents'. A NOT NULL
    -- column with a default would copy the platform figure into every wallet at creation and then
    -- silently stop tracking it when the platform figure changed.
    --
    -- Placed here rather than on a governance table because finance.vault_permissions and
    -- finance.spend_approvals both key on wallet_id: the threshold is a property of the vault the
    -- approval is raised against. Flagged for a human — the alternative home is the owning entity
    -- (org.business_profiles), which would apply the same threshold across every currency wallet
    -- that entity holds (root CLAUDE.md §8).
    approval_threshold_cents bigint CHECK (approval_threshold_cents IS NULL OR approval_threshold_cents >= 0),
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
    -- Which pot of capital this row's amount belongs to, stored rather than derived.
    --
    -- The ledger both FILTERS and ORDERS BY this, and the derivation is a three-way join across
    -- finance.pending_releases, finance.escrows and finance.disputes — an expression no index can
    -- serve, so a sorted, paged ledger would degrade to a full scan per page. Reuses the existing
    -- finance.fund_state enum (00000004) rather than declaring a parallel vocabulary, so a row here
    -- and a finance.pending_releases row speak the same four words.
    --
    -- DEFAULT 'available': the overwhelming majority of movements are settled cash at the moment
    -- they are written, and the two states that are not ('locked' while in escrow, 'pending' inside
    -- the 7-day release window) are always written by a function that knows which one applies.
    fund_state finance.fund_state NOT NULL DEFAULT 'available',
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
    -- A ceiling on ONE purchase, evaluated independently of the rolling cap above: a member may hold
    -- a healthy monthly allowance and still be barred from spending it all in a single transaction.
    -- Nullable because "no per-transaction ceiling" is a real policy, distinct from a ceiling of 0,
    -- which would refuse every purchase.
    per_transaction_cents bigint CHECK (per_transaction_cents IS NULL OR per_transaction_cents >= 0),
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
    -- A held stake is immovable: the rebalancer redistributes every OTHER member's share around it
    -- and never touches this one. It is a property of the agreement rather than a transient UI flag,
    -- because the invariant it protects — that the shares still total 10000bp after a rebalance —
    -- has to hold for whoever writes next, not just for the surface that set it.
    held boolean NOT NULL DEFAULT false,
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

-- The EXECUTION log for money leaving the platform, and the only table that can hold a payout
-- that has not arrived.
--
-- Four existing tables each hold one neighbouring fact and none of them holds this one:
-- finance.payout_schedules is the RULE (when and how often), finance.payment_methods is the
-- DESTINATION instrument, finance.payout_accounts is the Connect account behind it, and
-- finance.payout_splits divides ONE escrow release between team members. finance.transactions
-- records only completed movements, so an in-flight payout has nowhere to live and a FAILED payout
-- moves no money at all and therefore leaves no trace whatsoever - the buyer-visible "your payout
-- failed" row would simply not exist.
CREATE TABLE finance.payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    -- SET NULL, not CASCADE: retiring a card must not erase the history of what was paid to it.
    destination_method_id uuid REFERENCES finance.payment_methods (id) ON DELETE SET NULL,
    -- Which rule produced this run; NULL for a manual withdrawal, which is the common case.
    schedule_id uuid REFERENCES finance.payout_schedules (id) ON DELETE SET NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency char(3) NOT NULL,
    status finance.payout_status NOT NULL DEFAULT 'pending',
    instant boolean NOT NULL DEFAULT false,   -- the buyer opted into the Instant Payout fee
    provider text NOT NULL DEFAULT 'stripe',
    provider_ref text,                        -- Stripe Payout / Transfer id; XXXX-XXXX in docs
    -- The ledger debit this payout produced. NULL while in flight, and NULL FOREVER on a failure -
    -- nothing moved, so no transaction exists. Nullable is therefore the honest shape; a NOT NULL
    -- column would force a phantom zero-value debit just to record that a payout did not happen.
    transaction_id uuid REFERENCES finance.transactions (id) ON DELETE SET NULL,
    failure_reason text,
    initiated_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- A reason only ever accompanies a failure; anything else is a stale field contradicting a
    -- successful row.
    CONSTRAINT payouts_reason_only_when_failed CHECK (
        failure_reason IS NULL OR status = 'failed'
    ),
    -- Settlement and the 'paid' state are the same fact stated twice, so they may never disagree:
    -- a paid payout has landed and carries an instant, and nothing else has.
    CONSTRAINT payouts_settled_matches_status CHECK (
        (status = 'paid') = (settled_at IS NOT NULL)
    )
);

COMMENT ON TABLE finance.payouts IS
'One attempt to move money out of a wallet to an external destination. Distinct from
finance.payout_schedules (the rule), finance.payment_methods (the destination) and
finance.transactions (the ledger movement, which exists only once a payout has actually settled).
A failed payout is a first-class row precisely because it produces no transaction.';

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

-- What a promotional code is worth and whether it may still be redeemed.
--
-- Without this table a code is unenforceable: the discount would have to be re-invented at every
-- call site, so two surfaces could value the same code differently and neither could refuse an
-- expired one. Placed before finance.baskets because a reader should meet the code before the
-- column that names one.
--
-- The value is split across two columns rather than one `value` plus a unit, because a percentage
-- and a fixed amount are not the same kind of number: a flat discount is money and needs a currency,
-- a percentage is dimensionless and must not carry one. The CHECK below makes the mismatched
-- combinations - a percent with a currency, a flat with no amount - unrepresentable.
CREATE TABLE finance.promo_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- Stored uppercased so 'summer20' and 'SUMMER20' cannot become two codes; the CHECK enforces it
    -- at the column rather than trusting every writer to normalise first.
    code text NOT NULL CHECK (code = upper(code) AND length(code) BETWEEN 1 AND 40),
    label text NOT NULL,                      -- display copy ('SUMMER20 - 20% off services')
    kind text NOT NULL CHECK (kind IN ('percent', 'flat')),
    value_bp integer CHECK (value_bp IS NULL OR value_bp BETWEEN 0 AND 10000),
    value_minor bigint CHECK (value_minor IS NULL OR value_minor >= 0),
    currency char(3),
    -- An unbounded window at either end is a real configuration ('starts now', 'never expires'),
    -- so both are nullable rather than defaulted to arbitrary far-past / far-future instants.
    starts_at timestamptz,
    expires_at timestamptz,
    max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
    redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
    -- Withdrawing a code is a soft state with a useful instant, not a boolean: knowing WHEN a code
    -- was pulled is what makes a later "why was my code refused" answerable. NULL = still live.
    -- Distinct from expires_at, which is the schedule; this is the manual kill switch.
    deactivated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_promo_code UNIQUE (code),
    CONSTRAINT promo_code_value_matches_kind CHECK (
        (kind = 'percent' AND value_bp IS NOT NULL AND value_minor IS NULL AND currency IS NULL)
        OR (kind = 'flat' AND value_minor IS NOT NULL AND currency IS NOT NULL AND value_bp IS NULL)
    ),
    CONSTRAINT promo_code_window_ordered CHECK (
        starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at
    )
);

COMMENT ON TABLE finance.promo_codes IS
'The source of truth for what a promotional code is worth and whether it may still be redeemed.
redemption_count is deliberately NOT constrained against max_redemptions: concurrent redemptions
race, the cap is enforced by the redeeming function under a row lock, and lowering a cap later must
not retroactively invalidate rows that were legitimately issued under the old one.';

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
    -- The basket-WIDE promotional code, applied to the whole collection. Distinct from
    -- finance.basket_items.discount_code, which is the per-line creator code: a basket carries at
    -- most one promo, a line carries at most one creator discount, and the two stack.
    --
    -- Deliberately NOT a foreign key to finance.promo_codes. The code the buyer typed is part of the
    -- basket's record of itself, and a code later withdrawn or repriced must not silently vanish
    -- from - or change the meaning of - a basket that already carries it. Validation happens at
    -- apply time and again at checkout, against the table, where a refusal can be explained.
    promo_code text CHECK (promo_code IS NULL OR length(promo_code) <= 40),
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
    -- The struck-through pre-discount unit price a creator discount is running against. A SNAPSHOT
    -- for the same reason unit_price_minor is one: re-deriving the RRP from the listing at read time
    -- would let a seller's later price change rewrite the saving a buyer was already shown.
    -- Nullable - most lines carry no discount, and NULL is "no RRP", not "an RRP of zero".
    original_price_minor bigint CHECK (original_price_minor IS NULL OR original_price_minor >= 0),
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
    -- Explicit ordering within the basket. An in-memory list has insertion order; a table does not,
    -- so a reorder the buyer performed would be lost the moment the rows were re-read. Not UNIQUE:
    -- renumbering every sibling atomically would turn a drag into a table lock, and a tie simply
    -- falls back to the created_at tiebreak.
    position smallint NOT NULL DEFAULT 0,
    -- Session booking. A session line is identified by WHEN it was booked as much as by what it is:
    -- two sittings of the same service at two instants are two lines, and merging them by item alone
    -- charges a buyer twice for a time neither booking chose. Every non-session kind leaves all
    -- three NULL. `timezone` is not decoration - an instant with no zone cannot reproduce the label
    -- the buyer confirmed, and the calendar export is built from the pair.
    scheduled_at timestamptz,
    timezone text CHECK (timezone IS NULL OR length(timezone) <= 64),
    -- Seats held on a group-session line. A priced quantity in its own right and NOT foldable into
    -- `quantity`: a cohort line is one booking of N seats, not N bookings.
    seats integer CHECK (seats IS NULL OR seats BETWEEN 1 AND 500),
    -- Gifting: deliver to someone other than the buyer. The structural CHECK is the same shape the
    -- Zod SSOT enforces, so a stored address always parses back out — a read projection that throws
    -- on a malformed address would take the whole basket read down with it.
    destination_email text CHECK (
        destination_email IS NULL OR destination_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- The two ways a line leaves a basket, both soft (root CLAUDE.md - nothing is hard-deleted).
    -- Separate columns rather than one status because they answer different questions and both can
    -- matter: `removed_at` is the buyer changing their mind, which is a signal about the listing;
    -- `purchased_at` is checkout consuming the line, which is what lets an order line trace back to
    -- the basket line it came from. A line that carries neither is live.
    removed_at timestamptz,
    purchased_at timestamptz,
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

-- #region Orders — the record a completed checkout leaves behind
-- Closes the hole logged as Decision #68(g): `CheckoutResult.orderId` was permanently `null` because
-- no orders table existed, so a confirmation page had nothing to read back and an invoice had nothing
-- to cite.
--
-- An order is NOT a purchased basket. The basket is a mutable working set the buyer edits until they
-- pay; the order is the immutable record of what was actually bought, at the prices that actually
-- applied, under the fee mode that actually governed. Deriving one from the other after the fact
-- would let a later basket edit or a fee-schedule change silently restate history.
CREATE TABLE finance.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- Buyer-facing reference ('PJ-8QK4-2M7X'). Separate from `id` because a support conversation
    -- needs something a human can read aloud, and a UUID is not that.
    reference text NOT NULL UNIQUE,
    status finance.order_status NOT NULL DEFAULT 'processing',
    placed_at timestamptz NOT NULL DEFAULT now(),

    -- The wide 5-value finance owner axis, matching finance.baskets rather than inventing a narrower
    -- one — a team, business or organisation can all buy.
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,

    -- SET NULL, not CASCADE: a basket may be cleared or pruned long before the order it produced
    -- stops mattering, and losing the order because its basket was tidied away would be the reverse
    -- of the point.
    basket_id uuid REFERENCES finance.baskets (id) ON DELETE SET NULL,

    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
    creator_discount_minor bigint NOT NULL DEFAULT 0 CHECK (creator_discount_minor >= 0),
    promo_discount_minor bigint NOT NULL DEFAULT 0 CHECK (promo_discount_minor >= 0),
    platform_fee_minor bigint NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0),

    -- The fee RATE and MODE are stamped on the order, not looked up at read time. A platform that
    -- changes its fee must not retroactively restate what a buyer was charged last quarter, and
    -- `security.platform_params.platform_fee_bp` is a live value that can move.
    platform_fee_bp integer NOT NULL CHECK (platform_fee_bp >= 0),
    platform_fee_mode text NOT NULL DEFAULT 'seller_deducted'
        CHECK (platform_fee_mode IN ('seller_deducted', 'buyer_added')),

    tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    -- The buyer's voluntary contribution toward processing costs. Added LAST and never part of the
    -- platform-fee base: charging a percentage of a gift would turn the buyer's generosity into
    -- revenue.
    processing_contribution_minor bigint NOT NULL DEFAULT 0 CHECK (processing_contribution_minor >= 0),
    total_minor bigint NOT NULL CHECK (total_minor >= 0),
    -- Zero on an invoiced order, which is why this is separate from `total_minor`: what was owed and
    -- what was taken are different facts and an invoiced order has the second at zero.
    charged_minor bigint NOT NULL DEFAULT 0 CHECK (charged_minor >= 0),

    payment_provider text NOT NULL DEFAULT 'stripe',
    payment_method_label text NOT NULL DEFAULT ''::text,
    saved_card_id uuid REFERENCES finance.saved_cards (id) ON DELETE SET NULL,

    -- The idempotency key the checkout submitted. UNIQUE, so a retry after an unseen timeout resolves
    -- to the SAME order rather than charging twice — the one guarantee a payment endpoint must make.
    idempotency_key text NOT NULL UNIQUE,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One purchased line. Carries the delivery facts inline because a line is read back on the
-- confirmation page, the invoice and the order history, and joining out to five different subject
-- tables to render a receipt would make the receipt depend on those rows still existing.
CREATE TABLE finance.order_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    order_id uuid NOT NULL REFERENCES finance.orders (id) ON DELETE CASCADE,
    -- Traceability back to the basket line. Deliberately NOT a foreign key: basket items are pruned,
    -- and an order line must outlive the basket row that produced it.
    basket_item_id uuid,

    item_type finance.purchasable_item_kind NOT NULL,
    -- Polymorphic, resolved by `item_type` — the same rule finance.basket_items already follows.
    item_id uuid NOT NULL,

    -- The title and price AS PURCHASED. Snapshotted rather than joined, so a seller renaming or
    -- repricing a listing tomorrow cannot rewrite what a receipt says was bought today.
    title text NOT NULL,
    subtitle text,
    quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
    line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

    fulfilment finance.fulfilment_kind NOT NULL DEFAULT 'pending',
    -- Download fulfilment.
    asset_id uuid REFERENCES files.items (id) ON DELETE SET NULL,
    download_name text,
    download_bytes bigint CHECK (download_bytes IS NULL OR download_bytes >= 0),
    download_format text,
    licence text,
    -- Engagement fulfilment.
    stage_id uuid REFERENCES projects.project_stages (id) ON DELETE SET NULL,
    -- Session fulfilment.
    scheduled_at timestamptz,
    timezone text,
    duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
    seats integer CHECK (seats IS NULL OR seats BETWEEN 1 AND 500),
    conferencing_provider text,

    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The buyer's saved delivery and billing record, per billing identity.
--
-- Keyed on `context_id` ('personal' or 'business:{id}') rather than on the user alone, because one
-- person legitimately bills through several identities and each carries its own address, tax id and
-- invoicing arrangement. `buyerDetailsComplete()` in the SSOT reads exactly these columns, and it is
-- the same predicate that decides the details-step auto-skip and the payment-step gate — so a row
-- that may skip the form is a row that may pay, and the two cannot disagree.
CREATE TABLE finance.buyer_details (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    context_id text NOT NULL,
    context_kind text NOT NULL CHECK (context_kind IN ('personal', 'business')),
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,

    delivery_first_name text NOT NULL DEFAULT ''::text,
    delivery_last_name text NOT NULL DEFAULT ''::text,
    delivery_email text,

    personal_name text NOT NULL DEFAULT ''::text,
    personal_phone text NOT NULL DEFAULT ''::text,
    personal_email text,
    personal_address_line_1 text,
    personal_address_line_2 text,
    personal_address_city text,
    personal_address_state text,
    personal_address_postcode text,
    personal_address_country text,

    business_company_name text,
    business_registration_number text,
    business_tax_id text,
    business_corporate_email text,
    business_phone text,
    business_address_line_1 text,
    business_address_line_2 text,
    business_address_city text,
    business_address_state text,
    business_address_postcode text,
    business_address_country text,

    -- Which department a business buyer attributes spend to. NULL is a real state — an entity that
    -- declares no departments — and not an unfilled field.
    department_id text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- One record per identity per owner. The buyer edits it in place; there is no history here,
    -- because the version that mattered for a given purchase is snapshotted onto the order.
    CONSTRAINT uq_buyer_details_owner_context UNIQUE (owner_type, owner_id, context_id)
);
-- #endregion
