-- =============================================================================================
-- 07_finance.sql — wallets, ledger, escrows, orders, invoices, payouts and cards
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- Every balance_after_cents is a computed running balance over a chronologically sorted event list; the generator refuses to emit a ledger that ever goes negative. The business-wallet opening-credit trigger is disabled around the wallet insert and replaced by a dated opening credit so the history reads in order.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


-- The trigger would credit every business wallet 25,000.00 at now(); the dated opening credit below replaces it.
ALTER TABLE finance.wallets DISABLE TRIGGER trg_seed_business_wallet;
INSERT INTO finance.wallets (id, owner_type, owner_id, currency, balance_cents, approval_threshold_cents, created_at)
VALUES
  ('ef814c58-b670-4eb9-a349-1cde0ca3405f', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 'USD', 433610, NULL, now() - interval '10080 hours'),
  ('046c1c0c-b930-458d-a6a3-18c6786538d7', 'freelancer', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'USD', 62780, NULL, now() - interval '9120 hours'),
  ('84176641-6aa9-49fc-a8eb-9b37c6e68d7a', 'freelancer', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'USD', 256455, NULL, now() - interval '5040 hours'),
  ('c00e32e3-ef90-4ed6-a9c8-8dcd9bc5cca8', 'user', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'USD', 500000, NULL, now() - interval '7200 hours'),
  ('a23ac59f-b6c9-4b5e-a32b-821d5534a8ac', 'user', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'USD', 250000, NULL, now() - interval '3360 hours'),
  ('92971a4e-3a52-401b-a79f-84bc00924271', 'freelancer', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'USD', 0, NULL, now() - interval '9600 hours'),
  ('c812b2d1-219c-45f4-a2a9-290b4ee06dce', 'freelancer', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'USD', 523223, NULL, now() - interval '8760 hours'),
  ('217c6524-8cd9-4e25-abdc-794a6eada21b', 'freelancer', 'c859a726-490c-4f6d-a184-8984de3994d3', 'USD', 19691, NULL, now() - interval '7920 hours'),
  ('c7bd2da7-d3fa-47d2-a0e0-1f11f8282304', 'user', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'USD', 0, NULL, now() - interval '6240 hours'),
  ('25c87fa0-2094-4281-a12a-aaf2c2b6460b', 'user', '292e1827-f189-4f34-ab35-27c9f0320926', 'USD', 0, NULL, now() - interval '5760 hours'),
  ('40be2d44-c757-42b1-a974-aa06b366558b', 'freelancer', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'USD', 0, NULL, now() - interval '4800 hours'),
  ('9cf23fa8-ae11-43c9-a727-27d6f7fee7bf', 'freelancer', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'USD', 471167, NULL, now() - interval '4320 hours'),
  ('54488420-afae-4565-a353-b74e7b1c8b1b', 'freelancer', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'USD', 8439, NULL, now() - interval '3600 hours'),
  ('66878888-d391-4731-a1e1-29ea95b990b3', 'freelancer', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'USD', 771167, NULL, now() - interval '5280 hours'),
  ('d57b8eab-0afd-4656-abd8-a91933a9a33c', 'user', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 'USD', 0, NULL, now() - interval '5520 hours'),
  ('a3fdf8df-ee21-408e-aa7d-2f4d03c642e4', 'user', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', 'USD', 0, NULL, now() - interval '4560 hours'),
  ('30eed7c0-2d2d-4655-a10a-47d2e9955427', 'freelancer', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'USD', 5000, NULL, now() - interval '288 hours'),
  ('ed74da48-3ae7-44c1-a174-5b3a4ccfe0eb', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'USD', 0, NULL, now() - interval '9600 hours'),
  ('78297a62-19ca-4e6b-afcb-a91cbaa3504d', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'USD', 285618, NULL, now() - interval '8760 hours'),
  ('ac5e5bb6-036a-4c37-a9d9-8764836875d5', 'team', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'USD', 3125, NULL, now() - interval '7920 hours'),
  ('9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'USD', 889700, 500000, now() - interval '6240 hours'),
  ('0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', 'business', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'USD', 1000000, 500000, now() - interval '5760 hours')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE finance.wallets ENABLE TRIGGER trg_seed_business_wallet;

INSERT INTO finance.escrows (id, project_stage_id, ticket_id, payer_business_id, payee_type, payee_id, amount_cents, platform_fee_cents, deadline_bonus_cents, currency, status, created_at)
VALUES
  ('d4e6f3c4-8a98-4bf1-a851-bea6553126b3', 'faa19a6c-a1b2-4453-a0a6-bf02a933dd81', '1d760dab-1897-4fce-a303-8ae991eebddc', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 800000, 0, 0, 'USD', 'held', now() - interval '144 hours'),
  ('7ab53d6b-7835-40b0-abeb-02d52985e95a', '2a5614e5-7032-4b5c-a46f-12ebe434fde2', 'c25e3602-bb8d-438d-a7f5-bf78680d33b3', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 1500000, 75000, 0, 'USD', 'released', now() - interval '960 hours'),
  ('7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', '2a5614e5-7032-4b5c-a46f-12ebe434fde2', 'c15e346f-b88d-4ed4-aaf5-c431690d3546', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 1500000, 75000, 0, 'USD', 'released', now() - interval '912 hours'),
  ('7cb54091-7a35-43d6-a9ea-ffaf2785e634', '2756102c-7332-4015-a56f-147ee334fc4f', 'c05e32dc-b98d-4067-a9f5-c29e6a0d36d9', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 2250000, 0, 0, 'USD', 'held', now() - interval '216 hours'),
  ('7db54224-7d35-488f-a6ea-faf62685e4a1', '2756102c-7332-4015-a56f-147ee334fc4f', 'bf5e3149-b68d-4bae-acf5-c7576b0d386c', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'team', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 2250000, 0, 0, 'USD', 'held', now() - interval '288 hours'),
  ('f4b59a61-5919-471e-a302-dcf3d93812d8', '1df76187-f9b7-4c96-abc4-cd4dc4f456b4', '8911b6f0-9deb-42bb-a79c-6516d6f4cbb9', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 3200000, 0, 0, 'USD', 'held', now() - interval '264 hours'),
  ('2be31aa8-1878-4317-a6c0-339e4810b70d', '8ca74d22-728b-47ff-a528-acf449954ed9', '837b9e05-7625-47a6-af74-f3cf32089c80', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 1400000, 70000, 0, 'USD', 'released', now() - interval '672 hours'),
  ('2ee31f61-1978-44aa-a5c0-320b4510b254', '8ba74b8f-738b-4992-a828-b1ad46954a20', '807b994c-7525-4613-a074-f5623508a139', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 2200000, 0, 0, 'USD', 'held', now() - interval '192 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payout_splits (id, escrow_id, member_user_id, amount_cents, currency, created_at)
VALUES
  ('e294d8c5-622d-4b42-a84b-9a375cf5511c', '7ab53d6b-7835-40b0-abeb-02d52985e95a', 'c7173d3f-8b15-4876-afbf-499d17513a44', 513000, 'USD', now() - interval '480 hours'),
  ('cbea1721-e4f6-4e94-a7a5-72f3777fc6c6', '7ab53d6b-7835-40b0-abeb-02d52985e95a', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 384750, 'USD', now() - interval '480 hours'),
  ('572bcbe4-7c0a-4c69-ad8a-88669baa9f73', '7ab53d6b-7835-40b0-abeb-02d52985e95a', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 384750, 'USD', now() - interval '480 hours'),
  ('34b2ace8-c08a-4087-a2a6-54eed121570d', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', 'c7173d3f-8b15-4876-afbf-499d17513a44', 513000, 'USD', now() - interval '528 hours'),
  ('6d09e6a2-2f62-4643-a751-4bc0846076b9', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 384750, 'USD', now() - interval '528 hours'),
  ('8f5eda87-9be2-41d6-a3f9-2e0d27c7c68c', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 384750, 'USD', now() - interval '528 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.transactions (id, wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id, balance_after_cents, fund_state, created_at)
VALUES
  ('fcf56533-fb26-4296-a16f-bc21802efe24', 'ef814c58-b670-4eb9-a349-1cde0ca3405f', 'credit', 3610, 'USD', 'product_sale', 'order_lines', 'c51e3545-b216-47c8-ae5e-17afac1b7a02', 3610, 'available', now() - interval '1440 hours' + interval '0 seconds'),
  ('44c79efa-37a0-45d7-a340-0190c1925be5', 'ef814c58-b670-4eb9-a349-1cde0ca3405f', 'debit', 3610, 'USD', 'refund', 'orders', 'c9b2f5a7-2159-445e-acbd-2205292f28bc', 0, 'available', now() - interval '1392 hours' + interval '1 seconds'),
  ('074e1bc8-dde2-41b9-a31a-6f52c138bb1b', 'ef814c58-b670-4eb9-a349-1cde0ca3405f', 'credit', 3610, 'USD', 'product_sale', 'order_lines', '8f4e296f-fb45-41ba-ac09-1985327e6070', 3610, 'available', now() - interval '792 hours' + interval '2 seconds'),
  ('590bc5e8-643d-4207-a720-95d607a540b5', 'ef814c58-b670-4eb9-a349-1cde0ca3405f', 'credit', 1330000, 'USD', 'escrow_release', 'escrows', '2be31aa8-1878-4317-a6c0-339e4810b70d', 1333610, 'available', now() - interval '360 hours' + interval '3 seconds'),
  ('0aedad8b-416d-429e-a687-0fe90d272754', 'ef814c58-b670-4eb9-a349-1cde0ca3405f', 'debit', 900000, 'USD', 'payout', 'payouts', 'e46db340-f314-4e0b-a996-cf7257a6ce6d', 433610, 'available', now() - interval '240 hours' + interval '4 seconds'),
  ('a65f28d4-a45d-43f5-ae19-7392b9670403', '046c1c0c-b930-458d-a6a3-18c6786538d7', 'credit', 180500, 'USD', 'service_sale', 'order_lines', '7b67221e-eddb-4b17-af8f-28f4bbd5b1b5', 180500, 'available', now() - interval '1680 hours' + interval '0 seconds'),
  ('7129c05b-13b0-44ae-aa6b-22658550c7d8', '046c1c0c-b930-458d-a6a3-18c6786538d7', 'debit', 120000, 'USD', 'payout', 'payouts', '3de3d796-bd3c-464d-a806-1d284a28fb87', 60500, 'available', now() - interval '960 hours' + interval '1 seconds'),
  ('f643d724-3e73-45d7-a98b-7c0eb3fbc9b1', '046c1c0c-b930-458d-a6a3-18c6786538d7', 'credit', 2280, 'USD', 'product_sale', 'order_lines', '770c8aa5-ee34-428e-abc6-2bf392c02944', 62780, 'available', now() - interval '96 hours' + interval '2 seconds'),
  ('cb8d6ac1-b9b5-4cd0-afb0-1c2fab5dbd5e', '84176641-6aa9-49fc-a8eb-9b37c6e68d7a', 'credit', 20000, 'USD', 'topup', 'payment_methods', '62f947aa-9837-4099-ad8b-03f870eeff3f', 20000, 'available', now() - interval '1488 hours' + interval '0 seconds'),
  ('0ecb0ce1-e42a-433c-a37d-4b5708618ab2', '84176641-6aa9-49fc-a8eb-9b37c6e68d7a', 'credit', 3800, 'USD', 'refund', 'orders', 'c9b2f5a7-2159-445e-acbd-2205292f28bc', 23800, 'available', now() - interval '1392 hours' + interval '1 seconds'),
  ('5401a815-fc97-4328-a910-4bd7382ad682', '84176641-6aa9-49fc-a8eb-9b37c6e68d7a', 'credit', 228000, 'USD', 'service_sale', 'order_lines', '1f0d052c-349b-4cb7-aaea-d06228463005', 251800, 'available', now() - interval '1080 hours' + interval '2 seconds'),
  ('976161db-a07c-49ba-a4b3-1c61cf127ca0', '84176641-6aa9-49fc-a8eb-9b37c6e68d7a', 'credit', 4655, 'USD', 'product_sale', 'order_lines', '4ee46311-2c97-446c-adb9-36cb027a3786', 256455, 'available', now() - interval '288 hours' + interval '3 seconds'),
  ('307fac13-6a97-466c-aea5-40e9741565aa', 'c00e32e3-ef90-4ed6-a9c8-8dcd9bc5cca8', 'credit', 500000, 'USD', 'topup', 'payment_methods', '90853d86-ebdc-4f39-a4ef-6ee83cb456ab', 500000, 'available', now() - interval '672 hours' + interval '0 seconds'),
  ('a5286317-7e61-4fa0-aabf-8e319a607fa2', 'a23ac59f-b6c9-4b5e-a32b-821d5534a8ac', 'credit', 250000, 'USD', 'topup', 'payment_methods', 'dea1ee78-8b88-4353-a495-c33edbc899b9', 250000, 'available', now() - interval '360 hours' + interval '0 seconds'),
  ('58b91208-72d9-4841-ac87-0d36cd16f697', 'c812b2d1-219c-45f4-a2a9-290b4ee06dce', 'credit', 2223, 'USD', 'team_split', 'order_lines', '86de2250-ed65-466f-afc9-dec2ef513349', 2223, 'available', now() - interval '792 hours' + interval '0 seconds'),
  ('9878226a-efba-45e3-afea-1b40bfa54299', 'c812b2d1-219c-45f4-a2a9-290b4ee06dce', 'credit', 513000, 'USD', 'team_split', 'escrows', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', 515223, 'available', now() - interval '528 hours' + interval '1 seconds'),
  ('fe986231-e69a-4d0c-ab77-fed7a0f297a2', 'c812b2d1-219c-45f4-a2a9-290b4ee06dce', 'credit', 513000, 'USD', 'team_split', 'escrows', '7ab53d6b-7835-40b0-abeb-02d52985e95a', 1028223, 'available', now() - interval '480 hours' + interval '2 seconds'),
  ('35c51693-57bc-448a-ad0f-cb1109646fd8', 'c812b2d1-219c-45f4-a2a9-290b4ee06dce', 'debit', 500000, 'USD', 'payout', 'payouts', '4a4879d7-39c1-4884-a6db-9c45bc05602a', 528223, 'available', now() - interval '384 hours' + interval '3 seconds'),
  ('83da38fe-9a21-486f-a76a-f3600f269291', 'c812b2d1-219c-45f4-a2a9-290b4ee06dce', 'debit', 5000, 'USD', 'instant_payout_fee', 'payouts', '4a4879d7-39c1-4884-a6db-9c45bc05602a', 523223, 'available', now() - interval '384 hours' + interval '4 seconds'),
  ('03eabfe4-24d6-4a15-a688-dfdab4b529ab', '217c6524-8cd9-4e25-abdc-794a6eada21b', 'credit', 7182, 'USD', 'team_split', 'order_lines', 'c77a13ff-2426-434e-a7f5-119d71d0f854', 7182, 'available', now() - interval '600 hours' + interval '0 seconds'),
  ('0475dde5-b53c-4e64-a1b0-9b37a230a656', '217c6524-8cd9-4e25-abdc-794a6eada21b', 'credit', 1736, 'USD', 'team_split', 'order_lines', '9ee972f3-4d66-41c8-a41d-614d53220442', 8918, 'available', now() - interval '288 hours' + interval '1 seconds'),
  ('e952a06d-d331-4100-a85c-6827b8541e02', '217c6524-8cd9-4e25-abdc-794a6eada21b', 'credit', 10773, 'USD', 'team_split', 'order_lines', 'd6f84d3b-73e4-47b4-abcb-c35df01ae22e', 19691, 'available', now() - interval '72 hours' + interval '2 seconds'),
  ('13fb40a9-a691-4798-afb4-8e670c0bff2e', '9cf23fa8-ae11-43c9-a727-27d6f7fee7bf', 'credit', 1667, 'USD', 'team_split', 'order_lines', '86de2250-ed65-466f-afc9-dec2ef513349', 1667, 'available', now() - interval '792 hours' + interval '0 seconds'),
  ('af5572de-8191-477b-ac9d-e84cd0193bd9', '9cf23fa8-ae11-43c9-a727-27d6f7fee7bf', 'credit', 384750, 'USD', 'team_split', 'escrows', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', 386417, 'available', now() - interval '528 hours' + interval '1 seconds'),
  ('cb769b3d-fe35-44a4-a580-9d5349130a9a', '9cf23fa8-ae11-43c9-a727-27d6f7fee7bf', 'credit', 384750, 'USD', 'team_split', 'escrows', '7ab53d6b-7835-40b0-abeb-02d52985e95a', 771167, 'available', now() - interval '480 hours' + interval '2 seconds'),
  ('0616346b-29c4-438e-a9e5-97d919e89d34', '9cf23fa8-ae11-43c9-a727-27d6f7fee7bf', 'debit', 300000, 'USD', 'payout', 'payouts', '370d8eb4-a641-4cc9-af7f-23565dee150b', 471167, 'available', now() - interval '336 hours' + interval '3 seconds'),
  ('14e4db61-2036-4688-aa2e-8fd335901efa', '54488420-afae-4565-a353-b74e7b1c8b1b', 'credit', 3078, 'USD', 'team_split', 'order_lines', 'c77a13ff-2426-434e-a7f5-119d71d0f854', 3078, 'available', now() - interval '600 hours' + interval '0 seconds'),
  ('34ae33f4-402d-491b-a9f0-0bb64519401d', '54488420-afae-4565-a353-b74e7b1c8b1b', 'credit', 744, 'USD', 'team_split', 'order_lines', '9ee972f3-4d66-41c8-a41d-614d53220442', 3822, 'available', now() - interval '288 hours' + interval '1 seconds'),
  ('3a4a8c48-8e4d-4d07-a2ce-1456dad5a035', '54488420-afae-4565-a353-b74e7b1c8b1b', 'credit', 4617, 'USD', 'team_split', 'order_lines', 'd6f84d3b-73e4-47b4-abcb-c35df01ae22e', 8439, 'available', now() - interval '72 hours' + interval '2 seconds'),
  ('2cd0f049-9bd2-456c-ac38-c113eeb4ac36', '66878888-d391-4731-a1e1-29ea95b990b3', 'credit', 1667, 'USD', 'team_split', 'order_lines', '86de2250-ed65-466f-afc9-dec2ef513349', 1667, 'available', now() - interval '792 hours' + interval '0 seconds'),
  ('c097b87e-c404-444f-a5c5-4e7884b049c1', '66878888-d391-4731-a1e1-29ea95b990b3', 'credit', 384750, 'USD', 'team_split', 'escrows', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', 386417, 'available', now() - interval '528 hours' + interval '1 seconds'),
  ('bae85ddd-782a-4178-a0c5-285f3d158502', '66878888-d391-4731-a1e1-29ea95b990b3', 'credit', 384750, 'USD', 'team_split', 'escrows', '7ab53d6b-7835-40b0-abeb-02d52985e95a', 771167, 'available', now() - interval '480 hours' + interval '2 seconds'),
  ('f19f66c9-b680-47ac-ad34-8d23bd1aee8e', '30eed7c0-2d2d-4655-a10a-47d2e9955427', 'credit', 5000, 'USD', 'topup', 'payment_methods', '4f9d3f2b-4c42-467a-a45d-f669f8fef608', 5000, 'available', now() - interval '120 hours' + interval '0 seconds'),
  ('6b5aee13-ae82-4c9c-a34b-7b41e7feb1b2', '78297a62-19ca-4e6b-afcb-a91cbaa3504d', 'credit', 618, 'USD', 'product_sale_vault_retention', 'order_lines', '86de2250-ed65-466f-afc9-dec2ef513349', 618, 'available', now() - interval '792 hours' + interval '0 seconds'),
  ('8c4a26d2-2500-499f-ab10-2a2c8db64fe1', '78297a62-19ca-4e6b-afcb-a91cbaa3504d', 'credit', 142500, 'USD', 'escrow_release_vault_retention', 'escrows', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', 143118, 'available', now() - interval '528 hours' + interval '1 seconds'),
  ('6b951625-d611-4074-af61-b4e7cb3d2f6e', '78297a62-19ca-4e6b-afcb-a91cbaa3504d', 'credit', 142500, 'USD', 'escrow_release_vault_retention', 'escrows', '7ab53d6b-7835-40b0-abeb-02d52985e95a', 285618, 'available', now() - interval '480 hours' + interval '2 seconds'),
  ('15600a4a-67c3-4173-afac-830c0aefa7a5', 'ac5e5bb6-036a-4c37-a9d9-8764836875d5', 'credit', 1140, 'USD', 'product_sale_vault_retention', 'order_lines', 'c77a13ff-2426-434e-a7f5-119d71d0f854', 1140, 'available', now() - interval '600 hours' + interval '0 seconds'),
  ('e878a8b8-d9f8-4e73-ac65-5ca6d535af09', 'ac5e5bb6-036a-4c37-a9d9-8764836875d5', 'credit', 275, 'USD', 'product_sale_vault_retention', 'order_lines', '9ee972f3-4d66-41c8-a41d-614d53220442', 1415, 'available', now() - interval '288 hours' + interval '1 seconds'),
  ('fb17403c-a486-4033-a972-6ee252d8d549', 'ac5e5bb6-036a-4c37-a9d9-8764836875d5', 'credit', 1710, 'USD', 'service_sale_vault_retention', 'order_lines', 'd6f84d3b-73e4-47b4-abcb-c35df01ae22e', 3125, 'available', now() - interval '72 hours' + interval '2 seconds'),
  ('3e736aaa-1ba1-4851-ae4d-8fc4f8de7a1b', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'credit', 2500000, 'USD', 'demo_opening_credit', NULL, NULL, 2500000, 'available', now() - interval '6240 hours' + interval '0 seconds'),
  ('ded389c2-6519-40bb-aa60-c538d3bab759', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'debit', 10300, 'USD', 'order_payment', 'orders', 'c7b2f281-2359-4784-a6bd-1893272f2596', 2489700, 'available', now() - interval '792 hours' + interval '1 seconds'),
  ('2ea1c2a1-837d-4d9c-a85f-d39b2a4debee', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'credit', 6000000, 'USD', 'topup', 'payment_methods', 'a56c90b9-18ce-4b60-aac6-3b9f25e463c6', 8489700, 'available', now() - interval '720 hours' + interval '2 seconds'),
  ('0ef967b9-b1cb-4394-a9a0-fb4f1fe3780a', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'debit', 1400000, 'USD', 'escrow_hold', 'escrows', '2be31aa8-1878-4317-a6c0-339e4810b70d', 7089700, 'locked', now() - interval '672 hours' + interval '3 seconds'),
  ('9a0c919f-14f0-41e6-a15c-2a1d2923fb0c', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'debit', 3200000, 'USD', 'escrow_hold', 'escrows', 'f4b59a61-5919-471e-a302-dcf3d93812d8', 3889700, 'locked', now() - interval '264 hours' + interval '4 seconds'),
  ('023f1f97-b228-4138-af17-d0a9c9554d0a', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'debit', 2200000, 'USD', 'escrow_hold', 'escrows', '2ee31f61-1978-44aa-a5c0-320b4510b254', 1689700, 'locked', now() - interval '192 hours' + interval '5 seconds'),
  ('29d66bfc-94f2-4195-a73f-b12679bcfb6f', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'debit', 800000, 'USD', 'escrow_hold', 'escrows', 'd4e6f3c4-8a98-4bf1-a851-bea6553126b3', 889700, 'locked', now() - interval '144 hours' + interval '6 seconds'),
  ('7c73bdd7-5d81-481c-a5a0-652d0e0cf3d2', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', 'credit', 2500000, 'USD', 'demo_opening_credit', NULL, NULL, 2500000, 'available', now() - interval '5760 hours' + interval '0 seconds'),
  ('fd22e83f-7f85-4ed2-a677-c905a0d79258', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', 'credit', 6000000, 'USD', 'topup', 'payment_methods', '961d7515-cb55-44bc-a6c5-f0ffd3d32c6e', 8500000, 'available', now() - interval '1056 hours' + interval '1 seconds'),
  ('4e690dab-dc75-4cc6-aab8-ffcda5f155a8', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', 'debit', 1500000, 'USD', 'escrow_hold', 'escrows', '7ab53d6b-7835-40b0-abeb-02d52985e95a', 7000000, 'locked', now() - interval '960 hours' + interval '2 seconds'),
  ('e59c020b-a032-4c02-aa29-2575ad293e74', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', 'debit', 1500000, 'USD', 'escrow_hold', 'escrows', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', 5500000, 'locked', now() - interval '912 hours' + interval '3 seconds'),
  ('39d91636-4cca-4cf7-a387-8fe093454a71', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', 'debit', 2250000, 'USD', 'escrow_hold', 'escrows', '7db54224-7d35-488f-a6ea-faf62685e4a1', 3250000, 'locked', now() - interval '288 hours' + interval '4 seconds'),
  ('85766a04-2ee5-4b5b-a7ae-926a4ed07cc9', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', 'debit', 2250000, 'USD', 'escrow_hold', 'escrows', '7cb54091-7a35-43d6-a9ea-ffaf2785e634', 1000000, 'locked', now() - interval '216 hours' + interval '5 seconds')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payment_methods (id, owner_type, owner_id, method_role, provider, external_ref, label, brand, last4, is_default_funding, is_default_payout, status, created_at)
VALUES
  ('90853d86-ebdc-4f39-a4ef-6ee83cb456ab', 'user', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'funding', 'stripe', 'pm_seed_noor', 'Noor Haddad — visa 4242', 'visa', '4242', true, false, 'active', now() - interval '1080 hours'),
  ('dea1ee78-8b88-4353-a495-c33edbc899b9', 'user', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'funding', 'stripe', 'pm_seed_theo', 'Theo Almeida — mastercard 1881', 'mastercard', '1881', true, false, 'active', now() - interval '1080 hours'),
  ('a56c90b9-18ce-4b60-aac6-3b9f25e463c6', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'funding', 'stripe', 'pm_seed_helia', 'Helia Finance Ltd — amex 0005', 'amex', '0005', true, false, 'active', now() - interval '1080 hours'),
  ('961d7515-cb55-44bc-a6c5-f0ffd3d32c6e', 'business', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'funding', 'stripe', 'pm_seed_atlas', 'Atlas Labs Inc. — visa 4444', 'visa', '4444', true, false, 'active', now() - interval '1080 hours'),
  ('4f9d3f2b-4c42-467a-a45d-f669f8fef608', 'user', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'funding', 'stripe', 'pm_seed_chloe', 'Chloe Winters — mastercard 5556', 'mastercard', '5556', true, false, 'active', now() - interval '1080 hours'),
  ('62f947aa-9837-4099-ad8b-03f870eeff3f', 'user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'funding', 'stripe', 'pm_seed_juno', 'Juno Park — visa 4444', 'visa', '4444', true, false, 'active', now() - interval '1080 hours'),
  ('5c730de3-b0c7-4610-a3e9-23894311560e', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 'payout', 'stripe', 'ba_seed_marisdelacroix', 'Bank account •••• 2518', 'bank_account', '2518', false, true, 'active', now() - interval '1200 hours'),
  ('dea1bdac-db61-472f-a993-25026a17202d', 'freelancer', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'payout', 'stripe', 'ba_seed_renkoda', 'Bank account •••• 2259', 'bank_account', '2259', false, true, 'active', now() - interval '1200 hours'),
  ('1de25004-5b13-4c9d-ac01-d45e6d6df097', 'freelancer', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'payout', 'stripe', 'ba_seed_inesduarte', 'Bank account •••• 2370', 'bank_account', '2370', false, true, 'active', now() - interval '1200 hours'),
  ('b4c0c286-66b5-4471-a1c7-1594921f969f', 'freelancer', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'payout', 'stripe', 'ba_seed_kwamemensah', 'Bank account •••• 2407', 'bank_account', '2407', false, true, 'active', now() - interval '1200 hours'),
  ('6cf3eae9-b6c0-45ce-a670-deb71ef4ef54', 'freelancer', 'c859a726-490c-4f6d-a184-8984de3994d3', 'payout', 'stripe', 'ba_seed_saoirsebyrne', 'Bank account •••• 2444', 'bank_account', '2444', false, true, 'active', now() - interval '1200 hours'),
  ('5c7b8f2b-a964-4c8e-a9e1-94d1762541a4', 'freelancer', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'payout', 'stripe', 'ba_seed_lenamueller', 'Bank account •••• 2407', 'bank_account', '2407', false, true, 'active', now() - interval '1200 hours'),
  ('16118033-84bc-42ee-aaa0-4e910d84d1bc', 'freelancer', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'payout', 'stripe', 'ba_seed_tomaszwojcik', 'Bank account •••• 2444', 'bank_account', '2444', false, true, 'active', now() - interval '1200 hours'),
  ('d2094e6d-fdba-4e50-a37d-393f52c05682', 'freelancer', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'payout', 'stripe', 'ba_seed_aikotanaka', 'Bank account •••• 2370', 'bank_account', '2370', false, true, 'active', now() - interval '1200 hours'),
  ('c4be712c-a06e-467d-a8ed-307a3976768b', 'freelancer', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'payout', 'stripe', 'ba_seed_samuelnkemelu', 'Bank account •••• 2481', 'bank_account', '2481', false, true, 'active', now() - interval '1200 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.saved_cards (id, owner_type, owner_id, payment_method_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, cardholder_name, is_business_card, created_by_user_id, is_default, created_at)
VALUES
  ('4cc2f73d-f72d-49f2-a775-fc7bb8535df0', 'user', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', '90853d86-ebdc-4f39-a4ef-6ee83cb456ab', 'pm_seed_noor', 'visa', '4242', 9, 2028, 'Noor Haddad', false, '1fee216e-a637-4619-a90a-4ae03bb1ed8b', true, now() - interval '1080 hours'),
  ('ecd67083-b847-41d8-a097-dced44646772', 'user', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'dea1ee78-8b88-4353-a495-c33edbc899b9', 'pm_seed_theo', 'mastercard', '1881', 3, 2027, 'Theo Almeida', false, '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', true, now() - interval '1080 hours'),
  ('1c0d1f66-4869-4407-ace0-56302a56e5e9', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'a56c90b9-18ce-4b60-aac6-3b9f25e463c6', 'pm_seed_helia', 'amex', '0005', 11, 2027, 'Helia Finance Ltd', true, 'de29f2ce-0f36-4db5-a417-4edc88cedf83', true, now() - interval '1080 hours'),
  ('ef38d2c2-968a-4e03-a213-a72069aed091', 'business', '4cfa4f66-9aa2-496b-a93d-994caac019c1', '961d7515-cb55-44bc-a6c5-f0ffd3d32c6e', 'pm_seed_atlas', 'visa', '4444', 6, 2029, 'Atlas Labs Inc.', true, '292e1827-f189-4f34-ab35-27c9f0320926', true, now() - interval '1080 hours'),
  ('e671e61c-a03a-442d-a730-b7f667fef6ff', 'user', '950d68d1-8777-4bbe-ae59-3343e3e7f858', '4f9d3f2b-4c42-467a-a45d-f669f8fef608', 'pm_seed_chloe', 'mastercard', '5556', 1, 2028, 'Chloe Winters', false, '950d68d1-8777-4bbe-ae59-3343e3e7f858', true, now() - interval '1080 hours'),
  ('31a0fe31-3c61-4592-a953-b01b3e124354', 'user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', '62f947aa-9837-4099-ad8b-03f870eeff3f', 'pm_seed_juno', 'visa', '4444', 4, 2027, 'Juno Park', false, '45a4c6ae-d818-45fd-a62b-db44f1f69eab', true, now() - interval '1080 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payout_accounts (id, owner_type, owner_id, provider, account_id, status, created_at)
VALUES
  ('a0d54404-c3e0-4d2b-a245-12229a3b52b1', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 'stripe', 'acct_seed_marisdelacroix', 'verified', now() - interval '1200 hours'),
  ('8c1f9f55-5f9e-4254-ae5f-a3ab561c19d2', 'freelancer', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'stripe', 'acct_seed_renkoda', 'verified', now() - interval '1200 hours'),
  ('68ffdb83-018b-44d0-aeca-6d0919fea3ee', 'freelancer', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'stripe', 'acct_seed_inesduarte', 'verified', now() - interval '1200 hours'),
  ('f072a532-2aab-47bb-a211-1c9809b52131', 'freelancer', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'stripe', 'acct_seed_kwamemensah', 'verified', now() - interval '1200 hours'),
  ('c6c45fc1-7f02-4cfa-aea9-b60fe1b35700', 'freelancer', 'c859a726-490c-4f6d-a184-8984de3994d3', 'stripe', 'acct_seed_saoirsebyrne', 'verified', now() - interval '1200 hours'),
  ('4e9d3fad-47ad-4eb8-ac6c-e24b7488e18e', 'freelancer', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'stripe', 'acct_seed_lenamueller', 'verified', now() - interval '1200 hours'),
  ('3ce675cc-3fb1-4d87-a03c-3c16dd487241', 'freelancer', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'stripe', 'acct_seed_tomaszwojcik', 'verified', now() - interval '1200 hours'),
  ('e3414895-6eb3-4cce-ad99-eb3ffa7127c0', 'freelancer', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'stripe', 'acct_seed_aikotanaka', 'verified', now() - interval '1200 hours'),
  ('643c4e0f-b145-47e2-aa78-44610fbc9474', 'freelancer', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'stripe', 'acct_seed_samuelnkemelu', 'verified', now() - interval '1200 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payout_schedules (id, owner_type, owner_id, mode, destination_method_id, threshold_cents, currency, next_run_at, instant, active)
VALUES
  ('1773f0e6-cea0-461f-ad67-0a68325b4cd1', 'freelancer', '6ce1906f-caab-4708-a19e-df3d8960666e', 'scheduled_monthly', '5c730de3-b0c7-4610-a3e9-23894311560e', NULL, 'USD', now() + interval '288 hours', false, true),
  ('d46cf34f-d3d3-4128-afce-fb2981f01372', 'freelancer', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', 'manual', 'dea1bdac-db61-472f-a993-25026a17202d', NULL, 'USD', NULL, false, true),
  ('c1a0f055-963f-43dc-a9f2-fc5f423a8a0e', 'freelancer', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'manual', '1de25004-5b13-4c9d-ac01-d45e6d6df097', NULL, 'USD', NULL, false, true),
  ('c3a84c7c-2637-404f-a366-91561d1b84d1', 'freelancer', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'threshold', 'b4c0c286-66b5-4471-a1c7-1594921f969f', 250000, 'USD', NULL, true, true),
  ('aa5356eb-1fcc-43b6-a8a8-92cd242f0d20', 'freelancer', 'c859a726-490c-4f6d-a184-8984de3994d3', 'manual', '6cf3eae9-b6c0-45ce-a670-deb71ef4ef54', NULL, 'USD', NULL, false, true),
  ('82f981a7-2ac0-4814-ae86-fb19b868af2e', 'freelancer', '3fc3da04-549b-4239-aca3-fa82f713dbaf', 'manual', '5c7b8f2b-a964-4c8e-a9e1-94d1762541a4', NULL, 'USD', NULL, false, true),
  ('f85af18a-d6d5-4c6b-a368-b5a0c05aec61', 'freelancer', '2e4274fb-e76b-4640-ad31-c66d7fbea842', 'manual', '16118033-84bc-42ee-aaa0-4e910d84d1bc', NULL, 'USD', NULL, false, true),
  ('d9024023-0784-4df2-af4f-f8a922ab7ae0', 'freelancer', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', 'manual', 'd2094e6d-fdba-4e50-a37d-393f52c05682', NULL, 'USD', NULL, false, true),
  ('694a5e55-b64e-46f6-a3fd-645323618b14', 'freelancer', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', 'manual', 'c4be712c-a06e-467d-a8ed-307a3976768b', NULL, 'USD', NULL, false, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payouts (id, wallet_id, destination_method_id, amount_cents, currency, status, instant, provider, provider_ref, transaction_id, initiated_at, settled_at)
VALUES
  ('e46db340-f314-4e0b-a996-cf7257a6ce6d', 'ef814c58-b670-4eb9-a349-1cde0ca3405f', '5c730de3-b0c7-4610-a3e9-23894311560e', 900000, 'USD', 'paid', false, 'stripe', 'po_seed_maris_10', '0aedad8b-416d-429e-a687-0fe90d272754', now() - interval '240 hours', now() - interval '192 hours'),
  ('4a4879d7-39c1-4884-a6db-9c45bc05602a', 'c812b2d1-219c-45f4-a2a9-290b4ee06dce', 'b4c0c286-66b5-4471-a1c7-1594921f969f', 500000, 'USD', 'paid', true, 'stripe', 'po_seed_kwame_16', '35c51693-57bc-448a-ad0f-cb1109646fd8', now() - interval '384 hours', now() - interval '384 hours'),
  ('370d8eb4-a641-4cc9-af7f-23565dee150b', '9cf23fa8-ae11-43c9-a727-27d6f7fee7bf', '16118033-84bc-42ee-aaa0-4e910d84d1bc', 300000, 'USD', 'paid', false, 'stripe', 'po_seed_tomasz_14', '0616346b-29c4-438e-a9e5-97d919e89d34', now() - interval '336 hours', now() - interval '288 hours'),
  ('3de3d796-bd3c-464d-a806-1d284a28fb87', '046c1c0c-b930-458d-a6a3-18c6786538d7', 'dea1bdac-db61-472f-a993-25026a17202d', 120000, 'USD', 'paid', false, 'stripe', 'po_seed_ren_40', '7129c05b-13b0-44ae-aa6b-22658550c7d8', now() - interval '960 hours', now() - interval '912 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.orders (id, reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor, creator_discount_minor, platform_fee_minor, platform_fee_bp, platform_fee_mode, total_minor, charged_minor, payment_provider, payment_method_label, saved_card_id, idempotency_key, created_at)
VALUES
  ('c5b2ef5b-2559-4aaa-a8bd-1bb9252f2270', 'PJ-2026-1001', 'confirmed', now() - interval '600 hours', 'user', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'USD', 12000, 0, 600, 500, 'seller_deducted', 12000, 12000, 'stripe', 'visa •••• 4242', '4cc2f73d-f72d-49f2-a775-fc7bb8535df0', 'seed:o1', now() - interval '600 hours'),
  ('c6b2f0ee-2459-4917-a5bd-1700282f2729', 'PJ-2026-1002', 'confirmed', now() - interval '288 hours', 'user', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'USD', 7800, 0, 390, 500, 'seller_deducted', 7800, 7800, 'stripe', 'mastercard •••• 1881', 'ecd67083-b847-41d8-a097-dced44646772', 'seed:o2', now() - interval '288 hours'),
  ('c7b2f281-2359-4784-a6bd-1893272f2596', 'PJ-2026-1003', 'confirmed', now() - interval '792 hours', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'USD', 10300, 0, 515, 500, 'seller_deducted', 10300, 10300, 'stripe', 'Helia Finance vault', NULL, 'seed:o3', now() - interval '792 hours'),
  ('c8b2f414-2259-45f1-abbd-20722a2f2a4f', 'PJ-2026-1004', 'confirmed', now() - interval '96 hours', 'user', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'USD', 2400, 0, 120, 500, 'seller_deducted', 2400, 2400, 'stripe', 'mastercard •••• 5556', 'e671e61c-a03a-442d-a730-b7f667fef6ff', 'seed:o4', now() - interval '96 hours'),
  ('c9b2f5a7-2159-445e-acbd-2205292f28bc', 'PJ-2026-1005', 'refunded', now() - interval '1440 hours', 'user', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', 'USD', 3800, 0, 190, 500, 'seller_deducted', 3800, 3800, 'stripe', 'visa •••• 4444', '31a0fe31-3c61-4592-a953-b01b3e124354', 'seed:o5', now() - interval '1440 hours'),
  ('cab2f73a-2059-42cb-a9bd-1d4c2c2f2d75', 'PJ-2026-1006', 'confirmed', now() - interval '1680 hours', 'user', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'USD', 190000, 0, 9500, 500, 'seller_deducted', 190000, 190000, 'stripe', 'mastercard •••• 1881', 'ecd67083-b847-41d8-a097-dced44646772', 'seed:o6', now() - interval '1680 hours'),
  ('cbb2f8cd-1f59-4138-aabd-1edf2b2f2be2', 'PJ-2026-1007', 'confirmed', now() - interval '1080 hours', 'user', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'USD', 240000, 0, 12000, 500, 'seller_deducted', 240000, 240000, 'stripe', 'visa •••• 4242', '4cc2f73d-f72d-49f2-a775-fc7bb8535df0', 'seed:o7', now() - interval '1080 hours'),
  ('bcb2e130-1e59-4fa5-afbd-26be2e2f309b', 'PJ-2026-1008', 'confirmed', now() - interval '72 hours', 'user', '950d68d1-8777-4bbe-ae59-3343e3e7f858', 'USD', 18000, 0, 900, 500, 'seller_deducted', 18000, 18000, 'stripe', 'mastercard •••• 5556', 'e671e61c-a03a-442d-a730-b7f667fef6ff', 'seed:o8', now() - interval '72 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.order_lines (id, order_id, item_type, item_id, title, subtitle, quantity, line_total_minor, currency, fulfilment, download_name, download_bytes, download_format, licence, scheduled_at, timezone, duration_minutes, conferencing_provider, position)
VALUES
  ('c77a13ff-2426-434e-a7f5-119d71d0f854', 'c5b2ef5b-2559-4aaa-a8bd-1bb9252f2270', 'digital_product', 'bf28e02f-9294-49b2-a2b4-43cdb3cfe348', 'Editorial type system', 'Instant download', 1, 12000, 'USD', 'download', 'pr-editorial-type-system.zip', 18400000, 'zip', 'standard', NULL, NULL, NULL, NULL, 0),
  ('9ee972f3-4d66-41c8-a41d-614d53220442', 'c6b2f0ee-2459-4917-a5bd-1700282f2729', 'digital_product', 'c5e28496-b309-40fd-a25b-2a2c507012a3', 'Notion ops suite', 'Instant download', 1, 2900, 'USD', 'download', 'pr-notion-ops-suite.zip', 18400000, 'zip', 'standard', NULL, NULL, NULL, NULL, 0),
  ('4ee46311-2c97-446c-adb9-36cb027a3786', 'c6b2f0ee-2459-4917-a5bd-1700282f2729', 'digital_product', '75f0ec2a-da94-4f9b-a36c-1b2044191021', 'Motion primitives', 'Instant download', 1, 4900, 'USD', 'download', 'pr-motion-primitives.zip', 20500000, 'zip', 'standard', NULL, NULL, NULL, NULL, 1),
  ('86de2250-ed65-466f-afc9-dec2ef513349', 'c7b2f281-2359-4784-a6bd-1893272f2596', 'digital_product', '60842026-267e-4fb1-ab6f-776cd8f6585f', 'Dashboard blocks', 'Instant download', 1, 6500, 'USD', 'download', 'pr-dashboard-blocks.zip', 18400000, 'zip', 'standard', NULL, NULL, NULL, NULL, 0),
  ('8f4e296f-fb45-41ba-ac09-1985327e6070', 'c7b2f281-2359-4784-a6bd-1893272f2596', 'digital_product', 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 'Iconography set — 640', 'Instant download', 1, 3800, 'USD', 'download', 'pr-iconography-set.zip', 20500000, 'zip', 'standard', NULL, NULL, NULL, NULL, 1),
  ('770c8aa5-ee34-428e-abc6-2bf392c02944', 'c8b2f414-2259-45f1-abbd-20722a2f2a4f', 'digital_product', 'c31e9aa2-a1ea-4495-a471-7598b963bb23', 'Grain — Lightroom pack', 'Instant download', 1, 2400, 'USD', 'download', 'pr-grain-lightroom-pack.zip', 18400000, 'zip', 'standard', NULL, NULL, NULL, NULL, 0),
  ('c51e3545-b216-47c8-ae5e-17afac1b7a02', 'c9b2f5a7-2159-445e-acbd-2205292f28bc', 'digital_product', 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 'Iconography set — 640', 'Instant download', 1, 3800, 'USD', 'download', 'pr-iconography-set.zip', 18400000, 'zip', 'standard', NULL, NULL, NULL, NULL, 0),
  ('7b67221e-eddb-4b17-af8f-28f4bbd5b1b5', 'cab2f73a-2059-42cb-a9bd-1d4c2c2f2d75', 'single_service_task', '7b1b3f95-50bb-4b14-a1fa-457bd622993a', 'Packaging art direction', '7-day delivery', 1, 190000, 'USD', 'engagement', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
  ('1f0d052c-349b-4cb7-aaea-d06228463005', 'cbb2f8cd-1f59-4138-aabd-1edf2b2f2be2', 'one_off_service', '56b1183a-92e4-4f4d-a30e-1e983a201c6b', 'Landing page in a week', '5-day delivery', 1, 240000, 'USD', 'engagement', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0),
  ('d6f84d3b-73e4-47b4-abcb-c35df01ae22e', 'bcb2e130-1e59-4fa5-afbd-26be2e2f309b', 'service_session', 'eaff7484-81fb-46d3-adb1-42da56453eb9', 'Live portfolio review', '60-minute session', 1, 18000, 'USD', 'session', NULL, NULL, NULL, NULL, ((date_trunc('week', now() AT TIME ZONE 'Europe/Dublin') + interval '9 days' + interval '600 minutes') AT TIME ZONE 'Europe/Dublin'), 'Europe/London', 60, 'zoom', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.invoices (id, project_stage_id, issue_to_business_id, issue_from_profile, invoice_type, amount_cents, subtotal_cents, platform_fee_cents, tax_cents, total_cents, currency, status, due_date, paid_at, created_at)
VALUES
  ('73f46226-fcb1-4249-a11d-7e001310712b', 'faa19a6c-a1b2-4453-a0a6-bf02a933dd81', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '6ce1906f-caab-4708-a19e-df3d8960666e', 'per_stage', 800000, 800000, 0, 0, 800000, 'USD', 'issued', now() + interval '576 hours', NULL, now() - interval '144 hours'),
  ('11e36955-48f1-4158-aafd-5fdf0f2bdc82', '2a5614e5-7032-4b5c-a46f-12ebe434fde2', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'per_stage', 1500000, 1500000, 75000, 0, 1500000, 'USD', 'paid', now() + interval '-240 hours', now() - interval '480 hours', now() - interval '960 hours'),
  ('0ee3649c-4bf1-4611-abfd-61720e2bdaef', '2a5614e5-7032-4b5c-a46f-12ebe434fde2', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'per_stage', 1500000, 1500000, 75000, 0, 1500000, 'USD', 'paid', now() + interval '-192 hours', now() - interval '528 hours', now() - interval '912 hours'),
  ('0fe3662f-4af1-447e-acfd-63050d2bd95c', '2756102c-7332-4015-a56f-147ee334fc4f', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'per_stage', 2250000, 2250000, 0, 0, 2250000, 'USD', 'issued', now() + interval '504 hours', NULL, now() - interval '216 hours'),
  ('0ce36176-4df1-4937-a5fd-58000c2bd7c9', '2756102c-7332-4015-a56f-147ee334fc4f', '4cfa4f66-9aa2-496b-a93d-994caac019c1', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'per_stage', 2250000, 2250000, 0, 0, 2250000, 'USD', 'issued', now() + interval '432 hours', NULL, now() - interval '288 hours'),
  ('540a3f73-c59c-47f6-adee-ebe5ab1c5970', '1df76187-f9b7-4c96-abc4-cd4dc4f456b4', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'per_stage', 3200000, 3200000, 0, 0, 3200000, 'USD', 'issued', now() + interval '456 hours', NULL, now() - interval '264 hours'),
  ('67a7321e-de0d-462f-afb5-64dc5c63dc85', '8ca74d22-728b-47ff-a528-acf449954ed9', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '6ce1906f-caab-4708-a19e-df3d8960666e', 'per_stage', 1400000, 1400000, 70000, 0, 1400000, 'USD', 'paid', now() + interval '48 hours', now() - interval '360 hours', now() - interval '672 hours'),
  ('66a7308b-df0d-47c2-a2b5-69955963d7cc', '8ba74b8f-738b-4992-a828-b1ad46954a20', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', '6ce1906f-caab-4708-a19e-df3d8960666e', 'per_stage', 2200000, 2200000, 0, 0, 2200000, 'USD', 'issued', now() + interval '528 hours', NULL, now() - interval '192 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.invoice_line_items (id, invoice_id, ref_type, ref_id, description, amount_cents, currency)
VALUES
  ('c03f8341-f323-40cc-a599-fdcf3d9b8ad2', '73f46226-fcb1-4249-a11d-7e001310712b', 'escrow', 'd4e6f3c4-8a98-4bf1-a851-bea6553126b3', 'Stakeholder interviews and research synthesis — Discovery and research', 800000, 'USD'),
  ('3a6d0404-2453-413d-a7b9-c63eeabb4f67', '11e36955-48f1-4158-aafd-5fdf0f2bdc82', 'escrow', '7ab53d6b-7835-40b0-abeb-02d52985e95a', 'Ingestion pipeline and warehouse schema — Data model and ingestion', 1500000, 'USD'),
  ('4cbc2801-dd49-4956-a129-e227b1f58d24', '11e36955-48f1-4158-aafd-5fdf0f2bdc82', 'platform_fee', '7ab53d6b-7835-40b0-abeb-02d52985e95a', 'Platform fee (5%) — deducted from the payee', -75000, 'USD'),
  ('ea2b4f9c-4470-4739-a67c-9e1a2e6283af', '0ee3649c-4bf1-4611-abfd-61720e2bdaef', 'escrow', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', 'Event taxonomy and warehouse model — Data model and ingestion', 1500000, 'USD'),
  ('33853f19-b6cb-4eea-a590-decbcd0bc24c', '0ee3649c-4bf1-4611-abfd-61720e2bdaef', 'platform_fee', '7bb53efe-7b35-4569-a8ea-fe1c2885e7c7', 'Platform fee (5%) — deducted from the payee', -75000, 'USD'),
  ('be77f3cf-23e2-4462-a8de-67e105aed50c', '0fe3662f-4af1-447e-acfd-63050d2bd95c', 'escrow', '7cb54091-7a35-43d6-a9ea-ffaf2785e634', 'Realtime dashboard shell — Dashboard build', 2250000, 'USD'),
  ('d3b027e6-6640-4ab3-a51c-3c7c6483c521', '0ce36176-4df1-4937-a5fd-58000c2bd7c9', 'escrow', '7db54224-7d35-488f-a6ea-faf62685e4a1', 'Mobile companion screens — Dashboard build', 2250000, 'USD'),
  ('27c24d32-2934-4b03-abef-d4b4c801ba5d', '540a3f73-c59c-47f6-adee-ebe5ab1c5970', 'escrow', 'f4b59a61-5919-471e-a302-dcf3d93812d8', 'Verdant brand refresh — full delivery — Brand refresh delivery', 3200000, 'USD'),
  ('312747d5-3616-4b18-aa51-5c7b5c03116e', '67a7321e-de0d-462f-afb5-64dc5c63dc85', 'escrow', '2be31aa8-1878-4317-a6c0-339e4810b70d', 'Token architecture and theming — Tokens and foundations', 1400000, 'USD'),
  ('2e8d1f0e-1b31-473d-a763-e5d04415da57', '67a7321e-de0d-462f-afb5-64dc5c63dc85', 'platform_fee', '2be31aa8-1878-4317-a6c0-339e4810b70d', 'Platform fee (5%) — deducted from the payee', -70000, 'USD'),
  ('5ef78e48-82c9-4b09-a88c-4082b75ba803', '66a7308b-df0d-47c2-a2b5-69955963d7cc', 'escrow', '2ee31f61-1978-44aa-a5c0-320b4510b254', 'Button, field and layout primitives — Core components', 2200000, 'USD')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.promo_codes (id, code, label, kind, value_bp, value_minor, currency, starts_at, expires_at, max_redemptions, redemption_count, deactivated_at)
VALUES
  ('ff9bb60f-5c9a-4716-aca7-f3991373bd98', 'WELCOME10', 'WELCOME10 · 10% off', 'percent', 1000, NULL, NULL, NULL, NULL, NULL, 0, NULL),
  ('14a6ae82-1dd1-4ec5-ad04-bca80a1243fb', 'STUDIO20', 'STUDIO20 · $20 off', 'flat', NULL, 2000, 'USD', now() - interval '480 hours', now() + interval '960 hours', NULL, 0, NULL),
  ('570dc14d-dc7b-4c7a-a565-ff8f5edeccd4', 'SPRING15', 'SPRING15 · 15% off', 'percent', 1500, NULL, NULL, now() - interval '2880 hours', now() - interval '720 hours', NULL, 0, NULL),
  ('c7d0b413-3225-4e34-a261-9cb9e4c99472', 'FOUNDERS50', 'FOUNDERS50 · 50% off for our first fifty buyers', 'percent', 5000, NULL, NULL, now() - interval '4800 hours', NULL, 50, 50, NULL),
  ('fe0bc05f-c1dc-4b62-ac1e-aae9c3ddb33c', 'BETA5', 'BETA5 · $5 off', 'flat', NULL, 500, 'USD', now() - interval '7200 hours', NULL, NULL, 0, now() - interval '2160 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.baskets (id, owner_type, owner_id, name, is_default, promo_code)
VALUES
  ('1f76aaed-6fb2-4d22-a33b-f4cb8a6141f0', 'user', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'Main Basket', true, NULL),
  ('e472d4f3-d09e-4848-a0a8-b53d16724b72', 'user', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', 'Main Basket', true, 'WELCOME10'),
  ('55ed9bd6-ec5d-4937-a473-6140d634d1e9', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'Main Basket', true, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.basket_items (id, basket_id, item_type, item_id, title, subtitle, unit_price_minor, currency, quantity, saved_for_later, position, scheduled_at, timezone, seats, destination_email, created_at)
VALUES
  ('2868e6c1-09d1-4906-a605-5db3ad29b1b0', '1f76aaed-6fb2-4d22-a33b-f4cb8a6141f0', 'digital_product', '75f0ec2a-da94-4f9b-a36c-1b2044191021', 'Motion primitives', 'Instant download', 4900, 'USD', 1, false, 0, NULL, NULL, NULL, 'noor@projective.dev', now() - interval '24 hours'),
  ('37ba09f9-c609-4d90-a91f-72079cf3ab3e', '1f76aaed-6fb2-4d22-a33b-f4cb8a6141f0', 'service_session', 'eaff7484-81fb-46d3-adb1-42da56453eb9', 'Live portfolio review', '60-minute session', 18000, 'USD', 1, false, 1, ((date_trunc('week', now() AT TIME ZONE 'Asia/Dubai') + interval '8 days' + interval '900 minutes') AT TIME ZONE 'Asia/Dubai'), 'Asia/Dubai', NULL, NULL, now() - interval '48 hours'),
  ('449fa1ab-6a10-4f96-ae00-7d01ce18ca8c', '1f76aaed-6fb2-4d22-a33b-f4cb8a6141f0', 'one_off_service', '56b1183a-92e4-4f4d-a30e-1e983a201c6b', 'Landing page in a week', 'One-off service', 240000, 'USD', 1, true, 2, NULL, NULL, NULL, NULL, now() - interval '72 hours'),
  ('52c36e0d-5c59-4fc4-a2eb-841b6b117b02', 'e472d4f3-d09e-4848-a0a8-b53d16724b72', 'digital_product', 'c31e9aa2-a1ea-4495-a471-7598b963bb23', 'Grain — Lightroom pack', 'Instant download', 2400, 'USD', 1, false, 0, NULL, NULL, NULL, 'theo@projective.dev', now() - interval '24 hours'),
  ('b0b924f9-b493-4e78-aefe-bb476f94b206', 'e472d4f3-d09e-4848-a0a8-b53d16724b72', 'digital_product', '60842026-267e-4fb1-ab6f-776cd8f6585f', 'Dashboard blocks', 'Instant download', 6500, 'USD', 1, false, 1, NULL, NULL, NULL, 'theo@projective.dev', now() - interval '48 hours'),
  ('675206df-33f5-45f6-ad7e-cd516acf5ec0', '55ed9bd6-ec5d-4937-a473-6140d634d1e9', 'single_service_task', '7b1b3f95-50bb-4b14-a1fa-457bd622993a', 'Packaging art direction', 'Direct deliverable', 190000, 'USD', 1, false, 0, NULL, NULL, NULL, NULL, now() - interval '24 hours'),
  ('4b300591-0b9d-4d98-a813-afab948909ca', '55ed9bd6-ec5d-4937-a473-6140d634d1e9', 'course_group_session', '40d68e27-474f-4b56-a37e-1605cbc3fdb4', 'Design systems workshop', '3 seats · group session', 27000, 'USD', 1, false, 1, ((date_trunc('week', now() AT TIME ZONE 'Europe/London') + interval '17 days' + interval '840 minutes') AT TIME ZONE 'Europe/London'), 'Europe/London', 3, NULL, now() - interval '48 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.buyer_details (id, context_id, context_kind, owner_type, owner_id, delivery_first_name, delivery_last_name, delivery_email, personal_name, personal_phone, personal_email, personal_address_line_1, personal_address_city, personal_address_state, personal_address_postcode, personal_address_country, business_company_name, business_registration_number, business_tax_id, business_corporate_email, business_phone, business_address_line_1, business_address_city, business_address_state, business_address_postcode, business_address_country, created_at, updated_at)
VALUES
  ('cd65b30f-a324-46d6-a6fe-b14515f77b7c', 'personal', 'personal', 'user', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', 'Noor', 'Haddad', 'noor@projective.dev', 'Noor Haddad', '+971 50 123 4567', 'noor@projective.dev', 'Villa 12, Al Wasl Road', 'Dubai', NULL, '00000', 'United Arab Emirates', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, now() - interval '72 hours', now() - interval '72 hours'),
  ('7be54cc4-8176-4b7b-a85f-ed3e0af71785', 'business:edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'business', 'business', 'edb582e0-25d2-48a3-a0db-4a96f1d1a8d1', 'Hannah', 'Cole', 'hannahcole@projective.dev', '', '', NULL, NULL, NULL, NULL, NULL, NULL, 'Helia Finance Ltd', '13572468', 'GB 284 3715 62', 'accounts@heliafinance.dev', '+44 20 7946 0321', '41 Old Street', 'London', NULL, 'EC1V 9AE', 'United Kingdom', now() - interval '72 hours', now() - interval '72 hours')
ON CONFLICT (owner_type, owner_id, context_id) DO NOTHING;

INSERT INTO finance.subscriptions (id, profile_id, subject_type, subject_id, plan_id, state, billing_interval, current_period_start, current_period_end, price_cents, currency, provider_ref, started_at)
VALUES
  ('c30854cd-1a03-49f2-ad62-dfb784b244ec', '6ce1906f-caab-4708-a19e-df3d8960666e', 'user', '6ce1906f-caab-4708-a19e-df3d8960666e', (SELECT id FROM finance.plans WHERE code = 'individual_pro'), 'active', 'monthly', now() - interval '432 hours', now() + interval '288 hours', 1299, 'GBP', 'sub_seed_marisdelacroix', now() - interval '4800 hours'),
  ('89a079d0-7258-44dd-a4fc-287241337697', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'team', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', (SELECT id FROM finance.plans WHERE code = 'team_pro'), 'active', 'monthly', now() - interval '216 hours', now() + interval '504 hours', 2900, 'GBP', 'sub_seed_ateliernova', now() - interval '8880 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.vault_permissions (id, wallet_id, member_user_id, capabilities, granted_by)
VALUES
  ('7bda10a6-e1aa-4f0b-a069-618042bee065', 'ed74da48-3ae7-44c1-a174-5b3a4ccfe0eb', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', ARRAY['view', 'add_funds', 'spend', 'distribute', 'withdraw', 'manage_members', 'manage_billing']::finance.vault_capability[], '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d'),
  ('b9416c47-3dd1-499e-a643-692d44152544', 'ed74da48-3ae7-44c1-a174-5b3a4ccfe0eb', '3fc3da04-549b-4239-aca3-fa82f713dbaf', ARRAY['view', 'add_funds', 'spend', 'distribute']::finance.vault_capability[], '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d'),
  ('71a6bb39-86d8-436c-a270-d94bd9324486', 'ed74da48-3ae7-44c1-a174-5b3a4ccfe0eb', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', ARRAY['view']::finance.vault_capability[], '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d'),
  ('7bdef09f-faec-4f8a-a377-2121bfa09814', '78297a62-19ca-4e6b-afcb-a91cbaa3504d', 'c7173d3f-8b15-4876-afbf-499d17513a44', ARRAY['view', 'add_funds', 'spend', 'distribute', 'withdraw', 'manage_members', 'manage_billing']::finance.vault_capability[], 'c7173d3f-8b15-4876-afbf-499d17513a44'),
  ('53a9fc8b-7318-464c-a358-e85da26a652e', '78297a62-19ca-4e6b-afcb-a91cbaa3504d', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', ARRAY['view', 'add_funds', 'spend', 'distribute']::finance.vault_capability[], 'c7173d3f-8b15-4876-afbf-499d17513a44'),
  ('5ccf6bce-3ff3-40b1-af39-06f827f1048b', '78297a62-19ca-4e6b-afcb-a91cbaa3504d', '2e4274fb-e76b-4640-ad31-c66d7fbea842', ARRAY['view']::finance.vault_capability[], 'c7173d3f-8b15-4876-afbf-499d17513a44'),
  ('86f77972-dd48-46dd-a495-b7206e041ae3', 'ac5e5bb6-036a-4c37-a9d9-8764836875d5', 'c859a726-490c-4f6d-a184-8984de3994d3', ARRAY['view', 'add_funds', 'spend', 'distribute', 'withdraw', 'manage_members', 'manage_billing']::finance.vault_capability[], 'c859a726-490c-4f6d-a184-8984de3994d3'),
  ('63d32860-6c80-4e65-a4e6-a882c842eba7', 'ac5e5bb6-036a-4c37-a9d9-8764836875d5', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', ARRAY['view']::finance.vault_capability[], 'c859a726-490c-4f6d-a184-8984de3994d3'),
  ('ed0e70c7-6e66-49fe-a589-d56945a079e8', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', ARRAY['view', 'add_funds', 'spend', 'distribute', 'withdraw', 'manage_members', 'manage_billing']::finance.vault_capability[], 'de29f2ce-0f36-4db5-a417-4edc88cedf83'),
  ('3b0ccd6a-c1dc-4495-aae1-977ca62b994f', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', '35ce4987-15b3-4c38-a438-2bb9c35df15a', ARRAY['view', 'add_funds', 'spend', 'distribute']::finance.vault_capability[], 'de29f2ce-0f36-4db5-a417-4edc88cedf83'),
  ('1bb4a173-7f3f-4658-aed4-e10da5f79082', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', '292e1827-f189-4f34-ab35-27c9f0320926', ARRAY['view', 'add_funds', 'spend', 'distribute', 'withdraw', 'manage_members', 'manage_billing']::finance.vault_capability[], '292e1827-f189-4f34-ab35-27c9f0320926'),
  ('53896ecb-292a-43c0-a2a8-6f550243eb7a', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', ARRAY['view']::finance.vault_capability[], '292e1827-f189-4f34-ab35-27c9f0320926')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.spending_limits (id, wallet_id, member_user_id, cap_cents, per_transaction_cents, period_interval, spent_cents, resets_at)
VALUES
  ('bcd903dc-049a-43a7-a6da-53b6b500c641', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 2500000, 1000000, 'monthly', 800000, now() + interval '216 hours')
ON CONFLICT (wallet_id, member_user_id) DO NOTHING;

INSERT INTO finance.spend_approvals (id, wallet_id, requested_by, amount_cents, currency, reason, ref_table, ref_id, status, approver_user_id, decided_at, expires_at, created_at)
VALUES
  ('8ea0bfc1-4e4b-4adc-ac60-07879e1f86aa', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', '35ce4987-15b3-4c38-a438-2bb9c35df15a', 1600000, 'USD', 'Fund UX and flows on Helia wallet redesign once Juno accepts', 'project_stages', 'fda19f25-a2b2-45e6-afa6-bd6fa633d8c8', 'pending', NULL, NULL, now() + interval '144 hours', now() - interval '24 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.income_smoothing (id, user_id, enrolled, target_monthly_cents, currency, fee_bp, eligibility_met, enrolled_at)
VALUES
  ('99aee5de-473f-4f1f-a179-554c414a7075', '6ce1906f-caab-4708-a19e-df3d8960666e', true, 600000, 'USD', 50, true, now() - interval '1440 hours'),
  ('88fcd6e1-e587-4448-ab2b-b43feb773006', 'c7173d3f-8b15-4876-afbf-499d17513a44', false, NULL, 'USD', 50, true, NULL)
ON CONFLICT (user_id, currency) DO NOTHING;

INSERT INTO finance.wallet_pots (id, wallet_id, purpose, name, balance_cents, currency, auto_allocate_bp)
VALUES
  ('e93b5f11-00fd-44b2-a8d3-896b850e2dec', 'ef814c58-b670-4eb9-a349-1cde0ca3405f', 'tax', 'Tax set-aside', 180000, 'USD', 2000),
  ('a05f0ed7-46b7-4486-a79a-36952ceca9a4', 'ef814c58-b670-4eb9-a349-1cde0ca3405f', 'goal', 'New display', 45000, 'USD', 500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.ledger_audit (id, wallet_id, actor_user_id, action, amount_cents, currency, ref_table, ref_id, metadata, created_at)
VALUES
  ('e282312d-3146-4d94-ad9b-f797f8d6c9fe', '9bc97e73-5ac6-487a-a2a7-1d156c8ac784', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', 'add_funds', 6000000, 'USD', 'payment_methods', 'a56c90b9-18ce-4b60-aac6-3b9f25e463c6', '{"note":"Q4 hiring budget"}'::jsonb, now() - interval '720 hours'),
  ('8a553695-3474-4de4-a7ae-144b6c991422', '0bb1d9f1-b826-4bfc-ab8e-26ab3be30616', '292e1827-f189-4f34-ab35-27c9f0320926', 'add_funds', 6000000, 'USD', 'payment_methods', '961d7515-cb55-44bc-a6c5-f0ffd3d32c6e', '{"note":"Analytics platform build"}'::jsonb, now() - interval '1056 hours')
ON CONFLICT (id) DO NOTHING;
