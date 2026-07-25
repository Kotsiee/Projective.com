-- =============================================================================
-- RLS POLICIES — reviews & marketplace schemas
-- Consolidated verbatim from the original numbered migrations (Category 2:
-- Security, RLS & Permissions). Source file noted before each statement group.
-- =============================================================================


-- --- from 0215_marketplace.sql ---

CREATE POLICY "Public can view published blueprints" ON marketplace.service_blueprints FOR
SELECT TO public USING (
        is_published = true
        OR freelancer_profile_id = auth.uid ()
    );

CREATE POLICY "Freelancers manage own blueprints" ON marketplace.service_blueprints FOR ALL TO public USING (
    freelancer_profile_id = auth.uid ()
);


-- --- from 0216_reviews.sql ---

CREATE POLICY "Reviews are globally visible" ON reviews.entity_reviews FOR
SELECT TO public USING (true);

CREATE POLICY "Users can write their own reviews" ON reviews.entity_reviews FOR
INSERT
    TO public
WITH
    CHECK (
        reviewer_user_id = auth.uid ()
    );

CREATE POLICY "Users can update their own reviews" ON reviews.entity_reviews FOR
UPDATE TO public USING (
    reviewer_user_id = auth.uid ()
);

CREATE POLICY "Users can delete their own reviews" ON reviews.entity_reviews FOR DELETE TO public USING (
    reviewer_user_id = auth.uid ()
);
