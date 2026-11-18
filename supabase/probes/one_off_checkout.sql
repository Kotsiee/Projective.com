-- =============================================================================================
-- Probe: a One-Off or a Task paid at checkout becomes a funded engagement (Decision #457, LV2).
--
--   1. No client role executes the purchase door or its helpers.
--   2. fn_scoped_service_price: milestone 1, every milestone under the whole-project prepay, a Task at
--      the listing price, NULL for a Pipeline — and each equals what the hold takes.
--   3. fn_buy_scoped_service refuses a Pipeline, the buyer's own listing, a missing brief, a past
--      target date, a short key and a signed-out caller.
--   4. A One-Off funded for milestone 1: the seller owns it, the buyer is its client, one stage per
--      milestone with the seller's seat and room, one master ticket over every milestone due on the
--      target date, ONE held escrow on milestone 1 at its price, the wallet debited by exactly that,
--      the project active.
--   5. The whole-project prepay: milestone 1 held, every later milestone reserved.
--   6. A Task: one stage, single_task, held at the listing price, no due date and no bonus terms.
--   7. A refused hold rolls everything back: no project, no ticket, no escrow, the wallet untouched.
--   8. finance.place_wallet_order: the line is re-priced, the order line links the engagement, a
--      business basket and a moved price are refused with nothing written.
--   9. Conservation (finance.v_conservation_identity, FBP DB16): every purchase and refusal above
--      leaves each currency's imbalance where it was, measured after each of the fixture's own moves.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/one_off_checkout.sql
--
-- Fixtures are discovered from the seed: a published freelancer-owned One-Off with at least two priced
-- milestones, a published Direct Deliverable, a published Pipeline, and an adult buyer who sells none
-- of them, credited inside the transaction. A clean run prints only PASS notices.
-- =============================================================================================

BEGIN;
-- The pg_temp helpers below run as anon and authenticated, and 00002500 gives a new function no PUBLIC
-- EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region Helpers
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.balance(p_user uuid) RETURNS bigint LANGUAGE sql AS $$
    SELECT w.balance_cents FROM finance.wallets w
     WHERE w.owner_id = p_user AND w.owner_type = finance.fn_person_wallet_type(p_user) AND w.currency = 'USD';
$$;

CREATE FUNCTION pg_temp.stage_price(p_bp uuid, p_ord integer) RETURNS bigint LANGUAGE sql AS $$
    SELECT t.price FROM marketplace.service_blueprints sb
     CROSS JOIN LATERAL marketplace.fn_blueprint_stage_terms(sb) t
     WHERE sb.id = p_bp AND t.ord = p_ord;
$$;
-- #endregion

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_oneoff record;
    v_task record;
    v_pipeline uuid;
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
    SELECT sb.id INTO v_pipeline FROM marketplace.service_blueprints sb
     WHERE sb.delivery_model = 'pipeline' AND sb.is_published ORDER BY sb.slug LIMIT 1;
    IF v_oneoff.id IS NULL OR v_task.id IS NULL OR v_pipeline IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: one_off=% task=% pipeline=% — run deno task db:reset', v_oneoff.id, v_task.id, v_pipeline;
    END IF;

    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id NOT IN (v_oneoff.seller, v_task.seller)
       AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.business_profiles bp WHERE bp.owner_user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    IF v_buyer IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no adult buyer'; END IF;

    -- Every charged milestone is priced: the hold refuses an unpriced stage (no_price), tested in 7.
    UPDATE marketplace.service_blueprints
       SET stage_template = (
           SELECT jsonb_agg(CASE WHEN s.ord = 1 THEN s.value || '{"priceCents": 120000}'::jsonb
                                 ELSE s.value || '{"priceCents": 80000}'::jsonb END ORDER BY s.ord)
             FROM jsonb_array_elements(stage_template) WITH ORDINALITY AS s (value, ord))
     WHERE id = v_oneoff.id;
    UPDATE marketplace.service_blueprints SET price_cents = 190000 WHERE id = v_task.id;

    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_buyer), v_buyer, 'USD');
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', 2000000,
        'topup', 'inbound_payments', gen_random_uuid());
    -- The fixture's credit has no payment behind it, so the identity is measured from here on.
    PERFORM set_config('probe.imbalance', (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c)::text, true);

    PERFORM set_config('probe.oneoff', v_oneoff.id::text, true);
    PERFORM set_config('probe.seller', v_oneoff.seller::text, true);
    PERFORM set_config('probe.task', v_task.id::text, true);
    PERFORM set_config('probe.pipeline', v_pipeline::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    RAISE NOTICE 'fixture one_off=% seller=% task=% pipeline=% buyer=%', v_oneoff.id, v_oneoff.seller, v_task.id, v_pipeline, v_buyer;
END $$;
-- #endregion

-- #region 1. No client role executes the door or its helpers
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(current_setting('probe.buyer')::uuid);
DO $$
DECLARE
    v_sql text;
BEGIN
    FOREACH v_sql IN ARRAY ARRAY[
        format('SELECT marketplace.fn_buy_scoped_service(%L, ''brief'', ''{}'', NULL, false, ''probe-lv2-role'')', current_setting('probe.oneoff')),
        format('SELECT marketplace.fn_scoped_service_price(%L, false)', current_setting('probe.oneoff')),
        'SELECT marketplace.fn_intake_answers(''[]'', ''{}'')',
        format('SELECT * FROM marketplace.service_blueprints sb, marketplace.fn_blueprint_stage_terms(sb) WHERE sb.id = %L', current_setting('probe.oneoff'))
    ] LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'FAIL authenticated executed: %', v_sql;
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE NOTICE 'PASS 1 authenticated refused: %', left(v_sql, 60);
        END;
    END LOOP;
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The checkout price
DO $$
DECLARE
    v_oneoff uuid := current_setting('probe.oneoff')::uuid;
    v_n integer;
BEGIN
    SELECT jsonb_array_length(stage_template) INTO v_n FROM marketplace.service_blueprints WHERE id = v_oneoff;
    IF marketplace.fn_scoped_service_price(v_oneoff, false) IS DISTINCT FROM 120000 THEN
        RAISE EXCEPTION 'FAIL 2 first milestone priced %', marketplace.fn_scoped_service_price(v_oneoff, false);
    END IF;
    IF marketplace.fn_scoped_service_price(v_oneoff, true) IS DISTINCT FROM 120000 + 80000 * (v_n - 1) THEN
        RAISE EXCEPTION 'FAIL 2 whole project priced %', marketplace.fn_scoped_service_price(v_oneoff, true);
    END IF;
    IF marketplace.fn_scoped_service_price(current_setting('probe.task')::uuid, false) IS DISTINCT FROM 190000
       OR marketplace.fn_scoped_service_price(current_setting('probe.task')::uuid, true) IS DISTINCT FROM 190000 THEN
        RAISE EXCEPTION 'FAIL 2 a Task is not priced at the listing price';
    END IF;
    IF marketplace.fn_scoped_service_price(current_setting('probe.pipeline')::uuid, false) IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 2 a Pipeline was priced for checkout';
    END IF;
    RAISE NOTICE 'PASS 2 milestone 1 = 120000, whole = %, Task = 190000, Pipeline = NULL', 120000 + 80000 * (v_n - 1);

    -- Tiering is a Pipeline's: a One-Off marked tiered, its first milestone High with a seller High
    -- price, still sells that milestone at its stated price, the figure the dialog totals.
    UPDATE marketplace.service_blueprints
       SET allow_tiered_intensity = true,
           stage_template = jsonb_set(jsonb_set(stage_template, '{0,intensity}', '"high"'), '{0,highPriceCents}', '999999')
     WHERE id = v_oneoff;
    IF marketplace.fn_scoped_service_price(v_oneoff, false) IS DISTINCT FROM 120000 THEN
        RAISE EXCEPTION 'FAIL 2 a tiered One-Off priced milestone 1 at %', marketplace.fn_scoped_service_price(v_oneoff, false);
    END IF;
    RAISE NOTICE 'PASS 2 a One-Off marked tiered still sells at its stated price';

    -- An unpriced milestone is priced on scope: no ticket-rate fallback, so the whole project is unpriced.
    UPDATE marketplace.service_blueprints
       SET ticket_price_cents = 50000,
           stage_template = stage_template #- '{1,priceCents}'
     WHERE id = v_oneoff;
    IF marketplace.fn_scoped_service_price(v_oneoff, true) IS NOT NULL
       OR marketplace.fn_scoped_service_price(v_oneoff, false) IS DISTINCT FROM 120000 THEN
        RAISE EXCEPTION 'FAIL 2 an unpriced milestone was priced (whole %)', marketplace.fn_scoped_service_price(v_oneoff, true);
    END IF;
    PERFORM pg_temp.act(current_setting('probe.buyer')::uuid);
    BEGIN
        PERFORM marketplace.fn_buy_scoped_service(v_oneoff, 'brief', '{}', NULL, true, 'probe-lv2-2unpriced');
        RAISE EXCEPTION 'FAIL 2 an unpriced One-Off was bought';
    EXCEPTION WHEN SQLSTATE '22023' THEN
        RAISE NOTICE 'PASS 2 an unpriced milestone has no ticket-rate fallback and is refused 22023';
    END;

    UPDATE marketplace.service_blueprints
       SET allow_tiered_intensity = false, ticket_price_cents = NULL,
           stage_template = (
               SELECT jsonb_agg((s.value - 'highPriceCents') || jsonb_build_object(
                          'intensity', 'standard',
                          'priceCents', CASE WHEN s.ord = 1 THEN 120000 ELSE 80000 END) ORDER BY s.ord)
                 FROM jsonb_array_elements(stage_template) WITH ORDINALITY AS s (value, ord))
     WHERE id = v_oneoff;
END $$;
-- #endregion

-- #region 3. Refusals
DO $$
DECLARE
    v_oneoff uuid := current_setting('probe.oneoff')::uuid;
    v_case record;
BEGIN
    PERFORM pg_temp.act(current_setting('probe.buyer')::uuid);
    FOR v_case IN
        SELECT * FROM (VALUES
            ('a Pipeline', current_setting('probe.pipeline')::uuid, 'brief', NULL::date, 'probe-lv2-3a', '22023'),
            ('no brief', v_oneoff, '   ', NULL::date, 'probe-lv2-3b', '22023'),
            ('a past target date', v_oneoff, 'brief', current_date - 1, 'probe-lv2-3c', '22007'),
            ('a short key', v_oneoff, 'brief', NULL::date, 'short', '22023'),
            ('an unknown listing', gen_random_uuid(), 'brief', NULL::date, 'probe-lv2-3e', 'P0002')
        ) AS c (label, bp, brief, due, key, code)
    LOOP
        BEGIN
            PERFORM marketplace.fn_buy_scoped_service(v_case.bp, v_case.brief, '{}', v_case.due, false, v_case.key);
            RAISE EXCEPTION 'FAIL 3 % was accepted', v_case.label;
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE <> v_case.code THEN
                RAISE EXCEPTION 'FAIL 3 % refused % % (expected %)', v_case.label, SQLSTATE, SQLERRM, v_case.code;
            END IF;
            RAISE NOTICE 'PASS 3 % refused %', v_case.label, SQLSTATE;
        END;
    END LOOP;

    PERFORM pg_temp.act(current_setting('probe.seller')::uuid);
    BEGIN
        PERFORM marketplace.fn_buy_scoped_service(v_oneoff, 'brief', '{}', NULL, false, 'probe-lv2-3own');
        RAISE EXCEPTION 'FAIL 3 the seller bought their own listing';
    EXCEPTION WHEN SQLSTATE 'PU422' THEN
        RAISE NOTICE 'PASS 3 own listing refused PU422';
    END;

    PERFORM pg_temp.act(NULL);
    BEGIN
        PERFORM marketplace.fn_buy_scoped_service(v_oneoff, 'brief', '{}', NULL, false, 'probe-lv2-3anon');
        RAISE EXCEPTION 'FAIL 3 a signed-out caller bought';
    EXCEPTION WHEN SQLSTATE '28000' THEN
        RAISE NOTICE 'PASS 3 signed out refused 28000';
    END;
END $$;
-- #endregion

-- #region 4. A One-Off funded for milestone 1
DO $$
DECLARE
    v_oneoff uuid := current_setting('probe.oneoff')::uuid;
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_n integer;
    v_b0 bigint;
    v_out jsonb;
    v_project uuid;
    v_ticket record;
    v_p record;
    v_first uuid;
BEGIN
    SELECT jsonb_array_length(stage_template) INTO v_n FROM marketplace.service_blueprints WHERE id = v_oneoff;
    PERFORM pg_temp.act(v_buyer);
    v_b0 := pg_temp.balance(v_buyer);
    v_out := marketplace.fn_buy_scoped_service(v_oneoff, 'Build the landing page we discussed.',
        '{"not-a-question": "dropped"}', current_date + 30, false, 'probe-lv2-4');
    v_project := (v_out->>'project_id')::uuid;

    SELECT * INTO v_p FROM projects.projects WHERE id = v_project;
    IF v_p.owner_user_id <> v_seller OR v_p.client_user_id <> v_buyer
       OR v_p.format <> 'one_off' OR v_p.structure_variation <> 'one_off'
       OR v_p.status <> 'active' OR NOT v_p.allow_deadline_bonuses
       OR v_p.budget_amount_cents <> 120000 + 80000 * (v_n - 1) OR v_p.source_blueprint_id <> v_oneoff THEN
        RAISE EXCEPTION 'FAIL 4 project %', to_jsonb(v_p);
    END IF;
    RAISE NOTICE 'PASS 4 the seller owns %, the buyer is its client, one_off, active, budget %', v_p.slug, v_p.budget_amount_cents;

    IF (SELECT count(*) FROM projects.project_stages WHERE project_id = v_project) <> v_n
       OR (SELECT count(*) FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
            WHERE ps.project_id = v_project AND sa.freelancer_profile_id = v_seller AND sa.status = 'accepted') <> v_n
       OR (SELECT count(*) FROM comms.project_channels c WHERE c.project_id = v_project) <> v_n + 1 THEN
        RAISE EXCEPTION 'FAIL 4 stages/seats/rooms: stages % seats % rooms %',
            (SELECT count(*) FROM projects.project_stages WHERE project_id = v_project),
            (SELECT count(*) FROM projects.stage_assignments sa JOIN projects.project_stages ps ON ps.id = sa.project_stage_id
              WHERE ps.project_id = v_project AND sa.status = 'accepted'),
            (SELECT count(*) FROM comms.project_channels c WHERE c.project_id = v_project);
    END IF;
    RAISE NOTICE 'PASS 4 % milestones, the seller seated on each, % rooms', v_n, v_n + 1;

    SELECT id INTO v_first FROM projects.project_stages WHERE project_id = v_project AND sort_order = 0;
    IF (SELECT count(*) FROM projects.tickets WHERE project_id = v_project) <> 1 THEN
        RAISE EXCEPTION 'FAIL 4 a One-Off holds % tickets', (SELECT count(*) FROM projects.tickets WHERE project_id = v_project);
    END IF;
    SELECT * INTO v_ticket FROM projects.tickets WHERE project_id = v_project;
    IF v_ticket.owner_user_id <> v_buyer OR jsonb_array_length(v_ticket.required_stages) <> v_n
       OR v_ticket.current_stage_id <> v_first OR v_ticket.status <> 'todo'
       OR v_ticket.due_date::date <> current_date + 30 OR v_ticket.current_assignee_id IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL 4 master ticket %', to_jsonb(v_ticket) - 'description';
    END IF;
    RAISE NOTICE 'PASS 4 one master ticket over % milestones, placed in milestone 1, due %', v_n, v_ticket.due_date::date;

    IF (SELECT count(*) FROM finance.escrows e JOIN projects.project_stages ps ON ps.id = e.project_stage_id
         WHERE ps.project_id = v_project) <> 1
       OR NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.ticket_id = v_ticket.id AND e.project_stage_id = v_first
                       AND e.status = 'held' AND e.amount_cents = 120000 AND e.payer_user_id = v_buyer
                       AND e.deadline_bonus_cents = 0)
       OR (v_out->>'escrow_id')::uuid IS DISTINCT FROM
          (SELECT e.id FROM finance.escrows e WHERE e.ticket_id = v_ticket.id AND e.status = 'held') THEN
        RAISE EXCEPTION 'FAIL 4 escrows %', (SELECT jsonb_agg(to_jsonb(e)) FROM finance.escrows e WHERE e.ticket_id = v_ticket.id);
    END IF;
    IF pg_temp.balance(v_buyer) <> v_b0 - 120000 THEN
        RAISE EXCEPTION 'FAIL 4 wallet moved % (expected -120000)', pg_temp.balance(v_buyer) - v_b0;
    END IF;
    IF (SELECT intake_answers FROM projects.service_instantiations WHERE project_id = v_project) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'FAIL 4 an answer to no question was kept';
    END IF;
    RAISE NOTICE 'PASS 4 one escrow held on milestone 1 at 120000 from the buyer, no bonus, wallet -120000';
