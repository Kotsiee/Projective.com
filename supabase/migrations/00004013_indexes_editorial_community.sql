-- Indexes: editorial and community domains (Category 4, Decision #274).
--
-- One region per surface; each work order fills only its own. A UNIQUE or PRIMARY KEY constraint
-- already carries its index (in the table file) — what belongs here is the index a read path needs
-- beyond those, with a comment naming that read.


-- #region [editorial.help]
-- None beyond the constraints: the help service reads both tables whole (they are small reference
-- sets), help_articles_category_position_key leads with category_slug and so also serves its foreign
-- key, and help_articles_faq_rank_key serves the FAQ order.
-- #endregion


-- #region [editorial.changelog]
-- No secondary index, on purpose: the changelog reads the whole table (tens of rows) and orders it
-- in the service, and the one keyed read — a release by version — is the primary key.
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
-- submit_help_feedback's signed-in checks — "has this voter voted on this article in the last day"
-- and "how many votes has this voter cast in the last hour" — and the user_id foreign key's
-- ON DELETE SET NULL. Guests (user_id NULL) are never looked up by voter, so they are left out.
CREATE INDEX IF NOT EXISTS idx_help_feedback_voter_recent
    ON community.help_feedback (user_id, created_at DESC)
    WHERE user_id IS NOT NULL;

-- The per-article guest ceiling ("guest votes on this article in the last hour"), an operator's
-- per-article tally, and the article_slug foreign key.
CREATE INDEX IF NOT EXISTS idx_help_feedback_article_recent
    ON community.help_feedback (article_slug, created_at DESC);
-- #endregion


-- #region [community.feedback]
-- #endregion
