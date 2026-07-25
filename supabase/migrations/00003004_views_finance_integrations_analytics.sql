-- Views: finance reconciliation + integrations connections + analytics drift
-- (from 20260723094000, 20260724101000, 20260724110000)

CREATE OR REPLACE VIEW finance.v_wallet_reconciliation AS
SELECT
    w.id AS wallet_id,
    w.owner_type,
    w.owner_id,
    w.currency,
    w.balance_cents,
    COALESCE(SUM(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0) AS ledger_sum_cents,
    w.balance_cents - COALESCE(SUM(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0) AS drift_cents
FROM finance.wallets w
LEFT JOIN finance.transactions t ON t.wallet_id = w.id
GROUP BY w.id, w.owner_type, w.owner_id, w.currency, w.balance_cents;

CREATE OR REPLACE VIEW
    integrations.v_my_connections AS
SELECT
    c.id,
    c.user_id,
    c.provider_slug,
    p.label AS provider_label,
    p.capabilities AS provider_capabilities,
    c.status,
    c.granted_kinds,
    c.granted_scopes,
    c.external_account_label,
    c.token_expires_at,
    c.last_synced_at,
    c.last_error,
    c.revoked_at,
    c.created_at,
    c.updated_at
FROM
    integrations.user_connections c
    JOIN integrations.providers p ON p.slug = c.provider_slug
WHERE
    c.user_id = auth.uid ();

CREATE OR REPLACE VIEW analytics.v_unregistered_events AS
SELECT e.name, e.domain, count(*) AS occurrences, max(e.occurred_at) AS last_seen
FROM analytics.events e
LEFT JOIN analytics.event_catalogue c ON c.name = e.name
WHERE c.name IS NULL
GROUP BY e.name, e.domain;
