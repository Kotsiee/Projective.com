-- =============================================================================================
-- Probe: an escrow refund marks the order line it was bought on, and the order rolls up from its lines
-- (FBP DB19; Decision #337, ruling M8; Decision #469).
--
--   1. No client role executes the line writer, the rollup or their helpers.
--   2. A whole-project One-Off refunded before any work: its later milestones first (the line partly
--      refunded, the order still confirmed), then milestone 1 (the line refunded in full and
--      `cancelled`, refunded_at set, the order `cancelled`). A second refund door run changes nothing.
--   3. Two lines in one order: the One-Off, whose ticket reached in_progress, refunded in full is
--      `refunded` while the order stays confirmed (the Task still stands); the Task, refunded before any
--      work, is `cancelled`, and the order is `refunded` (every line refunded or cancelled, one refunded).
--   4. A 50% Fair Exit returns half the escrow: the line is partly refunded (60000 of 120000) and stays
--      confirmed, and so does the order.
--   5. An escrow no order line paid for (a stage funded from the Finance tab) touches no order line.
--   6. Conservation (finance.v_conservation_identity, FBP DB16): every refund above leaves each
--      currency's imbalance where it was after the fixture's own credit.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/order_refund_lifecycle.sql
--
-- Fixtures are discovered from the seed, as one_off_checkout.sql: a published freelancer-owned One-Off
-- with at least two milestones, a published Direct Deliverable (a Task), and an adult buyer who sells
-- neither, credited inside the transaction. A clean run prints only PASS notices.
-- =============================================================================================

\set ON_ERROR_STOP on
BEGIN;
-- The pg_temp helpers below run as authenticated, and 00002500 gives a new function no PUBLIC EXECUTE;
-- this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region Helpers
CREATE FUNCTION pg_temp.assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'PROBE FAIL: %', p_what;
    END IF;
    RAISE NOTICE 'PASS %', p_what;
END $$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

-- A basket of the buyer's with the given scoped lines (kind, blueprint, funding scope); returns the line ids.
CREATE FUNCTION pg_temp.basket(p_lines jsonb) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_basket uuid;
    v_line uuid;
    v_ids uuid[] := '{}';
    r jsonb;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES (finance.fn_person_wallet_type(v_buyer), v_buyer, 'Probe DB19') RETURNING id INTO v_basket;
    FOR r IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
        INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, metadata)
        VALUES (v_basket, (r ->> 'kind')::finance.purchasable_item_kind, (r ->> 'bp')::uuid, 'Probe line', 1, 'USD',
                jsonb_build_object('fundingScope', r ->> 'scope', 'requirements', 'Probe brief', 'answers', '{}'::jsonb))
        RETURNING id INTO v_line;
        v_ids := v_ids || v_line;
    END LOOP;
    RETURN v_ids;
END $$;

