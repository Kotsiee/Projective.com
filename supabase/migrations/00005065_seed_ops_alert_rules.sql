-- Seed: ops.alert_rules — what the alert sweep watches (MR4, Decision #461; OPS5).
--
-- Every rule is one channel: a scope that alerts is a row per channel. An incoming webhook and an email
-- digest fail apart, so one outage is not silence (#461 (A)); the third channel is an in-app notice to
-- every operator (OPS5 step 6). Adding a scope is a row here, not code. On a running database a rule
-- pauses with
--   UPDATE ops.alert_rules SET enabled = false WHERE scope_pattern = 'ops.scheduler';
--
-- A `level` rule takes every row at its `min_level` or above, and one scope has one rule per channel,
-- so a scope whose levels need different repeat rates gets them from its writer: the scheduler logs a
-- configuration skip once a day, the staleness pass a stale job once a day, the webhook pass a signature
-- burst once a day and a failure burst once an hour.
--
--   finance.%                   every money error any door, sweep or check writes, at `error`: the
--                               reconciliation's drift, the conservation check's imbalance, a card
--                               settlement held for reconciliation, a refund the wallet could not cover,
--                               a lost dispute's note, a payout schedule or deposit rule that failed.
--                               A `metric` row (a balanced night, a heartbeat) never alerts. The same
--                               drift on the next night folds into the open alert; after 36 hours it
--                               alerts again.
--   ops.scheduler               every scheduler row at `warn` or above, again after an hour: a job that
--                               failed to schedule, dispatch, answer or run, or has stopped succeeding
--                               (`stale`), at `error`; a configuration skip (a missing bearer or app
--                               URL, a schedule the staleness check cannot read) at `warn`, written at
--                               most once a day, so it alerts at most daily. On a development database
--                               with no channel set these simply wait.
--   ops.webhooks                a provider's webhook failing (`failing`, `error`, at most hourly) on
--                               every channel; a burst of signature refusals (`signature`, `warn`, at
--                               most daily) by webhook only. No rule matches the raw `webhook.<provider>`
--                               rows, so one failure never alerts by itself.
--   finance.reconcile_wallets   silent for 26 hours: the nightly reconciliation did not run.
--   finance.conservation        silent for 26 hours: the nightly conservation check did not run.
--   test                        the drill (`ops.fn_raise_alert`, OPS7), on every channel, again after 5
--                               minutes.

INSERT INTO ops.alert_rules (kind, scope_pattern, min_level, max_silence, channel, dedupe_window, description) VALUES
    ('level', 'finance.%', 'error', NULL, 'webhook', interval '36 hours',
        'Every money error, by webhook.'),
    ('level', 'finance.%', 'error', NULL, 'email', interval '36 hours',
        'Every money error, in the email digest.'),
    ('level', 'finance.%', 'error', NULL, 'in_app', interval '36 hours',
        'Every money error, as a notice to every operator.'),
    ('level', 'ops.scheduler', 'warn', NULL, 'webhook', interval '1 hour',
        'A scheduled job that failed, stopped succeeding or is misconfigured, by webhook.'),
    ('level', 'ops.scheduler', 'warn', NULL, 'email', interval '1 hour',
        'A scheduled job that failed, stopped succeeding or is misconfigured, in the email digest.'),
    ('level', 'ops.scheduler', 'warn', NULL, 'in_app', interval '1 hour',
        'A scheduled job that failed, stopped succeeding or is misconfigured, as a notice to every operator.'),
    ('level', 'ops.webhooks', 'warn', NULL, 'webhook', interval '1 hour',
        'A provider''s webhook failing, or a burst of signature refusals, by webhook.'),
    ('level', 'ops.webhooks', 'error', NULL, 'email', interval '1 hour',
        'A provider''s webhook failing, in the email digest.'),
    ('level', 'ops.webhooks', 'error', NULL, 'in_app', interval '1 hour',
        'A provider''s webhook failing, as a notice to every operator.'),
    ('silence', 'finance.reconcile_wallets', NULL, interval '26 hours', 'webhook', interval '24 hours',
        'The nightly ledger reconciliation has not run for 26 hours, by webhook.'),
    ('silence', 'finance.reconcile_wallets', NULL, interval '26 hours', 'email', interval '24 hours',
        'The nightly ledger reconciliation has not run for 26 hours, in the email digest.'),
    ('silence', 'finance.reconcile_wallets', NULL, interval '26 hours', 'in_app', interval '24 hours',
        'The nightly ledger reconciliation has not run for 26 hours, as a notice to every operator.'),
    ('silence', 'finance.conservation', NULL, interval '26 hours', 'webhook', interval '24 hours',
        'The nightly conservation check has not run for 26 hours, by webhook.'),
    ('silence', 'finance.conservation', NULL, interval '26 hours', 'email', interval '24 hours',
        'The nightly conservation check has not run for 26 hours, in the email digest.'),
    ('silence', 'finance.conservation', NULL, interval '26 hours', 'in_app', interval '24 hours',
        'The nightly conservation check has not run for 26 hours, as a notice to every operator.'),
    ('level', 'test', 'warn', NULL, 'webhook', interval '5 minutes',
        'An alert drill (ops.fn_raise_alert), by webhook.'),
    ('level', 'test', 'warn', NULL, 'email', interval '5 minutes',
        'An alert drill (ops.fn_raise_alert), in the email digest.'),
    ('level', 'test', 'warn', NULL, 'in_app', interval '5 minutes',
        'An alert drill (ops.fn_raise_alert), as a notice to every operator.')
ON CONFLICT ON CONSTRAINT alert_rules_unique DO NOTHING;
