-- =============================================================================================
-- Probe: a bought product reaches its buyer (MARKETPLACE CK1, Decision #488; ASSET_DELIVERY_
-- ARCHITECTURE.md §6, §10, §14 Phase 0).
--
--   1. No client role writes a version or an entitlement, nor runs the service's two doors; a
--      signed-out caller reads neither table.
--   2. Publishing freezes the attached library files into version 1, in the seller's order, one entry
--      per file, never ready until the service copies the bytes; a re-publish with nothing changed
--      writes nothing; a file the draft names but the library no longer holds refuses the publish.
--   3. finance.place_wallet_order writes one entitlement for a product line, in the same transaction:
--      the newest version, held by the buyer, active, the A8 acceptance stamped only when the buyer
--      gave it, and the receipt carrying the bundle's total size. A replayed key writes no second one.
--   4. RLS: the holder reads the entitlement and its version; another person reads neither; the seller
--      reads the version, never the buyer's entitlement.
--   5. catalogue.fn_record_delivery stamps first_delivered_at once and writes a files.download_events
--      row per delivery (via purchase); a file outside the version is refused.
--   6. A re-publish with changed files makes version 2; the first buyer keeps version 1; a new buyer
--      gets version 2.
--   7. finance.place_on_account_order reaches the same write: the business holds it, an active member
--      reads it, a non-member does not.
--   8. A product that attached no library file still writes its entitlement, with no version.
--   9. Conservation (finance.v_conservation_identity, once FBP DB16 has landed): every purchase above
--      leaves each currency's imbalance where it was.
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
--     < supabase/probes/product_delivery.sql
-- Concurrency (two checkouts at once) is product_delivery_race.sql, which commits.
--
-- Fixtures are discovered from the seed: a published USD product owned by a person (no team), two
-- adult buyers who do not sell it, and a business whose owner may buy on account, plus two library
-- files written for the seller inside the transaction. A clean run prints only `ok` notices.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;
-- The pg_temp helpers below run as anon and authenticated, and 00002500 gives a new function no
-- PUBLIC EXECUTE; this hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true),
           pg_catalog.set_config('request.jwt.claims',
               CASE WHEN p_uid IS NULL THEN ''
                    ELSE pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
$$;

-- The SQLSTATE a statement raises, or NULL when it runs.
CREATE FUNCTION pg_temp.state_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
END $$;

-- One selected digital-product line in a fresh basket of the given owner, priced as the listing is;
-- `p_accept` is the A8 tick the checkout writes onto the line.
CREATE FUNCTION pg_temp.product_line(p_owner_type text, p_owner uuid, p_product uuid, p_accept boolean)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_basket uuid;
    v_line uuid;
BEGIN
    INSERT INTO finance.baskets (owner_type, owner_id, name)
    VALUES (p_owner_type, p_owner, 'Probe CK1') RETURNING id INTO v_basket;
    INSERT INTO finance.basket_items (basket_id, item_type, item_id, title, unit_price_minor, currency,
                                      destination_email, metadata)
    SELECT v_basket, 'digital_product', p.id, p.title, p.price_cents, p.currency, 'probe-ck1@example.com',
           CASE WHEN p_accept THEN '{"deliveryTermsAccepted": true}'::jsonb ELSE '{}'::jsonb END
      FROM catalogue.products p WHERE p.id = p_product
    RETURNING id INTO v_line;
    RETURN v_line;
END $$;

-- Buy one product from a person's own wallet; the order line id.
CREATE FUNCTION pg_temp.buy(p_buyer uuid, p_product uuid, p_accept boolean, p_key text) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_line uuid := pg_temp.product_line(finance.fn_person_wallet_type(p_buyer), p_buyer, p_product, p_accept);
    v_price bigint := (SELECT price_cents FROM catalogue.products WHERE id = p_product);
    v_out jsonb;
BEGIN
    PERFORM pg_temp.act(p_buyer);
    v_out := finance.place_wallet_order((SELECT basket_id FROM finance.basket_items WHERE id = v_line),
        ARRAY[v_line], 'USD', jsonb_build_object(v_line::text, v_price), NULL, p_key, v_price);
    RETURN (SELECT ol.id FROM finance.order_lines ol
             WHERE ol.order_id = (v_out ->> 'order_id')::uuid AND ol.item_type = 'digital_product');
END $$;

-- A finished library file of the seller's own, as the upload pipeline leaves one.
CREATE FUNCTION pg_temp.library_file(p_owner uuid, p_name text, p_bytes bigint) RETURNS uuid
LANGUAGE sql AS $$
    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, owner_type, source)
    VALUES (p_owner, 'personal', 'users/' || p_owner || '/library/probe-ck1/' || p_name, p_name, p_name,
            'application/zip', p_bytes, 'uploaded', 'user', 'supabase')
    RETURNING id;
