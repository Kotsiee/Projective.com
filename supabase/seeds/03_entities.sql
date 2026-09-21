-- =============================================================================================
-- 03_entities.sql — teams and businesses, roles, memberships, invitations, follows
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- A team is a Freelancer with multiple members (seller side); a business is a Client with multiple members (buyer side). Owners and members were seeded in 01; brand images in 02.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO org.teams (id, owner_user_id, name, slug, avatar_file_id, banner_file_id, headline, bio, visibility, subscription_tier, member_limit, payout_model, current_workload_intensity, available_since, status, created_at)
VALUES
  ('213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'Atelier Nova', 'ateliernova', '140715cd-3aa6-4000-a615-fbef7cba4f7a', '68588544-1047-4f29-a0bc-55f62548d873', 'Brand identity studio — strategy, identity systems and launch assets', '{"text":"A three-person identity studio in Porto and Berlin. We take brands from a positioning workshop through to a system a marketing team can actually run."}'::jsonb, 'public', 'pro', 15, 'split_rules', 30, now() - interval '336 hours', 'active', now() - interval '9600 hours'),
  ('edc2d943-8062-426a-a6f2-29fdc6b4363c', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'North Loop', 'northloop', 'e72ec0b7-9712-43da-a109-fc39221dd434', '27963e1e-c5fa-4f53-a0c6-86082fb348c5', 'Realtime product engineering — Deno, Postgres, native mobile', '{"text":"An engineering studio that ships realtime products end to end: schema, API, web and native mobile. Small on purpose."}'::jsonb, 'public', 'free', 5, 'split_rules', 30, now() - interval '336 hours', 'active', now() - interval '8760 hours'),
  ('a4c25501-0fdd-4abe-a575-ff478daad4fc', 'c859a726-490c-4f6d-a184-8984de3994d3', 'Studio Fern', 'studiofern', '0e56ec8f-280c-4d6a-a72e-b61d1864a588', NULL, 'Editorial design, illustration and mentoring for designers', '{"text":"Editorial and illustration work, plus a mentoring practice — portfolio reviews, live sessions and a six-session mentorship block."}'::jsonb, 'public', 'free', 5, 'split_rules', 30, now() - interval '336 hours', 'active', now() - interval '7920 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.team_roles (id, team_id, name, summary, permissions, is_system)
VALUES
  ('aec78852-674b-4b2f-a537-a1dc34b46ec9', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'Owner', 'Owner of Atelier Nova', ARRAY['manage_profile', 'manage_portfolio', 'manage_members', 'manage_roles', 'manage_services', 'manage_projects', 'send_messages', 'manage_finances']::org.team_permission[], true),
  ('0e7ad3a9-48c1-445e-a6b9-f637631a48bc', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'Lead', 'Lead of Atelier Nova', ARRAY['manage_portfolio', 'manage_services', 'manage_projects', 'send_messages']::org.team_permission[], true),
  ('aeff2d66-2c2a-403f-ad34-9bec258fa555', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'Admin', 'Admin of Atelier Nova', ARRAY['manage_profile', 'manage_portfolio', 'manage_members', 'manage_services', 'manage_projects', 'send_messages']::org.team_permission[], true),
  ('d1734355-7638-460a-af51-5f7b275b96a0', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'Member', 'Member of Atelier Nova', ARRAY['send_messages']::org.team_permission[], true),
  ('0e2661ed-7974-4bba-a0df-7b9b61da8358', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'Owner', 'Owner of North Loop', ARRAY['manage_profile', 'manage_portfolio', 'manage_members', 'manage_roles', 'manage_services', 'manage_projects', 'send_messages', 'manage_finances']::org.team_permission[], true),
  ('53f4a920-9ca4-4b71-a99a-21ba049a8793', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'Lead', 'Lead of North Loop', ARRAY['manage_portfolio', 'manage_services', 'manage_projects', 'send_messages']::org.team_permission[], true),
  ('1b5c17f1-f110-473e-adc8-5b4341f79bf0', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'Admin', 'Admin of North Loop', ARRAY['manage_profile', 'manage_portfolio', 'manage_members', 'manage_services', 'manage_projects', 'send_messages']::org.team_permission[], true),
  ('7754434c-42d0-408d-aaae-f77e89287aef', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'Member', 'Member of North Loop', ARRAY['send_messages']::org.team_permission[], true),
  ('af0bb80d-914d-430c-a519-41df08339bc6', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Owner', 'Owner of Studio Fern', ARRAY['manage_profile', 'manage_portfolio', 'manage_members', 'manage_roles', 'manage_services', 'manage_projects', 'send_messages', 'manage_finances']::org.team_permission[], true),
  ('c2b5e5c0-d2c9-4687-acbe-6f6e68605f6d', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Lead', 'Lead of Studio Fern', ARRAY['manage_portfolio', 'manage_services', 'manage_projects', 'send_messages']::org.team_permission[], true),
  ('eafae811-8830-459c-ae87-3b2f8eac98e2', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Admin', 'Admin of Studio Fern', ARRAY['manage_profile', 'manage_portfolio', 'manage_members', 'manage_services', 'manage_projects', 'send_messages']::org.team_permission[], true),
  ('a05c05ec-223f-4a2b-a5b9-d37a3a9033d1', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Member', 'Member of Studio Fern', ARRAY['send_messages']::org.team_permission[], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.team_members (id, team_id, user_id, role, status, default_split_share, invited_by, title, joined_at, created_at)
VALUES
  ('ebf6f556-f1d4-42cd-a9e6-1314f1ef1813', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'owner', 'active', 50.00, NULL, 'Founder and creative director', now() - interval '9600 hours', now() - interval '9600 hours'),
  ('08bebad7-05d5-480c-adc8-1cc9e3ebe0c6', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'admin', 'active', 25.00, '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'Research lead', now() - interval '4800 hours', now() - interval '4800 hours'),
  ('01c3d249-f0c9-485e-a5bf-10777473c3c4', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'member', 'active', 25.00, '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'Illustrator', now() - interval '2880 hours', now() - interval '2880 hours'),
  ('461f816f-cb8e-478c-a25d-3c4d9236da62', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'owner', 'active', 40.00, NULL, 'Founder and engineering lead', now() - interval '8760 hours', now() - interval '8760 hours'),
  ('6b1505db-484d-4f36-a8ba-04f9bd20e934', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'lead', 'active', 30.00, 'c7173d3f-8b15-4876-afbf-499d17513a44', 'Mobile lead', now() - interval '5280 hours', now() - interval '5280 hours'),
  ('07d9acfe-ea3d-4fc3-a4d7-fecc6ffc9509', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'member', 'active', 30.00, 'c7173d3f-8b15-4876-afbf-499d17513a44', 'Backend engineer', now() - interval '4320 hours', now() - interval '4320 hours'),
  ('e9828602-3a5d-49eb-ad68-c75c3c817cc5', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'c859a726-490c-4f6d-a184-8984de3994d3', 'owner', 'active', 70.00, NULL, 'Founder', now() - interval '7920 hours', now() - interval '7920 hours'),
  ('701fe0f0-cce4-4b4f-a1b2-c97e39694e2d', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'member', 'active', 30.00, 'c859a726-490c-4f6d-a184-8984de3994d3', 'Illustrator', now() - interval '3600 hours', now() - interval '3600 hours')
ON CONFLICT (team_id, user_id) DO NOTHING;

INSERT INTO finance.contribution_agreements (id, team_id, member_user_id, percent_bp, held)
VALUES
  ('ef2d2c7e-87e3-4b47-a1f8-a590be9d4569', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 5000, true),
  ('bc63699f-6be7-4652-a7d2-7add836f9bb0', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 2500, false),
  ('a8b36781-7bda-4930-ab8f-e7fb25cffbf2', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 2500, false),
  ('c790aa87-f602-4e8e-a5e2-c511c366fff0', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'c7173d3f-8b15-4876-afbf-499d17513a44', 4000, true),
  ('3ec74443-c83b-41e0-aa1a-f0cda488dada', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 3000, false),
  ('ab475fd6-3b96-4f2d-a18e-f6883defbe0f', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 3000, false),
  ('a56866aa-2002-4001-aff4-54505da5f3ff', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'c859a726-490c-4f6d-a184-8984de3994d3', 7000, true),
  ('31ec28d8-1951-4c09-abd5-0ff21a88f033', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 3000, false)
ON CONFLICT (team_id, member_user_id) DO NOTHING;

INSERT INTO finance.split_rules (id, team_id, rule_type, vault_bp, active)
VALUES
  ('3a40a8ae-e875-49cd-a732-f1288e5b3967', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'co_op', 1000, true),
  ('2423b333-64d5-4576-af8b-e4716da2e52c', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'co_op', 1000, true),
  ('a4f5f421-2917-4b6a-a19a-fb9b6f7b200c', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'co_op', 1000, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.business_profiles (id, owner_user_id, name, slug, legal_name, logo_file_id, banner_file_id, country, billing_email, plan, headline, bio, languages, timezone, default_currency, tax_id, address_city, invoicing_mode, billing_day, status, kyb_status, kyb_verified_at, kyb_provider_ref, created_at)
VALUES
  ('edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'Helia Finance', 'heliafinance', 'Helia Finance Ltd', '9a55ec72-1004-466d-ae9e-4eb02bec6313', NULL, 'United Kingdom', 'accounts@heliafinance.co.uk', 'free', 'Consumer fintech — wallets, savings and a design system to match', '{"text":"Helia is a consumer finance app with two million customers. We bring in independent designers and engineers for well-scoped product work."}'::jsonb, ARRAY['English']::text[], 'Europe/London', 'USD', 'GB 987 6543 21', 'London', 'intervaled_monthly', 28, 'active', 'verified', now() - interval '6120 hours', 'acct_seed_heliafinance', now() - interval '6240 hours'),
  ('4cfa4f66-9aa2-496b-a93d-994caac019c1', '292e1827-f189-4f34-ab35-27c9f0320926', 'Atlas Labs', 'atlaslabs', 'Atlas Labs Inc.', '487b348b-5ae2-4952-a267-0f9d1b6670fc', NULL, 'Canada', 'ap@atlaslabs.io', 'free', 'Analytics platform for operations teams', '{"text":"Atlas builds an analytics platform for operations teams. Toronto-based, remote-friendly, and always hiring good outside teams for scoped builds."}'::jsonb, ARRAY['English']::text[], 'America/Toronto', 'USD', 'CA 123456789 RT0001', 'Toronto', 'per_transaction', NULL, 'active', 'pending', NULL, 'acct_seed_atlaslabs', now() - interval '5760 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.business_roles (id, business_id, title, summary, permissions, is_system)
VALUES
  ('a5c8ecb0-e4a4-42b7-a877-783685bd4765', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'Owner', 'Owner of Helia Finance', ARRAY['manage_profile', 'manage_members', 'manage_roles', 'manage_hiring', 'manage_projects', 'manage_billing', 'manage_escrow']::org.business_permission[], true),
  ('b81329b8-3cd9-43d7-a7b5-c3d203102799', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'Admin', 'Admin of Helia Finance', ARRAY['manage_profile', 'manage_members', 'manage_hiring', 'manage_projects', 'manage_escrow']::org.business_permission[], true),
  ('492da7d7-9559-4762-a385-ca81eb4fcc54', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'Member', 'Member of Helia Finance', ARRAY['manage_projects']::org.business_permission[], true),
  ('43f39a68-9049-43d3-ae54-8db27c9689e5', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'Owner', 'Owner of Atlas Labs', ARRAY['manage_profile', 'manage_members', 'manage_roles', 'manage_hiring', 'manage_projects', 'manage_billing', 'manage_escrow']::org.business_permission[], true),
  ('84da9d80-b426-49cb-aacb-43c6f9e96a19', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'Admin', 'Admin of Atlas Labs', ARRAY['manage_profile', 'manage_members', 'manage_hiring', 'manage_projects', 'manage_escrow']::org.business_permission[], true),
  ('eb72e8ff-2b7b-4d46-a77a-3d3503537bd4', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'Member', 'Member of Atlas Labs', ARRAY['manage_projects']::org.business_permission[], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.business_members (id, business_id, user_id, role, status, title, joined_at)
VALUES
  ('71b42d8a-1963-4cad-ad90-3664a644a037', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'owner', 'active', 'Head of Product', now() - interval '6240 hours'),
  ('085deb69-2a75-4918-a3f1-21b37c074f1a', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'admin', 'active', 'Product Manager', now() - interval '5520 hours'),
  ('2fe5ac4c-341f-47b9-a73f-1866bfbe7563', '4cfa4f66-9aa2-496b-a93d-994caac019c1', '292e1827-f189-4f34-ab35-27c9f0320926', 'owner', 'active', 'CTO', now() - interval '5760 hours'),
  ('b9c6a2ac-caa3-4b69-ab6e-f4f63d46d71b', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'member', 'active', 'Design Ops', now() - interval '4560 hours')
ON CONFLICT (business_id, user_id) DO NOTHING;

INSERT INTO finance.verification_cases (id, subject_type, subject_id, kind, status, tier, provider, provider_ref, submitted_at, decided_at, notes)
VALUES
  ('69d3b370-e6e8-42c3-a67d-8a42391ab505', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'kyb', 'verified', 3, 'stripe_identity', 'acct_seed_heliafinance', now() - interval '6144 hours', now() - interval '6120 hours', NULL),
  ('4dbeeb60-eea8-4acf-a15a-84fe004cee3d', 'business', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'kyb', 'pending', 3, 'stripe_identity', 'acct_seed_atlaslabs', now() - interval '5664 hours', NULL, 'Company registration document under review.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.org_invitations (id, inviter_user_id, target_user_id, target_handle, team_id, business_id, role_id, token, note, status, expires_at, created_at)
VALUES
  ('7ceb836b-0e37-4ce4-aa65-bb2d16fcbf6e', 'c859a726-490c-4f6d-a184-8984de3994d3', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'chloewinters', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', NULL, 'a05c05ec-223f-4a2b-a5b9-d37a3a9033d1', 'b4b9c001-334a-432e-aa4b-ce8b19800a20', 'We could use a writer on the editorial side — fancy joining Fern?', 'pending', now() + interval '264 hours', now() - interval '72 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.profile_follows (id, follower_user_id, target_entity_type, target_entity_id, created_at)
VALUES
  ('39260c46-45a6-4311-aa91-137cb6f8a8a7', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '72 hours'),
  ('76a7619c-4bcc-4009-aac0-197a7cf326c7', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', now() - interval '240 hours'),
  ('f5a6604c-ba73-44c1-ad2c-569288089d4f', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '408 hours'),
  ('2a839c59-f9d2-4912-a3f9-9dc3c8d3ea44', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'user', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '576 hours'),
  ('108c91e5-e39c-4adc-a6c1-72ff73938f9e', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'team', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', now() - interval '744 hours'),
  ('0aa8827d-4de8-4c9c-a08d-dacfebe978a6', '6ce1906f-caab-4708-a19e-df3d8960666e', 'user', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '912 hours'),
  ('22ea5ef2-e3eb-4451-acb0-5fbc6bb6cdd3', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '1080 hours'),
  ('02e1e1aa-7dee-4281-a79f-c91885e1721f', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '1248 hours'),
  ('1c942151-5a90-412a-a5c2-24a3597afdb4', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', now() - interval '1416 hours'),
  ('ff7317cb-0210-4fc6-a1bd-8d8d82370d40', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'user', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '144 hours'),
  ('99754c46-850d-4f25-a834-de406d4c6567', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'team', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', now() - interval '312 hours'),
  ('4230cef1-05cd-4164-a63d-e2032cc7efae', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '480 hours'),
  ('9a366616-32d3-4961-ad36-2860fcfcec33', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '648 hours'),
  ('367aa8af-1201-4f74-a6cc-4d0dadb884fa', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', now() - interval '816 hours'),
  ('a34d97c8-6d69-484f-a5fb-a41ea46bd43d', '292e1827-f189-4f34-ab35-27c9f0320926', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', now() - interval '984 hours'),
  ('8b694693-53ab-42be-a178-31ad3581efc8', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'user', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '1152 hours'),
  ('52c23574-9b53-467f-a9fc-f23e4b6f0119', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'user', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '1320 hours')
ON CONFLICT (follower_user_id, target_entity_type, target_entity_id) DO NOTHING;

INSERT INTO org.user_bookmarks (id, user_id, entity_type, entity_id)
VALUES
  ('d244e61c-48c2-4a69-a3ac-4316b7ecc143', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e'),
  ('aa3e8ca6-a02a-485d-a427-c4c45468e743', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3'),
  ('3e6483c5-db17-42ac-a327-b0b72f5cf30e', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'service_blueprint', '7b1b3f95-50bb-4b14-a1fa-457bd622993a'),
  ('6b067942-3f98-43a1-aaa7-a5e8df643177', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'project', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625'),
  ('57f8dbdb-d8ae-4bb2-a1e9-bdfdf7d9ed84', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c')
ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING;
