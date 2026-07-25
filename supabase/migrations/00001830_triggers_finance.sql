-- ============================================================================
-- 00001830 triggers finance
-- Consolidated verbatim from: 0309_business_finance_overview.sql, 20260724112000_billing_plans_entitlements.sql
-- ============================================================================

CREATE TRIGGER trg_seed_business_wallet
AFTER INSERT ON finance.wallets
FOR EACH ROW EXECUTE FUNCTION finance.fn_seed_business_wallet();

CREATE TRIGGER trg_sync_legacy_subscription_columns
    BEFORE INSERT OR UPDATE ON finance.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION finance.fn_sync_legacy_subscription_columns ();
