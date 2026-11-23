-- =============================================================================================
-- Probe: what a listing's first publish fixes (Decision #217, work order C13) — save_listing lets a
-- never-published draft change its currency (mirrored onto its blueprint) and reshape its buyer
-- questions freely; once `published_at` is set, even back in draft, the currency is fixed and the
-- questions keep their ids, order and kinds while their wording and options still change
-- (00001170, ServiceCreation.md §1.1).
--
-- Sections 4–8 (Decision #494, MARKETPLACE SC4): only the doors publish. Under the seller's JWT a bare
-- UPDATE or INSERT that publishes, unpublishes, promotes or marks a blueprint published is refused
-- 42501, for listings and member articles alike; a published listing's currency, questions, delivery
-- model, last cover and last Pipeline stage hold against a direct write as they do in the doors (MK-57,
-- #494 (a) and (d)); a showcase cannot name another person's file; the door still publishes and tells
-- the owner's followers once per first publish, in one daily group (#494 (C)); a product with no file
-- to deliver does not publish (MK-60, #488 (a)).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/catalogue_publish_locks.sql
--
-- Every expected refusal is asserted by its SQLSTATE and DETAIL inside its own exception block. A clean
-- run prints only PASS and ok notices. The seller and the follower come from the seed.
-- =============================================================================================
\set ON_ERROR_STOP on

BEGIN;
-- The pg_temp helpers run as authenticated, and 00002500 gives a new function no PUBLIC EXECUTE; this
-- hands it back to the helpers alone, and rolls back with them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- #region Helpers
CREATE FUNCTION pg_temp.ok(p_cond boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'PROBE FAIL: %', p_what; END IF;
    RAISE NOTICE 'ok  %', p_what;
END $$;

-- Act as a signed-in person: the role and the claims PostgREST would set.
CREATE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
    SELECT pg_catalog.set_config('request.jwt.claim.sub', p_uid::text, true),
           pg_catalog.set_config('request.jwt.claims',
               pg_catalog.json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- The SQLSTATE and DETAIL a statement raises ('22023 currency'), or NULL when it runs. The deferred
-- showcase checks are made to fire before the answer, as a commit would fire them; a refusal rolls the
-- statement back with it.
CREATE FUNCTION pg_temp.state_of(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
    v_detail text;
BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    RETURN NULL;
EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    RETURN pg_catalog.btrim(SQLSTATE || ' ' || COALESCE(v_detail, ''));
END $$;

-- A finished file in the person's library, as the upload pipeline leaves one.
CREATE FUNCTION pg_temp.library_file(p_owner uuid, p_name text, p_mime text) RETURNS uuid LANGUAGE sql AS $$
    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name,
                             mime_type, size_bytes, status, owner_type, source)
    VALUES (p_owner, 'personal', 'users/' || p_owner || '/library/probe-sc4/' || p_name, p_name, p_name,
            p_mime, 1000, 'uploaded', 'user', 'supabase')
    RETURNING id;
$$;

-- A One-Off the door would publish: a title, a price and a cover; two buyer questions.
CREATE FUNCTION pg_temp.ready_service(p_title text, p_model text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_listing uuid := (catalogue.create_listing('service', p_title, p_model, NULL, 'USD') ->> 'listing_id')::uuid;
BEGIN
    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('amount_cents', 5000, 'intake', jsonb_build_array(
        jsonb_build_object('id', 'q1', 'kind', 'text', 'label', 'Deadline?', 'required', true,
            'options', '[]'::jsonb, 'multiple', false, 'slider', false),
        jsonb_build_object('id', 'q2', 'kind', 'text', 'label', 'Style?', 'required', false,
            'options', '[]'::jsonb, 'multiple', false, 'slider', false))));
    IF p_model = 'pipeline' THEN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('stage_template', jsonb_build_array(
            jsonb_build_object('name', 'Discovery', 'priceCents', 5000))));
    END IF;
    PERFORM catalogue.apply_listing_media(v_listing, jsonb_build_array(jsonb_build_object(
        'position', 1, 'file_id', current_setting('probe.cover'), 'kind', 'image')));
    RETURN v_listing;
END $$;

-- The follower's notices of a listing going live, read past their RLS (the probe acts as the seller).
CREATE FUNCTION pg_temp.published_notices() RETURNS TABLE (n bigint, events integer, url text)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT pg_catalog.count(*), pg_catalog.max(nt.group_count), pg_catalog.max(nt.action_url)
      FROM comms.notifications nt
     WHERE nt.user_id = current_setting('probe.follower')::uuid AND nt.type = 'catalogue.listing_published';
$$;
-- #endregion

-- #region 0. Fixture (as postgres) — an adult seller who owns a personal listing
DO $$
DECLARE
    v_seller uuid;
BEGIN
    SELECT l.owner_user_id INTO v_seller
      FROM catalogue.listings l
     WHERE l.owner_team_id IS NULL AND l.kind = 'service' AND NOT org.fn_is_minor(l.owner_user_id)
     ORDER BY l.id LIMIT 1;
    IF v_seller IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no adult seller with a personal service'; END IF;
    PERFORM set_config('probe.seller', v_seller::text, true);
    RAISE NOTICE 'fixture seller=%', v_seller;
END $$;
-- #endregion

-- #region 1. A never-published draft changes its currency and reshapes its questions
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.seller'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_listing uuid;
    v_currency text;
    v_intake jsonb;
BEGIN
    v_listing := (catalogue.create_listing('service', 'Probe locks', 'one_off', NULL, 'USD') ->> 'listing_id')::uuid;
    PERFORM set_config('probe.listing', v_listing::text, true);

    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('currency', 'jpy', 'amount_cents', 5000));
    SELECT b.currency INTO v_currency FROM marketplace.service_blueprints b
      JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;
    IF (SELECT currency FROM catalogue.listings WHERE id = v_listing) <> 'JPY' OR v_currency <> 'JPY' THEN
        RAISE EXCEPTION 'FAIL draft currency change: listing=% blueprint=%',
            (SELECT currency FROM catalogue.listings WHERE id = v_listing), v_currency;
    END IF;

    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('currency', 'EURO'));
        RAISE EXCEPTION 'FAIL a four-letter currency accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL bad currency: % %', SQLSTATE, SQLERRM; END IF;
    END;

    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake', jsonb_build_array(
        jsonb_build_object('id', 'q1', 'kind', 'text', 'label', 'Deadline?', 'required', true,
            'options', '[]'::jsonb, 'multiple', false, 'slider', false),
        jsonb_build_object('id', 'q2', 'kind', 'radio', 'label', 'Style', 'required', false,
            'options', jsonb_build_array(jsonb_build_object('value', 'flat', 'label', 'Flat')),
            'multiple', false, 'slider', false))));
    SELECT b.intake_fields INTO v_intake FROM marketplace.service_blueprints b
      JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;
    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake',
        jsonb_build_array(v_intake -> 1, v_intake -> 0)));
    IF (SELECT b.intake_fields -> 0 ->> 'id' FROM marketplace.service_blueprints b
          JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing) <> 'q2' THEN
        RAISE EXCEPTION 'FAIL a never-published draft could not reorder its questions';
    END IF;

    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake', jsonb_build_object('id', 'q1')));
        RAISE EXCEPTION 'FAIL questions that are not a list accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL non-list intake: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS a never-published draft changes its currency (mirrored) and reorders its questions';
