-- =============================================================================================
-- 00004014_indexes_reviews.sql — reviews schema indexes (Category 4; Decision #487).
-- =============================================================================================

-- #region One review per party, target and anchor
-- Ruling 4 (#244 (e)): one review per (anchor, reviewing party, target), a business client being one
-- party however many of its members took part, and so is a team reviewing its client (Decision
-- #486). Withdrawn and hidden reviews still count: a party that withdrew its review does not get a
-- second one. reviews.submit_review answers the violation with PT409.
CREATE UNIQUE INDEX uq_entity_reviews_one_per_party ON reviews.entity_reviews (
    (COALESCE(project_id, cohort_membership_id, order_line_id)),
    (COALESCE(reviewer_business_id, reviewer_team_id, reviewer_user_id)),
    target_entity_type,
    target_entity_id
);
-- #endregion

-- #region The readers
-- A profile's or a product's reviews, newest first (org.get_profile_reviews, the /view reader, the
-- rating trigger).
CREATE INDEX idx_entity_reviews_target ON reviews.entity_reviews (
    target_entity_type, target_entity_id, created_at DESC
) WHERE is_visible;

-- A service listing's reviews, through the listing its engagement was bought from.
CREATE INDEX idx_entity_reviews_listing ON reviews.entity_reviews (
    service_blueprint_id, created_at DESC
) WHERE service_blueprint_id IS NOT NULL AND is_visible;

-- What a person wrote (the data export, reviews.get_reviewables).
CREATE INDEX idx_entity_reviews_reviewer ON reviews.entity_reviews (reviewer_user_id);

-- The anchors (reviews.get_reviewables, the reminder job).
CREATE INDEX idx_entity_reviews_project ON reviews.entity_reviews (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_entity_reviews_membership ON reviews.entity_reviews (cohort_membership_id)
    WHERE cohort_membership_id IS NOT NULL;

-- A paired review waiting for its counterpart or its window (the `reviews-reveal` job).
CREATE INDEX idx_entity_reviews_unrevealed ON reviews.entity_reviews (window_closes_at)
    WHERE revealed_at IS NULL;
-- #endregion

-- #region One reminder per person and anchor
CREATE UNIQUE INDEX uq_review_reminders_once ON reviews.review_reminders (
    user_id,
    (COALESCE(cohort_membership_id, project_id))
);
-- #endregion
