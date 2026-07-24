-- =============================================================================================
-- 20260724111000_standing_reputation.sql
-- Subscriptions, Standing & Gamification foundation (2/4) — the EARNED ladder.
--
-- ADDITIVE ONLY. New enums, new `org` tables, new SECURITY DEFINER helpers. No existing object is
-- altered — `org.users_public.rating_average`, `org.freelancer_profiles.rating_*`,
-- `finance.ratings` and `security.penalties` remain untouched and are the INPUTS this layer reads.
-- Authored, NOT applied to any live database.
--
-- WHAT THIS IS: Standing is the DISCRETISED, client-facing rung of the continuous Reliability Index
-- ($R_i$) already specified in PRODUCT_SPEC.md §Reputation & Discovery (Velocity / Accuracy /
-- Retention). It does NOT replace or fork $R_i$ — `org.entity_standing.score` is the composite, and
-- `level` is the ladder derived from it. Standing is EARNED and can NEVER be purchased: no
-- subscription plan, grant or payment writes to any table in this file (see 3/4 for the strict
-- separation of the two ladders).
--
-- ⚠️ Every reward here must map to something a client independently values — the governing rule for
-- Projective's gamification (PRODUCT_SPEC.md §Standing, Mastery & Progression). Deliberately absent:
-- login/attendance streaks, vanity points, and public earnings leaderboards.
-- =============================================================================================

-- #region 1. Vocabulary
-- Standing applies to the three EARNING subjects. Clients/businesses/organisations carry the separate
-- Client Trust Score (PRODUCT_SPEC.md §Reciprocal Reviews) and are deliberately NOT ranked here.
DO $$ BEGIN
    CREATE TYPE org.standing_subject AS ENUM ('user', 'freelancer', 'team');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- The CREATE framework (PRODUCT_SPEC.md §The CREATE Framework) — the mastery axis.
DO $$ BEGIN
    CREATE TYPE org.create_category AS ENUM ('create', 'run', 'educate', 'advise', 'test', 'empower');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Quality streaks ONLY. There is deliberately no 'daily_login' / attendance member: a streak must
-- celebrate good work, never mere presence.
DO $$ BEGIN
    CREATE TYPE org.streak_kind AS ENUM ('on_time_delivery', 'fast_response', 'dispute_free', 'client_repeat');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE org.achievement_tier AS ENUM ('milestone', 'bronze', 'silver', 'gold', 'designation');
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- #endregion

