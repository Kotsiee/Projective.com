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
-- #endregion


-- #region [community.feedback]
-- #endregion
