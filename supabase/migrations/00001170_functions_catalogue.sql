-- =============================================================================================
-- 00001170_functions_catalogue.sql — the seller console's write doors (Category 1).
--
-- A listing is TWO rows that must agree: the `catalogue.listings` row the console edits and the
-- subject it points at — a `catalogue.products` row or a `marketplace.service_blueprints` row — which
-- is what the checkout charges (`finance.place_wallet_order` re-prices a product from
-- `products.price_cents`) and what the booking and discovery paths read their delivery terms from.
-- Written as separate PostgREST requests, a save that failed halfway would leave the card and the
-- charge disagreeing about the price. So each operation is ONE function, and therefore one
-- transaction: create, save and publish either happen to both rows or to neither.
--
-- Every function here is SECURITY INVOKER on purpose. The catalogue and marketplace policies
-- (00002018, 00002020) already say who may write what — the seller, in their own name, a team row
-- only as an active member — and running as the caller keeps them the gate. A definer would have to
-- restate them, and a restated rule is one that can drift. The one definer below is the sales read,
-- which must see order lines the seller's own policies do not reach (they belong to the buyers).
--
-- Every UPDATE of a subject checks its row count. Under RLS an UPDATE the caller may not make does
-- not raise, it simply matches nothing — and a save that quietly updated the listing but not its
-- product is exactly the drift these functions exist to prevent.
-- =============================================================================================

