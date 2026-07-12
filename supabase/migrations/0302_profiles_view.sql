CREATE OR REPLACE VIEW org.profiles_index AS
-- 1. USERS & FREELANCERS
SELECT 
    u.user_id as entity_id, 
    CASE 
        WHEN u.is_freelancer THEN 'freelancer'::text 
        ELSE 'user'::text 
    END as entity_type, 
    u.username as handle, 
    trim(u.first_name || ' ' || COALESCE(u.last_name, '')) as name, 
    u.avatar_file_id, 
    u.banner_file_id, 
    u.headline, 
    u.bio,
    u.languages,
    u.timezone,
    u.country as location,

-- Split Ratings
u.rating_average as rating_as_client,
u.rating_count as reviews_as_client,
COALESCE(f.rating_average, 0.0) as rating_as_freelancer,
COALESCE(f.rating_count, 0) as reviews_as_freelancer,

-- Counter Stats
u.active_project_count,
    u.total_project_count,
    u.service_count,
    u.product_count,
    (SELECT COUNT(*)::int FROM org.portfolios p WHERE p.user_id = u.user_id) as portfolio_count,
    (SELECT COUNT(*)::int FROM org.team_members tm WHERE tm.user_id = u.user_id AND tm.status = 'active') as team_count,
    (SELECT COUNT(*)::int FROM org.business_members bm WHERE bm.user_id = u.user_id AND bm.status = 'active') as business_count,
    0 as member_count
FROM org.users_public u
    LEFT JOIN org.freelancer_profiles f ON u.user_id = f.user_id

UNION ALL

-- 2. BUSINESSES
SELECT 
    b.id as entity_id, 
    'business'::text as entity_type, 
    b.slug as handle, 
    b.name, 
    b.logo_file_id as avatar_file_id, 
    b.banner_file_id, 
    b.headline, 
    b.bio,
    b.languages,
    b.timezone,
    b.country as location,

-- Split Ratings
b.rating_average as rating_as_client,
b.rating_count as reviews_as_client,
0.0 as rating_as_freelancer,
0 as reviews_as_freelancer,

-- Counter Stats
b.active_project_count,
    b.total_project_count,
    b.service_count,
    b.product_count,
    0 as portfolio_count,
    0 as team_count,
    0 as business_count,
    (SELECT COUNT(*)::int FROM org.business_members bm WHERE bm.business_id = b.id AND bm.status = 'active') as member_count
FROM org.business_profiles b

UNION ALL

-- 3. TEAMS
SELECT 
    t.id as entity_id, 
    'team'::text as entity_type, 
    t.slug as handle, 
    t.name, 
    t.avatar_file_id, 
    t.banner_file_id, 
    t.headline, 
    t.bio,
    '{}'::text[] as languages, 
    NULL as timezone,
    NULL as location,

-- Split Ratings
0.0 as rating_as_client,
0 as reviews_as_client,
t.rating_average as rating_as_freelancer,
t.rating_count as reviews_as_freelancer,

-- Counter Stats
t.active_project_count,
    t.total_project_count,
    t.service_count,
    t.product_count,
    0 as portfolio_count, -- Requires org.portfolios schema update to support team_id later
    0 as team_count,
    0 as business_count,
    (SELECT COUNT(*)::int FROM org.team_members tm WHERE tm.team_id = t.id AND tm.status = 'active') as member_count
FROM org.teams t;