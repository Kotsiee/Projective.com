-- =============================================================================================
-- Probe: quote requests and priced offers (LV5; MK-16; Decision #458).
--
--   1  ask       a buyer raises one open request per listing; the host is told; no client write
--   2  answer    only the host prices it, within the bounds; a stranger cannot see it
--   3  revise    a new offer withdraws the pending one and points it at its successor
--   4  expiry    an expired offer can be neither accepted nor declined
--   5  accept    exactly one basket line, idempotent, re-added after a removal, never a second by hand
--   6  terms     checkout's one-stage terms, for the buyer and that line only; refused once paid for
--   7  close     the buyer declines an offer and withdraws; the host declines with a reason
--   8  reads     get_quotes_with per side; the pipeline shows the offer's price
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/quote_offers.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. Fixtures are found in
-- the seed; no ids are hard-coded.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;
-- The pg_temp helpers below run as anon and authenticated, and 00002500 gives a new function no PUBLIC
-- EXECUTE; this hands it back to the helpers alone, and rolls back with them.
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

-- Run a door as p_user and return its jsonb answer.
CREATE FUNCTION pg_temp.door(p_user uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.act(p_user);
    EXECUTE 'SELECT (' || p_sql || ')::jsonb' INTO v;
    PERFORM pg_temp.act(NULL);
    RETURN v;
END $$;

-- Run a statement as p_user and require the door's refusal code.
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

-- Run a statement as p_user and require a given SQLSTATE (a policy or index refusal).
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

CREATE FUNCTION pg_temp.notified(p_user uuid, p_type text, p_request uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM comms.notifications n
     WHERE n.user_id = p_user AND n.type = p_type AND n.entity_id = p_request;
$$;

CREATE FUNCTION pg_temp.live_lines(p_offer uuid) RETURNS integer LANGUAGE sql AS $$
    SELECT count(*)::integer FROM finance.basket_items bi
     WHERE bi.metadata ->> 'quoteOfferId' = p_offer::text AND bi.removed_at IS NULL AND bi.purchased_at IS NULL;
$$;

CREATE FUNCTION pg_temp.offer(p_request uuid, p_price bigint, p_days integer DEFAULT 14) RETURNS text LANGUAGE sql AS $$
    SELECT format(
        'marketplace.send_quote_offer(%L::uuid, %L, ARRAY[%L, %L], %s, 10, %s)',
        p_request, 'A redesign of the billing checkout, tested with customers.',
        'Journey map', 'Tested prototype', p_price, p_days
    );
$$;
-- #endregion

-- #region Fixtures: a published personal listing, its adult seller, an adult buyer and a stranger
DO $$
DECLARE
    v_bp uuid;
    v_seller uuid;
    v_buyer uuid;
    v_stranger uuid;
BEGIN
    SELECT b.id, b.freelancer_profile_id INTO v_bp, v_seller
      FROM marketplace.service_blueprints b
     WHERE b.is_published AND b.owner_team_id IS NULL
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
     ORDER BY u.user_id LIMIT 1;
    IF v_bp IS NULL OR v_buyer IS NULL OR v_stranger IS NULL THEN
        RAISE EXCEPTION 'FAIL fixtures: no published listing with an adult seller, buyer and stranger';
    END IF;
    PERFORM set_config('probe.bp', v_bp::text, true);
    PERFORM set_config('probe.seller', v_seller::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
END $$;
-- #endregion

-- #region 1. The buyer asks
DO $$
DECLARE
    v jsonb;
    v_req uuid;
BEGIN
    v := pg_temp.door(pg_temp.s('buyer'), format(
        'marketplace.request_quote(%L::uuid, %L, 300000, %L, %L)',
        pg_temp.s('bp'), 'Rebuild our checkout around usage billing.', 'usd', 'Before the quarter ends'));
    v_req := (v ->> 'id')::uuid;
    PERFORM set_config('probe.req', v_req::text, true);
    PERFORM pg_temp.check(v ->> 'status' = 'sent', '1 a request is raised as sent');
    PERFORM pg_temp.check(
        (SELECT q.host_user_id = pg_temp.s('seller') AND q.currency = 'USD' FROM marketplace.quote_requests q WHERE q.id = v_req),
        '1 the host is the listing''s seller and the budget currency is upper-cased');
    PERFORM pg_temp.check(pg_temp.notified(pg_temp.s('seller'), 'quote.requested', v_req) = 1, '1 the host is notified');
    PERFORM pg_temp.check(
        (SELECT n.action_url LIKE '/catalogue?view=clients&client=@%' FROM comms.notifications n
          WHERE n.user_id = pg_temp.s('seller') AND n.type = 'quote.requested' AND n.entity_id = v_req),
        '1 the host''s notice opens the buyer in their client pipeline');
END $$;

SELECT pg_temp.refused(pg_temp.s('buyer'), format(
    'SELECT marketplace.request_quote(%L::uuid, %L)', pg_temp.s('bp'), 'Same ask again'),
    'already_open', '1 a second open request on one listing');
SELECT pg_temp.refused(pg_temp.s('seller'), format(
    'SELECT marketplace.request_quote(%L::uuid, %L)', pg_temp.s('bp'), 'My own'),
    'own_listing', '1 a seller cannot ask their own listing');
SELECT pg_temp.refused(pg_temp.s('stranger'), format(
    'SELECT marketplace.request_quote(%L::uuid, %L, 100)', pg_temp.s('bp'), 'No currency'),
    'currency_required', '1 a budget needs a currency');

SELECT pg_temp.refused_state(pg_temp.s('buyer'), format(
    'INSERT INTO marketplace.quote_requests (blueprint_id, host_user_id, requester_user_id, scope) VALUES (%L, %L, %L, %L)',
    pg_temp.s('bp'), pg_temp.s('seller'), pg_temp.s('buyer'), 'By hand'),
    '42501', '1 no client insert');

DO $$
BEGIN
    PERFORM pg_temp.act(pg_temp.s('buyer'));
    UPDATE marketplace.quote_requests SET status = 'answered', answered_at = now() WHERE id = pg_temp.s('req');
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.check(
        (SELECT q.status = 'sent' FROM marketplace.quote_requests q WHERE q.id = pg_temp.s('req')),
        '1 a buyer can no longer mark their own request answered (the reproduced defect)');
END $$;
-- #endregion

-- #region 2. Only the host answers, within the bounds
SELECT pg_temp.refused(pg_temp.s('buyer'), 'SELECT ' || pg_temp.offer(pg_temp.s('req'), 100000),
    'not_your_move', '2 the buyer cannot price their own request');
SELECT pg_temp.refused(pg_temp.s('stranger'), 'SELECT ' || pg_temp.offer(pg_temp.s('req'), 100000),
    'quote_not_found', '2 a stranger cannot price it, nor learn it exists');
SELECT pg_temp.refused(pg_temp.s('seller'), 'SELECT ' || pg_temp.offer(pg_temp.s('req'), 0),
    'price_required', '2 an offer has a price');
SELECT pg_temp.refused(pg_temp.s('seller'), 'SELECT ' || pg_temp.offer(pg_temp.s('req'), 100000, 2),
    'expiry_invalid', '2 an expiry under 3 days');
SELECT pg_temp.refused(pg_temp.s('seller'), 'SELECT ' || pg_temp.offer(pg_temp.s('req'), 100000, 31),
    'expiry_invalid', '2 an expiry over 30 days');
SELECT pg_temp.refused(pg_temp.s('seller'), format(
    'SELECT marketplace.send_quote_offer(%L::uuid, %L, (SELECT array_agg(i::text) FROM generate_series(1, 13) i), 1000, 5)',
    pg_temp.s('req'), 'Too many'), 'too_many_deliverables', '2 at most 12 deliverables');

DO $$
DECLARE
    v jsonb;
BEGIN
    v := pg_temp.door(pg_temp.s('seller'), pg_temp.offer(pg_temp.s('req'), 120000));
    PERFORM set_config('probe.offer_a', v ->> 'id', true);
    PERFORM pg_temp.check(v ->> 'status' = 'pending' AND v ->> 'supersedes' IS NULL, '2 the host sends an offer');
    PERFORM pg_temp.check(
        (SELECT q.status = 'answered' AND q.answered_at IS NOT NULL FROM marketplace.quote_requests q WHERE q.id = pg_temp.s('req')),
        '2 the request is answered, and says when');
    PERFORM pg_temp.check(
        (SELECT o.currency = upper(b.currency) AND o.expires_at = o.created_at + interval '14 days'
           FROM marketplace.quote_offers o JOIN marketplace.service_blueprints b ON b.id = pg_temp.s('bp')
          WHERE o.id = pg_temp.s('offer_a')),
        '2 the price is in the listing''s currency and the expiry is 14 days out');
    PERFORM pg_temp.check(pg_temp.notified(pg_temp.s('buyer'), 'quote.offer_received', pg_temp.s('req')) = 1,
        '2 the buyer is notified');

    PERFORM pg_temp.act(pg_temp.s('stranger'));
    PERFORM pg_temp.check((SELECT count(*) FROM marketplace.quote_offers WHERE quote_request_id = pg_temp.s('req')) = 0
        AND (SELECT count(*) FROM marketplace.quote_requests WHERE id = pg_temp.s('req')) = 0,
        '2 a stranger reads neither the request nor its offer');
    PERFORM pg_temp.act(pg_temp.s('buyer'));
    PERFORM pg_temp.check((SELECT count(*) FROM marketplace.quote_offers WHERE quote_request_id = pg_temp.s('req')) = 1,
        '2 the buyer reads the offer');
    PERFORM pg_temp.act(NULL);
END $$;
-- #endregion

-- #region 3. A revision supersedes
DO $$
DECLARE
    v jsonb;
BEGIN
    v := pg_temp.door(pg_temp.s('seller'), pg_temp.offer(pg_temp.s('req'), 110000));
    PERFORM set_config('probe.offer_b', v ->> 'id', true);
    PERFORM pg_temp.check((v ->> 'supersedes')::uuid = pg_temp.s('offer_a'), '3 the revision names the offer it replaces');
    PERFORM pg_temp.check(
        (SELECT o.status = 'withdrawn' AND o.superseded_by = pg_temp.s('offer_b') AND o.decided_at IS NOT NULL
           FROM marketplace.quote_offers o WHERE o.id = pg_temp.s('offer_a')),
        '3 the old offer is withdrawn and points at its successor');
    PERFORM pg_temp.check(
        (SELECT count(*) FROM marketplace.quote_offers o WHERE o.quote_request_id = pg_temp.s('req') AND o.status = 'pending') = 1,
        '3 one pending offer, history kept');
END $$;
SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('offer_a')),
    'not_open', '3 a superseded offer cannot be accepted');
-- #endregion

-- #region 4. An expired offer
UPDATE marketplace.quote_offers
   SET created_at = now() - interval '15 days', expires_at = now() - interval '1 day'
 WHERE id = pg_temp.s('offer_b');
SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('offer_b')),
    'offer_expired', '4 an expired offer cannot be accepted');
SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT marketplace.decline_quote_offer(%L::uuid)', pg_temp.s('offer_b')),
    'offer_expired', '4 nor declined');
DO $$
BEGIN
    PERFORM pg_temp.check(
        (SELECT x -> 'offer' ->> 'expired' = 'true'
           FROM jsonb_array_elements(pg_temp.door(pg_temp.s('buyer'),
                    format('marketplace.get_quotes_with(%L::uuid)', pg_temp.s('seller')))) x
          WHERE (x ->> 'id')::uuid = pg_temp.s('req')),
        '4 the read derives expired; it is never stored');
END $$;
-- #endregion

-- #region 5. Accept: exactly one basket line
DO $$
DECLARE
    v jsonb;
    v_again jsonb;
BEGIN
    v := pg_temp.door(pg_temp.s('seller'), pg_temp.offer(pg_temp.s('req'), 125000));
    PERFORM set_config('probe.offer_c', v ->> 'id', true);
    PERFORM pg_temp.check(
        (SELECT o.status = 'withdrawn' FROM marketplace.quote_offers o WHERE o.id = pg_temp.s('offer_b')),
        '5 a new offer replaces the expired one');

    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('offer_c')));
    PERFORM set_config('probe.line', v ->> 'basket_item_id', true);
    PERFORM pg_temp.check(v ->> 'status' = 'accepted', '5 the buyer accepts');
    PERFORM pg_temp.check(
        (SELECT q.status = 'accepted' AND q.closed_at IS NOT NULL FROM marketplace.quote_requests q WHERE q.id = pg_temp.s('req')),
        '5 the request closes as accepted');
    PERFORM pg_temp.check(pg_temp.live_lines(pg_temp.s('offer_c')) = 1, '5 exactly one live basket line');
    PERFORM pg_temp.check(
        (SELECT bi.item_type = 'one_off_service' AND bi.item_id = pg_temp.s('bp') AND bi.unit_price_minor = 125000
                AND bi.quantity = 1 AND b.owner_type = 'user' AND b.owner_id = pg_temp.s('buyer') AND b.is_default
                AND bi.metadata ->> 'fundingScope' = 'whole_project'
           FROM finance.basket_items bi JOIN finance.baskets b ON b.id = bi.basket_id
          WHERE bi.id = pg_temp.s('line')),
        '5 a one_off_service line at the offer''s price in the buyer''s personal basket');
    PERFORM pg_temp.check(pg_temp.notified(pg_temp.s('seller'), 'quote.offer_accepted', pg_temp.s('req')) = 1,
        '5 the host is notified');

    v_again := pg_temp.door(pg_temp.s('buyer'), format('marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('offer_c')));
    PERFORM pg_temp.check((v_again ->> 'basket_item_id')::uuid = pg_temp.s('line') AND pg_temp.live_lines(pg_temp.s('offer_c')) = 1,
        '5 accepting again returns the same line');
    PERFORM pg_temp.check(pg_temp.notified(pg_temp.s('seller'), 'quote.offer_accepted', pg_temp.s('req')) = 1,
        '5 and tells the host nothing new');
END $$;

SELECT pg_temp.refused(pg_temp.s('seller'), format('SELECT marketplace.withdraw_quote_offer(%L::uuid)', pg_temp.s('offer_c')),
    'not_open', '5 the host cannot pull an accepted offer');
SELECT pg_temp.refused(pg_temp.s('seller'), 'SELECT ' || pg_temp.offer(pg_temp.s('req'), 90000),
    'not_open', '5 nor reprice an accepted request');
SELECT pg_temp.refused_state(pg_temp.s('buyer'), format(
    'INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, metadata)
     SELECT bi.basket_id, ''one_off_service'', bi.item_id, ''Forged'', 1, bi.currency, jsonb_build_object(''quoteOfferId'', %L)
       FROM finance.basket_items bi WHERE bi.id = %L',
    pg_temp.s('offer_c'), pg_temp.s('line')),
    '23505', '5 a second live line for the offer, written by hand, is refused');

DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('buyer'));
    UPDATE finance.basket_items SET removed_at = now() WHERE id = pg_temp.s('line');
    PERFORM pg_temp.act(NULL);
    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('offer_c')));
    PERFORM pg_temp.check((v ->> 'basket_item_id')::uuid <> pg_temp.s('line') AND pg_temp.live_lines(pg_temp.s('offer_c')) = 1,
        '5 a removed line is re-added by accepting again, still one live');
    PERFORM set_config('probe.line', v ->> 'basket_item_id', true);
