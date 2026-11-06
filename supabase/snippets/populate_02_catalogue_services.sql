-- =============================================================================================
-- populate_02_catalogue_services.sql — fills one freelancer's service catalogue.
--
-- WHAT IT POPULATES
--   Makes the target a freelancer, then writes 28 service listings and no products: all five delivery
--   models (Pipeline, One-Off, Direct Deliverable, Session, Group Session) in all four listing states
--   (published, draft, paused, archived), with stage templates priced per stage (one stage to seven),
--   intake questions of all nine kinds, deliverables, team roles, session terms, skills, tags, CREATE
--   categories, SEO text, collections, galleries, delivery windows, a paid placement, reviews by the
--   seed personas (ratings derived by the review trigger) and the buyer activity the seller console
--   reads: card-paid orders, quote requests, service inquiries, discovery calls and daily analytics.
--
-- WHICH PAGES SHOW IT
--   /catalogue            every status tab and filter, the Analytics and Clients views
--   /catalogue/[svc-…]    Edit, Preview, Analytics and Clients for each listing
--   /explore, /view/[svc-…], /[handle]   the 13 published services only. Explore reads through a cache
--                         with a five-minute TTL, so they can take that long to appear.
--
-- HOW TO RUN
--   Studio (localhost:54323): open this file in the SQL editor and press Run. The result pane shows
--   one summary table. Or:
--     docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/snippets/populate_02_catalogue_services.sql
--   Running it twice is a clean no-op. It stands alone: no other populate_* snippet is needed.
--
-- HOW TO CHANGE THE ACCOUNT
--   Edit the one username in the `set_config('snippet.username', …)` line below.
--
-- WHAT TO KNOW
--   * Publishing needs only an adult seller with a freelancer profile, but a buyer can hire only a
--     payout-ready freelancer, so this also verifies the account (KYC tier 2 and a payout account).
--     `visibility` stays as it is: an `unlisted` seller's published services still appear in Explore,
--     because only the profile card is hidden. A `private` seller's do not.
--   * SQL cannot upload images, and `files.items` allows one row per storage object, so the galleries
--     reference seeded public images owned by the personas. They render everywhere, but the showcase
--     door (`catalogue.apply_listing_media`) accepts only the seller's own files, so saving or
--     reordering one of these galleries is refused until every slot holds the seller's own upload.
--   * The orders are card-paid and this snippet does not touch the target's personal wallet.
--     populate_07_wallet.sql owns that ledger and credits their net proceeds when it runs.
--   * The schema has no pricing tiers, add-ons or hourly rates, and `recurring_retainer` is never
--     written or read by the app, so none appear. Buffers are per schedule, not per listing, so they
--     live once on `scheduling.call_settings`.
--   * The Clients view fills its four lanes from orders, quotes, inquiries and calls. Its session
--     booking and pipeline project arms stay empty: those need a project instantiated from a blueprint.
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

-- #region Owner
SELECT pg_temp.ensure_freelancer();
-- Publishing needs no more than that, but a buyer can hire only a payout-ready freelancer
-- (finance.fn_assert_payout_ready), and these listings have sold.
SELECT pg_temp.ensure_verified();
-- #endregion