END $$;
RESET ROLE;
-- #endregion

-- #region 2. First publish, then back to draft — published_at is what the locks read
DO $$
BEGIN
    UPDATE catalogue.listings SET published_at = now() - interval '1 day'
     WHERE id = current_setting('probe.listing')::uuid;
END $$;
-- #endregion

-- #region 3. After a first publish: the currency is fixed, the questions keep their shape
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.seller'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_listing uuid := current_setting('probe.listing')::uuid;
    v_intake jsonb;
    v_detail text;
BEGIN
    IF (SELECT status FROM catalogue.listings WHERE id = v_listing) <> 'draft' THEN
        RAISE EXCEPTION 'FAIL fixture: the probe listing should still be a draft';
    END IF;

    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('currency', 'EUR'));
        RAISE EXCEPTION 'FAIL a published listing changed its currency';
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
        IF SQLSTATE <> '22023' OR v_detail <> 'currency' THEN
            RAISE EXCEPTION 'FAIL fixed currency: % % (%)', SQLSTATE, SQLERRM, v_detail;
        END IF;
    END;
    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('currency', 'JPY', 'amount_cents', 6000));
    RAISE NOTICE 'PASS once published the currency is refused (22023 currency) unless it is unchanged';

    SELECT b.intake_fields INTO v_intake FROM marketplace.service_blueprints b
      JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;

    -- reordered · one added · one removed · a kind changed · an id renamed
    FOR v_detail IN SELECT unnest(ARRAY['reorder', 'add', 'remove', 'kind', 'rename']) LOOP
        BEGIN
            PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake', CASE v_detail
                WHEN 'reorder' THEN jsonb_build_array(v_intake -> 1, v_intake -> 0)
                WHEN 'add' THEN v_intake || jsonb_build_array(jsonb_build_object('id', 'q3', 'kind', 'text', 'label', 'More?'))
                WHEN 'remove' THEN jsonb_build_array(v_intake -> 0)
                WHEN 'kind' THEN jsonb_set(v_intake, '{0,kind}', '"textarea"')
                ELSE jsonb_set(v_intake, '{0,id}', '"q9"')
            END));
            RAISE EXCEPTION 'FAIL a published listing accepted a question %', v_detail;
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE <> '22023' THEN
                RAISE EXCEPTION 'FAIL question %: % %', v_detail, SQLSTATE, SQLERRM;
            END IF;
        END;
    END LOOP;

    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('intake',
        jsonb_set(jsonb_set(v_intake, '{0,label}', '"What is the deadline?"'),
                  '{1,options}', jsonb_build_array(
                      jsonb_build_object('value', 'flat', 'label', 'Flat colour'),
                      jsonb_build_object('value', 'line', 'label', 'Line art')))));
    IF (SELECT jsonb_array_length(b.intake_fields -> 1 -> 'options') FROM marketplace.service_blueprints b
          JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing) <> 2 THEN
        RAISE EXCEPTION 'FAIL rewording and a new option were not saved';
    END IF;
    RAISE NOTICE 'PASS once published the questions keep ids, order and kinds (22023 intake); wording and options save';