-- #region 2. org.standing_levels — the configurable ladder
-- Tunable config, NOT hard-coded thresholds: the magnitudes below are starting dials to be re-tuned
-- against `analytics.events` (migration 1/4). Money perks live in finance (3/4) — this table holds
-- only the non-money rungs so the earned ladder stays inside the identity domain.
CREATE TABLE IF NOT EXISTS org.standing_levels (
    level smallint PRIMARY KEY CHECK (level BETWEEN 1 AND 5),
    code text NOT NULL UNIQUE,
    label text NOT NULL,
    min_score numeric(5, 2) NOT NULL CHECK (min_score BETWEEN 0 AND 100),
    -- Volume floor: a flawless single engagement must not vault a subject to the top of the ladder.
    min_completed_stages integer NOT NULL DEFAULT 0 CHECK (min_completed_stages >= 0),
    -- Earned footprint: the published-listing allowance a FREE subject enjoys at this rung.
    listing_base integer NOT NULL DEFAULT 10 CHECK (listing_base >= 0),
    -- Earned distribution: extra weekly proposals on top of the plan's base allowance.
    proposal_bonus integer NOT NULL DEFAULT 0 CHECK (proposal_bonus >= 0),
    -- Discovery ranking multiplier in basis points (10000 = 1.0x). Feeds the search weighting engine.
    discovery_weight_bp integer NOT NULL DEFAULT 10000 CHECK (discovery_weight_bp >= 0),
    description text,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO org.standing_levels
    (level, code, label, min_score, min_completed_stages, listing_base, proposal_bonus, discovery_weight_bp, description) VALUES
    (1, 'l1_new',         'New',         0.00,   0, 10,  0, 10000, 'Everyone starts here. Full free footprint — a new subject is never starved.'),
    (2, 'l2_established', 'Established', 55.00,  5, 15, 10, 10500, 'A consistent early track record.'),
    (3, 'l3_trusted',     'Trusted',     70.00, 20, 20, 20, 11000, 'Reliably delivers; low dispute exposure.'),
    (4, 'l4_expert',      'Expert',      82.00, 50, 30, 30, 11500, 'Sustained high accuracy and on-time delivery.'),
    (5, 'l5_elite',       'Elite',       92.00, 120, 50, 40, 12000, 'Top of the ladder. Boosted discovery and the lowest commission.')
ON CONFLICT (level) DO NOTHING;

ALTER TABLE org.standing_levels ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE org.standing_levels TO authenticated;
GRANT ALL ON TABLE org.standing_levels TO service_role;

-- The ladder is public by design: a client must be able to read what a rung means.
DROP POLICY IF EXISTS "Read standing ladder" ON org.standing_levels;
CREATE POLICY "Read standing ladder" ON org.standing_levels FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region 3. org.entity_standing — the per-subject cache + its metric inputs
-- One row per earning subject. The metric columns are the $R_i$ inputs, materialised here so the
-- recompute is a single-row read and discovery stays one join (the same pattern as
-- `org.users_public.rating_average` and `security.fn_recalc_penalty_aggregates`).
--
-- NOTE every input is CLIENT-VALUED. Raw earnings and raw proposal counts are deliberately absent —
-- ranking by spend or by volume is the pay-to-win trap this ladder exists to avoid.
CREATE TABLE IF NOT EXISTS org.entity_standing (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    level smallint NOT NULL DEFAULT 1 REFERENCES org.standing_levels (level),
    score numeric(5, 2) NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    -- Inputs (all 0..1 rates unless noted)
    stages_completed integer NOT NULL DEFAULT 0 CHECK (stages_completed >= 0),
    completion_rate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (completion_rate BETWEEN 0 AND 1),
    on_time_rate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (on_time_rate BETWEEN 0 AND 1),
    -- Dual-track reviews (PRODUCT_SPEC.md §Reciprocal Reviews): what clients say, and what peers say.
    client_rating_avg numeric(3, 2) NOT NULL DEFAULT 0 CHECK (client_rating_avg BETWEEN 0 AND 5),
    peer_rating_avg numeric(3, 2) NOT NULL DEFAULT 0 CHECK (peer_rating_avg BETWEEN 0 AND 5),
    dispute_rate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (dispute_rate BETWEEN 0 AND 1),
    -- Delivering at capacity without dropping tickets — the $W_i$ reliability signal.
    workload_reliability numeric(5, 4) NOT NULL DEFAULT 0 CHECK (workload_reliability BETWEEN 0 AND 1),
    tenure_days integer NOT NULL DEFAULT 0 CHECK (tenure_days >= 0),
    -- Active penalty severity subtracted at recompute (security.penalties aggregate).
    penalty_severity numeric(6, 2) NOT NULL DEFAULT 0,
    -- Per-component contribution, for the "why am I this rung" profile surface.
    components jsonb NOT NULL DEFAULT '{}'::jsonb,
    level_changed_at timestamptz,
    computed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_entity_standing UNIQUE (subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_standing_level ON org.entity_standing (level DESC, score DESC);

ALTER TABLE org.entity_standing ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE org.entity_standing TO authenticated;
GRANT ALL ON TABLE org.entity_standing TO service_role;

-- Standing is a PUBLIC trust signal (like `rating_average`) — a client must see it before hiring.
-- Writes are definer-only: nothing client-side can move a rung.
DROP POLICY IF EXISTS "Read standing" ON org.entity_standing;
CREATE POLICY "Read standing" ON org.entity_standing FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region 4. org.standing_events — the append-only progression audit
-- The durable record behind "you moved from Trusted to Expert on …". Private to the subject (+ admin)
-- because it carries the score internals; the LEVEL itself is public via entity_standing.
CREATE TABLE IF NOT EXISTS org.standing_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type IN ('recomputed', 'promoted', 'demoted', 'penalty_applied', 'manual_review')),
    from_level smallint,
    to_level smallint,
    score numeric(5, 2),
    components jsonb NOT NULL DEFAULT '{}'::jsonb,
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_standing_events_subject ON org.standing_events (subject_type, subject_id, created_at DESC);

ALTER TABLE org.standing_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE org.standing_events TO authenticated;
GRANT ALL ON TABLE org.standing_events TO service_role;

DROP POLICY IF EXISTS "View own standing history" ON org.standing_events;
CREATE POLICY "View own standing history" ON org.standing_events FOR
SELECT TO authenticated USING (
        security.is_admin ()
        OR (subject_type IN ('user', 'freelancer') AND subject_id = auth.uid ())
        OR (subject_type = 'team' AND org.is_active_team_member (subject_id))
    );
-- #endregion

-- #region 5. org.create_mastery — specialisation that feeds discovery matching
-- The non-vanity progression: because every stage is typed C/R/E/A/T/E, a freelancer's specialisation
-- is DERIVED, not self-declared. `share_bp` is this category's share of the subject's completed work —
-- the matching signal that routes Create-heavy stages to proven Create specialists.
CREATE TABLE IF NOT EXISTS org.create_mastery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    category org.create_category NOT NULL,
    stages_completed integer NOT NULL DEFAULT 0 CHECK (stages_completed >= 0),
    -- Weighted by $W_i$, so a hard Create stage counts for more than a trivial one.
    intensity_delivered numeric(10, 2) NOT NULL DEFAULT 0 CHECK (intensity_delivered >= 0),
    on_time_rate numeric(5, 4) NOT NULL DEFAULT 0 CHECK (on_time_rate BETWEEN 0 AND 1),
    share_bp integer NOT NULL DEFAULT 0 CHECK (share_bp BETWEEN 0 AND 10000),
    mastery_level smallint NOT NULL DEFAULT 0 CHECK (mastery_level BETWEEN 0 AND 5),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_create_mastery UNIQUE (subject_type, subject_id, category)
);

CREATE INDEX IF NOT EXISTS idx_create_mastery_category ON org.create_mastery (category, mastery_level DESC, share_bp DESC);

ALTER TABLE org.create_mastery ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE org.create_mastery TO authenticated;
GRANT ALL ON TABLE org.create_mastery TO service_role;

DROP POLICY IF EXISTS "Read create mastery" ON org.create_mastery;
CREATE POLICY "Read create mastery" ON org.create_mastery FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region 6. org.achievements + org.entity_achievements — milestones & designations
-- Light-touch garnish, never the main course. `designation` tier carries real capability (the
-- "Architect" designation of PRODUCT_SPEC.md §Reliability Index unlocks leading Team-based stages).
CREATE TABLE IF NOT EXISTS org.achievements (
    code text PRIMARY KEY,
    label text NOT NULL,
    description text NOT NULL,
    tier org.achievement_tier NOT NULL DEFAULT 'milestone',
    category org.create_category,                  -- NULL = not CREATE-specific
    -- Client-visible on the public profile? A reward a client would not respect must not be shown.
    is_public boolean NOT NULL DEFAULT true,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO org.achievements (code, label, description, tier, is_public) VALUES
    ('first_payout',       'First Payout',        'Received a first released escrow payout.',                    'milestone', true),
    ('first_five_star',    'First Five Star',     'Earned a first 5-star client review.',                        'milestone', true),
    ('repeat_client',      'Trusted Again',       'A client returned for a second engagement.',                  'silver',    true),
    ('squad_ten_stages',   'Squad of Ten',        'Delivered ten stages as a single team unit.',                 'gold',      true),
    ('dispute_free_year',  'Clean Record',        'Twelve months of delivery with no upheld dispute.',           'gold',      true),
    ('architect',          'Architect',           'Consistently leads multi-person stages with high velocity and accuracy; unlocks leading Team-based stages and authoring Marketplace stage templates.', 'designation', true)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE org.achievements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE org.achievements TO authenticated;
GRANT ALL ON TABLE org.achievements TO service_role;

DROP POLICY IF EXISTS "Read achievement catalogue" ON org.achievements;
CREATE POLICY "Read achievement catalogue" ON org.achievements FOR
SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS org.entity_achievements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    achievement_code text NOT NULL REFERENCES org.achievements (code) ON DELETE CASCADE,
    awarded_at timestamptz NOT NULL DEFAULT now(),
    source_ref uuid,                               -- the escrow / review / stage that triggered it
    CONSTRAINT uq_entity_achievement UNIQUE (subject_type, subject_id, achievement_code)
);

CREATE INDEX IF NOT EXISTS idx_entity_achievements_subject ON org.entity_achievements (subject_type, subject_id, awarded_at DESC);

ALTER TABLE org.entity_achievements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE org.entity_achievements TO authenticated;
GRANT ALL ON TABLE org.entity_achievements TO service_role;

-- Public awards are visible to everyone; non-public ones only to the subject.
DROP POLICY IF EXISTS "Read awarded achievements" ON org.entity_achievements;
CREATE POLICY "Read awarded achievements" ON org.entity_achievements FOR
SELECT TO authenticated USING (
        EXISTS (SELECT 1 FROM org.achievements a WHERE a.code = achievement_code AND a.is_public)
        OR security.is_admin ()
        OR (subject_type IN ('user', 'freelancer') AND subject_id = auth.uid ())
        OR (subject_type = 'team' AND org.is_active_team_member (subject_id))
    );
-- #endregion

-- #region 7. org.quality_streaks — consecutive good outcomes
CREATE TABLE IF NOT EXISTS org.quality_streaks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    subject_type org.standing_subject NOT NULL,
    subject_id uuid NOT NULL,
    kind org.streak_kind NOT NULL,
    current_count integer NOT NULL DEFAULT 0 CHECK (current_count >= 0),
    best_count integer NOT NULL DEFAULT 0 CHECK (best_count >= 0),
    last_event_at timestamptz,
    broken_at timestamptz,
    CONSTRAINT uq_quality_streak UNIQUE (subject_type, subject_id, kind)
);

