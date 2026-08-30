-- =============================================================================================
-- 02_entities.sql — teams and businesses
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- A team is a Freelancer with multiple members (seller side); a business is a Client with multiple members (buyer side). Each entity's owner account was seeded in 01.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO org.teams (id, owner_user_id, name, slug, headline, current_workload_intensity, available_since, status)
VALUES
  ('213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'c60f6204-1a88-4fbd-a999-523228c50b43', 'Atelier Nova', 'ateliernova', 'Atelier Nova — collaborative studio on Projective', 30, now() - interval '14 days', 'active'),
  ('edc2d943-8062-426a-a6f2-29fdc6b4363c', '6ef3d16b-d6ea-4c6e-a664-5c0ded5e1ac0', 'North Loop', 'northloop', 'North Loop — collaborative studio on Projective', 30, now() - interval '14 days', 'active'),
  ('a4c25501-0fdd-4abe-a575-ff478daad4fc', '598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'Studio Fern', 'studiofern', 'Studio Fern — collaborative studio on Projective', 30, now() - interval '14 days', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.team_members (team_id, user_id, status)
VALUES
  ('213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'c60f6204-1a88-4fbd-a999-523228c50b43', 'active'),
  ('edc2d943-8062-426a-a6f2-29fdc6b4363c', '6ef3d16b-d6ea-4c6e-a664-5c0ded5e1ac0', 'active'),
  ('a4c25501-0fdd-4abe-a575-ff478daad4fc', '598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'active')
ON CONFLICT DO NOTHING;

INSERT INTO org.business_profiles (id, owner_user_id, name, slug, billing_email, headline, country, status)
VALUES
  ('edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '766a01c9-f267-4a96-a8ce-f77b6c6abb48', 'Helia Finance', 'heliafinance', 'billing@heliafinance.dev', 'Helia Finance — client on Projective', 'United Kingdom', 'active'),
  ('4cfa4f66-9aa2-496b-a93d-994caac019c1', 'cb162111-e6a8-469c-aea0-723b1c72b686', 'Atlas Labs', 'atlaslabs', 'billing@atlaslabs.dev', 'Atlas Labs — client on Projective', 'United Kingdom', 'active')
ON CONFLICT (id) DO NOTHING;
