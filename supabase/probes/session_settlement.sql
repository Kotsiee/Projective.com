-- =============================================================================================
-- Probe: session settlement beyond cohort seats (Decision #211).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/session_settlement.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. It drives the real
-- doors end to end — a 1-1 session and a six-session block paid for through finance.place_wallet_order
-- as the buyer — then moves the clock by rewriting sitting times (never by a fake p_now, so every
-- "has it started" test sees one consistent world) and checks:
--    1. a single session: one-seat cohort, ONE escrow tied to its sitting, wallet debited, calendar
--       mirror with both people on it, no handshake;
--    2. a block: six sittings a week apart, six per-sitting escrows, five handshakes due 72h out, both
--       people told;
--    3. the paid slot is refused to a second buyer (PS409); a past time and a stale price refuse (PC409);
--    4. a handshake that carries moves the SITTING with its calendar entry and confirms it;
--    5. the handshake sweep reminds the provider once, 24h before the deadline, then closes every
--       handshake past its deadline and keeps the pencilled-in time;
--    6. negative consent per sitting: a sitting 25h past its end releases ITS escrow only (to the team,
--       through the pending window); an open dispute holds one; a provider no-show 100h old refunds;
--    7. a client cancel across the notice line is `partial` — the near sitting forfeits, the far ones
--       refund, started ones are left to settle — and the sittings leave the calendar;
--    8. a provider cancel refunds a sitting inside the notice window in full, and tells the client;
--    9. a cohort seat (session_event_id NULL) still settles after the cohort's LAST sitting;
--   10. grants: nobody but the definers reaches fn_book_session_slot.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_one uuid; v_block uuid; v_buyer uuid; v_wtype text; v_bal bigint; v_basket uuid;
    v_li1 uuid; v_li2 uuid; v_li3 uuid; v_li4 uuid; v_li5 uuid;
    v_t1 timestamptz := date_trunc('hour', now()) + interval '10 days 3 hours 17 minutes';
    v_t2 timestamptz := date_trunc('hour', now()) + interval '2 days 3 hours 17 minutes';
BEGIN
    SELECT id INTO v_one FROM marketplace.service_blueprints
     WHERE delivery_model = 'session' AND is_published AND COALESCE(session_count, 1) = 1 ORDER BY id LIMIT 1;
    SELECT id INTO v_block FROM marketplace.service_blueprints
     WHERE delivery_model = 'session' AND is_published AND session_count > 1 ORDER BY id LIMIT 1;
    IF v_one IS NULL OR v_block IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published single-session and a set-session listing (deno task db:reset)';
    END IF;
    -- Pinned so the arithmetic below is legible whatever the seed says.
    UPDATE marketplace.service_blueprints SET session_price_cents = 18000, session_minutes = 60, currency = 'USD'
     WHERE id = v_one;
    UPDATE marketplace.service_blueprints SET session_price_cents = 16000, session_minutes = 45, session_count = 6,
           currency = 'USD'
     WHERE id = v_block;
    -- The first sitting must fall inside the provider's hours (Decision #217 (d)). The times below are
    -- arbitrary, so each listing's preset is compiled as open around the clock for the probe's window.
    UPDATE scheduling.availability_presets
       SET compiled_from = CURRENT_DATE - 2, compiled_through = CURRENT_DATE + 400
     WHERE id IN (scheduling.fn_preset_for_blueprint(v_one), scheduling.fn_preset_for_blueprint(v_block));
    INSERT INTO scheduling.availability_occurrences (preset_id, kind, starts_at, ends_at)
    SELECT DISTINCT pid, 'working_hours'::scheduling.availability_kind, now() - interval '2 days', now() + interval '400 days'
      FROM unnest(ARRAY[scheduling.fn_preset_for_blueprint(v_one), scheduling.fn_preset_for_blueprint(v_block)]) AS pid
     WHERE pid IS NOT NULL
    ON CONFLICT DO NOTHING;

    SELECT w.owner_id, w.owner_type, w.balance_cents INTO v_buyer, v_wtype, v_bal
      FROM finance.wallets w
     WHERE w.currency = 'USD' AND w.owner_type IN ('user', 'freelancer')
       AND NOT org.fn_is_minor(w.owner_id)
       AND NOT projects.fn_is_session_host(gen_random_uuid(), w.owner_id)
       AND w.owner_id NOT IN (SELECT sb.freelancer_profile_id FROM marketplace.service_blueprints sb WHERE sb.id IN (v_one, v_block))
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm
                        JOIN marketplace.service_blueprints sb ON sb.owner_team_id = tm.team_id
                       WHERE sb.id IN (v_one, v_block) AND tm.user_id = w.owner_id)
     ORDER BY w.balance_cents DESC LIMIT 1;
    IF v_buyer IS NULL OR v_bal < 200000 THEN
        RAISE EXCEPTION 'FAIL no fixture: need an adult buyer outside the sellers'' team with $2,000 in a USD wallet';
    END IF;

    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES (v_wtype, v_buyer, 'Probe basket')
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at, timezone)
    VALUES (v_basket, 'service_session', v_one, 'Probe single', 18000, 'USD', v_t1, 'UTC') RETURNING id INTO v_li1;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at, timezone)
    VALUES (v_basket, 'set_session', v_block, 'Probe block', 96000, 'USD', v_t2, 'UTC') RETURNING id INTO v_li2;
    -- The same slot as the single session, for a second attempt (3).
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at, timezone)
    VALUES (v_basket, 'service_session', v_one, 'Probe clash', 18000, 'USD', v_t1, 'UTC') RETURNING id INTO v_li3;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at, timezone)
    VALUES (v_basket, 'service_session', v_one, 'Probe past', 18000, 'USD', now() - interval '1 hour', 'UTC') RETURNING id INTO v_li4;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at, timezone)
    VALUES (v_basket, 'service_session', v_one, 'Probe price', 18000, 'USD', v_t1 + interval '1 day', 'UTC') RETURNING id INTO v_li5;

    PERFORM set_config('probe.one', v_one::text, true);
    PERFORM set_config('probe.block', v_block::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.wtype', v_wtype, true);
    PERFORM set_config('probe.bal0', v_bal::text, true);
    PERFORM set_config('probe.basket', v_basket::text, true);
    PERFORM set_config('probe.li1', v_li1::text, true);
    PERFORM set_config('probe.li2', v_li2::text, true);
    PERFORM set_config('probe.li3', v_li3::text, true);
    PERFORM set_config('probe.li4', v_li4::text, true);
    PERFORM set_config('probe.li5', v_li5::text, true);
    PERFORM set_config('probe.t1', v_t1::text, true);
    PERFORM set_config('probe.t2', v_t2::text, true);
END $$;
-- #endregion

-- #region 1–2. Pay for a single session and a block, as the buyer
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
SELECT set_config('probe.order1', finance.place_wallet_order(
    current_setting('probe.basket')::uuid, ARRAY[current_setting('probe.li1')::uuid], 'USD',
    jsonb_build_object(current_setting('probe.li1'), 18000), NULL, 'probe-single-' || current_setting('probe.li1')) ->> 'order_id', true);
SELECT set_config('probe.order2', finance.place_wallet_order(
    current_setting('probe.basket')::uuid, ARRAY[current_setting('probe.li2')::uuid], 'USD',
    jsonb_build_object(current_setting('probe.li2'), 96000), NULL, 'probe-block-' || current_setting('probe.li2')) ->> 'order_id', true);

-- 3. Refusals, each in its own subtransaction so the order rolls back and nothing is charged.
DO $$
DECLARE
    v_state text;
BEGIN
    BEGIN
        PERFORM finance.place_wallet_order(current_setting('probe.basket')::uuid, ARRAY[current_setting('probe.li3')::uuid],
            'USD', jsonb_build_object(current_setting('probe.li3'), 18000), NULL, 'probe-clash-' || current_setting('probe.li3'));
        RAISE EXCEPTION 'FAIL 3: a second buyer was sold a paid slot';
    EXCEPTION WHEN SQLSTATE 'PS409' THEN RAISE NOTICE 'PASS 3: the paid slot is refused to a second booking (PS409)';
    END;
    BEGIN
        PERFORM finance.place_wallet_order(current_setting('probe.basket')::uuid, ARRAY[current_setting('probe.li4')::uuid],
            'USD', jsonb_build_object(current_setting('probe.li4'), 18000), NULL, 'probe-past-' || current_setting('probe.li4'));
        RAISE EXCEPTION 'FAIL 3: a time in the past was booked';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN RAISE NOTICE 'PASS 3: a time that has passed is refused (PC409)';
    END;
    BEGIN
        PERFORM finance.place_wallet_order(current_setting('probe.basket')::uuid, ARRAY[current_setting('probe.li5')::uuid],
            'USD', jsonb_build_object(current_setting('probe.li5'), 17000), NULL, 'probe-price-' || current_setting('probe.li5'));
        RAISE EXCEPTION 'FAIL 3: a stale price was charged';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN RAISE NOTICE 'PASS 3: a price the buyer did not see is refused (PC409)';
    END;
    -- The doors stay closed to a client.
    BEGIN
        PERFORM projects.fn_book_session_slot(current_setting('probe.one')::uuid, auth.uid(), 'user', auth.uid(),
            1, 1, 'USD', now() + interval '30 days', NULL);
        RAISE EXCEPTION 'FAIL 10: a client called fn_book_session_slot';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 10: fn_book_session_slot is not reachable by a client';
    END;
    BEGIN
        PERFORM projects.fn_lapse_session_handshakes(now());
        RAISE EXCEPTION 'FAIL 10: a client ran the handshake sweep';
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS 10: the handshake sweep is not reachable by a client';
    END;
END $$;
RESET ROLE;
-- #endregion

-- #region 1–2. What the two payments built
DO $$
DECLARE
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_bal bigint;
    v_c1 uuid; v_c2 uuid; v_m1 uuid; v_m2 uuid; v_n integer; v_ok boolean;
    rec record;
BEGIN
    SELECT balance_cents INTO v_bal FROM finance.wallets
     WHERE owner_id = v_buyer AND owner_type = current_setting('probe.wtype') AND currency = 'USD';
    IF v_bal <> current_setting('probe.bal0')::bigint - 18000 - 96000 THEN
        RAISE EXCEPTION 'FAIL 1-2: wallet % expected %', v_bal, current_setting('probe.bal0')::bigint - 114000;
    END IF;
    RAISE NOTICE 'PASS 1-2: the wallet paid 180.00 + 6 × 160.00 and nothing else';

    -- 1. The single session.
    SELECT cm.id, cm.cohort_id INTO v_m1, v_c1
      FROM finance.order_lines ol JOIN projects.cohort_memberships cm ON cm.order_line_id = ol.id
     WHERE ol.order_id = current_setting('probe.order1')::uuid;
    IF v_m1 IS NULL THEN RAISE EXCEPTION 'FAIL 1: no seat for the single-session order'; END IF;
    SELECT (c.max_seats = 1 AND c.status = 'active' AND p.format = 'session' AND p.session_kind = 'normal'
            AND p.source_blueprint_id = current_setting('probe.one')::uuid
            AND (SELECT stage_id FROM finance.order_lines WHERE order_id = current_setting('probe.order1')::uuid) = c.project_stage_id)
      INTO v_ok FROM projects.cohorts c JOIN projects.projects p ON p.id = c.project_id WHERE c.id = v_c1;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 1: the seat is not a one-seat cohort on the listing''s session engagement'; END IF;
    SELECT count(*) INTO v_n FROM finance.escrows e JOIN projects.session_events se ON se.id = e.session_event_id
     WHERE e.cohort_membership_id = v_m1 AND e.status = 'held' AND e.amount_cents = 18000
       AND se.start_time = current_setting('probe.t1')::timestamptz AND e.payee_type = 'team';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 1: expected one held 180.00 escrow on the picked sitting, got %', v_n; END IF;
    SELECT count(*) INTO v_n FROM scheduling.events ev
      JOIN projects.session_events se ON se.id = ev.source_session_event_id
     WHERE se.cohort_id = v_c1 AND ev.status = 'confirmed' AND ev.starts_at = se.start_time
       AND (SELECT count(*) FROM scheduling.event_attendees a WHERE a.event_id = ev.id AND a.response = 'accepted') = 2
       AND NOT EXISTS (SELECT 1 FROM scheduling.event_reschedules r WHERE r.event_id = ev.id);
    IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 1: the sitting is not on the calendar with both people and no handshake'; END IF;
    RAISE NOTICE 'PASS 1: a single session is a one-seat cohort with one per-sitting escrow and a confirmed calendar entry';

    -- 2. The block.
    SELECT cm.id, cm.cohort_id INTO v_m2, v_c2
      FROM finance.order_lines ol JOIN projects.cohort_memberships cm ON cm.order_line_id = ol.id
     WHERE ol.order_id = current_setting('probe.order2')::uuid;
    SELECT count(*) INTO v_n FROM projects.session_events se
     WHERE se.cohort_id = v_c2
       AND se.start_time IN (SELECT current_setting('probe.t2')::timestamptz + make_interval(days => 7 * g)
                               FROM generate_series(0, 5) g)
       AND se.end_time = se.start_time + interval '45 minutes';
    IF v_n <> 6 THEN RAISE EXCEPTION 'FAIL 2: expected six 45-minute sittings a week apart, got %', v_n; END IF;
    SELECT count(DISTINCT e.session_event_id) INTO v_n FROM finance.escrows e
     WHERE e.cohort_membership_id = v_m2 AND e.status = 'held' AND e.amount_cents = 16000;
    IF v_n <> 6 THEN RAISE EXCEPTION 'FAIL 2: expected six per-sitting escrows of 160.00, got %', v_n; END IF;
    SELECT count(*) INTO v_n
      FROM scheduling.event_reschedules r
      JOIN scheduling.events ev ON ev.id = r.event_id
      JOIN projects.session_events se ON se.id = ev.source_session_event_id
     WHERE se.cohort_id = v_c2 AND r.round = 0 AND r.mode = 'counterparty' AND r.status = 'collecting'
       AND ev.status = 'tentative' AND se.start_time > current_setting('probe.t2')::timestamptz
       AND abs(extract(epoch FROM r.resolves_at - (now() + interval '72 hours'))) < 5;
    IF v_n <> 5 THEN RAISE EXCEPTION 'FAIL 2: expected five handshakes due in 72h on the provisional sittings, got %', v_n; END IF;
    IF EXISTS (SELECT 1 FROM comms.notifications n WHERE n.type = 'session.scheduling_reminder' AND n.entity_id = v_c2) THEN
        RAISE EXCEPTION 'FAIL 2: the reminder went out at payment';
    END IF;
    SELECT count(DISTINCT n.user_id) INTO v_n FROM comms.notifications n
     WHERE n.type = 'session.scheduling_requested' AND n.entity_id = v_c2;
    IF v_n <> 2 THEN RAISE EXCEPTION 'FAIL 2: expected the provider and the client told about the pencilled-in times, got %', v_n; END IF;
    RAISE NOTICE 'PASS 2: a block holds six per-sitting escrows and opens five 72h handshakes, and both people are told';

    PERFORM set_config('probe.c1', v_c1::text, true);
    PERFORM set_config('probe.m1', v_m1::text, true);
    PERFORM set_config('probe.c2', v_c2::text, true);
    PERFORM set_config('probe.m2', v_m2::text, true);
    FOR rec IN SELECT se.id, row_number() OVER (ORDER BY se.start_time) AS k
               FROM projects.session_events se WHERE se.cohort_id = v_c2 LOOP
        PERFORM set_config('probe.s' || rec.k, rec.id::text, true);
    END LOOP;
END $$;
-- #endregion

-- #region 4–5. Handshakes: one carries, the rest lapse
DO $$
DECLARE
    v_s2 uuid := current_setting('probe.s2')::uuid;
    v_ev uuid; v_round uuid; v_prop uuid; v_old timestamptz; v_new timestamptz; v_n integer; v_res jsonb;
BEGIN
    SELECT ev.id, r.id, ev.starts_at INTO v_ev, v_round, v_old
      FROM scheduling.events ev JOIN scheduling.event_reschedules r ON r.event_id = ev.id
     WHERE ev.source_session_event_id = v_s2;
    v_new := v_old + interval '1 day 2 hours';
    INSERT INTO scheduling.reschedule_proposals (reschedule_id, starts_at, ends_at, proposed_by_role, approved)
    VALUES (v_round, v_new, v_new + interval '45 minutes', 'host', true) RETURNING id INTO v_prop;
    PERFORM scheduling.close_reschedule_round(v_round, 'resolved', v_prop, NULL, 'probe', 'probe');

    IF (SELECT start_time FROM projects.session_events WHERE id = v_s2) <> v_new
       OR (SELECT end_time FROM projects.session_events WHERE id = v_s2) <> v_new + interval '45 minutes' THEN
        RAISE EXCEPTION 'FAIL 4: the sitting did not move with its calendar entry';
    END IF;
    IF (SELECT status FROM scheduling.events WHERE id = v_ev) <> 'confirmed'
       OR EXISTS (SELECT 1 FROM scheduling.event_attendees WHERE event_id = v_ev AND response = 'pending') THEN
        RAISE EXCEPTION 'FAIL 4: a carried handshake did not confirm the sitting';
    END IF;
    RAISE NOTICE 'PASS 4: a carried handshake moves the sitting itself and confirms it';

    v_res := projects.fn_lapse_session_handshakes(now() + interval '47 hours');
    IF (v_res ->> 'reminded')::integer <> 0 THEN RAISE EXCEPTION 'FAIL 5: reminded more than a day early (%)', v_res; END IF;
    v_res := projects.fn_lapse_session_handshakes(now() + interval '49 hours');
    IF (v_res ->> 'reminded')::integer <> 1 OR NOT EXISTS (
        SELECT 1 FROM comms.notifications n
          JOIN projects.cohorts c ON c.id = n.entity_id JOIN projects.projects p ON p.id = c.project_id
         WHERE n.type = 'session.scheduling_reminder' AND n.entity_id = current_setting('probe.c2')::uuid
           AND n.user_id = p.owner_user_id) THEN
        RAISE EXCEPTION 'FAIL 5: the provider was not reminded a day before the deadline (%)', v_res;
    END IF;
    IF (projects.fn_lapse_session_handshakes(now() + interval '50 hours') ->> 'reminded')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL 5: the reminder went out twice';
    END IF;
    RAISE NOTICE 'PASS 5: the provider is reminded once, a day before the deadline';

    v_res := projects.fn_lapse_session_handshakes(now() + interval '71 hours');
    IF (v_res ->> 'lapsed')::integer <> 0 THEN RAISE EXCEPTION 'FAIL 5: a handshake lapsed before its deadline'; END IF;
    v_res := projects.fn_lapse_session_handshakes(now() + interval '73 hours');
    IF (v_res ->> 'lapsed')::integer <> 4 THEN RAISE EXCEPTION 'FAIL 5: expected four handshakes lapsed, got %', v_res; END IF;
    -- Sittings 3–6 (indexed when they were booked) keep start = first + (k - 1) weeks.
    SELECT count(*) INTO v_n
      FROM generate_series(3, 6) k
      JOIN projects.session_events se ON se.id = current_setting('probe.s' || k)::uuid
      JOIN scheduling.events ev ON ev.source_session_event_id = se.id
      JOIN scheduling.event_reschedules r ON r.event_id = ev.id
     WHERE r.status = 'lapsed' AND ev.status = 'confirmed' AND se.start_time = ev.starts_at
       AND se.start_time = current_setting('probe.t2')::timestamptz + make_interval(days => 7 * (k - 1));
    IF v_n <> 4 THEN RAISE EXCEPTION 'FAIL 5: lapsed sittings did not keep their pencilled-in times (%)', v_n; END IF;
    IF (SELECT count(*) FROM comms.notifications WHERE type = 'session.scheduling_lapsed') < 8 THEN
        RAISE EXCEPTION 'FAIL 5: both people were not told about each kept time';
    END IF;
    IF (projects.fn_lapse_session_handshakes(now() + interval '73 hours') ->> 'lapsed')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL 5: the sweep is not idempotent';
    END IF;
    RAISE NOTICE 'PASS 5: the sweep lapses each handshake at its deadline and keeps the pencilled-in time';
END $$;
-- #endregion

-- #region 6. Negative consent, per sitting
DO $$
DECLARE
    v_m2 uuid := current_setting('probe.m2')::uuid;
    v_s1 uuid := current_setting('probe.s1')::uuid;
    v_s2 uuid := current_setting('probe.s2')::uuid;
    v_s3 uuid := current_setting('probe.s3')::uuid;
    v_e1 uuid; v_e2 uuid; v_e3 uuid; v_res jsonb; v_bal0 bigint; v_bal1 bigint;
    v_host uuid;
BEGIN
    SELECT id INTO v_e1 FROM finance.escrows WHERE session_event_id = v_s1;
    SELECT id INTO v_e2 FROM finance.escrows WHERE session_event_id = v_s2;
    SELECT id INTO v_e3 FROM finance.escrows WHERE session_event_id = v_s3;
    SELECT p.owner_user_id INTO v_host FROM projects.cohorts c JOIN projects.projects p ON p.id = c.project_id
     WHERE c.id = current_setting('probe.c2')::uuid;

    -- Sittings 1 and 2 ended 25h ago (2 under a no-show claim); sitting 3 ended 100h ago in a tracked room
    -- the client joined and the provider never did.
    UPDATE projects.session_events SET start_time = now() - interval '25 hours 45 minutes', end_time = now() - interval '25 hours'
     WHERE id IN (v_s1, v_s2);
    UPDATE projects.session_events SET start_time = now() - interval '100 hours 45 minutes', end_time = now() - interval '100 hours',
           meeting_provider = 'zoom', provider_meeting_id = 'probe-room-' || v_s3
     WHERE id = v_s3;
    INSERT INTO projects.session_attendance (session_event_id, user_id, joined_at, source)
    VALUES (v_s3, current_setting('probe.buyer')::uuid, now() - interval '100 hours 44 minutes', 'webhook');
    INSERT INTO finance.disputes (escrow_id, opened_by_profile, reason)
    VALUES (v_e2, current_setting('probe.buyer')::uuid, 'no_show: probe');

    SELECT balance_cents INTO v_bal0 FROM finance.wallets
     WHERE owner_id = current_setting('probe.buyer')::uuid AND owner_type = current_setting('probe.wtype') AND currency = 'USD';
    v_res := finance.auto_release_session_escrow(now());
    SELECT balance_cents INTO v_bal1 FROM finance.wallets
     WHERE owner_id = current_setting('probe.buyer')::uuid AND owner_type = current_setting('probe.wtype') AND currency = 'USD';

    IF (SELECT status FROM finance.escrows WHERE id = v_e1) <> 'released'
       OR (SELECT platform_fee_cents FROM finance.escrows WHERE id = v_e1) <= 0 THEN
        RAISE EXCEPTION 'FAIL 6: the sitting 25h past its end was not released (%)', v_res;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finance.pending_releases pr WHERE pr.escrow_id = v_e1)
       AND NOT EXISTS (SELECT 1 FROM finance.transactions t WHERE t.ref_table = 'escrows' AND t.ref_id = v_e1 AND t.direction::text = 'credit') THEN
        RAISE EXCEPTION 'FAIL 6: the release credited nobody';
    END IF;
    IF (SELECT status FROM finance.escrows WHERE id = v_e2) <> 'held' THEN
        RAISE EXCEPTION 'FAIL 6: an escrow under an open dispute was released';
    END IF;
    IF (SELECT status FROM finance.escrows WHERE id = v_e3) <> 'refunded' OR v_bal1 - v_bal0 <> 16000 THEN
        RAISE EXCEPTION 'FAIL 6: the 100h-old provider no-show was not refunded to the client (% → %)', v_bal0, v_bal1;
    END IF;
    IF (SELECT count(*) FROM finance.escrows WHERE cohort_membership_id = v_m2 AND status = 'held') <> 4 THEN
        RAISE EXCEPTION 'FAIL 6: a sitting that has not happened was settled';
    END IF;
    IF (SELECT status FROM projects.cohort_memberships WHERE id = v_m2) <> 'active' THEN
        RAISE EXCEPTION 'FAIL 6: the booking ended while sittings were still owed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications WHERE user_id = v_host AND type = 'escrow.released' AND entity_id = v_e1) THEN
        RAISE EXCEPTION 'FAIL 6: the provider was not told about the payout';
    END IF;
    IF (finance.auto_release_session_escrow(now()) ->> 'released')::integer <> 0 THEN
        RAISE EXCEPTION 'FAIL 6: the sweep is not idempotent';
    END IF;
    RAISE NOTICE 'PASS 6: each sitting settles on its own clock — released 24h after it, held under a dispute, refunded on a no-show of any age';
