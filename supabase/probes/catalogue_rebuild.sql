-- =============================================================================================
-- Probe: catalogue rebuild schema (Decision #217, work order C3) — the six-slot showcase and its
-- cover mirror, the tag cap and its index re-sync, save_listing's stale-write guard and offer/seo
-- envelopes, the batch status door, duplicate, the inquiry subject and the per-stage start triggers
-- instantiation writes (00000016, 00000018, 00000023, 00001170, 00001175, 00001300, 00001400).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/catalogue_rebuild.sql
--
-- Every expected refusal is asserted by its SQLSTATE inside its own exception block, so the claims set
-- before it survive. A clean run prints only PASS notices. Fixtures come from the seed.
-- =============================================================================================

BEGIN;

-- #region 0. Fixtures (as postgres)
-- A freelancer seller with two of their own uploaded images and a published, freelancer-owned
-- listing; a video file of theirs; a stranger who shares no team with them; a buyer with no thread
-- to them; and a published freelancer-owned Pipeline the buyer does not sell.
DO $$
DECLARE
    v_seller uuid;
    v_listing uuid;
    v_img_a uuid;
    v_img_b uuid;
    v_video uuid;
    v_stranger uuid;
    v_buyer uuid;
    v_pipeline uuid;
BEGIN
    SELECT l.owner_user_id, l.id INTO v_seller, v_listing
      FROM catalogue.listings l
      JOIN marketplace.service_blueprints b ON b.id = l.service_blueprint_id
     WHERE l.status = 'published' AND l.owner_team_id IS NULL AND b.delivery_model = 'one_off'
       AND NOT org.fn_is_minor(l.owner_user_id)
       AND (SELECT count(*) FROM files.items fi
             WHERE fi.owner_user_id = l.owner_user_id AND fi.mime_type LIKE 'image/%'
               AND fi.status = 'uploaded' AND fi.deleted_at IS NULL) >= 2
     ORDER BY l.id LIMIT 1;
    IF v_seller IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no adult one_off seller with two images'; END IF;

    SELECT fi.id INTO v_img_a FROM files.items fi
     WHERE fi.owner_user_id = v_seller AND fi.mime_type LIKE 'image/%' AND fi.status = 'uploaded' AND fi.deleted_at IS NULL
     ORDER BY fi.id LIMIT 1;
    SELECT fi.id INTO v_img_b FROM files.items fi
     WHERE fi.owner_user_id = v_seller AND fi.mime_type LIKE 'image/%' AND fi.status = 'uploaded' AND fi.deleted_at IS NULL
       AND fi.id <> v_img_a
     ORDER BY fi.id LIMIT 1;

    INSERT INTO files.items (owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes, status)
    VALUES (v_seller, 'catalogue', v_seller::text || '/probe-reel.mp4', 'Probe reel', 'probe-reel.mp4', 'video/mp4', 1024, 'uploaded')
    RETURNING id INTO v_video;

    SELECT u.user_id INTO v_stranger FROM org.users_public u
     WHERE u.user_id <> v_seller AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (
           SELECT 1 FROM org.team_members a JOIN org.team_members b ON b.team_id = a.team_id
            WHERE a.user_id = u.user_id AND b.user_id = v_seller
       )
     ORDER BY u.user_id LIMIT 1;

    SELECT u.user_id INTO v_buyer FROM org.users_public u
     WHERE u.user_id NOT IN (v_seller, v_stranger) AND NOT org.fn_is_minor(u.user_id)
       AND NOT EXISTS (
           SELECT 1 FROM comms.dm_threads t
             JOIN comms.dm_participants p1 ON p1.thread_id = t.id AND p1.user_id = u.user_id
             JOIN comms.dm_participants p2 ON p2.thread_id = t.id AND p2.user_id = v_seller
       )
     ORDER BY u.user_id LIMIT 1;

    SELECT b.id INTO v_pipeline FROM marketplace.service_blueprints b
     WHERE b.delivery_model = 'pipeline' AND b.is_published AND b.owner_team_id IS NULL
       AND b.freelancer_profile_id <> v_buyer
       AND NOT EXISTS (SELECT 1 FROM projects.projects p WHERE p.owner_user_id = v_buyer AND p.source_blueprint_id = b.id)
     ORDER BY b.slug LIMIT 1;

    IF v_img_b IS NULL OR v_stranger IS NULL OR v_buyer IS NULL OR v_pipeline IS NULL THEN
        RAISE EXCEPTION 'FAIL fixture: img_b=% stranger=% buyer=% pipeline=%', v_img_b, v_stranger, v_buyer, v_pipeline;
    END IF;

    PERFORM set_config('probe.seller', v_seller::text, true);
    PERFORM set_config('probe.listing', v_listing::text, true);
    PERFORM set_config('probe.img_a', v_img_a::text, true);
    PERFORM set_config('probe.img_b', v_img_b::text, true);
    PERFORM set_config('probe.video', v_video::text, true);
    PERFORM set_config('probe.stranger', v_stranger::text, true);
    PERFORM set_config('probe.buyer', v_buyer::text, true);
    PERFORM set_config('probe.pipeline', v_pipeline::text, true);
    RAISE NOTICE 'fixture seller=% listing=% stranger=% buyer=% pipeline=%', v_seller, v_listing, v_stranger, v_buyer, v_pipeline;
END $$;
-- #endregion

-- #region 1. anon — no EXECUTE on the new doors
SET LOCAL ROLE anon;
DO $$
BEGIN
    IF has_function_privilege('anon', 'catalogue.apply_listing_media(uuid, jsonb)', 'EXECUTE')
       OR has_function_privilege('anon', 'catalogue.set_listings_status(uuid[], text)', 'EXECUTE')
       OR has_function_privilege('anon', 'catalogue.duplicate_listing(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL grants: anon can execute a catalogue door';
    END IF;
    IF NOT has_function_privilege('authenticated', 'catalogue.apply_listing_media(uuid, jsonb)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL grants: authenticated cannot execute apply_listing_media';
    END IF;
    RAISE NOTICE 'PASS grants: the new doors are authenticated-only';
END $$;
RESET ROLE;
-- #endregion

-- #region 2. The seller drafts a product and a One-Off service
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.seller'), 'role', 'authenticated')::text, true);

DO $$
DECLARE
    v_product jsonb;
    v_service jsonb;
    v_bare jsonb;
BEGIN
    v_product := catalogue.create_listing('product', 'Probe product');
    v_service := catalogue.create_listing('service', 'Probe one-off', 'one_off');
    v_bare := catalogue.create_listing('service', 'Probe bare', 'one_off');
    PERFORM set_config('probe.product', v_product ->> 'listing_id', true);
    PERFORM set_config('probe.service', v_service ->> 'listing_id', true);
    PERFORM set_config('probe.bare', v_bare ->> 'listing_id', true);
    IF (SELECT licence FROM catalogue.products p JOIN catalogue.listings l ON l.product_id = p.id
         WHERE l.id = (v_product ->> 'listing_id')::uuid) <> 'personal' THEN
        RAISE EXCEPTION 'FAIL product licence default is not personal';
    END IF;
    RAISE NOTICE 'PASS drafts created; a new product defaults to the personal licence';
END $$;
-- #endregion

-- #region 3. Showcase CHECKs: a video in slot 1, a 7th slot, a duplicate position
DO $$
DECLARE
    v_listing uuid := current_setting('probe.product')::uuid;
    v_img text := current_setting('probe.img_a');
    v_video text := current_setting('probe.video');
BEGIN
    BEGIN
        PERFORM catalogue.apply_listing_media(v_listing, jsonb_build_array(
            jsonb_build_object('position', 1, 'file_id', v_video, 'kind', 'video')));
        RAISE EXCEPTION 'FAIL video in slot 1 accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '23514' THEN RAISE EXCEPTION 'FAIL video in slot 1: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS a video in slot 1 is refused (23514)';

    BEGIN
        PERFORM catalogue.apply_listing_media(v_listing, (
            SELECT jsonb_agg(jsonb_build_object('position', n, 'file_id', v_img, 'kind', 'image'))
              FROM generate_series(1, 7) n));
        RAISE EXCEPTION 'FAIL seven slots accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL seven slots: % %', SQLSTATE, SQLERRM; END IF;
    END;

    BEGIN
        PERFORM catalogue.apply_listing_media(v_listing, jsonb_build_array(
            jsonb_build_object('position', 7, 'file_id', v_img, 'kind', 'image')));
        RAISE EXCEPTION 'FAIL position 7 accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '23514' THEN RAISE EXCEPTION 'FAIL position 7: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS a 7th slot is refused (22023 by count, 23514 by position)';

    BEGIN
        PERFORM catalogue.apply_listing_media(v_listing, jsonb_build_array(
            jsonb_build_object('position', 1, 'file_id', v_img, 'kind', 'image'),
            jsonb_build_object('position', 1, 'file_id', v_img, 'kind', 'image')));
        RAISE EXCEPTION 'FAIL duplicate position accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL duplicate position: % %', SQLSTATE, SQLERRM; END IF;
    END;

    BEGIN
        PERFORM catalogue.apply_listing_media(v_listing, jsonb_build_array(
            jsonb_build_object('position', 2, 'file_id', v_img, 'kind', 'video')));
        RAISE EXCEPTION 'FAIL an image filed as a video accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '42501' THEN RAISE EXCEPTION 'FAIL kind/mime mismatch: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS duplicate positions (22023) and a kind/mime mismatch (42501) are refused';
END $$;
-- #endregion

-- #region 4. Cover mirror
DO $$
DECLARE
    v_listing uuid := current_setting('probe.service')::uuid;
    v_a uuid := current_setting('probe.img_a')::uuid;
    v_b uuid := current_setting('probe.img_b')::uuid;
    v_result jsonb;
    v_cover uuid;
BEGIN
    v_result := catalogue.apply_listing_media(v_listing, jsonb_build_array(
        jsonb_build_object('position', 1, 'file_id', v_a, 'rendition_file_id', v_b, 'kind', 'image', 'alt_text', 'Cover'),
        jsonb_build_object('position', 2, 'file_id', current_setting('probe.video'), 'kind', 'video', 'poster_file_id', v_a)));
    SELECT b.cover_file_id INTO v_cover FROM marketplace.service_blueprints b
      JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;
    IF v_cover IS DISTINCT FROM v_b OR (v_result ->> 'cover_file_id')::uuid IS DISTINCT FROM v_b THEN
        RAISE EXCEPTION 'FAIL cover mirror with a rendition: % (result %)', v_cover, v_result;
    END IF;

    PERFORM catalogue.apply_listing_media(v_listing, jsonb_build_array(
        jsonb_build_object('position', 1, 'file_id', v_a, 'kind', 'image'),
        jsonb_build_object('position', 2, 'file_id', current_setting('probe.video'), 'kind', 'video')));
    SELECT b.cover_file_id INTO v_cover FROM marketplace.service_blueprints b
      JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;
    IF v_cover IS DISTINCT FROM v_a THEN
        RAISE EXCEPTION 'FAIL cover mirror without a rendition: %', v_cover;
    END IF;
    IF (SELECT count(*) FROM catalogue.listing_media m WHERE m.listing_id = v_listing) <> 2 THEN
        RAISE EXCEPTION 'FAIL showcase rows were not replaced';
    END IF;
    RAISE NOTICE 'PASS slot 1 (rendition, else original) is mirrored to the blueprint cover';
END $$;
-- #endregion

-- #region 5. Tags: 10 accepted and indexed at weight B, the 11th refused
DO $$
BEGIN
    PERFORM catalogue.save_listing(current_setting('probe.service')::uuid, jsonb_build_object('tags',
        (SELECT jsonb_agg('zebratag' || n) FROM generate_series(1, 10) n)));
END $$;

RESET ROLE;
DO $$
DECLARE
    v_tags text[];
    v_fts tsvector;
BEGIN
    SELECT si.tags, si.fts INTO v_tags, v_fts FROM search.services_index si
      JOIN catalogue.listings l ON l.service_blueprint_id = si.service_id
     WHERE l.id = current_setting('probe.service')::uuid;
    IF cardinality(v_tags) <> 10 THEN
        RAISE EXCEPTION 'FAIL services_index.tags not re-synced: %', v_tags;
    END IF;
    IF NOT (v_fts @@ to_tsquery('english', 'zebratag1'))
       OR NOT EXISTS (SELECT 1 FROM unnest(v_fts) u WHERE u.lexeme = 'zebratag1' AND 'B' = ANY (u.weights::text[])) THEN
        RAISE EXCEPTION 'FAIL tags are not in the fts at weight B: %', v_fts;
    END IF;
    RAISE NOTICE 'PASS 10 tags re-sync services_index and enter its fts at weight B';
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
    v_listing uuid := current_setting('probe.service')::uuid;
BEGIN
    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('tags',
            (SELECT jsonb_agg('zebratag' || n) FROM generate_series(1, 11) n)));
        RAISE EXCEPTION 'FAIL eleven tags accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> 'PG422' THEN RAISE EXCEPTION 'FAIL eleven tags: % %', SQLSTATE, SQLERRM; END IF;
    END;

    BEGIN
        INSERT INTO catalogue.listing_tags (listing_id, tag) VALUES (v_listing, 'eleventh');
        RAISE EXCEPTION 'FAIL a direct 11th tag insert accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> 'PG422' THEN RAISE EXCEPTION 'FAIL direct 11th tag: % %', SQLSTATE, SQLERRM; END IF;
    END;

    RAISE NOTICE 'PASS the 11th tag is refused (PG422 tags_max) by save_listing and by a direct insert';
    DELETE FROM catalogue.listing_tags WHERE listing_id = v_listing AND tag = 'zebratag10';
END $$;

RESET ROLE;
DO $$
BEGIN
    IF (SELECT cardinality(si.tags) FROM search.services_index si
          JOIN catalogue.listings l ON l.service_blueprint_id = si.service_id
         WHERE l.id = current_setting('probe.service')::uuid) <> 9 THEN
        RAISE EXCEPTION 'FAIL a tag delete did not re-sync the index';
    END IF;
    RAISE NOTICE 'PASS a tag delete re-syncs the index row';
END $$;
SET LOCAL ROLE authenticated;
-- #endregion

-- #region 6. save_listing: stale guard, envelopes, validation
DO $$
DECLARE
    v_listing uuid := current_setting('probe.service')::uuid;
    v_product uuid := current_setting('probe.product')::uuid;
    v_now timestamptz;
    v_result jsonb;
    v_bp marketplace.service_blueprints;
BEGIN
    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object(
            'title', 'Stale', 'expected_updated_at', '2000-01-01T00:00:00Z'));
        RAISE EXCEPTION 'FAIL stale save accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> 'PC409' THEN RAISE EXCEPTION 'FAIL stale save: % %', SQLSTATE, SQLERRM; END IF;
    END;

    SELECT updated_at INTO v_now FROM catalogue.listings WHERE id = v_listing;
    v_result := catalogue.save_listing(v_listing, jsonb_build_object(
        'expected_updated_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'amount_cents', 25000,
        'offer', jsonb_build_object(
            'archetype', 'one_off',
            'milestones', jsonb_build_array(
                jsonb_build_object('name', 'Discovery', 'deliverables', jsonb_build_array('Brief'), 'startTrigger', 'after_previous', 'lagDays', 0, 'chainReaction', true),
                jsonb_build_object('name', 'Delivery', 'startTrigger', 'fixed_offset', 'lagDays', 2, 'chainReaction', false)),
            'turnaroundDays', 7,
            'scope', jsonb_build_array('Two concepts', 'One revision'),
            'teamRoles', '[]'::jsonb),
        'seo', jsonb_build_object('seoTitle', 'Probe SEO title', 'seoDescription', 'Probe description', 'createCategory', 'create')));
    IF (v_result ->> 'listing_id')::uuid <> v_listing THEN
        RAISE EXCEPTION 'FAIL save_listing result: %', v_result;
    END IF;
    SELECT b.* INTO v_bp FROM marketplace.service_blueprints b JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_listing;
    IF v_bp.turnaround_days <> 7 OR v_bp.deliverables <> ARRAY['Two concepts', 'One revision']
       OR jsonb_array_length(v_bp.stage_template) <> 2 OR v_bp.stage_template -> 1 ->> 'startTrigger' <> 'fixed_offset' THEN
        RAISE EXCEPTION 'FAIL offer envelope not decoded: turnaround=% deliverables=% stages=%', v_bp.turnaround_days, v_bp.deliverables, v_bp.stage_template;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM catalogue.listings l WHERE l.id = v_listing
                     AND l.seo_title = 'Probe SEO title' AND l.create_category = 'create') THEN
        RAISE EXCEPTION 'FAIL seo envelope not decoded';
    END IF;
    RAISE NOTICE 'PASS PC409 on a stale expected_updated_at; a fresh one saves; offer and seo envelopes decode';

    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('stage_template',
            jsonb_build_array(jsonb_build_object('name', 'Bad', 'startTrigger', 'whenever'))));
        RAISE EXCEPTION 'FAIL unknown startTrigger accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL unknown startTrigger: % %', SQLSTATE, SQLERRM; END IF;
    END;
    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('stage_template',
            jsonb_build_array(jsonb_build_object('name', repeat('x', 81)))));
        RAISE EXCEPTION 'FAIL an 81-character stage name accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL long stage name: % %', SQLSTATE, SQLERRM; END IF;
    END;
    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('offer',
            jsonb_build_object('archetype', 'pipeline', 'stages', '[]'::jsonb, 'teamRoles', '[]'::jsonb)));
        RAISE EXCEPTION 'FAIL a pipeline offer on a one-off accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL archetype mismatch: % %', SQLSTATE, SQLERRM; END IF;
    END;
    BEGIN
        PERFORM catalogue.save_listing(v_listing, jsonb_build_object('licence', 'commercial'));
        RAISE EXCEPTION 'FAIL a licence on a service accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL licence on a service: % %', SQLSTATE, SQLERRM; END IF;
    END;

    PERFORM catalogue.save_listing(v_product, jsonb_build_object('offer', jsonb_build_object(
        'archetype', 'product', 'format', 'bundle', 'licence', 'commercial', 'attributionRequired', true,
        'attachments', '[]'::jsonb)));
    IF NOT EXISTS (SELECT 1 FROM catalogue.products p JOIN catalogue.listings l ON l.product_id = p.id
                    WHERE l.id = v_product AND p.licence = 'commercial' AND p.format = 'bundle' AND p.attribution_required) THEN
        RAISE EXCEPTION 'FAIL product offer not decoded';
    END IF;
    BEGIN
        PERFORM catalogue.save_listing(v_product, jsonb_build_object('licence', 'standard'));
        RAISE EXCEPTION 'FAIL the retired standard licence accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22P02' THEN RAISE EXCEPTION 'FAIL standard licence: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS stage shape, archetype and kind are validated; product licence is the enum';
