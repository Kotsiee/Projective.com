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
    ('seat_hold_minutes', '15'::jsonb,
        'Minutes a reserved cohort seat is held for its buyer while they pay (projects.reserve_seat, Decision #171).'),
    ('session_join_lead_minutes', '10'::jsonb,
        'Minutes before a sitting starts that its join link opens (projects.session_join_link).'),
    ('session_presence_minutes', '15'::jsonb,
        'The presence window: provider and attendee must join within this many minutes of the start for a sitting to count as successful (PRODUCT_SPEC §Session-Based B).'),
    ('session_cancel_notice_hours', '24'::jsonb,
        'An attendee who cancels a seat less than this many hours before the cohort''s first sitting forfeits it to the provider; earlier is a full refund (PRODUCT_SPEC §Session-Based C).'),
    ('platform_fee_bp', '500'::jsonb,
        'Platform service fee in basis points: 5% (root CLAUDE.md §8 Decision #2 — finance-model.md is canonical; Stripe processing fees are passed through separately). An admin-approved finance.negotiated_rates row may override it per payer (finance.fn_effective_platform_fee_bp).'),
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

-- Business billing (PRODUCT_SPEC §Escrow, Wallets & Finance #4; finance-model.md §15; Decision #172)
INSERT INTO security.platform_params (key, value, description) VALUES
    ('invoice_due_days', '14'::jsonb,
        'Days after issue a consolidated business invoice is due (finance.fn_generate_consolidated_invoice). finance-model.md §15.'),
    ('on_account_limit_cents', '2500000'::jsonb,
        'Most a business may owe on account at once, per currency, in that currency''s minor units (finance.place_on_account_order). Product-owner figure 25,000.00 (2026-10-10). finance-model.md §15.')
ON CONFLICT (key) DO NOTHING;

-- from 20260723094000
INSERT INTO security.platform_params (key, value, description) VALUES
    ('pending_release_days', '7'::jsonb,
        'Length (days) of the post-escrow-release safety window before funds become Available/withdrawable (finance-model.md §7 "Pending" state).')
ON CONFLICT (key) DO NOTHING;

-- Withdrawals (Decision #202). The minimum is per currency, in each currency's own minor units (JPY has
-- none), so one flat figure would be a floor of ₹10 in INR and ¥10 in JPY; each is roughly £10.
INSERT INTO security.platform_params (key, value, description) VALUES
    ('min_withdrawal_minor',
        '{"default": 1000, "GBP": 1000, "USD": 1000, "EUR": 1000, "CHF": 1000, "CAD": 1500, "AUD": 2000, "SGD": 1500, "JPY": 2000, "INR": 100000, "ZAR": 20000, "NGN": 2000000, "AED": 4500}'::jsonb,
        'Smallest withdrawal (finance.begin_payout), per currency in that currency''s minor units, with a "default" for any currency not listed. finance-model.md §13.'),
    ('payout_stale_minutes', '15'::jsonb,
        'Minutes a withdrawal may sit pending (its transfer''s answer lost) before the stale-payout sweep reconciles it with Stripe (finance.fn_claim_stale_payouts); also the lease between two sweeps of one payout. finance-model.md §13.')
ON CONFLICT (key) DO NOTHING;

-- Stripe fiat rails (Decision #125)
INSERT INTO security.platform_params (key, value, description) VALUES
    ('identity_sessions_per_day', '5'::jsonb,
        'How many Stripe Identity checks one freelancer may START in any 24 hours (finance.begin_identity_verification). Every check is billed by the processor, so the ceiling lives in the database rather than in a per-process limiter.')
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

-- files: the storage quota gate (00001160 files.fn_check_storage_quota).
--
-- ⚠️ SEEDED FALSE, DELIBERATELY, and FLIPPING IT IS A HUMAN DECISION — never a side effect of
-- running a migration. It is the third member of the fail-open enforcement family
-- (`proposal_allowance_enforced`, `footprint_caps_enforced`) and follows the same discipline: while
-- false, an upload that would exceed the plan's `storage_megabytes` entitlement is allowed through
-- untouched. Turning it on starts REFUSING uploads on a live tenant, which is a visible product
-- behaviour change and needs the ladder tuned against real usage first.
--
-- It also carries the same known limit the other two do (Decision #58): once enforcement is on, the
-- RAISE aborts the transaction, which would roll back any denial telemetry written moments earlier
-- in the same statement — so a denial under active enforcement must be recorded by the APP layer
-- catching the `check_violation`, not by the trigger.
INSERT INTO security.platform_params (key, value, description) VALUES
    ('storage_quota_enforced', 'false'::jsonb,
        'When false, storage quota is NOT enforced — files.fn_check_storage_quota returns without raising and every upload is allowed (fail-open). Flip to true only after the storage_megabytes ladder has been tuned against real usage; it is a deliberate human decision that starts refusing uploads.')
ON CONFLICT (key) DO NOTHING;

-- finance: the developer wallet simulator gate (00001210 finance.simulate_wallet_transaction).
--
-- ⚠️ SEEDED FALSE, and unlike its three siblings above this one FAILS CLOSED: while it is false the
-- simulator raises `42501` on every call and no balance can move. Turning it on hands every
-- authenticated user a function that writes real finance.wallets balances and real
-- finance.transactions lines on the wallets they control. It exists to make the ledger debuggable,
-- not to be left on — it is a deliberate, reversible human decision requiring sign-off, never a
-- side effect of running a migration, and it should be false in any environment holding real money.
--
-- Simulated movements are always identifiable after the fact (`transactions.reason` =
-- 'simulated_<type>', `ref_table` = 'simulation', plus a finance.ledger_audit row per wallet), so
-- an environment where it was switched on can be audited rather than merely suspected.
INSERT INTO security.platform_params (key, value, description) VALUES
    ('finance_simulation_enabled', 'false'::jsonb,
        'When false (the default), finance.simulate_wallet_transaction refuses every call. When true it lets an authenticated caller move REAL balances between wallets they control, for ledger debugging. Fail-closed; flipping it is a human decision and must stay false wherever real money is held.')
ON CONFLICT (key) DO NOTHING;


-- from the service-booking pass (Add to Projects / the 30-day draft sweep)
INSERT INTO security.platform_params (key, value, description) VALUES
    ('service_draft_idle_days', '30'::jsonb,
        'Days of inactivity before an un-funded instantiated pipeline draft is soft-archived by projects.fn_archive_stale_service_drafts. Mirrored by DRAFT_IDLE_DAYS in @projective/types/services, which the interface reads to tell the buyer when their draft expires — the two must agree.')
ON CONFLICT (key) DO NOTHING;
