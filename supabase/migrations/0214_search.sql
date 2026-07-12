CREATE POLICY "Public can view profile search index" ON search.profiles_index FOR
SELECT TO public USING (is_active = true);

CREATE POLICY "Public can view project search index" ON search.projects_index FOR
SELECT TO public USING (is_active = true);

CREATE POLICY "Public can view service search index" ON search.services_index FOR
SELECT TO public USING (is_public = true);

CREATE POLICY "Users manage own affinity" ON search.user_affinity FOR ALL TO public USING (user_id = auth.uid ());

CREATE POLICY "Users view own query logs" ON search.query_logs FOR
SELECT TO public USING (user_id = auth.uid ());

CREATE POLICY "Users insert own query logs" ON search.query_logs FOR
INSERT
    TO public
WITH
    CHECK (
        user_id = auth.uid ()
        OR auth.uid () IS NULL
    );

ALTER FUNCTION search.sync_team_to_index() SECURITY DEFINER;

ALTER FUNCTION search.sync_freelancer_to_index() SECURITY DEFINER;

ALTER FUNCTION search.sync_user_to_index() SECURITY DEFINER;

ALTER FUNCTION search.sync_business_to_index() SECURITY DEFINER;

ALTER FUNCTION search.sync_project_to_index() SECURITY DEFINER;

ALTER FUNCTION search.sync_service_to_index() SECURITY DEFINER;