$$;

-- Each currency's imbalance, as finance.v_conservation_identity reads it; '{}' before FBP DB16.
CREATE FUNCTION pg_temp.imbalance() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v jsonb;
BEGIN
    IF to_regclass('finance.v_conservation_identity') IS NULL THEN RETURN '{}'::jsonb; END IF;
    EXECUTE 'SELECT COALESCE(jsonb_object_agg(c.currency, c.imbalance_minor), ''{}''::jsonb)
               FROM finance.v_conservation_identity c' INTO v;
    RETURN v;
END $$;
-- #endregion

-- #region 0. Fixtures (as postgres)
DO $$
DECLARE
    v_product record;
    v_buyer uuid;
    v_other uuid;
    v_biz record;
    v_member uuid;
    v_file_a uuid;
    v_file_b uuid;
    v_bare uuid;
BEGIN
    SELECT p.id, p.price_cents, p.owner_user_id, l.id AS listing INTO v_product
      FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.currency = 'USD' AND p.price_cents > 0 AND p.owner_team_id IS NULL
       AND EXISTS (SELECT 1 FROM catalogue.listing_media m
                    WHERE m.listing_id = l.id AND m.position = 1 AND m.kind = 'image')
     ORDER BY p.id LIMIT 1;
    PERFORM pg_temp.ok(v_product.id IS NOT NULL, 'fixture: a published USD product sold by a person (deno task db:reset)');

    -- Another published product, cleared of files: the one that delivers nothing (section 8).
    SELECT p.id INTO v_bare FROM catalogue.products p
      JOIN catalogue.listings l ON l.product_id = p.id AND l.status = 'published'
     WHERE p.currency = 'USD' AND p.price_cents > 0 AND p.id <> v_product.id
       AND p.owner_user_id <> v_product.owner_user_id
     ORDER BY p.id LIMIT 1;
    PERFORM pg_temp.ok(v_bare IS NOT NULL, 'fixture: a second published USD product');
    DELETE FROM catalogue.product_versions WHERE product_id = v_bare;
    UPDATE catalogue.products SET file_manifest = '[{"name": "readme.txt", "label": "Notes", "extension": ".txt", "bytes": 10}]'::jsonb
     WHERE id = v_bare;

    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id NOT IN (v_product.owner_user_id, (SELECT owner_user_id FROM catalogue.products WHERE id = v_bare))
       AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (SELECT 1 FROM org.team_members tm
                        JOIN catalogue.products p ON p.owner_team_id = tm.team_id
                       WHERE p.id IN (v_product.id, v_bare) AND tm.user_id = u.user_id)
     ORDER BY u.user_id LIMIT 1;
    SELECT u.user_id INTO v_other FROM org.users_public u
     WHERE u.user_id NOT IN (v_product.owner_user_id, v_buyer)
       AND NOT org.fn_is_minor(u.user_id)
     ORDER BY u.user_id DESC LIMIT 1;
    PERFORM pg_temp.ok(v_buyer IS NOT NULL AND v_other IS NOT NULL, 'fixture: two adult people who do not sell it');

    -- A business whose owner may buy on account (the on_account_amount fixture), and one more member.
    SELECT bp.id, bp.owner_user_id INTO v_biz
      FROM org.business_profiles bp
     WHERE bp.owner_user_id NOT IN (v_product.owner_user_id)
       AND NOT org.fn_is_minor(bp.owner_user_id)
       AND EXISTS (SELECT 1 FROM org.business_members bm
                    WHERE bm.business_id = bp.id AND bm.status = 'active' AND bm.user_id <> bp.owner_user_id)
     ORDER BY bp.id LIMIT 1;
    PERFORM pg_temp.ok(v_biz.id IS NOT NULL, 'fixture: a business with an owner and another active member');
    SELECT bm.user_id INTO v_member FROM org.business_members bm
     WHERE bm.business_id = v_biz.id AND bm.status = 'active' AND bm.user_id <> v_biz.owner_user_id
     ORDER BY bm.user_id LIMIT 1;
    UPDATE org.business_profiles SET kyb_status = 'verified', invoicing_mode = 'intervaled_monthly' WHERE id = v_biz.id;
    UPDATE finance.wallets SET approval_threshold_cents = NULL
     WHERE id = finance.fn_ensure_wallet('business', v_biz.id, 'USD');
    UPDATE security.platform_params SET value = '{"default": 0}'::jsonb WHERE key = 'vault_approval_threshold_cents';
    DELETE FROM finance.spending_limits
     WHERE wallet_id = finance.fn_ensure_wallet('business', v_biz.id, 'USD') AND member_user_id = v_biz.owner_user_id;
    IF v_other IN (SELECT bm.user_id FROM org.business_members bm WHERE bm.business_id = v_biz.id) THEN
        UPDATE org.business_members SET status = 'removed' WHERE business_id = v_biz.id AND user_id = v_other;
    END IF;

    -- Two finished library files of the seller's, and a draft that names both (and one twice).
    v_file_a := pg_temp.library_file(v_product.owner_user_id, 'probe-source.zip', 4000);
    v_file_b := pg_temp.library_file(v_product.owner_user_id, 'probe-guide.zip', 600);
    DELETE FROM catalogue.product_versions WHERE product_id = v_product.id;
    UPDATE catalogue.products SET file_manifest = jsonb_build_array(
        jsonb_build_object('name', 'Source.zip', 'label', 'Source', 'extension', '.zip', 'bytes', 1, 'fileId', v_file_a),
        jsonb_build_object('name', 'Notes', 'label', 'Notes', 'extension', '.txt', 'bytes', 1),
        jsonb_build_object('name', 'Guide.zip', 'label', 'Guide', 'extension', '.zip', 'bytes', 1, 'fileId', v_file_b),
        jsonb_build_object('name', 'Source again', 'label', 'Source', 'extension', '.zip', 'bytes', 1, 'fileId', v_file_a)
    ) WHERE id = v_product.id;

    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_buyer), v_buyer, 'USD');
    PERFORM finance.fn_wallet_credit(v_buyer, finance.fn_person_wallet_type(v_buyer), 'USD', 1000000,
        'topup', 'inbound_payments', gen_random_uuid());
    PERFORM finance.fn_ensure_wallet(finance.fn_person_wallet_type(v_other), v_other, 'USD');
    PERFORM finance.fn_wallet_credit(v_other, finance.fn_person_wallet_type(v_other), 'USD', 1000000,
        'topup', 'inbound_payments', gen_random_uuid());
    -- The fixture's credits have no payment behind them, so the identity is measured from here on.
    PERFORM set_config('probe.imbalance', pg_temp.imbalance()::text, true);

    PERFORM set_config('probe.product', v_product.id::text, true);
    PERFORM set_config('probe.listing', v_product.listing::text, true);
    PERFORM set_config('probe.seller', v_product.owner_user_id::text, true);
    PERFORM set_config('probe.bare', v_bare::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.other', v_other::text, true);
    PERFORM set_config('probe.biz', v_biz.id::text, true);
    PERFORM set_config('probe.biz_owner', v_biz.owner_user_id::text, true);
    PERFORM set_config('probe.biz_member', v_member::text, true);
    PERFORM set_config('probe.file_a', v_file_a::text, true);
    PERFORM set_config('probe.file_b', v_file_b::text, true);
    RAISE NOTICE 'fixture product=% seller=% buyer=% other=% business=%', v_product.id, v_product.owner_user_id,
        v_buyer, v_other, v_biz.id;
END $$;
-- #endregion

-- #region 1. No client role writes either table or runs the service's doors
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(current_setting('probe.buyer')::uuid);
DO $$
DECLARE
    v_line uuid := (SELECT id FROM finance.order_lines LIMIT 1);
BEGIN
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'INSERT INTO catalogue.entitlements (order_line_id, holder_type, holder_id, licence) VALUES (%L, ''user'', %L, ''personal'')',
        v_line, current_setting('probe.buyer'))) = '42501', '1 authenticated cannot insert an entitlement');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'INSERT INTO catalogue.product_versions (product_id, version, manifest) VALUES (%L, 9, ''[{}]'')',
        current_setting('probe.product'))) = '42501', '1 authenticated cannot insert a version');
    PERFORM pg_temp.ok(pg_temp.state_of(
        'SELECT catalogue.mark_product_version_ready(gen_random_uuid())') = '42501',
        '1 authenticated cannot mark a version ready');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'SELECT catalogue.fn_record_delivery(gen_random_uuid(), gen_random_uuid(), %L)',
        current_setting('probe.buyer'))) = '42501', '1 authenticated cannot record a delivery');
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.act(NULL);
DO $$
BEGIN
    PERFORM pg_temp.ok(pg_temp.state_of('SELECT 1 FROM catalogue.entitlements LIMIT 1') = '42501',
        '1 anon cannot read entitlements');
    PERFORM pg_temp.ok(pg_temp.state_of('SELECT 1 FROM catalogue.product_versions LIMIT 1') = '42501',
        '1 anon cannot read product versions');
