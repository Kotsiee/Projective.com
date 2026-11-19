-- =============================================================================================
-- 05_catalogue.sql — products, articles, listings, galleries, skills, reviews and placements
--
-- GENERATED FILE — do not edit by hand. Regenerate with:
--   deno run --allow-read --allow-write --allow-env supabase/seeds/generate.ts
--
-- catalogue owns the PUBLICATION layer. A listing points at its subject (a service blueprint or a product) rather than restating its price, so the two cannot disagree. Every image is a files.items row seeded in 02; every rating is derived by the review trigger from the rows written here.
--
-- Every insert is ON CONFLICT DO NOTHING and every id is derived deterministically from a natural
-- key, so this file is idempotent: running it twice, or against a partially-seeded database, is safe.
-- =============================================================================================


INSERT INTO catalogue.products (id, slug, owner_user_id, owner_team_id, title, description, description_text, format, category, price_cents, currency, licence, attribution_required, file_manifest, compatibility, specs, span, created_at)
VALUES
  ('2a178edd-ae09-4fc4-ab47-e61bbfbfcfc2', 'prd-uazch28xge', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'Aurora UI kit', '{"html":"<p>Aurora UI kit — a ready-to-buy download from Atelier Nova.</p>"}'::jsonb, 'Aurora UI kit — a ready-to-buy download from Atelier Nova.', 'source_code', 'ui-kit', 7900, 'USD', 'extended', false, '[{"name":"aurora-ui-kit.zip","label":"Source bundle","extension":".zip","bytes":12582912},{"name":"aurora-ui-kit.ts","label":"Typed entry points","extension":".ts","bytes":1048576},{"name":"aurora-ui-kit.md","label":"Integration guide","extension":".md","bytes":1048576}]'::jsonb, '[{"app":"Deno","versions":"2.x"},{"app":"Node.js","versions":"20 LTS and later"},{"app":"TypeScript","versions":"5.4 and later"}]'::jsonb, '[{"label":"Language","value":"TypeScript (strict)"},{"label":"Runtime","value":"Deno 2.x, Node 20+"},{"label":"Dependencies","value":"Zero runtime dependencies"},{"label":"Tests","value":"50 unit tests included"}]'::jsonb, 3, now() - interval '1920 hours'),
  ('c31e9aa2-a1ea-4495-a471-7598b963bb23', 'prd-qxxdgv7493', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'Grain — Lightroom pack', '{"html":"<p>Grain — Lightroom pack — a ready-to-buy download from Ren Koda.</p>"}'::jsonb, 'Grain — Lightroom pack — a ready-to-buy download from Ren Koda.', 'preset', 'presets', 2400, 'USD', 'personal', true, '[{"name":"grain-reference-before.jpg","label":"Reference, before","extension":".jpg","bytes":10896,"fileId":"fe3f0e8e-28c8-41ff-ac59-8aa455f6d3e5"},{"name":"grain-reference-after.jpg","label":"Reference, after","extension":".jpg","bytes":21533,"fileId":"e3135582-4e7b-417d-a1fd-92f806a5e353"}]'::jsonb, '[{"app":"After Effects","versions":"2022 and later"},{"app":"DaVinci Resolve","versions":"18 and later"},{"app":"Premiere Pro","versions":"2022 and later"}]'::jsonb, '[{"label":"Colour space","value":"Rec.709 with Log-to-Rec conversion included"},{"label":"Presets included","value":"13 looks"},{"label":"Resolution","value":"Resolution-independent (tested to 6K)"},{"label":"Frame rate","value":"Any - no baked timing"}]'::jsonb, 1, now() - interval '1824 hours'),
  ('75f0ec2a-da94-4f9b-a36c-1b2044191021', 'prd-wurb2hdchh', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 'Motion primitives', '{"html":"<p>Motion primitives — a ready-to-buy download from Juno Park.</p>"}'::jsonb, 'Motion primitives — a ready-to-buy download from Juno Park.', 'preset', 'templates', 4900, 'USD', 'personal', true, '[{"name":"motion-primitives.cube","label":"3D LUT","extension":".cube","bytes":2097152},{"name":"motion-primitives.aep","label":"After Effects project","extension":".aep","bytes":175112192},{"name":"motion-primitives.mov","label":"ProRes preview","extension":".mov","bytes":367001600}]'::jsonb, '[{"app":"After Effects","versions":"2022 and later"},{"app":"DaVinci Resolve","versions":"18 and later"},{"app":"Premiere Pro","versions":"2022 and later"}]'::jsonb, '[{"label":"Colour space","value":"Rec.709 with Log-to-Rec conversion included"},{"label":"Presets included","value":"17 looks"},{"label":"Resolution","value":"Resolution-independent (tested to 6K)"},{"label":"Frame rate","value":"Any - no baked timing"}]'::jsonb, 2, now() - interval '1728 hours'),
  ('bf28e02f-9294-49b2-a2b4-43cdb3cfe348', 'prd-db52j79haz', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Editorial type system', '{"html":"<p>Editorial type system — a ready-to-buy download from Studio Fern.</p>"}'::jsonb, 'Editorial type system — a ready-to-buy download from Studio Fern.', 'download', 'templates', 12000, 'USD', 'extended', false, '[{"name":"editorial-type-system.wav","label":"24-bit / 48kHz stem","extension":".wav","bytes":363855872},{"name":"editorial-type-system.mp3","label":"320kbps reference mix","extension":".mp3","bytes":20971520},{"name":"editorial-type-system.als","label":"Ableton session","extension":".als","bytes":8388608}]'::jsonb, '[{"app":"Ableton Live","versions":"11 and later"},{"app":"Logic Pro","versions":"10.7 and later"},{"app":"Any DAW","versions":"WAV / MP3 import"}]'::jsonb, '[{"label":"Sample rate","value":"48 kHz / 24-bit"},{"label":"Stems included","value":"8 separated stems"},{"label":"Tempo","value":"90 BPM"},{"label":"Key","value":"F# minor"}]'::jsonb, 3, now() - interval '1632 hours'),
  ('60842026-267e-4fb1-ab6f-776cd8f6585f', 'prd-6h2rwb4834', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'Dashboard blocks', '{"html":"<p>Dashboard blocks — a ready-to-buy download from North Loop.</p>"}'::jsonb, 'Dashboard blocks — a ready-to-buy download from North Loop.', 'template', 'templates', 6500, 'USD', 'extended', false, '[{"name":"dashboard-blocks.fig","label":"Figma source","extension":".fig","bytes":14680064},{"name":"dashboard-blocks.pdf","label":"Print-ready export","extension":".pdf","bytes":5242880},{"name":"dashboard-blocks.md","label":"Setup guide","extension":".md","bytes":1048576}]'::jsonb, '[{"app":"Figma","versions":"Current web + desktop"},{"app":"Adobe Acrobat","versions":"2020 and later"}]'::jsonb, '[{"label":"Pages / artboards","value":"23"},{"label":"Grid","value":"12-column, 8pt baseline"},{"label":"Type styles","value":"Variable-font ready, tokenised"},{"label":"Dark mode","value":"Light only"}]'::jsonb, 2, now() - interval '1536 hours'),
  ('d537bef9-ec2c-4b98-a9ad-481b8352748a', 'prd-ygm4yd4t7h', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'Iconography set — 640', '{"html":"<p>Iconography set — 640 — a ready-to-buy download from Maris Delacroix.</p>"}'::jsonb, 'Iconography set — 640 — a ready-to-buy download from Maris Delacroix.', 'download', 'icons', 3800, 'USD', 'personal', true, '[{"name":"iconography-sheet-a.png","label":"PNG icon sheet","extension":".png","bytes":8124,"fileId":"04adcbff-a30d-4586-a3d1-58dd0654028c"},{"name":"iconography-sheet-b.webp","label":"WebP icon sheet","extension":".webp","bytes":18720,"fileId":"1cb2332a-f898-4a21-a4e8-ca7458a28fdb"}]'::jsonb, '[{"app":"Illustrator","versions":"2021 and later"},{"app":"Affinity Designer","versions":"2 and later"}]'::jsonb, '[{"label":"Artboards","value":"10"},{"label":"Max export","value":"6000 x 6000 px at 300 DPI"},{"label":"Colour profile","value":"sRGB plus CMYK variants"}]'::jsonb, 1, now() - interval '1440 hours'),
  ('ab9f2cc0-769d-4eed-a8ba-6c4ed741b3e3', 'prd-zz2dqxe2fc', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, '3D product scenes', '{"html":"<p>3D product scenes — a ready-to-buy download from Ren Koda.</p>"}'::jsonb, '3D product scenes — a ready-to-buy download from Ren Koda.', 'download', '3d', 9500, 'USD', 'personal', true, '[{"name":"3d-product-scenes.blend","label":"Blender scene","extension":".blend","bytes":332398592},{"name":"3d-product-scenes.fbx","label":"FBX mesh + rig","extension":".fbx","bytes":77594624},{"name":"3d-product-scenes.png","label":"4K PBR texture set","extension":".png","bytes":193986560}]'::jsonb, '[{"app":"Blender","versions":"3.6 LTS - 4.2"},{"app":"Cinema 4D","versions":"R25 and later"},{"app":"Unreal Engine","versions":"5.1 - 5.4"}]'::jsonb, '[{"label":"Poly count","value":"25k tris (quad topology)"},{"label":"Texture resolution","value":"4096 x 4096 PBR (albedo, normal, roughness)"},{"label":"Rigged","value":"No - static mesh"},{"label":"UV layout","value":"Non-overlapping, single UDIM"}]'::jsonb, 2, now() - interval '1344 hours'),
  ('c5e28496-b309-40fd-a25b-2a2c507012a3', 'prd-krvd3a9qfw', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Notion ops suite', '{"html":"<p>Notion ops suite — a ready-to-buy download from Studio Fern.</p>"}'::jsonb, 'Notion ops suite — a ready-to-buy download from Studio Fern.', 'template', 'templates', 2900, 'USD', 'extended', false, '[{"name":"notion-ops-suite.fig","label":"Figma source","extension":".fig","bytes":14680064},{"name":"notion-ops-suite.pdf","label":"Print-ready export","extension":".pdf","bytes":5242880},{"name":"notion-ops-suite.md","label":"Setup guide","extension":".md","bytes":1048576}]'::jsonb, '[{"app":"Figma","versions":"Current web + desktop"},{"app":"Adobe Acrobat","versions":"2020 and later"}]'::jsonb, '[{"label":"Pages / artboards","value":"17"},{"label":"Grid","value":"12-column, 8pt baseline"},{"label":"Type styles","value":"Variable-font ready, tokenised"},{"label":"Dark mode","value":"Light only"}]'::jsonb, 1, now() - interval '1248 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.product_versions (id, product_id, version, manifest, published_at, ready_at, created_at)
VALUES
  ('c264219b-3776-4fb8-a55f-a4ed853b2a0a', 'c31e9aa2-a1ea-4495-a471-7598b963bb23', 1, '[{"fileId":"fe3f0e8e-28c8-41ff-ac59-8aa455f6d3e5","name":"grain-reference-before.jpg","label":"Reference, before","extension":".jpg","bytes":10896,"mime":"image/jpeg"},{"fileId":"e3135582-4e7b-417d-a1fd-92f806a5e353","name":"grain-reference-after.jpg","label":"Reference, after","extension":".jpg","bytes":21533,"mime":"image/jpeg"}]'::jsonb, now() - interval '1440 hours', now() - interval '1440 hours', now() - interval '1440 hours'),
  ('606d0652-ab43-45bb-addd-92e07c876411', 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 1, '[{"fileId":"04adcbff-a30d-4586-a3d1-58dd0654028c","name":"iconography-sheet-a.png","label":"PNG icon sheet","extension":".png","bytes":8124,"mime":"image/png"},{"fileId":"1cb2332a-f898-4a21-a4e8-ca7458a28fdb","name":"iconography-sheet-b.webp","label":"WebP icon sheet","extension":".webp","bytes":18720,"mime":"image/webp"}]'::jsonb, now() - interval '1440 hours', now() - interval '1440 hours', now() - interval '1440 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.articles (id, slug, owner_user_id, owner_team_id, title, topic, summary, body, body_text, cover_file_id, read_minutes, status, published_at, created_at)
VALUES
  ('6fb126e8-6980-4409-a127-7ac65f1cae7f', 'art-edrkw36c6x', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'How to hire a whole team, not just one person', 'hiring', 'How to hire a whole team, not just one person — a practical guide from the Projective team.', '[{"type":"paragraph","text":"How to hire a whole team, not just one person — a practical guide from the Projective team. Here''s the practical version, without the jargon."},{"type":"paragraph","text":"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence."},{"type":"heading","id":"why-this-matters-1","text":"Why this matters"},{"type":"paragraph","text":"The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted."},{"type":"paragraph","text":"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets."},{"type":"image","bucket":"catalogue","path":"c859a726-490c-4f6d-a184-8984de3994d3/articles/ar-hiring-a-team/banner_2.jpg","alt":"How to hire a whole team, not just one person","caption":"How to hire a whole team, not just one person — the flow at a glance."},{"type":"heading","id":"how-it-actually-works-2","text":"How it actually works"},{"type":"subheading","id":"step-by-step-3","text":"Step by step"},{"type":"paragraph","text":"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one."},{"type":"list","items":["Agree the scope and the definition of done before any money moves.","Fund the first stage — it sits safely in escrow until you accept it.","Review the submission, request revisions if needed, then release.","Repeat for each stage; you only ever have one in flight."]},{"type":"subheading","id":"in-practice-4","text":"In practice"},{"type":"paragraph","text":"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record."},{"type":"image","bucket":"catalogue","path":"c859a726-490c-4f6d-a184-8984de3994d3/articles/ar-hiring-a-team/banner_2.jpg","alt":"hiring in practice","caption":"Every stage carries its own channel, submissions, and escrow."},{"type":"heading","id":"a-worked-example-5","text":"A worked example"},{"type":"paragraph","text":"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread."},{"type":"paragraph","text":"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time."},{"type":"heading","id":"common-questions-6","text":"Common questions"},{"type":"subheading","id":"what-if-something-goes-wrong-7","text":"What if something goes wrong?"},{"type":"list","items":["Keep the brief short and specific — one outcome per ticket.","Use the stage channel for questions so the history stays in one place.","Accept promptly once a stage meets the bar; it releases the escrow.","Leave a review — it feeds both sides'' reputation tracks."]},{"type":"heading","id":"where-to-go-next-8","text":"Where to go next"},{"type":"paragraph","text":"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved."},{"type":"quote","text":"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying."}]'::jsonb, 'How to hire a whole team, not just one person — a practical guide from the Projective team. Here''s the practical version, without the jargon.

On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.

Why this matters

The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted.

It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.

How it actually works

Step by step

None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.

Agree the scope and the definition of done before any money moves.

Fund the first stage — it sits safely in escrow until you accept it.

Review the submission, request revisions if needed, then release.

Repeat for each stage; you only ever have one in flight.

In practice

When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.

A worked example

Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.

Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.

Common questions

What if something goes wrong?

Keep the brief short and specific — one outcome per ticket.

Use the stage channel for questions so the history stays in one place.

Accept promptly once a stage meets the bar; it releases the escrow.

Leave a review — it feeds both sides'' reputation tracks.

Where to go next

The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.

The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.', 'f719fb4b-1ce4-4102-a1eb-cbd90f89c130', 6, 'published', now() - interval '720 hours', now() - interval '768 hours'),
  ('9e4b8101-685d-4726-af54-b45fb5bd681c', 'art-72ngxoevhj', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'Escrow, explained: how your money stays safe', 'payments', 'Escrow, explained: how your money stays safe — a practical guide from the Projective team.', '[{"type":"paragraph","text":"Escrow, explained: how your money stays safe — a practical guide from the Projective team. Here''s the practical version, without the jargon."},{"type":"paragraph","text":"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved."},{"type":"heading","id":"why-this-matters-1","text":"Why this matters"},{"type":"paragraph","text":"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence."},{"type":"paragraph","text":"The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted."},{"type":"image","bucket":"catalogue","path":"c7173d3f-8b15-4876-afbf-499d17513a44/articles/ar-escrow-explained/banner_4.jpg","alt":"Escrow, explained: how your money stays safe","caption":"Escrow, explained: how your money stays safe — the flow at a glance."},{"type":"heading","id":"how-it-actually-works-2","text":"How it actually works"},{"type":"subheading","id":"step-by-step-3","text":"Step by step"},{"type":"paragraph","text":"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets."},{"type":"list","items":["Keep the brief short and specific — one outcome per ticket.","Use the stage channel for questions so the history stays in one place.","Accept promptly once a stage meets the bar; it releases the escrow.","Leave a review — it feeds both sides'' reputation tracks."]},{"type":"subheading","id":"in-practice-4","text":"In practice"},{"type":"paragraph","text":"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one."},{"type":"image","bucket":"catalogue","path":"c7173d3f-8b15-4876-afbf-499d17513a44/articles/ar-escrow-explained/banner_4.jpg","alt":"payments in practice","caption":"Every stage carries its own channel, submissions, and escrow."},{"type":"heading","id":"a-worked-example-5","text":"A worked example"},{"type":"paragraph","text":"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record."},{"type":"paragraph","text":"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread."},{"type":"heading","id":"common-questions-6","text":"Common questions"},{"type":"subheading","id":"what-if-something-goes-wrong-7","text":"What if something goes wrong?"},{"type":"list","items":["Agree the scope and the definition of done before any money moves.","Fund the first stage — it sits safely in escrow until you accept it.","Review the submission, request revisions if needed, then release.","Repeat for each stage; you only ever have one in flight."]},{"type":"heading","id":"where-to-go-next-8","text":"Where to go next"},{"type":"paragraph","text":"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time."},{"type":"quote","text":"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying."}]'::jsonb, 'Escrow, explained: how your money stays safe — a practical guide from the Projective team. Here''s the practical version, without the jargon.

The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.

Why this matters

On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.

The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted.

How it actually works

Step by step

It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.

Keep the brief short and specific — one outcome per ticket.

Use the stage channel for questions so the history stays in one place.

Accept promptly once a stage meets the bar; it releases the escrow.

Leave a review — it feeds both sides'' reputation tracks.

In practice

None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.

A worked example

When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.

Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.

Common questions

What if something goes wrong?

Agree the scope and the definition of done before any money moves.

Fund the first stage — it sits safely in escrow until you accept it.

Review the submission, request revisions if needed, then release.

Repeat for each stage; you only ever have one in flight.

Where to go next

Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.

The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.', '8d4c3651-4563-4b96-aa9d-25dbd3cd4bd0', 4, 'published', now() - interval '840 hours', now() - interval '888 hours'),
  ('d13d4267-5ad3-42aa-a99a-41ed850813e8', 'art-c6fmwh937h', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'Paying step by step across stages', 'payments', 'Paying step by step across stages — a practical guide from the Projective team.', '[{"type":"paragraph","text":"Paying step by step across stages — a practical guide from the Projective team. Here''s the practical version, without the jargon."},{"type":"paragraph","text":"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved."},{"type":"heading","id":"why-this-matters-1","text":"Why this matters"},{"type":"paragraph","text":"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence."},{"type":"paragraph","text":"The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted."},{"type":"image","bucket":"catalogue","path":"6ce1906f-caab-4708-a19e-df3d8960666e/articles/ar-paying-step-by-step/banner_7.jpg","alt":"Paying step by step across stages","caption":"Paying step by step across stages — the flow at a glance."},{"type":"heading","id":"how-it-actually-works-2","text":"How it actually works"},{"type":"subheading","id":"step-by-step-3","text":"Step by step"},{"type":"paragraph","text":"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets."},{"type":"list","items":["Keep the brief short and specific — one outcome per ticket.","Use the stage channel for questions so the history stays in one place.","Accept promptly once a stage meets the bar; it releases the escrow.","Leave a review — it feeds both sides'' reputation tracks."]},{"type":"subheading","id":"in-practice-4","text":"In practice"},{"type":"paragraph","text":"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one."},{"type":"image","bucket":"catalogue","path":"6ce1906f-caab-4708-a19e-df3d8960666e/articles/ar-paying-step-by-step/banner_7.jpg","alt":"payments in practice","caption":"Every stage carries its own channel, submissions, and escrow."},{"type":"heading","id":"a-worked-example-5","text":"A worked example"},{"type":"paragraph","text":"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record."},{"type":"paragraph","text":"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread."},{"type":"heading","id":"common-questions-6","text":"Common questions"},{"type":"subheading","id":"what-if-something-goes-wrong-7","text":"What if something goes wrong?"},{"type":"list","items":["Agree the scope and the definition of done before any money moves.","Fund the first stage — it sits safely in escrow until you accept it.","Review the submission, request revisions if needed, then release.","Repeat for each stage; you only ever have one in flight."]},{"type":"heading","id":"where-to-go-next-8","text":"Where to go next"},{"type":"paragraph","text":"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time."},{"type":"quote","text":"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying."}]'::jsonb, 'Paying step by step across stages — a practical guide from the Projective team. Here''s the practical version, without the jargon.

The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.

Why this matters

On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.

The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted.

How it actually works

Step by step

It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.

Keep the brief short and specific — one outcome per ticket.

Use the stage channel for questions so the history stays in one place.

Accept promptly once a stage meets the bar; it releases the escrow.

Leave a review — it feeds both sides'' reputation tracks.

In practice

None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.

A worked example

When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.

Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.

Common questions

What if something goes wrong?

Agree the scope and the definition of done before any money moves.

Fund the first stage — it sits safely in escrow until you accept it.

Review the submission, request revisions if needed, then release.

Repeat for each stage; you only ever have one in flight.

Where to go next

Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.

The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.', 'f6233138-87eb-451d-a34e-4a06c5f7bd7b', 5, 'published', now() - interval '960 hours', now() - interval '1008 hours'),
  ('e03c4152-b433-4f7d-a461-dd30a2577e6b', 'art-swzpgs5ohx', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'Running a small team without the chaos', 'teams', 'Running a small team without the chaos — a practical guide from the Projective team.', '[{"type":"paragraph","text":"Running a small team without the chaos — a practical guide from the Projective team. Here''s the practical version, without the jargon."},{"type":"paragraph","text":"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time."},{"type":"heading","id":"why-this-matters-1","text":"Why this matters"},{"type":"paragraph","text":"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved."},{"type":"paragraph","text":"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence."},{"type":"image","bucket":"catalogue","path":"9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d/articles/ar-running-a-small-team/banner_3.jpg","alt":"Running a small team without the chaos","caption":"Running a small team without the chaos — the flow at a glance."},{"type":"heading","id":"how-it-actually-works-2","text":"How it actually works"},{"type":"subheading","id":"step-by-step-3","text":"Step by step"},{"type":"paragraph","text":"The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted."},{"type":"list","items":["Agree the scope and the definition of done before any money moves.","Fund the first stage — it sits safely in escrow until you accept it.","Review the submission, request revisions if needed, then release.","Repeat for each stage; you only ever have one in flight."]},{"type":"subheading","id":"in-practice-4","text":"In practice"},{"type":"paragraph","text":"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets."},{"type":"image","bucket":"catalogue","path":"9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d/articles/ar-running-a-small-team/banner_3.jpg","alt":"teams in practice","caption":"Every stage carries its own channel, submissions, and escrow."},{"type":"heading","id":"a-worked-example-5","text":"A worked example"},{"type":"paragraph","text":"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one."},{"type":"paragraph","text":"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record."},{"type":"heading","id":"common-questions-6","text":"Common questions"},{"type":"subheading","id":"what-if-something-goes-wrong-7","text":"What if something goes wrong?"},{"type":"list","items":["Keep the brief short and specific — one outcome per ticket.","Use the stage channel for questions so the history stays in one place.","Accept promptly once a stage meets the bar; it releases the escrow.","Leave a review — it feeds both sides'' reputation tracks."]},{"type":"heading","id":"where-to-go-next-8","text":"Where to go next"},{"type":"paragraph","text":"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread."},{"type":"quote","text":"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying."}]'::jsonb, 'Running a small team without the chaos — a practical guide from the Projective team. Here''s the practical version, without the jargon.

Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.

Why this matters

The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.

On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.

How it actually works

Step by step

The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted.

Agree the scope and the definition of done before any money moves.

Fund the first stage — it sits safely in escrow until you accept it.

Review the submission, request revisions if needed, then release.

Repeat for each stage; you only ever have one in flight.

In practice

It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.

A worked example

None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.

When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.

Common questions

What if something goes wrong?

Keep the brief short and specific — one outcome per ticket.

Use the stage channel for questions so the history stays in one place.

Accept promptly once a stage meets the bar; it releases the escrow.

Leave a review — it feeds both sides'' reputation tracks.

Where to go next

Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.

The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.', 'c5973183-6c37-41c8-aa98-40299e0dbf3e', 7, 'published', now() - interval '1080 hours', now() - interval '1128 hours'),
  ('bb082a23-6d6b-4552-afcc-ea918a16c290', 'art-omtu2mepgj', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 'Getting started on Projective', 'getting-started', 'Getting started on Projective — a practical guide from the Projective team.', '[{"type":"paragraph","text":"Getting started on Projective — a practical guide from the Projective team. Here''s the practical version, without the jargon."},{"type":"paragraph","text":"None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one."},{"type":"heading","id":"why-this-matters-1","text":"Why this matters"},{"type":"paragraph","text":"When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record."},{"type":"paragraph","text":"Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread."},{"type":"image","bucket":"catalogue","path":"45a4c6ae-d818-45fd-a62b-db44f1f69eab/articles/ar-getting-started/banner_5.jpg","alt":"Getting started on Projective","caption":"Getting started on Projective — the flow at a glance."},{"type":"heading","id":"how-it-actually-works-2","text":"How it actually works"},{"type":"subheading","id":"step-by-step-3","text":"Step by step"},{"type":"paragraph","text":"Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time."},{"type":"list","items":["Keep the brief short and specific — one outcome per ticket.","Use the stage channel for questions so the history stays in one place.","Accept promptly once a stage meets the bar; it releases the escrow.","Leave a review — it feeds both sides'' reputation tracks."]},{"type":"subheading","id":"in-practice-4","text":"In practice"},{"type":"paragraph","text":"The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved."},{"type":"image","bucket":"catalogue","path":"45a4c6ae-d818-45fd-a62b-db44f1f69eab/articles/ar-getting-started/banner_5.jpg","alt":"getting-started in practice","caption":"Every stage carries its own channel, submissions, and escrow."},{"type":"heading","id":"a-worked-example-5","text":"A worked example"},{"type":"paragraph","text":"On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence."},{"type":"paragraph","text":"The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted."},{"type":"heading","id":"common-questions-6","text":"Common questions"},{"type":"subheading","id":"what-if-something-goes-wrong-7","text":"What if something goes wrong?"},{"type":"list","items":["Agree the scope and the definition of done before any money moves.","Fund the first stage — it sits safely in escrow until you accept it.","Review the submission, request revisions if needed, then release.","Repeat for each stage; you only ever have one in flight."]},{"type":"heading","id":"where-to-go-next-8","text":"Where to go next"},{"type":"paragraph","text":"It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets."},{"type":"quote","text":"The safest thing you can do is start small, stage by stage — and let the escrow do the worrying."}]'::jsonb, 'Getting started on Projective — a practical guide from the Projective team. Here''s the practical version, without the jargon.

None of this asks you to be an expert. The defaults are sensible, the language is plain, and the safe path is always the obvious one.

Why this matters

When something needs changing you request a revision rather than starting over. The original scope, the conversation, and the money all stay attached to the same record.

Communication lives next to the work, not in a separate inbox. Every stage has its own channel, and the whole history reads as one continuous thread.

How it actually works

Step by step

Because money moves in small, staged amounts, a project that stalls never puts a large sum at risk — only one stage is ever in flight at a time.

Keep the brief short and specific — one outcome per ticket.

Use the stage channel for questions so the history stays in one place.

Accept promptly once a stage meets the bar; it releases the escrow.

Leave a review — it feeds both sides'' reputation tracks.

In practice

The goal is boring, in the best way: predictable delivery, predictable payment, and no surprises for anyone involved.

A worked example

On Projective, every engagement is broken into stages, and every stage is funded up front and held in escrow. That structure is what lets both sides start with confidence.

The short version: you never pay for work you haven''t seen, and freelancers never deliver work they won''t be paid for. The platform sits in the middle and releases funds only when a stage is accepted.

Common questions

What if something goes wrong?

Agree the scope and the definition of done before any money moves.

Fund the first stage — it sits safely in escrow until you accept it.

Review the submission, request revisions if needed, then release.

Repeat for each stage; you only ever have one in flight.

Where to go next

It helps to think in tickets. A ticket is one unit of work with a clear definition of done, a price, and an owner. Stages are just ordered groups of tickets.

The safest thing you can do is start small, stage by stage — and let the escrow do the worrying.', 'ac2aaa99-da38-462c-a818-dec741129d3a', 3, 'published', now() - interval '1200 hours', now() - interval '1248 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listings (id, owner_user_id, owner_team_id, kind, status, service_blueprint_id, product_id, title, description, description_text, category, delivery_label, create_category, amount_cents, currency, ticket_price_cents, session_price_cents, seats_per_session, free_revisions, extra_revision_price_cents, promoted, view_count, order_count, published_at, created_at)
VALUES
  ('ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'product', 'published', NULL, '2a178edd-ae09-4fc4-ab47-e61bbfbfcfc2', 'Aurora UI kit', '{"html":"<p>Aurora UI kit — a ready-to-buy download from Atelier Nova.</p>"}'::jsonb, 'Aurora UI kit — a ready-to-buy download from Atelier Nova.', 'ui-kit', 'Instant download', NULL, 7900, 'USD', NULL, NULL, NULL, NULL, NULL, false, 120, 3, now() - interval '1800 hours', now() - interval '1920 hours'),
  ('3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'product', 'published', NULL, 'c31e9aa2-a1ea-4495-a471-7598b963bb23', 'Grain — Lightroom pack', '{"html":"<p>Grain — Lightroom pack — a ready-to-buy download from Ren Koda.</p>"}'::jsonb, 'Grain — Lightroom pack — a ready-to-buy download from Ren Koda.', 'presets', 'Instant download', NULL, 2400, 'USD', NULL, NULL, NULL, NULL, NULL, false, 157, 4, now() - interval '1704 hours', now() - interval '1824 hours'),
  ('fcd422c7-3755-4a22-a315-fa658bcc82e0', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 'product', 'published', NULL, '75f0ec2a-da94-4f9b-a36c-1b2044191021', 'Motion primitives', '{"html":"<p>Motion primitives — a ready-to-buy download from Juno Park.</p>"}'::jsonb, 'Motion primitives — a ready-to-buy download from Juno Park.', 'templates', 'Instant download', NULL, 4900, 'USD', NULL, NULL, NULL, NULL, NULL, false, 194, 5, now() - interval '1608 hours', now() - interval '1728 hours'),
  ('af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'product', 'published', NULL, 'bf28e02f-9294-49b2-a2b4-43cdb3cfe348', 'Editorial type system', '{"html":"<p>Editorial type system — a ready-to-buy download from Studio Fern.</p>"}'::jsonb, 'Editorial type system — a ready-to-buy download from Studio Fern.', 'templates', 'Instant download', NULL, 12000, 'USD', NULL, NULL, NULL, NULL, NULL, false, 231, 6, now() - interval '1512 hours', now() - interval '1632 hours'),
  ('04877375-51b1-4f2e-a8fe-d37bbd0fd52c', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'product', 'published', NULL, '60842026-267e-4fb1-ab6f-776cd8f6585f', 'Dashboard blocks', '{"html":"<p>Dashboard blocks — a ready-to-buy download from North Loop.</p>"}'::jsonb, 'Dashboard blocks — a ready-to-buy download from North Loop.', 'templates', 'Instant download', NULL, 6500, 'USD', NULL, NULL, NULL, NULL, NULL, false, 268, 7, now() - interval '1416 hours', now() - interval '1536 hours'),
  ('1284c43c-21de-4e61-a30c-c466ec880fdb', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'product', 'published', NULL, 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 'Iconography set — 640', '{"html":"<p>Iconography set — 640 — a ready-to-buy download from Maris Delacroix.</p>"}'::jsonb, 'Iconography set — 640 — a ready-to-buy download from Maris Delacroix.', 'icons', 'Instant download', NULL, 3800, 'USD', NULL, NULL, NULL, NULL, NULL, true, 305, 8, now() - interval '1320 hours', now() - interval '1440 hours'),
  ('32432859-5753-4578-ace1-c7175c28210e', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'product', 'published', NULL, 'ab9f2cc0-769d-4eed-a8ba-6c4ed741b3e3', '3D product scenes', '{"html":"<p>3D product scenes — a ready-to-buy download from Ren Koda.</p>"}'::jsonb, '3D product scenes — a ready-to-buy download from Ren Koda.', '3d', 'Instant download', NULL, 9500, 'USD', NULL, NULL, NULL, NULL, NULL, false, 342, 9, now() - interval '1224 hours', now() - interval '1344 hours'),
  ('2aa29779-3801-48ee-a301-9937f376df6c', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'product', 'published', NULL, 'c5e28496-b309-40fd-a25b-2a2c507012a3', 'Notion ops suite', '{"html":"<p>Notion ops suite — a ready-to-buy download from Studio Fern.</p>"}'::jsonb, 'Notion ops suite — a ready-to-buy download from Studio Fern.', 'templates', 'Instant download', NULL, 2900, 'USD', NULL, NULL, NULL, NULL, NULL, false, 379, 10, now() - interval '1128 hours', now() - interval '1248 hours'),
  ('b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'service', 'published', '11c2391b-1568-4ee2-aa84-10dd81d8ccf4', NULL, 'Brand identity sprint', '{"html":"<p>A staged identity system — discovery, concept routes, and a final kit with a Webflow handoff.</p>"}'::jsonb, 'A staged identity system — discovery, concept routes, and a final kit with a Webflow handoff.', 'branding', '10-day delivery', NULL, 480000, 'USD', 24000, NULL, NULL, 2, 12000, true, 240, 2, now() - interval '2040 hours', now() - interval '2160 hours'),
  ('aa39796f-bf84-48f0-af16-e745b8e67556', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'service', 'published', 'bccc7920-ca19-4f5f-aa0e-f572e1e8b029', NULL, 'Design-system foundation', '{"html":"<p>Tokens, core components, and usage docs delivered as a living Figma library plus a coded foundation.</p>"}'::jsonb, 'Tokens, core components, and usage docs delivered as a living Figma library plus a coded foundation.', 'product', '2-week delivery', NULL, 320000, 'USD', 18000, NULL, NULL, 0, 9000, false, 293, 3, now() - interval '1968 hours', now() - interval '2088 hours'),
  ('6ff0a9bd-6b46-4eaa-a41e-99271716035c', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 'service', 'published', '56b1183a-92e4-4f4d-a30e-1e983a201c6b', NULL, 'Landing page in a week', '{"html":"<p>One high-converting landing page — copy polish, responsive build, and analytics wired in five days.</p>"}'::jsonb, 'One high-converting landing page — copy polish, responsive build, and analytics wired in five days.', 'web', '5-day delivery', NULL, 240000, 'USD', NULL, NULL, NULL, 1, 18000, false, 346, 4, now() - interval '1896 hours', now() - interval '2016 hours'),
  ('840a6bb5-6d6e-4356-ac37-99cf5c59dc28', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'service', 'published', '2579bbc6-d14d-4c65-a5a5-350c3ab9510b', NULL, 'Realtime MVP build', '{"html":"<p>A working realtime product MVP on Deno + Postgres, shipped in weekly milestones you sign off.</p>"}'::jsonb, 'A working realtime product MVP on Deno + Postgres, shipped in weekly milestones you sign off.', 'product', '4-week delivery', 'create', 950000, 'USD', 32000, NULL, NULL, 2, 0, false, 399, 5, now() - interval '1824 hours', now() - interval '1944 hours'),
  ('49197229-8833-4e6c-adcc-12a322395eae', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'service', 'published', '871a653c-93a9-45f9-a35f-8d3a3a0d3457', NULL, 'Product launch film', '{"html":"<p>A 60-second launch film — script, 3D motion, sound design, and cutdowns for every channel.</p>"}'::jsonb, 'A 60-second launch film — script, 3D motion, sound design, and cutdowns for every channel.', 'motion', '3-week delivery', NULL, 610000, 'USD', NULL, NULL, NULL, 2, 24000, false, 452, 6, now() - interval '1752 hours', now() - interval '1872 hours'),
  ('19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'service', 'published', 'eaff7484-81fb-46d3-adb1-42da56453eb9', NULL, 'Live portfolio review', '{"html":"<p>A booked 1:1 call — a working editor walks your portfolio and leaves a written action plan.</p>"}'::jsonb, 'A booked 1:1 call — a working editor walks your portfolio and leaves a written action plan.', 'content', '60-minute session', NULL, 18000, 'USD', NULL, 18000, NULL, NULL, NULL, false, 505, 2, now() - interval '1680 hours', now() - interval '1800 hours'),
  ('8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'service', 'published', 'f882f878-11fa-4489-a8fa-f3f24055f2cb', NULL, 'Design mentorship block', '{"html":"<p>Six fortnightly 1:1s with a senior product designer — portfolio, craft, and the career conversation nobody schedules.</p>"}'::jsonb, 'Six fortnightly 1:1s with a senior product designer — portfolio, craft, and the career conversation nobody schedules.', 'product', '6 × 45-minute sessions', NULL, 96000, 'USD', NULL, 16000, NULL, NULL, NULL, false, 558, 3, now() - interval '1608 hours', now() - interval '1728 hours'),
  ('4ab01144-bb69-4b85-a430-35ee74ba5827', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'service', 'published', '7b1b3f95-50bb-4b14-a1fa-457bd622993a', NULL, 'Packaging art direction', '{"html":"<p>A single, self-contained packaging scope: art direction, dielines, and print-ready files from a defined team.</p>"}'::jsonb, 'A single, self-contained packaging scope: art direction, dielines, and print-ready files from a defined team.', 'branding', '7-day delivery', NULL, 190000, 'USD', NULL, NULL, NULL, 3, 6000, false, 611, 4, now() - interval '1536 hours', now() - interval '1656 hours'),
  ('bbf5cc66-95c8-49f7-a727-c320dc4ceb69', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'service', 'published', '40d68e27-474f-4b56-a37e-1605cbc3fdb4', NULL, 'Design systems workshop', '{"html":"<p>A live, multi-seat workshop: build a token-driven design system alongside a small cohort, seats sold per attendee.</p>"}'::jsonb, 'A live, multi-seat workshop: build a token-driven design system alongside a small cohort, seats sold per attendee.', 'product', '2-hour class', NULL, 9000, 'USD', NULL, 9000, 16, NULL, NULL, false, 664, 5, now() - interval '1464 hours', now() - interval '1584 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listing_media (id, listing_id, file_id, kind, alt_text, position)
VALUES
  ('79b3cd13-7b51-42e0-ada3-fec5c7556cba', 'ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', '68588544-1047-4f29-a0bc-55f62548d873', 'image', 'Aurora UI kit', 1),
  ('35839989-d0d0-4646-aeb2-425b94b36e40', 'ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', '7e269e0c-e033-4e45-a71f-a4aa61a33ef3', 'image', 'Aurora UI kit — view 2', 2),
  ('fc753088-ea9a-49eb-a02e-cc9ea14232f1', '3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', 'ee125997-23ab-4c2c-ac0d-6d5de6d90d5a', 'image', 'Grain — Lightroom pack', 1),
  ('e73e9724-17f7-4573-aa9f-9802eaf2da51', '3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', 'fcb34be5-38fb-4be6-a730-52ff57e810b8', 'image', 'Grain — Lightroom pack — view 2', 2),
  ('0a3bf379-3e84-4ae6-a569-b9cf9b3c5e94', '3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', '4ab7178c-c648-4437-a4f6-0a169480fd69', 'image', 'Grain — Lightroom pack — view 3', 3),
  ('8f7a42e1-5b04-40c2-a7c0-c36ff834ce98', 'fcd422c7-3755-4a22-a315-fa658bcc82e0', 'b29f397a-9779-4a9f-ab97-ec9c2c29b381', 'image', 'Motion primitives', 1),
  ('7b954aaf-d4f7-43b4-a8ff-9d3d0dae8902', 'fcd422c7-3755-4a22-a315-fa658bcc82e0', '9103a3aa-22bb-4eed-ab82-a5e87b3f8cbb', 'image', 'Motion primitives — view 2', 2),
  ('df2634b1-6555-4c92-a494-0c33f942a5dc', 'fcd422c7-3755-4a22-a315-fa658bcc82e0', '4a9a5f37-3a32-40e2-a7df-8e2581fb5e10', 'image', 'Motion primitives — view 3', 3),
  ('8de60034-6c4f-41f7-a770-7b42aecf3f15', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'e16f3c32-d32c-4c0f-a0b0-621c95145289', 'image', 'Editorial type system', 1),
  ('1c4ceeb5-bf8f-4ec6-a2f4-d5772e2aed48', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'eaf62ce0-12ca-456d-a119-c96e141905c3', 'image', 'Editorial type system — view 2', 2),
  ('49a9236a-e250-4685-aa2d-dde8b9679f73', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'ddf7fab5-2b05-4a78-abea-3e4bfc08735e', 'image', 'Editorial type system — view 3', 3),
  ('ac0a3d81-450a-42f6-a067-d6ab1e2cd010', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', '21a59c0f-fede-40b8-a42e-ea59b0b961f2', 'image', 'Editorial type system — view 4', 4),
  ('6db5f766-d433-4885-a05d-15747dd02b03', '04877375-51b1-4f2e-a8fe-d37bbd0fd52c', '53954770-c946-4487-ad08-e86e558a6f0d', 'image', 'Dashboard blocks', 1),
  ('04e8ff31-79bd-45be-a931-74e3be1e1218', '04877375-51b1-4f2e-a8fe-d37bbd0fd52c', '27963e1e-c5fa-4f53-a0c6-86082fb348c5', 'image', 'Dashboard blocks — view 2', 2),
  ('aa06e93a-1c46-4ca9-aa7a-1ea4c6ec26cb', '04877375-51b1-4f2e-a8fe-d37bbd0fd52c', '90a7cd63-d9cf-48ca-a2be-fa6577644044', 'image', 'Dashboard blocks — view 3', 3),
  ('16df2f97-5994-49e8-ad03-3a75ee20bc0e', '1284c43c-21de-4e61-a30c-c466ec880fdb', 'e5eed9d7-f64d-46f4-ae79-ab69d05545ae', 'image', 'Iconography set — 640', 1),
  ('c4c3ce8c-c5ff-4fc3-af9b-41d288189d41', '1284c43c-21de-4e61-a30c-c466ec880fdb', 'e2dbab7d-a7aa-491e-a194-9cf35eef0e9c', 'image', 'Iconography set — 640 — view 2', 2),
  ('6e3e2255-ae78-405a-abcf-35fbed680910', '1284c43c-21de-4e61-a30c-c466ec880fdb', '058f7c09-8d65-4eae-a2e0-9d378a48d614', 'image', 'Iconography set — 640 — view 3', 3),
  ('f60d2b30-1d28-4fcf-ae4c-9d3a578c8191', '32432859-5753-4578-ace1-c7175c28210e', 'fcb34be5-38fb-4be6-a730-52ff57e810b8', 'image', '3D product scenes', 1),
  ('b514d9fd-e72b-417a-a541-e527db713354', '32432859-5753-4578-ace1-c7175c28210e', '4ab7178c-c648-4437-a4f6-0a169480fd69', 'image', '3D product scenes — view 2', 2),
  ('dfd16d84-5027-4397-af8f-f5b6d2c1a2b1', '32432859-5753-4578-ace1-c7175c28210e', 'ee125997-23ab-4c2c-ac0d-6d5de6d90d5a', 'image', '3D product scenes — view 3', 3),
  ('ba042755-c233-48fa-a447-379b4b497798', '2aa29779-3801-48ee-a301-9937f376df6c', '21a59c0f-fede-40b8-a42e-ea59b0b961f2', 'image', 'Notion ops suite', 1),
  ('b6f69a91-6188-4462-a7f1-9f87988f32c0', '2aa29779-3801-48ee-a301-9937f376df6c', 'eaf62ce0-12ca-456d-a119-c96e141905c3', 'image', 'Notion ops suite — view 2', 2),
  ('91cd28a6-d50c-4bc1-a275-00d81e9d927b', '2aa29779-3801-48ee-a301-9937f376df6c', 'ddf7fab5-2b05-4a78-abea-3e4bfc08735e', 'image', 'Notion ops suite — view 3', 3),
  ('74380ff0-5e63-46f3-a184-e4d2409ca06d', '2aa29779-3801-48ee-a301-9937f376df6c', 'e16f3c32-d32c-4c0f-a0b0-621c95145289', 'image', 'Notion ops suite — view 4', 4),
  ('70c7b796-09d5-41f9-adf2-9614d5d46eef', 'b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '7e269e0c-e033-4e45-a71f-a4aa61a33ef3', 'image', 'Brand identity sprint', 1),
  ('6d8435d0-5345-4ae3-a04f-64ee287cd669', 'b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '68588544-1047-4f29-a0bc-55f62548d873', 'image', 'Brand identity sprint — view 2', 2),
  ('4c9dd37c-660e-4263-adcb-85521e72ca51', 'aa39796f-bf84-48f0-af16-e745b8e67556', '058f7c09-8d65-4eae-a2e0-9d378a48d614', 'image', 'Design-system foundation', 1),
  ('2638843d-f6a0-4bfa-ad9b-827b3c876648', 'aa39796f-bf84-48f0-af16-e745b8e67556', 'e2dbab7d-a7aa-491e-a194-9cf35eef0e9c', 'image', 'Design-system foundation — view 2', 2),
  ('5247540a-1332-4f6d-ad3c-e0d03bc0d4a3', 'aa39796f-bf84-48f0-af16-e745b8e67556', 'e5eed9d7-f64d-46f4-ae79-ab69d05545ae', 'image', 'Design-system foundation — view 3', 3),
  ('e60a7315-c55b-4782-a198-c72ffbec130c', '6ff0a9bd-6b46-4eaa-a41e-99271716035c', '4a9a5f37-3a32-40e2-a7df-8e2581fb5e10', 'image', 'Landing page in a week', 1),
  ('5ef2f753-b8a3-4684-a361-6e59edb64f92', '6ff0a9bd-6b46-4eaa-a41e-99271716035c', '9103a3aa-22bb-4eed-ab82-a5e87b3f8cbb', 'image', 'Landing page in a week — view 2', 2),
  ('73e90075-e73b-4a72-af2c-530bb1aec8c8', '6ff0a9bd-6b46-4eaa-a41e-99271716035c', 'b29f397a-9779-4a9f-ab97-ec9c2c29b381', 'image', 'Landing page in a week — view 3', 3),
  ('dd2635d6-cd4e-4a4d-ad17-fa789f610f87', '840a6bb5-6d6e-4356-ac37-99cf5c59dc28', '90a7cd63-d9cf-48ca-a2be-fa6577644044', 'image', 'Realtime MVP build', 1),
  ('c3770915-16f6-451a-a72b-925ff9f6987c', '840a6bb5-6d6e-4356-ac37-99cf5c59dc28', '27963e1e-c5fa-4f53-a0c6-86082fb348c5', 'image', 'Realtime MVP build — view 2', 2),
  ('b47cfda2-c599-4a49-af95-8e48642f7aef', '840a6bb5-6d6e-4356-ac37-99cf5c59dc28', '53954770-c946-4487-ad08-e86e558a6f0d', 'image', 'Realtime MVP build — view 3', 3),
  ('872eab0a-130a-4cdd-ae10-ec7c5f7fd7af', '49197229-8833-4e6c-adcc-12a322395eae', '4ab7178c-c648-4437-a4f6-0a169480fd69', 'image', 'Product launch film', 1),
  ('3cd201ff-553e-4a10-ab68-cb1973f76fe2', '49197229-8833-4e6c-adcc-12a322395eae', 'fcb34be5-38fb-4be6-a730-52ff57e810b8', 'image', 'Product launch film — view 2', 2),
  ('0868ee67-413a-4d64-a9cb-2939161418fe', '49197229-8833-4e6c-adcc-12a322395eae', 'ee125997-23ab-4c2c-ac0d-6d5de6d90d5a', 'image', 'Product launch film — view 3', 3),
  ('c30e0af5-2ef2-4ef6-a01d-c6b728eebc60', '19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'eaf62ce0-12ca-456d-a119-c96e141905c3', 'image', 'Live portfolio review', 1),
  ('2dd43d2a-957c-49d5-a4c7-6aa8d5de5b9b', '19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'ddf7fab5-2b05-4a78-abea-3e4bfc08735e', 'image', 'Live portfolio review — view 2', 2),
  ('18c12474-b38c-4de7-a1f4-0982bdce3f0d', '19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'e16f3c32-d32c-4c0f-a0b0-621c95145289', 'image', 'Live portfolio review — view 3', 3),
  ('b2ad2741-a931-4646-a2f2-e66bf986be38', '19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', '21a59c0f-fede-40b8-a42e-ea59b0b961f2', 'image', 'Live portfolio review — view 4', 4),
  ('33bd6225-da4b-4cba-a89b-c723ea12aee8', '8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'ddf7fab5-2b05-4a78-abea-3e4bfc08735e', 'image', 'Design mentorship block', 1),
  ('770b2566-f860-40e5-aeed-d71872d9a677', '8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'eaf62ce0-12ca-456d-a119-c96e141905c3', 'image', 'Design mentorship block — view 2', 2),
  ('a42fad17-1b01-46e4-a270-56a5d7554c42', '8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'e16f3c32-d32c-4c0f-a0b0-621c95145289', 'image', 'Design mentorship block — view 3', 3),
  ('3b60c396-e14c-4e91-abed-a4c0904ca7ab', '8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', '21a59c0f-fede-40b8-a42e-ea59b0b961f2', 'image', 'Design mentorship block — view 4', 4),
  ('d1924a93-c1e9-4e70-a296-c9b9cdc03f6e', '4ab01144-bb69-4b85-a430-35ee74ba5827', 'fcb34be5-38fb-4be6-a730-52ff57e810b8', 'image', 'Packaging art direction', 1),
  ('5d82cb86-43ba-43bd-ac1a-ee9cb73e9f33', '4ab01144-bb69-4b85-a430-35ee74ba5827', '4ab7178c-c648-4437-a4f6-0a169480fd69', 'image', 'Packaging art direction — view 2', 2),
  ('e986160b-07bc-4844-a7d1-1dd986c39c8a', '4ab01144-bb69-4b85-a430-35ee74ba5827', 'ee125997-23ab-4c2c-ac0d-6d5de6d90d5a', 'image', 'Packaging art direction — view 3', 3),
  ('2ef7274f-fd42-488c-a4dd-bf6589e973c2', 'bbf5cc66-95c8-49f7-a727-c320dc4ceb69', 'e2dbab7d-a7aa-491e-a194-9cf35eef0e9c', 'image', 'Design systems workshop', 1),
  ('97618136-a6bc-4c55-ae63-9be4eace23cb', 'bbf5cc66-95c8-49f7-a727-c320dc4ceb69', '058f7c09-8d65-4eae-a2e0-9d378a48d614', 'image', 'Design systems workshop — view 2', 2),
  ('ebffdf64-4f5d-4997-a26a-7aa263a27845', 'bbf5cc66-95c8-49f7-a727-c320dc4ceb69', 'e5eed9d7-f64d-46f4-ae79-ab69d05545ae', 'image', 'Design systems workshop — view 3', 3)
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listing_skills (listing_id, skill_id)
VALUES
  ('ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', 'ad071368-f79b-42b7-ac74-308a94a4ec19'),
  ('ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', 'e014d9ad-c5dd-4b18-af8f-a893b3d7a43e'),
  ('ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', 'dc53c67d-79a7-4f6e-a432-4a8b885e92cc'),
  ('3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', '382b44ad-84a5-4536-a23d-eb1b01d39a1c'),
  ('fcd422c7-3755-4a22-a315-fa658bcc82e0', '5a45a313-1365-4f44-a03c-3afd37cfe2f6'),
  ('fcd422c7-3755-4a22-a315-fa658bcc82e0', '534e98b7-185b-4816-a990-e7c925109b78'),
  ('fcd422c7-3755-4a22-a315-fa658bcc82e0', '848229b3-cbff-4c2e-a94a-b3f9e0e767bc'),
  ('af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'ff131961-54ae-4ae0-ad63-61e3795ab8a2'),
  ('af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'aa80d44a-6c35-4b8f-a455-5a8c8edde7e1'),
  ('04877375-51b1-4f2e-a8fe-d37bbd0fd52c', 'ad071368-f79b-42b7-ac74-308a94a4ec19'),
  ('04877375-51b1-4f2e-a8fe-d37bbd0fd52c', 'e014d9ad-c5dd-4b18-af8f-a893b3d7a43e'),
  ('04877375-51b1-4f2e-a8fe-d37bbd0fd52c', '534e98b7-185b-4816-a990-e7c925109b78'),
  ('1284c43c-21de-4e61-a30c-c466ec880fdb', 'f562f712-3251-4e47-a4da-dfb0031a44d5'),
  ('1284c43c-21de-4e61-a30c-c466ec880fdb', 'ad071368-f79b-42b7-ac74-308a94a4ec19'),
  ('32432859-5753-4578-ace1-c7175c28210e', '06b31d5c-00bd-497b-afd6-da026c48c969'),
  ('32432859-5753-4578-ace1-c7175c28210e', '70528859-94ce-4f4e-a75f-27cf4d6ea264'),
  ('32432859-5753-4578-ace1-c7175c28210e', '31b7eba8-879f-4e05-a1af-6002dcda704f'),
  ('2aa29779-3801-48ee-a301-9937f376df6c', '6cfda1bd-ba18-4438-ab8f-f36b2d1988be'),
  ('b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '26045b67-b728-4856-af7c-eb4998e1d378'),
  ('b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '9e6501c1-a6c8-406c-aaed-fe5782f63162'),
  ('b83b6eb2-af5a-42ab-a284-3ae8779f3d99', 'ff131961-54ae-4ae0-ad63-61e3795ab8a2'),
  ('b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '382b44ad-84a5-4536-a23d-eb1b01d39a1c'),
  ('aa39796f-bf84-48f0-af16-e745b8e67556', 'e014d9ad-c5dd-4b18-af8f-a893b3d7a43e'),
  ('aa39796f-bf84-48f0-af16-e745b8e67556', 'ad071368-f79b-42b7-ac74-308a94a4ec19'),
  ('aa39796f-bf84-48f0-af16-e745b8e67556', '27197668-1eff-486d-a4ed-1f861a38ba83'),
  ('aa39796f-bf84-48f0-af16-e745b8e67556', 'ff131961-54ae-4ae0-ad63-61e3795ab8a2'),
  ('6ff0a9bd-6b46-4eaa-a41e-99271716035c', 'ad071368-f79b-42b7-ac74-308a94a4ec19'),
  ('6ff0a9bd-6b46-4eaa-a41e-99271716035c', 'dc53c67d-79a7-4f6e-a432-4a8b885e92cc'),
  ('6ff0a9bd-6b46-4eaa-a41e-99271716035c', '848229b3-cbff-4c2e-a94a-b3f9e0e767bc'),
  ('6ff0a9bd-6b46-4eaa-a41e-99271716035c', '534e98b7-185b-4816-a990-e7c925109b78'),
  ('840a6bb5-6d6e-4356-ac37-99cf5c59dc28', '0ed029c4-7fa2-4f6d-aa08-681a474ac723'),
  ('840a6bb5-6d6e-4356-ac37-99cf5c59dc28', 'b935eb8b-f83b-4a7a-a072-9f6d3acb265c'),
  ('840a6bb5-6d6e-4356-ac37-99cf5c59dc28', 'ef7f5d79-8ad3-4770-a55f-a123a3dc3a7a'),
  ('840a6bb5-6d6e-4356-ac37-99cf5c59dc28', '534e98b7-185b-4816-a990-e7c925109b78'),
  ('49197229-8833-4e6c-adcc-12a322395eae', '5a45a313-1365-4f44-a03c-3afd37cfe2f6'),
  ('49197229-8833-4e6c-adcc-12a322395eae', '70528859-94ce-4f4e-a75f-27cf4d6ea264'),
  ('49197229-8833-4e6c-adcc-12a322395eae', '06b31d5c-00bd-497b-afd6-da026c48c969'),
  ('49197229-8833-4e6c-adcc-12a322395eae', '382b44ad-84a5-4536-a23d-eb1b01d39a1c'),
  ('19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', '38786dcb-b2f9-4bd8-a389-58f90afaafb6'),
  ('19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'aa80d44a-6c35-4b8f-a455-5a8c8edde7e1'),
  ('19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'ff131961-54ae-4ae0-ad63-61e3795ab8a2'),
  ('8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', '38786dcb-b2f9-4bd8-a389-58f90afaafb6'),
  ('8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'ecd69ae1-2226-4f5c-afb3-0e678f99d11a'),
  ('8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'e014d9ad-c5dd-4b18-af8f-a893b3d7a43e'),
  ('4ab01144-bb69-4b85-a430-35ee74ba5827', '382b44ad-84a5-4536-a23d-eb1b01d39a1c'),
  ('4ab01144-bb69-4b85-a430-35ee74ba5827', '26045b67-b728-4856-af7c-eb4998e1d378'),
  ('4ab01144-bb69-4b85-a430-35ee74ba5827', 'f562f712-3251-4e47-a4da-dfb0031a44d5'),
  ('bbf5cc66-95c8-49f7-a727-c320dc4ceb69', 'e014d9ad-c5dd-4b18-af8f-a893b3d7a43e'),
  ('bbf5cc66-95c8-49f7-a727-c320dc4ceb69', 'ad071368-f79b-42b7-ac74-308a94a4ec19'),
  ('bbf5cc66-95c8-49f7-a727-c320dc4ceb69', '38786dcb-b2f9-4bd8-a389-58f90afaafb6')
ON CONFLICT (listing_id, skill_id) DO NOTHING;

INSERT INTO catalogue.listing_tags (listing_id, tag)
VALUES
  ('ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', 'ui-kit'),
  ('3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', 'presets'),
  ('fcd422c7-3755-4a22-a315-fa658bcc82e0', 'templates'),
  ('af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'templates'),
  ('04877375-51b1-4f2e-a8fe-d37bbd0fd52c', 'templates'),
  ('1284c43c-21de-4e61-a30c-c466ec880fdb', 'icons'),
  ('32432859-5753-4578-ace1-c7175c28210e', '3d'),
  ('2aa29779-3801-48ee-a301-9937f376df6c', 'templates'),
  ('b83b6eb2-af5a-42ab-a284-3ae8779f3d99', 'branding'),
  ('aa39796f-bf84-48f0-af16-e745b8e67556', 'product'),
  ('6ff0a9bd-6b46-4eaa-a41e-99271716035c', 'web'),
  ('840a6bb5-6d6e-4356-ac37-99cf5c59dc28', 'product'),
  ('49197229-8833-4e6c-adcc-12a322395eae', 'motion'),
  ('19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'content'),
  ('8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'product'),
  ('4ab01144-bb69-4b85-a430-35ee74ba5827', 'branding'),
  ('bbf5cc66-95c8-49f7-a727-c320dc4ceb69', 'product')
ON CONFLICT (listing_id, tag) DO NOTHING;

INSERT INTO marketplace.promoted_placements (id, sponsor_user_id, entity_type, entity_id, surface, starts_at, ends_at, spend_cents, currency)
VALUES
  ('c6aa8b97-2321-4dce-a35b-52598ce2d808', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'service', '11c2391b-1568-4ee2-aa84-10dd81d8ccf4', 'explore_home', now() - interval '48 hours', now() + interval '120 hours', 0, 'GBP'),
  ('6fe9ff55-b272-4240-aa7b-4e1bb5186e86', '6ce1906f-caab-4708-a19e-df3d8960666e', 'product', 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 'explore_results', now() - interval '48 hours', now() + interval '120 hours', 0, 'GBP')
ON CONFLICT (id) DO NOTHING;
