-- listing_view_events.sql — probe for a listing's page views and the console counters (MARKETPLACE SC5).
--
-- A 'view' row in search.interest_events is counted at most once per viewer per listing per 30
-- minutes (the viewer is the signed-in person, else the guest's session), never for the listing's own
-- seller or a member of its owning team, and never without a visitor; every other event type is
-- stored as sent. analytics.fn_rollup_listings then derives catalogue.listings.view_count and
-- order_count from the listing rollups. Fixtures come from the seed; every row lands on 2024-08-01
-- (a day no seed or other probe uses). One transaction, ROLLED BACK. Run after `deno task db:reset`:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q < supabase/probes/listing_view_events.sql
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

-- The 'view' rows stored for one entity on the probe day, by visitor.
CREATE FUNCTION pg_temp.views(p_entity text, p_visitor text DEFAULT NULL) RETURNS bigint LANGUAGE sql AS $$
    SELECT pg_catalog.count(*) FROM search.interest_events e
     WHERE e.event_type = 'view' AND e.entity_id = pg_temp.s(p_entity)::uuid
       AND e.created_at >= '2024-08-01 00:00Z' AND e.created_at < '2024-08-02 00:00Z'
       AND (p_visitor IS NULL OR COALESCE(e.user_id::text, e.session_id) = p_visitor);
$$;

-- All-time sum of one rollup metric for one listing: what the console counter must equal.
CREATE FUNCTION pg_temp.total(p_metric text, p_listing text) RETURNS integer LANGUAGE sql AS $$
    SELECT COALESCE(pg_catalog.sum(r.value), 0)::integer FROM analytics.daily_rollups r
     WHERE r.subject_kind = 'listing' AND r.subject_id = pg_temp.s(p_listing)::uuid
       AND r.metric = p_metric AND r.dimensions = '{}'::jsonb;
$$;

CREATE FUNCTION pg_temp.counter(p_column text, p_listing text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
    EXECUTE pg_catalog.format('SELECT %I FROM catalogue.listings WHERE id = $1', p_column)
       INTO v USING pg_temp.s(p_listing)::uuid;
    RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.s(text), pg_temp.ok(boolean, text) TO anon, authenticated;
-- #endregion

-- #region Fixture: a personal service, a team listing with a member, a product, a second persona
DO $$
DECLARE r record; t record; p record; v_viewer uuid; v_other uuid;
BEGIN
    SELECT l.id, l.owner_user_id AS seller, l.service_blueprint_id AS entity
      INTO r
      FROM catalogue.listings l
     WHERE l.kind = 'service' AND l.status = 'published' AND l.owner_team_id IS NULL
     ORDER BY l.id LIMIT 1;
    SELECT l.id, tm.user_id AS member,
           CASE WHEN l.kind = 'service' THEN l.service_blueprint_id ELSE l.product_id END AS entity,
           CASE WHEN l.kind = 'service' THEN 'service' ELSE 'product' END AS entity_type
      INTO t
      FROM catalogue.listings l
      JOIN org.team_members tm ON tm.team_id = l.owner_team_id AND tm.status = 'active'
     WHERE l.status = 'published' AND l.owner_team_id IS NOT NULL
       AND tm.user_id <> l.owner_user_id
     ORDER BY l.id, tm.user_id LIMIT 1;
    SELECT l.id, l.product_id AS entity
      INTO p
      FROM catalogue.listings l
     WHERE l.kind = 'product' AND l.status = 'published'
     ORDER BY l.id LIMIT 1;
    IF r.id IS NULL OR t.id IS NULL OR p.id IS NULL THEN
        RAISE EXCEPTION 'PROBE FAIL: no personal service, team listing with a member, or product — run `deno task db:reset`';
    END IF;
    -- An adult who neither owns the service nor belongs to the team that owns the team listing.
    SELECT u.user_id INTO v_viewer FROM org.users_public u
     WHERE u.user_id <> r.seller AND u.dob < CURRENT_DATE - INTERVAL '18 years'
       AND NOT EXISTS (SELECT 1 FROM org.team_members m JOIN catalogue.listings l ON l.owner_team_id = m.team_id
                        WHERE m.user_id = u.user_id AND l.id = t.id)
     ORDER BY u.username LIMIT 1;
    -- A listing the probe day never touches, so its counters must not move.
    SELECT l.id INTO v_other FROM catalogue.listings l
     WHERE l.id NOT IN (r.id, t.id, p.id) ORDER BY l.id LIMIT 1;

    PERFORM pg_catalog.set_config('probe.service', r.id::text, true);
    PERFORM pg_catalog.set_config('probe.service_bp', r.entity::text, true);
    PERFORM pg_catalog.set_config('probe.seller', r.seller::text, true);
    PERFORM pg_catalog.set_config('probe.team_listing', t.id::text, true);
    PERFORM pg_catalog.set_config('probe.team_entity', t.entity::text, true);
    PERFORM pg_catalog.set_config('probe.team_entity_type', t.entity_type, true);
    PERFORM pg_catalog.set_config('probe.member', t.member::text, true);
    PERFORM pg_catalog.set_config('probe.product', p.id::text, true);
    PERFORM pg_catalog.set_config('probe.product_id', p.entity::text, true);
    PERFORM pg_catalog.set_config('probe.viewer', v_viewer::text, true);
    PERFORM pg_catalog.set_config('probe.other', v_other::text, true);
    PERFORM pg_catalog.set_config('probe.other_views', (SELECT l.view_count::text FROM catalogue.listings l WHERE l.id = v_other), true);
    PERFORM pg_catalog.set_config('probe.other_orders', (SELECT l.order_count::text FROM catalogue.listings l WHERE l.id = v_other), true);
END $$;
-- #endregion

-- #region 1. A second persona's view counts once in 30 minutes
SELECT pg_temp.act(pg_temp.s('viewer')); SET LOCAL ROLE authenticated;
INSERT INTO search.interest_events (user_id, session_id, event_type, entity_id, entity_type, created_at)
VALUES (pg_temp.s('viewer')::uuid, 'viewer-tab', 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 10:00Z');
INSERT INTO search.interest_events (user_id, session_id, event_type, entity_id, entity_type, created_at)
VALUES (pg_temp.s('viewer')::uuid, 'viewer-tab-2', 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 10:29Z');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.views('service_bp', pg_temp.s('viewer')) = 1,
                  'a signed-in viewer''s repeat inside 30 minutes is not stored, even from another tab');

SELECT pg_temp.act(pg_temp.s('viewer')); SET LOCAL ROLE authenticated;
INSERT INTO search.interest_events (user_id, session_id, event_type, entity_id, entity_type, created_at)
VALUES (pg_temp.s('viewer')::uuid, 'viewer-tab', 'impression', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 10:01Z'),
       (pg_temp.s('viewer')::uuid, 'viewer-tab', 'impression', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 10:02Z');
RESET ROLE;
SELECT pg_temp.ok((SELECT pg_catalog.count(*) FROM search.interest_events e
                    WHERE e.event_type = 'impression' AND e.entity_id = pg_temp.s('service_bp')::uuid
                      AND e.created_at >= '2024-08-01' AND e.created_at < '2024-08-02') = 2,
                  'every other event type is stored as sent');
-- #endregion

-- #region 2. A guest is counted by session
SELECT pg_temp.nobody(); SET LOCAL ROLE anon;
INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, created_at) VALUES
    ('guest-1', 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 11:00Z');
INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, created_at) VALUES
    ('guest-1', 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 11:20Z');
INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, created_at) VALUES
    ('guest-1', 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 11:40Z');
INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, created_at) VALUES
    ('guest-2', 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 11:05Z');
INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, created_at) VALUES
    (NULL, 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 11:06Z');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.views('service_bp', 'guest-1') = 2,
                  'a guest session: 11:20 falls inside 11:00''s 30 minutes, 11:40 does not');
SELECT pg_temp.ok(pg_temp.views('service_bp', 'guest-2') = 1, 'a second guest session counts on its own');
SELECT pg_temp.ok(pg_temp.views('service_bp') = 4, 'a view with no visitor at all is not stored');
-- #endregion

-- #region 3. Never the seller's own view, nor the owning team's
SELECT pg_temp.act(pg_temp.s('seller')); SET LOCAL ROLE authenticated;
INSERT INTO search.interest_events (user_id, session_id, event_type, entity_id, entity_type, created_at)
VALUES (pg_temp.s('seller')::uuid, 'seller-tab', 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 12:00Z');
INSERT INTO search.interest_events (user_id, session_id, event_type, entity_id, entity_type, created_at)
VALUES (NULL, 'seller-tab-2', 'view', pg_temp.s('service_bp')::uuid, 'service', '2024-08-01 13:00Z');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.views('service_bp') = 4,
                  'the seller''s own view is not stored, attributed or sent unattributed under their token');

SELECT pg_temp.act(pg_temp.s('member')); SET LOCAL ROLE authenticated;
INSERT INTO search.interest_events (user_id, session_id, event_type, entity_id, entity_type, created_at)
VALUES (pg_temp.s('member')::uuid, 'member-tab', 'view', pg_temp.s('team_entity')::uuid,
        pg_temp.s('team_entity_type'), '2024-08-01 12:00Z');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.views('team_entity') = 0, 'an active member of the owning team is not a viewer');

SELECT pg_temp.act(pg_temp.s('viewer')); SET LOCAL ROLE authenticated;
INSERT INTO search.interest_events (user_id, session_id, event_type, entity_id, entity_type, created_at)
VALUES (pg_temp.s('viewer')::uuid, 'viewer-tab', 'view', pg_temp.s('team_entity')::uuid,
        pg_temp.s('team_entity_type'), '2024-08-01 12:00Z');
RESET ROLE;
SELECT pg_temp.ok(pg_temp.views('team_entity') = 1, 'the same team listing counts an outsider');
-- #endregion

-- #region 4. The rollup counts them and derives the console counters
DO $$
DECLARE v_buyer uuid := pg_temp.s('viewer')::uuid; v_order uuid;
BEGIN
    INSERT INTO finance.orders (reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor,
                                platform_fee_bp, total_minor, idempotency_key, updated_at)
    VALUES ('PJ-PROBE-SC5', 'confirmed', '2024-08-01 14:00Z', 'user', v_buyer, 'GBP', 1200, 0, 1200,
            'probe-sc5-order', '2024-08-01 14:00Z')
    RETURNING id INTO v_order;
    INSERT INTO finance.order_lines (order_id, item_type, item_id, title, line_total_minor, currency)
    VALUES (v_order, 'digital_product', pg_temp.s('product_id')::uuid, 'Probe product', 1200, 'GBP');
END $$;

SELECT set_config('probe.views_before', pg_temp.total('listing.views', 'service')::text, true);
SELECT set_config('probe.orders_before', pg_temp.total('listing.orders', 'product')::text, true);
SELECT analytics.fn_rollup_listings(DATE '2024-08-01');

SELECT pg_temp.ok((SELECT r.value FROM analytics.daily_rollups r
                    WHERE r.day = DATE '2024-08-01' AND r.metric = 'listing.views'
                      AND r.subject_kind = 'listing' AND r.subject_id = pg_temp.s('service')::uuid) = 3,
                  'the day''s views are its distinct visitors: the persona and two guest sessions');
SELECT pg_temp.ok(pg_temp.total('listing.views', 'service') = pg_temp.s('views_before')::integer + 3,
                  'the rollup adds the day''s views to the listing''s total');
SELECT pg_temp.ok(pg_temp.counter('view_count', 'service') = pg_temp.total('listing.views', 'service'),
                  'listings.view_count is the listing''s rolled-up views, all time');
SELECT pg_temp.ok(pg_temp.counter('order_count', 'product') = pg_temp.total('listing.orders', 'product')
                  AND pg_temp.total('listing.orders', 'product') = pg_temp.s('orders_before')::integer + 1,
                  'listings.order_count is the listing''s rolled-up orders, all time');
SELECT pg_temp.ok(pg_temp.counter('view_count', 'other') = pg_temp.s('other_views')::integer
                  AND pg_temp.counter('order_count', 'other') = pg_temp.s('other_orders')::integer,
                  'a listing the day did not touch keeps its counters');

SELECT set_config('probe.counted', pg_temp.counter('view_count', 'service')::text, true);
SELECT analytics.fn_rollup_listings(DATE '2024-08-01');
SELECT pg_temp.ok(pg_temp.counter('view_count', 'service') = pg_temp.s('counted')::integer,
                  'a re-run leaves the counters where they were');

DELETE FROM search.interest_events e
 WHERE e.event_type = 'view' AND e.entity_id = pg_temp.s('service_bp')::uuid
   AND e.created_at >= '2024-08-01' AND e.created_at < '2024-08-02';
SELECT analytics.fn_rollup_listings(DATE '2024-08-01');
SELECT pg_temp.ok(pg_temp.counter('view_count', 'service') = pg_temp.s('counted')::integer - 3,
                  'a day whose views are gone takes them back out of the counter');
-- #endregion

-- #region 5. The derived guard still refuses a client write to the counters
SELECT pg_temp.act(pg_temp.s('seller')); SET LOCAL ROLE authenticated;
DO $$
BEGIN
    UPDATE catalogue.listings SET view_count = view_count + 100 WHERE id = pg_temp.s('service')::uuid;
    RAISE EXCEPTION 'PROBE FAIL: the seller wrote view_count directly';
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok  the seller cannot write view_count (42501)';
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
