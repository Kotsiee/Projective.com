-- listing_analytics.sql — probe for listing rollups and the client pipeline (Decision #217, C5).
--
-- Seeds synthetic interest, basket, order and session rows on one fixed past UTC day, rolls it up with
-- analytics.fn_rollup_listings and asserts every metric, re-runs it for idempotency, crosses the
-- keyword k-anonymity line at 4 → 5 sessions, checks who may read the rows, and calls
-- catalogue.get_client_pipeline as the seller, the buyer and a stranger. One transaction, ROLLED BACK.
-- Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/listing_analytics.sql
\set ON_ERROR_STOP on
\set QUIET on
BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.act(p_uid text) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

CREATE FUNCTION pg_temp.nobody() RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true),
           pg_catalog.set_config('request.jwt.claims', '', true);
$$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.v(p_metric text, p_listing text, p_dims jsonb DEFAULT '{}'::jsonb) RETURNS numeric
LANGUAGE sql AS $$
    SELECT COALESCE((SELECT r.value FROM analytics.daily_rollups r
                      WHERE r.day = DATE '2024-07-03' AND r.metric = p_metric
                        AND r.subject_kind = 'listing' AND r.subject_id = pg_temp.s(p_listing)::uuid
                        AND r.dimensions = p_dims), 0);
$$;

CREATE FUNCTION pg_temp.snapshot() RETURNS text LANGUAGE sql AS $$
    SELECT COALESCE(pg_catalog.string_agg(
               pg_catalog.format('%s|%s|%s|%s|%s', r.metric, r.subject_id, r.dimensions, r.value, r.sample_count),
               ';' ORDER BY r.metric, r.subject_id, r.dimensions::text), '')
      FROM analytics.daily_rollups r
     WHERE r.day = DATE '2024-07-03' AND r.subject_kind = 'listing';
$$;
GRANT EXECUTE ON FUNCTION pg_temp.s(text), pg_temp.ok(boolean, text) TO authenticated;
-- #endregion

-- #region Fixture: a personal seller with a pipeline service, a group session and a product
DO $$
DECLARE r record; v_buyer uuid; v_stranger uuid;
BEGIN
    SELECT l.owner_user_id AS seller, sc.id AS schedule,
           lp.id AS pipeline, lp.service_blueprint_id AS pipeline_bp,
           lg.id AS grp, lg.service_blueprint_id AS grp_bp,
           lr.id AS product, lr.product_id
      INTO r
      FROM catalogue.listings l
      JOIN scheduling.schedules sc ON sc.owner_type = 'user' AND sc.owner_id = l.owner_user_id
      JOIN catalogue.listings lp ON lp.owner_user_id = l.owner_user_id AND lp.owner_team_id IS NULL
      JOIN marketplace.service_blueprints bp ON bp.id = lp.service_blueprint_id AND bp.delivery_model = 'pipeline'
      JOIN catalogue.listings lg ON lg.owner_user_id = l.owner_user_id AND lg.owner_team_id IS NULL
      JOIN marketplace.service_blueprints bg ON bg.id = lg.service_blueprint_id AND bg.delivery_model = 'group_session'
      JOIN catalogue.listings lr ON lr.owner_user_id = l.owner_user_id AND lr.owner_team_id IS NULL
                                AND lr.kind = 'product'
     WHERE l.owner_team_id IS NULL
     ORDER BY l.owner_user_id, lp.id, lg.id, lr.id
     LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROBE FAIL: no seller with a pipeline, a group session and a product — run `deno task db:reset`';
    END IF;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id <> r.seller AND u.dob < CURRENT_DATE - INTERVAL '18 years'
     ORDER BY u.username LIMIT 1;
    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id NOT IN (r.seller, v_buyer) AND u.dob < CURRENT_DATE - INTERVAL '18 years'
     ORDER BY u.username LIMIT 1;

    PERFORM pg_catalog.set_config('probe.seller', r.seller::text, true);
    PERFORM pg_catalog.set_config('probe.schedule', r.schedule::text, true);
    PERFORM pg_catalog.set_config('probe.pipeline', r.pipeline::text, true);
    PERFORM pg_catalog.set_config('probe.pipeline_bp', r.pipeline_bp::text, true);
    PERFORM pg_catalog.set_config('probe.grp', r.grp::text, true);
    PERFORM pg_catalog.set_config('probe.grp_bp', r.grp_bp::text, true);
    PERFORM pg_catalog.set_config('probe.product', r.product::text, true);
    PERFORM pg_catalog.set_config('probe.product_id', r.product_id::text, true);
    PERFORM pg_catalog.set_config('probe.buyer', v_buyer::text, true);
    PERFORM pg_catalog.set_config('probe.stranger', v_stranger::text, true);
    UPDATE scheduling.schedules SET timezone = 'Europe/London' WHERE id = r.schedule;