END $$;
-- #endregion

-- #region 5. The whole-project prepay
DO $$
DECLARE
    v_oneoff uuid := current_setting('probe.oneoff')::uuid;
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_n integer;
    v_b0 bigint;
    v_out jsonb;
    v_ticket uuid;
BEGIN
    SELECT jsonb_array_length(stage_template) INTO v_n FROM marketplace.service_blueprints WHERE id = v_oneoff;
    PERFORM pg_temp.act(v_buyer);
    v_b0 := pg_temp.balance(v_buyer);
    v_out := marketplace.fn_buy_scoped_service(v_oneoff, 'Everything, start to finish.', '{}', NULL, true, 'probe-lv2-5');
    v_ticket := (v_out->>'ticket_id')::uuid;
    IF (SELECT count(*) FROM finance.escrows WHERE ticket_id = v_ticket AND status = 'held') <> 1
       OR (SELECT count(*) FROM finance.escrows WHERE ticket_id = v_ticket AND status = 'reserved') <> v_n - 1
       OR jsonb_array_length(v_out->'reserved_stage_ids') <> v_n - 1
       OR (v_out->>'amount_cents')::bigint <> 120000 + 80000 * (v_n - 1)
       OR pg_temp.balance(v_buyer) <> v_b0 - (120000 + 80000 * (v_n - 1)) THEN
        RAISE EXCEPTION 'FAIL 5 prepay: %, escrows %', v_out,
            (SELECT jsonb_agg(jsonb_build_object('status', e.status, 'amount', e.amount_cents)) FROM finance.escrows e WHERE e.ticket_id = v_ticket);
    END IF;
    IF (SELECT allow_deadline_bonuses FROM projects.projects WHERE id = (v_out->>'project_id')::uuid) THEN
        RAISE EXCEPTION 'FAIL 5 bonus terms on with no target date';
    END IF;
    RAISE NOTICE 'PASS 5 whole project: milestone 1 held, % reserved, wallet -%', v_n - 1, 120000 + 80000 * (v_n - 1);