END $$;
RESET ROLE;
-- #endregion

-- #region 4. SC4 fixtures (as postgres) — the seller's cover and file, a stranger's image, one follower
DO $$
DECLARE
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_follower uuid;
BEGIN
    SELECT u.user_id INTO v_follower FROM org.users_public u
     WHERE u.user_id <> v_seller AND NOT org.fn_is_minor(u.user_id)
     ORDER BY u.user_id LIMIT 1;
    PERFORM pg_temp.ok(v_follower IS NOT NULL, '4 fixture: an adult who is not the seller');
    INSERT INTO org.profile_follows (follower_user_id, target_entity_type, target_entity_id)
    VALUES (v_follower, 'user', v_seller) ON CONFLICT DO NOTHING;
    DELETE FROM comms.notifications WHERE user_id IN (v_follower, v_seller) AND type = 'catalogue.listing_published';
    PERFORM set_config('probe.follower', v_follower::text, true);
    PERFORM set_config('probe.cover', pg_temp.library_file(v_seller, 'probe-cover.png', 'image/png')::text, true);
    PERFORM set_config('probe.cover2', pg_temp.library_file(v_seller, 'probe-cover-2.png', 'image/png')::text, true);
    PERFORM set_config('probe.zip', pg_temp.library_file(v_seller, 'probe-bundle.zip', 'application/zip')::text, true);
    PERFORM set_config('probe.stranger_file', pg_temp.library_file(v_follower, 'probe-theirs.png', 'image/png')::text, true);
END $$;
-- #endregion

