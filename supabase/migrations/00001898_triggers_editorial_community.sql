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
-- #endregion