-- #region Create
-- A new DRAFT: the subject first (its `svc-`/`prd-` slug is minted by `security.fn_slug_guard`), then
-- the listing that points at it. Nothing is priced and nothing is published — the draft is the start
-- of the edit, and the publish gate (below) is what a listing must pass to go live.
CREATE OR REPLACE FUNCTION catalogue.create_listing(
    p_kind text,
    p_title text,
    p_delivery_model text DEFAULT NULL,
    p_team uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = catalogue, marketplace, org, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_title text := pg_catalog.btrim(COALESCE(p_title, ''));
    v_subject uuid;
    v_slug text;
    v_listing uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to create a listing' USING ERRCODE = '42501';
    END IF;
    IF v_title = '' OR pg_catalog.length(v_title) > 200 THEN
        RAISE EXCEPTION 'Name your listing (up to 200 characters)' USING ERRCODE = '22023';
    END IF;
    IF p_team IS NOT NULL AND NOT org.is_active_team_member (p_team) THEN
        RAISE EXCEPTION 'Only an active member can list for this team' USING ERRCODE = '42501';
    END IF;

    IF p_kind = 'service' THEN
        IF p_delivery_model IS NULL THEN
            RAISE EXCEPTION 'Pick a delivery model' USING ERRCODE = '22023';
        END IF;
        -- A service is delivered by a freelancer (`service_blueprints.freelancer_profile_id`); a buyer
        -- account has no seller profile to deliver it from.
        IF NOT EXISTS (SELECT 1 FROM org.freelancer_profiles fp WHERE fp.user_id = v_uid) THEN
            RAISE EXCEPTION 'Only a freelancer can sell a service' USING ERRCODE = '42501';
        END IF;
        INSERT INTO marketplace.service_blueprints (
            owner_type, owner_team_id, freelancer_profile_id, title, delivery_model, price_cents, is_published
        )
        VALUES (
            CASE WHEN p_team IS NULL THEN 'freelancer' ELSE 'team' END, p_team, v_uid, v_title,
            p_delivery_model::marketplace.service_delivery_model, 0, false
        )
        RETURNING id, slug INTO v_subject, v_slug;

        INSERT INTO catalogue.listings (owner_user_id, owner_team_id, kind, status, service_blueprint_id, title)
        VALUES (v_uid, p_team, 'service', 'draft', v_subject, v_title)
        RETURNING id INTO v_listing;
    ELSIF p_kind = 'product' THEN
        INSERT INTO catalogue.products (owner_user_id, owner_team_id, title, price_cents)
        VALUES (v_uid, p_team, v_title, 0)
        RETURNING id, slug INTO v_subject, v_slug;

        INSERT INTO catalogue.listings (owner_user_id, owner_team_id, kind, status, product_id, title, delivery_label)
        VALUES (v_uid, p_team, 'product', 'draft', v_subject, v_title, 'Instant download')
        RETURNING id INTO v_listing;
    ELSE
        RAISE EXCEPTION 'A listing is a product or a service' USING ERRCODE = '22023';
    END IF;

    RETURN pg_catalog.jsonb_build_object('listing_id', v_listing, 'slug', v_slug);
END;
$$;

COMMENT ON FUNCTION catalogue.create_listing(text, text, text, uuid) IS
'Create a DRAFT listing and its subject (a product, or a service blueprint for a freelancer) in one
transaction, as the caller. Returns { listing_id, slug } — the slug is the listing''s console and
public address. Refusals: 42501 not signed in / not a freelancer / not a member of the team ·
22023 bad title, kind or delivery model.';
-- #endregion

-- #region Save
-- Apply an editor patch. Only the keys PRESENT in `p_patch` change — an absent key keeps its value,
-- a key present as JSON null clears it — so a partial autosave cannot wipe fields it did not send.
--
-- Recognised keys: title · category · description_html · description_text · delivery_label ·
-- amount_cents · ticket_price_cents · session_price_cents · seats_per_session · free_revisions ·
-- extra_revision_price_cents · delivery_model (services) · intake (services) · media · skills · tags ·
-- availability · collections. `media` is an ordered [{ file_id?, url?, alt? }]; `skills` an array of
-- `org.skills` labels; `collections` an array of names.
CREATE OR REPLACE FUNCTION catalogue.save_listing(p_listing uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = catalogue, marketplace, org, files, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_patch jsonb := COALESCE(p_patch, '{}'::jsonb);
    v_row catalogue.listings;
    v_rows integer;
    v_item jsonb;
    v_file uuid;
    v_name text;
    v_collection uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to edit a listing' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.jsonb_typeof(v_patch) <> 'object' THEN
        RAISE EXCEPTION 'A save is an object of changed fields' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM catalogue.listings WHERE id = p_listing FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That listing no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF v_row.owner_user_id <> v_uid THEN
        RAISE EXCEPTION 'Only the seller who created this listing can edit it' USING ERRCODE = '42501';
    END IF;
    IF v_patch ? 'title' AND pg_catalog.btrim(COALESCE(v_patch ->> 'title', '')) = '' THEN
        RAISE EXCEPTION 'A listing needs a title' USING ERRCODE = '22023';
    END IF;

    -- #region The listing's own columns
    UPDATE catalogue.listings l SET
        title = CASE WHEN v_patch ? 'title' THEN pg_catalog.btrim(v_patch ->> 'title') ELSE l.title END,
        category = CASE WHEN v_patch ? 'category' THEN COALESCE(v_patch ->> 'category', '') ELSE l.category END,
        description = CASE WHEN v_patch ? 'description_html'
            THEN pg_catalog.jsonb_build_object('html', COALESCE(v_patch ->> 'description_html', ''))
            ELSE l.description END,
        description_text = CASE WHEN v_patch ? 'description_text'
            THEN COALESCE(v_patch ->> 'description_text', '') ELSE l.description_text END,
        delivery_label = CASE WHEN v_patch ? 'delivery_label'
            THEN COALESCE(v_patch ->> 'delivery_label', '') ELSE l.delivery_label END,
        amount_cents = CASE WHEN v_patch ? 'amount_cents'
            THEN COALESCE((v_patch ->> 'amount_cents')::bigint, 0) ELSE l.amount_cents END,
        ticket_price_cents = CASE WHEN v_patch ? 'ticket_price_cents'
            THEN (v_patch ->> 'ticket_price_cents')::bigint ELSE l.ticket_price_cents END,
        session_price_cents = CASE WHEN v_patch ? 'session_price_cents'
            THEN (v_patch ->> 'session_price_cents')::bigint ELSE l.session_price_cents END,
        seats_per_session = CASE WHEN v_patch ? 'seats_per_session'
            THEN (v_patch ->> 'seats_per_session')::integer ELSE l.seats_per_session END,
        free_revisions = CASE WHEN v_patch ? 'free_revisions'
            THEN (v_patch ->> 'free_revisions')::integer ELSE l.free_revisions END,
        extra_revision_price_cents = CASE WHEN v_patch ? 'extra_revision_price_cents'
            THEN (v_patch ->> 'extra_revision_price_cents')::bigint ELSE l.extra_revision_price_cents END,
        updated_at = pg_catalog.now()
    WHERE l.id = p_listing;

    SELECT * INTO v_row FROM catalogue.listings WHERE id = p_listing;
    -- #endregion

    -- #region The subject — kept in step with the listing, in the same transaction
    IF v_row.kind = 'product' THEN
        UPDATE catalogue.products p SET
            title = v_row.title,
            description = v_row.description,
            description_text = v_row.description_text,
            category = v_row.category,
            price_cents = v_row.amount_cents,
            currency = v_row.currency,
            updated_at = pg_catalog.now()
        WHERE p.id = v_row.product_id;
    ELSE
        UPDATE marketplace.service_blueprints b SET
            title = v_row.title,
            description = v_row.description,
            description_text = v_row.description_text,
            category = v_row.category,
            price_cents = v_row.amount_cents,
            ticket_price_cents = v_row.ticket_price_cents,
            session_price_cents = v_row.session_price_cents,
            currency = v_row.currency,
            free_revisions = v_row.free_revisions,
            extra_revision_price_cents = v_row.extra_revision_price_cents,
            max_seats_per_cohort = COALESCE(v_row.seats_per_session, b.max_seats_per_cohort),
            delivery_model = CASE WHEN v_patch ? 'delivery_model'
                THEN (v_patch ->> 'delivery_model')::marketplace.service_delivery_model ELSE b.delivery_model END,
            intake_fields = CASE WHEN v_patch ? 'intake' THEN COALESCE(v_patch -> 'intake', '[]'::jsonb) ELSE b.intake_fields END,
            updated_at = pg_catalog.now()
        WHERE b.id = v_row.service_blueprint_id;
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'This listing''s % could not be updated with it', CASE v_row.kind WHEN 'product' THEN 'product' ELSE 'service' END
            USING ERRCODE = '42501';
    END IF;
    -- #endregion

    -- #region Gallery — replaced whole, in order; position 0 is the cover
    IF v_patch ? 'media' THEN
        IF pg_catalog.jsonb_typeof(v_patch -> 'media') <> 'array' OR pg_catalog.jsonb_array_length(v_patch -> 'media') > 24 THEN
            RAISE EXCEPTION 'A gallery is a list of up to 24 images' USING ERRCODE = '22023';
        END IF;
        FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_patch -> 'media') LOOP
            v_file := NULLIF(v_item ->> 'file_id', '')::uuid;
            IF v_file IS NULL AND NULLIF(v_item ->> 'url', '') IS NULL THEN
                RAISE EXCEPTION 'Each gallery item needs a file or a link' USING ERRCODE = '22023';
            END IF;
            -- A file must be one the caller can read (their own library, under the files policies) and an
            -- image: the gallery is what a buyer SEES, and another person's private file is not the
            -- seller's to put on a public page.
            IF v_file IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM files.items fi
                WHERE fi.id = v_file AND fi.deleted_at IS NULL AND fi.mime_type LIKE 'image/%'
            ) THEN
                RAISE EXCEPTION 'A gallery image must be one of your own images' USING ERRCODE = '42501';
            END IF;
        END LOOP;

        DELETE FROM catalogue.listing_media WHERE listing_id = p_listing;
        INSERT INTO catalogue.listing_media (listing_id, file_id, url, alt_text, position)
        SELECT p_listing,
               NULLIF(m.value ->> 'file_id', '')::uuid,
               CASE WHEN NULLIF(m.value ->> 'file_id', '') IS NULL THEN NULLIF(m.value ->> 'url', '') END,
               pg_catalog.left(COALESCE(m.value ->> 'alt', ''), 200),
               (m.ordinality - 1)::integer
          FROM pg_catalog.jsonb_array_elements(v_patch -> 'media') WITH ORDINALITY AS m (value, ordinality);
    END IF;
    -- #endregion

    -- #region Skills — the controlled vocabulary only; a label nothing matches is dropped, not invented
    IF v_patch ? 'skills' THEN
        DELETE FROM catalogue.listing_skills WHERE listing_id = p_listing;
        INSERT INTO catalogue.listing_skills (listing_id, skill_id)
        SELECT DISTINCT p_listing, s.id
          FROM org.skills s
         WHERE pg_catalog.lower(s.label) IN (
               SELECT pg_catalog.lower(pg_catalog.btrim(x)) FROM pg_catalog.jsonb_array_elements_text(COALESCE(v_patch -> 'skills', '[]'::jsonb)) x
         );
    END IF;
    -- #endregion

    -- #region Tags — the seller's own words, trimmed, de-duplicated case-insensitively
    IF v_patch ? 'tags' THEN
        DELETE FROM catalogue.listing_tags WHERE listing_id = p_listing;
        INSERT INTO catalogue.listing_tags (listing_id, tag)
        SELECT p_listing, t.tag
          FROM (
              SELECT DISTINCT ON (pg_catalog.lower(pg_catalog.btrim(x))) pg_catalog.btrim(x) AS tag
                FROM pg_catalog.jsonb_array_elements_text(COALESCE(v_patch -> 'tags', '[]'::jsonb)) x
               WHERE pg_catalog.length(pg_catalog.btrim(x)) BETWEEN 1 AND 40
          ) t
         LIMIT 24;
    END IF;
    -- #endregion

    -- #region Availability — a session's weekly window; null clears it
    IF v_patch ? 'availability' THEN
        IF pg_catalog.jsonb_typeof(v_patch -> 'availability') IS DISTINCT FROM 'object' THEN
            DELETE FROM catalogue.listing_availability WHERE listing_id = p_listing;
        ELSE
            INSERT INTO catalogue.listing_availability (listing_id, timezone, weekdays, start_hour, end_hour, note)
            VALUES (
                p_listing,
                COALESCE(NULLIF(v_patch -> 'availability' ->> 'timezone', ''), 'UTC'),
                COALESCE(ARRAY(
                    SELECT DISTINCT d::smallint
                      FROM pg_catalog.jsonb_array_elements_text(COALESCE(v_patch -> 'availability' -> 'weekdays', '[]'::jsonb)) d
                ), '{}'::smallint[]),
                COALESCE((v_patch -> 'availability' ->> 'start_hour')::smallint, 9),
                COALESCE((v_patch -> 'availability' ->> 'end_hour')::smallint, 17),
                pg_catalog.left(COALESCE(v_patch -> 'availability' ->> 'note', ''), 400)
            )
            ON CONFLICT (listing_id) DO UPDATE SET
                timezone = EXCLUDED.timezone,
                weekdays = EXCLUDED.weekdays,
                start_hour = EXCLUDED.start_hour,
                end_hour = EXCLUDED.end_hour,
                note = EXCLUDED.note;
        END IF;
    END IF;
    -- #endregion

    -- #region Collections — by name; a new name becomes a new collection of the seller's
    IF v_patch ? 'collections' THEN
        DELETE FROM catalogue.collection_listings cl
         USING catalogue.collections c
         WHERE cl.listing_id = p_listing AND c.id = cl.collection_id AND c.owner_user_id = v_uid;
        FOR v_name IN
            SELECT DISTINCT ON (pg_catalog.lower(pg_catalog.btrim(x))) pg_catalog.btrim(x)
              FROM pg_catalog.jsonb_array_elements_text(COALESCE(v_patch -> 'collections', '[]'::jsonb)) x
             WHERE pg_catalog.length(pg_catalog.btrim(x)) BETWEEN 1 AND 80
        LOOP
            INSERT INTO catalogue.collections (owner_user_id, name, slug)
            VALUES (
                v_uid, v_name,
                COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(v_name), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'collection')
            )
            ON CONFLICT (owner_user_id, slug) DO UPDATE SET updated_at = pg_catalog.now()
            RETURNING id INTO v_collection;
            INSERT INTO catalogue.collection_listings (collection_id, listing_id)
            VALUES (v_collection, p_listing)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;
    -- #endregion
