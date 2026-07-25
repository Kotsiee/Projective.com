-- =============================================================================================
-- 00003005_permissions_view_grants.sql — GRANTs on VIEWS (Category 3, trailing).
--
-- A GRANT on a view can only run AFTER the view exists (Category 3: Views), so these cannot live in
-- the Category-2 table-grants file (00002520_permissions_table_grants.sql), which runs first — doing
-- so raises `relation "…" does not exist`. Table / sequence grants stay in Category 2; grants on
-- views trail their definitions here. (Root CLAUDE.md §1: view grants are the one permission class
-- that must follow Category 3, not precede it.)
-- =============================================================================================

-- #region comms
GRANT SELECT ON comms.message_file_details TO authenticated;
GRANT SELECT ON comms.message_file_details TO service_role;

GRANT SELECT ON comms.notification_feed TO authenticated;
GRANT SELECT ON comms.notification_unread_counts TO authenticated;
GRANT SELECT ON comms.notification_delivery_health TO authenticated;
-- #endregion

-- #region org
GRANT SELECT ON org.view_business_staff TO authenticated;
-- #endregion

-- #region integrations
-- v_my_connections is the column-safe read over the definer-only integrations.user_connections;
-- exposing the view (not the base table) is how token columns stay structurally unreachable.
GRANT SELECT ON integrations.v_my_connections TO authenticated;
-- v_plugin_catalog is security_invoker, so the plugins/plugin_versions RLS still gates it.
GRANT SELECT ON integrations.v_plugin_catalog TO anon,
authenticated;
-- #endregion

-- #region finance
-- SECURITY INVOKER view over finance.wallets/transactions (no RLS policy = definer-only), reachable
-- only via a SECURITY DEFINER wrapper / service-role — matching the hidden-ledger posture. Exposed to
-- service_role for the reconciliation job / admin tooling.
GRANT SELECT ON finance.v_wallet_reconciliation TO service_role;
-- #endregion

-- #region analytics
GRANT SELECT ON analytics.v_unregistered_events TO service_role;
-- #endregion
