CREATE EXTENSION IF NOT EXISTS vector;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE search.profile_entity_type AS ENUM ('user', 'freelancer', 'business', 'team');


CREATE TABLE search.profiles_index (
    entity_id uuid NOT NULL,
    entity_type search.profile_entity_type NOT NULL,
    display_name text NOT NULL,
    headline text,
    fts tsvector, 
    embedding vector(1536), 
    metadata jsonb DEFAULT '{}'::jsonb,


rating_average numeric(3,2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,
    current_workload_intensity integer DEFAULT 0,
    available_since timestamp with time zone,
    discovery_penalty numeric(6,2) DEFAULT 0,

    is_active boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now(),
    PRIMARY KEY (entity_id, entity_type)
);

CREATE INDEX idx_profiles_vector ON search.profiles_index USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_profiles_fts ON search.profiles_index USING GIN (fts);

CREATE TABLE search.projects_index (
    project_id uuid PRIMARY KEY REFERENCES projects.projects (id) ON DELETE CASCADE,
    title text NOT NULL,
    fts tsvector,
    embedding vector (1536),
    industry_category_id uuid,
    status text,
    target_start_date timestamp
    with
        time zone,
        is_active boolean DEFAULT false,
        updated_at timestamp
    with
        time zone DEFAULT now()
);

CREATE INDEX idx_projects_vector ON search.projects_index USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_projects_fts ON search.projects_index USING GIN (fts);

CREATE TABLE search.services_index (
    service_id uuid PRIMARY KEY REFERENCES marketplace.service_blueprints (id) ON DELETE CASCADE,
    title text NOT NULL,
    fts tsvector,
    embedding vector (1536),
    is_public boolean DEFAULT true,
    rating_average numeric(3, 2) DEFAULT 0.0,
    rating_count integer DEFAULT 0,
    updated_at timestamp
    with
        time zone DEFAULT now()
);

CREATE INDEX idx_services_vector ON search.services_index USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_services_fts ON search.services_index USING GIN (fts);

CREATE TABLE search.user_affinity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    category_slug text NOT NULL,
    affinity_score numeric(10, 2) NOT NULL DEFAULT 0.0,
    updated_at timestamp
    with
        time zone DEFAULT now(),
        CONSTRAINT unique_user_affinity UNIQUE (user_id, category_slug)
);

CREATE INDEX idx_user_affinity ON search.user_affinity (user_id, affinity_score DESC);

CREATE TABLE search.query_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES org.users_public(user_id),
    search_query text NOT NULL,
    query_embedding vector(1536),
    filters_applied jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX idx_query_logs_string ON search.query_logs (search_query);

CREATE OR REPLACE FUNCTION search.sync_team_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata, 
        rating_average, rating_count, current_workload_intensity, available_since, is_active, updated_at
    )
    VALUES (
        NEW.id, 'team', NEW.slug, to_tsvector('english', coalesce(NEW.slug, '')),
        jsonb_build_object('payout_model', NEW.payout_model),
        NEW.rating_average, NEW.rating_count, NEW.current_workload_intensity, NEW.available_since, true, now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        display_name = EXCLUDED.display_name, fts = EXCLUDED.fts,
        metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        current_workload_intensity = EXCLUDED.current_workload_intensity,
        available_since = EXCLUDED.available_since,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_team_search AFTER INSERT OR UPDATE ON org.teams
FOR EACH ROW EXECUTE FUNCTION search.sync_team_to_index();

CREATE OR REPLACE FUNCTION search.sync_freelancer_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata, 
        rating_average, rating_count, current_workload_intensity, available_since, updated_at
    )
    VALUES (
        NEW.user_id, 'freelancer', 'Freelancer Profile', to_tsvector('english', array_to_string(NEW.skills, ' ')),
        jsonb_build_object('skills', NEW.skills),
        NEW.rating_average, NEW.rating_count, NEW.current_workload_intensity, NEW.available_since, now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        fts = EXCLUDED.fts, metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        current_workload_intensity = EXCLUDED.current_workload_intensity,
        available_since = EXCLUDED.available_since,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_freelancer_search AFTER INSERT OR UPDATE ON org.freelancer_profiles
FOR EACH ROW EXECUTE FUNCTION search.sync_freelancer_to_index();

CREATE OR REPLACE FUNCTION search.sync_project_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.projects_index (project_id, title, fts, industry_category_id, status, target_start_date, is_active, updated_at)
    VALUES (
        NEW.id, NEW.title, to_tsvector('english', NEW.status::text || ' ' || NEW.title),
        NEW.industry_category_id, NEW.status::text, NEW.target_project_start_date,
        CASE WHEN NEW.visibility = 'public' AND NEW.status != 'draft' THEN true ELSE false END, now()
    )
    ON CONFLICT (project_id) DO UPDATE SET
        title = EXCLUDED.title, fts = EXCLUDED.fts,
        industry_category_id = EXCLUDED.industry_category_id,
        status = EXCLUDED.status, target_start_date = EXCLUDED.target_start_date, 
        is_active = EXCLUDED.is_active, updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_project_search AFTER INSERT OR UPDATE ON projects.projects
FOR EACH ROW EXECUTE FUNCTION search.sync_project_to_index();

CREATE OR REPLACE FUNCTION search.sync_user_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, headline, fts, metadata, 
        rating_average, rating_count, is_active, updated_at
    )
    VALUES (
        NEW.user_id, 'user', coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, ''), NEW.headline,
        to_tsvector('english', coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '') || ' ' || coalesce(NEW.headline, '')),
        jsonb_build_object('username', NEW.username),
        NEW.rating_average, NEW.rating_count,
        CASE WHEN NEW.visibility = 'public' THEN true ELSE false END, now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        display_name = EXCLUDED.display_name, headline = EXCLUDED.headline, fts = EXCLUDED.fts,
        metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        is_active = EXCLUDED.is_active, updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_user_search AFTER INSERT OR UPDATE ON org.users_public
FOR EACH ROW EXECUTE FUNCTION search.sync_user_to_index();

CREATE OR REPLACE FUNCTION search.sync_business_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata, 
        rating_average, rating_count, updated_at
    )
    VALUES (
        NEW.id, 'business', NEW.name, to_tsvector('english', coalesce(NEW.name, '')),
        jsonb_build_object('plan', NEW.plan),
        NEW.rating_average, NEW.rating_count, now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        display_name = EXCLUDED.display_name, fts = EXCLUDED.fts,
        metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_business_search AFTER INSERT OR UPDATE ON org.business_profiles
FOR EACH ROW EXECUTE FUNCTION search.sync_business_to_index();

CREATE OR REPLACE FUNCTION search.sync_service_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.services_index (
        service_id, title, fts, is_public, 
        rating_average, rating_count, updated_at
    )
    VALUES (
        NEW.id, NEW.title, to_tsvector('english', NEW.title || ' ' || coalesce(NEW.description_text, '')),
        NEW.is_published, NEW.rating_average, NEW.rating_count, now()
    )
    ON CONFLICT (service_id) DO UPDATE SET
        title = EXCLUDED.title, fts = EXCLUDED.fts, is_public = EXCLUDED.is_public,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_service_search AFTER INSERT OR UPDATE ON marketplace.service_blueprints
FOR EACH ROW EXECUTE FUNCTION search.sync_service_to_index();