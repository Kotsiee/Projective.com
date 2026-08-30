-- =============================================================================================
-- 06_search.sql — project the seeded rows into the discovery indexes.
--
-- Adapted from the retired `supabase/populate/populate-search.sql`. Not generated: every statement
-- here is a SELECT over tables the earlier files created, so it carries no corpus data of its own and
-- stays correct however the fixtures change.
--
-- ---------------------------------------------------------------------------------------------
-- TWO BUGS IN THE ORIGINAL, FIXED HERE
-- ---------------------------------------------------------------------------------------------
--  1. It indexed `org.portfolios.id` into `search.services_index`. That column is
--     `REFERENCES marketplace.service_blueprints (id)`, so every row either violated the foreign key
--     or — because the seed created no portfolios — silently inserted nothing at all. This indexes
--     the service blueprints the FK actually names.
--
--  2. It wrote the LITERAL strings 'Project Title' and 'Service/Portfolio' into the `title` column,
--     and `to_tsvector('english', 'service')` into `fts`. Every project in search results would have
--     been called "Project Title", and every service would have matched the single word "service" and
--     nothing else — a search index that cannot find anything by its name. Both now read the real
--     title, and the tsvector is built from the title plus the description text.
--
-- The rest of the file keeps the original's shape, including ON CONFLICT DO NOTHING throughout, so a
-- re-run is a no-op rather than a primary-key collision.
-- =============================================================================================

BEGIN;

-- #region Profiles: users, freelancers, teams, businesses
INSERT INTO search.profiles_index (entity_id, entity_type, display_name, headline, fts, metadata, is_active, updated_at)
SELECT
    user_id,
    'user',
    trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')),
    headline,
    to_tsvector('english',
        coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
        coalesce(headline, '') || ' ' || coalesce(username, '')),
    jsonb_build_object('username', username),
    visibility = 'public',
    now()
FROM org.users_public
ON CONFLICT (entity_id, entity_type) DO NOTHING;

INSERT INTO search.profiles_index (entity_id, entity_type, display_name, fts, metadata, is_active, updated_at)
SELECT
    fp.user_id,
    'freelancer',
    -- The person's own name, not a placeholder: this string is what a discovery result prints.
    trim(coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')),
    to_tsvector('english',
        coalesce(array_to_string(fp.skills, ' '), '') || ' ' ||
        coalesce(up.first_name, '') || ' ' || coalesce(up.last_name, '')),
    jsonb_build_object('skills', fp.skills, 'availability', fp.availability_status),
    true,
    now()
FROM org.freelancer_profiles fp
JOIN org.users_public up ON up.user_id = fp.user_id
ON CONFLICT (entity_id, entity_type) DO NOTHING;

INSERT INTO search.profiles_index (entity_id, entity_type, display_name, headline, fts, metadata, is_active, updated_at)
SELECT
    id,
    'team',
    name,
    headline,
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(headline, '') || ' ' || coalesce(slug, '')),
    jsonb_build_object('payout_model', payout_model, 'slug', slug),
    status = 'active',
    now()
FROM org.teams
ON CONFLICT (entity_id, entity_type) DO NOTHING;

INSERT INTO search.profiles_index (entity_id, entity_type, display_name, headline, fts, metadata, is_active, updated_at)
SELECT
    id,
    'business',
    name,
    headline,
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(headline, '') || ' ' || coalesce(slug, '')),
    jsonb_build_object('plan', plan, 'slug', slug),
    status = 'active',
    now()
FROM org.business_profiles
ON CONFLICT (entity_id, entity_type) DO NOTHING;
-- #endregion

-- #region Projects
INSERT INTO search.projects_index (project_id, title, fts, industry_category_id, status, target_start_date, is_active, updated_at)
SELECT
    id,
    title,
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description_text, '')),
    industry_category_id,
    status::text,
    target_project_start_date,
    visibility = 'public' AND status <> 'draft',
    now()
FROM projects.projects
ON CONFLICT (project_id) DO NOTHING;
-- #endregion

-- #region Services
-- service_id REFERENCES marketplace.service_blueprints (id) — see the header note.
INSERT INTO search.services_index (service_id, title, fts, is_public, rating_average, rating_count, updated_at)
SELECT
    id,
    title,
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description_text, '')),
    is_published,
    coalesce(rating_average, 0.0),
    coalesce(rating_count, 0),
    now()
FROM marketplace.service_blueprints
ON CONFLICT (service_id) DO NOTHING;
-- #endregion

COMMIT;
