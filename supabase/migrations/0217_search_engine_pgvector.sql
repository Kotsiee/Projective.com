-- =============================================================================
-- 0213_search_engine_pgvector.sql
-- Unified Explore & Discovery Engine — pgvector + mock embeddings.
--
-- pgvector is already enabled and the three search index tables already carry a
-- `vector(1536)` column (matching OpenAI `text-embedding-3-small`). Real embedding
-- models are NOT yet integrated, so this migration installs a deterministic MOCK
-- embedding generator + BEFORE-write triggers that guarantee every synced/seeded
-- row has a valid, non-NULL vector. That keeps every pgvector operation (cosine
-- distance `<=>`, the HNSW index) fully functional end-to-end until we swap in a
-- production model (see the embedding-model recommendation block in
-- apps/web/routes/api/v1/public/search/index.ts).
-- =============================================================================

-- Idempotent: the extension already exists, but keep the guard for fresh installs.
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Deterministic mock embedding: a stable pseudo-random vector(1536) derived from
-- a text seed. Deterministic (IMMUTABLE) so the same entity/query always yields
-- the same vector — cosine distance is therefore stable and reproducible in tests.
-- Each component ∈ [-1, 1) via a 64-bit hash of (seed, dimension_index).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_mock_embedding(p_seed text)
RETURNS public.vector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT (
    '[' || string_agg(
      to_char(
        ((hashtextextended(coalesce(p_seed, 'discovery'), g) & 65535)::double precision / 32768.0) - 1.0,
        'FM990.000000'
      ),
      ','
    ) || ']'
  )::public.vector
  FROM generate_series(1, 1536) AS g;
$$;

COMMENT ON FUNCTION search.fn_mock_embedding(text) IS
  'Deterministic mock vector(1536) seeded from text. Placeholder until a real embedding model is wired in.';

-- -----------------------------------------------------------------------------
-- Generic BEFORE INSERT/UPDATE trigger that fills a NULL embedding using the
-- table''s text seed column. TG_ARGV[0]/[1] name the primary + fallback seed
-- columns; `to_jsonb(NEW) ->> col` avoids statically referencing columns that
-- don''t exist on every index table.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_fill_mock_embedding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_seed text;
BEGIN
  IF NEW.embedding IS NULL THEN
    v_seed := coalesce(v_row ->> TG_ARGV[0], v_row ->> TG_ARGV[1], gen_random_uuid()::text);
    NEW.embedding := search.fn_mock_embedding(v_seed);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_embedding_profiles ON search.profiles_index;
CREATE TRIGGER trg_fill_embedding_profiles
  BEFORE INSERT OR UPDATE ON search.profiles_index
  FOR EACH ROW EXECUTE FUNCTION search.fn_fill_mock_embedding('display_name', 'entity_id');

DROP TRIGGER IF EXISTS trg_fill_embedding_projects ON search.projects_index;
CREATE TRIGGER trg_fill_embedding_projects
  BEFORE INSERT OR UPDATE ON search.projects_index
  FOR EACH ROW EXECUTE FUNCTION search.fn_fill_mock_embedding('title', 'project_id');

DROP TRIGGER IF EXISTS trg_fill_embedding_services ON search.services_index;
CREATE TRIGGER trg_fill_embedding_services
  BEFORE INSERT OR UPDATE ON search.services_index
  FOR EACH ROW EXECUTE FUNCTION search.fn_fill_mock_embedding('title', 'service_id');

-- -----------------------------------------------------------------------------
-- Backfill any pre-existing rows that were synced before embeddings were mocked.
-- -----------------------------------------------------------------------------
UPDATE search.profiles_index
   SET embedding = search.fn_mock_embedding(coalesce(display_name, entity_id::text))
 WHERE embedding IS NULL;

UPDATE search.projects_index
   SET embedding = search.fn_mock_embedding(coalesce(title, project_id::text))
 WHERE embedding IS NULL;

UPDATE search.services_index
   SET embedding = search.fn_mock_embedding(coalesce(title, service_id::text))
 WHERE embedding IS NULL;

GRANT EXECUTE ON FUNCTION search.fn_mock_embedding(text) TO authenticated, service_role;
