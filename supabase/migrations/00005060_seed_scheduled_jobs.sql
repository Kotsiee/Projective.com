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

-- #region [contact] /contact attachments (Decision #276)
-- Unsent attachments do not linger: hourly, every contact upload older than six hours that no request
-- links is soft-deleted and its bytes deleted (ops.fn_claim_stale_contact_attachments, then the
-- Storage API — objects cannot be deleted from SQL), so an http job on its own secret.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
    ('contact-attachment-sweep', 'http', '25 * * * *',
        NULL, '/api/contact/cron/attachments?limit=100', 'CONTACT_CRON_SECRET',
        'Deletes /contact attachments nobody sent — older than 6 hours and linked to no request: soft-deletes each files.items row and removes its object (ContactBackendService.sweepAttachments).')
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region [comms] The notification engine (Q0.3: #343 D9, Decision #203 flag (a))
-- The cadences of database/comms/Functions.md §Scheduled jobs, moved onto minutes no job above uses.
-- The worker runs every minute so a T-5 reminder lands on time; each sweep is safe to repeat.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
    ('comms-process-queue', 'sql', '* * * * *',
        'SELECT comms.fn_process_queue(500);', NULL, NULL,
        'Turns every due comms.notification_queue promise (session T-60/T-15/T-5 reminders, basket nudges, ghosting timers) into a notification through fn_notify; overlapping ticks skip each other''s rows, and a row that fails three times is parked as failed.'),
    ('comms-escalate-unread', 'sql', '4-59/5 * * * *',
        'SELECT comms.fn_escalate_unread(500);', NULL, NULL,
        'Falls back to email, once, for each critical or high notification still unread past the user''s escalate_after window (within its first 24 hours).'),
    ('comms-digest-daily', 'sql', '2 * * * *',
        'SELECT comms.fn_build_digests(''daily'');', NULL, NULL,
        'Builds the daily digest for every user whose local clock is in their digest_hour; a second run in the hour adds nothing.'),
    ('comms-digest-weekly', 'sql', '8 * * * *',
        'SELECT comms.fn_build_digests(''weekly'');', NULL, NULL,
        'Builds the weekly digest, gated like the daily one and also on the user''s local digest weekday.'),
    ('comms-sweep-expired', 'sql', '35 * * * *',
        'SELECT comms.fn_sweep_expired();', NULL, NULL,
        'Archives (never deletes) every notification past its expires_at.'),
    ('comms-reap-devices', 'sql', '32 3 * * *',
        'SELECT comms.fn_reap_dead_devices();', NULL, NULL,
        'Soft-revokes each push device with 5 or more gateway failures or unseen for 180 days, and clears its keys.'),
    ('comms-compact-events', 'sql', '47 3 * * *',
        'SELECT comms.fn_compact_delivery_events();', NULL, NULL,
        'Empties the raw provider body of delivery callbacks older than 30 days; the row stays, as it is the idempotency key.')
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region [projects] Claim-TTL auto-release (Q0.3: #338 D1)
-- Registered PAUSED: as written the sweep takes no row lock and never re-checks `claimed`, so it can
-- reset a ticket whose work has started (#338 flag (a)). PM-WP1 hardens it (SKIP LOCKED, a `claimed`
-- re-check, a ticket_history row, notices to both sides) and turns it on here.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description, enabled) VALUES
    ('projects-release-expired-claims', 'sql', '3,18,33,48 * * * *',
        'SELECT projects.fn_release_expired_claims();', NULL, NULL,
        'Claim-TTL auto-release ("Ticket Parking"): a ticket claimed for longer than claim_ttl_minutes goes back to the backlog and its escrow is refunded to the client.',
        false)
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region [scheduling] Discovery-call expiry and vote settlement (Q0.3: #343 D9)
-- Neither function exists yet; the scheduling track writes them (S-11, S-13). Each job registers itself
-- on the first reset after its function lands, matched by name rather than signature so any argument
-- list with defaults counts.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description)
SELECT v.name, 'sql', v.schedule, v.command, NULL, NULL, v.description
  FROM (VALUES
    ('scheduling-expire-discovery-calls', '1,16,31,46 * * * *', 'SELECT scheduling.fn_expire_discovery_calls();',
        'scheduling.fn_expire_discovery_calls',
        'Expires every proposed discovery call past its proposal TTL (discovery_call_proposal_ttl_hours) or its proposed start, so a stale request stops holding free/busy (#343 D3).'),
    ('scheduling-settle-votes', '11,26,41,56 * * * *', 'SELECT scheduling.fn_settle_votes();',
        'scheduling.fn_settle_votes',
        'Settles every reschedule vote past its deadline (fn_vote_deadline), so the round closes and its notices go out without anyone opening the event.')
  ) AS v (name, schedule, command, function_name, description)
 WHERE pg_catalog.to_regproc(v.function_name) IS NOT NULL
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region [finance] Card-payment recovery, spend-approval expiry, idempotency keys (Q0.3: #337)
-- The N1 recovery sweep calls Stripe, so it is an http job on the deposits route's secret. Every 15
-- minutes matches the claim's grace, after which an unpaid payment is asked about again.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
    ('finance-sweep-card-payments', 'http', '13,28,43,58 * * * *',
        NULL, '/api/finance/cron/card-payments?limit=50', 'FINANCE_CRON_SECRET',
        'Credits card payments Stripe charged but the ledger never settled because every webhook delivery was lost: each payment unsettled 15 minutes after it last moved is looked up at Stripe, and a succeeded intent is settled through the webhook''s own door (PaymentBackendService.sweepUnsettledCardPayments).')
ON CONFLICT (name) DO NOTHING;

-- Neither function exists yet (FINANCE_BUILD_PROMPTS DB3 writes them); matched by name like the
-- scheduling sweeps above.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description)
SELECT v.name, 'sql', v.schedule, v.command, NULL, NULL, v.description
  FROM (VALUES
    ('finance-expire-spend-approvals', '12 * * * *', 'SELECT finance.fn_expire_spend_approvals();',
        'finance.fn_expire_spend_approvals',
        'Expires every pending spend approval past its 7-day expires_at, so a stale request stops waiting on an approver.'),
    ('finance-sweep-idempotency-keys', '27 4 * * *', 'SELECT finance.fn_sweep_idempotency_keys();',
        'finance.fn_sweep_idempotency_keys',
        'Deletes finance.idempotency_keys rows expired more than 30 days ago; Stripe webhook keys are kept for replay safety.')
  ) AS v (name, schedule, command, function_name, description)
 WHERE pg_catalog.to_regproc(v.function_name) IS NOT NULL
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region [search] Query-log retention (Q0.3; finance-model.md §17)
-- Query logs are kept 90 days, a security.platform_params dial per §17, so the job passes no period.
-- No function prunes them yet; matched by name like the sweeps above.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description)
SELECT 'search-query-log-retention', 'sql', '36 4 * * *', 'SELECT search.fn_prune_query_logs();', NULL, NULL,
       'Deletes search.query_logs rows past their 90-day retention (finance-model.md §17).'
 WHERE pg_catalog.to_regproc('search.fn_prune_query_logs') IS NOT NULL
ON CONFLICT (name) DO NOTHING;
-- #endregion

-- #region [ops] pg_cron run history
-- pg_cron keeps a row per run and never prunes it; with comms-process-queue every minute that is about
-- 2,000 rows a day. Daily, on a minute no other job uses.
INSERT INTO ops.scheduled_jobs (name, kind, schedule, command, path, secret_name, description) VALUES
    ('ops-prune-job-history', 'sql', '53 4 * * *',
        'SELECT ops.fn_prune_job_history();', NULL, NULL,
        'Deletes pg_cron run history (cron.job_run_details) older than 7 days; ops-watch-jobs has already reported every failed run in it.')
ON CONFLICT (name) DO NOTHING;
-- #endregion