END;
$$;

COMMENT ON FUNCTION catalogue.save_listing(uuid, jsonb) IS
'Apply an editor patch to a listing AND its product or service blueprint in one transaction, as the
seller who created it. Only keys present in the patch change; children (gallery, skills, tags,
availability, collections) are replaced whole when present. Refusals: 42501 not the seller / a file
that is not theirs / the subject could not be updated · 22023 malformed patch · PB404 no such listing.';
-- #endregion

-- #region Status
-- Move a listing through its lifecycle (draft · published · paused · archived — nothing is ever
-- deleted). Publishing passes the gate the console shows — a title, a price and at least one image —
-- checked HERE as well, so a request built by hand cannot publish a listing the page would not have
-- let through. A service's blueprint follows the listing's publication, so discovery, booking and the
-- listing never disagree about whether the service is on sale.
CREATE OR REPLACE FUNCTION catalogue.set_listing_status(p_listing uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = catalogue, marketplace, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row catalogue.listings;
    v_missing text[] := ARRAY[]::text[];
    v_rows integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to change a listing' USING ERRCODE = '42501';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('draft', 'published', 'paused', 'archived') THEN
        RAISE EXCEPTION 'A listing is draft, published, paused or archived' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM catalogue.listings WHERE id = p_listing FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That listing no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF v_row.owner_user_id <> v_uid THEN
        RAISE EXCEPTION 'Only the seller who created this listing can change it' USING ERRCODE = '42501';
    END IF;

    IF p_status = 'published' THEN
        IF pg_catalog.btrim(v_row.title) = '' THEN
            v_missing := v_missing || 'a title'::text;
        END IF;
        IF NOT (v_row.amount_cents > 0 OR COALESCE(v_row.ticket_price_cents, 0) > 0 OR COALESCE(v_row.session_price_cents, 0) > 0) THEN
            v_missing := v_missing || 'a price'::text;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM catalogue.listing_media m WHERE m.listing_id = p_listing) THEN
            v_missing := v_missing || 'at least one image'::text;
        END IF;
        IF pg_catalog.cardinality(v_missing) > 0 THEN
            RAISE EXCEPTION 'Add % before publishing', pg_catalog.array_to_string(v_missing, ', ')
                USING ERRCODE = 'PG422', DETAIL = pg_catalog.array_to_string(v_missing, '|');
        END IF;
    END IF;

    UPDATE catalogue.listings l SET
        status = p_status::catalogue.listing_status,
        published_at = CASE WHEN p_status = 'published' THEN COALESCE(l.published_at, pg_catalog.now()) ELSE l.published_at END,
        updated_at = pg_catalog.now()
    WHERE l.id = p_listing;

    IF v_row.kind = 'service' THEN
        UPDATE marketplace.service_blueprints b
           SET is_published = (p_status = 'published'), updated_at = pg_catalog.now()
         WHERE b.id = v_row.service_blueprint_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'This listing''s service could not be updated with it' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object('listing_id', p_listing, 'status', p_status);
