-- ============================================================================
-- 00001898 triggers editorial + community (Decision #274)
-- Trigger functions live in 00001320, under the same region names; every
-- CREATE TRIGGER for a table in either schema goes here, in its surface's
-- region. A trigger runs with the CALLER's search_path, so its function
-- schema-qualifies every type and table it names.
-- ============================================================================


-- #region [editorial.help]
-- #endregion


-- #region [editorial.changelog]
-- #endregion


-- #region [editorial.articles]
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
