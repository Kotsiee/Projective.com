-- Indexes: integrations (from 20260724101000)

CREATE INDEX IF NOT EXISTS idx_user_connections_user ON integrations.user_connections (user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_connections_provider ON integrations.user_connections (provider_slug, status);
CREATE INDEX IF NOT EXISTS idx_connection_audit_user ON integrations.connection_audit (user_id, created_at DESC);