END $$;
-- #endregion

-- #region 1. Synthetic activity on 2024-07-03 (a Wednesday; London is UTC+1)
DO $$
DECLARE
    v_bp uuid := pg_temp.s('pipeline_bp')::uuid;
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_basket uuid; v_order uuid; v_project uuid; v_stage uuid; v_cohort uuid; i int;
BEGIN
    -- 7 sessions saw it for "Brand  Identity" (normalised to "brand identity"), 4 for "logo".
    FOR i IN 1 .. 7 LOOP
        INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, query, created_at)
        VALUES ('brand-' || i, 'impression', v_bp, 'service', '  Brand  Identity ', '2024-07-03 10:00Z');
    END LOOP;
    FOR i IN 1 .. 4 LOOP
        INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, query, created_at)
        VALUES ('logo-' || i, 'impression', v_bp, 'service', 'logo', '2024-07-03 11:00Z');
    END LOOP;
    INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, query, created_at) VALUES
        ('brand-1', 'click', v_bp, 'service', 'brand identity', '2024-07-03 10:01Z'),
        ('logo-1', 'click', v_bp, 'service', NULL, '2024-07-03 11:01Z'),
        ('brand-1', 'view', v_bp, 'service', NULL, '2024-07-03 10:02Z'),
        ('brand-1', 'view', v_bp, 'service', NULL, '2024-07-03 10:30Z'),
        ('logo-1', 'view', v_bp, 'service', NULL, '2024-07-03 11:02Z'),
        -- The day before and the day after never leak in.
        ('edge-0', 'impression', v_bp, 'service', NULL, '2024-07-02 23:59:59Z'),
        ('edge-1', 'impression', v_bp, 'service', NULL, '2024-07-04 00:00Z');

    -- One basket line and three orders for the product: GBP and EUR confirmed, one refunded.
    INSERT INTO finance.baskets (owner_type, owner_id) VALUES ('user', v_buyer) RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency, created_at)
    VALUES (v_basket, 'digital_product', pg_temp.s('product_id')::uuid, 'Probe product', 1500, 'GBP', '2024-07-03 12:00Z');

    INSERT INTO finance.orders (reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor,
                                platform_fee_bp, total_minor, idempotency_key, updated_at)
    VALUES ('PJ-PROBE-GBP', 'confirmed', '2024-07-03 12:05Z', 'user', v_buyer, 'GBP', 1500, 0, 1500,
            'probe-c5-gbp', '2024-07-03 12:05Z')
    RETURNING id INTO v_order;
    INSERT INTO finance.order_lines (order_id, item_type, item_id, title, line_total_minor, currency)
    VALUES (v_order, 'digital_product', pg_temp.s('product_id')::uuid, 'Probe product', 1500, 'GBP')
    RETURNING id INTO v_order;
    PERFORM pg_catalog.set_config('probe.order_line', v_order::text, true);

    INSERT INTO finance.orders (reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor,
                                platform_fee_bp, total_minor, idempotency_key, updated_at)
    VALUES ('PJ-PROBE-EUR', 'invoiced', '2024-07-03 13:00Z', 'user', v_buyer, 'EUR', 900, 0, 900,
            'probe-c5-eur', '2024-07-03 13:00Z')
    RETURNING id INTO v_order;
    INSERT INTO finance.order_lines (order_id, item_type, item_id, title, line_total_minor, currency)
    VALUES (v_order, 'digital_product', pg_temp.s('product_id')::uuid, 'Probe product', 900, 'EUR');

    INSERT INTO finance.orders (reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor,
                                platform_fee_bp, total_minor, idempotency_key, updated_at)
    VALUES ('PJ-PROBE-REF', 'refunded', '2024-07-01 09:00Z', 'user', v_buyer, 'GBP', 700, 0, 700,
            'probe-c5-ref', '2024-07-03 14:00Z')
    RETURNING id INTO v_order;
    INSERT INTO finance.order_lines (order_id, item_type, item_id, title, line_total_minor, currency)
    VALUES (v_order, 'digital_product', pg_temp.s('product_id')::uuid, 'Probe product', 700, 'GBP');

    -- The group session: one seat booked that day, one sitting held at 09:30Z (10:30 London), one
    -- sitting cancelled that day.
    INSERT INTO projects.projects (owner_user_id, title, session_kind, status, visibility, source_blueprint_id, currency)
    VALUES (pg_temp.s('seller')::uuid, 'Probe cohort run', 'group', 'active', 'unlisted', pg_temp.s('grp_bp')::uuid, 'GBP')
    RETURNING id INTO v_project;
    INSERT INTO projects.project_stages (project_id, name, sort_order)
    VALUES (v_project, 'Sessions', 0) RETURNING id INTO v_stage;
    INSERT INTO projects.cohorts (project_id, project_stage_id, name, max_seats, status)
    VALUES (v_project, v_stage, 'Probe cohort', 10, 'active') RETURNING id INTO v_cohort;
    INSERT INTO projects.cohort_memberships (cohort_id, user_id, seats, joined_at)
    VALUES (v_cohort, v_buyer, 2, '2024-07-03 08:00Z') RETURNING id INTO v_order;
    PERFORM pg_catalog.set_config('probe.membership', v_order::text, true);
    INSERT INTO projects.session_events (cohort_id, title, start_time, end_time, status, updated_at) VALUES
        (v_cohort, 'Held', '2024-07-03 09:30Z', '2024-07-03 10:30Z', 'completed', '2024-07-03 10:30Z'),
        (v_cohort, 'Called off', '2024-07-03 15:00Z', '2024-07-03 16:00Z', 'cancelled_by_freelancer', '2024-07-03 12:00Z');