END $$;
-- #endregion

-- #region 7. The client cancels the block across the notice line
DO $$
DECLARE
    v_s4 uuid := current_setting('probe.s4')::uuid;
BEGIN
    UPDATE projects.session_events SET start_time = now() + interval '12 hours',
           end_time = now() + interval '12 hours 45 minutes'
     WHERE id = v_s4;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
SELECT set_config('probe.cancel2', projects.cancel_cohort_membership(current_setting('probe.m2')::uuid)::text, true);
RESET ROLE;

DO $$
DECLARE
    v_res jsonb := current_setting('probe.cancel2')::jsonb;
    v_m2 uuid := current_setting('probe.m2')::uuid;
BEGIN
    IF v_res ->> 'outcome' <> 'partial' OR (v_res ->> 'refunded_minor')::bigint <> 32000
       OR (v_res ->> 'forfeited_minor')::bigint <= 0 OR (v_res ->> 'forfeited_minor')::bigint > 16000 THEN
        RAISE EXCEPTION 'FAIL 7: expected partial — two refunded, one forfeited — got %', v_res;
    END IF;
    IF (SELECT status FROM finance.escrows WHERE session_event_id = current_setting('probe.s4')::uuid) <> 'released'
       OR (SELECT count(*) FROM finance.escrows e JOIN projects.session_events se ON se.id = e.session_event_id
            WHERE e.cohort_membership_id = v_m2 AND e.status = 'refunded'
              AND se.status = 'cancelled_by_client') <> 2 THEN
        RAISE EXCEPTION 'FAIL 7: the near sitting did not forfeit or the far ones did not refund';
    END IF;
    IF (SELECT status FROM finance.escrows WHERE session_event_id = current_setting('probe.s2')::uuid) <> 'held' THEN
        RAISE EXCEPTION 'FAIL 7: a cancel touched a sitting that had already happened';
    END IF;
    IF (SELECT count(*) FROM scheduling.events ev JOIN projects.session_events se ON se.id = ev.source_session_event_id
         WHERE se.cohort_id = current_setting('probe.c2')::uuid AND ev.status = 'cancelled') <> 3 THEN
        RAISE EXCEPTION 'FAIL 7: the cancelled sittings are still on the provider''s calendar';
    END IF;
    IF (SELECT status FROM projects.cohort_memberships WHERE id = v_m2) <> 'cancelled'
       OR (SELECT status FROM projects.cohorts WHERE id = current_setting('probe.c2')::uuid) <> 'cancelled' THEN
        RAISE EXCEPTION 'FAIL 7: the booking or its one-seat cohort is still open';
    END IF;
    RAISE NOTICE 'PASS 7: a client cancel is judged per sitting — near forfeits, far refunds, held ones settle on their own';

    -- The disputed sitting still settles once its dispute is closed, though the booking was cancelled.
    UPDATE finance.disputes SET status = (
        SELECT e.enumlabel::public.dispute_status FROM pg_enum e
         WHERE e.enumtypid = 'public.dispute_status'::regtype AND e.enumlabel IN ('resolved_release', 'resolved')
         ORDER BY e.enumsortorder LIMIT 1), resolved_at = now()
     WHERE escrow_id = (SELECT id FROM finance.escrows WHERE session_event_id = current_setting('probe.s2')::uuid);
    PERFORM finance.auto_release_session_escrow(now());
    IF (SELECT status FROM finance.escrows WHERE session_event_id = current_setting('probe.s2')::uuid) <> 'released' THEN
        RAISE EXCEPTION 'FAIL 7: a held sitting on a cancelled booking never paid out after its dispute closed';
    END IF;
    RAISE NOTICE 'PASS 7: a sitting that happened still pays out after its dispute closes, booking cancelled or not';