END $$;
RESET ROLE;
-- #endregion

-- #region 2. Publishing freezes the attached files
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(current_setting('probe.seller')::uuid);
DO $$
DECLARE
    v_out jsonb;
    v_again jsonb;
    v_row record;
BEGIN
    v_out := catalogue.set_listing_status(current_setting('probe.listing')::uuid, 'published');
    SELECT * INTO v_row FROM catalogue.product_versions WHERE id = (v_out -> 'version' ->> 'version_id')::uuid;
    PERFORM pg_temp.ok(v_row.version = 1 AND (v_out -> 'version' ->> 'created')::boolean
        AND v_row.ready_at IS NULL, '2 the publish froze version 1, not yet ready');
    PERFORM pg_temp.ok(jsonb_array_length(v_row.manifest) = 2
        AND v_row.manifest -> 0 ->> 'fileId' = current_setting('probe.file_a')
        AND v_row.manifest -> 1 ->> 'fileId' = current_setting('probe.file_b')
        AND v_row.manifest -> 0 ->> 'name' = 'Source.zip'
        AND (v_row.manifest -> 0 ->> 'bytes')::bigint = 4000
        AND v_row.manifest -> 0 ->> 'mime' = 'application/zip'
        AND NOT (v_row.manifest -> 0 ? 'bucket') AND NOT (v_row.manifest::text LIKE '%users/%'),
        '2 one entry per library file, in the seller''s order, sizes from the library, no storage address');

    v_again := catalogue.set_listing_status(current_setting('probe.listing')::uuid, 'published');
    PERFORM pg_temp.ok(v_again -> 'version' ->> 'version_id' = v_out -> 'version' ->> 'version_id'
        AND NOT (v_again -> 'version' ->> 'created')::boolean
        AND (SELECT count(*) FROM catalogue.product_versions WHERE product_id = current_setting('probe.product')::uuid) = 1,
        '2 a re-publish with nothing changed writes no version');
    PERFORM set_config('probe.v1', v_out -> 'version' ->> 'version_id', true);
