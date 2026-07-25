-- Indexes: integrations (connectors + plugin ecosystem)

-- #region connectors
CREATE INDEX IF NOT EXISTS idx_user_connections_user ON integrations.user_connections (user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_connections_provider ON integrations.user_connections (provider_slug, status);
-- The refresh scheduler sweeps active connections whose token expires soon.
CREATE INDEX IF NOT EXISTS idx_user_connections_expiry ON integrations.user_connections (token_expires_at)
    WHERE status = 'active'::integrations.connection_status;

CREATE INDEX IF NOT EXISTS idx_connection_sync_state_conn ON integrations.connection_sync_state (connection_id);

-- The webhook-renewal cron sweeps channels nearing expiry.
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_expiry ON integrations.webhook_subscriptions (expires_at)
    WHERE status IN ('active'::integrations.webhook_status, 'expiring'::integrations.webhook_status);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_conn ON integrations.webhook_subscriptions (connection_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON integrations.webhook_deliveries (subscription_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_audit_user ON integrations.connection_audit (user_id, created_at DESC);
-- #endregion

-- #region plugin ecosystem
CREATE INDEX IF NOT EXISTS idx_plugins_status ON integrations.plugins (status, category);
CREATE INDEX IF NOT EXISTS idx_plugins_developer ON integrations.plugins (developer_user_id);
CREATE INDEX IF NOT EXISTS idx_plugin_versions_plugin ON integrations.plugin_versions (plugin_id, status);
CREATE INDEX IF NOT EXISTS idx_plugin_installations_user ON integrations.plugin_installations (installer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_plugin_installations_plugin ON integrations.plugin_installations (plugin_id, status);
CREATE INDEX IF NOT EXISTS idx_plugin_grants_install ON integrations.plugin_grants (installation_id);
CREATE INDEX IF NOT EXISTS idx_plugin_audit_user ON integrations.plugin_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plugin_audit_plugin ON integrations.plugin_audit (plugin_id, created_at DESC);
-- #endregion
