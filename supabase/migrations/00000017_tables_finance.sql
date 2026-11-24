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
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'team', 'business', 'enterprise')),
    owner_id uuid NOT NULL,
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
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

-- Append-only (Decision #186): trg_transactions_append_only (00001830) refuses UPDATE, DELETE and
-- TRUNCATE for every role, so a correction is a compensating row, never an edit. RESTRICT, not
-- CASCADE: a wallet that has ledger history is never hard-deleted.
CREATE TABLE finance.transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE RESTRICT,
    direction text NOT NULL CHECK (
        direction IN ('credit', 'debit')
    ),
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- Every code a finance function writes, and nothing else (FCA N24, N36). finance.fn_wallet_debit's
    -- voluntary and involuntary lists (00001200) and finance.fn_is_income_reason (00001240) classify
    -- them and name nothing outside this list (supabase/probes/currency_integrity.sql);
    -- LEDGER_KIND_REASONS (@projective/types/finance) is pinned to it by ledger-reasons.contract.test.ts.
    reason text NOT NULL CHECK (reason IN (
        -- debits: the voluntary spends, then the involuntary recoveries (team_distribution and
        -- fx_conversion also credit the other side)
        'escrow_hold', 'order_payment', 'invoice_payment', 'transfer_out', 'team_distribution', 'payout',
        'fx_conversion', 'fx_spread', 'chargeback', 'refund', 'forfeit_refund',
        -- earned credits, through the pending window
        'escrow_release', 'escrow_release_vault_retention', 'fair_exit_release',
        'fair_exit_release_vault_retention', 'team_split', 'team_finder_fee', 'product_sale', 'product_royalty',
        -- money in, and the payer's own money back
        'topup', 'transfer_in', 'escrow_refund', 'fair_exit_refund', 'order_refund', 'payout_reversal',
        'on_account_credit',
        -- the developer simulator (finance.simulate_wallet_transaction), never a real movement
        'simulated_escrow_lock', 'simulated_escrow_release', 'simulated_platform_fee',
        'simulated_split_payout', 'simulated_top_up', 'simulated_refund'
    )),
    ref_table text NULL,
    ref_id uuid NULL,
    balance_after_cents bigint NOT NULL,
    -- Meant to name the pot of capital the row's amount belongs to, in finance.fund_state's four words
    -- (00000004, the vocabulary finance.pending_releases.state speaks). No function writes it: every row a
    -- door writes takes the DEFAULT 'available' (FCA N13, FDD X22). The fund states are projected from
    -- finance.escrows, finance.pending_releases and the wallets instead; only the generated seed stamps
    -- its escrow holds 'locked'.
    fund_state finance.fund_state NOT NULL DEFAULT 'available',
    -- clock_timestamp(), not now(): several movements are often written in ONE transaction (a card
    -- settlement credits then holds escrow; a lost dispute refunds then claws back), and now() gives
    -- them all the transaction's start instant — so a ledger ordered by time fell back to the random
    -- uuid and printed `balance_after_cents` out of the order it was computed in (#125(e), Decision
    -- #126). The wall clock keeps the rows in write order.
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    -- The FX snapshot of a row a conversion wrote (finance.fx_conversions, Decision #435), NULL on every
    -- other row: one `fx_base` (the currency the payer paid in) bought `fx_rate` units of the pair's other
    -- currency at mid-market, observed `fx_as_of`. Immutable with the row, so a statement or invoice
    -- reprints the rate that was applied, never today's. `fx_base` keeps the platform-base default.
    fx_rate numeric(20, 10),
    fx_base char(3) DEFAULT 'GBP' CHECK (fx_base ~ '^[A-Z]{3}$'),
    fx_as_of timestamptz
);

-- #region FX conversion — paying in one's own currency for money held in another (Decision #435)
-- A locked conversion price: what `to_minor` of `to_currency` costs in `from_currency` at the newest
-- platform-base rates of both (`from_rate`, `to_rate`; amount_quote = amount_base × rate) plus the
-- disclosed margin (`security.platform_params.fx_spread_bp`). `principal_minor` is the mid-market cost
-- and `spread_minor` the margin on it, both truncated (Decision #187); `from_minor` is what the payer is
-- charged. Written only by finance.quote_fx_conversion for the account that pays, frozen except for
-- `consumed_at` (trg_fx_quotes_guard, 00001830), executed at most once by finance.fn_execute_fx_quote.
-- A quote a card payment was started on is honoured past `expires_at`: the payer was charged on it.
CREATE TABLE finance.fx_quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'team', 'business', 'enterprise')),
    owner_id uuid NOT NULL,
    purpose text NOT NULL CHECK (purpose IN ('checkout', 'escrow_lock', 'funding')),
    ref_table text CHECK (ref_table IS NULL OR ref_table IN ('baskets', 'project_stages', 'tickets', 'revisions')),
    ref_id uuid,
    from_currency char(3) NOT NULL CHECK (from_currency ~ '^[A-Z]{3}$'),
    to_currency char(3) NOT NULL CHECK (to_currency ~ '^[A-Z]{3}$'),
    to_minor bigint NOT NULL CHECK (to_minor > 0),
    principal_minor bigint NOT NULL CHECK (principal_minor > 0),
    spread_bp integer NOT NULL CHECK (spread_bp BETWEEN 0 AND 2000),
    spread_minor bigint NOT NULL CHECK (spread_minor >= 0),
    from_minor bigint NOT NULL,
    from_rate numeric(20, 10) NOT NULL CHECK (from_rate > 0),
    to_rate numeric(20, 10) NOT NULL CHECK (to_rate > 0),
    -- One `from_currency` buys `mid_rate` units of `to_currency` at mid-market (to_rate ÷ from_rate).
    mid_rate numeric(20, 10) NOT NULL CHECK (mid_rate > 0),
    -- The older of the two rates' observations: the one the freshness rule judges.
    rate_as_of timestamptz NOT NULL,
    rate_provider text NOT NULL,
    created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CONSTRAINT ck_fx_quotes_pair CHECK (from_currency <> to_currency),
    CONSTRAINT ck_fx_quotes_charge CHECK (from_minor = principal_minor + spread_minor),
    CONSTRAINT ck_fx_quotes_ref CHECK (num_nulls (ref_table, ref_id) IN (0, 2)),
    CONSTRAINT ck_fx_quotes_window CHECK (expires_at > created_at)
);

-- One executed conversion, append-only (trg_fx_conversions_append_only, 00001830). A `purchase`
-- executes a quote: `principal_minor` (reason `fx_conversion`) and `spread_minor` (`fx_spread`) leave
-- `from_wallet_id`, and `to_minor` (`fx_conversion`) arrives in `to_wallet_id`, both the payer's own. An
-- `unwind` returns a refunded share of the escrow a purchase funded (`ref_table` = 'escrows') to the
-- purchase's source wallet at its pinned figure, margin included and never charged again: `from_minor`
-- is the escrow currency refunded and `to_minor` what the payer gets back; no wallet is debited, because
-- the money comes out of the escrow. `rate_base` and `mid_rate` state the pair the purchase's way round
-- (one `rate_base` bought `mid_rate` of the other currency) on both kinds.
CREATE TABLE finance.fx_conversions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    kind text NOT NULL CHECK (kind IN ('purchase', 'unwind')),
    quote_id uuid REFERENCES finance.fx_quotes (id) ON DELETE RESTRICT,
    parent_id uuid REFERENCES finance.fx_conversions (id) ON DELETE RESTRICT,
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'team', 'business', 'enterprise')),
    owner_id uuid NOT NULL,
    from_wallet_id uuid REFERENCES finance.wallets (id) ON DELETE RESTRICT,
    to_wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE RESTRICT,
    from_currency char(3) NOT NULL CHECK (from_currency ~ '^[A-Z]{3}$'),
    to_currency char(3) NOT NULL CHECK (to_currency ~ '^[A-Z]{3}$'),
    from_minor bigint NOT NULL CHECK (from_minor > 0),
    principal_minor bigint NOT NULL CHECK (principal_minor > 0),
    spread_bp integer NOT NULL DEFAULT 0 CHECK (spread_bp >= 0),
    spread_minor bigint NOT NULL DEFAULT 0 CHECK (spread_minor >= 0),
    to_minor bigint NOT NULL CHECK (to_minor > 0),
    rate_base char(3) NOT NULL,
    mid_rate numeric(20, 10) NOT NULL CHECK (mid_rate > 0),
    rate_as_of timestamptz NOT NULL,
    ref_table text,
    ref_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT uq_fx_conversions_quote UNIQUE (quote_id),
    CONSTRAINT ck_fx_conversions_pair CHECK (from_currency <> to_currency AND rate_base IN (from_currency, to_currency)),
    CONSTRAINT ck_fx_conversions_charge CHECK (from_minor = principal_minor + spread_minor),
    CONSTRAINT ck_fx_conversions_kind CHECK (
        (kind = 'purchase' AND quote_id IS NOT NULL AND parent_id IS NULL AND from_wallet_id IS NOT NULL)
        OR (kind = 'unwind' AND quote_id IS NULL AND parent_id IS NOT NULL AND from_wallet_id IS NULL
            AND spread_bp = 0 AND spread_minor = 0 AND ref_table = 'escrows' AND ref_id IS NOT NULL)
    )
);
-- #endregion

