-- =============================================================================================
-- 04_catalogue.sql — products, articles and the seller listings over them
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- catalogue owns the PUBLICATION layer. A listing points at its subject (a service blueprint or a product) rather than restating its price, so the two cannot disagree.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO catalogue.products (id, owner_user_id, title, description, description_text,
    format, category, price_cents, currency, licence, attribution_required, span)
VALUES
  ('2a178edd-ae09-4fc4-ab47-e61bbfbfcfc2', 'c60f6204-1a88-4fbd-a999-523228c50b43', 'Aurora UI kit', '{}'::jsonb, 'Aurora UI kit — a ready-to-buy download from Atelier Nova.', 'download', 'ui-kit', 7900, 'USD', 'standard', false, 3),
  ('c31e9aa2-a1ea-4495-a471-7598b963bb23', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'Grain — Lightroom pack', '{}'::jsonb, 'Grain — Lightroom pack — a ready-to-buy download from Ren Koda.', 'download', 'presets', 2400, 'USD', 'standard', false, 1),
  ('75f0ec2a-da94-4f9b-a36c-1b2044191021', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'Motion primitives', '{}'::jsonb, 'Motion primitives — a ready-to-buy download from Juno Park.', 'download', 'templates', 4900, 'USD', 'standard', false, 2),
  ('bf28e02f-9294-49b2-a2b4-43cdb3cfe348', '598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'Editorial type system', '{}'::jsonb, 'Editorial type system — a ready-to-buy download from Studio Fern.', 'download', 'templates', 12000, 'USD', 'standard', false, 3),
  ('60842026-267e-4fb1-ab6f-776cd8f6585f', '6ef3d16b-d6ea-4c6e-a664-5c0ded5e1ac0', 'Dashboard blocks', '{}'::jsonb, 'Dashboard blocks — a ready-to-buy download from North Loop.', 'download', 'templates', 6500, 'USD', 'standard', false, 2),
  ('d537bef9-ec2c-4b98-a9ad-481b8352748a', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Iconography set — 640', '{}'::jsonb, 'Iconography set — 640 — a ready-to-buy download from Maris Delacroix.', 'download', 'icons', 3800, 'USD', 'standard', false, 1),
  ('ab9f2cc0-769d-4eed-a8ba-6c4ed741b3e3', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', '3D product scenes', '{}'::jsonb, '3D product scenes — a ready-to-buy download from Ren Koda.', 'download', '3d', 9500, 'USD', 'standard', false, 2),
  ('c5e28496-b309-40fd-a25b-2a2c507012a3', '598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'Notion ops suite', '{}'::jsonb, 'Notion ops suite — a ready-to-buy download from Studio Fern.', 'download', 'templates', 2900, 'USD', 'standard', false, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.articles (id, owner_user_id, slug, title, topic, summary, body, body_text, read_minutes, status, published_at)
VALUES
  ('6fb126e8-6980-4409-a127-7ac65f1cae7f', '598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'ar-hiring-a-team', 'How to hire a whole team, not just one person', 'hiring', 'How to hire a whole team, not just one person — a practical guide from the Projective team.', '[]'::jsonb, 'How to hire a whole team, not just one person — a practical guide from the Projective team.', 6, 'published', now() - interval '30 days'),
  ('9e4b8101-685d-4726-af54-b45fb5bd681c', '6ef3d16b-d6ea-4c6e-a664-5c0ded5e1ac0', 'ar-escrow-explained', 'Escrow, explained: how your money stays safe', 'payments', 'Escrow, explained: how your money stays safe — a practical guide from the Projective team.', '[]'::jsonb, 'Escrow, explained: how your money stays safe — a practical guide from the Projective team.', 4, 'published', now() - interval '30 days'),
  ('d13d4267-5ad3-42aa-a99a-41ed850813e8', '6ce1906f-caab-4708-a19e-df3d8960666e', 'ar-paying-step-by-step', 'Paying step by step across stages', 'payments', 'Paying step by step across stages — a practical guide from the Projective team.', '[]'::jsonb, 'Paying step by step across stages — a practical guide from the Projective team.', 5, 'published', now() - interval '30 days'),
  ('e03c4152-b433-4f7d-a461-dd30a2577e6b', 'c60f6204-1a88-4fbd-a999-523228c50b43', 'ar-running-a-small-team', 'Running a small team without the chaos', 'teams', 'Running a small team without the chaos — a practical guide from the Projective team.', '[]'::jsonb, 'Running a small team without the chaos — a practical guide from the Projective team.', 7, 'published', now() - interval '30 days'),
  ('bb082a23-6d6b-4552-afcc-ea918a16c290', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'ar-getting-started', 'Getting started on Projective', 'getting-started', 'Getting started on Projective — a practical guide from the Projective team.', '[]'::jsonb, 'Getting started on Projective — a practical guide from the Projective team.', 3, 'published', now() - interval '30 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listings (id, owner_user_id, kind, status, service_blueprint_id, product_id,
    title, description, description_text, category, delivery_label, amount_cents, currency, promoted, published_at)
VALUES
  ('ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', 'c60f6204-1a88-4fbd-a999-523228c50b43', 'product', 'published', NULL, '2a178edd-ae09-4fc4-ab47-e61bbfbfcfc2', 'Aurora UI kit', '{}'::jsonb, 'Aurora UI kit — a ready-to-buy download from Atelier Nova.', 'ui-kit', 'Instant download', 7900, 'USD', true, now() - interval '20 days'),
  ('3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'product', 'published', NULL, 'c31e9aa2-a1ea-4495-a471-7598b963bb23', 'Grain — Lightroom pack', '{}'::jsonb, 'Grain — Lightroom pack — a ready-to-buy download from Ren Koda.', 'presets', 'Instant download', 2400, 'USD', false, now() - interval '20 days'),
  ('fcd422c7-3755-4a22-a315-fa658bcc82e0', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'product', 'published', NULL, '75f0ec2a-da94-4f9b-a36c-1b2044191021', 'Motion primitives', '{}'::jsonb, 'Motion primitives — a ready-to-buy download from Juno Park.', 'templates', 'Instant download', 4900, 'USD', false, now() - interval '20 days'),
  ('af7f0bbe-7dde-4317-aa46-523cf7834c0d', '598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'product', 'published', NULL, 'bf28e02f-9294-49b2-a2b4-43cdb3cfe348', 'Editorial type system', '{}'::jsonb, 'Editorial type system — a ready-to-buy download from Studio Fern.', 'templates', 'Instant download', 12000, 'USD', false, now() - interval '20 days'),
  ('04877375-51b1-4f2e-a8fe-d37bbd0fd52c', '6ef3d16b-d6ea-4c6e-a664-5c0ded5e1ac0', 'product', 'published', NULL, '60842026-267e-4fb1-ab6f-776cd8f6585f', 'Dashboard blocks', '{}'::jsonb, 'Dashboard blocks — a ready-to-buy download from North Loop.', 'templates', 'Instant download', 6500, 'USD', false, now() - interval '20 days'),
  ('1284c43c-21de-4e61-a30c-c466ec880fdb', '6ce1906f-caab-4708-a19e-df3d8960666e', 'product', 'published', NULL, 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 'Iconography set — 640', '{}'::jsonb, 'Iconography set — 640 — a ready-to-buy download from Maris Delacroix.', 'icons', 'Instant download', 3800, 'USD', false, now() - interval '20 days'),
  ('32432859-5753-4578-ace1-c7175c28210e', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'product', 'published', NULL, 'ab9f2cc0-769d-4eed-a8ba-6c4ed741b3e3', '3D product scenes', '{}'::jsonb, '3D product scenes — a ready-to-buy download from Ren Koda.', '3d', 'Instant download', 9500, 'USD', false, now() - interval '20 days'),
  ('2aa29779-3801-48ee-a301-9937f376df6c', '598a32d5-30a1-46ee-a2eb-7b9bc7933a2c', 'product', 'published', NULL, 'c5e28496-b309-40fd-a25b-2a2c507012a3', 'Notion ops suite', '{}'::jsonb, 'Notion ops suite — a ready-to-buy download from Studio Fern.', 'templates', 'Instant download', 2900, 'USD', false, now() - interval '20 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listing_media (id, listing_id, file_id, url, alt_text, position)
VALUES
  ('32b47cf4-b7f4-4c91-a3e5-cad6d9d284b3', 'ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', NULL, 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&w=800&h=1000&q=72', 'Aurora UI kit', 0),
  ('6fd75385-cd56-460e-a42a-ad0f823cb3d0', '3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', NULL, 'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=800&h=600&q=72', 'Grain — Lightroom pack', 0),
  ('faa5d7eb-0d91-47ce-a1ff-669569255bd8', 'fcd422c7-3755-4a22-a315-fa658bcc82e0', NULL, 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=800&h=800&q=72', 'Motion primitives', 0),
  ('534c2fe2-4030-4203-afdd-368caae2ea15', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', NULL, 'https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=800&h=1000&q=72', 'Editorial type system', 0),
  ('745d8e01-c842-4aa2-aa04-0d2b2b196874', '04877375-51b1-4f2e-a8fe-d37bbd0fd52c', NULL, 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&h=800&q=72', 'Dashboard blocks', 0),
  ('16c5cd08-3f3a-4e65-a4dd-5936d21838e3', '1284c43c-21de-4e61-a30c-c466ec880fdb', NULL, 'https://images.unsplash.com/photo-1516131206008-dd041a9764fd?auto=format&fit=crop&w=800&h=600&q=72', 'Iconography set — 640', 0),
  ('820fb61d-de6b-4944-a594-9f674dad2686', '32432859-5753-4578-ace1-c7175c28210e', NULL, 'https://images.unsplash.com/photo-1633356122544-f134324a6cee?auto=format&fit=crop&w=800&h=800&q=72', '3D product scenes', 0),
  ('d7f7c1ed-305a-472a-afc6-29c703190be4', '2aa29779-3801-48ee-a301-9937f376df6c', NULL, 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=800&h=600&q=72', 'Notion ops suite', 0)
ON CONFLICT (id) DO NOTHING;
