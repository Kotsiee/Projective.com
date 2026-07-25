-- ============================================================================================
-- 00001870_triggers_integrations.sql — integrations schema triggers (Category 1).
-- Runs after 00001500_functions_integrations.sql (a trigger needs its function to exist first).
-- ============================================================================================

-- #region updated_at touch
CREATE TRIGGER trg_user_connections_touch
    BEFORE UPDATE ON integrations.user_connections
    FOR EACH ROW EXECUTE FUNCTION integrations.fn_touch_updated_at ();

CREATE TRIGGER trg_connection_secrets_touch
    BEFORE UPDATE ON integrations.connection_secrets
    FOR EACH ROW EXECUTE FUNCTION integrations.fn_touch_updated_at ();

CREATE TRIGGER trg_connection_sync_state_touch
    BEFORE UPDATE ON integrations.connection_sync_state
    FOR EACH ROW EXECUTE FUNCTION integrations.fn_touch_updated_at ();

CREATE TRIGGER trg_webhook_subscriptions_touch
    BEFORE UPDATE ON integrations.webhook_subscriptions
    FOR EACH ROW EXECUTE FUNCTION integrations.fn_touch_updated_at ();

CREATE TRIGGER trg_plugins_touch
    BEFORE UPDATE ON integrations.plugins
    FOR EACH ROW EXECUTE FUNCTION integrations.fn_touch_updated_at ();

CREATE TRIGGER trg_plugin_installations_touch
    BEFORE UPDATE ON integrations.plugin_installations
    FOR EACH ROW EXECUTE FUNCTION integrations.fn_touch_updated_at ();
-- #endregion

-- #region install counter
CREATE TRIGGER trg_plugin_installations_recount
    AFTER INSERT OR UPDATE OF status OR DELETE ON integrations.plugin_installations
    FOR EACH ROW EXECUTE FUNCTION integrations.fn_recount_installs ();
-- #endregion
