-- Indexes: editorial and community domains (Category 4, Decision #274).
--
-- One region per surface; each work order fills only its own. A UNIQUE or PRIMARY KEY constraint
-- already carries its index (in the table file) — what belongs here is the index a read path needs
-- beyond those, with a comment naming that read.


-- #region [editorial.help]
-- #endregion


-- #region [editorial.changelog]
-- #endregion


-- #region [editorial.articles]
-- The author foreign key: an author row's slug is checked against its articles whenever the row is
-- touched, and "everything this author wrote" reads by author. The reader itself loads the (small)
-- table whole and orders in TypeScript, so no publication-order index is needed yet.
CREATE INDEX IF NOT EXISTS idx_editorial_articles_author
    ON editorial.articles (author_slug);
-- #endregion


-- #region [community.newsletter]
-- A send to one topic's list — "everyone confirmed, still subscribed, who opted into `changelog`" —
-- is a containment test on the topics set over the send-eligible rows only. The email and token
-- lookups are served by their UNIQUE constraints.
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_topics_sendable
    ON community.newsletter_subscriptions USING gin (topics)
    WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;
-- #endregion


-- #region [community.help_feedback]
-- #endregion


-- #region [community.feedback]
-- #endregion