-- Places the order for the given lines at the given prices; returns the order id.
CREATE FUNCTION pg_temp.place(p_lines uuid[], p_prices bigint[], p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_units jsonb := '{}';
    v_total bigint := 0;
    i integer;
BEGIN
    FOR i IN 1..cardinality(p_lines) LOOP
        v_units := v_units || jsonb_build_object(p_lines[i]::text, p_prices[i]);
        v_total := v_total + p_prices[i];
    END LOOP;
    PERFORM pg_temp.act(current_setting('probe.buyer')::uuid);
    RETURN (finance.place_wallet_order(
        (SELECT basket_id FROM finance.basket_items WHERE id = p_lines[1]), p_lines, 'USD', v_units, NULL,
        p_key, v_total) ->> 'order_id')::uuid;
END $$;

CREATE FUNCTION pg_temp.imbalance_moved() RETURNS boolean LANGUAGE sql AS $$
    SELECT EXISTS (
        SELECT 1 FROM finance.v_conservation_identity c
         WHERE c.imbalance_minor IS DISTINCT FROM
               COALESCE((current_setting('probe.imbalance')::jsonb ->> c.currency)::bigint, 0));
$$;
-- #endregion

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_oneoff record;
    v_task record;
    v_buyer uuid;
BEGIN
    SELECT sb.id, sb.freelancer_profile_id AS seller INTO v_oneoff
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'one_off' AND sb.is_published AND sb.owner_team_id IS NULL
       AND sb.currency = 'USD' AND jsonb_array_length(sb.stage_template) >= 2
     ORDER BY sb.slug LIMIT 1;
    SELECT sb.id, sb.freelancer_profile_id AS seller INTO v_task
      FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'direct_deliverable' AND sb.is_published AND sb.owner_team_id IS NULL
       AND sb.currency = 'USD' AND sb.price_cents > 0
     ORDER BY sb.slug LIMIT 1;
    IF v_oneoff.id IS NULL OR v_task.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL fixture: one_off=% task=% — run deno task db:reset', v_oneoff.id, v_task.id;
    END IF;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id NOT IN (v_oneoff.seller, v_task.seller)
       AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.business_profiles bp WHERE bp.owner_user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_buyer IS NULL THEN RAISE EXCEPTION 'PROBE FAIL fixture: no adult buyer'; END IF;

    UPDATE marketplace.service_blueprints
       SET stage_template = (
           SELECT jsonb_agg(CASE WHEN s.ord = 1 THEN s.value || '{"priceCents": 120000}'::jsonb
                                 ELSE s.value || '{"priceCents": 80000}'::jsonb END ORDER BY s.ord)
             FROM jsonb_array_elements(stage_template) WITH ORDINALITY AS s (value, ord))
     WHERE id = v_oneoff.id;
    UPDATE marketplace.service_blueprints SET price_cents = 190000 WHERE id = v_task.id;

    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_buyer), v_buyer, 'USD');
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', 3000000,
        'topup', 'inbound_payments', gen_random_uuid());
    -- The fixture's credit has no payment behind it, so the identity is measured from here on.
    PERFORM set_config('probe.imbalance', (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb)
                                             FROM finance.v_conservation_identity c)::text, true);
    PERFORM set_config('probe.oneoff', v_oneoff.id::text, true);
    PERFORM set_config('probe.seller', v_oneoff.seller::text, true);
    PERFORM set_config('probe.task', v_task.id::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.milestones', (SELECT jsonb_array_length(stage_template)::text
                                              FROM marketplace.service_blueprints WHERE id = v_oneoff.id), true);
    RAISE NOTICE 'fixture one_off=% task=% buyer=%', v_oneoff.id, v_task.id, v_buyer;
END $$;
-- #endregion

