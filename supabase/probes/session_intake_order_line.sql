-- =============================================================================================
-- Probe: a session's intake answers survive to its order line (Decision #453).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/session_intake_order_line.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. The seed has no group
-- engagement, so one is built on the seeded group-session listing: an enrolling cohort of ten seats
-- with one sitting. The buyer reserves two seats through projects.reserve_seat, then pays for the seat
-- line and a 1-1 session line through finance.place_wallet_order, each line carrying the buyer's
-- answers as `metadata.answers` — the key a 1-1 line already used — and the probe checks:
--   1. the seat's order line keeps the answers to the listing's own questions, and only those;
--   2. the 1-1 session's order line does the same;
--   3. a line whose answers are not an object, or are over 32 KB, is refused (22023) and nothing is
--      charged; a line with no answers keeps `{}`;
--   4. the buyer reads the answers back under RLS;
--   5. grants: nobody but the definers reaches projects.fn_session_intake_answers.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_group uuid; v_one uuid; v_project uuid; v_stage uuid; v_cohort uuid;
    v_buyer uuid; v_wtype text; v_bal bigint; v_basket uuid;
    v_t1 timestamptz := date_trunc('hour', now()) + interval '33 days 5 hours 23 minutes';
BEGIN
    SELECT id INTO v_group FROM marketplace.service_blueprints
     WHERE delivery_model = 'group_session' AND is_published ORDER BY id LIMIT 1;
    SELECT id INTO v_one FROM marketplace.service_blueprints
     WHERE delivery_model = 'session' AND is_published AND COALESCE(session_count, 1) = 1 ORDER BY id LIMIT 1;
    IF v_group IS NULL OR v_one IS NULL THEN
        RAISE EXCEPTION 'FAIL no fixture: need a published group-session and a single-session listing (deno task db:reset)';
    END IF;
    -- Pinned so the arithmetic and the questions below are legible whatever the seed says.
    UPDATE marketplace.service_blueprints
       SET session_price_cents = 5000, currency = 'USD',
           intake_fields = '[{"id": "goal", "kind": "text", "label": "What do you want from the workshop?", "required": true},
                             {"id": "level", "kind": "select", "label": "Your level", "options": ["new", "practising"]}]'::jsonb
     WHERE id = v_group;
    UPDATE marketplace.service_blueprints
       SET session_price_cents = 18000, session_minutes = 60, currency = 'USD',
           intake_fields = '[{"id": "topic", "kind": "textarea", "label": "What should we cover?", "required": true}]'::jsonb
     WHERE id = v_one;
    UPDATE scheduling.availability_presets
       SET compiled_from = CURRENT_DATE - 2, compiled_through = CURRENT_DATE + 400
     WHERE id = scheduling.fn_preset_for_blueprint(v_one);
    INSERT INTO scheduling.availability_occurrences (preset_id, kind, starts_at, ends_at)
    SELECT pid, 'working_hours'::scheduling.availability_kind, now() - interval '2 days', now() + interval '400 days'
      FROM (SELECT scheduling.fn_preset_for_blueprint(v_one) AS pid) p
     WHERE pid IS NOT NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO projects.projects (owner_user_id, owner_team_id, title, format, session_kind, status, visibility,
                                   publish_visibility, currency, source_blueprint_id)
    SELECT sb.freelancer_profile_id, sb.owner_team_id, 'Probe group engagement', 'session', 'group', 'active',
           'unlisted', 'unlisted', 'USD', sb.id
      FROM marketplace.service_blueprints sb WHERE sb.id = v_group
    RETURNING id INTO v_project;
    INSERT INTO projects.project_stages (project_id, name, sort_order) VALUES (v_project, 'Sessions', 0)
    RETURNING id INTO v_stage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_project, v_stage, 'Probe cohort', 10, 'enrolling') RETURNING id INTO v_cohort;
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time)
    VALUES (v_cohort, 'Probe sitting', now() + interval '45 days', now() + interval '45 days 90 minutes');

    SELECT w.owner_id, w.owner_type, w.balance_cents INTO v_buyer, v_wtype, v_bal
      FROM finance.wallets w
     WHERE w.currency = 'USD' AND w.owner_type IN ('user', 'freelancer')
       AND NOT org.fn_is_minor(w.owner_id)
       AND w.owner_id NOT IN (SELECT sb.freelancer_profile_id FROM marketplace.service_blueprints sb
                               WHERE sb.id IN (v_group, v_one))
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm
                        JOIN marketplace.service_blueprints sb ON sb.owner_team_id = tm.team_id
                       WHERE sb.id IN (v_group, v_one) AND tm.user_id = w.owner_id AND tm.status = 'active')
     ORDER BY w.balance_cents DESC LIMIT 1;
    IF v_buyer IS NULL OR v_bal < 28000 THEN
        RAISE EXCEPTION 'FAIL no fixture: need an adult buyer outside the sellers'' teams with $280 in a USD wallet';
    END IF;
    INSERT INTO finance.baskets (owner_type, owner_id, name) VALUES (v_wtype, v_buyer, 'Probe basket')
    RETURNING id INTO v_basket;

    PERFORM set_config('probe.group', v_group::text, true);
    PERFORM set_config('probe.one', v_one::text, true);
    PERFORM set_config('probe.cohort', v_cohort::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.wtype', v_wtype, true);
    PERFORM set_config('probe.bal0', v_bal::text, true);
    PERFORM set_config('probe.basket', v_basket::text, true);
    PERFORM set_config('probe.t1', v_t1::text, true);
END $$;
-- #endregion

-- #region 1. The buyer reserves two seats
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
SELECT set_config('probe.hold', projects.reserve_seat(current_setting('probe.cohort')::uuid, 2) ->> 'hold_id', true);
RESET ROLE;

-- The lines as the booking service writes them: the answers ride `metadata.answers`, the seat line
-- names its hold. `stray` answers a question no listing asked.
DO $$
DECLARE
    v_seat uuid; v_one uuid; v_bare uuid; v_bad uuid; v_huge uuid;
    v_t1 timestamptz := current_setting('probe.t1')::timestamptz;
BEGIN
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      seats, metadata)
    VALUES (current_setting('probe.basket')::uuid, 'course_group_session', current_setting('probe.group')::uuid,
            'Probe seat', 5000, 'USD', now() + interval '45 days', 2,
            jsonb_build_object('holdId', current_setting('probe.hold'), 'bookingFormat', 'cohort',
                'answers', jsonb_build_object('goal', 'Ship a token pipeline', 'level', 'practising', 'stray', 'x')))
    RETURNING id INTO v_seat;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (current_setting('probe.basket')::uuid, 'service_session', current_setting('probe.one')::uuid,
            'Probe 1-1', 18000, 'USD', v_t1, 'UTC',
            jsonb_build_object('answers', jsonb_build_object('topic', 'Portfolio order', 'junk', 1)))
    RETURNING id INTO v_one;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (current_setting('probe.basket')::uuid, 'service_session', current_setting('probe.one')::uuid,
            'Probe bare', 18000, 'USD', v_t1 + interval '7 days', 'UTC', '{}'::jsonb)
    RETURNING id INTO v_bare;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (current_setting('probe.basket')::uuid, 'service_session', current_setting('probe.one')::uuid,
            'Probe malformed', 18000, 'USD', v_t1 + interval '14 days', 'UTC',
            jsonb_build_object('answers', jsonb_build_array('topic')))
    RETURNING id INTO v_bad;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, scheduled_at,
                                      timezone, metadata)
    VALUES (current_setting('probe.basket')::uuid, 'service_session', current_setting('probe.one')::uuid,
            'Probe huge', 18000, 'USD', v_t1 + interval '21 days', 'UTC',
            jsonb_build_object('answers', jsonb_build_object('topic', repeat('a', 40000))))
    RETURNING id INTO v_huge;
    PERFORM set_config('probe.seat', v_seat::text, true);
    PERFORM set_config('probe.line_one', v_one::text, true);
    PERFORM set_config('probe.bare', v_bare::text, true);
    PERFORM set_config('probe.bad', v_bad::text, true);
    PERFORM set_config('probe.huge', v_huge::text, true);