END $$;
-- #endregion

-- #region 7. Batch partial success: one listing gated, one published
DO $$
DECLARE
    v_ready uuid := current_setting('probe.service')::uuid;
    v_bare uuid := current_setting('probe.bare')::uuid;
    v_out jsonb[];
BEGIN
    PERFORM catalogue.save_listing(v_bare, jsonb_build_object('amount_cents', 1000));
    v_out := catalogue.set_listings_status(ARRAY[v_ready, v_bare, v_ready], 'published');
    IF cardinality(v_out) <> 2 THEN
        RAISE EXCEPTION 'FAIL batch did not de-duplicate: %', v_out;
    END IF;
    IF NOT (v_out[1] ->> 'ok')::boolean OR (v_out[1] ->> 'listing_id')::uuid <> v_ready THEN
        RAISE EXCEPTION 'FAIL the ready listing was not published: %', v_out[1];
    END IF;
    IF (v_out[2] ->> 'ok')::boolean OR v_out[2] ->> 'code' <> 'PG422' OR strpos(v_out[2] ->> 'detail', 'a cover image') = 0 THEN
        RAISE EXCEPTION 'FAIL the bare listing was not gated on its cover: %', v_out[2];
    END IF;
    IF (SELECT status FROM catalogue.listings WHERE id = v_ready) <> 'published'
       OR (SELECT status FROM catalogue.listings WHERE id = v_bare) <> 'draft' THEN
        RAISE EXCEPTION 'FAIL batch statuses did not land per row';
    END IF;
    IF NOT (SELECT b.is_published FROM marketplace.service_blueprints b JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_ready) THEN
        RAISE EXCEPTION 'FAIL the published listing''s blueprint did not follow';
    END IF;
    RAISE NOTICE 'PASS batch: one published, one gated (PG422 a cover image), each in its own sub-transaction';

    BEGIN
        PERFORM catalogue.save_listing(v_ready, jsonb_build_object('delivery_model', 'pipeline'));
        RAISE EXCEPTION 'FAIL a live listing changed its delivery model';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL live delivery model change: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS a published listing keeps its delivery model (22023)';
