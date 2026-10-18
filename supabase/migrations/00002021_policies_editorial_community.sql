-- =============================================================================================
-- 00002021_policies_editorial_community.sql — RLS policies for `editorial` and `community`
-- (Category 2, Decision #274).
--
-- THE MODEL, per schema:
--
--   * editorial — platform-authored content. `anon` and `authenticated` READ what is published;
--                 nothing is written by a client role at all. Rows arrive through the generated
--                 category-5 migrations (00005071–00005073) and any operator tooling runs as the
--                 service role. So an editorial table needs one SELECT policy and no write policy.
--   * community — user-generated. Reads are as narrow as the surface needs (public board ideas are
--                 public; a vote is its owner's), and writes go through SECURITY DEFINER doors
--                 (00001320) that rate-limit, screen and stamp the actor — not through INSERT
--                 policies a PostgREST call could reach directly.
--
-- REGIONS. One per surface, in the order of the table files; each work order fills only its own.
-- RLS itself is enabled in 00002001 under the same region names, and table privileges are granted in
-- 00002520 — a policy grants nothing without a privilege, and a privilege without RLS exposes
-- every row.
-- =============================================================================================


-- #region [editorial.help]
-- #endregion


-- #region [editorial.changelog]
-- #endregion


-- #region [editorial.articles]
-- #endregion


-- #region [community.newsletter]
-- NO POLICY, ON PURPOSE. Read this before adding one.
--
-- RLS is enabled in 00002001 and no policy follows, so the table is default-deny for `anon` and
-- `authenticated` alike — and, unlike its old home in `comms`, neither role holds any privilege on
-- it either (00002520), so default-deny no longer rests on RLS alone. It is reachable only through
-- the service role, which bypasses RLS.
--
-- Nothing should ever read this table as a user: every row is somebody's email address paired with
-- a `token` that is the unsubscribe capability, so a SELECT policy wide enough to be useful is a
-- subscriber-list dump, and a per-row one would still confirm whether a given address is subscribed.
--
-- The public subscribe form therefore posts to /api/newsletter/subscribe, and
-- NewsletterBackendService calls community.subscribe_newsletter (00001320) with the service-role
-- client. A direct PostgREST INSERT from the browser is not a capability this table wants: it would
-- let anyone enumerate addresses by observing unique-violation errors.
-- #endregion


-- #region [community.help_feedback]
-- #endregion


-- #region [community.feedback]
-- Reads only; every write is a definer door (00001320). Visibility is one rule in three places — these
-- policies, community.fn_feedback_idea_visible (the doors') and canSeeFeedbackIdea (the fixture
-- road) — and supabase/probes/feedback_board.sql pins it:
--   * Planned, In progress and Shipped ideas are public — guests included.
--   * An idea under review (Backlog) is its author's alone, until an operator accepts it.
--   * Operators (ops.admin_users) read everything, Archived included; nobody else reads Archived.
-- Policies are split by role rather than OR-ed into one expression because `anon` holds no USAGE on
-- `security`, so a policy that named security.is_admin() for anon would fail rather than deny.
DROP POLICY IF EXISTS feedback_ideas_public_read ON community.feedback_ideas;
CREATE POLICY feedback_ideas_public_read ON community.feedback_ideas
    FOR SELECT TO anon, authenticated
    USING (status IN ('ready', 'in_progress', 'complete'));

DROP POLICY IF EXISTS feedback_ideas_author_read ON community.feedback_ideas;
CREATE POLICY feedback_ideas_author_read ON community.feedback_ideas
    FOR SELECT TO authenticated
    USING (status = 'backlog' AND author_id = auth.uid());

DROP POLICY IF EXISTS feedback_ideas_operator_read ON community.feedback_ideas;
CREATE POLICY feedback_ideas_operator_read ON community.feedback_ideas
    FOR SELECT TO authenticated
    USING (security.is_admin());

-- A vote is its owner's: the board learns "you voted for this" and nothing about anyone else's.
DROP POLICY IF EXISTS feedback_votes_own_read ON community.feedback_votes;
CREATE POLICY feedback_votes_own_read ON community.feedback_votes
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- An idea's history is as visible as the idea: the subquery runs under the caller's own idea policies.
DROP POLICY IF EXISTS feedback_status_events_read ON community.feedback_status_events;
CREATE POLICY feedback_status_events_read ON community.feedback_status_events
    FOR SELECT TO anon, authenticated
    USING (EXISTS (SELECT 1 FROM community.feedback_ideas i WHERE i.id = idea_id));
-- #endregion
