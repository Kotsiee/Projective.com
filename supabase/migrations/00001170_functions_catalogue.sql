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
    p_team uuid DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_create_category text DEFAULT NULL
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
    v_currency text := pg_catalog.upper(COALESCE(NULLIF(pg_catalog.btrim(p_currency), ''), 'USD'));
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to create a listing' USING ERRCODE = '42501';
    END IF;
    IF v_currency !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'A currency is a three-letter ISO code' USING ERRCODE = '22023', DETAIL = 'currency';
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
            owner_type, owner_team_id, freelancer_profile_id, title, delivery_model, price_cents, currency, is_published
        )
        VALUES (
            CASE WHEN p_team IS NULL THEN 'freelancer' ELSE 'team' END, p_team, v_uid, v_title,
            p_delivery_model::marketplace.service_delivery_model, 0, v_currency, false
        )
        RETURNING id, slug INTO v_subject, v_slug;

        INSERT INTO catalogue.listings (owner_user_id, owner_team_id, kind, status, service_blueprint_id, title, currency, create_category)
        VALUES (v_uid, p_team, 'service', 'draft', v_subject, v_title, v_currency, NULLIF(p_create_category, '')::org.create_category)
        RETURNING id INTO v_listing;
    ELSIF p_kind = 'product' THEN
        INSERT INTO catalogue.products (owner_user_id, owner_team_id, title, price_cents, currency)
        VALUES (v_uid, p_team, v_title, 0, v_currency)
        RETURNING id, slug INTO v_subject, v_slug;

        INSERT INTO catalogue.listings (owner_user_id, owner_team_id, kind, status, product_id, title, delivery_label, currency, create_category)
        VALUES (v_uid, p_team, 'product', 'draft', v_subject, v_title, 'Instant download', v_currency, NULLIF(p_create_category, '')::org.create_category)
        RETURNING id INTO v_listing;
    ELSE
        RAISE EXCEPTION 'A listing is a product or a service' USING ERRCODE = '22023';
    END IF;

    RETURN pg_catalog.jsonb_build_object('listing_id', v_listing, 'slug', v_slug);
END;
$$;

COMMENT ON FUNCTION catalogue.create_listing(text, text, text, uuid, text, text) IS
'Create a DRAFT listing and its subject (a product, or a service blueprint for a freelancer) in one
transaction, as the caller, in p_currency (default USD) and, optionally, a CREATE category. Returns
{ listing_id, slug } — the slug is the listing''s console and public address. Refusals: 42501 not
signed in / not a freelancer / not a member of the team · 22023 bad title, kind, delivery model or
currency · 22P02 unknown CREATE category.';
-- #endregion

