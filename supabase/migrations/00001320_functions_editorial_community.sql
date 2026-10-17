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
-- #endregion


-- #region [editorial.articles]
-- #endregion


-- #region [community.newsletter]
-- community.subscribe_newsletter — the opt-in's one writer, called by the service role from
-- NewsletterBackendService (packages/backend/services/newsletter/). Its TypeScript twin is
-- planNewsletterSubscription (subscription-plan.ts), which the stub path runs and whose tests pin
-- the same four outcomes this function returns:
--
--   created       no row for the address — insert it with the one requested topic;
--   resubscribed  the address had unsubscribed — RECORD the request and change nothing else: the
--                 topic joins resubscribe_topics (sorted, distinct) and resubscribe_requested_at is
--                 stamped, while unsubscribed_at / unsubscribed_reason (the only record of the
--                 opt-out), topics and confirmed_at stay as they were, so the row stays unsendable.
--                 Whoever typed the address into a public form has not proved they own it; the
--                 confirm link (not built yet) applies the request;
--   topic_added   active, and the topic is new — add it to the set (sorted, distinct);
--   unchanged     active, and the topic is already held — write nothing, not even updated_at.
--
-- `already_subscribed` is true exactly for `unchanged`, so a repeat submission answers the same
-- success the first one did. The row is locked before it is read, and a concurrent first subscribe of
-- the same address is folded in rather than raised: INSERT … ON CONFLICT DO NOTHING, then loop to
-- lock the winner's row. Topic sets sort by code point (COLLATE "C"), as the TypeScript twin's
-- `normalizeTopics` does. The address guard refuses a malformed or over-long (> 254) address with
-- 22023; the table's CHECKs are the authority on `source` and `topic` (23514).
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
    v_prior community.newsletter_subscriptions%ROWTYPE;
    v_outcome text;
BEGIN
    IF v_email IS NULL OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(v_email) > 254 THEN
        RAISE EXCEPTION 'A valid email address is required.' USING ERRCODE = '22023';
    END IF;

    LOOP
        SELECT * INTO v_prior
        FROM community.newsletter_subscriptions
        WHERE email = v_email
        FOR UPDATE;

        IF NOT FOUND THEN
            INSERT INTO community.newsletter_subscriptions (email, source, topics)
            VALUES (v_email, v_source, ARRAY[v_topic])
            ON CONFLICT (email) DO NOTHING;
            IF FOUND THEN
                v_outcome := 'created';
                EXIT;
            END IF;
            -- A concurrent first subscribe of this address committed first: lock its row and fold
            -- this request into it.
            CONTINUE;
        END IF;

        IF v_prior.unsubscribed_at IS NOT NULL THEN
            UPDATE community.newsletter_subscriptions
            SET resubscribe_topics = ARRAY(
                    SELECT DISTINCT t COLLATE "C"
                    FROM unnest(COALESCE(v_prior.resubscribe_topics, '{}'::text[]) || v_topic) AS u (t)
                    ORDER BY 1
                ),
                resubscribe_requested_at = now(),
                updated_at = now()
            WHERE id = v_prior.id;
            v_outcome := 'resubscribed';
        ELSIF v_topic = ANY (v_prior.topics) THEN
            v_outcome := 'unchanged';
        ELSE
            UPDATE community.newsletter_subscriptions
            SET topics = ARRAY(
                    SELECT DISTINCT t COLLATE "C" FROM unnest(v_prior.topics || v_topic) AS u (t)
                    ORDER BY 1
                ),
                updated_at = now()
            WHERE id = v_prior.id;
            v_outcome := 'topic_added';
        END IF;
        EXIT;
    END LOOP;

    RETURN jsonb_build_object(
        'email', v_email,
        'topic', v_topic,
        'outcome', v_outcome,
        'already_subscribed', v_outcome = 'unchanged'
    );
END;
$$;
-- #endregion


-- #region [community.help_feedback]
-- #endregion


-- #region [community.feedback]
-- #endregion
