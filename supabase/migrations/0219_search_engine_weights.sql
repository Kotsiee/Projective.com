-- =============================================================================
-- 0215_search_engine_weights.sql
-- Admin-tunable ranking weights + admin guard.
--
-- `search.search_weights` is the single source of truth for every coefficient in
-- the scoring matrix. An admin can monitor and live-adjust individual weights via
-- the admin API (fn_get_weights / fn_set_weight) WITHOUT a code change or deploy —
-- the ranking RPC reads this table on every call.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Admin guard: reused by weight-management + analytics RPCs. ops.admin_users is
-- an internal (non-exposed) table, so this is SECURITY DEFINER.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ops, public
AS $$
  SELECT EXISTS (SELECT 1 FROM ops.admin_users WHERE user_id = p_user_id);
$$;

GRANT EXECUTE ON FUNCTION search.is_admin(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Weight configuration table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search.search_weights (
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

COMMENT ON TABLE search.search_weights IS
  'Live-tunable ranking coefficients. Read by search.fn_search_* on every query.';

-- -----------------------------------------------------------------------------
-- Seed the default scoring matrix (idempotent).
-- -----------------------------------------------------------------------------
INSERT INTO search.search_weights (key, label, description, scope, weight) VALUES
  -- Universal metrics --------------------------------------------------------
  ('text_relevance',   'Text relevance',      'Full-text rank over title/description/tags',      'universal', 3.00),
  ('vector_similarity','Semantic similarity', 'pgvector cosine similarity of query vs entity',   'universal', 2.00),
  ('query_interest',   'Stated query interest','Exact tag/skill match with the search term',      'universal', 1.50),
  ('location_match',   'Location match',      'Query/user location alignment',                    'universal', 0.75),
  ('timezone_match',   'Timezone match',      'Working-hours overlap',                            'universal', 0.50),
  ('language_match',   'Language match',      'Shared spoken languages',                          'universal', 0.75),
  ('verification',     'Verification status', 'Verified identity / business boost',               'universal', 1.00),
  ('interest_history', 'Interest history',    'Viewer click/search affinity for this entity',     'universal', 1.25),
  ('review_sentiment', 'Review sentiment',    'Average review rating (proxy for sentiment)',      'universal', 1.75),
  ('review_count',     'Review volume',       'Total number of reviews (social proof)',           'universal', 1.00),
  -- Talent metrics (freelancers / teams / businesses) ------------------------
  ('penalty',          'Trust penalties',     'Discovery-rank penalty dampening (negative)',      'talent',    2.50),
  ('workload',         'Current workload',    'Prefer available talent (lower workload)',         'talent',    1.50),
  ('idle_time',        'Idle time',           'Boost talent idle with low/no workload',           'talent',    0.75),
  ('response_time',    'Response time',       'Faster median first-response ranks higher',        'talent',    1.00),
  ('member_count',     'Team size',           'Team/business capacity signal',                    'talent',    0.50),
  ('rating_freelancer','Freelancer rating',   'Historical rating in the freelancer role',         'talent',    1.50),
  ('rating_client',    'Client rating',       'Historical rating in the client role',             'talent',    0.75),
  -- Opportunity / asset metrics (projects / services) ------------------------
  ('open_seats',       'Open seats',          'Available seats / open roles',                     'opportunity', 1.25),
  ('stage_count',      'Project stages',      'Structured scope depth',                           'opportunity', 0.50),
  ('budget_range',     'Budget / payout',     'Higher budget/payout range boost',                 'opportunity', 1.50),
  ('price_tier',       'Service pricing',     'Service pricing-tier alignment',                   'opportunity', 1.00)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- RLS: only admins may read/write the raw config table directly. The ranking RPC
-- is SECURITY DEFINER and reads it regardless.
-- -----------------------------------------------------------------------------
ALTER TABLE search.search_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read weights" ON search.search_weights;
CREATE POLICY "Admins read weights" ON search.search_weights
  FOR SELECT USING (search.is_admin());

GRANT SELECT ON search.search_weights TO authenticated;
GRANT ALL ON search.search_weights TO service_role;
