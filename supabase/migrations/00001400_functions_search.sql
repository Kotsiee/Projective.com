-- ============================================================================
-- 00001400 functions search
-- Consolidated verbatim from: 0010_search_tables.sql, 0217_search_engine_pgvector.sql, 0219_search_engine_weights.sql, 0220_search_engine_rpc.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION search.sync_team_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata, 
        rating_average, rating_count, current_workload_intensity, available_since, is_active, updated_at
    )
    VALUES (
        NEW.id, 'team', NEW.slug, to_tsvector('english', coalesce(NEW.slug, '')),
        jsonb_build_object('payout_model', NEW.payout_model),
        NEW.rating_average, NEW.rating_count, NEW.current_workload_intensity, NEW.available_since, true, now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        display_name = EXCLUDED.display_name, fts = EXCLUDED.fts,
        metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        current_workload_intensity = EXCLUDED.current_workload_intensity,
        available_since = EXCLUDED.available_since,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search.sync_freelancer_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata, 
        rating_average, rating_count, current_workload_intensity, available_since, updated_at
    )
    VALUES (
        NEW.user_id, 'freelancer', 'Freelancer Profile', to_tsvector('english', array_to_string(NEW.skills, ' ')),
        jsonb_build_object('skills', NEW.skills),
        NEW.rating_average, NEW.rating_count, NEW.current_workload_intensity, NEW.available_since, now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        fts = EXCLUDED.fts, metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        current_workload_intensity = EXCLUDED.current_workload_intensity,
        available_since = EXCLUDED.available_since,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search.sync_project_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.projects_index (project_id, title, fts, industry_category_id, status, target_start_date, is_active, updated_at)
    VALUES (
        NEW.id, NEW.title, to_tsvector('english', NEW.status::text || ' ' || NEW.title),
        NEW.industry_category_id, NEW.status::text, NEW.target_project_start_date,
        CASE WHEN NEW.visibility = 'public' AND NEW.status != 'draft' THEN true ELSE false END, now()
    )
    ON CONFLICT (project_id) DO UPDATE SET
        title = EXCLUDED.title, fts = EXCLUDED.fts,
        industry_category_id = EXCLUDED.industry_category_id,
        status = EXCLUDED.status, target_start_date = EXCLUDED.target_start_date, 
        is_active = EXCLUDED.is_active, updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search.sync_business_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.profiles_index (
        entity_id, entity_type, display_name, fts, metadata, 
        rating_average, rating_count, updated_at
    )
    VALUES (
        NEW.id, 'business', NEW.name, to_tsvector('english', coalesce(NEW.name, '')),
        jsonb_build_object('plan', NEW.plan),
        NEW.rating_average, NEW.rating_count, now()
    )
    ON CONFLICT (entity_id, entity_type) DO UPDATE SET
        display_name = EXCLUDED.display_name, fts = EXCLUDED.fts,
        metadata = search.profiles_index.metadata || EXCLUDED.metadata,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION search.sync_service_to_index() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO search.services_index (
        service_id, title, fts, is_public, 
        rating_average, rating_count, updated_at
    )
    VALUES (
        NEW.id, NEW.title, to_tsvector('english', NEW.title || ' ' || coalesce(NEW.description_text, '')),
        NEW.is_published, NEW.rating_average, NEW.rating_count, now()
    )
    ON CONFLICT (service_id) DO UPDATE SET
        title = EXCLUDED.title, fts = EXCLUDED.fts, is_public = EXCLUDED.is_public,
        rating_average = EXCLUDED.rating_average, rating_count = EXCLUDED.rating_count,
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Deterministic mock embedding: a stable pseudo-random vector(1536) derived from
-- a text seed. Deterministic (IMMUTABLE) so the same entity/query always yields
-- the same vector — cosine distance is therefore stable and reproducible in tests.
-- Each component ∈ [-1, 1) via a 64-bit hash of (seed, dimension_index).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_mock_embedding(p_seed text)
RETURNS public.vector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT (
    '[' || string_agg(
      to_char(
        ((hashtextextended(coalesce(p_seed, 'discovery'), g) & 65535)::double precision / 32768.0) - 1.0,
        'FM990.000000'
      ),
      ','
    ) || ']'
  )::public.vector
  FROM generate_series(1, 1536) AS g;
$$;

COMMENT ON FUNCTION search.fn_mock_embedding(text) IS
  'Deterministic mock vector(1536) seeded from text. Placeholder until a real embedding model is wired in.';

-- -----------------------------------------------------------------------------
-- Generic BEFORE INSERT/UPDATE trigger that fills a NULL embedding using the
-- table''s text seed column. TG_ARGV[0]/[1] name the primary + fallback seed
-- columns; `to_jsonb(NEW) ->> col` avoids statically referencing columns that
-- don''t exist on every index table.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_fill_mock_embedding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_seed text;
BEGIN
  IF NEW.embedding IS NULL THEN
    v_seed := coalesce(v_row ->> TG_ARGV[0], v_row ->> TG_ARGV[1], gen_random_uuid()::text);
    NEW.embedding := search.fn_mock_embedding(v_seed);
  END IF;
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
-- the ranking RPC reads this table on every call.
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
-- fn_search_entities — single-entity ranked search (filters + sort UNLOCKED).
-- Returns a uniform row shape across services / profiles / projects so the API
-- can map straight to PartialEntityResponse, plus per-row score + breakdown.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_search_entities(
  p_entity_type text,
  p_query       text    DEFAULT '',
  p_filters     jsonb   DEFAULT '{}'::jsonb,
  p_sort        text    DEFAULT 'recommended',
  p_limit       integer DEFAULT 24,
  p_offset      integer DEFAULT 0,
  p_user_id     uuid    DEFAULT auth.uid()
)
RETURNS TABLE (
  id uuid, entity_type text, title text, subtitle text, description text,
  owner_id uuid, owner_name text, owner_type text,
  rating_average numeric, rating_count integer, price_cents bigint,
  location text, availability text, tags text[],
  is_sponsored boolean, score numeric, score_breakdown jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = search, public, org, projects, marketplace, security, reviews
AS $$
DECLARE
  w        jsonb;
  q        text := coalesce(trim(p_query), '');
  tsq      tsquery := CASE WHEN q = '' THEN NULL ELSE websearch_to_tsquery('english', q) END;
  emb      public.vector := search.fn_mock_embedding(CASE WHEN q = '' THEN 'discovery' ELSE q END);
  cat      text := lower(coalesce(p_entity_type, 'all'));
  v_types  search.profile_entity_type[];
  f_rating numeric := coalesce((p_filters->>'min_rating')::numeric, 0);
  f_bmin   bigint  := coalesce((p_filters->>'budget_min_cents')::bigint, 0);
  f_bmax   bigint  := coalesce((p_filters->>'budget_max_cents')::bigint, 9223372036854775807);
  f_avail  text    := nullif(p_filters->>'availability', '');
  f_skills text[]  := CASE WHEN p_filters ? 'skills'
                        THEN ARRAY(SELECT jsonb_array_elements_text(p_filters->'skills')) END;
BEGIN
  SELECT jsonb_object_agg(key, weight) INTO w
  FROM search.search_weights WHERE is_active;

  -- ==========================================================================
  -- SERVICES
  -- ==========================================================================
  IF cat IN ('service', 'services') THEN
    RETURN QUERY
    SELECT
      si.service_id,
      'service'::text,
      si.title,
      sb.pricing_model::text,
      left(sb.description_text, 260),
      sb.freelancer_profile_id,
      coalesce(nullif(trim(u.first_name || ' ' || coalesce(u.last_name, '')), ''), u.username, 'Freelancer'),
      'freelancer'::text,
      si.rating_average, si.rating_count, sb.price_cents,
      u.country, NULL::text,
      ARRAY(SELECT jsonb_array_elements_text(coalesce(pi.metadata->'skills', '[]'::jsonb)))::text[],
      false,
      score.total,
      score.breakdown
    FROM search.services_index si
    JOIN marketplace.service_blueprints sb ON sb.id = si.service_id
    LEFT JOIN org.users_public u ON u.user_id = sb.freelancer_profile_id
    LEFT JOIN search.profiles_index pi ON pi.entity_id = sb.freelancer_profile_id AND pi.entity_type = 'freelancer'
    CROSS JOIN LATERAL (
      SELECT (SELECT count(*) FROM search.interest_events ie
              WHERE ie.entity_id = si.service_id AND ie.entity_type = 'service') AS pop
    ) sig
    CROSS JOIN LATERAL (
      SELECT
        (w->>'text_relevance')::numeric   * (CASE WHEN q = '' THEN 0.5 ELSE search.fn_norm(ts_rank(si.fts, tsq) * 10, 1) END) AS c_text,
        (w->>'vector_similarity')::numeric* greatest(0, 1 - (si.embedding <=> emb))::numeric                                          AS c_vec,
        (w->>'query_interest')::numeric   * (CASE WHEN q <> '' AND si.title ILIKE '%' || q || '%' THEN 1 ELSE 0 END)         AS c_qi,
        (w->>'review_sentiment')::numeric * search.fn_norm(si.rating_average, 5)                                             AS c_rev,
        (w->>'review_count')::numeric     * search.fn_norm(si.rating_count, 50)                                              AS c_rc,
        (w->>'interest_history')::numeric * search.fn_norm(sig.pop, 10)                                                      AS c_int,
        (w->>'price_tier')::numeric       * (1 - search.fn_norm(sb.price_cents, 2000000))                                    AS c_price,
        (w->>'open_seats')::numeric       * search.fn_norm(sb.max_seats_per_cohort, 20)                                      AS c_seats
    ) comp
    CROSS JOIN LATERAL (
      SELECT
        round(comp.c_text + comp.c_vec + comp.c_qi + comp.c_rev + comp.c_rc + comp.c_int + comp.c_price + comp.c_seats, 4) AS total,
        jsonb_build_object(
          'text_relevance', round(comp.c_text,3), 'vector_similarity', round(comp.c_vec,3),
          'query_interest', round(comp.c_qi,3), 'review_sentiment', round(comp.c_rev,3),
          'review_count', round(comp.c_rc,3), 'interest_history', round(comp.c_int,3),
          'price_tier', round(comp.c_price,3), 'open_seats', round(comp.c_seats,3)
        ) AS breakdown
    ) score
    WHERE si.is_public
      AND (q = '' OR si.fts @@ tsq OR si.title ILIKE '%' || q || '%')
      AND si.rating_average >= f_rating
      AND sb.price_cents BETWEEN f_bmin AND f_bmax
    ORDER BY
      CASE WHEN p_sort = 'rating'     THEN si.rating_average END DESC NULLS LAST,
      CASE WHEN p_sort = 'recent'     THEN si.updated_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'price'      THEN sb.price_cents END ASC NULLS LAST,
      CASE WHEN p_sort = 'popularity' THEN si.rating_count END DESC NULLS LAST,
      score.total DESC
    LIMIT p_limit OFFSET p_offset;

  -- ==========================================================================
  -- PROJECTS
  -- ==========================================================================
  ELSIF cat IN ('project', 'projects') THEN
    RETURN QUERY
    SELECT
      pri.project_id,
      'project'::text,
      pri.title,
      p.status::text,
      left(p.description_text, 260),
      p.owner_user_id,
      coalesce(b.name, nullif(trim(u.first_name || ' ' || coalesce(u.last_name, '')), ''), u.username, 'Client'),
      CASE WHEN p.client_business_id IS NOT NULL THEN 'business' ELSE 'user' END,
      0::numeric, 0,
      agg.budget_max::bigint,
      NULLIF(array_to_string(p.location_restriction, ', '), ''),
      NULL::text,
      agg.skills,
      false,
      score.total,
      score.breakdown
    FROM search.projects_index pri
    JOIN projects.projects p ON p.id = pri.project_id
    LEFT JOIN org.business_profiles b ON b.id = p.client_business_id
    LEFT JOIN org.users_public u ON u.user_id = p.owner_user_id
    CROSS JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE true)                       AS stage_count,
        coalesce(sum(ps.unit_price_cents), 0)              AS budget_max,
        coalesce(count(*) FILTER (WHERE ps.status = 'open'), 0) AS open_stages,
        coalesce((SELECT array_agg(DISTINCT x) FROM projects.project_stages ps2
                  CROSS JOIN LATERAL unnest(coalesce(ps2.skills, '{}'::text[])) x
                  WHERE ps2.project_id = p.id), '{}'::text[]) AS skills
      FROM projects.project_stages ps WHERE ps.project_id = p.id
    ) agg
    CROSS JOIN LATERAL (
      SELECT (SELECT count(*) FROM search.interest_events ie
              WHERE ie.entity_id = pri.project_id AND ie.entity_type = 'project') AS pop
    ) sig
    CROSS JOIN LATERAL (
      SELECT
        (w->>'text_relevance')::numeric   * (CASE WHEN q = '' THEN 0.5 ELSE search.fn_norm(ts_rank(pri.fts, tsq) * 10, 1) END) AS c_text,
        (w->>'vector_similarity')::numeric* greatest(0, 1 - (pri.embedding <=> emb))::numeric                                           AS c_vec,
        (w->>'query_interest')::numeric   * (CASE WHEN q <> '' AND (pri.title ILIKE '%' || q || '%' OR agg.skills && ARRAY[q]) THEN 1 ELSE 0 END) AS c_qi,
        (w->>'review_sentiment')::numeric * 0                                                                          AS c_rev,
        (w->>'interest_history')::numeric * search.fn_norm(sig.pop, 10)                                                        AS c_int,
        (w->>'open_seats')::numeric       * search.fn_norm(agg.open_stages, 6)                                                 AS c_seats,
        (w->>'stage_count')::numeric      * search.fn_norm(agg.stage_count, 8)                                                 AS c_stage,
        (w->>'budget_range')::numeric     * search.fn_norm(agg.budget_max, 15000000)                                           AS c_budget
    ) comp
    CROSS JOIN LATERAL (
      SELECT
        round(comp.c_text + comp.c_vec + comp.c_qi + comp.c_rev + comp.c_int + comp.c_seats + comp.c_stage + comp.c_budget, 4) AS total,
        jsonb_build_object(
          'text_relevance', round(comp.c_text,3), 'vector_similarity', round(comp.c_vec,3),
          'query_interest', round(comp.c_qi,3), 'review_sentiment', round(comp.c_rev,3),
          'interest_history', round(comp.c_int,3), 'open_seats', round(comp.c_seats,3),
          'stage_count', round(comp.c_stage,3), 'budget_range', round(comp.c_budget,3)
        ) AS breakdown
    ) score
    WHERE pri.is_active
      AND (q = '' OR pri.fts @@ tsq OR pri.title ILIKE '%' || q || '%')
      AND (f_skills IS NULL OR agg.skills && f_skills)
      AND agg.budget_max BETWEEN f_bmin AND f_bmax
    ORDER BY
      CASE WHEN p_sort = 'recent'     THEN pri.updated_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'price'      THEN agg.budget_max END ASC NULLS LAST,
      CASE WHEN p_sort = 'popularity' THEN sig.pop END DESC NULLS LAST,
      score.total DESC
    LIMIT p_limit OFFSET p_offset;

  -- ==========================================================================
  -- PROFILES (freelancers / teams / businesses)
  -- ==========================================================================
  ELSE
    v_types := CASE
      WHEN cat IN ('team', 'teams')            THEN ARRAY['team']::search.profile_entity_type[]
      WHEN cat IN ('business', 'businesses')   THEN ARRAY['business']::search.profile_entity_type[]
      WHEN cat IN ('freelancer', 'person', 'people', 'user', 'users') THEN ARRAY['freelancer']::search.profile_entity_type[]
      ELSE ARRAY['freelancer','team','business']::search.profile_entity_type[]
    END;

    RETURN QUERY
    SELECT
      pi.entity_id,
      pi.entity_type::text,
      coalesce(b.name, t.name, nullif(trim(u.first_name || ' ' || coalesce(u.last_name, '')), ''), u.username, 'Profile'),
      coalesce(pi.headline, b.headline, t.headline),
      NULL::text,
      pi.entity_id,
      coalesce(b.name, t.name, nullif(trim(u.first_name || ' ' || coalesce(u.last_name, '')), ''), u.username),
      pi.entity_type::text,
      pi.rating_average, pi.rating_count,
      svc.min_price,
      coalesce(u.country, b.country),
      fp.availability_status,
      coalesce(fp.skills, ARRAY(SELECT jsonb_array_elements_text(coalesce(pi.metadata->'skills','[]'::jsonb)))::text[]),
      false,
      score.total,
      score.breakdown
    FROM search.profiles_index pi
    LEFT JOIN org.users_public u        ON u.user_id = pi.entity_id AND pi.entity_type = 'freelancer'
    LEFT JOIN org.freelancer_profiles fp ON fp.user_id = pi.entity_id AND pi.entity_type = 'freelancer'
    LEFT JOIN org.teams t               ON t.id = pi.entity_id AND pi.entity_type = 'team'
    LEFT JOIN org.business_profiles b    ON b.id = pi.entity_id AND pi.entity_type = 'business'
    LEFT JOIN search.talent_signals ts   ON ts.entity_id = pi.entity_id AND ts.entity_type = pi.entity_type
    LEFT JOIN LATERAL (
      SELECT min(sb.price_cents) AS min_price FROM marketplace.service_blueprints sb
      WHERE sb.freelancer_profile_id = pi.entity_id AND sb.is_published
    ) svc ON true
    CROSS JOIN LATERAL (
      SELECT (SELECT count(*) FROM search.interest_events ie
              WHERE ie.entity_id = pi.entity_id) AS pop
    ) sig
    CROSS JOIN LATERAL (
      SELECT
        (w->>'text_relevance')::numeric   * (CASE WHEN q = '' THEN 0.5 ELSE search.fn_norm(ts_rank(pi.fts, tsq) * 10, 1) END) AS c_text,
        (w->>'vector_similarity')::numeric* greatest(0, 1 - (pi.embedding <=> emb))::numeric                                           AS c_vec,
        (w->>'query_interest')::numeric   * (CASE WHEN q <> '' AND coalesce(fp.skills,'{}') && ARRAY[q] THEN 1 ELSE 0 END)     AS c_qi,
        (w->>'verification')::numeric     * (CASE WHEN coalesce(ts.is_verified,false) THEN 1 ELSE 0 END)                       AS c_ver,
        (w->>'review_sentiment')::numeric * search.fn_norm(pi.rating_average, 5)                                              AS c_rev,
        (w->>'review_count')::numeric     * search.fn_norm(pi.rating_count, 50)                                               AS c_rc,
        (w->>'interest_history')::numeric * search.fn_norm(sig.pop, 10)                                                       AS c_int,
        (w->>'language_match')::numeric   * (CASE WHEN coalesce(array_length(u.languages,1),0) > 0 THEN 0.5 ELSE 0 END)       AS c_lang,
        (w->>'penalty')::numeric          * (-search.fn_norm(pi.discovery_penalty, 10))                                       AS c_pen,
        (w->>'workload')::numeric         * (1 - search.fn_norm(pi.current_workload_intensity, 100))                          AS c_wl,
        (w->>'idle_time')::numeric        * (CASE WHEN ts.low_workload_since IS NOT NULL
                                              THEN search.fn_norm(extract(epoch FROM now()-ts.low_workload_since), 2592000) ELSE 0 END) AS c_idle,
        (w->>'response_time')::numeric    * greatest(0, 1 - search.fn_norm(coalesce(ts.response_time_hours,24), 72))          AS c_resp,
        (w->>'member_count')::numeric     * search.fn_norm(coalesce(ts.member_count,1), 20)                                   AS c_mem,
        (w->>'rating_freelancer')::numeric* search.fn_norm(coalesce(ts.rating_as_freelancer, pi.rating_average), 5)           AS c_rf
    ) comp
    CROSS JOIN LATERAL (
      SELECT
        round(comp.c_text + comp.c_vec + comp.c_qi + comp.c_ver + comp.c_rev + comp.c_rc + comp.c_int
              + comp.c_lang + comp.c_pen + comp.c_wl + comp.c_idle + comp.c_resp + comp.c_mem + comp.c_rf, 4) AS total,
        jsonb_build_object(
          'text_relevance', round(comp.c_text,3), 'vector_similarity', round(comp.c_vec,3),
          'query_interest', round(comp.c_qi,3), 'verification', round(comp.c_ver,3),
          'review_sentiment', round(comp.c_rev,3), 'review_count', round(comp.c_rc,3),
          'interest_history', round(comp.c_int,3), 'penalty', round(comp.c_pen,3),
          'workload', round(comp.c_wl,3), 'idle_time', round(comp.c_idle,3),
          'response_time', round(comp.c_resp,3), 'member_count', round(comp.c_mem,3),
          'rating_freelancer', round(comp.c_rf,3)
        ) AS breakdown
    ) score
    WHERE pi.is_active
      AND pi.entity_type = ANY(v_types)
      AND (q = '' OR pi.fts @@ tsq OR pi.display_name ILIKE '%' || q || '%'
           OR coalesce(u.first_name || ' ' || u.last_name, '') ILIKE '%' || q || '%')
      AND pi.rating_average >= f_rating
      AND (f_avail IS NULL OR fp.availability_status = f_avail)
      AND (f_skills IS NULL OR coalesce(fp.skills,'{}') && f_skills)
    ORDER BY
      CASE WHEN p_sort = 'rating'     THEN pi.rating_average END DESC NULLS LAST,
      CASE WHEN p_sort = 'recent'     THEN pi.updated_at END DESC NULLS LAST,
      CASE WHEN p_sort = 'price'      THEN svc.min_price END ASC NULLS LAST,
      CASE WHEN p_sort = 'popularity' THEN pi.rating_count END DESC NULLS LAST,
      score.total DESC
    LIMIT p_limit OFFSET p_offset;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_search_global — federated multi-entity view. Sorting/filtering are DISABLED
