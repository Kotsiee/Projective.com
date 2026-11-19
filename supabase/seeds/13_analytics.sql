-- =============================================================================================
-- 13_analytics.sql — 90 days of listing traffic, rolled up by the platform's own writer.
--
-- Not generated: like 09_search.sql and 11_standing.sql, every statement reads tables the earlier
-- files created (the published listings and their tags), so it carries no corpus data of its own and
-- stays correct however the world in `gen/world.ts` changes.
--
-- The seller's Analytics view reads `analytics.daily_rollups`, which only `analytics.fn_rollup_listings`
-- writes, from `search.interest_events`, baskets, orders and sittings. So this file seeds the one
-- input nothing else seeds, guest traffic, and then runs the writer over the same days, exactly as the
-- nightly job (`analytics-listing-rollups`) would have. Nothing here is typed into a rollup.
--
-- Per published service and product listing, per UTC day from 91 days ago to yesterday (91 days, so the
-- 90-day view is full whether or not today's 02:10 job has run — `lastRolledUpDay`):
--
--   impressions   12–40 a day as a base, × 0.7 at weekends, × 0.75 → 1.25 across the window (traffic
--                 grows); every third impression carries the listing's first tag as its query and
--                 every third its title (up to any " — "), so most days clear the k ≥ 5 keyword line
--   clicks        4–12% of that day's impressions, by the same visitors
--   views         those visitors who clicked, plus up to two who came straight to the page; each one
--                 view per visitor per day, so the 30-minute rule (search.trg_interest_events_view)
--                 never drops a seeded row
--
-- Every figure comes from `hashtext(listing id || day)`, never `random()`, so a reset on the same day
-- reproduces the same numbers. Visitors are anonymous sessions (`seed-…`); no seeded persona is given a
-- browsing trail. The corpus's placeholder `view_count` / `order_count` (05_catalogue.sql) start at zero
-- here, because the backfill derives them from these rollups (MARKETPLACE SC5).
--
-- Re-running the file on a seeded database inserts no traffic (the `seed-…` sessions are already
-- there) and zeroes nothing; the backfill re-derives the same rollups and counters.
-- =============================================================================================

BEGIN;

-- #region The console counters start from the record, not the corpus
UPDATE catalogue.listings SET view_count = 0, order_count = 0
 WHERE (view_count <> 0 OR order_count <> 0)
   AND NOT EXISTS (SELECT 1 FROM search.interest_events e WHERE e.session_id LIKE 'seed-%');
-- #endregion

-- #region Guest traffic: impressions, clicks and page views
WITH subject AS (
    SELECT l.id AS listing_id,
           CASE WHEN l.kind = 'service' THEN 'service' ELSE 'product' END AS entity_type,
           CASE WHEN l.kind = 'service' THEN l.service_blueprint_id ELSE l.product_id END AS entity_id,
           (SELECT array_agg(lower(t.tag) ORDER BY t.tag) FROM catalogue.listing_tags t WHERE t.listing_id = l.id) AS tags,
           NULLIF(lower(btrim(l.category)), '') AS category,
           NULLIF(lower(btrim(split_part(l.title, ' — ', 1))), '') AS title_query
      FROM catalogue.listings l
     WHERE l.status = 'published'
       AND l.kind IN ('service', 'product')
       AND (l.service_blueprint_id IS NOT NULL OR l.product_id IS NOT NULL)
       -- A re-run inserts nothing: the seeded sessions are `seed-…`, a beacon's are uuids.
       AND NOT EXISTS (SELECT 1 FROM search.interest_events e WHERE e.session_id LIKE 'seed-%')
),
plan AS (
    SELECT s.*,
           d.day,
           abs(hashtext(s.listing_id::text || ':' || d.day::text))::bigint AS h,
           (d.day - (current_date - 91))::numeric / 91 AS progress,
           extract(isodow FROM d.day) IN (6, 7) AS weekend
      FROM subject s
     CROSS JOIN LATERAL (
         SELECT g::date AS day
           FROM generate_series(current_date - 91, current_date - 1, interval '1 day') g
     ) d
),
counts AS (
    SELECT p.*,
           greatest(5, round((12 + p.h % 29) * 1.8 * (CASE WHEN p.weekend THEN 0.7 ELSE 1 END)
                             * (0.75 + 0.5 * p.progress)))::int AS impressions,
           (4 + (p.h / 16) % 9)::numeric / 100 AS ctr,
           ((p.h / 256) % 3)::int AS direct
      FROM plan p
),
visitor AS (
    SELECT c.listing_id, c.entity_type, c.entity_id, c.day, c.h, i,
           'seed-' || left(md5(c.listing_id::text || c.day::text || i::text), 20) AS session_id,
           (c.day::timestamp AT TIME ZONE 'UTC')
               + make_interval(secs => ((c.h + i * 7919) % 86000)::double precision) AS seen_at,
           CASE i % 3
               WHEN 0 THEN coalesce(c.tags[1], c.category)
               WHEN 1 THEN c.title_query
           END AS query,
           i <= round(c.impressions * c.ctr) AS clicked,
           i <= round(c.impressions * c.ctr) + c.direct AS viewed
      FROM counts c
     CROSS JOIN LATERAL generate_series(1, c.impressions) i
)
INSERT INTO search.interest_events (session_id, event_type, entity_id, entity_type, query, weight, context, created_at)
SELECT v.session_id, 'impression', v.entity_id, v.entity_type, v.query, 0.1,
       jsonb_build_object('surface', 'explore.results', 'position', v.i % 24), v.seen_at
  FROM visitor v
UNION ALL
SELECT v.session_id, 'click', v.entity_id, v.entity_type, v.query, 1,
       jsonb_build_object('surface', 'explore.results', 'position', v.i % 24), v.seen_at + interval '40 seconds'
  FROM visitor v WHERE v.clicked
UNION ALL
SELECT v.session_id, 'view', v.entity_id, v.entity_type, NULL, 1,
       jsonb_build_object('surface', 'view.entity'), v.seen_at + interval '90 seconds'
  FROM visitor v WHERE v.viewed;
-- #endregion

-- #region Roll the window up, and with it the console counters
SELECT analytics.fn_backfill_listing_rollups(current_date - 91, current_date - 1);
-- #endregion

COMMIT;
