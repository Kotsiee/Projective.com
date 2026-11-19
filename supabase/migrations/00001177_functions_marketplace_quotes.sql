-- Functions: marketplace quote requests and offers (Category 1; Decision #458).
--
-- A buyer asks the seller of a service to price custom scope (`request_quote`). The host answers with a
-- priced offer (`send_quote_offer`; a new one supersedes the pending one), withdraws it, or declines
-- the request; the buyer accepts or declines the offer, or withdraws the request. Accepting puts
-- exactly ONE `one_off_service` line in the buyer's personal basket, and checkout prices that line from
-- the offer (`fn_quote_offer_terms`), never from its snapshot. Nothing here reserves, charges or
-- escrows: money moves only at checkout, where the offer escrows like any One-Off. The seller's expiry
-- bounds payment as well as acceptance (owner ruling A, CK7): an accepted offer past it is not re-added
-- to a basket, checkout refuses it, and the buyer withdraws the request and may ask again.
--
-- There is no client write on either table (00002018), so each door is the only way to make its move.
-- A door locks the request first and then its offer, so two doors on one request serialise in one
-- order. A refusal is 'Quote refused: <code>' (23514), which QuoteBackendService turns into a sentence;
-- the age gate's PM403 passes through.
--
-- The evidence (Decision #522). A seller may also issue a quote unprompted, from a conversation the
-- buyer started (`issue_quote`). Every offer's terms are frozen once written and carry the SHA-256 of
-- their canonical form (`fn_quote_terms`, stamped on insert); every move appends one
-- `marketplace.quote_events` row with the offer's terms and hash as they stood, and posts a quote card
-- into the pair's conversation. Checkout re-hashes the offer before charging it and records the
-- `paid` event and the order line that funded the engagement.

-- #region Helpers
-- An offer's terms in canonical form: what its hash is taken over and what an event snapshots. Instants
-- are written in UTC so the text, and so the hash, never depends on a session's time zone.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_terms(o marketplace.quote_offers)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pg_catalog.jsonb_build_object(
        'offer', o.id,
        'request', o.quote_request_id,
        'listing', q.blueprint_id,
        'seller', o.author_user_id,
        'buyer', q.requester_user_id,
        'scope', o.scope,
        'deliverables', pg_catalog.to_jsonb(o.deliverables),
        'price_cents', o.price_cents,
        'currency', o.currency,
        'turnaround_days', o.turnaround_days,
        'expires_at', pg_catalog.to_char(o.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'issued_at', pg_catalog.to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
      FROM marketplace.quote_requests q
     WHERE q.id = o.quote_request_id;
$$;

-- The hex SHA-256 of a terms object's text. jsonb prints its keys in one fixed order, so equal terms
-- always hash equal.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_hash(p_terms jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_terms::text, 'UTF8')), 'hex');
$$;

-- BEFORE INSERT on quote_offers: the hash is derived from the row, never taken from a writer.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_offers_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.terms_hash := marketplace.fn_quote_hash(marketplace.fn_quote_terms(NEW));
    RETURN NEW;
END;
$$;

-- BEFORE UPDATE OR DELETE on the quote record. An offer's terms never change: only its lifecycle
-- columns move. An event is never changed. A request, an offer or an event is never deleted directly;
-- the cascade of an erased account (a delete fired from another table's trigger) still passes.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_record_kept()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_moves text[] := ARRAY['status', 'superseded_by', 'decided_at', 'updated_at'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF pg_catalog.pg_trigger_depth() > 1 THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'Quote refused: record_kept' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_TABLE_NAME = 'quote_events' THEN
        RAISE EXCEPTION 'Quote refused: record_kept' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_TABLE_NAME = 'quote_offers'
       AND (pg_catalog.to_jsonb(NEW) - v_moves) IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - v_moves) THEN
        RAISE EXCEPTION 'Quote refused: terms_frozen' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

-- The pair's conversation, opened when they have none. A buyer's first ask opens it as an inquiry about
-- the listing; anything else opens a plain DM.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_thread(p_request marketplace.quote_requests)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_thread uuid;
    v_listing uuid;
BEGIN
    SELECT t.id INTO v_thread
      FROM comms.dm_threads t
      JOIN comms.dm_participants a ON a.thread_id = t.id AND a.user_id = p_request.host_user_id
      JOIN comms.dm_participants b ON b.thread_id = t.id AND b.user_id = p_request.requester_user_id
     WHERE t.kind IN ('dm', 'service_inquiry')
     ORDER BY t.created_at
     LIMIT 1;
    IF v_thread IS NOT NULL THEN
        RETURN v_thread;
    END IF;
    IF v_uid = p_request.requester_user_id THEN
        SELECT l.id INTO v_listing
          FROM catalogue.listings l
         WHERE l.service_blueprint_id = p_request.blueprint_id
           AND l.owner_user_id = p_request.host_user_id
           AND l.status = 'published'::catalogue.listing_status
         LIMIT 1;
    END IF;
    RETURN (comms.get_or_create_dm_thread(
        CASE WHEN v_uid = p_request.host_user_id THEN p_request.requester_user_id ELSE p_request.host_user_id END,
        v_listing
    ) ->> 'thread_id')::uuid;
END;
$$;

-- Record one move: the event row (with the offer's terms and hash as they stand, when it names one), and
-- the quote card that carries it in the pair's conversation, sent as the person who moved.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_event(
    p_request marketplace.quote_requests,
    p_offer uuid,
    p_kind text,
    p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_offer marketplace.quote_offers;
    v_terms jsonb;
    v_event uuid;
    v_title text := marketplace.fn_quote_listing_title(p_request);
    v_body text;
BEGIN
    IF p_offer IS NOT NULL THEN
        SELECT * INTO v_offer FROM marketplace.quote_offers WHERE id = p_offer;
        v_terms := marketplace.fn_quote_terms(v_offer);
    END IF;

    INSERT INTO marketplace.quote_events (
        quote_request_id, quote_offer_id, actor_user_id, kind, terms, terms_hash, detail
    ) VALUES (
        p_request.id, p_offer, v_uid, p_kind, v_terms,
        CASE WHEN v_terms IS NOT NULL THEN marketplace.fn_quote_hash(v_terms) END,
        COALESCE(p_detail, '{}'::jsonb)
    )
    RETURNING id INTO v_event;

    v_body := CASE p_kind
        WHEN 'requested' THEN 'Asked for a quote on ' || v_title || '.'
        WHEN 'issued' THEN 'Sent a quote for ' || v_title || '.'
        WHEN 'offer_sent' THEN 'Sent an offer for ' || v_title || '.'
        WHEN 'offer_revised' THEN 'Revised the offer for ' || v_title || '.'
        WHEN 'offer_withdrawn' THEN 'Withdrew the offer for ' || v_title || '.'
        WHEN 'request_declined' THEN 'Declined the quote request for ' || v_title || '.'
        WHEN 'offer_accepted' THEN 'Accepted the offer for ' || v_title || '.'
        WHEN 'offer_declined' THEN 'Declined the offer for ' || v_title || '.'
        WHEN 'request_withdrawn' THEN 'Withdrew the quote request for ' || v_title || '.'
        ELSE 'Paid for the offer for ' || v_title || '. The engagement has started.'
    END;
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, quote_event_id)
    VALUES (marketplace.fn_quote_thread(p_request), v_uid, v_body, v_event);
    RETURN v_event;
END;
$$;

-- Validate and send one offer on a locked, open request: the pending offer is withdrawn and points at
-- this one, the request is answered, the buyer told, and the move recorded as `p_kind` (`issued` for
-- a seller's own quote; `offer_sent`, or `offer_revised` when it replaces a pending one, otherwise).
CREATE OR REPLACE FUNCTION marketplace.fn_quote_put_offer(
    p_request marketplace.quote_requests,
    p_scope text,
    p_deliverables text[],
    p_price_cents bigint,
    p_turnaround_days integer,
    p_expires_in_days integer,
    p_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests := p_request;
    o marketplace.quote_offers;
    v_prior uuid;
    v_scope text := pg_catalog.btrim(COALESCE(p_scope, ''));
    v_deliverables text[];
    v_currency text;
BEGIN
    IF v_scope = '' OR pg_catalog.char_length(v_scope) > 4000 THEN
        RAISE EXCEPTION 'Quote refused: scope_required' USING ERRCODE = 'check_violation';
    END IF;
    v_deliverables := ARRAY(
        SELECT pg_catalog.btrim(d)
          FROM pg_catalog.unnest(COALESCE(p_deliverables, '{}'::text[])) WITH ORDINALITY AS x (d, n)
         WHERE pg_catalog.btrim(COALESCE(d, '')) <> ''
         ORDER BY n
    );
    IF pg_catalog.cardinality(v_deliverables) > 12 THEN
        RAISE EXCEPTION 'Quote refused: too_many_deliverables' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_deliverables) d WHERE pg_catalog.char_length(d) > 160) THEN
        RAISE EXCEPTION 'Quote refused: deliverable_too_long' USING ERRCODE = 'check_violation';
    END IF;
    IF p_price_cents IS NULL OR p_price_cents <= 0 THEN
        RAISE EXCEPTION 'Quote refused: price_required' USING ERRCODE = 'check_violation';
    END IF;
    IF p_turnaround_days IS NULL OR p_turnaround_days NOT BETWEEN 1 AND 90 THEN
        RAISE EXCEPTION 'Quote refused: turnaround_invalid' USING ERRCODE = 'check_violation';
    END IF;
    IF p_expires_in_days IS NULL OR p_expires_in_days NOT BETWEEN 3 AND 30 THEN
        RAISE EXCEPTION 'Quote refused: expiry_invalid' USING ERRCODE = 'check_violation';
    END IF;

    SELECT pg_catalog.upper(b.currency) INTO v_currency
      FROM marketplace.service_blueprints b WHERE b.id = q.blueprint_id;

    UPDATE marketplace.quote_offers
       SET status = 'withdrawn', decided_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE quote_request_id = q.id AND status = 'pending'
    RETURNING id INTO v_prior;

    INSERT INTO marketplace.quote_offers (
        quote_request_id, author_user_id, scope, deliverables, price_cents, currency,
        turnaround_days, expires_at
    ) VALUES (
        q.id, v_uid, v_scope, v_deliverables, p_price_cents, v_currency,
        p_turnaround_days, pg_catalog.now() + pg_catalog.make_interval(days => p_expires_in_days)
    )
    RETURNING * INTO o;

    IF v_prior IS NOT NULL THEN
        UPDATE marketplace.quote_offers SET superseded_by = o.id WHERE id = v_prior;
    END IF;

    UPDATE marketplace.quote_requests
       SET status = 'answered',
           answered_at = COALESCE(answered_at, pg_catalog.now()),
           updated_at = pg_catalog.now()
     WHERE id = q.id
    RETURNING * INTO q;

    PERFORM marketplace.fn_notify_quote(q, q.requester_user_id, 'quote.offer_received',
        CASE WHEN p_kind = 'issued' AND v_prior IS NULL THEN 'You have a quote'
             WHEN v_prior IS NULL THEN 'You have an offer'
             ELSE 'Your offer was revised' END,
        marketplace.fn_quote_party_name(v_uid)
            || CASE WHEN p_kind = 'issued' AND v_prior IS NULL THEN ' sent you a quote for ' ELSE ' priced ' END
            || marketplace.fn_quote_listing_title(q)
            || '. It is open for ' || p_expires_in_days || ' days.',
        o.id);
    PERFORM marketplace.fn_quote_event(q, o.id,
        CASE WHEN v_prior IS NOT NULL THEN 'offer_revised' ELSE p_kind END);
    RETURN pg_catalog.jsonb_build_object(
        'id', o.id, 'quote_request_id', q.id, 'status', o.status, 'supersedes', v_prior,
        'price_cents', o.price_cents, 'currency', o.currency, 'expires_at', o.expires_at,
        'terms_hash', o.terms_hash
    );
END;
$$;

-- The request a door acts on, locked. A stranger and a missing request are refused alike, so an id
-- cannot be probed.
CREATE OR REPLACE FUNCTION marketplace.fn_lock_quote(p_request uuid)
RETURNS marketplace.quote_requests
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Quote refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO q FROM marketplace.quote_requests WHERE id = p_request FOR UPDATE;
    IF NOT FOUND OR v_uid NOT IN (q.host_user_id, q.requester_user_id) THEN
        RAISE EXCEPTION 'Quote refused: quote_not_found' USING ERRCODE = 'check_violation';
    END IF;
    RETURN q;
END;
$$;

-- The offer a door acts on, locked after its request.
CREATE OR REPLACE FUNCTION marketplace.fn_lock_quote_offer(p_offer uuid)
RETURNS marketplace.quote_offers
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_request uuid;
    o marketplace.quote_offers;
BEGIN
    SELECT quote_request_id INTO v_request FROM marketplace.quote_offers WHERE id = p_offer;
    PERFORM marketplace.fn_lock_quote(v_request);
    SELECT * INTO o FROM marketplace.quote_offers WHERE id = p_offer FOR UPDATE;
    RETURN o;
END;
$$;

-- A person as a notice names them: their name, else their @handle.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_party_name(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        NULLIF(pg_catalog.btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
        '@' || u.username
    )
      FROM org.users_public u
     WHERE u.user_id = p_user;
$$;

-- Where a notice sends each party: the host to the buyer in their client pipeline, the buyer to the
-- conversation with the host, where the offer sits beside the thread.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_link(p_request marketplace.quote_requests, p_to uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE WHEN p_to = p_request.host_user_id
                THEN '/catalogue?view=clients&client=@' || u.username
                ELSE '/messages/dm-' || u.username
           END
      FROM org.users_public u
     WHERE u.user_id = CASE WHEN p_to = p_request.host_user_id
                            THEN p_request.requester_user_id ELSE p_request.host_user_id END;
$$;

-- Tell one party. The caller is recorded as the actor; the body names the listing, never the brief.
CREATE OR REPLACE FUNCTION marketplace.fn_notify_quote(
    p_request marketplace.quote_requests,
    p_to uuid,
    p_type text,
    p_title text,
    p_body text,
    p_offer uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM comms.fn_notify(
        p_to, p_type, p_title, p_body, 'marketplace.quote_requests', p_request.id,
        pg_catalog.jsonb_build_object(
            'quote_request_id', p_request.id,
            'offer_id', p_offer,
            'party', CASE WHEN p_to = p_request.host_user_id THEN 'host' ELSE 'requester' END
        ),
        auth.uid(),
        NULL, NULL, NULL,
        marketplace.fn_quote_link(p_request, p_to)
    );
END;
$$;

-- The listing a request is about, as a notice names it.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_listing_title(p_request marketplace.quote_requests)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((SELECT b.title FROM marketplace.service_blueprints b WHERE b.id = p_request.blueprint_id), 'your service');
$$;

-- The buyer's personal default basket, created on first use. A concurrent first write that loses the
-- race on the one-default-per-owner index reads the winner's row.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_basket(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_basket uuid;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, is_default)
    VALUES ('user', p_user, true)
    ON CONFLICT (owner_type, owner_id) WHERE is_default DO NOTHING;
    SELECT b.id INTO v_basket FROM finance.baskets b
     WHERE b.owner_type = 'user' AND b.owner_id = p_user AND b.is_default;
    RETURN v_basket;
END;
$$;

-- The live basket line that buys an offer, and whether any line has already bought it.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_offer_line(p_offer uuid, OUT live_line uuid, OUT ordered boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT bi.id FROM finance.basket_items bi
             WHERE bi.metadata ->> 'quoteOfferId' = p_offer::text
               AND bi.removed_at IS NULL AND bi.purchased_at IS NULL
             LIMIT 1),
           EXISTS (SELECT 1 FROM finance.basket_items bi
                    WHERE bi.metadata ->> 'quoteOfferId' = p_offer::text
                      AND bi.purchased_at IS NOT NULL);
$$;
-- #endregion

-- #region The buyer asks
-- A request against a published service, addressed to the person who sells it — resolved here, never
-- taken from the caller. One open request (sent or answered) per buyer per listing, so a buyer cannot
-- flood a seller's pipeline with copies of one ask. A group session takes no custom quote (Decision
-- #521). `p_answers` are the buyer's answers to the listing's own questions, validated against them by
-- QuoteBackendService (intakeRefusal) before this door is called; stored as an object.
CREATE OR REPLACE FUNCTION marketplace.request_quote(
    p_blueprint uuid,
    p_scope text,
    p_budget_cents bigint DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_timeline text DEFAULT NULL,
    p_answers jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_bp marketplace.service_blueprints;
    v_scope text := pg_catalog.btrim(COALESCE(p_scope, ''));
    v_currency text := NULLIF(pg_catalog.upper(pg_catalog.btrim(COALESCE(p_currency, ''))), '');
    v_timeline text := NULLIF(pg_catalog.btrim(COALESCE(p_timeline, '')), '');
    q marketplace.quote_requests;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Quote refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);

    SELECT * INTO v_bp FROM marketplace.service_blueprints b WHERE b.id = p_blueprint;
    IF NOT FOUND OR NOT v_bp.is_published THEN
        RAISE EXCEPTION 'Quote refused: listing_unavailable' USING ERRCODE = 'check_violation';
    END IF;
    IF v_bp.delivery_model = 'group_session'::marketplace.service_delivery_model THEN
        RAISE EXCEPTION 'Quote refused: group_session' USING ERRCODE = 'check_violation';
    END IF;
    IF p_answers IS NOT NULL AND pg_catalog.jsonb_typeof(p_answers) <> 'object' THEN
        RAISE EXCEPTION 'Quote refused: answers_invalid' USING ERRCODE = 'check_violation';
    END IF;
    IF v_bp.freelancer_profile_id = v_uid OR (
        v_bp.owner_team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM org.team_members tm
             WHERE tm.team_id = v_bp.owner_team_id AND tm.user_id = v_uid AND tm.status = 'active'
        )
    ) THEN
        RAISE EXCEPTION 'Quote refused: own_listing' USING ERRCODE = 'check_violation';
    END IF;
    IF v_scope = '' OR pg_catalog.char_length(v_scope) > 4000 THEN
        RAISE EXCEPTION 'Quote refused: scope_required' USING ERRCODE = 'check_violation';
    END IF;
    IF p_budget_cents IS NOT NULL AND p_budget_cents < 0 THEN
        RAISE EXCEPTION 'Quote refused: budget_invalid' USING ERRCODE = 'check_violation';
    END IF;
    IF p_budget_cents IS NOT NULL AND (v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$') THEN
        RAISE EXCEPTION 'Quote refused: currency_required' USING ERRCODE = 'check_violation';
    END IF;
    IF v_timeline IS NOT NULL AND pg_catalog.char_length(v_timeline) > 200 THEN
        RAISE EXCEPTION 'Quote refused: timeline_too_long' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM marketplace.quote_requests r
         WHERE r.requester_user_id = v_uid AND r.blueprint_id = p_blueprint
           AND r.status IN ('sent', 'answered')
    ) THEN
        RAISE EXCEPTION 'Quote refused: already_open' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO marketplace.quote_requests (
        blueprint_id, host_user_id, requester_user_id, scope, budget_cents, currency, timeline, answers
    ) VALUES (
        p_blueprint, v_bp.freelancer_profile_id, v_uid, v_scope, p_budget_cents,
        CASE WHEN p_budget_cents IS NOT NULL THEN v_currency END, v_timeline,
        COALESCE(p_answers, '{}'::jsonb)
    )
    RETURNING * INTO q;

    PERFORM marketplace.fn_notify_quote(q, q.host_user_id, 'quote.requested', 'New quote request',
        marketplace.fn_quote_party_name(v_uid) || ' asked you to price ' || marketplace.fn_quote_listing_title(q) || '.');
    PERFORM marketplace.fn_quote_event(q, NULL, 'requested');
    RETURN pg_catalog.jsonb_build_object('id', q.id, 'status', q.status);
END;
$$;
-- #endregion

-- #region The host answers
-- The host prices the request, or prices it again. The pending offer, if any, is withdrawn and points
-- at this one, so the buyer only ever holds one live offer and the history stays. The price is the
-- listing's currency; the expiry is 3 to 30 days from now (owner ruling, Decision #458).
CREATE OR REPLACE FUNCTION marketplace.send_quote_offer(
    p_request uuid,
    p_scope text,
    p_deliverables text[],
    p_price_cents bigint,
    p_turnaround_days integer,
    p_expires_in_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests;
BEGIN
    q := marketplace.fn_lock_quote(p_request);
    IF v_uid <> q.host_user_id THEN
        RAISE EXCEPTION 'Quote refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
    IF q.status NOT IN ('sent', 'answered') THEN
        RAISE EXCEPTION 'Quote refused: not_open' USING ERRCODE = 'check_violation';
    END IF;
    RETURN marketplace.fn_quote_put_offer(
        q, p_scope, p_deliverables, p_price_cents, p_turnaround_days, p_expires_in_days, 'offer_sent'
    );
END;
$$;

-- A seller's own quote, sent from a conversation (Decision #522): priced against one of their published
-- services (never a group session) for a buyer who has written to them. When that buyer already has an
-- open request on the listing, the quote answers it (superseding a pending offer); otherwise it opens a
-- host-issued request, born answered. Everything after that is the request's ordinary lifecycle.
CREATE OR REPLACE FUNCTION marketplace.issue_quote(
    p_counterpart uuid,
    p_blueprint uuid,
    p_scope text,
    p_deliverables text[],
    p_price_cents bigint,
    p_turnaround_days integer,
    p_expires_in_days integer DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_bp marketplace.service_blueprints;
    v_scope text := pg_catalog.btrim(COALESCE(p_scope, ''));
    q marketplace.quote_requests;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Quote refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);
    IF p_counterpart IS NULL OR p_counterpart = v_uid
       OR NOT EXISTS (SELECT 1 FROM org.users_public u WHERE u.user_id = p_counterpart) THEN
        RAISE EXCEPTION 'Quote refused: buyer_unavailable' USING ERRCODE = 'check_violation';
    END IF;
    IF org.fn_is_minor(p_counterpart) THEN
        RAISE EXCEPTION 'Quote refused: buyer_restricted' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_bp FROM marketplace.service_blueprints b WHERE b.id = p_blueprint;
    IF NOT FOUND OR NOT v_bp.is_published THEN
        RAISE EXCEPTION 'Quote refused: listing_unavailable' USING ERRCODE = 'check_violation';
    END IF;
    IF v_bp.freelancer_profile_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'Quote refused: not_your_listing' USING ERRCODE = 'check_violation';
    END IF;
    IF v_bp.delivery_model = 'group_session'::marketplace.service_delivery_model THEN
        RAISE EXCEPTION 'Quote refused: group_session' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM comms.dm_threads t
          JOIN comms.dm_participants a ON a.thread_id = t.id AND a.user_id = v_uid
          JOIN comms.dm_participants b ON b.thread_id = t.id AND b.user_id = p_counterpart
         WHERE t.kind IN ('dm', 'service_inquiry')
           AND EXISTS (
               SELECT 1 FROM comms.dm_messages m
                WHERE m.thread_id = t.id AND m.sender_user_id = p_counterpart AND m.deleted_at IS NULL
           )
    ) THEN
        RAISE EXCEPTION 'Quote refused: no_conversation' USING ERRCODE = 'check_violation';
    END IF;
    IF v_scope = '' OR pg_catalog.char_length(v_scope) > 4000 THEN
        RAISE EXCEPTION 'Quote refused: scope_required' USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO q FROM marketplace.quote_requests r
     WHERE r.requester_user_id = p_counterpart AND r.blueprint_id = p_blueprint
       AND r.status IN ('sent', 'answered')
     FOR UPDATE;
    IF FOUND THEN
        IF q.host_user_id <> v_uid THEN
            RAISE EXCEPTION 'Quote refused: not_your_move' USING ERRCODE = 'check_violation';
        END IF;
        RETURN marketplace.fn_quote_put_offer(
            q, v_scope, p_deliverables, p_price_cents, p_turnaround_days, p_expires_in_days, 'offer_sent'
        );
    END IF;

    INSERT INTO marketplace.quote_requests (blueprint_id, host_user_id, requester_user_id, scope, origin)
    VALUES (p_blueprint, v_uid, p_counterpart, v_scope, 'host')
    RETURNING * INTO q;
    RETURN marketplace.fn_quote_put_offer(
        q, v_scope, p_deliverables, p_price_cents, p_turnaround_days, p_expires_in_days, 'issued'
    );
END;
$$;

-- The host pulls a pending offer back. The request stays answered, so they can send another.
CREATE OR REPLACE FUNCTION marketplace.withdraw_quote_offer(p_offer uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests;
    o marketplace.quote_offers;
BEGIN
    o := marketplace.fn_lock_quote_offer(p_offer);
    q := marketplace.fn_lock_quote(o.quote_request_id);
    IF v_uid <> q.host_user_id THEN
        RAISE EXCEPTION 'Quote refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;
    IF o.status <> 'pending' THEN
        RAISE EXCEPTION 'Quote refused: not_open' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE marketplace.quote_offers
       SET status = 'withdrawn', decided_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = o.id
    RETURNING * INTO o;
    UPDATE marketplace.quote_requests SET updated_at = pg_catalog.now() WHERE id = q.id;

    PERFORM marketplace.fn_notify_quote(q, q.requester_user_id, 'quote.offer_withdrawn', 'An offer was withdrawn',
        marketplace.fn_quote_party_name(v_uid) || ' withdrew their offer for ' || marketplace.fn_quote_listing_title(q) || '.',
        o.id);
    PERFORM marketplace.fn_quote_event(q, o.id, 'offer_withdrawn');
    RETURN pg_catalog.jsonb_build_object('id', o.id, 'quote_request_id', q.id, 'status', o.status);
END;
$$;

-- The host says no to the request, with an optional reason the buyer reads. A pending offer goes with it.
CREATE OR REPLACE FUNCTION marketplace.decline_quote_request(p_request uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests;
BEGIN
    q := marketplace.fn_lock_quote(p_request);
    IF v_uid <> q.host_user_id THEN
        RAISE EXCEPTION 'Quote refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;
    IF q.status NOT IN ('sent', 'answered') THEN
        RAISE EXCEPTION 'Quote refused: not_open' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE marketplace.quote_offers
       SET status = 'withdrawn', decided_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE quote_request_id = q.id AND status = 'pending';
    UPDATE marketplace.quote_requests
       SET status = 'declined',
           closed_at = pg_catalog.now(),
           decline_reason = NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_reason, '')), 280), ''),
           updated_at = pg_catalog.now()
     WHERE id = q.id
    RETURNING * INTO q;

    PERFORM marketplace.fn_notify_quote(q, q.requester_user_id, 'quote.declined', 'Your quote request was declined',
        marketplace.fn_quote_party_name(v_uid) || ' can''t take on ' || marketplace.fn_quote_listing_title(q) || ' as asked.');
    PERFORM marketplace.fn_quote_event(q, NULL, 'request_declined',
        CASE WHEN q.decline_reason IS NOT NULL
             THEN pg_catalog.jsonb_build_object('reason', q.decline_reason) ELSE '{}'::jsonb END);
    RETURN pg_catalog.jsonb_build_object('id', q.id, 'status', q.status);
END;
$$;
-- #endregion

-- #region The buyer answers
-- The buyer takes the pending offer before it expires. The offer and the request close as accepted, and
-- exactly one `one_off_service` line joins the buyer's personal basket, carrying the offer's id; the
-- line's price is a display snapshot only. Accepting again is idempotent: it returns the live line, or
-- re-adds one the buyer removed, and refuses once a line has been paid for or the offer has expired.
CREATE OR REPLACE FUNCTION marketplace.accept_quote_offer(p_offer uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests;
    o marketplace.quote_offers;
    v_bp marketplace.service_blueprints;
    v_line uuid;
    v_ordered boolean;
    v_basket uuid;
    v_first boolean := false;
BEGIN
    o := marketplace.fn_lock_quote_offer(p_offer);
    q := marketplace.fn_lock_quote(o.quote_request_id);
    IF v_uid <> q.requester_user_id THEN
        RAISE EXCEPTION 'Quote refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM org.fn_assert_adult(v_uid);

    IF o.status = 'accepted' AND q.status = 'accepted' THEN
        SELECT l.live_line, l.ordered INTO v_line, v_ordered FROM marketplace.fn_quote_offer_line(o.id) l;
        IF v_ordered THEN
            RAISE EXCEPTION 'Quote refused: already_ordered' USING ERRCODE = 'check_violation';
        END IF;
        IF o.expires_at <= pg_catalog.now() THEN
            RAISE EXCEPTION 'Quote refused: offer_expired' USING ERRCODE = 'check_violation';
        END IF;
    ELSE
        IF o.status <> 'pending' OR q.status <> 'answered' THEN
            RAISE EXCEPTION 'Quote refused: not_open' USING ERRCODE = 'check_violation';
        END IF;
        IF o.expires_at <= pg_catalog.now() THEN
            RAISE EXCEPTION 'Quote refused: offer_expired' USING ERRCODE = 'check_violation';
        END IF;
        v_first := true;
    END IF;

    SELECT * INTO v_bp FROM marketplace.service_blueprints b WHERE b.id = q.blueprint_id;
    IF NOT FOUND OR NOT v_bp.is_published THEN
        RAISE EXCEPTION 'Quote refused: listing_unavailable' USING ERRCODE = 'check_violation';
    END IF;

    IF v_first THEN
        UPDATE marketplace.quote_offers
           SET status = 'accepted', decided_at = pg_catalog.now(), updated_at = pg_catalog.now()
         WHERE id = o.id
        RETURNING * INTO o;
        UPDATE marketplace.quote_requests
           SET status = 'accepted', closed_at = pg_catalog.now(), updated_at = pg_catalog.now()
         WHERE id = q.id
        RETURNING * INTO q;
    END IF;

    IF v_line IS NULL THEN
        v_basket := marketplace.fn_quote_basket(v_uid);
        INSERT INTO finance.basket_items (
            basket_id, item_type, item_id, title, subtitle, unit_price_minor, currency, quantity, metadata
        ) VALUES (
            v_basket, 'one_off_service'::finance.purchasable_item_kind, v_bp.id,
            pg_catalog.left(v_bp.title, 200), 'Custom offer', o.price_cents, o.currency, 1,
            pg_catalog.jsonb_build_object(
                'serviceId', v_bp.slug,
                'sourceType', 'service',
                'bookingFormat', 'one_off',
                'fundingScope', 'whole_project',
                'stageIds', '[]'::jsonb,
                'requirements', o.scope,
                'answers', q.answers,
                'attachments', '[]'::jsonb,
                'quoteOfferId', o.id,
                'quoteTermsHash', o.terms_hash,
                'quoteRequestId', q.id
            )
        )
        RETURNING id INTO v_line;
        UPDATE finance.baskets SET updated_at = pg_catalog.now() WHERE id = v_basket;
    ELSE
        SELECT bi.basket_id INTO v_basket FROM finance.basket_items bi WHERE bi.id = v_line;
    END IF;

    IF v_first THEN
        PERFORM marketplace.fn_notify_quote(q, q.host_user_id, 'quote.offer_accepted', 'Your offer was accepted',
            marketplace.fn_quote_party_name(v_uid) || ' accepted your offer for ' || marketplace.fn_quote_listing_title(q)
                || '. Nothing is charged until they pay at checkout.',
            o.id);
        PERFORM marketplace.fn_quote_event(q, o.id, 'offer_accepted');
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'id', o.id, 'quote_request_id', q.id, 'status', o.status,
        'basket_id', v_basket, 'basket_item_id', v_line, 'terms_hash', o.terms_hash
    );
END;
$$;

-- The buyer turns down the pending offer. The request stays answered, so the host can send another.
CREATE OR REPLACE FUNCTION marketplace.decline_quote_offer(p_offer uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests;
    o marketplace.quote_offers;
BEGIN
    o := marketplace.fn_lock_quote_offer(p_offer);
    q := marketplace.fn_lock_quote(o.quote_request_id);
    IF v_uid <> q.requester_user_id THEN
        RAISE EXCEPTION 'Quote refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;
    IF o.status <> 'pending' THEN
        RAISE EXCEPTION 'Quote refused: not_open' USING ERRCODE = 'check_violation';
    END IF;
    IF o.expires_at <= pg_catalog.now() THEN
        RAISE EXCEPTION 'Quote refused: offer_expired' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE marketplace.quote_offers
       SET status = 'declined', decided_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = o.id
    RETURNING * INTO o;
    UPDATE marketplace.quote_requests SET updated_at = pg_catalog.now() WHERE id = q.id;

    PERFORM marketplace.fn_notify_quote(q, q.host_user_id, 'quote.offer_declined', 'Your offer was declined',
        marketplace.fn_quote_party_name(v_uid) || ' declined your offer for ' || marketplace.fn_quote_listing_title(q)
            || '. You can send another.',
        o.id);
    PERFORM marketplace.fn_quote_event(q, o.id, 'offer_declined');
    RETURN pg_catalog.jsonb_build_object('id', o.id, 'quote_request_id', q.id, 'status', o.status);
END;
$$;

-- The buyer withdraws the request — before an offer, with one pending, or after accepting one they have
-- not paid for. A pending offer is declined with it, and the accepted offer's basket line is removed
-- (soft), so checkout can no longer buy it. Refused once the offer has been paid for: the engagement
-- then runs through its project.
CREATE OR REPLACE FUNCTION marketplace.withdraw_quote_request(p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests;
    v_accepted uuid;
BEGIN
    q := marketplace.fn_lock_quote(p_request);
    IF v_uid <> q.requester_user_id THEN
        RAISE EXCEPTION 'Quote refused: not_your_move' USING ERRCODE = 'check_violation';
    END IF;
    IF q.status NOT IN ('sent', 'answered', 'accepted') THEN
        RAISE EXCEPTION 'Quote refused: not_open' USING ERRCODE = 'check_violation';
    END IF;

    SELECT o.id INTO v_accepted FROM marketplace.quote_offers o
     WHERE o.quote_request_id = q.id AND o.status = 'accepted'
     FOR UPDATE;
    IF v_accepted IS NOT NULL AND (SELECT l.ordered FROM marketplace.fn_quote_offer_line(v_accepted) l) THEN
        RAISE EXCEPTION 'Quote refused: already_ordered' USING ERRCODE = 'check_violation';
    END IF;

    UPDATE marketplace.quote_offers
       SET status = 'declined', decided_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE quote_request_id = q.id AND status = 'pending';
    IF v_accepted IS NOT NULL THEN
        UPDATE finance.basket_items
           SET removed_at = pg_catalog.now(), updated_at = pg_catalog.now()
         WHERE metadata ->> 'quoteOfferId' = v_accepted::text
           AND removed_at IS NULL AND purchased_at IS NULL;
    END IF;
    UPDATE marketplace.quote_requests
       SET status = 'withdrawn', closed_at = pg_catalog.now(), updated_at = pg_catalog.now()
     WHERE id = q.id
    RETURNING * INTO q;

    PERFORM marketplace.fn_notify_quote(q, q.host_user_id, 'quote.withdrawn', 'A quote request was withdrawn',
        marketplace.fn_quote_party_name(v_uid) || ' withdrew their request for ' || marketplace.fn_quote_listing_title(q) || '.');
    PERFORM marketplace.fn_quote_event(q, v_accepted, 'request_withdrawn');
    RETURN pg_catalog.jsonb_build_object('id', q.id, 'status', q.status);
END;
$$;
-- #endregion

-- #region Checkout's terms
-- What checkout charges for a basket line that buys an offer, and the one stage it instantiates: a ONE-row
-- array in `fn_blueprint_stage_terms`' shape (the offer's price, Standard and locked) for
-- `fn_buy_scoped_service`'s `p_terms`, the offer's scope as the brief, and today plus the turnaround as
-- the target date. Refused unless the caller is the offer's buyer, the offer and its request are
-- accepted, the offer has not expired, the line named is a live line of the caller's carrying this
-- offer, and no other line has already bought it. Called by `finance.place_wallet_order`, inside the
-- order's transaction, after it has checked the same in checkout's own words: these are its backstop.
-- The offer is re-hashed first (Decision #522): terms that no longer match the hash the buyer accepted
-- are never charged. The buyer's answers to the listing's questions ride with the brief.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_offer_terms(p_offer uuid, p_basket_item uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
    q marketplace.quote_requests;
    o marketplace.quote_offers;
BEGIN
    SELECT * INTO o FROM marketplace.quote_offers WHERE id = p_offer;
    IF FOUND THEN
        SELECT * INTO q FROM marketplace.quote_requests WHERE id = o.quote_request_id;
    END IF;
    IF NOT FOUND OR v_uid IS NULL OR v_uid <> q.requester_user_id THEN
        RAISE EXCEPTION 'Quote refused: quote_not_found' USING ERRCODE = 'check_violation';
    END IF;
    IF o.status <> 'accepted' OR q.status <> 'accepted' THEN
        RAISE EXCEPTION 'Quote refused: offer_not_accepted' USING ERRCODE = 'check_violation';
    END IF;
    IF o.expires_at <= pg_catalog.now() THEN
        RAISE EXCEPTION 'Quote refused: offer_expired' USING ERRCODE = 'check_violation';
    END IF;
    IF marketplace.fn_quote_hash(marketplace.fn_quote_terms(o)) <> o.terms_hash THEN
        RAISE EXCEPTION 'Quote refused: terms_mismatch' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM finance.basket_items bi
          JOIN finance.baskets b ON b.id = bi.basket_id
         WHERE bi.id = p_basket_item
           AND bi.metadata ->> 'quoteOfferId' = o.id::text
           AND bi.item_id = q.blueprint_id
           AND bi.removed_at IS NULL
           AND b.owner_type = 'user' AND b.owner_id = v_uid
    ) OR EXISTS (
        SELECT 1 FROM finance.basket_items bi
         WHERE bi.metadata ->> 'quoteOfferId' = o.id::text
           AND bi.purchased_at IS NOT NULL
           AND bi.id <> p_basket_item
    ) THEN
        RAISE EXCEPTION 'Quote refused: already_ordered' USING ERRCODE = 'check_violation';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'offer_id', o.id,
        'quote_request_id', q.id,
        'blueprint_id', q.blueprint_id,
        'brief', o.scope,
        'answers', q.answers,
        'terms_hash', o.terms_hash,
        'target_date', pg_catalog.to_char(CURRENT_DATE + o.turnaround_days, 'YYYY-MM-DD'),
        'price_cents', o.price_cents,
        'currency', o.currency,
        'terms', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'ord', 1,
            'stage', pg_catalog.jsonb_build_object(
                'name', 'Custom offer',
                'description', pg_catalog.left(o.scope, 600),
                'deliverables', pg_catalog.to_jsonb(o.deliverables)
            ),
            'unit_price_cents', o.price_cents,
            'intensity', 'standard',
            'intensity_locked', true,
            'low_price_cents', NULL,
            'high_price_cents', NULL,
            'price', o.price_cents
        ))
    );
