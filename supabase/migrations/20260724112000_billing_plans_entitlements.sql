-- =============================================================================================
-- 20260724112000_billing_plans_entitlements.sql
-- Subscriptions, Standing & Gamification foundation (3/4) — the PAID ladder.
--
-- ADDITIVE ONLY. New enums, new finance tables, additive columns on the (previously skeletal)
-- `finance.subscriptions`, seed rows. No table/column/FK is dropped or altered. Authored, NOT applied
-- to any live database.
--
-- THE GOVERNING SEPARATION (three axes — finance-model.md §1.1):
--   1. EXECUTION capacity  — how much work you may hold concurrently. NEVER monetised; stays governed
--      by Workload Intensity ($W_i$) caps. No plan in this file grants execution headroom.
--   2. DISTRIBUTION        — outbound proposals/invitations. Tiered ALLOWANCE (4/4), never sold
--      à la carte: every tier keeps a ceiling, so deep pockets can never buy raw proposal volume.
--   3. MARKETPLACE FOOTPRINT — active public projects, published listings, entities owned, seats,
--      promoted placement. Tiered caps.
--
-- AND THE SECOND SEPARATION: a plan ACCELERATES capacity; it can never buy REPUTATION. Nothing here
-- writes to `org.entity_standing` (2/4). The two ladders stack — earn it, or accelerate it — but a
-- rung is never for sale.
-- =============================================================================================

-- #region 1. Vocabulary
DO $$ BEGIN
    CREATE TYPE finance.plan_audience AS ENUM ('individual', 'team', 'business', 'organisation');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE finance.plan_tier AS ENUM ('free', 'pro', 'enterprise');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE finance.billing_interval AS ENUM ('monthly', 'annual', 'custom');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE finance.subscription_state AS ENUM
        ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- A limit carries a number; a flag carries a boolean capability.
DO $$ BEGIN
    CREATE TYPE finance.entitlement_kind AS ENUM ('limit', 'flag');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- How the EARNED ladder (org.standing_levels) modifies this plan's value:
--   none          → the plan value is final.
--   standing_base → effective = standing_levels.listing_base × (multiplier_bp / 10000).
--                   (Free = 1.0x the rung's base; Pro = 2.0x — so an ambitious free user earns their
--                   way up, and Pro doubles whatever they have earned. Never a flat replacement.)
--   standing_bonus→ effective = limit_value + standing_levels.proposal_bonus.
--                   (Reliability buys volume the same way money does — the anti-Upwork headline.)
DO $$ BEGIN
    CREATE TYPE finance.entitlement_scaling AS ENUM ('none', 'standing_base', 'standing_bonus');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The closed limit vocabulary. Adding a lever is a migration + a Zod change in the same commit