ALTER TABLE org.quality_streaks ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE org.quality_streaks TO authenticated;
GRANT ALL ON TABLE org.quality_streaks TO service_role;

DROP POLICY IF EXISTS "Read quality streaks" ON org.quality_streaks;
CREATE POLICY "Read quality streaks" ON org.quality_streaks FOR
SELECT TO authenticated USING (true);
-- #endregion

-- #region 8. Resolution & mutation functions (all SECURITY DEFINER — Standing is never client-written)

-- Which rung does this score qualify for, given the subject's completed volume?
CREATE OR REPLACE FUNCTION org.fn_level_for_score(p_score numeric, p_stages integer DEFAULT 0)
RETURNS smallint
LANGUAGE sql
STABLE
SET search_path = org, public
AS $$
    SELECT COALESCE(
        (SELECT max(l.level)
         FROM org.standing_levels l
         WHERE p_score >= l.min_score
           AND COALESCE(p_stages, 0) >= l.min_completed_stages),
        1::smallint
    );
$$;

-- The subject's current rung — the single read every entitlement resolver (3/4) uses.
CREATE OR REPLACE FUNCTION org.fn_standing_level(p_subject_type org.standing_subject, p_subject_id uuid)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = org, public
AS $$
    SELECT COALESCE(
        (SELECT s.level FROM org.entity_standing s
         WHERE s.subject_type = p_subject_type AND s.subject_id = p_subject_id),
        1::smallint
    );