END $$;
-- #endregion

-- #region 6. Checkout's terms
DO $$
DECLARE
    v jsonb;
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.s('buyer'), 'role', 'authenticated')::text, true);
    v := marketplace.fn_quote_offer_terms(pg_temp.s('offer_c'), pg_temp.s('line'));
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM pg_temp.check((v ->> 'price_cents')::bigint = 125000 AND (v ->> 'blueprint_id')::uuid = pg_temp.s('bp'),
        '6 the price and listing come from the offer');
    PERFORM pg_temp.check(jsonb_array_length(v -> 'terms') = 1
        AND (v -> 'terms' -> 0 ->> 'price')::bigint = 125000
        AND (v -> 'terms' -> 0 ->> 'intensity_locked')::boolean
        AND jsonb_array_length(v -> 'terms' -> 0 -> 'stage' -> 'deliverables') = 2,
        '6 one locked stage, its deliverables a checklist');
    PERFORM pg_temp.check(v ->> 'target_date' = to_char(current_date + 10, 'YYYY-MM-DD'),
        '6 the target date is today plus the turnaround');
END $$;

DO $$
BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.s('stranger'), 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM marketplace.fn_quote_offer_terms(pg_temp.s('offer_c'), pg_temp.s('line'));
        RAISE EXCEPTION 'FAIL 6 a stranger read the terms';
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.check(SQLERRM LIKE '%quote_not_found', '6 a stranger cannot read the terms');
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;