END;
$$;

COMMENT ON FUNCTION catalogue.set_listing_status(uuid, text) IS
'Move a listing to draft / published / paused / archived, as the seller who created it; a service''s
blueprint follows. Publishing needs a title, a price and at least one image. Refusals: 42501 not the
seller · 22023 unknown status · PB404 no such listing · PG422 the publish gate (DETAIL lists what is
missing, separated by |).';
-- #endregion

-- #region Sales
-- What each of the caller's listings has sold: completed orders and their gross, per currency, from
-- the buyers' order lines — which the seller's own policies cannot read, hence a definer. It answers
-- only for listings the caller owns (or belongs to the owning team of), so it discloses nothing about
-- any other seller. `p_since` narrows to a reporting window; NULL is all time. A refunded or
-- cancelled order is not a sale, and one still awaiting payment is not a sale yet.
CREATE OR REPLACE FUNCTION catalogue.get_listing_sales(p_listing_ids uuid[], p_since timestamptz DEFAULT NULL)
RETURNS TABLE (listing_id uuid, orders bigint, revenue_minor bigint, currency text, week_start date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT l.id,
           pg_catalog.count(ol.id),
           COALESCE(pg_catalog.sum(ol.line_total_minor), 0)::bigint,
           pg_catalog.upper(ol.currency),
           pg_catalog.date_trunc('week', ol.created_at)::date
      FROM catalogue.listings l
      JOIN finance.order_lines ol
        ON (l.kind = 'product'::catalogue.listing_kind AND ol.item_type = 'digital_product'::finance.purchasable_item_kind
            AND ol.item_id = l.product_id)
        OR (l.kind = 'service'::catalogue.listing_kind AND ol.item_id = l.service_blueprint_id)
      JOIN finance.orders o
        ON o.id = ol.order_id AND o.status IN ('confirmed'::finance.order_status, 'invoiced'::finance.order_status)
     WHERE l.id = ANY (p_listing_ids)
       AND (l.owner_user_id = auth.uid ()
            OR (l.owner_team_id IS NOT NULL AND org.is_active_team_member (l.owner_team_id)))
       AND (p_since IS NULL OR ol.created_at >= p_since)
     GROUP BY l.id, pg_catalog.upper(ol.currency), pg_catalog.date_trunc('week', ol.created_at)::date
$$;

COMMENT ON FUNCTION catalogue.get_listing_sales(uuid[], timestamptz) IS
'Per listing, per currency, per week: completed (confirmed or invoiced) order lines and their gross, for
the caller''s own listings only (owned, or of a team they are an active member of). p_since narrows to a
window; NULL is all time.';
-- #endregion