-- #region The listings, as data
-- One JSON document per listing; every statement below reads this one function. Money is integer
-- minor units. `age`, `listed`, `ended` and `edited` are days ago: created, first published, paused or
-- archived, last edited. `images` are positions in pg_temp.c2_image's list, cover first. A Pipeline's
-- `ticket` is the mean of its stage prices and `amount` a whole number of tickets; a One-Off's stage
-- prices add up to `amount`; a Session's `amount` is `session` × `count`.
CREATE OR REPLACE FUNCTION pg_temp.c2_services()
RETURNS TABLE (
    key text, state text, model text, title text, about jsonb, category text, "create" text,
    delivery text, amount bigint, ticket bigint, session bigint, seats integer, free integer,
    extra bigint, turnaround integer, minutes integer, sittings integer, provider text,
    continuous boolean, enrolment integer, preset text, promoted boolean, age integer, listed integer,
    ended integer, edited integer, images jsonb, skills jsonb, tags jsonb, collections jsonb,
    seo_title text, seo_desc text, stages jsonb, roles jsonb, deliverables jsonb, intake jsonb,
    reviews jsonb, orders jsonb
)
LANGUAGE sql
IMMUTABLE
AS $f$
SELECT r.* FROM jsonb_to_recordset($json$[

{"key":"end-to-end","state":"published","model":"pipeline","create":"create","category":"product",
 "title":"End-to-end product design, from brief to build",
 "about":["Seven priced stages that take a product from a fuzzy brief to engineering-ready design: framing the problem, talking to real users, shaping flows, prototyping, testing, polishing the UI and seeing it through launch.",
          "Every stage ends with something you can sign off and is escrowed on its own, so you can pause between stages without losing the work."],
 "delivery":"8-week delivery","amount":1080000,"ticket":45000,"free":2,"extra":15000,
 "age":470,"listed":462,"edited":6,"promoted":true,"images":[7,1,6,12,13,15],
 "skills":["ux","ux-research","prototyping","figma","design-systems"],
 "tags":["product design","mvp design","saas","design partner"],
 "collections":["For founders"],
 "seo_title":"End-to-end product design for early-stage teams",
 "seo_desc":"A staged product design engagement: research, flows, prototype, testing, UI and handoff, each stage priced and held in escrow.",
 "stages":[
  {"name":"Discovery and framing","description":"A working session with your team to agree the problem, the audience and what success looks like, followed by a written brief everyone signs.","deliverables":["Signed-off product brief","Success metrics and risks","A stage-by-stage delivery plan"],"turnaround":"~4 days","priceCents":42000,"skills":["UX","Product strategy"],"startTrigger":"on_project_start"},
  {"name":"Research synthesis","description":"Five to eight user interviews plus a review of your analytics and support tickets, condensed into the few findings that should change the design.","deliverables":["Interview notes and clips","Findings summary","Prioritised opportunity map"],"turnaround":"~1 week","priceCents":38000,"skills":["UX research","User interviews"]},
  {"name":"Flows and information architecture","description":"The structure of the product before any polish: the key journeys, the navigation model and the states people will actually hit.","deliverables":["Annotated user flows","Navigation model","Empty, error and edge states list"],"turnaround":"~1 week","priceCents":42000,"skills":["UX","Figma"],"startTrigger":"fixed_offset","lagDays":2},
  {"name":"Interactive prototype","description":"A clickable prototype of the core journeys, realistic enough to put in front of a customer.","deliverables":["Clickable Figma prototype","Walkthrough recording"],"turnaround":"~1 week","priceCents":50000,"skills":["Prototyping","Figma"]},
  {"name":"Usability testing","description":"Moderated sessions with people who match your audience, then a short list of changes ranked by how often they tripped someone up. Recruiting takes a few days, so this stage starts after a gap and waits for your sign-off before moving on.","deliverables":["Five moderated test sessions","Severity-ranked issue list","Revised prototype"],"turnaround":"~1 week","priceCents":43000,"skills":["UX research","User interviews"],"startTrigger":"fixed_offset","lagDays":3,"chainReaction":false},
  {"name":"High-fidelity UI and components","description":"The final interface, built on a small token-driven component set so engineering is not left guessing at spacing or states.","deliverables":["Final UI for every agreed screen","Token and component library","Responsive and dark-mode variants"],"turnaround":"~2 weeks","priceCents":60000,"skills":["Figma","Design systems","Accessibility"]},
  {"name":"Handoff and launch support","description":"A paired review with your engineers, a build QA pass against the designs and two weeks of questions answered during launch.","deliverables":["Annotated handoff file","Build QA report","Two weeks of launch support"],"turnaround":"~1 week","priceCents":40000,"skills":["Design systems","TypeScript"]}],
 "roles":[
  {"name":"Lead product designer","summary":"Runs the engagement and owns the design decisions from brief to launch.","skills":["UX","Figma"],"count":1},
  {"name":"UX researcher","summary":"Recruits participants and runs the interviews and usability tests.","skills":["UX research","User interviews"],"count":1},
  {"name":"Design engineer","summary":"Pairs with your team on tokens, components and build QA.","skills":["TypeScript","Preact"],"count":1}],
 "deliverables":["Signed-off product brief and success metrics","Research findings and an opportunity map","Clickable, tested prototype","Final UI with a token-driven component library","Annotated engineering handoff and build QA report"],
 "intake":[
  {"id":"product_url","kind":"text","label":"A link to your product or prototype","required":false,"placeholder":"https://…","maxLength":300},
  {"id":"goal","kind":"textarea","label":"What should be true when this is finished?","hint":"One or two sentences is plenty.","required":true,"maxLength":800},
  {"id":"screens","kind":"number","label":"Roughly how many screens are in scope?","hint":"A rough count is fine.","required":false,"min":5,"max":120,"step":5,"unit":"screens","slider":true},
  {"id":"deadline","kind":"select","label":"When do you need to launch?","required":true,"options":[{"value":"8w","label":"Within eight weeks"},{"value":"q","label":"This quarter"},{"value":"next","label":"Next quarter"},{"value":"flex","label":"Flexible"}]},
  {"id":"stage","kind":"radio","label":"Where is the product today?","required":true,"options":[{"value":"idea","label":"Idea","hint":"Nothing built yet."},{"value":"mvp","label":"MVP","hint":"Live with early users."},{"value":"scale","label":"Scaling","hint":"Paying customers and a roadmap."}]},
  {"id":"platforms","kind":"pills","label":"Which platforms?","required":false,"multiple":true,"maxSelections":3,"options":[{"value":"web","label":"Web"},{"value":"ios","label":"iOS"},{"value":"android","label":"Android"}]},
  {"id":"have","kind":"checkboxes","label":"What do you already have?","required":false,"options":[{"value":"research","label":"User research"},{"value":"brand","label":"Brand guidelines"},{"value":"system","label":"A design system"},{"value":"analytics","label":"Product analytics"}]},
  {"id":"team","kind":"multiselect","label":"Who will work with us?","required":false,"maxSelections":3,"options":[{"value":"founder","label":"A founder"},{"value":"pm","label":"A product manager"},{"value":"eng","label":"Engineers"},{"value":"marketing","label":"Marketing"}]},
  {"id":"nda","kind":"boolean","label":"Do you need an NDA before we start?","required":false}],
 "reviews":[
  {"who":"priyaraman","rating":5,"title":"The most organised design engagement we have run","body":"Every stage ended with something my board could read, and the research findings changed our roadmap before a single screen was drawn. The escrow per stage meant we could stop and think without losing momentum.","days":12},
  {"who":"theo","rating":5,"title":"Took a napkin sketch to a launch-ready product","body":"We arrived with a rough idea for a subscription flow and left with a tested prototype and a component library our developer could build from in a fortnight. Clear, calm and honest about what to cut.","days":34},
  {"who":"danielokafor","rating":4.8,"title":"Research that actually moved the design","body":"The usability sessions caught two problems we would have shipped. One stage ran a few days long while we chased recruits, but it was flagged early and the extra time was worth it for the findings.","days":58},
  {"who":"noor","rating":5,"title":"A designer who thinks like a product owner","body":"Rare to work with someone who pushes back on the brief for the right reasons. The flows stage saved us from building two features nobody asked for, and the final UI is the best work on our site.","days":81},
  {"who":"hannahcole","rating":4.6,"title":"Rigorous, and the documentation is excellent","body":"Helia's compliance review is not gentle and the handoff file survived it with barely a comment. I would have liked a little more time on the empty states, but the stage plan was honest about the trade-off.","days":109},
  {"who":"miguelsantos","rating":5,"title":"Engineers loved the handoff","body":"Our mobile team said it was the first design file they did not need a meeting to understand. Tokens matched the code, states were all there, and build QA caught every drift before release.","days":146},
  {"who":"kwamemensah","rating":4.9,"title":"Fits neatly beside a delivery team","body":"We brought this in alongside North Loop's engineers. The design engineer role paired with us properly and the stage reviews slotted straight into our sprint rhythm without any extra ceremony.","days":188},
  {"who":"marisdelacroix","rating":4.5,"title":"Solid craft, strong process","body":"I hired this as a second pair of hands on a client job and got a thorough, well-reasoned set of flows. The visual polish took one extra round, and the extra round was handled without any fuss at all.","days":240},
  {"who":"saoirsebyrne","rating":5,"title":"Exactly the structure a small studio needs","body":"Having each stage priced and signed off separately let us bring a client along without a giant upfront commitment. They felt in control the entire way through and came back for a second project.","days":305},
  {"who":"tomaszwojcik","rating":4.2,"title":"Good outcome, tight on research time","body":"The final product is a real step up for us. Our only note is that the research stage felt compressed for a two-sided marketplace, so budget for an extra round of interviews if you have more than one audience.","days":372}],
 "orders":[{"who":"priyaraman","days":4},{"who":"danielokafor","days":23},{"who":"theo","days":49},{"who":"noor","days":76},{"who":"hannahcole","days":118},{"who":"miguelsantos","days":160},{"who":"saoirsebyrne","days":318},{"who":"tomaszwojcik","days":386}]},

{"key":"system-health-check","state":"published","model":"pipeline","create":"test","category":"product",
 "title":"Design system health check",
 "about":["A single, focused stage that tells you how healthy your design system really is: where the library and the code have drifted, which components nobody uses, and what to fix first."],
 "delivery":"5-day delivery","amount":120000,"ticket":120000,"free":1,"extra":9000,
 "age":260,"listed":255,"edited":21,"images":[2,9],
 "skills":["design-systems","figma","a11y"],"tags":["design system audit","figma library","tokens"],"collections":["Start here"],
 "seo_title":"Design system audit in five days",
 "stages":[
  {"name":"System audit and scorecard","description":"A component-by-component review of your library against production, with accessibility checks and a scorecard your team can re-run every quarter.","deliverables":["Scorecard across coverage, adoption and accessibility","Drift report between Figma and code","A ranked fix list"],"turnaround":"~5 days","priceCents":120000,"skills":["Design systems","Accessibility"],"startTrigger":"on_project_start"}],
 "roles":[],
 "deliverables":["Scored audit of your library","Figma-to-code drift report","Ranked fix list","45-minute readout with your team"],
 "intake":[
  {"id":"library","kind":"text","label":"A link to your Figma library","required":true,"placeholder":"https://figma.com/…","maxLength":300},
  {"id":"stack","kind":"select","label":"What is your front-end built with?","required":true,"options":[{"value":"react","label":"React"},{"value":"preact","label":"Preact"},{"value":"vue","label":"Vue"},{"value":"other","label":"Something else"}]},
  {"id":"components","kind":"number","label":"How many components are in the library?","required":false,"min":10,"max":400,"step":10,"unit":"components","slider":true}],
 "reviews":[
  {"who":"hannahcole","rating":5,"title":"A clear list instead of a vague worry","body":"We knew our library had drifted but not by how much. The scorecard gave us numbers to take to engineering, and the ranked fix list became our next two sprints almost without editing a single line.","days":40},
  {"who":"juno","rating":4.7,"title":"Useful from the front-end side too","body":"As the engineer on the receiving end I expected a lecture. Instead I got a drift report that matched what I see in the code every day, with practical fixes and very little theory about it.","days":96},
  {"who":"lenamueller","rating":4.8,"title":"Accessibility findings were the real value","body":"The contrast and focus-order checks turned up issues across our core components that we had not spotted in a year. It was five days of work that paid for itself on the first release we shipped.","days":171}],
 "orders":[{"who":"hannahcole","days":46},{"who":"juno","days":104},{"who":"lenamueller","days":178}]},

{"key":"onboarding-activation","state":"published","model":"pipeline","create":"create","category":"product",
 "title":"Onboarding and activation redesign",
 "about":["Four stages aimed at one number: how many new sign-ups reach their first moment of value. We find where people drop, redesign the path, test it and hand over a rollout plan."],
 "delivery":"4-week delivery","amount":456000,"ticket":38000,"free":2,"extra":12000,
 "age":330,"listed":322,"edited":15,"images":[8,3,10],
 "skills":["ux","ux-research","ux-writing","prototyping"],"tags":["onboarding","activation","saas growth"],"collections":["For founders"],
 "stages":[
  {"name":"Funnel audit","description":"Your sign-up and first-run funnel, step by step, with drop-off data and session recordings.","deliverables":["Annotated funnel map","Top five drop-off causes"],"turnaround":"~4 days","priceCents":30000,"skills":["UX research"],"startTrigger":"on_project_start"},
  {"name":"Journey redesign","description":"A redesigned first-run path, including the words on every step, built around the single action that predicts retention.","deliverables":["New onboarding flows","Rewritten microcopy"],"turnaround":"~1 week","priceCents":42000,"skills":["UX","UX writing"]},
  {"name":"Prototype and test","description":"Clickable prototype tested with five people who have never seen the product.","deliverables":["Tested prototype","Findings and changes"],"turnaround":"~1 week","priceCents":40000,"skills":["Prototyping","User interviews"]},
  {"name":"Rollout plan","description":"How to ship it safely: experiment design, the metrics to watch and what to do if they move the wrong way.","deliverables":["Experiment plan","Metrics dashboard brief"],"turnaround":"~3 days","priceCents":40000,"skills":["UX"]}],
 "roles":[{"name":"Product designer","summary":"Owns the redesign end to end.","skills":["UX","Figma"],"count":1},{"name":"UX writer","summary":"Writes every word on the path.","skills":["UX writing"],"count":1}],
 "deliverables":["Funnel audit with drop-off causes","Redesigned onboarding flows and microcopy","Tested prototype","Rollout and experiment plan"],
 "intake":[
  {"id":"activation","kind":"textarea","label":"What does an activated user do?","required":true,"maxLength":500},
  {"id":"signups","kind":"number","label":"New sign-ups a month","required":false,"min":0,"max":100000,"step":100,"unit":"sign-ups"},
  {"id":"tools","kind":"checkboxes","label":"Which tools do you already use?","required":false,"options":[{"value":"amplitude","label":"Amplitude"},{"value":"mixpanel","label":"Mixpanel"},{"value":"hotjar","label":"Hotjar"},{"value":"none","label":"None yet"}]}],
 "reviews":[
  {"who":"theo","rating":5,"title":"Trial-to-paid went up within a month","body":"We had been guessing about onboarding for a year. The funnel audit pointed at one confusing step, the redesign removed it, and paid conversion climbed within the first month of shipping the change.","days":52},
  {"who":"miguelsantos","rating":4.8,"title":"Practical, measurable and quick","body":"The rollout plan was the surprise. Instead of a big reveal we got a clean experiment with a clear decision rule, and the words on each step did as much work as the redesigned screens did.","days":133},
  {"who":"chloewinters","rating":4.6,"title":"Learned a lot watching the process","body":"I sat in on the sessions as a junior on the client side and picked up more than I had in months. The microcopy pass alone made our first-run feel like a different product.","days":214},
  {"who":"aikotanaka","rating":4.9,"title":"Words and screens designed together","body":"So many redesigns treat copy as an afterthought. Here the writer and designer worked on the same frames from day one, and it shows: the path reads like one voice from start to finish.","days":287}],
 "orders":[{"who":"theo","days":61},{"who":"miguelsantos","days":141},{"who":"aikotanaka","days":296}]},

{"key":"ux-audit","state":"published","model":"one_off","create":"test","category":"product",
 "title":"UX audit with a prioritised fix list",
 "about":["A week-long, expert review of your product against real usage data. You get a walkthrough of every issue, a fix list ranked by impact and effort, and a readout call for your team."],
 "delivery":"7-day delivery","amount":180000,"free":1,"extra":15000,"turnaround":7,
 "age":420,"listed":414,"edited":28,"images":[12,4,5],
 "skills":["ux","a11y","ux-research"],"tags":["ux audit","heuristic review","conversion"],"collections":["Start here"],
 "seo_title":"UX audit with a ranked fix list",
 "seo_desc":"A seven-day expert review of your product, with every issue ranked by impact and effort and a readout call for your team.",
 "stages":[
  {"name":"Heuristic walkthrough","description":"Every core journey reviewed screen by screen against usability and accessibility heuristics.","deliverables":["Annotated walkthrough of each journey"],"turnaround":"~3 days","priceCents":60000,"skills":["UX","Accessibility"],"startTrigger":"on_project_start"},
  {"name":"Data and support review","description":"Analytics, session recordings and support tickets checked against what the walkthrough found.","deliverables":["Evidence log behind each finding"],"turnaround":"~2 days","priceCents":50000,"skills":["UX research"],"startTrigger":"on_project_start"},
  {"name":"Fix list and readout","description":"Everything ranked by impact and effort, then a 60-minute readout with your team.","deliverables":["Ranked fix list","Readout call and recording"],"turnaround":"~2 days","priceCents":70000,"skills":["UX"]}],
 "roles":[],
 "deliverables":["Annotated walkthrough of every core journey","Evidence log from analytics and support tickets","Fix list ranked by impact and effort","60-minute readout call with your team"],
 "intake":[
  {"id":"journeys","kind":"multiselect","label":"Which journeys matter most?","required":true,"maxSelections":3,"options":[{"value":"signup","label":"Sign-up"},{"value":"onboarding","label":"Onboarding"},{"value":"checkout","label":"Checkout"},{"value":"settings","label":"Account and settings"}]},
  {"id":"access","kind":"boolean","label":"Can you share analytics access?","hint":"Read-only is all that is needed.","required":false}],
 "reviews":[
  {"who":"noor","rating":5,"title":"Worth every dirham","body":"Clear, ruthlessly prioritised and free of jargon. Our team fixed the top three items in a week and the support queue noticeably dropped. I have paid more for far less useful reports.","days":25},
  {"who":"danielokafor","rating":4.9,"title":"Evidence behind every finding","body":"What sets this apart is the evidence log. Nothing was opinion: each issue pointed at a recording, a ticket or a metric, which made it easy to get engineering time for the fixes.","days":90},
  {"who":"renkoda","rating":4.4,"title":"Sharp eye for detail","body":"Found problems in my portfolio site I had stopped seeing. A couple of recommendations did not fit my audience, but the reasoning was laid out plainly so it was easy to decide which ones to skip.","days":160},
  {"who":"inesduarte","rating":5,"title":"We now send clients here first","body":"Atelier Nova used this before a rebrand and the findings shaped our whole brief. It is a very efficient way to find out what is actually broken before anyone spends money on fixing it.","days":245},
  {"who":"samuelnkemelu","rating":4.7,"title":"Fast and well organised","body":"Seven days as promised, and the readout was the most useful hour of our quarter. The ranked list mapped straight into our backlog and we are still working through the lower priorities.","days":352}],
 "orders":[{"who":"noor","days":31},{"who":"danielokafor","days":98},{"who":"renkoda","days":168},{"who":"inesduarte","days":252},{"who":"samuelnkemelu","days":360},{"who":"juno","days":2}]},

{"key":"landing-page-sprint","state":"published","model":"one_off","create":"create","category":"web",
 "title":"Product landing page design in five days",
 "about":["One conversion-focused landing page for a product launch: structure, copy polish and a responsive Figma file your developer can build from directly."],
 "delivery":"5-day delivery","amount":140000,"free":2,"extra":18000,"turnaround":5,
 "age":12,"listed":9,"edited":2,"images":[5,14],
 "skills":["ux","figma","copywriting"],"tags":["landing page","launch","conversion"],"collections":["For founders"],
 "stages":[],"roles":[],
 "deliverables":["Responsive landing page design for desktop and mobile","Polished headline and section copy","Developer-ready Figma file"],
 "intake":[
  {"id":"sections","kind":"pills","label":"Which sections do you need?","required":false,"multiple":true,"options":[{"value":"hero","label":"Hero"},{"value":"features","label":"Features"},{"value":"pricing","label":"Pricing"},{"value":"faq","label":"FAQ"},{"value":"testimonials","label":"Testimonials"}]},
  {"id":"reference","kind":"text","label":"A page you admire","required":false,"placeholder":"https://…","maxLength":300},
  {"id":"launch","kind":"select","label":"When do you launch?","required":true,"options":[{"value":"2w","label":"Within two weeks"},{"value":"1m","label":"Within a month"},{"value":"flex","label":"Flexible"}]}],
 "reviews":[],"orders":[]},

{"key":"checkout-redesign","state":"published","model":"direct_deliverable","create":"create","category":"product",
 "title":"Checkout and payments flow redesign",
 "about":["A complete, self-contained redesign of your checkout, delivered by a named three-person crew. One fixed scope, one payment, one handover.","Built around trust and clarity: fewer steps, plainer language about fees, and error states that tell people what to do next."],
 "delivery":"3-week delivery","amount":420000,"free":3,"extra":6000,"turnaround":21,
 "age":300,"listed":291,"edited":11,"images":[3,11,6,1],
 "skills":["ux","ux-writing","prototyping","figma"],"tags":["checkout","payments ux","fintech","ecommerce"],
 "stages":[],
 "roles":[
  {"name":"Lead product designer","summary":"Owns the direction and signs off the final deliverable.","skills":["UX","Figma"],"count":1},
  {"name":"Payments UX writer","summary":"Writes fee, error and confirmation language buyers can trust.","skills":["UX writing"],"count":1},
  {"name":"Prototyper","summary":"Builds the realistic prototype that goes in front of real buyers.","skills":["Prototyping"],"count":1}],
 "deliverables":["Redesigned checkout for web and mobile","Fee, error and confirmation copy","Tested prototype with five buyers","Handoff file with every state covered"],
 "intake":[
  {"id":"methods","kind":"checkboxes","label":"Which payment methods do you take?","required":true,"options":[{"value":"cards","label":"Cards"},{"value":"wallets","label":"Apple Pay and Google Pay"},{"value":"bank","label":"Bank transfer"},{"value":"bnpl","label":"Pay later"}]},
  {"id":"steps","kind":"number","label":"Steps in your current checkout","required":false,"min":1,"max":12,"step":1,"unit":"steps","slider":true},
  {"id":"regulated","kind":"boolean","label":"Is your product regulated?","required":false}],
 "reviews":[
  {"who":"priyaraman","rating":5,"title":"Clearer fees, fewer support tickets","body":"The team rewrote every line about fees and escrow, and our support volume on payments dropped within weeks. Having one fixed scope and one handover made procurement simple on our side as well.","days":70},
  {"who":"theo","rating":4.8,"title":"Completion rate went up straight away","body":"We cut a step, explained shipping earlier and fixed the error messages. Nothing flashy, just careful work, and the numbers moved in the first week after we shipped the new flow.","days":155},
  {"who":"kwamemensah","rating":4.7,"title":"A crew that actually works as one","body":"I was sceptical about a named crew, but the designer, writer and prototyper really did work together. The handoff had every state in it, and our engineers had no questions left to ask.","days":232}],
 "orders":[{"who":"priyaraman","days":83},{"who":"theo","days":166},{"who":"kwamemensah","days":240}]},

{"key":"library-cleanup","state":"published","model":"direct_deliverable","create":"run","category":"product",
 "title":"Figma library cleanup and handover",
 "about":["Your Figma library, tidied and named properly: duplicates merged, variants rebuilt, styles mapped to tokens, and a short guide so it stays that way."],
 "delivery":"6-day delivery","amount":95000,"turnaround":6,
 "age":150,"listed":146,"edited":33,"images":[9,2],
 "skills":["figma","design-systems","notion"],"tags":["figma cleanup","design ops"],"collections":["For design teams"],
 "stages":[],
 "roles":[
  {"name":"Design ops lead","summary":"Plans the cleanup and agrees naming with your team.","skills":["Design systems"],"count":1},
  {"name":"Component librarian","summary":"Merges duplicates and rebuilds variants, working in pairs across your files.","skills":["Figma"],"count":2}],
 "deliverables":["Cleaned library with duplicates merged","Variants rebuilt with properties","Styles mapped to tokens","Two-page maintenance guide"],
 "intake":[
  {"id":"files","kind":"number","label":"How many Figma files are in scope?","required":true,"min":1,"max":40,"step":1,"unit":"files"},
  {"id":"plan","kind":"radio","label":"Which Figma plan are you on?","required":true,"options":[{"value":"professional","label":"Professional"},{"value":"organization","label":"Organization"},{"value":"enterprise","label":"Enterprise"}]}],
 "reviews":[
  {"who":"lenamueller","rating":4.9,"title":"Finally a library people trust","body":"Our designers had stopped using the shared library because nothing was named consistently. A week later it was the first place everyone looked, and the short guide has kept it that way since.","days":60},
  {"who":"aikotanaka","rating":4.5,"title":"Neat, careful, thorough","body":"Very tidy work and good communication throughout. We had more legacy files than we had estimated, which pushed delivery back a day, but that was flagged early and handled without any drama.","days":122}],
 "orders":[{"who":"lenamueller","days":67},{"who":"aikotanaka","days":130}]},

{"key":"critique-30","state":"published","model":"session","create":"advise","category":"product",
 "title":"Thirty-minute design critique",
 "about":["Bring one screen, flow or prototype and get an honest, specific critique from a working product designer. You leave with three things to change and why."],
 "delivery":"30-minute session","amount":6000,"session":6000,"minutes":30,"sittings":1,"provider":"google","preset":"mornings",
 "age":500,"listed":494,"edited":44,"images":[13,8],
 "skills":["ux","mentoring","figma"],"tags":["design critique","feedback","office hours"],"collections":["Start here"],
 "seo_title":"Book a 30-minute product design critique",
 "stages":[],"roles":[],
 "deliverables":["30-minute live critique","Three prioritised changes in writing","Recording on request"],
 "intake":[
  {"id":"work","kind":"text","label":"A link to what you want reviewed","required":true,"placeholder":"https://…","maxLength":300},
  {"id":"focus","kind":"radio","label":"What should the critique focus on?","required":true,"options":[{"value":"usability","label":"Usability"},{"value":"visual","label":"Visual design"},{"value":"copy","label":"Words and clarity"}]},
  {"id":"record","kind":"boolean","label":"Record the session for me","hint":"You get the recording afterwards; it is never shared.","required":false}],
 "reviews":[
  {"who":"chloewinters","rating":5,"title":"The kindest brutal feedback I have had","body":"I brought a flow I was nervous about and left with three clear changes and the reasons for them. Thirty minutes went quickly, and the follow-up note was specific enough to act on the same evening.","days":10},
  {"who":"juno","rating":4.8,"title":"Great value for half an hour","body":"Booked this to sense-check a dashboard before a client review. Quick, direct and focused on the things that mattered most, without trying to redesign the whole product in the time we had.","days":37},
  {"who":"tomaszwojcik","rating":5,"title":"Better than a week of going in circles","body":"Our team had been arguing over one settings screen for days. One outside view, three reasons, decision made. I have since booked it twice more for other things we were stuck on.","days":79},
  {"who":"lenamueller","rating":4.6,"title":"Specific and practical","body":"Far more useful than general advice from a design community. Every comment pointed at something on my screen, and the written summary meant I could share the reasoning with my developer.","days":126},
  {"who":"samuelnkemelu","rating":4.9,"title":"Sharpened our pitch prototype","body":"We used a session the week before a client pitch. The feedback on our core flow was exact and quick to apply, and the client commented on that very part of the prototype afterwards.","days":201},
  {"who":"renkoda","rating":4.3,"title":"Short but genuinely useful","body":"Thirty minutes is tight for a big file, so bring one thing rather than five. For the single flow we covered, the feedback was excellent and saved me a lot of time on the next revision.","days":333}],
 "orders":[{"who":"chloewinters","days":14},{"who":"juno","days":41},{"who":"tomaszwojcik","days":84},{"who":"tomaszwojcik","days":3},{"who":"lenamueller","days":132},{"who":"samuelnkemelu","days":207},{"who":"renkoda","days":340},{"who":"noor","days":390,"status":"refunded"}]},

{"key":"portfolio-review","state":"published","model":"session","create":"advise","category":"product",
 "title":"Portfolio review for product designers",
 "about":["A one-hour live review of your portfolio with a hiring manager's eye: what to cut, what to lead with and how to tell the story of your work."],
 "delivery":"60-minute session","amount":15000,"session":15000,"minutes":60,"sittings":1,"provider":"zoom","preset":"override",
 "age":240,"listed":233,"edited":18,"images":[6,15,16],
 "skills":["mentoring","ux"],"tags":["portfolio review","design careers"],
 "stages":[],"roles":[],
 "deliverables":["60-minute live review call","Written action plan within 48 hours","A list of pieces to cut, keep and rework"],
 "intake":[
  {"id":"portfolio","kind":"text","label":"A link to your portfolio","required":true,"placeholder":"https://…","maxLength":300},
  {"id":"level","kind":"select","label":"Which roles are you going for?","required":true,"options":[{"value":"junior","label":"Junior"},{"value":"mid","label":"Mid-level"},{"value":"senior","label":"Senior"},{"value":"lead","label":"Lead or principal"}]},
  {"id":"worries","kind":"textarea","label":"What worries you most about it?","required":false,"maxLength":400}],
 "reviews":[
  {"who":"chloewinters","rating":5,"title":"Changed how I present my work","body":"I had been leading with the wrong project for months. An hour later I had a new order, a shorter case study format and much more confidence. Two interviews followed within the next month.","days":22},
  {"who":"lenamueller","rating":4.7,"title":"Honest and encouraging","body":"Direct about what was not working, and generous with suggestions for how to fix it. The written action plan arrived the next day, and I have worked through it line by line since then.","days":75},
  {"who":"aikotanaka","rating":5,"title":"Exactly what a senior move needs","body":"I wanted to move from illustration into product roles, and the session was very specific about how to reframe my work for that. It was practical, not motivational, which is what I needed.","days":118},
  {"who":"juno","rating":4.4,"title":"Helpful for a front-end portfolio too","body":"I am more engineer than designer, so not everything applied, but the advice on narrating decisions rather than showing screens has already helped me in two conversations with hiring managers.","days":190}],
 "orders":[{"who":"chloewinters","days":28},{"who":"lenamueller","days":81},{"who":"aikotanaka","days":124},{"who":"juno","days":197},{"who":"tomaszwojcik","days":1}]},

{"key":"mentorship-block","state":"published","model":"session","create":"empower","category":"product",
 "title":"Product design mentorship block",
 "about":["Six fortnightly one-to-one sessions for a designer who wants to step up: craft, stakeholder confidence and the career conversation nobody schedules."],
 "delivery":"6 × 45-minute sessions","amount":72000,"session":12000,"minutes":45,"sittings":6,"preset":"mornings",
 "age":200,"listed":196,"edited":9,"images":[16,6],
 "skills":["mentoring","ux","prototyping"],"tags":["mentorship","career growth"],"collections":["For design teams"],
 "stages":[],"roles":[],
 "deliverables":["Six 45-minute one-to-one sessions","A growth plan agreed in the first session","Async feedback on work between sessions","Notes after every call"],
 "intake":[
  {"id":"topics","kind":"multiselect","label":"What should we cover?","required":true,"maxSelections":3,"options":[{"value":"craft","label":"Interaction craft"},{"value":"stakeholders","label":"Working with stakeholders"},{"value":"research","label":"Running research"},{"value":"career","label":"Career direction"}]},
  {"id":"years","kind":"number","label":"Years in product design","required":false,"min":0,"max":20,"step":1,"unit":"years"}],
 "reviews":[
  {"who":"chloewinters","rating":5,"title":"The best money I have spent on my career","body":"Six sessions gave me a plan, a sounding board and a lot more confidence with stakeholders. The notes after each call meant nothing was lost between sessions, and I still reread them now.","days":30},
  {"who":"aikotanaka","rating":4.8,"title":"Structured without being rigid","body":"The growth plan set the direction, but each session bent around whatever I was stuck on that fortnight. Async feedback between calls was a real bonus I had not expected to use so much.","days":95},
  {"who":"lenamueller","rating":4.9,"title":"A proper mentor, not a course","body":"This is personal and specific in a way courses never are. I took on a lead role during the block, and being able to talk through that move as it happened was worth the whole price on its own.","days":150}],
 "orders":[{"who":"chloewinters","days":112},{"who":"aikotanaka","days":176},{"who":"lenamueller","days":185}]},

{"key":"strategy-session","state":"published","model":"session","create":"advise","category":"product",
 "title":"Product strategy working session",
 "about":["Ninety minutes on the question that keeps moving down your roadmap. We leave with a decision, the reasoning behind it and the next three steps."],
 "delivery":"90-minute session","amount":34000,"session":34000,"minutes":90,"sittings":1,"provider":"microsoft_teams",
 "age":60,"listed":54,"edited":4,"images":[10,4],
 "skills":["ux","mentoring"],"tags":["product strategy","roadmap","founders"],"collections":["For founders"],
 "stages":[],"roles":[],
 "deliverables":["90-minute working session","Decision note with reasoning","Next three steps"],
 "intake":[
  {"id":"question","kind":"textarea","label":"What decision do you need to make?","required":true,"maxLength":600},
  {"id":"attendees","kind":"number","label":"How many people will join?","required":false,"min":1,"max":6,"step":1,"unit":"people","slider":true}],
 "reviews":[
  {"who":"danielokafor","rating":4.9,"title":"Unblocked a decision in one sitting","body":"We had been circling a pricing and packaging question for two quarters. Ninety minutes, a clear framing and a decision note we could share with the board. Very well facilitated throughout.","days":18}],
 "orders":[{"who":"danielokafor","days":24}]},

{"key":"tokens-workshop","state":"published","model":"group_session","create":"educate","category":"product",
 "title":"Figma variables and tokens workshop",
 "about":["A live, hands-on class: build a token-driven theme in Figma alongside a small group, with light and dark modes working by the end. Seats sold per attendee, joining any time."],
 "delivery":"2-hour class","amount":8500,"session":8500,"seats":16,"minutes":120,"sittings":1,"provider":"zoom","continuous":true,"enrolment":7,"preset":"afternoons",
 "age":280,"listed":274,"edited":7,"images":[14,2,9],
 "skills":["figma","design-systems","mentoring"],"tags":["figma variables","design tokens","workshop"],"collections":["For design teams"],
 "seo_title":"Live workshop: Figma variables and design tokens",
 "stages":[],"roles":[],
 "deliverables":["A live two-hour group class","Starter file and exercise sheet","Recording of the session","A follow-up Q&A thread"],
 "intake":[
  {"id":"level","kind":"pills","label":"Your Figma level","required":true,"options":[{"value":"new","label":"New to it"},{"value":"comfortable","label":"Comfortable"},{"value":"advanced","label":"Advanced"}]},
  {"id":"plan","kind":"select","label":"Which Figma plan do you use?","required":false,"options":[{"value":"free","label":"Free"},{"value":"professional","label":"Professional"},{"value":"organization","label":"Organization"}]}],
 "reviews":[
  {"who":"lenamueller","rating":5,"title":"Finally made variables click","body":"I had watched plenty of tutorials and still could not build a real theme. Doing it live in a small group, with someone checking my work, got me there in two hours flat.","days":16},
  {"who":"marisdelacroix","rating":4.7,"title":"Well paced and hands on","body":"Sent two people from a client team and they came back able to maintain their own theme. The starter file is excellent and I have borrowed its structure for my own teaching since.","days":69},
  {"who":"juno","rating":4.8,"title":"Useful for engineers too","body":"As a front-end developer I wanted to understand how our designers think about tokens. It cleared up a lot of confusion and made our conversations about the theme contract far shorter.","days":143},
  {"who":"aikotanaka","rating":4.5,"title":"Friendly group, solid content","body":"Good pace and plenty of time for questions. It moves quickly near the end, so do the pre-reading first if you are new to variables. The recording helped me catch up afterwards.","days":226}],
 "orders":[{"who":"lenamueller","days":21},{"who":"marisdelacroix","days":74,"seats":2},{"who":"juno","days":150},{"who":"aikotanaka","days":233},{"who":"theo","days":6,"seats":3},{"who":"noor","days":10}]},

{"key":"critique-circle","state":"published","model":"group_session","create":"educate","category":"product",
 "title":"Four-week design critique circle",
 "about":["A small, closed cohort that meets weekly to critique real work in progress. Six seats, four sittings, and enrolment closes when the cohort is full."],
 "delivery":"4 × 90-minute sittings","amount":22000,"session":22000,"seats":6,"minutes":90,"sittings":4,"provider":"microsoft_teams","continuous":false,"enrolment":14,"preset":"afternoons",
 "age":180,"listed":175,"edited":13,"images":[15,13],
 "skills":["mentoring","ux"],"tags":["design cohort","critique"],"collections":["For design teams"],
 "stages":[],"roles":[],
 "deliverables":["Four weekly 90-minute sittings","Critique of your own work in every session","A private group for the duration"],
 "intake":[
  {"id":"project","kind":"textarea","label":"What will you bring to the circle?","required":true,"maxLength":400},
  {"id":"timezone","kind":"radio","label":"Which sitting suits you best?","required":true,"options":[{"value":"tue","label":"Tuesdays"},{"value":"thu","label":"Thursdays"}]}],
 "reviews":[
  {"who":"chloewinters","rating":4.9,"title":"Feedback habits I will keep for good","body":"Four weeks of hearing how other designers think did more for me than any course. A small group means everyone really gets into your work, and it also teaches you how to give critique properly.","days":44},
  {"who":"samuelnkemelu","rating":4.6,"title":"Small and high trust","body":"I joined as an engineer who designs a little, and I was made to feel welcome straight away. The weekly rhythm kept me shipping small improvements rather than waiting for the perfect moment.","days":100},
  {"who":"tomaszwojcik","rating":4.8,"title":"Well facilitated","body":"Sessions could easily have become chatter, but they stayed sharp and on topic. Six seats is the right size, and everyone left each week with something concrete to go and try on their work.","days":158}],
 "orders":[{"who":"chloewinters","days":72},{"who":"samuelnkemelu","days":128},{"who":"tomaszwojcik","days":164}]},

{"key":"ai-feature-sprint","state":"draft","model":"pipeline","create":"create","category":"product",
 "title":"AI feature design sprint",
 "about":["Three stages to design an AI feature people will actually trust: pick the right job for it, prototype the conversation and test how it fails."],
 "delivery":"3-week delivery","amount":400000,"ticket":50000,"free":2,"extra":14000,
 "age":9,"edited":1,"images":[7,10],
 "skills":["ux","prototyping","ux-research"],"tags":["ai design","llm ux"],
 "stages":[
  {"name":"Use-case selection","description":"Which job is worth giving to a model, and what a good answer looks like.","deliverables":["Use-case scorecard"],"turnaround":"~4 days","priceCents":50000,"skills":["UX"],"startTrigger":"on_project_start"},
  {"name":"Interaction prototype","description":"The prompts, states and fallbacks, prototyped with real model output.","deliverables":["Working prototype","Prompt and state map"],"turnaround":"~1 week","priceCents":55000,"skills":["Prototyping"]},
  {"name":"Failure testing","description":"Sessions focused on wrong answers: when people notice, and what they do next.","deliverables":["Trust findings","Revised design"],"turnaround":"~1 week","priceCents":45000,"skills":["UX research"]}],
 "roles":[],
 "deliverables":["Use-case scorecard","Prototype with real model output","Trust and failure findings"],
 "intake":[{"id":"model","kind":"select","label":"Do you already use a model?","required":true,"options":[{"value":"yes","label":"Yes, in production"},{"value":"trial","label":"We are trialling one"},{"value":"no","label":"Not yet"}]}]},

{"key":"test-plan","state":"draft","model":"one_off","create":"test","category":"product",
 "title":"Usability test plan and script",
 "about":["A ready-to-run usability test: goals, recruiting screener, moderator script and a note-taking template."],
 "delivery":"4-day delivery","amount":65000,"free":1,"extra":8000,"turnaround":4,
 "age":6,"edited":6,"images":[],
 "skills":["ux-research","user-interviews"],"tags":["usability testing"],
 "stages":[],"roles":[],
 "deliverables":["Test goals and screener","Moderator script","Note-taking template"],
 "intake":[{"id":"audience","kind":"textarea","label":"Who should we test with?","required":true,"maxLength":400}]},

{"key":"dashboard-redesign","state":"draft","model":"direct_deliverable","category":"",
 "title":"Analytics dashboard redesign",
 "about":[],"delivery":"","amount":0,"age":3,"edited":3,"images":[],"skills":[],"tags":[],"stages":[],"roles":[],"deliverables":[],"intake":[]},

{"key":"office-hours","state":"draft","model":"session","create":"advise","category":"product",
 "title":"Founder office hours",
 "about":["A standing 45-minute slot for founders with a live product question."],
 "delivery":"45-minute session","amount":20000,"session":20000,"minutes":45,"sittings":1,
 "age":5,"edited":2,"images":[4],
 "skills":["mentoring"],"tags":["office hours"],
 "stages":[],"roles":[],
 "deliverables":["45-minute live call","Follow-up note"],
 "intake":[{"id":"question","kind":"textarea","label":"What do you want to talk about?","required":true,"maxLength":400}]},

{"key":"a11y-class","state":"draft","model":"group_session","create":"educate","category":"product",
 "title":"Accessibility for product teams",
 "about":["A one-hour live class on the accessibility checks every product team can run this week, for designers and engineers together."],
 "delivery":"1-hour class","amount":9500,"session":9500,"seats":20,"minutes":60,"sittings":1,"continuous":true,"enrolment":10,"preset":"afternoons",
 "age":14,"edited":1,"images":[11,12],
 "skills":["a11y","mentoring"],"tags":["accessibility","wcag"],
 "stages":[],"roles":[],
 "deliverables":["A live one-hour class","Checklist your team can keep using"],
 "intake":[{"id":"role","kind":"pills","label":"Your role","required":false,"options":[{"value":"design","label":"Designer"},{"value":"eng","label":"Engineer"},{"value":"pm","label":"Product manager"}]}]},

{"key":"mobile-app-redesign","state":"paused","model":"pipeline","create":"create","category":"product",
 "title":"Mobile app redesign, screen by screen",
 "about":["Five stages that modernise an existing iOS and Android app without a rewrite. Paused while the current client work finishes."],
 "delivery":"6-week delivery","amount":690000,"ticket":46000,"free":2,"extra":12000,
 "age":380,"listed":372,"ended":18,"edited":18,"images":[17,3,7],
 "skills":["ux","figma","prototyping"],"tags":["mobile app redesign","ios","android"],
 "stages":[
  {"name":"App audit","description":"The current app reviewed against platform guidelines and store reviews.","deliverables":["Audit report"],"turnaround":"~4 days","priceCents":40000,"skills":["UX"],"startTrigger":"on_project_start"},
  {"name":"Navigation model","description":"A new structure that fits how people use the app today.","deliverables":["Navigation prototype"],"turnaround":"~1 week","priceCents":48000,"skills":["UX"]},
  {"name":"Core screens","description":"The ten screens that carry most of the usage.","deliverables":["Core screen designs"],"turnaround":"~2 weeks","priceCents":52000,"skills":["Figma"]},
  {"name":"Remaining screens and states","description":"Everything else, with empty, loading and error states.","deliverables":["Full screen set"],"turnaround":"~1 week","priceCents":46000,"skills":["Figma"]},
  {"name":"Release support","description":"Build QA across devices, plus release notes.","deliverables":["Device QA report"],"turnaround":"~1 week","priceCents":44000,"skills":["UX"]}],
 "roles":[{"name":"Mobile product designer","summary":"Owns the redesign across iOS and Android.","skills":["UX","Figma"],"count":1}],
 "deliverables":["App audit","New navigation model","Full screen set for iOS and Android","Device QA report"],
 "intake":[{"id":"platforms","kind":"pills","label":"Platforms","required":true,"multiple":true,"options":[{"value":"ios","label":"iOS"},{"value":"android","label":"Android"}]},{"id":"users","kind":"number","label":"Monthly active users","required":false,"min":0,"max":1000000,"step":1000,"unit":"users"}],
 "reviews":[
  {"who":"miguelsantos","rating":4.9,"title":"Our app finally feels native","body":"The navigation stage alone was worth it. Store ratings climbed after release, and our iOS and Android teams now work from one set of files rather than two that slowly drift apart.","days":64},
  {"who":"noor","rating":4.7,"title":"Careful with an existing product","body":"It is hard to modernise something people already use without upsetting them. Each stage was tested with existing users, and complaints after release were very nearly zero, which surprised us.","days":135},
  {"who":"kwamemensah","rating":5,"title":"Handled a tricky legacy app","body":"Our client's app had ten years of history in it. The audit made sense of that history and the stage plan meant we could fund it in steps as the client saw the results come through.","days":210},
  {"who":"renkoda","rating":4.4,"title":"Strong on structure","body":"Very good on navigation and states. I did the motion work alongside and would have liked to be brought in a stage earlier, but the collaboration itself was smooth from beginning to end.","days":298}],
 "orders":[{"who":"miguelsantos","days":78},{"who":"noor","days":148},{"who":"kwamemensah","days":222}]},

{"key":"pricing-teardown","state":"paused","model":"one_off","create":"advise","category":"web",
 "title":"Pricing page teardown",
 "about":["A short, pointed review of your pricing page, with a rewritten plan table and a before-and-after mock. Paused over the holiday period."],
 "delivery":"3-day delivery","amount":48000,"free":1,"extra":7000,"turnaround":3,
 "age":220,"listed":214,"ended":5,"edited":5,"images":[18],
 "skills":["ux","ux-writing"],"tags":["pricing page","saas pricing"],
 "stages":[
  {"name":"Teardown","description":"What the page says, what buyers hear and where they hesitate.","deliverables":["Annotated teardown"],"turnaround":"~2 days","priceCents":20000,"skills":["UX"],"startTrigger":"on_project_start"},
  {"name":"Rewrite and mock","description":"A rewritten plan table and a mock of the new page.","deliverables":["Rewritten table","Before-and-after mock"],"turnaround":"~1 day","priceCents":28000,"skills":["UX writing"]}],
 "roles":[],
 "deliverables":["Annotated teardown","Rewritten plan table","Before-and-after mock"],
 "intake":[{"id":"page","kind":"text","label":"A link to your pricing page","required":true,"placeholder":"https://…","maxLength":300}],
 "reviews":[
  {"who":"theo","rating":4.8,"title":"Plain language, instantly better","body":"Three days and our plan table finally says what each tier is for. Upgrade questions in support dropped, and the rewritten copy needed almost no changes from us before it went live.","days":42},
  {"who":"saoirsebyrne","rating":4.6,"title":"A useful outside view","body":"We had stared at our own pricing for far too long. This was a quick, affordable way to see it the way a buyer does, and the before-and-after mock made the case internally for us.","days":117}],
 "orders":[{"who":"theo","days":47},{"who":"saoirsebyrne","days":121}]},

{"key":"investor-demo","state":"paused","model":"direct_deliverable","create":"create","category":"product",
 "title":"Clickable investor demo",
 "about":["A convincing, clickable demo of the product you are about to build, ready for a fundraising meeting. Paused until the next fundraising season."],
 "delivery":"2-week delivery","amount":260000,"free":2,"extra":10000,"turnaround":14,
 "age":340,"listed":330,"ended":30,"edited":30,"images":[19,12],
 "skills":["prototyping","figma"],"tags":["investor demo","pitch prototype"],
 "stages":[],
 "roles":[{"name":"Product designer","summary":"Designs the story and every screen.","skills":["UX","Figma"],"count":1},{"name":"Prototyper","summary":"Makes the demo behave like the real thing.","skills":["Prototyping"],"count":1}],
 "deliverables":["Clickable demo of the core story","Demo script","Fallback recording"],
 "intake":[{"id":"round","kind":"select","label":"Which round are you raising?","required":true,"options":[{"value":"pre","label":"Pre-seed"},{"value":"seed","label":"Seed"},{"value":"a","label":"Series A"}]}],
 "reviews":[
  {"who":"theo","rating":5,"title":"Investors asked when it would ship","body":"The demo told our story better than our deck did. Two investors assumed it was already built, and the fallback recording saved us during one meeting when the venue wifi gave out.","days":88}],
 "orders":[{"who":"theo","days":96}]},

{"key":"mock-interview","state":"paused","model":"session","create":"educate","category":"product",
 "title":"Whiteboard challenge mock interview",
 "about":["A realistic product design whiteboard exercise, followed by candid feedback. Paused while the calendar is full."],
 "delivery":"60-minute session","amount":9000,"session":9000,"minutes":60,"sittings":1,"provider":"zoom",
 "age":160,"listed":155,"ended":9,"edited":9,"images":[16],
 "skills":["mentoring","ux"],"tags":["design interview"],
 "stages":[],"roles":[],
 "deliverables":["60-minute mock interview","Scored feedback"],
 "intake":[{"id":"company","kind":"text","label":"Which kind of company are you interviewing with?","required":false,"maxLength":160}],
 "reviews":[
  {"who":"chloewinters","rating":4.9,"title":"Took the fear out of whiteboards","body":"I froze in my last real interview. Practising under realistic pressure, then hearing exactly how a hiring manager would score it, made a real difference when my next one came around.","days":55},
  {"who":"lenamueller","rating":4.5,"title":"Tough in the right way","body":"Not an easy hour, which is the point. The scored feedback was candid and fair, and it showed me where I rush into solutions before I have properly understood the problem I was given.","days":129}],
 "orders":[{"who":"chloewinters","days":59},{"who":"lenamueller","days":135}]},

{"key":"interviews-for-founders","state":"paused","model":"group_session","create":"educate","category":"product",
 "title":"User interviews for founders",
 "about":["A two-part live class on running your own customer interviews without leading the witness. Paused between cohorts."],
 "delivery":"2 × 2-hour sittings","amount":12000,"session":12000,"seats":10,"minutes":120,"sittings":2,"continuous":false,"enrolment":10,
 "age":310,"listed":304,"ended":40,"edited":40,"images":[20,8],
 "skills":["user-interviews","ux-research"],"tags":["customer interviews","founders"],
 "stages":[],"roles":[],
 "deliverables":["Two live two-hour sittings","Interview guide template"],
 "intake":[{"id":"interviews","kind":"number","label":"Interviews you have run so far","required":false,"min":0,"max":50,"step":1,"unit":"interviews"}],
 "reviews":[
  {"who":"danielokafor","rating":4.8,"title":"Stopped us pitching at our users","body":"We thought we were doing interviews. It turned out we were pitching. Two sessions fixed our questions, and the template is now how everyone at Atlas talks to customers each week.","days":73},
  {"who":"miguelsantos","rating":4.6,"title":"Practical and quick to apply","body":"I ran my first properly useful interview the day after the second sitting. It helps to practise on each other in the room, even when that feels a little awkward at the start.","days":180}],
 "orders":[{"who":"danielokafor","days":80,"seats":2},{"who":"miguelsantos","days":188}]},

{"key":"webflow-site","state":"archived","model":"pipeline","create":"create","category":"web",
 "title":"Marketing site design and Webflow build",
 "about":["A three-stage marketing site, designed and built in Webflow. Retired to focus on product work."],
 "delivery":"5-week delivery","amount":315000,"ticket":35000,"free":2,"extra":9000,
 "age":520,"listed":515,"ended":200,"edited":200,"images":[18,5],
 "skills":["figma","ux"],"tags":["webflow","marketing site"],
 "stages":[
  {"name":"Structure and copy","description":"Sitemap and page copy agreed before design begins.","deliverables":["Sitemap","Page copy"],"turnaround":"~1 week","priceCents":30000,"skills":["UX writing"],"startTrigger":"on_project_start"},
  {"name":"Design","description":"Every page designed for desktop and mobile.","deliverables":["Page designs"],"turnaround":"~2 weeks","priceCents":40000,"skills":["Figma"]},
  {"name":"Webflow build","description":"Built, connected to your CMS and handed over.","deliverables":["Live Webflow site"],"turnaround":"~2 weeks","priceCents":35000,"skills":["UX"]}],
 "roles":[],
 "deliverables":["Sitemap and copy","Page designs","Live Webflow site"],
 "intake":[{"id":"pages","kind":"number","label":"How many pages?","required":true,"min":1,"max":30,"step":1,"unit":"pages"}],
 "reviews":[
  {"who":"saoirsebyrne","rating":4.7,"title":"Lovely site, smooth build","body":"Our studio site went from a template to something that genuinely represents the work. The Webflow handover was clear enough for our writers to publish without having to call for help.","days":230},
  {"who":"inesduarte","rating":4.8,"title":"Structured from the first day","body":"Agreeing copy before design saved us from the usual last-minute scramble. It was a shame to see this listing retired, as it was a very dependable way to get a marketing site out.","days":310},
  {"who":"noor","rating":3.8,"title":"Good result, slipped by a week","body":"We were happy with the site in the end. The build stage ran a week past the plan because of some CMS changes on our side and theirs, and communication on it could have come a little sooner.","days":400}],
 "orders":[{"who":"inesduarte","days":322},{"who":"noor","days":412,"status":"refunded"}]},

{"key":"app-icon","state":"archived","model":"one_off","create":"create","category":"branding",
 "title":"App icon design",
 "about":["One distinctive app icon in three directions, tested at every size. Retired as brand work moved to a specialist partner."],
 "delivery":"4-day delivery","amount":38000,"free":3,"extra":4000,"turnaround":4,
 "age":510,"listed":503,"ended":260,"edited":260,"images":[21],
 "skills":["identity-systems","figma"],"tags":["app icon"],
 "stages":[],"roles":[],
 "deliverables":["Three icon directions","Final icon at every store size"],
 "intake":[{"id":"app","kind":"text","label":"What does your app do?","required":true,"maxLength":200}],
 "reviews":[
  {"who":"tomaszwojcik","rating":4.3,"title":"Clean icon, quick turnaround","body":"A good simple icon that holds up at small sizes, delivered in four days. The first set of directions felt a bit safe, but the second round landed on something we were very happy with.","days":330}],
 "orders":[{"who":"tomaszwojcik","days":345}]},

{"key":"bilingual-ux-copy","state":"archived","model":"direct_deliverable","create":"run","category":"content",
 "title":"Arabic and English UX copy pass",
 "about":["A full pass over your product's interface copy in Arabic and English, right-to-left layouts checked. Retired once the translator partner went full-time elsewhere."],
 "delivery":"10-day delivery","amount":110000,"free":2,"extra":5000,"turnaround":10,
 "age":440,"listed":432,"ended":150,"edited":150,"images":[22],
 "skills":["ux-writing","copywriting"],"tags":["arabic ux","rtl"],
 "stages":[],
 "roles":[{"name":"UX writer","summary":"Leads the English pass and the voice.","skills":["UX writing"],"count":1},{"name":"Arabic localisation lead","summary":"Writes the Arabic and checks every right-to-left layout.","skills":["Copywriting"],"count":1}],
 "deliverables":["Interface copy in Arabic and English","Right-to-left layout review"],
 "intake":[{"id":"strings","kind":"number","label":"Roughly how many strings?","required":false,"min":50,"max":5000,"step":50,"unit":"strings"}],
 "reviews":[],"orders":[{"who":"hannahcole","days":270}]},

{"key":"junior-career-chat","state":"archived","model":"session","create":"empower","category":"product",
 "title":"Career chat for junior designers",
 "about":["A low-cost half hour for people starting out. Retired in favour of the portfolio review."],
 "delivery":"30-minute session","amount":4000,"session":4000,"minutes":30,"sittings":1,
 "age":400,"listed":396,"ended":90,"edited":90,"images":[16],
 "skills":["mentoring"],"tags":["junior designers"],
 "stages":[],"roles":[],
 "deliverables":["30-minute career chat"],
 "intake":[{"id":"question","kind":"textarea","label":"What is on your mind?","required":false,"maxLength":300}],
 "reviews":[
  {"who":"chloewinters","rating":5,"title":"Kind, practical and honest","body":"My very first conversation with a working product designer. It was kind and practical, and honest about what the first two years really look like. It shaped how I applied for roles afterwards.","days":310}],
 "orders":[{"who":"chloewinters","days":316}]},

{"key":"weekend-bootcamp","state":"archived","model":"group_session","create":"educate","category":"product",
 "title":"Weekend Figma bootcamp",
 "about":["A two-day, in-depth Figma class for career changers. Retired after the final cohort."],
 "delivery":"2 × 4-hour sittings","amount":18000,"session":18000,"seats":12,"minutes":240,"sittings":2,"continuous":false,"enrolment":14,
 "age":480,"listed":474,"ended":120,"edited":120,"images":[23,14],
 "skills":["figma","mentoring"],"tags":["figma bootcamp"],
 "stages":[],"roles":[],
 "deliverables":["Two four-hour sittings","Exercise files"],
 "intake":[{"id":"experience","kind":"radio","label":"Have you used Figma before?","required":true,"options":[{"value":"no","label":"No"},{"value":"a_little","label":"A little"},{"value":"yes","label":"Yes"}]}],
 "reviews":[
  {"who":"aikotanaka","rating":4.6,"title":"Packed and very well organised","body":"A lot of ground covered in a single weekend. I arrived as an illustrator who had barely touched Figma and left with auto layout, components and a real file I could build on myself.","days":260},
  {"who":"lenamueller","rating":4.4,"title":"Great start for beginners","body":"Clear structure and patient teaching. The second afternoon moved fast for the newcomers, though the exercise files meant everyone could catch up at their own pace in the following week.","days":350}],
 "orders":[{"who":"aikotanaka","days":270},{"who":"lenamueller","days":358},{"who":"chloewinters","days":362}]}

]$json$::jsonb) AS r (
    key text, state text, model text, title text, about jsonb, category text, "create" text,
    delivery text, amount bigint, ticket bigint, session bigint, seats integer, free integer,
    extra bigint, turnaround integer, minutes integer, sittings integer, provider text,
    continuous boolean, enrolment integer, preset text, promoted boolean, age integer, listed integer,
    ended integer, edited integer, images jsonb, skills jsonb, tags jsonb, collections jsonb,
    seo_title text, seo_desc text, stages jsonb, roles jsonb, deliverables jsonb, intake jsonb,
    reviews jsonb, orders jsonb
)
$f$;

