-- =============================================================================================
-- Probe: a session block's sittings chosen at booking, and the session plan (Decision #411).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/session_chosen_sittings.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. A four-session block
-- is paid for through finance.place_wallet_order as the buyer, with sessions 2 and 3 chosen on the
-- basket line (`metadata.laterStarts`), and the probe checks:
--   1. sessions 1–3 sit at the chosen times, confirmed, with no handshake; session 4 is pencilled in a
--      week after session 3, tentative, with its 72h handshake;
--   2. each sitting is titled from the session plan, and an undescribed one by its number alone;
--   3. chosen times that overlap or run backwards are refused (PC409), and more chosen times than the
--      block holds are refused (22023) — the order rolls back and nothing is charged;
--   4. a rolling listing cannot hold more than one sitting or a plan (check_violation).
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_block uuid; v_buyer uuid; v_wtype text; v_bal bigint; v_basket uuid;
    v_ok uuid; v_overlap uuid; v_backwards uuid; v_toomany uuid;
    v_t0 timestamptz := date_trunc('hour', now()) + interval '20 days 4 hours 13 minutes';
BEGIN
    SELECT id INTO v_block FROM marketplace.service_blueprints
     WHERE delivery_model = 'session' AND is_published AND session_count > 1 ORDER BY id LIMIT 1;
    IF v_block IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published set-session listing (deno task db:reset)';
    END IF;
    UPDATE marketplace.service_blueprints
       SET session_price_cents = 16000, session_minutes = 45, session_count = 4, currency = 'USD',
           session_rolling = false,
           session_plan = '[{"title": "Discovery", "description": "Goals."}, {"title": "Build"},
                            {"title": "Review", "description": ""}, {"title": "", "description": ""}]'::jsonb
     WHERE id = v_block;
    UPDATE scheduling.availability_presets
       SET compiled_from = CURRENT_DATE - 2, compiled_through = CURRENT_DATE + 400
     WHERE id = scheduling.fn_preset_for_blueprint(v_block);
    INSERT INTO scheduling.availability_occurrences (preset_id, kind, starts_at, ends_at)
    SELECT pid, 'working_hours'::scheduling.availability_kind, now() - interval '2 days', now() + interval '400 days'
      FROM (SELECT scheduling.fn_preset_for_blueprint(v_block) AS pid) p
     WHERE pid IS NOT NULL
    ON CONFLICT DO NOTHING;

    SELECT w.owner_id, w.owner_type, w.balance_cents INTO v_buyer, v_wtype, v_bal
      FROM finance.wallets w
     WHERE w.currency = 'USD' AND w.owner_type IN ('user', 'freelancer')
       AND NOT org.fn_is_minor(w.owner_id)
       AND w.owner_id <> (SELECT sb.freelancer_profile_id FROM marketplace.service_blueprints sb WHERE sb.id = v_block)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm
                        JOIN marketplace.service_blueprints sb ON sb.owner_team_id = tm.team_id
                       WHERE sb.id = v_block AND tm.user_id = w.owner_id)
     ORDER BY w.balance_cents DESC LIMIT 1;
    IF v_buyer IS NULL OR v_bal < 64000 THEN
        RAISE EXCEPTION 'FAIL no fixture: need an adult buyer outside the seller''s team with $640 in a USD wallet';
    END IF;

    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES (v_wtype, v_buyer, 'Probe basket')
    RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (v_basket, 'set_session', v_block, 'Probe chosen', 64000, 'USD', v_t0, 'UTC',
            jsonb_build_object('laterStarts', jsonb_build_array(v_t0 + interval '2 days', v_t0 + interval '3 days')))
    RETURNING id INTO v_ok;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (v_basket, 'set_session', v_block, 'Probe overlap', 64000, 'USD', v_t0 + interval '30 days', 'UTC',
            jsonb_build_object('laterStarts', jsonb_build_array(v_t0 + interval '30 days 30 minutes')))
    RETURNING id INTO v_overlap;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (v_basket, 'set_session', v_block, 'Probe backwards', 64000, 'USD', v_t0 + interval '40 days', 'UTC',
            jsonb_build_object('laterStarts', jsonb_build_array(v_t0 + interval '39 days')))
    RETURNING id INTO v_backwards;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (v_basket, 'set_session', v_block, 'Probe too many', 64000, 'USD', v_t0 + interval '50 days', 'UTC',
            jsonb_build_object('laterStarts', jsonb_build_array(
                v_t0 + interval '51 days', v_t0 + interval '52 days', v_t0 + interval '53 days', v_t0 + interval '54 days')))
    RETURNING id INTO v_toomany;

    PERFORM set_config('probe.block', v_block::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.bal0', v_bal::text, true);
    PERFORM set_config('probe.basket', v_basket::text, true);
    PERFORM set_config('probe.ok', v_ok::text, true);
    PERFORM set_config('probe.overlap', v_overlap::text, true);
    PERFORM set_config('probe.backwards', v_backwards::text, true);
    PERFORM set_config('probe.toomany', v_toomany::text, true);
    PERFORM set_config('probe.t0', v_t0::text, true);
END $$;
-- #endregion

-- #region 1–3. Pay as the buyer
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_line text;
BEGIN
    FOREACH v_line IN ARRAY ARRAY['overlap', 'backwards'] LOOP
        BEGIN
            PERFORM finance.place_wallet_order(current_setting('probe.basket')::uuid,
                ARRAY[current_setting('probe.' || v_line)::uuid], 'USD',
                jsonb_build_object(current_setting('probe.' || v_line), 64000), NULL,
                'probe-' || v_line || '-' || current_setting('probe.' || v_line), 64000);
            RAISE EXCEPTION 'FAIL 3: chosen times (%) were booked', v_line;
        EXCEPTION WHEN SQLSTATE 'PC409' THEN
            RAISE NOTICE 'PASS 3: chosen times (%) are refused (PC409) [%]', v_line, SQLERRM;
        END;
    END LOOP;
    BEGIN
        PERFORM finance.place_wallet_order(current_setting('probe.basket')::uuid,
            ARRAY[current_setting('probe.toomany')::uuid], 'USD',
            jsonb_build_object(current_setting('probe.toomany'), 64000), NULL,
            'probe-toomany-' || current_setting('probe.toomany'), 64000);
        RAISE EXCEPTION 'FAIL 3: more chosen times than the block holds were booked';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS 3: more chosen times than the block holds are refused (22023) [%]', SQLERRM;
    END;
END $$;

SELECT set_config('probe.order', finance.place_wallet_order(
    current_setting('probe.basket')::uuid, ARRAY[current_setting('probe.ok')::uuid], 'USD',
    jsonb_build_object(current_setting('probe.ok'), 64000), NULL, 'probe-ok-' || current_setting('probe.ok'), 64000)
    ->> 'order_id', true);
RESET ROLE;
-- #endregion

-- #region 1–2. The sittings
DO $$
DECLARE
    v_t0 timestamptz := current_setting('probe.t0')::timestamptz;
    v_expected timestamptz[] := ARRAY[v_t0, v_t0 + interval '2 days', v_t0 + interval '3 days', v_t0 + interval '10 days'];
    v_titles text[];
    v_starts timestamptz[];
    v_status text[];
    v_rounds integer[];
    v_paid bigint;
BEGIN
    SELECT array_agg(se.start_time ORDER BY se.start_time),
           array_agg(se.title ORDER BY se.start_time),
           array_agg(ev.status::text ORDER BY se.start_time),
           array_agg((SELECT count(*)::integer FROM scheduling.event_reschedules r WHERE r.event_id = ev.id)
                     ORDER BY se.start_time)
      INTO v_starts, v_titles, v_status, v_rounds
      FROM finance.order_lines ol
      JOIN projects.cohort_memberships cm ON cm.order_line_id = ol.id
      JOIN projects.session_events se ON se.cohort_id = cm.cohort_id
      JOIN scheduling.events ev ON ev.source_session_event_id = se.id
     WHERE ol.order_id = current_setting('probe.order')::uuid;

    IF v_starts IS DISTINCT FROM v_expected THEN
        RAISE EXCEPTION 'FAIL 1: sittings at % (expected %)', v_starts, v_expected;
    END IF;
    IF v_status IS DISTINCT FROM ARRAY['confirmed', 'confirmed', 'confirmed', 'tentative'] THEN
        RAISE EXCEPTION 'FAIL 1: sitting statuses %', v_status;
    END IF;
    IF v_rounds IS DISTINCT FROM ARRAY[0, 0, 0, 1] THEN
        RAISE EXCEPTION 'FAIL 1: handshakes per sitting %', v_rounds;
    END IF;
    RAISE NOTICE 'PASS 1: chosen sittings are confirmed at their times; the one left is pencilled in a week later with its handshake';

    IF v_titles[1] NOT LIKE '%session 1 of 4: Discovery' OR v_titles[2] NOT LIKE '%session 2 of 4: Build'
       OR v_titles[3] NOT LIKE '%session 3 of 4: Review' OR v_titles[4] NOT LIKE '%session 4 of 4' THEN
        RAISE EXCEPTION 'FAIL 2: sitting titles %', v_titles;
    END IF;
    RAISE NOTICE 'PASS 2: sittings are titled from the session plan [%]', v_titles[2];

    SELECT current_setting('probe.bal0')::bigint - w.balance_cents INTO v_paid
      FROM finance.wallets w
     WHERE w.owner_id = current_setting('probe.buyer')::uuid AND w.currency = 'USD';
    IF v_paid <> 64000 THEN
        RAISE EXCEPTION 'FAIL 3: the wallet paid % (expected 64000 — the refused orders charge nothing)', v_paid;
    END IF;
    RAISE NOTICE 'PASS 3: only the accepted block was charged (4 × 160.00)';
END $$;
-- #endregion

-- #region 4. A rolling listing is one sitting with no plan
DO $$
BEGIN
    BEGIN
        UPDATE marketplace.service_blueprints SET session_rolling = true
         WHERE id = current_setting('probe.block')::uuid;
        RAISE EXCEPTION 'FAIL 4: a four-session listing with a plan was made rolling';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS 4: a rolling listing cannot keep a count or a plan (%)', SQLERRM;
    END;
    UPDATE marketplace.service_blueprints SET session_rolling = true, session_count = 1, session_plan = '[]'::jsonb
     WHERE id = current_setting('probe.block')::uuid;
    RAISE NOTICE 'PASS 4: a single-sitting listing with no plan can be rolling';
END $$;
-- #endregion

ROLLBACK;
