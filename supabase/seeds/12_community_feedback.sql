-- =============================================================================================
-- 12_community_feedback.sql — the feedback board's ideas, status history and votes
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- Ideas under review (`backlog`) are visible only to their author; Planned, In progress and Shipped are public; the Archived one is visible to operators only (00002021). vote_count is kept by trg_feedback_votes_count.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================

-- #region Ideas
INSERT INTO community.feedback_ideas (id, slug, title, impact, body, category, status, author_id, team_response, team_response_at, created_at, updated_at, status_changed_at, archived_at)
VALUES
  ('0351db27-3323-46cc-a59f-058d9cda6452', 'fbk-kbyrph7gdt', 'Save listings into named lists', 'I bookmark services for different clients and they all land in one long pile. A list per client would let me send a shortlist without rebuilding it every time.', NULL, 'explore', 'complete', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'Shipped. Save anything to a named collection from its page, then find every list under Saved.', now() - interval '1440 hours', now() - interval '2880 hours', now() - interval '1440 hours', now() - interval '1440 hours', NULL),
  ('ecb48b0a-463d-4afb-a76e-fe54436c2e2d', 'fbk-n3juwv2t2f', 'Pin the important message in a busy conversation', 'Scope decisions get buried under fifty messages of back-and-forth. Pinning the agreed brief would save everyone scrolling up to find it.', NULL, 'messaging', 'complete', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'Shipped. Pin a message from its menu and everyone in the room sees it at the top.', now() - interval '1152 hours', now() - interval '2280 hours', now() - interval '1152 hours', now() - interval '1152 hours', NULL),
  ('3e8cc34d-4253-46c0-a201-19eb4af0e38e', 'fbk-8caxcq6che', 'Fund a stage by card, not only from the wallet', 'Topping up the wallet and then funding the stage is two steps and two receipts for one payment. Our finance team asked for one.', NULL, 'escrow_payments', 'complete', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'Shipped. Choose “Continue to payment” when you fund a stage to pay its escrow by card in one step.', now() - interval '2160 hours', now() - interval '3600 hours', now() - interval '2160 hours', now() - interval '2160 hours', NULL),
  ('8e0eacb1-9691-45a6-a386-b2d358cf6110', 'fbk-vvg3hx9ogb', 'A dyslexia-friendly font and a reduced-motion setting', 'Long briefs are tiring for me to read, and some of the sliding panels make me feel queasy. I''d like both settings to follow me across devices.', NULL, 'other', 'complete', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'Shipped. Appearance settings now include a dyslexia-friendly font, high contrast and reduced motion, saved to your account.', now() - interval '720 hours', now() - interval '1680 hours', now() - interval '720 hours', now() - interval '720 hours', NULL),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', 'fbk-uvz5jm44es', 'Jump anywhere from the keyboard', 'I move between five projects, my wallet and the inbox all day. A command palette would save me a dozen clicks an hour.', 'Something like Cmd+K: type a project, a person or a setting, press Enter, and you are there.', 'other', 'in_progress', '6ce1906f-caab-4708-a19e-df3d8960666e', 'In progress. The first version searches your projects, people and settings from one shortcut.', now() - interval '288 hours', now() - interval '1080 hours', now() - interval '288 hours', now() - interval '288 hours', NULL),
  ('5c024306-5d85-4c2d-a754-4120f7495fdf', 'fbk-n3uqay55h4', 'Sync booked sessions to my Google Calendar', 'Clients book review sessions here, but my day lives in Google Calendar. I have double-booked twice because I forgot to copy one across.', NULL, 'projects', 'in_progress', 'c859a726-490c-4f6d-a184-8984de3994d3', 'In progress, starting with a one-way sync of booked sessions to a calendar you connect.', now() - interval '216 hours', now() - interval '1440 hours', now() - interval '216 hours', now() - interval '216 hours', NULL),
  ('784f9758-0aa3-4847-afe3-55324da68159', 'fbk-ghna9u6per', 'Split one stage''s payment between two freelancers', 'When two of us share a stage we settle the split ourselves afterwards, which defeats the point of escrow.', NULL, 'escrow_payments', 'in_progress', 'c7173d3f-8b15-4876-afbf-499d17513a44', NULL, NULL, now() - interval '792 hours', now() - interval '144 hours', now() - interval '144 hours', NULL),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', 'fbk-2trxnwfsgp', 'Pause a stage without cancelling it', 'Sometimes our side is the blocker — a legal review, a holiday. Today we either keep the clock running or end the stage under Fair Exit, and neither is fair to the freelancer.', 'A pause would freeze the deadline and keep the escrow held, with a reason the freelancer can see.', 'projects', 'ready', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'Planned. A paused stage will freeze its deadline and keep its escrow held, and the freelancer will be told why and for how long.', now() - interval '456 hours', now() - interval '672 hours', now() - interval '456 hours', now() - interval '480 hours', NULL),
  ('1a547c30-9640-441f-ab3d-f39e9e6b93ed', 'fbk-m4n2u2dt6u', 'Remind me before a stage is due for my review', 'I only notice a stage is ready when the freelancer chases me. A heads-up the day before would let me block time to give proper feedback.', NULL, 'projects', 'ready', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', NULL, NULL, now() - interval '528 hours', now() - interval '360 hours', now() - interval '360 hours', NULL),
  ('c818784e-bac3-4689-aafa-f460bc7ee5eb', 'fbk-bdryfgh9fh', 'Saved replies for the questions I answer every week', 'Half my first messages explain the same three things: how I scope, my revision policy and what I need to start. I retype them every time.', NULL, 'messaging', 'ready', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', NULL, NULL, now() - interval '432 hours', now() - interval '240 hours', now() - interval '240 hours', NULL),
  ('7533564f-1fe7-43bc-ac23-34f122d5a60e', 'fbk-m7pzkd9434', 'Filter freelancers by working-hours overlap', 'Our team is in Lagos and we need at least three shared hours a day. I end up opening every profile to check the time zone.', NULL, 'explore', 'ready', '292e1827-f189-4f34-ab35-27c9f0320926', 'Planned. Explore will use each freelancer''s published working hours to show how many overlap with yours.', now() - interval '384 hours', now() - interval '624 hours', now() - interval '384 hours', now() - interval '408 hours', NULL),
  ('281212cf-011e-4c12-a845-6791f6899a5c', 'fbk-f36zov3j3v', 'Case studies on my profile, not just images', 'A single render doesn''t show the brief, the constraints or what changed. Clients ask me to walk them through it on a call every time.', NULL, 'profiles', 'ready', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, NULL, now() - interval '336 hours', now() - interval '168 hours', now() - interval '168 hours', NULL),
  ('f0642c6e-06b3-4b0f-aea4-9eb8faf75ae9', 'fbk-vgxyd2ex3m', 'Add a tip when I approve a stage', 'When someone goes well beyond the brief I''d like to say thank you with more than a review, without opening a new stage for it.', NULL, 'escrow_payments', 'backlog', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', NULL, NULL, now() - interval '72 hours', now() - interval '72 hours', now() - interval '72 hours', NULL),
  ('7b5216be-89f5-4a65-a70a-228c4b7d9a7b', 'fbk-t55goucrhs', 'Hide my hourly rate from search results', 'I price per project, and a rate shown out of context puts off the clients I want before we have even talked.', NULL, 'profiles', 'backlog', '3fc3da04-549b-4239-aca3-fa82f713dbaf', NULL, NULL, now() - interval '48 hours', now() - interval '48 hours', now() - interval '48 hours', NULL),
  ('3ef315a5-84b8-409a-a97f-55db2e1c1110', 'fbk-f7kpn326dg', 'Let me reply to a review on my profile', 'A client misread a delay that was on their side. I''d like to add one calm, public reply beneath their review.', NULL, 'profiles', 'backlog', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', NULL, NULL, now() - interval '24 hours', now() - interval '24 hours', now() - interval '24 hours', NULL),
  ('3a2898d0-b8c0-49b1-acd2-1da2997ee9a3', 'fbk-koc2ep2zhe', 'Let me pay a freelancer directly to skip the fee', 'For small fixes the fee feels like a lot, and we already know each other well.', NULL, 'escrow_payments', 'archived', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'Closed. Payments stay inside escrow so both sides keep their protection and the work keeps its record. A small fix can be a single-ticket purchase instead.', now() - interval '1056 hours', now() - interval '1200 hours', now() - interval '1056 hours', now() - interval '1056 hours', now() - interval '1056 hours')
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Status history
INSERT INTO community.feedback_status_events (id, idea_id, from_status, to_status, actor_id, created_at)
VALUES
  ('aacd5454-7dbb-4db1-a4a2-fc2aa354c42f', '0351db27-3323-46cc-a59f-058d9cda6452', NULL, 'backlog', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '2880 hours'),
  ('abcd55e7-7cbb-4c1e-a5a2-fdbda254c29c', '0351db27-3323-46cc-a59f-058d9cda6452', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '2520 hours'),
  ('accd577a-7bbb-4a8b-a2a2-f904a554c755', '0351db27-3323-46cc-a59f-058d9cda6452', 'ready', 'in_progress', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '1920 hours'),
  ('adcd590d-7abb-48f8-a3a2-fa97a454c5c2', '0351db27-3323-46cc-a59f-058d9cda6452', 'in_progress', 'complete', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '1440 hours'),
  ('2d2c72fb-5f8e-4b3c-a3dd-1b2dc27e3f5e', 'ecb48b0a-463d-4afb-a76e-fe54436c2e2d', NULL, 'backlog', '35ce4987-15b3-4c38-a438-2bb9c35df15a', now() - interval '2280 hours'),
  ('2c2c7168-608e-4ccf-a2dd-199ac37e40f1', 'ecb48b0a-463d-4afb-a76e-fe54436c2e2d', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '2040 hours'),
  ('2f2c7621-618e-4e62-a1dd-1807c07e3c38', 'ecb48b0a-463d-4afb-a76e-fe54436c2e2d', 'ready', 'in_progress', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '1680 hours'),
  ('2e2c748e-628e-4ff5-a0dd-1674c17e3dcb', 'ecb48b0a-463d-4afb-a76e-fe54436c2e2d', 'in_progress', 'complete', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '1152 hours'),
  ('612c9930-cfc8-450b-a8c6-635e81be76f9', '3e8cc34d-4253-46c0-a201-19eb4af0e38e', NULL, 'backlog', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', now() - interval '3600 hours'),
  ('622c9ac3-cec8-4378-a9c6-64f180be7566', '3e8cc34d-4253-46c0-a201-19eb4af0e38e', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '3360 hours'),
  ('632c9c56-d1c8-4831-a6c6-60387fbe73d3', '3e8cc34d-4253-46c0-a201-19eb4af0e38e', 'ready', 'in_progress', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '2640 hours'),
  ('642c9de9-d0c8-469e-a7c6-61cb7ebe7240', '3e8cc34d-4253-46c0-a201-19eb4af0e38e', 'in_progress', 'complete', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '2160 hours'),
  ('22da5ade-8ba8-45e7-a092-3388a7fea751', '8e0eacb1-9691-45a6-a386-b2d358cf6110', NULL, 'backlog', '3fc3da04-549b-4239-aca3-fa82f713dbaf', now() - interval '1680 hours'),
  ('23da5c71-8aa8-4454-a192-351ba6fea5be', '8e0eacb1-9691-45a6-a386-b2d358cf6110', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '1536 hours'),
  ('20da57b8-8da8-490d-a292-36aea5fea42b', '8e0eacb1-9691-45a6-a386-b2d358cf6110', 'ready', 'in_progress', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '1200 hours'),
  ('21da594b-8ca8-477a-a392-3841a4fea298', '8e0eacb1-9691-45a6-a386-b2d358cf6110', 'in_progress', 'complete', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '720 hours'),
  ('48d1bdd8-bfb9-477d-a5a5-349e6637ee83', 'ec41d453-b79a-4330-a0a5-aa9116dd86a6', NULL, 'backlog', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '1080 hours'),
  ('49d1bf6b-beb9-45ea-a6a5-36316537ecf0', 'ec41d453-b79a-4330-a0a5-aa9116dd86a6', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '912 hours'),
  ('4ad1c0fe-bdb9-4457-a3a5-31786837f1a9', 'ec41d453-b79a-4330-a0a5-aa9116dd86a6', 'ready', 'in_progress', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '288 hours'),
  ('b89e72c1-ce86-43a0-a9ac-537b51ed6a2a', '5c024306-5d85-4c2d-a754-4120f7495fdf', NULL, 'backlog', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '1440 hours'),
  ('b79e712e-cf86-4533-a8ac-51e852ed6bbd', '5c024306-5d85-4c2d-a754-4120f7495fdf', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '1200 hours'),
  ('b69e6f9b-d086-46c6-abac-56a14fed6704', '5c024306-5d85-4c2d-a754-4120f7495fdf', 'ready', 'in_progress', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '216 hours'),
  ('ef0a0947-2a18-489e-ac6d-d329d33b67c8', '784f9758-0aa3-4847-afe3-55324da68159', NULL, 'backlog', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '792 hours'),
  ('ee0a07b4-2b18-4a31-ab6d-d196d43b695b', '784f9758-0aa3-4847-afe3-55324da68159', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '600 hours'),
  ('f10a0c6d-2818-4578-aa6d-d003d53b6aee', '784f9758-0aa3-4847-afe3-55324da68159', 'ready', 'in_progress', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '144 hours'),
  ('a9ee61b2-f726-4f03-a40c-2b8840ed4f19', '171588ad-e8d3-4e36-a1cb-398bc14dc9d4', NULL, 'backlog', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', now() - interval '672 hours'),
  ('aaee6345-f626-4d70-a50c-2d1b3fed4d86', '171588ad-e8d3-4e36-a1cb-398bc14dc9d4', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '480 hours'),
  ('ee2a5f7b-db4d-4676-af29-0a3121b9a084', '1a547c30-9640-441f-ab3d-f39e9e6b93ed', NULL, 'backlog', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '528 hours'),
  ('ed2a5de8-dc4d-4809-ae29-089e22b9a217', '1a547c30-9640-441f-ab3d-f39e9e6b93ed', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '360 hours'),
  ('8a9136e5-b4ee-4f70-af4e-6c1ff8e5dfaa', 'c818784e-bac3-4689-aafa-f460bc7ee5eb', NULL, 'backlog', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '432 hours'),
  ('89913552-b5ee-4103-ae4e-6a8cf9e5e13d', 'c818784e-bac3-4689-aafa-f460bc7ee5eb', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '240 hours'),
  ('fad3a858-9a5e-4c41-aa8b-a7d2d1685403', '7533564f-1fe7-43bc-ac23-34f122d5a60e', NULL, 'backlog', '292e1827-f189-4f34-ab35-27c9f0320926', now() - interval '624 hours'),
  ('fbd3a9eb-995e-4aae-ab8b-a965d0685270', '7533564f-1fe7-43bc-ac23-34f122d5a60e', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '408 hours'),
  ('128811ba-ee95-4a71-ac9a-a6648acd7743', '281212cf-011e-4c12-a845-6791f6899a5c', NULL, 'backlog', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '336 hours'),
  ('1388134d-ed95-48de-ad9a-a7f789cd75b0', '281212cf-011e-4c12-a845-6791f6899a5c', 'backlog', 'ready', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '168 hours'),
  ('60eadbdf-50a7-4d98-a529-3f9958a35292', 'f0642c6e-06b3-4b0f-aea4-9eb8faf75ae9', NULL, 'backlog', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '72 hours'),
  ('32c0bef5-50e3-48b0-ada3-924bd4802846', '7b5216be-89f5-4a65-a70a-228c4b7d9a7b', NULL, 'backlog', '3fc3da04-549b-4239-aca3-fa82f713dbaf', now() - interval '48 hours'),
  ('607f984e-4079-457b-a0c0-6f9c002cb429', '3ef315a5-84b8-409a-a97f-55db2e1c1110', NULL, 'backlog', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', now() - interval '24 hours'),
  ('3cc4850d-fb70-43e6-ad4c-c89703cd8418', '3a2898d0-b8c0-49b1-acd2-1da2997ee9a3', NULL, 'backlog', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', now() - interval '1200 hours'),
  ('3bc4837a-fc70-4579-ac4c-c70404cd85ab', '3a2898d0-b8c0-49b1-acd2-1da2997ee9a3', 'backlog', 'archived', 'd568b6e7-1194-445a-a50e-f3a594be7688', now() - interval '1056 hours')
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Votes (the author's first)
INSERT INTO community.feedback_votes (idea_id, user_id, created_at)
VALUES
  ('0351db27-3323-46cc-a59f-058d9cda6452', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '2880 hours'),
  ('0351db27-3323-46cc-a59f-058d9cda6452', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '2863 hours'),
  ('0351db27-3323-46cc-a59f-058d9cda6452', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '2846 hours'),
  ('0351db27-3323-46cc-a59f-058d9cda6452', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '2830 hours'),
  ('0351db27-3323-46cc-a59f-058d9cda6452', '950d68d1-8777-4bbe-ae59-3343e3e7f858', now() - interval '2813 hours'),
  ('0351db27-3323-46cc-a59f-058d9cda6452', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '2796 hours'),
  ('ecb48b0a-463d-4afb-a76e-fe54436c2e2d', '35ce4987-15b3-4c38-a438-2bb9c35df15a', now() - interval '2280 hours'),
  ('ecb48b0a-463d-4afb-a76e-fe54436c2e2d', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', now() - interval '2263 hours'),
  ('ecb48b0a-463d-4afb-a76e-fe54436c2e2d', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '2246 hours'),
  ('ecb48b0a-463d-4afb-a76e-fe54436c2e2d', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', now() - interval '2230 hours'),
  ('ecb48b0a-463d-4afb-a76e-fe54436c2e2d', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '2213 hours'),
  ('3e8cc34d-4253-46c0-a201-19eb4af0e38e', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', now() - interval '3600 hours'),
  ('3e8cc34d-4253-46c0-a201-19eb4af0e38e', '35ce4987-15b3-4c38-a438-2bb9c35df15a', now() - interval '3583 hours'),
  ('3e8cc34d-4253-46c0-a201-19eb4af0e38e', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', now() - interval '3566 hours'),
  ('3e8cc34d-4253-46c0-a201-19eb4af0e38e', '292e1827-f189-4f34-ab35-27c9f0320926', now() - interval '3550 hours'),
  ('3e8cc34d-4253-46c0-a201-19eb4af0e38e', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '3533 hours'),
  ('3e8cc34d-4253-46c0-a201-19eb4af0e38e', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '3516 hours'),
  ('3e8cc34d-4253-46c0-a201-19eb4af0e38e', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '3499 hours'),
  ('8e0eacb1-9691-45a6-a386-b2d358cf6110', '3fc3da04-549b-4239-aca3-fa82f713dbaf', now() - interval '1680 hours'),
  ('8e0eacb1-9691-45a6-a386-b2d358cf6110', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '1663 hours'),
  ('8e0eacb1-9691-45a6-a386-b2d358cf6110', '950d68d1-8777-4bbe-ae59-3343e3e7f858', now() - interval '1646 hours'),
  ('8e0eacb1-9691-45a6-a386-b2d358cf6110', '2e4274fb-e76b-4640-ad31-c66d7fbea842', now() - interval '1630 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '1080 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '1063 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '1046 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', now() - interval '1030 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', '2e4274fb-e76b-4640-ad31-c66d7fbea842', now() - interval '1013 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '996 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '979 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', '3fc3da04-549b-4239-aca3-fa82f713dbaf', now() - interval '962 hours'),
  ('ec41d453-b79a-4330-a0a5-aa9116dd86a6', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '946 hours'),
  ('5c024306-5d85-4c2d-a754-4120f7495fdf', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '1440 hours'),
  ('5c024306-5d85-4c2d-a754-4120f7495fdf', '950d68d1-8777-4bbe-ae59-3343e3e7f858', now() - interval '1423 hours'),
  ('5c024306-5d85-4c2d-a754-4120f7495fdf', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '1406 hours'),
  ('5c024306-5d85-4c2d-a754-4120f7495fdf', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '1390 hours'),
  ('5c024306-5d85-4c2d-a754-4120f7495fdf', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '1373 hours'),
  ('5c024306-5d85-4c2d-a754-4120f7495fdf', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '1356 hours'),
  ('784f9758-0aa3-4847-afe3-55324da68159', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '792 hours'),
  ('784f9758-0aa3-4847-afe3-55324da68159', '2e4274fb-e76b-4640-ad31-c66d7fbea842', now() - interval '775 hours'),
  ('784f9758-0aa3-4847-afe3-55324da68159', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', now() - interval '758 hours'),
  ('784f9758-0aa3-4847-afe3-55324da68159', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '742 hours'),
  ('784f9758-0aa3-4847-afe3-55324da68159', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', now() - interval '725 hours'),
  ('784f9758-0aa3-4847-afe3-55324da68159', '3fc3da04-549b-4239-aca3-fa82f713dbaf', now() - interval '708 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', now() - interval '672 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', '35ce4987-15b3-4c38-a438-2bb9c35df15a', now() - interval '655 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', '292e1827-f189-4f34-ab35-27c9f0320926', now() - interval '638 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', now() - interval '622 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '605 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '588 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '571 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '554 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '538 hours'),
  ('171588ad-e8d3-4e36-a1cb-398bc14dc9d4', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', now() - interval '521 hours'),
  ('1a547c30-9640-441f-ab3d-f39e9e6b93ed', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '528 hours'),
  ('1a547c30-9640-441f-ab3d-f39e9e6b93ed', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '511 hours'),
  ('1a547c30-9640-441f-ab3d-f39e9e6b93ed', '35ce4987-15b3-4c38-a438-2bb9c35df15a', now() - interval '494 hours'),
  ('1a547c30-9640-441f-ab3d-f39e9e6b93ed', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', now() - interval '478 hours'),
  ('c818784e-bac3-4689-aafa-f460bc7ee5eb', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', now() - interval '432 hours'),
  ('c818784e-bac3-4689-aafa-f460bc7ee5eb', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '415 hours'),
  ('c818784e-bac3-4689-aafa-f460bc7ee5eb', 'c7173d3f-8b15-4876-afbf-499d17513a44', now() - interval '398 hours'),
  ('c818784e-bac3-4689-aafa-f460bc7ee5eb', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '382 hours'),
  ('c818784e-bac3-4689-aafa-f460bc7ee5eb', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '365 hours'),
  ('7533564f-1fe7-43bc-ac23-34f122d5a60e', '292e1827-f189-4f34-ab35-27c9f0320926', now() - interval '624 hours'),
  ('7533564f-1fe7-43bc-ac23-34f122d5a60e', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', now() - interval '607 hours'),
  ('7533564f-1fe7-43bc-ac23-34f122d5a60e', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', now() - interval '590 hours'),
  ('7533564f-1fe7-43bc-ac23-34f122d5a60e', '35ce4987-15b3-4c38-a438-2bb9c35df15a', now() - interval '574 hours'),
  ('7533564f-1fe7-43bc-ac23-34f122d5a60e', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', now() - interval '557 hours'),
  ('7533564f-1fe7-43bc-ac23-34f122d5a60e', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '540 hours'),
  ('7533564f-1fe7-43bc-ac23-34f122d5a60e', '950d68d1-8777-4bbe-ae59-3343e3e7f858', now() - interval '523 hours'),
  ('281212cf-011e-4c12-a845-6791f6899a5c', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', now() - interval '336 hours'),
  ('281212cf-011e-4c12-a845-6791f6899a5c', '6ce1906f-caab-4708-a19e-df3d8960666e', now() - interval '319 hours'),
  ('281212cf-011e-4c12-a845-6791f6899a5c', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', now() - interval '302 hours'),
  ('281212cf-011e-4c12-a845-6791f6899a5c', 'c859a726-490c-4f6d-a184-8984de3994d3', now() - interval '286 hours'),
  ('f0642c6e-06b3-4b0f-aea4-9eb8faf75ae9', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', now() - interval '72 hours'),
  ('7b5216be-89f5-4a65-a70a-228c4b7d9a7b', '3fc3da04-549b-4239-aca3-fa82f713dbaf', now() - interval '48 hours'),
  ('3ef315a5-84b8-409a-a97f-55db2e1c1110', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', now() - interval '24 hours'),
  ('3a2898d0-b8c0-49b1-acd2-1da2997ee9a3', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', now() - interval '1200 hours')
ON CONFLICT (idea_id, user_id) DO NOTHING;
-- #endregion
