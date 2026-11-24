-- =============================================================================================
-- 00001670_functions_reviews_doors.sql — the doors a review is written through (Category 1;
-- Decisions #487 (RV1) and #486 (RV2); PRODUCT_SPEC §Reputation 3).
--
-- `reviews.entity_reviews` grants no client role a write privilege (00002500 / 00002520), so these
-- definers are the only writers. Eligibility lives here, once:
--
--   who      the client party of a completed engagement reviews each provider who held a seat on it
--            (or the provider of the listing it was bought from); the client party of an engagement
--            still running reviews a provider whose seat was released after work began; the attendee
--            of a completed sitting, or of a completed cohort membership, reviews the session's
--            provider. Each provider who worked on an engagement reviews its client party back on the
--            same anchor (#486). A business client is one party, and so is a team provider. Nobody
--            reviews themselves, their own team or their own business, and a 13–17 account never
--            writes one. A product review waits for CK1's delivery record (ruling 5).
--   reveal   double-blind on an engagement: each side's review is its author's alone until the other
--            side's arrives (the second submit reveals the pair) or the window closes (the
--            `reviews-reveal` job); a session review reveals on submit. `review.received` fires at
--            reveal.
--   trust    the Client Trust Score v1 of a client party, recomputed on reveal, on the edit,
--            withdrawal or hiding of a revealed review, when a dispute resolves, and daily; below
--            3.00 from 3 reviews it warns, and a proposal or a hire acceptance needs the
--            freelancer's acknowledgement first.
--   when     30 days from the anchor's completion; the author edits until then or until the target
--            replies, whichever comes first; the author withdraws at any time (kept, hidden).
--   reply    one public reply by the target's owner or a member holding its profile or listing
--            capability, editable for 7 days.
--
-- Refusals, each with its own SQLSTATE (supabase/probes/reviews_writer.sql):
--   42501  not signed in; hide_review by anyone but an operator
--   PM403  a 13–17 account
--   22023  a rating, title, comment or reply outside its bounds; an unknown anchor kind
--   PT404  no such anchor, or nothing on it this target can be reviewed for; a withdrawn or hidden
--          review
--   PT403  the caller is not the anchor's reviewing party, not the review's author, or may not answer
--          for its target
--   PT422  a review of oneself, one's own team or one's own business
--   PT410  the window is closed (a review, an edit, a reply edit)
--   PT409  a review by this party of this target on this anchor exists; an edit after the reply; a
--          second reply
--   PT501  a product review, until CK1 records a delivery
--   PT428  a proposal to, or acceptance of a hire on, a warned client's project before the
--          freelancer acknowledged the warning (reviews.fn_assert_client_trust_consent)
--
-- Grants by name in 00002510; the reminder and reveal jobs in 00005060; the seat clock trigger in
-- 00001850; the dispute trigger in 00001800. Probes: reviews_writer.sql, reviews_reciprocal.sql.
-- =============================================================================================

-- #region Windows
/** The review window: an anchor is reviewable for this long after it completed (ruling 2). */
CREATE OR REPLACE FUNCTION reviews.fn_review_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT interval '30 days' $$;

/** How long a reply stays editable (ruling 3). */
CREATE OR REPLACE FUNCTION reviews.fn_reply_edit_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT interval '7 days' $$;

/** How long after an anchor opens its one reminder is sent (the catalogue row's lead time). */
CREATE OR REPLACE FUNCTION reviews.fn_reminder_lead()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT interval '3 days' $$;
-- #endregion

-- #region The seat clock
-- Stamps `projects.stage_assignments.ended_at` when a seat moves into an ended status, so a review of
-- a provider who left mid-engagement has an instant to count 30 days from. The writers of the status
-- (projects.remove_project_member, set_project_status, the completion doors) are not edited: the
-- stamp follows the move. The stamp is pinned whoever writes: an update that leaves the status alone
-- keeps the stamp it had, and only the table's owner (the seed) may supply one on insert.
CREATE OR REPLACE FUNCTION projects.trg_stage_assignment_ended_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
        NEW.ended_at := OLD.ended_at;
    ELSIF NEW.status IN ('completed', 'released', 'cancelled') THEN
        NEW.ended_at := CASE
            WHEN TG_OP = 'INSERT' AND current_user NOT IN ('anon', 'authenticated')
                THEN COALESCE(NEW.ended_at, pg_catalog.now())
            ELSE pg_catalog.now()
        END;
    ELSE
        NEW.ended_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

-- #region Who may be reviewed on an anchor
/**
 * The providers `p_user` may review on project `p_project` as its client party, each with the
 * instant the review opened and, when a released seat opened it, that seat. Empty when `p_user` is
 * not the client party. The window is NOT applied here: a caller sees a closed item as closed.
 *
 * The client person is COALESCE(client_user_id, owner_user_id) (00000015). A business client is one
 * party: its client person and any active member holding `hire` write for it.
 */
CREATE OR REPLACE FUNCTION reviews.fn_engagement_targets(p_project uuid, p_user uuid)
RETURNS TABLE (
    target_type reviews.review_target_type,
    target_id uuid,
    stage_assignment_id uuid,
    opened_at timestamptz,
    business_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_p projects.projects;
    v_client uuid;
    v_business uuid;
    v_completed timestamptz;
BEGIN
    SELECT * INTO v_p FROM projects.projects p WHERE p.id = p_project;
    IF NOT FOUND OR p_user IS NULL THEN
        RETURN;
    END IF;
    v_client := COALESCE(v_p.client_user_id, v_p.owner_user_id);
    IF v_p.client_business_id IS NOT NULL THEN
        IF p_user <> v_client
           AND NOT ('hire'::org.workspace_capability
                    = ANY (org.fn_member_capabilities('business', v_p.client_business_id, p_user))) THEN
            RETURN;
        END IF;
        v_business := v_p.client_business_id;
    ELSIF p_user <> v_client THEN
        RETURN;
    END IF;

    IF v_p.status = 'completed'::public.project_status THEN
        SELECT pg_catalog.max(h.created_at) INTO v_completed
          FROM projects.project_status_history h
         WHERE h.project_id = p_project AND h.to_status = 'completed'::public.project_status;
    END IF;

    RETURN QUERY
    WITH seats AS (
        SELECT CASE WHEN sa.assignee_type::text = 'team' THEN 'team' ELSE 'freelancer' END
                   ::reviews.review_target_type AS t_type,
               CASE WHEN sa.assignee_type::text = 'team' THEN sa.team_id ELSE sa.freelancer_profile_id END AS t_id,
               sa.id AS seat_id, sa.status, sa.ended_at, sa.project_stage_id
          FROM projects.stage_assignments sa
          JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
         WHERE ps.project_id = p_project
    ),
    listing_owner AS (
        SELECT CASE WHEN b.owner_type = 'team' THEN 'team' ELSE 'freelancer' END
                   ::reviews.review_target_type AS t_type,
               CASE WHEN b.owner_type = 'team' THEN b.owner_team_id ELSE b.freelancer_profile_id END AS t_id
          FROM marketplace.service_blueprints b
         WHERE b.id = v_p.source_blueprint_id
    ),
    candidates AS (
        SELECT s.t_type, s.t_id, NULL::uuid AS seat_id, v_completed AS opened
          FROM seats s
         WHERE v_completed IS NOT NULL AND s.status IN ('accepted', 'completed', 'released')
        UNION ALL
        SELECT l.t_type, l.t_id, NULL::uuid, v_completed
          FROM listing_owner l
         WHERE v_completed IS NOT NULL
        UNION ALL
        SELECT s.t_type, s.t_id, s.seat_id, s.ended_at
          FROM seats s
         WHERE v_completed IS NULL
           AND v_p.status <> 'draft'::public.project_status
           AND s.status = 'released'
           AND s.ended_at IS NOT NULL
           AND EXISTS (
               SELECT 1 FROM projects.stage_submissions sub
                WHERE sub.project_stage_id = s.project_stage_id
                  AND (sub.submitted_by = s.t_id
                       OR (s.t_type = 'team' AND EXISTS (
                           SELECT 1 FROM org.team_members tm
                            WHERE tm.team_id = s.t_id AND tm.user_id = sub.submitted_by))))
    )
    SELECT DISTINCT ON (c.t_type, c.t_id) c.t_type, c.t_id, c.seat_id, c.opened, v_business
      FROM candidates c
     WHERE c.t_id IS NOT NULL
     ORDER BY c.t_type, c.t_id, c.opened DESC;
END;
$$;

/**
 * The provider `p_user` may review on cohort membership `p_membership`, and the instant it opened:
 * the latest completed sitting of the cohort, or the membership's own completion (its seat escrow's
 * release), whichever is later. Empty when the membership is not `p_user`'s, is cancelled, or nothing
 * has completed yet.
 */
CREATE OR REPLACE FUNCTION reviews.fn_session_targets(p_membership uuid, p_user uuid)
RETURNS TABLE (
    target_type reviews.review_target_type,
    target_id uuid,
    session_event_id uuid,
    opened_at timestamptz,
    project_id uuid,
    service_blueprint_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cm projects.cohort_memberships;
    v_p projects.projects;
    v_sitting uuid;
    v_sitting_end timestamptz;
    v_released timestamptz;
    v_opened timestamptz;
BEGIN
    SELECT * INTO v_cm FROM projects.cohort_memberships cm WHERE cm.id = p_membership;
    IF NOT FOUND OR p_user IS NULL OR v_cm.user_id <> p_user OR v_cm.status = 'cancelled' THEN
        RETURN;
    END IF;
    SELECT p.* INTO v_p
      FROM projects.cohorts c JOIN projects.projects p ON p.id = c.project_id
     WHERE c.id = v_cm.cohort_id;

    SELECT se.id, se.end_time INTO v_sitting, v_sitting_end
      FROM projects.session_events se
     WHERE se.cohort_id = v_cm.cohort_id AND se.status = 'completed'::projects.session_event_status
     ORDER BY se.end_time DESC, se.id
     LIMIT 1;
    IF v_cm.status = 'completed' THEN
        SELECT pg_catalog.max(e.released_at) INTO v_released
          FROM finance.escrows e
         WHERE e.cohort_membership_id = v_cm.id AND e.status = 'released';
    END IF;
    v_opened := GREATEST(v_sitting_end, v_released);
    IF v_opened IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT CASE WHEN b.owner_type = 'team' THEN 'team' ELSE 'freelancer' END::reviews.review_target_type,
           CASE WHEN b.owner_type = 'team' THEN b.owner_team_id ELSE b.freelancer_profile_id END,
           v_sitting, v_opened, v_p.id, b.id
      FROM marketplace.service_blueprints b
     WHERE b.id = v_p.source_blueprint_id
    UNION ALL
    SELECT 'freelancer'::reviews.review_target_type, v_p.owner_user_id, v_sitting, v_opened, v_p.id, NULL::uuid
     WHERE v_p.source_blueprint_id IS NULL;
END;
$$;

/**
 * The client party `p_user` may review on project `p_project` as a provider who worked on it
 * (Decision #486): its business, or its client person, with the instant the review opened and, when a
 * released seat opened it, that seat. A seat counts as for the client's own review of the provider
 * (fn_engagement_targets): an accepted, completed or released seat on a completed engagement, the
 * listing's provider of one, or on a running engagement a seat released after its holder submitted
 * work. A team's seat is the team's, and whoever may answer for the team writes for it (`team_id`;
 * the person's own seat comes first). Empty when `p_user` worked on none of it.
 */
CREATE OR REPLACE FUNCTION reviews.fn_client_targets(p_project uuid, p_user uuid)
RETURNS TABLE (
    target_type reviews.review_target_type,
    target_id uuid,
    stage_assignment_id uuid,
    opened_at timestamptz,
    team_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_p projects.projects;
    v_completed timestamptz;
BEGIN
    SELECT * INTO v_p FROM projects.projects p WHERE p.id = p_project;
    IF NOT FOUND OR p_user IS NULL OR v_p.status = 'draft'::public.project_status THEN
        RETURN;
    END IF;
    IF v_p.status = 'completed'::public.project_status THEN
        SELECT pg_catalog.max(h.created_at) INTO v_completed
          FROM projects.project_status_history h
         WHERE h.project_id = p_project AND h.to_status = 'completed'::public.project_status;
    END IF;

    RETURN QUERY
    WITH mine AS (
        SELECT sa.id AS seat_id, sa.status, sa.ended_at, sa.project_stage_id,
               CASE WHEN sa.assignee_type::text = 'team' THEN sa.team_id END AS t_team,
               CASE WHEN sa.assignee_type::text = 'team' THEN NULL ELSE sa.freelancer_profile_id END AS t_person
          FROM projects.stage_assignments sa
          JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
         WHERE ps.project_id = p_project
           AND ((sa.assignee_type::text <> 'team' AND sa.freelancer_profile_id = p_user)
                OR (sa.assignee_type::text = 'team' AND reviews.fn_can_answer('team', sa.team_id, p_user)))
    ),
    listing_owner AS (
        SELECT CASE WHEN b.owner_type = 'team' THEN b.owner_team_id END AS t_team
          FROM marketplace.service_blueprints b
         WHERE b.id = v_p.source_blueprint_id
           AND ((b.owner_type <> 'team' AND b.freelancer_profile_id = p_user)
                OR (b.owner_type = 'team' AND reviews.fn_can_answer('team', b.owner_team_id, p_user)))
    ),
    opened AS (
        SELECT m.t_team, NULL::uuid AS seat_id, v_completed AS at
          FROM mine m
         WHERE v_completed IS NOT NULL AND m.status IN ('accepted', 'completed', 'released')
        UNION ALL
        SELECT l.t_team, NULL::uuid, v_completed
          FROM listing_owner l
         WHERE v_completed IS NOT NULL
        UNION ALL
        SELECT m.t_team, m.seat_id, m.ended_at
          FROM mine m
         WHERE v_completed IS NULL
           AND m.status = 'released'
           AND m.ended_at IS NOT NULL
           AND EXISTS (
               SELECT 1 FROM projects.stage_submissions sub
                WHERE sub.project_stage_id = m.project_stage_id
                  AND (sub.submitted_by = m.t_person
                       OR (m.t_team IS NOT NULL AND EXISTS (
                           SELECT 1 FROM org.team_members tm
                            WHERE tm.team_id = m.t_team AND tm.user_id = sub.submitted_by))))
    )
    SELECT DISTINCT ON (o.t_team)
           CASE WHEN v_p.client_business_id IS NOT NULL THEN 'business' ELSE 'user' END::reviews.review_target_type,
           COALESCE(v_p.client_business_id, v_p.client_user_id, v_p.owner_user_id),
           o.seat_id, o.at, o.t_team
      FROM opened o
     ORDER BY o.t_team NULLS FIRST, o.at DESC;
END;
$$;

/** Whether `p_user` IS the target, or belongs to it: a review of it would be a self-review. */
CREATE OR REPLACE FUNCTION reviews.fn_is_own_target(
    p_target_type reviews.review_target_type,
    p_target_id uuid,
    p_user uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN CASE p_target_type
        WHEN 'user' THEN p_target_id = p_user
        WHEN 'freelancer' THEN p_target_id = p_user
        WHEN 'team' THEN EXISTS (
            SELECT 1 FROM org.teams t WHERE t.id = p_target_id AND t.owner_user_id = p_user
            UNION ALL
            SELECT 1 FROM org.team_members m
             WHERE m.team_id = p_target_id AND m.user_id = p_user AND m.status = 'active')
        WHEN 'business' THEN EXISTS (
            SELECT 1 FROM org.business_members m
             WHERE m.business_id = p_target_id AND m.user_id = p_user AND m.status = 'active')
        WHEN 'product' THEN EXISTS (
            SELECT 1 FROM catalogue.products pr
             WHERE pr.id = p_target_id
               AND (pr.owner_user_id = p_user
                    OR (pr.owner_team_id IS NOT NULL AND reviews.fn_is_own_target('team', pr.owner_team_id, p_user))))
        WHEN 'service_blueprint' THEN EXISTS (
            SELECT 1 FROM marketplace.service_blueprints b
             WHERE b.id = p_target_id
               AND (b.freelancer_profile_id = p_user
                    OR (b.owner_team_id IS NOT NULL AND reviews.fn_is_own_target('team', b.owner_team_id, p_user))))
        ELSE false
    END;
END;
$$;

/**
 * Whether `p_user` may answer for a review's target: the person reviewed, or a member of the team or
 * business holding `edit_profile` or `publish_listings` (an owner holds every capability).
 */
CREATE OR REPLACE FUNCTION reviews.fn_can_answer(
    p_target_type reviews.review_target_type,
    p_target_id uuid,
    p_user uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_kind text;
    v_entity uuid;
    v_person uuid;
BEGIN
    IF p_user IS NULL THEN
        RETURN false;
    END IF;
    CASE p_target_type
        WHEN 'user', 'freelancer' THEN v_person := p_target_id;
        WHEN 'team' THEN v_kind := 'team'; v_entity := p_target_id;
        WHEN 'business' THEN v_kind := 'business'; v_entity := p_target_id;
        WHEN 'product' THEN
            SELECT CASE WHEN pr.owner_team_id IS NULL THEN pr.owner_user_id END, pr.owner_team_id
              INTO v_person, v_entity
              FROM catalogue.products pr WHERE pr.id = p_target_id;
            v_kind := CASE WHEN v_entity IS NOT NULL THEN 'team' END;
        WHEN 'service_blueprint' THEN
            SELECT CASE WHEN b.owner_team_id IS NULL THEN b.freelancer_profile_id END, b.owner_team_id
              INTO v_person, v_entity
              FROM marketplace.service_blueprints b WHERE b.id = p_target_id;
            v_kind := CASE WHEN v_entity IS NOT NULL THEN 'team' END;
    END CASE;
    IF v_person IS NOT NULL THEN
        RETURN v_person = p_user;
    END IF;
    IF v_kind IS NULL THEN
        RETURN false;
    END IF;
    RETURN org.fn_member_capabilities(v_kind, v_entity, p_user)
        && ARRAY['edit_profile', 'publish_listings']::org.workspace_capability[];
END;
$$;

/** The people a target's review is announced to: whoever may answer for it. */
CREATE OR REPLACE FUNCTION reviews.fn_answerers(p_target_type reviews.review_target_type, p_target_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_team uuid;
BEGIN
    IF p_target_type IN ('user', 'freelancer') THEN
        RETURN NEXT p_target_id;
        RETURN;
    END IF;
    IF p_target_type = 'product' THEN
        SELECT pr.owner_team_id INTO v_team FROM catalogue.products pr WHERE pr.id = p_target_id;
        IF v_team IS NULL THEN
            RETURN QUERY SELECT pr.owner_user_id FROM catalogue.products pr WHERE pr.id = p_target_id;
            RETURN;
        END IF;
    ELSIF p_target_type = 'service_blueprint' THEN
        SELECT b.owner_team_id INTO v_team FROM marketplace.service_blueprints b WHERE b.id = p_target_id;
        IF v_team IS NULL THEN
            RETURN QUERY SELECT b.freelancer_profile_id FROM marketplace.service_blueprints b WHERE b.id = p_target_id;
            RETURN;
        END IF;
    ELSIF p_target_type = 'team' THEN
        v_team := p_target_id;
    END IF;

    IF v_team IS NOT NULL THEN
        RETURN QUERY
        SELECT m.user_id FROM org.team_members m
         WHERE m.team_id = v_team AND m.status = 'active'
           AND reviews.fn_can_answer('team', v_team, m.user_id);
    ELSIF p_target_type = 'business' THEN
        RETURN QUERY
        SELECT m.user_id FROM org.business_members m
         WHERE m.business_id = p_target_id AND m.status = 'active'
           AND reviews.fn_can_answer('business', p_target_id, m.user_id);
    END IF;
END;
$$;
-- #endregion

-- #region Notices
/**
 * `review.received` to everyone who may answer for the target, with an address that fits it: the
 * listing it was bought from (`/view/<slug>#evp-reviews`) or the profile (`/@handle/reviews`).
 */
CREATE OR REPLACE FUNCTION reviews.fn_notify_received(p_review uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews;
    v_url text;
    v_author text;
    v_to uuid;
BEGIN
    SELECT * INTO r FROM reviews.entity_reviews er WHERE er.id = p_review;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF r.service_blueprint_id IS NOT NULL THEN
        SELECT '/view/' || b.slug || '#evp-reviews' INTO v_url
          FROM marketplace.service_blueprints b WHERE b.id = r.service_blueprint_id;
    ELSIF r.target_entity_type = 'product' THEN
        SELECT '/view/' || pr.slug || '#evp-reviews' INTO v_url
          FROM catalogue.products pr WHERE pr.id = r.target_entity_id;
    ELSIF r.target_entity_type IN ('user', 'freelancer') THEN
        SELECT '/@' || u.username || '/reviews' INTO v_url
          FROM org.users_public u WHERE u.user_id = r.target_entity_id;
    ELSIF r.target_entity_type = 'team' THEN
        SELECT '/@' || t.slug || '/reviews' INTO v_url FROM org.teams t WHERE t.id = r.target_entity_id;
    ELSIF r.target_entity_type = 'business' THEN
        SELECT '/@' || b.slug || '/reviews' INTO v_url FROM org.business_profiles b WHERE b.id = r.target_entity_id;
    END IF;
    SELECT COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', u.first_name, u.last_name)), ''), 'A client')
      INTO v_author
      FROM org.users_public u WHERE u.user_id = r.reviewer_user_id;

    FOR v_to IN SELECT DISTINCT a FROM reviews.fn_answerers(r.target_entity_type, r.target_entity_id) a
                 WHERE a IS NOT NULL AND a <> r.reviewer_user_id
    LOOP
        PERFORM comms.fn_notify(
            v_to, 'review.received', 'You received a review',
            pg_catalog.format('%s rated you %s out of 5.', v_author, pg_catalog.trim_scale(r.rating)),
            'reviews.entity_reviews', r.id,
            pg_catalog.jsonb_build_object('rating', r.rating),
            r.reviewer_user_id, NULL, NULL, NULL, v_url);
    END LOOP;
END;
$$;
-- #endregion

-- #region Input bounds
/** Refuses a rating, title or comment outside the table's bounds before a CHECK would (22023). */
CREATE OR REPLACE FUNCTION reviews.fn_check_review_input(p_rating numeric, p_title text, p_comment text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 OR pg_catalog.round(p_rating, 2) <> p_rating THEN
        RAISE EXCEPTION 'review refused: the rating is from 1 to 5' USING ERRCODE = '22023';
    END IF;
    IF p_title IS NOT NULL AND pg_catalog.char_length(pg_catalog.btrim(p_title)) > 120 THEN
        RAISE EXCEPTION 'review refused: the title is at most 120 characters' USING ERRCODE = '22023';
    END IF;
    IF p_comment IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_comment)) < 100
       OR pg_catalog.char_length(pg_catalog.btrim(p_comment)) > 5000 THEN
        RAISE EXCEPTION 'review refused: the review is 100 to 5,000 characters' USING ERRCODE = '22023';
    END IF;
END;
$$;
-- #endregion

-- #region submit_review
/**
 * Writes the caller's review of a target on an anchor. `p_anchor_kind` is `project` (an engagement:
 * the client reviews a provider, or a provider the client), `cohort_membership` (a session) or
 * `order_line` (a product — PT501 until CK1). A session review is public and its target told at once;
 * an engagement review waits for its counterpart (fn_reveal). Returns the review's id.
 */
CREATE OR REPLACE FUNCTION reviews.submit_review(
    p_anchor_kind text,
    p_anchor_id uuid,
    p_target_type reviews.review_target_type,
    p_target_id uuid,
    p_rating numeric,
    p_title text,
    p_comment text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_business uuid;
    v_seat uuid;
    v_sitting uuid;
    v_opened timestamptz;
    v_project uuid;
    v_membership uuid;
    v_listing uuid;
    v_id uuid;
    v_p projects.projects;
    v_cm projects.cohort_memberships;
    v_is_client boolean;
    v_team uuid;
    v_pair uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'review refused: not signed in' USING ERRCODE = '42501';
    END IF;
    IF org.fn_is_minor(v_uid) THEN
        RAISE EXCEPTION 'review refused: reviews unlock at 18' USING ERRCODE = 'PM403';
    END IF;
    PERFORM reviews.fn_check_review_input(p_rating, p_title, p_comment);
    IF p_target_id IS NULL OR p_target_type IS NULL THEN
        RAISE EXCEPTION 'review refused: no target' USING ERRCODE = '22023';
    END IF;

    IF p_anchor_kind = 'order_line' THEN
        RAISE EXCEPTION 'review refused: product reviews open once a purchase records its delivery'
            USING ERRCODE = 'PT501';
    ELSIF p_anchor_kind = 'project' THEN
        SELECT * INTO v_p FROM projects.projects p WHERE p.id = p_anchor_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'review refused: no such engagement' USING ERRCODE = 'PT404';
        END IF;
        v_is_client := v_uid = COALESCE(v_p.client_user_id, v_p.owner_user_id)
                OR (v_p.client_business_id IS NOT NULL
                    AND 'hire'::org.workspace_capability
                        = ANY (org.fn_member_capabilities('business', v_p.client_business_id, v_uid)));
        IF NOT v_is_client AND NOT EXISTS (SELECT 1 FROM reviews.fn_client_targets(v_p.id, v_uid)) THEN
            RAISE EXCEPTION 'review refused: only the client, or a provider who worked on it, reviews this engagement'
                USING ERRCODE = 'PT403';
        END IF;
        IF reviews.fn_is_own_target(p_target_type, p_target_id, v_uid) THEN
            RAISE EXCEPTION 'review refused: a review of yourself or your own workspace' USING ERRCODE = 'PT422';
        END IF;
        IF v_is_client THEN
            SELECT t.stage_assignment_id, t.opened_at, t.business_id INTO v_seat, v_opened, v_business
              FROM reviews.fn_engagement_targets(v_p.id, v_uid) t
             WHERE t.target_type = p_target_type AND t.target_id = p_target_id;
        ELSE
            SELECT t.stage_assignment_id, t.opened_at, t.team_id INTO v_seat, v_opened, v_team
              FROM reviews.fn_client_targets(v_p.id, v_uid) t
             WHERE t.target_type = p_target_type AND t.target_id = p_target_id;
        END IF;
        IF NOT FOUND OR v_opened IS NULL THEN
            RAISE EXCEPTION 'review refused: nothing on this engagement is complete for that party'
                USING ERRCODE = 'PT404';
        END IF;
        v_project := v_p.id;
        v_listing := CASE WHEN v_is_client THEN v_p.source_blueprint_id END;
    ELSIF p_anchor_kind = 'cohort_membership' THEN
        SELECT * INTO v_cm FROM projects.cohort_memberships cm WHERE cm.id = p_anchor_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'review refused: no such session seat' USING ERRCODE = 'PT404';
        END IF;
        IF v_cm.user_id <> v_uid THEN
            RAISE EXCEPTION 'review refused: only the attendee reviews this session' USING ERRCODE = 'PT403';
        END IF;
        IF reviews.fn_is_own_target(p_target_type, p_target_id, v_uid) THEN
            RAISE EXCEPTION 'review refused: a review of yourself or your own workspace' USING ERRCODE = 'PT422';
        END IF;
        SELECT t.session_event_id, t.opened_at, t.service_blueprint_id INTO v_sitting, v_opened, v_listing
          FROM reviews.fn_session_targets(v_cm.id, v_uid) t
         WHERE t.target_type = p_target_type AND t.target_id = p_target_id;
        IF NOT FOUND OR v_opened IS NULL THEN
            RAISE EXCEPTION 'review refused: no sitting of this session has completed' USING ERRCODE = 'PT404';
        END IF;
        v_membership := v_cm.id;
    ELSE
        RAISE EXCEPTION 'review refused: unknown anchor kind %', p_anchor_kind USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.now() >= v_opened + reviews.fn_review_window() THEN
        RAISE EXCEPTION 'review refused: the review window closed on %', v_opened + reviews.fn_review_window()
            USING ERRCODE = 'PT410';
    END IF;

    IF v_project IS NOT NULL THEN
        -- Two sides submitting at once each find the other: the second waits for the first.
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reviews.pair:' || v_project::text, 0));
    END IF;
    BEGIN
        INSERT INTO reviews.entity_reviews (
            target_entity_id, target_entity_type, reviewer_user_id, reviewer_business_id, reviewer_team_id,
            project_id, stage_assignment_id, cohort_membership_id, session_event_id,
            service_blueprint_id, window_closes_at, rating, title, comment, revealed_at
        ) VALUES (
            p_target_id, p_target_type, v_uid, v_business, v_team,
            v_project, v_seat, v_membership, v_sitting,
            v_listing, v_opened + reviews.fn_review_window(), p_rating,
            NULLIF(pg_catalog.btrim(p_title), ''), pg_catalog.btrim(p_comment),
            -- An engagement is reviewed both ways, so its reviews wait for each other (#486 (A)).
            CASE WHEN v_project IS NULL THEN pg_catalog.now() END
        ) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'review refused: this engagement already has your review of that party'
            USING ERRCODE = 'PT409';
    END;

    IF v_project IS NULL THEN
        PERFORM reviews.fn_after_review_change(p_target_type, p_target_id);
        PERFORM reviews.fn_notify_received(v_id);
    ELSE
        v_pair := reviews.fn_counterpart(v_id);
        IF v_pair IS NOT NULL THEN
            PERFORM reviews.fn_reveal(v_pair);
            PERFORM reviews.fn_reveal(v_id);
        END IF;
    END IF;
    RETURN v_id;
END;
$$;
-- #endregion

-- #region The author's edits
/** The caller's own review, locked for the edit; refuses anyone else (PT403) and a hidden one (PT404). */
CREATE OR REPLACE FUNCTION reviews.fn_authored(p_review uuid)
RETURNS reviews.entity_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'review refused: not signed in' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO r FROM reviews.entity_reviews er WHERE er.id = p_review FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'review refused: no such review' USING ERRCODE = 'PT404';
    END IF;
    IF r.reviewer_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'review refused: only its author changes a review' USING ERRCODE = 'PT403';
    END IF;
    RETURN r;
END;
$$;

/** Rewrites the caller's review, while its window is open and before the target replies. */
CREATE OR REPLACE FUNCTION reviews.edit_review(p_review uuid, p_rating numeric, p_title text, p_comment text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews := reviews.fn_authored(p_review);
BEGIN
    IF r.withdrawn_at IS NOT NULL OR r.hidden_at IS NOT NULL THEN
        RAISE EXCEPTION 'review refused: the review was withdrawn or hidden' USING ERRCODE = 'PT404';
    END IF;
    IF r.replied_at IS NOT NULL THEN
        RAISE EXCEPTION 'review refused: a review is fixed once it has a reply' USING ERRCODE = 'PT409';
    END IF;
    IF pg_catalog.now() >= r.window_closes_at THEN
        RAISE EXCEPTION 'review refused: the review window closed on %', r.window_closes_at USING ERRCODE = 'PT410';
    END IF;
    PERFORM reviews.fn_check_review_input(p_rating, p_title, p_comment);
    UPDATE reviews.entity_reviews
       SET rating = p_rating, title = NULLIF(pg_catalog.btrim(p_title), ''), comment = pg_catalog.btrim(p_comment),
           edited_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = r.id;
    IF r.revealed_at IS NOT NULL THEN
        PERFORM reviews.fn_after_review_change(r.target_entity_type, r.target_entity_id);
    END IF;
END;
$$;

/** Withdraws the caller's review: kept, hidden from every reader and average. A second call is a no-op. */
CREATE OR REPLACE FUNCTION reviews.withdraw_review(p_review uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews := reviews.fn_authored(p_review);
BEGIN
    IF r.withdrawn_at IS NOT NULL THEN
        RETURN;
    END IF;
    UPDATE reviews.entity_reviews
       SET withdrawn_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = r.id;
    IF r.revealed_at IS NOT NULL THEN
        PERFORM reviews.fn_after_review_change(r.target_entity_type, r.target_entity_id);
    END IF;
END;
$$;
-- #endregion

-- #region The reply
/** The review the caller may answer for, locked; refuses a hidden one (PT404) and anyone else (PT403). */
CREATE OR REPLACE FUNCTION reviews.fn_answerable(p_review uuid)
RETURNS reviews.entity_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'reply refused: not signed in' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO r FROM reviews.entity_reviews er WHERE er.id = p_review FOR UPDATE;
    IF NOT FOUND OR NOT r.is_visible THEN
        RAISE EXCEPTION 'reply refused: no such review' USING ERRCODE = 'PT404';
    END IF;
    IF NOT reviews.fn_can_answer(r.target_entity_type, r.target_entity_id, auth.uid()) THEN
        RAISE EXCEPTION 'reply refused: only the reviewed side replies' USING ERRCODE = 'PT403';
    END IF;
    RETURN r;
END;
$$;

/** Refuses a reply outside 1–1,000 characters (22023). */
CREATE OR REPLACE FUNCTION reviews.fn_check_reply(p_body text)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF p_body IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_body)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'reply refused: a reply is 1 to 1,000 characters' USING ERRCODE = '22023';
    END IF;
END;
$$;

/** The one public reply to a review. */
CREATE OR REPLACE FUNCTION reviews.reply_to_review(p_review uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews := reviews.fn_answerable(p_review);
BEGIN
    IF r.replied_at IS NOT NULL THEN
        RAISE EXCEPTION 'reply refused: this review already has its reply' USING ERRCODE = 'PT409';
    END IF;
    PERFORM reviews.fn_check_reply(p_body);
    UPDATE reviews.entity_reviews
       SET reply_comment = pg_catalog.btrim(p_body), reply_user_id = auth.uid(), replied_at = pg_catalog.now(),
           updated_at = pg_catalog.now()
     WHERE id = r.id;
END;
$$;

/** Rewrites the reply, for 7 days after it was posted. */
CREATE OR REPLACE FUNCTION reviews.edit_reply(p_review uuid, p_body text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews := reviews.fn_answerable(p_review);
BEGIN
    IF r.replied_at IS NULL THEN
        RAISE EXCEPTION 'reply refused: there is no reply to edit' USING ERRCODE = 'PT404';
    END IF;
    IF pg_catalog.now() >= r.replied_at + reviews.fn_reply_edit_window() THEN
        RAISE EXCEPTION 'reply refused: a reply is editable for 7 days' USING ERRCODE = 'PT410';
    END IF;
    PERFORM reviews.fn_check_reply(p_body);
    UPDATE reviews.entity_reviews
       SET reply_comment = pg_catalog.btrim(p_body), reply_edited_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = r.id;
END;
$$;
-- #endregion

-- #region Moderation
/** An operator hides a review (kept, gone from every reader and average). A second call keeps the first reason. */
CREATE OR REPLACE FUNCTION reviews.hide_review(p_review uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews;
BEGIN
    IF NOT security.is_admin() THEN
        RAISE EXCEPTION 'hide refused: operators only' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'hide refused: give a reason of 1 to 500 characters' USING ERRCODE = '22023';
    END IF;
    UPDATE reviews.entity_reviews
       SET hidden_at = pg_catalog.now(), hidden_reason = pg_catalog.btrim(p_reason), hidden_by = auth.uid(),
           updated_at = pg_catalog.now()
     WHERE id = p_review AND hidden_at IS NULL
    RETURNING * INTO r;
    IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM reviews.entity_reviews er WHERE er.id = p_review) THEN
        RAISE EXCEPTION 'hide refused: no such review' USING ERRCODE = 'PT404';
    END IF;
    IF r.revealed_at IS NOT NULL THEN
        PERFORM reviews.fn_after_review_change(r.target_entity_type, r.target_entity_id);
    END IF;
END;
$$;
-- #endregion

-- #region Reads
/** A target's public face for the dialog: name, `@handle`, avatar. */
CREATE OR REPLACE FUNCTION reviews.fn_target_card(p_target_type reviews.review_target_type, p_target_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_target_type IN ('user', 'freelancer') THEN (
            SELECT pg_catalog.jsonb_build_object(
                'name', COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.concat_ws(' ', u.first_name, u.last_name)), ''), u.username),
                'handle', '@' || u.username,
                'avatar', files.fn_public_media_ref(u.avatar_file_id))
              FROM org.users_public u WHERE u.user_id = p_target_id)
        WHEN p_target_type = 'team' THEN (
            SELECT pg_catalog.jsonb_build_object('name', t.name, 'handle', '@' || t.slug,
                       'avatar', files.fn_public_media_ref(t.avatar_file_id))
              FROM org.teams t WHERE t.id = p_target_id)
        WHEN p_target_type = 'business' THEN (
            SELECT pg_catalog.jsonb_build_object('name', b.name, 'handle', '@' || b.slug,
                       'avatar', files.fn_public_media_ref(b.logo_file_id))
              FROM org.business_profiles b WHERE b.id = p_target_id)
    END;
$$;

/**
 * What the caller may review on one project (`/projects/:slug?review=:slug`): as its client party,
 * each provider of the engagement; as a provider who worked on it, its client party (Decision #486);
 * on a session, the provider of each of the caller's seats. Each with the window and the party's
 * review if one exists (`revealed` false while it waits for the other side's). NULL for a project
 * that does not exist; `[]` for a 13–17 account and for anyone who is none of those.
 */
CREATE OR REPLACE FUNCTION reviews.get_reviewables(p_project_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_project uuid;
    v_out jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'reviewables refused: not signed in' USING ERRCODE = '42501';
    END IF;
    SELECT p.id INTO v_project FROM projects.projects p WHERE p.slug = p_project_slug;
    IF v_project IS NULL THEN
        RETURN NULL;
    END IF;
    IF org.fn_is_minor(v_uid) THEN
        RETURN '[]'::jsonb;
    END IF;

    WITH items AS (
        SELECT 'project'::text AS anchor_kind, v_project AS anchor_id, t.target_type, t.target_id,
               t.opened_at, COALESCE(t.business_id, v_uid) AS party
          FROM reviews.fn_engagement_targets(v_project, v_uid) t
         WHERE NOT reviews.fn_is_own_target(t.target_type, t.target_id, v_uid)
        UNION ALL
        SELECT 'project', v_project, t.target_type, t.target_id, t.opened_at, COALESCE(t.team_id, v_uid)
          FROM reviews.fn_client_targets(v_project, v_uid) t
         WHERE NOT reviews.fn_is_own_target(t.target_type, t.target_id, v_uid)
        UNION ALL
        SELECT 'cohort_membership', cm.id, t.target_type, t.target_id, t.opened_at, v_uid
          FROM projects.cohort_memberships cm
          JOIN projects.cohorts c ON c.id = cm.cohort_id AND c.project_id = v_project
          CROSS JOIN LATERAL reviews.fn_session_targets(cm.id, v_uid) t
         WHERE cm.user_id = v_uid
           AND NOT reviews.fn_is_own_target(t.target_type, t.target_id, v_uid)
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'anchor_kind', i.anchor_kind,
               'anchor_id', i.anchor_id,
               'target_type', i.target_type,
               'target_id', i.target_id,
               'target', reviews.fn_target_card(i.target_type, i.target_id),
               'opened_at', i.opened_at,
               'closes_at', i.opened_at + reviews.fn_review_window(),
               'open', pg_catalog.now() < i.opened_at + reviews.fn_review_window(),
               'review', (
                   SELECT pg_catalog.jsonb_build_object(
                       'id', r.id, 'rating', r.rating, 'title', r.title, 'comment', r.comment,
                       'created_at', r.created_at, 'edited_at', r.edited_at,
                       'withdrawn', r.withdrawn_at IS NOT NULL, 'hidden', r.hidden_at IS NOT NULL,
                       'reply', r.reply_comment, 'replied_at', r.replied_at,
                       'window_closes_at', r.window_closes_at,
                       'mine', r.reviewer_user_id = v_uid,
                       'revealed', r.revealed_at IS NOT NULL,
                       'editable', r.reviewer_user_id = v_uid AND r.withdrawn_at IS NULL AND r.hidden_at IS NULL
                                   AND r.replied_at IS NULL
                                   AND pg_catalog.now() < r.window_closes_at)
                     FROM reviews.entity_reviews r
                    WHERE r.target_entity_type = i.target_type AND r.target_entity_id = i.target_id
                      AND COALESCE(r.reviewer_business_id, r.reviewer_team_id, r.reviewer_user_id) = i.party
                      AND COALESCE(r.project_id, r.cohort_membership_id) = i.anchor_id
                    LIMIT 1)
           ) ORDER BY i.opened_at DESC, i.target_id), '[]'::jsonb)
      INTO v_out
      FROM items i;
    RETURN v_out;
END;
$$;

/**
 * What the caller may do to each of a list of reviews: edit or withdraw it (its author), reply or edit
 * the reply (whoever answers for its target), and where the author's dialog lives. `[]` signed out.
 */
CREATE OR REPLACE FUNCTION reviews.get_review_actions(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL OR p_ids IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;
    RETURN COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'id', r.id,
                   'can_edit', r.reviewer_user_id = v_uid AND r.replied_at IS NULL
                               AND pg_catalog.now() < r.window_closes_at,
                   'can_withdraw', r.reviewer_user_id = v_uid,
                   'can_reply', r.replied_at IS NULL AND reviews.fn_can_answer(r.target_entity_type, r.target_entity_id, v_uid),
                   'can_edit_reply', r.replied_at IS NOT NULL
                                     AND pg_catalog.now() < r.replied_at + reviews.fn_reply_edit_window()
                                     AND reviews.fn_can_answer(r.target_entity_type, r.target_entity_id, v_uid),
                   'edit_href', CASE WHEN r.reviewer_user_id = v_uid THEN (
                       SELECT '/projects/' || p.slug || '?review=' || p.slug
                         FROM projects.projects p
                        WHERE p.id = COALESCE(r.project_id, (
                            SELECT c.project_id FROM projects.cohort_memberships cm
                              JOIN projects.cohorts c ON c.id = cm.cohort_id
                             WHERE cm.id = r.cohort_membership_id))) END)
                ORDER BY r.created_at DESC)
          FROM reviews.entity_reviews r
         WHERE r.id = ANY (p_ids)
           AND (r.is_visible
                OR (r.reviewer_user_id = v_uid AND r.withdrawn_at IS NULL AND r.hidden_at IS NULL))
    ), '[]'::jsonb);
END;
$$;
-- #endregion

-- #region The reminder
/**
 * Asks each client party, each provider who worked on an engagement (Decision #486; a team's seat is
 * answered by its members through the dialog, so only a person's own seat is asked), and each attendee,
 * once per anchor to review it: the first run at least
 * `fn_reminder_lead()` after the anchor opened and before its window closes, while something on it is
 * still unreviewed by that party. The ask is recorded in `reviews.review_reminders` (ruling 6). Returns
 * how many were asked. The daily job `reviews-reminders` (00005060).
 */
CREATE OR REPLACE FUNCTION reviews.fn_send_review_reminders(p_now timestamptz DEFAULT pg_catalog.now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r record;
    v_asked integer := 0;
BEGIN
    FOR r IN
        WITH anchors AS (
            SELECT p.id AS project_id, NULL::uuid AS membership_id,
                   COALESCE(p.client_user_id, p.owner_user_id) AS user_id, p.slug, p.title
              FROM projects.projects p
             WHERE p.status <> 'draft'::public.project_status
               AND (EXISTS (SELECT 1 FROM projects.project_status_history h
                             WHERE h.project_id = p.id AND h.to_status = 'completed'::public.project_status
                               AND h.created_at > p_now - reviews.fn_review_window())
                    OR EXISTS (SELECT 1 FROM projects.stage_assignments sa
                                 JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
                                WHERE ps.project_id = p.id AND sa.status = 'released'
                                  AND sa.ended_at > p_now - reviews.fn_review_window()))
            UNION ALL
            -- The providers who worked on it, asked to review the client back.
            SELECT DISTINCT p.id, NULL::uuid, sa.freelancer_profile_id, p.slug, p.title
              FROM projects.projects p
              JOIN projects.project_stages ps ON ps.project_id = p.id
              JOIN projects.stage_assignments sa ON sa.project_stage_id = ps.id
             WHERE p.status <> 'draft'::public.project_status
               AND sa.assignee_type::text <> 'team'
               AND sa.freelancer_profile_id IS NOT NULL
               AND ((sa.status IN ('accepted', 'completed', 'released')
                     AND EXISTS (SELECT 1 FROM projects.project_status_history h
                                  WHERE h.project_id = p.id AND h.to_status = 'completed'::public.project_status
                                    AND h.created_at > p_now - reviews.fn_review_window()))
                    OR (sa.status = 'released' AND sa.ended_at > p_now - reviews.fn_review_window()))
            UNION ALL
            SELECT c.project_id, cm.id, cm.user_id, p.slug, p.title
              FROM projects.cohort_memberships cm
              JOIN projects.cohorts c ON c.id = cm.cohort_id
              JOIN projects.projects p ON p.id = c.project_id
             WHERE cm.status <> 'cancelled'
               AND EXISTS (SELECT 1 FROM projects.session_events se
                            WHERE se.cohort_id = cm.cohort_id
                              AND se.status = 'completed'::projects.session_event_status
                              AND se.end_time > p_now - reviews.fn_review_window())
        )
        SELECT DISTINCT a.*
          FROM anchors a
         WHERE a.user_id IS NOT NULL
           AND NOT org.fn_is_minor(a.user_id)
           AND NOT EXISTS (
               SELECT 1 FROM reviews.review_reminders rr
                WHERE rr.user_id = a.user_id
                  AND COALESCE(rr.cohort_membership_id, rr.project_id) = COALESCE(a.membership_id, a.project_id))
    LOOP
        IF NOT EXISTS (
            SELECT 1
              FROM (
                SELECT t.target_type, t.target_id, t.opened_at, COALESCE(t.business_id, r.user_id) AS party
                  FROM reviews.fn_engagement_targets(r.project_id, r.user_id) t
                 WHERE r.membership_id IS NULL
                UNION ALL
                SELECT t.target_type, t.target_id, t.opened_at, COALESCE(t.team_id, r.user_id)
                  FROM reviews.fn_client_targets(r.project_id, r.user_id) t
                 WHERE r.membership_id IS NULL
                UNION ALL
                SELECT t.target_type, t.target_id, t.opened_at, r.user_id
                  FROM reviews.fn_session_targets(r.membership_id, r.user_id) t
                 WHERE r.membership_id IS NOT NULL
              ) t
             WHERE t.opened_at <= p_now - reviews.fn_reminder_lead()
               AND p_now < t.opened_at + reviews.fn_review_window()
               AND NOT reviews.fn_is_own_target(t.target_type, t.target_id, r.user_id)
               AND NOT EXISTS (
                   SELECT 1 FROM reviews.entity_reviews er
                    WHERE er.target_entity_type = t.target_type AND er.target_entity_id = t.target_id
                      AND COALESCE(er.reviewer_business_id, er.reviewer_user_id) = t.party
                      AND COALESCE(er.cohort_membership_id, er.project_id) = COALESCE(r.membership_id, r.project_id))
        ) THEN
            CONTINUE;
        END IF;

        PERFORM comms.fn_notify(
            r.user_id, 'review.reminder', 'How did it go?',
            pg_catalog.format(CASE WHEN EXISTS (SELECT 1 FROM reviews.fn_engagement_targets(r.project_id, r.user_id))
                                        OR r.membership_id IS NOT NULL
                                   THEN '"%s" is complete. Your review helps the next client choose.'
                                   ELSE '"%s" is complete. Your review of the client helps the next freelancer decide.' END,
                              r.title),
            CASE WHEN r.membership_id IS NULL THEN 'projects.projects' ELSE 'projects.cohort_memberships' END,
            COALESCE(r.membership_id, r.project_id), '{}'::jsonb, NULL, 'project', r.project_id, NULL,
            '/projects/' || r.slug || '?review=' || r.slug);
        INSERT INTO reviews.review_reminders (user_id, project_id, cohort_membership_id, asked_at)
        VALUES (r.user_id, CASE WHEN r.membership_id IS NULL THEN r.project_id END, r.membership_id, p_now);
        v_asked := v_asked + 1;
    END LOOP;
    RETURN v_asked;
END;
$$;
-- #endregion

-- #region The reveal (Decision #486 (A))
/**
 * The other side's review on the same engagement: the review of this review's author, by this
 * review's target. NULL when it has not been written. A session or product review has none.
 */
CREATE OR REPLACE FUNCTION reviews.fn_counterpart(p_review uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT o.id
      FROM reviews.entity_reviews r
      JOIN reviews.entity_reviews o
        ON o.project_id = r.project_id
       AND o.id <> r.id
       AND o.target_entity_id = COALESCE(r.reviewer_business_id, r.reviewer_team_id, r.reviewer_user_id)
       AND COALESCE(o.reviewer_business_id, o.reviewer_team_id, o.reviewer_user_id) = r.target_entity_id
       AND (o.target_entity_type IN ('user', 'business')) <> (r.target_entity_type IN ('user', 'business'))
     WHERE r.id = p_review
     LIMIT 1;
$$;

/**
 * What a change to a revealed review recomputes beyond the rating trigger, for the subject it rates
 * only: a client party's Client Trust Score.
 */
CREATE OR REPLACE FUNCTION reviews.fn_after_review_change(p_target_type reviews.review_target_type, p_target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_target_type IN ('user', 'business') THEN
        PERFORM reviews.fn_recompute_client_trust(p_target_type, p_target_id);
    END IF;
END;
$$;

/**
 * Makes a blind review public: it joins every reader and average (`is_visible`, the rating trigger),
 * its target is told (`review.received`), and the scores that read it are recomputed. A second call,
 * or a call on a review already public, does nothing.
 */
CREATE OR REPLACE FUNCTION reviews.fn_reveal(p_review uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    r reviews.entity_reviews;
BEGIN
    UPDATE reviews.entity_reviews
       SET revealed_at = pg_catalog.now()
     WHERE id = p_review AND revealed_at IS NULL
    RETURNING * INTO r;
    IF NOT FOUND OR NOT r.is_visible THEN
        RETURN;
    END IF;
    PERFORM reviews.fn_notify_received(r.id);
    PERFORM reviews.fn_after_review_change(r.target_entity_type, r.target_entity_id);
END;
$$;

/**
 * The `reviews-reveal` job (00005060): reveals every blind review whose window closed with no
 * counterpart, then recomputes each Client Trust Score not computed in the day before `p_now`, so a
 * lost dispute leaves a score as it passes 12 months and the corpus mean stays current. Returns how
 * many reviews it revealed.
 */
CREATE OR REPLACE FUNCTION reviews.fn_reveal_due(p_now timestamptz DEFAULT pg_catalog.now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_n integer := 0;
    t record;
BEGIN
    FOR v_id IN
        SELECT r.id FROM reviews.entity_reviews r
         WHERE r.revealed_at IS NULL AND r.window_closes_at <= p_now
         ORDER BY r.window_closes_at, r.id
    LOOP
        PERFORM reviews.fn_reveal(v_id);
        v_n := v_n + 1;
    END LOOP;
    FOR t IN
        SELECT s.subject_type, s.subject_id FROM reviews.client_trust_scores s
         WHERE s.computed_at < p_now - interval '1 day'
    LOOP
        PERFORM reviews.fn_recompute_client_trust(t.subject_type, t.subject_id, p_now);
    END LOOP;
    RETURN v_n;
END;
$$;
-- #endregion

-- #region Client Trust Score v1 (Decision #486 (B))
/**
 * Recomputes one client party's Client Trust Score into reviews.client_trust_scores.
 *
 *   n     the party's revealed, visible reviews by providers
 *   m     the client track's corpus mean: every revealed, visible review of a person or a business
 *         as a client (finance-model §16.7 keeps the delivery and client tracks apart)
 *   base  (5·m + Σ ratings) / (5 + n), to two decimals: §16.7's cold-start prior of 5 pseudo-reviews
 *   less  0.25 for each dispute the party opened and lost (`resolved_release`) in the 12 months before
 *         `p_now`, capped at 1.00; a split or refund costs nothing. A business's dispute is the one its
 *         escrow was funded from, opened by one of its members (#486 (f)). Ghosting (−0.10 each,
 *         capped at 0.50) reads 0 until Decision #337 P3's auto-approve records one.
 *   score max(1.00, base − deduction)
 *
 * Writes nothing while the corpus is empty.
 */
CREATE OR REPLACE FUNCTION reviews.fn_recompute_client_trust(
    p_type reviews.review_target_type,
    p_id uuid,
    p_now timestamptz DEFAULT pg_catalog.now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_m numeric;
    v_n integer;
    v_sum numeric;
    v_lost integer;
    v_base numeric(3, 2);
    v_ded numeric(3, 2);
BEGIN
    IF p_id IS NULL OR p_type NOT IN ('user', 'business') THEN
        RETURN;
    END IF;
    SELECT pg_catalog.avg(r.rating) INTO v_m
      FROM reviews.entity_reviews r
     WHERE r.is_visible AND r.target_entity_type IN ('user', 'business');
    IF v_m IS NULL THEN
        RETURN;
    END IF;
    SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(r.rating), 0) INTO v_n, v_sum
      FROM reviews.entity_reviews r
     WHERE r.is_visible AND r.target_entity_type = p_type AND r.target_entity_id = p_id;
    SELECT pg_catalog.count(*) INTO v_lost
      FROM finance.disputes d
      JOIN finance.escrows e ON e.id = d.escrow_id
     WHERE d.status = 'resolved_release'::public.dispute_status
       AND d.resolved_at > p_now - interval '12 months'
       AND d.resolved_at <= p_now
       AND CASE WHEN p_type = 'business'
                THEN e.payer_business_id = p_id
                     AND EXISTS (SELECT 1 FROM org.business_members bm
                                  WHERE bm.business_id = p_id AND bm.user_id = d.opened_by_profile)
                ELSE e.payer_business_id IS NULL AND e.payer_user_id = p_id AND d.opened_by_profile = p_id
           END;

    v_base := pg_catalog.round((5 * v_m + v_sum) / (5 + v_n), 2);
    v_ded := LEAST(0.25 * v_lost, 1.00);
    INSERT INTO reviews.client_trust_scores AS s
        (subject_type, subject_id, review_count, base, lost_disputes, deduction, score, computed_at)
    VALUES (p_type, p_id, v_n, v_base, v_lost, v_ded, GREATEST(1.00, v_base - v_ded), p_now)
    ON CONFLICT (subject_type, subject_id) DO UPDATE
       SET review_count = EXCLUDED.review_count, base = EXCLUDED.base, lost_disputes = EXCLUDED.lost_disputes,
           deduction = EXCLUDED.deduction, score = EXCLUDED.score, computed_at = EXCLUDED.computed_at;
END;
$$;

/**
 * A dispute ruled `resolved_release`, or moved off it, recomputes the Client Trust Score of the party
 * that funded its escrow. Trigger `trg_disputes_client_trust` (00001800).
 */
CREATE OR REPLACE FUNCTION reviews.trg_dispute_client_trust()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    e finance.escrows;
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND 'resolved_release'::public.dispute_status IN (NEW.status, OLD.status) THEN
        SELECT * INTO e FROM finance.escrows x WHERE x.id = NEW.escrow_id;
        PERFORM reviews.fn_recompute_client_trust(
            CASE WHEN e.payer_business_id IS NOT NULL THEN 'business' ELSE 'user' END::reviews.review_target_type,
            COALESCE(e.payer_business_id, e.payer_user_id));
    END IF;
    RETURN NULL;
END;
$$;

/** A party's score as readers show it: NULL below 3 reviews; `warned` below 3.00 (#486 (B), (C)). */
CREATE OR REPLACE FUNCTION reviews.fn_client_trust_shown(p_type reviews.review_target_type, p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object('score', s.score, 'review_count', s.review_count, 'warned', s.score < 3.00)
      FROM reviews.client_trust_scores s
     WHERE s.subject_type = p_type AND s.subject_id = p_id AND s.review_count >= 3;
$$;
-- #endregion

-- #region The warning and the Informed Consent (Decision #486 (C))
/** A project's client party: its business, or its client person. */
CREATE OR REPLACE FUNCTION reviews.fn_project_client(p_project uuid)
RETURNS TABLE (subject_type reviews.review_target_type, subject_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE WHEN p.client_business_id IS NOT NULL THEN 'business' ELSE 'user' END::reviews.review_target_type,
           COALESCE(p.client_business_id, p.client_user_id, p.owner_user_id)
      FROM projects.projects p
     WHERE p.id = p_project;
$$;

/** The client party's shown score when it warns (below 3.00, from 3 reviews), else NULL. */
CREATE OR REPLACE FUNCTION reviews.fn_project_trust_warning(p_project uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object('subject_type', c.subject_type, 'subject_id', c.subject_id,
               'score', s.score, 'review_count', s.review_count)
      FROM reviews.fn_project_client(p_project) c
      JOIN reviews.client_trust_scores s ON s.subject_type = c.subject_type AND s.subject_id = c.subject_id
     WHERE s.review_count >= 3 AND s.score < 3.00;
$$;

/**
 * Refuses (PT428) a proposal to, or the acceptance of a hire on, a warned client's project until the
 * freelancer has acknowledged the warning (reviews.acknowledge_client_trust). projects.apply_to_project,
 * projects.redeem_invite_link and projects.fn_apply_invitation_decision (an acceptance) call it, each
 * as its last gate, so an API call cannot skip what the dialog asks.
 */
CREATE OR REPLACE FUNCTION reviews.fn_assert_client_trust_consent(p_project uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v jsonb := reviews.fn_project_trust_warning(p_project);
BEGIN
    IF v IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM reviews.client_trust_consents k WHERE k.user_id = p_user AND k.project_id = p_project
    ) THEN
        RAISE EXCEPTION 'refused: acknowledge this client''s trust score (% from % reviews) first',
            v ->> 'score', v ->> 'review_count'
            USING ERRCODE = 'PT428';
    END IF;
END;
$$;

/**
 * What the apply and accept controls check before they act on project `p_project_slug`: `warned`, and
 * when it is, the score, its review count, where the client's reviews are read and whether the caller
 * has acknowledged it. NULL for a project that does not exist.
 */
CREATE OR REPLACE FUNCTION reviews.get_client_trust_warning(p_project_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_project uuid;
    v jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'warning refused: not signed in' USING ERRCODE = '42501';
    END IF;
    SELECT p.id INTO v_project FROM projects.projects p WHERE p.slug = p_project_slug;
    IF v_project IS NULL THEN
        RETURN NULL;
    END IF;
    v := reviews.fn_project_trust_warning(v_project);
    IF v IS NULL THEN
        RETURN pg_catalog.jsonb_build_object('warned', false);
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'warned', true,
        'score', v -> 'score',
        'review_count', v -> 'review_count',
        'reviews_href', CASE v ->> 'subject_type'
            WHEN 'business' THEN (SELECT '/@' || b.slug || '/reviews' FROM org.business_profiles b
                                   WHERE b.id = (v ->> 'subject_id')::uuid)
            ELSE (SELECT '/@' || u.username || '/reviews' FROM org.users_public u
                   WHERE u.user_id = (v ->> 'subject_id')::uuid)
        END,
        'acknowledged', EXISTS (SELECT 1 FROM reviews.client_trust_consents k
                                 WHERE k.user_id = v_uid AND k.project_id = v_project));
END;
$$;

/**
 * Logs the caller's acknowledgement of a warned client's score on one project, once per (freelancer,
 * project), with the score and count shown. A project whose client is not warned logs nothing.
 */
CREATE OR REPLACE FUNCTION reviews.acknowledge_client_trust(p_project_slug text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_project uuid;
    v jsonb;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'acknowledgement refused: not signed in' USING ERRCODE = '42501';
    END IF;
    SELECT p.id INTO v_project FROM projects.projects p WHERE p.slug = p_project_slug;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'acknowledgement refused: no such project' USING ERRCODE = 'PT404';
    END IF;
    v := reviews.fn_project_trust_warning(v_project);
    IF v IS NULL THEN
        RETURN;
    END IF;
    INSERT INTO reviews.client_trust_consents (user_id, project_id, subject_type, subject_id, score, review_count)
    VALUES (v_uid, v_project, (v ->> 'subject_type')::reviews.review_target_type, (v ->> 'subject_id')::uuid,
            (v ->> 'score')::numeric, (v ->> 'review_count')::integer)
    ON CONFLICT (user_id, project_id) DO NOTHING;
END;
$$;
-- #endregion
