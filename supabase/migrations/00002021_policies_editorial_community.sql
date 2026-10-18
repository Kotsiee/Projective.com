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
-- Categories are never hidden: every category row is public reference data.
CREATE POLICY help_categories_select_public ON editorial.help_categories
    FOR SELECT TO anon, authenticated
    USING (true);

-- An article is readable from its publication date until it is archived, both UTC dates — exactly
-- the content source's `visible` predicate (isHelpCentreArticleVisible), so the live read and the
-- fixture read serve the same articles and a direct PostgREST read is closed the same way.
CREATE POLICY help_articles_select_published ON editorial.help_articles
    FOR SELECT TO anon, authenticated
    USING (
        published_on <= (now() AT TIME ZONE 'UTC')::date
        AND (archived_on IS NULL OR archived_on > (now() AT TIME ZONE 'UTC')::date)
    );
-- #endregion


-- #region [editorial.changelog]
-- A release is public from its release day (UTC) while it is not withdrawn: the same rule as the
-- content source's `visible` predicate (services/editorial/content/changelog.ts), pinned to UTC so it
-- is never narrower than it whatever the session's TimeZone. No write policy: rows arrive through the
-- generated 00005072 and any operator tooling runs as the service role.
CREATE POLICY changelog_releases_select_public ON editorial.changelog_releases
    FOR SELECT TO anon, authenticated
    USING (NOT withdrawn AND released_on <= (now() AT TIME ZONE 'UTC')::date);
-- #endregion


-- #region [editorial.articles]
-- Bylines are never hidden: an author row is shown wherever an article names it.
CREATE POLICY article_authors_select_public ON editorial.article_authors
    FOR SELECT TO anon, authenticated
    USING (true);

-- A reader sees a published article once its publication time has passed — the same rule as the
-- table's `visible` predicate in services/editorial/content/articles.ts, which both reader roads
-- apply (Decision #274). A draft, a future-dated article and an archived (retracted) one stay
-- hidden; no client role writes here at all.
CREATE POLICY articles_select_published ON editorial.articles
    FOR SELECT TO anon, authenticated
    USING (status = 'published' AND published_at <= now());
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
-- NO POLICY, ON PURPOSE. RLS is enabled in 00002001 and no client role holds any privilege on the
-- table (00002520), so it is default-deny for `anon` and `authenticated`: a vote is never read, edited
-- or deleted through PostgREST. Votes arrive only through community.submit_help_feedback (00001320),
-- the SECURITY DEFINER door that stamps the voter, masks the comment and rate-limits; operators read
-- them as the service role.
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
