-- =============================================================================================
-- 01_identities.sql — auth accounts, public profiles and freelancer profiles
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- Seventeen development personas (see gen/world.ts). Every account signs in with the password 'password123' at <username>@projective.dev. Triggers stay ENABLED: public.handle_new_user is a no-op without username/dob metadata, and the users_public triggers are what seed each person's preference rows and search index.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO org.skills (id, slug, label)
VALUES
  ('ecd69ae1-2226-4f5c-afb3-0e678f99d11a', 'ux', 'UX'),
  ('e014d9ad-c5dd-4b18-af8f-a893b3d7a43e', 'design-systems', 'Design systems'),
  ('ad071368-f79b-42b7-ac74-308a94a4ec19', 'figma', 'Figma'),
  ('dc53c67d-79a7-4f6e-a432-4a8b885e92cc', 'prototyping', 'Prototyping'),
  ('70528859-94ce-4f4e-a75f-27cf4d6ea264', 'webgl', 'WebGL'),
  ('06b31d5c-00bd-497b-afd6-da026c48c969', 'blender', 'Blender'),
  ('31b7eba8-879f-4e05-a1af-6002dcda704f', 'three-js', 'Three.js'),
  ('5a45a313-1365-4f44-a03c-3afd37cfe2f6', 'motion-design', 'Motion design'),
  ('848229b3-cbff-4c2e-a94a-b3f9e0e767bc', 'preact', 'Preact'),
  ('534e98b7-185b-4816-a990-e7c925109b78', 'typescript', 'TypeScript'),
  ('27197668-1eff-486d-a4ed-1f861a38ba83', 'a11y', 'Accessibility'),
  ('0ed029c4-7fa2-4f6d-aa08-681a474ac723', 'deno', 'Deno'),
  ('26045b67-b728-4856-af7c-eb4998e1d378', 'branding', 'Branding'),
  ('9e6501c1-a6c8-406c-aaed-fe5782f63162', 'identity-systems', 'Identity systems'),
  ('ff131961-54ae-4ae0-ad63-61e3795ab8a2', 'typography', 'Typography'),
  ('382b44ad-84a5-4536-a23d-eb1b01d39a1c', 'art-direction', 'Art direction'),
  ('b935eb8b-f83b-4a7a-a072-9f6d3acb265c', 'postgres', 'Postgres'),
  ('ef7f5d79-8ad3-4770-a55f-a123a3dc3a7a', 'realtime', 'Realtime systems'),
  ('aa80d44a-6c35-4b8f-a455-5a8c8edde7e1', 'editorial-design', 'Editorial design'),
  ('38786dcb-b2f9-4bd8-a389-58f90afaafb6', 'mentoring', 'Mentoring'),
  ('6cfda1bd-ba18-4438-ab8f-f36b2d1988be', 'notion', 'Notion'),
  ('0bb16fe9-d937-41fa-aa9e-41cb58cd943c', 'ux-research', 'UX research'),
  ('95f106ca-2ec7-4d99-af36-8988dc3c29df', 'user-interviews', 'User interviews'),
  ('f562f712-3251-4e47-a4da-dfb0031a44d5', 'illustration', 'Illustration'),
  ('beba8f27-5dd4-48a0-a7ff-90199f35a34a', 'procreate', 'Procreate'),
  ('195fe3cf-c420-4f54-ad9f-3cfd0081a90a', 'swift', 'Swift'),
  ('8a886841-d562-4d58-a101-b153da678aba', 'kotlin', 'Kotlin'),
  ('52e8301d-bc40-4394-a7ba-596b162ddb0a', 'react-native', 'React Native'),
  ('a848244b-83a6-4330-af71-e745f8822d52', 'copywriting', 'Copywriting'),
  ('a58d79f4-ff93-4621-ab32-a46a2c0b31df', 'ux-writing', 'UX writing'),
  ('0767af46-3dbc-45f9-aef5-1328125cbd9b', 'brand-voice', 'Brand voice')
ON CONFLICT (slug) DO NOTHING;

