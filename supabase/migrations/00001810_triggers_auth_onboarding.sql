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

-- An enterprise owner gets no org.users_public row; the owner membership seeds their preferences
-- (Decision #207).
CREATE TRIGGER on_enterprise_owner_created
    AFTER INSERT ON org.enterprise_members
    FOR EACH ROW
    WHEN (NEW.role = 'owner')
    EXECUTE FUNCTION org.seed_owner_preferences();

-- #region Age guardrails (Decision #190)
CREATE TRIGGER trg_users_public_dob_guard
    BEFORE INSERT OR UPDATE OF dob ON org.users_public
    FOR EACH ROW EXECUTE FUNCTION org.trg_users_public_dob_guard();

CREATE TRIGGER trg_users_public_minor_visibility
    BEFORE INSERT OR UPDATE OF visibility ON org.users_public
    FOR EACH ROW EXECUTE FUNCTION org.trg_users_public_minor_visibility();

CREATE TRIGGER trg_listings_publish_age_gate
    BEFORE INSERT OR UPDATE OF status ON catalogue.listings
    FOR EACH ROW EXECUTE FUNCTION catalogue.trg_listings_publish_age_gate();

CREATE TRIGGER trg_workspace_member_adult BEFORE INSERT OR UPDATE OF user_id ON org.team_members
    FOR EACH ROW EXECUTE FUNCTION org.trg_workspace_member_adult('user_id');
CREATE TRIGGER trg_workspace_member_adult BEFORE INSERT OR UPDATE OF user_id ON org.business_members
    FOR EACH ROW EXECUTE FUNCTION org.trg_workspace_member_adult('user_id');
CREATE TRIGGER trg_workspace_member_adult BEFORE INSERT OR UPDATE OF user_id ON org.enterprise_members
    FOR EACH ROW EXECUTE FUNCTION org.trg_workspace_member_adult('user_id');
CREATE TRIGGER trg_workspace_member_adult BEFORE INSERT OR UPDATE OF target_user_id ON org.org_invitations
    FOR EACH ROW EXECUTE FUNCTION org.trg_workspace_member_adult('target_user_id');
-- Asking through an invite link is a way in too (Decision #318).
CREATE TRIGGER trg_workspace_member_adult BEFORE INSERT OR UPDATE OF requester_user_id ON org.org_join_requests
    FOR EACH ROW EXECUTE FUNCTION org.trg_workspace_member_adult('requester_user_id');
-- #endregion
