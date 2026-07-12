GRANT USAGE ON SCHEMA security TO authenticated;

GRANT USAGE ON SCHEMA security TO service_role;

GRANT
SELECT,
INSERT
,
UPDATE ON
TABLE security.session_context TO authenticated;

GRANT ALL ON TABLE security.session_context TO service_role;

ALTER TABLE security.session_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own session context" ON security.session_context;

CREATE POLICY "Users can view own session context" ON security.session_context FOR
SELECT TO authenticated USING (user_id = auth.uid ());

DROP POLICY IF EXISTS "Users can manage own session context" ON security.session_context;

CREATE POLICY "Users can manage own session context" ON security.session_context FOR ALL TO authenticated USING (user_id = auth.uid ())
WITH
    CHECK (user_id = auth.uid ());

-- #region Penalties & platform params
GRANT SELECT ON TABLE security.penalties TO authenticated;

GRANT ALL ON TABLE security.penalties TO service_role;

GRANT SELECT ON TABLE security.platform_params TO authenticated;

GRANT ALL ON TABLE security.platform_params TO service_role;

DROP POLICY IF EXISTS "View own penalties" ON security.penalties;

-- A subject sees its own penalties; admins see all. Writes are service/definer-only (no policy).
CREATE POLICY "View own penalties" ON security.penalties FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (subject_type IN ('freelancer', 'user') AND subject_id = auth.uid ())
        OR (subject_type = 'business' AND org.is_active_business_member (subject_id))
        OR (subject_type = 'team' AND org.is_active_team_member (subject_id))
    );

DROP POLICY IF EXISTS "Read platform params" ON security.platform_params;

CREATE POLICY "Read platform params" ON security.platform_params FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region Finance: escrow visibility (writes are SECURITY DEFINER only)
GRANT SELECT ON TABLE finance.escrows TO authenticated;

GRANT ALL ON TABLE finance.escrows TO service_role;

DROP POLICY IF EXISTS "View escrows" ON finance.escrows;

-- The payee (freelancer/team) and the payer business's active members can view an escrow.
CREATE POLICY "View escrows" ON finance.escrows FOR
SELECT TO authenticated USING (
        (payee_type = 'freelancer'::assignment_type AND payee_id = auth.uid ())
        OR (payee_type = 'team'::assignment_type AND org.is_active_team_member (payee_id))
        OR org.is_active_business_member (payer_business_id)
    );
-- #endregion