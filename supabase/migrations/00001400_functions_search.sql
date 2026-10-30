-- ============================================================================
-- 00001400 functions search
-- Consolidated verbatim from: 0010_search_tables.sql, 0217_search_engine_pgvector.sql, 0219_search_engine_weights.sql, 0220_search_engine_rpc.sql
-- ============================================================================

-- #region A team's live W_i in the index (Decision #235, closes #233 FLAG (a))
-- A team's load is its active members' LIVE W_i — Σ workload_intensity of the claimed / in-progress /
-- in-review tickets they hold, rounded — exactly as org.profiles_index's team branch (00003001)
-- computes `workload`. org.teams.current_workload_intensity has no writer and is not read (#233 (a)).
-- search.profiles_index.current_workload_intensity keeps a team row on this figure, though no SQL
-- ranking reads it since Decision #340 Q0.2 (f) deleted the ranking RPC: sync_team_to_index writes
-- it, and fn_refresh_team_workload re-sums it when a ticket moves (projects.fn_sync_workload_intensity,
-- 00001140) or a membership changes (trg_team_members_search_workload, 00001895).

/** A team's live W_i: its active members' claimed / in_progress / in_review / reported_hidden ticket intensity, summed. */
CREATE OR REPLACE FUNCTION search.fn_team_live_workload(p_team_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT round(sum(tk.workload_intensity))::int
          FROM org.team_members tm
          JOIN projects.tickets tk ON tk.current_assignee_id = tm.user_id
                                  AND tk.status::text IN ('claimed', 'in_progress', 'in_review', 'reported_hidden')
         WHERE tm.team_id = p_team_id AND tm.status = 'active'
    ), 0);
$$;

/**
 * Re-sums the live W_i of each listed team into its search row. A load change is not a profile edit,
 * so `updated_at` (the `recent` sort key) is left alone, and an unchanged figure writes nothing.
 */
