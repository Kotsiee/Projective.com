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
-- #endregion


-- #region [community.newsletter]
-- #endregion


-- #region [community.help_feedback]
-- #endregion


-- #region [community.feedback]
-- #endregion