-- #region 5. A direct write cannot publish, unpublish, promote or mark a blueprint live (#494 (A) 1–2, (f))
SET LOCAL ROLE authenticated;
SELECT pg_temp.act(current_setting('probe.seller')::uuid);

DO $$
DECLARE
    v_seller uuid := current_setting('probe.seller')::uuid;
    v_draft uuid := (catalogue.create_listing('service', 'Probe bare draft', 'one_off', NULL, 'USD') ->> 'listing_id')::uuid;
    v_live uuid := pg_temp.ready_service('Probe live one-off', 'one_off');
    v_product uuid;
    v_article uuid;
    v_blueprint uuid := (SELECT service_blueprint_id FROM catalogue.listings WHERE id = v_draft);
BEGIN
    PERFORM set_config('probe.live', v_live::text, true);
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE catalogue.listings SET status = ''published'', published_at = now() WHERE id = %L', v_draft)) = '42501',
        '5 a bare UPDATE does not publish a draft with no cover or price (42501)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE catalogue.listings SET status = ''published'' WHERE id = %L', v_draft)) = '42501',
        '5 nor does a bare UPDATE of status alone');

    INSERT INTO catalogue.products (owner_user_id, title, price_cents, currency)
    VALUES (v_seller, 'Probe inserted product', 0, 'USD') RETURNING id INTO v_product;
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'INSERT INTO catalogue.listings (owner_user_id, kind, status, product_id, title, currency, published_at)
         VALUES (%L, ''product'', ''published'', %L, ''Probe inserted'', ''USD'', now())', v_seller, v_product)) = '42501',
        '5 an INSERT published from its first byte is refused (42501)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'INSERT INTO catalogue.listings (owner_user_id, kind, status, product_id, title, currency)
         VALUES (%L, ''product'', ''paused'', %L, ''Probe inserted'', ''USD'')', v_seller, v_product)) = '42501',
        '5 an INSERT starts as a draft');

    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE marketplace.service_blueprints SET is_published = true WHERE id = %L', v_blueprint)) = '42501',
        '5 a blueprint is not marked published directly (42501)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE catalogue.listings SET promoted = true WHERE id = %L', v_draft)) = '42501',
        '5 a seller does not set their own promoted flag (42501, #494 (f))');

    PERFORM catalogue.set_listing_status(v_live, 'published');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE catalogue.listings SET status = ''draft'', published_at = NULL WHERE id = %L', v_live)) = '42501',
        '5 clearing published_at to reopen #217''s locks is refused (42501)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE catalogue.listings SET published_at = now() - interval ''1 year'' WHERE id = %L', v_live)) = '42501',
        '5 published_at is the door''s to stamp');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE catalogue.listings SET title = ''Probe live one-off, renamed'' WHERE id = %L', v_live)) IS NULL,
        '5 an ordinary column still saves directly');

    INSERT INTO catalogue.articles (owner_user_id, title) VALUES (v_seller, 'Probe article') RETURNING id INTO v_article;
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE catalogue.articles SET status = ''published'', published_at = now() WHERE id = %L', v_article)) = '42501',
        '5 a member article is not published by a bare UPDATE (42501, #494 (e))');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'INSERT INTO catalogue.articles (owner_user_id, title, status, published_at)
         VALUES (%L, ''Probe live article'', ''published'', now())', v_seller)) = '42501',
        '5 nor by an INSERT');

    PERFORM pg_temp.ok((SELECT status = 'published' AND published_at IS NOT NULL FROM catalogue.listings WHERE id = v_live)
        AND (SELECT b.is_published FROM marketplace.service_blueprints b JOIN catalogue.listings l
              ON l.service_blueprint_id = b.id WHERE l.id = v_live),
        '5 the door still publishes, and its blueprint follows');
END $$;
-- #endregion

-- #region 6. A published listing's locks hold against a direct write (MK-57, #494 (A) 3–4)
DO $$
DECLARE
    v_live uuid := current_setting('probe.live')::uuid;
    v_blueprint uuid := (SELECT service_blueprint_id FROM catalogue.listings WHERE id = v_live);
    v_product uuid;