END $$;
RESET ROLE;

-- The service's copy, then its stamp (as the service role).
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(catalogue.mark_product_version_ready(current_setting('probe.v1')::uuid) IS NOT NULL,
    '2 the service role marks the version ready');
RESET ROLE;

-- A file the draft names but the library no longer holds refuses the publish, and writes nothing.
DO $$
DECLARE
    v_ghost uuid := pg_temp.library_file(current_setting('probe.seller')::uuid, 'probe-ghost.zip', 10);
    v_draft jsonb := (SELECT file_manifest FROM catalogue.products WHERE id = current_setting('probe.product')::uuid);
    v_state text;
BEGIN
    UPDATE files.items SET deleted_at = now() WHERE id = v_ghost;
    UPDATE catalogue.products
       SET file_manifest = v_draft || jsonb_build_array(jsonb_build_object(
               'name', 'Ghost.zip', 'label', 'Ghost', 'extension', '.zip', 'bytes', 1, 'fileId', v_ghost))
     WHERE id = current_setting('probe.product')::uuid;
    PERFORM pg_temp.act(current_setting('probe.seller')::uuid);
    v_state := pg_temp.state_of(format('SELECT catalogue.set_listing_status(%L, ''published'')', current_setting('probe.listing')));
    PERFORM pg_temp.ok(v_state = 'PG422'
        AND (SELECT count(*) FROM catalogue.product_versions WHERE product_id = current_setting('probe.product')::uuid) = 1,
        '2 a deleted attachment refuses the publish (PG422) and freezes nothing');
    UPDATE catalogue.products SET file_manifest = v_draft WHERE id = current_setting('probe.product')::uuid;
