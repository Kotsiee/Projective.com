-- Indexes: editorial and community domains (Category 4, Decision #274).
--
-- One region per surface; each work order fills only its own. A UNIQUE or PRIMARY KEY constraint
-- already carries its index (in the table file) — what belongs here is the index a read path needs
-- beyond those, with a comment naming that read.


-- #region [editorial.help]
-- #endregion


-- #region [editorial.changelog]
-- No secondary index, on purpose: the changelog reads the whole table (tens of rows) and orders it
-- in the service, and the one keyed read — a release by version — is the primary key.
-- #endregion


-- #region [editorial.articles]
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