DO $$
DECLARE
    v_other uuid;
BEGIN
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, metadata, removed_at)
    SELECT bi.basket_id, 'one_off_service', bi.item_id, 'Old', 1, bi.currency,
           jsonb_build_object('quoteOfferId', pg_temp.s('offer_c')), now()
      FROM finance.basket_items bi WHERE bi.id = pg_temp.s('line')
    RETURNING id INTO v_other;
    UPDATE finance.basket_items SET purchased_at = now() WHERE id = pg_temp.s('line');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.s('buyer'), 'role', 'authenticated')::text, true);
    BEGIN
        PERFORM marketplace.fn_quote_offer_terms(pg_temp.s('offer_c'), v_other);
        RAISE EXCEPTION 'FAIL 6 a second line bought a paid offer';
    EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.check(SQLERRM LIKE '%already_ordered', '6 once paid for, no other line can buy it');
    END;
    PERFORM set_config('request.jwt.claims', '', true);
END $$;
SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('offer_c')),
    'already_ordered', '6 accepting a paid offer again');
SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT marketplace.withdraw_quote_request(%L::uuid)', pg_temp.s('req')),
    'already_ordered', '6 withdrawing a paid request');
-- #endregion

-- #region 7. Declines and withdrawals
DO $$
DECLARE
    v jsonb;
