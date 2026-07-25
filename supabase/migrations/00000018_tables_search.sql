-- =============================================================================================
-- 00000018_tables_search.sql — search schema tables (Category 0), final folded form.
-- Base: 0010_search_tables.sql. Also: 0218_search_engine_signals.sql (talent_signals,
--       interest_events), 0219_search_engine_weights.sql (search_weights).
-- Folded ALTER:
--   * search.query_logs += entity_type, duration_ms, result_count, matched_density  (0218)
-- =============================================================================================

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

CREATE TABLE search.query_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES org.users_public(user_id),
    search_query text NOT NULL,
    query_embedding vector(1536),
    filters_applied jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    -- Folded (0218): execution analytics columns.
    entity_type     text,
    duration_ms     integer,
    result_count    integer,
    matched_density numeric(6,4)  -- results / candidate pool
);

-- #region Discovery signals (0218_search_engine_signals.sql)
CREATE TABLE search.talent_signals (
  entity_id           uuid NOT NULL,
  entity_type         search.profile_entity_type NOT NULL,
  -- Talent metrics
  is_verified         boolean NOT NULL DEFAULT false,
  response_time_hours numeric(6,2) NOT NULL DEFAULT 24.0,   -- median first-response time
  member_count        integer NOT NULL DEFAULT 1,           -- teams / businesses
  low_workload_since  timestamptz,                          -- start of the current idle spell
  -- Rolling engagement (fed from interest_events by fn_recalc_engagement)
  engagement_score    numeric(10,2) NOT NULL DEFAULT 0,     -- weighted clicks/hires
  -- Structural, per-role reputation caches (freelancer vs client vs team vs business)
  rating_as_freelancer numeric(3,2) NOT NULL DEFAULT 0,
  rating_as_client     numeric(3,2) NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, entity_type)
);

CREATE TABLE search.interest_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES org.users_public(user_id) ON DELETE SET NULL,  -- NULL for guests
  session_id   text,                                                          -- anonymous session key
  event_type   text NOT NULL CHECK (event_type IN
                 ('impression','click','search','save','hire','apply','message')),
  entity_id    uuid,
  entity_type  text,        -- 'service' | 'project' | 'user' | 'freelancer' | 'team' | 'business'
  query        text,
  weight       numeric(6,2) NOT NULL DEFAULT 1.0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- #endregion

-- #region Ranking weights (0219_search_engine_weights.sql)
CREATE TABLE search.search_weights (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  description text,
  -- Which slice of the scoring matrix this factor belongs to.
  scope       text NOT NULL CHECK (scope IN ('universal','talent','opportunity')),
  weight      numeric(6,3) NOT NULL DEFAULT 1.0,
  min_value   numeric(6,3) NOT NULL DEFAULT 0,
  max_value   numeric(6,3) NOT NULL DEFAULT 5,
  is_active   boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
-- #endregion
