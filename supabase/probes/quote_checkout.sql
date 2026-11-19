-- =============================================================================================
-- Probe: an accepted quote offer is paid at its offered price and becomes its funded engagement
-- (CK7; MK-16; Decision #458 flags (a) and (b)).
--
--   1  the offer   a request on a priced One-Off, a first offer superseded by a lower one, accepted
--   2  price       checkout refuses the listing's own price for the offer's line
--   3  pay         the order, the line and the one held escrow equal the offer; one "Custom offer"
--                  milestone whose checklist is the offer's deliverables; the ticket due on
--                  today + the turnaround; the buyer debited exactly that; no seller credit
--   4  after       the offer cannot be accepted or withdrawn again; a replayed key buys nothing more
--   5  superseded  a hand-written line naming the superseded offer refuses, nothing written
--   6  expired     an accepted offer past its expiry: checkout refuses, accept refuses, the read says
--                  expired and offers only Withdraw (owner ruling A: the offer's expiry bounds payment)
--   7  not yours   a stranger's line naming the buyer's offer refuses; another currency refuses
--   8  pipeline    a quote on a Pipeline listing is bought as a one-milestone One-Off engagement
--   9  conserved   finance.v_conservation_identity (FBP DB16) reads the same imbalance after every
--                  order above as after the fixtures: the flow moves wallet money into escrow and
--                  adds no term of its own
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/quote_checkout.sql
--
-- Fixtures are discovered from the seed: a published personal One-Off with two or more milestones
-- and a published personal Pipeline, both in USD and sold by adults, an adult buyer who sells
-- neither and a stranger, both credited inside the transaction. A clean run prints only PASS notices;
-- any failure raises `PROBE FAIL: …` and aborts. Conservation is asserted twice: per order (buyer
-- debit = escrow held, no seller credit) and across the whole run (§9, the DB16 identity).
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;
-- The pg_temp helpers below run as authenticated, and 00002500 gives a new function no PUBLIC
-- EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region 0. Helpers (as postgres)
CREATE FUNCTION pg_temp.act(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_user IS NULL THEN
        PERFORM set_config('role', 'postgres', true);
        PERFORM set_config('request.jwt.claims', '', true);
        PERFORM set_config('request.jwt.claim.sub', '', true);
    ELSE
        PERFORM set_config('request.jwt.claims',
            json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
        PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
        PERFORM set_config('role', 'authenticated', true);
    END IF;
END $$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'PROBE FAIL: %', p_label;
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

-- Run a statement as p_user and require a SQLSTATE whose message contains p_words.
CREATE FUNCTION pg_temp.refused(p_user uuid, p_sql text, p_state text, p_words text, p_label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.act(p_user);
    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        PERFORM pg_temp.act(NULL);
        IF SQLSTATE <> p_state OR position(lower(p_words) IN lower(SQLERRM)) = 0 THEN
            RAISE EXCEPTION 'PROBE FAIL: % answered % [%], wanted % "…%…"', p_label, SQLSTATE, SQLERRM, p_state, p_words;
        END IF;
        RAISE NOTICE 'PASS % [% %]', p_label, SQLSTATE, SQLERRM;
        RETURN;
    END;
    PERFORM pg_temp.act(NULL);
    RAISE EXCEPTION 'PROBE FAIL: % was allowed', p_label;
END $$;

CREATE FUNCTION pg_temp.balance(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE(sum(w.balance_cents), 0)::bigint FROM finance.wallets w
     WHERE w.owner_id = p_user AND w.owner_type IN ('user', 'freelancer') AND w.currency = 'USD';
$$;

CREATE FUNCTION pg_temp.pending(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE(sum(pr.amount_cents), 0)::bigint FROM finance.pending_releases pr
      JOIN finance.wallets w ON w.id = pr.wallet_id
     WHERE w.owner_id = p_user AND w.owner_type IN ('user', 'freelancer') AND w.currency = 'USD';
$$;

CREATE FUNCTION pg_temp.offer(p_request uuid, p_price bigint, p_turnaround integer DEFAULT 10) RETURNS text
LANGUAGE sql AS $$
    SELECT format(
        'marketplace.send_quote_offer(%L::uuid, %L, ARRAY[%L, %L], %s, %s, 14)',
        p_request, 'A redesign of the billing checkout, tested with customers.',
        'Journey map', 'Tested prototype', p_price, p_turnaround
    );
$$;

-- The checkout call a buyer's Pay makes, for one line at one shown unit.
CREATE FUNCTION pg_temp.pay_sql(p_line uuid, p_unit bigint, p_key text, p_currency text DEFAULT 'USD') RETURNS text
LANGUAGE sql AS $$
    SELECT format(
        'finance.place_wallet_order((SELECT basket_id FROM finance.basket_items WHERE id = %L::uuid), ARRAY[%L::uuid], %L, jsonb_build_object(%L, %s::bigint), NULL, %L, %s::bigint)',
        p_line, p_line, p_currency, p_line::text, p_unit, p_key, p_unit
    );
$$;

-- A line written by hand into p_user's own personal basket, naming an offer (a buyer may write
-- basket_items: "Manage own basket items").
CREATE FUNCTION pg_temp.forged_line(p_user uuid, p_bp uuid, p_offer uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_basket uuid;
    v_line uuid;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES ('user', p_user, 'Probe CK7')
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, metadata)
    VALUES (v_basket, 'one_off_service', p_bp, 'Probe offer line', 1, 'USD',
            jsonb_build_object('fundingScope', 'whole_project', 'requirements', 'Forged', 'answers', '{}'::jsonb,
                               'quoteOfferId', p_offer))
    RETURNING id INTO v_line;
    RETURN v_line;
END $$;

-- The buyer's own read of one request, as the conversation panel gets it.
CREATE FUNCTION pg_temp.read(p_user uuid, p_counterpart uuid, p_request uuid) RETURNS jsonb LANGUAGE sql AS $$
    SELECT x FROM jsonb_array_elements(pg_temp.door(p_user,
        format('marketplace.get_quotes_with(%L::uuid)', p_counterpart))) x
     WHERE x ->> 'id' = p_request::text;
$$;
-- #endregion

-- #region Fixtures
DO $$
DECLARE
    v_oneoff record;
    v_pipe record;
    v_buyer uuid;
    v_stranger uuid;
BEGIN
    SELECT sb.id, sb.freelancer_profile_id AS seller INTO v_oneoff
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'one_off' AND sb.is_published AND sb.owner_team_id IS NULL
       AND upper(sb.currency) = 'USD' AND jsonb_array_length(sb.stage_template) >= 2
       AND NOT org.fn_is_minor(sb.freelancer_profile_id)
     ORDER BY sb.slug LIMIT 1;
    SELECT sb.id, sb.freelancer_profile_id AS seller INTO v_pipe
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'pipeline' AND sb.is_published AND sb.owner_team_id IS NULL
       AND upper(sb.currency) = 'USD' AND NOT org.fn_is_minor(sb.freelancer_profile_id)
       AND sb.freelancer_profile_id IS DISTINCT FROM v_oneoff.seller
     ORDER BY sb.slug LIMIT 1;
    IF v_oneoff.id IS NULL OR v_pipe.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture one_off=% pipeline=% — run deno task db:reset', v_oneoff.id, v_pipe.id;
    END IF;

    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id NOT IN (v_oneoff.seller, v_pipe.seller) AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm WHERE tm.user_id = u.user_id AND tm.status = 'active')
       AND NOT EXISTS (SELECT 1 FROM marketplace.quote_requests q
                        WHERE q.requester_user_id = u.user_id AND q.blueprint_id IN (v_oneoff.id, v_pipe.id))
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (v_oneoff.seller, v_pipe.seller, v_buyer) AND NOT org.fn_is_minor(u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_buyer IS NULL OR v_stranger IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: fixture buyer=% stranger=%', v_buyer, v_stranger;
    END IF;

    -- The listing's own milestones are priced, so "below the listing" is a real difference: the
    -- whole-project prepay the offer's line carries (`fundingScope`) would charge 280000 today.
    UPDATE marketplace.service_blueprints
       SET stage_template = (
           SELECT jsonb_agg(CASE WHEN s.ord = 1 THEN s.value || '{"priceCents": 120000}'::jsonb
                                 ELSE s.value || '{"priceCents": 80000}'::jsonb END ORDER BY s.ord)
             FROM jsonb_array_elements(stage_template) WITH ORDINALITY AS s (value, ord))
     WHERE id = v_oneoff.id;

    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_buyer), v_buyer, 'USD');
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', 2000000,
        'topup', 'inbound_payments', gen_random_uuid());
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_stranger), v_stranger, 'USD');
    PERFORM finance.fn_wallet_credit(v_stranger, finance.fn_person_wallet_type(v_stranger), 'USD', 2000000,
        'topup', 'inbound_payments', gen_random_uuid());

    PERFORM set_config('probe.oneoff', v_oneoff.id::text, true);
    PERFORM set_config('probe.seller', v_oneoff.seller::text, true);
    PERFORM set_config('probe.pipe', v_pipe.id::text, true);
    PERFORM set_config('probe.pipe_seller', v_pipe.seller::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
    -- The identity after the fixtures' own credits (minted with no inbound payment), so §9 judges the
    -- quote checkout alone.
    PERFORM set_config('probe.imbalance0', COALESCE((SELECT ci.imbalance_minor::text
        FROM finance.v_conservation_identity ci WHERE ci.currency = 'USD'), '0'), true);
    RAISE NOTICE 'fixture one_off=% seller=% pipeline=% pipe_seller=% buyer=% stranger=%',
        v_oneoff.id, v_oneoff.seller, v_pipe.id, v_pipe.seller, v_buyer, v_stranger;
END $$;
-- #endregion

-- #region 1. The offer: requested, priced, revised lower, accepted
DO $$
DECLARE
    v_req jsonb;
    v_o1 jsonb;
    v_o2 jsonb;
    v_acc jsonb;
BEGIN
    v_req := pg_temp.door(pg_temp.s('buyer'), format(
        'marketplace.request_quote(%L::uuid, %L)', pg_temp.s('oneoff'), 'Redesign our billing checkout'));
    v_o1 := pg_temp.door(pg_temp.s('seller'), pg_temp.offer((v_req ->> 'id')::uuid, 150000));
    v_o2 := pg_temp.door(pg_temp.s('seller'), pg_temp.offer((v_req ->> 'id')::uuid, 90000, 12));
    v_acc := pg_temp.door(pg_temp.s('buyer'), format('marketplace.accept_quote_offer(%L::uuid)', v_o2 ->> 'id'));
    PERFORM pg_temp.check(
        (SELECT status = 'withdrawn' AND superseded_by = (v_o2 ->> 'id')::uuid
           FROM marketplace.quote_offers WHERE id = (v_o1 ->> 'id')::uuid)
        AND v_acc ->> 'status' = 'accepted' AND v_acc ->> 'basket_item_id' IS NOT NULL,
        '1 the first offer is superseded; the lower one is accepted into one basket line');
    PERFORM set_config('probe.request', v_req ->> 'id', true);
    PERFORM set_config('probe.o1', v_o1 ->> 'id', true);
    PERFORM set_config('probe.o2', v_o2 ->> 'id', true);
    PERFORM set_config('probe.line', v_acc ->> 'basket_item_id', true);
END $$;
-- #endregion

-- #region 2. The listing's price is not the offer's
SELECT pg_temp.refused(pg_temp.s('buyer'),
    'SELECT ' || pg_temp.pay_sql(pg_temp.s('line'), 280000, 'probe-ck7-listing'),
    'PC409', 'changed', '2 checkout refuses the listing''s whole-project price for the offer''s line');
-- #endregion

-- #region 3. Paid at the offer's price, into its funded engagement
DO $$
DECLARE
    v_buyer uuid := pg_temp.s('buyer');
    v_seller uuid := pg_temp.s('seller');
    v_b0 bigint := pg_temp.balance(pg_temp.s('buyer'));
    v_s0 bigint := pg_temp.balance(pg_temp.s('seller'));
    v_p0 bigint := pg_temp.pending(pg_temp.s('seller'));
    v_out jsonb;
    v_ol record;
    v_stage record;
    v_n integer;
BEGIN
    v_out := pg_temp.door(v_buyer, pg_temp.pay_sql(pg_temp.s('line'), 90000, 'probe-ck7-pay'));
    SELECT * INTO v_ol FROM finance.order_lines WHERE order_id = (v_out ->> 'order_id')::uuid;
    SELECT count(*) INTO v_n FROM projects.project_stages WHERE project_id = v_ol.project_id;
    SELECT * INTO v_stage FROM projects.project_stages WHERE id = v_ol.stage_id;

    PERFORM pg_temp.check((v_out ->> 'charged_minor')::bigint = 90000
        AND (SELECT total_minor FROM finance.orders WHERE id = (v_out ->> 'order_id')::uuid) = 90000
        AND v_ol.line_total_minor = 90000 AND v_ol.fulfilment = 'engagement'
        AND v_ol.item_type = 'one_off_service' AND v_ol.subtitle = 'Custom offer · escrow held',
        '3 the order and its line are charged the offer''s 90000, not the listing''s 280000');
    PERFORM pg_temp.check(EXISTS (
        SELECT 1 FROM finance.escrows e
         WHERE e.id = v_ol.escrow_id AND e.status = 'held' AND e.amount_cents = 90000
           AND e.project_stage_id = v_ol.stage_id AND e.ticket_id = v_ol.ticket_id)
        AND (SELECT count(*) FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
              WHERE ps.project_id = v_ol.project_id) = 1,
        '3 one escrow, held, equal to the offer');
    PERFORM pg_temp.check(EXISTS (
        SELECT 1 FROM projects.projects p
         WHERE p.id = v_ol.project_id AND p.status = 'active' AND p.format = 'one_off'
           AND p.structure_variation = 'one_off' AND p.client_user_id = v_buyer AND p.owner_user_id = v_seller
           AND p.budget_amount_cents = 90000 AND p.source_blueprint_id = pg_temp.s('oneoff')),
        '3 the engagement is the seller''s One-Off with the buyer as client, budgeted at the offer');
    PERFORM pg_temp.check(v_n = 1 AND v_stage.name = 'Custom offer' AND v_stage.unit_price_cents = 90000
        AND v_stage.intensity_locked
        AND (SELECT array_agg(t ->> 'text' ORDER BY n) FROM jsonb_array_elements(v_stage.default_tasks) WITH ORDINALITY AS x (t, n))
            = ARRAY['Journey map', 'Tested prototype']
        AND EXISTS (SELECT 1 FROM projects.stage_assignments sa
                     WHERE sa.project_stage_id = v_stage.id AND sa.freelancer_profile_id = v_seller AND sa.status = 'accepted'),
        '3 one "Custom offer" milestone at the offer''s price: its checklist is the offer''s deliverables, the seller seated');
    PERFORM pg_temp.check(
        (SELECT due_date::date FROM projects.tickets WHERE id = v_ol.ticket_id) = current_date + 12
        AND (SELECT text_description FROM projects.tickets WHERE id = v_ol.ticket_id)
            = 'A redesign of the billing checkout, tested with customers.',
        '3 the master ticket carries the offer''s scope and is due on today + its 12-day turnaround');
    PERFORM pg_temp.check(pg_temp.balance(v_buyer) = v_b0 - 90000
        AND pg_temp.balance(v_seller) = v_s0 AND pg_temp.pending(v_seller) = v_p0
        AND NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.order_id = (v_out ->> 'order_id')::uuid),
        '3 conservation: the buyer is debited exactly what escrow holds; the seller is credited nothing yet');
    PERFORM pg_temp.check(
        (SELECT purchased_at IS NOT NULL FROM finance.basket_items WHERE id = pg_temp.s('line')),
        '3 the offer''s basket line is consumed');
    PERFORM set_config('probe.order', v_out ->> 'order_id', true);
END $$;
-- #endregion

-- #region 4. Once paid, the offer is spent
SELECT pg_temp.refused(pg_temp.s('buyer'),
    format('SELECT marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('o2')),
    '23514', 'already_ordered', '4 a paid offer cannot be accepted again');
SELECT pg_temp.refused(pg_temp.s('buyer'),
    format('SELECT marketplace.withdraw_quote_request(%L::uuid)', pg_temp.s('request')),
    '23514', 'already_ordered', '4 a paid request cannot be withdrawn');
DO $$
DECLARE
    v_again jsonb;
BEGIN
    v_again := pg_temp.door(pg_temp.s('buyer'), pg_temp.pay_sql(pg_temp.s('line'), 90000, 'probe-ck7-pay'));
    PERFORM pg_temp.check((v_again ->> 'replayed')::boolean AND v_again ->> 'order_id' = current_setting('probe.order')
        AND (SELECT count(*) FROM projects.projects WHERE source_blueprint_id = pg_temp.s('oneoff')
               AND client_user_id = pg_temp.s('buyer') AND created_at >= now()) = 1,
        '4 a replayed key returns the same order and no second engagement');
END $$;
-- #endregion

-- #region 5. A superseded offer refuses
DO $$
DECLARE
    v_line uuid;
    v_orders bigint;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('buyer'));
    v_line := pg_temp.forged_line(pg_temp.s('buyer'), pg_temp.s('oneoff'), pg_temp.s('o1'));
    PERFORM pg_temp.act(NULL);
    SELECT count(*) INTO v_orders FROM finance.orders;
    PERFORM set_config('probe.forged', v_line::text, true);
    PERFORM set_config('probe.orders', v_orders::text, true);
END $$;
SELECT pg_temp.refused(pg_temp.s('buyer'),
    'SELECT ' || pg_temp.pay_sql(pg_temp.s('forged'), 150000, 'probe-ck7-superseded'),
    'PC409', 'no longer on offer', '5 a line naming the superseded offer refuses');
SELECT pg_temp.check((SELECT count(*) FROM finance.orders) = current_setting('probe.orders')::bigint,
    '5 the refusal wrote no order');
-- #endregion

-- #region 6. Past its expiry an accepted offer is not payable (ruling A)
DO $$
DECLARE
    v_req jsonb;
    v_o3 jsonb;
    v_acc jsonb;
BEGIN
    -- The first request closed as accepted, so the buyer may ask again on the same listing.
    v_req := pg_temp.door(pg_temp.s('buyer'), format(
        'marketplace.request_quote(%L::uuid, %L)', pg_temp.s('oneoff'), 'A second round of checkout work'));
    v_o3 := pg_temp.door(pg_temp.s('seller'), pg_temp.offer((v_req ->> 'id')::uuid, 70000));
    v_acc := pg_temp.door(pg_temp.s('buyer'), format('marketplace.accept_quote_offer(%L::uuid)', v_o3 ->> 'id'));
    -- The offer was sent 20 days ago and lapsed an hour ago (inside the 3–30 day window check). Its
    -- terms are frozen (trg_quote_offers_kept, Decision #522), so the probe lifts the guard for this one
    -- rewrite, inside its rolled-back transaction.
    ALTER TABLE marketplace.quote_offers DISABLE TRIGGER trg_quote_offers_kept;
    UPDATE marketplace.quote_offers
       SET created_at = now() - interval '20 days', expires_at = now() - interval '1 hour'
     WHERE id = (v_o3 ->> 'id')::uuid;
    ALTER TABLE marketplace.quote_offers ENABLE TRIGGER trg_quote_offers_kept;
    PERFORM set_config('probe.request3', v_req ->> 'id', true);
    PERFORM set_config('probe.o3', v_o3 ->> 'id', true);
    PERFORM set_config('probe.line3', v_acc ->> 'basket_item_id', true);
END $$;
SELECT pg_temp.refused(pg_temp.s('buyer'),
    'SELECT ' || pg_temp.pay_sql(pg_temp.s('line3'), 70000, 'probe-ck7-expired'),
    'PC409', 'expired', '6 checkout refuses an accepted offer past its expiry');
SELECT pg_temp.refused(pg_temp.s('buyer'),
    format('SELECT marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('o3')),
    '23514', 'offer_expired', '6 accepting it again (Checkout''s re-add) refuses offer_expired');
SELECT pg_temp.check(
    (pg_temp.read(pg_temp.s('buyer'), pg_temp.s('seller'), pg_temp.s('request3')) -> 'offer' ->> 'expired')::boolean
    AND (pg_temp.read(pg_temp.s('buyer'), pg_temp.s('seller'), pg_temp.s('request3')) -> 'offer' ->> 'status') = 'accepted',
    '6 the buyer''s read marks the accepted offer expired');
SELECT pg_temp.check((SELECT count(*) FROM finance.orders) = current_setting('probe.orders')::bigint
    AND NOT EXISTS (SELECT 1 FROM projects.projects WHERE source_blueprint_id = pg_temp.s('oneoff')
                     AND client_user_id = pg_temp.s('buyer') AND budget_amount_cents = 70000),
    '6 the refusals wrote no order and no engagement');
DO $$
DECLARE
    v_out jsonb;
    v_req jsonb;
BEGIN
    v_out := pg_temp.door(pg_temp.s('buyer'), format('marketplace.withdraw_quote_request(%L::uuid)', pg_temp.s('request3')));
    PERFORM pg_temp.check(v_out ->> 'status' = 'withdrawn'
        AND (SELECT removed_at IS NOT NULL FROM finance.basket_items WHERE id = pg_temp.s('line3')),
        '6 the buyer withdraws the lapsed request and its basket line goes with it');
    v_req := pg_temp.door(pg_temp.s('buyer'), format(
        'marketplace.request_quote(%L::uuid, %L)', pg_temp.s('oneoff'), 'Asking again'));
    PERFORM pg_temp.check(v_req ->> 'status' = 'sent', '6 and may ask again');
END $$;
-- #endregion

-- #region 7. Only the buyer's own offer, only in its currency
DO $$
DECLARE
    v_req jsonb;
    v_o4 jsonb;
    v_acc jsonb;
    v_line uuid;
BEGIN
    v_req := pg_temp.door(pg_temp.s('buyer'), format(
        'marketplace.request_quote(%L::uuid, %L)', pg_temp.s('pipe'), 'One bespoke brand sprint'));
    v_o4 := pg_temp.door(pg_temp.s('pipe_seller'), pg_temp.offer((v_req ->> 'id')::uuid, 64000, 7));
    v_acc := pg_temp.door(pg_temp.s('buyer'), format('marketplace.accept_quote_offer(%L::uuid)', v_o4 ->> 'id'));
    -- The buyer sets the line aside, so the one-live-line index lets a stranger write one naming it.
    UPDATE finance.basket_items SET removed_at = now() WHERE id = (v_acc ->> 'basket_item_id')::uuid;
    PERFORM pg_temp.act(pg_temp.s('stranger'));
    v_line := pg_temp.forged_line(pg_temp.s('stranger'), pg_temp.s('pipe'), (v_o4 ->> 'id')::uuid);
    PERFORM pg_temp.act(NULL);
    PERFORM set_config('probe.o4', v_o4 ->> 'id', true);
    PERFORM set_config('probe.stranger_line', v_line::text, true);
END $$;
SELECT pg_temp.refused(pg_temp.s('stranger'),
    'SELECT ' || pg_temp.pay_sql(pg_temp.s('stranger_line'), 64000, 'probe-ck7-stranger'),
    'PC409', 'no longer on offer', '7 a stranger''s line naming the buyer''s offer refuses');
DO $$
DECLARE
    v_acc jsonb;
BEGIN
    UPDATE finance.basket_items SET removed_at = now() WHERE id = pg_temp.s('stranger_line');
    v_acc := pg_temp.door(pg_temp.s('buyer'), format('marketplace.accept_quote_offer(%L::uuid)', pg_temp.s('o4')));
    PERFORM set_config('probe.line4', v_acc ->> 'basket_item_id', true);
END $$;
SELECT pg_temp.refused(pg_temp.s('buyer'),
    'SELECT ' || pg_temp.pay_sql(pg_temp.s('line4'), 64000, 'probe-ck7-eur', 'EUR'),
    'PC409', 'priced in USD', '7 the offer refuses another currency');
-- #endregion

-- #region 8. A quote on a Pipeline is bought as a one-milestone One-Off (#458 (a))
DO $$
DECLARE
    v_b0 bigint := pg_temp.balance(pg_temp.s('buyer'));
    v_out jsonb;
    v_ol record;
BEGIN
    v_out := pg_temp.door(pg_temp.s('buyer'), pg_temp.pay_sql(pg_temp.s('line4'), 64000, 'probe-ck7-pipe'));
    SELECT * INTO v_ol FROM finance.order_lines WHERE order_id = (v_out ->> 'order_id')::uuid;
    PERFORM pg_temp.check(v_ol.line_total_minor = 64000
        AND EXISTS (SELECT 1 FROM finance.escrows e WHERE e.id = v_ol.escrow_id AND e.amount_cents = 64000 AND e.status = 'held')
        AND EXISTS (SELECT 1 FROM projects.projects p
                     WHERE p.id = v_ol.project_id AND p.format = 'one_off' AND p.structure_variation = 'one_off'
                       AND p.owner_user_id = pg_temp.s('pipe_seller') AND p.client_user_id = pg_temp.s('buyer'))
        AND (SELECT count(*) FROM projects.project_stages WHERE project_id = v_ol.project_id) = 1
        AND pg_temp.balance(pg_temp.s('buyer')) = v_b0 - 64000,
        '8 a Pipeline''s quote is paid at 64000 into a one-milestone One-Off engagement');
END $$;
-- #endregion

-- #region 9. The run conserves money
SELECT pg_temp.check(
    COALESCE((SELECT ci.imbalance_minor FROM finance.v_conservation_identity ci WHERE ci.currency = 'USD'), 0)
        = current_setting('probe.imbalance0')::bigint,
    '9 the conservation identity''s USD imbalance is unchanged by two paid offers and every refusal');
-- #endregion

ROLLBACK;