/** A seeded public image by position: SQL cannot upload, and files.items holds one row per object. */
CREATE OR REPLACE FUNCTION pg_temp.c2_image(p_position integer) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_name text := (ARRAY[
        'Helia wallet design system — cover', 'An accessible data table — cover',
        'Launch film for a smart speaker — cover', 'Maris Delacroix — showcase 4',
        'Guidelines people actually open — cover', 'Live operations board — cover',
        'Inês Duarte — showcase 5', 'Research-led onboarding — cover', 'Ren Koda — showcase 3',
        'Inês Duarte — showcase 3', 'Juno Park — showcase 3', 'Realtime analytics dashboard — cover',
        'Saoirse Byrne — showcase 2', 'Packaging in 3D — cover', 'Campaign illustration series — cover',
        'Studio Fern — showcase 1', 'North Loop — showcase 1', 'Kwame Mensah — showcase 2',
        'Long-read layout system — cover', 'Atelier Nova — showcase 1', 'Almeida Coffee Co. identity — cover',
        'Inês Duarte — showcase 4', 'Checkout that explains itself — cover'
    ])[p_position];
    v_id uuid;
BEGIN
    IF p_position IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT i.id INTO v_id
      FROM files.items i
     WHERE i.display_name = v_name AND i.visibility = 'public' AND i.deleted_at IS NULL
     LIMIT 1;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'Seed image "%" is missing: these snippets expect the seeded world from `deno task db:reset`.', v_name;
    END IF;
    RETURN v_id;
