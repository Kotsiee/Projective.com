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

    PERFORM org.fn_refresh_active_adornments (p_subject_type, p_subject_id);
    IF p_subject_type = 'freelancer' THEN
        PERFORM org.fn_refresh_verification_stamp (p_subject_id);
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
-- #endregion

-- #region 9. Trust signals — the verification stamp and the earned adornments (Decision #155)

-- The strongest verification authority behind a person: payout-verified needs identity AND a verified
-- payout account (the finance.fn_freelancer_payout_ready pair), so the stamp can never outrank the
-- identity check beneath it; else identity-verified; else none.
CREATE OR REPLACE FUNCTION org.fn_verification_stamp(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT CASE
            WHEN fp.kyc_status = 'verified'::finance.kyc_status AND fp.payout_ready THEN 'vault_verified'
            WHEN fp.kyc_status = 'verified'::finance.kyc_status THEN 'id_verified'
            ELSE 'none'
        END
        FROM org.freelancer_profiles fp
        WHERE fp.user_id = p_user_id
    ), 'none');
$$;

-- Write the derived stamp onto the person's Standing row. A row is created only when there is a stamp
-- to hold, so a person with no row reads as 'none' everywhere.
CREATE OR REPLACE FUNCTION org.fn_refresh_verification_stamp(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_stamp text := org.fn_verification_stamp (p_user_id);
BEGIN
    IF v_stamp = 'none' THEN
        UPDATE org.entity_standing es
        SET verification_stamp = 'none'
        WHERE es.subject_type = 'freelancer'::org.standing_subject
          AND es.subject_id = p_user_id
          AND es.verification_stamp <> 'none';
    ELSE
        INSERT INTO org.entity_standing AS es (subject_type, subject_id, verification_stamp)
        VALUES ('freelancer'::org.standing_subject, p_user_id, v_stamp)
        ON CONFLICT (subject_type, subject_id) DO UPDATE
        SET verification_stamp = EXCLUDED.verification_stamp
        WHERE es.verification_stamp IS DISTINCT FROM EXCLUDED.verification_stamp;
    END IF;
    RETURN v_stamp;
END;
$$;

-- Attached AFTER INSERT OR UPDATE OF kyc_status, payout_ready ON org.freelancer_profiles (00001830):
-- the KYC webhook and finance.sync_payout_account are the only writers of those two columns, so the
-- stamp moves the moment the evidence does.
CREATE OR REPLACE FUNCTION org.trg_freelancer_profiles_verification_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM org.fn_refresh_verification_stamp (NEW.user_id);
    RETURN NULL;
END;
$$;

-- The earned trust signals: six dimensions of three tiers, every threshold read from the delivery
-- record — never from points. A dimension contributes the HIGHEST tier whose own evidence holds, so at
-- most six slugs are stored, in dimension order. Volume floors keep one engagement from earning a
-- signal. A person earns as 'freelancer' and a team as 'team'; a 'user' subject earns none, because
-- buyers are not gamified (PRODUCT_SPEC §Standing, Mastery & Progression). Called by
-- org.fn_recompute_standing, so the Standing sweep materialises the signals. Returns what it stored.
--
--   communication  quick_replies <4h · fast_replies <1h · instant_dispatch <15m — the median first
--                  response (search.talent_signals), evidenced by a live fast_response streak ≥ 5
--   turnaround     on_schedule: on_time_delivery streak ≥ 10 · rapid_turnaround: mean claim → accepted
--                  submission < 48h · same_day_delivery: < 24h (both over ≥ 5 delivered tickets)
--   integrity      first_pass_approved: 10 completed stages with no revision round · dispute_free:
--                  dispute_free streak ≥ 20 · flawless_execution: 50 stages and no disputed escrow
--   retention      repeat_favorite: the repeat_client achievement · high_retention: > 40% of ≥ 5
--                  engagements from returning clients · retained_partner: still delivering on a
--                  Pipeline first joined more than six months ago
--   sentiment      rated_4_8: ≥ 4.80 over ≥ 5 reviews · top_reviews: ≥ 4.95 over ≥ 10 ·
--                  100_percent_recommended: 50 stages and not one review below 5
--   mastery        create_specialist: one CREATE category > 60% of delivered intensity (≥ 5 stages
--                  in it) · squad_verified: a team with ≥ 10 stages and a payout split ·
--                  architect_tier: the architect designation
CREATE OR REPLACE FUNCTION org.fn_refresh_active_adornments(
    p_subject_type org.standing_subject,
    p_subject_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_team boolean := p_subject_type = 'team'::org.standing_subject;
    v_stages integer := 0;
    v_rating numeric := 0;
    v_rating_count integer := 0;
    v_fast_streak integer := 0;
    v_on_time_streak integer := 0;
    v_dispute_streak integer := 0;
    v_response_hours numeric;
    v_turnaround_n integer := 0;
    v_turnaround_hours numeric;
    v_first_pass integer := 0;
    v_disputes integer := 0;
    v_projects integer := 0;
    v_repeat_projects integer := 0;
    v_retained boolean := false;
    v_below_five boolean := false;
    v_pick text;
    v_slugs text[] := '{}'::text[];
BEGIN
    IF p_subject_type = 'user'::org.standing_subject THEN
        UPDATE org.entity_standing es
        SET active_adornments = '{}'::text[]
        WHERE es.subject_type = p_subject_type AND es.subject_id = p_subject_id
          AND cardinality(es.active_adornments) > 0;
        RETURN v_slugs;
    END IF;

    SELECT es.stages_completed, es.client_rating_avg INTO v_stages, v_rating
    FROM org.entity_standing es
    WHERE es.subject_type = p_subject_type AND es.subject_id = p_subject_id;
    v_stages := COALESCE(v_stages, 0);
    v_rating := COALESCE(v_rating, 0);

    v_rating_count := COALESCE(CASE WHEN v_team
        THEN (SELECT t.rating_count FROM org.teams t WHERE t.id = p_subject_id)
        ELSE (SELECT fp.rating_count FROM org.freelancer_profiles fp WHERE fp.user_id = p_subject_id)
    END, 0);

    SELECT
        COALESCE(max(qs.current_count) FILTER (WHERE qs.kind = 'fast_response'::org.streak_kind), 0),
        COALESCE(max(qs.current_count) FILTER (WHERE qs.kind = 'on_time_delivery'::org.streak_kind), 0),
        COALESCE(max(qs.current_count) FILTER (WHERE qs.kind = 'dispute_free'::org.streak_kind), 0)
    INTO v_fast_streak, v_on_time_streak, v_dispute_streak
    FROM org.quality_streaks qs
    WHERE qs.subject_type = p_subject_type AND qs.subject_id = p_subject_id;

    SELECT ts.response_time_hours INTO v_response_hours
    FROM search.talent_signals ts
    WHERE ts.entity_id = p_subject_id
      AND ts.entity_type = p_subject_type::text::search.profile_entity_type;

    WITH held AS (
        SELECT tk.id
        FROM projects.tickets tk
        WHERE NOT v_team AND tk.current_assignee_id = p_subject_id
          AND tk.status = 'completed'::public.ticket_status
        UNION
        SELECT tk.id
        FROM projects.stage_assignments sa
        JOIN projects.tickets tk ON tk.current_stage_id = sa.project_stage_id
        WHERE v_team AND sa.team_id = p_subject_id
          AND tk.status = 'completed'::public.ticket_status
    ),
    spans AS (
        SELECT
            (SELECT max(ss.created_at) FROM projects.stage_submissions ss
              WHERE ss.ticket_id = h.id AND ss.status = 'accepted') AS delivered_at,
            (SELECT min(th.created_at) FROM projects.ticket_history th
              WHERE th.ticket_id = h.id
                AND th.new_status IN ('claimed'::public.ticket_status, 'in_progress'::public.ticket_status))
                AS started_at
        FROM held h
    )
    SELECT count(*)::integer, avg(extract(epoch FROM (s.delivered_at - s.started_at)) / 3600.0)
    INTO v_turnaround_n, v_turnaround_hours
    FROM spans s
    WHERE s.delivered_at IS NOT NULL AND s.started_at IS NOT NULL AND s.delivered_at >= s.started_at;

    SELECT count(DISTINCT sa.project_stage_id)::integer INTO v_first_pass
    FROM projects.stage_assignments sa
    JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
    WHERE ps.completed_at IS NOT NULL
      AND CASE WHEN v_team THEN sa.team_id = p_subject_id ELSE sa.freelancer_profile_id = p_subject_id END
      AND NOT EXISTS (
          SELECT 1 FROM projects.stage_submissions ss
          WHERE ss.project_stage_id = sa.project_stage_id
            AND (ss.status = 'revisions_requested' OR ss.revision_of IS NOT NULL)
      );

    SELECT count(*)::integer INTO v_disputes
    FROM finance.escrows e
    WHERE e.payee_type::text = p_subject_type::text AND e.payee_id = p_subject_id
      AND e.status = 'disputed';

    WITH engagements AS (
        SELECT DISTINCT COALESCE(e.payer_business_id, e.payer_user_id) AS payer, ps.project_id
        FROM finance.escrows e
        JOIN projects.project_stages ps ON ps.id = e.project_stage_id
        WHERE e.payee_type::text = p_subject_type::text AND e.payee_id = p_subject_id
          AND e.status <> 'refunded'
    ),
    per_payer AS (
        SELECT g.payer, count(*)::integer AS projects FROM engagements g GROUP BY g.payer
    )
    SELECT COALESCE(sum(pp.projects), 0)::integer,
           COALESCE(sum(pp.projects) FILTER (WHERE pp.projects >= 2), 0)::integer
    INTO v_projects, v_repeat_projects
    FROM per_payer pp;

    v_retained := EXISTS (
        SELECT 1
        FROM projects.stage_assignments sa
        JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
        JOIN projects.projects p ON p.id = ps.project_id
        WHERE p.format = 'pipeline'::public.project_format
          AND CASE WHEN v_team THEN sa.team_id = p_subject_id ELSE sa.freelancer_profile_id = p_subject_id END
          AND sa.created_at <= now() - interval '6 months'
          AND EXISTS (
              SELECT 1
              FROM projects.stage_assignments cur
              JOIN projects.project_stages cps ON cps.id = cur.project_stage_id
              WHERE cps.project_id = p.id
                AND cps.completed_at IS NULL
                AND cur.status IN ('active', 'assigned')
                AND CASE WHEN v_team THEN cur.team_id = p_subject_id
                         ELSE cur.freelancer_profile_id = p_subject_id END
          )
    );

    v_below_five := EXISTS (
        SELECT 1 FROM reviews.entity_reviews r
        WHERE r.target_entity_id = p_subject_id
          AND r.target_entity_type = p_subject_type::text::reviews.review_target_type
          AND r.rating < 5
    );

    v_pick := CASE
        WHEN v_fast_streak < 5 OR v_response_hours IS NULL THEN NULL
        WHEN v_response_hours < 0.25 THEN 'instant_dispatch'
        WHEN v_response_hours < 1 THEN 'fast_replies'
        WHEN v_response_hours < 4 THEN 'quick_replies'
    END;
    IF v_pick IS NOT NULL THEN v_slugs := v_slugs || v_pick; END IF;

    v_pick := CASE
        WHEN v_turnaround_n >= 5 AND v_turnaround_hours < 24 THEN 'same_day_delivery'
        WHEN v_turnaround_n >= 5 AND v_turnaround_hours < 48 THEN 'rapid_turnaround'
        WHEN v_on_time_streak >= 10 THEN 'on_schedule'
    END;
    IF v_pick IS NOT NULL THEN v_slugs := v_slugs || v_pick; END IF;

    v_pick := CASE
        WHEN v_stages >= 50 AND v_disputes = 0 THEN 'flawless_execution'
        WHEN v_dispute_streak >= 20 THEN 'dispute_free'
        WHEN v_first_pass >= 10 THEN 'first_pass_approved'
    END;
    IF v_pick IS NOT NULL THEN v_slugs := v_slugs || v_pick; END IF;

    v_pick := CASE
        WHEN v_retained THEN 'retained_partner'
        WHEN v_projects >= 5 AND v_repeat_projects::numeric / v_projects > 0.40 THEN 'high_retention'
        WHEN EXISTS (
            SELECT 1 FROM org.entity_achievements ea
            WHERE ea.subject_type = p_subject_type AND ea.subject_id = p_subject_id
              AND ea.achievement_code = 'repeat_client'
        ) THEN 'repeat_favorite'
    END;
    IF v_pick IS NOT NULL THEN v_slugs := v_slugs || v_pick; END IF;

    v_pick := CASE
        WHEN v_stages >= 50 AND v_rating_count > 0 AND NOT v_below_five THEN '100_percent_recommended'
        WHEN v_rating_count >= 10 AND v_rating >= 4.95 THEN 'top_reviews'
        WHEN v_rating_count >= 5 AND v_rating >= 4.80 THEN 'rated_4_8'
    END;
    IF v_pick IS NOT NULL THEN v_slugs := v_slugs || v_pick; END IF;

    v_pick := CASE
        WHEN EXISTS (
            SELECT 1 FROM org.entity_achievements ea
            WHERE ea.subject_type = p_subject_type AND ea.subject_id = p_subject_id
              AND ea.achievement_code = 'architect'
        ) THEN 'architect_tier'
        WHEN v_team AND v_stages >= 10 AND (
            EXISTS (SELECT 1 FROM finance.split_rules sr WHERE sr.team_id = p_subject_id AND sr.active)
            OR EXISTS (SELECT 1 FROM finance.contribution_agreements ca WHERE ca.team_id = p_subject_id)
        ) THEN 'squad_verified'
        WHEN EXISTS (
            SELECT 1 FROM org.create_mastery m
            WHERE m.subject_type = p_subject_type AND m.subject_id = p_subject_id
              AND m.share_bp > 6000 AND m.stages_completed >= 5
        ) THEN 'create_specialist'
    END;
    IF v_pick IS NOT NULL THEN v_slugs := v_slugs || v_pick; END IF;

    UPDATE org.entity_standing es
    SET active_adornments = v_slugs
    WHERE es.subject_type = p_subject_type AND es.subject_id = p_subject_id
      AND es.active_adornments IS DISTINCT FROM v_slugs;

    RETURN v_slugs;
END;
$$;
-- #endregion
