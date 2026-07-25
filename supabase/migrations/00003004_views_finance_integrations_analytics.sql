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

-- The ONLY connection shape a client sees: a definer view (runs as owner, reads the un-policied
-- base table) filtered to the caller. It cannot project a token — the token vault
-- (integrations.connection_secrets) is a separate table this view never joins.
CREATE OR REPLACE VIEW
    integrations.v_my_connections AS
SELECT
    c.id,
    c.user_id,
    c.provider_slug,
    p.label AS provider_label,
    p.category AS provider_category,
    p.capabilities AS provider_capabilities,
    c.status,
    c.granted_kinds,
    c.granted_scopes,
    c.sync_direction,
    c.external_account_id,
    c.external_account_label,
    c.token_expires_at,
    c.last_synced_at,
    c.last_error,
    c.error_count,
    c.connected_at,
    c.revoked_at,
    c.created_at,
    c.updated_at
FROM
    integrations.user_connections c
    JOIN integrations.providers p ON p.slug = c.provider_slug
WHERE
    c.user_id = auth.uid ();

-- The public plugin marketplace listing: each PUBLISHED plugin joined to its latest published
-- version (replaces a stored latest_version_id back-pointer, which would be a circular FK). A
-- DEFINER view (like v_my_connections) with an explicit published-only filter, so it is safe to
-- expose to anon without granting the base tables — a publisher sees their own drafts via the base
-- table (their RLS grant), not this public catalogue.
CREATE OR REPLACE VIEW
    integrations.v_plugin_catalog
    WITH (security_invoker = false) AS
SELECT
    p.id,
    p.slug,
    p.name,
    p.tagline,
    p.description,
    p.developer_name,
    p.category,
    p.runtime,
    p.icon_url,
    p.homepage_url,
    p.repo_url,
    p.status,
    p.is_verified,
    p.install_count,
    v.id AS latest_version_id,
    v.semver AS latest_semver,
    v.requested_scopes AS latest_requested_scopes,
    v.published_at AS latest_published_at
FROM
    integrations.plugins p
    LEFT JOIN LATERAL (
        SELECT pv.*
        FROM integrations.plugin_versions pv
        WHERE pv.plugin_id = p.id
          AND pv.status = 'published'::integrations.plugin_version_status
        ORDER BY pv.published_at DESC NULLS LAST
        LIMIT 1
    ) v ON true
WHERE
    p.status = 'published'::integrations.plugin_status;

CREATE OR REPLACE VIEW analytics.v_unregistered_events AS
SELECT e.name, e.domain, count(*) AS occurrences, max(e.occurred_at) AS last_seen
FROM analytics.events e
LEFT JOIN analytics.event_catalogue c ON c.name = e.name
WHERE c.name IS NULL
GROUP BY e.name, e.domain;