END;
$$;
-- #endregion

-- #region Schedule: what a booked service sells from
-- A session binds to an availability preset on its owner's schedule, and the gate books inside the
-- schedule's weekly bands. Buffers and notice live on `call_settings`, once per schedule. An owner who
-- already has a schedule keeps it. No default preset is written: `strategy-session` and `office-hours`
-- then read "Choose availability" until the owner has one, which is the needs-attention filter's case.
INSERT INTO scheduling.schedules (id, owner_type, owner_id, timezone, is_published)
SELECT pg_temp.sid('schedule'), 'user', u.user_id, COALESCE(NULLIF(u.timezone, ''), 'UTC'), true
  FROM org.users_public u
 WHERE u.user_id = pg_temp.me()
ON CONFLICT (owner_type, owner_id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.c2_schedule() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT s.id FROM scheduling.schedules s WHERE s.owner_type = 'user' AND s.owner_id = pg_temp.me();
$$;

INSERT INTO scheduling.availability_rules (id, schedule_id, kind, weekday, start_minute, end_minute, label)
SELECT pg_temp.sid('band:' || b.kind || ':' || d || ':' || b.start_minute), pg_temp.c2_schedule(),
       b.kind::scheduling.availability_kind, d, b.start_minute, b.end_minute, b.label
  FROM (VALUES
      ('working_hours', 540, 1140, 'Working hours'),
      ('call_window', 600, 720, 'Morning calls'),
      ('call_window', 840, 960, 'Afternoon calls')
  ) AS b (kind, start_minute, end_minute, label)
 CROSS JOIN generate_series(1, 5) AS d
 WHERE NOT EXISTS (SELECT 1 FROM scheduling.availability_rules r WHERE r.schedule_id = pg_temp.c2_schedule())
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.call_settings
    (schedule_id, accepts_calls, courtesy_enabled, courtesy_duration_minutes, courtesy_max_per_week,
     buffer_before_minutes, buffer_after_minutes, min_notice_minutes, max_advance_days, agenda_required)
VALUES (pg_temp.c2_schedule(), true, true, 20, 3, 5, 15, 1440, 45, true)
ON CONFLICT (schedule_id) DO NOTHING;

INSERT INTO scheduling.call_platforms (schedule_id, provider_slug, position)
VALUES (pg_temp.c2_schedule(), 'google', 0), (pg_temp.c2_schedule(), 'zoom', 1)
ON CONFLICT (schedule_id, provider_slug) DO NOTHING;
-- #endregion

-- #region Service blueprints: how each service is delivered and priced
-- Follows catalogue.save_listing's mirror: the subject agrees with its listing, and a blueprint is
-- published exactly while its listing is (catalogue.set_listing_status). search.services_index is
-- maintained from here by trg_sync_service_search.
INSERT INTO marketplace.service_blueprints (
    id, owner_type, freelancer_profile_id, title, slug, description, description_text, delivery_model,
    pricing_model, price_cents, ticket_price_cents, session_price_cents, currency, category,
    cover_file_id, free_revisions, extra_revision_price_cents, requires_upfront_escrow,
    max_seats_per_cohort, allow_continuous_enrollment, enrollment_window_days, intake_fields,
    stage_template, team_roles, deliverables, session_minutes, session_count, turnaround_days,
    meeting_provider, is_published, created_at, updated_at
)
SELECT pg_temp.sid('svc:' || s.key), 'freelancer', pg_temp.me(), s.title, pg_temp.slug('svc', s.key),
       jsonb_build_object('html', t.html), t.body,
       s.model::marketplace.service_delivery_model,
       CASE WHEN s.model IN ('session', 'group_session') THEN 'per_seat' ELSE 'flat_fee' END::marketplace.pricing_model,
       s.amount, s.ticket, s.session, 'USD', s.category,
       pg_temp.c2_image((s.images ->> 0)::integer), s.free, s.extra,
       s.model NOT IN ('session', 'group_session'), COALESCE(s.seats, 1), COALESCE(s.continuous, false),
       COALESCE(s.enrolment, 7), COALESCE(s.intake, '[]'), COALESCE(s.stages, '[]'), COALESCE(s.roles, '[]'),
       ARRAY(SELECT jsonb_array_elements_text(COALESCE(s.deliverables, '[]'))), s.minutes, s.sittings,
       s.turnaround, s.provider, s.state = 'published',
       now() - make_interval(days => s.age), now() - make_interval(days => s.edited)
  FROM pg_temp.c2_services() s
 CROSS JOIN LATERAL (
     SELECT COALESCE(string_agg(p, E'\n\n' ORDER BY n), '') AS body,
            COALESCE(string_agg('<p>' || replace(replace(replace(p, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>', '' ORDER BY n), '') AS html
       FROM jsonb_array_elements_text(s.about) WITH ORDINALITY AS a (p, n)
 ) t
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Availability presets, and the sessions bound to them
INSERT INTO scheduling.availability_presets (id, schedule_id, scope, blueprint_id, slug, name, description)
VALUES
    (pg_temp.sid('preset:mornings'), pg_temp.c2_schedule(), 'library', NULL, pg_temp.slug('avp', 'mornings'),
     'Service sessions, mornings', 'Weekday mornings, 10:00–13:00, for one-to-one sessions.'),
    (pg_temp.sid('preset:afternoons'), pg_temp.c2_schedule(), 'library', NULL, pg_temp.slug('avp', 'afternoons'),
     'Cohorts, late afternoons', 'Tuesday and Thursday, 16:00–19:00, for classes and cohorts.'),
    (pg_temp.sid('preset:override'), pg_temp.c2_schedule(), 'service', pg_temp.sid('svc:portfolio-review'),
     pg_temp.slug('avp', 'override'), 'Portfolio review hours', 'Monday and Wednesday afternoons, kept for portfolio reviews.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.recurrence_rules (id, preset_id, kind, rrule, starts_on, label)
SELECT pg_temp.sid('rule:' || r.preset), pg_temp.sid('preset:' || r.preset), 'working_hours', r.rrule,
       (date_trunc('week', now()) - interval '28 days')::date, r.label
  FROM (VALUES
      ('mornings', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Weekday mornings'),
      ('afternoons', 'FREQ=WEEKLY;BYDAY=TU,TH', 'Tuesday and Thursday'),
      ('override', 'FREQ=WEEKLY;BYDAY=MO,WE', 'Monday and Wednesday')
  ) AS r (preset, rrule, label)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scheduling.recurrence_rule_bands (rule_id, position, start_minute, end_minute)
VALUES
    (pg_temp.sid('rule:mornings'), 0, 600, 780),
    (pg_temp.sid('rule:afternoons'), 0, 960, 1140),
    (pg_temp.sid('rule:override'), 0, 840, 1080)
ON CONFLICT (rule_id, position) DO NOTHING;

UPDATE marketplace.service_blueprints b
   SET availability_preset_id = pg_temp.sid('preset:' || s.preset)
  FROM pg_temp.c2_services() s
 WHERE b.id = pg_temp.sid('svc:' || s.key) AND s.preset IS NOT NULL AND b.availability_preset_id IS NULL;
-- #endregion

-- #region Listings: the publication layer over each blueprint
INSERT INTO catalogue.listings (
    id, owner_user_id, kind, status, service_blueprint_id, title, description, description_text,
    category, delivery_label, seo_title, seo_description, create_category, amount_cents,
    ticket_price_cents, session_price_cents, seats_per_session, currency, free_revisions,
    extra_revision_price_cents, promoted, published_at, created_at, updated_at
)
SELECT pg_temp.sid('listing:' || s.key), pg_temp.me(), 'service', s.state::catalogue.listing_status,
       b.id, s.title, b.description, b.description_text, s.category, COALESCE(s.delivery, ''),
       s.seo_title, s.seo_desc, s."create"::org.create_category, s.amount, s.ticket, s.session, s.seats,
       'USD', s.free, s.extra, COALESCE(s.promoted, false), now() - make_interval(days => s.listed),
       b.created_at, b.updated_at
  FROM pg_temp.c2_services() s
  JOIN marketplace.service_blueprints b ON b.id = pg_temp.sid('svc:' || s.key)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Galleries, skills, tags, collections and the paid placement
INSERT INTO catalogue.listing_media (id, listing_id, file_id, kind, alt_text, position)
SELECT pg_temp.sid('media:' || s.key || ':' || f.position), pg_temp.sid('listing:' || s.key),
       pg_temp.c2_image(f.image::integer), 'image',
       s.title || CASE WHEN f.position = 1 THEN '' ELSE ' — view ' || f.position END, f.position
  FROM pg_temp.c2_services() s
 CROSS JOIN LATERAL jsonb_array_elements_text(s.images) WITH ORDINALITY AS f (image, position)
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalogue.listing_skills (listing_id, skill_id)
SELECT pg_temp.sid('listing:' || s.key), k.id
  FROM pg_temp.c2_services() s
 CROSS JOIN LATERAL jsonb_array_elements_text(s.skills) AS x (slug)
  JOIN org.skills k ON k.slug = x.slug
ON CONFLICT (listing_id, skill_id) DO NOTHING;

-- trg_listing_tags_touch projects these into search.services_index.
INSERT INTO catalogue.listing_tags (listing_id, tag)
SELECT pg_temp.sid('listing:' || s.key), x.tag
  FROM pg_temp.c2_services() s
 CROSS JOIN LATERAL jsonb_array_elements_text(s.tags) AS x (tag)
ON CONFLICT (listing_id, tag) DO NOTHING;

INSERT INTO catalogue.collections (id, owner_user_id, name, slug, description_text)
VALUES
    (pg_temp.sid('collection:start-here'), pg_temp.me(), 'Start here', 'start-here', 'Small, low-risk ways to work together.'),
    (pg_temp.sid('collection:for-founders'), pg_temp.me(), 'For founders', 'for-founders', 'For teams shaping a product from scratch.'),
    (pg_temp.sid('collection:for-design-teams'), pg_temp.me(), 'For design teams', 'for-design-teams', 'For designers and the people around them.')
ON CONFLICT (owner_user_id, slug) DO NOTHING;

INSERT INTO catalogue.collection_listings (collection_id, listing_id, position)
SELECT c.id, pg_temp.sid('listing:' || s.key), row_number() OVER (PARTITION BY c.id ORDER BY s.key) - 1
  FROM pg_temp.c2_services() s
 CROSS JOIN LATERAL jsonb_array_elements_text(s.collections) AS x (name)
  JOIN catalogue.collections c ON c.owner_user_id = pg_temp.me() AND c.name = x.name
ON CONFLICT (collection_id, listing_id) DO NOTHING;

-- The "AD" disclosure is answerable from a row, as the seed's sponsored listings are.
INSERT INTO marketplace.promoted_placements
    (id, sponsor_user_id, entity_type, entity_id, surface, starts_at, ends_at, spend_cents, currency)
SELECT pg_temp.sid('placement:' || s.key), pg_temp.me(), 'service', pg_temp.sid('svc:' || s.key),
       'explore_home', now() - interval '7 days', now() + interval '23 days', 4900, 'USD'
  FROM pg_temp.c2_services() s
 WHERE s.promoted
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Reviews: reviews.recalculate_entity_rating derives every rating from these rows
INSERT INTO reviews.entity_reviews
    (id, target_entity_id, target_entity_type, reviewer_user_id, rating, title, comment, created_at, updated_at)
SELECT pg_temp.sid('review:' || s.key || ':' || r.who), pg_temp.sid('svc:' || s.key), 'service_blueprint',
       pg_temp.persona(r.who), r.rating, r.title, r.body,
       now() - make_interval(days => r.days), now() - make_interval(days => r.days)
  FROM pg_temp.c2_services() s
 CROSS JOIN LATERAL jsonb_to_recordset(s.reviews) AS r (who text, rating numeric, title text, body text, days integer)
 WHERE r.who <> current_setting('snippet.username')
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Orders: card-paid, one line each, priced by the live basket's own rule
-- Fees floor, per line (platformFeeFor). A sitting lands five days after the order, on a
-- weekday, inside the working hours above. No seller credit here: populate_07_wallet.sql owns that wallet.
CREATE OR REPLACE FUNCTION pg_temp.c2_sales()
RETURNS TABLE (
    order_id uuid, line_id uuid, listing_id uuid, blueprint_id uuid, buyer uuid, placed timestamptz,
    status text, item_type text, title text, delivery text, price bigint, fee bigint, seats integer,
    scheduled timestamptz, minutes integer, provider text, tz text
)
LANGUAGE sql STABLE AS $$
    SELECT pg_temp.sid(k.order_key), pg_temp.sid('line:' || k.order_key), pg_temp.sid('listing:' || s.key),
           pg_temp.sid('svc:' || s.key), pg_temp.persona(x.who), k.placed, COALESCE(x.status, 'confirmed'),
           k.kind, s.title, s.delivery, p.price, p.price * 500 / 10000,
           CASE WHEN s.model = 'group_session' THEN COALESCE(x.seats, 1) END,
           CASE WHEN s.model IN ('session', 'group_session') THEN
               (date_trunc('day', k.placed AT TIME ZONE k.tz)
                + make_interval(days => 5 + CASE extract(dow FROM (k.placed + interval '5 days') AT TIME ZONE k.tz)
                                                WHEN 6 THEN 2 WHEN 0 THEN 1 ELSE 0 END,
                                mins => 600 + 60 * (x.days % 7))) AT TIME ZONE k.tz
           END,
           s.minutes, COALESCE(s.provider, 'zoom'), k.tz
      FROM pg_temp.c2_services() s
     CROSS JOIN LATERAL jsonb_to_recordset(s.orders) AS x (who text, days integer, status text, seats integer)
     CROSS JOIN LATERAL (
         SELECT 'order:' || s.key || ':' || x.who || ':' || x.days AS order_key,
                now() - make_interval(days => x.days) AS placed,
                (SELECT sc.timezone FROM scheduling.schedules sc WHERE sc.id = pg_temp.c2_schedule()) AS tz,
                CASE s.model
                    WHEN 'pipeline' THEN 'service_ticket'
                    WHEN 'one_off' THEN 'one_off_service'
                    WHEN 'direct_deliverable' THEN 'single_service_task'
                    WHEN 'group_session' THEN 'course_group_session'
                    ELSE CASE WHEN s.sittings > 1 THEN 'set_session' ELSE 'service_session' END
                END AS kind
     ) k
     CROSS JOIN LATERAL (
         SELECT CASE k.kind
                    WHEN 'service_ticket' THEN s.ticket
                    WHEN 'service_session' THEN s.session
                    WHEN 'set_session' THEN s.session * s.sittings
                    WHEN 'course_group_session' THEN s.session * COALESCE(x.seats, 1)
                    ELSE s.amount
                END AS price
     ) p
     WHERE x.who <> current_setting('snippet.username');
$$;

INSERT INTO finance.orders (
    id, reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor, platform_fee_minor,
    platform_fee_bp, platform_fee_mode, total_minor, charged_minor, payment_provider,
    payment_method_label, idempotency_key, created_at, updated_at
)
SELECT x.order_id, 'PJ-' || upper(substr(replace(x.order_id::text, '-', ''), 1, 10)),
       x.status::finance.order_status, x.placed, 'user', x.buyer, 'USD', x.price, x.fee, 500,
       'seller_deducted', x.price, x.price, 'stripe', 'visa •••• 4242', 'snippet:' || x.order_id, x.placed,
       x.placed + CASE WHEN x.status = 'refunded' THEN interval '3 days' ELSE interval '0' END
  FROM pg_temp.c2_sales() x
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.order_lines (
    id, order_id, item_type, item_id, title, subtitle, quantity, line_total_minor, currency,
    platform_fee_bp, platform_fee_minor, fulfilment, scheduled_at, timezone, duration_minutes, seats,
    conferencing_provider, created_at
)
SELECT x.line_id, x.order_id, x.item_type::finance.purchasable_item_kind, x.blueprint_id, x.title,
       x.delivery, 1, x.price, 'USD', 500, x.fee,
       (CASE WHEN x.scheduled IS NULL THEN 'engagement' ELSE 'session' END)::finance.fulfilment_kind,
       x.scheduled, CASE WHEN x.scheduled IS NOT NULL THEN u.timezone END, x.minutes, x.seats,
       CASE WHEN x.scheduled IS NOT NULL THEN x.provider END, x.placed
  FROM pg_temp.c2_sales() x
  JOIN org.users_public u ON u.user_id = x.buyer
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Clients: quote requests, service inquiries and discovery calls
-- Together with the orders above these fill all four lanes of the board. Each status is the source
-- row's own: a `sent` quote or a thread whose last word is the buyer's waits on the seller, an
-- `answered` quote or a thread the seller answered last is an inquiry, and a withdrawn quote or an
-- archived thread is closed.
INSERT INTO marketplace.quote_requests
    (id, blueprint_id, host_user_id, requester_user_id, scope, budget_cents, currency, timeline, status,
     answered_at, created_at, updated_at)
SELECT pg_temp.sid('quote:' || q.key || ':' || q.who), pg_temp.sid('svc:' || q.key), pg_temp.me(),
       pg_temp.persona(q.who), q.scope, q.budget, 'USD', q.timeline, q.status,
       now() - make_interval(days => q.answered), now() - make_interval(days => q.days),
       now() - make_interval(days => COALESCE(q.answered, q.days))
  FROM (VALUES
      ('end-to-end', 'priyaraman', 'We are rebuilding the savings flows in the Helia wallet and need the research and prototype stages first, then a decision on the rest.', 900000::bigint, 'Starting in January', 'sent', 2, NULL::integer),
      ('ux-audit', 'hannahcole', 'An audit of our business onboarding ahead of an external accessibility review. Can the data stage cover two products?', 240000, 'Within four weeks', 'sent', 1, NULL),
      ('checkout-redesign', 'miguelsantos', 'Atlas needs its usage-based billing checkout rethought. There is more than one plan change path, so the fixed scope may need adjusting.', 480000, 'Before the end of the quarter', 'answered', 16, 14),
      ('onboarding-activation', 'kwamemensah', 'A client of ours wants their activation funnel looked at. They decided to run it in-house for now, so this one is on hold.', 300000, 'Next quarter', 'withdrawn', 45, NULL)
  ) AS q (key, who, scope, budget, timeline, status, days, answered)
 WHERE q.who <> current_setting('snippet.username')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION pg_temp.c2_inquiries()
RETURNS TABLE (key text, who text, folder text, read boolean, n integer, mine boolean, body text, hours integer)
LANGUAGE sql STABLE AS $$
    SELECT * FROM (VALUES
        ('portfolio-review', 'marisdelacroix', 'primary', false, 1, false, 'Hello, one of the designers on my team is preparing for a lead role. Does the portfolio review work for someone already senior, or is it aimed at people earlier in their careers?', 20),
        ('tokens-workshop', 'samuelnkemelu', 'primary', true, 1, false, 'Hi, is the workshop useful for an engineer who only reads Figma files and does not build them?', 75),
        ('tokens-workshop', 'samuelnkemelu', 'primary', true, 2, true, 'Yes, you would follow along fine. We spend the second hour on how tokens reach the code, so engineers usually get the most from that part.', 72),
        ('landing-page-sprint', 'noor', 'primary', false, 1, false, 'We have a launch in three weeks. If we already have the copy, can the five days come down, or is that the minimum for this?', 6),
        ('ux-audit', 'aikotanaka', 'archived', true, 1, false, 'Could the audit run against a staging build rather than production?', 640),
        ('ux-audit', 'aikotanaka', 'archived', true, 2, true, 'It can, as long as the analytics review has real data to look at. If staging has none, we would drop that stage and adjust the scope.', 636),
        ('ux-audit', 'aikotanaka', 'archived', true, 3, false, 'Understood, that makes sense. We will wait until the new build is live and get back in touch then.', 630),
        ('ux-audit', 'aikotanaka', 'archived', true, 4, true, 'Sounds good. The audit will be here when you are ready, and I will keep the notes from this thread.', 628)
    ) AS i (key, who, folder, read, n, mine, body, hours)
     WHERE i.who <> current_setting('snippet.username')
$$;

INSERT INTO comms.dm_threads (id, kind, subject_listing_id, created_by_user_id, created_at)
SELECT pg_temp.sid('inquiry:' || i.key), 'service_inquiry', pg_temp.sid('listing:' || i.key),
       pg_temp.persona(i.who), now() - make_interval(hours => max(i.hours))
  FROM pg_temp.c2_inquiries() i
 GROUP BY i.key, i.who
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_participants (id, thread_id, user_id, last_read_at, inbox_folder, joined_at)
SELECT pg_temp.sid('inquiry-seat:' || t.key || ':' || p.side), pg_temp.sid('inquiry:' || t.key), p.person,
       CASE WHEN p.side = 'buyer' OR t.read THEN now() - make_interval(hours => t.last_hours) END,
       CASE WHEN p.side = 'seller' THEN t.folder ELSE 'primary' END,
       now() - make_interval(hours => t.first_hours)
  FROM (
      SELECT i.key, i.who, i.folder, i.read, min(i.hours) AS last_hours, max(i.hours) AS first_hours
        FROM pg_temp.c2_inquiries() i
       GROUP BY i.key, i.who, i.folder, i.read
  ) t
 CROSS JOIN LATERAL (VALUES ('buyer', pg_temp.persona(t.who)), ('seller', pg_temp.me())) AS p (side, person)
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.dm_messages (id, thread_id, sender_user_id, body, created_at)
SELECT pg_temp.sid('inquiry-message:' || i.key || ':' || i.n), pg_temp.sid('inquiry:' || i.key),
       CASE WHEN i.mine THEN pg_temp.me() ELSE pg_temp.persona(i.who) END, i.body,
       now() - make_interval(hours => i.hours)
  FROM pg_temp.c2_inquiries() i
ON CONFLICT (id) DO NOTHING;

-- One call is yet to be answered and next week; the other happened last week. Wall-clock times follow
-- the seed's `localAt` pattern, so both land inside the call windows above whenever this is run.
INSERT INTO scheduling.discovery_calls (
    id, host_schedule_id, host_user_id, requester_user_id, call_type, status, proposed_start,
    proposed_end, confirmed_start, confirmed_end, requester_timezone, agenda, service_blueprint_id,
    provider_slug, proposed_at, confirmed_at, completed_at
)
SELECT pg_temp.sid('call:' || c.key), pg_temp.c2_schedule(), pg_temp.me(), pg_temp.persona(c.who),
       'courtesy', c.status::scheduling.call_status, w.starts, w.ends,
       CASE WHEN c.status = 'completed' THEN w.starts END, CASE WHEN c.status = 'completed' THEN w.ends END,
       u.timezone, c.agenda, pg_temp.sid('svc:' || c.key), 'google',
       now() - make_interval(hours => c.asked),
       CASE WHEN c.status = 'completed' THEN now() - make_interval(hours => c.asked - 12) END,
       CASE WHEN c.status = 'completed' THEN w.ends END
  FROM (VALUES
      ('system-health-check', 'danielokafor', 'proposed', 8, 'A quick check that a health check is the right starting point for a library shared by two products.', 30),
      ('end-to-end', 'noor', 'completed', -6, 'Talk through the first two stages and how the sign-offs work before committing to a project.', 336)
  ) AS c (key, who, status, offset_days, agenda, asked)
  JOIN org.users_public u ON u.user_id = pg_temp.persona(c.who)
 CROSS JOIN LATERAL (
     SELECT (date_trunc('week', now() AT TIME ZONE z.tz) + make_interval(days => c.offset_days, mins => 630)) AT TIME ZONE z.tz AS starts,
            (date_trunc('week', now() AT TIME ZONE z.tz) + make_interval(days => c.offset_days, mins => 650)) AT TIME ZONE z.tz AS ends
       FROM (SELECT sc.timezone AS tz FROM scheduling.schedules sc WHERE sc.id = pg_temp.c2_schedule()) z
 ) w
 WHERE c.who <> current_setting('snippet.username')
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Analytics: the daily rollups the catalogue's Analytics reads
-- analytics.fn_rollup_listings is written for one whole day across every seller, so running it here
-- would rewrite the seeded world's rows. These are the same metrics for these listings alone. Traffic
-- is generated, stable per listing and day, from first published to paused or archived; the commerce
-- metrics are derived from the orders above, so they agree with `catalogue.get_listing_sales`.
INSERT INTO analytics.daily_rollups (day, metric, subject_kind, subject_id, dimensions, value, sample_count)
SELECT d.day, m.metric, 'listing', d.listing_id, '{}', m.value, m.sample
  FROM (
      SELECT pg_temp.sid('listing:' || s.key) AS listing_id, g::date AS day,
             get_byte(decode(md5(s.key || g::date), 'hex'), 0) AS n,
             round((6 + 3 * COALESCE(jsonb_array_length(s.reviews), 0))
                   * CASE WHEN extract(dow FROM g) IN (0, 6) THEN 0.6 ELSE 1 END
                   * (1.2 - (now()::date - g::date) / 1100.0)
                   * (0.6 + get_byte(decode(md5(s.key || g::date), 'hex'), 0) / 255.0))::integer AS impressions
        FROM pg_temp.c2_services() s
       CROSS JOIN LATERAL generate_series(
             (now() - make_interval(days => s.listed))::date,
             (now() - make_interval(days => GREATEST(COALESCE(s.ended, 1), 1)))::date,
             interval '1 day') AS g
       WHERE s.listed IS NOT NULL
  ) d
 CROSS JOIN LATERAL (
     SELECT round(d.impressions * (0.06 + (d.n % 7) / 100.0))::integer AS clicks
 ) c
 CROSS JOIN LATERAL (VALUES
     ('listing.impressions', d.impressions, round(d.impressions * 0.8)::integer),
     ('listing.clicks', c.clicks, c.clicks),
     ('listing.views', c.clicks + d.n % 3, c.clicks + d.n % 3 + d.n % 2),
     ('listing.checkout_starts', CASE WHEN d.n % 11 = 0 AND c.clicks > 0 THEN 1 ELSE 0 END, 1)
 ) AS m (metric, value, sample)
 WHERE m.value > 0
ON CONFLICT (day, metric, subject_kind, subject_id, dimensions) DO NOTHING;

-- Search terms: each published listing's tags, weekly, past KEYWORD_MIN_SESSIONS over any window.
INSERT INTO analytics.daily_rollups (day, metric, subject_kind, subject_id, dimensions, value, sample_count)
SELECT q.day, m.metric, 'listing', q.listing_id, jsonb_build_object('q', q.term), m.value, m.sample
  FROM (
      SELECT pg_temp.sid('listing:' || s.key) AS listing_id, x.term, g::date AS day,
             6 + get_byte(decode(md5(s.key || x.term || g::date), 'hex'), 0) % 24 AS impressions
        FROM pg_temp.c2_services() s
       CROSS JOIN LATERAL jsonb_array_elements_text(s.tags) AS x (term)
       CROSS JOIN generate_series(date_trunc('week', now()) - interval '26 weeks', date_trunc('week', now()) - interval '1 week', interval '1 week') AS g
       WHERE s.state = 'published' AND s.listed > 0 AND g::date >= (now() - make_interval(days => s.listed))::date
  ) q
 CROSS JOIN LATERAL (VALUES
     ('listing.query_impressions', q.impressions, GREATEST(5, q.impressions - 2)),
     ('listing.query_clicks', q.impressions / 6, GREATEST(q.impressions / 6, 1))
 ) AS m (metric, value, sample)
 WHERE m.value > 0
ON CONFLICT (day, metric, subject_kind, subject_id, dimensions) DO NOTHING;

INSERT INTO analytics.daily_rollups (day, metric, subject_kind, subject_id, dimensions, value, sample_count)
SELECT r.day, r.metric, 'listing', r.listing_id, r.dimensions, sum(r.value), sum(r.sample)::integer
  FROM pg_temp.c2_sales() x
 CROSS JOIN LATERAL (
     SELECT (x.placed AT TIME ZONE 'UTC')::date AS day, 'listing.orders' AS metric, x.listing_id, '{}'::jsonb AS dimensions, 1::numeric AS value, 1 AS sample
      WHERE x.status = 'confirmed'
     UNION ALL
     SELECT (x.placed AT TIME ZONE 'UTC')::date, 'listing.gross_minor', x.listing_id, '{"currency":"USD"}'::jsonb, x.price, 1
      WHERE x.status = 'confirmed'
     UNION ALL
     SELECT (x.placed AT TIME ZONE 'UTC')::date, 'listing.bookings', x.listing_id, '{}'::jsonb, 1, COALESCE(x.seats, 1)
      WHERE x.status = 'confirmed' AND x.scheduled IS NOT NULL
     UNION ALL
     SELECT (x.scheduled AT TIME ZONE 'UTC')::date, 'listing.booking_slot', x.listing_id,
            jsonb_build_object('dow', extract(dow FROM x.scheduled AT TIME ZONE x.tz)::integer,
                               'hour', extract(hour FROM x.scheduled AT TIME ZONE x.tz)::integer), 1, 1
      WHERE x.status = 'confirmed' AND x.scheduled < now()
     UNION ALL
     SELECT ((x.placed + interval '3 days') AT TIME ZONE 'UTC')::date, 'listing.cancellations', x.listing_id, '{}'::jsonb, 1, 1
      WHERE x.status = 'refunded' AND x.scheduled IS NULL
 ) r
 WHERE r.day < (now() AT TIME ZONE 'UTC')::date
 GROUP BY r.day, r.metric, r.listing_id, r.dimensions
ON CONFLICT (day, metric, subject_kind, subject_id, dimensions) DO NOTHING;
-- #endregion

-- #region Projections no trigger maintains
-- The console's Views column reads `view_count`, so it follows the rollups above, and `order_count`
-- follows the orders. `service_count` has no writer in the app; org.profiles_index projects it.
UPDATE catalogue.listings l
   SET view_count = c.views, order_count = c.orders
  FROM (
      SELECT pg_temp.sid('listing:' || s.key) AS id,
             COALESCE((SELECT sum(r.value)::integer FROM analytics.daily_rollups r
                        WHERE r.subject_kind = 'listing' AND r.metric = 'listing.views'
                          AND r.subject_id = pg_temp.sid('listing:' || s.key)), 0) AS views,
             (SELECT count(*)::integer FROM pg_temp.c2_sales() x
               WHERE x.listing_id = pg_temp.sid('listing:' || s.key) AND x.status = 'confirmed') AS orders
        FROM pg_temp.c2_services() s
  ) c
 WHERE l.id = c.id AND (l.view_count, l.order_count) IS DISTINCT FROM (c.views, c.orders);

UPDATE org.users_public u
   SET service_count = c.published
  FROM (
      SELECT count(*)::integer AS published
        FROM catalogue.listings l
       WHERE l.owner_user_id = pg_temp.me() AND l.owner_team_id IS NULL
         AND l.kind = 'service' AND l.status = 'published'
  ) c
 WHERE u.user_id = pg_temp.me() AND u.service_count IS DISTINCT FROM c.published;
-- #endregion

-- #region Summary
SELECT r.label, r.count
  FROM (
      SELECT 10 AS ord, 'Service listings' AS label, count(*) AS count
        FROM catalogue.listings l WHERE l.owner_user_id = pg_temp.me() AND l.kind = 'service'
      UNION ALL
      SELECT 20, 'Product listings', count(*)
        FROM catalogue.listings l WHERE l.owner_user_id = pg_temp.me() AND l.kind = 'product'
      UNION ALL
      SELECT 30 + array_position(enum_range(NULL::catalogue.listing_status), l.status),
             'Listings: ' || l.status, count(*)
        FROM catalogue.listings l WHERE l.owner_user_id = pg_temp.me() AND l.kind = 'service' GROUP BY l.status
      UNION ALL
      SELECT 40 + array_position(enum_range(NULL::marketplace.service_delivery_model), b.delivery_model),
             'Delivery model: ' || b.delivery_model, count(*)
        FROM catalogue.listings l JOIN marketplace.service_blueprints b ON b.id = l.service_blueprint_id
       WHERE l.owner_user_id = pg_temp.me() GROUP BY b.delivery_model
      UNION ALL
      SELECT 50, 'Visible in /explore (published, indexed, owner in the directory)', count(*)
        FROM catalogue.listings l
        JOIN marketplace.service_blueprints b ON b.id = l.service_blueprint_id AND b.is_published
        JOIN search.services_index si ON si.service_id = b.id AND si.is_public
        JOIN org.profiles_index p ON p.entity_id = l.owner_user_id
       WHERE l.owner_user_id = pg_temp.me() AND l.status = 'published'
      UNION ALL
      SELECT 60, 'Reviews', count(*)
        FROM reviews.entity_reviews r JOIN marketplace.service_blueprints b ON b.id = r.target_entity_id
       WHERE b.freelancer_profile_id = pg_temp.me()
      UNION ALL
      SELECT 61, 'Orders', count(*)
        FROM finance.order_lines ol JOIN marketplace.service_blueprints b ON b.id = ol.item_id
       WHERE b.freelancer_profile_id = pg_temp.me()
      UNION ALL
      SELECT 62, 'Quote requests', count(*) FROM marketplace.quote_requests q WHERE q.host_user_id = pg_temp.me()
      UNION ALL
      SELECT 63, 'Service inquiries', count(*)
        FROM comms.dm_threads t JOIN catalogue.listings l ON l.id = t.subject_listing_id
       WHERE l.owner_user_id = pg_temp.me()
      UNION ALL
      SELECT 64, 'Discovery calls on a listing', count(*)
        FROM scheduling.discovery_calls d WHERE d.host_user_id = pg_temp.me() AND d.service_blueprint_id IS NOT NULL
      UNION ALL
      SELECT 65, 'Analytics rollup rows', count(*)
        FROM analytics.daily_rollups r JOIN catalogue.listings l ON l.id = r.subject_id
       WHERE r.subject_kind = 'listing' AND l.owner_user_id = pg_temp.me()
  ) r
 ORDER BY r.ord;
-- #endregion

COMMIT;