END;
$$;

-- Record the payment of an accepted offer (Decision #522): the `paid` event, naming the order line,
-- project and escrow that checkout created for it. Called only by finance.place_wallet_order, in the
-- order's transaction, after the line is written.
CREATE OR REPLACE FUNCTION marketplace.fn_quote_paid(p_offer uuid, p_order_line uuid, p_project uuid, p_escrow uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    q marketplace.quote_requests;
BEGIN
    SELECT r.* INTO q
      FROM marketplace.quote_requests r
      JOIN marketplace.quote_offers o ON o.quote_request_id = r.id
     WHERE o.id = p_offer;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quote refused: quote_not_found' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM marketplace.fn_quote_event(q, p_offer, 'paid', pg_catalog.jsonb_build_object(
        'order_line_id', p_order_line, 'project_id', p_project, 'escrow_id', p_escrow
    ));
END;
$$;
-- #endregion

-- #region Reads
-- Every quote request between the caller and one other person, in either role, newest first, each with
-- its current offer (the pending or accepted one, else the latest) and how many offers were sent. The
-- caller's role names the side they are on; `expired` is derived: a pending offer, or an accepted one
-- not yet paid for, past its expiry. Feeds the buyer's conversation panel and the host's client drawer.
CREATE OR REPLACE FUNCTION marketplace.get_quotes_with(p_counterpart uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Quote refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE((
        SELECT pg_catalog.jsonb_agg(x.item ORDER BY x.created_at DESC)
          FROM (
            SELECT q.created_at,
                   pg_catalog.jsonb_build_object(
                       'id', q.id,
                       'role', CASE WHEN q.host_user_id = v_uid THEN 'host' ELSE 'buyer' END,
                       'status', q.status,
                       'origin', q.origin,
                       'scope', q.scope,
                       'answers', q.answers,
                       'budget_cents', q.budget_cents,
                       'currency', q.currency,
                       'timeline', q.timeline,
                       'decline_reason', q.decline_reason,
                       'created_at', q.created_at,
                       'answered_at', q.answered_at,
                       'closed_at', q.closed_at,
                       'blueprint_id', q.blueprint_id,
                       'listing_slug', b.slug,
                       'listing_title', b.title,
                       'listing_currency', pg_catalog.upper(b.currency),
                       'listing_delivery_model', b.delivery_model,
                       'free_revisions', b.free_revisions,
                       'intake_fields', b.intake_fields,
                       'offers_sent', (SELECT pg_catalog.count(*) FROM marketplace.quote_offers c WHERE c.quote_request_id = q.id),
                       'offer', CASE WHEN o.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
                           'id', o.id,
                           'status', o.status,
                           'expired', o.expires_at <= pg_catalog.now() AND (
                               o.status = 'pending' OR (o.status = 'accepted'
                                   AND NOT (SELECT l.ordered FROM marketplace.fn_quote_offer_line(o.id) l))),
                           'scope', o.scope,
                           'deliverables', pg_catalog.to_jsonb(o.deliverables),
                           'price_cents', o.price_cents,
                           'currency', o.currency,
                           'turnaround_days', o.turnaround_days,
                           'expires_at', o.expires_at,
                           'created_at', o.created_at,
                           'decided_at', o.decided_at,
                           'terms_hash', o.terms_hash,
                           'terms_intact', o.recomputed = o.terms_hash
                       ) END,
                       'history', COALESCE((
                           SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'id', e.id,
                               'kind', e.kind,
                               'by', CASE WHEN e.actor_user_id = q.host_user_id THEN 'host' ELSE 'buyer' END,
                               'at', e.created_at,
                               'offer_id', e.quote_offer_id,
                               'terms_hash', e.terms_hash
                           ) ORDER BY e.created_at, e.id)
                             FROM (SELECT * FROM marketplace.quote_events ev
                                    WHERE ev.quote_request_id = q.id
                                    ORDER BY ev.created_at DESC, ev.id DESC
                                    LIMIT 30) e
                       ), '[]'::jsonb),
                       'basket_item_id', CASE WHEN q.requester_user_id = v_uid AND o.status = 'accepted'
                                              THEN (SELECT l.live_line FROM marketplace.fn_quote_offer_line(o.id) l) END,
                       'ordered', CASE WHEN o.status = 'accepted'
                                       THEN (SELECT l.ordered FROM marketplace.fn_quote_offer_line(o.id) l)
                                       ELSE false END
                   ) AS item
              FROM marketplace.quote_requests q
              JOIN marketplace.service_blueprints b ON b.id = q.blueprint_id
              LEFT JOIN LATERAL (
                  SELECT oo.*, marketplace.fn_quote_hash(marketplace.fn_quote_terms(oo)) AS recomputed
                    FROM marketplace.quote_offers oo
                   WHERE oo.quote_request_id = q.id
                   ORDER BY (oo.status IN ('pending', 'accepted')) DESC, oo.created_at DESC
                   LIMIT 1
              ) o ON true
             WHERE (q.host_user_id = v_uid AND q.requester_user_id = p_counterpart)
                OR (q.requester_user_id = v_uid AND q.host_user_id = p_counterpart)
             ORDER BY q.created_at DESC
             LIMIT 20
          ) x
    ), '[]'::jsonb);
