CREATE SCHEMA IF NOT EXISTS reviews;

CREATE TYPE reviews.review_target_type AS ENUM ('user', 'freelancer', 'business', 'team', 'service_blueprint');

CREATE TABLE reviews.entity_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    target_entity_id uuid NOT NULL,
    target_entity_type reviews.review_target_type NOT NULL,
    reviewer_user_id uuid NOT NULL REFERENCES org.users_public (user_id),
    project_id uuid REFERENCES projects.projects (id),
    rating numeric(3, 2) NOT NULL CHECK (
        rating >= 1.0
        AND rating <= 5.0
    ),
    comment text NOT NULL CHECK (
        char_length(trim(comment)) >= 100
    ),
    reply_comment text CHECK (
        reply_comment IS NULL
        OR char_length(trim(reply_comment)) >= 100
    ),
    replied_at timestamp
    with
        time zone,
        created_at timestamp
    with
        time zone DEFAULT now(),
        updated_at timestamp
    with
        time zone DEFAULT now(),
        CONSTRAINT unique_review_per_project UNIQUE (
            target_entity_id,
            reviewer_user_id,
            project_id
        )
);

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

CREATE TRIGGER trg_update_ratings
AFTER INSERT OR UPDATE OR DELETE ON reviews.entity_reviews
FOR EACH ROW EXECUTE FUNCTION reviews.recalculate_entity_rating();