$$;

-- Recompute the composite from the stored inputs, persist the rung, and record the transition.
-- The weights are TUNABLE DIALS, deliberately surfaced in `components` so the profile can explain the
-- rung and so the magnitudes can be re-fitted against analytics.
CREATE OR REPLACE FUNCTION org.fn_recompute_standing(
    p_subject_type org.standing_subject,
    p_subject_id uuid
)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, security, analytics, public
AS $$
DECLARE
    v_row org.entity_standing%ROWTYPE;
    v_components jsonb;
    v_score numeric(5, 2);
    v_level smallint;
BEGIN
    SELECT * INTO v_row FROM org.entity_standing s
    WHERE s.subject_type = p_subject_type AND s.subject_id = p_subject_id;

    IF NOT FOUND THEN
        INSERT INTO org.entity_standing (subject_type, subject_id)
        VALUES (p_subject_type, p_subject_id)
        ON CONFLICT (subject_type, subject_id) DO NOTHING;

        SELECT * INTO v_row FROM org.entity_standing s
        WHERE s.subject_type = p_subject_type AND s.subject_id = p_subject_id;
    END IF;

    v_components := jsonb_build_object(
        'completion',   round(v_row.completion_rate * 25, 2),
        'on_time',      round(v_row.on_time_rate * 25, 2),
        'reviews',      round(((v_row.client_rating_avg + v_row.peer_rating_avg) / 10.0) * 20, 2),
        'dispute_free', round((1 - v_row.dispute_rate) * 15, 2),
        'workload',     round(v_row.workload_reliability * 10, 2),
        'tenure',       round(LEAST(v_row.tenure_days / 365.0, 1.0) * 5, 2),
        'penalty',      round(-1 * LEAST(v_row.penalty_severity, 100), 2)
    );

    v_score := GREATEST(0, LEAST(100,
        (v_components ->> 'completion')::numeric
        + (v_components ->> 'on_time')::numeric
        + (v_components ->> 'reviews')::numeric
        + (v_components ->> 'dispute_free')::numeric
        + (v_components ->> 'workload')::numeric
        + (v_components ->> 'tenure')::numeric
        + (v_components ->> 'penalty')::numeric
    ));

    v_level := org.fn_level_for_score (v_score, v_row.stages_completed);

    UPDATE org.entity_standing s
    SET score = v_score,
        level = v_level,
        components = v_components,
        level_changed_at = CASE WHEN v_level IS DISTINCT FROM v_row.level THEN now() ELSE s.level_changed_at END,
        computed_at = now()
    WHERE s.subject_type = p_subject_type AND s.subject_id = p_subject_id;

    INSERT INTO org.standing_events (subject_type, subject_id, event_type, from_level, to_level, score, components)
    VALUES (
        p_subject_type, p_subject_id,
        CASE
            WHEN v_level > v_row.level THEN 'promoted'
            WHEN v_level < v_row.level THEN 'demoted'
            ELSE 'recomputed'
        END,
        v_row.level, v_level, v_score, v_components
    );

    PERFORM analytics.fn_emit (
        'standing.recomputed', p_subject_type::text::analytics.subject_kind, p_subject_id,
        jsonb_build_object('score', v_score, 'level', v_level, 'components', v_components),
        v_score, NULL, 'standing'
    );

    IF v_level IS DISTINCT FROM v_row.level THEN
        PERFORM analytics.fn_emit (
            'standing.level_changed', p_subject_type::text::analytics.subject_kind, p_subject_id,
            jsonb_build_object(
                'from_level', v_row.level,
                'to_level', v_level,
                'direction', CASE WHEN v_level > v_row.level THEN 'up' ELSE 'down' END,
                'score', v_score
            ),
            v_level, NULL, 'standing'
        );
    END IF;

    RETURN v_level;
