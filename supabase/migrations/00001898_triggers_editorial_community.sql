-- ============================================================================
-- 00001898 triggers editorial + community (Decision #274)
-- Trigger functions live in 00001320, under the same region names; every
-- CREATE TRIGGER for a table in either schema goes here, in its surface's
-- region. A trigger runs with the CALLER's search_path, so its function
-- schema-qualifies every type and table it names.
-- ============================================================================


-- #region [editorial.help]
-- A help category's and a help article's readable slug is permanent once the row exists
-- (Decision #274 (k)); a moved article keeps its slug and the route redirects its old address.
CREATE TRIGGER trg_help_categories_slug_immutable
    BEFORE UPDATE OF slug ON editorial.help_categories
    FOR EACH ROW EXECUTE FUNCTION editorial.fn_guard_slug_immutable();

CREATE TRIGGER trg_help_articles_slug_immutable
    BEFORE UPDATE OF slug ON editorial.help_articles
    FOR EACH ROW EXECUTE FUNCTION editorial.fn_guard_slug_immutable();
-- #endregion


-- #region [editorial.changelog]
CREATE TRIGGER trg_changelog_releases_version_immutable
    BEFORE UPDATE OF version ON editorial.changelog_releases
    FOR EACH ROW EXECUTE FUNCTION editorial.fn_guard_release_version_immutable();
-- #endregion


-- #region [editorial.articles]
-- An article's and an author's readable slug is permanent (Decision #274 (k)): a renamed article is
-- a NEW row plus a redirect, never an UPDATE of its address.
CREATE TRIGGER trg_article_authors_slug_immutable
    BEFORE UPDATE OF slug ON editorial.article_authors
    FOR EACH ROW EXECUTE FUNCTION editorial.fn_guard_slug_immutable();

CREATE TRIGGER trg_articles_slug_immutable
    BEFORE UPDATE OF slug ON editorial.articles
    FOR EACH ROW EXECUTE FUNCTION editorial.fn_guard_slug_immutable();
-- #endregion


-- #region [community.newsletter]
-- #endregion


-- #region [community.help_feedback]
-- #endregion


-- #region [community.feedback]
-- The idea's opaque `fbk-` address: minted on insert, frozen on update (security.fn_slug_guard,
-- 00001001). It lives here rather than in 00001890 with the other slug guards because every
-- community statement stays in this surface's region; slug.contract.test.ts reads both files.
DROP TRIGGER IF EXISTS trg_feedback_ideas_slug ON community.feedback_ideas;
CREATE TRIGGER trg_feedback_ideas_slug
    BEFORE INSERT OR UPDATE ON community.feedback_ideas
    FOR EACH ROW EXECUTE FUNCTION security.fn_slug_guard('fbk');

-- Decision #147 Tier 2 on every path into the table, an edit included.
DROP TRIGGER IF EXISTS trg_feedback_ideas_screen ON community.feedback_ideas;
CREATE TRIGGER trg_feedback_ideas_screen
    BEFORE INSERT OR UPDATE OF title, impact, body ON community.feedback_ideas
    FOR EACH ROW EXECUTE FUNCTION community.fn_feedback_idea_screen();

DROP TRIGGER IF EXISTS trg_feedback_ideas_no_delete ON community.feedback_ideas;
CREATE TRIGGER trg_feedback_ideas_no_delete
    BEFORE DELETE ON community.feedback_ideas
    FOR EACH ROW EXECUTE FUNCTION community.fn_feedback_idea_no_delete();

DROP TRIGGER IF EXISTS trg_feedback_votes_count ON community.feedback_votes;
CREATE TRIGGER trg_feedback_votes_count
    AFTER INSERT OR DELETE ON community.feedback_votes
    FOR EACH ROW EXECUTE FUNCTION community.fn_feedback_vote_count();

DROP TRIGGER IF EXISTS trg_feedback_status_events_append_only ON community.feedback_status_events;
CREATE TRIGGER trg_feedback_status_events_append_only
    BEFORE UPDATE OR DELETE ON community.feedback_status_events
    FOR EACH ROW EXECUTE FUNCTION community.fn_feedback_status_events_append_only();
-- #endregion
