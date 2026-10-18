-- =============================================================================================
-- 00001320_functions_editorial_community.sql — functions for `editorial` and `community`
-- (Category 1, Decision #274).
--
-- Editorial content is read straight from its tables under their SELECT policies, so editorial
-- functions should be rare (a search helper, a derived read). Community rows are user-generated and
-- are written through the SECURITY DEFINER doors that live here: each one stamps the actor from
-- auth.uid() (never from an argument), rate-limits, screens public text through comms.mask_pii
-- (Decision #147) and refuses with a typed SQLSTATE the route maps to a status.
--
-- Every function in both schemas is revoked from PUBLIC, `anon` and `authenticated` by default
-- (00002510) and granted back by name in its surface's region there. Triggers live in 00001898.
--
-- REGIONS. One per surface; each work order fills only its own. [editorial.shared] holds the guards
-- every editorial surface attaches to its own tables.
-- =============================================================================================


-- #region [editorial.shared] Guards shared by every editorial surface (Decision #274 (k))
-- A platform-authored editorial row is addressed by a READABLE slug that is authored on its own,
-- never derived from the title, and frozen once the row exists: the scoped amendment of Decision #88
-- for editorial rows that #274 (k) records. A moved address is the defect #88 exists to prevent, so a
-- renamed page is a NEW row (the generator upserts by slug and never prunes) plus a redirect, never
-- an UPDATE of the slug. Attach it per table in 00001898, in the surface's own region:
--   CREATE TRIGGER trg_<table>_slug_immutable BEFORE UPDATE OF slug ON editorial.<table>
--       FOR EACH ROW EXECUTE FUNCTION editorial.fn_guard_slug_immutable();
CREATE OR REPLACE FUNCTION editorial.fn_guard_slug_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
	IF NEW.slug IS DISTINCT FROM OLD.slug THEN
		RAISE EXCEPTION 'editorial slug "%" is permanent and cannot change', OLD.slug
			USING ERRCODE = '23514',
				HINT = 'Author a new row under the new slug and redirect the old address to it.';
	END IF;
	RETURN NEW;
END;
$$;

COMMENT ON FUNCTION editorial.fn_guard_slug_immutable() IS
	'BEFORE UPDATE OF slug guard for editorial tables: a readable editorial slug never changes once the row exists (Decision #274 (k), amending #88 for platform-authored rows).';
-- #endregion


-- #region [editorial.help]
-- #endregion


-- #region [editorial.changelog]
-- #endregion


-- #region [editorial.articles]
-- #endregion


-- #region [community.newsletter]
-- community.subscribe_newsletter — the opt-in's one writer, called by the service role from
-- NewsletterBackendService (packages/backend/services/newsletter/). Its TypeScript twin is
-- planNewsletterSubscription (subscription-plan.ts), which the stub path runs and whose tests pin
-- the same four outcomes this function returns:
--
--   created       no row for the address — insert it with the one requested topic;
--   resubscribed  the address had unsubscribed — RECORD the request and change nothing else: the
--                 topic joins resubscribe_topics (sorted, distinct) and resubscribe_requested_at is
--                 stamped, while unsubscribed_at / unsubscribed_reason (the only record of the
--                 opt-out), topics and confirmed_at stay as they were, so the row stays unsendable.
--                 Whoever typed the address into a public form has not proved they own it; the
--                 confirm link (not built yet) applies the request;
--   topic_added   active, and the topic is new — add it to the set (sorted, distinct);
--   unchanged     active, and the topic is already held — write nothing, not even updated_at.
--
-- `already_subscribed` is true exactly for `unchanged`, so a repeat submission answers the same
-- success the first one did. The row is locked before it is read, and a concurrent first subscribe of
-- the same address is folded in rather than raised: INSERT … ON CONFLICT DO NOTHING, then loop to
-- lock the winner's row. Topic sets sort by code point (COLLATE "C"), as the TypeScript twin's
-- `normalizeTopics` does. The address guard refuses a malformed or over-long (> 254) address with
-- 22023; the table's CHECKs are the authority on `source` and `topic` (23514).
CREATE OR REPLACE FUNCTION community.subscribe_newsletter(
    p_email text,
    p_source text DEFAULT 'footer',
    p_topic text DEFAULT 'general'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_email text := lower(btrim(p_email));
    v_source text := COALESCE(p_source, 'footer');
    v_topic text := COALESCE(p_topic, 'general');
    v_prior community.newsletter_subscriptions%ROWTYPE;
    v_outcome text;
BEGIN
    IF v_email IS NULL OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(v_email) > 254 THEN
        RAISE EXCEPTION 'A valid email address is required.' USING ERRCODE = '22023';
    END IF;

    LOOP
        SELECT * INTO v_prior
        FROM community.newsletter_subscriptions
        WHERE email = v_email
        FOR UPDATE;

        IF NOT FOUND THEN
            INSERT INTO community.newsletter_subscriptions (email, source, topics)
            VALUES (v_email, v_source, ARRAY[v_topic])
            ON CONFLICT (email) DO NOTHING;
            IF FOUND THEN
                v_outcome := 'created';
                EXIT;
            END IF;
            -- A concurrent first subscribe of this address committed first: lock its row and fold
            -- this request into it.
            CONTINUE;
        END IF;

        IF v_prior.unsubscribed_at IS NOT NULL THEN
            UPDATE community.newsletter_subscriptions
            SET resubscribe_topics = ARRAY(
                    SELECT DISTINCT t COLLATE "C"
                    FROM unnest(COALESCE(v_prior.resubscribe_topics, '{}'::text[]) || v_topic) AS u (t)
                    ORDER BY 1
                ),
                resubscribe_requested_at = now(),
                updated_at = now()
            WHERE id = v_prior.id;
            v_outcome := 'resubscribed';
        ELSIF v_topic = ANY (v_prior.topics) THEN
            v_outcome := 'unchanged';
        ELSE
            UPDATE community.newsletter_subscriptions
            SET topics = ARRAY(
                    SELECT DISTINCT t COLLATE "C" FROM unnest(v_prior.topics || v_topic) AS u (t)
                    ORDER BY 1
                ),
                updated_at = now()
            WHERE id = v_prior.id;
            v_outcome := 'topic_added';
        END IF;
        EXIT;
    END LOOP;

    RETURN jsonb_build_object(
        'email', v_email,
        'topic', v_topic,
        'outcome', v_outcome,
        'already_subscribed', v_outcome = 'unchanged'
    );
END;
$$;
-- #endregion


-- #region [community.help_feedback]
-- #endregion


-- #region [community.feedback]
-- The feedback board's doors and trigger functions (Decision #272). An idea moves on the UNIFIED
-- machine (PRODUCT_MANAGEMENT.md §3.9): it is submitted into `backlog` ("Under review"), becomes
-- public at `ready` ("Planned"), then `in_progress` and `complete` ("Shipped"); `archived` is terminal.
-- Every door stamps auth.uid() itself, refuses with a typed SQLSTATE the service maps to a status,
-- and is granted to `authenticated` by name (00002510):
--
--   28000  not signed in                       401
--   42501  not an operator (status, response)   403
--   22023  a field out of bounds ("field: …")   422
--   P0002  no idea the caller can see           404   (a Backlog idea is never confirmed to exist)
--   55000  voting closed / an illegal move      409
--   PR429  over a rate limit (DETAIL = retry)   429
--
-- Visibility is ONE rule, stated three times and pinned by supabase/probes/feedback_board.sql: the
-- SELECT policies (00002021), community.fn_feedback_idea_visible below (what the doors use, since a
-- definer bypasses RLS) and canSeeFeedbackIdea in the fixture road (packages/types/community).

-- Whether the caller may see an idea in `p_status` written by `p_author`: the public statuses to
-- everyone, a Backlog idea to its author, and everything (Archived included) to an operator.
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_visible(p_status text, p_author uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_status IN ('ready', 'in_progress', 'complete')
        OR (p_status = 'backlog' AND p_author IS NOT NULL AND p_author = auth.uid())
        OR security.is_admin();
$$;

-- The legal moves of the idea lifecycle. They use the unified machine's STATES but not all of its
-- §3.2 edges: an idea has no claimant and no deliverable, so Ready → In Progress skips Claimed,
-- In Progress → Complete skips Review, and Ready → Backlog ("sent back for review") has no §3.2 edge
-- at all — see Decision #272 (l), flagged for the owner. Archived is terminal and non-reopenable;
-- Complete may only be archived (a regression is a new idea).
CREATE OR REPLACE FUNCTION community.fn_feedback_move_legal(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_from
        WHEN 'backlog' THEN p_to IN ('ready', 'archived')
        WHEN 'ready' THEN p_to IN ('backlog', 'in_progress', 'archived')
        WHEN 'in_progress' THEN p_to IN ('ready', 'complete', 'archived')
        WHEN 'complete' THEN p_to = 'archived'
        ELSE false
    END;
$$;

-- The board's label for a stored state — the words a notification uses, matching
-- FEEDBACK_STATE_LABEL in packages/types/community/feedback.ts.
CREATE OR REPLACE FUNCTION community.fn_feedback_state_label(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_status
        WHEN 'backlog' THEN 'Under review'
        WHEN 'ready' THEN 'Planned'
        WHEN 'in_progress' THEN 'In progress'
        WHEN 'complete' THEN 'Shipped'
        WHEN 'archived' THEN 'Archived'
        ELSE p_status
    END;
$$;

-- An idea as the board reads it: the client-readable columns only (never pii_categories or
-- team_response_by), plus whether the caller has voted for it.
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_json(p_idea community.feedback_ideas)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'id', p_idea.id,
        'slug', p_idea.slug,
        'title', p_idea.title,
        'impact', p_idea.impact,
        'body', p_idea.body,
        'category', p_idea.category,
        'status', p_idea.status,
        'author_id', p_idea.author_id,
        'vote_count', p_idea.vote_count,
        'team_response', p_idea.team_response,
        'team_response_at', p_idea.team_response_at,
        'created_at', p_idea.created_at,
        'updated_at', p_idea.updated_at,
        'status_changed_at', p_idea.status_changed_at,
        'archived_at', p_idea.archived_at,
        'viewer_voted', EXISTS (
            SELECT 1 FROM community.feedback_votes v
            WHERE v.idea_id = p_idea.id AND v.user_id = auth.uid()
        )
    );
$$;

-- Trigger (BEFORE INSERT OR UPDATE OF title, impact, body): the Tier 2 floor of Decision #147. Public
-- copy may never carry an email, a payment link or handle, or a phone number; the service refuses
-- them first (Tier 1, a field-named 422), and this masks whatever reaches the table by any path — a
-- door, the service role or a seed — and records which categories fired. Every name is qualified,
-- because a trigger runs with the caller's search_path.
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_screen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_title record;
    v_impact record;
    v_body record;
BEGIN
    SELECT m.masked, m.categories INTO v_title FROM comms.mask_pii(NEW.title) AS m;
    SELECT m.masked, m.categories INTO v_impact FROM comms.mask_pii(NEW.impact) AS m;
    SELECT m.masked, m.categories INTO v_body FROM comms.mask_pii(NEW.body) AS m;
    NEW.title := v_title.masked;
    NEW.impact := v_impact.masked;
    NEW.body := v_body.masked;
    NEW.pii_categories := ARRAY(
        SELECT DISTINCT c COLLATE "C"
        FROM unnest(
            COALESCE(v_title.categories, '{}'::text[])
                || COALESCE(v_impact.categories, '{}'::text[])
                || COALESCE(v_body.categories, '{}'::text[])
        ) AS u (c)
        ORDER BY 1
    );
    RETURN NEW;
END;
$$;

-- Trigger (AFTER INSERT OR DELETE on feedback_votes): keeps `vote_count` equal to the number of vote
-- rows. A definer, so the count is kept whoever writes the vote; it updates nothing else.
CREATE OR REPLACE FUNCTION community.fn_feedback_vote_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE community.feedback_ideas SET vote_count = vote_count + 1 WHERE id = NEW.idea_id;
        RETURN NEW;
    END IF;
    UPDATE community.feedback_ideas SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = OLD.idea_id;
    RETURN OLD;
END;
$$;

-- Trigger (BEFORE DELETE on feedback_ideas): nothing on the board is hard-deleted (§5.4) — retiring
-- an idea is `archived`, which keeps its votes and history for audit.
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'A feedback idea is never deleted; archive it instead.'
        USING ERRCODE = '55000';
END;
$$;

-- Trigger (BEFORE UPDATE OR DELETE on feedback_status_events): the history is append-only, for every
-- role — a status an idea held stays held.
CREATE OR REPLACE FUNCTION community.fn_feedback_status_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'The feedback status history is append-only.'
        USING ERRCODE = '55000';
END;
$$;

-- community.submit_feedback_idea — a signed-in person suggests an idea. It enters `backlog` ("Under
-- review"), so nobody but its author and the operators sees it until an operator moves it to Ready:
-- Decision #148's screening is not built, so review IS the publication gate. The author's own vote
-- is cast with it, and the submission is the first history row (NULL → backlog). Five ideas per
-- person per rolling 24 hours — counted under a per-person advisory lock (the same key the vote door
-- takes), so two concurrent submits cannot both read four and both insert.
CREATE OR REPLACE FUNCTION community.submit_feedback_idea(
    p_title text,
    p_category text,
    p_impact text,
    p_body text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_title text := btrim(COALESCE(p_title, ''));
    v_impact text := btrim(COALESCE(p_impact, ''));
    v_body text := NULLIF(btrim(COALESCE(p_body, '')), '');
    v_recent integer;
    v_oldest timestamptz;
    v_idea community.feedback_ideas%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to suggest an idea.' USING ERRCODE = '28000';
    END IF;
    IF char_length(v_title) < 6 OR char_length(v_title) > 90 THEN
        RAISE EXCEPTION 'title: Give the idea a title of 6 to 90 characters.' USING ERRCODE = '22023';
    END IF;
    IF p_category IS NULL OR p_category NOT IN (
        'projects', 'escrow_payments', 'messaging', 'profiles', 'teams', 'explore', 'other'
    ) THEN
        RAISE EXCEPTION 'category: Choose a category.' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_impact) < 10 OR char_length(v_impact) > 600 THEN
        RAISE EXCEPTION 'impact: Say what problem this solves in 10 to 600 characters.'
            USING ERRCODE = '22023';
    END IF;
    IF v_body IS NOT NULL AND char_length(v_body) > 4000 THEN
        RAISE EXCEPTION 'body: Keep the details under 4,000 characters.' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('community.feedback:' || v_uid::text));
    SELECT count(*), min(created_at) INTO v_recent, v_oldest
    FROM community.feedback_ideas
    WHERE author_id = v_uid AND created_at > now() - interval '24 hours';
    IF v_recent >= 5 THEN
        RAISE EXCEPTION 'You have suggested five ideas today. Try again tomorrow.'
            USING ERRCODE = 'PR429',
                DETAIL = to_char((v_oldest + interval '24 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    END IF;

    INSERT INTO community.feedback_ideas (title, impact, body, category, status, author_id)
    VALUES (v_title, v_impact, v_body, p_category, 'backlog', v_uid)
    RETURNING * INTO v_idea;

    INSERT INTO community.feedback_status_events (idea_id, from_status, to_status, actor_id)
    VALUES (v_idea.id, NULL, 'backlog', v_uid);

    INSERT INTO community.feedback_votes (idea_id, user_id) VALUES (v_idea.id, v_uid);

    SELECT * INTO v_idea FROM community.feedback_ideas WHERE id = v_idea.id;
    RETURN community.fn_feedback_idea_json(v_idea);
END;
$$;

-- The idea `p_slug` names, locked, when the caller may see it — or P0002 (one refusal for "absent"
-- and "not yours to see", so a Backlog idea's existence is never confirmed).
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_for_caller(p_slug text)
RETURNS community.feedback_ideas
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idea community.feedback_ideas%ROWTYPE;
BEGIN
    SELECT * INTO v_idea FROM community.feedback_ideas WHERE slug = p_slug FOR UPDATE;
    IF NOT FOUND OR NOT community.fn_feedback_idea_visible(v_idea.status, v_idea.author_id) THEN
        RAISE EXCEPTION 'That idea does not exist.' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_idea;
END;
$$;

-- community.vote_feedback_idea / unvote_feedback_idea — idempotent: a repeat vote, or retracting a
-- vote never cast, changes nothing and answers the same `{ voted, vote_count }`. Voting is open while
-- an idea is under review, planned or in progress, and closed once it ships or is archived. 120 new
-- votes per person per rolling hour, counted under the per-person advisory lock the submit door takes
-- (taken before the idea's row lock, so the two locks are always acquired in one order).
CREATE OR REPLACE FUNCTION community.vote_feedback_idea(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_idea community.feedback_ideas%ROWTYPE;
    v_recent integer;
    v_oldest timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to vote.' USING ERRCODE = '28000';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('community.feedback:' || v_uid::text));
    v_idea := community.fn_feedback_idea_for_caller(p_slug);
    IF v_idea.status NOT IN ('backlog', 'ready', 'in_progress') THEN
        RAISE EXCEPTION 'Voting has closed on this idea.' USING ERRCODE = '55000';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM community.feedback_votes WHERE idea_id = v_idea.id AND user_id = v_uid
    ) THEN
        SELECT count(*), min(created_at) INTO v_recent, v_oldest
        FROM community.feedback_votes
        WHERE user_id = v_uid AND created_at > now() - interval '1 hour';
        IF v_recent >= 120 THEN
            RAISE EXCEPTION 'That is a lot of votes in an hour. Try again shortly.'
                USING ERRCODE = 'PR429',
                    DETAIL = to_char((v_oldest + interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
        END IF;
        INSERT INTO community.feedback_votes (idea_id, user_id)
        VALUES (v_idea.id, v_uid)
        ON CONFLICT (idea_id, user_id) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'voted', true,
        'vote_count', (SELECT vote_count FROM community.feedback_ideas WHERE id = v_idea.id)
    );
END;
$$;

CREATE OR REPLACE FUNCTION community.unvote_feedback_idea(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_idea community.feedback_ideas%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to vote.' USING ERRCODE = '28000';
    END IF;
    v_idea := community.fn_feedback_idea_for_caller(p_slug);
    IF v_idea.status NOT IN ('backlog', 'ready', 'in_progress') THEN
        RAISE EXCEPTION 'Voting has closed on this idea.' USING ERRCODE = '55000';
    END IF;

    DELETE FROM community.feedback_votes WHERE idea_id = v_idea.id AND user_id = v_uid;

    RETURN jsonb_build_object(
        'voted', false,
        'vote_count', (SELECT vote_count FROM community.feedback_ideas WHERE id = v_idea.id)
    );
END;
$$;

-- community.set_feedback_idea_status — an operator (ops.admin_users) moves an idea along the
-- lifecycle. Moving to the state it already holds is a no-op answer, not a refusal; an illegal move
-- (fn_feedback_move_legal) is 55000. Each move appends a history row and tells the author and every
-- voter (not the operator) through `feedback.status_changed` (00005010), linking the idea.
CREATE OR REPLACE FUNCTION community.set_feedback_idea_status(
    p_slug text,
    p_status text,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_idea community.feedback_ideas%ROWTYPE;
    v_from text;
    v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_label text;
    v_recipient uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to continue.' USING ERRCODE = '28000';
    END IF;
    IF NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a Projective operator can change an idea''s status.'
            USING ERRCODE = '42501';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('backlog', 'ready', 'in_progress', 'complete', 'archived') THEN
        RAISE EXCEPTION 'status: Choose a status.' USING ERRCODE = '22023';
    END IF;
    IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
        RAISE EXCEPTION 'note: Keep the note under 1,000 characters.' USING ERRCODE = '22023';
    END IF;

    v_idea := community.fn_feedback_idea_for_caller(p_slug);
    v_from := v_idea.status;
    IF v_from = p_status THEN
        RETURN community.fn_feedback_idea_json(v_idea);
    END IF;
    IF NOT community.fn_feedback_move_legal(v_from, p_status) THEN
        RAISE EXCEPTION 'An idea cannot move from % to %.',
            community.fn_feedback_state_label(v_from), community.fn_feedback_state_label(p_status)
            USING ERRCODE = '55000';
    END IF;

    UPDATE community.feedback_ideas
    SET status = p_status,
        status_changed_at = now(),
        updated_at = now(),
        archived_at = CASE WHEN p_status = 'archived' THEN now() END
    WHERE id = v_idea.id
    RETURNING * INTO v_idea;

    INSERT INTO community.feedback_status_events (idea_id, from_status, to_status, actor_id, note)
    VALUES (v_idea.id, v_from, p_status, v_uid, v_note);

    v_label := community.fn_feedback_state_label(p_status);
    FOR v_recipient IN
        SELECT DISTINCT r.user_id
        FROM (
            SELECT v_idea.author_id AS user_id
            UNION ALL
            SELECT v.user_id FROM community.feedback_votes v WHERE v.idea_id = v_idea.id
        ) r
        WHERE r.user_id IS NOT NULL AND r.user_id <> v_uid
    LOOP
        PERFORM comms.fn_notify(
            v_recipient,
            'feedback.status_changed',
            format('"%s" is now %s', v_idea.title, v_label),
            CASE
                WHEN v_recipient = v_idea.author_id
                    THEN format('An idea you suggested moved from %s to %s.',
                        community.fn_feedback_state_label(v_from), v_label)
                ELSE format('An idea you voted for moved from %s to %s.',
                    community.fn_feedback_state_label(v_from), v_label)
            END,
            'community.feedback_ideas',
            v_idea.id,
            jsonb_build_object('slug', v_idea.slug, 'from', v_from, 'to', p_status),
            v_uid,
            NULL,
            NULL,
            'feedback:' || v_idea.slug,
            '/feedback?idea=' || v_idea.slug
        );
    END LOOP;

    RETURN community.fn_feedback_idea_json(v_idea);
END;
$$;

-- community.respond_to_feedback_idea — an operator writes (or, with an empty response, clears) the
-- team's official response shown on the idea.
CREATE OR REPLACE FUNCTION community.respond_to_feedback_idea(p_slug text, p_response text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_response text := NULLIF(btrim(COALESCE(p_response, '')), '');
    v_idea community.feedback_ideas%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to continue.' USING ERRCODE = '28000';
    END IF;
    IF NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a Projective operator can respond for the team.'
            USING ERRCODE = '42501';
    END IF;
    IF v_response IS NOT NULL AND char_length(v_response) > 2000 THEN
        RAISE EXCEPTION 'response: Keep the response under 2,000 characters.' USING ERRCODE = '22023';
    END IF;

    v_idea := community.fn_feedback_idea_for_caller(p_slug);
    UPDATE community.feedback_ideas
    SET team_response = v_response,
        team_response_at = CASE WHEN v_response IS NULL THEN NULL ELSE now() END,
        team_response_by = CASE WHEN v_response IS NULL THEN NULL ELSE v_uid END,
        updated_at = now()
    WHERE id = v_idea.id
    RETURNING * INTO v_idea;

    RETURN community.fn_feedback_idea_json(v_idea);
END;
$$;

-- community.moderate_feedback_idea — an operator's move and/or the team's response in ONE
-- transaction: it runs set_feedback_idea_status (when p_status is given) and then
-- respond_to_feedback_idea (when p_response is given — an empty string clears it), so a refused
-- response rolls the move and its notifications back with it. Every check is the two doors' own;
-- this adds only "change something". What FeedbackBackendService.moderate calls.
CREATE OR REPLACE FUNCTION community.moderate_feedback_idea(
    p_slug text,
    p_status text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_response text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_answer jsonb;
BEGIN
    IF p_status IS NULL AND p_response IS NULL THEN
        RAISE EXCEPTION 'status: Change the status, the response, or both.' USING ERRCODE = '22023';
    END IF;
    IF p_status IS NOT NULL THEN
        v_answer := community.set_feedback_idea_status(p_slug, p_status, p_note);
    END IF;
    IF p_response IS NOT NULL THEN
        v_answer := community.respond_to_feedback_idea(p_slug, p_response);
    END IF;
    RETURN v_answer;
END;
$$;

-- community.feedback_status_counts — how many ideas the CALLER can see in each state, for the
-- board's tab counts. SECURITY INVOKER on purpose: it is the SELECT policies that decide, so a guest
-- counts the public statuses, an author also their own ideas under review, an operator everything.
CREATE OR REPLACE FUNCTION community.feedback_status_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
    FROM (
        SELECT i.status, count(*) AS n
        FROM community.feedback_ideas i
        GROUP BY i.status
    ) s;
$$;
-- #endregion