-- #region Shape helpers
-- The form archetype a listing edits as (Decision #217(a)), mirroring `formArchetypeOf` in
-- `@projective/types/catalogue/archetype.ts`: a Direct Deliverable edits as a One-Off and a Group
-- Session as a cohort. The enum is never forked; this is a view of it.
CREATE OR REPLACE FUNCTION catalogue.fn_form_archetype(
    p_kind catalogue.listing_kind,
    p_model marketplace.service_delivery_model
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_kind = 'product'::catalogue.listing_kind THEN 'product'
        WHEN p_model = 'pipeline'::marketplace.service_delivery_model THEN 'pipeline'
        WHEN p_model = 'session'::marketplace.service_delivery_model THEN 'session'
        WHEN p_model = 'group_session'::marketplace.service_delivery_model THEN 'cohort'
        ELSE 'one_off'
    END
$$;

-- Is one `stage_template` element readable by every consumer? The Zod SSOT (`MilestoneSchema`) owns
-- the full shape; this refuses only what `instantiate_service_blueprint` and the /view showcase could
-- not interpret. Sequential IFs rather than one OR chain, because PL/pgSQL does not promise to
-- evaluate an OR left to right and a cast on the wrong JSON type would raise instead of returning false.
CREATE OR REPLACE FUNCTION catalogue.fn_stage_shape_ok(p_stage jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF pg_catalog.jsonb_typeof(p_stage) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF pg_catalog.jsonb_typeof(p_stage -> 'name') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF pg_catalog.char_length(pg_catalog.btrim(p_stage ->> 'name')) NOT BETWEEN 1 AND 80 THEN RETURN false; END IF;
    IF p_stage ? 'deliverables' THEN
        IF pg_catalog.jsonb_typeof(p_stage -> 'deliverables') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
        IF pg_catalog.jsonb_array_length(p_stage -> 'deliverables') > 12 THEN RETURN false; END IF;
    END IF;
    IF p_stage ? 'startTrigger'
       AND COALESCE(p_stage ->> 'startTrigger', '') NOT IN ('on_project_start', 'after_previous', 'fixed_offset') THEN
        RETURN false;
    END IF;
    IF p_stage ? 'lagDays' THEN
        IF pg_catalog.jsonb_typeof(p_stage -> 'lagDays') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
        IF (p_stage ->> 'lagDays')::numeric NOT BETWEEN 0 AND 90
           OR (p_stage ->> 'lagDays')::numeric <> pg_catalog.trunc((p_stage ->> 'lagDays')::numeric) THEN
            RETURN false;
        END IF;
    END IF;
    IF p_stage ? 'chainReaction' AND pg_catalog.jsonb_typeof(p_stage -> 'chainReaction') IS DISTINCT FROM 'boolean' THEN
        RETURN false;
    END IF;
    IF p_stage ? 'priceCents' THEN
        IF pg_catalog.jsonb_typeof(p_stage -> 'priceCents') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
        IF (p_stage ->> 'priceCents')::numeric < 0 THEN RETURN false; END IF;
    END IF;
    RETURN true;
END;
$$;

-- Is one `team_roles` element readable? A named role with a sane headcount (`BlueprintTeamRoleSchema`).
CREATE OR REPLACE FUNCTION catalogue.fn_team_role_shape_ok(p_role jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
    IF pg_catalog.jsonb_typeof(p_role) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF pg_catalog.jsonb_typeof(p_role -> 'name') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    IF pg_catalog.char_length(pg_catalog.btrim(p_role ->> 'name')) NOT BETWEEN 1 AND 80 THEN RETURN false; END IF;
    IF p_role ? 'count' THEN
        IF pg_catalog.jsonb_typeof(p_role -> 'count') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
        IF (p_role ->> 'count')::numeric NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
    END IF;
    RETURN true;
END;
$$;

-- May the caller put this file on a listing? It must be live, finished uploading (never quarantined)
-- and theirs: their own library, or the library of the team the listing belongs to while they are an
-- active member of it. INVOKER, so the files policies decide what the caller can see at all.
CREATE OR REPLACE FUNCTION catalogue.fn_listing_file_ok(p_file uuid, p_team uuid, p_mime_prefix text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM files.items fi
         WHERE fi.id = p_file
           AND fi.deleted_at IS NULL
           AND fi.status = 'uploaded'::files.file_status
           AND (p_mime_prefix IS NULL OR fi.mime_type LIKE p_mime_prefix || '%')
           AND (
               fi.owner_user_id = auth.uid ()
               OR (p_team IS NOT NULL
                   AND fi.owner_type = 'team'::files.owner_kind
                   AND fi.owner_entity_id = p_team
                   AND org.is_active_team_member (p_team))
           )
    )
$$;
-- #endregion

-- #region Save
-- Apply an editor patch. Only the keys PRESENT in `p_patch` change — an absent key keeps its value,
-- a key present as JSON null clears it — so a partial autosave cannot wipe fields it did not send.
--
-- Recognised keys (Decision #217):
--   listing    title · category · description_html · description_text · delivery_label ·
--              amount_cents · ticket_price_cents · session_price_cents · seats_per_session ·
--              free_revisions · extra_revision_price_cents · seo_title · seo_description ·
--              create_category · currency (until first published)
--   service    delivery_model (while a draft) · intake (ids and kinds fixed once first published) ·
--              stage_template · team_roles · deliverables ·
--              turnaround_days · session_minutes · session_count · meeting_provider ·
--              max_seats_per_cohort · allow_continuous_enrollment
--   product    format · licence · attribution_required · file_manifest
--   children   skills (`org.skills` labels) · tags (at most 10) · collections (names)
--   envelopes  offer — a `ListingOffer` (camelCase, discriminated by `archetype`) decoded onto the
--              keys above; seo — { seoTitle, seoDescription, createCategory, tags }
--   guard      expected_updated_at — the `updated_at` the editor loaded; a mismatch is PC409
-- The showcase has its own door (`apply_listing_media`); availability is a preset binding on the
-- blueprint, not a listing key.
CREATE OR REPLACE FUNCTION catalogue.save_listing(p_listing uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = catalogue, marketplace, org, files, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_patch jsonb := COALESCE(p_patch, '{}'::jsonb);
    v_row catalogue.listings;
    v_model marketplace.service_delivery_model;
    v_archetype text;
    v_offer jsonb;
    v_offer_archetype text;
    v_envelope jsonb;
    v_expected timestamptz;
    v_doc jsonb;
    v_rows integer;
    v_item jsonb;
    v_ord bigint;
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

    -- #region Stale-write guard — compared to the millisecond, the precision a browser round-trips
    IF pg_catalog.jsonb_typeof(v_patch -> 'expected_updated_at') = 'string' THEN
        v_expected := (v_patch ->> 'expected_updated_at')::timestamptz;
        IF pg_catalog.date_trunc('milliseconds', v_expected) <> pg_catalog.date_trunc('milliseconds', v_row.updated_at) THEN
            RAISE EXCEPTION 'This listing was changed somewhere else since you opened it' USING ERRCODE = 'PC409',
                DETAIL = 'stale:' || pg_catalog.to_char(v_row.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
        END IF;
    END IF;
    -- #endregion

    IF v_row.kind = 'service' THEN
        SELECT b.delivery_model INTO v_model FROM marketplace.service_blueprints b WHERE b.id = v_row.service_blueprint_id;
    END IF;
    v_archetype := catalogue.fn_form_archetype(v_row.kind, v_model);

    -- #region Envelopes — decoded onto the flat keys, which then take the one path below
    IF v_patch ? 'offer' THEN
        v_offer := v_patch -> 'offer';
        IF pg_catalog.jsonb_typeof(v_offer) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'An offer is an object' USING ERRCODE = '22023', DETAIL = 'offer';
        END IF;
        v_offer_archetype := v_offer ->> 'archetype';
        -- The solo/cohort toggle is the one archetype change an offer may carry: both edit the same
        -- session fields, and the delivery-model rule below still holds it to a draft.
        IF v_offer_archetype IS DISTINCT FROM v_archetype
           AND NOT (v_archetype IN ('session', 'cohort') AND v_offer_archetype IN ('session', 'cohort')) THEN
            RAISE EXCEPTION 'This listing takes a % offer', v_archetype USING ERRCODE = '22023', DETAIL = 'offer.archetype';
        END IF;
        SELECT pg_catalog.jsonb_object_agg(m.dst, v_offer -> m.src) INTO v_envelope
          FROM (VALUES
              ('product', 'format', 'format'),
              ('product', 'licence', 'licence'),
              ('product', 'attributionRequired', 'attribution_required'),
              ('product', 'attachments', 'file_manifest'),
              ('one_off', 'milestones', 'stage_template'),
              ('one_off', 'turnaroundDays', 'turnaround_days'),
              ('one_off', 'scope', 'deliverables'),
              ('one_off', 'teamRoles', 'team_roles'),
              ('pipeline', 'stages', 'stage_template'),
              ('pipeline', 'teamRoles', 'team_roles'),
              ('session', 'minutes', 'session_minutes'),
              ('session', 'count', 'session_count'),
              ('session', 'meetingProvider', 'meeting_provider'),
              ('cohort', 'minutes', 'session_minutes'),
              ('cohort', 'count', 'session_count'),
              ('cohort', 'meetingProvider', 'meeting_provider'),
              ('cohort', 'maxSeatsPerCohort', 'max_seats_per_cohort'),
              ('cohort', 'continuousEnrollment', 'allow_continuous_enrollment')
          ) AS m (archetype, src, dst)
         WHERE m.archetype = v_offer_archetype AND v_offer ? m.src;
        v_patch := (v_patch - 'offer') || COALESCE(v_envelope, '{}'::jsonb);
        IF v_offer_archetype <> v_archetype THEN
            v_patch := v_patch || pg_catalog.jsonb_build_object(
                'delivery_model', CASE v_offer_archetype WHEN 'cohort' THEN 'group_session' ELSE 'session' END);
        END IF;
    END IF;

    IF v_patch ? 'seo' THEN
        IF pg_catalog.jsonb_typeof(v_patch -> 'seo') IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'SEO settings are an object' USING ERRCODE = '22023', DETAIL = 'seo';
        END IF;
        SELECT pg_catalog.jsonb_object_agg(m.dst, v_patch -> 'seo' -> m.src) INTO v_envelope
          FROM (VALUES
              ('seoTitle', 'seo_title'),
              ('seoDescription', 'seo_description'),
              ('createCategory', 'create_category'),
              ('tags', 'tags')
          ) AS m (src, dst)
         WHERE (v_patch -> 'seo') ? m.src;
        v_patch := (v_patch - 'seo') || COALESCE(v_envelope, '{}'::jsonb);
    END IF;
    -- #endregion

    -- #region Validation — refuse the whole save before anything is written
    IF v_patch ? 'title' AND pg_catalog.btrim(COALESCE(v_patch ->> 'title', '')) = '' THEN
        RAISE EXCEPTION 'A listing needs a title' USING ERRCODE = '22023', DETAIL = 'title';
    END IF;

    IF v_row.kind = 'product' AND (
        v_patch ?| ARRAY['delivery_model', 'intake', 'stage_template', 'team_roles', 'deliverables', 'turnaround_days',
                         'session_minutes', 'session_count', 'meeting_provider', 'max_seats_per_cohort',
                         'allow_continuous_enrollment']
    ) THEN
        RAISE EXCEPTION 'A product has no service terms' USING ERRCODE = '22023', DETAIL = 'kind';
    END IF;
    IF v_row.kind = 'service' AND (v_patch ?| ARRAY['format', 'licence', 'attribution_required', 'file_manifest']) THEN
        RAISE EXCEPTION 'A service has no product terms' USING ERRCODE = '22023', DETAIL = 'kind';
    END IF;

    -- A live listing keeps its delivery model: changing it would orphan the bookings and projects made
    -- under the old one, so the seller archives and recreates instead (plan §4.3).
    IF v_patch ? 'delivery_model'
       AND (v_patch ->> 'delivery_model')::marketplace.service_delivery_model IS DISTINCT FROM v_model
       AND v_row.status <> 'draft' THEN
        RAISE EXCEPTION 'A live listing keeps its delivery model; archive it and create a new one'
            USING ERRCODE = '22023', DETAIL = 'delivery_model';
    END IF;

    -- The currency is the seller's to choose until the listing first goes live; from then on orders,
    -- payouts and analytics are recorded in it. Keyed on published_at, which outlives a return to draft.
    IF v_patch ? 'currency' THEN
        IF pg_catalog.upper(COALESCE(v_patch ->> 'currency', '')) !~ '^[A-Z]{3}$' THEN
            RAISE EXCEPTION 'A currency is a three-letter ISO code' USING ERRCODE = '22023', DETAIL = 'currency';
        END IF;
        IF v_row.published_at IS NOT NULL AND pg_catalog.upper(v_patch ->> 'currency') <> v_row.currency THEN
            RAISE EXCEPTION 'A listing keeps its currency once it has been published' USING ERRCODE = '22023',
                DETAIL = 'currency';
        END IF;
    END IF;

    -- Once a listing has been live, buyers' answers are stored under its question ids (basket lines,
    -- invitations), so the questions keep their ids, order and kinds; only wording and options change
    -- (ServiceCreation.md §1.1). Keyed on published_at, so a listing restored to draft stays locked.
    IF v_patch ? 'intake' THEN
        v_doc := COALESCE(v_patch -> 'intake', '[]'::jsonb);
        IF pg_catalog.jsonb_typeof(v_doc) <> 'array' THEN
            RAISE EXCEPTION 'Buyer questions are a list' USING ERRCODE = '22023', DETAIL = 'intake';
        END IF;
        IF v_row.published_at IS NOT NULL AND (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_array(f.value ->> 'id', f.value ->> 'kind') ORDER BY f.n), '[]'::jsonb)
              FROM pg_catalog.jsonb_array_elements(v_doc) WITH ORDINALITY AS f (value, n)
        ) IS DISTINCT FROM (
            SELECT COALESCE(pg_catalog.jsonb_agg(
                       pg_catalog.jsonb_build_array(f.value ->> 'id', f.value ->> 'kind') ORDER BY f.n), '[]'::jsonb)
              FROM marketplace.service_blueprints b
             CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
                   CASE WHEN pg_catalog.jsonb_typeof(b.intake_fields) = 'array' THEN b.intake_fields ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS f (value, n)
             WHERE b.id = v_row.service_blueprint_id
        ) THEN
            RAISE EXCEPTION 'A published listing keeps its questions; only their wording and options can change'
                USING ERRCODE = '22023', DETAIL = 'intake';
        END IF;
    END IF;

    IF v_patch ? 'stage_template' THEN
        v_doc := COALESCE(v_patch -> 'stage_template', '[]'::jsonb);
        IF pg_catalog.jsonb_typeof(v_doc) <> 'array' OR pg_catalog.jsonb_array_length(v_doc) > 12 THEN
            RAISE EXCEPTION 'A listing has at most 12 stages' USING ERRCODE = '22023', DETAIL = 'stage_template';
        END IF;
        FOR v_item, v_ord IN SELECT s.value, s.ordinality FROM pg_catalog.jsonb_array_elements(v_doc) WITH ORDINALITY AS s LOOP
            IF NOT catalogue.fn_stage_shape_ok(v_item) THEN
                RAISE EXCEPTION 'Stage % needs a name (up to 80 characters), at most 12 deliverables and a known start trigger', v_ord
                    USING ERRCODE = '22023', DETAIL = 'stage_template.' || (v_ord - 1);
            END IF;
        END LOOP;
    END IF;

    IF v_patch ? 'team_roles' THEN
        v_doc := COALESCE(v_patch -> 'team_roles', '[]'::jsonb);
        IF pg_catalog.jsonb_typeof(v_doc) <> 'array' OR pg_catalog.jsonb_array_length(v_doc) > 12 THEN
            RAISE EXCEPTION 'A listing names at most 12 team roles' USING ERRCODE = '22023', DETAIL = 'team_roles';
        END IF;
        FOR v_item, v_ord IN SELECT s.value, s.ordinality FROM pg_catalog.jsonb_array_elements(v_doc) WITH ORDINALITY AS s LOOP
            IF NOT catalogue.fn_team_role_shape_ok(v_item) THEN
                RAISE EXCEPTION 'Team role % needs a name and a headcount of 1 to 20', v_ord
                    USING ERRCODE = '22023', DETAIL = 'team_roles.' || (v_ord - 1);
            END IF;
        END LOOP;
    END IF;

    IF v_patch ? 'deliverables' THEN
        v_doc := COALESCE(v_patch -> 'deliverables', '[]'::jsonb);
        IF pg_catalog.jsonb_typeof(v_doc) <> 'array' OR pg_catalog.jsonb_array_length(v_doc) > 24
           OR EXISTS (
               SELECT 1 FROM pg_catalog.jsonb_array_elements(v_doc) d
                WHERE pg_catalog.jsonb_typeof(d) <> 'string'
                   OR pg_catalog.char_length(pg_catalog.btrim(d #>> '{}')) NOT BETWEEN 1 AND 140
           ) THEN
            RAISE EXCEPTION 'Scope is up to 24 lines of up to 140 characters' USING ERRCODE = '22023', DETAIL = 'deliverables';
        END IF;
    END IF;

    IF v_patch ? 'file_manifest' THEN
        v_doc := COALESCE(v_patch -> 'file_manifest', '[]'::jsonb);
        IF pg_catalog.jsonb_typeof(v_doc) <> 'array' OR pg_catalog.jsonb_array_length(v_doc) > 24 THEN
            RAISE EXCEPTION 'A product bundle lists at most 24 files' USING ERRCODE = '22023', DETAIL = 'file_manifest';
        END IF;
        FOR v_item, v_ord IN SELECT s.value, s.ordinality FROM pg_catalog.jsonb_array_elements(v_doc) WITH ORDINALITY AS s LOOP
            IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object'
               OR pg_catalog.jsonb_typeof(v_item -> 'name') IS DISTINCT FROM 'string' THEN
                RAISE EXCEPTION 'Attachment % needs a name', v_ord USING ERRCODE = '22023', DETAIL = 'file_manifest.' || (v_ord - 1);
            END IF;
            -- An attached library file is delivered to buyers, so it must be the seller's to sell.
            IF v_item ? 'fileId' AND NOT catalogue.fn_listing_file_ok(NULLIF(v_item ->> 'fileId', '')::uuid, v_row.owner_team_id) THEN
                RAISE EXCEPTION 'An attachment must be one of your own files' USING ERRCODE = '42501',
                    DETAIL = 'file_manifest.' || (v_ord - 1);
            END IF;
        END LOOP;
    END IF;
    -- #endregion

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
        seo_title = CASE WHEN v_patch ? 'seo_title'
            THEN NULLIF(pg_catalog.btrim(COALESCE(v_patch ->> 'seo_title', '')), '') ELSE l.seo_title END,
        seo_description = CASE WHEN v_patch ? 'seo_description'
            THEN NULLIF(pg_catalog.btrim(COALESCE(v_patch ->> 'seo_description', '')), '') ELSE l.seo_description END,
        create_category = CASE WHEN v_patch ? 'create_category'
            THEN (v_patch ->> 'create_category')::org.create_category ELSE l.create_category END,
        currency = CASE WHEN v_patch ? 'currency'
            THEN pg_catalog.upper(v_patch ->> 'currency') ELSE l.currency END,
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
            format = CASE WHEN v_patch ? 'format'
                THEN (v_patch ->> 'format')::catalogue.product_format ELSE p.format END,
            licence = CASE WHEN v_patch ? 'licence'
                THEN (v_patch ->> 'licence')::catalogue.product_licence ELSE p.licence END,
            attribution_required = CASE WHEN v_patch ? 'attribution_required'
                THEN COALESCE((v_patch ->> 'attribution_required')::boolean, false) ELSE p.attribution_required END,
            file_manifest = CASE WHEN v_patch ? 'file_manifest'
                THEN COALESCE(v_patch -> 'file_manifest', '[]'::jsonb) ELSE p.file_manifest END,
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
            max_seats_per_cohort = CASE
                WHEN pg_catalog.jsonb_typeof(v_patch -> 'max_seats_per_cohort') = 'number'
                THEN (v_patch ->> 'max_seats_per_cohort')::integer
                ELSE COALESCE(v_row.seats_per_session, b.max_seats_per_cohort) END,
            allow_continuous_enrollment = CASE
                WHEN pg_catalog.jsonb_typeof(v_patch -> 'allow_continuous_enrollment') = 'boolean'
                THEN (v_patch ->> 'allow_continuous_enrollment')::boolean
                ELSE b.allow_continuous_enrollment END,
            delivery_model = CASE WHEN v_patch ? 'delivery_model'
                THEN (v_patch ->> 'delivery_model')::marketplace.service_delivery_model ELSE b.delivery_model END,
            intake_fields = CASE WHEN v_patch ? 'intake' THEN COALESCE(v_patch -> 'intake', '[]'::jsonb) ELSE b.intake_fields END,
            stage_template = CASE WHEN v_patch ? 'stage_template'
                THEN COALESCE(v_patch -> 'stage_template', '[]'::jsonb) ELSE b.stage_template END,
            team_roles = CASE WHEN v_patch ? 'team_roles'
                THEN COALESCE(v_patch -> 'team_roles', '[]'::jsonb) ELSE b.team_roles END,
            deliverables = CASE WHEN v_patch ? 'deliverables'
                THEN ARRAY(
                    SELECT pg_catalog.btrim(d.value)
                      FROM pg_catalog.jsonb_array_elements_text(COALESCE(v_patch -> 'deliverables', '[]'::jsonb)) WITH ORDINALITY AS d (value, n)
                     ORDER BY d.n
                )
                ELSE b.deliverables END,
            turnaround_days = CASE WHEN v_patch ? 'turnaround_days'
                THEN (v_patch ->> 'turnaround_days')::smallint ELSE b.turnaround_days END,
            session_minutes = CASE WHEN v_patch ? 'session_minutes'
                THEN (v_patch ->> 'session_minutes')::integer ELSE b.session_minutes END,
            session_count = CASE WHEN v_patch ? 'session_count'
                THEN (v_patch ->> 'session_count')::integer ELSE b.session_count END,
            meeting_provider = CASE WHEN v_patch ? 'meeting_provider'
                THEN NULLIF(v_patch ->> 'meeting_provider', '') ELSE b.meeting_provider END,
            updated_at = pg_catalog.now()
        WHERE b.id = v_row.service_blueprint_id;
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'This listing''s % could not be updated with it', CASE v_row.kind WHEN 'product' THEN 'product' ELSE 'service' END
            USING ERRCODE = '42501';
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

    -- #region Tags — the seller's own words, trimmed, de-duplicated case-insensitively; at most 10
    -- (`catalogue.trg_listing_tags_max` refuses the 11th with PG422 tags_max, so nothing is cut silently)
    IF v_patch ? 'tags' THEN
        DELETE FROM catalogue.listing_tags WHERE listing_id = p_listing;
        INSERT INTO catalogue.listing_tags (listing_id, tag)
        SELECT p_listing, t.tag
          FROM (
              SELECT DISTINCT ON (pg_catalog.lower(pg_catalog.btrim(x))) pg_catalog.btrim(x) AS tag
                FROM pg_catalog.jsonb_array_elements_text(COALESCE(v_patch -> 'tags', '[]'::jsonb)) x
               WHERE pg_catalog.length(pg_catalog.btrim(x)) BETWEEN 1 AND 40
          ) t;
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

    RETURN pg_catalog.jsonb_build_object('listing_id', p_listing, 'updated_at', v_row.updated_at);
END;
$$;

COMMENT ON FUNCTION catalogue.save_listing(uuid, jsonb) IS
'Apply an editor patch to a listing AND its product or service blueprint in one transaction, as the
seller who created it. Only keys present in the patch change; children (skills, tags, collections) are
replaced whole when present; `offer` and `seo` envelopes are decoded onto the flat keys. Returns
{ listing_id, updated_at }. Refusals: 42501 not the seller / a file that is not theirs / the subject
could not be updated · 22023 malformed patch, a changed currency or question id/kind/order after first
publish (DETAIL names the key) · PB404 no such listing · PC409 expected_updated_at is stale (DETAIL
stale:<current updated_at>) · PG422 more than 10 tags.';
-- #endregion

-- #region Tag cap (Decision #217(f))
-- At most 10 tags per listing, on the table rather than only in save_listing, so a direct insert under
-- the owner policy is held to the same cap. A BEFORE ROW trigger sees the rows its own statement has
-- already inserted, so one multi-row INSERT of 11 is refused at the 11th. The listing row is locked
-- first, so two concurrent writers cannot each count 9 and insert past the cap. A definer so the count
-- and the lock do not depend on what the caller's policies let them see.
CREATE OR REPLACE FUNCTION catalogue.trg_listing_tags_max()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM 1 FROM catalogue.listings l WHERE l.id = NEW.listing_id FOR UPDATE;
    IF (SELECT pg_catalog.count(*) FROM catalogue.listing_tags t WHERE t.listing_id = NEW.listing_id) >= 10 THEN
        RAISE EXCEPTION 'A listing carries at most 10 tags' USING ERRCODE = 'PG422', DETAIL = 'tags_max';
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

-- #region Showcase
-- Replace a listing's six-slot showcase (Decision #217(e)). `p_slots` is an array of at most 6
-- { position 1–6, file_id, kind 'image'|'video', rendition_file_id?, poster_file_id?, alt_text? }; an empty
-- array clears it. Every file must be the caller's (`fn_listing_file_ok`) and match its kind; a
-- poster is an image. Slot 1 must be an image (`ck_listing_media_cover_is_image`). A service's
-- blueprint cover follows slot 1 — its rendition when one was cut, else the original — so the card,
-- the hero and every booking surface show the same picture; no slot 1 clears it. INVOKER: the owner
-- policy on `listing_media` is the gate, as it is for every other listing child.
CREATE OR REPLACE FUNCTION catalogue.apply_listing_media(p_listing uuid, p_slots jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = catalogue, marketplace, files, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_slots jsonb := COALESCE(p_slots, '[]'::jsonb);
    v_row catalogue.listings;
    v_item jsonb;
    v_ord bigint;
    v_position integer;
    v_kind text;
    v_file uuid;
    v_rendition uuid;
    v_poster uuid;
    v_cover uuid;
    v_rows integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to edit a listing' USING ERRCODE = '42501';
    END IF;
    IF pg_catalog.jsonb_typeof(v_slots) <> 'array' OR pg_catalog.jsonb_array_length(v_slots) > 6 THEN
        RAISE EXCEPTION 'A showcase holds at most 6 items' USING ERRCODE = '22023', DETAIL = 'slots';
    END IF;

    SELECT * INTO v_row FROM catalogue.listings WHERE id = p_listing FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That listing no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF v_row.owner_user_id <> v_uid THEN
        RAISE EXCEPTION 'Only the seller who created this listing can edit it' USING ERRCODE = '42501';
    END IF;

    FOR v_item, v_ord IN SELECT s.value, s.ordinality FROM pg_catalog.jsonb_array_elements(v_slots) WITH ORDINALITY AS s LOOP
        IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object'
           OR pg_catalog.jsonb_typeof(v_item -> 'position') IS DISTINCT FROM 'number'
           OR pg_catalog.jsonb_typeof(v_item -> 'file_id') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Showcase item % needs a position and a file', v_ord USING ERRCODE = '22023', DETAIL = 'slots.' || (v_ord - 1);
        END IF;
        v_position := (v_item ->> 'position')::integer;
        v_kind := COALESCE(v_item ->> 'kind', 'image');
        v_file := (v_item ->> 'file_id')::uuid;
        v_rendition := NULLIF(v_item ->> 'rendition_file_id', '')::uuid;
        v_poster := NULLIF(v_item ->> 'poster_file_id', '')::uuid;
        IF v_kind NOT IN ('image', 'video') THEN
            RAISE EXCEPTION 'A showcase item is an image or a video' USING ERRCODE = '22023', DETAIL = 'slots.' || (v_ord - 1);
        END IF;
        IF NOT catalogue.fn_listing_file_ok(v_file, v_row.owner_team_id, v_kind || '/')
           OR (v_rendition IS NOT NULL AND NOT catalogue.fn_listing_file_ok(v_rendition, v_row.owner_team_id, v_kind || '/'))
           OR (v_poster IS NOT NULL AND NOT catalogue.fn_listing_file_ok(v_poster, v_row.owner_team_id, 'image/')) THEN
            RAISE EXCEPTION 'A showcase item must be one of your own % files', v_kind
                USING ERRCODE = '42501', DETAIL = 'slots.' || (v_ord - 1);
        END IF;
        IF v_position = 1 THEN
            v_cover := COALESCE(v_rendition, v_file);
        END IF;
    END LOOP;
    -- Said here rather than left to the DEFERRED unique constraint, which would only fire at commit.
    IF (SELECT pg_catalog.count(DISTINCT s.value ->> 'position') FROM pg_catalog.jsonb_array_elements(v_slots) s)
       <> pg_catalog.jsonb_array_length(v_slots) THEN
        RAISE EXCEPTION 'Two showcase items share a position' USING ERRCODE = '22023', DETAIL = 'slots';
    END IF;

    DELETE FROM catalogue.listing_media WHERE listing_id = p_listing;
    INSERT INTO catalogue.listing_media (listing_id, file_id, kind, rendition_file_id, poster_file_id, alt_text, position)
    SELECT p_listing,
           (s.value ->> 'file_id')::uuid,
           COALESCE(s.value ->> 'kind', 'image'),
           NULLIF(s.value ->> 'rendition_file_id', '')::uuid,
           NULLIF(s.value ->> 'poster_file_id', '')::uuid,
           pg_catalog.left(COALESCE(s.value ->> 'alt_text', s.value ->> 'alt', ''), 200),
           (s.value ->> 'position')::smallint
      FROM pg_catalog.jsonb_array_elements(v_slots) AS s;

    IF v_row.kind = 'service' THEN
        UPDATE marketplace.service_blueprints b
           SET cover_file_id = v_cover, updated_at = pg_catalog.now()
         WHERE b.id = v_row.service_blueprint_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
            RAISE EXCEPTION 'This listing''s service could not be updated with it' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE catalogue.listings l SET updated_at = pg_catalog.now() WHERE l.id = p_listing;

    RETURN pg_catalog.jsonb_build_object(
        'listing_id', p_listing,
        'slots', pg_catalog.jsonb_array_length(v_slots),
        'cover_file_id', v_cover
    );
END;
$$;

COMMENT ON FUNCTION catalogue.apply_listing_media(uuid, jsonb) IS
'Replace a listing''s showcase (at most 6 slots, positions 1–6, slot 1 an image) as the seller who created
it, and mirror slot 1 (rendition, else original) into service_blueprints.cover_file_id. Returns
{ listing_id, slots, cover_file_id }. Refusals: 42501 not the seller / a file that is not theirs or not
of its kind · 22023 malformed slots or two items in one position · 23514 a video in slot 1 ·
PB404 no such listing.';
-- #endregion

-- #region Status
-- Move a listing through its lifecycle (draft · published · paused · archived — nothing is ever
-- deleted). Publishing passes the gate the console shows — a title, a price, an image in showcase
-- slot 1 and, for a Pipeline, at least one stage —
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
        IF NOT EXISTS (
            SELECT 1 FROM catalogue.listing_media m
             WHERE m.listing_id = p_listing AND m.position = 1 AND m.kind = 'image'
        ) THEN
            v_missing := v_missing || 'a cover image'::text;
        END IF;
        -- A Pipeline is bought as its stages; one with none could not be added to a project.
        IF v_row.kind = 'service' AND EXISTS (
            SELECT 1 FROM marketplace.service_blueprints b
             WHERE b.id = v_row.service_blueprint_id
               AND b.delivery_model = 'pipeline'::marketplace.service_delivery_model
               AND pg_catalog.jsonb_array_length(b.stage_template) = 0
        ) THEN
            v_missing := v_missing || 'at least one stage'::text;
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
blueprint follows. Publishing needs a title, a price, a slot-1 cover image and (Pipeline) a stage. Refusals: 42501 not the
seller · 22023 unknown status · PB404 no such listing · PG422 the publish gate (DETAIL lists what is
missing, separated by |) · PM403 the seller is under 18 (catalogue.trg_listings_publish_age_gate).';
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

-- #region Listing analytics read
-- The listing rollups (analytics.fn_rollup_listings) as the catalogue's Analytics read takes them.
-- `analytics` is not a PostgREST-exposed schema, so this INVOKER door in `catalogue` is the read:
-- `analytics.daily_rollups`' own policy (fn_subject_visible('listing')) still decides each row, so a
-- listing the caller may not see answers nothing. Ordered for paging past max_rows.
CREATE OR REPLACE FUNCTION catalogue.get_listing_rollups(p_listing_ids uuid[], p_from date, p_to date)
RETURNS TABLE (day date, metric text, subject_id uuid, dimensions jsonb, value numeric, sample_count integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT r.day, r.metric, r.subject_id, r.dimensions, r.value, r.sample_count
      FROM analytics.daily_rollups r
     WHERE r.subject_kind = 'listing'::analytics.subject_kind
       AND r.subject_id = ANY (p_listing_ids)
       AND r.day BETWEEN p_from AND p_to
       AND p_to - p_from <= 800
     ORDER BY r.day, r.subject_id, r.metric, r.id
$$;

COMMENT ON FUNCTION catalogue.get_listing_rollups(uuid[], date, date) IS
'The listing rollups for the given listings over [p_from, p_to] (at most 800 days), as the caller may
read them: INVOKER, so analytics.daily_rollups'' policy (fn_subject_visible(''listing'')) decides. The
read behind the catalogue''s Analytics view and tab, because analytics is not an exposed schema.';
-- #endregion

-- #region Publish age gate (Decision #190)
-- A seller under 18 cannot put a listing on sale. Held on the table rather than in set_listing_status
-- so no write — this door, a direct PATCH, a future one — publishes past it; and as a trigger it can
-- be a definer while the doors above stay invokers, so org.fn_assert_adult needs no client grant.
CREATE OR REPLACE FUNCTION catalogue.trg_listings_publish_age_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'published'::catalogue.listing_status
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM org.fn_assert_adult(NEW.owner_user_id);
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion

-- #region Batch status
-- The console's batch action (`BatchActionSchema` status): `set_listing_status` per listing, each in
-- its own sub-transaction, so one listing the gate refuses does not undo the others. At most 100 ids;
-- repeats are applied once, in first-seen order. Returns one outcome per listing:
-- { listing_id, ok, code, detail, message } — `code` is the refusal's SQLSTATE (PG422 for the
-- publish gate, with `detail` listing what is missing), NULL on success.
CREATE OR REPLACE FUNCTION catalogue.set_listings_status(p_listings uuid[], p_status text)
RETURNS jsonb[]
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = catalogue, public
AS $$
DECLARE
    v_ids uuid[];
    v_id uuid;
    v_out jsonb[] := ARRAY[]::jsonb[];
    v_code text;
    v_message text;
    v_detail text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sign in to change a listing' USING ERRCODE = '42501';
    END IF;
    SELECT COALESCE(pg_catalog.array_agg(x.id ORDER BY x.first), ARRAY[]::uuid[]) INTO v_ids
      FROM (
          SELECT u.id, pg_catalog.min(u.n) AS first
            FROM pg_catalog.unnest(COALESCE(p_listings, ARRAY[]::uuid[])) WITH ORDINALITY AS u (id, n)
           WHERE u.id IS NOT NULL
           GROUP BY u.id
      ) x;
    IF pg_catalog.cardinality(v_ids) > 100 THEN
        RAISE EXCEPTION 'A batch changes at most 100 listings' USING ERRCODE = '22023', DETAIL = 'listings';
    END IF;

    FOREACH v_id IN ARRAY v_ids LOOP
        BEGIN
            PERFORM catalogue.set_listing_status(v_id, p_status);
            v_out := v_out || pg_catalog.jsonb_build_object(
                'listing_id', v_id, 'ok', true, 'code', NULL, 'detail', NULL, 'message', NULL);
        EXCEPTION WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT, v_detail = PG_EXCEPTION_DETAIL;
            v_out := v_out || pg_catalog.jsonb_build_object(
                'listing_id', v_id, 'ok', false, 'code', v_code,
                'detail', NULLIF(v_detail, ''), 'message', v_message);
        END;
    END LOOP;
    RETURN v_out;
END;
$$;

COMMENT ON FUNCTION catalogue.set_listings_status(uuid[], text) IS
'Batch set_listing_status: each listing in its own sub-transaction, so a refused one leaves the rest
applied. At most 100 ids, de-duplicated. Returns jsonb[] of { listing_id, ok, code, detail, message }.
Refusals of the whole call: 42501 not signed in · 22023 more than 100 ids.';
-- #endregion

-- #region Duplicate
-- Copy a listing as a new DRAFT: its subject row (every column, through a row-to-json round trip so a
-- column added later is copied without editing this function), the listing, its showcase by file id
-- (the same files, never re-uploaded), skills, tags and the seller's own collections. The copy gets
-- its own `svc-`/`prd-` address from `security.fn_slug_guard` (the slug is sent as NULL), starts
-- unpublished, unpromoted and with zeroed derived counters, and its title is marked "(copy)".
-- A service bound to a preset forked for the original alone (`scope = 'service'`) falls back to the
-- schedule default, since that preset belongs to the original; a library preset binding is kept.
CREATE OR REPLACE FUNCTION catalogue.duplicate_listing(p_listing uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = catalogue, marketplace, public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_row catalogue.listings;
    v_listing uuid := gen_random_uuid();
    v_subject uuid := gen_random_uuid();
    v_title text;
    v_slug text;
    v_bp marketplace.service_blueprints;
    v_product catalogue.products;
    v_preset uuid;
    v_scope text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to duplicate a listing' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_row FROM catalogue.listings WHERE id = p_listing;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That listing no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF v_row.owner_user_id <> v_uid THEN
        RAISE EXCEPTION 'Only the seller who created this listing can duplicate it' USING ERRCODE = '42501';
    END IF;
    v_title := pg_catalog.left(v_row.title, 193) || ' (copy)';

    IF v_row.kind = 'service' THEN
        SELECT * INTO v_bp FROM marketplace.service_blueprints WHERE id = v_row.service_blueprint_id;
        v_preset := v_bp.availability_preset_id;
        IF v_preset IS NOT NULL THEN
            SELECT p.scope::text INTO v_scope FROM scheduling.availability_presets p WHERE p.id = v_preset;
            IF v_scope IS DISTINCT FROM 'library' THEN
                v_preset := NULL;
            END IF;
        END IF;
        INSERT INTO marketplace.service_blueprints
        SELECT (pg_catalog.jsonb_populate_record(NULL::marketplace.service_blueprints,
            pg_catalog.to_jsonb(v_bp) || pg_catalog.jsonb_build_object(
                'id', v_subject, 'slug', NULL, 'title', v_title, 'is_published', false,
                'availability_preset_id', v_preset,
                'rating_average', 0, 'rating_count', 0,
                'created_at', pg_catalog.now(), 'updated_at', pg_catalog.now()
            ))).*
        RETURNING slug INTO v_slug;
    ELSE
        SELECT * INTO v_product FROM catalogue.products WHERE id = v_row.product_id;
        INSERT INTO catalogue.products
        SELECT (pg_catalog.jsonb_populate_record(NULL::catalogue.products,
            pg_catalog.to_jsonb(v_product) || pg_catalog.jsonb_build_object(
                'id', v_subject, 'slug', NULL, 'title', v_title,
                'rating_average', 0, 'rating_count', 0,
                'created_at', pg_catalog.now(), 'updated_at', pg_catalog.now()
            ))).*
        RETURNING slug INTO v_slug;
    END IF;

    INSERT INTO catalogue.listings
    SELECT (pg_catalog.jsonb_populate_record(NULL::catalogue.listings,
        pg_catalog.to_jsonb(v_row) || pg_catalog.jsonb_build_object(
            'id', v_listing, 'title', v_title, 'status', 'draft', 'published_at', NULL, 'promoted', false,
            'service_blueprint_id', CASE WHEN v_row.kind = 'service' THEN v_subject END,
            'product_id', CASE WHEN v_row.kind = 'product' THEN v_subject END,
            'view_count', 0, 'order_count', 0, 'rating_average', 0, 'rating_count', 0,
            'created_at', pg_catalog.now(), 'updated_at', pg_catalog.now()
        ))).*;

    INSERT INTO catalogue.listing_media (listing_id, file_id, kind, rendition_file_id, poster_file_id, alt_text, position)
    SELECT v_listing, m.file_id, m.kind, m.rendition_file_id, m.poster_file_id, m.alt_text, m.position
      FROM catalogue.listing_media m WHERE m.listing_id = p_listing;
    INSERT INTO catalogue.listing_skills (listing_id, skill_id)
    SELECT v_listing, s.skill_id FROM catalogue.listing_skills s WHERE s.listing_id = p_listing;
    INSERT INTO catalogue.listing_tags (listing_id, tag)
    SELECT v_listing, t.tag FROM catalogue.listing_tags t WHERE t.listing_id = p_listing;
    INSERT INTO catalogue.collection_listings (collection_id, listing_id, position)
    SELECT cl.collection_id, v_listing, cl.position
      FROM catalogue.collection_listings cl
      JOIN catalogue.collections c ON c.id = cl.collection_id AND c.owner_user_id = v_uid
     WHERE cl.listing_id = p_listing;

    RETURN pg_catalog.jsonb_build_object('listing_id', v_listing, 'slug', v_slug);
END;
$$;

COMMENT ON FUNCTION catalogue.duplicate_listing(uuid) IS
'Copy a listing, its subject (product or service blueprint), showcase (by file id), skills, tags and
the seller''s collections as a new DRAFT with a freshly minted slug and "(copy)" title, as the seller who
created it. Returns { listing_id, slug }. Refusals: 42501 not the seller · PB404 no such listing.';
-- #endregion

-- #region Client pipeline (Decision #217, C5)
-- May the caller manage this listing — and so read who is buying it? A personal listing answers to its
-- owner; a team listing to whoever holds `publish_listings` on that team (the owner, admin and lead
-- presets, or a custom role that grants it), asked of the permission twin rather than a role name.
-- A definer because `org.fn_member_can` is internal; it reveals one boolean about the caller.
CREATE OR REPLACE FUNCTION catalogue.fn_manages_listing(p_listing uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT auth.uid () IS NOT NULL
       AND EXISTS (
           SELECT 1
             FROM catalogue.listings l
            WHERE l.id = p_listing
              AND CASE
                      WHEN l.owner_team_id IS NULL THEN l.owner_user_id = auth.uid ()
                      ELSE org.fn_member_can ('team', l.owner_team_id, 'publish_listings'::org.workspace_capability)
                  END
       );
$$;

COMMENT ON FUNCTION catalogue.fn_manages_listing(uuid) IS
'True when the caller may manage the listing: its owner when personal, a holder of publish_listings on
the owning team when a team''s. The gate for the client pipeline and listing analytics.';

-- The listings the caller could manage, found through two indexed paths (their personal listings by
-- owner, their teams' listings through their active memberships) so neither caller scans the whole
-- catalogue; `fn_manages_listing` then decides each one. `p_listing` narrows to one.
CREATE OR REPLACE FUNCTION catalogue.fn_candidate_listings(p_listing uuid DEFAULT NULL)
RETURNS SETOF catalogue.listings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT l.*
      FROM catalogue.listings l
     WHERE l.owner_user_id = auth.uid ()
       AND l.owner_team_id IS NULL
       AND (p_listing IS NULL OR l.id = p_listing)
    UNION ALL
    SELECT l.*
      FROM org.team_members tm
      JOIN catalogue.listings l ON l.owner_team_id = tm.team_id
     WHERE tm.user_id = auth.uid ()
       AND tm.status = 'active'
       AND (p_listing IS NULL OR l.id = p_listing);
$$;

COMMENT ON FUNCTION catalogue.fn_candidate_listings(uuid) IS
'The caller''s personal listings and their active teams'' listings, by index; fn_manages_listing then
decides each. The candidate set for get_client_pipeline and fn_seller_order_lines.';

-- The order lines that bought one of the caller's listings — the one pipeline arm the seller's own
-- policies cannot read, because `finance.orders` / `order_lines` are the buyer's. A narrow projection,
-- like `get_listing_sales` beside it: the buyer, the order's status and instant, and the line's own
-- money. Never the payment method, card, promo, other sellers' lines or the order's totals. Answers
-- only for listings `fn_manages_listing` admits; `p_listing` NULL is all of them.
CREATE OR REPLACE FUNCTION catalogue.fn_seller_order_lines(p_listing uuid DEFAULT NULL)
RETURNS TABLE (
    listing_id uuid,
    order_line_id uuid,
    item_type text,
    buyer_user_id uuid,
    buyer_handle text,
    order_status text,
    placed_at timestamptz,
    updated_at timestamptz,
    line_total_minor bigint,
    currency text,
    scheduled_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH mine AS (
        SELECT c.id, c.kind, c.service_blueprint_id, c.product_id
          FROM catalogue.fn_candidate_listings (p_listing) c
         WHERE catalogue.fn_manages_listing (c.id)
    ),
    lines AS (
        SELECT m.id AS listing_id, ol.*
          FROM mine m
          JOIN finance.order_lines ol
            ON ol.item_id = m.product_id AND ol.item_type = 'digital_product'::finance.purchasable_item_kind
         WHERE m.kind = 'product'::catalogue.listing_kind
        UNION ALL
        SELECT m.id, ol.*
          FROM mine m
          JOIN finance.order_lines ol
            ON ol.item_id = m.service_blueprint_id
           AND ol.item_type NOT IN (
                   'digital_product'::finance.purchasable_item_kind,
                   'project_ticket'::finance.purchasable_item_kind,
                   'one_off_project'::finance.purchasable_item_kind,
                   'one_off_task'::finance.purchasable_item_kind,
                   'paid_revision'::finance.purchasable_item_kind
               )
         WHERE m.kind = 'service'::catalogue.listing_kind
    )
    SELECT x.listing_id,
           x.id,
           x.item_type::text,
           CASE WHEN o.owner_type IN ('user', 'freelancer') THEN o.owner_id END,
           u.username,
           o.status::text,
           o.placed_at,
           o.updated_at,
           x.line_total_minor,
           pg_catalog.upper(x.currency),
           x.scheduled_at
      FROM lines x
      JOIN finance.orders o ON o.id = x.order_id
      LEFT JOIN org.users_public u
        ON o.owner_type IN ('user', 'freelancer') AND u.user_id = o.owner_id;
$$;

COMMENT ON FUNCTION catalogue.fn_seller_order_lines(uuid) IS
'The order lines that bought the caller''s listings (fn_manages_listing), narrowed to the buyer, the
order''s status and instant, and the line''s money. The order arm of get_client_pipeline.';

-- One read of everyone buying, asking about or booking the caller's listings, one row per engagement.
-- INVOKER, so every arm but the order one answers under the caller's own policies (thread
-- participant, quote host, call host, cohort owner, project access); orders come through the narrow
-- definer above. Each row carries its source table's OWN status, never a lane: the pipeline's lanes
-- are derived in TypeScript (`laneOf`, @projective/types/catalogue/clients.ts), so this read invents no
-- vocabulary (root CLAUDE.md §5). `action_reasons` names what is waiting on the seller.
-- `href` is the surface the engagement lives on: the conversation, the calendar event, the project.
-- `p_listing` NULL is every listing the caller manages; `p_limit` is clamped to 1–500, newest
-- activity first.
CREATE OR REPLACE FUNCTION catalogue.get_client_pipeline(p_listing uuid DEFAULT NULL, p_limit integer DEFAULT 200)
RETURNS TABLE (
    engagement_kind text,
    engagement_id uuid,
    listing_id uuid,
    buyer_user_id uuid,
    buyer_handle text,
    status text,
    opened_at timestamptz,
    last_activity_at timestamptz,
    amount_minor bigint,
    currency text,
    next_event_at timestamptz,
    action_reasons text[],
    href text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    WITH mine AS (
        SELECT c.id, c.service_blueprint_id
          FROM catalogue.fn_candidate_listings (p_listing) c
         WHERE catalogue.fn_manages_listing (c.id)
    ),
    open_rounds AS (
        SELECT r.event_id, r.round, r.status, r.opened_by_user_id
          FROM scheduling.event_reschedules r
         WHERE r.status IN ('collecting', 'awaiting_counterparty', 'voting')
    ),
    sales AS (
        SELECT * FROM catalogue.fn_seller_order_lines (p_listing)
    ),
    arms AS (
        SELECT 'inquiry'::text AS engagement_kind,
               t.id AS engagement_id,
               m.id AS listing_id,
               b.user_id AS buyer_user_id,
               u.username AS buyer_handle,
               me.inbox_folder AS status,
               t.created_at AS opened_at,
               COALESCE(lm.created_at, t.created_at) AS last_activity_at,
               NULL::bigint AS amount_minor,
               NULL::text AS currency,
               NULL::timestamptz AS next_event_at,
               CASE WHEN lm.sender_user_id IS DISTINCT FROM auth.uid () AND lm.sender_user_id IS NOT NULL
                    THEN ARRAY['inquiry_unanswered'] ELSE ARRAY[]::text[] END AS action_reasons,
               '/messages/' || t.id::text AS href
          FROM mine m
          JOIN comms.dm_threads t
            ON t.subject_listing_id = m.id AND t.kind = 'service_inquiry'::comms.conversation_kind
          JOIN comms.dm_participants me
            ON me.thread_id = t.id AND me.user_id = auth.uid () AND me.deleted_at IS NULL
          LEFT JOIN LATERAL (
              SELECT p.user_id FROM comms.dm_participants p
               WHERE p.thread_id = t.id AND p.user_id <> auth.uid ()
               ORDER BY p.joined_at, p.user_id
               LIMIT 1
          ) b ON true
          LEFT JOIN org.users_public u ON u.user_id = b.user_id
          LEFT JOIN LATERAL (
              SELECT dm.sender_user_id, dm.created_at FROM comms.dm_messages dm
               WHERE dm.thread_id = t.id AND dm.deleted_at IS NULL
               ORDER BY dm.created_at DESC, dm.id DESC
               LIMIT 1
          ) lm ON true

        UNION ALL

        SELECT 'quote', q.id, m.id, q.requester_user_id, u.username, q.status,
               q.created_at, GREATEST(q.updated_at, COALESCE(q.answered_at, q.created_at)),
               q.budget_cents, q.currency, NULL::timestamptz,
               CASE WHEN q.status = 'sent' THEN ARRAY['inquiry_unanswered'] ELSE ARRAY[]::text[] END,
               '/messages/dm-' || COALESCE(u.username, '')
          FROM mine m
          JOIN marketplace.quote_requests q ON q.blueprint_id = m.service_blueprint_id
          LEFT JOIN org.users_public u ON u.user_id = q.requester_user_id

        UNION ALL

        SELECT 'discovery_call', d.id, m.id, d.requester_user_id, u.username, d.status::text,
               d.proposed_at, d.updated_at,
               d.fee_amount_minor, pg_catalog.upper(d.fee_currency::text),
               CASE WHEN COALESCE(d.confirmed_start, d.proposed_start) > pg_catalog.now()
                         AND d.status IN ('proposed'::scheduling.call_status, 'confirmed'::scheduling.call_status)
                    THEN COALESCE(d.confirmed_start, d.proposed_start) END,
               pg_catalog.array_remove(ARRAY[
                   CASE WHEN d.status = 'proposed'::scheduling.call_status THEN 'inquiry_unanswered' END,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM open_rounds r
                        WHERE r.event_id = d.event_id
                          AND r.opened_by_user_id IS DISTINCT FROM auth.uid ()
                   ) THEN 'reschedule_open' END
               ], NULL),
               CASE WHEN d.event_id IS NOT NULL THEN '/calendar?event=' || d.event_id::text
                    ELSE '/messages/dm-' || COALESCE(u.username, '') END
          FROM mine m
          JOIN scheduling.discovery_calls d ON d.service_blueprint_id = m.service_blueprint_id
          LEFT JOIN org.users_public u ON u.user_id = d.requester_user_id

        UNION ALL

        SELECT 'order', s.order_line_id, s.listing_id, s.buyer_user_id, s.buyer_handle, s.order_status,
               s.placed_at, s.updated_at, s.line_total_minor, s.currency, NULL::timestamptz,
               ARRAY[]::text[],
               '/messages/dm-' || COALESCE(s.buyer_handle, '')
          FROM sales s
         WHERE s.item_type NOT IN ('service_session', 'set_session', 'course_group_session')

        UNION ALL

        SELECT 'session_booking', cm.id, m.id, cm.user_id, u.username, cm.status,
               cm.joined_at,
               GREATEST(cm.joined_at, COALESCE(cm.cancelled_at, cm.joined_at), COALESCE(sit.touched, cm.joined_at)),
               s.line_total_minor, s.currency,
               sit.next_start,
               pg_catalog.array_remove(ARRAY[
                   CASE WHEN EXISTS (
                       SELECT 1 FROM open_rounds r
                         JOIN scheduling.events e ON e.id = r.event_id
                         JOIN projects.session_events se ON se.id = e.source_session_event_id
                        WHERE se.cohort_id = c.id AND r.round = 0 AND r.status = 'collecting'
                   ) THEN 'handshake_pending' END,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM open_rounds r
                         JOIN scheduling.events e ON e.id = r.event_id
                         JOIN projects.session_events se ON se.id = e.source_session_event_id
                        WHERE se.cohort_id = c.id AND r.round > 0
                          AND r.opened_by_user_id IS DISTINCT FROM auth.uid ()
                   ) THEN 'reschedule_open' END,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM finance.disputes dp
                         JOIN finance.escrows es ON es.id = dp.escrow_id
                        WHERE dp.status IN ('open'::public.dispute_status, 'awaiting_response'::public.dispute_status,
                                            'under_review'::public.dispute_status)
                          AND (es.cohort_membership_id = cm.id
                               OR es.session_event_id IN (SELECT se.id FROM projects.session_events se WHERE se.cohort_id = c.id))
                   ) THEN 'dispute_open' END
               ], NULL),
               CASE WHEN sit.next_event_id IS NOT NULL THEN '/calendar?event=' || sit.next_event_id::text
                    ELSE '/projects/' || p.slug END
          FROM mine m
          JOIN projects.projects p ON p.source_blueprint_id = m.service_blueprint_id AND p.session_kind <> 'none'
          JOIN projects.cohorts c ON c.project_id = p.id
          JOIN projects.cohort_memberships cm ON cm.cohort_id = c.id
          LEFT JOIN org.users_public u ON u.user_id = cm.user_id
          LEFT JOIN sales s ON s.order_line_id = cm.order_line_id
          LEFT JOIN LATERAL (
              SELECT pg_catalog.max(se.updated_at) AS touched,
                     pg_catalog.min(se.start_time) FILTER (
                         WHERE se.status = 'scheduled'::projects.session_event_status AND se.start_time > pg_catalog.now()
                     ) AS next_start,
                     (SELECT e.id FROM projects.session_events se2
                        JOIN scheduling.events e ON e.source_session_event_id = se2.id
                       WHERE se2.cohort_id = c.id
                         AND se2.status = 'scheduled'::projects.session_event_status
                         AND se2.start_time > pg_catalog.now()
                       ORDER BY se2.start_time, e.id
                       LIMIT 1) AS next_event_id
                FROM projects.session_events se
               WHERE se.cohort_id = c.id
          ) sit ON true
         WHERE cm.user_id <> auth.uid ()

        UNION ALL

        SELECT 'pipeline_project', p.id, m.id, p.owner_user_id, u.username, p.status::text,
               p.created_at, p.last_activity_at,
               p.budget_amount_cents, pg_catalog.upper(p.currency),
               (SELECT pg_catalog.min(e.starts_at) FROM scheduling.events e
                 WHERE e.project_id = p.id AND e.starts_at > pg_catalog.now()),
               pg_catalog.array_remove(ARRAY[
                   CASE WHEN EXISTS (
                       SELECT 1 FROM projects.stage_revision_requests rv
                         JOIN projects.project_stages ps ON ps.id = rv.project_stage_id
                        WHERE ps.project_id = p.id AND rv.status = 'open'
                   ) THEN 'revision_requested' END,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM open_rounds r
                         JOIN scheduling.events e ON e.id = r.event_id
                        WHERE e.project_id = p.id AND r.opened_by_user_id IS DISTINCT FROM auth.uid ()
                   ) THEN 'reschedule_open' END,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM finance.disputes dp
                         JOIN finance.escrows es ON es.id = dp.escrow_id
                         JOIN projects.project_stages ps ON ps.id = es.project_stage_id
                        WHERE ps.project_id = p.id
                          AND dp.status IN ('open'::public.dispute_status, 'awaiting_response'::public.dispute_status,
                                            'under_review'::public.dispute_status)
                   ) THEN 'dispute_open' END,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM projects.stage_submissions sb
                         JOIN projects.project_stages ps ON ps.id = sb.project_stage_id
                        WHERE ps.project_id = p.id AND sb.status = 'draft'
                   ) THEN 'submission_pending' END
               ], NULL),
               '/projects/' || p.slug
          FROM mine m
          JOIN projects.projects p ON p.source_blueprint_id = m.service_blueprint_id AND p.session_kind = 'none'
          LEFT JOIN org.users_public u ON u.user_id = p.owner_user_id
         WHERE p.owner_user_id <> auth.uid ()
    )
    SELECT a.engagement_kind, a.engagement_id, a.listing_id, a.buyer_user_id, a.buyer_handle, a.status,
           a.opened_at, a.last_activity_at, a.amount_minor, a.currency, a.next_event_at,
           a.action_reasons, a.href
      FROM arms a
     ORDER BY a.last_activity_at DESC, a.engagement_kind, a.engagement_id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
$$;

COMMENT ON FUNCTION catalogue.get_client_pipeline(uuid, integer) IS
'Every engagement on the caller''s listings (fn_manages_listing): inquiry threads, quote requests,
discovery calls, orders, session bookings and pipeline projects, each with its source table''s own
status, the reasons it waits on the seller and its deep link. INVOKER: the arms answer under RLS,
orders through fn_seller_order_lines. Lanes are derived in TypeScript (laneOf).';
-- #endregion
