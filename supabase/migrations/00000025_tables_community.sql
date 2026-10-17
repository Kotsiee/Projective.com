-- =============================================================================================
-- 00000025_tables_community.sql — community schema tables (Category 0).
--
-- What people DO around the platform and its promises (Decision #274): the newsletter opt-in, the
-- help centre's "Was this helpful?" votes and the public feedback board. Every row is written by a
-- person — through a SECURITY DEFINER door or the service role — and never by a content generator;
-- platform-authored content lives in `editorial` (00000024).
--
-- REGIONS. Each surface owns exactly one region below and fills only that region, so the work
-- orders that build them on parallel branches merge without touching each other's lines:
--
--   [newsletter]     community.newsletter_subscriptions           (filled, Decision #274)
--   [help_feedback]  P2 — the help centre's helpfulness votes
--   [feedback]       P7 — the feedback board: ideas, votes, status events
--
-- Keep the regions in this order and keep the blank lines between them. A table's policies, grants,
-- functions, triggers and indexes go into the same-named region of their own category file
-- (00002021, 00002520, 00001320, 00001898, 00004013), never next to the table.
-- =============================================================================================

-- #region [newsletter] Newsletter subscriptions — the public opt-in (moved from comms, Decision #274)
-- One row per address. The capture is public and anonymous, so the address is the only identity the
-- row has. Sends to this list are still gated by `comms.channel_suppressions` (bounces and
-- complaints), which stays in `comms` with the rest of outbound delivery: a send job reads both.
--
-- No client role holds any privilege on this table (00002520) and it has no policy (00002021). The
-- one writer is `community.subscribe_newsletter` (00001320), called by the service role from
-- NewsletterBackendService. The Zod SSOT is packages/types/community/newsletter.ts.
CREATE TABLE community.newsletter_subscriptions (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    -- Stored lowercase, and enforced, because the capture is public and anonymous: the address is
    -- the only identity this row has, so two casings would mean two sends and two unsubscribe links
    -- that each only work half the time. At most 254 characters (RFC 5321's path limit), so an
    -- oversized input is a field error at every layer rather than a btree row-size failure.
    email text NOT NULL,
    -- Where the FIRST capture happened, matching NewsletterSource in
    -- packages/types/community/newsletter.ts. A later capture that adds a topic keeps it.
    source text NOT NULL DEFAULT 'footer',
    -- The topics this address opted into: `general` is the platform newsletter, `changelog` the
    -- release notes (/changelog). A set — stored sorted and distinct by its one writer — and never
    -- empty: leaving the list is `unsubscribed_at`, not an empty array. The allowed set mirrors
    -- NEWSLETTER_TOPICS value for value.
    topics text[] NOT NULL DEFAULT ARRAY['general']::text[],
    -- Nullable by design: the footer capture never requires an account, and linking one later must
    -- not be a precondition for subscribing. ON DELETE SET NULL because closing an account is not
    -- the same act as unsubscribing — the opt-in survives and stays honoured.
    user_id uuid,
    locale text,
    -- Double opt-in. NULL means captured but unconfirmed, so a send-eligible row is exactly
    -- (confirmed_at IS NOT NULL AND unsubscribed_at IS NULL) and neither state needs a boolean that
    -- could end up contradicting its own timestamp.
    confirmed_at timestamptz,
    -- The opt-out, and the only record of it. A public form never clears these: whoever types an
    -- unsubscribed address into it has not proved they own it, so the request is recorded below and
    -- the address stays unsubscribed (and unsendable) until the confirm link applies it.
    unsubscribed_at timestamptz,
    unsubscribed_reason text,
    -- A re-subscribe request on an unsubscribed address, pending its owner's confirmation: the topics
    -- asked for since the unsubscribe (sorted, distinct, never empty) and when last asked. Both NULL
    -- when nothing is pending, and only ever set while unsubscribed_at is. The confirm-link handler
    -- (not built yet) applies it in one write: topics = resubscribe_topics, confirmed_at = now(),
    -- and unsubscribed_at, unsubscribed_reason and both of these cleared.
    resubscribe_topics text[],
    resubscribe_requested_at timestamptz,
    -- The opaque handle carried in the confirm / unsubscribe link. One-click unsubscribe cannot ask
    -- the reader to sign in first, so the link itself has to be the credential.
    token uuid NOT NULL DEFAULT gen_random_uuid (),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT newsletter_subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT newsletter_subscriptions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    -- One row per address. A re-subscribe updates this row (recording a pending request) rather than
    -- inserting a second one, which is what lets the service answer alreadySubscribed truthfully
    -- without leaking list membership through a differently shaped response.
    CONSTRAINT newsletter_subscriptions_email_key UNIQUE (email),
    CONSTRAINT newsletter_subscriptions_token_key UNIQUE (token),
    CONSTRAINT newsletter_subscriptions_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT newsletter_subscriptions_email_length CHECK (char_length(email) <= 254),
    CONSTRAINT newsletter_subscriptions_source_check CHECK (source IN ('footer', 'landing', 'explore')),
    CONSTRAINT newsletter_subscriptions_topics_check CHECK (
        cardinality(topics) >= 1
        AND array_position(topics, NULL) IS NULL
        AND topics <@ ARRAY['general', 'changelog']::text[]
    ),
    -- The same topic set as newsletter_subscriptions_topics_check, value for value.
    CONSTRAINT newsletter_subscriptions_resubscribe_check CHECK (
        (resubscribe_topics IS NULL) = (resubscribe_requested_at IS NULL)
        AND (resubscribe_topics IS NULL OR unsubscribed_at IS NOT NULL)
        AND (
            resubscribe_topics IS NULL
            OR (
                cardinality(resubscribe_topics) >= 1
                AND array_position(resubscribe_topics, NULL) IS NULL
                AND resubscribe_topics <@ ARRAY['general', 'changelog']::text[]
            )
        )
    )
);
-- #endregion


-- #region [help_feedback] Help-article helpfulness votes (P2)
-- One row per "Was this helpful?" answer on a help article (/help/<category>/<article>). Insert-only
-- and written by ONE door, community.submit_help_feedback (00001320): it stamps the voter from
-- auth.uid() (never from an argument), refuses an article that is not published, rate-limits, and
-- stores a comment only after comms.mask_pii (Decision #147). No client role holds any privilege on
-- the table and it has no policy (00002520 / 00002021), so nobody reads, edits or deletes a vote
-- through PostgREST; operators read it as the service role. The Zod SSOT is
-- packages/types/community/help-feedback.ts.
CREATE TABLE community.help_feedback (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    -- The article voted on. RESTRICT: an editorial article is retracted by visibility, never
    -- deleted, so a delete that would orphan its votes is refused.
    article_slug text NOT NULL,
    helpful boolean NOT NULL,
    -- What was missing, only after a "No". Stored MASKED. The reader may type at most 280 characters
    -- (the writer refuses more before masking); a placeholder can be longer than what it replaced
    -- (`$ab` → `[handle hidden]`), so the stored text may run to five times that.
    comment text,
    -- The categories comms.mask_pii hid in the comment (`email` · `payment_link` · `handle` ·
    -- `phone`), empty when it hid nothing — the same evidence a masked message keeps.
    comment_pii_categories text[] NOT NULL DEFAULT '{}'::text[],
    -- The signed-in voter, or NULL for a guest (and for a session with no profile row). SET NULL:
    -- an erased account's votes stay counted, unattributed.
    user_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT help_feedback_pkey PRIMARY KEY (id),
    CONSTRAINT help_feedback_article_slug_fkey
        FOREIGN KEY (article_slug) REFERENCES editorial.help_articles (slug) ON DELETE RESTRICT,
    CONSTRAINT help_feedback_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    CONSTRAINT help_feedback_comment_length CHECK (
        comment IS NULL OR char_length(comment) BETWEEN 1 AND 1400
    ),
    CONSTRAINT help_feedback_comment_on_no CHECK (comment IS NULL OR NOT helpful),
    CONSTRAINT help_feedback_pii_categories_check CHECK (
        array_position(comment_pii_categories, NULL) IS NULL
        AND (comment IS NOT NULL OR cardinality(comment_pii_categories) = 0)
    )
);
-- #endregion


-- #region [feedback] Feedback board — ideas, votes, status events (P7)
-- #endregion