END $$;
-- #endregion

-- #region 3. Malformed answers refuse the order
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_line text;
BEGIN
    FOREACH v_line IN ARRAY ARRAY['bad', 'huge'] LOOP
        BEGIN
            PERFORM finance.place_wallet_order(current_setting('probe.basket')::uuid,
                ARRAY[current_setting('probe.' || v_line)::uuid], 'USD',
                jsonb_build_object(current_setting('probe.' || v_line), 18000), NULL,
                'probe-intake-' || v_line || '-' || current_setting('probe.' || v_line), 18000);
            RAISE EXCEPTION 'FAIL 3: a line with % answers was paid for', v_line;
        EXCEPTION WHEN SQLSTATE '22023' THEN
            RAISE NOTICE 'PASS 3: a line with % answers is refused (22023) [%]', v_line, SQLERRM;
        END;
    END LOOP;
END $$;
-- #endregion

-- #region 1–2. Pay for the seat, the 1-1 and a line with no answers
SELECT set_config('probe.order', finance.place_wallet_order(
    current_setting('probe.basket')::uuid,
    ARRAY[current_setting('probe.seat')::uuid, current_setting('probe.line_one')::uuid,
          current_setting('probe.bare')::uuid],
    'USD',
    jsonb_build_object(current_setting('probe.seat'), 10000, current_setting('probe.line_one'), 18000,
                       current_setting('probe.bare'), 18000),
    NULL, 'probe-intake-ok-' || current_setting('probe.seat'), 46000) ->> 'order_id', true);
