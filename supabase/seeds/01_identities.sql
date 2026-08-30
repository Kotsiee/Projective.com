-- =============================================================================================
-- 01_identities.sql — auth accounts, public profiles and freelancer profiles
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- Derived from the discovery corpus in packages/backend/services/explore/fixtures.ts. Triggers are suppressed around the auth.users insert only, because the onboarding trigger assumes a live GoTrue signup.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


SET session_replication_role = replica;

-- The token columns are seeded as EMPTY STRINGS, not left NULL, and that is load-bearing.
-- GoTrue scans confirmation_token / recovery_token / email_change* / phone_change* /
-- reauthentication_token into non-nullable Go strings. A NULL in any of them makes every
-- sign-in fail with a 500 'Database error querying schema' — which reads like a broken
-- database rather than a bad seed, and is why this is spelled out here.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
                        confirmation_token, recovery_token, email_change, email_change_token_new,
                        email_change_token_current, phone_change, phone_change_token, reauthentication_token)
VALUES
  ('00000000-0000-0000-0000-000000000000', '6ce1906f-caab-4708-a19e-df3d8960666e', 'authenticated', 'authenticated', 'marisdelacroix@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'authenticated', 'authenticated', 'renkoda@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'authenticated', 'authenticated', 'juno@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'authenticated', 'authenticated', 'noor@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'authenticated', 'authenticated', 'theo@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c60f6204-1a88-4fbd-a999-523228c50b43', 'authenticated', 'authenticated', 'ateliernova-owner@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '6ef3d16b-d6ea-4c6e-a664-5c0ded5e1ac0', 'authenticated', 'authenticated', 'northloop-owner@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'authenticated', 'authenticated', 'studiofern-owner@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '766a01c9-f267-4a96-a8ce-f77b6c6abb48', 'authenticated', 'authenticated', 'heliafinance-owner@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'cb162111-e6a8-469c-aea0-723b1c72b686', 'authenticated', 'authenticated', 'atlaslabs-owner@projective.dev', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.users_public (user_id, username, first_name, last_name, headline, country, timezone, languages, dob, is_freelancer, is_operator)
VALUES
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'marisdelacroix', 'Maris', 'Delacroix', 'Maris Delacroix on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', true, false),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'renkoda', 'Ren', 'Koda', 'Ren Koda on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', true, false),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'juno', 'Juno', 'Park', 'Juno Park on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', true, false),
  ('1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'noor', 'Noor', 'Haddad', 'Noor Haddad on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', false, false),
  ('2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'theo', 'Theo', 'Almeida', 'Theo Almeida on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', false, false),
  ('c60f6204-1a88-4fbd-a999-523228c50b43', 'ateliernova-owner', 'Atelier', 'Nova Owner', 'Atelier Nova on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', true, false),
  ('6ef3d16b-d6ea-4c6e-a664-5c0ded5e1ac0', 'northloop-owner', 'North', 'Loop Owner', 'North Loop on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', true, false),
  ('598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'studiofern-owner', 'Studio', 'Fern Owner', 'Studio Fern on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', true, false),
  ('766a01c9-f267-4a96-a8ce-f77b6c6abb48', 'heliafinance-owner', 'Helia', 'Finance Owner', 'Helia Finance on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', false, true),
  ('cb162111-e6a8-469c-aea0-723b1c72b686', 'atlaslabs-owner', 'Atlas', 'Labs Owner', 'Atlas Labs on Projective', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1990-01-01', false, true)
ON CONFLICT (user_id) DO NOTHING;

SET session_replication_role = origin;

INSERT INTO org.freelancer_profiles (user_id, skills, availability_status, current_workload_intensity, available_since)
VALUES
  ('6ce1906f-caab-4708-a19e-df3d8960666e', ARRAY['ux', 'design systems', 'figma']::text[], 'busy', 70, now() - interval '7 days'),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', ARRAY['webgl', 'blender', 'three.js']::text[], 'busy', 92, now() - interval '7 days'),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', ARRAY['preact', 'signals', 'a11y']::text[], 'available', 28, now() - interval '7 days')
ON CONFLICT (user_id) DO NOTHING;
