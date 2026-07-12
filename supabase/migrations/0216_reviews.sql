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