END $$;
-- #endregion

-- #region 3. A wallet purchase writes the entitlement with its line
DO $$
DECLARE
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_line uuid;
    v_ol record;
    v_ent record;
    v_again uuid;
BEGIN
    v_line := pg_temp.buy(v_buyer, current_setting('probe.product')::uuid, true, 'probe-ck1-wallet-1');
    SELECT * INTO v_ol FROM finance.order_lines WHERE id = v_line;
    SELECT * INTO v_ent FROM catalogue.entitlements WHERE order_line_id = v_line;
    PERFORM pg_temp.ok(v_ent.id IS NOT NULL AND v_ent.status = 'active' AND v_ent.holder_type = 'user'
        AND v_ent.holder_id = v_buyer
        AND v_ent.holder_id = (SELECT o.owner_id FROM finance.orders o WHERE o.id = v_ol.order_id)
        AND v_ent.product_id = current_setting('probe.product')::uuid
        AND v_ent.version_id = current_setting('probe.v1')::uuid
        AND v_ent.licence::text = v_ol.licence AND v_ent.seats = 1
        AND v_ent.updates_until IS NULL AND v_ent.first_delivered_at IS NULL
        AND v_ent.slug ~ '^ent-[23456789abcdefghjkmnopqrstuvwxyz]{10}$',
        '3 one active entitlement: the line''s, held by the order''s owner, on version 1, an ent- slug');
    PERFORM pg_temp.ok(v_ent.delivery_terms_accepted_at IS NOT NULL,
        '3 the buyer''s A8 tick is stamped on the entitlement');
    PERFORM pg_temp.ok(v_ol.download_name IS NULL AND v_ol.download_bytes = 4600,
        '3 the receipt carries the bundle''s total size and no single file name');
    PERFORM set_config('probe.ent1', v_ent.id::text, true);
    PERFORM set_config('probe.slug1', v_ent.slug, true);

    -- The same key again replays the order: no second line, no second entitlement.
    PERFORM pg_temp.act(v_buyer);
    PERFORM finance.place_wallet_order(
        (SELECT basket_id FROM finance.basket_items WHERE id = v_ol.basket_item_id), ARRAY[v_ol.basket_item_id],
        'USD', jsonb_build_object(v_ol.basket_item_id::text, v_ol.line_total_minor), NULL, 'probe-ck1-wallet-1',
        v_ol.line_total_minor);
    PERFORM pg_temp.ok((SELECT count(*) FROM catalogue.entitlements e JOIN finance.order_lines ol ON ol.id = e.order_line_id
                         WHERE ol.order_id = v_ol.order_id) = 1, '3 a replayed key writes no second entitlement');

    -- Paid without the tick: the entitlement exists, the acceptance does not.
    v_again := pg_temp.buy(current_setting('probe.other')::uuid, current_setting('probe.product')::uuid, false,
        'probe-ck1-wallet-2');
    PERFORM pg_temp.ok((SELECT delivery_terms_accepted_at IS NULL AND status = 'active'
                          FROM catalogue.entitlements WHERE order_line_id = v_again),
        '3 without the A8 tick the entitlement records no acceptance');
    PERFORM set_config('probe.ent_other', (SELECT id FROM catalogue.entitlements WHERE order_line_id = v_again)::text, true);