END $$;
-- #endregion

-- #region 2. One roll-up: every metric
SELECT pg_temp.ok(analytics.fn_rollup_listings(DATE '2024-07-03') > 0, 'the day rolls up');
SELECT pg_temp.ok(pg_temp.v('listing.impressions', 'pipeline') = 11, 'impressions count every impression of the day, none from either edge');
SELECT pg_temp.ok(pg_temp.v('listing.clicks', 'pipeline') = 2, 'clicks');
SELECT pg_temp.ok(pg_temp.v('listing.views', 'pipeline') = 2, 'views are distinct sessions (3 view events, 2 sessions)');
SELECT pg_temp.ok(pg_temp.v('listing.query_impressions', 'pipeline', '{"q":"brand identity"}') = 7,
                  'a query from 7 sessions is written, normalised');
SELECT pg_temp.ok(pg_temp.v('listing.query_clicks', 'pipeline', '{"q":"brand identity"}') = 1,
                  'query clicks follow a query that cleared the threshold');
SELECT pg_temp.ok(pg_temp.v('listing.checkout_starts', 'product') = 1, 'checkout starts');
SELECT pg_temp.ok(pg_temp.v('listing.orders', 'product') = 2, 'orders count confirmed and invoiced, not refunded');
SELECT pg_temp.ok(pg_temp.v('listing.gross_minor', 'product', '{"currency":"GBP"}') = 1500, 'gross in GBP');
SELECT pg_temp.ok(pg_temp.v('listing.gross_minor', 'product', '{"currency":"EUR"}') = 900, 'gross in EUR, its own row');
SELECT pg_temp.ok(pg_temp.v('listing.cancellations', 'product') = 1, 'a refund last changed that day is a cancellation');
SELECT pg_temp.ok(pg_temp.v('listing.bookings', 'grp') = 1, 'bookings');
SELECT pg_temp.ok(pg_temp.v('listing.booking_slot', 'grp', '{"dow":3,"hour":10}') = 1,
                  'the heatmap reads the seller''s timezone (09:30Z is Wednesday 10:30 London)');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM analytics.daily_rollups r WHERE r.day = DATE '2024-07-03'
                               AND r.metric = 'listing.booking_slot' AND r.dimensions ->> 'hour' = '16'),
                  'a cancelled sitting is not in the heatmap');
