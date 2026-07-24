-- =============================================================================================
-- 20260724110000_analytics_event_substrate.sql
-- Subscriptions, Standing & Gamification foundation (1/4) — the analytics event substrate.
--
-- ADDITIVE ONLY. New enums, new `analytics` tables (the schema had none), a new SECURITY DEFINER
-- subject-visibility helper, a new emit RPC. No existing object is altered. Authored, NOT applied to
-- any live database.
--
-- WHY THIS LANDS FIRST: the subscription allowances (3/4, 4/4) and the earned Standing ladder (2/4)
-- are BOTH derived systems — a rank cannot exist without an event substrate to derive it from, and
-- the cap magnitudes (50 proposals/wk, 3-per-10h buffer, listing ladders) are explicitly placeholder
-- dials that must be tuned against real telemetry. Every allowance grant/consumption, entitlement
-- denial, standing transition and achievement award writes an `analytics.events` row so the numbers
-- can be re-derived and re-tuned instead of guessed.
-- =============================================================================================

CREATE SCHEMA IF NOT EXISTS analytics;

-- #region 1. Subject vocabulary + visibility helper
-- Every analytics row is attributed to a SUBJECT (the entity the event is *about*) and optionally an
-- ACTOR (the user who caused it). Keeping the subject vocabulary an enum — rather than free text —
-- keeps the Zod SSOT (`@projective/types/analytics`) and the rollup dimensions honest.
DO $$ BEGIN
    CREATE TYPE analytics.subject_kind AS ENUM (
        'user', 'freelancer', 'business', 'team', 'organisation',
        'project', 'stage', 'ticket', 'listing', 'platform'
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Can the current user see analytics attributed to this subject? Mirrors finance.fn_owner_visible's
-- posture (owner scope → membership) but covers the broader, non-money subject kinds. Project-scoped
-- and platform-scoped rows are admin-only; the app reads project analytics through the projects
-- domain, not here.
CREATE OR REPLACE FUNCTION analytics.fn_subject_visible(
    p_subject_kind analytics.subject_kind,
    p_subject_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_subject_kind IN ('user', 'freelancer') AND p_subject_id = auth.uid ())
        OR (p_subject_kind = 'business' AND org.is_active_business_member (p_subject_id))
        OR (p_subject_kind = 'team' AND org.is_active_team_member (p_subject_id))
        OR (p_subject_kind = 'organisation' AND org.is_organisation_member (p_subject_id));
$$;

GRANT USAGE ON SCHEMA analytics TO authenticated;
GRANT EXECUTE ON FUNCTION analytics.fn_subject_visible(analytics.subject_kind, uuid) TO authenticated;
-- #endregion

-- #region 2. analytics.event_catalogue — the documented event vocabulary
-- Event names stay TEXT (a new event must not require an enum migration mid-feature) but every name
-- the platform emits is registered here with its owning domain and expected properties. The catalogue
-- is the discipline: an unregistered name still records, and `analytics.v_unregistered_events`
-- surfaces the drift for cleanup.
CREATE TABLE IF NOT EXISTS analytics.event_catalogue (
    name text PRIMARY KEY,
    domain text NOT NULL,                          -- 'billing' | 'standing' | 'allowance' | 'projects' | ...
    description text NOT NULL,
    subject_kinds analytics.subject_kind[] NOT NULL DEFAULT '{}'::analytics.subject_kind[],
    property_keys text[] NOT NULL DEFAULT '{}'::text[],  -- documented keys expected in `properties`
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analytics.event_catalogue ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE analytics.event_catalogue TO authenticated;
GRANT ALL ON TABLE analytics.event_catalogue TO service_role;

DROP POLICY IF EXISTS "Read event catalogue" ON analytics.event_catalogue;
CREATE POLICY "Read event catalogue" ON analytics.event_catalogue FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region 3. analytics.events — the append-only substrate
-- Append-only by discipline (no UPDATE/DELETE policy). Volume table: BRIN on the time axis (naturally
-- correlated with physical order) plus btree indexes for the two hot read paths (by subject, by name).
-- Monthly RANGE partitioning is the documented scale-out step (SYSTEM_ARCHITECTURE.md §Analytics) and
-- is deliberately deferred — it is a physical reorganisation, not an additive change.
CREATE TABLE IF NOT EXISTS analytics.events (
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

CREATE INDEX IF NOT EXISTS idx_events_occurred_brin ON analytics.events USING brin (occurred_at);
CREATE INDEX IF NOT EXISTS idx_events_subject ON analytics.events (subject_kind, subject_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_name ON analytics.events (name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor ON analytics.events (actor_user_id, occurred_at DESC)
    WHERE actor_user_id IS NOT NULL;

ALTER TABLE analytics.events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE analytics.events TO authenticated;
GRANT ALL ON TABLE analytics.events TO service_role;

-- Read-only, subject-scoped. Writes go exclusively through analytics.fn_emit (SECURITY DEFINER), so
-- a client can never forge an event attributed to another entity — and never rewrite history.
DROP POLICY IF EXISTS "View own subject events" ON analytics.events;
CREATE POLICY "View own subject events" ON analytics.events FOR
SELECT TO authenticated USING (analytics.fn_subject_visible (subject_kind, subject_id));
-- #endregion

-- #region 4. analytics.daily_rollups — pre-calculated daily aggregates
-- One row per (day, metric, subject). `dimensions` carries the optional breakdown (plan code,
-- entitlement key, standing level, CREATE category) so a new dimension never needs a new column.
CREATE TABLE IF NOT EXISTS analytics.daily_rollups (
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

CREATE INDEX IF NOT EXISTS idx_daily_rollups_metric ON analytics.daily_rollups (metric, day DESC);
CREATE INDEX IF NOT EXISTS idx_daily_rollups_subject ON analytics.daily_rollups (subject_kind, subject_id, day DESC);

ALTER TABLE analytics.daily_rollups ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE analytics.daily_rollups TO authenticated;
GRANT ALL ON TABLE analytics.daily_rollups TO service_role;

DROP POLICY IF EXISTS "View own subject rollups" ON analytics.daily_rollups;
CREATE POLICY "View own subject rollups" ON analytics.daily_rollups FOR
SELECT TO authenticated USING (analytics.fn_subject_visible (subject_kind, subject_id));
-- #endregion

-- #region 5. analytics.fn_emit — the single write path
-- SECURITY DEFINER so RLS-scoped callers (and the other three migrations in this set) can record an
-- event without a direct INSERT grant. `p_actor` defaults to auth.uid() — a client cannot spoof it,
-- because the parameter is ignored unless the caller is an admin or the service role.
CREATE OR REPLACE FUNCTION analytics.fn_emit(
    p_name text,
    p_subject_kind analytics.subject_kind,
    p_subject_id uuid DEFAULT NULL,
    p_properties jsonb DEFAULT '{}'::jsonb,
    p_value numeric DEFAULT NULL,
    p_project_id uuid DEFAULT NULL,
    p_domain text DEFAULT NULL,
    p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, security, public
AS $$
DECLARE
    v_id uuid;
    v_domain text;
    v_actor uuid;
BEGIN
    -- Trust the caller's actor only when it is privileged; otherwise attribute to the session user.
    v_actor := CASE
        WHEN p_actor IS NOT NULL AND (security.is_admin () OR auth.uid () IS NULL) THEN p_actor
        ELSE COALESCE(auth.uid (), p_actor)
    END;

    SELECT c.domain INTO v_domain FROM analytics.event_catalogue c WHERE c.name = p_name;

    INSERT INTO analytics.events (
        name, domain, subject_kind, subject_id, actor_user_id, project_id, value, properties
    ) VALUES (
        p_name,
        COALESCE(p_domain, v_domain, 'platform'),
        p_subject_kind,
        p_subject_id,
        v_actor,
        p_project_id,
        p_value,
        COALESCE(p_properties, '{}'::jsonb)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    -- Telemetry must NEVER break the business transaction that emitted it.
    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION analytics.fn_emit(
    text, analytics.subject_kind, uuid, jsonb, numeric, uuid, text, uuid
) TO authenticated;
-- #endregion

-- #region 6. analytics.v_unregistered_events — catalogue-drift monitor
CREATE OR REPLACE VIEW analytics.v_unregistered_events AS
SELECT e.name, e.domain, count(*) AS occurrences, max(e.occurred_at) AS last_seen
FROM analytics.events e
LEFT JOIN analytics.event_catalogue c ON c.name = e.name
WHERE c.name IS NULL
GROUP BY e.name, e.domain;

GRANT SELECT ON analytics.v_unregistered_events TO service_role;
-- #endregion

-- #region 7. Registered vocabulary for the subscription / standing / allowance systems
INSERT INTO analytics.event_catalogue (name, domain, description, subject_kinds, property_keys) VALUES
    -- Billing
    ('subscription.started', 'billing', 'A paid or free plan became active for a subject.',
        '{user,freelancer,team,business,organisation}', '{plan_code,tier,audience,price_cents,currency,interval}'),
    ('subscription.changed', 'billing', 'A subject moved between plans (upgrade or downgrade).',
        '{user,freelancer,team,business,organisation}', '{from_plan,to_plan,direction,reason}'),
    ('subscription.cancelled', 'billing', 'A subscription was cancelled or allowed to lapse.',
        '{user,freelancer,team,business,organisation}', '{plan_code,at_period_end,reason}'),
    -- Entitlements & allowances (the tuning substrate for every cap magnitude)
    ('entitlement.checked', 'allowance', 'An entitlement limit was resolved for a subject.',
        '{user,freelancer,team,business,organisation}', '{key,effective_limit,source}'),
    ('entitlement.denied', 'allowance', 'An action was blocked by an entitlement cap — the upgrade signal.',
        '{user,freelancer,team,business,organisation}', '{key,effective_limit,attempted}'),
    ('allowance.consumed', 'allowance', 'A metered allowance unit was spent (e.g. one proposal).',
        '{user,freelancer,team}', '{key,units,remaining,from_buffer,period_start}'),
    ('allowance.exhausted', 'allowance', 'A subject reached zero on a metered allowance.',
        '{user,freelancer,team}', '{key,granted,period_start}'),
    ('allowance.period_rolled', 'allowance', 'A new allowance period opened with a fresh grant.',
        '{user,freelancer,team}', '{key,granted,base,standing_bonus,plan_code}'),
    ('allowance.buffer_replenished', 'allowance', 'The rolling drip topped a subject''s buffer back up.',
        '{user,freelancer,team}', '{key,units,buffer_cap}'),
    -- Standing & gamification
    ('standing.recomputed', 'standing', 'The Standing score was recalculated from its metric inputs.',
        '{user,freelancer,team}', '{score,level,components}'),
    ('standing.level_changed', 'standing', 'A subject moved up or down the Standing ladder.',
        '{user,freelancer,team}', '{from_level,to_level,direction,score}'),
    ('mastery.progressed', 'standing', 'CREATE-category mastery advanced for a subject.',
        '{user,freelancer,team}', '{category,stages_completed,mastery_level,share_bp}'),
    ('achievement.awarded', 'standing', 'A milestone or achievement was granted.',
        '{user,freelancer,team}', '{code,tier}'),
    ('streak.extended', 'standing', 'A quality streak (on-time delivery, fast response) was extended.',
        '{user,freelancer,team}', '{kind,current_count,best_count}'),
    ('streak.broken', 'standing', 'A quality streak lapsed.',
        '{user,freelancer,team}', '{kind,previous_count}')
ON CONFLICT (name) DO NOTHING;
-- #endregion