END $$;
-- #endregion

-- #region 4. Who reads an entitlement and its version
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(current_setting('probe.buyer')::uuid);
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.entitlements WHERE id = current_setting('probe.ent1')::uuid) = 1
    AND (SELECT count(*) FROM catalogue.product_versions WHERE id = current_setting('probe.v1')::uuid) = 1
    AND (SELECT count(*) FROM catalogue.entitlements WHERE id = current_setting('probe.ent_other')::uuid) = 0,
    '4 the holder reads their entitlement and its version, never another buyer''s');
SELECT pg_temp.act(current_setting('probe.biz_member')::uuid);
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.entitlements WHERE id = current_setting('probe.ent1')::uuid) = 0
    AND (SELECT count(*) FROM catalogue.product_versions WHERE id = current_setting('probe.v1')::uuid) = 0,
    '4 another person reads neither');
SELECT pg_temp.act(current_setting('probe.seller')::uuid);
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.entitlements WHERE id = current_setting('probe.ent1')::uuid) = 0
    AND (SELECT count(*) FROM catalogue.product_versions WHERE id = current_setting('probe.v1')::uuid) = 1,
    '4 the seller reads the version, not the buyer''s entitlement');
RESET ROLE;
-- #endregion

-- #region 5. A completed delivery is recorded once, per file
SET LOCAL ROLE service_role;
DO $$
DECLARE
    v_ent uuid := current_setting('probe.ent1')::uuid;
    v_buyer uuid := current_setting('probe.buyer')::uuid;
    v_first timestamptz;
    v_second timestamptz;
BEGIN
    v_first := catalogue.fn_record_delivery(v_ent, current_setting('probe.file_a')::uuid, v_buyer);
    PERFORM pg_sleep(0.01);
    v_second := catalogue.fn_record_delivery(v_ent, current_setting('probe.file_b')::uuid, v_buyer);
    PERFORM pg_temp.ok(v_first IS NOT NULL AND v_second = v_first
        AND (SELECT first_delivered_at FROM catalogue.entitlements WHERE id = v_ent) = v_first,
        '5 first_delivered_at is stamped by the first delivery and kept');
    PERFORM pg_temp.ok((SELECT count(*) FROM files.download_events
                         WHERE item_id IN (current_setting('probe.file_a')::uuid, current_setting('probe.file_b')::uuid)
                           AND actor_user_id = v_buyer AND via = 'purchase') = 2,
        '5 each delivery is a download_events row, via purchase');
    PERFORM pg_temp.ok(pg_temp.state_of(format('SELECT catalogue.fn_record_delivery(%L, gen_random_uuid(), %L)',
        v_ent, v_buyer)) = 'PB404', '5 a file outside the version is refused');
END $$;
RESET ROLE;
-- #endregion

-- #region 6. A changed bundle is a new version; each buyer keeps theirs
DO $$
DECLARE
    v_out jsonb;
    v_line uuid;