BEGIN
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE catalogue.listings SET currency = ''EUR'' WHERE id = %L', v_live)) = '22023 currency',
        '6 a published listing keeps its currency (22023 currency)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE marketplace.service_blueprints SET currency = ''EUR'' WHERE id = %L', v_blueprint)) = '22023 currency',
        '6 and so does its blueprint');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE marketplace.service_blueprints SET intake_fields = jsonb_build_array(intake_fields -> 1, intake_fields -> 0)
          WHERE id = %L', v_blueprint)) = '22023 intake',
        '6 its questions keep their order (22023 intake)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE marketplace.service_blueprints SET intake_fields = jsonb_set(intake_fields, ''{0,label}'', ''"When?"'')
          WHERE id = %L', v_blueprint)) IS NULL,
        '6 while their wording still changes directly');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE marketplace.service_blueprints SET delivery_model = ''pipeline'' WHERE id = %L', v_blueprint))
        = '22023 delivery_model',
        '6 a live listing keeps its delivery model (22023 delivery_model)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'INSERT INTO catalogue.listing_media (listing_id, file_id, kind, position) VALUES (%L, %L, ''image'', 2)',
        v_live, current_setting('probe.stranger_file'))) = '42501',
        '6 a showcase cannot name another person''s file (42501)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'INSERT INTO catalogue.listing_media (listing_id, file_id, kind, position) VALUES (%L, %L, ''image'', 2)',
        v_live, current_setting('probe.cover2'))) IS NULL,
        '6 while the seller''s own file still goes in directly');

    v_product := (SELECT product_id FROM catalogue.listings
                   WHERE owner_user_id = current_setting('probe.seller')::uuid AND kind = 'product'
                     AND published_at IS NOT NULL ORDER BY id LIMIT 1);
    IF v_product IS NOT NULL THEN
        PERFORM pg_temp.ok(pg_temp.state_of(format(
            'UPDATE catalogue.products SET currency = CASE WHEN currency = ''EUR'' THEN ''USD'' ELSE ''EUR'' END
              WHERE id = %L', v_product)) = '22023 currency',
            '6 a published product keeps its currency');
    END IF;
END $$;
-- #endregion

-- #region 7. A published listing keeps its cover and, for a Pipeline, a stage (#494 (d))
DO $$
DECLARE
    v_live uuid := current_setting('probe.live')::uuid;
    v_pipeline uuid := pg_temp.ready_service('Probe live pipeline', 'pipeline');
BEGIN
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'SELECT catalogue.apply_listing_media(%L, ''[]''::jsonb)', v_live)) = 'PG422 a cover image',
        '7 the showcase door refuses a published listing''s last cover (PG422)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'DELETE FROM catalogue.listing_media WHERE listing_id = %L AND position = 1', v_live)) = 'PG422 a cover image',
        '7 so does a direct DELETE');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'SELECT catalogue.apply_listing_media(%L, jsonb_build_array(jsonb_build_object(
             ''position'', 1, ''file_id'', %L, ''kind'', ''image'')))', v_live, current_setting('probe.cover2'))) IS NULL,
        '7 a cover is still replaced');

    PERFORM catalogue.set_listing_status(v_pipeline, 'published');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'SELECT catalogue.save_listing(%L, jsonb_build_object(''stage_template'', ''[]''::jsonb))', v_pipeline))
        = 'PG422 at least one stage',
        '7 the editor refuses a published Pipeline''s last stage (PG422)');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'UPDATE marketplace.service_blueprints b SET stage_template = ''[]''::jsonb
           FROM catalogue.listings l WHERE l.id = %L AND b.id = l.service_blueprint_id', v_pipeline))
        = 'PG422 at least one stage',
        '7 so does a direct UPDATE');

    PERFORM catalogue.set_listing_status(v_pipeline, 'paused');
    PERFORM pg_temp.ok(pg_temp.state_of(format(
        'SELECT catalogue.save_listing(%L, jsonb_build_object(''stage_template'', ''[]''::jsonb))', v_pipeline)) IS NULL,
        '7 a paused one may lose them; the gate asks again at the next publish');
END $$;
-- #endregion

