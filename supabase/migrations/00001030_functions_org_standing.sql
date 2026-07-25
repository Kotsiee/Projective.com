-- ============================================================================
-- 00001030 functions org standing
-- Consolidated verbatim from: 20260724111000_standing_reputation.sql
-- ============================================================================

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