SELECT pg_temp.ok(pg_temp.v('listing.cancellations', 'grp') = 1, 'a sitting cancelled that day is a cancellation');
-- #endregion

-- #region 3. Idempotency, stale rows and the k-anonymity line
DO $$
DECLARE v_before text := pg_temp.snapshot();
BEGIN
    PERFORM analytics.fn_rollup_listings(DATE '2024-07-03');
    PERFORM pg_temp.ok(pg_temp.snapshot() = v_before, 'a second run writes the same rows and values');
    INSERT INTO analytics.daily_rollups (day, metric, subject_kind, subject_id, value)
    VALUES (DATE '2024-07-03', 'listing.clicks', 'listing', pg_temp.s('grp')::uuid, 99);
    PERFORM analytics.fn_rollup_listings(DATE '2024-07-03');
    PERFORM pg_temp.ok(pg_temp.snapshot() = v_before, 'a row the day no longer produces is removed on re-run');
END $$;
SELECT pg_temp.ok(pg_temp.v('listing.query_impressions', 'pipeline', '{"q":"logo"}') = 0,
                  'a query from 4 sessions is dropped (k-anonymity)');
INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, query, created_at)
VALUES ('logo-5', 'impression', pg_temp.s('pipeline_bp')::uuid, 'service', 'logo', '2024-07-03 11:30Z');
SELECT analytics.fn_rollup_listings(DATE '2024-07-03');
SELECT pg_temp.ok(pg_temp.v('listing.query_impressions', 'pipeline', '{"q":"logo"}') = 5,
                  'the fifth session makes the query visible');
SELECT pg_temp.ok(analytics.fn_backfill_listing_rollups(DATE '2024-07-02', DATE '2024-07-04') > 0,
                  'the backfill rolls up a range');
-- #endregion

-- #region 4. Who may read the rows, and who may write them
SELECT pg_temp.ok(NOT pg_catalog.has_function_privilege('authenticated', 'analytics.fn_rollup_listings(date)', 'EXECUTE')
                  AND NOT pg_catalog.has_function_privilege('anon', 'analytics.fn_rollup_listings(date)', 'EXECUTE')
                  AND NOT pg_catalog.has_function_privilege('authenticated', 'analytics.fn_backfill_listing_rollups(date, date)', 'EXECUTE')
                  AND pg_catalog.has_function_privilege('service_role', 'analytics.fn_rollup_listings(date)', 'EXECUTE'),
                  'only the service role may run the writer and the backfill');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM ops.scheduled_jobs j WHERE j.name = 'analytics-listing-rollups'
                           AND j.kind = 'sql' AND j.schedule = '10 2 * * *' AND j.enabled),
                  'the job is in the registry, daily 02:10 UTC');

