-- Seed: ops.scheduled_jobs — every recurring job the platform runs (Decision #203).
--
-- Inserting a row schedules it with pg_cron (ops.tg_scheduled_jobs_apply, 00001897). Where pg_cron is
-- missing, each row raises a WARNING and writes an ops.log_entries row instead of failing the
-- migration; run such a job by hand with `deno task cron:run <name>`.
--
-- THE CADENCE IS CONFIGURABLE HERE: `schedule` is a five-field cron expression in UTC. This file sets
-- the default on every reset; on a running database change it with
--   UPDATE ops.scheduled_jobs SET schedule = '30 * * * *' WHERE name = 'finance-recurring-deposits';
-- which reschedules the job in the same transaction (an invalid expression is refused), and pause one
-- with `SET enabled = false`. An http job's batch size is the `limit` in its `path`.
--
-- http jobs need two Vault secrets per environment, provisioned by hand and never committed:
-- CRON_APP_URL (the origin the database reaches the app on) and the row's secret_name, holding the
-- same value as the app's env key of that name. SYSTEM_ARCHITECTURE.md §Scheduled jobs.

INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
    ('finance-billing-cycle', 'sql', '20 2 * * *',
        'SELECT finance.fn_run_billing_cycle();', NULL, NULL,
        'Daily billing run: monthly business invoices on each billing day, last month''s wallet statements from the 1st, and the overdue sweep.'),
    ('archive-stale-service-drafts', 'sql', '10 3 * * *',
        'SELECT projects.fn_archive_stale_service_drafts();', NULL, NULL,
        'Soft-archives instantiated service drafts idle for service_draft_idle_days with no funded stage. The window is 30 days, so the hour only keeps it off the top of the hour.'),
    ('auto-release-session-escrow', 'sql', '*/15 * * * *',
        'SELECT finance.auto_release_session_escrow();', NULL, NULL,
        'Session negative-consent sweep: completes ended sittings, refunds provider no-shows, releases seat escrow after session_payout_hours.'),
    ('finance-dispute-sweep', 'sql', '7,22,37,52 * * * *',
        'SELECT finance.sweep_disputes();', NULL, NULL,
        'Dispute sweep (Decision #212): closes disputes whose escrow already settled, audits no-show claims once their sitting ends, and auto-escalates awaiting_response cases past respond_by to an auditor.'),
    ('finance-recurring-deposits', 'http', '15 * * * *',
        NULL, '/api/finance/cron/deposits?limit=50', 'FINANCE_CRON_SECRET',
        'Charges every due recurring deposit off-session through Stripe (PaymentBackendService.processDueDeposits).'),
    ('account-erasures', 'http', '10 4 * * *',
        NULL, '/api/user/cron/erasures?limit=100', 'ACCOUNT_CRON_SECRET',
        'Runs the account and freelancer-profile erasures that have come due (Decision #156).'),
    ('ops-watch-jobs', 'sql', '*/10 * * * *',
        'SELECT ops.fn_watch_jobs();', NULL, NULL,
        'Settles each HTTP dispatch from pg_net''s response and reports every failed pg_cron run, non-2xx, transport error or lost response as an error.')
ON CONFLICT (name) DO NOTHING;

-- The ledger reconciliation (M3, Decision #186) and the pending-window sweep (M4, Decision #191) are
-- registered only where their function exists, so this seed is correct whichever order those changes
-- reach a branch in, and pg_cron is never pointed at a function that is not there.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description)
SELECT v.name, 'sql', v.schedule, v.command, NULL, NULL, v.description
  FROM (VALUES
    ('finance-reconcile-wallets', '40 3 * * *', 'SELECT finance.fn_reconcile_wallets();',
        'finance.fn_reconcile_wallets()',
        'Ledger reconciliation after the billing run: logs every wallet whose cached balance drifted from its ledger (Decision #186).'),
    ('finance-mature-pending-releases', '5 * * * *', 'SELECT finance.fn_mature_pending_releases();',
        'finance.fn_mature_pending_releases(integer)',
        'Credits every pending release past its 7-day window to the available balance (Decision #191).')
  ) AS v (name, schedule, command, signature, description)
 WHERE pg_catalog.to_regprocedure(v.signature) IS NOT NULL
ON CONFLICT (name) DO NOTHING;

-- The stale-payout sweep (Decision #202) calls Stripe, so it is an http job on the deposits route's
-- secret. Registered only where its claim function exists, like the M3 / M4 sweeps above: the function
-- and `POST /api/finance/cron/payouts` land together, so pg_cron is never pointed at a 404.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description)
SELECT 'finance-sweep-stale-payouts', 'http', '*/10 * * * *', NULL, '/api/finance/cron/payouts?limit=50',
       'FINANCE_CRON_SECRET',
       'Reconciles withdrawals stuck in pending with Stripe: completes them from their transfer, re-sends under the same idempotency key, or returns the money (PaymentBackendService.sweepStalePayouts).'
 WHERE pg_catalog.to_regprocedure('finance.fn_claim_stale_payouts(integer)') IS NOT NULL
ON CONFLICT (name) DO NOTHING;

-- 1-1 sessions (Decision #211). The handshake sweep reminds a provider once, a day before their block's
-- earliest scheduling deadline, and lapses every set-session scheduling round still open at its
-- deadline, so the pencilled-in time stands. Offset from the quarter hours the escrow sweep runs on.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
    ('session-scheduling-handshakes', 'sql', '7,22,37,52 * * * *',
        'SELECT projects.fn_lapse_session_handshakes();', NULL, NULL,
        'Set-session scheduling handshakes: one reminder 24h before a booking''s earliest deadline, then each handshake still open at its deadline (set_session_schedule_hours) lapses — the pencilled-in sitting time stands and both people are told.')
ON CONFLICT (name) DO NOTHING;

-- Listing analytics (Decision #217). Writes yesterday's UTC listing rollups; a SQL job, so it needs no
-- secret. A late or missed run is repaired by `analytics.fn_backfill_listing_rollups`.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
    ('analytics-listing-rollups', 'sql', '10 2 * * *',
        'SELECT analytics.fn_rollup_listings(current_date - 1);', NULL, NULL,
        'Writes yesterday''s (UTC) listing analytics into analytics.daily_rollups: impressions, clicks, views, checkout starts, orders, gross per currency, bookings, the booking heatmap, keywords from 5+ sessions and cancellations (Decision #217).')
ON CONFLICT (name) DO NOTHING;

-- Availability presets (Decision #217 (d)). The TypeScript evaluator is the only thing that knows what
-- a rule means, so the nightly extension of each preset's 120-day occurrence horizon runs in the app:
-- an http job on its own secret. A preset that misses a night is still compiled 90 days ahead.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
    ('scheduling-availability-horizon', 'http', '5 3 * * *',
        NULL, '/api/scheduling/cron/horizon?limit=200', 'SCHEDULING_CRON_SECRET',
        'Recompiles every live availability preset not compiled, or compiled through an earlier date than today + 90 days, over today to today + 120 days (ScheduleBackendService.extendHorizons).')
ON CONFLICT (name) DO NOTHING;