END;
$$;

-- The quote cards a conversation renders (Decision #522): for each event id the caller is a party to,
-- the move (its kind, who made it, when), the offer's terms and hash as they stood then, and where that
-- offer and its request stand now, so a card can say "superseded" or "paid" and offer only the acts the
-- doors would accept. Ids the caller is not a party to are left out. At most 100 per call.
CREATE OR REPLACE FUNCTION marketplace.get_quote_cards(p_events uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Quote refused: not_signed_in' USING ERRCODE = 'check_violation';
    END IF;
    IF pg_catalog.cardinality(COALESCE(p_events, '{}'::uuid[])) > 100 THEN
        RAISE EXCEPTION 'Quote refused: too_many_cards' USING ERRCODE = 'check_violation';
    END IF;
    RETURN COALESCE((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'event_id', e.id,
            'kind', e.kind,
            'by', CASE WHEN e.actor_user_id = q.host_user_id THEN 'host' ELSE 'buyer' END,
            'at', e.created_at,
            'role', CASE WHEN q.host_user_id = v_uid THEN 'host' ELSE 'buyer' END,
            'request_id', q.id,
            'request_status', q.status,
            'origin', q.origin,
            'listing_slug', b.slug,
            'listing_title', b.title,
            'free_revisions', b.free_revisions,
            'terms', e.terms,
            'terms_hash', e.terms_hash,
            'detail', e.detail,
            'offer', CASE WHEN o.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
                'id', o.id,
                'status', o.status,
                'superseded', o.superseded_by IS NOT NULL,
                'ordered', (SELECT l.ordered FROM marketplace.fn_quote_offer_line(o.id) l),
                'expired', o.expires_at <= pg_catalog.now() AND (
                    o.status = 'pending' OR (o.status = 'accepted'
                        AND NOT (SELECT l.ordered FROM marketplace.fn_quote_offer_line(o.id) l))),
                'terms_intact', marketplace.fn_quote_hash(marketplace.fn_quote_terms(o)) = o.terms_hash
            ) END
        ) ORDER BY e.created_at, e.id)
          FROM marketplace.quote_events e
          JOIN marketplace.quote_requests q ON q.id = e.quote_request_id
          JOIN marketplace.service_blueprints b ON b.id = q.blueprint_id
          LEFT JOIN marketplace.quote_offers o ON o.id = e.quote_offer_id
         WHERE e.id = ANY (p_events)
           AND v_uid IN (q.host_user_id, q.requester_user_id)
    ), '[]'::jsonb);
