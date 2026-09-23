-- ============================================================================
-- 00001005 functions reviews
-- Consolidated verbatim from: 0011_reviews_tables.sql
-- ============================================================================

-- Recompute the denormalised rating on the entity a review targets.
--
-- TWO CORRECTIONS (2026-09-22), both invisible while every review was written by the seed as the
-- table owner:
--
--  1. The aggregate now filters by TARGET TYPE as well as target id. A person is reviewed on two
--     tracks under one id — as a client (`user` → `org.users_public`) and as a freelancer
--     (`freelancer` → `org.freelancer_profiles`) — and averaging every review with that id folded
--     each track into the other, so a freelancer's delivery rating moved when a seller reviewed them
--     as a buyer. `org.profiles_index` prints the two tracks side by side as "Split Ratings"; they
--     were the same number.
--  2. SECURITY DEFINER. As the invoker, a review INSERTed by a signed-in user fired UPDATEs on
--     somebody ELSE's profile row, which that user's RLS forbids — so the UPDATE matched nothing,
--     raised nothing, and the rating never moved for any review written through the API.
--
-- `product` joins the targets so a digital product can carry a rating at all.
CREATE OR REPLACE FUNCTION reviews.recalculate_entity_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    WHERE target_entity_id = v_target_id
      AND target_entity_type = v_target_type;

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
        WHEN 'product' THEN
            UPDATE catalogue.products SET rating_average = v_avg, rating_count = v_count WHERE id = v_target_id;
    END CASE;

    RETURN NULL;
END;
$$;

-- A trigger function, never an RPC: `reviews` is exposed to PostgREST, and a definer callable over
-- the API would let anyone rewrite any entity's rating.
REVOKE ALL ON FUNCTION reviews.recalculate_entity_rating() FROM PUBLIC;