CREATE TABLE finance.escrows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    project_stage_id uuid NOT NULL REFERENCES projects.project_stages (id) ON DELETE RESTRICT,
    ticket_id uuid REFERENCES projects.tickets (id) ON DELETE SET NULL,
    -- The seat this escrow pays for (Decision #171): a session's escrow is held at booking, one per
    -- membership, against the cohort's stage. RESTRICT: a seat with money behind it is cancelled,
    -- never removed. A ticket escrow and a seat escrow are different subjects (ck_escrows_one_subject).
    cohort_membership_id uuid REFERENCES projects.cohort_memberships (id) ON DELETE RESTRICT,
    -- The ONE sitting this seat escrow pays for (Decision #211). A 1-1 session holds one escrow per
    -- sitting, so each sitting releases `session_payout_hours` after its own end and the 24-hour cancel
    -- rule is judged per sitting; a cohort seat keeps it NULL and settles after the cohort's last
    -- sitting. Only ever set beside `cohort_membership_id` (ck_escrows_sitting_on_seat). RESTRICT: a
    -- sitting with money behind it is cancelled, never removed.
    session_event_id uuid REFERENCES projects.session_events (id) ON DELETE RESTRICT,
    -- The paid revision round this escrow pays for (Decision #167), written by fn_hold_revision_escrow.
    -- A round's escrow sits beside its ticket's base escrow, and this is what tells the two apart: NULL
    -- is the base escrow, of which a ticket holds at most one (uq_escrows_ticket_base_held, #189), plus
    -- at most one `reserved` per later stage it is prepaid for (uq_escrows_ticket_stage_reserved, #430).
    -- RESTRICT: a round with money behind it is never removed.
    revision_id uuid REFERENCES projects.stage_revision_requests (id) ON DELETE RESTRICT,
    -- The payer is EITHER a client business OR an individual client (a project with no
    -- client_business_id is paid for by its owner, PRODUCT_SPEC §Escrow, Wallets & Finance #5: an
    -- individual client needs no business profile). Exactly one is set (ck_escrows_one_payer); the
    -- business FK is unchanged, only its NOT NULL moved into that CHECK. Relaxed 2026-09-29 on the
    -- product owner's instruction (root CLAUDE.md §8 Decision #126), closing #56(a) / #125(b).
    payer_business_id uuid REFERENCES org.business_profiles (id) ON DELETE RESTRICT,
    payer_user_id uuid REFERENCES org.users_public (user_id) ON DELETE RESTRICT,
    -- Who the escrow pays. NULL on a PREPAID ticket escrow (Decision #197): the client funded a ticket
    -- nobody has claimed yet, and the claim names the payee (finance.fn_bind_ticket_escrow). An unbound
    -- escrow is never released — it is bound, or refunded to its payer (ck_escrows_unbound).
    payee_type assignment_type,
    payee_id uuid,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    platform_fee_cents bigint NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
    -- Refused above 0 until a bonus is held with its escrow (Decision #337, ruling M7): release pays
    -- amount + bonus − fee, and nothing funds the bonus (FCA N4).
    deadline_bonus_cents bigint NOT NULL DEFAULT 0
        CONSTRAINT ck_escrows_bonus_unfunded CHECK (deadline_bonus_cents = 0),
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- The values the doors write, and nothing else (FCA N24): `held` (every hold, the DEFAULT) ·
    -- `released` · `refunded` · `disputed`, and `reserved` (Decision #430): a later ticket stage paid for ahead — debited from the payer's wallet, bound to nobody, with
    -- no refund clock, held by finance.fn_activate_ticket_reservation when the ticket reaches that stage
    -- and refunded by finance.fn_refund_ticket_reservations if it never does. Every door that releases,
    -- binds, sweeps or settles reads `held` only, so a reservation waits untouched beside the stage at work.
    status text NOT NULL DEFAULT 'held'
        CHECK (status IN ('held', 'reserved', 'released', 'refunded', 'disputed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- When it was released to the payee — what a consolidated invoice selects its period by.
    released_at timestamptz,
    -- When an unclaimed PREPAID escrow on its ticket's current stage is refunded to its payer
    -- (Decision #428): stamped by fn_hold_ticket_escrow, cleared by fn_bind_ticket_escrow, swept by
    -- fn_sweep_expired_prepaid_escrows. Never set on a bound escrow (ck_escrows_expiry_unbound).
    expires_at timestamptz,
    -- Held by the From-wallet auto-fund queue (finance.fn_auto_fund_drain) rather than by a person.
    auto_funded boolean NOT NULL DEFAULT false,
    -- The snapshot of the conversion that funded this escrow (Decision #435), all NULL on an escrow held
    -- from a balance already in its currency: one `fx_base` (the payer's currency) bought `fx_rate` of
    -- this escrow's currency at mid-market, observed `fx_as_of`, and `fx_source_minor` is the exact amount
    -- of `fx_base` it cost (its largest-remainder share of the conversion's charge, margin included),
    -- which a refund returns pro rata (finance.fn_refund_escrow_to_payer). Written once, by
    -- finance.fn_stamp_escrow_fx.
    fx_rate numeric(20, 10),
    fx_base char(3) DEFAULT 'GBP' CHECK (fx_base ~ '^[A-Z]{3}$'),
    fx_as_of timestamptz,
    fx_conversion_id uuid REFERENCES finance.fx_conversions (id) ON DELETE RESTRICT,
    fx_source_minor bigint CHECK (fx_source_minor IS NULL OR fx_source_minor >= 0),
    CONSTRAINT ck_escrows_one_payer CHECK (num_nonnulls (payer_business_id, payer_user_id) = 1),
    CONSTRAINT ck_escrows_one_subject CHECK (num_nonnulls (ticket_id, cohort_membership_id) <= 1),
    CONSTRAINT ck_escrows_sitting_on_seat CHECK (session_event_id IS NULL OR cohort_membership_id IS NOT NULL),
    CONSTRAINT ck_escrows_payee_pair CHECK (num_nulls (payee_type, payee_id) IN (0, 2)),
    CONSTRAINT ck_escrows_unbound CHECK (
        payee_id IS NOT NULL
        OR (
            revision_id IS NULL AND cohort_membership_id IS NULL
            AND (status = 'refunded' OR (status IN ('held', 'reserved') AND ticket_id IS NOT NULL))
        )
    ),
    CONSTRAINT ck_escrows_expiry_unbound CHECK (expires_at IS NULL OR payee_id IS NULL),
    -- A reservation (Decision #430) is a ticket's base escrow for a stage it has not reached: unbound and
    -- without a refund clock, both of which it takes on only when the stage's hold activates it.
    CONSTRAINT ck_escrows_reserved_shape CHECK (
        status <> 'reserved'
        OR (ticket_id IS NOT NULL AND payee_id IS NULL AND expires_at IS NULL
            AND revision_id IS NULL AND cohort_membership_id IS NULL)
    ),
    CONSTRAINT ck_escrows_fx_snapshot CHECK (num_nulls (fx_conversion_id, fx_source_minor, fx_rate, fx_as_of) IN (0, 4))
);

CREATE TABLE finance.payout_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL
        CHECK (owner_type IN ('user', 'freelancer', 'team', 'business', 'enterprise')),
    owner_id uuid NOT NULL,
    provider text NOT NULL,
    account_id text NOT NULL,
    -- The account's readiness to RECEIVE transfers. For a Stripe Connect account this is the v2
    -- recipient capability `stripe_balance.stripe_transfers`, mapped by payoutAccountStatusFor() in
    -- @projective/types/finance: active → verified, pending → pending_verification, restricted →
    -- restricted, unsupported → disabled. Written by finance.sync_payout_account from what the
    -- provider reports — never by the owner, whose word is not evidence of a payable account.
    status text NOT NULL DEFAULT 'pending_verification'
        CHECK (status IN ('pending_verification', 'verified', 'restricted', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- When the status was last reconciled with the provider.
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_payout_accounts_provider_account UNIQUE (provider, account_id)
);

CREATE TABLE finance.invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- Nullable: a consolidated monthly invoice spans many stages (constraint relaxed, not dropped).
    project_stage_id uuid REFERENCES projects.project_stages (id) ON DELETE CASCADE,
    issue_to_business_id uuid NOT NULL REFERENCES org.business_profiles (id) ON DELETE RESTRICT,
    -- NULL: issued by the platform (Projective) — every consolidated invoice (PRODUCT_SPEC §Escrow,
    -- Wallets & Finance #4). A profile id only for a per-stage invoice a seller issues.
    issue_from_profile uuid,
    invoice_type text NOT NULL DEFAULT 'per_stage' CHECK (invoice_type IN ('per_stage', 'consolidated_monthly')),
    billing_period_start timestamptz,
    billing_period_end timestamptz,
    -- The invoice's figure — its total. Zero on a month that only bought on account.
    amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
    subtotal_cents bigint NOT NULL DEFAULT 0,
    platform_fee_cents bigint NOT NULL DEFAULT 0,
    tax_cents bigint NOT NULL DEFAULT 0,
    total_cents bigint NOT NULL DEFAULT 0,
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid', 'overdue', 'void')),
    due_date timestamptz,
    paid_at timestamptz,
    pdf_file_id uuid REFERENCES files.items (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- What is still owed: the period's on-account credit (`on_account_credit` lines), until paid.
    -- Escrow held from the wallet was paid when held, so an invoice with nothing on account is 0.
    amount_due_cents bigint NOT NULL DEFAULT 0 CHECK (amount_due_cents >= 0),
    -- One run per business, period and currency: the billing run is idempotent on it.
    CONSTRAINT uq_invoices_business_period_currency UNIQUE (issue_to_business_id, billing_period_start, currency)
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
    currency char(3) NOT NULL DEFAULT 'GBP' CHECK (currency ~ '^[A-Z]{3}$'),
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
    currency char(3) CHECK (currency ~ '^[A-Z]{3}$'),
    provider text NOT NULL DEFAULT 'stripe',
    provider_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.spending_limits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    member_user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    -- NULL means no rolling ceiling (the per-transaction ceiling below may still apply). A row
    -- rather than an absent row, because "unlimited" is a policy somebody set and nothing is
    -- hard-deleted to express it.
    cap_cents bigint CHECK (cap_cents IS NULL OR cap_cents >= 0),
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
    ref_type text NOT NULL CHECK (ref_type IN ('escrow', 'bonus', 'platform_fee', 'refund', 'tax', 'on_account')),
    ref_id uuid,
    description text NOT NULL,
    amount_cents bigint NOT NULL,
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- A line paid through an FX conversion (Decision #435) is stated in the invoice's currency at its
    -- pinned figure, beside what it was priced at: `origin_minor` of `origin_currency`, one unit of the
    -- invoice's currency buying `fx_rate` of it at mid-market, observed `fx_as_of`. All NULL otherwise.
    origin_minor bigint CHECK (origin_minor IS NULL OR origin_minor >= 0),
    origin_currency char(3) CHECK (origin_currency IS NULL OR origin_currency ~ '^[A-Z]{3}$'),
    fx_rate numeric(20, 10) CHECK (fx_rate IS NULL OR fx_rate > 0),
    fx_as_of timestamptz,
    CONSTRAINT ck_invoice_line_items_origin CHECK (num_nulls (origin_minor, origin_currency, fx_rate, fx_as_of) IN (0, 4))
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
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- #region Multi-currency FX (20260723090000_finance_currency_fx.sql)
CREATE TABLE finance.fx_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    base char(3) NOT NULL CHECK (base ~ '^[A-Z]{3}$'),   -- ISO-4217, e.g. 'GBP'
    quote char(3) NOT NULL CHECK (quote ~ '^[A-Z]{3}$'), -- ISO-4217, e.g. 'USD'
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
    subject_type text NOT NULL CHECK (subject_type IN ('freelancer', 'business', 'enterprise', 'user')),
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
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'enterprise')),
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
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    interval finance.deposit_interval NOT NULL,
    next_run_at timestamptz NOT NULL,
    active boolean NOT NULL DEFAULT true,
    failure_count integer NOT NULL DEFAULT 0,   -- consecutive failed charges (drives dunning / auto-pause)
    last_error text,
    -- Who authorised the standing charge. Every run is recorded as an inbound payment made BY this
    -- person (finance.inbound_payments.created_by is NOT NULL), so a rule nobody authorised cannot run.
    created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    -- Set once by finance.update_deposit_rule(p_archive => true); an archived rule is inactive for good
    -- (trg_deposit_rules_immutable). Rules are never deleted.
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (archived_at IS NULL OR NOT active)
);

-- Written only by finance.save_payout_schedule and run only by finance.fn_claim_due_payout_schedules
-- (00001240): clients hold SELECT. A run withdraws AS `created_by` through finance.begin_payout, so a
-- schedule nobody authorised, or whose author lost `withdraw`, pays nothing out.
CREATE TABLE finance.payout_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'enterprise')),
    owner_id uuid NOT NULL,
    mode finance.payout_mode NOT NULL DEFAULT 'manual',
    destination_method_id uuid REFERENCES finance.payment_methods (id) ON DELETE SET NULL,
    threshold_cents bigint CHECK (threshold_cents IS NULL OR threshold_cents > 0),  -- for mode='threshold'
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- The next calendar slot a weekly / monthly schedule runs at (UTC); NULL for manual and threshold.
    next_run_at timestamptz,
    -- Reserved: Instant Payouts are Planned (Decision #337, ruling P3) and the door refuses `true`.
    instant boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Who authorised the schedule; every run withdraws as them. Re-stamped on each save.
    created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    last_run_at timestamptz,                    -- the last run: paid, skipped below the minimum or refused
    last_error text,                            -- the last refusal's sentence; NULL after a paid run
    failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),  -- refusals in a row; 3 pauses
    CONSTRAINT uq_payout_schedule_owner UNIQUE (owner_type, owner_id, currency),
    CONSTRAINT payout_schedules_threshold_mode CHECK (mode <> 'threshold' OR threshold_cents IS NOT NULL)
);

CREATE TABLE finance.income_smoothing (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    enrolled boolean NOT NULL DEFAULT false,
    target_monthly_cents bigint CHECK (target_monthly_cents IS NULL OR target_monthly_cents >= 0),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    fee_bp integer NOT NULL DEFAULT 50 CHECK (fee_bp >= 0),   -- ~0.5% micro-fee
    eligibility_met boolean NOT NULL DEFAULT false,           -- ≥ min-months history + min volume (see params)
    enrolled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_income_smoothing_user UNIQUE (user_id, currency)
);

-- A pot is an EARMARK inside its wallet, never a separate balance (Decision #337, ruling M6): its
-- `balance_cents` labels part of the wallet's own `balance_cents`, which stays the total, so what the
-- wallet may spend is its balance minus its active pots (finance.fn_available_cents). Written by
-- definer doors only (00001240 region 9, and the involuntary-recovery branch of
-- finance.fn_wallet_debit); every change of `balance_cents` is a finance.pot_movements row. Never
-- deleted: an empty pot is archived (`active = false`, `archived_at`) and is then never changed again.
CREATE TABLE finance.wallet_pots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    purpose finance.pot_purpose NOT NULL DEFAULT 'general',
    name text NOT NULL CHECK (char_length(name) <= 120),
    balance_cents bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- The share of each matured income credit earmarked into the pot (the tax-pot auto-set-aside); a
    -- wallet's active pots together take at most 10000 (finance.save_wallet_pot).
    auto_allocate_bp integer NOT NULL DEFAULT 0 CHECK (auto_allocate_bp BETWEEN 0 AND 10000),
    -- What the owner is saving towards, shown as progress. NULL is no target; it never caps the pot.
    goal_cents bigint CHECK (goal_cents IS NULL OR goal_cents > 0),
    active boolean NOT NULL DEFAULT true,
    archived_at timestamptz,
    -- clock_timestamp(): a recovery shrinks pots newest first, so creation order must be exact even for
    -- two pots saved in one transaction.
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_wallet_pots_archived CHECK (active = (archived_at IS NULL)),
    CONSTRAINT ck_wallet_pots_archived_empty CHECK (active OR balance_cents = 0)
);

-- A pot's ledger: one row per change of its earmark, append-only like finance.transactions
-- (trg_pot_movements_append_only, 00001830). An earmark moves no money between wallets, so nothing here
-- touches finance.transactions or the conservation identity; Σ in − Σ out over a pot's rows is its
-- `balance_cents`, and `balance_after_cents` is that balance after the row. `reason`: `allocation`
-- (finance.fn_apply_pot_allocations; ref = the matured income's credit in finance.transactions),
-- `move_in` / `move_out` (finance.move_pot_funds, by `actor_user_id`), `recovery`
-- (finance.fn_wallet_debit; ref = the chargeback or refund debit that took earmarked money).
CREATE TABLE finance.pot_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    pot_id uuid NOT NULL REFERENCES finance.wallet_pots (id) ON DELETE RESTRICT,
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE RESTRICT,
    direction text NOT NULL CHECK (direction IN ('in', 'out')),
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    reason text NOT NULL CHECK (reason IN ('allocation', 'move_in', 'move_out', 'recovery')),
    ref_table text,
    ref_id uuid,
    balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0),
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_pot_movements_direction CHECK ((reason IN ('allocation', 'move_in')) = (direction = 'in')),
    CONSTRAINT ck_pot_movements_ref CHECK (
        reason NOT IN ('allocation', 'recovery') OR (ref_table = 'transactions' AND ref_id IS NOT NULL)
    )
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

-- A request binds to the one thing it approves (`ref_table`/`ref_id`, required) at the amount and
-- currency it was filed for, and is spent exactly once: finance.fn_redeem_spend_approval stamps
-- `consumed_at` and the redeeming door's ref in the same transaction as the money movement
-- (BUSINESSES_AUDIT BF20 / §4.3). `decided_at` is when the request left `pending` by somebody's act: an
-- approver's decision, or the requester's withdrawal (finance.withdraw_spend_approval, BU2 — Decision
-- #246), which names no approver. A lapse (`expired`) stamps nothing.
CREATE TABLE finance.spend_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    reason text NOT NULL CHECK (char_length(reason) <= 2000),
    ref_table text NOT NULL,
    ref_id uuid NOT NULL,
    status finance.approval_status NOT NULL DEFAULT 'pending',
    approver_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    decided_at timestamptz,
    expires_at timestamptz,
    consumed_at timestamptz,
    consumed_ref_table text,
    consumed_ref_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT spend_approvals_ref_table_check CHECK (
        ref_table IN ('baskets', 'tickets', 'project_stages', 'revisions', 'invoices', 'transfers')
    ),
    -- Only an approved request is ever spent, and a spend always records what spent it.
    CONSTRAINT spend_approvals_consumed_check CHECK (
        (consumed_at IS NULL AND consumed_ref_table IS NULL AND consumed_ref_id IS NULL)
        OR (consumed_at IS NOT NULL AND status = 'approved'
            AND consumed_ref_table IS NOT NULL AND consumed_ref_id IS NOT NULL)
    ),
    -- A withdrawn request was taken back by its requester: nobody decided it, and it left pending at a
    -- recorded moment.
    CONSTRAINT spend_approvals_withdrawn_check CHECK (
        status <> 'withdrawn' OR (approver_user_id IS NULL AND decided_at IS NOT NULL)
    )
);

CREATE TABLE finance.ledger_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE CASCADE,
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    action finance.vault_action NOT NULL,
    amount_cents bigint NOT NULL,
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    ref_table text,
    ref_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region Statements & settlement (20260723094000)
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
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
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
    -- The connected account (`acct_…`) the transfer goes to, fixed when the payout begins, so the
    -- stale-payout sweep looks for the transfer where it was actually sent (Decision #202).
    destination_account text,
    -- How much of the transfer the platform has reversed (`transfer.reversed`), each part returned to
    -- the wallet as a `payout_reversal` credit. Equal to the amount exactly when the status is `reversed`.
    reversed_cents bigint NOT NULL DEFAULT 0,
    -- The connected account's onward payout to the bank (Connect `payout.paid` / `payout.failed` /
    -- `payout.canceled`). Separate from `status`: the money has left Projective either way, and after a
    -- bank failure or a cancelled bank payout it waits in the connected account's Stripe balance until
    -- Stripe pays it out again. `canceled` is spelled as Stripe spells it, like inbound_payment_status.
    bank_status text CHECK (bank_status IN ('paid', 'failed', 'canceled')),
    bank_payout_ref text,                     -- Stripe Payout id on the connected account; XXXX-XXXX in docs
    bank_failure_code text,                   -- Stripe's failure CODE, never its prose
    bank_status_at timestamptz,
    -- The stale-pending sweep's lease (finance.fn_claim_stale_payouts): when it last claimed the row,
    -- and how many times it has.
    swept_at timestamptz,
    sweep_attempts integer NOT NULL DEFAULT 0 CHECK (sweep_attempts >= 0),
    -- A reason only ever accompanies a failure; anything else is a stale field contradicting a
    -- successful row.
    CONSTRAINT payouts_reason_only_when_failed CHECK (
        failure_reason IS NULL OR status = 'failed'
    ),
    -- A sent payout carries the instant it was sent, and nothing else does: `paid`, or `reversed`
    -- (sent, then wholly returned).
    CONSTRAINT payouts_settled_matches_status CHECK (
        (status IN ('paid', 'reversed')) = (settled_at IS NOT NULL)
    ),
    CONSTRAINT payouts_reversed_within_amount CHECK (
        reversed_cents >= 0 AND reversed_cents <= amount_cents
    ),
    CONSTRAINT payouts_reversed_matches_status CHECK (
        (status = 'reversed') = (reversed_cents = amount_cents)
    ),
    -- Only a sent transfer can reach a bank, and only a failed bank payout has a failure code.
    CONSTRAINT payouts_bank_status_only_when_sent CHECK (
        bank_status IS NULL OR status IN ('paid', 'reversed')
    ),
    CONSTRAINT payouts_bank_failure_only_when_failed CHECK (
        bank_failure_code IS NULL OR bank_status = 'failed'
    )
);

COMMENT ON TABLE finance.payouts IS
'One attempt to move money out of a wallet to an external destination. Distinct from
finance.payout_schedules (the rule), finance.payment_methods (the destination) and
finance.transactions (the ledger movement, which exists only once a payout has actually settled).
A failed payout is a first-class row precisely because it produces no transaction.';

CREATE TABLE finance.statements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'enterprise')),
    owner_id uuid NOT NULL,
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
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
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    status finance.chargeback_status NOT NULL DEFAULT 'opened',
    reason text,
    opened_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    -- On a LOST dispute, the part of the clawback the payer's wallet could not cover (it had already
    -- been spent): the platform's loss, recorded rather than forced into a negative balance. 0 until
    -- the case is lost, and 0 whenever the wallet covered it in full (finance.record_dispute_closed).
    unrecovered_cents bigint NOT NULL DEFAULT 0 CHECK (unrecovered_cents >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- When Stripe reported the disputed funds withdrawn from, and reinstated to, the platform balance
    -- (`charge.dispute.funds_withdrawn` / `funds_reinstated`). Facts for reconciliation only: the ledger
    -- moves on `.created` (the freeze) and `.closed` (the outcome), never on these.
    funds_withdrawn_at timestamptz,
    funds_reinstated_at timestamptz,
    -- What a human has to know about how the case was resolved: a dispute Stripe closed before it
    -- reported it opened, or an escrow left `disputed` because its ticket was funded again meanwhile
    -- (finance.record_dispute_closed). NULL for an ordinary case.
    resolution_note text,
    -- Resolution and the three closed states are the same fact stated twice.
    CONSTRAINT chargebacks_resolved_matches_status CHECK (
        (status IN ('won', 'lost', 'refunded')) = (resolved_at IS NOT NULL)
    )
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
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'freelancer', 'business', 'team', 'enterprise')),
    subject_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN
        ('started', 'upgraded', 'downgraded', 'renewed', 'payment_failed', 'paused', 'resumed', 'cancelled', 'expired')),
    from_plan_id uuid REFERENCES finance.plans (id) ON DELETE SET NULL,
    to_plan_id uuid REFERENCES finance.plans (id) ON DELETE SET NULL,
    amount_cents bigint,
    currency char(3) CHECK (currency ~ '^[A-Z]{3}$'),
    provider_ref text,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finance.entitlement_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'freelancer', 'business', 'team', 'enterprise')),
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

-- A buyer's contract (a business or an enterprise) sets the fee its escrows are charged (Decision
-- #187). An Agency's (a team, and so a payee) sets the commission on its own product sales and its
-- payer fee when it buys (Decision #252, ruled 2026-10-31); an escrow fee stays the payer's.
CREATE TABLE finance.negotiated_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('business', 'enterprise', 'team')),
    subject_id uuid NOT NULL,
    platform_fee_bp integer NOT NULL CHECK (platform_fee_bp BETWEEN 0 AND 10000),
    marketplace_commission_bp integer CHECK (marketplace_commission_bp IS NULL OR marketplace_commission_bp BETWEEN 0 AND 10000),
    minimum_volume_cents bigint CHECK (minimum_volume_cents IS NULL OR minimum_volume_cents >= 0),
    currency char(3) CHECK (currency ~ '^[A-Z]{3}$'),
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
    subject_type text NOT NULL CHECK (subject_type IN ('user', 'freelancer', 'team', 'business', 'enterprise')),
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
    currency char(3) CHECK (currency ~ '^[A-Z]{3}$'),
    -- An unbounded window at either end is a real configuration ('starts now', 'never expires'),
    -- so both are nullable rather than defaulted to arbitrary far-past / far-future instants.
    starts_at timestamptz,
    expires_at timestamptz,
    max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
    -- How many times ONE account may redeem the code (Decision #337, ruling M8; FBP DB19): its orders
    -- that used it, in every status, so a refund does not give a redemption back (finance.fn_promo_uses).
    -- The default allows one; NULL is no per-account limit.
    max_redemptions_per_account integer DEFAULT 1
        CHECK (max_redemptions_per_account IS NULL OR max_redemptions_per_account > 0),
    redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
    -- Withdrawing a code is a soft state with a useful instant, not a boolean: knowing WHEN a code
    -- was pulled is what makes a later "why was my code refused" answerable. NULL = still live.
    -- Distinct from expires_at, which is the schedule; this is the manual kill switch, and the archive
    -- a seller's finance.archive_promo_code writes (nothing is hard-deleted).
    deactivated_at timestamptz,
    -- Who issued the code and pays for its discount (Decision #485). NULL is the platform: an operator's
    -- code over every product line, funded by the platform (#485 (a)). A seller's code ('user' a
    -- person's own listings, 'team' a team's) discounts only that seller's product lines, and the
    -- seller funds it: their commission is taken on the discounted price (finance-model §1.2).
    issuer_type text CHECK (issuer_type IN ('user', 'team')),
    issuer_id uuid,
    -- The issuer's product listings the code covers; NULL is all of them. An array, not foreign keys:
    -- finance.save_promo_code admits only product listings the issuer manages.
    listing_ids uuid[] CHECK (listing_ids IS NULL OR cardinality(listing_ids) BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_promo_code UNIQUE (code),
    CONSTRAINT promo_code_issuer_pair CHECK ((issuer_type IS NULL) = (issuer_id IS NULL)),
    CONSTRAINT promo_code_scope_needs_issuer CHECK (listing_ids IS NULL OR issuer_type IS NOT NULL),
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
not retroactively invalidate rows that were legitimately issued under the old one.
max_redemptions_per_account caps one account''s uses, counted from its orders in every status under
the same lock (FBP DB19). issuer_type / issuer_id name the seller who issued and funds the code (NULL:
the platform, which funds it); listing_ids narrows a seller''s code to some of their product listings
(Decision #485).';

-- A named collection of purchasable intents. A "wishlist" is not a separate table or a separate
-- kind — it is simply a non-default basket with its own name ('3D Asset Wishlist'), which is why
-- there is no `kind` column: one owner may hold many baskets and exactly one of them is the default.
--
-- ⚠️ `owner_type` is the WIDE finance owner axis, deliberately matching finance.payment_methods /
-- finance.payout_schedules / finance.statements. A narrower ('user','business') pair could not
-- express a TEAM basket, and the app's context switcher (root CLAUDE.md Decisions #16/#61) switches
-- between personal / team / business / enterprise — the basket must re-scope with it.
CREATE TABLE finance.baskets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'enterprise')),
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
'A named collection of purchasable intents for one owner (personal, team, business or enterprise).
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
    -- The ONE ticket this line buys (Decision #166) — a board ticket's Buy now / Checkout. NULL for a
    -- line that buys a whole project, a listing or a session. CASCADE for the same reason as stage_id:
    -- a ticket that no longer exists is not purchasable. One live line per ticket STAGE per basket
    -- (uq_basket_items_live_ticket, cat 4, Decision #430) — each stage is one hold, never a quantity:
    -- the stage the ticket is funded in is held at payment, a later one is prepaid (`reserved`).
    ticket_id uuid REFERENCES projects.tickets (id) ON DELETE CASCADE,
    -- The paid revision round this line buys (Decision #167): a client-requested round on a ticket,
    -- raised `awaiting_payment` by projects.request_paid_revision and opened when its escrow is held.
    -- Set exactly on a `paid_revision` line, where it equals `item_id` (basket_item_revision_line).
    -- CASCADE for stage_id's reason: a round that no longer exists is not purchasable.
    revision_id uuid REFERENCES projects.stage_revision_requests (id) ON DELETE CASCADE,
    title text NOT NULL,                           -- display snapshot, so a renamed listing cannot rewrite history
    subtitle text,
    unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
    -- The struck-through pre-discount unit price a creator discount is running against. A SNAPSHOT
    -- for the same reason unit_price_minor is one: re-deriving the RRP from the listing at read time
    -- would let a seller's later price change rewrite the saving a buyer was already shown.
    -- Nullable - most lines carry no discount, and NULL is "no RRP", not "an RRP of zero".
    original_price_minor bigint CHECK (original_price_minor IS NULL OR original_price_minor >= 0),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
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
    ),
    -- A ticket line buys project work, exactly one of it.
    CONSTRAINT basket_item_ticket_is_project_work CHECK (
        ticket_id IS NULL OR (
            item_type IN ('project_ticket', 'one_off_project', 'one_off_task') AND quantity = 1
        )
    ),
    -- A paid revision line names its round, once; no other kind names one.
    CONSTRAINT basket_item_revision_line CHECK (
        (item_type = 'paid_revision') = (revision_id IS NOT NULL)
        AND (revision_id IS NULL OR (revision_id = item_id AND quantity = 1))
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
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'enterprise')),
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
    -- Written `confirmed` once paid, or `invoiced` on account; finance.fn_roll_up_order_status writes
    -- `refunded` and `cancelled` from the lines (Decision #469). `processing` is retired (00000004).
    status finance.order_status NOT NULL DEFAULT 'confirmed',
    placed_at timestamptz NOT NULL DEFAULT now(),

    -- The wide 5-value finance owner axis, matching finance.baskets rather than inventing a narrower
    -- one — a team, business or enterprise can all buy.
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
    -- The basket-wide promo code that discounted this order, as redeemed (upper-cased); NULL when none
    -- did. Not a foreign key, for the reason finance.baskets.promo_code gives: a code withdrawn later
    -- must not change what this order says it used.
    promo_code text CHECK (promo_code IS NULL OR length(promo_code) <= 40),
    -- The fee taken when the order was placed: the sum of its lines' `platform_fee_minor`, which is
    -- each product line's seller commission (escrow lines take theirs at release).
    platform_fee_minor bigint NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0),

    -- The fee RATE and MODE are stamped on the order, not looked up at read time. A platform that
    -- changes its fee must not retroactively restate what a buyer was charged last quarter, and
    -- `security.platform_params.platform_fee_bp` is a live value that can move. The rate is the
    -- PAYER's at placement (finance.fn_effective_platform_fee_bp, Decision #187): the rate an escrow
    -- line's fee follows, resolved again when that escrow is released. A product line is charged its
    -- seller's commission instead, recorded on the line (Decision #337, ruling M1).
    platform_fee_bp integer NOT NULL CHECK (platform_fee_bp >= 0),
    platform_fee_mode text NOT NULL DEFAULT 'seller_deducted'
        CHECK (platform_fee_mode IN ('seller_deducted', 'buyer_added')),

    -- The tax the order was charged (Decision #490): the sum of its lines' `tax_minor`, from the Stripe Tax
    -- calculation it names, added on top of the price (tax-exclusive). 0 while `tax_collection_enabled`
    -- is off, and on every order with no line of a kind `tax_collected_kinds` names.
    tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    -- What the tax was ("United Kingdom VAT 20%"), as the checkout showed it; NULL with no calculation.
    tax_jurisdiction text CHECK (tax_jurisdiction IS NULL OR length(tax_jurisdiction) <= 160),
    -- The Stripe Tax calculation the order was placed on (`taxcalc_…`, finance.tax_calculations), and the
    -- tax transaction recorded from it after commit (`tax_…`, finance.record_tax_transaction). A
    -- calculation with no transaction yet is due one (finance.tax_records_due).
    tax_calculation_ref text CHECK (tax_calculation_ref IS NULL OR tax_calculation_ref ~ '^taxcalc_[A-Za-z0-9_]{1,250}$'),
    tax_transaction_ref text CHECK (tax_transaction_ref IS NULL OR tax_transaction_ref ~ '^tax_[A-Za-z0-9_]{1,250}$'),
    -- The business buyer's VAT ID the calculation was made with (reverse charge), as typed on
    -- /checkout/details; NULL for a consumer.
    buyer_tax_id text CHECK (buyer_tax_id IS NULL OR length(buyer_tax_id) <= 60),
    -- The buyer's voluntary contribution toward processing costs. Added LAST and never part of the
    -- platform-fee base: charging a percentage of a gift would turn the buyer's generosity into
    -- revenue.
    processing_contribution_minor bigint NOT NULL DEFAULT 0 CHECK (processing_contribution_minor >= 0),
    total_minor bigint NOT NULL CHECK (total_minor >= 0),
    -- Zero on an invoiced order, which is why this is separate from `total_minor`: what was owed and
    -- what was taken are different facts and an invoiced order has the second at zero. An on-account
    -- order (finance.place_on_account_order) is written `invoiced` with this zeroed: the platform's
    -- on-account credit paid it, and the business pays on its monthly invoice.
    charged_minor bigint NOT NULL DEFAULT 0 CHECK (charged_minor >= 0),

    payment_provider text NOT NULL DEFAULT 'stripe',
    payment_method_label text NOT NULL DEFAULT ''::text,
    saved_card_id uuid REFERENCES finance.saved_cards (id) ON DELETE SET NULL,
    -- The conversion that paid for this order in the buyer's own currency (Decision #435): the order's
    -- figures stay in its lines' currency, and the buyer's charge is the conversion's `from_minor` in its
    -- `from_currency`. NULL when no conversion was needed.
    fx_conversion_id uuid REFERENCES finance.fx_conversions (id) ON DELETE RESTRICT,

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
    -- The line's share of the order's basket-wide promo (finance.orders.promo_discount_minor is their
    -- sum). What the buyer paid for the line is `line_total_minor - promo_discount_minor`.
    promo_discount_minor bigint NOT NULL DEFAULT 0 CHECK (promo_discount_minor >= 0),
    -- Who paid for that share (Decision #485): 'seller', whose own code it was, so the fee is charged on
    -- what the buyer paid; or 'platform', for an operator's code, so the fee is charged on the line
    -- before the share and the share is the platform's cost (finance.v_conservation_identity's
    -- losses_promos). NULL when the line carries no share.
    promo_funded_by text CHECK (promo_funded_by IN ('seller', 'platform')),
    -- The fee taken on this line when it was bought, and its rate, stamped like the order's
    -- (Decision #337, ruling M1). A digital product pays its SELLER's marketplace commission
    -- (finance.fn_effective_commission_bp for the owning team, else the owning person), truncated,
    -- deducted from the seller's credit. An escrow line (a ticket, a paid revision, a seat, a
    -- session) takes nothing here, so it records 0 and no rate: its fee is the payer's rate, charged
    -- at release (finance.escrows.platform_fee_cents). finance.orders.platform_fee_minor is the sum.
    platform_fee_bp integer CHECK (platform_fee_bp IS NULL OR platform_fee_bp BETWEEN 0 AND 10000),
    platform_fee_minor bigint NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0),
    -- The client's royalty on a product sold under their grant (MARKETPLACE SC7, Decision #493 (A)):
    -- taken after the commission from what is left, floored, and credited pending to the client
    -- (`product_royalty`) beside the seller's credit, which is this much less. 0 on every other line.
    royalty_minor bigint NOT NULL DEFAULT 0 CHECK (royalty_minor >= 0),

    -- What has gone back to the buyer for this line, and where the line stands (Decision #337, ruling
    -- M8; Decision #469; FBP DB19). Written only by finance.fn_record_order_line_refund, which every
    -- escrow refund reaches: `refunded_minor` accumulates partial refunds (a Fair Exit split) in the
    -- line's currency, never past what the buyer paid for the line (`line_total_minor -
    -- promo_discount_minor`), and `refunded_at` is when the latest one landed. Refunded in full, the line
    -- is `cancelled` when no delivery had begun (no sitting held, no work started, the revision not
    -- resolved) and `refunded` when it had; until then it stays `confirmed`. A product line's refunds
    -- are DB21's.
    status finance.order_status NOT NULL DEFAULT 'confirmed'
        CHECK (status IN ('confirmed', 'refunded', 'cancelled')),
    refunded_minor bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
    refunded_at timestamptz,
    -- The tax on this line (Decision #490), on top of what the buyer paid for it; finance.orders.tax_minor
    -- is the sum. A refund in full gives it back with the line (finance.fn_refund_product_line).
    tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
    -- The line's item in the order's Stripe tax transaction (`tax_li_…`), and the reversal recorded once
    -- the line was refunded; a refunded line with a `tax_line_ref` and no reversal is due one.
    tax_line_ref text CHECK (tax_line_ref IS NULL OR tax_line_ref ~ '^tax_li_[A-Za-z0-9_]{1,250}$'),
    tax_reversal_ref text CHECK (tax_reversal_ref IS NULL OR tax_reversal_ref ~ '^tax_[A-Za-z0-9_]{1,250}$'),

    fulfilment finance.fulfilment_kind NOT NULL DEFAULT 'pending',
    -- Download fulfilment.
    asset_id uuid REFERENCES files.items (id) ON DELETE SET NULL,
    download_name text,
    download_bytes bigint CHECK (download_bytes IS NULL OR download_bytes >= 0),
    download_format text,
    licence text,
    -- Engagement fulfilment.
    stage_id uuid REFERENCES projects.project_stages (id) ON DELETE SET NULL,
    -- The ticket whose escrow this line held (Decision #166). SET NULL: the receipt outlives the ticket.
    ticket_id uuid REFERENCES projects.tickets (id) ON DELETE SET NULL,
    -- The engagement a One-Off or Task line created and funded at payment, and the escrow it held there
    -- (Decision #457; marketplace.fn_buy_scoped_service): what the receipt links, and what maps an
    -- escrow refund back to its line. NULL on every other line. SET NULL: the receipt outlives both.
    project_id uuid REFERENCES projects.projects (id) ON DELETE SET NULL,
    escrow_id uuid REFERENCES finance.escrows (id) ON DELETE SET NULL,
    -- The accepted custom quote this line paid for (Decision #522), so the engagement it created links
    -- to the exact offer and terms hash both parties agreed. At most one paid line per offer
    -- (uq_order_lines_quote_offer). NULL on every other line.
    quote_offer_id uuid REFERENCES marketplace.quote_offers (id) ON DELETE SET NULL,
    -- Session fulfilment.
    scheduled_at timestamptz,
    timezone text,
    duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
    seats integer CHECK (seats IS NULL OR seats BETWEEN 1 AND 500),
    conferencing_provider text,
    -- The buyer's answers to the listing's own intake (`IntakeAnswersSchema`, keyed by
    -- `service_blueprints.intake_fields[].id`) on a session, block or seat line (Decision #453): what
    -- the provider asked before the booking, kept with the receipt it was paid on. Reduced to the ids
    -- the listing asks (projects.fn_session_intake_answers); `{}` on every other line.
    intake_answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(intake_answers) = 'object'),

    position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_order_lines_promo_funder CHECK ((promo_funded_by IS NULL) = (promo_discount_minor = 0)),
    CONSTRAINT ck_order_lines_refund_within_charge
        CHECK (refunded_minor <= GREATEST(line_total_minor - promo_discount_minor, 0)),
    CONSTRAINT ck_order_lines_refunded_at CHECK ((refunded_minor = 0) = (refunded_at IS NULL)),
    CONSTRAINT ck_order_lines_refund_state CHECK (
        status = 'confirmed' OR refunded_minor = GREATEST(line_total_minor - promo_discount_minor, 0)
    ),
    CONSTRAINT ck_order_lines_tax_reversal CHECK (tax_reversal_ref IS NULL OR tax_line_ref IS NOT NULL)
);

-- A Stripe Tax calculation the checkout made for a basket (Decision #490, CK4), recorded by the server
-- (finance.record_tax_calculation, service role) so finance.place_wallet_order takes the tax from HERE,
-- never from its caller: a figure the browser could send would be a figure it could lower. `lines` maps
-- each taxed basket line (its id) to `{amount, tax}`, the amount being what the buyer pays for the line,
-- which the order door re-checks line by line. `input_hash` keys the cache: the same basket, lines and
-- billing address reuse a live calculation rather than pay Stripe for another. Consumed once
-- (`order_id`); Stripe lets a transaction be made from it until `expires_at` (90 days).
CREATE TABLE finance.tax_calculations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    calculation_ref text NOT NULL UNIQUE CHECK (calculation_ref ~ '^taxcalc_[A-Za-z0-9_]{1,250}$'),
    basket_id uuid NOT NULL REFERENCES finance.baskets (id) ON DELETE CASCADE,
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'team', 'business', 'enterprise')),
    owner_id uuid NOT NULL,
    currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    input_hash text NOT NULL CHECK (length(input_hash) BETWEEN 1 AND 128),
    lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'object'),
    taxable_minor bigint NOT NULL CHECK (taxable_minor >= 0),
    tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
    jurisdiction text CHECK (jurisdiction IS NULL OR length(jurisdiction) <= 160),
    buyer_tax_id text CHECK (buyer_tax_id IS NULL OR length(buyer_tax_id) <= 60),
    reverse_charge boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL,
    order_id uuid UNIQUE REFERENCES finance.orders (id) ON DELETE SET NULL,
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

-- #region Disputes — contested money (Decision #212, PRODUCT_MANAGEMENT §3.8; FBP DB21)
-- One contested payment (Decision #212; lifecycle in PRODUCT_MANAGEMENT §3.8): a held escrow, or a
-- digital product line whose seller's earnings are still clearing (FBP DB21). Written only by the
-- definers in 00001260 (and the no-show claim in 00001155); never deleted, and terminal once resolved
-- (finance.fn_dispute_records_immutable, 00001830). At most one LIVE dispute per escrow
-- (uq_disputes_escrow_live, 00004005) and one dispute per order line, ever (uq_disputes_order_line).
CREATE TABLE finance.disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    -- What is contested (FBP DB21; PROJECTS EX2 adopts it): a session seat's escrow, a ticket's escrow
    -- (finance.open_ticket_dispute, Decision #548) or a digital product order line. ck_disputes_subject
    -- binds it.
    subject_kind text NOT NULL DEFAULT 'session_seat'
        CHECK (subject_kind IN ('session_seat', 'ticket_escrow', 'order_line')),
    -- RESTRICT, not CASCADE: a dispute is a record that outlives anything it is about. NULL only on an
    -- order-line dispute, whose money is the seller's clearing row (pending_releases.hold_dispute_id).
    escrow_id uuid NULL REFERENCES finance.escrows (id) ON DELETE RESTRICT,
    order_line_id uuid NULL REFERENCES finance.order_lines (id) ON DELETE RESTRICT,
    -- A ticket escrow dispute's ticket and the stage whose money it contests, and the side that raised it
    -- (`payer` the client, `payee` the freelancer), kept so the case's sides outlive a membership change
    -- (PROJECTS EX2). NULL on any other dispute.
    ticket_id uuid NULL REFERENCES projects.tickets (id) ON DELETE RESTRICT,
    stage_id uuid NULL REFERENCES projects.project_stages (id) ON DELETE RESTRICT,
    claimant_side text NULL CHECK (claimant_side IN ('payer', 'payee')),
    -- The sitting a no-show claim is about — what the attendance audit reads. NULL on any other dispute.
    session_event_id uuid NULL REFERENCES projects.session_events (id) ON DELETE RESTRICT,
    opened_by_profile uuid NOT NULL,
    reason text NOT NULL,
    status dispute_status NOT NULL DEFAULT 'open',
    -- The attendance audit's snapshot (finance.fn_dispute_attendance_audit), frozen when it ran.
    audit jsonb NULL,
    -- The auto-escalation deadline: an `awaiting_response` case past it goes to an auditor.
    respond_by timestamptz NULL,
    responded_at timestamptz NULL,
    escalated_at timestamptz NULL,
    -- The review SLA: when an operator should have ruled on an `under_review` case, set as it enters
    -- review (`dispute_review_hours`). A target, never a trigger: a case past it is NOT ruled — the
    -- sweep raises an ops alert and tells the operators (finance.sweep_disputes), no money moves.
    review_by timestamptz NULL,
    -- When the sweep last raised the overdue alert for this case (at most once a day per case).
    review_alerted_at timestamptz NULL,
    resolution_notes text NULL,
    -- The operator who ruled; NULL when the platform's own audit (or the money's own path) settled it.
    resolved_by uuid NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    -- The provider's share of a split ruling, in basis points of the principal.
    payee_share_bp integer NULL CHECK (payee_share_bp BETWEEN 1 AND 9999),
    -- What the ruling moved: payee_minor · fee_minor · refund_minor · currency, or deferred / by_fact.
    settlement jsonb NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz NULL,
    CONSTRAINT ck_disputes_resolved_at CHECK (
        (status IN ('resolved_release', 'resolved_refund', 'resolved_split')) = (resolved_at IS NOT NULL)
    ),
    CONSTRAINT ck_disputes_split_share CHECK ((status = 'resolved_split') = (payee_share_bp IS NOT NULL)),
    CONSTRAINT ck_disputes_awaiting_deadline CHECK (status <> 'awaiting_response' OR respond_by IS NOT NULL),
    CONSTRAINT ck_disputes_review_deadline CHECK (status <> 'under_review' OR review_by IS NOT NULL),
    CONSTRAINT ck_disputes_subject CHECK (
        CASE WHEN subject_kind = 'order_line' THEN order_line_id IS NOT NULL AND escrow_id IS NULL
             ELSE escrow_id IS NOT NULL AND order_line_id IS NULL END
        AND (subject_kind = 'ticket_escrow')
            = (ticket_id IS NOT NULL AND stage_id IS NOT NULL AND claimant_side IS NOT NULL)
        AND num_nonnulls (ticket_id, stage_id, claimant_side) IN (0, 3)
    ),
    -- A product dispute is upheld (refund) or dismissed (release), never split.
    CONSTRAINT ck_disputes_order_line_split CHECK (subject_kind <> 'order_line' OR status <> 'resolved_split')
);

-- A dispute's statements, append-only (00001830): one per submission, by either party or an operator.
CREATE TABLE finance.dispute_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    dispute_id uuid NOT NULL REFERENCES finance.disputes (id) ON DELETE RESTRICT,
    sender_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    party text NOT NULL CHECK (party IN ('claimant', 'respondent', 'operator')),
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- The Evidence Vault's files (PRODUCT_SPEC §Dispute Resolution 1): each a `files.items` row its sender
-- uploaded, filed with the statement it came with. Append-only; RESTRICT keeps a filed file's row from
-- ever being removed, and files.fn_can_read (00001160) lets the dispute's readers open it.
CREATE TABLE finance.dispute_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    dispute_id uuid NOT NULL REFERENCES finance.disputes (id) ON DELETE RESTRICT,
    message_id uuid NOT NULL REFERENCES finance.dispute_messages (id) ON DELETE RESTRICT,
    file_id uuid NOT NULL REFERENCES files.items (id) ON DELETE RESTRICT,
    submitted_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_dispute_evidence_message_file UNIQUE (message_id, file_id)
);

-- Phase 1's offers on a ticket escrow dispute (PRODUCT_SPEC §Dispute Resolution 2; PROJECTS EX2,
-- Decision #548 ruling 3): either side proposes the freelancer's share of the contested money in basis
-- points (0 is all of it back to the client, 10000 all of it to the freelancer). The newest offer on a
-- live case is the one standing; the other side accepting it settles the case on its terms
-- (finance.accept_dispute_offer). Written only by the definers in 00001260; append-only but for the
-- one acceptance stamp, and never deleted (finance.fn_dispute_records_immutable, 00001830).
CREATE TABLE finance.dispute_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    dispute_id uuid NOT NULL REFERENCES finance.disputes (id) ON DELETE RESTRICT,
    proposed_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    party text NOT NULL CHECK (party IN ('claimant', 'respondent')),
    payee_share_bp integer NOT NULL CHECK (payee_share_bp BETWEEN 0 AND 10000),
    note text NULL CHECK (note IS NULL OR length(note) BETWEEN 1 AND 1000),
    -- clock_timestamp(), not now(): two offers one transaction writes must keep their order.
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    accepted_at timestamptz NULL,
    accepted_by uuid NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    CONSTRAINT ck_dispute_offers_accepted CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)),
    CONSTRAINT ck_dispute_offers_other_side CHECK (accepted_by IS NULL OR accepted_by <> proposed_by)
);

-- The Evidence Vault (PRODUCT_SPEC §Dispute Resolution 1; PROJECTS EX3, Decision #548 (6)): the
-- point-in-time snapshot a ticket dispute freezes in the transaction that raises it. `manifest` is the
-- record — the ticket's and stage's terms at raise, the contested escrows, the ticket's history, every
-- submission on the stage with its files (each by its stored hash) and the stage's rooms' messages —
-- and `sha256` the SHA-256 (hex) of its canonical text (`manifest::text`). The dispute service copies
-- the files' bytes into the policy-less `evidence` bucket under `object_prefix` (`vault/{dispute_id}/`)
-- and finance.mark_dispute_vault_ready moves `status` pending → ready. Immutable but for that one
-- move, never deleted (finance.fn_dispute_records_immutable, 00001830), and never purged: ⚖️ retention
-- is counsel's (FOUNDER_QUESTIONNAIRE E2.5).
CREATE TABLE finance.dispute_vaults (
    dispute_id uuid PRIMARY KEY REFERENCES finance.disputes (id) ON DELETE RESTRICT,
    manifest jsonb NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
    object_prefix text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region The pending window — earned money clearing to Available (finance-model.md §7, Decision #191)
-- One earned credit inside its safety window. An escrow release (and each team share, finder fee and
-- vault cut of one), a fair-exit payout, a seat release and a product sale write a row here INSTEAD of
-- crediting the wallet; finance.fn_mature_pending_releases credits the wallet once `available_at`
-- passes, writing the ledger row then. So `finance.wallets.balance_cents` stays the Available balance
-- and still equals the ledger sum, and Pending is the sum of `amount_cents - recovered_cents` over
-- this wallet's `state = 'pending'` rows.
--
-- Keyed to its SOURCE by a typed foreign key, exactly one of them: the escrow it was released from,
-- or the order whose sale earned it.
--
-- `state` is where the row stands: `pending` inside the window, `available` once closed — matured
-- (`transaction_id` names the credit) or fully recovered by a lost chargeback (`recovered_cents =
-- amount_cents`, no credit) — or `on_hold` while a card dispute against the payment that funded it is
-- open (Decision #337, ruling M3): finance.fn_open_chargeback freezes it, the sweep skips it, and
-- finance.record_dispute_closed recovers from it first when the dispute is lost, or returns it to
-- `pending` at its unchanged `available_at` when it is won.
CREATE TABLE finance.pending_releases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    escrow_id uuid REFERENCES finance.escrows (id) ON DELETE RESTRICT,
    order_id uuid REFERENCES finance.orders (id) ON DELETE RESTRICT,
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE RESTRICT,
    -- The ledger reason the maturing credit is written with (`escrow_release`, `team_split`, `product_sale` …),
    -- so a matured release reads exactly as an immediate credit always did.
    reason text NOT NULL,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    -- Taken back by a lost chargeback against this wallet before the row matured; the sweep credits the rest.
    recovered_cents bigint NOT NULL DEFAULT 0,
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    released_at timestamptz NOT NULL DEFAULT now(),
    available_at timestamptz NOT NULL,           -- released_at + pending_release_days
    state finance.fund_state NOT NULL DEFAULT 'pending',
    matured_at timestamptz,
    transaction_id uuid REFERENCES finance.transactions (id) ON DELETE RESTRICT,
    -- The card dispute that last froze this row (ruling M3), kept after it resolves as the record of
    -- what froze it and, when lost, what recovered from it. NULL on a row no dispute has reached.
    hold_chargeback_id uuid REFERENCES finance.chargebacks (id) ON DELETE RESTRICT,
    -- The product dispute that froze this row (FBP DB21: a buyer's report on a digital product line
    -- while its sale clears), kept after it resolves like hold_chargeback_id. NULL on any other row.
    hold_dispute_id uuid REFERENCES finance.disputes (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_pending_releases_one_source CHECK (num_nonnulls (escrow_id, order_id) = 1),
    CONSTRAINT ck_pending_releases_hold_case CHECK (
        state <> 'on_hold' OR hold_chargeback_id IS NOT NULL OR hold_dispute_id IS NOT NULL
    ),
    CONSTRAINT ck_pending_releases_recovered CHECK (recovered_cents BETWEEN 0 AND amount_cents),
    CONSTRAINT ck_pending_releases_window CHECK (available_at >= released_at),
    CONSTRAINT ck_pending_releases_closed CHECK (
        (state = 'available') = (matured_at IS NOT NULL)
        AND (transaction_id IS NULL OR state = 'available')
    )
);
-- #endregion

-- #region Inbound payments (Stripe fiat rails, Phase 1 — Decision #125)
-- The EXECUTION log for money ENTERING the platform from an external instrument, and the twin of
-- finance.payouts, which logs money leaving it.
--
-- Nothing else can hold this fact. finance.transactions records only COMPLETED movements, so a card
-- payment that has been started but not paid has nowhere to live, and a DECLINED one moves no money
-- and would leave no trace at all. finance.orders is the record of a basket purchase, not of a
-- top-up or an escrow funding. So one row here per attempt: created when the payer asks to pay
-- (finance.begin_card_payment), bound to the processor's PaymentIntent (attach_card_payment), and
-- settled ONLY by the signed `payment_intent.succeeded` webhook (settle_card_payment).
--
-- The card is charged on the PLATFORM account and the settled amount is credited to `wallet_id`
-- ('topup'); an `escrow_lock` payment then holds the stage's escrow FROM that wallet, exactly as
-- projects.fund_stage would. An escrow is always funded from a wallet — that is the model this
-- table serves, and why the charge is not a destination charge (Decision #125).
CREATE TABLE finance.inbound_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    purpose text NOT NULL CHECK (purpose IN ('wallet_topup', 'escrow_lock')),
    -- The wallet the settled money is credited to: the payer's own for a top-up, the paying business's
    -- for an escrow lock. RESTRICT, not CASCADE: a wallet that has taken money must not take the record
    -- of that money with it.
    wallet_id uuid NOT NULL REFERENCES finance.wallets (id) ON DELETE RESTRICT,
    -- The stage an `escrow_lock` payment funds. SET NULL so a stage retired later keeps the payment
    -- history; which is also why the rule below is one-directional (a top-up never names a stage).
    project_stage_id uuid REFERENCES projects.project_stages (id) ON DELETE SET NULL,
    -- The ONE ticket an `escrow_lock` funds (Decision #166): only that ticket's escrow is held, at its
    -- own price. NULL funds every assigned, unfunded ticket of the stage (projects.fund_stage).
    ticket_id uuid REFERENCES projects.tickets (id) ON DELETE SET NULL,
    -- The paid revision round an `escrow_lock` pays for (Decision #199): settlement runs
    -- projects.fund_paid_revision for it instead of a ticket or stage hold, at the round's price.
    -- RESTRICT, not SET NULL: a nulled round would settle as a whole-stage lock.
    revision_id uuid REFERENCES projects.stage_revision_requests (id) ON DELETE RESTRICT,
    amount_cents bigint NOT NULL CHECK (amount_cents > 0),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    -- What the processor reports it actually received. NULL until settlement; the ledger is credited
    -- with THIS figure, because it is the money that exists.
    amount_received_cents bigint CHECK (amount_received_cents IS NULL OR amount_received_cents >= 0),
    status finance.inbound_payment_status NOT NULL DEFAULT 'requires_payment',
    -- For an escrow lock: whether the settled money could be held against the stage. A failed lock
    -- loses nothing — the money stays in the paying wallet, where the stage can be funded again.
    lock_status text NOT NULL DEFAULT 'not_applicable'
        CHECK (lock_status IN ('not_applicable', 'pending', 'locked', 'failed')),
    lock_error text,
    -- The escrows this payment's lock created, so a chargeback can freeze exactly the capital it
    -- funded (Dispute Lockbox) without inferring it from timestamps.
    locked_escrow_ids uuid[] NOT NULL DEFAULT '{}',
    provider text NOT NULL DEFAULT 'stripe',
    provider_ref text,                        -- Stripe PaymentIntent id; XXXX-XXXX in docs
    -- The payer's attempt key. UNIQUE, so a retry after an unseen timeout resolves to the SAME
    -- payment rather than a second charge.
    idempotency_key text NOT NULL UNIQUE,
    -- The ledger credit this payment produced. NULL until it settles, and NULL forever when it fails.
    transaction_id uuid REFERENCES finance.transactions (id) ON DELETE SET NULL,
    failure_reason text,
    -- Whether the settling event came from the processor's live mode. NULL until settlement.
    livemode boolean,
    -- Who asked to pay. The escrow lock is re-authorised as THIS user when the payment settles, so a
    -- member who lost the right to spend in between cannot have a lock completed on their behalf.
    created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    -- The standing rule that charged this payment off-session (finance.claim_due_deposit_rules), or
    -- NULL for a payment somebody made in the moment. SET NULL: deleting a rule must not erase the
    -- history of what it charged.
    deposit_rule_id uuid REFERENCES finance.deposit_rules (id) ON DELETE SET NULL,
    -- The checkout this top-up pays for (Decision #153) — `{basket_id, item_ids, currency, units,
    -- promo_code, order_key}`, written by finance.attach_checkout_order. When set, the signed webhook
    -- that settles the top-up ALSO places the order (finance.place_wallet_order, as `created_by`,
    -- under `order_key`), so a buyer whose browser never comes back is not left with a funded wallet
    -- and no order. Only ids, integer minor units and a promo code — no PII. NULL for every other top-up.
    checkout jsonb,
    -- The order that checkout placed. SET NULL: an order is never deleted, but the payment must not
    -- be the thing that keeps it.
    order_id uuid REFERENCES finance.orders (id) ON DELETE SET NULL,
    -- Why the webhook could not place it (a price that moved, a line no longer for sale). The money
    -- stays in the wallet; the browser's own attempt re-asks under the same key.
    order_error text,
    -- The locked FX quote this payment was started on (Decision #435): it is charged the quote's
    -- `from_minor` in its `from_currency`, into the payer's wallet in that currency, and settlement
    -- executes the quote before the escrow lock or the order. NULL when the payment is in the currency it
    -- pays for.
    fx_quote_id uuid REFERENCES finance.fx_quotes (id) ON DELETE RESTRICT,
    -- Why a settled payment's purpose was not applied (`settled_unapplied`, Decision #200): the lock or
    -- the order refused after the credit, which is kept. The detail stays in lock_error / order_error.
    unapplied_reason text,
    -- How much of the charge `charge.refunded` has accounted for: Stripe's CUMULATIVE
    -- `amount_refunded`, capped at what was credited. Each newly refunded part is debited from the
    -- wallet (reason `refund`), so a replay or an older, lower total debits nothing
    -- (finance.record_charge_refunded).
    refunded_cents bigint NOT NULL DEFAULT 0,
    -- The part of `refunded_cents` the wallet could no longer cover when it was refunded (the payer had
    -- spent it): the platform's loss, recorded rather than forced into a negative balance, the way
    -- finance.chargebacks.unrecovered_cents records a lost dispute's.
    refund_unrecovered_cents bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    succeeded_at timestamptz,
    CONSTRAINT uq_inbound_payments_provider_ref UNIQUE (provider, provider_ref),
    CONSTRAINT uq_inbound_payments_fx_quote UNIQUE (fx_quote_id),
    -- A refund never exceeds what was credited, and only a settled payment was credited anything.
    CONSTRAINT inbound_payments_refund_within_received CHECK (
        refunded_cents >= 0 AND refunded_cents <= COALESCE(amount_received_cents, 0)
        AND (refunded_cents = 0 OR status IN ('succeeded', 'settled_unapplied'))
    ),
    CONSTRAINT inbound_payments_refund_unrecovered_within CHECK (
        refund_unrecovered_cents >= 0 AND refund_unrecovered_cents <= refunded_cents
    ),
    -- Only a top-up can pay for a checkout; an escrow lock funds a stage, never an order.
    CONSTRAINT inbound_payments_checkout_only_for_topups CHECK (
        checkout IS NULL OR purpose = 'wallet_topup'
    ),
    -- An order outcome exists only for a payment that carried a checkout.
    CONSTRAINT inbound_payments_order_only_with_checkout CHECK (
        (order_id IS NULL AND order_error IS NULL) OR checkout IS NOT NULL
    ),
    -- A standing deposit only ever tops a wallet up.
    CONSTRAINT inbound_payments_rule_only_for_topups CHECK (
        deposit_rule_id IS NULL OR purpose = 'wallet_topup'
    ),
    -- A top-up never names a stage (an escrow lock may lose its stage later, hence one-directional).
    CONSTRAINT inbound_payments_stage_only_for_locks CHECK (
        purpose = 'escrow_lock' OR project_stage_id IS NULL
    ),
    CONSTRAINT inbound_payments_ticket_only_for_locks CHECK (
        purpose = 'escrow_lock' OR ticket_id IS NULL
    ),
    -- A revision round is funded on its own, never alongside a named ticket hold.
    CONSTRAINT inbound_payments_revision_only_for_locks CHECK (
        revision_id IS NULL OR (purpose = 'escrow_lock' AND ticket_id IS NULL)
    ),
    -- The lock state is meaningful exactly for escrow locks.
    CONSTRAINT inbound_payments_lock_matches_purpose CHECK (
        (purpose = 'wallet_topup') = (lock_status = 'not_applicable')
    ),
    CONSTRAINT inbound_payments_lock_error_only_when_failed CHECK (
        lock_error IS NULL OR lock_status = 'failed'
    ),
    -- Settlement and the settled states are the same fact stated twice, so they may never disagree.
    CONSTRAINT inbound_payments_succeeded_matches_status CHECK (
        (status IN ('succeeded', 'settled_unapplied')) = (succeeded_at IS NOT NULL)
    ),
    -- A settled payment IS its ledger credit (Decision #200): no settled row without one, no credit
    -- on an unsettled row.
    CONSTRAINT inbound_payments_credit_only_when_succeeded CHECK (
        (transaction_id IS NOT NULL) = (status IN ('succeeded', 'settled_unapplied'))
    ),
    CONSTRAINT inbound_payments_unapplied_has_reason CHECK (
        (status = 'settled_unapplied') = (unapplied_reason IS NOT NULL)
    ),
    CONSTRAINT inbound_payments_reason_only_when_unpaid CHECK (
        failure_reason IS NULL OR status IN ('failed', 'canceled')
    )
);

COMMENT ON TABLE finance.inbound_payments IS
'One attempt to move money INTO a wallet from an external instrument (a Stripe PaymentIntent on the
platform account). Settled only by the signed payment_intent.succeeded webhook, which credits the
wallet (reason topup), for an escrow_lock holds the stage escrow from it, and for a top-up carrying a
checkout places that order as the payer. The twin of finance.payouts. Money moves only through the
finance.* definer functions; no client role writes here.';
-- #endregion

-- #region Processor customers — the Stripe Customer a saved card is attached to
-- A card saved for later (a recurring deposit, a one-click top-up) has to be attached to a Stripe
-- Customer, and a Customer has to be reused or every saved card lands on a different one. This is the
-- one place that pairing lives: one Customer per finance owner per provider. No PII: the processor id
-- only. Definer-only (RLS on, no policy) — written and read through finance.card_owner_for /
-- finance.record_processor_customer, which authorise the caller themselves.
CREATE TABLE finance.processor_customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    owner_type text NOT NULL CHECK (owner_type IN ('user', 'freelancer', 'business', 'team', 'enterprise')),
    owner_id uuid NOT NULL,
    provider text NOT NULL DEFAULT 'stripe',
    customer_ref text NOT NULL,                   -- Stripe Customer id (cus_…); XXXX-XXXX in docs
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_processor_customers_owner UNIQUE (provider, owner_type, owner_id),
    CONSTRAINT uq_processor_customers_ref UNIQUE (provider, customer_ref)
);
-- #endregion

-- #region AML monitoring signals (Decision #529; #336 ruling I1, the data half of "AML-ready")
-- One row per pattern a money door saw: `round_trip` (one person on both sides of an escrow, at its
-- hold or its release), `rapid_churn` (a withdrawal of at least `aml_churn_min_minor` after at least as
-- much card money came in inside `aml_churn_window_hours`) and `safety_hold` (a withdrawal the 72-hour
-- Safety Hold refused). A signal is a fact for an operator, never a finding about a person: nothing
-- reads it to decide anything except the Safety Hold, which is off (`aml_safety_hold_enabled`).
--
-- Columns are what the readers filter on (subject, kind, time) and what ties a row to the money it
-- describes (wallet, escrow, payout, amount); everything else a reviewer needs is `facts`, ids and
-- integer minor units only. No name, address, IP or user agent (Decision #446): a signal is built from
-- rows the platform already holds. Append-only (trg_aml_signals_append_only, 00001830); RLS on with no
-- policy and no client grant, so the subject never sees it; written only by the definers on the money
-- paths and read only through finance.read_aml_signals (operators). Kept for the AML period
-- (finance-model.md §17) and HOLD under erasure: RESTRICT on every reference, so a person, an escrow or
-- a payout with a signal behind it is never hard-deleted.
CREATE TABLE finance.aml_signals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    kind text NOT NULL CHECK (kind IN ('round_trip', 'rapid_churn', 'safety_hold')),
    -- The person the pattern is about: the one on both sides, or the one withdrawing.
    subject_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    wallet_id uuid REFERENCES finance.wallets (id) ON DELETE RESTRICT,
    escrow_id uuid REFERENCES finance.escrows (id) ON DELETE RESTRICT,
    payout_id uuid REFERENCES finance.payouts (id) ON DELETE RESTRICT,
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    facts jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT ck_aml_signals_round_trip_escrow CHECK (kind <> 'round_trip' OR escrow_id IS NOT NULL),
    CONSTRAINT ck_aml_signals_withdrawal_wallet CHECK (kind = 'round_trip' OR wallet_id IS NOT NULL)
);

COMMENT ON TABLE finance.aml_signals IS
'AML monitoring signals (Decision #529): round_trip, rapid_churn and safety_hold facts recorded by the
money-path definers. Append-only, never visible to the subject, read by operators through
finance.read_aml_signals. Kept for the AML period; HOLD under erasure.';
-- #endregion