BEGIN
    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.request_quote(%L::uuid, %L)', pg_temp.s('bp'), 'A second ask'));
    PERFORM set_config('probe.req2', v ->> 'id', true);
    PERFORM pg_temp.check(v ->> 'status' = 'sent', '7 a closed request leaves room for a new one');
    v := pg_temp.door(pg_temp.s('seller'), pg_temp.offer(pg_temp.s('req2'), 50000));
    PERFORM set_config('probe.offer_d', v ->> 'id', true);
    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.decline_quote_offer(%L::uuid)', pg_temp.s('offer_d')));
    PERFORM pg_temp.check(v ->> 'status' = 'declined'
        AND (SELECT q.status = 'answered' FROM marketplace.quote_requests q WHERE q.id = pg_temp.s('req2')),
        '7 the buyer declines an offer; the request stays answered');
    PERFORM pg_temp.check(pg_temp.notified(pg_temp.s('seller'), 'quote.offer_declined', pg_temp.s('req2')) = 1,
        '7 the host is told');

    v := pg_temp.door(pg_temp.s('seller'), pg_temp.offer(pg_temp.s('req2'), 60000));
    PERFORM set_config('probe.offer_e', v ->> 'id', true);
    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.withdraw_quote_request(%L::uuid)', pg_temp.s('req2')));
    PERFORM pg_temp.check(v ->> 'status' = 'withdrawn'
        AND (SELECT o.status = 'declined' FROM marketplace.quote_offers o WHERE o.id = pg_temp.s('offer_e'))
        AND (SELECT q.closed_at IS NOT NULL FROM marketplace.quote_requests q WHERE q.id = pg_temp.s('req2')),
        '7 the buyer withdraws; the pending offer is declined with it');
    PERFORM pg_temp.check(pg_temp.notified(pg_temp.s('seller'), 'quote.withdrawn', pg_temp.s('req2')) = 1,
        '7 the host is told');
END $$;
SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT marketplace.withdraw_quote_request(%L::uuid)', pg_temp.s('req2')),
    'not_open', '7 a withdrawn request cannot be withdrawn again');

DO $$
DECLARE
    v jsonb;
BEGIN
    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.request_quote(%L::uuid, %L)', pg_temp.s('bp'), 'A third ask'));
    PERFORM set_config('probe.req3', v ->> 'id', true);
    v := pg_temp.door(pg_temp.s('seller'), pg_temp.offer(pg_temp.s('req3'), 70000));
    PERFORM set_config('probe.offer_f', v ->> 'id', true);
