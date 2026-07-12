-- =============================================================================
-- 0214_search_engine_signals.sql
-- Discovery scoring inputs + behavioural telemetry.
--
--  * search.talent_signals   — denormalised / derived per-entity ranking signals
--                              that have no natural home on the thin index tables
--                              (response time, member count, verification, idle
--                              time, aggregate engagement).
--  * search.interest_events  — click / impression / search / hire telemetry used
--                              for "history of user interest" + popularity signals.
--                              Guest-safe: anon may INSERT, but only ever reads
--                              back its own rows (admins read all).
--  * search.query_logs (+cols)— execution telemetry (duration, result count,
--                              matching density) powering the admin analytics RPC.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Talent / entity derived signals
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search.talent_signals (
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

COMMENT ON TABLE search.talent_signals IS
  'Denormalised ranking signals for profile-family entities, refreshed out-of-band.';

-- -----------------------------------------------------------------------------
-- Behavioural telemetry (clicks, impressions, searches, conversions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search.interest_events (
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

CREATE INDEX IF NOT EXISTS idx_interest_events_entity ON search.interest_events (entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_interest_events_user   ON search.interest_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interest_events_recent ON search.interest_events (created_at DESC);

-- -----------------------------------------------------------------------------
-- Extend the existing query telemetry with execution analytics columns.
-- -----------------------------------------------------------------------------
ALTER TABLE search.query_logs ADD COLUMN IF NOT EXISTS entity_type     text;
ALTER TABLE search.query_logs ADD COLUMN IF NOT EXISTS duration_ms     integer;
ALTER TABLE search.query_logs ADD COLUMN IF NOT EXISTS result_count    integer;
ALTER TABLE search.query_logs ADD COLUMN IF NOT EXISTS matched_density numeric(6,4);  -- results / candidate pool

CREATE INDEX IF NOT EXISTS idx_query_logs_created ON search.query_logs (created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
ALTER TABLE search.talent_signals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE search.interest_events ENABLE ROW LEVEL SECURITY;

-- Signals are public read (they only expose already-public ranking facts).
DROP POLICY IF EXISTS "Public read talent signals" ON search.talent_signals;
CREATE POLICY "Public read talent signals" ON search.talent_signals
  FOR SELECT USING (true);

-- Telemetry: anyone (incl. guests) may record an interest event for themselves;
-- reads are restricted to the owning user (admin visibility is via SECURITY DEFINER RPC).
DROP POLICY IF EXISTS "Insert own interest events" ON search.interest_events;
CREATE POLICY "Insert own interest events" ON search.interest_events
  FOR INSERT WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "Read own interest events" ON search.interest_events;
CREATE POLICY "Read own interest events" ON search.interest_events
  FOR SELECT USING (user_id = auth.uid());

GRANT SELECT ON search.talent_signals TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON search.talent_signals TO service_role;
GRANT INSERT ON search.interest_events TO anon, authenticated;
GRANT SELECT ON search.interest_events TO authenticated;
GRANT ALL ON search.interest_events TO service_role;
