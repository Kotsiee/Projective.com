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
-- #endregion


-- #region [feedback] Feedback board — ideas, votes, status events (P7)
-- The public board at /feedback and the global `?feedback=open` drawer (Decision #272). Three tables:
-- the ideas, one vote per person per idea, and the append-only history of every status an idea held.
-- Every write goes through a SECURITY DEFINER door in 00001320 [community.feedback] — no client role
-- holds INSERT, UPDATE or DELETE on any of them (00002520). The Zod SSOT is
-- packages/types/community/feedback.ts.

-- One idea. Its `status` is a state of the UNIFIED machine (PRODUCT_MANAGEMENT.md §3.1, owner ruling
-- (d), Decision #272), never a bespoke one; only the label the board shows differs:
--   backlog      "Under review" — the intake state; visible only to its author and operators
--   ready        "Planned"      — accepted onto the roadmap; public from here on
--   in_progress  "In progress"
--   complete     "Shipped"
--   archived     terminal: declined, duplicate or withdrawn; hidden from everyone but operators
-- Stored as text under a CHECK rather than a new enum so the whole surface lives in this region.
-- An idea is never deleted (trg_feedback_ideas_no_delete): retiring one is `archived`.
CREATE TABLE community.feedback_ideas (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    -- The opaque, prefixed, permanent address (`fbk-…`, Decision #88 — member content keeps opaque
    -- slugs). Filled by security.fn_slug_guard('fbk') on insert and frozen on update (00001898).
    slug text NOT NULL,
    -- Authored at most 90 characters (the door refuses more). The CHECK allows 120 because the
    -- screen trigger runs first and a masked placeholder ("[email hidden]") can be longer than what it
    -- replaced.
    title text NOT NULL,
    -- "What problem does this solve?" — required, so every idea states its reason.
    impact text NOT NULL,
    -- Optional details.
    body text,
    -- FEEDBACK_CATEGORIES, value for value.
    category text NOT NULL,
    status text NOT NULL DEFAULT 'backlog',
    -- Nullable only so closing an account does not take the community's ideas with it: the door
    -- always stamps auth.uid(), and an erased author's ideas survive unattributed.
    author_id uuid,
    -- Maintained by trg_feedback_votes_count (00001898) on every vote insert and delete.
    vote_count integer NOT NULL DEFAULT 0,
    -- The official response, written by an operator through community.respond_to_feedback_idea.
    team_response text,
    team_response_at timestamptz,
    team_response_by uuid,
    -- Which comms.mask_pii categories fired on this idea's text (Decision #147 Tier 2). Operator
    -- evidence only: no client role may read the column (00002520).
    pii_categories text[] NOT NULL DEFAULT '{}'::text[],
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    status_changed_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CONSTRAINT feedback_ideas_pkey PRIMARY KEY (id),
    CONSTRAINT feedback_ideas_slug_key UNIQUE (slug),
    CONSTRAINT ck_feedback_ideas_slug_shape CHECK (slug ~ '^fbk-[23456789abcdefghjkmnopqrstuvwxyz]{10}$'),
    CONSTRAINT feedback_ideas_author_id_fkey
        FOREIGN KEY (author_id) REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    CONSTRAINT feedback_ideas_team_response_by_fkey
        FOREIGN KEY (team_response_by) REFERENCES org.users_public (user_id) ON DELETE SET NULL,
    CONSTRAINT feedback_ideas_status_check CHECK (
        status IN ('backlog', 'ready', 'in_progress', 'complete', 'archived')
    ),
    CONSTRAINT feedback_ideas_category_check CHECK (
        category IN ('projects', 'escrow_payments', 'messaging', 'profiles', 'teams', 'explore', 'other')
    ),
    CONSTRAINT feedback_ideas_title_length CHECK (char_length(btrim(title)) BETWEEN 6 AND 120),
    CONSTRAINT feedback_ideas_impact_length CHECK (char_length(btrim(impact)) BETWEEN 10 AND 900),
    CONSTRAINT feedback_ideas_body_length CHECK (body IS NULL OR char_length(body) BETWEEN 1 AND 6000),
    CONSTRAINT feedback_ideas_vote_count_check CHECK (vote_count >= 0),
    -- `archived_at` is set exactly while the idea is archived, so neither can contradict the other.
    CONSTRAINT feedback_ideas_archived_check CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
    CONSTRAINT feedback_ideas_response_check CHECK (
        (team_response IS NULL) = (team_response_at IS NULL)
        AND (team_response IS NULL OR char_length(btrim(team_response)) BETWEEN 1 AND 2000)
    ),
    CONSTRAINT feedback_ideas_pii_categories_check CHECK (
        pii_categories <@ ARRAY['email', 'payment_link', 'handle', 'phone']::text[]
    )
);

-- One vote per person per idea — the primary key IS the uniqueness rule, so a second vote is a no-op
-- (the door inserts ON CONFLICT DO NOTHING) and never a second row. Retracting a vote deletes it;
-- closing an account retracts that person's votes (CASCADE), and the count trigger follows both.
CREATE TABLE community.feedback_votes (
    idea_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feedback_votes_pkey PRIMARY KEY (idea_id, user_id),
    CONSTRAINT feedback_votes_idea_id_fkey
        FOREIGN KEY (idea_id) REFERENCES community.feedback_ideas (id) ON DELETE RESTRICT,
    CONSTRAINT feedback_votes_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES org.users_public (user_id) ON DELETE CASCADE
);

-- Every status an idea has held, append-only (trg_feedback_status_events_append_only): the
-- submission (from NULL → backlog) and each operator move after it. The board's status history reads
-- this; `actor_id` and `note` are operator-side and withheld from client roles (00002520).
CREATE TABLE community.feedback_status_events (
    id uuid NOT NULL DEFAULT gen_random_uuid (),
    idea_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    -- Who moved it. An audit column with no FK on purpose: the history outlives an erased account
    -- as an opaque id, and an append-only row cannot take an ON DELETE SET NULL.
    actor_id uuid,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT feedback_status_events_pkey PRIMARY KEY (id),
    CONSTRAINT feedback_status_events_idea_id_fkey
        FOREIGN KEY (idea_id) REFERENCES community.feedback_ideas (id) ON DELETE RESTRICT,
    CONSTRAINT feedback_status_events_from_check CHECK (
        from_status IS NULL
        OR from_status IN ('backlog', 'ready', 'in_progress', 'complete', 'archived')
    ),
    CONSTRAINT feedback_status_events_to_check CHECK (
        to_status IN ('backlog', 'ready', 'in_progress', 'complete', 'archived')
    ),
    CONSTRAINT feedback_status_events_moves_check CHECK (from_status IS DISTINCT FROM to_status),
    CONSTRAINT feedback_status_events_note_length CHECK (note IS NULL OR char_length(note) <= 1000)
);
-- #endregion
