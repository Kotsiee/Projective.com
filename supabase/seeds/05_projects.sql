-- =============================================================================================
-- 05_projects.sql — open projects and their stages
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- client_business_id is set on every row deliberately: projects.update_entity_project_counts() dereferences a team_id column that does not exist on projects.projects whenever client_business_id IS NULL, which errors on a user-owned project. That is a pre-existing trigger bug, worked around here rather than fixed silently.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO projects.projects (id, client_business_id, owner_user_id, title, description, description_text,
    format, structure_variation, status, visibility, currency, timeline_preset, ip_ownership_mode,
    nda_required, portfolio_display_rights, allow_deadline_bonuses, location_restriction, language_requirement, target_project_start_date)
VALUES
  ('f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '766a01c9-f267-4a96-a8ce-f77b6c6abb48', 'Helia wallet redesign', '{}'::jsonb, 'Reimagine the Helia consumer wallet end-to-end — a research-backed redesign of onboarding, transfers, and card management, delivered as production-ready screens and a coded front end.', 'pipeline', 'standard', 'active', 'public', 'USD', 'sequential', 'exclusive_transfer', false, 'allowed', true, ARRAY['Remote']::text[], ARRAY['English']::text[], now() + interval '21 days'),
  ('7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'cb162111-e6a8-469c-aea0-723b1c72b686', 'Atlas analytics platform', '{}'::jsonb, 'Build the Atlas analytics platform: a multi-tenant dashboard suite over a streaming data model, with drill-downs, alerting, and a visualisation kit that scales to millions of rows.', 'pipeline', 'standard', 'active', 'public', 'USD', 'sequential', 'exclusive_transfer', false, 'allowed', true, ARRAY['Remote']::text[], ARRAY['English']::text[], now() + interval '21 days'),
  ('8fc13e15-5051-4c3c-af74-82ef238f210e', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '766a01c9-f267-4a96-a8ce-f77b6c6abb48', 'Verdant brand refresh', '{}'::jsonb, 'A full brand refresh for Verdant — audit the current identity, explore territories, and land a flexible logo system, palette, illustration language, and guidelines the team can run with.', 'one_off', 'standard', 'active', 'public', 'USD', 'sequential', 'exclusive_transfer', false, 'allowed', true, ARRAY['Remote']::text[], ARRAY['English']::text[], now() + interval '21 days'),
  ('4a9f7c1e-0c3f-462f-a67e-0ce833290759', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'cb162111-e6a8-469c-aea0-723b1c72b686', 'Loop mobile app', '{}'::jsonb, 'Ship the Loop mobile app on iOS and Android from a validated prototype — native builds, offline-first sync, and an App Store / Play launch with staged rollouts.', 'pipeline', 'standard', 'active', 'public', 'USD', 'sequential', 'exclusive_transfer', false, 'allowed', true, ARRAY['Remote']::text[], ARRAY['English']::text[], now() + interval '21 days'),
  ('af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '766a01c9-f267-4a96-a8ce-f77b6c6abb48', 'Meridian design system', '{}'::jsonb, 'Stand up the Meridian design system — tokens and foundations, a governed component library, a searchable docs site, and a migration path that gets product teams onto it.', 'pipeline', 'standard', 'active', 'public', 'USD', 'sequential', 'exclusive_transfer', false, 'allowed', true, ARRAY['Remote']::text[], ARRAY['English']::text[], now() + interval '21 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_stages (id, project_id, name, description_text, sort_order, status, skills, unit_price_cents)
VALUES
  ('ffbbad09-d9c2-449c-ada1-5e4bb688b7d6', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'Discovery', 'Discovery for Helia wallet redesign', 1, 'open', '{}'::text[], 100000),
  ('febbab76-dac2-462f-aca1-5cb8b788b969', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'Flows & IA', 'Flows & IA for Helia wallet redesign', 2, 'open', '{}'::text[], 200000),
  ('fdbba9e3-dbc2-47c2-afa1-6171b488b4b0', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'Hi-fi design', 'Hi-fi design for Helia wallet redesign', 3, 'open', '{}'::text[], 300000),
  ('fcbba850-dcc2-4955-aea1-5fdeb588b643', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'Build', 'Build for Helia wallet redesign', 4, 'open', '{}'::text[], 400000),
  ('3096d4f2-402b-4919-ad6a-2c708e0c1237', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', 'Data model', 'Data model for Atlas analytics platform', 1, 'open', '{}'::text[], 100000),
  ('3196d685-3f2b-4786-ae6a-2e038d0c10a4', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', 'API layer', 'API layer for Atlas analytics platform', 2, 'open', '{}'::text[], 200000),
  ('2e96d1cc-3e2b-45f3-af6a-2f96900c155d', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', 'Dashboards', 'Dashboards for Atlas analytics platform', 3, 'open', '{}'::text[], 300000),
  ('2f96d35f-3d2b-4460-a06a-31298f0c13ca', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', 'Realtime', 'Realtime for Atlas analytics platform', 4, 'open', '{}'::text[], 400000),
  ('522e0302-7dce-47c3-a7b1-fe5841382041', '8fc13e15-5051-4c3c-af74-82ef238f210e', 'Audit', 'Audit for Verdant brand refresh', 1, 'open', '{}'::text[], 100000),
  ('532e0495-7cce-4630-a8b1-ffeb40381eae', '8fc13e15-5051-4c3c-af74-82ef238f210e', 'Territory', 'Territory for Verdant brand refresh', 2, 'open', '{}'::text[], 200000),
  ('502dffdc-7fce-4ae9-a9b2-017e3f381d1b', '8fc13e15-5051-4c3c-af74-82ef238f210e', 'Identity', 'Identity for Verdant brand refresh', 3, 'open', '{}'::text[], 300000),
  ('512e016f-7ece-4956-aab2-03113e381b88', '8fc13e15-5051-4c3c-af74-82ef238f210e', 'Guidelines', 'Guidelines for Verdant brand refresh', 4, 'open', '{}'::text[], 400000),
  ('35738ab1-0560-44b8-a4fe-49a7e21c2bbe', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'Scoping', 'Scoping for Loop mobile app', 1, 'open', '{}'::text[], 100000),
  ('3473891e-0660-464b-a3fe-4814e31c2d51', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'Design', 'Design for Loop mobile app', 2, 'open', '{}'::text[], 200000),
  ('3373878b-0760-47de-a6fe-4ccde01c2898', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'iOS build', 'iOS build for Loop mobile app', 3, 'open', '{}'::text[], 300000),
  ('327385f8-0860-4971-a5fe-4b3ae11c2a2b', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'Android build', 'Android build for Loop mobile app', 4, 'open', '{}'::text[], 400000),
  ('d961a17a-dcfa-4b11-a2b3-e2e040407717', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'Foundations', 'Foundations for Meridian design system', 1, 'open', '{}'::text[], 100000),
  ('da61a30d-dbfa-497e-a3b3-e4733f407584', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'Components', 'Components for Meridian design system', 2, 'open', '{}'::text[], 200000),
  ('d7619e54-dafa-47eb-a4b3-e60642407a3d', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'Docs site', 'Docs site for Meridian design system', 3, 'open', '{}'::text[], 300000),
  ('d8619fe7-d9fa-4658-a5b3-e799414078aa', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'Adoption', 'Adoption for Meridian design system', 4, 'open', '{}'::text[], 400000)
ON CONFLICT (id) DO NOTHING;
