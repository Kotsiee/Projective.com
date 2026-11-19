-- Seed: ops.alert_rules — what the alert sweep watches (MR4, Decision #461).
--
-- Every rule is one channel: a scope that alerts is two rows, an incoming webhook and an email digest,
-- because two channels that fail apart mean one outage is not silence (#461 (A)). Adding a scope is a
-- row here, not code. On a running database a rule pauses with
--   UPDATE ops.alert_rules SET enabled = false WHERE scope_pattern = 'ops.scheduler';
--
--   finance.%                   every money error any door, sweep or check writes, at `error`: the
--                               reconciliation's drift, the conservation check's imbalance, a card
--                               settlement held for reconciliation, a refund the wallet could not cover,
--                               a lost dispute's note, a payout schedule or deposit rule that failed.
--                               A `metric` row (a balanced night, a heartbeat) never alerts. The same
--                               drift on the next night folds into the open alert; after 36 hours it
--                               alerts again.
--   ops.scheduler               a job that failed to schedule, dispatch, answer or run, at `error`
--                               (#461 flag (b)). The once-a-day configuration skips (`warn`: a missing
--                               bearer or app URL) stay out: every development database has them.
--   finance.reconcile_wallets   silent for 26 hours: the nightly reconciliation did not run.
--   finance.conservation        silent for 26 hours: the nightly conservation check did not run.

INSERT INTO ops.alert_rules (kind, scope_pattern, min_level, max_silence, channel, dedupe_window, description) VALUES
    ('level', 'finance.%', 'error', NULL, 'webhook', interval '36 hours',
        'Every money error, by webhook.'),
    ('level', 'finance.%', 'error', NULL, 'email', interval '36 hours',
        'Every money error, in the email digest.'),
    ('level', 'ops.scheduler', 'error', NULL, 'webhook', interval '24 hours',
        'A scheduled job that failed, by webhook.'),
    ('level', 'ops.scheduler', 'error', NULL, 'email', interval '24 hours',
        'A scheduled job that failed, in the email digest.'),
    ('silence', 'finance.reconcile_wallets', NULL, interval '26 hours', 'webhook', interval '24 hours',
        'The nightly ledger reconciliation has not run for 26 hours, by webhook.'),
    ('silence', 'finance.reconcile_wallets', NULL, interval '26 hours', 'email', interval '24 hours',
        'The nightly ledger reconciliation has not run for 26 hours, in the email digest.'),
    ('silence', 'finance.conservation', NULL, interval '26 hours', 'webhook', interval '24 hours',
        'The nightly conservation check has not run for 26 hours, by webhook.'),
    ('silence', 'finance.conservation', NULL, interval '26 hours', 'email', interval '24 hours',
        'The nightly conservation check has not run for 26 hours, in the email digest.')
ON CONFLICT ON CONSTRAINT alert_rules_unique DO NOTHING;