END $$;
-- #endregion

-- #region 8. Duplicate
DO $$
DECLARE
    v_src uuid := current_setting('probe.service')::uuid;
    v_out jsonb;
    v_copy catalogue.listings;
    v_src_bp marketplace.service_blueprints;
    v_copy_bp marketplace.service_blueprints;
BEGIN
    v_out := catalogue.duplicate_listing(v_src);
    SELECT * INTO v_copy FROM catalogue.listings WHERE id = (v_out ->> 'listing_id')::uuid;
    SELECT b.* INTO v_src_bp FROM marketplace.service_blueprints b JOIN catalogue.listings l ON l.service_blueprint_id = b.id WHERE l.id = v_src;
    SELECT * INTO v_copy_bp FROM marketplace.service_blueprints WHERE id = v_copy.service_blueprint_id;
    IF v_copy.id IS NULL OR v_copy.status <> 'draft' OR v_copy.title NOT LIKE '% (copy)'
       OR v_copy.seo_title IS DISTINCT FROM 'Probe SEO title' THEN
        RAISE EXCEPTION 'FAIL duplicate listing row: %', row_to_json(v_copy);
    END IF;
    IF v_copy_bp.slug = v_src_bp.slug OR v_copy_bp.slug !~ '^svc-' OR v_out ->> 'slug' <> v_copy_bp.slug
       OR v_copy_bp.is_published OR v_copy_bp.stage_template <> v_src_bp.stage_template
       OR v_copy_bp.turnaround_days IS DISTINCT FROM v_src_bp.turnaround_days
       OR v_copy_bp.cover_file_id IS DISTINCT FROM v_src_bp.cover_file_id THEN
        RAISE EXCEPTION 'FAIL duplicate blueprint: src % copy %', v_src_bp.slug, v_copy_bp.slug;
    END IF;
    IF (SELECT array_agg(file_id ORDER BY position) FROM catalogue.listing_media WHERE listing_id = v_copy.id)
       IS DISTINCT FROM (SELECT array_agg(file_id ORDER BY position) FROM catalogue.listing_media WHERE listing_id = v_src)
       OR (SELECT count(*) FROM catalogue.listing_tags WHERE listing_id = v_copy.id) <> 9 THEN
        RAISE EXCEPTION 'FAIL duplicate children (media by file id, tags)';
    END IF;
    RAISE NOTICE 'PASS duplicate: a draft copy of subject, showcase, tags and SEO under a new svc- slug';