END $$;
SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT marketplace.decline_quote_request(%L::uuid)', pg_temp.s('req3')),
    'not_your_move', '7 only the host declines a request');
DO $$
DECLARE
    v jsonb;
BEGIN
    v := pg_temp.door(pg_temp.s('seller'),
        format('marketplace.decline_quote_request(%L::uuid, %L)', pg_temp.s('req3'), '  Fully booked until spring.  '));
    PERFORM pg_temp.check(v ->> 'status' = 'declined'
        AND (SELECT q.decline_reason = 'Fully booked until spring.' FROM marketplace.quote_requests q WHERE q.id = pg_temp.s('req3'))
        AND (SELECT o.status = 'withdrawn' FROM marketplace.quote_offers o WHERE o.id = pg_temp.s('offer_f')),
        '7 the host declines with a reason; the pending offer goes with it');
    PERFORM pg_temp.check(pg_temp.notified(pg_temp.s('buyer'), 'quote.declined', pg_temp.s('req3')) = 1
        AND (SELECT n.action_url LIKE '/messages/dm-%' FROM comms.notifications n
              WHERE n.user_id = pg_temp.s('buyer') AND n.type = 'quote.declined' AND n.entity_id = pg_temp.s('req3')),
        '7 the buyer is told, and the notice opens the conversation');
END $$;
SELECT pg_temp.refused(pg_temp.s('buyer'), format('SELECT marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('offer_f')),
    'not_open', '7 an offer on a declined request cannot be accepted');
-- #endregion

-- #region 8. Reads
DO $$
DECLARE
    v jsonb;
BEGIN
    v := pg_temp.door(pg_temp.s('buyer'), format('marketplace.get_quotes_with(%L::uuid)', pg_temp.s('seller')));
    PERFORM pg_temp.check(
        (SELECT count(*) FROM jsonb_array_elements(v) x
          WHERE (x ->> 'id')::uuid IN (pg_temp.s('req'), pg_temp.s('req2'), pg_temp.s('req3')) AND x ->> 'role' = 'buyer') = 3,
        '8 the buyer reads all three, as the buyer');
    PERFORM pg_temp.check(
        (SELECT x -> 'offer' ->> 'id' = pg_temp.s('offer_c')::text AND (x ->> 'ordered')::boolean
                AND (x ->> 'offers_sent')::integer = 3
           FROM jsonb_array_elements(v) x WHERE (x ->> 'id')::uuid = pg_temp.s('req')),
        '8 the current offer is the accepted one, ordered, after three sent');

    v := pg_temp.door(pg_temp.s('seller'), format('marketplace.get_quotes_with(%L::uuid)', pg_temp.s('buyer')));
    PERFORM pg_temp.check(
        (SELECT count(*) FROM jsonb_array_elements(v) x WHERE x ->> 'role' = 'host'
            AND (x ->> 'id')::uuid IN (pg_temp.s('req'), pg_temp.s('req2'), pg_temp.s('req3'))) = 3
        AND (SELECT count(*) FROM jsonb_array_elements(v) x WHERE x ->> 'basket_item_id' IS NOT NULL) = 0,
        '8 the host reads them as the host, without the buyer''s basket');

    v := pg_temp.door(pg_temp.s('stranger'), format('marketplace.get_quotes_with(%L::uuid)', pg_temp.s('seller')));
    PERFORM pg_temp.check(NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v) x
         WHERE (x ->> 'id')::uuid IN (pg_temp.s('req'), pg_temp.s('req2'), pg_temp.s('req3'))),
        '8 a stranger reads none of them');

    PERFORM pg_temp.act(pg_temp.s('seller'));
    PERFORM pg_temp.check(
        (SELECT p.amount_minor = 125000 FROM catalogue.get_client_pipeline(NULL, 500) p
          WHERE p.engagement_kind = 'quote' AND p.engagement_id = pg_temp.s('req')),
        '8 the pipeline shows the accepted offer''s price, not the budget');
    PERFORM pg_temp.act(NULL);
END $$;
-- #endregion

ROLLBACK;
