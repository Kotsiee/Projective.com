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
    -- Non-secret mount config (S3 endpoint/bucket/prefix, Drive root). Safe to project precisely
    -- because credentials live in connection_secrets, which this view cannot reach.
    c.config,
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


-- --- search.platform_stats: the landing hero's proof points ---
--
-- The public landing page states what the marketplace has DONE — how many people are ready to hire,
-- how much work has been signed off, how much money has reached sellers. Those facts live in tables a
-- visitor may not read (`finance.payouts` is not even usable by `anon`), so this definer view answers
-- them as AGGREGATES only: four numbers and a currency, one row, nothing a visitor could use to find
-- or identify a single person, project or payout.
--
-- It replaces three figures the landing page used to hardcode ("$4.2M", "3,800+", "19k"), which were
-- claims about a marketplace that did not exist. A small real number is the honest one.
--
-- `paid_out_minor` sums payouts that actually settled, in the platform's base currency. A payout in
-- another currency is left out rather than converted at an arbitrary rate; the figure is labelled
-- with its currency so it is never read as a total of everything.
--
-- Placed in `search` because that schema is exposed to PostgREST and granted to `anon` for exactly
-- this kind of public, read-only projection.
CREATE OR REPLACE VIEW search.platform_stats AS
SELECT
    (SELECT COUNT(*)::int FROM org.profiles_index
      WHERE listed AND entity_type IN ('freelancer', 'team')) AS helpers,
    (SELECT COUNT(*)::int FROM projects.stage_assignments
      WHERE status = 'completed') AS stages_delivered,
    (SELECT COUNT(*)::int FROM projects.projects
      WHERE status IN ('active'::project_status, 'completed'::project_status)) AS projects_live,
    (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM finance.payouts
      WHERE status = 'paid'::finance.payout_status AND currency = 'USD') AS paid_out_minor,
    'USD'::text AS paid_out_currency;
