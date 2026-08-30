-- =============================================================================================
-- 03_marketplace.sql — service blueprints
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- marketplace.service_blueprints owns HOW a service is delivered and priced. Its publication (draft/published, gallery, taxonomy) is catalogue.listings, seeded in 04.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO marketplace.service_blueprints (id, freelancer_profile_id, title, description, description_text,
    pricing_model, price_cents, currency, requires_upfront_escrow, max_seats_per_cohort,
    allow_continuous_enrollment, session_template_rules, is_published)
VALUES
  ('bccc7920-ca19-4f5f-aa0e-f572e1e8b029', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Design-system foundation', '{}'::jsonb, 'Tokens, core components, and usage docs delivered as a living Figma library plus a coded foundation.', 'flat_fee', 320000, 'USD', true, 1, false, '{}'::jsonb, true),
  ('56b1183a-92e4-4f4d-a30e-1e983a201c6b', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'Landing page in a week', '{}'::jsonb, 'One high-converting landing page — copy polish, responsive build, and analytics wired in five days.', 'flat_fee', 240000, 'USD', true, 1, false, '{}'::jsonb, true),
  ('871a653c-93a9-45f9-a35f-8d3a3a0d3457', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'Product launch film', '{}'::jsonb, 'A 60-second launch film — script, 3D motion, sound design, and cutdowns for every channel.', 'flat_fee', 610000, 'USD', true, 1, false, '{}'::jsonb, true),
  ('7b1b3f95-50bb-4b14-a1fa-457bd622993a', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'Packaging art direction', '{}'::jsonb, 'A single, self-contained packaging scope: art direction, dielines, and print-ready files from a defined team.', 'flat_fee', 190000, 'USD', true, 1, false, '{}'::jsonb, true),
  ('40d68e27-474f-4b56-a37e-1605cbc3fdb4', '6ce1906f-caab-4708-a19e-df3d8960666e', 'Design systems workshop', '{}'::jsonb, 'A live, multi-seat workshop: build a token-driven design system alongside a small cohort, seats sold per attendee.', 'flat_fee', 9000, 'USD', true, 1, false, '{}'::jsonb, true)
ON CONFLICT (id) DO NOTHING;