-- The token columns are seeded as EMPTY STRINGS, not left NULL, and that is load-bearing.
-- GoTrue scans confirmation_token / recovery_token / email_change* / phone_change* /
-- reauthentication_token into non-nullable Go strings. A NULL in any of them makes every
-- sign-in fail with a 500 'Database error querying schema' — which reads like a broken
-- database rather than a bad seed, and is why this is spelled out here.
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
VALUES
  ('00000000-0000-0000-0000-000000000000', '6ce1906f-caab-4708-a19e-df3d8960666e', 'authenticated', 'authenticated', 'marisdelacroix@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '10080 hours', now() - interval '24 hours', now() - interval '10080 hours', now() - interval '10080 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Maris Delacroix","name":"Maris Delacroix"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'authenticated', 'authenticated', 'renkoda@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '9120 hours', now() - interval '24 hours', now() - interval '9120 hours', now() - interval '9120 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Ren Koda","name":"Ren Koda"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'authenticated', 'authenticated', 'juno@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '5040 hours', now() - interval '24 hours', now() - interval '5040 hours', now() - interval '5040 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Juno Park","name":"Juno Park"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'authenticated', 'authenticated', 'noor@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '7200 hours', now() - interval '24 hours', now() - interval '7200 hours', now() - interval '7200 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Noor Haddad","name":"Noor Haddad"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'authenticated', 'authenticated', 'theo@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '3360 hours', now() - interval '24 hours', now() - interval '3360 hours', now() - interval '3360 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Theo Almeida","name":"Theo Almeida"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'authenticated', 'authenticated', 'inesduarte@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '9600 hours', now() - interval '24 hours', now() - interval '9600 hours', now() - interval '9600 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Inês Duarte","name":"Inês Duarte"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'authenticated', 'authenticated', 'kwamemensah@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '8760 hours', now() - interval '24 hours', now() - interval '8760 hours', now() - interval '8760 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Kwame Mensah","name":"Kwame Mensah"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c859a726-490c-4f6d-a184-8984de3994d3', 'authenticated', 'authenticated', 'saoirsebyrne@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '7920 hours', now() - interval '24 hours', now() - interval '7920 hours', now() - interval '7920 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Saoirse Byrne","name":"Saoirse Byrne"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'authenticated', 'authenticated', 'priyaraman@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '6240 hours', now() - interval '24 hours', now() - interval '6240 hours', now() - interval '6240 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Priya Raman","name":"Priya Raman"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '292e1827-f189-4f34-ab35-27c9f0320926', 'authenticated', 'authenticated', 'danielokafor@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '5760 hours', now() - interval '24 hours', now() - interval '5760 hours', now() - interval '5760 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Daniel Okafor","name":"Daniel Okafor"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'authenticated', 'authenticated', 'lenamueller@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '4800 hours', now() - interval '24 hours', now() - interval '4800 hours', now() - interval '4800 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Lena Müller","name":"Lena Müller"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'authenticated', 'authenticated', 'tomaszwojcik@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '4320 hours', now() - interval '24 hours', now() - interval '4320 hours', now() - interval '4320 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Tomasz Wójcik","name":"Tomasz Wójcik"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'authenticated', 'authenticated', 'aikotanaka@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '3600 hours', now() - interval '24 hours', now() - interval '3600 hours', now() - interval '3600 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Aiko Tanaka","name":"Aiko Tanaka"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'authenticated', 'authenticated', 'samuelnkemelu@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '5280 hours', now() - interval '24 hours', now() - interval '5280 hours', now() - interval '5280 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Samuel Nkemelu","name":"Samuel Nkemelu"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'authenticated', 'authenticated', 'hannahcole@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '5520 hours', now() - interval '24 hours', now() - interval '5520 hours', now() - interval '5520 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Hannah Cole","name":"Hannah Cole"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'authenticated', 'authenticated', 'miguelsantos@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '4560 hours', now() - interval '24 hours', now() - interval '4560 hours', now() - interval '4560 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Miguel Santos","name":"Miguel Santos"}'::jsonb, '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'authenticated', 'authenticated', 'chloewinters@projective.dev', crypt('password123', gen_salt('bf')), now() - interval '288 hours', now() - interval '24 hours', now() - interval '288 hours', now() - interval '288 hours', '{"provider":"email","providers":["email"]}', '{"full_name":"Chloe Winters","name":"Chloe Winters"}'::jsonb, '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
