BEGIN;

INSERT INTO
    search.profiles_index (
        entity_id,
        entity_type,
        display_name,
        fts,
        metadata,
        is_active,
        updated_at
    )
SELECT
    id,
    'team',
    slug,
    to_tsvector ('english', coalesce(slug, '')),
    jsonb_build_object ('payout_model', payout_model),
    true,
    now()
FROM org.teams ON CONFLICT (entity_id, entity_type) DO NOTHING;

INSERT INTO
    search.profiles_index (
        entity_id,
        entity_type,
        display_name,
        fts,
        metadata,
        updated_at
    )
SELECT
    user_id,
    'freelancer',
    'Freelancer Profile',
    to_tsvector (
        'english',
        array_to_string (skills, ' ')
    ),
    jsonb_build_object (
        'skills',
        skills
    ),
    now()
FROM org.freelancer_profiles ON CONFLICT (entity_id, entity_type) DO NOTHING;

INSERT INTO
    search.profiles_index (
        entity_id,
        entity_type,
        display_name,
        headline,
        fts,
        metadata,
        is_active,
        updated_at
    )
SELECT
    user_id,
    'user',
    coalesce(first_name, '') || ' ' || coalesce(last_name, ''),
    headline,
    to_tsvector (
        'english',
        coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(headline, '')
    ),
    jsonb_build_object ('username', username),
    CASE
        WHEN visibility = 'public' THEN true
        ELSE false
    END,
    now()
FROM org.users_public ON CONFLICT (entity_id, entity_type) DO NOTHING;

INSERT INTO
    search.profiles_index (
        entity_id,
        entity_type,
        display_name,
        fts,
        metadata,
        updated_at
    )
SELECT
    id,
    'business',
    name,
    to_tsvector ('english', coalesce(name, '')),
    jsonb_build_object ('plan', plan),
    now()
FROM org.business_profiles ON CONFLICT (entity_id, entity_type) DO NOTHING;

INSERT INTO search.projects_index (project_id, title, fts, industry_category_id, status, is_active, updated_at)
SELECT 
    id, 
    'Project Title', 
    to_tsvector('english', status::text),
    industry_category_id,
    status::text,
    CASE WHEN visibility = 'public' AND status != 'draft' THEN true ELSE false END,
    now()
FROM projects.projects
ON CONFLICT (project_id) DO NOTHING;

INSERT INTO
    search.services_index (
        service_id,
        title,
        fts,
        is_public,
        updated_at
    )
SELECT id, 'Service/Portfolio', to_tsvector ('english', 'service'), is_public, now()
FROM org.portfolios ON CONFLICT (service_id) DO NOTHING;

COMMIT;