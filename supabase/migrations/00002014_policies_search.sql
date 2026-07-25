-- =============================================================================
-- RLS POLICIES — search schema (discovery indexes & signals)
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0214_search.sql ---

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


-- --- from 0218_search_engine_signals.sql ---

CREATE POLICY "Public read talent signals" ON search.talent_signals
  FOR SELECT USING (true);

CREATE POLICY "Insert own interest events" ON search.interest_events
  FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Read own interest events" ON search.interest_events
  FOR SELECT USING (user_id = auth.uid());


-- --- from 0219_search_engine_weights.sql ---

CREATE POLICY "Admins read weights" ON search.search_weights
  FOR SELECT USING (search.is_admin());
