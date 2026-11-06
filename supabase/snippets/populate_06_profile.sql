-- =============================================================================================
-- populate_06_profile.sql — fills one account's public profile with a believable eighteen months.
--
-- WHAT IT POPULATES
--   Identity      visibility, headline, story, location, languages, interests, skills, links
--   Media         avatar, banner, five showcase slots, portfolio covers, employer logos
--   Experience    roles, education, certifications (verified, unverified and one expired)
--   Selected work four public portfolio pieces and one private draft
--   Record        two client businesses, three finished public projects, seven paid stages,
--                 six reviews, achievements, streaks, CREATE mastery and a computed Standing
--   Graph         followers and following with the seeded personas
--   Hire form     the questions the profile asks before joining a project
--
-- WHICH PAGES SHOW IT
--   /<username>                  hero, showcase, context bar, metrics, trust signals
--   /<username>/work             selected work, completed projects
--   /<username>/experience       roles, education, certifications
--   /<username>/reviews          reviews and the rating summary
--   /<username>/edit             the owner's editor, seeded from the same rows
--
-- NOT HERE, ON PURPOSE
--   Services, products and posts are listings, and working hours and call offers are the calendar's:
--   those rows belong to the other populate_* snippets. Their sections stay empty if this runs alone.
--   The target's personal wallet is untouched: the seven released escrows here pay the target, and
--   populate_07_wallet.sql picks them up into its ledger walk when it runs.
--
-- HOW TO RUN
--   Open this file in Supabase Studio (localhost:54323) and press Run, or:
--     docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < populate_06_profile.sql
--   Running it twice changes nothing. A value the owner has already set is kept, and it is safe
--   after or before any other populate_* snippet. Run it after them if you want Standing to count
--   the work they add.
--
-- TO POPULATE SOMEBODY ELSE
--   Change the username in the `snippet.username` line just below.
-- =============================================================================================

BEGIN;

-- ▼ TARGET ACCOUNT — change this one value to populate somebody else.
SELECT set_config('snippet.username', 'ahmed.kotzie-kotwal', true);

-- #region Shared helpers (session-temporary, byte-identical in every populate_* snippet)

/** The target account's id; refuses with a readable message when the username has no account. */
CREATE OR REPLACE FUNCTION pg_temp.me() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT user_id INTO v_id
      FROM org.users_public
     WHERE username = current_setting('snippet.username');
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'No account has the username "%": sign up first, or edit the username at the top of this snippet.',
            current_setting('snippet.username');
    END IF;
    RETURN v_id;
END;
$$;

