-- Seed: security.platform_params + security.feature_flags (config/reference)
-- Consolidated from 0004, 0310, 20260723090000/092000/093000/094000,
-- 20260724094000, 20260724104000, 20260724111000, 20260724113000.
-- All INSERT ... ON CONFLICT DO NOTHING with disjoint keys.

-- from 0004
INSERT INTO security.platform_params (key, value, description) VALUES
    ('workload_report_window_hours', '48'::jsonb,
        'Hours a ticket stays hidden after a workload-intensity report before the client is penalized.'),
    ('claim_ttl_minutes', '1440'::jsonb,
        'Minutes a claimed ticket may sit idle before auto-release to the backlog.'),
    ('session_payout_hours', '24'::jsonb,
        'Negative-consent window (hours) after a session completes before payout auto-releases.'),
    ('platform_fee_bp', '0'::jsonb,
        'Platform service fee in basis points. UNRESOLVED: finance-model.md=5% vs investor-summary.md=10%; set deliberately.'),
    ('freelancer_bad_faith_penalty', '0'::jsonb,
        'Discovery-rank penalty severity applied to a freelancer whose report is audited bad-faith.'),
    ('client_no_adjust_penalty', '0'::jsonb,
        'Trust-score penalty severity applied to a client who fails to adjust workload intensity in time.')
ON CONFLICT (key) DO NOTHING;

-- from 0310
INSERT INTO security.platform_params (key, value, description) VALUES
    ('global_workload_cap_default', '10.00'::jsonb,
        'Default global cap on a freelancer''s summed active-ticket Workload Intensity (W_i) when the profile has no per-user override.')
ON CONFLICT (key) DO NOTHING;

-- from 20260723090000
INSERT INTO security.platform_params (key, value, description) VALUES
    ('base_currency', '"GBP"'::jsonb,
        'The platform''s internal base/accounting currency (ISO-4217) for system accounts, fees, and cross-currency FX bridging. Stored amounts stay in their origin currency; this is only the accounting/settlement base.')
ON CONFLICT (key) DO NOTHING;

-- from 20260723092000
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

-- from 20260723093000
INSERT INTO security.platform_params (key, value, description) VALUES
    ('vault_approval_threshold_cents', '0'::jsonb,
        'Wallet spend amount (minor units) at or above which a second approver is required (in addition to per-member spending caps). Magnitude in finance-model.md §Vault Permissions, Caps & Approvals; default 0 = disabled.')
ON CONFLICT (key) DO NOTHING;

-- from 20260723094000
INSERT INTO security.platform_params (key, value, description) VALUES
    ('pending_release_days', '7'::jsonb,
        'Length (days) of the post-escrow-release safety window before funds become Available/withdrawable (finance-model.md §7 "Pending" state).')
ON CONFLICT (key) DO NOTHING;

-- from 20260724094000
INSERT INTO security.feature_flags (key, enabled, payload)
VALUES ('comms.dispatch_webhook', false, jsonb_build_object(
    'description', 'When enabled, a comms.notifications INSERT calls the dispatch Edge Function via pg_net for push/email/SMS fan-out.'
))
ON CONFLICT (key) DO NOTHING;

INSERT INTO security.platform_params (key, value, description)
VALUES (
    'comms_dispatch_url',
    to_jsonb('XXXX-XXXX'::text),
    'Edge Function URL for notification dispatch (push/email/SMS). Placeholder — set per environment; never commit a real URL or key.'
)
ON CONFLICT (key) DO NOTHING;

-- from 20260724104000
INSERT INTO
    security.platform_params (key, value, description)
VALUES (
        'discovery_call_cancellation_window_hours',
        '24'::jsonb,
        'Hours before a confirmed discovery call inside which a cancellation is flagged is_late_cancel. A COURTESY call carries no financial consequence for a late cancel — it is a reliability signal only. Whether a PAID late cancel forfeits 50% (finance-model.md §4) or in full (PRODUCT_SPEC.md §Sessions) is the pre-existing logged conflict; PRODUCT_SPEC wins per the hierarchy and the outcome is recorded per-call, never hard-coded here.'
    ),
    (
        'discovery_call_default_buffer_minutes',
        '10'::jsonb,
        'Default dead time reserved after a discovery call when a provider has not set their own buffer. The burnout guard.'
    ),
    (
        'discovery_call_max_duration_minutes',
        '240'::jsonb,
        'Hard ceiling on any single discovery call, courtesy or paid.'
    ),
    (
        'discovery_call_reminder_lead_minutes',
        '60'::jsonb,
        'How far ahead of a confirmed call the reminder notification is dispatched.'
    ),
    (
        'discovery_call_proposal_ttl_hours',
        '72'::jsonb,
        'Hours a proposed (unanswered) discovery call stays live before it is swept to expired.'
    ) ON CONFLICT (key) DO NOTHING;

-- from 20260724111000
INSERT INTO security.platform_params (key, value, description) VALUES
    ('standing_recompute_interval_hours', '24'::jsonb,
        'How often the Standing sweep re-derives org.entity_standing from its metric inputs.'),
    ('standing_demotion_grace_days', '30'::jsonb,
        'Grace window before a score drop is allowed to demote a subject a rung (prevents rung flapping).')
ON CONFLICT (key) DO NOTHING;

-- from 20260724113000
INSERT INTO security.platform_params (key, value, description) VALUES
    ('proposal_allowance_enforced', 'false'::jsonb,
        'When false the proposal allowance is METERED but never blocks (fail-open). Flip to true only after the caps have been tuned against analytics.events.'),
    ('footprint_caps_enforced', 'false'::jsonb,
        'When false active-public-project caps are METERED but never block (fail-open). Same tuning discipline as proposal_allowance_enforced.'),
    ('proposal_buffer_window_hours', '10'::jsonb,
        'Rolling window over which buffered proposals are replenished (the "3 per 10 hours" drip).'),
    ('proposal_buffer_hold_multiple', '4'::jsonb,
        'Buffer hold cap as a multiple of the per-window drip — how many proposals may be banked for a burst.'),
    ('subscription_grace_days', '7'::jsonb,
        'Days a past_due subscription retains its paid entitlements before falling back to the free plan.')
ON CONFLICT (key) DO NOTHING;