CREATE OR REPLACE FUNCTION search.fn_refresh_team_workload(p_team_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE search.profiles_index pi
       SET current_workload_intensity = w.live
      FROM (SELECT DISTINCT ids.id, search.fn_team_live_workload(ids.id) AS live
              FROM unnest(p_team_ids) AS ids(id)
             WHERE ids.id IS NOT NULL) w
     WHERE pi.entity_type = 'team'
       AND pi.entity_id = w.id
       AND pi.current_workload_intensity IS DISTINCT FROM w.live;
END;
$$;

/** org.team_members trigger: a member joining, leaving or moving re-sums the teams on both sides. */
CREATE OR REPLACE FUNCTION search.fn_team_members_workload_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM search.fn_refresh_team_workload(ARRAY[
        CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.team_id END,
        CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN NEW.team_id END
    ]);
    RETURN NULL;
END;
$$;
-- #endregion

-- #region Index visibility = directory visibility (SEC E6 / G12)
-- `is_active` is what makes an index row discoverable: the anon SELECT policies, the column grants and
-- search.fn_nearest / fn_nearest_to_entity all answer from rows where it is true, and promise to
-- answer nothing anon could not already read. So it is the source's own LISTED predicate, the one
-- the public directory (org.profiles_index, 00003001) and the project policies apply, never wider:
--   user, freelancer   users_public.visibility = 'public' (a freelancer row also needs is_freelancer)
--   team, business     status = 'active' AND visibility = 'public'
--   project            status = 'active' AND visibility = 'public'
-- `unlisted` is reachable by handle and never discoverable; a draft, archived, completed or
-- cancelled source is not listed at all. Before this, a team row was always active, a freelancer or
-- business row kept whatever it was born with, and every non-draft public project was listed.

/** Whether a person's freelancer row is listed: a public profile that is a freelancer. */
CREATE OR REPLACE FUNCTION search.fn_freelancer_listed(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE((
        SELECT u.visibility = 'public' AND u.is_freelancer
          FROM org.users_public u WHERE u.user_id = p_user_id
    ), false);
$$;
-- #endregion

CREATE OR REPLACE FUNCTION search.sync_team_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata,
        rating_average, rating_count, current_workload_intensity, available_since, is_active, updated_at
    )
    VALUES (
        NEW.id, 'team', NEW.slug, to_tsvector('english', coalesce(NEW.slug, '')),
        jsonb_build_object('payout_model', NEW.payout_model),
        NEW.rating_average, NEW.rating_count, search.fn_team_live_workload(NEW.id), NEW.available_since,
        NEW.status = 'active' AND NEW.visibility = 'public', now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        display_name = EXCLUDED.display_name, fts = EXCLUDED.fts,
        metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        current_workload_intensity = EXCLUDED.current_workload_intensity,
        available_since = EXCLUDED.available_since,
        is_active = EXCLUDED.is_active,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, search, org;

CREATE OR REPLACE FUNCTION search.sync_freelancer_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata,
        rating_average, rating_count, current_workload_intensity, available_since, is_active, updated_at
    )
    VALUES (
        NEW.user_id, 'freelancer', 'Freelancer Profile', to_tsvector('english', array_to_string(NEW.skills, ' ')),
        jsonb_build_object('skills', NEW.skills),
        NEW.rating_average, NEW.rating_count, NEW.current_workload_intensity, NEW.available_since,
        search.fn_freelancer_listed(NEW.user_id), now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        fts = EXCLUDED.fts, metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        current_workload_intensity = EXCLUDED.current_workload_intensity,
        available_since = EXCLUDED.available_since,
        is_active = EXCLUDED.is_active,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, search, org;

-- ⚠️ THE SIX `sync_*_to_index` TRIGGERS ARE `INVOKER`, AND THAT MAKES THEM WRITE BLOCKERS.
--
-- Each one fires on a write to a table `authenticated` is supposed to be able to write, and each one
-- then writes a `search.*_index` row on that caller's behalf. But `00002500` grants `authenticated`
-- only SELECT on this schema, so an ordinary client UPDATE raises
-- `permission denied for table <x>_index` — inside a trigger, from a statement the caller never wrote.
-- Widening the grant does NOT fix it either: every index table has RLS on with a SELECT-only policy,
-- so DML then raises `new row violates row-level security policy`. Two layers, both blocking.
--
-- `SECURITY DEFINER` is the fix, and it is what every OTHER function in this file already is: the
-- index is derived, internal, and nobody's row-level property — it is maintained BY the platform, not
-- by whoever happened to trigger it.
--
-- Only the PROJECT sync is corrected here, because a client write to `projects.projects` is a live
-- path (the engagement editor's `PATCH /api/projects/[id]`) and was measurably failing on it.
-- `sync_team_to_index`, `sync_freelancer_to_index`, `sync_user_to_index`, `sync_business_to_index`
-- and `sync_service_to_index` carry the IDENTICAL defect and are latent only because their own client
-- write paths are still stub-first. They are not fixed here on purpose — each one gates a different
-- domain's writes and belongs to that domain's pass, not to this one.
CREATE OR REPLACE FUNCTION search.sync_project_to_index() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, search, projects
AS $$
BEGIN
    INSERT INTO search.projects_index (project_id, title, fts, industry_category_id, status, target_start_date, is_active, updated_at)
    VALUES (
        NEW.id, NEW.title, to_tsvector('english', NEW.status::text || ' ' || NEW.title),
        NEW.industry_category_id, NEW.status::text, NEW.target_project_start_date,
        NEW.status = 'active' AND NEW.visibility = 'public', now()
    )
    ON CONFLICT (project_id) DO UPDATE SET
        title = EXCLUDED.title, fts = EXCLUDED.fts,
        industry_category_id = EXCLUDED.industry_category_id,
        status = EXCLUDED.status, target_start_date = EXCLUDED.target_start_date, 
        is_active = EXCLUDED.is_active, updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION search.sync_user_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, headline, fts, metadata,
        rating_average, rating_count, is_active, updated_at
    )
    VALUES (
        NEW.user_id, 'user', coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, ''), NEW.headline,
        to_tsvector('english', coalesce(NEW.first_name, '') || ' ' || coalesce(NEW.last_name, '') || ' ' || coalesce(NEW.headline, '')),
        jsonb_build_object('username', NEW.username),
        NEW.rating_average, NEW.rating_count,
        CASE WHEN NEW.visibility = 'public' THEN true ELSE false END, now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        display_name = EXCLUDED.display_name, headline = EXCLUDED.headline, fts = EXCLUDED.fts,
        metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        is_active = EXCLUDED.is_active, updated_at = now();

    -- The person's freelancer row is listed by THIS row's visibility, which sync_freelancer_to_index
    -- reads only when the freelancer profile itself changes. So a profile turned private, or a person
    -- who stops being a freelancer, must take the freelancer row out here (SEC G12).
    UPDATE search.profiles_index pi
       SET is_active = search.fn_freelancer_listed(NEW.user_id), updated_at = now()
     WHERE pi.entity_type = 'freelancer' AND pi.entity_id = NEW.user_id
       AND pi.is_active IS DISTINCT FROM search.fn_freelancer_listed(NEW.user_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, search, org;

CREATE OR REPLACE FUNCTION search.sync_business_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata,
        rating_average, rating_count, is_active, updated_at
    )
    VALUES (
        NEW.id, 'business', NEW.name, to_tsvector('english', coalesce(NEW.name, '')),
        jsonb_build_object('plan', NEW.plan),
        NEW.rating_average, NEW.rating_count, NEW.status = 'active' AND NEW.visibility = 'public', now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        display_name = EXCLUDED.display_name, fts = EXCLUDED.fts,
        metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        is_active = EXCLUDED.is_active,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, search, org;

-- #region Listing fts (Decision #217(f))
-- The one fts recipe for a listing's index row: the title at weight A, the seller's tags at B and the
-- body at C, so a tag match outranks a passing mention in the description but never the title.
CREATE OR REPLACE FUNCTION search.fn_listing_fts(p_title text, p_tags text[], p_body text)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT pg_catalog.setweight(pg_catalog.to_tsvector('english'::regconfig, COALESCE(p_title, '')), 'A')
        || pg_catalog.setweight(pg_catalog.to_tsvector('english'::regconfig,
               pg_catalog.array_to_string(COALESCE(p_tags, '{}'::text[]), ' ')), 'B')
        || pg_catalog.setweight(pg_catalog.to_tsvector('english'::regconfig, COALESCE(p_body, '')), 'C')
$$;

-- A listing's tags in a stable order, so an unchanged set never rewrites its index row differently.
CREATE OR REPLACE FUNCTION search.fn_listing_tags(p_listing uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT COALESCE(pg_catalog.array_agg(t.tag ORDER BY pg_catalog.lower(t.tag)), '{}'::text[])
      FROM catalogue.listing_tags t
     WHERE t.listing_id = p_listing
$$;

-- A tag change re-syncs the listing's index row (`trg_listing_tags_touch`, 00001800): the tags live
-- on `catalogue.listing_tags`, so neither the blueprint nor the listing trigger sees them change.
CREATE OR REPLACE FUNCTION search.fn_listing_tags_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_listing catalogue.listings;
    v_tags text[];
BEGIN
    SELECT * INTO v_listing FROM catalogue.listings l
     WHERE l.id = CASE TG_OP WHEN 'DELETE' THEN OLD.listing_id ELSE NEW.listing_id END;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    v_tags := search.fn_listing_tags(v_listing.id);
    IF v_listing.kind = 'service'::catalogue.listing_kind THEN
        UPDATE search.services_index si
           SET tags = v_tags, fts = search.fn_listing_fts(b.title, v_tags, b.description_text), updated_at = pg_catalog.now()
          FROM marketplace.service_blueprints b
         WHERE b.id = v_listing.service_blueprint_id AND si.service_id = b.id;
    ELSE
        UPDATE search.catalogue_index ci
           SET tags = v_tags,
               fts = search.fn_listing_fts(v_listing.title, v_tags, v_listing.description_text || ' ' || v_listing.category),
               updated_at = pg_catalog.now()
         WHERE ci.entity_type = 'product' AND ci.entity_id = v_listing.product_id;
    END IF;
    RETURN NULL;
END;
$$;
-- #endregion

CREATE OR REPLACE FUNCTION search.sync_service_to_index() RETURNS TRIGGER AS $$
DECLARE
    v_tags text[];
BEGIN
    v_tags := COALESCE((
        SELECT pg_catalog.array_agg(t.tag ORDER BY pg_catalog.lower(t.tag))
          FROM catalogue.listing_tags t
          JOIN catalogue.listings l ON l.id = t.listing_id
         WHERE l.service_blueprint_id = NEW.id
    ), '{}'::text[]);
    INSERT INTO search.services_index (
        service_id, title, tags, fts, is_public,
        rating_average, rating_count, updated_at
    )
    VALUES (
        NEW.id, NEW.title, v_tags, search.fn_listing_fts(NEW.title, v_tags, NEW.description_text),
        NEW.is_published, NEW.rating_average, NEW.rating_count, now()
    )
    ON CONFLICT (service_id) DO UPDATE SET
        title = EXCLUDED.title, tags = EXCLUDED.tags, fts = EXCLUDED.fts, is_public = EXCLUDED.is_public,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, search, marketplace;

-- -----------------------------------------------------------------------------
-- search.catalogue_index sync (Decision #179). A product's discovery facts live on
-- its LISTING (title, description, status); an article is its own row. Visibility is
-- the source's `published` status. Definers, for the reason given above the project
-- sync. The embedding columns are left alone: a stale text is caught by its hash.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.sync_product_listing_to_index() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, search, catalogue
AS $$
DECLARE
    v_tags text[];
BEGIN
    IF NEW.kind <> 'product' OR NEW.product_id IS NULL THEN
        RETURN NEW;
    END IF;
    v_tags := search.fn_listing_tags(NEW.id);
    INSERT INTO search.catalogue_index (entity_type, entity_id, title, tags, fts, is_public, updated_at)
    VALUES (
        'product', NEW.product_id, NEW.title, v_tags,
        search.fn_listing_fts(NEW.title, v_tags, coalesce(NEW.description_text, '') || ' ' || coalesce(NEW.category, '')),
        NEW.status = 'published', now()
    )
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
        title = EXCLUDED.title, tags = EXCLUDED.tags, fts = EXCLUDED.fts, is_public = EXCLUDED.is_public, updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION search.sync_article_to_index() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, search, catalogue
AS $$
BEGIN
    INSERT INTO search.catalogue_index (entity_type, entity_id, title, fts, is_public, updated_at)
    VALUES (
        'article', NEW.id, NEW.title,
        to_tsvector('english', NEW.title || ' ' || coalesce(NEW.topic, '') || ' ' || coalesce(NEW.summary, '')),
        NEW.status = 'published', now()
    )
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
        title = EXCLUDED.title, fts = EXCLUDED.fts, is_public = EXCLUDED.is_public, updated_at = now();
    RETURN NEW;
END;
$$;

-- =============================================================================
-- 0215_search_engine_weights.sql
-- Admin-tunable ranking weights + admin guard.
--
-- `search.search_weights` is the single source of truth for every coefficient in
-- the scoring matrix. An admin can monitor and live-adjust individual weights via
-- the admin API (fn_get_weights / fn_set_weight) WITHOUT a code change or deploy —
-- the discovery catalogue reads it through search.ranking_weights().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Admin guard: reused by weight-management + analytics RPCs. ops.admin_users is
-- an internal (non-exposed) table, so this is SECURITY DEFINER.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.is_admin(p_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ops, public
AS $$
  SELECT EXISTS (SELECT 1 FROM ops.admin_users WHERE user_id = p_user_id);
$$;

CREATE OR REPLACE FUNCTION search.fn_norm(p_val double precision, p_cap double precision)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT least(greatest(coalesce(p_val, 0), 0) / nullif(p_cap, 0), 1.0)::numeric;
$$;

-- -----------------------------------------------------------------------------
-- fn_log_query — write search execution telemetry (guest-safe). p_query_embedding is
-- the voyage-4 query vector when semantic ranking ran, else NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_log_query(
  p_query       text,
  p_entity_type text,
  p_filters     jsonb,
  p_result_count integer,
  p_duration_ms  integer,
  p_candidate_pool integer DEFAULT NULL,
  p_user_id     uuid DEFAULT auth.uid(),
  p_query_embedding public.vector(1024) DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = search, public
AS $$
  INSERT INTO search.query_logs
    (user_id, search_query, query_embedding, filters_applied, entity_type, duration_ms, result_count, matched_density)
  VALUES
    -- A minor's searches are logged anonymously, with no query vector (Decision #208).
    (CASE WHEN org.fn_is_minor(p_user_id) THEN NULL ELSE p_user_id END, coalesce(p_query, ''),
     CASE WHEN org.fn_is_minor(p_user_id) THEN NULL ELSE p_query_embedding END,
     coalesce(p_filters, '{}'::jsonb), p_entity_type, p_duration_ms, p_result_count,
     CASE WHEN p_candidate_pool > 0 THEN round(p_result_count::numeric / p_candidate_pool, 4) ELSE NULL END);
$$;

-- -----------------------------------------------------------------------------
-- ADMIN: analytics on query timings, matching density, weight distribution.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_search_analytics(p_window_hours integer DEFAULT 168)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = search, public
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT search.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'window_hours', p_window_hours,
    'performance', (
      SELECT jsonb_build_object(
        'total_queries', count(*),
        'avg_duration_ms', round(avg(duration_ms), 2),
        'p95_duration_ms', percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms),
        'max_duration_ms', max(duration_ms),
        'avg_result_count', round(avg(result_count), 2),
        'avg_matched_density', round(avg(matched_density), 4)
      )
      FROM search.query_logs
      WHERE created_at > now() - make_interval(hours => p_window_hours)
    ),
    'by_entity_type', (
      SELECT coalesce(jsonb_object_agg(entity_type, cnt), '{}'::jsonb)
      FROM (SELECT coalesce(entity_type, 'all') entity_type, count(*) cnt
            FROM search.query_logs
            WHERE created_at > now() - make_interval(hours => p_window_hours)
            GROUP BY 1) t
    ),
    'top_queries', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('query', search_query, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
      FROM (SELECT search_query, count(*) cnt FROM search.query_logs
            WHERE created_at > now() - make_interval(hours => p_window_hours) AND search_query <> ''
            GROUP BY 1 ORDER BY cnt DESC LIMIT 10) t
    ),
    'weight_distribution', (
      SELECT jsonb_object_agg(scope, jsonb_build_object('factors', cnt, 'total_weight', tw))
      FROM (SELECT scope, count(*) cnt, round(sum(weight), 2) tw
            FROM search.search_weights WHERE is_active GROUP BY scope) t
    ),
    'index_density', jsonb_build_object(
      'profiles', (SELECT count(*) FROM search.profiles_index WHERE is_active),
      'services', (SELECT count(*) FROM search.services_index WHERE is_public),
      'projects', (SELECT count(*) FROM search.projects_index WHERE is_active)
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- -----------------------------------------------------------------------------
-- ADMIN: read + live-adjust weights.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_get_weights()
RETURNS SETOF search.search_weights
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = search, public AS $$
BEGIN
  IF NOT search.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM search.search_weights ORDER BY scope, key;
END;
$$;

CREATE OR REPLACE FUNCTION search.fn_set_weight(p_key text, p_weight numeric)
RETURNS search.search_weights
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = search, public AS $$
DECLARE row search.search_weights;
BEGIN
  IF NOT search.is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE search.search_weights
     SET weight = greatest(0, p_weight), updated_at = now(), updated_by = auth.uid()
   WHERE key = p_key
   RETURNING * INTO row;
  IF row IS NULL THEN
    RAISE EXCEPTION 'unknown weight key: %', p_key USING ERRCODE = '22023';
  END IF;
  RETURN row;
END;
$$;

-- =============================================================================
-- Discovery signals — the personalised Home feed and the catalogue's quality score
-- (PRODUCT_SPEC §Reputation & Discovery; packages/backend/services/explore/ranking.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ranking_weights — the scoring matrix's COEFFICIENTS, for the discovery catalogue.
-- The table stays admin-read (00002014): its rows also name who tuned them. This door
-- projects only what a reader of the ranking needs — the key, the weight, whether the
-- factor is on — and is a definer because the guest catalogue reads it as `anon`.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.ranking_weights()
RETURNS TABLE (key text, weight numeric, is_active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = search, public
AS $$
  SELECT w.key, w.weight, w.is_active FROM search.search_weights w ORDER BY w.key;
$$;

-- -----------------------------------------------------------------------------
-- trending_entities — what the marketplace is opening right now: per entity, the
-- distinct people who viewed it (org.recent_views) or saved it (org.user_bookmarks)
-- inside the window, a save counting double. AGGREGATES ONLY, and only past a floor
-- of three distinct people, so no row can be traced back to one person's history —
-- which is what lets it run as a definer for `anon` while both tables stay read-own.
-- The window is clamped to 1..30 days and the answer to 1..100 rows.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.trending_entities(
  p_days  integer DEFAULT 7,
  p_limit integer DEFAULT 24
)
RETURNS TABLE (entity_type text, entity_id uuid, people integer, score numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = org, public
AS $$
  WITH win AS (
    SELECT now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30)) AS since
  ),
  signals AS (
    SELECT rv.user_id, rv.entity_type, rv.entity_id, 1.0 AS weight
      FROM org.recent_views rv, win
     WHERE rv.viewed_at >= win.since
    UNION ALL
    SELECT ub.user_id, ub.entity_type::text, ub.entity_id, 2.0
      FROM org.user_bookmarks ub, win
     WHERE ub.created_at >= win.since
  )
  SELECT s.entity_type, s.entity_id, count(DISTINCT s.user_id)::integer, sum(s.weight)
    FROM signals s
   GROUP BY s.entity_type, s.entity_id
  HAVING count(DISTINCT s.user_id) >= 3
   ORDER BY sum(s.weight) DESC, count(DISTINCT s.user_id) DESC, s.entity_id
   LIMIT least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

-- -----------------------------------------------------------------------------
-- record_view — the SIGNED-IN caller opened a discovery item: move it to the top of
-- their history and lean their affinity toward its topics.
--
-- The only writer of org.recent_views (00002520 revokes the client's INSERT/UPDATE),
-- because it stamps the times itself: a client-written `viewed_at` in the future
-- would hold an item inside the Trending window forever. The person is auth.uid(),
-- never a parameter, so nobody records a view as somebody else. The discovery service
-- resolves the entity from the PUBLISHED catalogue before calling, so the id names a
-- live listing or profile; a direct call can only ever add to the caller's own rows.
--
-- Affinity (search.user_affinity, one row per topic) decays with a 14-day half-life
-- before each +1, so last month's browsing fades instead of outvoting this week's —
-- the reader applies the same decay. At most eight topics of 60 characters count.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.record_view(
  p_entity_type text,
  p_entity_id   uuid,
  p_topics      text[] DEFAULT '{}'::text[]
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = org, search, public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_topic text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'record_view: sign in to keep a viewing history' USING ERRCODE = '42501';
  END IF;
  -- No behavioural profile of a minor (UK Children's Code, Decision #208): nothing is recorded.
  IF org.fn_is_minor(v_user) THEN
    RETURN;
  END IF;

  INSERT INTO org.recent_views (user_id, entity_type, entity_id)
  VALUES (v_user, p_entity_type, p_entity_id)
  ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE
     SET viewed_at = now(), view_count = org.recent_views.view_count + 1;

  FOR v_topic IN
    SELECT DISTINCT left(lower(btrim(t)), 60)
      FROM unnest(coalesce(p_topics, '{}'::text[])) AS t
     WHERE btrim(t) <> ''
     LIMIT 8
  LOOP
    INSERT INTO search.user_affinity (user_id, category_slug, affinity_score, updated_at)
    VALUES (v_user, v_topic, 1, now())
    ON CONFLICT (user_id, category_slug) DO UPDATE
       SET affinity_score = search.user_affinity.affinity_score
             * power(0.5, extract(epoch FROM now() - coalesce(search.user_affinity.updated_at, now())) / 1209600.0)
             + 1,
           updated_at = now();
  END LOOP;
END;
$$;

-- =============================================================================
-- Embeddings — voyage-4, 1024 dimensions, unit length (Decision #179). Inner
-- product therefore ranks exactly as cosine similarity; the HNSW indexes use
-- vector_ip_ops (00004004). Vectors are written by fn_set_embedding alone and
-- leave the database only as ids + scores.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fn_set_embedding — store one entity's vector, the model that made it and the
-- hash of the text it was made from (so an unchanged text is never re-embedded).
-- service_role only (00002510). FALSE when the entity has no index row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_set_embedding(
  p_entity_type text,
  p_entity_id   uuid,
  p_embedding   public.vector(1024),
  p_model       text,
  p_hash        text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = search, public
AS $$
BEGIN
  IF p_embedding IS NULL OR public.vector_dims(p_embedding) <> 1024 THEN
    RAISE EXCEPTION 'fn_set_embedding: a 1024-dimension vector is required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_model), '') = '' OR coalesce(btrim(p_hash), '') = '' THEN
    RAISE EXCEPTION 'fn_set_embedding: the model and the text hash are required' USING ERRCODE = '22023';
  END IF;

  CASE p_entity_type
    WHEN 'service_blueprint' THEN
      UPDATE search.services_index
         SET embedding = p_embedding, embedding_model = p_model, embedding_hash = p_hash, embedded_at = now()
       WHERE service_id = p_entity_id;
    WHEN 'project' THEN
      UPDATE search.projects_index
         SET embedding = p_embedding, embedding_model = p_model, embedding_hash = p_hash, embedded_at = now()
       WHERE project_id = p_entity_id;
    WHEN 'user', 'freelancer', 'team', 'business' THEN
      UPDATE search.profiles_index
         SET embedding = p_embedding, embedding_model = p_model, embedding_hash = p_hash, embedded_at = now()
       WHERE entity_id = p_entity_id AND entity_type = p_entity_type::search.profile_entity_type;
    WHEN 'product', 'article' THEN
      UPDATE search.catalogue_index
         SET embedding = p_embedding, embedding_model = p_model, embedding_hash = p_hash, embedded_at = now()
       WHERE entity_type = p_entity_type AND entity_id = p_entity_id;
    ELSE
      RAISE EXCEPTION 'fn_set_embedding: unknown entity type %', p_entity_type USING ERRCODE = '22023';
  END CASE;
  RETURN FOUND;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_nearest — the public rows closest to p_embedding, best first, as
-- (entity_type, entity_id, score = cosine similarity). Visibility is each index's
-- own public rule — the USING clause of its anon SELECT policy (00002014) — so it
-- answers nothing anon could not already read, and never a vector. p_types NULL =
-- every type (the discovery vocabulary: service_blueprint · product · article ·
-- project · user · freelancer · team · business); p_limit is clamped to 1..100.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_nearest(
  p_embedding public.vector(1024),
  p_types     text[]  DEFAULT NULL,
  p_exclude   uuid[]  DEFAULT '{}'::uuid[],
  p_limit     integer DEFAULT 24
)
RETURNS TABLE (entity_type text, entity_id uuid, score double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = search, public
AS $$
  SELECT n.entity_type, n.entity_id, n.score
    FROM (
      (SELECT 'service_blueprint'::text AS entity_type, si.service_id AS entity_id,
              -(si.embedding <#> p_embedding) AS score
         FROM search.services_index si
        WHERE p_embedding IS NOT NULL AND si.is_public AND si.embedding IS NOT NULL
          AND (p_types IS NULL OR 'service_blueprint' = ANY (p_types))
          AND si.service_id <> ALL (coalesce(p_exclude, '{}'::uuid[]))
        ORDER BY si.embedding <#> p_embedding
        LIMIT least(greatest(coalesce(p_limit, 24), 1), 100))
      UNION ALL
      (SELECT 'project'::text, pr.project_id, -(pr.embedding <#> p_embedding)
         FROM search.projects_index pr
        WHERE p_embedding IS NOT NULL AND pr.is_active AND pr.embedding IS NOT NULL
          AND (p_types IS NULL OR 'project' = ANY (p_types))
          AND pr.project_id <> ALL (coalesce(p_exclude, '{}'::uuid[]))
        ORDER BY pr.embedding <#> p_embedding
        LIMIT least(greatest(coalesce(p_limit, 24), 1), 100))
      UNION ALL
      (SELECT pi.entity_type::text, pi.entity_id, -(pi.embedding <#> p_embedding)
         FROM search.profiles_index pi
        WHERE p_embedding IS NOT NULL AND pi.is_active AND pi.embedding IS NOT NULL
          AND (p_types IS NULL OR pi.entity_type::text = ANY (p_types))
          AND pi.entity_id <> ALL (coalesce(p_exclude, '{}'::uuid[]))
        ORDER BY pi.embedding <#> p_embedding
        LIMIT least(greatest(coalesce(p_limit, 24), 1), 100))
      UNION ALL
      (SELECT ci.entity_type, ci.entity_id, -(ci.embedding <#> p_embedding)
         FROM search.catalogue_index ci
        WHERE p_embedding IS NOT NULL AND ci.is_public AND ci.embedding IS NOT NULL
          AND (p_types IS NULL OR ci.entity_type = ANY (p_types))
          AND ci.entity_id <> ALL (coalesce(p_exclude, '{}'::uuid[]))
        ORDER BY ci.embedding <#> p_embedding
        LIMIT least(greatest(coalesce(p_limit, 24), 1), 100))
    ) n
   ORDER BY n.score DESC, n.entity_type, n.entity_id
   LIMIT least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

-- -----------------------------------------------------------------------------
-- fn_nearest_to_entity — fn_nearest seeded with one PUBLIC entity's stored vector
-- (a /view page's "Similar" rail). The vector is read here, inside the database, so
-- it never crosses the wire and the server needs no service-role read on a public
-- page (Decision #178(b)). The entity itself is always excluded; empty when it is
-- not public or has no vector yet.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_nearest_to_entity(
  p_entity_type text,
  p_entity_id   uuid,
  p_types       text[]  DEFAULT NULL,
  p_exclude     uuid[]  DEFAULT '{}'::uuid[],
  p_limit       integer DEFAULT 24
)
RETURNS TABLE (entity_type text, entity_id uuid, score double precision)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = search, public
AS $$
  WITH source AS (
    SELECT CASE
      WHEN p_entity_type = 'service_blueprint' THEN
        (SELECT si.embedding FROM search.services_index si
          WHERE si.service_id = p_entity_id AND si.is_public)
      WHEN p_entity_type = 'project' THEN
        (SELECT pr.embedding FROM search.projects_index pr
          WHERE pr.project_id = p_entity_id AND pr.is_active)
      WHEN p_entity_type IN ('user', 'freelancer', 'team', 'business') THEN
        (SELECT pi.embedding FROM search.profiles_index pi
          WHERE pi.entity_id = p_entity_id AND pi.entity_type::text = p_entity_type AND pi.is_active)
      WHEN p_entity_type IN ('product', 'article') THEN
        (SELECT ci.embedding FROM search.catalogue_index ci
          WHERE ci.entity_type = p_entity_type AND ci.entity_id = p_entity_id AND ci.is_public)
    END AS v
  )
  SELECT n.entity_type, n.entity_id, n.score
    FROM source
   CROSS JOIN LATERAL search.fn_nearest(
     source.v, p_types, array_append(coalesce(p_exclude, '{}'::uuid[]), p_entity_id), p_limit
   ) n
   WHERE source.v IS NOT NULL
   ORDER BY n.score DESC, n.entity_type, n.entity_id;
$$;

-- #region Profiling off for under-18 accounts (Decision #208)
-- `search.interest_events` is written directly under RLS (InterestBackendService), so a minor's
-- impressions, clicks and searches are dropped here rather than refused — the page never notices.
CREATE OR REPLACE FUNCTION search.trg_interest_events_minor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.user_id IS NOT NULL AND org.fn_is_minor(NEW.user_id) THEN
        RETURN NULL;
    END IF;
    RETURN NEW;
END;
$$;
-- #endregion
