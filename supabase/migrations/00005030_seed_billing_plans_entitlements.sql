-- Seed: finance billing plans, entitlement matrix, standing commission tiers
-- (from 20260724112000). Plans MUST precede plan_entitlements (resolved by plan code);
-- standing_commission_tiers FKs org.standing_levels(level) (seeded in 00005020).

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

INSERT INTO finance.standing_commission_tiers (level, marketplace_commission_bp, platform_fee_bp, note) VALUES
    (1, 800, NULL, 'Base marketplace commission — 8%, comparable to Etsy (finance-model.md §1.2).'),
    (2, 800, NULL, 'Held at base while a track record forms.'),
    (3, 750, NULL, '7.5% — the taper begins at Trusted.'),
    (4, 700, NULL, '7%.'),
    (5, 650, NULL, '6.5% — the lowest rate on the platform, earned and never purchasable.')
ON CONFLICT (level) DO NOTHING;