-- #region 1. No client role executes the writer, the rollup or their helpers
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(current_setting('probe.buyer')::uuid);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        'SELECT finance.fn_record_order_line_refund(gen_random_uuid(), 1)',
        'SELECT finance.fn_roll_up_order_status(gen_random_uuid())',
        'SELECT finance.fn_order_line_of_escrow(gen_random_uuid())',
        'SELECT finance.fn_order_line_delivery_began(gen_random_uuid())',
        format('SELECT finance.fn_promo_uses(''X'', ''user'', %L)', current_setting('probe.buyer'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'PROBE FAIL 1 authenticated executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS 1 authenticated refused: %', left(v_sql, 60);
        END;
    END LOOP;
END $$;
RESET ROLE;
-- #endregion

-- #region 2. Refunded before any work: partly, then in full → cancelled
DO $$
DECLARE
    v_n integer := current_setting('probe.milestones')::integer;
    v_whole bigint := 120000 + 80000 * (current_setting('probe.milestones')::integer - 1);
    v_lines uuid[];
    v_order uuid;
    l finance.order_lines;
BEGIN
    v_lines := pg_temp.basket(jsonb_build_array(jsonb_build_object(
        'kind', 'one_off_service', 'bp', current_setting('probe.oneoff'), 'scope', 'whole_project')));
    v_order := pg_temp.place(v_lines, ARRAY[v_whole], 'probe-db19-2');
    PERFORM pg_temp.act(NULL);
    SELECT * INTO l FROM finance.order_lines WHERE order_id = v_order;
    PERFORM pg_temp.assert(l.status = 'confirmed' AND l.refunded_minor = 0 AND l.refunded_at IS NULL
        AND (SELECT status FROM finance.orders WHERE id = v_order) = 'confirmed'
        AND (SELECT count(*) FROM finance.escrows WHERE ticket_id = l.ticket_id AND status = 'reserved') = v_n - 1,
        format('2 a whole-project One-Off is placed confirmed: milestone 1 held, %s reserved, nothing refunded', v_n - 1));

    PERFORM finance.fn_refund_ticket_reservations(l.ticket_id, NULL, 'probe');
    SELECT * INTO l FROM finance.order_lines WHERE id = l.id;
    PERFORM pg_temp.assert(l.status = 'confirmed' AND l.refunded_minor = v_whole - 120000 AND l.refunded_at IS NOT NULL
        AND (SELECT status FROM finance.orders WHERE id = v_order) = 'confirmed',
        format('2 the reserved milestones refunded: the line is partly refunded (%s of %s) and the order stays confirmed',
               l.refunded_minor, v_whole));

    PERFORM finance.fn_refund_ticket_escrow(l.ticket_id);
    SELECT * INTO l FROM finance.order_lines WHERE id = l.id;
    PERFORM pg_temp.assert(l.status = 'cancelled' AND l.refunded_minor = v_whole
        AND (SELECT status FROM finance.orders WHERE id = v_order) = 'cancelled',
        '2 milestone 1 refunded before any work: the line is cancelled in full and so is the order');

    PERFORM finance.fn_refund_ticket_escrow(l.ticket_id);
    PERFORM finance.fn_refund_ticket_reservations(l.ticket_id, NULL, 'probe');
    PERFORM pg_temp.assert(
        (SELECT refunded_minor FROM finance.order_lines WHERE id = l.id) = v_whole
        AND (SELECT status FROM finance.orders WHERE id = v_order) = 'cancelled'
        AND finance.fn_record_order_line_refund(
                (SELECT e.id FROM finance.escrows e WHERE e.ticket_id = l.ticket_id ORDER BY e.id LIMIT 1), 500) = l.id
        AND (SELECT refunded_minor FROM finance.order_lines WHERE id = l.id) = v_whole,
        '2 running the refund doors again, or the writer on a cancelled line, changes nothing');
    PERFORM pg_temp.assert(NOT pg_temp.imbalance_moved(), '2 conservation: no currency''s imbalance moved');
END $$;
-- #endregion

-- #region 3. Two lines: one refunded after work started, one cancelled → the order is refunded
DO $$
DECLARE
    v_lines uuid[];
    v_order uuid;
    l1 finance.order_lines;
    l2 finance.order_lines;
BEGIN
    v_lines := pg_temp.basket(jsonb_build_array(
        jsonb_build_object('kind', 'one_off_service', 'bp', current_setting('probe.oneoff'), 'scope', 'first_stage'),
        jsonb_build_object('kind', 'single_service_task', 'bp', current_setting('probe.task'), 'scope', 'first_stage')));
    v_order := pg_temp.place(v_lines, ARRAY[120000, 190000]::bigint[], 'probe-db19-3');
    PERFORM pg_temp.act(NULL);
    SELECT * INTO l1 FROM finance.order_lines WHERE order_id = v_order AND item_type = 'one_off_service';
    SELECT * INTO l2 FROM finance.order_lines WHERE order_id = v_order AND item_type = 'single_service_task';
    PERFORM pg_temp.assert(l1.id IS NOT NULL AND l2.id IS NOT NULL AND l1.ticket_id <> l2.ticket_id,
        '3 one order, two lines, two tickets');

    -- The seller starts the One-Off's work.
    INSERT INTO projects.ticket_history (ticket_id, actor_id, action_type, previous_status, new_status, changes)
    VALUES (l1.ticket_id, current_setting('probe.seller')::uuid, 'status_changed', 'todo', 'in_progress', '{}');
    PERFORM finance.fn_refund_ticket_escrow(l1.ticket_id);
    SELECT * INTO l1 FROM finance.order_lines WHERE id = l1.id;
    PERFORM pg_temp.assert(l1.status = 'refunded' AND l1.refunded_minor = 120000
        AND (SELECT status FROM finance.orders WHERE id = v_order) = 'confirmed'
        AND (SELECT status FROM finance.order_lines WHERE id = l2.id) = 'confirmed',
        '3 the One-Off refunded in full after its work started is refunded; the order stays confirmed beside the Task');

    PERFORM finance.fn_refund_ticket_escrow(l2.ticket_id);
    SELECT * INTO l2 FROM finance.order_lines WHERE id = l2.id;
    PERFORM pg_temp.assert(l2.status = 'cancelled' AND l2.refunded_minor = 190000
        AND (SELECT status FROM finance.orders WHERE id = v_order) = 'refunded',
        '3 the Task refunded before any work is cancelled; every line is refunded or cancelled, so the order is refunded');
    PERFORM pg_temp.assert(NOT pg_temp.imbalance_moved(), '3 conservation: no currency''s imbalance moved');
END $$;
-- #endregion

-- #region 4. A 50% Fair Exit leaves the line partly refunded
DO $$
DECLARE
    v_lines uuid[];
    v_order uuid;
    l finance.order_lines;
BEGIN
    v_lines := pg_temp.basket(jsonb_build_array(jsonb_build_object(
        'kind', 'one_off_service', 'bp', current_setting('probe.oneoff'), 'scope', 'first_stage')));
    v_order := pg_temp.place(v_lines, ARRAY[120000]::bigint[], 'probe-db19-4');
    PERFORM pg_temp.act(NULL);
    SELECT * INTO l FROM finance.order_lines WHERE order_id = v_order;
    -- The seller claims the milestone, which names them the escrow's payee.
    PERFORM pg_temp.act(current_setting('probe.seller')::uuid);
    PERFORM projects.claim_ticket(l.ticket_id, current_setting('probe.seller')::uuid);
    PERFORM pg_temp.act(NULL);
    PERFORM pg_temp.assert(EXISTS (SELECT 1 FROM finance.escrows e WHERE e.id = l.escrow_id AND e.status = 'held'
                                    AND e.payee_id IS NOT NULL),
        '4 the One-Off''s milestone 1 is held for its seller');
    PERFORM finance.fn_fair_exit_release(l.ticket_id, 5000);
    SELECT * INTO l FROM finance.order_lines WHERE id = l.id;
    PERFORM pg_temp.assert(l.status = 'confirmed' AND l.refunded_minor = 60000 AND l.refunded_at IS NOT NULL
        AND (SELECT status FROM finance.orders WHERE id = v_order) = 'confirmed',
        format('4 a 50%% Fair Exit: the line is partly refunded (%s of 120000) and the line and order stay confirmed',
               l.refunded_minor));
    PERFORM pg_temp.assert(NOT pg_temp.imbalance_moved(), '4 conservation: no currency''s imbalance moved');
END $$;
-- #endregion

-- #region 5. An escrow no order line paid for touches no order
DO $$
DECLARE
    v_ticket uuid;
    v_before jsonb;
BEGIN
    SELECT e.ticket_id INTO v_ticket
      FROM finance.escrows e
     WHERE e.status = 'held' AND e.ticket_id IS NOT NULL AND e.revision_id IS NULL AND e.cohort_membership_id IS NULL
       AND finance.fn_order_line_of_escrow(e.id) IS NULL
       AND NOT EXISTS (SELECT 1 FROM finance.disputes d WHERE d.escrow_id = e.id)
     ORDER BY e.id LIMIT 1;
    IF v_ticket IS NULL THEN RAISE EXCEPTION 'PROBE FAIL fixture 5: no held ticket escrow outside any order'; END IF;
    SELECT jsonb_agg(jsonb_build_array(l.id, l.status, l.refunded_minor) ORDER BY l.id) INTO v_before FROM finance.order_lines l;
    PERFORM finance.fn_refund_ticket_escrow(v_ticket);
    PERFORM pg_temp.assert(
        (SELECT jsonb_agg(jsonb_build_array(l.id, l.status, l.refunded_minor) ORDER BY l.id) FROM finance.order_lines l)
            = v_before
        AND EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_ticket AND e.status = 'refunded'),
        '5 a ticket escrow funded outside any order is refunded and no order line changes');
    PERFORM pg_temp.assert(NOT pg_temp.imbalance_moved(), '5 conservation: no currency''s imbalance moved');
END $$;
-- #endregion

ROLLBACK;
