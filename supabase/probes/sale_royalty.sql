-- =============================================================================================
-- Probe: a request to sell, the client's grant, and the royalty on every sale (MARKETPLACE SC7;
-- Decision #493).
--
--   1. catalogue.request_sale refuses anyone the stage did not pay, a stage that is not released, a
--      Projective Partner stage, a royalty over the ceiling, a file not delivered on the stage, and a
--      file with no whole-file fingerprint; a second open request on one stage refuses.
--   2. A request waits for the client: the grant is refused while `sale_grants_enabled` is off, and
--      by anyone but the client; with it on (set here, rolled back), a grant of some of the files
--      mints the maker's draft with provenance, and a second decision refuses.
--   3. The draft publishes only granted files (catalogue.fn_freeze_product_version).
--   4. A sale pays the seller, the platform and the client exactly: the commission first, then the
--      royalty floored from what is left, credited pending to the client; money is conserved, and a
--      cancel recovers both credits.
--   5. A person client whose account was erased is paid nothing, and the seller keeps it.
--   6. A shared-ownership stage lists at once, with no grant and no royalty, and the client is told.
--   7. Decline, withdraw and the project read.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/sale_royalty.sql
--
-- Fixtures are discovered from the seed: a released stage paid to a person, with a file they delivered
-- that has a whole-file fingerprint, on a project whose client is a business with a member holding
-- manage_projects. Conservation is checked as a change. A clean run prints only `ok` notices.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.s(p_key text) RETURNS text LANGUAGE sql AS $$
    SELECT pg_catalog.current_setting('probe.' || p_key);
$$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

CREATE FUNCTION pg_temp.try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ': ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.imbalance(p_currency text) RETURNS bigint LANGUAGE sql AS $$
    SELECT COALESCE((SELECT imbalance_minor FROM finance.v_conservation_identity WHERE currency = p_currency), 0);
$$;

CREATE FUNCTION pg_temp.request(p_title text, p_files uuid[], p_bp integer) RETURNS text LANGUAGE sql AS $$
    SELECT pg_temp.try(pg_catalog.format('SELECT catalogue.request_sale(%L, %L, %L::uuid[], %s, %L)',
        pg_temp.s('stage'), p_title, p_files, COALESCE(p_bp::text, 'NULL'), 'Probe SC7'));
$$;

-- Buy a product from a person's own USD wallet, as checkout does; the order line id.
CREATE FUNCTION pg_temp.buy(p_buyer uuid, p_product uuid, p_key text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_price bigint := (SELECT price_cents FROM catalogue.products WHERE id = p_product);
    v_basket uuid;
    v_item uuid;
    v_out jsonb;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES (finance.fn_person_wallet_type(p_buyer), p_buyer, 'Probe SC7') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency,
                                      destination_email, metadata)
    SELECT v_basket, 'digital_product', p.id, p.title, p.price_cents, p.currency, 'probe-sc7@example.com',
           '{"deliveryTermsAccepted": true}'::jsonb
      FROM catalogue.products p WHERE p.id = p_product
    RETURNING id INTO v_item;
    PERFORM pg_temp.act(p_buyer);
    v_out := finance.place_wallet_order(v_basket, ARRAY[v_item], 'USD', pg_catalog.jsonb_build_object(v_item::text, v_price),
        NULL, p_key, v_price);
    RETURN (SELECT ol.id FROM finance.order_lines ol
             WHERE ol.order_id = (v_out ->> 'order_id')::uuid AND ol.item_type = 'digital_product');
END $$;

