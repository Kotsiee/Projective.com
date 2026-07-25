-- ============================================================================
-- 00001800 triggers core search
-- Consolidated verbatim from: 0004_security_tables.sql, 0010_search_tables.sql, 0011_reviews_tables.sql, 0114_update_entity_project_counts.sql, 0217_search_engine_pgvector.sql
-- ============================================================================

CREATE TRIGGER trg_recalc_penalty_aggregates
AFTER INSERT OR UPDATE OR DELETE ON security.penalties
FOR EACH ROW EXECUTE FUNCTION security.fn_recalc_penalty_aggregates();

CREATE TRIGGER trg_sync_team_search AFTER INSERT OR UPDATE ON org.teams
FOR EACH ROW EXECUTE FUNCTION search.sync_team_to_index();

CREATE TRIGGER trg_sync_freelancer_search AFTER INSERT OR UPDATE ON org.freelancer_profiles
FOR EACH ROW EXECUTE FUNCTION search.sync_freelancer_to_index();

CREATE TRIGGER trg_sync_project_search AFTER INSERT OR UPDATE ON projects.projects
FOR EACH ROW EXECUTE FUNCTION search.sync_project_to_index();

CREATE TRIGGER trg_sync_user_search AFTER INSERT OR UPDATE ON org.users_public
FOR EACH ROW EXECUTE FUNCTION search.sync_user_to_index();

CREATE TRIGGER trg_sync_business_search AFTER INSERT OR UPDATE ON org.business_profiles
FOR EACH ROW EXECUTE FUNCTION search.sync_business_to_index();

CREATE TRIGGER trg_sync_service_search AFTER INSERT OR UPDATE ON marketplace.service_blueprints
FOR EACH ROW EXECUTE FUNCTION search.sync_service_to_index();

CREATE TRIGGER trg_update_ratings
AFTER INSERT OR UPDATE OR DELETE ON reviews.entity_reviews
FOR EACH ROW EXECUTE FUNCTION reviews.recalculate_entity_rating();

CREATE TRIGGER trg_update_project_counts
AFTER INSERT OR UPDATE OF status OR DELETE ON projects.projects
FOR EACH ROW EXECUTE FUNCTION projects.update_entity_project_counts();

CREATE TRIGGER trg_fill_embedding_profiles
  BEFORE INSERT OR UPDATE ON search.profiles_index
  FOR EACH ROW EXECUTE FUNCTION search.fn_fill_mock_embedding('display_name', 'entity_id');

CREATE TRIGGER trg_fill_embedding_projects
  BEFORE INSERT OR UPDATE ON search.projects_index
  FOR EACH ROW EXECUTE FUNCTION search.fn_fill_mock_embedding('title', 'project_id');

CREATE TRIGGER trg_fill_embedding_services
  BEFORE INSERT OR UPDATE ON search.services_index
  FOR EACH ROW EXECUTE FUNCTION search.fn_fill_mock_embedding('title', 'service_id');