-- here by contract: it returns fixed top-N buckets (recommended carousel +
-- services + profiles + projects), each ranked by the recommended score.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_search_global(
  p_query   text    DEFAULT '',
  p_user_id uuid    DEFAULT auth.uid(),
  p_limit   integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = search, public
AS $$
DECLARE
  services jsonb;
  profiles jsonb;
  projects jsonb;
  recommended jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO services
  FROM search.fn_search_entities('services', p_query, '{}'::jsonb, 'recommended', p_limit, 0, p_user_id) r;

  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO profiles
  FROM search.fn_search_entities('profiles', p_query, '{}'::jsonb, 'recommended', p_limit, 0, p_user_id) r;

  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO projects
  FROM search.fn_search_entities('projects', p_query, '{}'::jsonb, 'recommended', p_limit, 0, p_user_id) r;

  -- Recommended = the highest-scoring rows across every bucket.
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'score')::numeric DESC), '[]'::jsonb) INTO recommended
  FROM (
    SELECT x FROM jsonb_array_elements(services || profiles || projects) x
    ORDER BY (x->>'score')::numeric DESC
    LIMIT p_limit
  ) top;

  RETURN jsonb_build_object(
    'recommended', recommended,
    'services',    services,
    'profiles',    profiles,
    'projects',    projects
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- fn_log_query — write search execution telemetry (guest-safe).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search.fn_log_query(
  p_query       text,
  p_entity_type text,
  p_filters     jsonb,
  p_result_count integer,
  p_duration_ms  integer,
  p_candidate_pool integer DEFAULT NULL,
  p_user_id     uuid DEFAULT auth.uid()
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = search, public
AS $$
  INSERT INTO search.query_logs
    (user_id, search_query, query_embedding, filters_applied, entity_type, duration_ms, result_count, matched_density)
  VALUES
    (p_user_id, coalesce(p_query, ''), search.fn_mock_embedding(coalesce(p_query, 'discovery')),
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