-- Publish a minted draft as the probe's setup does it: priced in USD, its listing marked published with
-- the publish triggers held (the payout and cover gates are other probes'), then frozen as the maker.
CREATE FUNCTION pg_temp.publish(p_product uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_listing uuid := (SELECT id FROM catalogue.listings WHERE product_id = p_product);
BEGIN
    UPDATE catalogue.products SET price_cents = 10000, currency = 'USD' WHERE id = p_product;
    SET LOCAL session_replication_role = replica;
    UPDATE catalogue.listings SET status = 'published', published_at = pg_catalog.now(), currency = 'USD' WHERE id = v_listing;
    SET LOCAL session_replication_role = origin;
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    RETURN pg_temp.try(pg_catalog.format('SELECT catalogue.fn_freeze_product_version(%L)', v_listing));
END $$;
-- #endregion

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    f record;
    v_other uuid;
    v_buyer uuid;
    v_spare uuid;
BEGIN
    SELECT st.id AS stage, p.id AS project, e.payee_id AS maker, sf.file_id AS file,
           p.client_business_id AS business, p.owner_user_id AS decider
      INTO f
      FROM projects.project_stages st
      JOIN projects.projects p ON p.id = st.project_id
      JOIN finance.escrows e ON e.project_stage_id = st.id AND e.status = 'released' AND e.payee_type = 'freelancer'
      JOIN projects.stage_submissions sub ON sub.project_stage_id = st.id AND sub.submitted_by = e.payee_id
      JOIN projects.submission_files sf ON sf.submission_id = sub.id
      JOIN files.items fi ON fi.id = sf.file_id AND fi.hash_algo = 'sha-256' AND NOT fi.hash_sampled
     WHERE st.status = 'paid' AND st.ip_mode = 'exclusive_transfer' AND p.client_business_id IS NOT NULL
     ORDER BY st.id
     LIMIT 1;
    PERFORM pg_temp.ok(f.stage IS NOT NULL,
        'fixture: a released stage paid to a person, with a fingerprinted file they delivered (deno task db:reset)');
    PERFORM pg_temp.act(f.decider);
    PERFORM pg_temp.ok(org.fn_member_can('business', f.business, 'manage_projects'),
        'fixture: a member of the client business holding manage_projects');
    -- A second delivered file with no fingerprint, and a library file of the maker's never delivered.
    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes, status, source)
    SELECT f.maker, 'assets', f.maker || '/probe-sc7/unhashed-asset.png', 'unhashed-asset.png', 'unhashed-asset.png', 'image/png', 1000, 'uploaded', 'supabase'
    RETURNING id INTO v_spare;
    INSERT INTO projects.submission_files (submission_id, file_id)
    SELECT sub.id, v_spare FROM projects.stage_submissions sub
     WHERE sub.project_stage_id = f.stage AND sub.submitted_by = f.maker ORDER BY sub.id LIMIT 1;
    SELECT u.user_id INTO v_other FROM org.users_public u
     WHERE u.user_id NOT IN (f.maker, f.decider) AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM ops.admin_users au WHERE au.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id NOT IN (f.maker, f.decider, v_other) AND NOT org.fn_is_minor(u.user_id)
     ORDER BY u.user_id DESC LIMIT 1;
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_buyer), v_buyer, 'USD');
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', 1000000,
        'topup', 'inbound_payments', gen_random_uuid());
    UPDATE security.platform_params SET value = 'false'::jsonb WHERE key = 'sale_grants_enabled';
    UPDATE security.feature_flags SET enabled = false WHERE key = 'finance.delivered_refund_refusal';
    PERFORM pg_catalog.set_config('probe.stage', f.stage::text, true);
    PERFORM pg_catalog.set_config('probe.project', f.project::text, true);
    PERFORM pg_catalog.set_config('probe.maker', f.maker::text, true);
    PERFORM pg_catalog.set_config('probe.file', f.file::text, true);
    PERFORM pg_catalog.set_config('probe.unhashed', v_spare::text, true);
    PERFORM pg_catalog.set_config('probe.business', f.business::text, true);
    PERFORM pg_catalog.set_config('probe.decider', f.decider::text, true);
    PERFORM pg_catalog.set_config('probe.other', v_other::text, true);
    PERFORM pg_catalog.set_config('probe.buyer', v_buyer::text, true);
END $$;
-- #endregion

-- #region 1. Who may ask, and what
DO $$
DECLARE
    v_file uuid := pg_temp.s('file')::uuid;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('other')::uuid);
    PERFORM pg_temp.ok(pg_temp.request('Tokens kit', ARRAY[v_file], 1000) LIKE 'P0002%',
        'request: someone the stage did not pay is refused (P0002)');
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    PERFORM pg_temp.ok(pg_temp.request('Tokens kit', ARRAY[v_file], 6000) LIKE '22023%royalty%',
        'request: a royalty over 50 % of the seller''s net is refused');
    PERFORM pg_temp.ok(pg_temp.request('Tokens kit', ARRAY[gen_random_uuid()], 1000) LIKE '22023%delivered%',
        'request: a file not delivered on the stage is refused');
    PERFORM pg_temp.ok(pg_temp.request('Tokens kit', ARRAY[pg_temp.s('unhashed')::uuid], 1000) LIKE '22023%fingerprint%',
        'request: a file with no whole-file fingerprint cannot be the link, and is refused');