END $$;
-- #endregion

-- #region 8. The provider cancels inside the notice window
UPDATE projects.session_events SET start_time = now() + interval '2 hours', end_time = now() + interval '3 hours'
 WHERE cohort_id = current_setting('probe.c1')::uuid;
SELECT set_config('probe.host1', (
    SELECT p.owner_user_id::text FROM projects.cohorts c JOIN projects.projects p ON p.id = c.project_id
     WHERE c.id = current_setting('probe.c1')::uuid), true);
SELECT set_config('probe.bal_before8', (SELECT balance_cents::text FROM finance.wallets
    WHERE owner_id = current_setting('probe.buyer')::uuid AND owner_type = current_setting('probe.wtype') AND currency = 'USD'), true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.host1'), 'role', 'authenticated')::text, true);
SELECT set_config('probe.cancel1', projects.cancel_cohort_membership(current_setting('probe.m1')::uuid)::text, true);
RESET ROLE;

DO $$
DECLARE
    v_res jsonb := current_setting('probe.cancel1')::jsonb;
BEGIN
    IF v_res ->> 'outcome' <> 'refunded' OR (v_res ->> 'refunded_minor')::bigint <> 18000 THEN
        RAISE EXCEPTION 'FAIL 8: the provider''s cancel inside the notice window was not a full refund: %', v_res;
    END IF;
    IF (SELECT balance_cents FROM finance.wallets WHERE owner_id = current_setting('probe.buyer')::uuid
         AND owner_type = current_setting('probe.wtype') AND currency = 'USD') - current_setting('probe.bal_before8')::bigint <> 18000 THEN
        RAISE EXCEPTION 'FAIL 8: the refund did not reach the payer''s wallet';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM projects.session_events WHERE cohort_id = current_setting('probe.c1')::uuid
                    AND status = 'cancelled_by_freelancer') THEN
        RAISE EXCEPTION 'FAIL 8: the sitting is not marked cancelled by the provider';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM comms.notifications WHERE user_id = current_setting('probe.buyer')::uuid
                    AND type = 'session.cancelled' AND payload ->> 'outcome' = 'refunded') THEN
        RAISE EXCEPTION 'FAIL 8: the client was not told about the refund';
    END IF;
    RAISE NOTICE 'PASS 8: a provider cancel refunds in full, inside the notice window too, and tells the client';