SELECT set_config('probe.total', (SELECT count(*)::text FROM analytics.daily_rollups r
                                   WHERE r.day = DATE '2024-07-03' AND r.subject_kind = 'listing'
                                     AND r.subject_id IN (pg_temp.s('pipeline')::uuid, pg_temp.s('grp')::uuid,
                                                          pg_temp.s('product')::uuid)), true);
SELECT pg_temp.act(pg_temp.s('seller')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM analytics.daily_rollups r
                    WHERE r.day = DATE '2024-07-03' AND r.subject_kind = 'listing'
                      AND r.subject_id IN (pg_temp.s('pipeline')::uuid, pg_temp.s('grp')::uuid,
                                           pg_temp.s('product')::uuid)) = pg_temp.s('total')::bigint,
                  'the owner reads every row of their listings');
RESET ROLE;
SELECT pg_temp.act(pg_temp.s('stranger')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM analytics.daily_rollups r
                    WHERE r.day = DATE '2024-07-03' AND r.subject_kind = 'listing'
                      AND r.subject_id IN (pg_temp.s('pipeline')::uuid, pg_temp.s('grp')::uuid,
                                           pg_temp.s('product')::uuid)) = 0,
                  'a stranger reads none');
RESET ROLE;

SELECT pg_temp.ok(pg_catalog.has_function_privilege('authenticated', 'catalogue.get_listing_rollups(uuid[], date, date)', 'EXECUTE')
                  AND NOT pg_catalog.has_function_privilege('anon', 'catalogue.get_listing_rollups(uuid[], date, date)', 'EXECUTE'),
                  'get_listing_rollups: a signed-in caller may call it, a guest may not');
SELECT pg_temp.act(pg_temp.s('seller')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.get_listing_rollups(
                       ARRAY[pg_temp.s('pipeline'), pg_temp.s('grp'), pg_temp.s('product')]::uuid[],
                       DATE '2024-07-03', DATE '2024-07-03')) = pg_temp.s('total')::bigint,
                  'get_listing_rollups: the owner reads every row of their listings');
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.get_listing_rollups(
                       ARRAY[pg_temp.s('pipeline')]::uuid[], DATE '2024-07-10', DATE '2024-07-20')) = 0,
                  'get_listing_rollups: a window that misses the day reads nothing');
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.get_listing_rollups(
                       ARRAY[pg_temp.s('pipeline')]::uuid[], DATE '2022-01-01', DATE '2024-07-05')) = 0,
                  'get_listing_rollups: a window over 800 days reads nothing');
RESET ROLE;
SELECT pg_temp.act(pg_temp.s('stranger')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.get_listing_rollups(
                       ARRAY[pg_temp.s('pipeline'), pg_temp.s('grp'), pg_temp.s('product')]::uuid[],
                       DATE '2024-07-01', DATE '2024-07-05')) = 0,
                  'get_listing_rollups: a stranger reads none (INVOKER, the table''s policy decides)');
RESET ROLE;
-- #endregion

-- #region 4b. A team listing answers to the team's managers, not to every member
DO $$
DECLARE r record;
BEGIN
    SELECT l.id AS listing, mgr.user_id AS manager, mem.user_id AS member
      INTO r
      FROM catalogue.listings l
      JOIN org.team_members mgr ON mgr.team_id = l.owner_team_id AND mgr.status = 'active'
                               AND mgr.user_id <> l.owner_user_id
                               AND 'publish_listings' = ANY (org.fn_member_capabilities('team', l.owner_team_id, mgr.user_id))
      JOIN org.team_members mem ON mem.team_id = l.owner_team_id AND mem.status = 'active'
                               AND NOT 'publish_listings' = ANY (org.fn_member_capabilities('team', l.owner_team_id, mem.user_id))
     WHERE l.owner_team_id IS NOT NULL
     ORDER BY l.id, mgr.user_id, mem.user_id
     LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PROBE FAIL: no team listing with a non-owner manager and a plain member';
    END IF;
    PERFORM pg_catalog.set_config('probe.team_listing', r.listing::text, true);
    PERFORM pg_catalog.set_config('probe.team_manager', r.manager::text, true);
    PERFORM pg_catalog.set_config('probe.team_member', r.member::text, true);
    INSERT INTO analytics.daily_rollups (day, metric, subject_kind, subject_id, value)
    VALUES (DATE '2024-07-03', 'listing.views', 'listing', r.listing, 3)
    ON CONFLICT (day, metric, subject_kind, subject_id, dimensions) DO UPDATE SET value = 3;