END;
$$;

-- Idempotent award. Returns true only on the first grant, so the caller can fire a celebration once.
CREATE OR REPLACE FUNCTION org.fn_award_achievement(
    p_subject_type org.standing_subject,
    p_subject_id uuid,
    p_code text,
    p_source_ref uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, analytics, public
AS $$
DECLARE
    v_rows integer := 0;
    v_tier org.achievement_tier;
BEGIN
    INSERT INTO org.entity_achievements (subject_type, subject_id, achievement_code, source_ref)
    VALUES (p_subject_type, p_subject_id, p_code, p_source_ref)
    ON CONFLICT (subject_type, subject_id, achievement_code) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF v_rows > 0 THEN
        SELECT a.tier INTO v_tier FROM org.achievements a WHERE a.code = p_code;
        PERFORM analytics.fn_emit (
            'achievement.awarded', p_subject_type::text::analytics.subject_kind, p_subject_id,
            jsonb_build_object('code', p_code, 'tier', v_tier), NULL, NULL, 'standing'
        );
    END IF;

    RETURN v_rows > 0;
END;
$$;

-- Extend a streak on a good outcome; reset it on a bad one. Quality events only.
CREATE OR REPLACE FUNCTION org.fn_touch_streak(
    p_subject_type org.standing_subject,
    p_subject_id uuid,
    p_kind org.streak_kind,
    p_success boolean
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, analytics, public
AS $$
DECLARE
    v_current integer;
    v_best integer;
    v_previous integer;
BEGIN
    INSERT INTO org.quality_streaks (subject_type, subject_id, kind)
    VALUES (p_subject_type, p_subject_id, p_kind)
    ON CONFLICT (subject_type, subject_id, kind) DO NOTHING;

    SELECT s.current_count INTO v_previous FROM org.quality_streaks s
    WHERE s.subject_type = p_subject_type AND s.subject_id = p_subject_id AND s.kind = p_kind;

    UPDATE org.quality_streaks s
    SET current_count = CASE WHEN p_success THEN s.current_count + 1 ELSE 0 END,
        best_count = CASE WHEN p_success THEN GREATEST(s.best_count, s.current_count + 1) ELSE s.best_count END,
        last_event_at = now(),
        broken_at = CASE WHEN p_success THEN s.broken_at ELSE now() END
    WHERE s.subject_type = p_subject_type AND s.subject_id = p_subject_id AND s.kind = p_kind
    RETURNING s.current_count, s.best_count INTO v_current, v_best;

    IF p_success THEN
        PERFORM analytics.fn_emit (
            'streak.extended', p_subject_type::text::analytics.subject_kind, p_subject_id,
            jsonb_build_object('kind', p_kind, 'current_count', v_current, 'best_count', v_best),
            v_current, NULL, 'standing'
        );
    ELSIF COALESCE(v_previous, 0) > 0 THEN
        PERFORM analytics.fn_emit (
            'streak.broken', p_subject_type::text::analytics.subject_kind, p_subject_id,
            jsonb_build_object('kind', p_kind, 'previous_count', v_previous),
            v_previous, NULL, 'standing'
        );
    END IF;

    RETURN v_current;
END;
$$;

-- Record delivery against a CREATE category and re-derive the subject's specialisation shares.
CREATE OR REPLACE FUNCTION org.fn_record_mastery(
    p_subject_type org.standing_subject,
    p_subject_id uuid,
    p_category org.create_category,
    p_intensity numeric DEFAULT 1.0,
    p_on_time boolean DEFAULT true
)
RETURNS smallint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = org, analytics, public
AS $$
DECLARE
    v_total numeric;
    v_row org.create_mastery%ROWTYPE;
    v_level smallint;
BEGIN
    INSERT INTO org.create_mastery (subject_type, subject_id, category)
    VALUES (p_subject_type, p_subject_id, p_category)
    ON CONFLICT (subject_type, subject_id, category) DO NOTHING;

    UPDATE org.create_mastery m
    SET stages_completed = m.stages_completed + 1,
        intensity_delivered = m.intensity_delivered + GREATEST(COALESCE(p_intensity, 1.0), 0),
        on_time_rate = ((m.on_time_rate * m.stages_completed) + CASE WHEN p_on_time THEN 1 ELSE 0 END)
                       / (m.stages_completed + 1),
        updated_at = now()
    WHERE m.subject_type = p_subject_type AND m.subject_id = p_subject_id AND m.category = p_category;

    SELECT COALESCE(sum(m.intensity_delivered), 0) INTO v_total FROM org.create_mastery m
    WHERE m.subject_type = p_subject_type AND m.subject_id = p_subject_id;

    -- Share is intensity-weighted, so specialisation reflects effort delivered, not stage count.
    UPDATE org.create_mastery m
    SET share_bp = CASE WHEN v_total > 0 THEN LEAST(10000, round((m.intensity_delivered / v_total) * 10000)::integer) ELSE 0 END,
        mastery_level = LEAST(5, width_bucket(m.intensity_delivered, 0, 250, 5))::smallint
    WHERE m.subject_type = p_subject_type AND m.subject_id = p_subject_id;

    SELECT * INTO v_row FROM org.create_mastery m
    WHERE m.subject_type = p_subject_type AND m.subject_id = p_subject_id AND m.category = p_category;

    v_level := v_row.mastery_level;

    PERFORM analytics.fn_emit (
        'mastery.progressed', p_subject_type::text::analytics.subject_kind, p_subject_id,
        jsonb_build_object(
            'category', p_category,
            'stages_completed', v_row.stages_completed,
            'mastery_level', v_level,
            'share_bp', v_row.share_bp
        ),
        v_level, NULL, 'standing'
    );

    RETURN v_level;
END;
$$;

GRANT EXECUTE ON FUNCTION org.fn_level_for_score(numeric, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION org.fn_standing_level(org.standing_subject, uuid) TO authenticated;
-- Mutating functions stay service-role/definer-callable only: Standing is EARNED, never client-written.
REVOKE ALL ON FUNCTION org.fn_recompute_standing(org.standing_subject, uuid) FROM public;
REVOKE ALL ON FUNCTION org.fn_award_achievement(org.standing_subject, uuid, text, uuid) FROM public;
REVOKE ALL ON FUNCTION org.fn_touch_streak(org.standing_subject, uuid, org.streak_kind, boolean) FROM public;
REVOKE ALL ON FUNCTION org.fn_record_mastery(org.standing_subject, uuid, org.create_category, numeric, boolean) FROM public;
GRANT EXECUTE ON FUNCTION org.fn_recompute_standing(org.standing_subject, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION org.fn_award_achievement(org.standing_subject, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION org.fn_touch_streak(org.standing_subject, uuid, org.streak_kind, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION org.fn_record_mastery(org.standing_subject, uuid, org.create_category, numeric, boolean) TO service_role;
-- #endregion

-- #region 9. Tunable parameters
INSERT INTO security.platform_params (key, value, description) VALUES
    ('standing_recompute_interval_hours', '24'::jsonb,
        'How often the Standing sweep re-derives org.entity_standing from its metric inputs.'),
    ('standing_demotion_grace_days', '30'::jsonb,
        'Grace window before a score drop is allowed to demote a subject a rung (prevents rung flapping).')
ON CONFLICT (key) DO NOTHING;
-- #endregion
