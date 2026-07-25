-- Indexes: search (from 0010, 0218)

CREATE INDEX idx_profiles_vector ON search.profiles_index USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_profiles_fts ON search.profiles_index USING GIN (fts);
CREATE INDEX idx_projects_vector ON search.projects_index USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_projects_fts ON search.projects_index USING GIN (fts);
CREATE INDEX idx_services_vector ON search.services_index USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_services_fts ON search.services_index USING GIN (fts);
CREATE INDEX idx_user_affinity ON search.user_affinity (user_id, affinity_score DESC);
CREATE INDEX idx_query_logs_string ON search.query_logs (search_query);

CREATE INDEX IF NOT EXISTS idx_interest_events_entity ON search.interest_events (entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_interest_events_user   ON search.interest_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interest_events_recent ON search.interest_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_logs_created ON search.query_logs (created_at DESC);