END $$;
-- #endregion

-- #region 6. A Task
DO $$
DECLARE
    v_task uuid := current_setting('probe.task')::uuid;
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_b0 bigint;
    v_out jsonb;
    v_p record;
BEGIN
    PERFORM pg_temp.act(v_buyer);
    v_b0 := pg_temp.balance(v_buyer);
    v_out := marketplace.fn_buy_scoped_service(v_task, 'One logo, three concepts.', '{}', NULL, false, 'probe-lv2-6');
    SELECT * INTO v_p FROM projects.projects WHERE id = (v_out->>'project_id')::uuid;
    IF v_p.structure_variation <> 'single_task' OR v_p.format <> 'one_off' OR v_p.status <> 'active'
       OR v_p.allow_deadline_bonuses OR v_p.budget_amount_cents <> 190000
       OR (SELECT count(*) FROM projects.project_stages WHERE project_id = v_p.id) <> 1
       OR (SELECT due_date FROM projects.tickets WHERE id = (v_out->>'ticket_id')::uuid) IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM finance.escrows WHERE ticket_id = (v_out->>'ticket_id')::uuid
                       AND status = 'held' AND amount_cents = 190000)
       OR pg_temp.balance(v_buyer) <> v_b0 - 190000 THEN
        RAISE EXCEPTION 'FAIL 6 Task %', to_jsonb(v_p) - 'description';
    END IF;
    RAISE NOTICE 'PASS 6 a Task: one stage, single_task, held at 190000, no due date, no bonus terms';