END;
$$;
-- #endregion

COMMENT ON FUNCTION marketplace.request_quote (uuid, text, bigint, text, text, jsonb) IS
'A buyer asks the seller of a published service (never a group session) to price custom scope (Decision #458): the host is the blueprint''s seller, one open request per buyer per listing, the buyer''s answers to the listing''s questions kept on the request, the host notified (quote.requested) and the move recorded (quote_events, a card in the pair''s conversation). Refusals ''Quote refused: <code>''.';
COMMENT ON FUNCTION marketplace.issue_quote (uuid, uuid, text, text[], bigint, integer, integer) IS
'A seller''s own quote from a conversation (Decision #522): one of their published, non-cohort services, for a buyer who has written to them. Answers that buyer''s open request on the listing, else opens a host-issued one, born answered. Notifies the buyer and records the move.';
COMMENT ON FUNCTION marketplace.get_quote_cards (uuid[]) IS
'The quote cards of a conversation: per quote event the caller is a party to, the move, the offer''s terms and hash as they stood, and the offer''s and request''s state now (Decision #522).';
COMMENT ON FUNCTION marketplace.fn_quote_terms (marketplace.quote_offers) IS
'An offer''s terms in canonical form (UTC instants): what its SHA-256 terms_hash is taken over and what a quote event snapshots (Decision #522).';
COMMENT ON FUNCTION marketplace.send_quote_offer (uuid, text, text[], bigint, integer, integer) IS
'The host prices a sent or answered request: scope, deliverables (a checklist, one escrow), price in the listing''s currency, turnaround 1-90 days, expiry 3-30 days. Supersedes the pending offer (withdrawn, superseded_by). Notifies the buyer (quote.offer_received).';
COMMENT ON FUNCTION marketplace.accept_quote_offer (uuid) IS
'The buyer accepts the pending, unexpired offer: offer and request accepted, exactly one one_off_service basket line carrying quoteOfferId. Idempotent; refused once paid for or past its expiry. Charges nothing.';
COMMENT ON FUNCTION marketplace.fn_quote_offer_terms (uuid, uuid) IS
'Checkout''s price, brief, target date and one-stage p_terms for a basket line that buys an accepted, unexpired offer. Internal to finance.place_wallet_order.';
COMMENT ON FUNCTION marketplace.get_quotes_with (uuid) IS
'Every quote request between the caller and one counterpart, either role, with its current offer. Read by the conversation panel and the client drawer.';
