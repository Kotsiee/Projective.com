-- =============================================================================================
-- Probe: a Session or Group Session priced per hour, with sittings of their own length (SC10).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/session_hourly.sql
--
-- The rule (the SC10 ruling): a per-hour sitting costs ⌊rate × minutes ÷ 60⌋ minor units, floored per
-- sitting; a block is the sum of its sittings and holds one escrow per sitting at that sitting's price;
-- a per-hour Group Session seat is the sum over the listing's sittings, one escrow per seat bought; a
-- sitting's length is its plan entry's `durationMinutes`, else the listing's `session_minutes`; and only a
-- per-hour listing may vary its lengths. Checked:
--   1. projects.fn_sitting_price: 90 min at 6000/h is 9000; 25 min at 7001/h floors to 2917; a per-session
--      price ignores the length.
--   2. By wallet: a 90-minute 1-1 at £60/hour holds 9000 and sits 90 minutes; a block of 90 · 25 · 60
--      minutes at 7001/h holds 10501 · 2917 · 7001 (20419) on sittings of those lengths; two seats of a
--      90 + 60-minute cohort at 3000/h hold 15000. A unit priced per session is refused (PC409).
--   3. By card: the same three lines settled by finance.settle_card_payment replay to the same holds.
--   4. Regression: the same listings priced per session hold exactly what they did before SC10:
--      6000, 7001 × 3 on 60-minute sittings, and 3000 × 2 seats.
--   5. The listing: varying lengths on a per-session listing are refused by the table and by
--      catalogue.save_listing (22023); a length off the 15–600, five-minute grid is refused (22023);
--      save_listing maps `pricingUnit` and `durationMinutes` through.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region 0. Helpers
CREATE TEMP TABLE probe_ids (k text PRIMARY KEY, id uuid, n bigint, t text);

CREATE FUNCTION pg_temp.id(p_key text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM probe_ids WHERE k = p_key;
$$;

CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Act as p_uid in a fresh request (NULL: the webhook), with the spend gate's carrier cleared.
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('finance.spend_cover', '', true),
           pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

-- A 1-1 or block line in the buyer's basket, at p_at, with p_later as the block's chosen later starts.
CREATE FUNCTION pg_temp.session_line(p_kind text, p_item uuid, p_at timestamptz, p_later timestamptz[])
RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (pg_temp.id('basket'), p_kind::finance.purchasable_item_kind, p_item, 'Probe ' || p_kind, 1, 'USD', p_at, 'UTC',
            CASE WHEN p_later IS NULL THEN '{}'::jsonb
                 ELSE pg_catalog.jsonb_build_object('laterStarts', pg_catalog.to_jsonb(p_later)) END)
    RETURNING id;
$$;

-- Two seats on p_cohort, held as the buyer, and the seat line naming the hold.
CREATE FUNCTION pg_temp.seat_line(p_cohort uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_hold text;
    v_line uuid;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('buyer'));
    v_hold := projects.reserve_seat(p_cohort, 2) ->> 'hold_id';
    PERFORM pg_temp.act(NULL);
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      seats, metadata)
    VALUES (pg_temp.id('basket'), 'course_group_session', pg_temp.id('group'), 'Probe seat', 1, 'USD',
            now() + interval '45 days', 2, pg_catalog.jsonb_build_object('holdId', v_hold, 'bookingFormat', 'cohort'))
    RETURNING id INTO v_line;
    RETURN v_line;
END $$;

