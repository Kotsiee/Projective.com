-- =============================================================================================
-- Probe: the custom quote record and cohort seat links (Decision #522).
--
--   1  stamp     an offer's terms_hash is derived from its terms and re-hashes equal
--   2  frozen    no one rewrites an offer's terms or deletes the record, the owner role included
--   3  events    every move appends one event and posts one quote card in the pair's thread
--   4  cards     get_quote_cards answers the two parties only; a client cannot forge a card
--   5  issue     a seller's own quote: refused without a conversation, for another's listing, and
--                for a group session; otherwise a host-issued request, born answered
--   6  answers   a buyer's answers ride the request; a group session takes no quote request
--   7  seats     a multi-seat booking shares its spare seats: first come first served, the buyer
--                keeps one, a revoked link stops claims, and the seats end with the buyer's
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/quote_evidence.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts.
-- =============================================================================================
\set ON_ERROR_STOP on
BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Helpers (as postgres)
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'FAIL %', p_label;
    END IF;
    RAISE NOTICE 'PASS %', p_label;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT current_setting('probe.' || p_key)::uuid;
$$;

CREATE FUNCTION pg_temp.door(p_user uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.act(p_user);
    EXECUTE 'SELECT (' || p_sql || ')::jsonb' INTO v;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

CREATE FUNCTION pg_temp.refused(p_user uuid, p_sql text, p_code text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.act(NULL);
        IF SQLERRM NOT LIKE '%: ' || p_code THEN
            RAISE EXCEPTION 'FAIL % answered [%], wanted %', p_label, SQLERRM, p_code;
        END IF;
        RAISE NOTICE 'PASS % [%]', p_label, p_code;
        RETURN;
    END;
    PERFORM pg_temp.act(NULL);
    RAISE EXCEPTION 'FAIL % was allowed', p_label;
END $$;

CREATE FUNCTION pg_temp.refused_state(p_user uuid, p_sql text, p_state text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.act(NULL);
        IF SQLSTATE <> p_state THEN
            RAISE EXCEPTION 'FAIL % answered % [%], wanted %', p_label, SQLSTATE, SQLERRM, p_state;
        END IF;
        RAISE NOTICE 'PASS % [%]', p_label, p_state;
        RETURN;
    END;
    PERFORM pg_temp.act(NULL);
    RAISE EXCEPTION 'FAIL % was allowed', p_label;
END $$;

CREATE FUNCTION pg_temp.events(p_request uuid, p_kind text) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM marketplace.quote_events e
     WHERE e.quote_request_id = p_request AND e.kind = p_kind;
$$;

CREATE FUNCTION pg_temp.cards(p_request uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM comms.dm_messages m
      JOIN marketplace.quote_events e ON e.id = m.quote_event_id
     WHERE e.quote_request_id = p_request;
$$;
-- #endregion

-- #region Fixtures: a published personal one-off listing, its adult seller, a buyer, a stranger, a third
DO $$
DECLARE
    v_bp uuid;
    v_seller uuid;
    v_buyer uuid;
    v_stranger uuid;
    v_third uuid;
BEGIN
    SELECT b.id, b.freelancer_profile_id INTO v_bp, v_seller
      FROM marketplace.service_blueprints b
     WHERE b.is_published AND b.owner_team_id IS NULL
       AND b.delivery_model <> 'group_session'
       AND NOT org.fn_is_minor(b.freelancer_profile_id)
     ORDER BY b.created_at, b.id
     LIMIT 1;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id <> v_seller AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM marketplace.quote_requests q
                        WHERE q.requester_user_id = u.user_id AND q.blueprint_id = v_bp)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_seller, v_buyer) AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (
           SELECT 1 FROM comms.dm_participants a
             JOIN comms.dm_participants b ON b.thread_id = a.thread_id AND b.user_id = v_seller
            WHERE a.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_third FROM org.users_public u
     WHERE u.user_id NOT IN (v_seller, v_buyer, v_stranger) AND NOT org.fn_is_minor(u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_bp IS NULL OR v_buyer IS NULL OR v_stranger IS NULL OR v_third IS NULL THEN
        RAISE EXCEPTION 'FAIL fixtures: no listing with an adult seller, buyer, stranger and third person';
    END IF;
    PERFORM set_config('probe.bp', v_bp::text, true);
    PERFORM set_config('probe.seller', v_seller::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
    PERFORM set_config('probe.third', v_third::text, true);
END $$;
-- #endregion

-- #region 1. The stamp, and 3. the events of an ask and an answer
DO $$
DECLARE
    v jsonb;
    v_req uuid;
    v_offer uuid;
BEGIN
    v := pg_temp.door(pg_temp.s('buyer'), format(
        'marketplace.request_quote(%L::uuid, %L, NULL, NULL, NULL, %L::jsonb)',
        pg_temp.s('bp'), 'Price a two-week build of our onboarding flow.', '{"pages": 4}'));
    v_req := (v ->> 'id')::uuid;
    PERFORM set_config('probe.req', v_req::text, true);
    PERFORM pg_temp.check(
        (SELECT q.answers = '{"pages": 4}'::jsonb AND q.origin = 'buyer' FROM marketplace.quote_requests q WHERE q.id = v_req),
        '6 the buyer''s answers ride the request; a buyer''s ask is origin buyer');
    PERFORM pg_temp.check(pg_temp.events(v_req, 'requested') = 1, '3 the ask is one requested event');
    PERFORM pg_temp.check(pg_temp.cards(v_req) = 1, '3 the ask is one quote card in the pair''s thread');
    PERFORM pg_temp.check(
        (SELECT m.sender_user_id = pg_temp.s('buyer') FROM comms.dm_messages m
           JOIN marketplace.quote_events e ON e.id = m.quote_event_id
          WHERE e.quote_request_id = v_req AND e.kind = 'requested'),
        '3 the card is sent as the person who moved');

    v := pg_temp.door(pg_temp.s('seller'), format(
        'marketplace.send_quote_offer(%L::uuid, %L, ARRAY[%L, %L], 240000, 14, 10)',
        v_req, 'Onboarding flow, four screens, tested.', 'Flow map', 'Tested build'));
    v_offer := (v ->> 'id')::uuid;
    PERFORM set_config('probe.offer', v_offer::text, true);
    PERFORM pg_temp.check(v ->> 'terms_hash' ~ '^[0-9a-f]{64}$', '1 the door answers the offer''s hash');
    PERFORM pg_temp.check(
        (SELECT o.terms_hash = marketplace.fn_quote_hash(marketplace.fn_quote_terms(o))
           FROM marketplace.quote_offers o WHERE o.id = v_offer),
        '1 the stored hash is the hash of the terms');
    PERFORM pg_temp.check(
        (SELECT e.terms_hash = (v ->> 'terms_hash') AND (e.terms ->> 'price_cents')::bigint = 240000
           FROM marketplace.quote_events e WHERE e.quote_offer_id = v_offer AND e.kind = 'offer_sent'),
        '3 the offer is one offer_sent event carrying its terms and hash');
END $$;
-- #endregion

-- #region 2. Frozen
SELECT pg_temp.refused(NULL, format(
    'UPDATE marketplace.quote_offers SET price_cents = 1 WHERE id = %L', pg_temp.s('offer')),
    'terms_frozen', '2 the owner role cannot rewrite an offer''s price');
SELECT pg_temp.refused(NULL, format(
    'UPDATE marketplace.quote_offers SET terms_hash = repeat(%L, 64) WHERE id = %L', 'a', pg_temp.s('offer')),
    'terms_frozen', '2 nor its hash');
SELECT pg_temp.refused(NULL, format(
    'DELETE FROM marketplace.quote_offers WHERE id = %L', pg_temp.s('offer')),
    'record_kept', '2 nor delete an offer');
SELECT pg_temp.refused(NULL, format(
    'DELETE FROM marketplace.quote_requests WHERE id = %L', pg_temp.s('req')),
    'record_kept', '2 nor delete a request');
SELECT pg_temp.refused(NULL, format(
    'UPDATE marketplace.quote_events SET kind = %L WHERE quote_request_id = %L', 'paid', pg_temp.s('req')),
    'record_kept', '2 nor change an event');
SELECT pg_temp.refused_state(pg_temp.s('buyer'), format(
    'INSERT INTO marketplace.quote_events (quote_request_id, actor_user_id, kind) VALUES (%L, %L, %L)',
    pg_temp.s('req'), pg_temp.s('buyer'), 'paid'),
    '42501', '2 a client cannot append an event');
-- #endregion

-- #region 3. Revise, accept: one event each, the accepted hash on the basket line
DO $$
DECLARE
    v jsonb;
    v_offer2 uuid;
BEGIN
    v := pg_temp.door(pg_temp.s('seller'), format(
        'marketplace.send_quote_offer(%L::uuid, %L, ARRAY[%L], 260000, 14, 10)',
        pg_temp.s('req'), 'Onboarding flow, five screens, tested.', 'Tested build'));
    v_offer2 := (v ->> 'id')::uuid;
    PERFORM set_config('probe.offer2', v_offer2::text, true);
    PERFORM pg_temp.check(pg_temp.events(pg_temp.s('req'), 'offer_revised') = 1, '3 a revision is one offer_revised event');
    PERFORM pg_temp.check(
        (SELECT o.status = 'withdrawn' AND o.superseded_by = v_offer2 FROM marketplace.quote_offers o WHERE o.id = pg_temp.s('offer')),
        '3 the revision supersedes the first offer (its lifecycle still moves)');
    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.accept_quote_offer(%L::uuid)', v_offer2));
    PERFORM pg_temp.check(
        (SELECT e.terms_hash = o.terms_hash FROM marketplace.quote_events e
           JOIN marketplace.quote_offers o ON o.id = e.quote_offer_id
          WHERE e.quote_offer_id = v_offer2 AND e.kind = 'offer_accepted'),
        '3 the acceptance records the hash the buyer accepted');
    PERFORM pg_temp.check(
        (SELECT bi.metadata ->> 'quoteTermsHash' = (v ->> 'terms_hash') AND bi.metadata -> 'answers' = '{"pages": 4}'::jsonb
           FROM finance.basket_items bi WHERE bi.id = (v ->> 'basket_item_id')::uuid),
        '3 the basket line carries the accepted hash and the buyer''s answers');
    PERFORM pg_temp.check(pg_temp.cards(pg_temp.s('req')) = 4, '3 four moves, four cards');
END $$;
-- #endregion

-- #region 4. Cards
DO $$
DECLARE
    v_ids uuid[];
    v jsonb;
BEGIN
    SELECT array_agg(e.id ORDER BY e.created_at) INTO v_ids FROM marketplace.quote_events e WHERE e.quote_request_id = pg_temp.s('req');
    PERFORM set_config('probe.events', array_to_string(v_ids, ','), true);
    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.get_quote_cards(%L::uuid[])', '{' || array_to_string(v_ids, ',') || '}'));
    PERFORM pg_temp.check(jsonb_array_length(v) = 4, '4 the buyer reads all four cards');
    PERFORM pg_temp.check(
        (SELECT bool_and(c ->> 'role' = 'buyer') FROM jsonb_array_elements(v) c),
        '4 each card names the viewer''s side');
    PERFORM pg_temp.check(
        (SELECT (c -> 'offer' ->> 'superseded')::boolean FROM jsonb_array_elements(v) c WHERE c ->> 'kind' = 'offer_sent'),
        '4 the first offer''s card says it was superseded');
    v := pg_temp.door(pg_temp.s('stranger'), format('marketplace.get_quote_cards(%L::uuid[])', '{' || array_to_string(v_ids, ',') || '}'));
    PERFORM pg_temp.check(jsonb_array_length(v) = 0, '4 a stranger reads none of them');
END $$;

DO $$
DECLARE
    v_thread uuid;
BEGIN
    SELECT m.thread_id INTO v_thread FROM comms.dm_messages m
      JOIN marketplace.quote_events e ON e.id = m.quote_event_id
     WHERE e.quote_request_id = pg_temp.s('req') LIMIT 1;
    PERFORM set_config('probe.thread', v_thread::text, true);
END $$;
SELECT pg_temp.refused_state(pg_temp.s('buyer'), format(
    'INSERT INTO comms.dm_messages (thread_id, sender_user_id, body, quote_event_id) VALUES (%L, %L, %L, %L)',
    pg_temp.s('thread'), pg_temp.s('buyer'), 'Forged', split_part(current_setting('probe.events'), ',', 1)),
    '42501', '4 a client cannot make a message a quote card');
-- #endregion

-- #region 5. A seller's own quote
SELECT pg_temp.refused(pg_temp.s('seller'), format(
    'SELECT marketplace.issue_quote(%L::uuid, %L::uuid, %L, ARRAY[]::text[], 50000, 7)',
    pg_temp.s('stranger'), pg_temp.s('bp'), 'Unprompted'),
    'no_conversation', '5 no quote to someone who has not written');
SELECT pg_temp.refused(pg_temp.s('buyer'), format(
    'SELECT marketplace.issue_quote(%L::uuid, %L::uuid, %L, ARRAY[]::text[], 50000, 7)',
    pg_temp.s('seller'), pg_temp.s('bp'), 'Not mine'),
    'not_your_listing', '5 no quote on someone else''s listing');

DO $$
DECLARE
    v_thread jsonb;
    v jsonb;
    v_req uuid;
BEGIN
    v_thread := pg_temp.door(pg_temp.s('stranger'), format('comms.get_or_create_dm_thread(%L::uuid)', pg_temp.s('seller')));
    PERFORM pg_temp.act(pg_temp.s('stranger'));
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body)
    VALUES ((v_thread ->> 'thread_id')::uuid, pg_temp.s('stranger'), 'Could you price a landing page?');
    PERFORM pg_temp.act(NULL);

    v := pg_temp.door(pg_temp.s('seller'), format(
        'marketplace.issue_quote(%L::uuid, %L::uuid, %L, ARRAY[%L], 90000, 7, 7)',
        pg_temp.s('stranger'), pg_temp.s('bp'), 'A landing page, one round of revisions.', 'Landing page'));
    v_req := (v ->> 'quote_request_id')::uuid;
    PERFORM pg_temp.check(
        (SELECT q.origin = 'host' AND q.status = 'answered' AND q.requester_user_id = pg_temp.s('stranger')
           FROM marketplace.quote_requests q WHERE q.id = v_req),
        '5 a seller''s quote opens a host-issued request, born answered');
    PERFORM pg_temp.check(pg_temp.events(v_req, 'issued') = 1, '5 it is one issued event');
    PERFORM pg_temp.check(
        (SELECT count(*) = 1 FROM comms.dm_messages m JOIN marketplace.quote_events e ON e.id = m.quote_event_id
          WHERE e.quote_request_id = v_req AND m.thread_id = (v_thread ->> 'thread_id')::uuid),
        '5 its card lands in the conversation the buyer started');
    PERFORM pg_temp.check(
        (SELECT count(*) = 1 FROM comms.notifications n
          WHERE n.user_id = pg_temp.s('stranger') AND n.type = 'quote.offer_received' AND n.entity_id = v_req),
        '5 the buyer is told');
END $$;

DO $$
DECLARE
    v_cohort_bp uuid;
    v_owner uuid;
BEGIN
    SELECT b.id, b.freelancer_profile_id INTO v_cohort_bp, v_owner
      FROM marketplace.service_blueprints b
     WHERE b.is_published AND b.delivery_model = 'group_session' AND NOT org.fn_is_minor(b.freelancer_profile_id)
     LIMIT 1;
    IF v_cohort_bp IS NULL THEN
        RAISE NOTICE 'SKIP 5/6 group-session refusals: no published group session in the seed';
        RETURN;
    END IF;
    PERFORM set_config('probe.cohort_bp', v_cohort_bp::text, true);
    PERFORM set_config('probe.cohort_owner', v_owner::text, true);
END $$;
DO $$
BEGIN
    IF current_setting('probe.cohort_bp', true) IS NULL OR current_setting('probe.cohort_bp', true) = '' THEN
        RETURN;
    END IF;
    PERFORM pg_temp.refused(
        (SELECT u.user_id FROM org.users_public u
          WHERE u.user_id <> pg_temp.s('cohort_owner') AND NOT org.fn_is_minor(u.user_id) LIMIT 1),
        format('SELECT marketplace.request_quote(%L::uuid, %L)', pg_temp.s('cohort_bp'), 'A private cohort'),
        'group_session', '6 a group session takes no quote request');
END $$;
-- #endregion

-- #region 7. Seat links
DO $$
DECLARE
    v_project uuid;
    v_stage uuid;
    v_cohort uuid;
    v_line uuid;
BEGIN
    SELECT p.id, s.id INTO v_project, v_stage
      FROM projects.projects p
      JOIN projects.project_stages s ON s.project_id = p.id
     WHERE p.owner_user_id = pg_temp.s('seller') AND p.owner_team_id IS NULL
       AND p.status IN ('draft', 'active')
     ORDER BY p.created_at LIMIT 1;
    IF v_project IS NULL THEN
        RAISE EXCEPTION 'FAIL fixtures: the seller owns no project with a stage to hang a cohort on';
    END IF;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_project, v_stage, 'Probe cohort', 10, 'enrolling') RETURNING id INTO v_cohort;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Probe sitting', now() + interval '7 days', now() + interval '7 days 2 hours');
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, status)
    VALUES (v_cohort, pg_temp.s('buyer'), 3, 'active');
    PERFORM set_config('probe.cohort', v_cohort::text, true);
    PERFORM set_config('probe.membership', (SELECT cm.id FROM projects.cohort_memberships cm
        WHERE cm.cohort_id = v_cohort AND cm.user_id = pg_temp.s('buyer'))::text, true);
END $$;

DO $$
DECLARE
    v jsonb;
    v_code text;
BEGIN
    v := pg_temp.door(pg_temp.s('buyer'), format('projects.share_cohort_seats(%L::uuid)', pg_temp.s('membership')));
    v_code := v ->> 'code';
    PERFORM set_config('probe.code', v_code, true);
    PERFORM pg_temp.check(v_code ~ '^s-[A-Za-z0-9_-]{24}$' AND (v ->> 'seats_left')::int = 2,
        '7 the buyer opens a link for their two spare seats');
    PERFORM pg_temp.check(
        (pg_temp.door(pg_temp.s('buyer'), format('projects.share_cohort_seats(%L::uuid)', pg_temp.s('membership'))) ->> 'code') = v_code,
        '7 sharing again returns the same link');
    PERFORM pg_temp.check(
        (pg_temp.door(pg_temp.s('stranger'), format('projects.get_cohort_seat_invite(%L)', v_code)) ->> 'state') = 'open',
        '7 the link reads open to someone else');
    PERFORM pg_temp.check(
        (pg_temp.door(pg_temp.s('buyer'), format('projects.get_cohort_seat_invite(%L)', v_code)) ->> 'state') = 'own',
        '7 and own to the buyer');
END $$;

SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT projects.claim_cohort_seat(%L)', current_setting('probe.code')),
    'own', '7 the buyer cannot claim their own seat');
SELECT pg_temp.refused(pg_temp.s('seller'), format('SELECT projects.claim_cohort_seat(%L)', current_setting('probe.code')),
    'own', '7 nor can the host');

DO $$
DECLARE
    v jsonb;
    v_taken_before integer;
BEGIN
    v_taken_before := projects.fn_cohort_seats_taken(pg_temp.s('cohort'));
    v := pg_temp.door(pg_temp.s('stranger'), format('projects.claim_cohort_seat(%L)', current_setting('probe.code')));
    PERFORM pg_temp.check(
        (SELECT cm.seats = 1 AND cm.sponsor_membership_id = pg_temp.s('membership') AND cm.status = 'active'
           FROM projects.cohort_memberships cm WHERE cm.id = (v ->> 'membership_id')::uuid),
        '7 a claim seats the claimer on one seat sponsored by the buyer');
    PERFORM pg_temp.check(
        (SELECT cm.seats = 2 FROM projects.cohort_memberships cm WHERE cm.id = pg_temp.s('membership')),
        '7 the seat leaves the buyer''s count');
    PERFORM pg_temp.check(projects.fn_cohort_seats_taken(pg_temp.s('cohort')) = v_taken_before,
        '7 the cohort''s occupancy is unchanged');
    PERFORM pg_temp.check(
        (SELECT count(*) = 1 FROM comms.notifications n
          WHERE n.user_id = pg_temp.s('buyer') AND n.type = 'session.seat_claimed'),
        '7 the buyer is told');
END $$;

SELECT pg_temp.refused(pg_temp.s('stranger'), format('SELECT projects.claim_cohort_seat(%L)', current_setting('probe.code')),
    'seated', '7 one claim per person');

DO $$
BEGIN
    PERFORM pg_temp.door(pg_temp.s('third'), format('projects.claim_cohort_seat(%L)', current_setting('probe.code')));
    PERFORM pg_temp.check(
        (SELECT cm.seats = 1 FROM projects.cohort_memberships cm WHERE cm.id = pg_temp.s('membership')),
        '7 the second claim leaves the buyer their own seat');
    PERFORM pg_temp.check(
        (pg_temp.door(pg_temp.s('buyer'), format('projects.get_my_cohort_seats(%L::uuid)', pg_temp.s('cohort'))) ->> 'can_share')::boolean = false
        AND jsonb_array_length(pg_temp.door(pg_temp.s('buyer'), format('projects.get_my_cohort_seats(%L::uuid)', pg_temp.s('cohort'))) -> 'claimed') = 2,
        '7 the buyer reads both claims and has nothing left to share');
END $$;

DO $$
DECLARE
    v_fourth uuid;
BEGIN
    SELECT u.user_id INTO v_fourth FROM org.users_public u
     WHERE u.user_id NOT IN (pg_temp.s('seller'), pg_temp.s('buyer'), pg_temp.s('stranger'), pg_temp.s('third'))
       AND NOT org.fn_is_minor(u.user_id)
     ORDER BY u.user_id LIMIT 1;
    PERFORM set_config('probe.fourth', v_fourth::text, true);
END $$;
SELECT pg_temp.refused(pg_temp.s('fourth'), format('SELECT projects.claim_cohort_seat(%L)', current_setting('probe.code')),
    'full', '7 no claim once the buyer is down to their own seat');

DO $$
DECLARE
    v_third_seat uuid;
BEGIN
    SELECT cm.id INTO v_third_seat FROM projects.cohort_memberships cm
     WHERE cm.cohort_id = pg_temp.s('cohort') AND cm.user_id = pg_temp.s('third');
    UPDATE projects.cohort_memberships SET status = 'cancelled', cancelled_at = now() WHERE id = v_third_seat;
    PERFORM pg_temp.check(
        (SELECT cm.seats = 2 FROM projects.cohort_memberships cm WHERE cm.id = pg_temp.s('membership')),
        '7 a claimed seat given up goes back to the buyer');
END $$;

DO $$
BEGIN
    PERFORM pg_temp.door(pg_temp.s('buyer'), format('projects.revoke_cohort_seat_link(%L::uuid)', pg_temp.s('membership')));
END $$;
SELECT pg_temp.refused(pg_temp.s('fourth'), format('SELECT projects.claim_cohort_seat(%L)', current_setting('probe.code')),
    'revoked', '7 a revoked link takes no claim');

DO $$
BEGIN
    UPDATE projects.cohort_memberships SET status = 'cancelled', cancelled_at = now() WHERE id = pg_temp.s('membership');
    PERFORM pg_temp.check(
        (SELECT cm.status = 'cancelled' FROM projects.cohort_memberships cm
          WHERE cm.cohort_id = pg_temp.s('cohort') AND cm.user_id = pg_temp.s('stranger')),
        '7 the seats a buyer gave away end with the buyer''s');
END $$;
-- #endregion

ROLLBACK;