BEGIN
    UPDATE catalogue.products
       SET file_manifest = jsonb_build_array(file_manifest -> 2)
     WHERE id = current_setting('probe.product')::uuid;
    PERFORM pg_temp.act(current_setting('probe.seller')::uuid);
    v_out := catalogue.set_listing_status(current_setting('probe.listing')::uuid, 'published');
    PERFORM pg_temp.ok((v_out -> 'version' ->> 'version')::int = 2 AND (v_out -> 'version' ->> 'created')::boolean,
        '6 a re-publish with changed files freezes version 2');
    PERFORM pg_temp.ok((SELECT version_id FROM catalogue.entitlements WHERE id = current_setting('probe.ent1')::uuid)
        = current_setting('probe.v1')::uuid, '6 the first buyer keeps version 1');

    v_line := pg_temp.buy(current_setting('probe.buyer')::uuid, current_setting('probe.product')::uuid, true,
        'probe-ck1-wallet-3');
    PERFORM pg_temp.ok((SELECT version_id FROM catalogue.entitlements WHERE order_line_id = v_line)
        = (v_out -> 'version' ->> 'version_id')::uuid
        AND (SELECT download_name FROM finance.order_lines WHERE id = v_line) = 'Guide.zip',
        '6 a later purchase gets version 2, and a one-file receipt names its file');
END $$;
-- #endregion

-- #region 7. An on-account purchase reaches the same write
DO $$
DECLARE
    v_biz uuid := current_setting('probe.biz')::uuid;
    v_line uuid := pg_temp.product_line('business', current_setting('probe.biz')::uuid,
        current_setting('probe.product')::uuid, true);
    v_price bigint := (SELECT price_cents FROM catalogue.products WHERE id = current_setting('probe.product')::uuid);
    v_out jsonb;
    v_ent record;
BEGIN
    PERFORM pg_temp.act(current_setting('probe.biz_owner')::uuid);
    v_out := finance.place_on_account_order((SELECT basket_id FROM finance.basket_items WHERE id = v_line),
        ARRAY[v_line], 'USD', jsonb_build_object(v_line::text, v_price), NULL, 'probe-ck1-account-1', v_price);
    SELECT e.* INTO v_ent FROM catalogue.entitlements e
      JOIN finance.order_lines ol ON ol.id = e.order_line_id
     WHERE ol.order_id = (v_out ->> 'order_id')::uuid;
    PERFORM pg_temp.ok(v_ent.holder_type = 'business' AND v_ent.holder_id = v_biz AND v_ent.status = 'active'
        AND v_ent.version_id IS NOT NULL,
        '7 place_on_account_order writes the entitlement, held by the business');
    PERFORM set_config('probe.ent_biz', v_ent.id::text, true);
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(current_setting('probe.biz_member')::uuid);
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.entitlements WHERE id = current_setting('probe.ent_biz')::uuid) = 1,
    '7 an active member of the business reads it');
SELECT pg_temp.act(current_setting('probe.other')::uuid);
SELECT pg_temp.ok((SELECT count(*) FROM catalogue.entitlements WHERE id = current_setting('probe.ent_biz')::uuid) = 0,
    '7 a non-member does not');
RESET ROLE;
-- #endregion

-- #region 8. A product that attached no library file still sells its licence
DO $$
DECLARE
    v_line uuid := pg_temp.buy(current_setting('probe.buyer')::uuid, current_setting('probe.bare')::uuid, true,
        'probe-ck1-wallet-4');
BEGIN
    PERFORM pg_temp.ok((SELECT version_id IS NULL AND delivery_terms_accepted_at IS NULL AND status = 'active'
                          FROM catalogue.entitlements WHERE order_line_id = v_line),
        '8 the entitlement exists with no version and no acceptance to record');
END $$;
-- #endregion

-- #region 9. Conservation
SELECT pg_temp.ok(pg_temp.imbalance() = current_setting('probe.imbalance')::jsonb,
    '9 every purchase above leaves each currency''s imbalance where it was');
-- #endregion

ROLLBACK;
