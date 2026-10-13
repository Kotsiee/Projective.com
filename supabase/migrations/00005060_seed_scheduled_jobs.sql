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