END $$;
-- #endregion

-- #region 7. A refused hold leaves nothing behind
DO $$
DECLARE
    v_oneoff uuid := current_setting('probe.oneoff')::uuid;
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_projects bigint;
    v_escrows bigint;
    v_b0 bigint;
BEGIN
    IF (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c) IS DISTINCT FROM current_setting('probe.imbalance')::jsonb THEN
        RAISE EXCEPTION 'FAIL 9 conservation: sections 2-6 moved the identity from % to %',
            current_setting('probe.imbalance'), (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c);
    END IF;
    RAISE NOTICE 'PASS 9 conservation: every purchase and refusal in sections 2-6 left each currency''s imbalance where it was';
    PERFORM pg_temp.act(v_buyer);
    v_b0 := pg_temp.balance(v_buyer);
    -- The drain below debits with no escrow behind it, a fixture move: the identity is measured again
    -- after the section's closing credit.
    PERFORM finance.fn_wallet_debit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', v_b0 - 1000,
        'escrow_hold', 'escrows', gen_random_uuid());
    v_b0 := pg_temp.balance(v_buyer);
    SELECT count(*) INTO v_projects FROM projects.projects WHERE source_blueprint_id = v_oneoff;
    SELECT count(*) INTO v_escrows FROM finance.escrows;
    BEGIN
        PERFORM marketplace.fn_buy_scoped_service(v_oneoff, 'Too little in the wallet.', '{}', NULL, false, 'probe-lv2-7');
        RAISE EXCEPTION 'FAIL 7 an unfunded purchase went through';
    EXCEPTION WHEN SQLSTATE 'PF402' THEN
        RAISE NOTICE 'PASS 7 short wallet refused PF402 (%)', SQLERRM;
    END;
    IF (SELECT count(*) FROM projects.projects WHERE source_blueprint_id = v_oneoff) <> v_projects
       OR (SELECT count(*) FROM finance.escrows) <> v_escrows
       OR pg_temp.balance(v_buyer) <> v_b0
       OR EXISTS (SELECT 1 FROM projects.service_instantiations WHERE idempotency_key = 'probe-lv2-7') THEN
        RAISE EXCEPTION 'FAIL 7 the refusal left an engagement, an escrow or a wallet movement behind';
    END IF;
    RAISE NOTICE 'PASS 7 nothing written: no project, no escrow, wallet untouched';
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', 2000000,
        'topup', 'inbound_payments', gen_random_uuid());
    PERFORM set_config('probe.imbalance', (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c)::text, true);