END $$;
SAVEPOINT s_gates;
UPDATE projects.project_stages SET ip_mode = 'projective_partner' WHERE id = pg_temp.s('stage')::uuid;
DO $$ BEGIN
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    PERFORM pg_temp.ok(pg_temp.request('Tokens kit', ARRAY[pg_temp.s('file')::uuid], 1000) LIKE 'PG409%Partner%',
        'request: a Projective Partner stage is refused');
END $$;
ROLLBACK TO SAVEPOINT s_gates;
SET LOCAL session_replication_role = replica;
UPDATE projects.project_stages SET status = 'approved' WHERE id = pg_temp.s('stage')::uuid;
SET LOCAL session_replication_role = origin;
DO $$ BEGIN
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    PERFORM pg_temp.ok(pg_temp.request('Tokens kit', ARRAY[pg_temp.s('file')::uuid], 1000) LIKE 'PG409%released%',
        'request: a stage that is not released is refused');
END $$;
ROLLBACK TO SAVEPOINT s_gates;
RELEASE SAVEPOINT s_gates;
-- #endregion

-- #region 2. The request, the switch and the grant
DO $$
DECLARE
    v_out jsonb;
    v_req uuid;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    v_out := catalogue.request_sale(pg_temp.s('stage')::uuid, 'Meridian tokens kit',
        ARRAY[pg_temp.s('file')::uuid], 2000, 'I''d like to sell the token set.');
    v_req := (v_out ->> 'request_id')::uuid;
    PERFORM pg_temp.ok(v_out ->> 'status' = 'requested' AND NOT (v_out ? 'listing_id'),
        'request: an exclusive_transfer stage waits for the client, and mints nothing yet');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = pg_temp.s('decider')::uuid
                                AND n.type = 'sale_request.received' AND n.entity_id = v_req),
        'request: the client is told');
    PERFORM pg_temp.ok(pg_temp.request('Again', ARRAY[pg_temp.s('file')::uuid], 1000) LIKE 'PG409%already asked%',
        'request: a second open request on the stage is refused');
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT catalogue.decide_sale_request(%L, true)', v_req)) LIKE 'P0002%',
        'grant: the maker cannot grant their own request (P0002)');
    PERFORM pg_temp.act(pg_temp.s('decider')::uuid);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT catalogue.decide_sale_request(%L, true)', v_req)) LIKE '55000%counsel%',
        'grant: refused while sale_grants_enabled is off (counsel writes the licence)');
    PERFORM pg_catalog.set_config('probe.request', v_req::text, true);
END $$;

UPDATE security.platform_params SET value = 'true'::jsonb WHERE key = 'sale_grants_enabled';
DO $$
DECLARE
    v_req uuid := pg_temp.s('request')::uuid;
    v_out jsonb;
    v_product catalogue.products;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('other')::uuid);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT catalogue.decide_sale_request(%L, true)', v_req)) LIKE 'P0002%',
        'grant: someone who is not the client cannot grant (P0002)');
    PERFORM pg_temp.act(pg_temp.s('decider')::uuid);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT catalogue.decide_sale_request(%L, true, %L::uuid[])',
            v_req, ARRAY[gen_random_uuid()])) LIKE '22023%',
        'grant: only files that were asked for can be granted');
    v_out := catalogue.decide_sale_request(v_req, true, ARRAY[pg_temp.s('file')::uuid], 'The token set only, not the logo.');
    SELECT * INTO v_product FROM catalogue.products WHERE id = (v_out ->> 'product_id')::uuid;
    PERFORM pg_temp.ok(v_out ->> 'status' = 'approved' AND v_product.sale_request_id = v_req
        AND v_product.owner_user_id = pg_temp.s('maker')::uuid AND v_product.price_cents = 0
        AND v_product.file_manifest -> 0 ->> 'fileId' = pg_temp.s('file'),
        'grant: a draft product is minted for the maker, naming the request and delivering the granted file');
    PERFORM pg_temp.ok((SELECT status = 'draft' FROM catalogue.listings WHERE product_id = v_product.id),
        'grant: its listing is a draft the maker publishes through the normal gate');
    PERFORM pg_temp.ok((SELECT sr.files -> 0 ->> 'sha256' = fi.content_hash AND sr.scope_note LIKE 'The token set%'
                          FROM catalogue.sale_requests sr, files.items fi
                         WHERE sr.id = v_req AND fi.id = pg_temp.s('file')::uuid),
        'grant: the provenance carries each granted file''s SHA-256 and the client''s own words');
    PERFORM pg_temp.ok((SELECT ip_mode FROM projects.project_stages WHERE id = pg_temp.s('stage')::uuid) = 'exclusive_transfer',
        'grant: the stage''s IP mode is left as it was');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = pg_temp.s('maker')::uuid
                                AND n.type = 'sale_request.approved' AND n.entity_id = v_req),
        'grant: the maker is told');
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT catalogue.decide_sale_request(%L, false)', v_req)) LIKE 'PG409%',
        'grant: a decided request cannot be decided again');
    PERFORM pg_catalog.set_config('probe.product', v_product.id::text, true);
