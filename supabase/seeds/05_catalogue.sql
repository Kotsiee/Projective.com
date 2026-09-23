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
  ('c31e9aa2-a1ea-4495-a471-7598b963bb23', 'prd-qxxdgv7493', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'Grain — Lightroom pack', '{"html":"<p>Grain — Lightroom pack — a ready-to-buy download from Ren Koda.</p>"}'::jsonb, 'Grain — Lightroom pack — a ready-to-buy download from Ren Koda.', 'preset', 'presets', 2400, 'USD', 'standard', true, '[{"name":"grain-lightroom-pack.cube","label":"3D LUT","extension":".cube","bytes":2097152},{"name":"grain-lightroom-pack.aep","label":"After Effects project","extension":".aep","bytes":154140672},{"name":"grain-lightroom-pack.mov","label":"ProRes preview","extension":".mov","bytes":321912832}]'::jsonb, '[{"app":"After Effects","versions":"2022 and later"},{"app":"DaVinci Resolve","versions":"18 and later"},{"app":"Premiere Pro","versions":"2022 and later"}]'::jsonb, '[{"label":"Colour space","value":"Rec.709 with Log-to-Rec conversion included"},{"label":"Presets included","value":"13 looks"},{"label":"Resolution","value":"Resolution-independent (tested to 6K)"},{"label":"Frame rate","value":"Any - no baked timing"}]'::jsonb, 1, now() - interval '1824 hours'),
  ('75f0ec2a-da94-4f9b-a36c-1b2044191021', 'prd-wurb2hdchh', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 'Motion primitives', '{"html":"<p>Motion primitives — a ready-to-buy download from Juno Park.</p>"}'::jsonb, 'Motion primitives — a ready-to-buy download from Juno Park.', 'preset', 'templates', 4900, 'USD', 'standard', true, '[{"name":"motion-primitives.cube","label":"3D LUT","extension":".cube","bytes":2097152},{"name":"motion-primitives.aep","label":"After Effects project","extension":".aep","bytes":175112192},{"name":"motion-primitives.mov","label":"ProRes preview","extension":".mov","bytes":367001600}]'::jsonb, '[{"app":"After Effects","versions":"2022 and later"},{"app":"DaVinci Resolve","versions":"18 and later"},{"app":"Premiere Pro","versions":"2022 and later"}]'::jsonb, '[{"label":"Colour space","value":"Rec.709 with Log-to-Rec conversion included"},{"label":"Presets included","value":"17 looks"},{"label":"Resolution","value":"Resolution-independent (tested to 6K)"},{"label":"Frame rate","value":"Any - no baked timing"}]'::jsonb, 2, now() - interval '1728 hours'),
  ('bf28e02f-9294-49b2-a2b4-43cdb3cfe348', 'prd-db52j79haz', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Editorial type system', '{"html":"<p>Editorial type system — a ready-to-buy download from Studio Fern.</p>"}'::jsonb, 'Editorial type system — a ready-to-buy download from Studio Fern.', 'download', 'templates', 12000, 'USD', 'extended', false, '[{"name":"editorial-type-system.wav","label":"24-bit / 48kHz stem","extension":".wav","bytes":363855872},{"name":"editorial-type-system.mp3","label":"320kbps reference mix","extension":".mp3","bytes":20971520},{"name":"editorial-type-system.als","label":"Ableton session","extension":".als","bytes":8388608}]'::jsonb, '[{"app":"Ableton Live","versions":"11 and later"},{"app":"Logic Pro","versions":"10.7 and later"},{"app":"Any DAW","versions":"WAV / MP3 import"}]'::jsonb, '[{"label":"Sample rate","value":"48 kHz / 24-bit"},{"label":"Stems included","value":"8 separated stems"},{"label":"Tempo","value":"90 BPM"},{"label":"Key","value":"F# minor"}]'::jsonb, 3, now() - interval '1632 hours'),
  ('60842026-267e-4fb1-ab6f-776cd8f6585f', 'prd-6h2rwb4834', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'Dashboard blocks', '{"html":"<p>Dashboard blocks — a ready-to-buy download from North Loop.</p>"}'::jsonb, 'Dashboard blocks — a ready-to-buy download from North Loop.', 'template', 'templates', 6500, 'USD', 'extended', false, '[{"name":"dashboard-blocks.fig","label":"Figma source","extension":".fig","bytes":14680064},{"name":"dashboard-blocks.pdf","label":"Print-ready export","extension":".pdf","bytes":5242880},{"name":"dashboard-blocks.md","label":"Setup guide","extension":".md","bytes":1048576}]'::jsonb, '[{"app":"Figma","versions":"Current web + desktop"},{"app":"Adobe Acrobat","versions":"2020 and later"}]'::jsonb, '[{"label":"Pages / artboards","value":"23"},{"label":"Grid","value":"12-column, 8pt baseline"},{"label":"Type styles","value":"Variable-font ready, tokenised"},{"label":"Dark mode","value":"Light only"}]'::jsonb, 2, now() - interval '1536 hours'),
  ('d537bef9-ec2c-4b98-a9ad-481b8352748a', 'prd-ygm4yd4t7h', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'Iconography set — 640', '{"html":"<p>Iconography set — 640 — a ready-to-buy download from Maris Delacroix.</p>"}'::jsonb, 'Iconography set — 640 — a ready-to-buy download from Maris Delacroix.', 'download', 'icons', 3800, 'USD', 'standard', true, '[{"name":"iconography-set.ai","label":"Vector source","extension":".ai","bytes":57671680},{"name":"iconography-set.png","label":"Transparent exports","extension":".png","bytes":168820736},{"name":"iconography-set.svg","label":"Scalable set","extension":".svg","bytes":4194304}]'::jsonb, '[{"app":"Illustrator","versions":"2021 and later"},{"app":"Affinity Designer","versions":"2 and later"}]'::jsonb, '[{"label":"Artboards","value":"10"},{"label":"Max export","value":"6000 x 6000 px at 300 DPI"},{"label":"Colour profile","value":"sRGB plus CMYK variants"}]'::jsonb, 1, now() - interval '1440 hours'),
  ('ab9f2cc0-769d-4eed-a8ba-6c4ed741b3e3', 'prd-zz2dqxe2fc', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, '3D product scenes', '{"html":"<p>3D product scenes — a ready-to-buy download from Ren Koda.</p>"}'::jsonb, '3D product scenes — a ready-to-buy download from Ren Koda.', 'download', '3d', 9500, 'USD', 'standard', true, '[{"name":"3d-product-scenes.blend","label":"Blender scene","extension":".blend","bytes":332398592},{"name":"3d-product-scenes.fbx","label":"FBX mesh + rig","extension":".fbx","bytes":77594624},{"name":"3d-product-scenes.png","label":"4K PBR texture set","extension":".png","bytes":193986560}]'::jsonb, '[{"app":"Blender","versions":"3.6 LTS - 4.2"},{"app":"Cinema 4D","versions":"R25 and later"},{"app":"Unreal Engine","versions":"5.1 - 5.4"}]'::jsonb, '[{"label":"Poly count","value":"25k tris (quad topology)"},{"label":"Texture resolution","value":"4096 x 4096 PBR (albedo, normal, roughness)"},{"label":"Rigged","value":"No - static mesh"},{"label":"UV layout","value":"Non-overlapping, single UDIM"}]'::jsonb, 2, now() - interval '1344 hours'),
  ('c5e28496-b309-40fd-a25b-2a2c507012a3', 'prd-krvd3a9qfw', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'Notion ops suite', '{"html":"<p>Notion ops suite — a ready-to-buy download from Studio Fern.</p>"}'::jsonb, 'Notion ops suite — a ready-to-buy download from Studio Fern.', 'template', 'templates', 2900, 'USD', 'extended', false, '[{"name":"notion-ops-suite.fig","label":"Figma source","extension":".fig","bytes":14680064},{"name":"notion-ops-suite.pdf","label":"Print-ready export","extension":".pdf","bytes":5242880},{"name":"notion-ops-suite.md","label":"Setup guide","extension":".md","bytes":1048576}]'::jsonb, '[{"app":"Figma","versions":"Current web + desktop"},{"app":"Adobe Acrobat","versions":"2020 and later"}]'::jsonb, '[{"label":"Pages / artboards","value":"17"},{"label":"Grid","value":"12-column, 8pt baseline"},{"label":"Type styles","value":"Variable-font ready, tokenised"},{"label":"Dark mode","value":"Light only"}]'::jsonb, 1, now() - interval '1248 hours')
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

INSERT INTO catalogue.listings (id, owner_user_id, owner_team_id, kind, status, service_blueprint_id, product_id, title, description, description_text, category, delivery_label, amount_cents, currency, ticket_price_cents, session_price_cents, seats_per_session, free_revisions, extra_revision_price_cents, promoted, view_count, order_count, published_at, created_at)
VALUES
  ('ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'product', 'published', NULL, '2a178edd-ae09-4fc4-ab47-e61bbfbfcfc2', 'Aurora UI kit', '{"html":"<p>Aurora UI kit — a ready-to-buy download from Atelier Nova.</p>"}'::jsonb, 'Aurora UI kit — a ready-to-buy download from Atelier Nova.', 'ui-kit', 'Instant download', 7900, 'USD', NULL, NULL, NULL, NULL, NULL, true, 120, 3, now() - interval '1800 hours', now() - interval '1920 hours'),
  ('3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'product', 'published', NULL, 'c31e9aa2-a1ea-4495-a471-7598b963bb23', 'Grain — Lightroom pack', '{"html":"<p>Grain — Lightroom pack — a ready-to-buy download from Ren Koda.</p>"}'::jsonb, 'Grain — Lightroom pack — a ready-to-buy download from Ren Koda.', 'presets', 'Instant download', 2400, 'USD', NULL, NULL, NULL, NULL, NULL, false, 157, 4, now() - interval '1704 hours', now() - interval '1824 hours'),
  ('fcd422c7-3755-4a22-a315-fa658bcc82e0', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 'product', 'published', NULL, '75f0ec2a-da94-4f9b-a36c-1b2044191021', 'Motion primitives', '{"html":"<p>Motion primitives — a ready-to-buy download from Juno Park.</p>"}'::jsonb, 'Motion primitives — a ready-to-buy download from Juno Park.', 'templates', 'Instant download', 4900, 'USD', NULL, NULL, NULL, NULL, NULL, false, 194, 5, now() - interval '1608 hours', now() - interval '1728 hours'),
  ('af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'product', 'published', NULL, 'bf28e02f-9294-49b2-a2b4-43cdb3cfe348', 'Editorial type system', '{"html":"<p>Editorial type system — a ready-to-buy download from Studio Fern.</p>"}'::jsonb, 'Editorial type system — a ready-to-buy download from Studio Fern.', 'templates', 'Instant download', 12000, 'USD', NULL, NULL, NULL, NULL, NULL, false, 231, 6, now() - interval '1512 hours', now() - interval '1632 hours'),
  ('04877375-51b1-4f2e-a8fe-d37bbd0fd52c', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'product', 'published', NULL, '60842026-267e-4fb1-ab6f-776cd8f6585f', 'Dashboard blocks', '{"html":"<p>Dashboard blocks — a ready-to-buy download from North Loop.</p>"}'::jsonb, 'Dashboard blocks — a ready-to-buy download from North Loop.', 'templates', 'Instant download', 6500, 'USD', NULL, NULL, NULL, NULL, NULL, false, 268, 7, now() - interval '1416 hours', now() - interval '1536 hours'),
  ('1284c43c-21de-4e61-a30c-c466ec880fdb', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'product', 'published', NULL, 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 'Iconography set — 640', '{"html":"<p>Iconography set — 640 — a ready-to-buy download from Maris Delacroix.</p>"}'::jsonb, 'Iconography set — 640 — a ready-to-buy download from Maris Delacroix.', 'icons', 'Instant download', 3800, 'USD', NULL, NULL, NULL, NULL, NULL, false, 305, 8, now() - interval '1320 hours', now() - interval '1440 hours'),
  ('32432859-5753-4578-ace1-c7175c28210e', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'product', 'published', NULL, 'ab9f2cc0-769d-4eed-a8ba-6c4ed741b3e3', '3D product scenes', '{"html":"<p>3D product scenes — a ready-to-buy download from Ren Koda.</p>"}'::jsonb, '3D product scenes — a ready-to-buy download from Ren Koda.', '3d', 'Instant download', 9500, 'USD', NULL, NULL, NULL, NULL, NULL, false, 342, 9, now() - interval '1224 hours', now() - interval '1344 hours'),
  ('2aa29779-3801-48ee-a301-9937f376df6c', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'product', 'published', NULL, 'c5e28496-b309-40fd-a25b-2a2c507012a3', 'Notion ops suite', '{"html":"<p>Notion ops suite — a ready-to-buy download from Studio Fern.</p>"}'::jsonb, 'Notion ops suite — a ready-to-buy download from Studio Fern.', 'templates', 'Instant download', 2900, 'USD', NULL, NULL, NULL, NULL, NULL, false, 379, 10, now() - interval '1128 hours', now() - interval '1248 hours'),
  ('b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', '213dc9f8-3ad7-4f35-ac4b-baa674bf48b3', 'service', 'published', '11c2391b-1568-4ee2-aa84-10dd81d8ccf4', NULL, 'Brand identity sprint', '{"html":"<p>A staged identity system — discovery, concept routes, and a final kit with a Webflow handoff.</p>"}'::jsonb, 'A staged identity system — discovery, concept routes, and a final kit with a Webflow handoff.', 'branding', '10-day delivery', 480000, 'USD', 24000, NULL, NULL, 2, 12000, true, 240, 2, now() - interval '2040 hours', now() - interval '2160 hours'),
  ('aa39796f-bf84-48f0-af16-e745b8e67556', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'service', 'published', 'bccc7920-ca19-4f5f-aa0e-f572e1e8b029', NULL, 'Design-system foundation', '{"html":"<p>Tokens, core components, and usage docs delivered as a living Figma library plus a coded foundation.</p>"}'::jsonb, 'Tokens, core components, and usage docs delivered as a living Figma library plus a coded foundation.', 'product', '2-week delivery', 320000, 'USD', 18000, NULL, NULL, 0, 9000, false, 293, 3, now() - interval '1968 hours', now() - interval '2088 hours'),
  ('6ff0a9bd-6b46-4eaa-a41e-99271716035c', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 'service', 'published', '56b1183a-92e4-4f4d-a30e-1e983a201c6b', NULL, 'Landing page in a week', '{"html":"<p>One high-converting landing page — copy polish, responsive build, and analytics wired in five days.</p>"}'::jsonb, 'One high-converting landing page — copy polish, responsive build, and analytics wired in five days.', 'web', '5-day delivery', 240000, 'USD', NULL, NULL, NULL, 1, 18000, false, 346, 4, now() - interval '1896 hours', now() - interval '2016 hours'),
  ('840a6bb5-6d6e-4356-ac37-99cf5c59dc28', 'c7173d3f-8b15-4876-afbf-499d17513a44', 'edc2d943-8062-426a-a6f2-29fdc6b4363c', 'service', 'published', '2579bbc6-d14d-4c65-a5a5-350c3ab9510b', NULL, 'Realtime MVP build', '{"html":"<p>A working realtime product MVP on Deno + Postgres, shipped in weekly milestones you sign off.</p>"}'::jsonb, 'A working realtime product MVP on Deno + Postgres, shipped in weekly milestones you sign off.', 'product', '4-week delivery', 950000, 'USD', 32000, NULL, NULL, 2, 0, false, 399, 5, now() - interval '1824 hours', now() - interval '1944 hours'),
  ('49197229-8833-4e6c-adcc-12a322395eae', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'service', 'published', '871a653c-93a9-45f9-a35f-8d3a3a0d3457', NULL, 'Product launch film', '{"html":"<p>A 60-second launch film — script, 3D motion, sound design, and cutdowns for every channel.</p>"}'::jsonb, 'A 60-second launch film — script, 3D motion, sound design, and cutdowns for every channel.', 'motion', '3-week delivery', 610000, 'USD', NULL, NULL, NULL, 2, 24000, false, 452, 6, now() - interval '1752 hours', now() - interval '1872 hours'),
  ('19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'service', 'published', 'eaff7484-81fb-46d3-adb1-42da56453eb9', NULL, 'Live portfolio review', '{"html":"<p>A booked 1:1 call — a working editor walks your portfolio and leaves a written action plan.</p>"}'::jsonb, 'A booked 1:1 call — a working editor walks your portfolio and leaves a written action plan.', 'content', '60-minute session', 18000, 'USD', NULL, 18000, NULL, NULL, NULL, false, 505, 2, now() - interval '1680 hours', now() - interval '1800 hours'),
  ('8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'c859a726-490c-4f6d-a184-8984de3994d3', 'a4c25501-0fdd-4abe-a575-ff478daad4fc', 'service', 'published', 'f882f878-11fa-4489-a8fa-f3f24055f2cb', NULL, 'Design mentorship block', '{"html":"<p>Six fortnightly 1:1s with a senior product designer — portfolio, craft, and the career conversation nobody schedules.</p>"}'::jsonb, 'Six fortnightly 1:1s with a senior product designer — portfolio, craft, and the career conversation nobody schedules.', 'product', '6 × 45-minute sessions', 96000, 'USD', NULL, 16000, NULL, NULL, NULL, false, 558, 3, now() - interval '1608 hours', now() - interval '1728 hours'),
  ('4ab01144-bb69-4b85-a430-35ee74ba5827', 'bdff9d38-7124-4a49-af5d-c88eb4fe8b57', NULL, 'service', 'published', '7b1b3f95-50bb-4b14-a1fa-457bd622993a', NULL, 'Packaging art direction', '{"html":"<p>A single, self-contained packaging scope: art direction, dielines, and print-ready files from a defined team.</p>"}'::jsonb, 'A single, self-contained packaging scope: art direction, dielines, and print-ready files from a defined team.', 'branding', '7-day delivery', 190000, 'USD', NULL, NULL, NULL, 3, 6000, false, 611, 4, now() - interval '1536 hours', now() - interval '1656 hours'),
  ('bbf5cc66-95c8-49f7-a727-c320dc4ceb69', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 'service', 'published', '40d68e27-474f-4b56-a37e-1605cbc3fdb4', NULL, 'Design systems workshop', '{"html":"<p>A live, multi-seat workshop: build a token-driven design system alongside a small cohort, seats sold per attendee.</p>"}'::jsonb, 'A live, multi-seat workshop: build a token-driven design system alongside a small cohort, seats sold per attendee.', 'product', '2-hour class', 9000, 'USD', NULL, 9000, 16, NULL, NULL, false, 664, 5, now() - interval '1464 hours', now() - interval '1584 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listing_media (id, listing_id, file_id, url, alt_text, position)
VALUES
  ('79b3cd13-7b51-42e0-ada3-fec5c7556cba', 'ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', '68588544-1047-4f29-a0bc-55f62548d873', NULL, 'Aurora UI kit', 0),
  ('35839989-d0d0-4646-aeb2-425b94b36e40', 'ad1c9a90-2d27-4fb5-a7ed-9c86a1e5a85b', '7e269e0c-e033-4e45-a71f-a4aa61a33ef3', NULL, 'Aurora UI kit — view 2', 1),
  ('fc753088-ea9a-49eb-a02e-cc9ea14232f1', '3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', 'ee125997-23ab-4c2c-ac0d-6d5de6d90d5a', NULL, 'Grain — Lightroom pack', 0),
  ('e73e9724-17f7-4573-aa9f-9802eaf2da51', '3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', 'fcb34be5-38fb-4be6-a730-52ff57e810b8', NULL, 'Grain — Lightroom pack — view 2', 1),
  ('0a3bf379-3e84-4ae6-a569-b9cf9b3c5e94', '3b8ccb39-1068-4b5a-a40a-0abfdb7b15d8', '4ab7178c-c648-4437-a4f6-0a169480fd69', NULL, 'Grain — Lightroom pack — view 3', 2),
  ('8f7a42e1-5b04-40c2-a7c0-c36ff834ce98', 'fcd422c7-3755-4a22-a315-fa658bcc82e0', 'b29f397a-9779-4a9f-ab97-ec9c2c29b381', NULL, 'Motion primitives', 0),
  ('7b954aaf-d4f7-43b4-a8ff-9d3d0dae8902', 'fcd422c7-3755-4a22-a315-fa658bcc82e0', '9103a3aa-22bb-4eed-ab82-a5e87b3f8cbb', NULL, 'Motion primitives — view 2', 1),
  ('df2634b1-6555-4c92-a494-0c33f942a5dc', 'fcd422c7-3755-4a22-a315-fa658bcc82e0', '4a9a5f37-3a32-40e2-a7df-8e2581fb5e10', NULL, 'Motion primitives — view 3', 2),
  ('8de60034-6c4f-41f7-a770-7b42aecf3f15', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'e16f3c32-d32c-4c0f-a0b0-621c95145289', NULL, 'Editorial type system', 0),
  ('1c4ceeb5-bf8f-4ec6-a2f4-d5772e2aed48', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'eaf62ce0-12ca-456d-a119-c96e141905c3', NULL, 'Editorial type system — view 2', 1),
  ('49a9236a-e250-4685-aa2d-dde8b9679f73', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', 'ddf7fab5-2b05-4a78-abea-3e4bfc08735e', NULL, 'Editorial type system — view 3', 2),
  ('ac0a3d81-450a-42f6-a067-d6ab1e2cd010', 'af7f0bbe-7dde-4317-aa46-523cf7834c0d', '21a59c0f-fede-40b8-a42e-ea59b0b961f2', NULL, 'Editorial type system — view 4', 3),
  ('6db5f766-d433-4885-a05d-15747dd02b03', '04877375-51b1-4f2e-a8fe-d37bbd0fd52c', '53954770-c946-4487-ad08-e86e558a6f0d', NULL, 'Dashboard blocks', 0),
  ('04e8ff31-79bd-45be-a931-74e3be1e1218', '04877375-51b1-4f2e-a8fe-d37bbd0fd52c', '27963e1e-c5fa-4f53-a0c6-86082fb348c5', NULL, 'Dashboard blocks — view 2', 1),
  ('aa06e93a-1c46-4ca9-aa7a-1ea4c6ec26cb', '04877375-51b1-4f2e-a8fe-d37bbd0fd52c', '90a7cd63-d9cf-48ca-a2be-fa6577644044', NULL, 'Dashboard blocks — view 3', 2),
  ('16df2f97-5994-49e8-ad03-3a75ee20bc0e', '1284c43c-21de-4e61-a30c-c466ec880fdb', 'e5eed9d7-f64d-46f4-ae79-ab69d05545ae', NULL, 'Iconography set — 640', 0),
  ('c4c3ce8c-c5ff-4fc3-af9b-41d288189d41', '1284c43c-21de-4e61-a30c-c466ec880fdb', 'e2dbab7d-a7aa-491e-a194-9cf35eef0e9c', NULL, 'Iconography set — 640 — view 2', 1),
  ('6e3e2255-ae78-405a-abcf-35fbed680910', '1284c43c-21de-4e61-a30c-c466ec880fdb', '058f7c09-8d65-4eae-a2e0-9d378a48d614', NULL, 'Iconography set — 640 — view 3', 2),
  ('f60d2b30-1d28-4fcf-ae4c-9d3a578c8191', '32432859-5753-4578-ace1-c7175c28210e', 'fcb34be5-38fb-4be6-a730-52ff57e810b8', NULL, '3D product scenes', 0),
  ('b514d9fd-e72b-417a-a541-e527db713354', '32432859-5753-4578-ace1-c7175c28210e', '4ab7178c-c648-4437-a4f6-0a169480fd69', NULL, '3D product scenes — view 2', 1),
  ('dfd16d84-5027-4397-af8f-f5b6d2c1a2b1', '32432859-5753-4578-ace1-c7175c28210e', 'ee125997-23ab-4c2c-ac0d-6d5de6d90d5a', NULL, '3D product scenes — view 3', 2),
  ('ba042755-c233-48fa-a447-379b4b497798', '2aa29779-3801-48ee-a301-9937f376df6c', '21a59c0f-fede-40b8-a42e-ea59b0b961f2', NULL, 'Notion ops suite', 0),
  ('b6f69a91-6188-4462-a7f1-9f87988f32c0', '2aa29779-3801-48ee-a301-9937f376df6c', 'eaf62ce0-12ca-456d-a119-c96e141905c3', NULL, 'Notion ops suite — view 2', 1),
  ('91cd28a6-d50c-4bc1-a275-00d81e9d927b', '2aa29779-3801-48ee-a301-9937f376df6c', 'ddf7fab5-2b05-4a78-abea-3e4bfc08735e', NULL, 'Notion ops suite — view 3', 2),
  ('74380ff0-5e63-46f3-a184-e4d2409ca06d', '2aa29779-3801-48ee-a301-9937f376df6c', 'e16f3c32-d32c-4c0f-a0b0-621c95145289', NULL, 'Notion ops suite — view 4', 3),
  ('70c7b796-09d5-41f9-adf2-9614d5d46eef', 'b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '7e269e0c-e033-4e45-a71f-a4aa61a33ef3', NULL, 'Brand identity sprint', 0),
  ('6d8435d0-5345-4ae3-a04f-64ee287cd669', 'b83b6eb2-af5a-42ab-a284-3ae8779f3d99', '68588544-1047-4f29-a0bc-55f62548d873', NULL, 'Brand identity sprint — view 2', 1),
  ('4c9dd37c-660e-4263-adcb-85521e72ca51', 'aa39796f-bf84-48f0-af16-e745b8e67556', '058f7c09-8d65-4eae-a2e0-9d378a48d614', NULL, 'Design-system foundation', 0),
  ('2638843d-f6a0-4bfa-ad9b-827b3c876648', 'aa39796f-bf84-48f0-af16-e745b8e67556', 'e2dbab7d-a7aa-491e-a194-9cf35eef0e9c', NULL, 'Design-system foundation — view 2', 1),
  ('5247540a-1332-4f6d-ad3c-e0d03bc0d4a3', 'aa39796f-bf84-48f0-af16-e745b8e67556', 'e5eed9d7-f64d-46f4-ae79-ab69d05545ae', NULL, 'Design-system foundation — view 3', 2),
  ('e60a7315-c55b-4782-a198-c72ffbec130c', '6ff0a9bd-6b46-4eaa-a41e-99271716035c', '4a9a5f37-3a32-40e2-a7df-8e2581fb5e10', NULL, 'Landing page in a week', 0),
  ('5ef2f753-b8a3-4684-a361-6e59edb64f92', '6ff0a9bd-6b46-4eaa-a41e-99271716035c', '9103a3aa-22bb-4eed-ab82-a5e87b3f8cbb', NULL, 'Landing page in a week — view 2', 1),
  ('73e90075-e73b-4a72-af2c-530bb1aec8c8', '6ff0a9bd-6b46-4eaa-a41e-99271716035c', 'b29f397a-9779-4a9f-ab97-ec9c2c29b381', NULL, 'Landing page in a week — view 3', 2),
  ('dd2635d6-cd4e-4a4d-ad17-fa789f610f87', '840a6bb5-6d6e-4356-ac37-99cf5c59dc28', '90a7cd63-d9cf-48ca-a2be-fa6577644044', NULL, 'Realtime MVP build', 0),
  ('c3770915-16f6-451a-a72b-925ff9f6987c', '840a6bb5-6d6e-4356-ac37-99cf5c59dc28', '27963e1e-c5fa-4f53-a0c6-86082fb348c5', NULL, 'Realtime MVP build — view 2', 1),
  ('b47cfda2-c599-4a49-af95-8e48642f7aef', '840a6bb5-6d6e-4356-ac37-99cf5c59dc28', '53954770-c946-4487-ad08-e86e558a6f0d', NULL, 'Realtime MVP build — view 3', 2),
  ('872eab0a-130a-4cdd-ae10-ec7c5f7fd7af', '49197229-8833-4e6c-adcc-12a322395eae', '4ab7178c-c648-4437-a4f6-0a169480fd69', NULL, 'Product launch film', 0),
  ('3cd201ff-553e-4a10-ab68-cb1973f76fe2', '49197229-8833-4e6c-adcc-12a322395eae', 'fcb34be5-38fb-4be6-a730-52ff57e810b8', NULL, 'Product launch film — view 2', 1),
  ('0868ee67-413a-4d64-a9cb-2939161418fe', '49197229-8833-4e6c-adcc-12a322395eae', 'ee125997-23ab-4c2c-ac0d-6d5de6d90d5a', NULL, 'Product launch film — view 3', 2),
  ('c30e0af5-2ef2-4ef6-a01d-c6b728eebc60', '19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'eaf62ce0-12ca-456d-a119-c96e141905c3', NULL, 'Live portfolio review', 0),
  ('2dd43d2a-957c-49d5-a4c7-6aa8d5de5b9b', '19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'ddf7fab5-2b05-4a78-abea-3e4bfc08735e', NULL, 'Live portfolio review — view 2', 1),
  ('18c12474-b38c-4de7-a1f4-0982bdce3f0d', '19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', 'e16f3c32-d32c-4c0f-a0b0-621c95145289', NULL, 'Live portfolio review — view 3', 2),
  ('b2ad2741-a931-4646-a2f2-e66bf986be38', '19c80ea3-c2a5-4e54-af85-bf05a70ddc6e', '21a59c0f-fede-40b8-a42e-ea59b0b961f2', NULL, 'Live portfolio review — view 4', 3),
  ('33bd6225-da4b-4cba-a89b-c723ea12aee8', '8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'ddf7fab5-2b05-4a78-abea-3e4bfc08735e', NULL, 'Design mentorship block', 0),
  ('770b2566-f860-40e5-aeed-d71872d9a677', '8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'eaf62ce0-12ca-456d-a119-c96e141905c3', NULL, 'Design mentorship block — view 2', 1),
  ('a42fad17-1b01-46e4-a270-56a5d7554c42', '8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', 'e16f3c32-d32c-4c0f-a0b0-621c95145289', NULL, 'Design mentorship block — view 3', 2),
  ('3b60c396-e14c-4e91-abed-a4c0904ca7ab', '8de7bab9-c5e7-4ee8-ab70-355f03d78c4e', '21a59c0f-fede-40b8-a42e-ea59b0b961f2', NULL, 'Design mentorship block — view 4', 3),
  ('d1924a93-c1e9-4e70-a296-c9b9cdc03f6e', '4ab01144-bb69-4b85-a430-35ee74ba5827', 'fcb34be5-38fb-4be6-a730-52ff57e810b8', NULL, 'Packaging art direction', 0),
  ('5d82cb86-43ba-43bd-ac1a-ee9cb73e9f33', '4ab01144-bb69-4b85-a430-35ee74ba5827', '4ab7178c-c648-4437-a4f6-0a169480fd69', NULL, 'Packaging art direction — view 2', 1),
  ('e986160b-07bc-4844-a7d1-1dd986c39c8a', '4ab01144-bb69-4b85-a430-35ee74ba5827', 'ee125997-23ab-4c2c-ac0d-6d5de6d90d5a', NULL, 'Packaging art direction — view 3', 2),
  ('2ef7274f-fd42-488c-a4dd-bf6589e973c2', 'bbf5cc66-95c8-49f7-a727-c320dc4ceb69', 'e2dbab7d-a7aa-491e-a194-9cf35eef0e9c', NULL, 'Design systems workshop', 0),
  ('97618136-a6bc-4c55-ae63-9be4eace23cb', 'bbf5cc66-95c8-49f7-a727-c320dc4ceb69', '058f7c09-8d65-4eae-a2e0-9d378a48d614', NULL, 'Design systems workshop — view 2', 1),
  ('ebffdf64-4f5d-4997-a26a-7aa263a27845', 'bbf5cc66-95c8-49f7-a727-c320dc4ceb69', 'e5eed9d7-f64d-46f4-ae79-ab69d05545ae', NULL, 'Design systems workshop — view 3', 2)
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

INSERT INTO reviews.entity_reviews (id, target_entity_id, target_entity_type, reviewer_user_id, project_id, rating, title, comment, created_at, updated_at)
VALUES
  ('0c604eab-8ad6-467a-a206-60d9461dfde8', '11c2391b-1568-4ee2-aa84-10dd81d8ccf4', 'service_blueprint', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', NULL, 5.00, 'The identity our whole launch now hangs off', 'Atelier Nova ran discovery properly — they interviewed our roasters before drawing a single mark. The final kit covered every packaging size we sell and the Webflow handoff took our developer an afternoon.', now() - interval '504 hours', now() - interval '504 hours'),
  ('4d59fb75-d875-4888-a7f2-6797e531d2c2', '11c2391b-1568-4ee2-aa84-10dd81d8ccf4', 'service_blueprint', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', NULL, 4.80, 'Structured, calm and genuinely strategic', 'Every stage ended with something I could put in front of my board. The concept routes were distinct rather than three variations of one idea, which made choosing easy. One extra revision round was needed on the wordmark.', now() - interval '1152 hours', now() - interval '1152 hours'),
  ('ffbc72f6-1ba1-4a39-a5d4-b9283a983f13', '11c2391b-1568-4ee2-aa84-10dd81d8ccf4', 'service_blueprint', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', NULL, 5.00, 'A brand system, not just a logo', 'We came for a refresh and left with a system our product team can actually extend: tokens for colour and type, clear rules for illustration, and a guidelines document people genuinely read.', now() - interval '1752 hours', now() - interval '1752 hours'),
  ('85c27b8d-3010-44ac-ad01-4daf8cbbd616', 'bccc7920-ca19-4f5f-aa0e-f572e1e8b029', 'service_blueprint', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', NULL, 5.00, 'Our engineers adopted it the same week', 'Maris set up a token architecture that maps cleanly onto our codebase, and the theming contract made dark mode a configuration change. The accessibility checklist caught issues we had shipped for a year.', now() - interval '336 hours', now() - interval '336 hours'),
  ('b696c2e9-8649-4496-aeeb-9f173e5ac56c', 'bccc7920-ca19-4f5f-aa0e-f572e1e8b029', 'service_blueprint', '292e1827-f189-4f34-ab35-27c9f0320926', NULL, 4.90, 'The foundation we should have started with', 'Clear stage reviews, a component library that matches production, and an adoption guide our engineers actually followed. Pricing per ticket let us scale the second stage up without renegotiating anything.', now() - interval '936 hours', now() - interval '936 hours'),
  ('71328678-2c64-4e0b-a2f5-3522c3491b1d', 'bccc7920-ca19-4f5f-aa0e-f572e1e8b029', 'service_blueprint', '35ce4987-15b3-4c38-a438-2bb9c35df15a', NULL, 4.70, 'Excellent on tokens, thorough on docs', 'The token work is excellent and the documentation is the best we have received from a contractor. The component review stage ran a few days long, but the delay was communicated early and handled well.', now() - interval '1584 hours', now() - interval '1584 hours'),
  ('225d4aec-0232-4223-a432-24d60f8e38b5', '56b1183a-92e4-4f4d-a30e-1e983a201c6b', 'service_blueprint', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', NULL, 5.00, 'Live in five days, exactly as promised', 'Juno shipped a fast, accessible landing page in the week we were promised, with the forms and analytics wired correctly first time. The Figma file is tidy enough that I can edit sections myself now.', now() - interval '216 hours', now() - interval '216 hours'),
  ('c0713f8f-f3b6-42d4-a4bb-070114b34d0e', '56b1183a-92e4-4f4d-a30e-1e983a201c6b', 'service_blueprint', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', NULL, 4.60, 'Fast turnaround and a clean build', 'The build scored well on performance from day one and the copy pass tightened our messaging considerably. We needed one small layout fix after launch, which was turned around within a day of asking.', now() - interval '1056 hours', now() - interval '1056 hours'),
  ('0f9ed003-3135-4244-a7e3-9b7dfa40695e', '2579bbc6-d14d-4c65-a5a5-350c3ab9510b', 'service_blueprint', '292e1827-f189-4f34-ab35-27c9f0320926', NULL, 4.80, 'Reliable, communicative, and the load test held', 'North Loop delivered the ingestion stage a week early and the replay design has already saved us once in production. The row-level security policies were reviewed with us line by line before shipping.', now() - interval '432 hours', now() - interval '432 hours'),
  ('cc92b9bb-e52c-46a4-a61d-d1e567669ace', '2579bbc6-d14d-4c65-a5a5-350c3ab9510b', 'service_blueprint', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', NULL, 4.90, 'A realtime backend we trust in production', 'Every stage came with a written handoff and a working demo. The typed client removed a whole class of bugs from our frontend, and the deployment runbook meant our on-call rotation was ready on day one.', now() - interval '1248 hours', now() - interval '1248 hours'),
  ('91da7998-d622-4839-aaaa-461623061bbf', '871a653c-93a9-45f9-a35f-8d3a3a0d3457', 'service_blueprint', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', NULL, 5.00, 'The launch film carried our whole campaign', 'Ren turned a rough brief into a film that felt expensive without being loud. The social cut-downs were ready alongside the master, and the sound design made the product feel physical on screen.', now() - interval '648 hours', now() - interval '648 hours'),
  ('782b96e9-e73a-409a-a2f3-4747b2ec6ad0', '871a653c-93a9-45f9-a35f-8d3a3a0d3457', 'service_blueprint', 'de29f2ce-0f36-4db5-a417-4edc88cedf83', NULL, 4.70, 'Beautiful work, very clear process', 'Storyboards and style frames were signed off before any rendering began, so there were no surprises at the end. We asked for one extra cut-down, which was quoted clearly and delivered within two days.', now() - interval '1944 hours', now() - interval '1944 hours'),
  ('4fce693f-2d29-46b6-a0d8-2f3919543da0', 'eaff7484-81fb-46d3-adb1-42da56453eb9', 'service_blueprint', '950d68d1-8777-4bbe-ae59-3343e3e7f858', NULL, 5.00, 'An hour that changed how I present my work', 'Saoirse walked through every case study, cut three I was attached to, and explained exactly why. The written action plan arrived the next morning and I have been working through it ever since.', now() - interval '288 hours', now() - interval '288 hours'),
  ('763cbf94-3e74-49db-a952-55d691570d3d', 'eaff7484-81fb-46d3-adb1-42da56453eb9', 'service_blueprint', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 4.80, 'Direct, kind and genuinely useful', 'I have had portfolio reviews before that were vague encouragement. This was specific: which projects to lead with, what to cut, and how to write the case studies so the decisions come across.', now() - interval '840 hours', now() - interval '840 hours'),
  ('485ddd49-4dee-4854-a0e8-57af74f963c2', 'f882f878-11fa-4489-a8fa-f3f24055f2cb', 'service_blueprint', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', NULL, 4.90, 'Six sessions worth more than a course', 'The growth plan from the first session shaped the whole block, and the async feedback between calls kept me moving. I left with a clear sense of the design decisions I am now trusted to make.', now() - interval '552 hours', now() - interval '552 hours'),
  ('ce9d2e8b-a9d5-49dc-a886-28b156d9ec1a', 'f882f878-11fa-4489-a8fa-f3f24055f2cb', 'service_blueprint', '950d68d1-8777-4bbe-ae59-3343e3e7f858', NULL, 4.80, 'Thoughtful mentorship with real structure', 'Each session built on the last and the notes afterwards meant nothing was lost. The feedback on my UX writing portfolio was specific enough to act on the same day, which is rare in mentoring.', now() - interval '1392 hours', now() - interval '1392 hours'),
  ('af9246d1-42e3-4964-a12d-d58bf80f5736', '7b1b3f95-50bb-4b14-a1fa-457bd622993a', 'service_blueprint', '2bdebf14-f7dc-40af-acd8-fe22cb9916fd', NULL, 5.00, 'Packaging that finally matches the coffee', 'Ren''s three routes were genuinely different directions, and the final artwork came with print-ready dielines our supplier accepted without a single query. The whole SKU family now feels like one brand.', now() - interval '720 hours', now() - interval '720 hours'),
  ('18e3d77f-d681-497e-afad-1955e475c684', '7b1b3f95-50bb-4b14-a1fa-457bd622993a', 'service_blueprint', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', NULL, 4.70, 'Strong art direction and a tidy handoff', 'The concept presentation was clear about trade-offs between cost and finish, which helped us decide quickly. The supplier handoff pack saved our production manager days of back and forth.', now() - interval '1608 hours', now() - interval '1608 hours'),
  ('fc0fe065-0924-4cf8-af0d-6a0f6271bcfa', '40d68e27-474f-4b56-a37e-1605cbc3fdb4', 'service_blueprint', '3fc3da04-549b-4239-aca3-fa82f713dbaf', NULL, 4.90, 'The clearest two hours on tokens I have seen', 'Maris moved from principles to a working token set in two hours without losing anyone. The exercise files were practical and the recording meant our absent teammates could catch up the next day.', now() - interval '384 hours', now() - interval '384 hours'),
  ('33d970cd-866d-46d0-ac90-aadffb73929a', '40d68e27-474f-4b56-a37e-1605cbc3fdb4', 'service_blueprint', '2e4274fb-e76b-4640-ad31-c66d7fbea842', NULL, 4.60, 'Useful for engineers, not just designers', 'As a backend engineer I expected to sit this out, but the session on theming contracts changed how I think about our API for preferences. The follow-up thread answered everything we raised afterwards.', now() - interval '984 hours', now() - interval '984 hours'),
  ('ee256db1-39ac-48bc-a8a3-827765c30ee2', '40d68e27-474f-4b56-a37e-1605cbc3fdb4', 'service_blueprint', '35ce4987-15b3-4c38-a438-2bb9c35df15a', NULL, 4.80, 'Well run and immediately applicable', 'Our product team used the workshop as a kickoff for our own system and the shared vocabulary helped immediately. Sixteen seats felt about right — there was still time for everyone''s questions.', now() - interval '1800 hours', now() - interval '1800 hours'),
  ('9d6789df-7d23-44c6-ae2d-3a0d8f842534', '2a178edd-ae09-4fc4-ab47-e61bbfbfcfc2', 'product', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 4.90, 'The Figma kit I reach for first', 'Aurora is organised the way a real product is built — tokens first, then components, then patterns. Variants are consistent and the auto-layout never fights you when content changes length.', now() - interval '456 hours', now() - interval '456 hours'),
  ('e0c19fa0-1cb5-480b-a6e5-1e56fca5d611', '2a178edd-ae09-4fc4-ab47-e61bbfbfcfc2', 'product', 'c7173d3f-8b15-4876-afbf-499d17513a44', NULL, 4.70, 'Saves days on every new dashboard', 'We used Aurora to prototype an internal tool and the handoff to code was smooth because the naming matches what engineers expect. A few more data-table variants would make it perfect.', now() - interval '1104 hours', now() - interval '1104 hours'),
  ('c71eda50-1031-40e7-a3e5-a5d28fca34c1', 'c31e9aa2-a1ea-4495-a471-7598b963bb23', 'product', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', NULL, 4.80, 'Film looks that do not fall apart', 'The grain in this pack is subtle enough to survive compression on social and the looks hold up across skin tones. I use three of the presets as a starting point on almost every shoot now.', now() - interval '600 hours', now() - interval '600 hours'),
  ('48e075e2-f10d-4d23-aae7-0ab0fcf93fb9', 'c31e9aa2-a1ea-4495-a471-7598b963bb23', 'product', 'c859a726-490c-4f6d-a184-8984de3994d3', NULL, 4.60, 'Tasteful presets for editorial work', 'Most preset packs push colour too far; these stay restrained and editorial. The included notes on adjusting exposure before applying them made a real difference to my results.', now() - interval '1512 hours', now() - interval '1512 hours'),
  ('a365e36f-9075-46fa-a18a-ce89e8b960b4', '75f0ec2a-da94-4f9b-a36c-1b2044191021', 'product', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', NULL, 4.90, 'Motion that respects reduced-motion settings', 'The primitives are small, typed and honour reduced-motion preferences out of the box, which is rare. We replaced a heavier animation library with these and our bundle shrank noticeably.', now() - interval '528 hours', now() - interval '528 hours'),
  ('45aca20f-d8a3-4756-aa14-a7fd31fab43c', '75f0ec2a-da94-4f9b-a36c-1b2044191021', 'product', '5b4f5d46-9d9a-4973-a8fd-bfa0b88e72cd', NULL, 4.70, 'Clean API and good defaults', 'The easing defaults feel right without tuning and the API is predictable. The integration guide covered our framework directly, so the whole team was using it within an afternoon.', now() - interval '1320 hours', now() - interval '1320 hours'),
  ('c655fb78-dd1f-4d73-aa55-3256dfcc00d1', 'bf28e02f-9294-49b2-a2b4-43cdb3cfe348', 'product', '950d68d1-8777-4bbe-ae59-3343e3e7f858', NULL, 5.00, 'Typography that makes long reads pleasant', 'The type scale is carefully tuned for long-form reading and the pairing guidance saved me from my usual mistakes. It made our newsletter feel like a publication instead of an email.', now() - interval '672 hours', now() - interval '672 hours'),
  ('3019bd1d-a7ee-40b2-a226-659bb881de50', 'bf28e02f-9294-49b2-a2b4-43cdb3cfe348', 'product', '6ce1906f-caab-4708-a19e-df3d8960666e', NULL, 4.80, 'A thoughtful editorial foundation', 'Measure, rhythm and heading hierarchy are all considered together rather than as separate tokens. I adapted it for a documentation site and it needed almost no adjustment.', now() - interval '1680 hours', now() - interval '1680 hours'),
  ('4aa310eb-04f2-4980-a434-3161007af1b6', '60842026-267e-4fb1-ab6f-776cd8f6585f', 'product', '292e1827-f189-4f34-ab35-27c9f0320926', NULL, 4.80, 'Dashboard layouts that ship quickly', 'The blocks cover the layouts we actually need — KPI rows, dense tables and filter bars — and they are built on sensible tokens. Our analytics screens came together in a fraction of the usual time.', now() - interval '408 hours', now() - interval '408 hours'),
  ('d532ed36-26a6-4455-a524-acd44e00f6cb', '60842026-267e-4fb1-ab6f-776cd8f6585f', 'product', '3fc3da04-549b-4239-aca3-fa82f713dbaf', NULL, 4.50, 'Solid blocks, well documented', 'Good coverage of common dashboard patterns and clear documentation. I would like a few more empty-state variants, but the ones included are accessible and easy to extend.', now() - interval '1440 hours', now() - interval '1440 hours'),
  ('1c2c6b5d-0d90-4ad8-a7e0-73337af5bc86', 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 'product', '0dd8da22-3fe7-4449-a6f6-df8cfd5ebfbb', NULL, 4.90, 'Consistent icons at every size', 'The stroke weights stay consistent from 16 to 48 pixels, which is where most icon sets fall apart. The naming is predictable enough that the team finds the right icon without asking.', now() - interval '744 hours', now() - interval '744 hours'),
  ('31bff6eb-d5e0-480e-a8d1-1f0548ae9138', 'd537bef9-ec2c-4b98-a9ad-481b8352748a', 'product', '45a4c6ae-d818-45fd-a62b-db44f1f69eab', NULL, 4.70, 'A large set that still feels designed', 'Six hundred icons and they still read as one family. The SVGs are clean, with no stray groups or transforms, so they drop straight into our component library.', now() - interval '1296 hours', now() - interval '1296 hours'),
  ('db5e93d4-4617-4ac5-a14f-9cde82c41e47', 'ab9f2cc0-769d-4eed-a8ba-6c4ed741b3e3', 'product', '1fee216e-a637-4619-a90a-4ae03bb1ed8b', NULL, 4.80, 'Studio-quality renders without a studio', 'The scenes are lit beautifully and swapping in our own product meshes took minutes. We used them for a launch campaign and nobody could tell they were built from a kit.', now() - interval '624 hours', now() - interval '624 hours'),
  ('0e3514b5-39b3-4184-a2ab-2feff1d50716', 'ab9f2cc0-769d-4eed-a8ba-6c4ed741b3e3', 'product', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', NULL, 4.60, 'Well organised scenes with good lighting', 'Materials and cameras are named clearly and the lighting rigs are easy to adjust. Render times were reasonable on a mid-range machine with the settings included in the guide.', now() - interval '1632 hours', now() - interval '1632 hours'),
  ('a5c85616-cc51-426d-ad82-298839e35cef', 'c5e28496-b309-40fd-a25b-2a2c507012a3', 'product', '35ce4987-15b3-4c38-a438-2bb9c35df15a', NULL, 4.80, 'Our team''s operating system in an afternoon', 'The suite gave us project, meeting and decision logs that link together properly. Setup took an afternoon and the templates are opinionated in ways that genuinely improved how we run the team.', now() - interval '480 hours', now() - interval '480 hours'),
  ('1e131623-b795-493c-afd5-2aa94539cab2', 'c5e28496-b309-40fd-a25b-2a2c507012a3', 'product', 'b30145ef-f693-439c-a2c4-8b3db32a54a2', NULL, 4.60, 'Practical templates for real ops work', 'The decision log alone was worth it. The databases are structured well and the guide explains how to adapt each template instead of assuming one way of working suits everyone.', now() - interval '1368 hours', now() - interval '1368 hours')
ON CONFLICT (id) DO NOTHING;

INSERT INTO marketplace.promoted_placements (id, sponsor_user_id, entity_type, entity_id, surface, starts_at, ends_at, spend_cents, currency)
VALUES
  ('c6aa8b97-2321-4dce-a35b-52598ce2d808', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'service', '11c2391b-1568-4ee2-aa84-10dd81d8ccf4', 'explore_home', now() - interval '168 hours', now() + interval '552 hours', 4900, 'USD'),
  ('8115e701-8a61-435c-a028-fc1bc2ccef26', '9e4c0d6c-1b26-48ff-ae0f-1202ebcf5a3d', 'product', '2a178edd-ae09-4fc4-ab47-e61bbfbfcfc2', 'explore_home', now() - interval '168 hours', now() + interval '552 hours', 4900, 'USD')
ON CONFLICT (id) DO NOTHING;