END $$;
-- #endregion

-- #region 9. A cohort seat still settles after the cohort's last sitting
DO $$
DECLARE
    v_stage uuid; v_project uuid; v_cohort uuid; v_m uuid; v_e uuid; v_team uuid; v_payer uuid;
BEGIN
    SELECT c.project_id, c.project_stage_id INTO v_project, v_stage FROM projects.cohorts c
     WHERE c.id = current_setting('probe.c2')::uuid;
    SELECT owner_team_id INTO v_team FROM projects.projects WHERE id = v_project;
    v_payer := current_setting('probe.buyer')::uuid;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_project, v_stage, 'Probe group', 5, 'active') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id) VALUES (v_cohort, v_payer) RETURNING id INTO v_m;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time) VALUES
        (v_cohort, 'Probe group 1', now() - interval '80 hours', now() - interval '79 hours'),
        (v_cohort, 'Probe group 2', now() - interval '26 hours', now() - interval '25 hours');
    INSERT INTO finance.escrows (project_stage_id, cohort_membership_id, payer_user_id, payee_type, payee_id,
                                 amount_cents, currency, status)
    VALUES (v_stage, v_m, v_payer, CASE WHEN v_team IS NULL THEN 'freelancer' ELSE 'team' END::assignment_type,
            COALESCE(v_team, (SELECT owner_user_id FROM projects.projects WHERE id = v_project)), 5000, 'USD', 'held')
    RETURNING id INTO v_e;
    PERFORM finance.auto_release_session_escrow(now());
    IF (SELECT status FROM finance.escrows WHERE id = v_e) <> 'released'
       OR (SELECT status FROM projects.cohort_memberships WHERE id = v_m) <> 'completed' THEN
        RAISE EXCEPTION 'FAIL 9: a cohort seat did not settle after the cohort''s last sitting';
    END IF;
    RAISE NOTICE 'PASS 9: a cohort seat (no sitting of its own) still settles after the cohort''s last sitting';
END $$;
-- #endregion

-- #region 10. Grants
DO $$
BEGIN
    IF has_function_privilege('authenticated', 'projects.fn_book_session_slot(uuid, uuid, text, uuid, bigint, integer, text, timestamptz, uuid)', 'EXECUTE')
       OR has_function_privilege('service_role', 'projects.fn_book_session_slot(uuid, uuid, text, uuid, bigint, integer, text, timestamptz, uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'projects.fn_lapse_session_handshakes(timestamptz)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'projects.fn_settle_membership_state(uuid, timestamptz)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'projects.fn_lapse_session_handshakes(timestamptz)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 10: the 1-1 session functions are granted wrongly';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ops.scheduled_jobs WHERE name = 'session-scheduling-handshakes' AND enabled) THEN
        RAISE EXCEPTION 'FAIL 10: the handshake sweep is not scheduled';
    END IF;
    RAISE NOTICE 'PASS 10: grants and the job registry';
END $$;
-- #endregion

ROLLBACK;