-- Pay for p_lines from the buyer's wallet at p_units; the total.
CREATE FUNCTION pg_temp.pay_wallet(p_lines uuid[], p_units jsonb, p_key text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_total bigint := (SELECT sum(v::bigint) FROM pg_catalog.jsonb_each_text(p_units) AS u (k, v));
BEGIN
    PERFORM pg_temp.act(pg_temp.id('buyer'));
    PERFORM finance.place_wallet_order(pg_temp.id('basket'), p_lines, 'USD', p_units, NULL, p_key, v_total);
    PERFORM pg_temp.act(NULL);
    RETURN v_total;
END $$;

-- Pay for p_lines by card: a top-up of the total carrying the checkout, settled by the webhook, which
-- replays place_wallet_order. The order's refusal, if the replay refused it.
CREATE FUNCTION pg_temp.pay_card(p_lines uuid[], p_units jsonb, p_key text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_total bigint := (SELECT sum(v::bigint) FROM pg_catalog.jsonb_each_text(p_units) AS u (k, v));
    v_pay jsonb;
    v_p finance.inbound_payments;
BEGIN
    PERFORM pg_temp.act(pg_temp.id('buyer'));
    v_pay := finance.begin_card_payment('wallet_topup', pg_temp.id('wallet'), NULL, NULL, v_total, 'USD', p_key);
    PERFORM finance.attach_checkout_order((v_pay ->> 'id')::uuid, pg_catalog.jsonb_build_object(
        'basket_id', pg_temp.id('basket'), 'item_ids', pg_catalog.to_jsonb(p_lines), 'currency', 'USD',
        'units', p_units, 'order_key', p_key || '-order'));
    PERFORM pg_temp.act(NULL);
    UPDATE finance.inbound_payments
       SET provider_ref = 'pi_probe_sc10_' || pg_catalog.replace(v_pay ->> 'id', '-', ''), status = 'processing'
     WHERE id = (v_pay ->> 'id')::uuid
    RETURNING * INTO v_p;
    PERFORM finance.settle_card_payment('evt_probe_sc10_' || pg_catalog.replace(v_pay ->> 'id', '-', ''),
        v_p.provider_ref, v_p.amount_cents, v_p.currency, false, v_p.id);
    SELECT * INTO v_p FROM finance.inbound_payments WHERE id = v_p.id;
    RETURN CASE WHEN v_p.order_id IS NULL THEN COALESCE(v_p.order_error, 'no order') END;
END $$;

-- What a paid line holds in escrow, sitting by sitting (a seat: its one hold).
CREATE FUNCTION pg_temp.held(p_item uuid) RETURNS bigint[] LANGUAGE sql AS $$
    SELECT pg_catalog.array_agg(e.amount_cents ORDER BY se.start_time NULLS FIRST, e.id)
      FROM finance.order_lines ol
      JOIN projects.cohort_memberships cm ON cm.order_line_id = ol.id
      JOIN finance.escrows e ON e.cohort_membership_id = cm.id AND e.status = 'held'
      LEFT JOIN projects.session_events se ON se.id = e.session_event_id
     WHERE ol.basket_item_id = p_item;
$$;

-- How long each booked sitting of a 1-1 or block line runs, in minutes.
CREATE FUNCTION pg_temp.lengths(p_item uuid) RETURNS integer[] LANGUAGE sql AS $$
    SELECT pg_catalog.array_agg((extract(epoch FROM se.end_time - se.start_time) / 60)::integer ORDER BY se.start_time)
      FROM finance.order_lines ol
      JOIN projects.cohort_memberships cm ON cm.order_line_id = ol.id
      JOIN projects.session_events se ON se.cohort_id = cm.cohort_id
     WHERE ol.basket_item_id = p_item;
$$;

CREATE FUNCTION pg_temp.gross(p_item uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT line_total_minor FROM finance.order_lines WHERE basket_item_id = p_item;
$$;
-- #endregion

-- #region 0b. Fixtures (as postgres)
DO $$
DECLARE
    v_one uuid; v_block uuid; v_group uuid; v_project uuid; v_stage uuid; v_cohort uuid;
    v_buyer uuid; v_wtype text; v_wallet uuid; v_basket uuid;
BEGIN
    SELECT id INTO v_one FROM marketplace.service_blueprints
     WHERE delivery_model = 'session' AND is_published AND COALESCE(session_count, 1) = 1 ORDER BY id LIMIT 1;
    SELECT id INTO v_block FROM marketplace.service_blueprints
     WHERE delivery_model = 'session' AND is_published AND session_count > 1 AND id <> v_one ORDER BY id LIMIT 1;
    SELECT id INTO v_group FROM marketplace.service_blueprints
     WHERE delivery_model = 'group_session' AND is_published ORDER BY id LIMIT 1;
    IF v_one IS NULL OR v_block IS NULL OR v_group IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: need a published 1-1, a block and a group-session listing (deno task db:reset)';
    END IF;

    UPDATE marketplace.service_blueprints
       SET session_price_cents = 6000, pricing_unit = 'per_hour', session_minutes = 90, session_count = 1,
           session_rolling = false, session_plan = '[]'::jsonb, currency = 'USD', intake_fields = '[]'::jsonb
     WHERE id = v_one;
    UPDATE marketplace.service_blueprints
       SET session_price_cents = 7001, pricing_unit = 'per_hour', session_minutes = 60, session_count = 3,
           session_rolling = false, currency = 'USD', intake_fields = '[]'::jsonb,
           session_plan = '[{"title": "Intro", "durationMinutes": 90}, {"title": "Short", "durationMinutes": 25},
                            {"title": "Close"}]'::jsonb
     WHERE id = v_block;
    UPDATE marketplace.service_blueprints
       SET session_price_cents = 3000, pricing_unit = 'per_hour', session_minutes = 60, session_count = 2,
           currency = 'USD', intake_fields = '[]'::jsonb,
           session_plan = '[{"title": "Long", "durationMinutes": 90}, {"title": "Standard"}]'::jsonb
     WHERE id = v_group;

    UPDATE scheduling.availability_presets
       SET compiled_from = CURRENT_DATE - 2, compiled_through = CURRENT_DATE + 400
     WHERE id IN (scheduling.fn_preset_for_blueprint(v_one), scheduling.fn_preset_for_blueprint(v_block));
    INSERT INTO scheduling.availability_occurrences (preset_id, kind, starts_at, ends_at)
    SELECT pid, 'working_hours'::scheduling.availability_kind, now() - interval '2 days', now() + interval '400 days'
      FROM (SELECT scheduling.fn_preset_for_blueprint(v_one) AS pid
            UNION SELECT scheduling.fn_preset_for_blueprint(v_block)) p
     WHERE pid IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO projects.projects (owner_user_id, owner_team_id, title, format, session_kind, status, visibility,
                                   publish_visibility, currency, source_blueprint_id)
    SELECT sb.freelancer_profile_id, sb.owner_team_id, 'Probe hourly group', 'session', 'group', 'active',
           'unlisted', 'unlisted', 'USD', sb.id
      FROM marketplace.service_blueprints sb WHERE sb.id = v_group
    RETURNING id INTO v_project;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Sessions', 0)
    RETURNING id INTO v_stage;
    FOR i IN 1 .. 3 LOOP
        INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
        VALUES (v_project, v_stage, 'Probe cohort ' || i, 10, 'enrolling') RETURNING id INTO v_cohort;
        INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
        VALUES (v_cohort, 'Probe sitting', now() + interval '45 days', now() + interval '45 days 90 minutes');
        INSERT INTO probe_ids (k, id) VALUES ('cohort' || i, v_cohort);
    END LOOP;

    SELECT w.owner_id, w.owner_type, w.id INTO v_buyer, v_wtype, v_wallet
      FROM finance.wallets w
     WHERE w.currency = 'USD' AND w.owner_type IN ('user', 'freelancer')
       AND NOT org.fn_is_minor(w.owner_id)
       AND w.owner_id NOT IN (SELECT sb.freelancer_profile_id FROM marketplace.service_blueprints sb
                               WHERE sb.id IN (v_one, v_block, v_group))
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm
                        JOIN marketplace.service_blueprints sb ON sb.owner_team_id = tm.team_id
                       WHERE sb.id IN (v_one, v_block, v_group) AND tm.user_id = w.owner_id AND tm.status = 'active')
     ORDER BY w.balance_cents DESC LIMIT 1;
    IF v_buyer IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no fixture: need an adult buyer outside the sellers'' teams with a USD wallet';
    END IF;
    -- Enough for the wallet legs (44419 + 33003), whatever the seed left in the wallet.
    PERFORM finance.fn_wallet_credit(v_buyer, v_wtype, 'USD', 80000, 'topup', 'probe', NULL);
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES (v_wtype, v_buyer, 'Probe hourly basket')
    RETURNING id INTO v_basket;

    INSERT INTO probe_ids (k, id) VALUES ('one', v_one), ('block', v_block), ('group', v_group),
        ('buyer', v_buyer), ('wallet', v_wallet), ('basket', v_basket);
    INSERT INTO probe_ids (k, t) VALUES ('t0', (date_trunc('hour', now()) + interval '20 days 4 hours 5 minutes')::text);
END $$;
-- #endregion

-- #region 1. One price per sitting
DO $$
BEGIN
    PERFORM pg_temp.ok(projects.fn_sitting_price(6000, 'per_hour', 90) = 9000, '1 90 minutes at 6000/h is 9000');
    PERFORM pg_temp.ok(projects.fn_sitting_price(7001, 'per_hour', 25) = 2917, '1 25 minutes at 7001/h floors to 2917');
    PERFORM pg_temp.ok(projects.fn_sitting_price(7001, 'per_session', 25) = 7001, '1 a per-session price ignores the length');
END $$;
-- #endregion

-- #region 2. By wallet
DO $$
DECLARE
    t0 timestamptz := (SELECT t FROM probe_ids WHERE k = 't0')::timestamptz;
    v_one uuid := pg_temp.session_line('service_session', pg_temp.id('one'), t0, NULL);
    v_block uuid := pg_temp.session_line('set_session', pg_temp.id('block'), t0 + interval '1 day',
        ARRAY[t0 + interval '2 days', t0 + interval '3 days']);
    v_seat uuid := pg_temp.seat_line(pg_temp.id('cohort1'));
    v_stale uuid := pg_temp.session_line('service_session', pg_temp.id('one'), t0 + interval '9 days', NULL);
BEGIN
    BEGIN
        PERFORM pg_temp.pay_wallet(ARRAY[v_stale], jsonb_build_object(v_stale, 6000), 'probe-sc10-stale');
        RAISE EXCEPTION 'PROBE FAIL: 2 a 90-minute sitting priced at the per-session 6000 was booked';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'ok  2 a unit priced per session is refused (PC409)';
    END;
    PERFORM pg_temp.pay_wallet(ARRAY[v_one, v_block, v_seat],
        jsonb_build_object(v_one, 9000, v_block, 20419, v_seat, 15000), 'probe-sc10-wallet');

    PERFORM pg_temp.ok(pg_temp.held(v_one) = ARRAY[9000::bigint], '2 a 90-minute sitting at £60/hour holds 9000');
    PERFORM pg_temp.ok(pg_temp.lengths(v_one) = ARRAY[90], '2 ... and sits 90 minutes');
    PERFORM pg_temp.ok(pg_temp.held(v_block) = ARRAY[10501, 2917, 7001]::bigint[],
        format('2 the block holds each sitting at its own price (%s)', pg_temp.held(v_block)));
    PERFORM pg_temp.ok(pg_temp.lengths(v_block) = ARRAY[90, 25, 60],
        format('2 the block''s sittings keep their lengths (%s)', pg_temp.lengths(v_block)));
    PERFORM pg_temp.ok(pg_temp.gross(v_block) = 20419, '2 the block''s line is the sum of its sittings');
    PERFORM pg_temp.ok((SELECT duration_minutes FROM finance.order_lines WHERE basket_item_id = v_block) = 90,
        '2 the block''s receipt line runs as long as its first sitting');
    PERFORM pg_temp.ok(pg_temp.held(v_seat) = ARRAY[15000::bigint],
        format('2 two seats of a 90 + 60-minute cohort at 3000/h hold 15000 (%s)', pg_temp.held(v_seat)));
END $$;
-- #endregion

-- #region 3. By card
DO $$
DECLARE
    t0 timestamptz := (SELECT t FROM probe_ids WHERE k = 't0')::timestamptz + interval '60 days';
    v_one uuid := pg_temp.session_line('service_session', pg_temp.id('one'), t0, NULL);
    v_block uuid := pg_temp.session_line('set_session', pg_temp.id('block'), t0 + interval '1 day',
        ARRAY[t0 + interval '2 days', t0 + interval '3 days']);
    v_seat uuid := pg_temp.seat_line(pg_temp.id('cohort2'));
    v_refusal text;
BEGIN
    v_refusal := pg_temp.pay_card(ARRAY[v_one, v_block, v_seat],
        jsonb_build_object(v_one, 9000, v_block, 20419, v_seat, 15000), 'probe-sc10-card');
    PERFORM pg_temp.ok(v_refusal IS NULL, format('3 the card replay placed the order (refusal: %s)', v_refusal));
    PERFORM pg_temp.ok(pg_temp.held(v_one) = ARRAY[9000::bigint], '3 by card, the 90-minute sitting holds 9000');
    PERFORM pg_temp.ok(pg_temp.held(v_block) = ARRAY[10501, 2917, 7001]::bigint[], '3 by card, the block holds 10501 · 2917 · 7001');
    PERFORM pg_temp.ok(pg_temp.lengths(v_block) = ARRAY[90, 25, 60], '3 by card, the block''s sittings keep their lengths');
    PERFORM pg_temp.ok(pg_temp.held(v_seat) = ARRAY[15000::bigint], '3 by card, the two seats hold 15000');
END $$;
-- #endregion

-- #region 4. Regression: per session, as before SC10
DO $$
DECLARE
    t0 timestamptz := (SELECT t FROM probe_ids WHERE k = 't0')::timestamptz + interval '120 days';
    v_one uuid;
    v_block uuid;
    v_seat uuid;
BEGIN
    UPDATE marketplace.service_blueprints SET pricing_unit = 'per_session', session_minutes = 60
     WHERE id = pg_temp.id('one');
    UPDATE marketplace.service_blueprints SET pricing_unit = 'per_session',
           session_plan = '[{"title": "Intro"}, {"title": "Short"}, {"title": "Close"}]'::jsonb
     WHERE id = pg_temp.id('block');
    UPDATE marketplace.service_blueprints SET pricing_unit = 'per_session',
           session_plan = '[{"title": "Long"}, {"title": "Standard"}]'::jsonb
     WHERE id = pg_temp.id('group');
    v_one := pg_temp.session_line('service_session', pg_temp.id('one'), t0, NULL);
    v_block := pg_temp.session_line('set_session', pg_temp.id('block'), t0 + interval '1 day',
        ARRAY[t0 + interval '2 days', t0 + interval '3 days']);
    v_seat := pg_temp.seat_line(pg_temp.id('cohort3'));
    PERFORM pg_temp.pay_wallet(ARRAY[v_one, v_block, v_seat],
        jsonb_build_object(v_one, 6000, v_block, 21003, v_seat, 6000), 'probe-sc10-per-session');
    PERFORM pg_temp.ok(pg_temp.held(v_one) = ARRAY[6000::bigint], '4 per session, a 1-1 holds its price');
    PERFORM pg_temp.ok(pg_temp.held(v_block) = ARRAY[7001, 7001, 7001]::bigint[], '4 per session, a block holds its price per sitting');
    PERFORM pg_temp.ok(pg_temp.lengths(v_block) = ARRAY[60, 60, 60], '4 per session, every sitting runs the listing''s length');
    PERFORM pg_temp.ok(pg_temp.held(v_seat) = ARRAY[6000::bigint], '4 per session, a seat is the price × seats for the whole cohort');
END $$;
-- #endregion

-- #region 5. The listing's rules
DO $$
DECLARE
    v_listing uuid := (SELECT l.id FROM catalogue.listings l WHERE l.service_blueprint_id = pg_temp.id('block'));
    -- save_listing edits as the seller who created the listing.
    v_owner uuid := (SELECT l.owner_user_id FROM catalogue.listings l WHERE l.service_blueprint_id = pg_temp.id('block'));
    v_bp marketplace.service_blueprints;
BEGIN
    BEGIN
        UPDATE marketplace.service_blueprints SET session_plan = '[{"durationMinutes": 90}]'::jsonb
         WHERE id = pg_temp.id('block');
        RAISE EXCEPTION 'PROBE FAIL: 5 a per-session listing stored varying lengths';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'ok  5 the table refuses varying lengths on a per-session listing';
    END;

    PERFORM pg_temp.act(v_owner);
    SET LOCAL ROLE authenticated;
    BEGIN
        PERFORM catalogue.save_listing(v_listing, '{"offer": {"archetype": "session",
            "plan": [{"title": "Intro", "durationMinutes": 90}]}}'::jsonb);
        RAISE EXCEPTION 'PROBE FAIL: 5 save_listing stored varying lengths on a per-session listing';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'ok  5 save_listing refuses varying lengths on a per-session listing (%)', SQLERRM;
    END;
    BEGIN
        PERFORM catalogue.save_listing(v_listing, '{"offer": {"archetype": "session", "pricingUnit": "per_hour",
            "plan": [{"title": "Intro", "durationMinutes": 92}]}}'::jsonb);
        RAISE EXCEPTION 'PROBE FAIL: 5 save_listing stored a 92-minute sitting';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'ok  5 save_listing refuses a length off the five-minute grid (%)', SQLERRM;
    END;
    BEGIN
        PERFORM catalogue.save_listing(v_listing, '{"offer": {"archetype": "session", "pricingUnit": "per_minute"}}'::jsonb);
        RAISE EXCEPTION 'PROBE FAIL: 5 save_listing stored an unknown pricing unit';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'ok  5 save_listing refuses an unknown pricing unit (%)', SQLERRM;
    END;
    PERFORM catalogue.save_listing(v_listing, '{"offer": {"archetype": "session", "pricingUnit": "per_hour",
        "plan": [{"title": "Intro", "durationMinutes": 120}, {"title": "Short"}]}}'::jsonb);
    RESET ROLE;
    PERFORM pg_temp.act(NULL);
    SELECT * INTO v_bp FROM marketplace.service_blueprints WHERE id = pg_temp.id('block');
    PERFORM pg_temp.ok(v_bp.pricing_unit = 'per_hour' AND (v_bp.session_plan -> 0 ->> 'durationMinutes')::integer = 120,
        '5 save_listing maps pricingUnit and durationMinutes through');
END $$;
-- #endregion

ROLLBACK;