END $$;
-- #endregion

-- #region 9. A stranger cannot touch the seller's showcase
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.stranger'), 'role', 'authenticated')::text, true);
DO $$
BEGIN
    BEGIN
        PERFORM catalogue.apply_listing_media(current_setting('probe.service')::uuid, jsonb_build_array(
            jsonb_build_object('position', 1, 'file_id', current_setting('probe.img_a'), 'kind', 'image')));
        RAISE EXCEPTION 'FAIL a stranger replaced the showcase';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE NOT IN ('42501', 'PB404') THEN RAISE EXCEPTION 'FAIL stranger media: % %', SQLSTATE, SQLERRM; END IF;
    END;
    BEGIN
        PERFORM catalogue.duplicate_listing(current_setting('probe.listing')::uuid);
        RAISE EXCEPTION 'FAIL a stranger duplicated the listing';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE NOT IN ('42501', 'PB404') THEN RAISE EXCEPTION 'FAIL stranger duplicate: % %', SQLSTATE, SQLERRM; END IF;
    END;
    IF NOT (catalogue.set_listings_status(ARRAY[current_setting('probe.listing')::uuid], 'paused'))[1] ->> 'ok' = 'false' THEN
        RAISE EXCEPTION 'FAIL a stranger paused the listing through the batch';
    END IF;
    RAISE NOTICE 'PASS a stranger cannot apply media to, duplicate or batch-pause someone else''s listing';
