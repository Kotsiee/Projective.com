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

-- Decision #179: products and articles, public once their source is published.
CREATE POLICY "Public can view catalogue search index" ON search.catalogue_index FOR
SELECT TO public USING (is_public = true);

CREATE POLICY "Users manage own affinity" ON search.user_affinity FOR ALL TO public USING (user_id = auth.uid ());

CREATE POLICY "Users view own query logs" ON search.query_logs FOR
SELECT TO public USING (user_id = auth.uid ());

-- No INSERT policy on search.query_logs: its one writer is the search.fn_log_query definer, which
-- attributes the row to auth.uid() itself, and no client role holds INSERT (00002520).


-- --- from 0218_search_engine_signals.sql ---

CREATE POLICY "Public read talent signals" ON search.talent_signals
  FOR SELECT USING (true);

CREATE POLICY "Insert own interest events" ON search.interest_events
  FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Read own interest events" ON search.interest_events
  FOR SELECT USING (user_id = auth.uid());


-- --- from 0219_search_engine_weights.sql ---

-- security.is_admin() reads only auth.uid(). search.is_admin(uuid) answers for any id and no client
-- role may execute it (PRD-C6), so a policy that called it would refuse every guest read with 42501.
CREATE POLICY "Admins read weights" ON search.search_weights
  FOR SELECT USING (security.is_admin());