-- #region 8. The door tells the followers once per first publish, in one daily group (#494 (b), (C))
DO $$
DECLARE
    v_live uuid := current_setting('probe.live')::uuid;
    v_slug text := (SELECT b.slug FROM marketplace.service_blueprints b JOIN catalogue.listings l
                     ON l.service_blueprint_id = b.id WHERE l.id = v_live);
    v_a uuid := pg_temp.ready_service('Probe batch A', 'one_off');
    v_b uuid := pg_temp.ready_service('Probe batch B', 'one_off');
    v_n record;
    v_out jsonb[];
BEGIN
    SELECT * INTO v_n FROM pg_temp.published_notices();
    PERFORM pg_temp.ok(v_n.n = 1 AND v_n.events = 2 AND v_n.url LIKE '/view/svc-%',
        format('8 two first publishes (section 5''s One-Off, section 7''s Pipeline) read as one notice of 2 (%s)', v_n));
    PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM comms.notifications
                                    WHERE user_id = current_setting('probe.seller')::uuid
                                      AND type = 'catalogue.listing_published'),
        '8 the seller is not told of their own publish');

    PERFORM catalogue.set_listing_status(v_live, 'paused');
    PERFORM catalogue.set_listing_status(v_live, 'published');
    PERFORM catalogue.set_listing_status(v_live, 'draft');
    PERFORM catalogue.set_listing_status(v_live, 'published');
    SELECT * INTO v_n FROM pg_temp.published_notices();
    PERFORM pg_temp.ok(v_n.events = 2, '8 a resume or a re-publish from draft tells no one');

    v_out := catalogue.set_listings_status(ARRAY[v_a, v_b], 'published');
    PERFORM pg_temp.ok((v_out[1] ->> 'ok')::boolean AND (v_out[2] ->> 'ok')::boolean, '8 the batch publishes both');
    SELECT * INTO v_n FROM pg_temp.published_notices();
    PERFORM pg_temp.ok(v_n.n = 1 AND v_n.events = 4,
        format('8 a batch adds one event per listing to the day''s notice (%s)', v_n));
    PERFORM pg_temp.ok(v_n.url = '/view/' || (SELECT b.slug FROM marketplace.service_blueprints b
                                               JOIN catalogue.listings l ON l.service_blueprint_id = b.id
                                              WHERE l.id = v_b),
        '8 the notice links to the newest listing''s public page');
    PERFORM pg_temp.ok(v_slug IS NOT NULL, '8 fixture: the live listing has a public slug');
END $$;
-- #endregion

-- #region 9. A product with no file to deliver does not publish (MK-60, #488 (a))
DO $$
DECLARE
    v_listing uuid := (catalogue.create_listing('product', 'Probe empty product', NULL, NULL, 'USD') ->> 'listing_id')::uuid;
    v_state text;
BEGIN
    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('amount_cents', 900, 'file_manifest',
        jsonb_build_array(jsonb_build_object('name', 'Notes', 'label', 'Notes', 'extension', '.txt', 'bytes', 1))));
    PERFORM catalogue.apply_listing_media(v_listing, jsonb_build_array(jsonb_build_object(
        'position', 1, 'file_id', current_setting('probe.cover'), 'kind', 'image')));
    v_state := pg_temp.state_of(format('SELECT catalogue.set_listing_status(%L, ''published'')', v_listing));
    PERFORM pg_temp.ok(v_state = 'PG422 a file to deliver',
        format('9 a product whose files name no library file is refused (PG422 a file to deliver; got %s)', v_state));

    PERFORM catalogue.save_listing(v_listing, jsonb_build_object('file_manifest', jsonb_build_array(jsonb_build_object(
        'name', 'Bundle.zip', 'label', 'Bundle', 'extension', '.zip', 'bytes', 1, 'fileId', current_setting('probe.zip')))));
    PERFORM pg_temp.ok((catalogue.set_listing_status(v_listing, 'published') -> 'version' ->> 'version')::integer = 1,
        '9 with a library file attached it publishes and freezes version 1');
END $$;
RESET ROLE;
-- #endregion

ROLLBACK;