END $$;
-- #endregion

-- #region 10. The inquiry subject
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_thread uuid;
BEGIN
    BEGIN
        PERFORM comms.get_or_create_dm_thread(current_setting('probe.seller')::uuid, current_setting('probe.bare')::uuid);
        RAISE EXCEPTION 'FAIL an inquiry about an unpublished listing opened';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '22023' THEN RAISE EXCEPTION 'FAIL unpublished subject: % %', SQLSTATE, SQLERRM; END IF;
    END;

    v_thread := comms.get_or_create_dm_thread(current_setting('probe.seller')::uuid, current_setting('probe.listing')::uuid);
    PERFORM set_config('probe.thread', v_thread::text, true);
    RAISE NOTICE 'PASS the opener refuses a subject that is not on sale from the recipient';
END $$;
RESET ROLE;

DO $$
DECLARE
    v_thread uuid := current_setting('probe.thread')::uuid;
    v_dm uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM comms.dm_threads t WHERE t.id = v_thread
                     AND t.kind = 'service_inquiry' AND t.subject_listing_id = current_setting('probe.listing')::uuid) THEN
        RAISE EXCEPTION 'FAIL the opener did not make a service inquiry about the listing';
    END IF;

    SELECT t.id INTO v_dm FROM comms.dm_threads t WHERE t.kind = 'dm' ORDER BY t.id LIMIT 1;
    IF v_dm IS NULL THEN RAISE EXCEPTION 'FAIL fixture: no dm thread in the seed'; END IF;
    BEGIN
        UPDATE comms.dm_threads SET subject_listing_id = current_setting('probe.listing')::uuid WHERE id = v_dm;
        RAISE EXCEPTION 'FAIL a dm thread took a subject listing';
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> '23514' THEN RAISE EXCEPTION 'FAIL dm subject: % %', SQLSTATE, SQLERRM; END IF;
    END;
    RAISE NOTICE 'PASS an inquiry carries its subject; subject_listing_id on a dm thread is refused (23514)';

    BEGIN
        INSERT INTO search.interest_events (event_type, entity_id, entity_type, session_id)
        VALUES ('view', current_setting('probe.listing')::uuid, 'service', 'probe-session');
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'FAIL a view event was refused: % %', SQLSTATE, SQLERRM;
    END;
    RAISE NOTICE 'PASS interest_events accepts a view';