-- #endregion

-- #region 4. The buyer reads the answers back under RLS
DO $$
DECLARE
    v_seen integer;
BEGIN
    SELECT count(*) INTO v_seen FROM finance.order_lines ol
     WHERE ol.order_id = current_setting('probe.order')::uuid AND ol.intake_answers <> '{}'::jsonb;
    IF v_seen <> 2 THEN
        RAISE EXCEPTION 'FAIL 4: the buyer sees % answered order lines (expected 2)', v_seen;
    END IF;
    RAISE NOTICE 'PASS 4: the buyer reads both answered lines back under RLS';
END $$;
RESET ROLE;
-- #endregion

-- #region 1–3. The order lines
DO $$
DECLARE
    v_seat finance.order_lines;
    v_one finance.order_lines;
    v_bare finance.order_lines;
    v_member uuid;
    v_paid bigint;
BEGIN
    SELECT * INTO v_seat FROM finance.order_lines
     WHERE order_id = current_setting('probe.order')::uuid AND basket_item_id = current_setting('probe.seat')::uuid;
    SELECT * INTO v_one FROM finance.order_lines
     WHERE order_id = current_setting('probe.order')::uuid AND basket_item_id = current_setting('probe.line_one')::uuid;
    SELECT * INTO v_bare FROM finance.order_lines
     WHERE order_id = current_setting('probe.order')::uuid AND basket_item_id = current_setting('probe.bare')::uuid;

    IF v_seat.id IS NULL OR v_seat.item_type <> 'course_group_session' OR v_seat.seats <> 2 THEN
        RAISE EXCEPTION 'FAIL 1: no two-seat order line (% %)', v_seat.item_type, v_seat.seats;
    END IF;
    IF v_seat.intake_answers IS DISTINCT FROM '{"goal": "Ship a token pipeline", "level": "practising"}'::jsonb THEN
        RAISE EXCEPTION 'FAIL 1: the seat line kept %', v_seat.intake_answers;
    END IF;
    SELECT cm.id INTO v_member FROM projects.cohort_memberships cm
     WHERE cm.cohort_id = current_setting('probe.cohort')::uuid AND cm.order_line_id = v_seat.id AND cm.status = 'active';
    IF v_member IS NULL THEN
        RAISE EXCEPTION 'FAIL 1: the seat order line seats nobody';
    END IF;
    RAISE NOTICE 'PASS 1: the seat order line keeps the answers to the listing''s questions, and only those [%]',
        v_seat.intake_answers;

    IF v_one.intake_answers IS DISTINCT FROM '{"topic": "Portfolio order"}'::jsonb THEN
        RAISE EXCEPTION 'FAIL 2: the 1-1 line kept %', v_one.intake_answers;
    END IF;
    RAISE NOTICE 'PASS 2: the 1-1 order line keeps the answers to the listing''s questions [%]', v_one.intake_answers;

    IF v_bare.intake_answers IS DISTINCT FROM '{}'::jsonb THEN
        RAISE EXCEPTION 'FAIL 3: a line with no answers kept %', v_bare.intake_answers;
    END IF;
    RAISE NOTICE 'PASS 3: a line with no answers keeps {}';

    SELECT current_setting('probe.bal0')::bigint - w.balance_cents INTO v_paid
      FROM finance.wallets w
     WHERE w.owner_id = current_setting('probe.buyer')::uuid AND w.currency = 'USD'
       AND w.owner_type = current_setting('probe.wtype');
    IF v_paid <> 46000 THEN
        RAISE EXCEPTION 'FAIL 3: the wallet paid % (expected 46000 — the refused lines charge nothing)', v_paid;
    END IF;
    RAISE NOTICE 'PASS 3: only the accepted order was charged (2 × 50.00 + 2 × 180.00)';
END $$;
-- #endregion

-- #region 5. Grants
DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF has_function_privilege(v_role, 'projects.fn_session_intake_answers(uuid, jsonb)', 'EXECUTE') THEN
            RAISE EXCEPTION 'FAIL 5: % may run projects.fn_session_intake_answers', v_role;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS 5: only the definers reach projects.fn_session_intake_answers';
END $$;
-- #endregion

ROLLBACK;
