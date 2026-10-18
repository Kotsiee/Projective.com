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
-- The board, sorted "Top" within a status (vote_count, then newest) and "New" (newest first).
CREATE INDEX IF NOT EXISTS idx_feedback_ideas_status_top
    ON community.feedback_ideas (status, vote_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_ideas_status_new
    ON community.feedback_ideas (status, created_at DESC);
-- An author's own ideas: the "under review" tab and submit_feedback_idea's 24-hour rate limit.
CREATE INDEX IF NOT EXISTS idx_feedback_ideas_author_recent
    ON community.feedback_ideas (author_id, created_at DESC);
-- The viewer's own votes across the page shown, and vote_feedback_idea's hourly rate limit. The
-- per-idea fan-out (an idea's voters, for its status notification) is the primary key's prefix.
CREATE INDEX IF NOT EXISTS idx_feedback_votes_user_recent
    ON community.feedback_votes (user_id, created_at DESC);
-- One idea's status history, oldest first.
CREATE INDEX IF NOT EXISTS idx_feedback_status_events_idea
    ON community.feedback_status_events (idea_id, created_at);
-- #endregion
