-- =============================================================================================
-- 08_comms.sql — project channels, direct messages and notifications
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- A project gets a General room plus one `stage_all` room per stage (the rooms comms.get_stage_channels would otherwise provision lazily). DM read state is per participant: `last_read_at` before the last message means unread.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO comms.project_channels (id, project_id, name, stage_id, visibility, created_at)
VALUES
  ('17b756ff-3897-4f62-ac20-5415c78cfea8', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'General', NULL, 'project_all', now() - interval '504 hours'),
  ('22bef015-fc59-475a-ad8e-27777ec1566c', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'Discovery and research', 'faa19a6c-a1b2-4453-a0a6-bf02a933dd81', 'stage_all', now() - interval '504 hours'),
  ('495f41c8-f456-4303-a9d9-06eed7f97a09', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'UX and flows', 'fda19f25-a2b2-45e6-afa6-bd6fa633d8c8', 'stage_all', now() - interval '504 hours'),
  ('a37afc9f-5159-421c-a3c4-7d6d95ddc36a', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', 'Visual design and handoff', 'fca19d92-a3b2-4779-aea6-bbdca733da5b', 'stage_all', now() - interval '504 hours'),
  ('e7a7fb3a-076f-46c5-ae72-1d602dbe806b', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', 'General', NULL, 'project_all', now() - interval '1080 hours'),
  ('61b801e2-3216-4427-ac88-fd94aad73bd1', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', 'Data model and ingestion', '2a5614e5-7032-4b5c-a46f-12ebe434fde2', 'stage_all', now() - interval '1080 hours'),
  ('41a1be4b-c5db-439e-a9b6-33b143cb2134', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', 'Dashboard build', '2756102c-7332-4015-a56f-147ee334fc4f', 'stage_all', now() - interval '1080 hours'),
  ('51608bc4-f203-40dd-a299-d3f20b8e9f3b', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', 'Rollout and documentation', '285611bf-7232-4e82-a66f-1611e234fabc', 'stage_all', now() - interval '1080 hours'),
  ('8b20a518-937b-48c3-aad4-75ae1aa74561', '8fc13e15-5051-4c3c-af74-82ef238f210e', 'General', NULL, 'project_all', now() - interval '384 hours'),
  ('f3ecd71c-6e93-4df9-ad6b-b8a66e087f83', '8fc13e15-5051-4c3c-af74-82ef238f210e', 'Brand refresh delivery', '1df76187-f9b7-4c96-abc4-cd4dc4f456b4', 'stage_all', now() - interval '384 hours'),
  ('01614cc7-3612-47a0-a03a-dbddc112cac6', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'General', NULL, 'project_all', now() - interval '144 hours'),
  ('9efc842d-69b2-4ed4-a742-9e2ffdc1a6ce', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'Architecture and design', '3106f13e-a74c-4e83-aafc-625c843f9801', 'stage_all', now() - interval '144 hours'),
  ('97edcfc0-6543-48f1-a398-0fc6926ec657', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'iOS build', '3006efab-a84c-4016-adfc-6715813f9348', 'stage_all', now() - interval '144 hours'),
  ('80b8a237-7016-4b32-a914-da65b1cc3f60', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'Android build', '2f06ee18-a94c-41a9-acfc-6582823f94db', 'stage_all', now() - interval '144 hours'),
  ('8898dc12-b7a6-4057-abf8-254c400c3ef1', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', 'QA and release', '3606f91d-aa4c-433c-a7fc-5da3873f9cba', 'stage_all', now() - interval '144 hours'),
  ('e0adf9af-6ff2-46a8-a22f-e909cbc6b5da', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'General', NULL, 'project_all', now() - interval '1200 hours'),
  ('66a96145-475b-4e6c-a442-e23bec8564c2', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'Tokens and foundations', '8ca74d22-728b-47ff-a528-acf449954ed9', 'stage_all', now() - interval '1200 hours'),
  ('459a77f8-a093-4209-afd0-7a92266c5b2b', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'Core components', '8ba74b8f-738b-4992-a828-b1ad46954a20', 'stage_all', now() - interval '1200 hours'),
  ('fdc7f40f-5e77-4b6a-a38b-7ed1dff32424', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', 'Documentation site', '8aa749fc-748b-4b25-a728-b01a47954bb3', 'stage_all', now() - interval '1200 hours'),
  ('8ed2ca3a-da90-408d-a05f-0a3cdfa87baf', '5210c27e-66e4-45c1-a142-01dcaf55d1d7', 'General', NULL, 'project_all', now() - interval '216 hours'),
  ('9fbcaee2-8070-4b5f-aa85-c280e7886745', '5210c27e-66e4-45c1-a142-01dcaf55d1d7', 'Site build', 'e0ee3319-8fc2-4698-a9a6-a7239da82cb2', 'stage_all', now() - interval '216 hours'),
  ('260fdb62-7f6b-4cc7-a5d6-1684d9843151', '65f5e896-28c7-442b-ab08-2f9404d56901', 'General', NULL, 'project_all', now() - interval '48 hours'),
  ('5b937b5a-4f92-442d-a7d6-3658adcd29b3', '65f5e896-28c7-442b-ab08-2f9404d56901', 'Concepts', 'a86e5ff7-39b0-43a0-a55d-65e1c78ef93a', 'stage_all', now() - interval '48 hours'),
  ('538ff703-4884-4fc0-acfb-06a53be1898a', '65f5e896-28c7-442b-ab08-2f9404d56901', 'Final artwork', 'a96e618a-3cb0-4859-a25d-6128c68ef7a7', 'stage_all', now() - interval '48 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.project_channel_participants (id, channel_id, profile_type, profile_id, role)
VALUES
  ('35f42ea7-00e6-4788-afd7-bbe114772cba', '17b756ff-3897-4f62-ac20-5415c78cfea8', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'owner'),
  ('5266a208-0c38-4693-a91c-224a9ab310c5', '17b756ff-3897-4f62-ac20-5415c78cfea8', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 'participant'),
  ('af5aaea8-1365-4591-ab30-7c72aec3ab6b', 'e7a7fb3a-076f-46c5-ae72-1d602dbe806b', 'business', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'owner'),
  ('4a327c6a-9f23-40af-af86-e56005837e0d', 'e7a7fb3a-076f-46c5-ae72-1d602dbe806b', 'freelancer', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'participant'),
  ('81119c03-567a-465a-a97e-daa183c67160', 'e7a7fb3a-076f-46c5-ae72-1d602dbe806b', 'freelancer', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'participant'),
  ('5f56c563-0972-47aa-a7ff-8b0dc8a6d144', 'e7a7fb3a-076f-46c5-ae72-1d602dbe806b', 'freelancer', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'participant'),
  ('b923abba-d777-495b-a3b9-535c59e4f115', '8b20a518-937b-48c3-aad4-75ae1aa74561', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'owner'),
  ('5d8f9e77-e16e-4c82-a524-4c795671c00c', '8b20a518-937b-48c3-aad4-75ae1aa74561', 'freelancer', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'participant'),
  ('44225cb1-e77c-4474-a734-b9bfa4164eba', '8b20a518-937b-48c3-aad4-75ae1aa74561', 'freelancer', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'participant'),
  ('fde05fe1-1490-427c-a884-77131b6bbfe6', '8b20a518-937b-48c3-aad4-75ae1aa74561', 'freelancer', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'participant'),
  ('34387697-2f4b-4102-a926-b519b5ff95e4', '01614cc7-3612-47a0-a03a-dbddc112cac6', 'business', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'owner'),
  ('37ccfc53-bad5-4e66-a582-50d1997e41dc', 'e0adf9af-6ff2-46a8-a22f-e909cbc6b5da', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'owner'),
  ('2b5f4d44-5621-48e1-abd4-091a18ec9297', 'e0adf9af-6ff2-46a8-a22f-e909cbc6b5da', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 'participant'),
  ('84dcbcd6-963a-463b-a436-d86c663fe3e1', '8ed2ca3a-da90-408d-a05f-0a3cdfa87baf', 'freelancer', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'participant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.project_messages (id, channel_id, sender_user_id, body, created_at)
VALUES
  ('2175ff69-b3be-48b8-a47f-cbf7ac65e406', '17b756ff-3897-4f62-ac20-5415c78cfea8', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'Welcome Maris! Kickoff is Tuesday 10:00 — I will send the interview list tonight.', now() - interval '168 hours'),
  ('2075fdd6-b4be-4a4b-a37f-ca64ad65e599', '17b756ff-3897-4f62-ac20-5415c78cfea8', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Perfect. I have blocked the week for interviews. Could someone from risk be on the list?', now() - interval '166 hours'),
  ('1f75fc43-b5be-4bde-a67f-cf1daa65e0e0', '17b756ff-3897-4f62-ac20-5415c78cfea8', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'Yes — I will add Rob from risk. Good call.', now() - interval '163 hours'),
  ('1e75fab0-b6be-4d71-a57f-cd8aab65e273', '22bef015-fc59-475a-ad8e-27777ec1566c', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'Loved the interview clips you shared. The top-up pain is even worse than we thought.', now() - interval '48 hours'),
  ('257605b5-b7be-4f04-a07f-c5abb065ea52', '22bef015-fc59-475a-ad8e-27777ec1566c', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Synthesis is up for review. Three problem statements, evidence on page 2.', now() - interval '24 hours'),
  ('94e8a78c-f93c-4d87-ac59-eb5a8bdfb4d5', 'e7a7fb3a-076f-46c5-ae72-1d602dbe806b', '292e1827-f189-4f34-ab35-27c9f0320926', 'North Loop are on the build — welcome Kwame, Samuel and Tomasz.', now() - interval '1008 hours'),
  ('95e8a91f-f83c-4bf4-ad59-eced8adfb342', 'e7a7fb3a-076f-46c5-ae72-1d602dbe806b', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'Thanks Daniel. Ingestion first; we will have the taxonomy workshop booked by Friday.', now() - interval '996 hours'),
  ('96e8aab2-fb3c-40ad-aa59-e83489dfb1af', '61b801e2-3216-4427-ac88-fd94aad73bd1', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'Replay is working end to end. Load test tomorrow.', now() - interval '576 hours'),
  ('97e8ac45-fa3c-4f1a-ab59-e9c788dfb01c', '61b801e2-3216-4427-ac88-fd94aad73bd1', '292e1827-f189-4f34-ab35-27c9f0320926', 'Accepted both stage-one tickets. Great work — releasing escrow now.', now() - interval '480 hours'),
  ('90e8a140-f53c-473b-a859-e50e87dfae89', '41a1be4b-c5db-439e-a9b6-33b143cb2134', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'v2 of the companion screens is up. The clipping is fixed on the Pixel 4a.', now() - interval '48 hours'),
  ('91e8a2d3-f43c-45a8-a959-e6a186dfacf6', '41a1be4b-c5db-439e-a9b6-33b143cb2134', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'Looking now — thanks Samuel.', now() - interval '43 hours'),
  ('4a1a32b6-8b62-4b79-addc-50743b8fd97f', '8b20a518-937b-48c3-aad4-75ae1aa74561', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'Workshop notes are in the shared folder. Excited to see the three routes.', now() - interval '192 hours'),
  ('4b1a3449-8a62-49e6-aedc-52073a8fd7ec', '8b20a518-937b-48c3-aad4-75ae1aa74561', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'Thanks Priya — routes land next Thursday. Lena is running a quick round of customer interviews first.', now() - interval '180 hours'),
  ('f83675d9-5918-4192-ac84-4a77ffb87c50', '01614cc7-3612-47a0-a03a-dbddc112cac6', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'Project is open for applications — architecture stage first.', now() - interval '144 hours'),
  ('532f7a4d-ed60-41ae-ae10-121fae2e8b28', 'e0adf9af-6ff2-46a8-a22f-e909cbc6b5da', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'Tokens accepted and escrow released. On to components!', now() - interval '360 hours'),
  ('522f78ba-ee60-4341-ad10-108caf2e8cbb', '459a77f8-a093-4209-afd0-7a92266c5b2b', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Button is done with all states. Field family next — expect a first pass Friday.', now() - interval '72 hours'),
  ('856b5d40-e4bd-4803-ad73-676aba573a8d', '8ed2ca3a-da90-408d-a05f-0a3cdfa87baf', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'Brief and the six case studies are attached. Go wild with the type.', now() - interval '168 hours'),
  ('866b5ed3-e3bd-4670-ae73-68fdb95738fa', '8ed2ca3a-da90-408d-a05f-0a3cdfa87baf', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'On it — first layout pass Thursday.', now() - interval '156 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_threads (id, kind, title, created_by_user_id, created_at)
VALUES
  ('1e62d824-5686-4899-a443-8ef26ad85777', 'dm', NULL, '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '480 hours'),
  ('a61d333a-c26e-4ac9-aa3a-44b0d65c041f', 'dm', NULL, '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '29 hours'),
  ('fd0071ff-2c37-4026-a0a8-8f19d092dc48', 'dm', NULL, '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '24 hours'),
  ('27607248-db60-46b3-aedf-de42c67781e5', 'group', 'Atlas × North Loop', '292e1827-f189-4f34-ab35-27c9f0320926', now() - interval '1008 hours'),
  ('323bdb0f-add3-4e50-a001-0f0122eabf52', 'service_inquiry', NULL, '950d68d1-8777-4bbe-ae59-3343e3e7f858', now() - interval '84 hours'),
  ('1f185704-a123-4725-afa4-bffaa33c9b43', 'dm', NULL, '35ce4987-15b3-4c38-a438-2bb9c35df15a', now() - interval '22 hours'),
  ('06638739-a2a1-4bae-a5ce-346b81286ce0', 'group', 'Atelier Nova', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '168 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_participants (id, thread_id, user_id, last_read_at, is_starred, joined_at)
VALUES
  ('41fda573-1f67-444e-abbe-5dbdd7fb7dc8', '1e62d824-5686-4899-a443-8ef26ad85777', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '454 hours', true, now() - interval '480 hours'),
  ('f1f00173-c941-4000-ac73-ec811a6155c6', '1e62d824-5686-4899-a443-8ef26ad85777', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '454 hours', false, now() - interval '480 hours'),
  ('107abf83-5ba0-487c-a9f0-6e3d7cd594ee', 'a61d333a-c26e-4ac9-aa3a-44b0d65c041f', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '10 hours', false, now() - interval '29 hours'),
  ('61b11143-5575-4ff0-aece-7531a28c3a2e', 'a61d333a-c26e-4ac9-aa3a-44b0d65c041f', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '10 hours', false, now() - interval '29 hours'),
  ('9c0ba318-dee1-4035-aa6f-54fa9c7946a7', 'fd0071ff-2c37-4026-a0a8-8f19d092dc48', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '15 hours', false, now() - interval '24 hours'),
  ('73831741-6d5d-4c36-a744-8ca3732d0dc0', 'fd0071ff-2c37-4026-a0a8-8f19d092dc48', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '14 hours', false, now() - interval '24 hours'),
  ('e11df584-dd45-4f77-a920-b1b6cdb9deb9', '27607248-db60-46b3-aedf-de42c67781e5', '292e1827-f189-4f34-ab35-27c9f0320926', now() - interval '19 hours', false, now() - interval '1008 hours'),
  ('a805f2e4-47ad-4eb7-a2a4-5326643d9269', '27607248-db60-46b3-aedf-de42c67781e5', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', now() - interval '19 hours', false, now() - interval '1008 hours'),
  ('507f9f52-c029-4703-adc7-740435d46b65', '27607248-db60-46b3-aedf-de42c67781e5', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '20 hours', false, now() - interval '1008 hours'),
  ('11a6db64-bdad-4aaf-a343-989eab027641', '27607248-db60-46b3-aedf-de42c67781e5', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', now() - interval '19 hours', false, now() - interval '1008 hours'),
  ('6680b5d9-33f1-4b3a-a192-001b1cf90904', '27607248-db60-46b3-aedf-de42c67781e5', '2e4274fb-e76b-4640-ad31-c66d7fbea842', now() - interval '20 hours', false, now() - interval '1008 hours'),
  ('9512d813-e752-43a6-a6d8-d7a58a9d3818', '323bdb0f-add3-4e50-a001-0f0122eabf52', '950d68d1-8777-4bbe-ae59-3343e3e7f858', now() - interval '67 hours', false, now() - interval '84 hours'),
  ('9c191bbc-a4f9-4195-af05-1c66273c1adf', '323bdb0f-add3-4e50-a001-0f0122eabf52', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '67 hours', false, now() - interval '84 hours'),
  ('180e62a7-5a6d-471a-ab4e-709179c1dadc', '1f185704-a123-4725-afa4-bffaa33c9b43', '35ce4987-15b3-4c38-a438-2bb9c35df15a', now() - interval '17 hours', false, now() - interval '22 hours'),
  ('658d3c47-c790-49b8-a886-badde98659f6', '1f185704-a123-4725-afa4-bffaa33c9b43', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '17 hours', false, now() - interval '22 hours'),
  ('06a4b3a3-4d9e-42b4-ae6b-4739fa444852', '06638739-a2a1-4bae-a5ce-346b81286ce0', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '144 hours', false, now() - interval '168 hours'),
  ('37246ab6-f831-4469-a777-e020bec1013b', '06638739-a2a1-4bae-a5ce-346b81286ce0', '3fc3da04-549b-4239-aca3-fa82f713dbaf', now() - interval '144 hours', false, now() - interval '168 hours'),
  ('8f3d78f4-2977-4017-abb3-aa623c61a96d', '06638739-a2a1-4bae-a5ce-346b81286ce0', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '144 hours', false, now() - interval '168 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_messages (id, thread_id, sender_user_id, body, created_at)
VALUES
  ('c4b1797d-4eb4-4fb6-a7e9-f03b7dc195e4', '1e62d824-5686-4899-a443-8ef26ad85777', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'Hi Maris — I have a brand refresh coming up in Q4 and would love to talk about your design-system offer.', now() - interval '480 hours'),
  ('c3b177ea-4fb4-4149-a6e9-eea87ec19777', '1e62d824-5686-4899-a443-8ef26ad85777', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Hi Noor, happy to. I am mostly booked with Helia until mid-October but could take a foundations stage after that.', now() - interval '468 hours'),
  ('c2b17657-4cb4-4c90-a9e9-f3617fc1990a', '1e62d824-5686-4899-a443-8ef26ad85777', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'That timing works. I will send the brief over next week.', now() - interval '456 hours'),
  ('c1b174c4-4db4-4e23-a8e9-f1ce80c19a9d', '1e62d824-5686-4899-a443-8ef26ad85777', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Looking forward to it!', now() - interval '454 hours'),
  ('29c4b2b5-a58c-43e8-a526-93eba72d05ce', 'a61d333a-c26e-4ac9-aa3a-44b0d65c041f', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'Juno, quick one on the studio site — can the case studies be reordered from the editor?', now() - interval '29 hours'),
  ('28c4b122-a68c-457b-a426-9258a82d0761', 'a61d333a-c26e-4ac9-aa3a-44b0d65c041f', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'Yes, drag to reorder. I will show you Thursday.', now() - interval '26 hours'),
  ('27c4af8f-a78c-470e-a726-9711a52d02a8', 'a61d333a-c26e-4ac9-aa3a-44b0d65c041f', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'Brilliant. Also — could we get a dark mode?', now() - interval '10 hours'),
  ('fc280baa-b3ac-4e35-aef5-d0fc700c312f', 'fd0071ff-2c37-4026-a0a8-8f19d092dc48', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'Ren — I just sent an invitation for our packaging project. Three bags, one display, a month from now.', now() - interval '24 hours'),
  ('fd280d3d-b2ac-4ca2-aff5-d28f6f0c2f9c', 'fd0071ff-2c37-4026-a0a8-8f19d092dc48', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'Saw it, thank you. I am wrapping a launch film this fortnight but a month out is realistic. Let me look at the brief properly tomorrow.', now() - interval '14 hours'),
  ('df09cd9f-8dd0-402a-a8f5-66711e87e384', '27607248-db60-46b3-aedf-de42c67781e5', '292e1827-f189-4f34-ab35-27c9f0320926', 'Group for anything cross-project between Atlas and North Loop.', now() - interval '1008 hours'),
  ('de09cc0c-8ed0-41bd-a7f5-64de1f87e517', '27607248-db60-46b3-aedf-de42c67781e5', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'Perfect. Samuel and Tomasz are here.', now() - interval '1006 hours'),
  ('e109d0c5-8bd0-4d04-a6f5-634b2087e6aa', '27607248-db60-46b3-aedf-de42c67781e5', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'Heads up: Loop mobile is open for applications — Samuel, an invite is on its way.', now() - interval '24 hours'),
  ('e009cf32-8cd0-4e97-a5f5-61b82187e83d', '27607248-db60-46b3-aedf-de42c67781e5', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'Seen it — will reply once the companion screens are accepted.', now() - interval '19 hours'),
  ('334ad6a0-bf53-4cf5-a7af-917abcaedecf', '323bdb0f-add3-4e50-a001-0f0122eabf52', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'Hi Saoirse — I would love to book a portfolio review before I start pitching for product roles. Is the 60-minute session right for that?', now() - interval '84 hours'),
  ('344ad833-be53-4b62-a8af-930dbbaedd3c', '323bdb0f-add3-4e50-a001-0f0122eabf52', 'c859a726-490c-4f6d-a184-8984de3994d3', 'Hi Chloe! Yes, that is exactly what it is for. Also — I have just sent you an invite to join Studio Fern on the writing side, no pressure.', now() - interval '72 hours'),
  ('354ad9c6-bd53-49cf-a5af-8e54beaee1f5', '323bdb0f-add3-4e50-a001-0f0122eabf52', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'Oh wow, thank you. Let me book the review first and think about Fern properly.', now() - interval '67 hours'),
  ('da830bd9-80fd-4ae6-a973-b5d778c05594', '1f185704-a123-4725-afa4-bffaa33c9b43', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'Synthesis received — reviewing with Priya tomorrow morning.', now() - interval '22 hours'),
  ('d9830a46-81fd-4c79-a873-b44479c05727', '1f185704-a123-4725-afa4-bffaa33c9b43', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Great. I am around all day if you want to talk through the third problem statement.', now() - interval '17 hours'),
  ('8ef2cf12-c3ef-47e3-a77f-63743ab011ad', '06638739-a2a1-4bae-a5ce-346b81286ce0', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'Verdant workshop notes are in. Lena — can you do four customer interviews before Thursday?', now() - interval '168 hours'),
  ('8ff2d0a5-c2ef-4650-a87f-650739b0101a', '06638739-a2a1-4bae-a5ce-346b81286ce0', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'Yes, recruiting now.', now() - interval '163 hours'),
  ('8cf2cbec-c5ef-4b09-a97f-669a38b00e87', '06638739-a2a1-4bae-a5ce-346b81286ce0', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'I will start on illustration directions for route two once the interviews land.', now() - interval '144 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.notifications (id, user_id, type, title, body, category, urgency, channels, actor_user_id, context_type, context_id, action_url, read_at, seen_at, created_at)
SELECT v.id::uuid, v.user_id::uuid, nt.key, v.title, v.body, nt.category, nt.urgency, nt.default_channels,
       v.actor_user_id::uuid, v.context_type, v.context_id::uuid, v.action_url, v.read_at, v.seen_at, v.created_at
FROM (VALUES
  ('1fbf6a26-d3b4-4a03-a991-6c904885d615', '6ce1906f-caab-4708-a19e-df3d8960666e', 'escrow.funded', 'Escrow secured for Discovery and research', 'Helia Finance funded $8,000.00 for your ticket on Helia wallet redesign.', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'project', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', '/projects/prj-6ndtxa9u9x', now() - interval '142 hours', now() - interval '142 hours', now() - interval '144 hours'),
  ('20bf6bb9-d2b4-4870-aa91-6e234785d482', '6ce1906f-caab-4708-a19e-df3d8960666e', 'escrow.released', '$13,300.00 released to your wallet', 'Tokens and foundations on Meridian design system was accepted and paid out.', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'project', 'af6c1867-2b94-49f4-ad1f-12c10c4ab616', '/wallet/transactions', now() - interval '358 hours', now() - interval '358 hours', now() - interval '360 hours'),
  ('1dbf6700-d5b4-4d29-ab91-6fb64685d2ef', '6ce1906f-caab-4708-a19e-df3d8960666e', 'review.received', 'Hannah Cole left you a 5-star review', '"The token work engineering actually adopted"', '35ce4987-15b3-4c38-a438-2bb9c35df15a', NULL, NULL, NULL, now() - interval '334 hours', now() - interval '334 hours', now() - interval '336 hours'),
  ('1ebf6893-d4b4-4b96-ac91-71494585d15c', '6ce1906f-caab-4708-a19e-df3d8960666e', 'message.new', 'Hannah Cole', 'Synthesis received — reviewing with Priya tomorrow morning.', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'conversation', '1f185704-a123-4725-afa4-bffaa33c9b43', '/messages/1f185704-a123-4725-afa4-bffaa33c9b43', now() - interval '19 hours', now() - interval '19 hours', now() - interval '22 hours'),
  ('23bf7072-d7b4-404f-ad91-72dc4485cfc9', '6ce1906f-caab-4708-a19e-df3d8960666e', 'profile.followed', 'Chloe Winters started following you', 'Freelance copywriter — brand voice and UX writing', '950d68d1-8777-4bbe-ae59-3343e3e7f858', NULL, NULL, NULL, NULL, NULL, now() - interval '96 hours'),
  ('24bf7205-d6b4-4ebc-ae91-746f4385ce36', '6ce1906f-caab-4708-a19e-df3d8960666e', 'payout.sent', 'Payout of $9,000.00 sent', 'Your payout to the account ending 2210 is on its way.', NULL, NULL, NULL, '/wallet/payouts', now() - interval '238 hours', now() - interval '238 hours', now() - interval '240 hours'),
  ('678f1b9e-fda9-4ab1-aaee-d7b87aa27f03', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'submission.received', 'Maris submitted Research synthesis — round 1', 'Ticket: Stakeholder interviews and research synthesis', '6ce1906f-caab-4708-a19e-df3d8960666e', 'project', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', '/projects/prj-6ndtxa9u9x', NULL, NULL, now() - interval '24 hours'),
  ('688f1d31-fca9-491e-abee-d94b79a27d70', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'application.received', 'Chloe Winters applied to UX and flows', '"I write onboarding and transactional copy for fintech apps…"', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'project', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', '/projects/prj-6ndtxa9u9x', NULL, NULL, now() - interval '48 hours'),
  ('618f122c-f7a9-413f-a8ee-d49288a2950d', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'application.received', 'Lena Müller applied to Discovery and research', '"I run interview programmes for brand and product teams…"', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'project', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', '/projects/prj-6ndtxa9u9x', now() - interval '214 hours', now() - interval '214 hours', now() - interval '216 hours'),
  ('628f13bf-f6a9-4fac-a9ee-d62587a2937a', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'message.new', 'Maris Delacroix', 'Great. I am around all day if you want to talk through the third problem statement.', '6ce1906f-caab-4708-a19e-df3d8960666e', 'conversation', '1f185704-a123-4725-afa4-bffaa33c9b43', '/messages/1f185704-a123-4725-afa4-bffaa33c9b43', NULL, NULL, now() - interval '17 hours'),
  ('dde2c06a-850c-4fb5-a9d6-22dcb5902117', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'ticket.claimed', 'Inês Duarte claimed the Verdant brand refresh ticket', 'Escrow of $32,000.00 is now held for Atelier Nova.', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'project', '8fc13e15-5051-4c3c-af74-82ef238f210e', '/projects/prj-k9gmv68pe9', now() - interval '262 hours', now() - interval '262 hours', now() - interval '264 hours'),
  ('dee2c1fd-840c-4e22-aad6-246fb4901f84', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'review.received', 'Maris Delacroix reviewed Helia Finance', '"Well-run, fast reviews" — 4.7 stars', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, NULL, NULL, NULL, NULL, now() - interval '312 hours'),
  ('a793b79b-e106-4856-ab4d-2665af2ccff8', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'stage.invite', 'Hannah Cole invited you to UX and flows', 'Helia wallet redesign — offer $16,000.00', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'project', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', '/projects/prj-6ndtxa9u9x', NULL, NULL, now() - interval '96 hours'),
  ('a693b608-e206-49e9-aa4d-24d2b02cd18b', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'application.received', 'Your application to Loop mobile app was received', 'Architecture and design — Atlas Labs will respond within five days.', NULL, 'project', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', '/projects/prj-67o7d44y6x', now() - interval '70 hours', now() - interval '70 hours', now() - interval '72 hours'),
  ('ad93c10d-e306-4b7c-a54d-1cf3b52cd96a', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'message.new', 'Noor Haddad', 'Brilliant. Also — could we get a dark mode?', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'conversation', 'a61d333a-c26e-4ac9-aa3a-44b0d65c041f', '/messages/a61d333a-c26e-4ac9-aa3a-44b0d65c041f', NULL, NULL, now() - interval '10 hours'),
  ('ac93bf7a-e406-4d0f-a44d-1b60b62cdafd', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'escrow.refunded', '$38.00 refunded for Iconography set — 640', 'Your refund has been credited to your wallet.', NULL, NULL, NULL, '/wallet/transactions', now() - interval '1390 hours', now() - interval '1390 hours', now() - interval '1392 hours'),
  ('455bf832-3cd5-4f4d-a1e6-2c54db578537', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'stage.invite', 'Theo Almeida invited you to Concepts', 'Almeida Coffee — packaging refresh — offer $700.00', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'project', '65f5e896-28c7-442b-ab08-2f9404d56901', '/projects/prj-sqfpd8dq67', NULL, NULL, now() - interval '24 hours'),
  ('465bf9c5-3bd5-4dba-a2e6-2de7da5783a4', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'message.new', 'Theo Almeida', 'Ren — I just sent an invitation for our packaging project.', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'conversation', 'fd0071ff-2c37-4026-a0a8-8f19d092dc48', '/messages/fd0071ff-2c37-4026-a0a8-8f19d092dc48', now() - interval '22 hours', now() - interval '22 hours', now() - interval '24 hours'),
  ('475bfb58-2ed5-4943-a7e6-1c96d1577579', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'profile.followed', 'Maris Delacroix started following you', 'Product design lead', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, NULL, NULL, now() - interval '718 hours', now() - interval '718 hours', now() - interval '720 hours'),
  ('6030e0f6-26ca-4f7f-a09c-a33801583209', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'message.new', 'Juno Park', 'Yes, drag to reorder. I will show you Thursday.', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'conversation', 'a61d333a-c26e-4ac9-aa3a-44b0d65c041f', '/messages/a61d333a-c26e-4ac9-aa3a-44b0d65c041f', now() - interval '24 hours', now() - interval '24 hours', now() - interval '26 hours'),
  ('6f33372a-9fd1-49bf-a795-28f882552b85', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'wallet.topup_succeeded', 'Top-up of $5,000.00 landed', 'Your wallet balance has been updated.', NULL, NULL, NULL, '/wallet/transactions', now() - interval '670 hours', now() - interval '670 hours', now() - interval '672 hours'),
  ('703338bd-9ed1-482c-a895-2a8b815529f2', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'project.member_joined', 'Juno Park joined Haddad Studio portfolio site', 'Assigned to Site build.', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'project', '5210c27e-66e4-45c1-a142-01dcaf55d1d7', '/projects/prj-ummvtuay59', now() - interval '166 hours', now() - interval '166 hours', now() - interval '168 hours'),
  ('b1811b6a-9a91-405b-a9de-9f90dd7b0d71', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'message.new', 'Ren Koda', 'Saw it, thank you. I am wrapping a launch film this fortnight but a month out is realistic.', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'conversation', 'fd0071ff-2c37-4026-a0a8-8f19d092dc48', '/messages/fd0071ff-2c37-4026-a0a8-8f19d092dc48', NULL, NULL, now() - interval '14 hours'),
  ('e5d05e98-25b4-4541-a629-7c1e46ddb6e7', '292e1827-f189-4f34-ab35-27c9f0320926', 'submission.received', 'Samuel submitted Companion screens — v2', 'Ticket: Mobile companion screens', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'project', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '/projects/prj-xghufr2r5b', NULL, NULL, now() - interval '48 hours'),
  ('ecd0699d-26b4-46d4-a929-80d743ddb22e', '292e1827-f189-4f34-ab35-27c9f0320926', 'review.received', 'Kwame Mensah reviewed Atlas Labs', '"A client who reviews on time" — 5 stars', 'c7173d3f-8b15-4876-afbf-499d17513a44', NULL, NULL, NULL, now() - interval '430 hours', now() - interval '430 hours', now() - interval '432 hours'),
  ('ebd0680a-27b4-4867-a829-7f4444ddb3c1', '292e1827-f189-4f34-ab35-27c9f0320926', 'invoice.issued', 'Invoice from North Loop', 'Ingestion pipeline and warehouse schema — $15,000.00', NULL, NULL, NULL, '/wallet/invoices', now() - interval '478 hours', now() - interval '478 hours', now() - interval '480 hours'),
  ('94eacc8f-c1c6-483a-a8b6-934d5657b4c0', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'application.received', 'Tomasz Wójcik applied to Android build', '"Happy to take the Android build once architecture lands…"', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'project', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', '/projects/prj-67o7d44y6x', NULL, NULL, now() - interval '48 hours'),
  ('93eacafc-c2c6-49cd-a7b6-91ba5757b653', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'application.received', 'Juno Park applied to Architecture and design', '"I can own the architecture stage…"', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'project', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', '/projects/prj-67o7d44y6x', NULL, NULL, now() - interval '72 hours'),
  ('d05a6a0d-5345-4ba2-a443-08b7979585b4', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'escrow.released', '$14,250.00 released to North Loop', 'Event taxonomy and warehouse model was accepted and paid out; your share is $5,130.00.', '292e1827-f189-4f34-ab35-27c9f0320926', 'project', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '/wallet/transactions', now() - interval '526 hours', now() - interval '526 hours', now() - interval '528 hours'),
  ('cf5a687a-5445-4d35-a343-072498958747', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'review.received', 'Daniel Okafor left North Loop a 4.8-star review', '"Reliable, communicative, and the load test held"', '292e1827-f189-4f34-ab35-27c9f0320926', NULL, NULL, NULL, now() - interval '454 hours', now() - interval '454 hours', now() - interval '456 hours'),
  ('c258156c-c148-4763-a640-b4169597c125', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'payout.sent', 'Instant payout of $5,000.00 sent', 'A small fee applies to instant payouts.', NULL, NULL, NULL, '/wallet/payouts', now() - interval '382 hours', now() - interval '382 hours', now() - interval '384 hours'),
  ('d15ba4c3-2754-4a9e-a47f-316d8fd44b28', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'stage.invite', 'Miguel Santos invited you to iOS build', 'Loop mobile app — offer $25,000.00', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'project', '4a9f7c1e-0c3f-462f-a67e-0ce833290759', '/projects/prj-67o7d44y6x', NULL, NULL, now() - interval '24 hours'),
  ('d25ba656-2654-490b-a17f-2cb492d44fe1', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'submission.revision_requested', 'Revisions requested on Companion screens — v1', '"The drill-down chart clips on small Android screens…"', '292e1827-f189-4f34-ab35-27c9f0320926', 'project', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '/projects/prj-xghufr2r5b', now() - interval '142 hours', now() - interval '142 hours', now() - interval '144 hours'),
  ('7bbd8fda-2da6-4b67-a024-c560327af5c5', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'escrow.released', '$14,250.00 released to North Loop', 'Ingestion pipeline and warehouse schema was accepted; your share is $3,847.50.', '292e1827-f189-4f34-ab35-27c9f0320926', 'project', '7f930a97-cfa8-4784-a7d0-61c913c2f3ce', '/wallet/transactions', now() - interval '478 hours', now() - interval '478 hours', now() - interval '480 hours'),
  ('76bd87fb-2aa6-46ae-a724-d0652b7aeac0', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'message.new', 'Atlas × North Loop', 'Miguel: Heads up: Loop mobile is open for applications.', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'conversation', '27607248-db60-46b3-aedf-de42c67781e5', '/messages/27607248-db60-46b3-aedf-de42c67781e5', NULL, NULL, now() - interval '24 hours'),
  ('04c2414f-8269-4062-a8ec-ac5db01369e8', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'stage.invite', 'Priya Raman invited Atelier Nova to Brand refresh delivery', 'Verdant brand refresh — offer $32,000.00', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'project', '8fc13e15-5051-4c3c-af74-82ef238f210e', '/projects/prj-k9gmv68pe9', now() - interval '334 hours', now() - interval '334 hours', now() - interval '336 hours'),
  ('05c242e2-8169-4ecf-a5ec-a7a4b3136ea1', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'escrow.funded', 'Escrow secured for Brand refresh delivery', 'Helia Finance funded $32,000.00 for the Verdant brand refresh.', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'project', '8fc13e15-5051-4c3c-af74-82ef238f210e', '/projects/prj-k9gmv68pe9', now() - interval '262 hours', now() - interval '262 hours', now() - interval '264 hours'),
  ('2fa7ae9f-2093-4d4c-af2a-0c050f8c72b2', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'team.invite', 'Saoirse Byrne invited you to join Studio Fern', '"We could use a writer on the editorial side — fancy joining Fern?"', 'c859a726-490c-4f6d-a184-8984de3994d3', 'team', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', '/teams/studiofern', NULL, NULL, now() - interval '72 hours'),
  ('34a7b67e-2793-4851-a02a-0d98128c776b', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'account.email_verified', 'Email verified', 'Your address is confirmed — welcome to Projective.', NULL, NULL, NULL, NULL, now() - interval '286 hours', now() - interval '286 hours', now() - interval '288 hours'),
  ('35a7b811-2693-46be-a12a-0f2b118c75d8', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'message.new', 'Saoirse Byrne', 'Hi Chloe! Yes, that is exactly what it is for.', 'c859a726-490c-4f6d-a184-8984de3994d3', 'conversation', '323bdb0f-add3-4e50-a001-0f0122eabf52', '/messages/323bdb0f-add3-4e50-a001-0f0122eabf52', now() - interval '70 hours', now() - interval '70 hours', now() - interval '72 hours'),
  ('9741e1a8-bdc3-430f-a8e2-e96ec52e9725', 'c859a726-490c-4f6d-a184-8984de3994d3', 'message.new', 'Chloe Winters', 'Oh wow, thank you. Let me book the review first and think about Fern properly.', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'conversation', '323bdb0f-add3-4e50-a001-0f0122eabf52', '/messages/323bdb0f-add3-4e50-a001-0f0122eabf52', NULL, NULL, now() - interval '67 hours'),
  ('9841e33b-bcc3-417c-a9e2-eb01c42e9592', 'c859a726-490c-4f6d-a184-8984de3994d3', 'profile.followed', 'Chloe Winters started following you', 'Freelance copywriter', '950d68d1-8777-4bbe-ae59-3343e3e7f858', NULL, NULL, NULL, now() - interval '118 hours', now() - interval '118 hours', now() - interval '120 hours'),
  ('dd1fc91e-db14-4ec7-acc8-a928f79c30f9', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'application.declined', 'Your application to Discovery and research was declined', 'Helia wallet redesign — the stage was filled.', NULL, 'project', 'f64b99ba-0ab3-4c4f-ac7b-5a88f2577625', '/projects/prj-6ndtxa9u9x', now() - interval '166 hours', now() - interval '166 hours', now() - interval '168 hours'),
  ('96fe8713-ea04-4706-aa5f-8d699f236654', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'team.member_joined', 'You joined Atelier Nova', 'Inês Duarte added you as Illustrator.', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', '/teams/ateliernova', now() - interval '2878 hours', now() - interval '2878 hours', now() - interval '2880 hours')
) AS v(id, user_id, type, title, body, actor_user_id, context_type, context_id, action_url, read_at, seen_at, created_at)
JOIN comms.notification_types nt ON nt.key = v.type
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.auto_responses (id, user_id, enabled, name, trigger, keyword, message, ai_assist)
VALUES
  ('3cf0cb9c-c18e-461b-a5f3-c7326257c069', 'c859a726-490c-4f6d-a184-8984de3994d3', true, 'First reply', 'any', NULL, 'Thanks for getting in touch — I reply to new messages within one working day. If it is about a portfolio review, the booking link on my profile is the fastest route.', false),
  ('8e8a8dc2-04e4-4d91-a06a-adec55226613', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', false, 'Launch film enquiries', 'keyword', 'launch film', 'Launch films book out about six weeks ahead — send the product, the deadline and a reference or two and I will come back with dates.', false)
ON CONFLICT (id) DO NOTHING;