END $$;
SELECT pg_temp.act(pg_temp.s('team_manager')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM analytics.daily_rollups r WHERE r.day = DATE '2024-07-03'
                           AND r.subject_kind = 'listing' AND r.subject_id = pg_temp.s('team_listing')::uuid),
                  'a team member holding publish_listings reads the team listing''s rows');
RESET ROLE;
SELECT pg_temp.act(pg_temp.s('team_member')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM analytics.daily_rollups r WHERE r.day = DATE '2024-07-03'
                               AND r.subject_kind = 'listing' AND r.subject_id = pg_temp.s('team_listing')::uuid),
                  'a plain member of the same team reads none');
RESET ROLE;
-- #endregion

-- #region 5. The client pipeline: one row per arm for the seller, none for anyone else
SELECT pg_temp.nobody();
DO $$
DECLARE
    v_seller uuid := pg_temp.s('seller')::uuid;
    v_buyer uuid := pg_temp.s('buyer')::uuid;
    v_id uuid;
BEGIN
    INSERT INTO comms.dm_threads (kind, created_by_user_id, subject_listing_id)
    VALUES ('service_inquiry', v_buyer, pg_temp.s('pipeline')::uuid) RETURNING id INTO v_id;
    INSERT INTO comms.dm_participants (thread_id, user_id) VALUES (v_id, v_seller), (v_id, v_buyer);
    INSERT INTO comms.dm_messages (thread_id, sender_user_id, body) VALUES (v_id, v_buyer, 'Is this available in May?');
    PERFORM pg_catalog.set_config('probe.thread', v_id::text, true);

    INSERT INTO marketplace.quote_requests (blueprint_id, host_user_id, requester_user_id, scope)
    VALUES (pg_temp.s('pipeline_bp')::uuid, v_seller, v_buyer, 'A logo and a style guide') RETURNING id INTO v_id;
    PERFORM pg_catalog.set_config('probe.quote', v_id::text, true);

    INSERT INTO scheduling.discovery_calls (host_schedule_id, host_user_id, requester_user_id, proposed_start,
                                            proposed_end, service_blueprint_id)
    VALUES (pg_temp.s('schedule')::uuid, v_seller, v_buyer, now() + interval '3 days',
            now() + interval '3 days 30 minutes', pg_temp.s('pipeline_bp')::uuid)
    RETURNING id INTO v_id;
    PERFORM pg_catalog.set_config('probe.call', v_id::text, true);

    INSERT INTO projects.projects (owner_user_id, title, status, visibility, source_blueprint_id, currency)
    VALUES (v_buyer, 'Probe pipeline engagement', 'draft', 'unlisted', pg_temp.s('pipeline_bp')::uuid, 'GBP')
    RETURNING id INTO v_id;
    INSERT INTO projects.project_participants (project_id, profile_type, profile_id, role)
    VALUES (v_id, 'freelancer', v_seller, 'freelancer');
    PERFORM pg_catalog.set_config('probe.project', v_id::text, true);
END $$;

CREATE TEMP TABLE probe_ids (kind text, id uuid);
INSERT INTO probe_ids VALUES
    ('inquiry', pg_temp.s('thread')::uuid), ('quote', pg_temp.s('quote')::uuid),
    ('discovery_call', pg_temp.s('call')::uuid), ('order', pg_temp.s('order_line')::uuid),
    ('session_booking', pg_temp.s('membership')::uuid), ('pipeline_project', pg_temp.s('project')::uuid);