END $$;
-- #endregion

-- #region 11. Instantiation maps each stage's start trigger
DO $$
BEGIN
    UPDATE marketplace.service_blueprints SET stage_template = jsonb_build_array(
        jsonb_build_object('name', 'Kickoff', 'startTrigger', 'after_previous', 'lagDays', 5, 'chainReaction', true),
        jsonb_build_object('name', 'Build', 'startTrigger', 'fixed_offset', 'lagDays', 3, 'chainReaction', true),
        jsonb_build_object('name', 'Launch', 'startTrigger', 'on_project_start', 'chainReaction', false)
    ) WHERE id = current_setting('probe.pipeline')::uuid;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
    json_build_object('sub', current_setting('probe.buyer'), 'role', 'authenticated')::text, true);
DO $$
DECLARE
    v_draft jsonb;
BEGIN
    v_draft := marketplace.instantiate_service_blueprint(current_setting('probe.pipeline')::uuid, '{}'::jsonb, NULL, 'probe-c3-triggers');
    PERFORM set_config('probe.project_slug', v_draft ->> 'slug', true);
    PERFORM set_config('probe.project_id', COALESCE(v_draft ->> 'project_id', v_draft ->> 'id', ''), true);
END $$;
RESET ROLE;

DO $$
DECLARE
    v_project uuid;
    s record;
    v_ids uuid[] := ARRAY[]::uuid[];
    v_types text[] := ARRAY[]::text[];
    v_deps uuid[] := ARRAY[]::uuid[];
    v_lags integer[] := ARRAY[]::integer[];
    v_chains boolean[] := ARRAY[]::boolean[];