/** A stable uuid for a natural key, namespaced by the target account so two accounts never collide. */
CREATE OR REPLACE FUNCTION pg_temp.sid(p_key text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT (substr(h, 1, 12) || '4' || substr(h, 14, 3) || 'a' || substr(h, 18, 15))::uuid
      FROM (SELECT md5(pg_temp.me()::text || ':' || p_key) AS h) x;
$$;

/** A stable opaque slug in the shape the CHECKs want (`prj-…`, `stg-…`, `tkt-…`, `svc-…`). */
CREATE OR REPLACE FUNCTION pg_temp.slug(p_prefix text, p_key text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT p_prefix || '-' || string_agg(
               substr('23456789abcdefghjkmnopqrstuvwxyz', 1 + get_byte(h, i) % 32, 1), '' ORDER BY i)
      FROM (SELECT decode(md5(p_prefix || ':' || pg_temp.me()::text || ':' || p_key), 'hex') AS h) x,
           generate_series(0, 9) AS i;
$$;

/** A seeded persona's user id, by username; refuses when the seed world is missing. */
CREATE OR REPLACE FUNCTION pg_temp.persona(p_username text) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT user_id INTO v_id FROM org.users_public WHERE username = p_username;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'Seed persona "%" is missing: these snippets expect the seeded world from `deno task db:reset`.',
            p_username;
    END IF;
    RETURN v_id;
END;
$$;

/**
 * Backdates a brand-new account by eighteen months, so the history these snippets write does not
 * predate the person it belongs to. An account already that old is left alone.
 */
CREATE OR REPLACE FUNCTION pg_temp.ensure_tenure() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE org.users_public
       SET created_at = now() - interval '540 days'
     WHERE user_id = pg_temp.me() AND created_at > now() - interval '500 days';

    UPDATE org.freelancer_profiles
       SET created_at = now() - interval '540 days'
     WHERE user_id = pg_temp.me() AND created_at > now() - interval '500 days';
END;
$$;

/** Makes the target a freelancer: the flag, and a profile row when there is none. */
CREATE OR REPLACE FUNCTION pg_temp.ensure_freelancer() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE org.users_public
       SET is_freelancer = true
     WHERE user_id = pg_temp.me() AND NOT is_freelancer;

    INSERT INTO org.freelancer_profiles (user_id, skills)
    VALUES (pg_temp.me(), ARRAY['product']::text[])
    ON CONFLICT (user_id) DO NOTHING;
END;
$$;

/**
 * Makes the target payout-ready: KYC verified at tier 2 with its case, plus a verified payout account,
 * which is what `finance.fn_freelancer_payout_ready` and every earning door read.
 */
CREATE OR REPLACE FUNCTION pg_temp.ensure_verified() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_temp.ensure_freelancer();

    UPDATE org.freelancer_profiles
       SET kyc_status = 'verified',
           kyc_tier = 2,
           kyc_verified_at = COALESCE(kyc_verified_at, now() - interval '330 days'),
           payout_ready = true,
           identity_provider_ref = COALESCE(identity_provider_ref, 'vs_snippet_' || pg_temp.me())
     WHERE user_id = pg_temp.me();

    INSERT INTO finance.verification_cases
        (id, subject_type, subject_id, kind, status, tier, provider, provider_ref, submitted_at, decided_at)
    VALUES
        (pg_temp.sid('kyc'), 'freelancer', pg_temp.me(), 'kyc', 'verified', 2, 'stripe_identity',
         'vs_snippet_' || pg_temp.me(), now() - interval '331 days', now() - interval '330 days')
    ON CONFLICT (id) DO NOTHING;

    -- One live account per provider: one that exists is verified in place, otherwise one is added.
    UPDATE finance.payout_accounts
       SET status = 'verified'
     WHERE owner_type = 'freelancer' AND owner_id = pg_temp.me() AND provider = 'stripe'
       AND status <> 'disabled';

    INSERT INTO finance.payout_accounts (id, owner_type, owner_id, provider, account_id, status)
    SELECT pg_temp.sid('payout-account'), 'freelancer', pg_temp.me(), 'stripe',
           'acct_snippet_' || replace(pg_temp.me()::text, '-', ''), 'verified'
     WHERE NOT EXISTS (
         SELECT 1 FROM finance.payout_accounts a
          WHERE a.owner_type = 'freelancer' AND a.owner_id = pg_temp.me() AND a.provider = 'stripe'
            AND a.status <> 'disabled'
     );
END;
$$;

/** The wallet of an owner in a currency, created empty on first use. */
CREATE OR REPLACE FUNCTION pg_temp.wallet(p_owner_type text, p_owner_id uuid, p_currency text DEFAULT 'USD')
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    SELECT id INTO v_id
      FROM finance.wallets
     WHERE owner_type = p_owner_type AND owner_id = p_owner_id AND currency = p_currency;
    IF v_id IS NULL THEN
        INSERT INTO finance.wallets (owner_type, owner_id, currency)
        VALUES (p_owner_type, p_owner_id, p_currency)
        RETURNING id INTO v_id;
    END IF;
    RETURN v_id;
END;
$$;

/**
 * Appends one ledger row and moves the wallet's balance with it; a key already posted is a no-op, so
 * a re-run cannot double-count. The ledger is append-only, so call this in chronological order per
 * wallet: `balance_after_cents` is a running balance over the order of the calls.
 */
CREATE OR REPLACE FUNCTION pg_temp.post(
    p_key text,
    p_wallet uuid,
    p_direction text,
    p_amount_cents bigint,
    p_reason text,
    p_at timestamptz,
    p_ref_table text DEFAULT NULL,
    p_ref_id uuid DEFAULT NULL,
    p_fund_state finance.fund_state DEFAULT 'available'
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid := pg_temp.sid('tx:' || p_key);
    v_balance bigint;
    v_currency text;
BEGIN
    IF EXISTS (SELECT 1 FROM finance.transactions WHERE id = v_id) THEN
        RETURN v_id;
    END IF;

    UPDATE finance.wallets
       SET balance_cents = balance_cents
           + CASE p_direction WHEN 'credit' THEN p_amount_cents ELSE -p_amount_cents END
     WHERE id = p_wallet
    RETURNING balance_cents, currency INTO v_balance, v_currency;

    INSERT INTO finance.transactions
        (id, wallet_id, direction, amount_cents, currency, reason, ref_table, ref_id,
         balance_after_cents, fund_state, created_at)
    VALUES
        (v_id, p_wallet, p_direction, p_amount_cents, v_currency, p_reason, p_ref_table, p_ref_id,
         v_balance, p_fund_state, p_at);
    RETURN v_id;
END;
$$;

SELECT pg_temp.ensure_tenure();

-- #endregion

-- #region Script helpers and content

/** A moment p_days ago, in the working day of the target's city, so nothing lands at 3am. */
CREATE OR REPLACE FUNCTION pg_temp.p7_ago(p_days integer) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Dubai')
            - p_days * interval '1 day'
            + (9 + p_days % 8) * interval '1 hour') AT TIME ZONE 'Asia/Dubai';
$$;

/** A year p_back years before this one, as the text the profile tables store. */
CREATE OR REPLACE FUNCTION pg_temp.p7_year(p_back integer) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT (extract(year FROM now())::integer - p_back)::text;
$$;

-- The clients. Each business is owned by a persona who already has has_business set and owns none
-- yet, so no seeded row needs to change and no plan limit is passed.
CREATE OR REPLACE TEMP VIEW p7_business AS
SELECT v.*,
       pg_temp.sid('p7:business:' || v.key) AS id,
       v.key || '-' || substr(pg_temp.me()::text, 1, 4) AS slug,
       pg_temp.persona(v.owner_name) AS owner_id,
       pg_temp.persona(v.member_name) AS member_id
FROM (VALUES
    ('lantern-commerce', 'hannahcole', 'priyaraman', 'Board advisor',
     'Lantern Commerce', 'Lantern Commerce Ltd',
     'Homeware online, shipped from our own warehouse',
     'An independent homeware retailer selling direct across the UK and the Gulf.',
     'London', 'United Kingdom', 'Europe/London', 1500000::bigint, 440),
    ('northbeam-clinics', 'miguelsantos', 'danielokafor', 'Operations advisor',
     'Northbeam Clinics', 'Northbeam Clinics Inc.',
     'Walk-in family clinics, booked from your phone',
     'A growing group of family clinics that wants booking to take less time than the appointment.',
     'Toronto', 'Canada', 'America/Toronto', 800000::bigint, 280)
) v (key, owner_name, member_name, member_title, name, legal_name, headline, bio, city, country,
     timezone, deposit_cents, created_days);

-- The finished engagements.
CREATE OR REPLACE TEMP VIEW p7_project AS
SELECT v.*,
       pg_temp.sid('p7:project:' || v.key) AS id,
       pg_temp.slug('prj', 'p7:' || v.key) AS slug,
       b.id AS business_id,
       b.owner_id
FROM (VALUES
    ('checkout', 'lantern-commerce', 'Checkout and account redesign',
     'Rebuild the guest checkout and account area of an online retailer, one funded stage at a time.',
     430, 369),
    ('booking', 'northbeam-clinics', 'Clinic booking app',
     'Design a patient booking app in English and Arabic, from first interviews to a build-ready file.',
     270, 218),
    ('system', 'lantern-commerce', 'Design system rollout',
     'Turn a year of one-off screens into a token set and a component library the team ships from.',
     120, 59)
) v (key, business, title, summary, created_days, finished_days)
JOIN p7_business b ON b.key = v.business;

-- One row per stage, each with the single ticket that delivered it. Amounts keep 5% a whole number.
CREATE OR REPLACE TEMP VIEW p7_stage AS
SELECT v.*,
       pg_temp.sid('p7:stage:' || v.key) AS id,
       pg_temp.slug('stg', 'p7:' || v.key) AS slug,
       pg_temp.sid('p7:ticket:' || v.key) AS ticket_id,
       pg_temp.slug('tkt', 'p7:' || v.key) AS ticket_slug,
       pg_temp.sid('p7:escrow:' || v.key) AS escrow_id,
       p.id AS project_id,
       p.owner_id,
       p.business_id,
       p.business
FROM (VALUES
    ('checkout:1', 'checkout', 1, 'Funnel audit and research',
     'Audit the current checkout and account area, interview recent buyers and name the steps that lose orders.',
     'Funnel audit and findings report', 'Findings report, session clips and a ranked list of fixes.',
     ARRAY['Review twelve weeks of funnel analytics', 'Interview eight recent buyers'],
     180000::bigint, 'test', 2.00, ARRAY['ux-research', 'user-interviews'], 425, 412, 410),
    ('checkout:2', 'checkout', 2, 'Flows and prototype',
     'Redesign guest checkout, saved details and order tracking as a clickable prototype and test it with buyers.',
     'Checkout prototype, tested with buyers', 'Figma prototype plus notes from five test sessions.',
     ARRAY['Map the new guest checkout', 'Run five prototype test sessions'],
     320000::bigint, 'create', 3.00, ARRAY['ux', 'prototyping', 'figma'], 408, 392, 390),
    ('checkout:3', 'checkout', 3, 'UI and developer handoff',
     'Finish the interface for web and mobile, and hand developers a specified, annotated file.',
     'Final UI and handoff file', 'Annotated Figma file, redlines and an acceptance checklist.',
     ARRAY['Finish the responsive screens', 'Annotate states and edge cases'],
     260000::bigint, 'create', 3.00, ARRAY['figma', 'design-systems'], 388, 372, 370),
    ('booking:1', 'booking', 1, 'Patient interviews and journey map',
     'Interview patients and reception staff, and map the booking journey from first symptom to follow-up.',
     'Research report and journey map', 'Interview synthesis and a journey map the whole clinic signed off.',
     ARRAY['Interview ten patients', 'Shadow two reception shifts'],
     240000::bigint, 'test', 2.00, ARRAY['ux-research', 'user-interviews'], 262, 250, 248),
    ('booking:2', 'booking', 2, 'App design in English and Arabic',
     'Design the booking app end to end in English and Arabic, right-to-left layouts included.',
     'Bilingual app design, ready to build', 'Complete app file in both languages, with accessibility notes.',
     ARRAY['Design the booking and reminder flows', 'Check every screen right to left'],
     420000::bigint, 'create', 4.00, ARRAY['ux', 'figma', 'a11y'], 246, 222, 219),
    ('system:1', 'system', 1, 'Token and component audit',
     'Audit colours, type and components across the shop and define the token set the library will use.',
     'Token set and audit report', 'Audit report and a token set that replaces sixty colours with fourteen.',
     ARRAY['Inventory colours, type and components', 'Define the token set'],
     300000::bigint, 'create', 2.50, ARRAY['design-systems', 'figma'], 112, 98, 97),
    ('system:2', 'system', 2, 'Component library and adoption guide',
     'Build the component library in Figma, document it and agree a rollout plan with engineering.',
     'Component library and adoption guide', 'Published library, adoption guide and a rollout plan.',
     ARRAY['Build and document the components', 'Agree the rollout with engineering'],
     280000::bigint, 'create', 3.00, ARRAY['design-systems', 'a11y'], 95, 62, 60)
) v (key, project, ord, name, brief, deliverable, handoff, tasks, price_cents, category, intensity,
     skills, funded_days, delivered_days, approved_days)
JOIN p7_project p ON p.key = v.project;

-- Every picture on the page, named by the seed image it reuses (bucket + `original_name`).
CREATE OR REPLACE TEMP VIEW p7_media AS
SELECT v.*, pg_temp.sid('p7:file:' || v.key) AS id
FROM (VALUES
    ('avatar', 'avatars', 'banner_5.jpg', 'Profile photo'),
    ('banner', 'avatars', 'banner_7.jpg', 'Profile banner'),
    ('logo-lumen', 'avatars', 'brandmark_6.jpg', 'Lumen Bank logo'),
    ('logo-halcyon', 'avatars', 'brandmark_7.png', 'Halcyon Motion logo'),
    ('slot-1', 'showcase', 'product_1.jpg', 'Showcase 1'),
    ('slot-2', 'showcase', 'service_3.webp', 'Showcase 2'),
    ('slot-3', 'showcase', 'service_2.jpg', 'Showcase 3'),
    ('slot-4', 'showcase', 'service_5.webp', 'Showcase 4'),
    ('slot-5', 'showcase', 'banner_8.webp', 'Showcase 5'),
    ('cover-1', 'showcase', 'product_5.webp', 'Beauty marketplace cover'),
    ('cover-2', 'showcase', 'product_3.jpg', 'Wellness subscription cover'),
    ('cover-3', 'showcase', 'service_1.jpg', 'Operations console cover'),
    ('cover-4', 'showcase', 'banner_4.jpg', 'Calm onboarding cover'),
    ('cover-5', 'showcase', 'banner_1.jpg', 'Night mode concept cover')
) v (key, bucket, image, label);

-- #endregion

-- #region Identity

-- The hero's verified badge reads KYC, and an escrow only ever paid a verified, payout-ready person.
SELECT pg_temp.ensure_verified();

UPDATE org.users_public u SET
    visibility = 'public',
    headline = CASE WHEN u.headline = ''
        THEN 'Product designer for checkouts, bookings and the other flows people have to finish'
        ELSE u.headline END,
    bio = CASE WHEN u.bio = '{}'::jsonb OR u.bio ->> 'text' = '' THEN jsonb_build_object('text',
$story$I design consumer products end to end, from the first interview to the component library engineers ship from. Most of my work sits where money or trust changes hands: checkout, subscriptions, bookings and onboarding.

Before going independent I designed mobile banking at Lumen Bank and shipped launch interfaces at Halcyon Motion. Those years taught me to write the decision down, test it with real people and leave a system behind rather than a folder of screens.

I work from Dubai in Gulf hours, with easy overlap across Europe and South Asia. Clients get a stage plan with one clear deliverable per stage, a working prototype early, and handoff notes a developer can build from without a meeting. English and Arabic interfaces are everyday work for me, right-to-left included.$story$)
        ELSE u.bio END,
    city = COALESCE(NULLIF(u.city, ''), 'Dubai'),
    country = COALESCE(NULLIF(u.country, ''), 'United Arab Emirates'),
    languages = CASE WHEN u.languages = '{}' THEN ARRAY['English', 'Arabic', 'Hindi'] ELSE u.languages END,
    interests = u.interests
        || ARRAY(SELECT i FROM unnest(ARRAY['find-work', 'sell-services']) i WHERE i <> ALL (u.interests))
WHERE u.user_id = pg_temp.me();

INSERT INTO org.user_languages (user_id, code, level)
SELECT pg_temp.me(), v.code, v.level
FROM (VALUES ('en', 'native'), ('ar', 'conversational'), ('hi', 'conversational')) v (code, level)
WHERE NOT EXISTS (SELECT 1 FROM org.user_languages ul WHERE ul.user_id = pg_temp.me())
ON CONFLICT (user_id, code) DO NOTHING;

-- Appended after what the owner already chose, so their first skill stays first.
UPDATE org.freelancer_profiles f SET
    skills = f.skills || ARRAY(
        SELECT s
        FROM unnest(ARRAY['ux', 'figma', 'design-systems', 'prototyping', 'ux-research',
                          'user-interviews', 'a11y']) WITH ORDINALITY AS t (s, ord)
        WHERE s <> ALL (f.skills)
        ORDER BY ord
    ),
    hire_intake = CASE WHEN f.hire_intake = '[]'::jsonb THEN
$intake$[
  {"id": "goal", "kind": "textarea", "label": "What should this work change for your customers?",
   "hint": "A sentence or two is plenty. We can go through the detail on a first call.",
   "placeholder": "Fewer abandoned checkouts, a booking flow people finish", "required": true,
   "maxLength": 800},
  {"id": "product_stage", "kind": "radio", "label": "Where is the product today?", "required": true,
   "options": [
     {"value": "idea", "label": "An idea or a brief"},
     {"value": "prototype", "label": "A prototype or early build"},
     {"value": "live", "label": "Live with real customers"}
   ]},
  {"id": "scope", "kind": "pills", "label": "What do you need?", "hint": "Pick as many as apply.",
   "required": true, "multiple": true,
   "options": [
     {"value": "research", "label": "Research"},
     {"value": "flows", "label": "Flows and prototypes"},
     {"value": "ui", "label": "Interface design"},
     {"value": "system", "label": "Design system"}
   ]},
  {"id": "arabic", "kind": "boolean", "label": "The product needs Arabic or right-to-left layouts"}
]$intake$::jsonb
        ELSE f.hire_intake END
WHERE f.user_id = pg_temp.me();

INSERT INTO org.user_skills (user_id, skill_id, proficiency)
SELECT pg_temp.me(), s.id, v.proficiency
FROM (VALUES ('ux', 5), ('figma', 5), ('design-systems', 4), ('prototyping', 4), ('ux-research', 4),
             ('user-interviews', 4), ('a11y', 3)) v (slug, proficiency)
JOIN org.skills s ON s.slug = v.slug
ON CONFLICT (user_id, skill_id) DO NOTHING;

INSERT INTO org.profile_links (id, profile_type, profile_id, kind, url)
SELECT pg_temp.sid('p7:link:' || v.kind), 'user', pg_temp.me(), v.kind,
       v.prefix || current_setting('snippet.username') || v.suffix
FROM (VALUES
    ('website', 'https://', '.example', 1),
    ('linkedin', 'https://linkedin.example/in/', '', 2),
    ('github', 'https://github.example/', '', 3),
    ('dribbble', 'https://dribbble.example/', '', 4)
) v (kind, prefix, suffix, ord)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.profile_settings (owner_type, owner_id, allow_avatar_expand, show_location, show_local_time)
VALUES ('user', pg_temp.me(), true, true, true)
ON CONFLICT (owner_type, owner_id) DO NOTHING;

-- #endregion

-- #region Media

-- `items_storage_object_unique` allows one row per bucket + path, and the seeded objects are all
-- taken, so these rows cannot name them directly. `<me>/../<seeded path>` is unique per target, keeps
-- the bytes where they are, and collapses to the seeded object in the URL the browser requests.
-- Purposes `avatar` and `showcase` keep them out of the file library, and make them the renditions
-- `org.set_profile_avatar` and `org.save_showcase` expect, so the editor keeps working on them.
INSERT INTO files.items (
    id, owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes,
    category, metadata, status, source, visibility, owner_type, purpose, created_at, updated_at
)
SELECT DISTINCT ON (m.key)
    m.id, pg_temp.me(), src.bucket_id, pg_temp.me() || '/../' || src.storage_path, m.label,
    src.original_name, src.mime_type, src.size_bytes, 'Image', src.metadata, 'uploaded', 'supabase',
    'public', 'user',
    CASE m.bucket WHEN 'showcase' THEN 'showcase' ELSE 'avatar' END::files.asset_purpose,
    pg_temp.p7_ago(300), pg_temp.p7_ago(300)
FROM p7_media m
JOIN files.items src
  ON src.bucket_id = m.bucket AND src.original_name = m.image AND src.storage_path NOT LIKE '%/../%'
ORDER BY m.key, src.storage_path
ON CONFLICT (id) DO NOTHING;

UPDATE org.users_public u SET
    avatar_file_id = COALESCE(u.avatar_file_id, pg_temp.sid('p7:file:avatar')),
    banner_file_id = COALESCE(u.banner_file_id, pg_temp.sid('p7:file:banner'))
WHERE u.user_id = pg_temp.me();

INSERT INTO org.profile_showcase_items (id, owner_type, owner_id, position, file_id, alt, created_by, created_at, updated_at)
SELECT pg_temp.sid('p7:showcase:' || v.position), 'user', pg_temp.me(), v.position,
       pg_temp.sid('p7:file:slot-' || v.position), v.alt, pg_temp.me(),
       pg_temp.p7_ago(300 - v.position), pg_temp.p7_ago(300 - v.position)
FROM (VALUES
    (1::smallint, 'Skincare bottles on a coral set, the lead image of a shop redesign'),
    (2::smallint, 'Blue cosmetics range on a plinth, from a product launch page'),
    (3::smallint, 'Lipstick on wet black stones, the hero of a campaign page'),
    (4::smallint, 'Studio set for a product gallery, with a photographer framing red heels'),
    (5::smallint, 'Illustrated pattern used across an app''s empty states')
) v (position, alt)
ON CONFLICT (owner_type, owner_id, position) DO NOTHING;

-- #endregion

-- #region Experience

INSERT INTO org.experience_entries (id, user_id, org_name, role, start_year, end_year, is_current, summary, logo_file_id, sort_order)
SELECT pg_temp.sid('p7:experience:' || v.ord), pg_temp.me(), v.org_name, v.role,
       pg_temp.p7_year(v.since), pg_temp.p7_year(v.until), v.until IS NULL, v.summary,
       (SELECT m.id FROM p7_media m WHERE m.key = v.logo), v.ord
FROM (VALUES
    (0, 'Independent', 'Product designer', 1, NULL::integer, NULL,
     'Stage-based design engagements for retail, health and fintech teams, from research to handoff.'),
    (1, 'Lumen Bank', 'Product designer, mobile banking', 2, 1, 'logo-lumen',
     'Designed the savings and payments journeys of the consumer app and contributed to its design system.'),
    (2, 'Halcyon Motion', 'Junior UI designer', 3, 2, 'logo-halcyon',
     'Interface and prototype work for hardware launch campaigns, alongside the motion team.')
) v (ord, org_name, role, since, until, logo, summary)
WHERE NOT EXISTS (SELECT 1 FROM org.experience_entries e WHERE e.user_id = pg_temp.me())
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.education_entries (id, user_id, school, credential, field, start_year, end_year, sort_order)
SELECT pg_temp.sid('p7:education:0'), pg_temp.me(), 'Gulf College of Art and Design', 'BDes',
       'Interaction Design', pg_temp.p7_year(5), pg_temp.p7_year(2), 0
WHERE NOT EXISTS (SELECT 1 FROM org.education_entries d WHERE d.user_id = pg_temp.me())
ON CONFLICT (id) DO NOTHING;

-- Platform verification is the platform's to give, so these carry a date. Expired stays visible.
INSERT INTO org.certifications (id, user_id, name, issuer, issued_year, expires_year, credential_url, verified, verified_at, sort_order, created_at)
SELECT pg_temp.sid('p7:certification:' || v.ord), pg_temp.me(), v.name, v.issuer,
       pg_temp.p7_year(v.issued), pg_temp.p7_year(v.expires), v.url,
       v.verified_days IS NOT NULL, pg_temp.p7_ago(v.verified_days), v.ord, pg_temp.p7_ago(330 - v.ord)
FROM (VALUES
    (0, 'UX Certification', 'Nielsen Norman Group', 1, NULL::integer,
     'https://www.nngroup.com/ux-certification/', 190),
    (1, 'Certified Professional in Accessibility Core Competencies', 'IAAP', 1, -2,
     'https://www.accessibilityassociation.org/certification', 75),
    (2, 'Google UX Design Certificate', 'Coursera', 3, NULL, NULL, NULL),
    (3, 'Certified ScrumMaster', 'Scrum Alliance', 4, 2, NULL, NULL)
) v (ord, name, issuer, issued, expires, url, verified_days)
WHERE NOT EXISTS (SELECT 1 FROM org.certifications c WHERE c.user_id = pg_temp.me())
ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Selected work

INSERT INTO org.portfolios (id, user_id, title, description, cover_file_id, client_name, category, sort_order, is_public, created_at)
SELECT pg_temp.sid('p7:portfolio:' || v.ord), pg_temp.me(), v.title, v.description,
       pg_temp.sid('p7:file:cover-' || v.ord), v.client, v.category, v.ord, v.is_public, pg_temp.p7_ago(v.days)
FROM (VALUES
    (1, 'A beauty marketplace people trust', 'Search, shade matching and returns rebuilt so buyers stop leaving to check reviews elsewhere.',
     NULL, 'Product design', true, 210),
    (2, 'Subscriptions without the small print', 'A wellness subscription flow where pausing is as easy as joining, which cut cancellations.',
     NULL, 'Product design', true, 170),
    (3, 'An operations console for a dispatch team', 'Dense live data organised around the three decisions a dispatcher makes every minute.',
     'Lantern Commerce', 'Dashboards', true, 140),
    (4, 'Calm onboarding for a sleep app', 'Illustration-led onboarding that asks four questions and gets out of the way.',
     NULL, 'Mobile', true, 100),
    (5, 'Night mode for a reading app', 'Concept work in progress on contrast and type at low light. Not ready to share.',
     NULL, 'Concept', false, 30)
) v (ord, title, description, client, category, is_public, days)
WHERE NOT EXISTS (SELECT 1 FROM org.portfolios p WHERE p.user_id = pg_temp.me())
ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Followers and following

INSERT INTO org.profile_follows (id, follower_user_id, target_entity_type, target_entity_id, created_at)
SELECT pg_temp.sid('p7:follower:' || v.handle), pg_temp.persona(v.handle), 'user', pg_temp.me(), pg_temp.p7_ago(v.days)
FROM (VALUES ('marisdelacroix', 300), ('juno', 260), ('noor', 240), ('hannahcole', 365), ('priyaraman', 350),
             ('miguelsantos', 215), ('renkoda', 180), ('inesduarte', 120), ('theo', 90), ('chloewinters', 40)
) v (handle, days)
ON CONFLICT (follower_user_id, target_entity_type, target_entity_id) DO NOTHING;

-- People, two teams and a business: `fn_resolve_profile` names which kind each handle is.
INSERT INTO org.profile_follows (id, follower_user_id, target_entity_type, target_entity_id, created_at)
SELECT pg_temp.sid('p7:following:' || v.handle), pg_temp.me(), r.owner_type, r.owner_id, pg_temp.p7_ago(v.days)
FROM (VALUES ('marisdelacroix', 420), ('juno', 390), ('saoirsebyrne', 310), ('inesduarte', 280),
              ('kwamemensah', 200), ('ateliernova', 260), ('northloop', 150), ('heliafinance', 95)
) v (handle, days)
CROSS JOIN LATERAL org.fn_resolve_profile(v.handle) r
ON CONFLICT (follower_user_id, target_entity_type, target_entity_id) DO NOTHING;

-- #endregion

-- #region Clients: two small businesses, their rosters and funded wallets

INSERT INTO org.business_profiles (
    id, owner_user_id, name, slug, legal_name, country, billing_email, plan, headline, bio, languages,
    timezone, default_currency, tax_id, address_city, status, kyb_status, kyb_verified_at,
    kyb_provider_ref, visibility, created_at
)
SELECT b.id, b.owner_id, b.name, b.slug, b.legal_name, b.country, 'billing@' || b.slug || '.example',
       'free', b.headline, jsonb_build_object('text', b.bio), ARRAY['English'], b.timezone, 'USD',
       'XXXX-XXXX', b.city, 'active', 'verified', pg_temp.p7_ago(b.created_days - 5),
       'acct_snippet_' || b.slug, 'public', pg_temp.p7_ago(b.created_days)
FROM p7_business b
ON CONFLICT (id) DO NOTHING;

SELECT org.fn_seed_preset_roles('business', b.id)
FROM p7_business b
WHERE NOT EXISTS (SELECT 1 FROM org.business_roles r WHERE r.business_id = b.id);

INSERT INTO org.business_members (id, business_id, user_id, role_id, role, status, invited_by, title, joined_at, created_at)
SELECT pg_temp.sid('p7:member:' || b.key || ':' || v.who), b.id, v.user_id, r.id, v.preset, 'active',
       v.invited_by, v.title, pg_temp.p7_ago(v.days), pg_temp.p7_ago(v.days)
FROM p7_business b
CROSS JOIN LATERAL (VALUES
    ('owner', b.owner_id, 'owner', NULL::uuid, 'Founder', b.created_days),
    ('member', b.member_id, 'member', b.owner_id, b.member_title, b.created_days - 10)
) v (who, user_id, preset, invited_by, title, days)
JOIN org.business_roles r ON r.business_id = b.id AND r.preset = v.preset
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.verification_cases (id, subject_type, subject_id, kind, status, tier, provider, provider_ref, submitted_at, decided_at)
SELECT pg_temp.sid('p7:kyb:' || b.key), 'business', b.id, 'kyb', 'verified', 3, 'stripe_identity',
       'acct_snippet_' || b.slug, pg_temp.p7_ago(b.created_days - 4), pg_temp.p7_ago(b.created_days - 5)
FROM p7_business b
ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Finished engagements: projects, stages, seats, tickets, deliveries

INSERT INTO projects.projects (
    id, client_business_id, owner_user_id, title, slug, description, description_text, format,
    structure_variation, status, visibility, publish_visibility, currency, budget_type,
    budget_amount_cents, timeline_preset, target_project_start_date, ip_ownership_mode, nda_required,
    portfolio_display_rights, location_restriction, language_requirement, allow_deadline_bonuses,
    handover_unlocked_at, created_at, updated_at, last_activity_at
)
SELECT p.id, p.business_id, p.owner_id, p.title, p.slug, jsonb_build_object('text', p.summary), p.summary,
       'pipeline', 'standard', 'completed', 'public', 'public', 'USD', 'fixed_price',
       (SELECT sum(s.price_cents) FROM p7_stage s WHERE s.project = p.key), 'sequential',
       pg_temp.p7_ago(p.created_days - 3), 'exclusive_transfer', false, 'allowed',
       ARRAY['Remote'], ARRAY['English'], false, pg_temp.p7_ago(p.finished_days),
       pg_temp.p7_ago(p.created_days), pg_temp.p7_ago(p.finished_days), pg_temp.p7_ago(p.finished_days)
FROM p7_project p
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_status_history (id, project_id, actor_user_id, from_status, to_status, reason, created_at)
SELECT pg_temp.sid('p7:status:' || p.key || ':' || v.to_status), p.id, p.owner_id,
       v.from_status::project_status, v.to_status::project_status, v.reason, pg_temp.p7_ago(v.days)
FROM p7_project p
CROSS JOIN LATERAL (VALUES
    (NULL, 'draft', 'Created', p.created_days),
    ('draft', 'active', 'Published', p.created_days - 1),
    ('active', 'completed', 'Every stage accepted and paid', p.finished_days)
) v (from_status, to_status, reason, days)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_required_skills (project_id, skill_id)
SELECT DISTINCT s.project_id, sk.id
FROM p7_stage s
CROSS JOIN LATERAL unnest(s.skills) AS wanted (skill)
JOIN org.skills sk ON sk.slug = wanted.skill
ON CONFLICT (project_id, skill_id) DO NOTHING;

-- BEFORE triggers count a stage or ticket ahead of any conflict clause, so these guard by absence.
INSERT INTO projects.project_stages (
    id, project_id, name, slug, description, description_text, sort_order, status, skills,
    unit_price_cents, milestone, completed_at, seat_limit, start_trigger_type, created_at
)
SELECT s.id, s.project_id, s.name, s.slug, jsonb_build_object('text', s.brief), s.brief, s.ord, 'paid',
       s.skills, s.price_cents, 'Accepted and paid', pg_temp.p7_ago(s.approved_days), 3,
       'on_project_start', pg_temp.p7_ago(p.created_days)
FROM p7_stage s
JOIN p7_project p ON p.key = s.project
WHERE NOT EXISTS (SELECT 1 FROM projects.project_stages x WHERE x.id = s.id);

INSERT INTO projects.stage_staffing_roles (id, project_stage_id, role_title, skills, created_at)
SELECT pg_temp.sid('p7:role:' || s.key), s.id, 'Product designer', s.skills, pg_temp.p7_ago(s.funded_days)
FROM p7_stage s
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, created_at)
SELECT pg_temp.sid('p7:participant:' || p.key || ':' || v.side), p.id, v.side::profile_type, v.who, v.role,
       pg_temp.p7_ago(v.days)
FROM p7_project p
CROSS JOIN LATERAL (VALUES
    ('business', p.business_id, 'client', p.created_days),
    ('freelancer', pg_temp.me(), 'assignee', p.created_days - 4)
) v (side, who, role, days)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_assignments (id, project_stage_id, assignee_type, freelancer_profile_id, assigned_by, is_client_managed, status, created_at)
SELECT pg_temp.sid('p7:assignment:' || s.key), s.id, 'freelancer', pg_temp.me(), s.owner_id, false, 'completed',
       pg_temp.p7_ago(s.funded_days)
FROM p7_stage s
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.tickets (
    id, project_id, current_stage_id, current_assignee_id, slug, owner_user_id, title, description,
    text_description, status, priority, required_stages, tasks, workload_intensity, payment_status,
    unit_price_cents, total_amount_paid, sort_order, claimed_at, created_at, updated_at
)
SELECT s.ticket_id, s.project_id, s.id, pg_temp.me(), s.ticket_slug, s.owner_id, s.deliverable,
       jsonb_build_object('text', s.brief), s.brief, 'completed', 'normal',
       jsonb_build_array(jsonb_build_object('stage_id', s.id, 'order', 0)),
       (SELECT jsonb_agg(jsonb_build_object(
                   'id', pg_temp.sid('p7:task:' || s.key || ':' || t.ord), 'text', t.task, 'done', true,
                   'completed_by', jsonb_build_array(pg_temp.me())
               ) ORDER BY t.ord)
          FROM unnest(s.tasks) WITH ORDINALITY AS t (task, ord)),
       s.intensity, 'released', s.price_cents, s.price_cents - s.price_cents * 500 / 10000, 0,
       pg_temp.p7_ago(s.funded_days), pg_temp.p7_ago(s.funded_days + 1), pg_temp.p7_ago(s.approved_days)
FROM p7_stage s
WHERE NOT EXISTS (SELECT 1 FROM projects.tickets x WHERE x.id = s.ticket_id);

INSERT INTO projects.ticket_history (id, ticket_id, actor_id, action_type, previous_stage_id, new_stage_id, previous_status, new_status, changes, created_at)
SELECT pg_temp.sid('p7:history:' || s.key || ':' || v.step), s.ticket_id, v.actor, v.action, v.from_stage, s.id,
       v.from_status::ticket_status, v.to_status::ticket_status, v.changes, pg_temp.p7_ago(v.days)
FROM p7_stage s
CROSS JOIN LATERAL (VALUES
    ('created', s.owner_id, 'created', NULL::uuid, NULL, 'backlog', jsonb_build_object('title', s.deliverable), s.funded_days + 1),
    ('claimed', pg_temp.me(), 'reassigned', s.id, 'todo', 'claimed', jsonb_build_object('assignee', pg_temp.me()), s.funded_days),
    ('completed', s.owner_id, 'status_changed', s.id, 'in_review', 'completed', '{}'::jsonb, s.approved_days)
) v (step, actor, action, from_stage, from_status, to_status, changes, days)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_submissions (
    id, project_stage_id, ticket_id, submitted_by, notes, title, status, description, checked_item_ids,
    number, reviewed_by, reviewed_at, created_at, updated_at
)
SELECT pg_temp.sid('p7:submission:' || s.key), s.id, s.ticket_id, pg_temp.me(), s.handoff, s.deliverable,
       'accepted', jsonb_build_object('text', s.handoff),
       (SELECT jsonb_agg(pg_temp.sid('p7:task:' || s.key || ':' || t.ord) ORDER BY t.ord)
          FROM unnest(s.tasks) WITH ORDINALITY AS t (task, ord)),
       1, s.owner_id, pg_temp.p7_ago(s.approved_days), pg_temp.p7_ago(s.delivered_days),
       pg_temp.p7_ago(s.approved_days)
FROM p7_stage s
ON CONFLICT (id) DO NOTHING;

-- #endregion

-- #region Money: the clients' ledgers and the escrows they released

-- The fee is 5% of each stage, truncated as `finance.fn_release_ticket_escrow` truncates it.
INSERT INTO finance.escrows (
    id, project_stage_id, ticket_id, payer_business_id, payee_type, payee_id, amount_cents,
    platform_fee_cents, currency, status, created_at, released_at
)
SELECT s.escrow_id, s.id, s.ticket_id, s.business_id, 'freelancer', pg_temp.me(), s.price_cents,
       s.price_cents * 500 / 10000, 'USD', 'released', pg_temp.p7_ago(s.funded_days),
       pg_temp.p7_ago(s.approved_days)
FROM p7_stage s
ON CONFLICT (id) DO NOTHING;

-- Both wallets are this script's own, written oldest first so `balance_after_cents` runs true. The
-- target's personal wallet is populate_07_wallet.sql's to write.
SELECT pg_temp.post('p7:topup:' || b.key, pg_temp.wallet('business', b.id), 'credit', b.deposit_cents, 'topup',
                    pg_temp.p7_ago(b.created_days), 'payment_methods')
FROM p7_business b;

SELECT pg_temp.post('p7:hold:' || s.key, pg_temp.wallet('business', s.business_id), 'debit', s.price_cents,
                    'escrow_hold', pg_temp.p7_ago(s.funded_days), 'escrows', s.escrow_id, 'locked')
FROM p7_stage s
ORDER BY s.funded_days DESC;

-- #endregion

-- #region Reviews, achievements, streaks and mastery

-- The rating trigger derives `rating_average` and `rating_count` from these rows.
INSERT INTO reviews.entity_reviews (id, target_entity_id, target_entity_type, reviewer_user_id, project_id, rating, title, comment, created_at, updated_at)
SELECT pg_temp.sid('p7:review:' || v.project || ':' || v.reviewer), pg_temp.me(), 'freelancer',
       pg_temp.persona(v.reviewer), pg_temp.sid('p7:project:' || v.project), v.rating, v.title, v.comment,
       pg_temp.p7_ago(v.days), pg_temp.p7_ago(v.days)
FROM (VALUES
    ('checkout', 'hannahcole', 5.00, 'Our checkout finally explains itself',
     'The funnel audit found the three steps that were costing us orders, and the redesign removed them. Every stage ended with something we could put in front of customers, and the handoff notes meant our developers never had to guess.', 366),
    ('checkout', 'priyaraman', 4.80, 'Clear thinking and a tidy handoff',
     'I sat in on the stage reviews as an advisor. The prototype answered most questions before they were asked, and decisions were written down with their reasons. The one gap was the returns flow, which needed a second pass after launch.', 362),
    ('booking', 'miguelsantos', 4.90, 'Patients book without calling us now',
     'The interviews changed what we thought we were building. The app went out in English and Arabic at the same time, the right-to-left screens were designed rather than mirrored, and phone bookings dropped within a month of launch.', 215),
    ('booking', 'danielokafor', 4.70, 'Strong work, a slightly long second stage',
     'The design quality was high and the research was properly done. The second stage ran about a week past the plan while we settled the insurance flow, but the delay was flagged early and nothing was dropped to make up the time.', 212),
    ('system', 'hannahcole', 5.00, 'We hired again and it was the right call',
     'We came back for the design system because the checkout work held up so well. The audit cut our colours from sixty to fourteen, and the adoption guide meant the team was shipping from the library within a fortnight.', 56),
    ('system', 'priyaraman', 4.90, 'A system the team actually uses',
     'Good systems work is mostly patience and this had plenty of it. Components match production, the documentation is short enough to be read, and the rollout plan respected what the engineers already had in flight.', 52)
) v (project, reviewer, rating, title, comment, days)
ON CONFLICT (id) DO NOTHING;

-- Each is true of the rows above: a payout, a five-star review, a client who came back, and more than
-- a year since the first delivery with no dispute.
SELECT org.fn_award_achievement('freelancer', pg_temp.me(), v.code, v.source)
FROM (VALUES
    ('first_payout', pg_temp.sid('p7:escrow:checkout:1')),
    ('first_five_star', pg_temp.sid('p7:review:checkout:hannahcole')),
    ('repeat_client', pg_temp.sid('p7:project:system')),
    ('dispute_free_year', NULL::uuid)
) v (code, source);

-- These two doors add on every call, so each runs once, for each delivery, in delivery order.
SELECT org.fn_touch_streak('freelancer', pg_temp.me(), k.kind::org.streak_kind, true)
FROM (SELECT s.approved_days FROM p7_stage s ORDER BY s.approved_days DESC) s
CROSS JOIN (VALUES ('on_time_delivery'), ('dispute_free')) k (kind)
WHERE NOT EXISTS (
    SELECT 1 FROM org.quality_streaks q
    WHERE q.subject_type = 'freelancer' AND q.subject_id = pg_temp.me()
);

SELECT org.fn_record_mastery('freelancer', pg_temp.me(), s.category::org.create_category, s.intensity, true)
FROM p7_stage s
WHERE NOT EXISTS (
    SELECT 1 FROM org.create_mastery m
    WHERE m.subject_type = 'freelancer' AND m.subject_id = pg_temp.me()
);

-- #endregion

-- #region Standing

/**
 * The target's row of `11_standing.sql`: the inputs counted from the delivery record, then the
 * platform's own recompute for the score, the rung and the trust signals. Unchanged inputs skip the
 * recompute, because each one appends a `org.standing_events` row.
 */
CREATE OR REPLACE FUNCTION pg_temp.p7_refresh_standing() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_changed integer;
BEGIN
    WITH held AS (
        SELECT tk.id AS ticket_id, tk.status::text AS status, tk.due_date, tk.updated_at, tk.workload_report_id
        FROM projects.tickets tk
        WHERE tk.current_assignee_id = pg_temp.me()
          AND tk.status::text IN ('claimed', 'in_progress', 'in_review', 'completed')
    ),
    delivered AS (
        SELECT h.ticket_id, h.due_date,
               COALESCE(
                   (SELECT max(ss.created_at) FROM projects.stage_submissions ss
                     WHERE ss.ticket_id = h.ticket_id AND ss.status = 'accepted'),
                   (SELECT max(th.created_at) FROM projects.ticket_history th
                     WHERE th.ticket_id = h.ticket_id AND th.new_status::text = 'completed'),
                   h.updated_at
               ) AS delivered_at
        FROM held h
        WHERE h.status = 'completed'
    ),
    record AS (
        SELECT
            GREATEST(0, now()::date - up.created_at::date)::integer AS tenure_days,
            COALESCE(fp.rating_average, 0)::numeric AS rating,
            (SELECT count(*) FROM projects.stage_assignments sa
              WHERE sa.status = 'completed' AND sa.freelancer_profile_id = up.user_id)::integer AS stages_completed,
            (SELECT count(*) FROM held)::numeric AS held_n,
            (SELECT count(*) FROM held h WHERE h.workload_report_id IS NOT NULL)::numeric AS reported_n,
            (SELECT count(*) FROM delivered)::numeric AS delivered_n,
            (SELECT count(*) FROM delivered d
              WHERE d.due_date IS NULL OR d.delivered_at <= d.due_date)::numeric AS on_time_n,
            (SELECT count(*) FROM finance.escrows e
              WHERE e.payee_type::text = 'freelancer' AND e.payee_id = up.user_id)::numeric AS escrows_n,
            (SELECT count(*) FROM finance.escrows e
              WHERE e.payee_type::text = 'freelancer' AND e.payee_id = up.user_id
                AND e.status = 'disputed')::numeric AS disputed_n,
            (SELECT COALESCE(sum(p.severity), 0) FROM security.penalties p
              WHERE p.subject_type = 'freelancer' AND p.subject_id = up.user_id
                AND p.status = 'active' AND (p.expires_at IS NULL OR p.expires_at > now()))::numeric AS penalty
        FROM org.users_public up
        JOIN org.freelancer_profiles fp ON fp.user_id = up.user_id
        WHERE up.user_id = pg_temp.me()
    )
    INSERT INTO org.entity_standing AS es (
        subject_type, subject_id, stages_completed, completion_rate, on_time_rate,
        client_rating_avg, peer_rating_avg, dispute_rate, workload_reliability, tenure_days, penalty_severity
    )
    SELECT
        'freelancer',
        pg_temp.me(),
        r.stages_completed,
        CASE WHEN r.delivered_n + r.reported_n > 0 THEN round(r.delivered_n / (r.delivered_n + r.reported_n), 4) ELSE 0 END,
        CASE WHEN r.delivered_n > 0 THEN round(r.on_time_n / r.delivered_n, 4) ELSE 0 END,
        LEAST(5, GREATEST(0, round(r.rating, 2))),
        0,
        CASE WHEN r.escrows_n > 0 THEN round(r.disputed_n / r.escrows_n, 4) ELSE 0 END,
        CASE WHEN r.held_n > 0 THEN round((r.held_n - r.reported_n) / r.held_n, 4) ELSE 0 END,
        r.tenure_days,
        r.penalty
    FROM record r
    ON CONFLICT (subject_type, subject_id) DO UPDATE SET
        stages_completed = EXCLUDED.stages_completed,
        completion_rate = EXCLUDED.completion_rate,
        on_time_rate = EXCLUDED.on_time_rate,
        client_rating_avg = EXCLUDED.client_rating_avg,
        peer_rating_avg = EXCLUDED.peer_rating_avg,
        dispute_rate = EXCLUDED.dispute_rate,
        workload_reliability = EXCLUDED.workload_reliability,
        tenure_days = EXCLUDED.tenure_days,
        penalty_severity = EXCLUDED.penalty_severity
    WHERE (es.stages_completed, es.completion_rate, es.on_time_rate, es.client_rating_avg, es.dispute_rate,
           es.workload_reliability, es.tenure_days, es.penalty_severity)
          IS DISTINCT FROM
          (EXCLUDED.stages_completed, EXCLUDED.completion_rate, EXCLUDED.on_time_rate, EXCLUDED.client_rating_avg,
           EXCLUDED.dispute_rate, EXCLUDED.workload_reliability, EXCLUDED.tenure_days, EXCLUDED.penalty_severity);

    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed > 0 THEN
        PERFORM org.fn_recompute_standing('freelancer', pg_temp.me());
    END IF;
END;
$$;

SELECT pg_temp.p7_refresh_standing();

-- #endregion

-- #region Summary

SELECT label AS "Populated for the profile", total AS "Count"
FROM (
    SELECT 1 AS ord, 'Languages' AS label, (SELECT count(*) FROM org.user_languages WHERE user_id = pg_temp.me()) AS total
    UNION ALL SELECT 2, 'Skills', (SELECT cardinality(skills) FROM org.freelancer_profiles WHERE user_id = pg_temp.me())
    UNION ALL SELECT 3, 'Links', (SELECT count(*) FROM org.profile_links WHERE profile_type = 'user' AND profile_id = pg_temp.me())
    UNION ALL SELECT 4, 'Hire form questions', (SELECT jsonb_array_length(hire_intake) FROM org.freelancer_profiles WHERE user_id = pg_temp.me())
    UNION ALL SELECT 5, 'Showcase slots', (SELECT count(*) FROM org.profile_showcase_items WHERE owner_type = 'user' AND owner_id = pg_temp.me())
    UNION ALL SELECT 6, 'Portfolio pieces', (SELECT count(*) FROM org.portfolios WHERE user_id = pg_temp.me())
    UNION ALL SELECT 7, 'Roles', (SELECT count(*) FROM org.experience_entries WHERE user_id = pg_temp.me())
    UNION ALL SELECT 8, 'Education entries', (SELECT count(*) FROM org.education_entries WHERE user_id = pg_temp.me())
    UNION ALL SELECT 9, 'Certifications', (SELECT count(*) FROM org.certifications WHERE user_id = pg_temp.me())
    UNION ALL SELECT 10, 'Followers', (SELECT count(*) FROM org.profile_follows WHERE target_entity_type = 'user' AND target_entity_id = pg_temp.me())
    UNION ALL SELECT 11, 'Following', (SELECT count(*) FROM org.profile_follows WHERE follower_user_id = pg_temp.me())
    UNION ALL SELECT 12, 'Completed stages', (SELECT stages_completed FROM org.entity_standing WHERE subject_type = 'freelancer' AND subject_id = pg_temp.me())
    UNION ALL SELECT 13, 'Reviews received', (SELECT rating_count FROM org.freelancer_profiles WHERE user_id = pg_temp.me())
    UNION ALL SELECT 14, 'Achievements', (SELECT count(*) FROM org.entity_achievements WHERE subject_type = 'freelancer' AND subject_id = pg_temp.me())
    UNION ALL SELECT 15, 'Standing rung: ' || (SELECT sl.label FROM org.entity_standing es JOIN org.standing_levels sl ON sl.level = es.level
                                               WHERE es.subject_type = 'freelancer' AND es.subject_id = pg_temp.me()),
                         (SELECT es.level FROM org.entity_standing es WHERE es.subject_type = 'freelancer' AND es.subject_id = pg_temp.me())
    UNION ALL SELECT 16, 'Trust signals earned', (SELECT cardinality(active_adornments) FROM org.entity_standing WHERE subject_type = 'freelancer' AND subject_id = pg_temp.me())
) s
ORDER BY ord;

-- #endregion

COMMIT;
