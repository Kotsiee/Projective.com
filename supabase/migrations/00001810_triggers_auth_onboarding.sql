-- ============================================================================
-- 00001810 triggers auth onboarding
-- Consolidated verbatim from: 0304_onboarding_session_and_audit.sql, 0312_email_verification_sync.sql, 20260722120000_seed_user_preferences.sql, 20260724091000_comms_notification_preferences.sql
-- ============================================================================

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_confirmed
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_email_confirmed();

CREATE TRIGGER on_users_public_created
AFTER INSERT ON org.users_public
FOR EACH ROW EXECUTE FUNCTION org.seed_user_preferences();

CREATE TRIGGER on_users_public_created_notification_prefs
    AFTER INSERT ON org.users_public
    FOR EACH ROW EXECUTE FUNCTION comms.seed_notification_prefs();
