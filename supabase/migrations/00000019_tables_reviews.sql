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
    -- The review's headline, rendered as the card heading on /view/[id]. NULLABLE on purpose: the
    -- 100-character `comment` below is the substance and is what the platform actually requires, so
    -- a reviewer who writes one without summarising it is making a complete review, not a broken
    -- one. NOT NULL DEFAULT '' would be worse than nullable here — it would make every titleless
    -- review indistinguishable from one whose author deliberately cleared the heading, and a reader
    -- cannot fall back to deriving one when it cannot tell the two apart. The CHECK rejects a
    -- whitespace-only heading for the same reason: '   ' claims a title that renders as nothing.
    title text CONSTRAINT entity_reviews_title_check CHECK (
        title IS NULL
        OR char_length(trim(title)) BETWEEN 1 AND 120
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