END $$;
-- #endregion

-- #region 3. The draft delivers granted files only
DO $$
DECLARE
    v_product uuid := pg_temp.s('product')::uuid;
    v_extra uuid;
    v_res text;
BEGIN
    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes, status, source)
    VALUES (pg_temp.s('maker')::uuid, 'assets', pg_temp.s('maker') || '/probe-sc7/logo.svg', 'logo.svg', 'logo.svg', 'image/svg+xml', 500, 'uploaded', 'supabase')
    RETURNING id INTO v_extra;
    UPDATE catalogue.products
       SET file_manifest = file_manifest || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
               'fileId', v_extra, 'name', 'logo.svg', 'label', '', 'extension', 'svg', 'bytes', 500))
     WHERE id = v_product;
    PERFORM pg_temp.ok(pg_temp.publish(v_product) LIKE 'PG422%not among the files the client granted%',
        'publish: a file the client did not grant is refused');
    UPDATE catalogue.products SET file_manifest = pg_catalog.jsonb_build_array(file_manifest -> 0) WHERE id = v_product;
    v_res := pg_temp.publish(v_product);
    PERFORM pg_temp.ok(v_res = 'ok'
        AND EXISTS (SELECT 1 FROM catalogue.product_versions WHERE product_id = v_product),
        'publish: with granted files only it freezes a version');
END $$;
-- #endregion

-- #region 4. A sale pays the seller, the platform and the client exactly
SAVEPOINT s_sale;
DO $$
DECLARE
    v_line finance.order_lines;
    v_id uuid;
    v_paid bigint;
    v_royalty bigint;
    v_gap bigint := pg_temp.imbalance('USD');
    v_seller finance.pending_releases;
    v_client finance.pending_releases;
BEGIN
    v_id := pg_temp.buy(pg_temp.s('buyer')::uuid, pg_temp.s('product')::uuid, 'probe-sc7-4');
    SELECT * INTO v_line FROM finance.order_lines WHERE id = v_id;
    v_paid := v_line.line_total_minor - v_line.promo_discount_minor;
    v_royalty := ((v_paid - v_line.platform_fee_minor) * 2000) / 10000;
    PERFORM pg_temp.ok(v_line.platform_fee_minor > 0 AND v_line.royalty_minor = v_royalty AND v_royalty > 0,
        'sale: the commission first, then 20 % of what is left, floored, recorded on the line');
    SELECT * INTO v_client FROM finance.pending_releases WHERE order_id = v_line.order_id AND reason = 'product_royalty';
    SELECT * INTO v_seller FROM finance.pending_releases WHERE order_id = v_line.order_id AND reason = 'product_sale';
    PERFORM pg_temp.ok(v_client.amount_cents = v_royalty AND v_client.state = 'pending'
        AND (SELECT w.owner_type = 'business' AND w.owner_id = pg_temp.s('business')::uuid
               FROM finance.wallets w WHERE w.id = v_client.wallet_id),
        'sale: the client business is credited the royalty through the pending window');
    PERFORM pg_temp.ok(v_seller.amount_cents = v_paid - v_line.platform_fee_minor - v_royalty
        AND v_seller.available_at = v_client.available_at,
        'sale: the seller keeps the rest, the dust of both cuts included, in the same window');
    PERFORM pg_temp.ok(pg_temp.imbalance('USD') = v_gap, 'sale: money is conserved');

    PERFORM pg_temp.act(pg_temp.s('buyer')::uuid);
    PERFORM finance.cancel_order_line(v_line.id);
    PERFORM pg_temp.ok((SELECT pg_catalog.bool_and(state = 'available' AND recovered_cents = amount_cents AND transaction_id IS NULL)
                          FROM finance.pending_releases WHERE order_id = v_line.order_id),
        'refund: a cancel takes back both the seller''s and the client''s credit');
    PERFORM pg_temp.ok(pg_temp.imbalance('USD') = v_gap, 'refund: money is conserved');
