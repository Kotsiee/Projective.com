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
--
-- VISIBLE ONLY, AND THE LISTING TOO (Decision #487). A withdrawn or hidden review leaves every
-- average (`is_visible`). A review of a provider bought through a listing carries that listing in
-- `service_blueprint_id`, and the listing's own average is recomputed from those rows, so the card a
-- guest reads and the provider's profile are two views of the same reviews. Both the old and the new
-- row are recounted, so a move out of visibility lowers the count it left.
CREATE OR REPLACE FUNCTION reviews.fn_recount_rating(
    p_target_type reviews.review_target_type,
    p_target_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_avg numeric(3,2);
    v_count integer;
BEGIN
    IF p_target_type = 'service_blueprint' THEN
        SELECT COALESCE(ROUND(AVG(r.rating), 2), 0.0), COUNT(r.id)
        INTO v_avg, v_count
        FROM reviews.entity_reviews r
        WHERE r.is_visible
          AND (r.service_blueprint_id = p_target_id
               OR (r.target_entity_type = 'service_blueprint' AND r.target_entity_id = p_target_id));
    ELSE
        SELECT COALESCE(ROUND(AVG(r.rating), 2), 0.0), COUNT(r.id)
        INTO v_avg, v_count
        FROM reviews.entity_reviews r
        WHERE r.is_visible
          AND r.target_entity_id = p_target_id
          AND r.target_entity_type = p_target_type;
    END IF;

    CASE p_target_type
        WHEN 'user' THEN
            UPDATE org.users_public SET rating_average = v_avg, rating_count = v_count WHERE user_id = p_target_id;
        WHEN 'freelancer' THEN
            UPDATE org.freelancer_profiles SET rating_average = v_avg, rating_count = v_count WHERE user_id = p_target_id;
        WHEN 'business' THEN
            UPDATE org.business_profiles SET rating_average = v_avg, rating_count = v_count WHERE id = p_target_id;
        WHEN 'team' THEN
            UPDATE org.teams SET rating_average = v_avg, rating_count = v_count WHERE id = p_target_id;
        WHEN 'service_blueprint' THEN
            UPDATE marketplace.service_blueprints SET rating_average = v_avg, rating_count = v_count WHERE id = p_target_id;
        WHEN 'product' THEN
            UPDATE catalogue.products SET rating_average = v_avg, rating_count = v_count WHERE id = p_target_id;
    END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION reviews.recalculate_entity_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM reviews.fn_recount_rating(OLD.target_entity_type, OLD.target_entity_id);
        IF OLD.service_blueprint_id IS NOT NULL THEN
            PERFORM reviews.fn_recount_rating('service_blueprint', OLD.service_blueprint_id);
        END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF TG_OP = 'INSERT' OR (NEW.target_entity_type, NEW.target_entity_id)
                IS DISTINCT FROM (OLD.target_entity_type, OLD.target_entity_id) THEN
            PERFORM reviews.fn_recount_rating(NEW.target_entity_type, NEW.target_entity_id);
        END IF;
        IF NEW.service_blueprint_id IS NOT NULL
           AND (TG_OP = 'INSERT' OR NEW.service_blueprint_id IS DISTINCT FROM OLD.service_blueprint_id) THEN
            PERFORM reviews.fn_recount_rating('service_blueprint', NEW.service_blueprint_id);
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

-- A trigger function, never an RPC: `reviews` is exposed to PostgREST, and a definer callable over
-- the API would let anyone rewrite any entity's rating.
REVOKE ALL ON FUNCTION reviews.recalculate_entity_rating() FROM PUBLIC;