-- (`@projective/types/finance/entitlements.ts`) — deliberate friction that keeps the SSOT honest.
DO $$ BEGIN
    CREATE TYPE finance.entitlement_key AS ENUM (
        -- Footprint (buyer side)
        'active_public_projects',
        'private_drafts',
        -- Footprint (seller side)
        'published_listings',
        -- Distribution
        'weekly_proposals',
        'proposal_buffer_per_10h',
        -- Ownership umbrella (how many entities a PERSON may spin up)
        'teams_owned',
        'businesses_owned',
        'teams_joined',
        'businesses_joined',
        -- Entity muscle (what an entity's OWN plan powers)
        'team_seats',
        'team_public_projects',
        'business_public_projects',
        'business_managers',
        'organisation_seats',
        'organisation_businesses',
        'departments',
        -- Capability flags
        'promoted_placement',
        'advanced_analytics',
        'discovery_boost',
        'instant_payouts_included',
        'pooled_wallet_full',
        'advanced_vault_splits',
        'intervaled_invoicing',
        'sso_enabled',
        'api_access',
        'audit_log_retention_days',
        'dedicated_support',
        'negotiated_platform_fee'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- #endregion

-- #region 2. finance.plans — the catalogue
CREATE TABLE IF NOT EXISTS finance.plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    code text NOT NULL UNIQUE,
    label text NOT NULL,
    audience finance.plan_audience NOT NULL,
    tier finance.plan_tier NOT NULL,
    -- NULL price = custom/negotiated (the Organisation tier) OR not yet set (flagged below).
    price_cents bigint CHECK (price_cents IS NULL OR price_cents >= 0),
    currency char(3) NOT NULL DEFAULT 'GBP',
    billing_interval finance.billing_interval NOT NULL DEFAULT 'monthly',
    is_custom_priced boolean NOT NULL DEFAULT false,
    -- Seat-based pricing (Organisation) keys off org.employee_scale; per-seat price in minor units.
    per_seat_cents bigint CHECK (per_seat_cents IS NULL OR per_seat_cents >= 0),
    is_default boolean NOT NULL DEFAULT false,     -- the free plan implicitly held by every subject
    is_public boolean NOT NULL DEFAULT true,
    sort_order smallint NOT NULL DEFAULT 0,
    provider text NOT NULL DEFAULT 'stripe',
    provider_price_ref text,                       -- Stripe Price id (XXXX-XXXX in docs)
    pricing_note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plans_default_per_audience
    ON finance.plans (audience) WHERE is_default;

INSERT INTO finance.plans
    (code, label, audience, tier, price_cents, currency, billing_interval, is_custom_priced, is_default, sort_order, pricing_note) VALUES
    ('individual_free', 'Free',            'individual',   'free',       0, 'GBP', 'monthly', false, true,  10,
        'The universal baseline every account holds. A freelancer is a superset of a client, so this plan carries the full BUYER baseline too — there is no separate client plan.'),
    ('individual_pro',  'Pro',             'individual',   'pro',     1299, 'GBP', 'monthly', false, false, 20,
        '£12.99/mo. Accelerates footprint + distribution. Never accelerates reputation.'),
    ('team_free',       'Team',            'team',         'free',       0, 'GBP', 'monthly', false, true,  30,
        'Attached to a team, not a person. A team must hold >= 2 members to send proposals.'),
    ('team_pro',        'Pro Team',        'team',         'pro',     2900, 'GBP', 'monthly', false, false, 40,
        '£29/mo per team (pre-existing rate, finance-model.md §1.3).'),
    ('business_free',   'Business',        'business',     'free',       0, 'GBP', 'monthly', false, true,  50,
        'Attached to a business. Pooled wallet in basic mode.'),
    ('business_pro',    'Business Pro',    'business',     'pro',     NULL, 'GBP', 'monthly', false, false, 60,
        'PRICE TBD (flagged, root CLAUDE.md §8): the per-business monthly rate has not been set by the product owner. Entitlements are seeded; price_cents stays NULL until confirmed.'),
    ('organisation',    'Organisation',    'organisation', 'enterprise', NULL, 'GBP', 'custom', true, false, 70,
        'Seat-based, custom-priced, keyed to org.employee_scale (1-50 / 51-200 / 201-500 / 500+). The one place the platform fee may be negotiated (finance.negotiated_rates).'),
    ('organisation_free','Organisation (draft)', 'organisation', 'free', 0, 'GBP', 'monthly', false, true, 65,
        'Free-to-draft. An organisation may be created and configured at no cost; going active and adding seats requires the Organisation subscription — the same draft-first pattern used everywhere else.')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE finance.plans ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.plans TO authenticated;
GRANT ALL ON TABLE finance.plans TO service_role;

DROP POLICY IF EXISTS "Read public plans" ON finance.plans;
CREATE POLICY "Read public plans" ON finance.plans FOR
SELECT TO authenticated USING (is_public OR security.is_admin ());
-- #endregion

-- #region 3. finance.plan_entitlements — what a plan actually grants
CREATE TABLE IF NOT EXISTS finance.plan_entitlements (
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

CREATE INDEX IF NOT EXISTS idx_plan_entitlements_key ON finance.plan_entitlements (entitlement_key);

ALTER TABLE finance.plan_entitlements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.plan_entitlements TO authenticated;
GRANT ALL ON TABLE finance.plan_entitlements TO service_role;

DROP POLICY IF EXISTS "Read plan entitlements" ON finance.plan_entitlements;
CREATE POLICY "Read plan entitlements" ON finance.plan_entitlements FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region 4. Seeded entitlement matrix
-- Magnitudes are STARTING DIALS. The governing design constraint (product owner, 2026-07-24):
-- "a user should never feel suffocated by their tier — the features they have should feel plentiful,
-- and upgrading should just make sense." Every free value below is deliberately generous.

-- Individual Free — the universal baseline (buyer + seller).
INSERT INTO finance.plan_entitlements (plan_id, entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp, note)
SELECT p.id, v.k::finance.entitlement_key, v.kind::finance.entitlement_kind, v.lim, v.unl, v.flg, v.scal::finance.entitlement_scaling, v.mult, v.note
FROM finance.plans p, (VALUES
    ('private_drafts',            'limit', NULL::integer, true,  false, 'none',          10000, 'Unlimited private drafting — you are never charged to think.'),
    ('active_public_projects',    'limit', 3,             false, false, 'none',          10000, 'Concurrent LIVE public postings as a client.'),
    ('published_listings',        'limit', NULL,          false, false, 'standing_base', 10000, 'Earned footprint: 10 at L1, scaling to 50 at L5 (org.standing_levels.listing_base).'),
    ('weekly_proposals',          'limit', 50,            false, false, 'standing_bonus',10000, 'Base 50/wk + the rung bonus. Anti-spam ceiling, not a paywall.'),
    ('proposal_buffer_per_10h',   'limit', 3,             false, false, 'none',          10000, 'Rolling drip: 3 proposals returned every 10 hours, capped by the weekly allowance.'),
    ('teams_owned',               'limit', 3,             false, false, 'none',          10000, NULL),
    ('businesses_owned',          'limit', 1,             false, false, 'none',          10000, NULL),
    ('teams_joined',              'limit', NULL,          true,  false, 'none',          10000, 'Uncapped by owner directive — joining is viral; capping it would hurt growth.'),
    ('businesses_joined',         'limit', NULL,          true,  false, 'none',          10000, 'Uncapped, same reasoning.'),
    ('promoted_placement',        'flag',  NULL,          false, false, 'none',          10000, NULL),
    ('advanced_analytics',        'flag',  NULL,          false, false, 'none',          10000, 'Basic analytics remain free.'),
    ('discovery_boost',           'flag',  NULL,          false, false, 'none',          10000, 'Free users still get the availability/new-talent Discovery Boost — that is EARNED, not sold.'),
    ('instant_payouts_included',  'flag',  NULL,          false, false, 'none',          10000, 'Available pay-per-use on Free.')
) AS v(k, kind, lim, unl, flg, scal, mult, note)
WHERE p.code = 'individual_free'
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;

-- Individual Pro — £12.99/mo. Raises the ceiling; never removes it.
INSERT INTO finance.plan_entitlements (plan_id, entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp, note)
SELECT p.id, v.k::finance.entitlement_key, v.kind::finance.entitlement_kind, v.lim, v.unl, v.flg, v.scal::finance.entitlement_scaling, v.mult, v.note
FROM finance.plans p, (VALUES
    ('private_drafts',            'limit', NULL::integer, true,  false, 'none',          10000, NULL),
    ('active_public_projects',    'limit', 15,            false, false, 'none',          10000, NULL),
    ('published_listings',        'limit', NULL,          false, false, 'standing_base', 20000, 'DOUBLE the rung base — Pro accelerates what you earned, it does not replace it.'),
    ('weekly_proposals',          'limit', 150,           false, false, 'standing_bonus',10000, 'Base 150/wk + the rung bonus. Still a ceiling.'),
    ('proposal_buffer_per_10h',   'limit', 5,             false, false, 'none',          10000, NULL),
    ('teams_owned',               'limit', 6,             false, false, 'none',          10000, 'Owning more entities does NOT power them — each entity pays for its own muscle.'),
    ('businesses_owned',          'limit', 3,             false, false, 'none',          10000, NULL),
    ('teams_joined',              'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('businesses_joined',         'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('promoted_placement',        'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('advanced_analytics',        'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('discovery_boost',           'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('instant_payouts_included',  'flag',  NULL,          false, true,  'none',          10000, 'Instant payout fee magnitude remains TBD platform-wide (Decision #55).')
) AS v(k, kind, lim, unl, flg, scal, mult, note)
WHERE p.code = 'individual_pro'
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;

-- Team Free / Pro Team — attached to the TEAM, not to its owner.
INSERT INTO finance.plan_entitlements (plan_id, entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp, note)
SELECT p.id, v.k::finance.entitlement_key, v.kind::finance.entitlement_kind, v.lim, v.unl, v.flg, v.scal::finance.entitlement_scaling, v.mult, v.note
FROM finance.plans p, (VALUES
    ('team_seats',                'limit', 4,             false, false, 'none',          10000, 'A team needs >= 2 members before it may send proposals.'),
    ('team_public_projects',      'limit', 2,             false, false, 'none',          10000, NULL),
    ('published_listings',        'limit', NULL,          false, false, 'standing_base', 10000, NULL),
    ('weekly_proposals',          'limit', 50,            false, false, 'standing_bonus',10000, 'A free team draws on its members'' allowances rather than a dedicated pool.'),
    ('advanced_vault_splits',     'flag',  NULL,          false, false, 'none',          10000, NULL),
    ('advanced_analytics',        'flag',  NULL,          false, false, 'none',          10000, NULL),
    ('promoted_placement',        'flag',  NULL,          false, false, 'none',          10000, NULL)
) AS v(k, kind, lim, unl, flg, scal, mult, note)
WHERE p.code = 'team_free'
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;

INSERT INTO finance.plan_entitlements (plan_id, entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp, note)
SELECT p.id, v.k::finance.entitlement_key, v.kind::finance.entitlement_kind, v.lim, v.unl, v.flg, v.scal::finance.entitlement_scaling, v.mult, v.note
FROM finance.plans p, (VALUES
    ('team_seats',                'limit', 15,            false, false, 'none',          10000, NULL),
    ('team_public_projects',      'limit', 15,            false, false, 'none',          10000, NULL),
    ('published_listings',        'limit', NULL,          false, false, 'standing_base', 20000, NULL),
    ('weekly_proposals',          'limit', 150,           false, false, 'standing_bonus',10000, 'A dedicated pooled team quota, separate from members'' personal allowances.'),
    ('advanced_vault_splits',     'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('advanced_analytics',        'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('promoted_placement',        'flag',  NULL,          false, true,  'none',          10000, NULL)
) AS v(k, kind, lim, unl, flg, scal, mult, note)
WHERE p.code = 'team_pro'
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;

-- Business Free / Business Pro — attached to the BUSINESS. KYB (L3) still gates the pooled wallet.
INSERT INTO finance.plan_entitlements (plan_id, entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp, note)
SELECT p.id, v.k::finance.entitlement_key, v.kind::finance.entitlement_kind, v.lim, v.unl, v.flg, v.scal::finance.entitlement_scaling, v.mult, v.note
FROM finance.plans p, (VALUES
    ('business_public_projects',  'limit', 3,             false, false, 'none',          10000, NULL),
    ('business_managers',         'limit', 2,             false, false, 'none',          10000, 'Project Managers / Observers.'),
    ('private_drafts',            'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('pooled_wallet_full',        'flag',  NULL,          false, false, 'none',          10000, 'Basic pooled wallet only. KYB verification remains a SEPARATE gate — never sold.'),
    ('intervaled_invoicing',      'flag',  NULL,          false, false, 'none',          10000, NULL),
    ('departments',               'limit', 0,             false, false, 'none',          10000, NULL),
    ('advanced_analytics',        'flag',  NULL,          false, false, 'none',          10000, NULL)
) AS v(k, kind, lim, unl, flg, scal, mult, note)
WHERE p.code = 'business_free'
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;

INSERT INTO finance.plan_entitlements (plan_id, entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp, note)
SELECT p.id, v.k::finance.entitlement_key, v.kind::finance.entitlement_kind, v.lim, v.unl, v.flg, v.scal::finance.entitlement_scaling, v.mult, v.note
FROM finance.plans p, (VALUES
    ('business_public_projects',  'limit', 25,            false, false, 'none',          10000, NULL),
    ('business_managers',         'limit', 15,            false, false, 'none',          10000, NULL),
    ('private_drafts',            'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('pooled_wallet_full',        'flag',  NULL,          false, true,  'none',          10000, 'Full pooled wallet + spending caps. Still requires KYB.'),
    ('intervaled_invoicing',      'flag',  NULL,          false, true,  'none',          10000, 'Monthly consolidated invoicing (finance-model.md §Invoicing).'),
    ('departments',               'limit', 5,             false, false, 'none',          10000, 'Light departmental scoping; full isolation is the Organisation tier.'),
    ('advanced_analytics',        'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('promoted_placement',        'flag',  NULL,          false, true,  'none',          10000, NULL)
) AS v(k, kind, lim, unl, flg, scal, mult, note)
WHERE p.code = 'business_pro'
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;

-- Organisation (draft, free) — create and configure at no cost.
INSERT INTO finance.plan_entitlements (plan_id, entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp, note)
SELECT p.id, v.k::finance.entitlement_key, v.kind::finance.entitlement_kind, v.lim, v.unl, v.flg, v.scal::finance.entitlement_scaling, v.mult, v.note
FROM finance.plans p, (VALUES
    ('organisation_seats',        'limit', 3,             false, false, 'none',          10000, 'Enough to configure and evaluate; going active needs the paid tier.'),
    ('organisation_businesses',   'limit', 1,             false, false, 'none',          10000, NULL),
    ('departments',               'limit', 2,             false, false, 'none',          10000, NULL),
    ('private_drafts',            'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('active_public_projects',    'limit', 1,             false, false, 'none',          10000, NULL)
) AS v(k, kind, lim, unl, flg, scal, mult, note)
WHERE p.code = 'organisation_free'
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;

-- Organisation (paid, custom) — the enterprise ceiling.
INSERT INTO finance.plan_entitlements (plan_id, entitlement_key, kind, limit_value, is_unlimited, flag_value, scaling, multiplier_bp, note)
SELECT p.id, v.k::finance.entitlement_key, v.kind::finance.entitlement_kind, v.lim, v.unl, v.flg, v.scal::finance.entitlement_scaling, v.mult, v.note
FROM finance.plans p, (VALUES
    ('organisation_seats',        'limit', NULL::integer, true,  false, 'none',          10000, 'Seat count is the PRICING dial (org.employee_scale), not a hard cap.'),
    ('organisation_businesses',   'limit', NULL,          true,  false, 'none',          10000, 'Unlimited businesses nested under the organisation.'),
    ('departments',               'limit', NULL,          true,  false, 'none',          10000, 'Full departmental isolation — Marketing sees only marketing pipelines.'),
    ('business_public_projects',  'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('business_managers',         'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('private_drafts',            'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('active_public_projects',    'limit', NULL,          true,  false, 'none',          10000, NULL),
    ('pooled_wallet_full',        'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('intervaled_invoicing',      'flag',  NULL,          false, true,  'none',          10000, 'Consolidated statement across every department.'),
    ('advanced_analytics',        'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('sso_enabled',               'flag',  NULL,          false, true,  'none',          10000, 'SAML/OIDC domain discovery (PRODUCT_SPEC.md §Enterprise SSO).'),
    ('api_access',                'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('audit_log_retention_days',  'limit', 730,           false, false, 'none',          10000, NULL),
    ('dedicated_support',         'flag',  NULL,          false, true,  'none',          10000, NULL),
    ('negotiated_platform_fee',   'flag',  NULL,          false, true,  'none',          10000, 'The ONE place the 5% service fee may flex — via finance.negotiated_rates, admin-approved.')
) AS v(k, kind, lim, unl, flg, scal, mult, note)
WHERE p.code = 'organisation'
ON CONFLICT (plan_id, entitlement_key) DO NOTHING;
-- #endregion

-- #region 5. finance.subscriptions — additive extension of the 0009 skeleton
-- The pre-existing table was (id, profile_id, plan text, status text, started_at, ends_at) with no
-- subject scoping, no period and no provider linkage. Every column below is ADDED; `profile_id` and
-- the legacy `plan` text column are RETAINED (never dropped) and become the legacy mirror.
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS subject_type text;
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS subject_id uuid;
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES finance.plans (id) ON DELETE RESTRICT;
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS state finance.subscription_state NOT NULL DEFAULT 'active';
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS billing_interval finance.billing_interval NOT NULL DEFAULT 'monthly';
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS current_period_start timestamptz;
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS seats integer CHECK (seats IS NULL OR seats > 0);
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS price_cents bigint CHECK (price_cents IS NULL OR price_cents >= 0);
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS currency char(3);
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS provider_ref text;
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE finance.subscriptions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- The legacy `plan` / `status` text columns are NOT NULL and must stay truthful. Rather than relax
-- them (an alteration), give `plan` a DEFAULT and mirror both from the new authoritative columns —
-- purely additive, and the backend never has to double-write.
ALTER TABLE finance.subscriptions ALTER COLUMN plan SET DEFAULT 'free';

CREATE OR REPLACE FUNCTION finance.fn_sync_legacy_subscription_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = finance, public
AS $$
BEGIN
    IF NEW.plan_id IS NOT NULL THEN
        SELECT p.code INTO NEW.plan FROM finance.plans p WHERE p.id = NEW.plan_id;
    END IF;
    -- The legacy `profile_id` is NOT NULL with no default; NOT NULL is checked AFTER this BEFORE
    -- trigger, so mirroring the subject here keeps new subject-scoped rows insertable unchanged.
    NEW.profile_id := COALESCE(NEW.profile_id, NEW.subject_id);
    NEW.status := NEW.state::text;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_legacy_subscription_columns ON finance.subscriptions;
CREATE TRIGGER trg_sync_legacy_subscription_columns
    BEFORE INSERT OR UPDATE ON finance.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_sync_legacy_subscription_columns ();

CREATE INDEX IF NOT EXISTS idx_subscriptions_subject ON finance.subscriptions (subject_type, subject_id, state);
-- Exactly one live subscription per subject. Partial unique index (not a table constraint) so the
-- legacy rows — which carry NULL subject scoping — are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_active_subject
    ON finance.subscriptions (subject_type, subject_id)
    WHERE subject_type IS NOT NULL AND state IN ('trialing', 'active', 'past_due', 'paused');

ALTER TABLE finance.subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.subscriptions TO authenticated;
GRANT ALL ON TABLE finance.subscriptions TO service_role;

-- Readable by the subject's members; writes are definer/service (a Stripe webhook owns the lifecycle).
DROP POLICY IF EXISTS "View own subscriptions" ON finance.subscriptions;
CREATE POLICY "View own subscriptions" ON finance.subscriptions FOR
SELECT TO authenticated USING (
        subject_type IS NOT NULL AND finance.fn_owner_visible (subject_type, subject_id)
    );
-- #endregion

-- #region 6. finance.subscription_events — the billing audit trail
CREATE TABLE IF NOT EXISTS finance.subscription_events (
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

CREATE INDEX IF NOT EXISTS idx_subscription_events_subject
    ON finance.subscription_events (subject_type, subject_id, created_at DESC);

ALTER TABLE finance.subscription_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.subscription_events TO authenticated;
GRANT ALL ON TABLE finance.subscription_events TO service_role;

DROP POLICY IF EXISTS "View own subscription events" ON finance.subscription_events;
CREATE POLICY "View own subscription events" ON finance.subscription_events FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));
-- #endregion

-- #region 7. finance.entitlement_grants — manual overrides (comps, trials, enterprise negotiation)
-- A grant may only RAISE an effective limit, never lower it (enforced in the resolver, 4/4), so a
-- misconfigured grant can never suffocate a paying subject.
CREATE TABLE IF NOT EXISTS finance.entitlement_grants (
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

CREATE INDEX IF NOT EXISTS idx_entitlement_grants_lookup
    ON finance.entitlement_grants (subject_type, subject_id, entitlement_key, expires_at);

ALTER TABLE finance.entitlement_grants ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.entitlement_grants TO authenticated;
GRANT ALL ON TABLE finance.entitlement_grants TO service_role;

DROP POLICY IF EXISTS "View own entitlement grants" ON finance.entitlement_grants;
CREATE POLICY "View own entitlement grants" ON finance.entitlement_grants FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));
-- #endregion

-- #region 8. finance.standing_commission_tiers — the EARNED commission taper
-- The retention mechanic: the platform's best sellers pay the least. Marketplace commission tapers
-- with the earned rung (never with the plan). `platform_fee_bp` is NULL at every rung — the 5%
-- project service fee does NOT taper with Standing; it flexes only via negotiated Organisation deals
-- (§9). Marketplace commission is the separate 8–20% band of finance-model.md §1.2.
CREATE TABLE IF NOT EXISTS finance.standing_commission_tiers (
    level smallint PRIMARY KEY REFERENCES org.standing_levels (level) ON DELETE CASCADE,
    marketplace_commission_bp integer NOT NULL CHECK (marketplace_commission_bp BETWEEN 0 AND 10000),
    -- Optional per-rung override of the project service fee. Intentionally NULL everywhere: the 5%
    -- is sacrosanct outside negotiated Organisation contracts.
    platform_fee_bp integer CHECK (platform_fee_bp IS NULL OR platform_fee_bp BETWEEN 0 AND 10000),
    note text
);

INSERT INTO finance.standing_commission_tiers (level, marketplace_commission_bp, platform_fee_bp, note) VALUES
    (1, 800, NULL, 'Base marketplace commission — 8%, comparable to Etsy (finance-model.md §1.2).'),
    (2, 800, NULL, 'Held at base while a track record forms.'),
    (3, 750, NULL, '7.5% — the taper begins at Trusted.'),
    (4, 700, NULL, '7%.'),
    (5, 650, NULL, '6.5% — the lowest rate on the platform, earned and never purchasable.')
ON CONFLICT (level) DO NOTHING;

ALTER TABLE finance.standing_commission_tiers ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.standing_commission_tiers TO authenticated;
GRANT ALL ON TABLE finance.standing_commission_tiers TO service_role;

DROP POLICY IF EXISTS "Read commission tiers" ON finance.standing_commission_tiers;
CREATE POLICY "Read commission tiers" ON finance.standing_commission_tiers FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region 9. finance.negotiated_rates — the one sanctioned flex of the 5% service fee
-- Owner decision (2026-07-24): the platform fee MAY flex for Organisation volume commitments. Every
-- flex is an explicit, admin-approved, time-boxed row — never an implicit consequence of a plan.
CREATE TABLE IF NOT EXISTS finance.negotiated_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type text NOT NULL CHECK (subject_type IN ('business', 'organisation')),
    subject_id uuid NOT NULL,
    platform_fee_bp integer NOT NULL CHECK (platform_fee_bp BETWEEN 0 AND 10000),
    marketplace_commission_bp integer CHECK (marketplace_commission_bp IS NULL OR marketplace_commission_bp BETWEEN 0 AND 10000),
    -- The commitment the discount is priced against.
    minimum_volume_cents bigint CHECK (minimum_volume_cents IS NULL OR minimum_volume_cents >= 0),
    currency char(3),
    contract_ref text,
    approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'expired', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_negotiated_rates_subject
    ON finance.negotiated_rates (subject_type, subject_id, status, ends_at);

ALTER TABLE finance.negotiated_rates ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE finance.negotiated_rates TO authenticated;
GRANT ALL ON TABLE finance.negotiated_rates TO service_role;

DROP POLICY IF EXISTS "View own negotiated rates" ON finance.negotiated_rates;
CREATE POLICY "View own negotiated rates" ON finance.negotiated_rates FOR
SELECT TO authenticated USING (finance.fn_owner_visible (subject_type, subject_id));
-- #endregion