VALUES
  ('66eb5c24-cd22-4393-a250-d6d6dc202a45', '6ce1906f-caab-4708-a19e-df3d8960666e', '6ce1906f-caab-4708-a19e-df3d8960666e', 'email', '{"sub":"6ce1906f-caab-4708-a19e-df3d8960666e","email":"marisdelacroix@projective.dev","email_verified":true}'::jsonb, now() - interval '10080 hours', now() - interval '10080 hours', now() - interval '10080 hours'),
  ('0de8baf5-89a8-46bc-a63a-a1ff43581396', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'email', '{"sub":"bdff9d38-7124-4a49-af5d-c88eb4fe8b57","email":"renkoda@projective.dev","email_verified":true}'::jsonb, now() - interval '9120 hours', now() - interval '9120 hours', now() - interval '9120 hours'),
  ('f03e0719-4310-4982-abef-34c30116a81c', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'email', '{"sub":"45a4c6ae-d818-45fd-a62b-db44f1f69eab","email":"juno@projective.dev","email_verified":true}'::jsonb, now() - interval '5040 hours', now() - interval '5040 hours', now() - interval '5040 hours'),
  ('14e56425-94a0-4be2-aab8-e303bd8aaa58', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'email', '{"sub":"1fee216e-a637-4619-a90a-4ae03bb1ed8b","email":"noor@projective.dev","email_verified":true}'::jsonb, now() - interval '7200 hours', now() - interval '7200 hours', now() - interval '7200 hours'),
  ('5d45e9db-f58c-4708-a2a1-5145eb8687ca', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'email', '{"sub":"2bdebf14-f7dc-40af-acd8-fe22cb9916fd","email":"theo@projective.dev","email_verified":true}'::jsonb, now() - interval '3360 hours', now() - interval '3360 hours', now() - interval '3360 hours'),
  ('e495f2a3-b240-46d8-a8e2-6d855378130a', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'email', '{"sub":"9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d","email":"inesduarte@projective.dev","email_verified":true}'::jsonb, now() - interval '9600 hours', now() - interval '9600 hours', now() - interval '9600 hours'),
  ('14f7b4d2-fecf-4623-a033-c10cff28d465', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'email', '{"sub":"c7173d3f-8b15-4876-afbf-499d17513a44","email":"kwamemensah@projective.dev","email_verified":true}'::jsonb, now() - interval '8760 hours', now() - interval '8760 hours', now() - interval '8760 hours'),
  ('4a5d18e1-63e5-4fe2-aa7e-387bbd3957cc', 'c859a726-490c-4f6d-a184-8984de3994d3', 'c859a726-490c-4f6d-a184-8984de3994d3', 'email', '{"sub":"c859a726-490c-4f6d-a184-8984de3994d3","email":"saoirsebyrne@projective.dev","email_verified":true}'::jsonb, now() - interval '7920 hours', now() - interval '7920 hours', now() - interval '7920 hours'),
  ('83b7ca39-72fe-4b0a-a255-d6ab2cace8a4', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'email', '{"sub":"de29f2ce-0f36-4db5-a417-4edc88cedf83","email":"priyaraman@projective.dev","email_verified":true}'::jsonb, now() - interval '6240 hours', now() - interval '6240 hours', now() - interval '6240 hours'),
  ('f0049630-d474-426b-ab74-912ed6ed0a31', '292e1827-f189-4f34-ab35-27c9f0320926', '292e1827-f189-4f34-ab35-27c9f0320926', 'email', '{"sub":"292e1827-f189-4f34-ab35-27c9f0320926","email":"danielokafor@projective.dev","email_verified":true}'::jsonb, now() - interval '5760 hours', now() - interval '5760 hours', now() - interval '5760 hours'),
  ('1fa4bf4d-d04d-4a00-a72a-1f37ba20f6aa', '3fc3da04-549b-4239-aca3-fa82f713dbaf', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'email', '{"sub":"3fc3da04-549b-4239-aca3-fa82f713dbaf","email":"lenamueller@projective.dev","email_verified":true}'::jsonb, now() - interval '4800 hours', now() - interval '4800 hours', now() - interval '4800 hours'),
  ('75f3ecec-77fe-433f-a54e-f7fa98ccb385', '2e4274fb-e76b-4640-ad31-c66d7fbea842', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'email', '{"sub":"2e4274fb-e76b-4640-ad31-c66d7fbea842","email":"tomaszwojcik@projective.dev","email_verified":true}'::jsonb, now() - interval '4320 hours', now() - interval '4320 hours', now() - interval '4320 hours'),
  ('84e9f5b5-9a80-4f26-a87e-b233a21929c4', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'email', '{"sub":"0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb","email":"aikotanaka@projective.dev","email_verified":true}'::jsonb, now() - interval '3600 hours', now() - interval '3600 hours', now() - interval '3600 hours'),
  ('3ea994af-abcd-497a-ad6c-ba8520955158', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'email', '{"sub":"5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd","email":"samuelnkemelu@projective.dev","email_verified":true}'::jsonb, now() - interval '5280 hours', now() - interval '5280 hours', now() - interval '5280 hours'),
  ('6ac0e084-8f7f-4d1b-ae2b-1d62db5e89a1', '35ce4987-15b3-4c38-a438-2bb9c35df15a', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'email', '{"sub":"35ce4987-15b3-4c38-a438-2bb9c35df15a","email":"hannahcole@projective.dev","email_verified":true}'::jsonb, now() - interval '5520 hours', now() - interval '5520 hours', now() - interval '5520 hours'),
  ('27fd3e40-a64d-4b1b-a6d5-4b7aa8c657b5', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'email', '{"sub":"b30145ef-f693-439c-a2c4-8b3db32a54a2","email":"miguelsantos@projective.dev","email_verified":true}'::jsonb, now() - interval '4560 hours', now() - interval '4560 hours', now() - interval '4560 hours'),
  ('5b70018a-7b43-4755-a4ae-47b061ffe15b', '950d68d1-8777-4bbe-ae59-3343e3e7f858', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'email', '{"sub":"950d68d1-8777-4bbe-ae59-3343e3e7f858","email":"chloewinters@projective.dev","email_verified":true}'::jsonb, now() - interval '288 hours', now() - interval '288 hours', now() - interval '288 hours')
ON CONFLICT (provider_id, provider) DO NOTHING;

