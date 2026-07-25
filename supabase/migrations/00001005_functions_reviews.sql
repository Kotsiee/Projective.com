-- ============================================================================
-- 00001005 functions reviews
-- Consolidated verbatim from: 0011_reviews_tables.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION reviews.recalculate_entity_rating()
RETURNS TRIGGER AS $$
DECLARE
    v_target_id uuid;
    v_target_type reviews.review_target_type;
    v_avg numeric(3,2);
    v_count integer;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_id := OLD.target_entity_id;
        v_target_type := OLD.target_entity_type;
    ELSE
        v_target_id := NEW.target_entity_id;
        v_target_type := NEW.target_entity_type;
    END IF;

    SELECT COALESCE(ROUND(AVG(rating), 2), 0.0), COUNT(id)
    INTO v_avg, v_count
    FROM reviews.entity_reviews
    WHERE target_entity_id = v_target_id;

    CASE v_target_type
        WHEN 'user' THEN
            UPDATE org.users_public SET rating_average = v_avg, rating_count = v_count WHERE user_id = v_target_id;
        WHEN 'freelancer' THEN
            UPDATE org.freelancer_profiles SET rating_average = v_avg, rating_count = v_count WHERE user_id = v_target_id;
        WHEN 'business' THEN
            UPDATE org.business_profiles SET rating_average = v_avg, rating_count = v_count WHERE id = v_target_id;
        WHEN 'team' THEN
            UPDATE org.teams SET rating_average = v_avg, rating_count = v_count WHERE id = v_target_id;
        WHEN 'service_blueprint' THEN
            UPDATE marketplace.service_blueprints SET rating_average = v_avg, rating_count = v_count WHERE id = v_target_id;
    END CASE;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
