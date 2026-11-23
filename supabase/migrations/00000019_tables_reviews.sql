-- =============================================================================================
-- 00000019_tables_reviews.sql — reviews schema tables (Category 0). Source: 0011_reviews_tables.sql.
-- =============================================================================================

-- #region entity_reviews
-- One review: a party's rating of what it completed (PRODUCT_SPEC §Reputation 3; Decision #487).
-- Every row is written by a door in 00001670 — no client role holds a write privilege on the table —
-- and every row carries the ANCHOR that proved the engagement: exactly one of the project, the cohort
-- membership or the order line (`ck_entity_reviews_one_anchor`). The seed obeys the same CHECK.
CREATE TABLE reviews.entity_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    target_entity_id uuid NOT NULL,
    target_entity_type reviews.review_target_type NOT NULL,
    reviewer_user_id uuid NOT NULL REFERENCES org.users_public (user_id),
    -- The PARTY the author wrote for when it is a business: a business client is one party however
    -- many of its members took part (Decision #244 (e), ruled by #487), so the one-per-party index in
    -- 00004014 keys on COALESCE(reviewer_business_id, reviewer_team_id, reviewer_user_id). NULL for a
    -- person.
    reviewer_business_id uuid REFERENCES org.business_profiles (id),
    -- The PARTY when a team reviews the client it worked for (Decision #486): the team is one party
    -- however many of its members held the seat. NULL otherwise.
    reviewer_team_id uuid REFERENCES org.teams (id),

    -- The anchor. An engagement is anchored on its project; a session on the attendee's cohort
    -- membership; a product on the order line that bought it. A seat released after work began, or a
    -- completed sitting, opens the review before the whole engagement ends and is kept beside the
    -- anchor it belongs to, so one engagement still yields one review per party and target.
    project_id uuid REFERENCES projects.projects (id),
    stage_assignment_id uuid REFERENCES projects.stage_assignments (id),
    cohort_membership_id uuid REFERENCES projects.cohort_memberships (id),
    session_event_id uuid REFERENCES projects.session_events (id),
    order_line_id uuid REFERENCES finance.order_lines (id),
    -- The listing the engagement was bought from, stamped by the door from the anchor, so the listing's
    -- page and average read a review of its provider without reading the provider's projects (which a
    -- guest cannot). NULL for an engagement that came from no listing.
    service_blueprint_id uuid REFERENCES marketplace.service_blueprints (id),
    -- 30 days from the anchor's completion (Decision #487 ruling 2): the author may edit until then, or
    -- until the target replies, whichever comes first.
    window_closes_at timestamptz NOT NULL,

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
    edited_at timestamptz,
    -- Withdrawn by its author, or hidden by an operator: kept, never deleted (root CLAUDE.md §5), and
    -- gone from every reader and every average (`is_visible`).
    withdrawn_at timestamptz,
    hidden_at timestamptz,
    hidden_reason text CHECK (
        hidden_reason IS NULL
        OR char_length(btrim(hidden_reason)) BETWEEN 1 AND 500
    ),
    hidden_by uuid REFERENCES org.users_public (user_id),
    -- Double-blind (Decision #486 (A)). On an engagement both sides review each other, so each side's
    -- review stays NULL here, read by its author alone, until the other side's review of it on the
    -- same anchor arrives or the window closes (reviews.fn_reveal, the `reviews-reveal` job). A
    -- one-way anchor (a session seat, a product) reveals on submit, which the default records.
    revealed_at timestamptz DEFAULT now(),
    is_visible boolean GENERATED ALWAYS AS (
        withdrawn_at IS NULL AND hidden_at IS NULL AND revealed_at IS NOT NULL
    ) STORED,

    -- One public reply, by the target's owner or a member holding its profile or listing capability;
    -- editable for 7 days (Decision #487 ruling 3).
    reply_comment text CHECK (
        reply_comment IS NULL
        OR char_length(btrim(reply_comment)) BETWEEN 1 AND 1000
    ),
    reply_user_id uuid REFERENCES org.users_public (user_id),
    replied_at timestamp
    with
        time zone,
        reply_edited_at timestamptz,
        created_at timestamp
    with
        time zone DEFAULT now(),
        updated_at timestamp
    with
        time zone DEFAULT now(),
        CONSTRAINT ck_entity_reviews_one_anchor CHECK (
            num_nonnulls (project_id, cohort_membership_id, order_line_id) = 1
        ),
        CONSTRAINT ck_entity_reviews_one_party CHECK (
            num_nonnulls (reviewer_business_id, reviewer_team_id) <= 1
        ),
        CONSTRAINT ck_entity_reviews_seat_on_project CHECK (
            stage_assignment_id IS NULL
            OR project_id IS NOT NULL
        ),
        CONSTRAINT ck_entity_reviews_sitting_on_membership CHECK (
            session_event_id IS NULL
            OR cohort_membership_id IS NOT NULL
        ),
        CONSTRAINT ck_entity_reviews_hidden CHECK (
            (hidden_at IS NULL) = (hidden_reason IS NULL)
        ),
        CONSTRAINT ck_entity_reviews_reply CHECK (
            (reply_comment IS NULL) = (replied_at IS NULL)
            AND (reply_comment IS NULL) = (reply_user_id IS NULL)
            AND (reply_edited_at IS NULL OR replied_at IS NOT NULL)
        )
);
-- #endregion

-- #region review_reminders
-- The one review reminder each person receives per anchor (Decision #487 ruling 6). Its own record,
-- never `projects.session_events.review_asked_at`, which is the attendance question of Decision #383
-- ruling R6 and decides when an unanswered sitting becomes a dispute. Written only by
-- reviews.fn_send_review_reminders (00001670); no client role reads or writes it.
CREATE TABLE reviews.review_reminders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id) ON DELETE CASCADE,
    project_id uuid REFERENCES projects.projects (id),
    cohort_membership_id uuid REFERENCES projects.cohort_memberships (id),
    asked_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_review_reminders_one_anchor CHECK (
        num_nonnulls (project_id, cohort_membership_id) = 1
    )
);
-- #endregion

-- #region client_trust_scores
-- Client Trust Score v1 (Decision #486 (B)): one row per client party, a person (`user`) or a
-- business. Written only by reviews.fn_recompute_client_trust (00001670): on every reveal, on the
-- withdrawal or hiding of a revealed review, when a dispute resolves, and by the daily
-- `reviews-reveal` job while a lost dispute ages out of its 12 months. `base` is the Bayesian mean of
-- the providers' revealed, visible reviews of the party (k = 5 at the client track's corpus mean);
-- `score` is max(1.00, base − deduction). A reader shows the score only once `review_count` reaches 3.
CREATE TABLE reviews.client_trust_scores (
    subject_type reviews.review_target_type NOT NULL CHECK (subject_type IN ('user', 'business')),
    subject_id uuid NOT NULL,
    review_count integer NOT NULL CHECK (review_count >= 0),
    base numeric(3, 2) NOT NULL CHECK (base BETWEEN 1 AND 5),
    -- Lost disputes in the trailing 12 months: opened by the party and ruled `resolved_release`.
    lost_disputes integer NOT NULL DEFAULT 0 CHECK (lost_disputes >= 0),
    -- −0.25 per lost dispute (capped at −1.00) plus −0.10 per ghosting auto-approval (capped at −0.50,
    -- dormant until Decision #337 P3 records one), stored as a positive figure.
    deduction numeric(3, 2) NOT NULL DEFAULT 0 CHECK (deduction BETWEEN 0 AND 1.5),
    score numeric(3, 2) NOT NULL CHECK (score BETWEEN 1 AND 5),
    computed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_type, subject_id)
);
-- #endregion

-- #region client_trust_consents
-- The Informed Consent (Decision #486 (C)): a freelancer acknowledged a warned client's score before
-- applying to, or accepting a hire on, one of its projects. Once per (freelancer, project), with the
-- score and review count that were shown. Written only by reviews.acknowledge_client_trust; the
-- proposal and hire doors read it (reviews.fn_assert_client_trust_consent).
CREATE TABLE reviews.client_trust_consents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id uuid NOT NULL REFERENCES org.users_public (user_id),
    project_id uuid NOT NULL REFERENCES projects.projects (id),
    subject_type reviews.review_target_type NOT NULL CHECK (subject_type IN ('user', 'business')),
    subject_id uuid NOT NULL,
    score numeric(3, 2) NOT NULL,
    review_count integer NOT NULL,
    acknowledged_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_client_trust_consents_once UNIQUE (user_id, project_id)
);
-- #endregion
