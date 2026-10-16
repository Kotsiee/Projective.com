-- ============================================================================
-- 00001600 functions analytics
-- Consolidated verbatim from: 20260724110000_analytics_event_substrate.sql
-- ============================================================================

-- Can the current user see analytics attributed to this subject? Mirrors finance.fn_owner_visible's
-- posture (owner scope → membership) but covers the broader, non-money subject kinds. Project-scoped
-- and platform-scoped rows are admin-only; the app reads project analytics through the projects
-- domain, not here. A listing's rows answer to whoever may manage the listing: its owner, or a holder
-- of `publish_listings` on the owning team (catalogue.fn_manages_listing, 00001170).
CREATE OR REPLACE FUNCTION analytics.fn_subject_visible(
    p_subject_kind analytics.subject_kind,
    p_subject_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = analytics, org, security, public
AS $$
    SELECT
        security.is_admin ()
        OR (p_subject_kind IN ('user', 'freelancer') AND p_subject_id = auth.uid ())
        OR (p_subject_kind = 'business' AND org.is_active_business_member (p_subject_id))
        OR (p_subject_kind = 'team' AND org.is_active_team_member (p_subject_id))
        OR (p_subject_kind = 'enterprise' AND org.is_enterprise_member (p_subject_id))
        OR (p_subject_kind = 'listing' AND catalogue.fn_manages_listing (p_subject_id));
$$;

-- #endregion

-- #region 5. analytics.fn_emit — the single write path
-- SECURITY DEFINER so RLS-scoped callers (and the other three migrations in this set) can record an
-- event without a direct INSERT grant. `p_actor` defaults to auth.uid() — a client cannot spoof it,
-- because the parameter is ignored unless the caller is an admin or the service role.
CREATE OR REPLACE FUNCTION analytics.fn_emit(
    p_name text,
    p_subject_kind analytics.subject_kind,
    p_subject_id uuid DEFAULT NULL,
    p_properties jsonb DEFAULT '{}'::jsonb,
    p_value numeric DEFAULT NULL,
    p_project_id uuid DEFAULT NULL,
    p_domain text DEFAULT NULL,
    p_actor uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = analytics, security, public
AS $$
DECLARE
    v_id uuid;
    v_domain text;
    v_actor uuid;
BEGIN
    -- Trust the caller's actor only when it is privileged; otherwise attribute to the session user.
    v_actor := CASE
        WHEN p_actor IS NOT NULL AND (security.is_admin () OR auth.uid () IS NULL) THEN p_actor
        ELSE COALESCE(auth.uid (), p_actor)
    END;

    SELECT c.domain INTO v_domain FROM analytics.event_catalogue c WHERE c.name = p_name;

    INSERT INTO analytics.events (
        name, domain, subject_kind, subject_id, actor_user_id, project_id, value, properties
    ) VALUES (
        p_name,
        COALESCE(p_domain, v_domain, 'platform'),
        p_subject_kind,
        p_subject_id,
        v_actor,
        p_project_id,
        p_value,
        COALESCE(p_properties, '{}'::jsonb)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
EXCEPTION WHEN OTHERS THEN
    -- Telemetry must NEVER break the business transaction that emitted it.
    RETURN NULL;
END;
$$;

-- #region 6. Listing rollups (Decision #217, C5)
-- The writer `analytics.daily_rollups` never had: one UTC day of every listing's numbers, written as
-- `subject_kind = 'listing'` rows so the catalogue's Analytics reads aggregates, never a buyer-level
-- trail (#217 flag k). Idempotent: a re-run upserts the same keys and deletes the day's listing rows it
-- no longer produces, so the day always equals one fresh computation. A definer, because it reads every
-- seller's interest, basket and order rows; nobody but the service role may call it.
--
-- Metrics (the vocabulary is `ListingRollupMetric`, @projective/types/analytics; `value` is the figure,
-- `sample_count` the rows or people behind it):
--   listing.impressions · listing.clicks   interest events on the listing's blueprint / product
--   listing.views                          distinct sessions that opened the listing
--   listing.checkout_starts                basket lines added for the listing
--   listing.orders                         distinct confirmed or invoiced orders placed with a line for it
--   listing.gross_minor {currency}         those lines' gross, per currency
--   listing.bookings                       session seats booked (cohort memberships joined)
--   listing.booking_slot {dow, hour}       sittings held, by weekday (0 = Sunday) and hour in the seller's
--                                          timezone (owning schedule, else profile, else UTC)
--   listing.query_impressions {q}          impressions per normalised query, only from 5+ distinct
--   listing.query_clicks {q}               sessions (KEYWORD_MIN_SESSIONS); clicks for the same queries
--   listing.cancellations                  refunded or cancelled non-session lines (by the order's last
--                                          change) plus sittings cancelled that day
CREATE OR REPLACE FUNCTION analytics.fn_rollup_listings(p_day date)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_from timestamptz;
    v_to timestamptz;
    v_written integer;
BEGIN
    IF p_day IS NULL THEN
        RAISE EXCEPTION 'A day to roll up is required' USING ERRCODE = '22004';
    END IF;
    v_from := p_day::timestamp AT TIME ZONE 'UTC';
    v_to := v_from + interval '1 day';

    WITH subject AS (
        SELECT l.id AS listing_id, 'service'::text AS entity_type, l.service_blueprint_id AS entity_id
          FROM catalogue.listings l
         WHERE l.kind = 'service'::catalogue.listing_kind
        UNION ALL
        SELECT l.id, 'product', l.product_id
          FROM catalogue.listings l
         WHERE l.kind = 'product'::catalogue.listing_kind
    ),
    interest AS (
        SELECT s.listing_id,
               ie.event_type,
               COALESCE(ie.session_id, ie.user_id::text) AS visitor,
               NULLIF(pg_catalog.lower(pg_catalog.btrim(
                   pg_catalog.regexp_replace(COALESCE(ie.query, ''), '\s+', ' ', 'g')
               )), '') AS q
          FROM search.interest_events ie
          JOIN subject s ON s.entity_id = ie.entity_id AND s.entity_type = ie.entity_type
         WHERE ie.created_at >= v_from AND ie.created_at < v_to
           AND ie.event_type IN ('impression', 'click', 'view')
    ),
    keyword AS (
        SELECT i.listing_id, i.q
          FROM interest i
         WHERE i.event_type = 'impression' AND i.q IS NOT NULL
         GROUP BY i.listing_id, i.q
        HAVING pg_catalog.count(DISTINCT i.visitor) >= 5
    ),
    line_subject AS (
        SELECT s.listing_id, s.entity_id,
               CASE WHEN s.entity_type = 'product' THEN true ELSE false END AS is_product
          FROM subject s
    ),
    basket AS (
        SELECT ls.listing_id, bi.id, bi.basket_id
          FROM finance.basket_items bi
          JOIN line_subject ls ON ls.entity_id = bi.item_id
           AND (ls.is_product = (bi.item_type = 'digital_product'::finance.purchasable_item_kind))
         WHERE bi.created_at >= v_from AND bi.created_at < v_to
           AND bi.item_type NOT IN ('project_ticket'::finance.purchasable_item_kind,
                                    'one_off_project'::finance.purchasable_item_kind,
                                    'one_off_task'::finance.purchasable_item_kind,
                                    'paid_revision'::finance.purchasable_item_kind)
    ),
    sold AS (
        SELECT ls.listing_id, ol.id, ol.order_id, ol.item_type, ol.line_total_minor,
               pg_catalog.upper(ol.currency) AS currency, o.status, o.placed_at, o.updated_at
          FROM finance.order_lines ol
          JOIN finance.orders o ON o.id = ol.order_id
          JOIN line_subject ls ON ls.entity_id = ol.item_id
           AND (ls.is_product = (ol.item_type = 'digital_product'::finance.purchasable_item_kind))
         WHERE ol.item_type NOT IN ('project_ticket'::finance.purchasable_item_kind,
                                    'one_off_project'::finance.purchasable_item_kind,
                                    'one_off_task'::finance.purchasable_item_kind,
                                    'paid_revision'::finance.purchasable_item_kind)
           AND ((o.placed_at >= v_from AND o.placed_at < v_to)
                OR (o.updated_at >= v_from AND o.updated_at < v_to))
    ),
    seller_tz AS (
        SELECT s.listing_id,
               COALESCE(tz.name, 'UTC') AS tz
          FROM subject s
          JOIN catalogue.listings l ON l.id = s.listing_id
          LEFT JOIN scheduling.schedules sc
            ON (l.owner_team_id IS NOT NULL AND sc.owner_type = 'team'::scheduling.owner_type AND sc.owner_id = l.owner_team_id)
            OR (l.owner_team_id IS NULL AND sc.owner_type = 'user'::scheduling.owner_type AND sc.owner_id = l.owner_user_id)
          LEFT JOIN org.users_public u ON u.user_id = l.owner_user_id
          LEFT JOIN pg_catalog.pg_timezone_names tz ON tz.name = COALESCE(sc.timezone, u.timezone)
         WHERE s.entity_type = 'service'
    ),
    session_projects AS (
        SELECT s.listing_id, c.id AS cohort_id
          FROM subject s
          JOIN projects.projects p ON p.source_blueprint_id = s.entity_id AND p.session_kind <> 'none'
          JOIN projects.cohorts c ON c.project_id = p.id
         WHERE s.entity_type = 'service'
    ),
    metrics (listing_id, metric, dimensions, value, sample_count) AS (
        SELECT i.listing_id, 'listing.impressions', '{}'::jsonb,
               pg_catalog.count(*)::numeric, pg_catalog.count(DISTINCT i.visitor)::integer
          FROM interest i WHERE i.event_type = 'impression' GROUP BY i.listing_id
        UNION ALL
        SELECT i.listing_id, 'listing.clicks', '{}'::jsonb,
               pg_catalog.count(*)::numeric, pg_catalog.count(DISTINCT i.visitor)::integer
          FROM interest i WHERE i.event_type = 'click' GROUP BY i.listing_id
        UNION ALL
        SELECT i.listing_id, 'listing.views', '{}'::jsonb,
               pg_catalog.count(DISTINCT i.visitor)::numeric, pg_catalog.count(*)::integer
          FROM interest i WHERE i.event_type = 'view' AND i.visitor IS NOT NULL GROUP BY i.listing_id
        UNION ALL
        SELECT k.listing_id, 'listing.query_impressions', pg_catalog.jsonb_build_object('q', k.q),
               pg_catalog.count(*)::numeric, pg_catalog.count(DISTINCT i.visitor)::integer
          FROM keyword k
          JOIN interest i ON i.listing_id = k.listing_id AND i.q = k.q AND i.event_type = 'impression'
         GROUP BY k.listing_id, k.q
        UNION ALL
        SELECT k.listing_id, 'listing.query_clicks', pg_catalog.jsonb_build_object('q', k.q),
               pg_catalog.count(*)::numeric, pg_catalog.count(DISTINCT i.visitor)::integer
          FROM keyword k
          JOIN interest i ON i.listing_id = k.listing_id AND i.q = k.q AND i.event_type = 'click'
         GROUP BY k.listing_id, k.q
        UNION ALL
        SELECT b.listing_id, 'listing.checkout_starts', '{}'::jsonb,
               pg_catalog.count(*)::numeric, pg_catalog.count(DISTINCT b.basket_id)::integer
          FROM basket b GROUP BY b.listing_id
        UNION ALL
        SELECT x.listing_id, 'listing.orders', '{}'::jsonb,
               pg_catalog.count(DISTINCT x.order_id)::numeric, pg_catalog.count(*)::integer
          FROM sold x
         WHERE x.placed_at >= v_from AND x.placed_at < v_to
           AND x.status IN ('confirmed'::finance.order_status, 'invoiced'::finance.order_status)
         GROUP BY x.listing_id
        UNION ALL
        SELECT x.listing_id, 'listing.gross_minor', pg_catalog.jsonb_build_object('currency', x.currency),
               pg_catalog.sum(x.line_total_minor)::numeric, pg_catalog.count(*)::integer
          FROM sold x
         WHERE x.placed_at >= v_from AND x.placed_at < v_to
           AND x.status IN ('confirmed'::finance.order_status, 'invoiced'::finance.order_status)
         GROUP BY x.listing_id, x.currency
        UNION ALL
        SELECT sp.listing_id, 'listing.bookings', '{}'::jsonb,
               pg_catalog.count(*)::numeric, pg_catalog.sum(cm.seats)::integer
          FROM session_projects sp
          JOIN projects.cohort_memberships cm ON cm.cohort_id = sp.cohort_id
         WHERE cm.joined_at >= v_from AND cm.joined_at < v_to
         GROUP BY sp.listing_id
        UNION ALL
        SELECT slot.listing_id, 'listing.booking_slot',
               pg_catalog.jsonb_build_object('dow', slot.dow, 'hour', slot.hour),
               pg_catalog.count(*)::numeric, pg_catalog.count(*)::integer
          FROM (
              SELECT sp.listing_id,
                     pg_catalog.date_part('dow', se.start_time AT TIME ZONE st.tz)::integer AS dow,
                     pg_catalog.date_part('hour', se.start_time AT TIME ZONE st.tz)::integer AS hour
                FROM session_projects sp
                JOIN seller_tz st ON st.listing_id = sp.listing_id
                JOIN projects.session_events se ON se.cohort_id = sp.cohort_id
               WHERE se.start_time >= v_from AND se.start_time < v_to
                 AND se.status IN ('scheduled'::projects.session_event_status,
                                   'completed'::projects.session_event_status)
          ) slot
         GROUP BY slot.listing_id, slot.dow, slot.hour
        UNION ALL
        SELECT c.listing_id, 'listing.cancellations', '{}'::jsonb,
               pg_catalog.count(*)::numeric, pg_catalog.count(*)::integer
          FROM (
              SELECT x.listing_id
                FROM sold x
               WHERE x.updated_at >= v_from AND x.updated_at < v_to
                 AND x.status IN ('refunded'::finance.order_status, 'cancelled'::finance.order_status)
                 AND x.item_type NOT IN ('service_session'::finance.purchasable_item_kind,
                                         'set_session'::finance.purchasable_item_kind,
                                         'course_group_session'::finance.purchasable_item_kind)
              UNION ALL
              SELECT sp.listing_id
                FROM session_projects sp
                JOIN projects.session_events se ON se.cohort_id = sp.cohort_id
               WHERE se.updated_at >= v_from AND se.updated_at < v_to
                 AND se.status IN ('cancelled_by_freelancer'::projects.session_event_status,
                                   'cancelled_by_client'::projects.session_event_status)
          ) c
         GROUP BY c.listing_id
    ),
    written AS (
        INSERT INTO analytics.daily_rollups AS r
               (day, metric, subject_kind, subject_id, dimensions, value, sample_count, computed_at)
        SELECT p_day, m.metric, 'listing'::analytics.subject_kind, m.listing_id, m.dimensions,
               m.value, COALESCE(m.sample_count, 0), pg_catalog.now()
          FROM metrics m
         WHERE m.value > 0
        ON CONFLICT (day, metric, subject_kind, subject_id, dimensions) DO UPDATE
           SET value = EXCLUDED.value,
               sample_count = EXCLUDED.sample_count,
               computed_at = EXCLUDED.computed_at
        RETURNING r.id
    ),
    stale AS (
        DELETE FROM analytics.daily_rollups d
         WHERE d.day = p_day
           AND d.subject_kind = 'listing'::analytics.subject_kind
           AND d.metric LIKE 'listing.%'
           AND NOT EXISTS (SELECT 1 FROM written w WHERE w.id = d.id)
        RETURNING d.id
    )
    SELECT pg_catalog.count(*)::integer INTO v_written FROM written;

    RETURN v_written;
END;
$$;

COMMENT ON FUNCTION analytics.fn_rollup_listings(date) IS
'Writes one UTC day of listing analytics into analytics.daily_rollups (subject_kind = listing):
impressions, clicks, views, checkout_starts, orders, gross_minor {currency}, bookings, booking_slot
{dow, hour} in the seller''s timezone, query_impressions / query_clicks {q} from 5+ distinct sessions,
cancellations. Idempotent per day. Service role only; job analytics-listing-rollups.';

-- Rolls every day in [p_from, p_to] up again, oldest first, for a backfill after seeding or a fix to the
-- writer. Bounded to two years so a typo cannot pin the database. Service role only.
CREATE OR REPLACE FUNCTION analytics.fn_backfill_listing_rollups(p_from date, p_to date)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_day date;
    v_total integer := 0;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
        RAISE EXCEPTION 'A backfill needs p_from <= p_to' USING ERRCODE = '22023';
    END IF;
    IF p_to - p_from > 731 THEN
        RAISE EXCEPTION 'A backfill covers at most two years at a time' USING ERRCODE = '22023';
    END IF;
    v_day := p_from;
    WHILE v_day <= p_to LOOP
        v_total := v_total + analytics.fn_rollup_listings(v_day);
        v_day := v_day + 1;
    END LOOP;
    RETURN v_total;
END;
$$;

COMMENT ON FUNCTION analytics.fn_backfill_listing_rollups(date, date) IS
'Re-runs fn_rollup_listings for every day in [p_from, p_to] (at most two years). Service role only.';
-- #endregion
