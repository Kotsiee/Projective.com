-- =============================================================================
-- seed-explore.sql — realistic mock data for the Unified Explore & Discovery Engine.
--
-- Seeds: users, freelancers, teams, businesses, services, projects (+ stages),
-- rating aggregates, trust penalties, talent signals, behavioural telemetry and
-- an admin user. PRODUCTS ARE DELIBERATELY NOT SEEDED — the product entity is not
-- fully defined in the schema yet.
--
-- Apply as the superuser (local Supabase workflow):
--   docker exec -i supabase_db_Projective psql -U supabase_admin -d postgres \
--       < supabase/populate/seed-explore.sql
--
-- The auth.users + org.users_public inserts run with triggers suppressed
-- (session_replication_role = replica) to bypass the onboarding trigger; every
-- other insert runs normally so the real search-index sync triggers fire and
-- populate search.*_index (with mock embeddings) end-to-end.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Auth users + public profiles (triggers suppressed)
-- ---------------------------------------------------------------------------
SET session_replication_role = replica;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-a000-000000000001','authenticated','authenticated','aria@projective.dev',   crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}','{}'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-a000-000000000002','authenticated','authenticated','milo@projective.dev',   crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}','{}'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-a000-000000000003','authenticated','authenticated','priya@projective.dev',  crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}','{}'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-a000-000000000004','authenticated','authenticated','devon@projective.dev',  crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}','{}'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-a000-000000000005','authenticated','authenticated','selene@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}','{}'),
  ('00000000-0000-0000-0000-000000000000','a0000000-0000-4000-a000-000000000006','authenticated','authenticated','kenji@projective.dev',  crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}','{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.users_public (user_id, username, first_name, last_name, headline, country, timezone, languages, dob, is_freelancer)
VALUES
  ('a0000000-0000-4000-a000-000000000001','ariabuilds','Aria','Okonkwo','Senior full-stack engineer — ships production SaaS end-to-end','Portugal','Europe/Lisbon', ARRAY['English','Portuguese'],'1992-03-04', true),
  ('a0000000-0000-4000-a000-000000000002','milodesigns','Milo','Fenwick','Brand & product designer for high-growth startups','Germany','Europe/Berlin', ARRAY['English','German'],'1990-07-19', true),
  ('a0000000-0000-4000-a000-000000000003','priyadecks','Priya','Nair','Pitch & narrative designer — helped raise $40M+','United Kingdom','Europe/London', ARRAY['English'],'1994-11-02', true),
  ('a0000000-0000-4000-a000-000000000004','devongrowth','Devon','Reyes','Technical SEO & growth engineer','United States','America/Chicago', ARRAY['English','Spanish'],'1989-05-23', true),
  ('a0000000-0000-4000-a000-000000000005','selenemotion','Selene','Vaughn','Cinematic motion & 3D artist','United Kingdom','Europe/London', ARRAY['English'],'1993-09-14', true),
  ('a0000000-0000-4000-a000-000000000006','kenjiml','Kenji','Watari','ML engineer — LLM agents & retrieval systems','United States','America/Los_Angeles', ARRAY['English','Japanese'],'1991-01-30', true)
ON CONFLICT (user_id) DO NOTHING;

SET session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- 2. Freelancer profiles (sync trigger populates search.profiles_index)
--    NOTE: freelancers carry no hourly/fixed rate — cost derives from Services.
-- ---------------------------------------------------------------------------
INSERT INTO org.freelancer_profiles (user_id, skills, availability_status, current_workload_intensity, available_since)
VALUES
  ('a0000000-0000-4000-a000-000000000001', ARRAY['react','typescript','supabase','postgres'],'available', 20, now() - interval '9 days'),
  ('a0000000-0000-4000-a000-000000000002', ARRAY['branding','figma','logo','design'],       'available', 10, now() - interval '30 days'),
  ('a0000000-0000-4000-a000-000000000003', ARRAY['pitch','slides','story','finance'],        'available', 5,  now() - interval '2 days'),
  ('a0000000-0000-4000-a000-000000000004', ARRAY['seo','analytics','growth'],                'busy',      70, now() - interval '1 day'),
  ('a0000000-0000-4000-a000-000000000005', ARRAY['motion','after effects','3d','video'],     'available', 35, now() - interval '14 days'),
  ('a0000000-0000-4000-a000-000000000006', ARRAY['ai','python','rag','llm'],                 'busy',      80, now() - interval '1 day')
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Teams & businesses (sync triggers populate profiles_index)
-- ---------------------------------------------------------------------------
INSERT INTO org.teams (id, owner_user_id, name, slug, headline, current_workload_intensity, available_since)
VALUES
  ('11110000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000002','Northwind Collective','northwind','Product design squad for venture-backed startups', 40, now() - interval '3 days'),
  ('11110000-0000-4000-a000-000000000002','a0000000-0000-4000-a000-000000000001','Studio Aurora','studio-aurora','Design-systems studio crafting UI kits & type', 25, now() - interval '20 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.business_profiles (id, owner_user_id, name, slug, billing_email, headline, country)
VALUES
  ('22220000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000005','Helios Studios','helios-studios','billing@helios.dev','Full-service motion & video production house','United Kingdom'),
  ('22220000-0000-4000-a000-000000000002','a0000000-0000-4000-a000-000000000004','Meridian','meridian','billing@meridian.dev','Consumer fintech building regulated products','United States')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Services (sync trigger populates search.services_index)
-- ---------------------------------------------------------------------------
INSERT INTO marketplace.service_blueprints (id, freelancer_profile_id, title, description, description_text,
    pricing_model, price_cents, currency, requires_upfront_escrow, max_seats_per_cohort,
    allow_continuous_enrollment, session_template_rules, is_published)
VALUES
  ('33330000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000001','Full-stack SaaS MVP in 4 weeks','{}','End-to-end product build: auth, billing, dashboards and a polished design system.','flat_fee', 650000,'USD', true, 3, false,'{}', true),
  ('33330000-0000-4000-a000-000000000002','a0000000-0000-4000-a000-000000000002','Conversion-focused brand identity','{}','Logo, type system and a full brand kit tuned for high-growth startups.','flat_fee', 240000,'USD', true, 2, false,'{}', true),
  ('33330000-0000-4000-a000-000000000003','a0000000-0000-4000-a000-000000000003','Investor-ready pitch deck','{}','12-slide narrative deck with financial models and a story that closes rounds.','flat_fee', 180000,'USD', true, 1, false,'{}', true),
  ('33330000-0000-4000-a000-000000000004','a0000000-0000-4000-a000-000000000004','Technical SEO & growth audit','{}','Full crawl, Core Web Vitals fixes and a 90-day compounding growth roadmap.','flat_fee', 150000,'USD', true, 1, true, '{}', true),
  ('33330000-0000-4000-a000-000000000005','a0000000-0000-4000-a000-000000000005','Cinematic product launch video','{}','60-second hero film — script, 3D motion, sound design and social cutdowns.','flat_fee', 320000,'USD', true, 1, false,'{}', true),
  ('33330000-0000-4000-a000-000000000006','a0000000-0000-4000-a000-000000000006','AI agent & automation setup','{}','Custom LLM workflows wired into your stack — retrieval, tools and guardrails.','per_seat', 420000,'USD', true, 5, true, '{}', true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Projects + stages (sync trigger populates search.projects_index)
-- ---------------------------------------------------------------------------
INSERT INTO projects.projects (id, client_business_id, owner_user_id, title, description, description_text,
    format, structure_variation, status, visibility, currency, timeline_preset, ip_ownership_mode,
    nda_required, portfolio_display_rights, allow_deadline_bonuses, location_restriction, language_requirement, target_project_start_date)
VALUES
  ('44440000-0000-4000-a000-000000000001','22220000-0000-4000-a000-000000000002','a0000000-0000-4000-a000-000000000004','Fintech mobile app — end-to-end build','{}','Seeking a cross-functional squad to design and ship a regulated consumer fintech app across iOS & Android.','pipeline','standard','active','public','USD','sequential','exclusive_transfer', true,'allowed', true, ARRAY['Remote'], ARRAY['English'], now() + interval '21 days'),
  ('44440000-0000-4000-a000-000000000002','22220000-0000-4000-a000-000000000001','a0000000-0000-4000-a000-000000000005','Launch film + paid social campaign','{}','Hero launch video plus a 6-week paid social sprint with weekly creative iterations.','session','standard','active','public','USD','staggered','licensed_use', false,'allowed', true, ARRAY['Hybrid — LA'], ARRAY['English'], now() + interval '10 days'),
  -- NOTE: client_business_id set intentionally — the pre-existing trigger
  -- projects.update_entity_project_counts() dereferences NEW.team_id (a column that
  -- does not exist on projects.projects) whenever client_business_id IS NULL, which
  -- errors on user-owned projects. Assigning a business avoids that latent bug.
  ('44440000-0000-4000-a000-000000000003','22220000-0000-4000-a000-000000000002','a0000000-0000-4000-a000-000000000006','AI customer-support copilot','{}','Build a retrieval-augmented support agent integrated with Zendesk and an internal knowledge base.','pipeline','standard','active','public','USD','sequential','shared_ownership', true,'embargoed', false, ARRAY['Remote'], ARRAY['English'], now() + interval '14 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_stages (id, project_id, name, description_text, sort_order, status, skills, unit_price_cents)
VALUES
  ('45450000-0000-4000-a000-000000000001','44440000-0000-4000-a000-000000000001','Discovery & UX','Research, flows and clickable prototype', 1,'open',  ARRAY['figma','research'],           1200000),
  ('45450000-0000-4000-a000-000000000002','44440000-0000-4000-a000-000000000001','Mobile build','React Native app + secure backend', 2,'open',      ARRAY['react','typescript','security'], 6000000),
  ('45450000-0000-4000-a000-000000000003','44440000-0000-4000-a000-000000000002','Pre-production','Script, storyboard and shot list', 1,'open',    ARRAY['motion','video'],             900000),
  ('45450000-0000-4000-a000-000000000004','44440000-0000-4000-a000-000000000002','Edit & delivery','Final film + social cutdowns', 2,'open',       ARRAY['after effects','3d'],         1600000),
  ('45450000-0000-4000-a000-000000000005','44440000-0000-4000-a000-000000000003','RAG pipeline','Retrieval, tools and guardrails', 1,'open',        ARRAY['ai','python','rag'],          4000000)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Rating aggregates (UPDATE fires sync triggers -> index rating columns).
--    Standing in for the reviews.entity_reviews pipeline for realistic volume.
-- ---------------------------------------------------------------------------
UPDATE org.freelancer_profiles SET rating_average = v.avg, rating_count = v.cnt
FROM (VALUES
  ('a0000000-0000-4000-a000-000000000001', 4.9, 214),
  ('a0000000-0000-4000-a000-000000000002', 4.8, 178),
  ('a0000000-0000-4000-a000-000000000003', 4.7, 96),
  ('a0000000-0000-4000-a000-000000000004', 4.6, 132),
  ('a0000000-0000-4000-a000-000000000005', 4.9, 87),
  ('a0000000-0000-4000-a000-000000000006', 4.8, 64)
) AS v(uid, avg, cnt) WHERE org.freelancer_profiles.user_id = v.uid::uuid;

UPDATE org.teams SET rating_average = 4.85, rating_count = 156 WHERE id = '11110000-0000-4000-a000-000000000001';
UPDATE org.teams SET rating_average = 4.90, rating_count = 203 WHERE id = '11110000-0000-4000-a000-000000000002';
UPDATE org.business_profiles SET rating_average = 4.90, rating_count = 302 WHERE id = '22220000-0000-4000-a000-000000000001';
UPDATE org.business_profiles SET rating_average = 4.60, rating_count = 48  WHERE id = '22220000-0000-4000-a000-000000000002';

UPDATE marketplace.service_blueprints SET rating_average = v.avg, rating_count = v.cnt
FROM (VALUES
  ('33330000-0000-4000-a000-000000000001', 4.9, 214),
  ('33330000-0000-4000-a000-000000000002', 4.8, 178),
  ('33330000-0000-4000-a000-000000000003', 4.7, 96),
  ('33330000-0000-4000-a000-000000000004', 4.6, 132),
  ('33330000-0000-4000-a000-000000000005', 4.9, 87),
  ('33330000-0000-4000-a000-000000000006', 4.8, 64)
) AS v(sid, avg, cnt) WHERE marketplace.service_blueprints.id = v.sid::uuid;

-- ---------------------------------------------------------------------------
-- 7. Trust penalty (demonstrates discovery_rank dampening -> profiles_index.discovery_penalty)
-- ---------------------------------------------------------------------------
INSERT INTO security.penalties (id, subject_type, subject_id, penalty_type, source_type, severity, reason, status, issued_at)
VALUES
  ('55550000-0000-4000-a000-000000000001','freelancer','a0000000-0000-4000-a000-000000000004','discovery_rank','manual', 3.0,'Repeated late deliveries (seed demo)','active', now())
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Talent signals (derived ranking inputs)
-- ---------------------------------------------------------------------------
INSERT INTO search.talent_signals (entity_id, entity_type, is_verified, response_time_hours, member_count, low_workload_since, engagement_score, rating_as_freelancer)
VALUES
  ('a0000000-0000-4000-a000-000000000001','freelancer', true,  2.0, 1,  now() - interval '9 days', 320, 4.9),
  ('a0000000-0000-4000-a000-000000000002','freelancer', true,  4.0, 1,  now() - interval '30 days', 180, 4.8),
  ('a0000000-0000-4000-a000-000000000003','freelancer', false, 6.0, 1,  now() - interval '2 days', 90,  4.7),
  ('a0000000-0000-4000-a000-000000000004','freelancer', false, 20.0, 1, NULL, 60, 4.6),
  ('a0000000-0000-4000-a000-000000000005','freelancer', true,  3.0, 1,  now() - interval '14 days', 150, 4.9),
  ('a0000000-0000-4000-a000-000000000006','freelancer', true,  8.0, 1,  NULL, 64, 4.8),
  ('11110000-0000-4000-a000-000000000001','team',       true,  5.0, 6,  now() - interval '3 days', 210, 0),
  ('11110000-0000-4000-a000-000000000002','team',       true,  4.0, 4,  now() - interval '20 days', 300, 0),
  ('22220000-0000-4000-a000-000000000001','business',   true,  6.0, 12, now() - interval '5 days', 400, 0),
  ('22220000-0000-4000-a000-000000000002','business',   true,  9.0, 8,  NULL, 120, 0)
ON CONFLICT (entity_id, entity_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Behavioural telemetry (popularity + interest history) & query analytics
-- ---------------------------------------------------------------------------
INSERT INTO search.interest_events (event_type, entity_id, entity_type, query, weight, created_at)
SELECT 'click', '33330000-0000-4000-a000-000000000001','service','saas mvp', 1, now() - (g || ' hours')::interval FROM generate_series(1,14) g;
INSERT INTO search.interest_events (event_type, entity_id, entity_type, query, weight, created_at)
SELECT 'click', 'a0000000-0000-4000-a000-000000000001','freelancer','react', 1, now() - (g || ' hours')::interval FROM generate_series(1,9) g;
INSERT INTO search.interest_events (event_type, entity_id, entity_type, query, weight, created_at)
SELECT 'click', '44440000-0000-4000-a000-000000000001','project','fintech', 1, now() - (g || ' hours')::interval FROM generate_series(1,6) g;
INSERT INTO search.interest_events (event_type, query, created_at)
SELECT 'search', q, now() - (r || ' hours')::interval
FROM (VALUES ('design'),('react developers'),('pitch deck'),('ai automation'),('motion graphics')) v(q),
     generate_series(1,3) r;

INSERT INTO search.query_logs (user_id, search_query, query_embedding, filters_applied, entity_type, duration_ms, result_count, matched_density, created_at)
SELECT NULL, v.q, search.fn_mock_embedding(v.q), '{}'::jsonb, v.et, v.dur, v.rc,
       round(v.rc::numeric / 30, 4), now() - (v.h || ' hours')::interval
FROM (VALUES
  ('design',   NULL,        42, 12, 3), ('react',    'services',  28, 6,  8),
  ('pitch',    'services',  31, 3,  12),('fintech',  'projects',  55, 4,  20),
  ('ai agent', 'services',  38, 5,  16),('motion',   NULL,        47, 9,  6)
) AS v(q, et, dur, rc, h);

-- ---------------------------------------------------------------------------
-- 10. Admin user (so admin analytics/weight RPCs are testable)
-- ---------------------------------------------------------------------------
INSERT INTO ops.admin_users (user_id, role) VALUES
  ('a0000000-0000-4000-a000-000000000001','admin')
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
