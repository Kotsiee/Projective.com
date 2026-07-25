-- =============================================================================
-- RLS POLICIES — security & ops schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0205_security.sql ---

CREATE POLICY "Users can view own session context" ON security.session_context FOR
SELECT TO authenticated USING (user_id = auth.uid ());

CREATE POLICY "Users can manage own session context" ON security.session_context FOR ALL TO authenticated USING (user_id = auth.uid ())
WITH
    CHECK (user_id = auth.uid ());

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