BEGIN
    SELECT si.project_id INTO v_project FROM projects.service_instantiations si
     WHERE si.blueprint_id = current_setting('probe.pipeline')::uuid
       AND si.owner_user_id = current_setting('probe.buyer')::uuid AND si.idempotency_key = 'probe-c3-triggers';
    IF v_project IS NULL THEN RAISE EXCEPTION 'FAIL instantiation recorded no project'; END IF;
    FOR s IN SELECT * FROM projects.project_stages WHERE project_id = v_project ORDER BY sort_order LOOP
        v_ids := v_ids || s.id;
        v_types := v_types || s.start_trigger_type::text;
        v_deps := v_deps || s.start_dependency_stage_id;
        v_lags := v_lags || COALESCE(s.start_dependency_lag_days, 0);
        v_chains := v_chains || s.chain_reaction;
    END LOOP;
    IF cardinality(v_ids) <> 3
       OR v_types <> ARRAY['on_project_start', 'dependent_on_stage', 'on_project_start']
       OR v_deps[1] IS NOT NULL OR v_deps[2] IS DISTINCT FROM v_ids[1] OR v_deps[3] IS NOT NULL
       OR v_lags <> ARRAY[0, 3, 0]
       OR v_chains <> ARRAY[true, true, false] THEN
        RAISE EXCEPTION 'FAIL trigger mapping: types=% deps=% lags=% chains=%', v_types, v_deps, v_lags, v_chains;
    END IF;
    RAISE NOTICE 'PASS a 3-stage pipeline instantiates as on_project_start → dependent(+3d) → on_project_start, chain kept';
END $$;
-- #endregion

-- #region 12. listing_availability is gone
DO $$
BEGIN
    IF to_regclass('catalogue.listing_availability') IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL catalogue.listing_availability still exists';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'catalogue' AND table_name = 'listing_media' AND column_name = 'url') THEN
        RAISE EXCEPTION 'FAIL catalogue.listing_media.url still exists';
    END IF;
    IF EXISTS (SELECT 1 FROM catalogue.listing_media m WHERE m.position NOT BETWEEN 1 AND 6)
       OR EXISTS (SELECT 1 FROM catalogue.listing_media m GROUP BY m.listing_id HAVING count(*) > 6) THEN
        RAISE EXCEPTION 'FAIL seeded media out of the 6 slots';
    END IF;
    RAISE NOTICE 'PASS listing_availability and listing_media.url are gone; seeded media fit six slots';
END $$;
-- #endregion

ROLLBACK;