GRANT SELECT ON probe_ids TO authenticated;

SELECT pg_temp.act(pg_temp.s('seller')); SET LOCAL ROLE authenticated;
CREATE TEMP TABLE probe_seen ON COMMIT DROP AS
    SELECT p.* FROM catalogue.get_client_pipeline(NULL, 500) p JOIN probe_ids i ON i.id = p.engagement_id;
SELECT pg_temp.ok((SELECT count(*) FROM probe_seen) = 6
                  AND (SELECT count(DISTINCT engagement_kind) FROM probe_seen) = 6
                  AND NOT EXISTS (SELECT 1 FROM probe_seen s JOIN probe_ids i ON i.id = s.engagement_id
                                   WHERE i.kind <> s.engagement_kind),
                  'the seller gets exactly one row per arm');
SELECT pg_temp.ok((SELECT status FROM probe_seen WHERE engagement_kind = 'quote') = 'sent'
                  AND (SELECT status FROM probe_seen WHERE engagement_kind = 'discovery_call') = 'proposed'
                  AND (SELECT status FROM probe_seen WHERE engagement_kind = 'order') = 'confirmed'
                  AND (SELECT status FROM probe_seen WHERE engagement_kind = 'pipeline_project') = 'draft',
                  'each row carries its source table''s own status');
SELECT pg_temp.ok((SELECT action_reasons FROM probe_seen WHERE engagement_kind = 'inquiry') = ARRAY['inquiry_unanswered']
                  AND (SELECT action_reasons FROM probe_seen WHERE engagement_kind = 'quote') = ARRAY['inquiry_unanswered'],
                  'an inquiry and a quote the seller has not answered wait on them');
SELECT pg_temp.ok((SELECT href FROM probe_seen WHERE engagement_kind = 'pipeline_project') ~ '^/projects/prj-'
                  AND (SELECT href FROM probe_seen WHERE engagement_kind = 'inquiry') = '/messages/' || pg_temp.s('thread')
                  AND (SELECT next_event_at FROM probe_seen WHERE engagement_kind = 'discovery_call') IS NOT NULL,
                  'deep links and the next event');
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.get_client_pipeline(pg_temp.s('product')::uuid, 500)) >= 1
                  AND NOT EXISTS (SELECT 1 FROM catalogue.get_client_pipeline(pg_temp.s('product')::uuid, 500) p
                                   WHERE p.listing_id <> pg_temp.s('product')::uuid),
                  'p_listing narrows to one listing');
RESET ROLE;

SELECT pg_temp.act(pg_temp.s('buyer')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM catalogue.get_client_pipeline(NULL, 500) p
                               JOIN probe_ids i ON i.id = p.engagement_id),
                  'the buyer, a party to every engagement, does not get the seller''s pipeline');
RESET ROLE;

SELECT pg_temp.act(pg_temp.s('stranger')); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.get_client_pipeline(pg_temp.s('pipeline')::uuid, 500)) = 0
                  AND (SELECT count(*) FROM catalogue.fn_seller_order_lines(pg_temp.s('product')::uuid)) = 0
                  AND NOT EXISTS (SELECT 1 FROM catalogue.get_client_pipeline(NULL, 500) p
                                   JOIN probe_ids i ON i.id = p.engagement_id),
                  'a stranger gets zero rows');
RESET ROLE;
SELECT pg_temp.ok(NOT pg_catalog.has_function_privilege('anon', 'catalogue.get_client_pipeline(uuid, integer)', 'EXECUTE')
                  AND NOT pg_catalog.has_function_privilege('anon', 'catalogue.fn_seller_order_lines(uuid)', 'EXECUTE'),
                  'a guest may not call the pipeline or its order helper');
-- #endregion

ROLLBACK;