END $$;
-- #endregion

-- #region 8. Checkout: finance.place_wallet_order
CREATE FUNCTION pg_temp.scoped_line(p_owner_type text, p_owner uuid, p_bp uuid, p_kind text, p_meta jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_basket uuid;
    v_line uuid;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES (p_owner_type, p_owner, 'Probe LV2') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, metadata)
    VALUES (v_basket, p_kind::finance.purchasable_item_kind, p_bp, 'Probe One-Off', 1, 'USD',
            jsonb_build_object('fundingScope', 'first_stage', 'requirements', 'Probe brief', 'answers', '{}'::jsonb)
                || p_meta)
    RETURNING id INTO v_line;
    RETURN v_line;
END $$;

DO $$
DECLARE
    v_oneoff uuid := current_setting('probe.oneoff')::uuid;
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_owner_type text := finance.fn_person_wallet_type(current_setting('probe.buyer')::uuid);
    v_n integer;
    v_line uuid;
    v_basket uuid;
    v_out jsonb;
    v_again jsonb;
    v_ol record;
    v_b0 bigint;
    v_projects bigint;
    v_orders bigint;
    v_biz record;
BEGIN
    SELECT jsonb_array_length(stage_template) INTO v_n FROM marketplace.service_blueprints WHERE id = v_oneoff;
    PERFORM pg_temp.act(v_buyer);

    -- The happy path: milestone 1, with a target date.
    v_line := pg_temp.scoped_line(v_owner_type, v_buyer, v_oneoff, 'one_off_service',
        jsonb_build_object('targetDate', to_char(current_date + 21, 'YYYY-MM-DD'), 'answers', '{"stray": 1}'::jsonb));
    SELECT basket_id INTO v_basket FROM finance.basket_items WHERE id = v_line;
    v_b0 := pg_temp.balance(v_buyer);
    v_out := finance.place_wallet_order(v_basket, ARRAY[v_line], 'USD',
        jsonb_build_object(v_line::text, 120000), NULL, 'probe-lv2-8a', 120000);
    SELECT * INTO v_ol FROM finance.order_lines WHERE order_id = (v_out ->> 'order_id')::uuid;
    IF v_ol.project_id IS NULL OR v_ol.escrow_id IS NULL OR v_ol.ticket_id IS NULL OR v_ol.stage_id IS NULL
       OR v_ol.fulfilment <> 'engagement' OR v_ol.line_total_minor <> 120000 OR v_ol.intake_answers <> '{}'::jsonb
       OR NOT EXISTS (SELECT 1 FROM finance.escrows e WHERE e.id = v_ol.escrow_id AND e.status = 'held'
                       AND e.project_stage_id = v_ol.stage_id AND e.ticket_id = v_ol.ticket_id AND e.amount_cents = 120000)
       OR NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.id = v_ol.project_id AND p.status = 'active'
                       AND p.client_user_id = v_buyer AND p.owner_user_id = current_setting('probe.seller')::uuid)
       OR (SELECT due_date::date FROM projects.tickets WHERE id = v_ol.ticket_id) <> current_date + 21
       OR (SELECT purchased_at FROM finance.basket_items WHERE id = v_line) IS NULL
       OR (v_out ->> 'charged_minor')::bigint <> 120000
       OR pg_temp.balance(v_buyer) <> v_b0 - 120000 THEN
        RAISE EXCEPTION 'FAIL 8 order line %', to_jsonb(v_ol);
    END IF;
    RAISE NOTICE 'PASS 8 order % charged 120000: its line links project, ticket, milestone 1 and the held escrow', v_out ->> 'reference';

    -- A replayed key answers with the same order and creates nothing more.
    SELECT count(*) INTO v_projects FROM projects.projects WHERE source_blueprint_id = v_oneoff;
    v_again := finance.place_wallet_order(v_basket, ARRAY[v_line], 'USD',
        jsonb_build_object(v_line::text, 120000), NULL, 'probe-lv2-8a', 120000);
    IF NOT (v_again ->> 'replayed')::boolean OR v_again ->> 'order_id' <> v_out ->> 'order_id'
       OR (SELECT count(*) FROM projects.projects WHERE source_blueprint_id = v_oneoff) <> v_projects THEN
        RAISE EXCEPTION 'FAIL 8 replay %', v_again;
    END IF;
    RAISE NOTICE 'PASS 8 a replayed key returns the same order and no second engagement';

    -- The whole-project prepay through checkout.
    v_line := pg_temp.scoped_line(v_owner_type, v_buyer, v_oneoff, 'one_off_service', '{"fundingScope": "whole_project"}');
    SELECT basket_id INTO v_basket FROM finance.basket_items WHERE id = v_line;
    v_out := finance.place_wallet_order(v_basket, ARRAY[v_line], 'USD',
        jsonb_build_object(v_line::text, 120000 + 80000 * (v_n - 1)), NULL, 'probe-lv2-8b', 120000 + 80000 * (v_n - 1));
    SELECT * INTO v_ol FROM finance.order_lines WHERE order_id = (v_out ->> 'order_id')::uuid;
    IF v_ol.subtitle <> 'Every milestone funded'
       OR (SELECT count(*) FROM finance.escrows WHERE ticket_id = v_ol.ticket_id AND status = 'reserved') <> v_n - 1 THEN
        RAISE EXCEPTION 'FAIL 8 whole-project order line %', to_jsonb(v_ol);
    END IF;
    RAISE NOTICE 'PASS 8 whole project through checkout: milestone 1 held, % reserved', v_n - 1;

    -- Refusals leave nothing: a moved price, a promo beside the line, a past target date.
    SELECT count(*) INTO v_projects FROM projects.projects;
    SELECT count(*) INTO v_orders FROM finance.orders;
    v_line := pg_temp.scoped_line(v_owner_type, v_buyer, v_oneoff, 'one_off_service', '{}');
    SELECT basket_id INTO v_basket FROM finance.basket_items WHERE id = v_line;
    BEGIN
        PERFORM finance.place_wallet_order(v_basket, ARRAY[v_line], 'USD',
            jsonb_build_object(v_line::text, 100000), NULL, 'probe-lv2-8c', 100000);
        RAISE EXCEPTION 'FAIL 8 a moved price was charged';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'PASS 8 a moved price refused PC409 (%)', SQLERRM;
    END;
    UPDATE finance.basket_items SET metadata = metadata || jsonb_build_object('targetDate', to_char(current_date - 1, 'YYYY-MM-DD'))
     WHERE id = v_line;
    BEGIN
        PERFORM finance.place_wallet_order(v_basket, ARRAY[v_line], 'USD',
            jsonb_build_object(v_line::text, 120000), NULL, 'probe-lv2-8d', 120000);
        RAISE EXCEPTION 'FAIL 8 a past target date was accepted';
    EXCEPTION WHEN SQLSTATE 'PC409' THEN
        RAISE NOTICE 'PASS 8 a past target date refused PC409 (%)', SQLERRM;
    END;
    IF (SELECT count(*) FROM projects.projects) <> v_projects OR (SELECT count(*) FROM finance.orders) <> v_orders THEN
        RAISE EXCEPTION 'FAIL 8 a refused checkout left a project or an order behind';
    END IF;
    RAISE NOTICE 'PASS 8 refused checkouts left no project and no order';

    -- Individuals only (owner ruling): a business basket is refused before anything is written.
    SELECT b.id, b.owner_user_id INTO v_biz
      FROM org.business_profiles b
      JOIN finance.wallets w ON w.owner_type = 'business' AND w.owner_id = b.id AND w.currency = 'USD'
     WHERE b.kyb_status = 'verified' AND b.status = 'active' AND b.owner_user_id IS NOT NULL
       AND b.owner_user_id <> current_setting('probe.seller')::uuid
     ORDER BY b.id LIMIT 1;
    IF v_biz.id IS NULL THEN
        RAISE NOTICE 'SKIP 8 no verified business with a USD wallet in the seed';
    ELSE
        PERFORM pg_temp.act(v_biz.owner_user_id);
        v_line := pg_temp.scoped_line('business', v_biz.id, v_oneoff, 'one_off_service', '{}');
        SELECT basket_id INTO v_basket FROM finance.basket_items WHERE id = v_line;
        BEGIN
            PERFORM finance.place_wallet_order(v_basket, ARRAY[v_line], 'USD',
                jsonb_build_object(v_line::text, 120000), NULL, 'probe-lv2-8e', 120000);
            RAISE EXCEPTION 'FAIL 8 a business bought a One-Off';
        EXCEPTION WHEN SQLSTATE 'PU422' THEN
            RAISE NOTICE 'PASS 8 a business basket refused PU422 (%)', SQLERRM;
        END;
        PERFORM pg_temp.act(v_buyer);
    END IF;

    -- A Task through checkout, at the listing price.
    v_line := pg_temp.scoped_line(v_owner_type, v_buyer, current_setting('probe.task')::uuid, 'single_service_task', '{}');
    SELECT basket_id INTO v_basket FROM finance.basket_items WHERE id = v_line;
    v_out := finance.place_wallet_order(v_basket, ARRAY[v_line], 'USD',
        jsonb_build_object(v_line::text, 190000), NULL, 'probe-lv2-8f', 190000);
    SELECT * INTO v_ol FROM finance.order_lines WHERE order_id = (v_out ->> 'order_id')::uuid;
    IF v_ol.project_id IS NULL OR v_ol.escrow_id IS NULL OR v_ol.line_total_minor <> 190000
       OR (SELECT structure_variation FROM projects.projects WHERE id = v_ol.project_id) <> 'single_task' THEN
        RAISE EXCEPTION 'FAIL 8 Task order line %', to_jsonb(v_ol);
    END IF;
    RAISE NOTICE 'PASS 8 a Task through checkout: single_task, held at 190000, line linked';
END $$;
-- #endregion

-- #region 9. Conservation across the checkout
DO $$
BEGIN
    IF (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c) IS DISTINCT FROM current_setting('probe.imbalance')::jsonb THEN
        RAISE EXCEPTION 'FAIL 9 conservation: the checkout moved the identity from % to %',
            current_setting('probe.imbalance'), (SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), '{}'::jsonb) FROM finance.v_conservation_identity c);
    END IF;
    RAISE NOTICE 'PASS 9 conservation: every order in section 8 left each currency''s imbalance where it was';
END $$;
-- #endregion

ROLLBACK;