END $$;
ROLLBACK TO SAVEPOINT s_sale;

-- A product dispute (FBP DB21) holds the client's royalty with the seller's credit, and an upheld one
-- recovers both.
DO $$
DECLARE
    v_id uuid := pg_temp.buy(pg_temp.s('buyer')::uuid, pg_temp.s('product')::uuid, 'probe-sc7-4b');
    v_line finance.order_lines;
    v_d uuid;
    v_gap bigint;
    v_op uuid := (SELECT au.user_id FROM ops.admin_users au ORDER BY au.user_id LIMIT 1);
BEGIN
    SELECT * INTO v_line FROM finance.order_lines WHERE id = v_id;
    UPDATE catalogue.entitlements SET first_delivered_at = pg_catalog.now() WHERE order_line_id = v_id;
    v_gap := pg_temp.imbalance('USD');
    PERFORM pg_temp.act(pg_temp.s('buyer')::uuid);
    v_d := (finance.open_order_line_dispute(v_id, 'defective', 'The token file is empty.') ->> 'dispute_id')::uuid;
    PERFORM pg_temp.ok((SELECT pg_catalog.count(*) = 2 AND pg_catalog.bool_and(state = 'on_hold' AND hold_dispute_id = v_d)
                          FROM finance.pending_releases WHERE order_id = v_line.order_id),
        'dispute: a report holds the client''s royalty with the seller''s credit');
    PERFORM pg_temp.act(v_op);
    PERFORM finance.resolve_dispute(v_d, 'refund', NULL, 'The file is empty.');
    PERFORM pg_temp.ok((SELECT pg_catalog.bool_and(state = 'available' AND recovered_cents = amount_cents)
                          FROM finance.pending_releases WHERE order_id = v_line.order_id)
        AND pg_temp.imbalance('USD') = v_gap,
        'dispute: an upheld report recovers both, and money is conserved');
END $$;
ROLLBACK TO SAVEPOINT s_sale;
RELEASE SAVEPOINT s_sale;
-- #endregion

-- #region 5. A person client erased: the royalty stops
SAVEPOINT s_erased;
DO $$
DECLARE
    v_person uuid := pg_temp.s('other')::uuid;
    v_line finance.order_lines;
    v_id uuid;
BEGIN
    UPDATE catalogue.sale_requests SET client_business_id = NULL, client_user_id = v_person
     WHERE id = pg_temp.s('request')::uuid;
    INSERT INTO org.deletion_requests (user_id, scope, status, requested_at, scheduled_for, completed_at)
    VALUES (v_person, 'account', 'completed', pg_catalog.now() - interval '31 days', pg_catalog.now() - interval '1 day',
            pg_catalog.now() - interval '1 day');
    v_id := pg_temp.buy(pg_temp.s('buyer')::uuid, pg_temp.s('product')::uuid, 'probe-sc7-5');
    SELECT * INTO v_line FROM finance.order_lines WHERE id = v_id;
    PERFORM pg_temp.ok(v_line.royalty_minor = 0
        AND NOT EXISTS (SELECT 1 FROM finance.pending_releases WHERE order_id = v_line.order_id AND reason = 'product_royalty')
        AND (SELECT amount_cents FROM finance.pending_releases WHERE order_id = v_line.order_id AND reason = 'product_sale')
            = v_line.line_total_minor - v_line.platform_fee_minor,
        'erased: a person client whose account was erased is paid nothing, and the seller keeps it');
END $$;
ROLLBACK TO SAVEPOINT s_erased;
RELEASE SAVEPOINT s_erased;
-- #endregion