INSERT INTO org.users_public (user_id, username, first_name, last_name, headline, city, country, timezone, languages, dob, visibility, bio, interests, is_freelancer, is_operator, has_team, has_business, created_at, updated_at)
VALUES
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'marisdelacroix', 'Maris', 'Delacroix', 'Product design lead — design systems and end-to-end product work', 'London', 'United Kingdom', 'Europe/London', ARRAY['English', 'French']::text[], '1989-03-14', 'public', '{"text":"I lead product design for fintech and SaaS teams: from research and flows through to tokenised design systems that engineering can ship from. Twelve years in, still hands-on in Figma every day."}'::jsonb, ARRAY['fintech', 'design systems', 'accessibility']::text[], true, false, false, false, now() - interval '10080 hours', now() - interval '48 hours'),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'renkoda', 'Ren', 'Koda', '3D and motion designer — launch films, WebGL, packaging', 'Berlin', 'Germany', 'Europe/Berlin', ARRAY['English', 'Japanese', 'German']::text[], '1992-11-02', 'public', '{"text":"Motion and 3D for product launches. I script, model and render the sixty seconds that make a product feel inevitable, and I art-direct packaging when the product is something you can hold."}'::jsonb, ARRAY['motion', '3d', 'packaging']::text[], true, false, false, false, now() - interval '9120 hours', now() - interval '48 hours'),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'juno', 'Juno', 'Park', 'Frontend engineer — Preact, signals, accessibility', 'Lisbon', 'Portugal', 'Europe/Lisbon', ARRAY['English', 'Korean', 'Portuguese']::text[], '1995-06-21', 'public', '{"text":"I build fast, accessible frontends and the landing pages that sell them. Preact and signals by preference, Deno on the server, and an audit pass on every page before it ships."}'::jsonb, ARRAY['frontend', 'accessibility', 'performance']::text[], true, false, false, false, now() - interval '5040 hours', now() - interval '48 hours'),
  ('1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'noor', 'Noor', 'Haddad', 'Creative director — hires teams, occasionally takes on advisory work', 'Dubai', 'United Arab Emirates', 'Asia/Dubai', ARRAY['English', 'Arabic']::text[], '1986-01-30', 'public', '{"text":"Creative director running a small studio in Dubai. I commission brand, web and campaign work from independent talent and occasionally advise founders on creative direction."}'::jsonb, ARRAY['branding', 'web', 'campaigns']::text[], false, false, false, false, now() - interval '7200 hours', now() - interval '48 hours'),
  ('2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'theo', 'Theo', 'Almeida', 'Founder, Almeida Coffee Co. — brand and packaging', 'São Paulo', 'Brazil', 'America/Sao_Paulo', ARRAY['Portuguese', 'English']::text[], '1990-09-09', 'public', '{"text":"I run a specialty coffee roastery in São Paulo and buy design work for our packaging, retail and web presence."}'::jsonb, ARRAY['packaging', 'branding', 'retail']::text[], false, false, false, false, now() - interval '3360 hours', now() - interval '48 hours'),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'inesduarte', 'Inês', 'Duarte', 'Brand designer — founder of Atelier Nova', 'Porto', 'Portugal', 'Europe/Lisbon', ARRAY['Portuguese', 'English', 'Spanish']::text[], '1987-04-17', 'public', '{"text":"I founded Atelier Nova to do identity work properly: strategy first, then a system that survives contact with a real marketing team. Ten years of brand work across Portugal and the UK."}'::jsonb, ARRAY['branding', 'typography', 'strategy']::text[], true, false, true, false, now() - interval '9600 hours', now() - interval '48 hours'),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', 'kwamemensah', 'Kwame', 'Mensah', 'Full-stack engineer — Deno, Postgres, realtime — North Loop', 'Manchester', 'United Kingdom', 'Europe/London', ARRAY['English', 'Twi']::text[], '1988-12-05', 'public', '{"text":"I lead North Loop, a small engineering studio shipping realtime products on Deno and Postgres. I care about boring infrastructure and exciting demos, in that order."}'::jsonb, ARRAY['realtime', 'postgres', 'developer tools']::text[], true, false, true, false, now() - interval '8760 hours', now() - interval '48 hours'),
  ('c859a726-490c-4f6d-a184-8984de3994d3', 'saoirsebyrne', 'Saoirse', 'Byrne', 'Editorial designer and mentor — Studio Fern', 'Dublin', 'Ireland', 'Europe/Dublin', ARRAY['English', 'Irish']::text[], '1984-07-23', 'public', '{"text":"Editorial and typographic design, and a mentoring practice for designers moving from agency into product. Studio Fern is where the two meet."}'::jsonb, ARRAY['editorial', 'typography', 'mentoring']::text[], true, false, true, false, now() - interval '7920 hours', now() - interval '48 hours'),
  ('de29f2ce-0f36-4db5-a417-4edc88cedf83', 'priyaraman', 'Priya', 'Raman', 'Head of Product, Helia Finance', 'London', 'United Kingdom', 'Europe/London', ARRAY['English', 'Tamil']::text[], '1985-10-11', 'public', '{"text":"I run product at Helia Finance. We hire independent designers and engineers for the work our core team cannot get to, and we pay on time."}'::jsonb, ARRAY['fintech', 'product']::text[], false, true, false, true, now() - interval '6240 hours', now() - interval '48 hours'),
  ('292e1827-f189-4f34-ab35-27c9f0320926', 'danielokafor', 'Daniel', 'Okafor', 'CTO, Atlas Labs', 'Toronto', 'Canada', 'America/Toronto', ARRAY['English']::text[], '1983-02-27', 'public', '{"text":"CTO at Atlas Labs, a Toronto analytics company. I bring in outside teams for well-scoped builds and keep the core platform in-house."}'::jsonb, ARRAY['analytics', 'data platforms']::text[], false, true, false, true, now() - interval '5760 hours', now() - interval '48 hours'),
  ('3fc3da04-549b-4239-aca3-fa82f713dbaf', 'lenamueller', 'Lena', 'Müller', 'UX researcher — Atelier Nova', 'Berlin', 'Germany', 'Europe/Berlin', ARRAY['German', 'English']::text[], '1993-05-19', 'public', '{"text":"Qualitative research for brand and product teams: interviews, diary studies and the synthesis that turns them into decisions."}'::jsonb, ARRAY['research', 'interviews']::text[], true, false, true, false, now() - interval '4800 hours', now() - interval '48 hours'),
  ('2e4274fb-e76b-4640-ad31-c66d7fbea842', 'tomaszwojcik', 'Tomasz', 'Wójcik', 'Backend engineer — North Loop', 'Kraków', 'Poland', 'Europe/Warsaw', ARRAY['Polish', 'English']::text[], '1991-08-08', 'public', '{"text":"Postgres, queues and the parts of a system nobody sees until they break."}'::jsonb, ARRAY['postgres', 'data pipelines']::text[], true, false, true, false, now() - interval '4320 hours', now() - interval '48 hours'),
  ('0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'aikotanaka', 'Aiko', 'Tanaka', 'Illustrator and visual designer — Studio Fern, Atelier Nova', 'Osaka', 'Japan', 'Asia/Tokyo', ARRAY['Japanese', 'English']::text[], '1996-03-03', 'public', '{"text":"Illustration and visual design for brands that want a hand-drawn edge. I work with two studios and take a small number of direct commissions."}'::jsonb, ARRAY['illustration', 'branding']::text[], true, false, true, false, now() - interval '3600 hours', now() - interval '48 hours'),
  ('5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'samuelnkemelu', 'Samuel', 'Nkemelu', 'Mobile engineer (iOS and Android) — North Loop mobile lead', 'Lagos', 'Nigeria', 'Africa/Lagos', ARRAY['English', 'Igbo']::text[], '1990-11-15', 'public', '{"text":"Native mobile for products that need to feel native. I lead mobile at North Loop and still write most of the Swift myself."}'::jsonb, ARRAY['mobile', 'swift', 'kotlin']::text[], true, false, true, false, now() - interval '5280 hours', now() - interval '48 hours'),
  ('35ce4987-15b3-4c38-a438-2bb9c35df15a', 'hannahcole', 'Hannah', 'Cole', 'Product manager at Helia Finance', 'London', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1991-01-25', 'public', '{"text":"I run the wallet and design-system workstreams at Helia and manage the external talent we bring in on them."}'::jsonb, ARRAY['fintech', 'design systems']::text[], false, true, false, true, now() - interval '5520 hours', now() - interval '48 hours'),
  ('b30145ef-f693-439c-a2c4-8b3db32a54a2', 'miguelsantos', 'Miguel', 'Santos', 'Design ops at Atlas Labs', 'Toronto', 'Canada', 'America/Toronto', ARRAY['English', 'Portuguese']::text[], '1989-06-30', 'public', '{"text":"Design operations at Atlas: tooling, hiring and keeping the design system honest."}'::jsonb, ARRAY['design ops', 'mobile']::text[], false, true, false, true, now() - interval '4560 hours', now() - interval '48 hours'),
  ('950d68d1-8777-4bbe-ae59-3343e3e7f858', 'chloewinters', 'Chloe', 'Winters', 'Freelance copywriter — brand voice and UX writing', 'Edinburgh', 'United Kingdom', 'Europe/London', ARRAY['English']::text[], '1994-12-12', 'public', '{"text":"Words for products and brands: naming, voice guidelines, onboarding copy and the microcopy nobody notices until it is wrong. New here — say hello."}'::jsonb, ARRAY['copywriting', 'ux writing']::text[], true, false, false, false, now() - interval '288 hours', now() - interval '48 hours')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO org.user_emails (id, user_id, email, is_primary, verified_at, created_at)
VALUES
  ('45197c30-d72f-42ed-aaa0-bbf28b874757', '6ce1906f-caab-4708-a19e-df3d8960666e', 'marisdelacroix@projective.dev', true, now() - interval '10080 hours', now() - interval '10080 hours'),
  ('ee33cfb1-226a-4cfe-a6a0-41bbcf3398e0', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'renkoda@projective.dev', true, now() - interval '9120 hours', now() - interval '9120 hours'),
  ('871cab75-1449-4014-ab4e-5f0f486afbe6', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'juno@projective.dev', true, now() - interval '5040 hours', now() - interval '5040 hours'),
  ('f96bfd11-aa51-48b0-a760-53bf62bc8726', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'noor@projective.dev', true, now() - interval '7200 hours', now() - interval '7200 hours'),
  ('4a03ff37-3664-4532-a08a-bf11cfddb09c', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'theo@projective.dev', true, now() - interval '3360 hours', now() - interval '3360 hours'),
  ('1e3878e7-a528-4572-a155-bd19c398f394', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'inesduarte@projective.dev', true, now() - interval '9600 hours', now() - interval '9600 hours'),
  ('0fde6f1e-76c8-402d-a062-ac08936d7ae7', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'kwamemensah@projective.dev', true, now() - interval '8760 hours', now() - interval '8760 hours'),
  ('1c862c95-1dfc-49d4-a345-4d7ffbed4bae', 'c859a726-490c-4f6d-a184-8984de3994d3', 'saoirsebyrne@projective.dev', true, now() - interval '7920 hours', now() - interval '7920 hours'),
  ('2d97b73d-d161-428c-a120-5e4ffd887cf6', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'priyaraman@projective.dev', true, now() - interval '6240 hours', now() - interval '6240 hours'),
  ('fce6de5c-c28d-4959-a77c-f21a2d49538f', '292e1827-f189-4f34-ab35-27c9f0320926', 'danielokafor@projective.dev', true, now() - interval '5760 hours', now() - interval '5760 hours'),
  ('380be861-4f86-4512-aaa5-633b542d89ac', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'lenamueller@projective.dev', true, now() - interval '4800 hours', now() - interval '4800 hours'),
  ('e865f598-6aac-41dd-a4df-85a6b6fc5c33', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'tomaszwojcik@projective.dev', true, now() - interval '4320 hours', now() - interval '4320 hours'),
  ('1fa36ec1-0c97-4a5c-a82b-eb6f15a4a8da', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'aikotanaka@projective.dev', true, now() - interval '3600 hours', now() - interval '3600 hours'),
  ('a4e4fdcb-159f-4cd0-a1f9-f271eeafa1de', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'samuelnkemelu@projective.dev', true, now() - interval '5280 hours', now() - interval '5280 hours'),
  ('4bcd14a0-713d-4569-ab21-6a5e9af8edcf', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'hannahcole@projective.dev', true, now() - interval '5520 hours', now() - interval '5520 hours'),
  ('a8ba3954-0533-496d-aa75-ce7eea5f4d27', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'miguelsantos@projective.dev', true, now() - interval '4560 hours', now() - interval '4560 hours'),
  ('b5cc7996-4400-4db3-ae56-d01c5ea68529', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'chloewinters@projective.dev', true, now() - interval '288 hours', now() - interval '288 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.user_preferences (user_id, preferred_display_currency, locale, theme)
VALUES
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'GBP', 'en-GB', 'system'),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'EUR', 'de-DE', 'system'),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'EUR', 'pt-PT', 'system'),
  ('1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'AED', 'en-GB', 'system'),
  ('2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'BRL', 'pt-BR', 'system'),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'EUR', 'pt-PT', 'system'),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', 'GBP', 'en-GB', 'system'),
  ('c859a726-490c-4f6d-a184-8984de3994d3', 'EUR', 'en-GB', 'system'),
  ('de29f2ce-0f36-4db5-a417-4edc88cedf83', 'GBP', 'en-GB', 'system'),
  ('292e1827-f189-4f34-ab35-27c9f0320926', 'CAD', 'en-CA', 'system'),
  ('3fc3da04-549b-4239-aca3-fa82f713dbaf', 'EUR', 'de-DE', 'system'),
  ('2e4274fb-e76b-4640-ad31-c66d7fbea842', 'PLN', 'pl-PL', 'system'),
  ('0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'JPY', 'ja-JP', 'system'),
  ('5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'USD', 'en-GB', 'system'),
  ('35ce4987-15b3-4c38-a438-2bb9c35df15a', 'GBP', 'en-GB', 'system'),
  ('b30145ef-f693-439c-a2c4-8b3db32a54a2', 'CAD', 'en-CA', 'system'),
  ('950d68d1-8777-4bbe-ae59-3343e3e7f858', 'GBP', 'en-GB', 'system')
ON CONFLICT (user_id) DO UPDATE SET preferred_display_currency = EXCLUDED.preferred_display_currency, locale = EXCLUDED.locale;

INSERT INTO org.freelancer_profiles (user_id, skills, availability_status, current_workload_intensity, max_workload_intensity, available_since, kyc_status, kyc_tier, kyc_verified_at, payout_ready, identity_provider_ref, created_at)
VALUES
  ('6ce1906f-caab-4708-a19e-df3d8960666e', ARRAY['ux', 'design-systems', 'figma', 'prototyping']::text[], 'busy', 4, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_marisdelacroix', now() - interval '10080 hours'),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', ARRAY['webgl', 'blender', 'three-js', 'motion-design']::text[], 'busy', 5, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_renkoda', now() - interval '9120 hours'),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', ARRAY['preact', 'typescript', 'a11y', 'deno']::text[], 'available', 1, 5.00, now() - interval '336 hours', 'pending', NULL, NULL, false, 'vs_seed_juno', now() - interval '5040 hours'),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', ARRAY['branding', 'identity-systems', 'typography', 'art-direction']::text[], 'available', 3, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_inesduarte', now() - interval '9600 hours'),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', ARRAY['deno', 'postgres', 'typescript', 'realtime']::text[], 'busy', 3, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_kwamemensah', now() - interval '8760 hours'),
  ('c859a726-490c-4f6d-a184-8984de3994d3', ARRAY['editorial-design', 'typography', 'mentoring', 'notion']::text[], 'available', 2, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_saoirsebyrne', now() - interval '7920 hours'),
  ('3fc3da04-549b-4239-aca3-fa82f713dbaf', ARRAY['ux-research', 'user-interviews', 'figma']::text[], 'available', 2, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_lenamueller', now() - interval '4800 hours'),
  ('2e4274fb-e76b-4640-ad31-c66d7fbea842', ARRAY['postgres', 'deno', 'typescript']::text[], 'available', 3, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_tomaszwojcik', now() - interval '4320 hours'),
  ('0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', ARRAY['illustration', 'procreate', 'branding']::text[], 'available', 2, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_aikotanaka', now() - interval '3600 hours'),
  ('5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', ARRAY['swift', 'kotlin', 'react-native']::text[], 'busy', 3, 5.00, now() - interval '336 hours', 'verified', 2, now() - interval '1440 hours', true, 'vs_seed_samuelnkemelu', now() - interval '5280 hours'),
  ('950d68d1-8777-4bbe-ae59-3343e3e7f858', ARRAY['copywriting', 'ux-writing', 'brand-voice']::text[], 'available', 1, 5.00, now() - interval '288 hours', 'unverified', NULL, NULL, false, NULL, now() - interval '288 hours')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO org.user_skills (user_id, skill_id, proficiency)
VALUES
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'ecd69ae1-2226-4f5c-afb3-0e678f99d11a', 5),
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'e014d9ad-c5dd-4b18-af8f-a893b3d7a43e', 5),
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'ad071368-f79b-42b7-ac74-308a94a4ec19', 4),
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'dc53c67d-79a7-4f6e-a432-4a8b885e92cc', 4),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', '70528859-94ce-4f4e-a75f-27cf4d6ea264', 5),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', '06b31d5c-00bd-497b-afd6-da026c48c969', 5),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', '31b7eba8-879f-4e05-a1af-6002dcda704f', 4),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', '5a45a313-1365-4f44-a03c-3afd37cfe2f6', 4),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', '848229b3-cbff-4c2e-a94a-b3f9e0e767bc', 5),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', '534e98b7-185b-4816-a990-e7c925109b78', 5),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', '27197668-1eff-486d-a4ed-1f861a38ba83', 4),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', '0ed029c4-7fa2-4f6d-aa08-681a474ac723', 4),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '26045b67-b728-4856-af7c-eb4998e1d378', 5),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '9e6501c1-a6c8-406c-aaed-fe5782f63162', 5),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'ff131961-54ae-4ae0-ad63-61e3795ab8a2', 4),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '382b44ad-84a5-4536-a23d-eb1b01d39a1c', 4),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', '0ed029c4-7fa2-4f6d-aa08-681a474ac723', 5),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', 'b935eb8b-f83b-4a7a-a072-9f6d3acb265c', 5),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', '534e98b7-185b-4816-a990-e7c925109b78', 4),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', 'ef7f5d79-8ad3-4770-a55f-a123a3dc3a7a', 4),
  ('c859a726-490c-4f6d-a184-8984de3994d3', 'aa80d44a-6c35-4b8f-a455-5a8c8edde7e1', 5),
  ('c859a726-490c-4f6d-a184-8984de3994d3', 'ff131961-54ae-4ae0-ad63-61e3795ab8a2', 5),
  ('c859a726-490c-4f6d-a184-8984de3994d3', '38786dcb-b2f9-4bd8-a389-58f90afaafb6', 4),
  ('c859a726-490c-4f6d-a184-8984de3994d3', '6cfda1bd-ba18-4438-ab8f-f36b2d1988be', 4),
  ('3fc3da04-549b-4239-aca3-fa82f713dbaf', '0bb16fe9-d937-41fa-aa9e-41cb58cd943c', 5),
  ('3fc3da04-549b-4239-aca3-fa82f713dbaf', '95f106ca-2ec7-4d99-af36-8988dc3c29df', 5),
  ('3fc3da04-549b-4239-aca3-fa82f713dbaf', 'ad071368-f79b-42b7-ac74-308a94a4ec19', 4),
  ('2e4274fb-e76b-4640-ad31-c66d7fbea842', 'b935eb8b-f83b-4a7a-a072-9f6d3acb265c', 5),
  ('2e4274fb-e76b-4640-ad31-c66d7fbea842', '0ed029c4-7fa2-4f6d-aa08-681a474ac723', 5),
  ('2e4274fb-e76b-4640-ad31-c66d7fbea842', '534e98b7-185b-4816-a990-e7c925109b78', 4),
  ('0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'f562f712-3251-4e47-a4da-dfb0031a44d5', 5),
  ('0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'beba8f27-5dd4-48a0-a7ff-90199f35a34a', 5),
  ('0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', '26045b67-b728-4856-af7c-eb4998e1d378', 4),
  ('5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', '195fe3cf-c420-4f54-ad9f-3cfd0081a90a', 5),
  ('5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', '8a886841-d562-4d58-a101-b153da678aba', 5),
  ('5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', '52e8301d-bc40-4394-a7ba-596b162ddb0a', 4),
  ('950d68d1-8777-4bbe-ae59-3343e3e7f858', 'a848244b-83a6-4330-af71-e745f8822d52', 5),
  ('950d68d1-8777-4bbe-ae59-3343e3e7f858', 'a58d79f4-ff93-4621-ab32-a46a2c0b31df', 5),
  ('950d68d1-8777-4bbe-ae59-3343e3e7f858', '0767af46-3dbc-45f9-aef5-1328125cbd9b', 4)
ON CONFLICT (user_id, skill_id) DO NOTHING;

INSERT INTO org.user_languages (user_id, code, level)
VALUES
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'en', 'native'),
  ('6ce1906f-caab-4708-a19e-df3d8960666e', 'fr', 'fluent'),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'ja', 'native'),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'en', 'fluent'),
  ('bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'de', 'conversational'),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'ko', 'native'),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'en', 'fluent'),
  ('45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'pt', 'conversational'),
  ('1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'ar', 'native'),
  ('1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'en', 'fluent'),
  ('2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'pt', 'native'),
  ('2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'en', 'professional'),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'pt', 'native'),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'en', 'fluent'),
  ('9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'es', 'professional'),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', 'en', 'native'),
  ('c7173d3f-8b15-4876-afbf-499d17513a44', 'tw', 'native'),
  ('c859a726-490c-4f6d-a184-8984de3994d3', 'en', 'native'),
  ('c859a726-490c-4f6d-a184-8984de3994d3', 'ga', 'conversational'),
  ('de29f2ce-0f36-4db5-a417-4edc88cedf83', 'en', 'native'),
  ('de29f2ce-0f36-4db5-a417-4edc88cedf83', 'ta', 'native'),
  ('292e1827-f189-4f34-ab35-27c9f0320926', 'en', 'native'),
  ('3fc3da04-549b-4239-aca3-fa82f713dbaf', 'de', 'native'),
  ('3fc3da04-549b-4239-aca3-fa82f713dbaf', 'en', 'fluent'),
  ('2e4274fb-e76b-4640-ad31-c66d7fbea842', 'pl', 'native'),
  ('2e4274fb-e76b-4640-ad31-c66d7fbea842', 'en', 'professional'),
  ('0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'ja', 'native'),
  ('0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'en', 'professional'),
  ('5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'en', 'native'),
  ('5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'ig', 'native'),
  ('35ce4987-15b3-4c38-a438-2bb9c35df15a', 'en', 'native'),
  ('b30145ef-f693-439c-a2c4-8b3db32a54a2', 'pt', 'native'),
  ('b30145ef-f693-439c-a2c4-8b3db32a54a2', 'en', 'fluent'),
  ('950d68d1-8777-4bbe-ae59-3343e3e7f858', 'en', 'native')
ON CONFLICT (user_id, code) DO NOTHING;

INSERT INTO org.profile_links (id, profile_type, profile_id, kind, url, is_public)
VALUES
  ('b2f98651-6983-4652-a1fc-60179ab2e848', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', 'website', 'https://marisdelacroix.design', true),
  ('a3d7613e-e4d7-4d47-ae82-b2608eec6d01', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', 'linkedin', 'https://linkedin.com/in/marisdelacroix', true),
  ('60e2a074-2923-4dd1-ae4e-1892200ed06f', 'user', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'website', 'https://renkoda.studio', true),
  ('e91dce70-5f77-4759-a403-27becbf7a897', 'user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'github', 'https://github.com/junopark', true),
  ('6b8dcbd2-056b-4875-aa2f-09f8bdffdb7b', 'user', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'website', 'https://ateliernova.pt', true),
  ('fc1b5f49-7ec0-431a-a9ec-e64719aded20', 'user', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'github', 'https://github.com/kwamemensah', true),
  ('9d68d9a0-594a-414f-aa5f-45be56645b9d', 'user', 'c859a726-490c-4f6d-a184-8984de3994d3', 'website', 'https://studiofern.ie', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.verification_cases (id, subject_type, subject_id, kind, status, tier, provider, provider_ref, submitted_at, decided_at, notes)
VALUES
  ('fe67055b-7759-4812-ac3b-b19525ffa08c', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_marisdelacroix', now() - interval '1464 hours', now() - interval '1440 hours', NULL),
  ('1f9e8ec4-0128-475b-abc7-b7e65dfdcf1d', 'freelancer', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_renkoda', now() - interval '1464 hours', now() - interval '1440 hours', NULL),
  ('e221639a-52f6-472f-a364-e44cf7fd9751', 'freelancer', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'kyc', 'pending', 2, 'stripe_identity', 'vs_seed_juno', now() - interval '1464 hours', NULL, 'Document uploaded; awaiting provider decision.'),
  ('78aba300-2393-4e39-a723-c3da72b25c2b', 'freelancer', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_inesduarte', now() - interval '1464 hours', now() - interval '1440 hours', NULL),
  ('f4a8b34b-e92f-49a8-a82d-71d5f826963a', 'freelancer', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_kwamemensah', now() - interval '1464 hours', now() - interval '1440 hours', NULL),
  ('ee5ca20a-0701-419f-a5c6-5efc708c4609', 'freelancer', 'c859a726-490c-4f6d-a184-8984de3994d3', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_saoirsebyrne', now() - interval '1464 hours', now() - interval '1440 hours', NULL),
  ('b0a1df48-9b17-4edb-ac20-feda8aaf3a75', 'freelancer', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_lenamueller', now() - interval '1464 hours', now() - interval '1440 hours', NULL),
  ('02eefc37-f1e9-41c6-abb4-095553bc9c24', 'freelancer', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_tomaszwojcik', now() - interval '1464 hours', now() - interval '1440 hours', NULL),
  ('c23b7a5e-6127-4a8f-ac87-7d744d19940d', 'freelancer', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_aikotanaka', now() - interval '1464 hours', now() - interval '1440 hours', NULL),
  ('27eabc52-b8aa-4611-a4f2-62a85459db87', 'freelancer', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'kyc', 'verified', 2, 'stripe_identity', 'vs_seed_samuelnkemelu', now() - interval '1464 hours', now() - interval '1440 hours', NULL)
ON CONFLICT (id) DO NOTHING;
