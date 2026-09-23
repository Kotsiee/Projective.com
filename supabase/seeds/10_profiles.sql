-- =============================================================================================
-- 10_profiles.sql — the public profile's presentation: showcase, selected work, certifications, privacy
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- Rows keyed by persona / entity in supabase/seeds/gen/profiles.ts. The files they reference are written by 02_assets.sql; showcase slots are renditions in the public `showcase` bucket, exactly as the media pipeline lays one out.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO org.profile_showcase_items (id, owner_type, owner_id, position, file_id, alt, created_by, created_at, updated_at)
VALUES
  ('102282c8-5608-49f3-a05a-5a622ccb2d1d', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', 1, '6c7bf7da-1372-4dfb-a08d-ba00884cf9c1', 'Design system component sheet for a fintech dashboard', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '720 hours', now() - interval '720 hours'),
  ('13228781-5708-4b86-af5a-58cf29cb2864', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', 2, 'ea8192c2-f6ce-48f3-a033-0714125d5d0d', 'Workshop wall of journey maps and product flows', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '696 hours', now() - interval '696 hours'),
  ('122285ee-5808-4d19-ae5a-573c2acb29f7', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', 3, 'cf9be95f-ff07-40de-aed3-6d3d14b955a4', 'Mobile onboarding screens in light and dark themes', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '672 hours', now() - interval '672 hours'),
  ('15228aa7-5908-4eac-ad5a-55a927cb253e', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', 4, '61b3220b-b6ed-4d68-aae5-2d6520b00c32', 'Token audit laid out across three brand palettes', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '648 hours', now() - interval '648 hours'),
  ('dd1e4371-e5ad-415a-a2c0-8ddb623e27ac', 'user', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 1, '03081195-0a82-461e-a14c-f9d37efde114', 'Still from a 3D product launch film', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '720 hours', now() - interval '720 hours'),
  ('da1e3eb8-e4ad-4fc7-a3c0-8f6e653e2c65', 'user', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 2, '07af921b-0f47-4f54-a72a-a3b9bb21778a', 'Packaging render with studio lighting', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '696 hours', now() - interval '696 hours'),
  ('db1e404b-e3ad-4e34-a4c0-9101643e2ad2', 'user', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 3, 'd38e0fc1-2d94-4364-a8d5-e0dbc83b35a6', 'Motion storyboard frames for a launch sequence', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '672 hours', now() - interval '672 hours'),
  ('157ebff8-0bce-4a25-a489-0efa91f74a07', 'user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 1, 'e0ddea8f-05ab-42da-a8e3-aec1ab260954', 'Accessible component library shown in a browser', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '720 hours', now() - interval '720 hours'),
  ('187ec4b1-08ce-456c-a389-0d6792f74b9a', 'user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 2, 'e57d889c-4078-42a5-a52c-690ee3c4f797', 'Signal-driven dashboard running at sixty frames a second', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '696 hours', now() - interval '696 hours'),
  ('177ec31e-09ce-46ff-a289-0bd493f74d2d', 'user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 3, '26cb1752-619e-4c0f-aa6c-bf4460e9b2a1', 'Keyboard navigation map for a data table', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '672 hours', now() - interval '672 hours'),
  ('e799a611-4831-4d64-adcb-9207c93801fa', 'user', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 1, 'e982b68a-e042-4543-a5a5-a640d9c52549', 'Identity system for a coffee roaster', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '720 hours', now() - interval '720 hours'),
  ('e499a158-4b31-421d-aecb-939ac8380067', 'user', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 2, 'b04179ab-d87f-4236-a936-77c93d4fd094', 'Brand guidelines spread with type and colour pages', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '696 hours', now() - interval '696 hours'),
  ('e599a2eb-4a31-408a-afcb-952dc737fed4', 'user', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 3, '8ea9ffbb-f891-4692-a159-a0452ec4519c', 'Launch assets across print and social', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '672 hours', now() - interval '672 hours'),
  ('ea99aaca-4531-48ab-a8cb-8a28c637fd41', 'user', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 4, '9dd67f17-ac39-4dda-abe5-2d75a0e6caf0', 'Packaging family in the new identity', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '648 hours', now() - interval '648 hours'),
  ('eb99ac5d-4431-4718-a9cb-8bbbc537fbae', 'user', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 5, 'e586f150-fb42-4ee3-a9ec-40b27e8351a5', 'Logo construction grid', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '624 hours', now() - interval '624 hours'),
  ('65142bf3-4917-456c-a249-365d5f3fd13e', 'user', 'c7173d3f-8b15-4876-afbf-499d17513a44', 1, '3c75f70d-a331-40fa-a182-fbef1ebc767c', 'Realtime operations dashboard', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '720 hours', now() - interval '720 hours'),
  ('66142d86-4c17-4a25-af49-31a45e3fcfab', 'user', 'c7173d3f-8b15-4876-afbf-499d17513a44', 2, '067b7b6e-5ca5-4977-a204-4168fb7fda91', 'Architecture diagram for a Deno and Postgres service', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '696 hours', now() - interval '696 hours'),
  ('f2b32a5e-fe4c-41a1-a299-375825739d63', 'user', 'c859a726-490c-4f6d-a184-8984de3994d3', 1, 'ac2f47b4-e22f-43e7-aa1c-7f3edd5ef9d9', 'Editorial feature spread with pull quotes', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '720 hours', now() - interval '720 hours'),
  ('f1b328cb-fb4c-4ce8-a599-3c1126739ef6', 'user', 'c859a726-490c-4f6d-a184-8984de3994d3', 2, '36a44150-c71c-42bd-ae2a-0bc6b87784a3', 'Magazine cover series', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '696 hours', now() - interval '696 hours'),
  ('f0b32738-fc4c-4e7b-a499-3a7e2773a089', 'user', 'c859a726-490c-4f6d-a184-8984de3994d3', 3, '1c1fc30a-3635-484b-ab0b-85f0232d4c69', 'Typographic grid for a long-read layout', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '672 hours', now() - interval '672 hours'),
  ('92f97e62-4940-452f-ad1e-43f0a470faa5', 'user', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 1, 'ab269da9-1185-41fc-a2f6-e09fe0e7f892', 'Illustrated campaign poster', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '720 hours', now() - interval '720 hours'),
  ('91f97ccf-4a40-46c2-a01e-48a9a170f5ec', 'user', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 2, '4ceb461f-181c-4f90-a5b8-48c5a6bf0fa6', 'Character sheet for a children''s app', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '696 hours', now() - interval '696 hours'),
  ('90f97b3c-4b40-4855-af1e-4716a270f77f', 'user', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 3, '6964e7af-88b7-4ab0-aa97-0ba1106c6542', 'Spot illustrations for an onboarding flow', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '672 hours', now() - interval '672 hours'),
  ('33aab540-6b7b-48e5-ac5f-5e82782495bf', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 1, 'e216a6a3-babd-46ec-a94e-17590e86b79a', 'Atelier Nova studio work across identity and launch', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '720 hours', now() - interval '720 hours'),
  ('36aab9f9-687b-442c-ab5f-5cef79249752', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 2, 'af59282d-3fd4-4384-aa1a-f67f426fd626', 'A roaster''s identity system', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '696 hours', now() - interval '696 hours'),
  ('35aab866-697b-45bf-aa5f-5b5c7a2498e5', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 3, 'bf4416ba-ef1d-4aab-a8d8-8dd8749e1a71', 'Guidelines system delivered to a client team', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '672 hours', now() - interval '672 hours'),
  ('0d31445b-8b80-4b20-a5f6-3d09c029b8d6', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 1, '207cca65-1486-4efe-a8e8-5f3b1ae00c04', 'North Loop''s realtime product work', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '720 hours', now() - interval '720 hours'),
  ('0e3145ee-8e80-4fd9-a2f6-3850bf29b743', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 2, '238f5735-5943-4606-a4b1-f143ec6101ec', 'Live operations dashboard shipped for a logistics client', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '696 hours', now() - interval '696 hours'),
  ('ef7c37a7-9b9a-40a6-a3a5-1e69d8103208', 'team', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 1, '59fddfbe-785e-4655-a945-6b140c1bcf0b', 'Studio Fern editorial and illustration work', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '720 hours', now() - interval '720 hours'),
  ('f07c393a-9a9a-4f13-a0a5-19b0db1036c1', 'team', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 2, '3cf9f610-fc8a-4e05-a01f-421ad1cde8c7', 'Cover series for an independent magazine', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '696 hours', now() - interval '696 hours')
ON CONFLICT (owner_type, owner_id, position) DO NOTHING;

INSERT INTO org.portfolios (id, user_id, title, description, cover_file_id, client_name, category, sort_order, is_public, created_at)
VALUES
  ('8f988ce3-a5f8-4fd4-af53-ee455fd2cd5e', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Helia wallet design system', 'A token-driven component library across web and native, shipped with its own contribution model.', '093e9d4c-0e4f-4f09-aa0e-031252b5d957', 'Helia Finance', 'Design systems', 0, true, now() - interval '1440 hours'),
  ('8e988b50-a6f8-4167-ae53-ecb260d2cef1', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Checkout that explains itself', 'A four-step purchase flow rebuilt around one visible total and plain-language fees.', '21f1ab21-9ef6-4614-a562-4d7b4c078d4e', NULL, 'Product design', 1, true, now() - interval '1272 hours'),
  ('91989009-a7f8-42fa-ad53-eb1f5dd2ca38', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Research-led onboarding', 'Onboarding reworked from twelve interviews; activation up by a third in the first month.', 'f25f5e92-8c68-4023-a0ed-41ccf916db9d', 'Atlas Labs', 'Product design', 2, true, now() - interval '1104 hours'),
  ('bb8b0d76-16ad-4d69-a73c-6eb8cc3a526b', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'Launch film for a smart speaker', 'Forty-five seconds of product motion, modelled, lit and cut in-house.', 'f4163ea3-9fd9-475c-a375-94d9afc5e87a', NULL, 'Motion', 0, true, now() - interval '1440 hours'),
  ('bc8b0f09-15ad-4bd6-a83c-704bcb3a50d8', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'Packaging in 3D', 'Photoreal packaging renders delivered before the first print run existed.', '4011b874-d325-4e2b-ae1d-999ee4fb7ed5', NULL, '3D', 1, true, now() - interval '1272 hours'),
  ('3d310b13-941d-477e-ad1a-eddd301db730', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'An accessible data table', 'Keyboard-first sorting, filtering and virtualised rows that a screen reader can follow.', 'c1f928c9-b601-45e8-a39e-cb074f6e9646', NULL, 'Frontend', 0, true, now() - interval '1440 hours'),
  ('3c310980-951d-4911-ac1a-ec4a311db8c3', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'Realtime analytics dashboard', 'Preact and signals rendering thousands of live points without dropping a frame.', '5027a9d4-4c2f-427d-a369-cdfe33911c6f', 'Atlas Labs', 'Frontend', 1, true, now() - interval '1272 hours'),
  ('ceec75d6-2b20-4d9b-ac84-f6c473edf841', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'Almeida Coffee Co. identity', 'Wordmark, packaging system and launch assets for a family roaster.', 'ce4ddf1a-3432-42eb-ac14-50b81e3a1f49', 'Almeida Coffee Co.', 'Brand identity', 0, true, now() - interval '1440 hours'),
  ('cfec7769-2a20-4c08-ad84-f85772edf6ae', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'Guidelines people actually open', 'A brand book rebuilt as a searchable site with ready-to-use templates.', '36fb0fa3-6b2d-4982-ae0a-500dac68a054', NULL, 'Brand identity', 1, true, now() - interval '1272 hours'),
  ('3b16e5e8-bdb4-4fe3-a30a-a27a58108545', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'Live operations board', 'A realtime Postgres-backed board for a dispatch team, built on Deno.', 'e8b20a28-93bc-4ce3-a92a-7c86721847b9', NULL, 'Engineering', 0, true, now() - interval '1440 hours'),
  ('8dc958b9-d454-4d6a-a7ed-fc1b88f9f3ac', 'c859a726-490c-4f6d-a184-8984de3994d3', 'Long-read layout system', 'An editorial grid and type scale for an independent magazine''s web edition.', '50084d0b-afc2-49b4-ab67-ddcd156c763e', NULL, 'Editorial design', 0, true, now() - interval '1440 hours'),
  ('b7360c3d-3c13-4af8-aeb7-7cb3b32d853e', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'Campaign illustration series', 'Six posters and their social cut-downs for a city arts festival.', '9b620e14-b7f6-4db5-a881-108286dae263', NULL, 'Illustration', 0, true, now() - interval '1440 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.certifications (id, user_id, name, issuer, issued_year, expires_year, credential_url, verified, verified_at, sort_order, created_at)
VALUES
  ('7194ab8d-82d4-4b0a-a6ee-c1b300f7a400', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Certified Usability Analyst', 'Human Factors International', '2021', NULL, 'https://www.humanfactors.com/certification', true, now() - interval '2880 hours', 0, now() - interval '4800 hours'),
  ('d56ae405-0cbc-4af4-abb3-bbe3bae20132', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'Web Accessibility Specialist', 'IAAP', '2023', '2026', 'https://www.accessibilityassociation.org/certification', true, now() - interval '1080 hours', 0, now() - interval '4800 hours'),
  ('3e5a49c2-b749-4251-a8b7-48184bfe6b9f', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'AWS Certified Solutions Architect – Associate', 'Amazon Web Services', '2022', '2025', NULL, false, NULL, 0, now() - interval '4800 hours'),
  ('93d9c1c5-9cca-43f0-adcc-b153734217ce', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'UX Research Certification', 'Nielsen Norman Group', '2020', NULL, 'https://www.nngroup.com/ux-certification/', false, NULL, 0, now() - interval '4800 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.profile_settings (owner_type, owner_id, allow_avatar_expand, show_location, show_local_time)
VALUES
  ('user', '6ce1906f-caab-4708-a19e-df3d8960666e', true, true, true),
  ('user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', true, true, true),
  ('user', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', false, true, false),
  ('user', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', false, false, true)
ON CONFLICT (owner_type, owner_id) DO NOTHING;
