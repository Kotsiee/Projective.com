-- =============================================================================================
-- 00001320_functions_editorial_community.sql — functions for `editorial` and `community`
-- (Category 1, Decision #274).
--
-- Editorial content is read straight from its tables under their SELECT policies, so editorial
-- functions should be rare (a search helper, a derived read). Community rows are user-generated and
-- are written through the SECURITY DEFINER doors that live here: each one stamps the actor from
-- auth.uid() (never from an argument), rate-limits, screens public text through comms.mask_pii
-- (Decision #147) and refuses with a typed SQLSTATE the route maps to a status.
--
-- Every function in both schemas is revoked from PUBLIC, `anon` and `authenticated` by default
-- (00002510) and granted back by name in its surface's region there. Triggers live in 00001898.
--
-- REGIONS. One per surface; each work order fills only its own. [editorial.shared] holds the guards
-- every editorial surface attaches to its own tables.
-- =============================================================================================


-- #region [editorial.shared] Guards shared by every editorial surface (Decision #274 (k))
-- A platform-authored editorial row is addressed by a READABLE slug that is authored on its own,
-- never derived from the title, and frozen once the row exists: the scoped amendment of Decision #88
-- for editorial rows that #274 (k) records. A moved address is the defect #88 exists to prevent, so a
-- renamed page is a NEW row (the generator upserts by slug and never prunes) plus a redirect, never
-- an UPDATE of the slug. Attach it per table in 00001898, in the surface's own region:
--   CREATE TRIGGER trg_<table>_slug_immutable BEFORE UPDATE OF slug ON editorial.<table>
--       FOR EACH ROW EXECUTE FUNCTION editorial.fn_guard_slug_immutable();
CREATE OR REPLACE FUNCTION editorial.fn_guard_slug_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
	IF NEW.slug IS DISTINCT FROM OLD.slug THEN
		RAISE EXCEPTION 'editorial slug "%" is permanent and cannot change', OLD.slug
			USING ERRCODE = '23514',
				HINT = 'Author a new row under the new slug and redirect the old address to it.';
	END IF;
	RETURN NEW;
END;
$$;

COMMENT ON FUNCTION editorial.fn_guard_slug_immutable() IS
	'BEFORE UPDATE OF slug guard for editorial tables: a readable editorial slug never changes once the row exists (Decision #274 (k), amending #88 for platform-authored rows).';
-- #endregion


-- #region [editorial.help]
-- #endregion


-- #region [editorial.changelog]
-- A release's version is its public address (/changelog/<version>) and the natural key the
-- generated seed upserts on, so it never changes once the row exists — the changelog's twin of
-- fn_guard_slug_immutable (Decision #274 (k): changelog versions are fixed identifiers). A
-- mis-versioned release is withdrawn and authored again under the right version. Attached in
-- 00001898, [editorial.changelog]; a trigger function needs no client EXECUTE grant.
CREATE OR REPLACE FUNCTION editorial.fn_guard_release_version_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
	IF NEW.version IS DISTINCT FROM OLD.version THEN
		RAISE EXCEPTION 'changelog release "%" keeps its version for good', OLD.version
			USING ERRCODE = '23514',
				HINT = 'Withdraw the release and author it again under the new version.';
	END IF;
	RETURN NEW;
END;
$$;

COMMENT ON FUNCTION editorial.fn_guard_release_version_immutable() IS
	'BEFORE UPDATE OF version guard on editorial.changelog_releases: a release''s version is its permanent public address (Decisions #274 (k) / #278).';
-- #endregion


-- #region [editorial.articles]
-- #endregion


-- #region [community.newsletter]
-- The double opt-in (Decision #274 flag (c), resolved by PRD-E11's CD1) and the provider's copy of
-- the list (Decision #480 Q1 A, CD1 step 5). Every function is service-role only (00002510), called
-- from packages/backend/services/newsletter/:
--
--   fn_newsletter_pending_topics      what a confirmation would apply to a row, or NULL (the one rule);
--   fn_newsletter_suppressed          whether the suppression list refuses the address for marketing;
--   subscribe_newsletter              the public form: records the request, reports a mail as due;
--   read_newsletter_link              what the mailed link's pages show, writing nothing (a GET);
--   confirm_newsletter                the Confirm button's POST: applies the pending request;
--   unsubscribe_newsletter            the Unsubscribe button and the RFC 8058 one-click POST;
--   fn_newsletter_provider_sync_enabled  the sync's switch, the `newsletter.provider_sync` flag;
--   newsletter_sync_batch             what the provider sync must push or delete next (a read);
--   record_newsletter_sync            what one provider call did, stamped on its row;
--   record_newsletter_provider_event  the provider's own news about an address (its webhook).
--
-- The token in the mailed link is the only credential the link's doors take, because the address
-- has no account. A link is good for 7 days after its mail (confirmation_sent_at); an unsubscribe
-- never expires, and nothing here deletes a row. The provider's copy holds the address and its
-- topics only; Postgres stays the record, so the provider can take an address off the list but never
-- put one on.

-- community.fn_newsletter_pending_topics — what the confirm link would apply to this row: on an
-- unsubscribed address the pending re-subscribe (NULL when none), on an unconfirmed one its whole
-- topic set (the first confirmation covers it), on a confirmed one the pending topics (NULL when
-- none, Decision #274 flag (c): each topic is consented to on its own). NULL means nothing awaits
-- confirmation. Pure: it reads only its argument.
CREATE OR REPLACE FUNCTION community.fn_newsletter_pending_topics(
    p_row community.newsletter_subscriptions
)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN (p_row).unsubscribed_at IS NOT NULL THEN (p_row).resubscribe_topics
        WHEN (p_row).confirmed_at IS NULL THEN (p_row).topics
        ELSE (p_row).resubscribe_topics
    END;
$$;

-- community.fn_newsletter_suppressed — whether comms.fn_is_suppressed refuses this address for
-- marketing email: a hard bounce blocks every category, a complaint or an unsubscribe Marketing, and
-- the newsletter is Marketing (ruling N3 (b)). SECURITY DEFINER so the newsletter's doors need
-- nothing of `comms` but this one boolean for one address, whatever USAGE the service role holds
-- there (00002500); nothing else of `comms` is reachable through it.
CREATE OR REPLACE FUNCTION community.fn_newsletter_suppressed(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT comms.fn_is_suppressed(
        'email'::comms.notification_channel,
        p_email,
        'marketing'::comms.notification_category
    );
$$;

-- community.subscribe_newsletter — the public form's writer. Its TypeScript twin is
-- planNewsletterSubscription (subscription-plan.ts), which the stub path runs and whose tests pin
-- the same five outcomes this function returns:
--
--   created       no row for the address — insert it, unconfirmed, with the one requested topic;
--   resubscribed  the address had unsubscribed — RECORD the request and change nothing else: the
--                 topic joins resubscribe_topics (sorted, distinct) and resubscribe_requested_at is
--                 stamped, while unsubscribed_at / unsubscribed_reason (the only record of the
--                 opt-out), topics and confirmed_at stay as they were, so the row stays unsendable.
--                 Whoever typed the address into a public form has not proved they own it; the
--                 confirm link applies the request;
--   topic_added   active and unconfirmed, and the topic is new — add it to the set (sorted,
--                 distinct); the first confirmation covers every topic the row holds;
--   topic_pending active and confirmed, and the topic is new — record it in resubscribe_topics, as a
--                 re-subscribe is recorded: a confirmed address consents to each topic on its own;
--   unchanged     active, and the topic is already held — write nothing, not even updated_at.
--
-- Then, under the same lock: a confirmation mail is due when something awaits confirmation
-- (fn_newsletter_pending_topics), the last one is NULL or more than 10 minutes old, and the
-- suppression list does not refuse the address for marketing email (fn_newsletter_suppressed). A due mail
-- stamps confirmation_sent_at, and only that column: it is not a change of the subscription, so
-- updated_at is left alone. The answer carries the token and the topics to confirm only when the mail
-- is due; the service sends it after this transaction commits.
--
-- `already_subscribed` is true exactly for `unchanged`. The service answers every outcome with the
-- same public success, so neither field reaches the form. The row is locked before it is read, and a
-- concurrent first subscribe of the same address is folded in rather than raised: INSERT … ON
-- CONFLICT DO NOTHING, then loop to lock the winner's row. Topic sets sort by code point (COLLATE
-- "C"), as the TypeScript twin's `normalizeTopics` does. The address guard refuses a malformed or
-- over-long (> 254) address with 22023; the table's CHECKs are the authority on `source` and `topic`
-- (23514).
CREATE OR REPLACE FUNCTION community.subscribe_newsletter(
    p_email text,
    p_source text DEFAULT 'footer',
    p_topic text DEFAULT 'general'
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_email text := lower(btrim(p_email));
    v_source text := COALESCE(p_source, 'footer');
    v_topic text := COALESCE(p_topic, 'general');
    v_row community.newsletter_subscriptions%ROWTYPE;
    v_outcome text;
    v_pending text[];
    v_due boolean;
BEGIN
    IF v_email IS NULL OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(v_email) > 254 THEN
        RAISE EXCEPTION 'A valid email address is required.' USING ERRCODE = '22023';
    END IF;

    LOOP
        SELECT * INTO v_row
        FROM community.newsletter_subscriptions
        WHERE email = v_email
        FOR UPDATE;

        IF NOT FOUND THEN
            INSERT INTO community.newsletter_subscriptions (email, source, topics)
            VALUES (v_email, v_source, ARRAY[v_topic])
            ON CONFLICT (email) DO NOTHING
            RETURNING * INTO v_row;
            IF FOUND THEN
                v_outcome := 'created';
                EXIT;
            END IF;
            -- A concurrent first subscribe of this address committed first: lock its row and fold
            -- this request into it.
            CONTINUE;
        END IF;

        IF v_row.unsubscribed_at IS NOT NULL OR (
            v_row.confirmed_at IS NOT NULL AND NOT (v_topic = ANY (v_row.topics))
        ) THEN
            UPDATE community.newsletter_subscriptions
            SET resubscribe_topics = ARRAY(
                    SELECT DISTINCT t COLLATE "C"
                    FROM unnest(COALESCE(v_row.resubscribe_topics, '{}'::text[]) || v_topic) AS u (t)
                    ORDER BY 1
                ),
                resubscribe_requested_at = now(),
                updated_at = now()
            WHERE id = v_row.id
            RETURNING * INTO v_row;
            v_outcome := CASE WHEN v_row.unsubscribed_at IS NOT NULL THEN 'resubscribed' ELSE 'topic_pending' END;
        ELSIF v_topic = ANY (v_row.topics) THEN
            v_outcome := 'unchanged';
        ELSE
            UPDATE community.newsletter_subscriptions
            SET topics = ARRAY(
                    SELECT DISTINCT t COLLATE "C" FROM unnest(v_row.topics || v_topic) AS u (t)
                    ORDER BY 1
                ),
                updated_at = now()
            WHERE id = v_row.id
            RETURNING * INTO v_row;
            v_outcome := 'topic_added';
        END IF;
        EXIT;
    END LOOP;

    v_pending := community.fn_newsletter_pending_topics(v_row);
    v_due := v_pending IS NOT NULL
        AND (v_row.confirmation_sent_at IS NULL OR v_row.confirmation_sent_at < now() - interval '10 minutes')
        AND NOT community.fn_newsletter_suppressed(v_email);
    IF v_due THEN
        UPDATE community.newsletter_subscriptions
        SET confirmation_sent_at = now()
        WHERE id = v_row.id;
    END IF;

    RETURN jsonb_build_object(
        'email', v_email,
        'topic', v_topic,
        'outcome', v_outcome,
        'already_subscribed', v_outcome = 'unchanged',
        'confirmation_due', v_due,
        'token', CASE WHEN v_due THEN v_row.token END,
        'confirm_topics', CASE WHEN v_due THEN to_jsonb(v_pending) END
    );
END;
$$;

-- community.read_newsletter_link — what the mailed link's two pages show for a token, writing
-- nothing: a mail scanner opens every link, so a GET only reads (Decisions #445, #478). NULL for an
-- unknown token (the page's 404). Otherwise the address's standing, and never the address itself:
--
--   subscribed      confirmed and not unsubscribed (send-eligible);
--   unsubscribed    unsubscribed_at is set;
--   topics          the topics the row holds now;
--   pending_topics  what Confirm would apply (fn_newsletter_pending_topics), or NULL;
--   expired         pending_topics is set but the mail that carried the link is more than 7 days old
--                   (or was never sent), so Confirm would refuse it.
CREATE OR REPLACE FUNCTION community.read_newsletter_link(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_row community.newsletter_subscriptions%ROWTYPE;
    v_pending text[];
BEGIN
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_pending := community.fn_newsletter_pending_topics(v_row);
    RETURN jsonb_build_object(
        'subscribed', v_row.confirmed_at IS NOT NULL AND v_row.unsubscribed_at IS NULL,
        'unsubscribed', v_row.unsubscribed_at IS NOT NULL,
        'topics', to_jsonb(v_row.topics),
        'pending_topics', to_jsonb(v_pending),
        'expired', v_pending IS NOT NULL AND (
            v_row.confirmation_sent_at IS NULL OR v_row.confirmation_sent_at < now() - interval '7 days'
        )
    );
END;
$$;

-- community.confirm_newsletter — the confirm page's button (a POST; never a GET). The row's one
-- confirming write, applied under a row lock:
--
--   confirmed          something awaited confirmation and the link is fresh: topics become
--                      resubscribe_topics (an unsubscribed address), topics ∪ resubscribe_topics (a
--                      confirmed one) or stay (an unconfirmed one); confirmed_at = now(); and
--                      unsubscribed_at, unsubscribed_reason and the pending pair are cleared, so an
--                      opt-out ends only through a request its owner confirmed;
--   already_confirmed  nothing awaits and the address is subscribed: the same success, no write;
--   expired            something awaits but its mail is more than 7 days old (or was never sent):
--                      nothing is written, and subscribing again mails a fresh link;
--   unsubscribed       nothing awaits and the address has unsubscribed: no write;
--   not_found          no row holds the token.
--
-- Answers {outcome, topics}: the topics the address now holds (empty for not_found).
CREATE OR REPLACE FUNCTION community.confirm_newsletter(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_row community.newsletter_subscriptions%ROWTYPE;
    v_pending text[];
    v_outcome text;
BEGIN
    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE token = p_token FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found', 'topics', '[]'::jsonb);
    END IF;

    v_pending := community.fn_newsletter_pending_topics(v_row);
    IF v_pending IS NULL THEN
        v_outcome := CASE WHEN v_row.unsubscribed_at IS NOT NULL THEN 'unsubscribed' ELSE 'already_confirmed' END;
    ELSIF v_row.confirmation_sent_at IS NULL OR v_row.confirmation_sent_at < now() - interval '7 days' THEN
        v_outcome := 'expired';
    ELSE
        UPDATE community.newsletter_subscriptions
        SET topics = CASE
                WHEN unsubscribed_at IS NOT NULL THEN resubscribe_topics
                WHEN confirmed_at IS NULL THEN topics
                ELSE ARRAY(
                    SELECT DISTINCT t COLLATE "C" FROM unnest(topics || resubscribe_topics) AS u (t)
                    ORDER BY 1
                )
            END,
            confirmed_at = now(),
            unsubscribed_at = NULL,
            unsubscribed_reason = NULL,
            resubscribe_topics = NULL,
            resubscribe_requested_at = NULL,
            updated_at = now()
        WHERE id = v_row.id
        RETURNING * INTO v_row;
        v_outcome := 'confirmed';
    END IF;

    RETURN jsonb_build_object('outcome', v_outcome, 'topics', to_jsonb(v_row.topics));
END;
$$;

-- community.unsubscribe_newsletter — the unsubscribe page's button (p_reason 'link') and a mail
-- client's RFC 8058 one-click POST ('one_click'). Never a GET, never expires, idempotent:
--
--   unsubscribed          the address was on the list: unsubscribed_at = now(), the reason, and any
--                         pending request cleared;
--   already_unsubscribed  it had already left: the first opt-out's time and reason stay, and a
--                         request pending since is cleared (its owner has just said no);
--   not_found             no row holds the token.
--
-- Nothing is deleted: the row is the opt-out's only record. An unknown reason is refused (22023).
CREATE OR REPLACE FUNCTION community.unsubscribe_newsletter(p_token uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_row community.newsletter_subscriptions%ROWTYPE;
BEGIN
    IF p_reason IS NULL OR p_reason NOT IN ('link', 'one_click') THEN
        RAISE EXCEPTION 'Unknown unsubscribe reason.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE token = p_token FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;

    IF v_row.unsubscribed_at IS NOT NULL THEN
        IF v_row.resubscribe_topics IS NOT NULL THEN
            UPDATE community.newsletter_subscriptions
            SET resubscribe_topics = NULL, resubscribe_requested_at = NULL, updated_at = now()
            WHERE id = v_row.id;
        END IF;
        RETURN jsonb_build_object('outcome', 'already_unsubscribed');
    END IF;

    UPDATE community.newsletter_subscriptions
    SET unsubscribed_at = now(),
        unsubscribed_reason = p_reason,
        resubscribe_topics = NULL,
        resubscribe_requested_at = NULL,
        updated_at = now()
    WHERE id = v_row.id;
    RETURN jsonb_build_object('outcome', 'unsubscribed');
END;
$$;

-- community.fn_newsletter_provider_sync_enabled — the `newsletter.provider_sync` feature flag, false
-- when the row is missing. SECURITY DEFINER for the same reason as comms.fn_dispatch_enabled: the
-- service role reads no flag table, and this answers one boolean of one flag.
CREATE OR REPLACE FUNCTION community.fn_newsletter_provider_sync_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        (SELECT f.enabled FROM security.feature_flags f WHERE f.key = 'newsletter.provider_sync'),
        false
    );
$$;

-- community.newsletter_sync_batch — what newsletter-provider-sync must do next, oldest change first,
-- reading only. A row is SEND-ELIGIBLE when confirmed, not unsubscribed and not suppressed for
-- marketing email (fn_newsletter_suppressed); the provider must hold a contact for exactly those:
--
--   upsert  eligible, and the provider has not received this version (provider_synced_at NULL or
--           older than updated_at): create the contact, or set its topics;
--   remove  not eligible, and a provider contact is known (provider_contact_ref): delete it.
--
-- `reconfirmed` is true when the row was confirmed after the version the provider last received, the
-- one case in which an existing contact's own provider-side opt-out may be lifted: its owner has just
-- consented again. Answers {enabled, segment_id, topic_ids, rows}: the `newsletter.provider_sync` flag
-- (false when the row is missing, and then no rows), the provider's segment and per-topic ids
-- (security.platform_params), and at most p_limit rows (1–500). The address leaves only for the
-- provider call it is read for.
CREATE OR REPLACE FUNCTION community.newsletter_sync_batch(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_enabled boolean;
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
    v_rows jsonb;
BEGIN
    v_enabled := community.fn_newsletter_provider_sync_enabled();
    IF v_enabled THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.version, b.id), '[]'::jsonb) INTO v_rows
        FROM (
            SELECT r.id,
                   r.email,
                   to_jsonb(r.topics) AS topics,
                   CASE WHEN e.eligible THEN 'upsert' ELSE 'remove' END AS action,
                   r.provider_contact_ref AS contact_ref,
                   r.updated_at AS version,
                   r.confirmed_at IS NOT NULL
                       AND r.confirmed_at > COALESCE(r.provider_synced_at, '-infinity'::timestamptz) AS reconfirmed
            FROM community.newsletter_subscriptions r
            CROSS JOIN LATERAL (
                SELECT r.confirmed_at IS NOT NULL
                    AND r.unsubscribed_at IS NULL
                    AND NOT community.fn_newsletter_suppressed(r.email) AS eligible
            ) e
            WHERE (e.eligible AND (r.provider_synced_at IS NULL OR r.provider_synced_at < r.updated_at))
               OR (NOT e.eligible AND r.provider_contact_ref IS NOT NULL)
            ORDER BY r.updated_at, r.id
            LIMIT v_limit
        ) b;
    END IF;

    RETURN jsonb_build_object(
        'enabled', v_enabled,
        'segment_id', (SELECT p.value FROM security.platform_params p WHERE p.key = 'newsletter_provider_segment_id'),
        'topic_ids', (SELECT p.value FROM security.platform_params p WHERE p.key = 'newsletter_provider_topic_ids'),
        'rows', COALESCE(v_rows, '[]'::jsonb)
    );
END;
$$;

-- community.record_newsletter_sync — what one provider call did for one row, stamped against the
-- version the batch read (p_version, the row's updated_at then). Never touches updated_at: a sync is
-- not a change of the subscription.
--
--   upserted  the provider holds contact p_contact_ref opted in to exactly p_topics:
--             provider_contact_ref, provider_topics and provider_synced_at = p_version, unless a newer
--             version was already recorded (`stale`);
--   refused   the provider refused the address for good (not a rate limit or an outage):
--             provider_synced_at = p_version, so it is not retried until the row changes;
--   removed   contact p_contact_ref is gone: provider_contact_ref, provider_topics and
--             provider_synced_at cleared, so the row is created afresh if it is ever eligible again; a
--             different contact recorded since (a concurrent upsert) is left alone (`stale`).
--
-- Answers recorded · stale · not_found. An unknown action, an upsert or removal without its contact
-- id, or an unknown topic is refused (22023).
CREATE OR REPLACE FUNCTION community.record_newsletter_sync(
    p_id uuid,
    p_version timestamptz,
    p_action text,
    p_contact_ref text DEFAULT NULL,
    p_topics text[] DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_row community.newsletter_subscriptions%ROWTYPE;
BEGIN
    IF p_version IS NULL OR p_action IS NULL OR p_action NOT IN ('upserted', 'refused', 'removed') THEN
        RAISE EXCEPTION 'A sync record needs a version and a known action.' USING ERRCODE = '22023';
    END IF;
    IF p_action IN ('upserted', 'removed')
       AND (p_contact_ref IS NULL OR char_length(p_contact_ref) NOT BETWEEN 1 AND 128) THEN
        RAISE EXCEPTION 'A sync record of % needs the contact id.', p_action USING ERRCODE = '22023';
    END IF;
    IF p_action = 'upserted' AND (
        p_topics IS NULL OR array_position(p_topics, NULL) IS NOT NULL
        OR NOT p_topics <@ ARRAY['general', 'changelog']::text[]
    ) THEN
        RAISE EXCEPTION 'An upsert record needs the topics it opted in to.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'not_found';
    END IF;

    IF p_action = 'removed' THEN
        IF v_row.provider_contact_ref IS DISTINCT FROM p_contact_ref THEN
            RETURN 'stale';
        END IF;
        UPDATE community.newsletter_subscriptions
        SET provider_contact_ref = NULL, provider_topics = NULL, provider_synced_at = NULL
        WHERE id = p_id;
        RETURN 'recorded';
    END IF;

    IF v_row.provider_synced_at IS NOT NULL AND v_row.provider_synced_at > p_version THEN
        RETURN 'stale';
    END IF;
    IF p_action = 'upserted' THEN
        UPDATE community.newsletter_subscriptions
        SET provider_contact_ref = p_contact_ref,
            provider_topics = ARRAY(SELECT DISTINCT t COLLATE "C" FROM unnest(p_topics) AS u (t) ORDER BY 1),
            provider_synced_at = p_version
        WHERE id = p_id;
    ELSE
        UPDATE community.newsletter_subscriptions SET provider_synced_at = p_version WHERE id = p_id;
    END IF;
    RETURN 'recorded';
END;
$$;

-- community.record_newsletter_provider_event — the mail provider's own news about an address, from
-- its signed webhook (Resend's contact events and a spam complaint; NT3's DeliveryEventService). The
-- provider can take an address off the list, or a topic off an address, but never put either back:
-- consent is given only through the confirm link. Keyed by the address, under a row lock:
--
--   unsubscribed  contact p_contact_ref unsubscribed there    → unsubscribed_at, reason `provider`;
--   complaint     a spam complaint about any mail to it       → unsubscribed_at, reason `complaint`;
--   topics        its topic preferences changed there         → each p_opted_out topic the provider
--                 had opted in (provider_topics) leaves `topics`, and the last one leaving is an
--                 unsubscribe (reason `provider`); an opt-out of a topic the provider never held is the
--                 echo of a sync, not a choice. A p_opted_in topic the provider never held is not added
--                 here: the provider's copy is re-synced from this row instead (`resync`);
--   present       the provider holds contact p_contact_ref    → recorded when it is not the one known,
--                 and re-synced, so an ineligible address's stray contact is deleted and an eligible
--                 one is set to this row's topics;
--   deleted       contact p_contact_ref was deleted there    → when it is the contact this row knows,
--                 the provider columns are cleared and the address unsubscribed (reason `provider`);
--                 any other deletion (the sync's own, already cleared, or an older contact) is
--                 `unchanged`.
--
-- Staleness, so a late or replayed delivery never undoes a newer consent: an `unsubscribed` event of
-- a contact other than the one known is `stale`; a complaint or topic event that happened before the
-- row's last confirmation (p_occurred_at < confirmed_at) is `stale`, and so is an `unsubscribed`
-- event when no contact is known. An unsubscribe clears a pending request, as unsubscribe_newsletter
-- does. Answers {outcome}: unsubscribed · already_unsubscribed · topics_removed · resync · unchanged
-- · stale · not_found. An unknown event or topic, or a contact event without its id, is refused
-- (22023).
CREATE OR REPLACE FUNCTION community.record_newsletter_provider_event(
    p_email text,
    p_event text,
    p_occurred_at timestamptz DEFAULT NULL,
    p_contact_ref text DEFAULT NULL,
    p_opted_out text[] DEFAULT NULL,
    p_opted_in text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_email text := lower(btrim(COALESCE(p_email, '')));
    v_row community.newsletter_subscriptions%ROWTYPE;
    v_out text[] := COALESCE(p_opted_out, '{}'::text[]);
    v_in text[] := COALESCE(p_opted_in, '{}'::text[]);
    v_known text[];
    v_topics text[];
    v_reason text;
    v_before_consent boolean;
BEGIN
    IF p_event IS NULL OR p_event NOT IN ('unsubscribed', 'complaint', 'topics', 'present', 'deleted') THEN
        RAISE EXCEPTION 'Unknown provider event.' USING ERRCODE = '22023';
    END IF;
    IF array_position(v_out || v_in, NULL) IS NOT NULL
       OR NOT (v_out || v_in) <@ ARRAY['general', 'changelog']::text[] THEN
        RAISE EXCEPTION 'Unknown newsletter topic.' USING ERRCODE = '22023';
    END IF;
    IF p_event IN ('unsubscribed', 'present', 'deleted')
       AND (p_contact_ref IS NULL OR char_length(p_contact_ref) NOT BETWEEN 1 AND 128) THEN
        RAISE EXCEPTION 'A % event needs the contact id.', p_event USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM community.newsletter_subscriptions WHERE email = v_email FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'not_found');
    END IF;
    v_before_consent := v_row.confirmed_at IS NOT NULL AND p_occurred_at IS NOT NULL
        AND p_occurred_at < v_row.confirmed_at;

    IF p_event = 'present' THEN
        IF v_row.provider_contact_ref IS NOT DISTINCT FROM p_contact_ref THEN
            RETURN jsonb_build_object('outcome', 'unchanged');
        END IF;
        UPDATE community.newsletter_subscriptions
        SET provider_contact_ref = p_contact_ref, provider_topics = NULL, provider_synced_at = NULL
        WHERE id = v_row.id;
        RETURN jsonb_build_object('outcome', 'resync');
    END IF;

    IF p_event = 'deleted' THEN
        IF v_row.provider_contact_ref IS DISTINCT FROM p_contact_ref THEN
            RETURN jsonb_build_object('outcome', 'unchanged');
        END IF;
        UPDATE community.newsletter_subscriptions
        SET provider_contact_ref = NULL, provider_topics = NULL, provider_synced_at = NULL
        WHERE id = v_row.id;
        v_reason := 'provider';
    ELSIF p_event = 'unsubscribed' THEN
        IF v_row.provider_contact_ref IS DISTINCT FROM p_contact_ref
           AND (v_row.provider_contact_ref IS NOT NULL OR v_before_consent) THEN
            RETURN jsonb_build_object('outcome', 'stale');
        END IF;
        v_reason := 'provider';
    ELSIF v_before_consent THEN
        RETURN jsonb_build_object('outcome', 'stale');
    ELSIF p_event = 'complaint' THEN
        v_reason := 'complaint';
    ELSE
        -- p_event = 'topics'
        IF v_row.unsubscribed_at IS NOT NULL THEN
            RETURN jsonb_build_object('outcome', 'unchanged');
        END IF;
        v_known := COALESCE(v_row.provider_topics, '{}'::text[]);
        v_topics := ARRAY(
            SELECT t COLLATE "C" FROM unnest(v_row.topics) AS u (t)
            WHERE NOT (t = ANY (v_out) AND t = ANY (v_known))
            ORDER BY 1
        );
        IF cardinality(v_topics) = 0 THEN
            v_reason := 'provider';
        ELSIF v_topics IS DISTINCT FROM v_row.topics THEN
            UPDATE community.newsletter_subscriptions
            SET topics = v_topics,
                provider_topics = ARRAY(
                    SELECT t COLLATE "C" FROM unnest(v_known) AS u (t) WHERE NOT (t = ANY (v_out)) ORDER BY 1
                ),
                updated_at = now()
            WHERE id = v_row.id;
            RETURN jsonb_build_object('outcome', 'topics_removed');
        ELSIF v_row.confirmed_at IS NOT NULL
              AND EXISTS (SELECT 1 FROM unnest(v_in) AS u (t) WHERE NOT (t = ANY (v_known))) THEN
            UPDATE community.newsletter_subscriptions SET provider_synced_at = NULL WHERE id = v_row.id;
            RETURN jsonb_build_object('outcome', 'resync');
        ELSE
            RETURN jsonb_build_object('outcome', 'unchanged');
        END IF;
    END IF;

    -- What is left is an unsubscribe of the whole address, for v_reason.
    IF v_row.unsubscribed_at IS NOT NULL THEN
        IF v_row.resubscribe_topics IS NOT NULL THEN
            UPDATE community.newsletter_subscriptions
            SET resubscribe_topics = NULL, resubscribe_requested_at = NULL, updated_at = now()
            WHERE id = v_row.id;
        END IF;
        RETURN jsonb_build_object('outcome', 'already_unsubscribed');
    END IF;
    UPDATE community.newsletter_subscriptions
    SET unsubscribed_at = now(),
        unsubscribed_reason = v_reason,
        resubscribe_topics = NULL,
        resubscribe_requested_at = NULL,
        updated_at = now()
    WHERE id = v_row.id;
    RETURN jsonb_build_object('outcome', 'unsubscribed');
END;
$$;
-- #endregion


-- #region [community.help_feedback]
-- community.submit_help_feedback — the one writer of community.help_feedback (00000025), called by
-- HelpFeedbackBackendService (packages/backend/services/community/) with the caller's own client: the
-- anon client for a guest, the voter's JWT client when signed in. SECURITY DEFINER because no client
-- role holds any privilege on the table; everything a client could otherwise choose is decided here:
--
--   * the voter is auth.uid() — and only when it names a profile (org.users_public), so a session
--     with no profile row votes as a guest rather than failing the foreign key;
--   * the article must be one a reader can see right now (the same rule as
--     help_articles_select_published), else PH404;
--   * a comment goes only with a "No" and is at most 280 characters before masking (22023), and is
--     stored only after comms.mask_pii, with the categories it hid (Decision #147);
--   * the durable rate limits (the route's per-process limiter sits in front of them): a signed-in
--     voter's second vote on one article inside 24 hours writes nothing and answers
--     `duplicate: true` (serialised per voter and article, so a double press cannot write twice);
--     past 30 votes in an hour a voter is refused PH429; and an article takes at most 120 guest
--     votes an hour (PH429), which bounds a scripted flood the per-process limit cannot see.
--
-- Answers {recorded, duplicate}. Never updates or deletes a row.
CREATE OR REPLACE FUNCTION community.submit_help_feedback(
    p_article_slug text,
    p_helpful boolean,
    p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_slug text := lower(btrim(COALESCE(p_article_slug, '')));
    v_comment text := NULLIF(btrim(COALESCE(p_comment, '')), '');
    v_today date := (now() AT TIME ZONE 'UTC')::date;
    v_voter uuid;
    v_masked text;
    v_categories text[] := '{}'::text[];
    v_recent integer;
BEGIN
    IF p_helpful IS NULL THEN
        RAISE EXCEPTION 'Say whether the article helped.' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM editorial.help_articles a
    WHERE a.slug = v_slug
        AND a.published_on <= v_today
        AND (a.archived_on IS NULL OR a.archived_on > v_today);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'help article "%" is not published', v_slug USING ERRCODE = 'PH404';
    END IF;

    IF v_comment IS NOT NULL THEN
        IF p_helpful THEN
            RAISE EXCEPTION 'A comment goes with a "No".' USING ERRCODE = '22023';
        END IF;
        IF char_length(v_comment) > 280 THEN
            RAISE EXCEPTION 'A comment is at most 280 characters.' USING ERRCODE = '22023';
        END IF;
        SELECT m.masked, m.categories INTO v_masked, v_categories FROM comms.mask_pii(v_comment) m;
    END IF;

    SELECT u.user_id INTO v_voter FROM org.users_public u WHERE u.user_id = auth.uid();

    IF v_voter IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('community.help_feedback:' || v_voter::text || ':' || v_slug, 0));
        PERFORM 1
        FROM community.help_feedback f
        WHERE f.user_id = v_voter
            AND f.article_slug = v_slug
            AND f.created_at > now() - interval '24 hours';
        IF FOUND THEN
            RETURN jsonb_build_object('recorded', false, 'duplicate', true);
        END IF;

        SELECT count(*) INTO v_recent
        FROM community.help_feedback f
        WHERE f.user_id = v_voter AND f.created_at > now() - interval '1 hour';
        IF v_recent >= 30 THEN
            RAISE EXCEPTION 'Too many votes in the last hour.' USING ERRCODE = 'PH429';
        END IF;
    ELSE
        SELECT count(*) INTO v_recent
        FROM community.help_feedback f
        WHERE f.article_slug = v_slug
            AND f.user_id IS NULL
            AND f.created_at > now() - interval '1 hour';
        IF v_recent >= 120 THEN
            RAISE EXCEPTION 'This article has had too many votes in the last hour.' USING ERRCODE = 'PH429';
        END IF;
    END IF;

    INSERT INTO community.help_feedback (article_slug, helpful, comment, comment_pii_categories, user_id)
    VALUES (v_slug, p_helpful, v_masked, COALESCE(v_categories, '{}'::text[]), v_voter);

    RETURN jsonb_build_object('recorded', true, 'duplicate', false);
END;
$$;

COMMENT ON FUNCTION community.submit_help_feedback(text, boolean, text) IS
    'The one writer of community.help_feedback: a "Was this helpful?" vote on a published help article, the voter stamped from auth.uid(), a comment masked by comms.mask_pii (Decision #147), rate-limited (PH429) and deduplicated per signed-in voter per day (P2, Decision #274).';
-- #endregion


-- #region [community.feedback]
-- The feedback board's doors and trigger functions (Decision #272). An idea moves on the UNIFIED
-- machine (PRODUCT_MANAGEMENT.md §3.9): it is submitted into `backlog` ("Under review"), becomes
-- public at `ready` ("Planned"), then `in_progress` and `complete` ("Shipped"); `archived` is terminal.
-- Every door stamps auth.uid() itself, refuses with a typed SQLSTATE the service maps to a status,
-- and is granted to `authenticated` by name (00002510):
--
--   28000  not signed in                       401
--   42501  not an operator (status, response)   403
--   22023  a field out of bounds ("field: …")   422
--   P0002  no idea the caller can see           404   (a Backlog idea is never confirmed to exist)
--   55000  voting closed / an illegal move      409
--   PR429  over a rate limit (DETAIL = retry)   429
--
-- Visibility is ONE rule, stated three times and pinned by supabase/probes/feedback_board.sql: the
-- SELECT policies (00002021), community.fn_feedback_idea_visible below (what the doors use, since a
-- definer bypasses RLS) and canSeeFeedbackIdea in the fixture road (packages/types/community).

-- Whether the caller may see an idea in `p_status` written by `p_author`: the public statuses to
-- everyone, a Backlog idea to its author, and everything (Archived included) to an operator.
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_visible(p_status text, p_author uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p_status IN ('ready', 'in_progress', 'complete')
        OR (p_status = 'backlog' AND p_author IS NOT NULL AND p_author = auth.uid())
        OR security.is_admin();
$$;

-- The legal moves of the idea lifecycle. They use the unified machine's STATES but not all of its
-- §3.2 edges: an idea has no claimant and no deliverable, so Ready → In Progress skips Claimed,
-- In Progress → Complete skips Review, and Ready → Backlog ("sent back for review") has no §3.2 edge
-- at all — see Decision #272 (l), flagged for the owner. Archived is terminal and non-reopenable;
-- Complete may only be archived (a regression is a new idea).
CREATE OR REPLACE FUNCTION community.fn_feedback_move_legal(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_from
        WHEN 'backlog' THEN p_to IN ('ready', 'archived')
        WHEN 'ready' THEN p_to IN ('backlog', 'in_progress', 'archived')
        WHEN 'in_progress' THEN p_to IN ('ready', 'complete', 'archived')
        WHEN 'complete' THEN p_to = 'archived'
        ELSE false
    END;
$$;

-- The board's label for a stored state — the words a notification uses, matching
-- FEEDBACK_STATE_LABEL in packages/types/community/feedback.ts.
CREATE OR REPLACE FUNCTION community.fn_feedback_state_label(p_status text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE p_status
        WHEN 'backlog' THEN 'Under review'
        WHEN 'ready' THEN 'Planned'
        WHEN 'in_progress' THEN 'In progress'
        WHEN 'complete' THEN 'Shipped'
        WHEN 'archived' THEN 'Archived'
        ELSE p_status
    END;
$$;

-- An idea as the board reads it: the client-readable columns only (never pii_categories or
-- team_response_by), plus whether the caller has voted for it.
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_json(p_idea community.feedback_ideas)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'id', p_idea.id,
        'slug', p_idea.slug,
        'title', p_idea.title,
        'impact', p_idea.impact,
        'body', p_idea.body,
        'category', p_idea.category,
        'status', p_idea.status,
        'author_id', p_idea.author_id,
        'vote_count', p_idea.vote_count,
        'team_response', p_idea.team_response,
        'team_response_at', p_idea.team_response_at,
        'created_at', p_idea.created_at,
        'updated_at', p_idea.updated_at,
        'status_changed_at', p_idea.status_changed_at,
        'archived_at', p_idea.archived_at,
        'viewer_voted', EXISTS (
            SELECT 1 FROM community.feedback_votes v
            WHERE v.idea_id = p_idea.id AND v.user_id = auth.uid()
        )
    );
$$;

-- Trigger (BEFORE INSERT OR UPDATE OF title, impact, body): the Tier 2 floor of Decision #147. Public
-- copy may never carry an email, a payment link or handle, or a phone number; the service refuses
-- them first (Tier 1, a field-named 422), and this masks whatever reaches the table by any path — a
-- door, the service role or a seed — and records which categories fired. Every name is qualified,
-- because a trigger runs with the caller's search_path.
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_screen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_title record;
    v_impact record;
    v_body record;
BEGIN
    SELECT m.masked, m.categories INTO v_title FROM comms.mask_pii(NEW.title) AS m;
    SELECT m.masked, m.categories INTO v_impact FROM comms.mask_pii(NEW.impact) AS m;
    SELECT m.masked, m.categories INTO v_body FROM comms.mask_pii(NEW.body) AS m;
    NEW.title := v_title.masked;
    NEW.impact := v_impact.masked;
    NEW.body := v_body.masked;
    NEW.pii_categories := ARRAY(
        SELECT DISTINCT c COLLATE "C"
        FROM unnest(
            COALESCE(v_title.categories, '{}'::text[])
                || COALESCE(v_impact.categories, '{}'::text[])
                || COALESCE(v_body.categories, '{}'::text[])
        ) AS u (c)
        ORDER BY 1
    );
    RETURN NEW;
END;
$$;

-- Trigger (AFTER INSERT OR DELETE on feedback_votes): keeps `vote_count` equal to the number of vote
-- rows. A definer, so the count is kept whoever writes the vote; it updates nothing else.
CREATE OR REPLACE FUNCTION community.fn_feedback_vote_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE community.feedback_ideas SET vote_count = vote_count + 1 WHERE id = NEW.idea_id;
        RETURN NEW;
    END IF;
    UPDATE community.feedback_ideas SET vote_count = GREATEST(vote_count - 1, 0) WHERE id = OLD.idea_id;
    RETURN OLD;
END;
$$;

-- Trigger (BEFORE DELETE on feedback_ideas): nothing on the board is hard-deleted (§5.4) — retiring
-- an idea is `archived`, which keeps its votes and history for audit.
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'A feedback idea is never deleted; archive it instead.'
        USING ERRCODE = '55000';
END;
$$;

-- Trigger (BEFORE UPDATE OR DELETE on feedback_status_events): the history is append-only, for every
-- role — a status an idea held stays held.
CREATE OR REPLACE FUNCTION community.fn_feedback_status_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'The feedback status history is append-only.'
        USING ERRCODE = '55000';
END;
$$;

-- community.submit_feedback_idea — a signed-in person suggests an idea. It enters `backlog` ("Under
-- review"), so nobody but its author and the operators sees it until an operator moves it to Ready:
-- Decision #148's screening is not built, so review IS the publication gate. The author's own vote
-- is cast with it, and the submission is the first history row (NULL → backlog). Five ideas per
-- person per rolling 24 hours — counted under a per-person advisory lock (the same key the vote door
-- takes), so two concurrent submits cannot both read four and both insert.
CREATE OR REPLACE FUNCTION community.submit_feedback_idea(
    p_title text,
    p_category text,
    p_impact text,
    p_body text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_title text := btrim(COALESCE(p_title, ''));
    v_impact text := btrim(COALESCE(p_impact, ''));
    v_body text := NULLIF(btrim(COALESCE(p_body, '')), '');
    v_recent integer;
    v_oldest timestamptz;
    v_idea community.feedback_ideas%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to suggest an idea.' USING ERRCODE = '28000';
    END IF;
    IF char_length(v_title) < 6 OR char_length(v_title) > 90 THEN
        RAISE EXCEPTION 'title: Give the idea a title of 6 to 90 characters.' USING ERRCODE = '22023';
    END IF;
    IF p_category IS NULL OR p_category NOT IN (
        'projects', 'escrow_payments', 'messaging', 'profiles', 'teams', 'explore', 'other'
    ) THEN
        RAISE EXCEPTION 'category: Choose a category.' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_impact) < 10 OR char_length(v_impact) > 600 THEN
        RAISE EXCEPTION 'impact: Say what problem this solves in 10 to 600 characters.'
            USING ERRCODE = '22023';
    END IF;
    IF v_body IS NOT NULL AND char_length(v_body) > 4000 THEN
        RAISE EXCEPTION 'body: Keep the details under 4,000 characters.' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('community.feedback:' || v_uid::text));
    SELECT count(*), min(created_at) INTO v_recent, v_oldest
    FROM community.feedback_ideas
    WHERE author_id = v_uid AND created_at > now() - interval '24 hours';
    IF v_recent >= 5 THEN
        RAISE EXCEPTION 'You have suggested five ideas today. Try again tomorrow.'
            USING ERRCODE = 'PR429',
                DETAIL = to_char((v_oldest + interval '24 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    END IF;

    INSERT INTO community.feedback_ideas (title, impact, body, category, status, author_id)
    VALUES (v_title, v_impact, v_body, p_category, 'backlog', v_uid)
    RETURNING * INTO v_idea;

    INSERT INTO community.feedback_status_events (idea_id, from_status, to_status, actor_id)
    VALUES (v_idea.id, NULL, 'backlog', v_uid);

    INSERT INTO community.feedback_votes (idea_id, user_id) VALUES (v_idea.id, v_uid);

    SELECT * INTO v_idea FROM community.feedback_ideas WHERE id = v_idea.id;
    RETURN community.fn_feedback_idea_json(v_idea);
END;
$$;

-- The idea `p_slug` names, locked, when the caller may see it — or P0002 (one refusal for "absent"
-- and "not yours to see", so a Backlog idea's existence is never confirmed).
CREATE OR REPLACE FUNCTION community.fn_feedback_idea_for_caller(p_slug text)
RETURNS community.feedback_ideas
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_idea community.feedback_ideas%ROWTYPE;
BEGIN
    SELECT * INTO v_idea FROM community.feedback_ideas WHERE slug = p_slug FOR UPDATE;
    IF NOT FOUND OR NOT community.fn_feedback_idea_visible(v_idea.status, v_idea.author_id) THEN
        RAISE EXCEPTION 'That idea does not exist.' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_idea;
END;
$$;

-- community.vote_feedback_idea / unvote_feedback_idea — idempotent: a repeat vote, or retracting a
-- vote never cast, changes nothing and answers the same `{ voted, vote_count }`. Voting is open while
-- an idea is under review, planned or in progress, and closed once it ships or is archived. 120 new
-- votes per person per rolling hour, counted under the per-person advisory lock the submit door takes
-- (taken before the idea's row lock, so the two locks are always acquired in one order).
CREATE OR REPLACE FUNCTION community.vote_feedback_idea(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_idea community.feedback_ideas%ROWTYPE;
    v_recent integer;
    v_oldest timestamptz;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to vote.' USING ERRCODE = '28000';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('community.feedback:' || v_uid::text));
    v_idea := community.fn_feedback_idea_for_caller(p_slug);
    IF v_idea.status NOT IN ('backlog', 'ready', 'in_progress') THEN
        RAISE EXCEPTION 'Voting has closed on this idea.' USING ERRCODE = '55000';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM community.feedback_votes WHERE idea_id = v_idea.id AND user_id = v_uid
    ) THEN
        SELECT count(*), min(created_at) INTO v_recent, v_oldest
        FROM community.feedback_votes
        WHERE user_id = v_uid AND created_at > now() - interval '1 hour';
        IF v_recent >= 120 THEN
            RAISE EXCEPTION 'That is a lot of votes in an hour. Try again shortly.'
                USING ERRCODE = 'PR429',
                    DETAIL = to_char((v_oldest + interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
        END IF;
        INSERT INTO community.feedback_votes (idea_id, user_id)
        VALUES (v_idea.id, v_uid)
        ON CONFLICT (idea_id, user_id) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'voted', true,
        'vote_count', (SELECT vote_count FROM community.feedback_ideas WHERE id = v_idea.id)
    );
END;
$$;

CREATE OR REPLACE FUNCTION community.unvote_feedback_idea(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_idea community.feedback_ideas%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to vote.' USING ERRCODE = '28000';
    END IF;
    v_idea := community.fn_feedback_idea_for_caller(p_slug);
    IF v_idea.status NOT IN ('backlog', 'ready', 'in_progress') THEN
        RAISE EXCEPTION 'Voting has closed on this idea.' USING ERRCODE = '55000';
    END IF;

    DELETE FROM community.feedback_votes WHERE idea_id = v_idea.id AND user_id = v_uid;

    RETURN jsonb_build_object(
        'voted', false,
        'vote_count', (SELECT vote_count FROM community.feedback_ideas WHERE id = v_idea.id)
    );
END;
$$;

-- community.set_feedback_idea_status — an operator (ops.admin_users) moves an idea along the
-- lifecycle. Moving to the state it already holds is a no-op answer, not a refusal; an illegal move
-- (fn_feedback_move_legal) is 55000. Each move appends a history row and tells the author and every
-- voter (not the operator) through `feedback.status_changed` (00005010), linking the idea.
CREATE OR REPLACE FUNCTION community.set_feedback_idea_status(
    p_slug text,
    p_status text,
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_idea community.feedback_ideas%ROWTYPE;
    v_from text;
    v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
    v_label text;
    v_recipient uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to continue.' USING ERRCODE = '28000';
    END IF;
    IF NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a Projective operator can change an idea''s status.'
            USING ERRCODE = '42501';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('backlog', 'ready', 'in_progress', 'complete', 'archived') THEN
        RAISE EXCEPTION 'status: Choose a status.' USING ERRCODE = '22023';
    END IF;
    IF v_note IS NOT NULL AND char_length(v_note) > 1000 THEN
        RAISE EXCEPTION 'note: Keep the note under 1,000 characters.' USING ERRCODE = '22023';
    END IF;

    v_idea := community.fn_feedback_idea_for_caller(p_slug);
    v_from := v_idea.status;
    IF v_from = p_status THEN
        RETURN community.fn_feedback_idea_json(v_idea);
    END IF;
    IF NOT community.fn_feedback_move_legal(v_from, p_status) THEN
        RAISE EXCEPTION 'An idea cannot move from % to %.',
            community.fn_feedback_state_label(v_from), community.fn_feedback_state_label(p_status)
            USING ERRCODE = '55000';
    END IF;

    UPDATE community.feedback_ideas
    SET status = p_status,
        status_changed_at = now(),
        updated_at = now(),
        archived_at = CASE WHEN p_status = 'archived' THEN now() END
    WHERE id = v_idea.id
    RETURNING * INTO v_idea;

    INSERT INTO community.feedback_status_events (idea_id, from_status, to_status, actor_id, note)
    VALUES (v_idea.id, v_from, p_status, v_uid, v_note);

    v_label := community.fn_feedback_state_label(p_status);
    FOR v_recipient IN
        SELECT DISTINCT r.user_id
        FROM (
            SELECT v_idea.author_id AS user_id
            UNION ALL
            SELECT v.user_id FROM community.feedback_votes v WHERE v.idea_id = v_idea.id
        ) r
        WHERE r.user_id IS NOT NULL AND r.user_id <> v_uid
    LOOP
        PERFORM comms.fn_notify(
            v_recipient,
            'feedback.status_changed',
            format('"%s" is now %s', v_idea.title, v_label),
            CASE
                WHEN v_recipient = v_idea.author_id
                    THEN format('An idea you suggested moved from %s to %s.',
                        community.fn_feedback_state_label(v_from), v_label)
                ELSE format('An idea you voted for moved from %s to %s.',
                    community.fn_feedback_state_label(v_from), v_label)
            END,
            'community.feedback_ideas',
            v_idea.id,
            jsonb_build_object('slug', v_idea.slug, 'from', v_from, 'to', p_status),
            v_uid,
            NULL,
            NULL,
            'feedback:' || v_idea.slug,
            '/feedback?idea=' || v_idea.slug
        );
    END LOOP;

    RETURN community.fn_feedback_idea_json(v_idea);
END;
$$;

-- community.respond_to_feedback_idea — an operator writes (or, with an empty response, clears) the
-- team's official response shown on the idea.
CREATE OR REPLACE FUNCTION community.respond_to_feedback_idea(p_slug text, p_response text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_response text := NULLIF(btrim(COALESCE(p_response, '')), '');
    v_idea community.feedback_ideas%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to continue.' USING ERRCODE = '28000';
    END IF;
    IF NOT security.is_admin() THEN
        RAISE EXCEPTION 'Only a Projective operator can respond for the team.'
            USING ERRCODE = '42501';
    END IF;
    IF v_response IS NOT NULL AND char_length(v_response) > 2000 THEN
        RAISE EXCEPTION 'response: Keep the response under 2,000 characters.' USING ERRCODE = '22023';
    END IF;

    v_idea := community.fn_feedback_idea_for_caller(p_slug);
    UPDATE community.feedback_ideas
    SET team_response = v_response,
        team_response_at = CASE WHEN v_response IS NULL THEN NULL ELSE now() END,
        team_response_by = CASE WHEN v_response IS NULL THEN NULL ELSE v_uid END,
        updated_at = now()
    WHERE id = v_idea.id
    RETURNING * INTO v_idea;

    RETURN community.fn_feedback_idea_json(v_idea);
END;
$$;

-- community.moderate_feedback_idea — an operator's move and/or the team's response in ONE
-- transaction: it runs set_feedback_idea_status (when p_status is given) and then
-- respond_to_feedback_idea (when p_response is given — an empty string clears it), so a refused
-- response rolls the move and its notifications back with it. Every check is the two doors' own;
-- this adds only "change something". What FeedbackBackendService.moderate calls.
CREATE OR REPLACE FUNCTION community.moderate_feedback_idea(
    p_slug text,
    p_status text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_response text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_answer jsonb;
BEGIN
    IF p_status IS NULL AND p_response IS NULL THEN
        RAISE EXCEPTION 'status: Change the status, the response, or both.' USING ERRCODE = '22023';
    END IF;
    IF p_status IS NOT NULL THEN
        v_answer := community.set_feedback_idea_status(p_slug, p_status, p_note);
    END IF;
    IF p_response IS NOT NULL THEN
        v_answer := community.respond_to_feedback_idea(p_slug, p_response);
    END IF;
    RETURN v_answer;
END;
$$;

-- community.feedback_status_counts — how many ideas the CALLER can see in each state, for the
-- board's tab counts. SECURITY INVOKER on purpose: it is the SELECT policies that decide, so a guest
-- counts the public statuses, an author also their own ideas under review, an operator everything.
CREATE OR REPLACE FUNCTION community.feedback_status_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
    FROM (
        SELECT i.status, count(*) AS n
        FROM community.feedback_ideas i
        GROUP BY i.status
    ) s;
$$;
-- #endregion
