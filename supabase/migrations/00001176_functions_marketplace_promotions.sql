-- ============================================================================
-- 00001176 functions marketplace — promoted placements (Decision #454)
--
-- Organic ranking is never for sale. A promotion buys a separately labelled "Promoted" slot at a
-- fixed position on an Explore rail or results page, placed after ranking; it never moves an organic
-- result and is never shown to a 13–17 account (both enforced by the reader,
-- `ExploreBackendService`). These doors are the only writers of `marketplace.promoted_placements`,
-- which has no client write policy (00002018).
--
-- Allocation, provisional until plans can be bought (PRD-F14; finance-model.md §16.7): a seller whose
-- plan holds the `promoted_placement` flag runs ONE live placement at a time, a 7-day flight starting
-- now, on `explore_home` or `explore_results`, for a published service or product. Nothing is
-- charged (`spend_cents` 0). The seller is the listing's owning subject: its team for a team listing
-- (the team's plan, the team's one live slot), otherwise its person.
--
-- Three doors, signed-in only (grants in 00002510): `promote_listing`, `stop_listing_promotion` and
-- `get_listing_promotion` (the /catalogue control's read). Probe: `supabase/probes/promoted_placements.sql`.
-- ============================================================================

-- #region Helpers
CREATE OR REPLACE FUNCTION marketplace.fn_promotion_flight()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT interval '7 days';
$$;

COMMENT ON FUNCTION marketplace.fn_promotion_flight() IS
'How long one plan-allocated promotion runs (Decision #454; finance-model.md §16.7). Internal.';

-- The live placements of one seller subject, oldest flight first. Driven from the seller's listings
-- (indexed by owner) into the ledger's (entity_type, entity_id) index.
CREATE OR REPLACE FUNCTION marketplace.fn_live_listing_promotions(p_owner_team uuid, p_owner_user uuid)
RETURNS TABLE (
    placement_id uuid,
    listing_id uuid,
    surface text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT pp.id, l.id, pp.surface, pp.starts_at, pp.ends_at
      FROM catalogue.listings l
      JOIN marketplace.promoted_placements pp
        ON pp.entity_type = l.kind::text
       AND pp.entity_id = COALESCE (l.service_blueprint_id, l.product_id)
     WHERE CASE
               WHEN p_owner_team IS NOT NULL THEN l.owner_team_id = p_owner_team
               ELSE l.owner_team_id IS NULL AND l.owner_user_id = p_owner_user
           END
       AND pp.cancelled_at IS NULL
       AND pp.starts_at <= pg_catalog.now ()
       AND pp.ends_at > pg_catalog.now ()
     ORDER BY pp.starts_at, pp.id;
$$;

COMMENT ON FUNCTION marketplace.fn_live_listing_promotions(uuid, uuid) IS
'The live placements on one seller''s listings: the team''s when p_owner_team is set, else the
person''s own (non-team) listings. Internal.';
-- #endregion

-- #region Promote
CREATE OR REPLACE FUNCTION marketplace.promote_listing(p_listing uuid, p_surface text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid ();
    v_row catalogue.listings;
    v_subject_type text;
    v_subject uuid;
    v_live uuid;
    v_id uuid;
    v_starts timestamp with time zone := pg_catalog.now ();
    v_ends timestamp with time zone;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Sign in to promote a listing' USING ERRCODE = '42501';
    END IF;
    IF p_surface IS NULL OR p_surface NOT IN ('explore_home', 'explore_results') THEN
        RAISE EXCEPTION 'A listing is promoted on the Explore home or in search results' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_row FROM catalogue.listings WHERE id = p_listing FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That listing no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF NOT catalogue.fn_manages_listing (p_listing) THEN
        RAISE EXCEPTION 'Only the listing''s seller can promote it' USING ERRCODE = '42501';
    END IF;
    PERFORM org.fn_assert_adult (v_uid);
    IF v_row.status::text <> 'published' THEN
        RAISE EXCEPTION 'Publish this listing before promoting it' USING ERRCODE = 'PG422';
    END IF;

    v_subject_type := CASE WHEN v_row.owner_team_id IS NULL THEN 'user' ELSE 'team' END;
    v_subject := COALESCE (v_row.owner_team_id, v_row.owner_user_id);
    IF NOT finance.fn_has_entitlement (v_subject_type, v_subject, 'promoted_placement'::finance.entitlement_key) THEN
        RAISE EXCEPTION USING ERRCODE = 'PK402', HINT = 'promoted_placement',
            MESSAGE = CASE v_subject_type
                WHEN 'team' THEN 'Promotion is part of Pro Team — this team''s plan does not include it'
                ELSE 'Promotion is part of Pro — your plan does not include it'
            END;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock (pg_catalog.hashtextextended ('marketplace.promotion:' || v_subject::text, 0));
    SELECT f.placement_id INTO v_live
      FROM marketplace.fn_live_listing_promotions (v_row.owner_team_id, v_row.owner_user_id) f
     LIMIT 1;
    IF v_live IS NOT NULL THEN
        RAISE EXCEPTION 'A promotion is already running — stop it or let it end first'
            USING ERRCODE = 'PC409', HINT = 'promotion_live', DETAIL = v_live::text;
    END IF;

    v_ends := v_starts + marketplace.fn_promotion_flight ();
    INSERT INTO marketplace.promoted_placements
        (sponsor_user_id, entity_type, entity_id, surface, starts_at, ends_at, spend_cents, currency)
    VALUES
        (v_uid, v_row.kind::text, COALESCE (v_row.service_blueprint_id, v_row.product_id), p_surface,
         v_starts, v_ends, 0, 'GBP')
    RETURNING id INTO v_id;

    UPDATE catalogue.listings SET promoted = true WHERE id = p_listing AND NOT promoted;

    RETURN pg_catalog.jsonb_build_object(
        'placement_id', v_id,
        'listing_id', p_listing,
        'surface', p_surface,
        'starts_at', v_starts,
        'ends_at', v_ends
    );
END;
$$;

COMMENT ON FUNCTION marketplace.promote_listing(uuid, text) IS
'Start the seller''s one plan-allocated promotion of a published listing: a 7-day flight from now on
explore_home or explore_results, charged nothing. Refusals: 42501 not signed in or not the
listing''s manager · 22023 unknown surface · PB404 no such listing · PM403 the caller is under 18 ·
PG422 not published · PK402 the owning subject''s plan lacks promoted_placement · PC409 a promotion
is already live for that seller (DETAIL = its placement id).';
-- #endregion

-- #region Stop
CREATE OR REPLACE FUNCTION marketplace.stop_listing_promotion(p_listing uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row catalogue.listings;
    v_stopped integer;
BEGIN
    IF auth.uid () IS NULL THEN
        RAISE EXCEPTION 'Sign in to stop a promotion' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_row FROM catalogue.listings WHERE id = p_listing FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That listing no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF NOT catalogue.fn_manages_listing (p_listing) THEN
        RAISE EXCEPTION 'Only the listing''s seller can stop its promotion' USING ERRCODE = '42501';
    END IF;

    UPDATE marketplace.promoted_placements pp
       SET cancelled_at = pg_catalog.now (), updated_at = pg_catalog.now ()
     WHERE pp.entity_type = v_row.kind::text
       AND pp.entity_id = COALESCE (v_row.service_blueprint_id, v_row.product_id)
       AND pp.cancelled_at IS NULL
       AND pp.starts_at <= pg_catalog.now ()
       AND pp.ends_at > pg_catalog.now ();
    GET DIAGNOSTICS v_stopped = ROW_COUNT;
    IF v_stopped = 0 THEN
        RAISE EXCEPTION 'This listing has no promotion running' USING ERRCODE = 'PC409', HINT = 'promotion_not_live';
    END IF;

    UPDATE catalogue.listings SET promoted = false WHERE id = p_listing AND promoted;

    RETURN pg_catalog.jsonb_build_object('listing_id', p_listing, 'stopped', v_stopped);
END;
$$;

COMMENT ON FUNCTION marketplace.stop_listing_promotion(uuid) IS
'Stop a listing''s live promotion now (cancelled_at, never a delete: the window it ran is the record).
Refusals: 42501 not signed in or not the listing''s manager · PB404 no such listing · PC409 nothing
is running on it.';
-- #endregion

-- #region Read
CREATE OR REPLACE FUNCTION marketplace.get_listing_promotion(p_listing uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row catalogue.listings;
    v_live record;
    v_elsewhere record;
BEGIN
    IF auth.uid () IS NULL THEN
        RAISE EXCEPTION 'Sign in to see this listing''s promotion' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_row FROM catalogue.listings WHERE id = p_listing;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That listing no longer exists' USING ERRCODE = 'PB404';
    END IF;
    IF NOT catalogue.fn_manages_listing (p_listing) THEN
        RAISE EXCEPTION 'Only the listing''s seller can see its promotion' USING ERRCODE = '42501';
    END IF;

    SELECT f.* INTO v_live
      FROM marketplace.fn_live_listing_promotions (v_row.owner_team_id, v_row.owner_user_id) f
     WHERE f.listing_id = p_listing
     LIMIT 1;
    SELECT f.listing_id, f.ends_at, l.title,
           COALESCE (b.slug, p.slug) AS slug
      INTO v_elsewhere
      FROM marketplace.fn_live_listing_promotions (v_row.owner_team_id, v_row.owner_user_id) f
      JOIN catalogue.listings l ON l.id = f.listing_id
      LEFT JOIN marketplace.service_blueprints b ON b.id = l.service_blueprint_id
      LEFT JOIN catalogue.products p ON p.id = l.product_id
     WHERE f.listing_id <> p_listing
     LIMIT 1;

    RETURN pg_catalog.jsonb_build_object(
        'listing_id', p_listing,
        'entitled', finance.fn_has_entitlement (
            CASE WHEN v_row.owner_team_id IS NULL THEN 'user' ELSE 'team' END,
            COALESCE (v_row.owner_team_id, v_row.owner_user_id),
            'promoted_placement'::finance.entitlement_key
        ),
        'subject', CASE WHEN v_row.owner_team_id IS NULL THEN 'user' ELSE 'team' END,
        'published', v_row.status::text = 'published',
        'flight_days', EXTRACT(DAY FROM marketplace.fn_promotion_flight ())::integer,
        'live', CASE WHEN v_live.placement_id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
            'placement_id', v_live.placement_id,
            'surface', v_live.surface,
            'starts_at', v_live.starts_at,
            'ends_at', v_live.ends_at
        ) END,
        'elsewhere', CASE WHEN v_elsewhere.listing_id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
            'listing_id', v_elsewhere.listing_id,
            'slug', v_elsewhere.slug,
            'title', v_elsewhere.title,
            'ends_at', v_elsewhere.ends_at
        ) END
    );
END;
$$;

COMMENT ON FUNCTION marketplace.get_listing_promotion(uuid) IS
'What the /catalogue Promote control shows for one listing: whether the owning subject''s plan holds
promoted_placement, whether the listing is published, the flight length, its live placement and the
seller''s live placement on another listing (one live at a time). Refusals: 42501 · PB404.';
-- #endregion
