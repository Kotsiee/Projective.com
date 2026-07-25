-- =============================================================================================
-- 00000021_tables_analytics.sql — analytics schema tables (Category 0).
-- Source: 20260724110000_analytics_event_substrate.sql.
-- =============================================================================================

CREATE TABLE analytics.event_catalogue (
    name text PRIMARY KEY,
    domain text NOT NULL,                          -- 'billing' | 'standing' | 'allowance' | 'projects' | ...
    description text NOT NULL,
    subject_kinds analytics.subject_kind[] NOT NULL DEFAULT '{}'::analytics.subject_kind[],
    property_keys text[] NOT NULL DEFAULT '{}'::text[],  -- documented keys expected in `properties`
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analytics.events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    name text NOT NULL,
    domain text NOT NULL DEFAULT 'platform',
    subject_kind analytics.subject_kind NOT NULL,
    subject_id uuid,                               -- NULL only for subject_kind = 'platform'
    actor_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
    project_id uuid REFERENCES projects.projects (id) ON DELETE SET NULL,
    -- Numeric payload lifted out of `properties` so rollups aggregate without JSON extraction.
    value numeric(18, 4),
    properties jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT events_subject_present CHECK (subject_kind = 'platform' OR subject_id IS NOT NULL)
);

CREATE TABLE analytics.daily_rollups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    day date NOT NULL,
    metric text NOT NULL,
    subject_kind analytics.subject_kind NOT NULL,
    subject_id uuid,
    dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
    value numeric(18, 4) NOT NULL DEFAULT 0,
    sample_count integer NOT NULL DEFAULT 0,
    computed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_daily_rollup UNIQUE (day, metric, subject_kind, subject_id, dimensions)
);
