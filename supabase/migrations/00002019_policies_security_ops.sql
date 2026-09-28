-- =============================================================================
-- RLS POLICIES — security & ops schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0205_security.sql ---

CREATE POLICY "Users can view own session context" ON security.session_context FOR
SELECT TO authenticated USING (user_id = auth.uid ());

-- NO client write policy (2026-09-28). The acting context is written only by the security.switch_*
-- definers (00001001), each of which re-checks the membership it names. The FOR ALL policy this
-- replaces let any user write `active_team_id` / `active_profile_id` to ANY entity over PostgREST, and
-- the access-token hook then stamped that forged context into their JWT for RLS to trust.

-- A subject sees its own penalties; admins see all. Writes are service/definer-only (no policy).
CREATE POLICY "View own penalties" ON security.penalties FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (subject_type IN ('freelancer', 'user') AND subject_id = auth.uid ())
        OR (subject_type = 'business' AND org.is_active_business_member (subject_id))
        OR (subject_type = 'team' AND org.is_active_team_member (subject_id))
    );

CREATE POLICY "Read platform params" ON security.platform_params FOR
SELECT TO authenticated USING (true);