-- #region 6. Shared ownership lists at once
SAVEPOINT s_shared;
UPDATE projects.project_stages SET ip_mode = 'shared_ownership' WHERE id = pg_temp.s('stage')::uuid;
DO $$
DECLARE
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    PERFORM pg_temp.ok(pg_temp.request('Shared kit', ARRAY[pg_temp.s('file')::uuid], 500) LIKE '22023%no royalty%',
        'shared: a royalty is refused, since shared ownership carries none');
    v_out := catalogue.request_sale(pg_temp.s('stage')::uuid, 'Shared kit', ARRAY[pg_temp.s('file')::uuid], 0);
    PERFORM pg_temp.ok(v_out ->> 'status' = 'approved' AND (v_out ->> 'product_id') IS NOT NULL
        AND (SELECT decided_by IS NULL AND royalty_bp = 0 FROM catalogue.sale_requests WHERE id = (v_out ->> 'request_id')::uuid),
        'shared: the draft is minted at once, with no grant and no royalty');
    PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = pg_temp.s('decider')::uuid
                                AND n.type = 'sale_request.shared_listed'),
        'shared: the client is told');
END $$;
ROLLBACK TO SAVEPOINT s_shared;
RELEASE SAVEPOINT s_shared;
-- #endregion

-- #region 7. Decline, withdraw, and the project read
SAVEPOINT s_more;
UPDATE projects.project_stages SET ip_mode = 'licensed_use' WHERE id = pg_temp.s('stage')::uuid;
DO $$
DECLARE
    v_req uuid;
    v_read jsonb;
BEGIN
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    v_req := (catalogue.request_sale(pg_temp.s('stage')::uuid, 'Licensed kit', ARRAY[pg_temp.s('file')::uuid], 1500) ->> 'request_id')::uuid;
    PERFORM pg_temp.ok((SELECT status FROM catalogue.sale_requests WHERE id = v_req) = 'requested',
        'licensed: a licensed_use stage also waits for the client''s grant');
    v_read := catalogue.project_sale_requests(pg_temp.s('project')::uuid);
    PERFORM pg_temp.ok((v_read -> 'stages' -> 0 ->> 'stage_id') = pg_temp.s('stage')
        AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_read -> 'requests') r
                     WHERE r ->> 'id' = v_req::text AND (r ->> 'can_withdraw')::boolean AND r ->> 'role' = 'maker'),
        'read: the maker sees the stage they may sell from and can withdraw their request');
    PERFORM pg_temp.act(pg_temp.s('decider')::uuid);
    v_read := catalogue.project_sale_requests(pg_temp.s('project')::uuid);
    PERFORM pg_temp.ok(pg_catalog.jsonb_array_length(v_read -> 'stages') = 0
        AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_read -> 'requests') r
                     WHERE r ->> 'id' = v_req::text AND (r ->> 'can_decide')::boolean AND r ->> 'role' = 'client'),
        'read: the client sees the request to decide, and no stage to sell from');
    PERFORM catalogue.decide_sale_request(v_req, false, NULL, 'Ask again at 10 %.');
    PERFORM pg_temp.ok((SELECT status = 'declined' AND decision_note = 'Ask again at 10 %.' FROM catalogue.sale_requests WHERE id = v_req)
        AND EXISTS (SELECT 1 FROM comms.notifications n WHERE n.user_id = pg_temp.s('maker')::uuid
                     AND n.type = 'sale_request.declined' AND n.entity_id = v_req),
        'decline: the request reads declined with the client''s words, and the maker is told');
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    v_req := (catalogue.request_sale(pg_temp.s('stage')::uuid, 'Licensed kit', ARRAY[pg_temp.s('file')::uuid], 1000) ->> 'request_id')::uuid;
    PERFORM pg_temp.ok(v_req IS NOT NULL, 'decline: the maker may ask again');
    PERFORM pg_temp.act(pg_temp.s('decider')::uuid);
    PERFORM pg_temp.ok(pg_temp.try(pg_catalog.format('SELECT catalogue.withdraw_sale_request(%L)', v_req)) LIKE 'P0002%',
        'withdraw: only the maker who asked can withdraw (P0002)');
    PERFORM pg_temp.act(pg_temp.s('maker')::uuid);
    PERFORM catalogue.withdraw_sale_request(v_req);
    PERFORM pg_temp.ok((SELECT status FROM catalogue.sale_requests WHERE id = v_req) = 'withdrawn',
        'withdraw: the request reads withdrawn');
    PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'catalogue.sale_requests', 'INSERT')
        AND NOT has_table_privilege('authenticated', 'catalogue.sale_requests', 'DELETE')
        AND NOT has_table_privilege('anon', 'catalogue.sale_requests', 'SELECT'),
        'records: no client role writes a request to sell, and a signed-out caller reads none');
END $$;
ROLLBACK TO SAVEPOINT s_more;
RELEASE SAVEPOINT s_more;
-- #endregion

ROLLBACK;
