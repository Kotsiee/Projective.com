-- =============================================================================================
-- 00000019_tables_reviews.sql — reviews schema tables (Category 0). Source: 0011_reviews_tables.sql.
-- =============================================================================================

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
