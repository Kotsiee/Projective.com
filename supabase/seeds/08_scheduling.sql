-- =============================================================================================
-- 08_scheduling.sql — schedules, bands, blackouts, call settings, commitments, discovery calls
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- Generated from supabase/seeds/gen/schedules.ts. Times are wall-clock times in each owner's zone, placed relative to the current week.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO scheduling.schedules (id, owner_type, owner_id, timezone, is_published, mask_external_events)
VALUES
  ('75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'user'::scheduling.owner_type, '6ce1906f-caab-4708-a19e-df3d8960666e', 'Europe/London', true, true),
  ('1ccb25d3-184b-487e-a81c-7e11db9a9404', 'user'::scheduling.owner_type, 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'Europe/Berlin', true, true),
  ('c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'user'::scheduling.owner_type, '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'Europe/Lisbon', true, true),
  ('f403d885-6327-4a7e-a146-470bcb49c40c', 'user'::scheduling.owner_type, '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'Africa/Lagos', true, true),
  ('c20bf810-20fd-4efb-aa6b-b64ec6dd8871', 'user'::scheduling.owner_type, '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'Europe/Warsaw', true, true),
  ('868e608a-b2cf-445d-a665-110c9b029627', 'user'::scheduling.owner_type, '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'Asia/Tokyo', true, true),
  ('11922877-8757-4806-a855-57dd4fd44294', 'user'::scheduling.owner_type, '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'Europe/London', false, true),
  ('679905ac-0aa6-4cf3-ad70-02aa6e825291', 'team'::scheduling.owner_type, '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'Europe/Lisbon', true, true),
  ('4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'team'::scheduling.owner_type, 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'Europe/London', true, true),
  ('b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'team'::scheduling.owner_type, 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Europe/Dublin', true, true)
ON CONFLICT (owner_type, owner_id) DO NOTHING;

INSERT INTO scheduling.availability_rules (id, schedule_id, kind, weekday, start_minute, end_minute, is_active)
VALUES
  ('728c70ec-06b6-4aef-ae04-cff2704e0f65', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'working_hours'::scheduling.availability_kind, 1, 540, 1050, true),
  ('a2962429-c080-49ae-aa7d-24a3c61b0c18', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'working_hours'::scheduling.availability_kind, 2, 540, 1050, true),
  ('d43f4f2e-8ed7-4ea9-a75a-a7808b0eea5b', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'working_hours'::scheduling.availability_kind, 3, 540, 1050, true),
  ('27e7026b-2db2-49a8-adce-f241f89fc99e', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'working_hours'::scheduling.availability_kind, 4, 540, 1050, true),
  ('41711f28-1428-4ceb-a685-bf86c5b96a19', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'working_hours'::scheduling.availability_kind, 5, 540, 780, true),
  ('f10ea315-c4af-44ee-a1d8-9f3fcdd53f28', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'call_window'::scheduling.availability_kind, 2, 840, 960, true),
  ('38b1db97-b2ab-4130-a140-b2eddcb8ebbe', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'call_window'::scheduling.availability_kind, 4, 600, 720, true),
  ('70c2b7b2-3dfb-448d-acf9-d08c0c3dd70f', '1ccb25d3-184b-487e-a81c-7e11db9a9404', 'working_hours'::scheduling.availability_kind, 2, 600, 1080, true),
  ('b7bd3409-1eaa-4736-aefb-edbb45853270', '1ccb25d3-184b-487e-a81c-7e11db9a9404', 'working_hours'::scheduling.availability_kind, 3, 600, 1080, true),
  ('c443f7a0-e9a5-42ab-a8e2-ecc6ee4cae59', '1ccb25d3-184b-487e-a81c-7e11db9a9404', 'working_hours'::scheduling.availability_kind, 4, 600, 1080, true),
  ('29523e3f-2ca7-427c-a911-589de9cea282', '1ccb25d3-184b-487e-a81c-7e11db9a9404', 'working_hours'::scheduling.availability_kind, 5, 600, 1080, true),
  ('130df8b6-c359-4289-a24f-053042321afb', '1ccb25d3-184b-487e-a81c-7e11db9a9404', 'working_hours'::scheduling.availability_kind, 6, 600, 1080, true),
  ('5e28b36d-2c2f-40fe-aca1-4d63a50f2754', '1ccb25d3-184b-487e-a81c-7e11db9a9404', 'call_window'::scheduling.availability_kind, 3, 960, 1080, true),
  ('17416ead-e237-481e-a4e4-bf3ffe50b450', '1ccb25d3-184b-487e-a81c-7e11db9a9404', 'call_window'::scheduling.availability_kind, 6, 660, 750, true),
  ('ef15bd6a-842e-433b-a173-fedc4d26023d', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'working_hours'::scheduling.availability_kind, 1, 510, 990, true),
  ('422de85f-457d-44f6-a14a-899586ea5504', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'working_hours'::scheduling.availability_kind, 2, 510, 990, true),
  ('e6ad9ac0-78a4-4dc5-a7e1-df46088c3013', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'working_hours'::scheduling.availability_kind, 3, 510, 990, true),
  ('2c81f0c5-32d0-47c0-a459-2aaf7c5ff702', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'working_hours'::scheduling.availability_kind, 4, 510, 990, true),
  ('f95b47f6-8e50-455f-aa83-3b10bfb2d6c1', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'working_hours'::scheduling.availability_kind, 5, 510, 990, true),
  ('cab29932-a021-4b23-a1bf-e900952d3621', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'call_window'::scheduling.availability_kind, 1, 540, 630, true),
  ('040870c0-fe2a-49cd-a86a-11723d7d8687', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'call_window'::scheduling.availability_kind, 3, 540, 630, true),
  ('c33388c6-8e1c-42a7-a2db-6d24d8880a2d', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'call_window'::scheduling.availability_kind, 5, 540, 630, true),
  ('906ccdcd-85ef-4ef8-a91e-9eb317f0e7e6', 'f403d885-6327-4a7e-a146-470bcb49c40c', 'working_hours'::scheduling.availability_kind, 1, 540, 1020, true),
  ('1f40f200-03c6-4a45-a6c5-1182aee7f187', 'f403d885-6327-4a7e-a146-470bcb49c40c', 'working_hours'::scheduling.availability_kind, 2, 540, 1020, true),
  ('32636f23-e159-4dea-a384-1bddac7f7404', 'f403d885-6327-4a7e-a146-470bcb49c40c', 'working_hours'::scheduling.availability_kind, 3, 540, 1020, true),
  ('de6c0a06-14a5-4f3f-a374-8db449f2752d', 'f403d885-6327-4a7e-a146-470bcb49c40c', 'working_hours'::scheduling.availability_kind, 4, 540, 1020, true),
  ('35b53cc1-0aaf-423c-a3bf-d0b7ee92c352', 'f403d885-6327-4a7e-a146-470bcb49c40c', 'working_hours'::scheduling.availability_kind, 5, 540, 1020, true),
  ('2bb02f2d-5aef-4034-ac90-37f72ba7b57e', 'f403d885-6327-4a7e-a146-470bcb49c40c', 'call_window'::scheduling.availability_kind, 2, 900, 1020, true),
  ('dfbc35ff-6183-42a2-a1fd-2cc588565518', 'f403d885-6327-4a7e-a146-470bcb49c40c', 'call_window'::scheduling.availability_kind, 4, 900, 1020, true),
  ('78d38169-c7c5-445c-a792-b367d871619a', 'c20bf810-20fd-4efb-aa6b-b64ec6dd8871', 'working_hours'::scheduling.availability_kind, 1, 480, 960, true),
  ('4a16ae8c-9964-4e39-a6cd-d40e7f59cca3', 'c20bf810-20fd-4efb-aa6b-b64ec6dd8871', 'working_hours'::scheduling.availability_kind, 2, 480, 960, true),
  ('c7a97543-68bd-478a-a7a1-3a8d7520ab6c', 'c20bf810-20fd-4efb-aa6b-b64ec6dd8871', 'working_hours'::scheduling.availability_kind, 3, 480, 960, true),
  ('174911d6-9bf9-4cff-a46f-4ae4e4aeb995', 'c20bf810-20fd-4efb-aa6b-b64ec6dd8871', 'working_hours'::scheduling.availability_kind, 4, 480, 960, true),
  ('7f650f35-398c-4998-acfe-0e1b04c8d5b6', 'c20bf810-20fd-4efb-aa6b-b64ec6dd8871', 'working_hours'::scheduling.availability_kind, 5, 480, 960, true),
  ('943e60f3-e9a3-460a-af9a-dfc540f9e9fc', 'c20bf810-20fd-4efb-aa6b-b64ec6dd8871', 'call_window'::scheduling.availability_kind, 1, 780, 900, true),
  ('79798664-4722-4429-a267-23bec7f003fb', '868e608a-b2cf-445d-a665-110c9b029627', 'working_hours'::scheduling.availability_kind, 1, 600, 1140, true),
  ('657e7251-7b23-4e1c-a28c-aa476f8c8b82', '868e608a-b2cf-445d-a665-110c9b029627', 'working_hours'::scheduling.availability_kind, 2, 600, 1140, true),
  ('561db7da-186a-4a4b-a6f7-91a8740a9759', '868e608a-b2cf-445d-a665-110c9b029627', 'working_hours'::scheduling.availability_kind, 3, 600, 1140, true),
  ('3fb78907-4d92-42d6-a853-9391cb431b70', '868e608a-b2cf-445d-a665-110c9b029627', 'working_hours'::scheduling.availability_kind, 4, 600, 1140, true),
  ('64227068-9dc1-482d-a8f2-d91a91fbc00f', '868e608a-b2cf-445d-a665-110c9b029627', 'working_hours'::scheduling.availability_kind, 5, 600, 1140, true),
  ('c1e09ab3-9d5c-41c4-adf7-1ff1cac97f82', '11922877-8757-4806-a855-57dd4fd44294', 'working_hours'::scheduling.availability_kind, 1, 600, 960, true),
  ('e94c279a-686e-4531-a2e5-2c84232cf7fb', '11922877-8757-4806-a855-57dd4fd44294', 'working_hours'::scheduling.availability_kind, 2, 600, 960, true),
  ('f8ace211-7762-433a-a5de-e713112adacc', '11922877-8757-4806-a855-57dd4fd44294', 'working_hours'::scheduling.availability_kind, 3, 600, 960, true),
  ('f750e028-b15b-4a67-a3f9-a51ebd4262dd', '11922877-8757-4806-a855-57dd4fd44294', 'working_hours'::scheduling.availability_kind, 4, 600, 960, true),
  ('d2e5f8c7-bfa7-4948-ab35-b4f5ed13f706', '11922877-8757-4806-a855-57dd4fd44294', 'working_hours'::scheduling.availability_kind, 5, 600, 960, true),
  ('f3067c37-7994-4d16-ad66-8a916aa2f508', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'working_hours'::scheduling.availability_kind, 1, 570, 1080, true),
  ('ac0b00e2-eead-4abb-ae68-9bd083115a89', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'working_hours'::scheduling.availability_kind, 2, 570, 1080, true),
  ('d2ecd055-19c2-4808-ac00-ffe3ca756a16', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'working_hours'::scheduling.availability_kind, 3, 570, 1080, true),
  ('d9569780-7b8e-447d-a120-ddb2b907c27f', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'working_hours'::scheduling.availability_kind, 4, 570, 1080, true),
  ('1871ca13-5639-4b6a-a6c5-78a5b7612f2c', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'working_hours'::scheduling.availability_kind, 5, 570, 1080, true),
  ('7aed66c4-1033-4439-a7d0-9e2e3cac9913', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'call_window'::scheduling.availability_kind, 2, 660, 780, true),
  ('cbb76f02-f7df-4ceb-a2e7-14985da495c1', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'call_window'::scheduling.availability_kind, 4, 660, 780, true),
  ('4e386c5b-d776-4bb0-a4f0-87ddedc2b33a', '4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'working_hours'::scheduling.availability_kind, 1, 540, 1020, true),
  ('64d10a8a-b128-4cfd-a06b-d010102c8e0b', '4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'working_hours'::scheduling.availability_kind, 2, 540, 1020, true),
  ('33779165-934c-4422-aa8b-0ab3e73a3a48', '4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'working_hours'::scheduling.availability_kind, 3, 540, 1020, true),
  ('c3d9d75c-fffe-40d7-aa92-1b16e6d89849', '4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'working_hours'::scheduling.availability_kind, 4, 540, 1020, true),
  ('981d5bdf-7c35-4154-a195-b3d1d0241a4e', '4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'working_hours'::scheduling.availability_kind, 5, 540, 1020, true),
  ('c96de53d-07dc-4f96-a2a6-5b6bc77f9b64', '4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'call_window'::scheduling.availability_kind, 3, 600, 720, true),
  ('45226b47-1592-435a-a2df-a5052a666238', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'working_hours'::scheduling.availability_kind, 1, 540, 1020, true),
  ('ae2b61a6-9297-4b2b-a509-89b8a83c7d85', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'working_hours'::scheduling.availability_kind, 2, 540, 1020, true),
  ('9cd21ae1-ac21-47e8-acbd-6afb85cff12a', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'working_hours'::scheduling.availability_kind, 3, 540, 1020, true),
  ('a940c0a0-0d46-4ce9-a7d7-b9beb91c427f', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'working_hours'::scheduling.availability_kind, 4, 540, 1020, true),
  ('d863fec3-3ef0-47ee-a62e-8eb9af25957c', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'working_hours'::scheduling.availability_kind, 5, 540, 1020, true),
  ('871f9991-712c-4ba0-afc1-0633307bf842', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'call_window'::scheduling.availability_kind, 1, 720, 780, true),
  ('73890af3-7a89-4b4e-a357-94d139b759f4', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'call_window'::scheduling.availability_kind, 3, 720, 780, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.blackout_dates (id, schedule_id, starts_at, ends_at, label, label_is_public)
VALUES
  ('325ee390-e5fd-4e99-ad58-767aa5e38fd3', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '14 days' + interval '0 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '17 days' + interval '0 minutes') AT TIME ZONE 'Europe/London'), 'Speaking at Config', true),
  ('2f781e82-0549-4af9-ac76-5ea41d697483', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '10 days' + interval '0 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '12 days' + interval '0 minutes') AT TIME ZONE 'Europe/Lisbon'), 'Travelling', false),
  ('32bd67e3-5bd3-450a-a581-da19fa0bae10', '4b8eb94d-ee54-4300-aab0-de4745bb12c2', ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '21 days' + interval '0 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '26 days' + interval '0 minutes') AT TIME ZONE 'Europe/London'), 'Team offsite', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.call_settings (schedule_id, accepts_calls, courtesy_enabled, courtesy_duration_minutes, courtesy_max_per_week, courtesy_cooldown_days, paid_enabled, paid_duration_minutes, fee_amount_minor, fee_currency, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_advance_days, auto_confirm, agenda_required, preferred_provider_slug)
VALUES
  ('75d05796-1a22-4a0b-a5d6-be2ce79100a9', true, true, 20, 4, 30, true, 45, 7500, 'GBP', 0, 10, 720, 45, false, false, 'google'),
  ('1ccb25d3-184b-487e-a81c-7e11db9a9404', true, true, 15, 3, 60, false, 30, NULL, NULL, 5, 10, 1440, 30, false, true, 'zoom'),
  ('c1e31a5c-c862-4feb-a217-8a4237a5a4d9', true, false, 15, 0, 0, true, 30, 6000, 'EUR', 0, 15, 720, 60, true, true, 'google'),
  ('f403d885-6327-4a7e-a146-470bcb49c40c', true, true, 20, 5, 14, false, 30, NULL, NULL, 0, 10, 480, 60, false, false, 'google'),
  ('c20bf810-20fd-4efb-aa6b-b64ec6dd8871', true, true, 15, 2, 30, true, 60, 20000, 'PLN', 10, 10, 1440, 60, false, true, 'microsoft_teams'),
  ('679905ac-0aa6-4cf3-ad70-02aa6e825291', true, true, 30, 5, 30, true, 60, 12000, 'EUR', 0, 15, 1440, 45, false, false, 'microsoft_teams'),
  ('4b8eb94d-ee54-4300-aab0-de4745bb12c2', true, true, 20, 3, 30, false, 30, NULL, NULL, 0, 10, 720, 60, false, true, 'google'),
  ('b4df1c6f-f2d2-45a8-a060-0b0d4251925e', true, false, 15, 0, 0, true, 30, 4000, 'GBP', 0, 10, 720, 60, false, false, 'zoom')
ON CONFLICT (schedule_id) DO NOTHING;

INSERT INTO scheduling.call_platforms (schedule_id, provider_slug, position)
VALUES
  ('75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'google', 0),
  ('75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'zoom', 1),
  ('1ccb25d3-184b-487e-a81c-7e11db9a9404', 'zoom', 0),
  ('c1e31a5c-c862-4feb-a217-8a4237a5a4d9', 'google', 0),
  ('f403d885-6327-4a7e-a146-470bcb49c40c', 'google', 0),
  ('f403d885-6327-4a7e-a146-470bcb49c40c', 'microsoft_teams', 1),
  ('c20bf810-20fd-4efb-aa6b-b64ec6dd8871', 'microsoft_teams', 0),
  ('679905ac-0aa6-4cf3-ad70-02aa6e825291', 'microsoft_teams', 0),
  ('679905ac-0aa6-4cf3-ad70-02aa6e825291', 'zoom', 1),
  ('679905ac-0aa6-4cf3-ad70-02aa6e825291', 'google', 2),
  ('4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'google', 0),
  ('b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'zoom', 0)
ON CONFLICT (schedule_id, provider_slug) DO NOTHING;

INSERT INTO scheduling.events (id, schedule_id, kind, status, title, starts_at, ends_at, is_masked, created_by)
VALUES
  ('65280d29-e203-46ac-a85f-693b1d60a85e', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'busy'::scheduling.event_kind, 'confirmed'::scheduling.event_status, 'Client workshop', ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '8 days' + interval '870 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '8 days' + interval '930 minutes') AT TIME ZONE 'Europe/London'), false, '6ce1906f-caab-4708-a19e-df3d8960666e'),
  ('64280b96-e303-483f-a75f-67a81e60a9f1', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'sync'::scheduling.event_kind, 'confirmed'::scheduling.event_status, 'Design review', ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '10 days' + interval '600 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '10 days' + interval '660 minutes') AT TIME ZONE 'Europe/London'), false, '6ce1906f-caab-4708-a19e-df3d8960666e'),
  ('63280a03-e403-49d2-aa5f-6c611b60a538', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', 'busy'::scheduling.event_kind, 'confirmed'::scheduling.event_status, 'Focus block', ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '17 days' + interval '900 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '17 days' + interval '990 minutes') AT TIME ZONE 'Europe/London'), false, '6ce1906f-caab-4708-a19e-df3d8960666e'),
  ('526ce6b4-4d6c-4091-a0c0-6dbe134ff56b', '1ccb25d3-184b-487e-a81c-7e11db9a9404', 'busy'::scheduling.event_kind, 'confirmed'::scheduling.event_status, 'Render review', ((date_trunc('week', now() AT TIME ZONE 'Europe/Berlin') + interval '9 days' + interval '960 minutes') AT TIME ZONE 'Europe/Berlin'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Berlin') + interval '9 days' + interval '1020 minutes') AT TIME ZONE 'Europe/Berlin'), false, 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57'),
  ('885fb981-c722-4ea6-aa97-95b3d8aa3518', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'busy'::scheduling.event_kind, 'confirmed'::scheduling.event_status, 'Brand workshop', ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '10 days' + interval '660 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '10 days' + interval '720 minutes') AT TIME ZONE 'Europe/Lisbon'), false, '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d'),
  ('875fb7ee-c822-4039-a997-9420d9aa36ab', '679905ac-0aa6-4cf3-ad70-02aa6e825291', 'sync'::scheduling.event_kind, 'confirmed'::scheduling.event_status, 'Studio crit', ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '15 days' + interval '720 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '15 days' + interval '780 minutes') AT TIME ZONE 'Europe/Lisbon'), false, '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d'),
  ('41bd8152-2cf5-42fd-ad21-51f47204dca7', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'session'::scheduling.event_kind, 'confirmed'::scheduling.event_status, 'Portfolio review', ((date_trunc('week', now() AT TIME ZONE 'Europe/Dublin') + interval '9 days' + interval '600 minutes') AT TIME ZONE 'Europe/Dublin'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Dublin') + interval '9 days' + interval '660 minutes') AT TIME ZONE 'Europe/Dublin'), false, 'c859a726-490c-4f6d-a184-8984de3994d3'),
  ('42bd82e5-2bf5-416a-ae21-53877104db14', 'b4df1c6f-f2d2-45a8-a060-0b0d4251925e', 'busy'::scheduling.event_kind, 'confirmed'::scheduling.event_status, 'Editorial deadline', ((date_trunc('week', now() AT TIME ZONE 'Europe/Dublin') + interval '7 days' + interval '840 minutes') AT TIME ZONE 'Europe/Dublin'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Dublin') + interval '7 days' + interval '960 minutes') AT TIME ZONE 'Europe/Dublin'), false, 'c859a726-490c-4f6d-a184-8984de3994d3')
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.discovery_calls (id, host_schedule_id, host_user_id, requester_user_id, call_type, status, proposed_start, proposed_end, confirmed_start, confirmed_end, requester_timezone, agenda, service_blueprint_id, provider_slug, fee_amount_minor, fee_currency, proposed_at, confirmed_at, completed_at)
VALUES
  ('51a83c0b-48ae-4a3c-a4bb-c7b13b1aa01a', '75d05796-1a22-4a0b-a5d6-be2ce79100a9', '6ce1906f-caab-4708-a19e-df3d8960666e', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'courtesy'::scheduling.call_type, 'proposed'::scheduling.call_status, ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '8 days' + interval '840 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '8 days' + interval '860 minutes') AT TIME ZONE 'Europe/London'), NULL, NULL, 'America/Sao_Paulo', 'Scoping a design-system refresh for our booking app before we commit to a pipeline.', 'bccc7920-ca19-4f5f-aa0e-f572e1e8b029', 'google', NULL, NULL, ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '8 days' + interval '840 minutes') AT TIME ZONE 'Europe/London') - interval '72 hours', NULL, NULL),
  ('6893f401-1471-41f8-a398-f9237363d01a', 'c1e31a5c-c862-4feb-a217-8a4237a5a4d9', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'paid'::scheduling.call_type, 'confirmed'::scheduling.call_status, ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '7 days' + interval '540 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '7 days' + interval '570 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '7 days' + interval '540 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '7 days' + interval '570 minutes') AT TIME ZONE 'Europe/Lisbon'), 'Asia/Dubai', 'Walk through the landing page brief and the analytics we need wired in.', '56b1183a-92e4-4f4d-a30e-1e983a201c6b', 'google', 6000, 'EUR', ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '7 days' + interval '540 minutes') AT TIME ZONE 'Europe/Lisbon') - interval '120 hours', ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '7 days' + interval '540 minutes') AT TIME ZONE 'Europe/Lisbon') - interval '96 hours', NULL),
  ('4987cc37-8933-437c-ab1c-0839bce5d46e', '4b8eb94d-ee54-4300-aab0-de4745bb12c2', 'c7173d3f-8b15-4876-afbf-499d17513a44', '292e1827-f189-4f34-ab35-27c9f0320926', 'courtesy'::scheduling.call_type, 'confirmed'::scheduling.call_status, ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '9 days' + interval '600 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '9 days' + interval '620 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '9 days' + interval '600 minutes') AT TIME ZONE 'Europe/London'), ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '9 days' + interval '620 minutes') AT TIME ZONE 'Europe/London'), 'America/Toronto', 'Realtime dashboard for Atlas — is a four-week MVP realistic for our data volumes?', '2579bbc6-d14d-4c65-a5a5-350c3ab9510b', 'google', NULL, NULL, ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '9 days' + interval '600 minutes') AT TIME ZONE 'Europe/London') - interval '96 hours', ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '9 days' + interval '600 minutes') AT TIME ZONE 'Europe/London') - interval '72 hours', NULL),
  ('932df35c-fd03-40a7-aef0-a7fa0dffc63d', '679905ac-0aa6-4cf3-ad70-02aa6e825291', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'courtesy'::scheduling.call_type, 'completed'::scheduling.call_status, ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '-6 days' + interval '660 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '-6 days' + interval '690 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '-6 days' + interval '660 minutes') AT TIME ZONE 'Europe/Lisbon'), ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '-6 days' + interval '690 minutes') AT TIME ZONE 'Europe/Lisbon'), 'Europe/London', 'Advice on a portfolio brand before I start pitching.', NULL, 'zoom', NULL, NULL, ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '-6 days' + interval '660 minutes') AT TIME ZONE 'Europe/Lisbon') - interval '144 hours', ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '-6 days' + interval '660 minutes') AT TIME ZONE 'Europe/Lisbon') - interval '120 hours', ((date_trunc('week', now() AT TIME ZONE 'Europe/Lisbon') + interval '-6 days' + interval '690 minutes') AT TIME ZONE 'Europe/Lisbon'))
ON CONFLICT (id) DO NOTHING;

-- scheduling: 10 schedules, 65 bands, 4 calls.
