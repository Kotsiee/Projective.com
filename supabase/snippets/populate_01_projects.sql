-- =============================================================================================
-- populate_01_projects.sql — fills one account's /projects page with every kind of engagement.
--
-- WHAT IT POPULATES
--   Fifty-seven projects around the target account, reaching every format and structure pair, every
--   project, stage and ticket status, and every relationship the account can hold with a project:
--   owner (individually, through a business, through a team, through an enterprise), hired on a stage,
--   a seat on a hired team, admin, manager, member, guest, invited (pending, placeholder, declined,
--   expired, revoked), applicant (pending, accepted, rejected, withdrawn), session host and attendee.
--   It also writes what those need: three client businesses, two teams, one enterprise, four session
--   and service blueprints, stages, tickets, hires, invitations, applications, submissions with
--   revision chains, cohorts and sittings, escrows, wallets, ledgers, invoices, channels, messages,
--   reviews, maintenance contracts and history.
--
-- WHICH PAGES SHOW IT
--   /projects (portfolio, status filter, proposals list) and the projects lane beside it, including
--   its Services tab; every /projects/prj-… workspace (overview, board, timeline, submissions,
--   members, details). Pending invitations reach the account through notifications. A project with a
--   status of archived, a seat bought as a session attendee, and an invitation or application with no
--   hire behind it do not list on /projects: the feed reads ownership and participant rows only.
--
-- HOW TO RUN IT
--   Open this file in Supabase Studio's SQL editor (localhost:54323) and press Run. It is one
--   transaction, it ends in a summary table, and running it twice changes nothing. Or:
--     docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/snippets/populate_01_projects.sql
--
-- HOW TO CHANGE THE ACCOUNT
--   Edit the username in the `snippet.username` line just below. The script stands alone: it needs
--   only the seeded world and that account, not any of the other populate_* snippets.
--
-- MONEY
--   Released escrows and team splits that pay the target are written here, but the target's personal
--   wallet is not: populate_07_wallet.sql walks them into that ledger. Every other wallet this script
--   touches is one it created (its businesses', its teams', and a persona's EUR wallet), written in
--   one chronological pass. No seeded wallet moves.
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

-- #region Script helpers
SELECT pg_temp.ensure_verified();

/** A key's person: `me` is the target, anything else a seeded persona's username. */
CREATE OR REPLACE FUNCTION pg_temp.p1_who(p text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p IS NULL THEN NULL WHEN p = 'me' THEN pg_temp.me() ELSE pg_temp.persona(p) END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.p1_k(p text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT pg_temp.sid('p01:' || p); $$;

CREATE OR REPLACE FUNCTION pg_temp.p1_pid(p text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT pg_temp.p1_k('project:' || p); $$;

CREATE OR REPLACE FUNCTION pg_temp.p1_stg(p text, n integer) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT pg_temp.p1_k('stage:' || p || ':' || n); $$;

CREATE OR REPLACE FUNCTION pg_temp.p1_tkt(p text, t text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT pg_temp.p1_k('ticket:' || p || ':' || t); $$;

CREATE OR REPLACE FUNCTION pg_temp.p1_biz(p text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT pg_temp.p1_k('business:' || p); $$;

CREATE OR REPLACE FUNCTION pg_temp.p1_team(p text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT pg_temp.p1_k('team:' || p); $$;

/** Days before now. Negative is the future. */
CREATE OR REPLACE FUNCTION pg_temp.p1_ago(p numeric) RETURNS timestamptz
LANGUAGE sql STABLE AS $$ SELECT now() - make_interval(secs => (p * 86400)::double precision); $$;

/** A deadline: `today` is late this evening on the target's own clock, a number is days from now. */
CREATE OR REPLACE FUNCTION pg_temp.p1_day(p text) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN p IS NULL THEN NULL
        WHEN p = 'today' THEN (date_trunc('day', now() AT TIME ZONE z) + interval '23 hours 30 minutes') AT TIME ZONE z
        ELSE pg_temp.p1_ago(-(p::numeric))
    END
    FROM (SELECT COALESCE((SELECT timezone FROM org.users_public WHERE user_id = pg_temp.me()), 'UTC') AS z) x;
$$;

/** A jsonb array of strings as text[]. */
CREATE OR REPLACE FUNCTION pg_temp.p1_arr(p jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p IS NULL THEN '{}'::text[]
                ELSE ARRAY(SELECT jsonb_array_elements_text(p)) END;
$$;

/** One of this script's blueprints (`own:x`), or a seeded one by title. */
CREATE OR REPLACE FUNCTION pg_temp.p1_blueprint(p text) RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN p IS NULL THEN NULL
        WHEN p LIKE 'own:%' THEN pg_temp.p1_k('blueprint:' || substr(p, 5))
        ELSE (SELECT b.id FROM marketplace.service_blueprints b WHERE b.title = p AND b.is_published LIMIT 1)
    END;
$$;

/** A handle other accounts cannot collide with. */
CREATE OR REPLACE FUNCTION pg_temp.p1_handle(p text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT p || '-' || substr(pg_temp.me()::text, 1, 4); $$;
-- #endregion

-- #region Spec tables
-- Everything below reads these, so each fact about the world is stated once. They live for the
-- transaction; a second pass in the same session reloads them.
CREATE TEMP TABLE IF NOT EXISTS p01_project (
    key text PRIMARY KEY, title text, brief text, owner text, biz text, format text, structure text,
    status text, vis text, budget bigint, created numeric, activity numeric, o jsonb NOT NULL DEFAULT '{}',
    cur text GENERATED ALWAYS AS (COALESCE(o ->> 'cur', 'USD')) STORED
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_stage (
    project text, n integer, name text, brief text, status text, price bigint,
    o jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (project, n)
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_ticket (
    project text, key text, n integer, title text, brief text, status text, priority text,
    intensity numeric, assignee text, claimed numeric, due text, payment text, tasks text[],
    o jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (project, key)
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_assign (
    project text, n integer, kind text, who text, status text, days numeric
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_member (
    project text, who text, role text, manage boolean, days numeric
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_invite (
    project text, n integer, who text, email text, role text, status text, offer bigint, message text,
    by_who text, days numeric, placeholder boolean, expires numeric, dismissed boolean
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_seat (
    key text, project text, n integer, need text, lo bigint, hi bigint, proposals boolean, status text,
    filled_by text, skills text[]
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_role (
    key text, project text, n integer, title text, qty integer, btype text, amount bigint, skills text[],
    note text, proposals boolean
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_application (
    key text, project text, target_type text, target text, who text, team text, status text,
    message text, days numeric, via_link text
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_submission (
    key text, project text, n integer, ticket text, by_who text, title text, notes text, status text,
    num integer, days numeric, reviewer text, feedback text, revision_of text, file_from text
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_revision (
    key text, project text, n integer, ticket text, by_who text, kind text, reason text, status text,
    submission text, price bigint, days numeric, resolved numeric
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_cohort (
    key text, project text, n integer, name text, seats integer, status text
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_seat_taken (
    key text, cohort text, who text, seats integer, status text, days numeric, cancelled numeric
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_sitting (
    key text, cohort text, title text, starts numeric, minutes integer, status text
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_escrow (
    key text PRIMARY KEY, project text, n integer, ticket text, ptype text, payee text, status text,
    funded numeric, released numeric, o jsonb NOT NULL DEFAULT '{}',
    amount bigint, cur text, payer text
) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS p01_topup (
    key text, otype text, owner_key text, cur text, amount bigint, days numeric, note text
) ON COMMIT DROP;
TRUNCATE p01_project, p01_stage, p01_ticket, p01_assign, p01_member, p01_invite, p01_seat, p01_role,
    p01_application, p01_submission, p01_revision, p01_cohort, p01_seat_taken, p01_sitting, p01_escrow,
    p01_topup;
-- #endregion

-- #region Spec: projects
-- `o` carries whatever a project sets beyond the defaults. A draft is stored unlisted; `pub` is where
-- it means to sit once it publishes. Every project status appears at least once, and so does every
-- format and structure pair the schema allows.
INSERT INTO p01_project (key, title, brief, owner, biz, format, structure, status, vis, budget, created, activity, o) VALUES
-- The target as an individual client
('draft-empty', 'New project', '', 'me', NULL, 'pipeline', 'standard', 'draft', 'unlisted', NULL, 0.08, 0.08, '{}'),
('draft-outline', 'Neighbourhood clinic website rebuild',
 'Patient-first rebuild of the clinic site: appointment journeys, clinician pages and a plain-language health library. Scope still being shaped with the practice managers.',
 'me', NULL, 'pipeline', 'standard', 'draft', 'unlisted', 2400000, 9, 1.2, '{"pub":"public","start":21,"langs":["English"],"places":["Remote"]}'),
('draft-longtitle', 'Multi-region customer onboarding overhaul: discovery, information architecture, localisation for eleven markets, accessibility fixes and launch support',
 'One master ticket carried across the whole programme, kept deliberately broad until the regional leads sign off the market list.',
 'me', NULL, 'one_off', 'one_off', 'draft', 'unlisted', 9500000, 3, 3, '{"pub":"invite_only"}'),
('task-unfunded', 'Translate the onboarding emails into Arabic and French',
 'Six transactional emails, tone matched to the English originals, with a short glossary for future sends.',
 'me', NULL, 'one_off', 'single_task', 'active', 'unlisted', 48000, 18, 2, '{"langs":["Arabic","French"],"ip":"licensed_use"}'),
('oneoff-master', 'Founder keynote deck for the spring summit',
 'A forty-minute keynote: narrative outline, storyboard and a final deck the founder can present without a clicker rehearsal.',
 'me', NULL, 'one_off', 'one_off', 'active', 'public', 320000, 26, 4, '{"start":-20,"nda":"platform","starred":true}'),
('oneoff-flat-hold', 'Café Olé — menu & signage (قائمة الطعام)',
 'Bilingual menu boards and window signage for the Jumeirah branch. Paused while the landlord approves the shopfront.',
 'me', NULL, 'one_off', 'single_stage', 'on_hold', 'invite_only', 145000, 64, 31, '{"langs":["English","Arabic"],"places":["United Arab Emirates"]}'),
('pipeline-flat-hourly', 'Ongoing newsletter production',
 'A standing fortnightly newsletter: research, draft, edit and send. Billed against a monthly ceiling rather than a fixed fee.',
 'me', NULL, 'pipeline', 'single_stage', 'active', 'invite_only', 120000, 96, 6, '{"btype":"hourly_cap","timeline":"custom"}'),
('many-stages', 'Twelve-month content calendar for the clinic group',
 'One stage for each month of the year, plus a kickoff and a wrap-up, so each month can be staffed and approved on its own.',
 'me', NULL, 'pipeline', 'standard', 'active', 'unlisted', NULL, 40, 0.6, '{"timeline":"staggered","start":-30}'),
('own-cancelled', 'Pop-up shop fit-out',
 'Temporary fit-out for a six-week retail pop-up. Called off when the unit fell through.',
 'me', NULL, 'pipeline', 'standard', 'cancelled', 'invite_only', 680000, 120, 88, '{}'),
('own-archived', 'Podcast rebrand idea', 'Early notes on renaming the podcast. Put away unpublished.',
 'me', NULL, 'pipeline', 'standard', 'archived', 'unlisted', NULL, 210, 180, '{}'),
('personal-planner', 'Portfolio rebuild — my own to-do list',
 'Private planning board for refreshing the portfolio: case studies, photography and the new about page.',
 'me', NULL, 'pipeline', 'standard', 'draft', 'invite_only', NULL, 55, 0.4, '{"personal":true,"starred":true}'),
('personal-task', 'Renew professional indemnity insurance', 'A one-line reminder with the broker''s checklist.',
 'me', NULL, 'one_off', 'single_task', 'draft', 'invite_only', NULL, 12, 12, '{"personal":true}'),
-- The target as a client through their own business
('biz-rollout', 'Harvest season brand rollout',
 'Key visual, retail toolkit, campaign copy and lifecycle emails for the autumn range, delivered stage by stage ahead of the September shelf reset.',
 'me', 'b3', 'pipeline', 'standard', 'active', 'public', 2150000, 72, 0.3, '{"cur":"EUR","bonus":true,"start":-65,"starred":true,"nda":"platform"}'),
('biz-paused', 'Customer portal accessibility audit',
 'WCAG 2.2 AA audit of the customer portal with a prioritised fix list. On hold until the vendor ships the new navigation.',
 'me', 'b3', 'pipeline', 'standard', 'on_hold', 'invite_only', 700000, 58, 16, '{"auto":"off"}'),
('biz-done', 'Annual report and data storytelling',
 'Design and data storytelling for the annual report: structure, chart system and print-ready artwork. Delivered and handed over.',
 'me', 'b3', 'pipeline', 'standard', 'completed', 'public', 700000, 240, 112, '{"cur":"EUR","portfolio":"allowed","ip":"exclusive_transfer"}'),
('biz-hiring', 'Mobile field-sales app',
 'A native field-sales app for the regional team: discovery, build and a staged rollout. Hiring across all three stages now.',
 'me', 'b3', 'pipeline', 'standard', 'active', 'public', 3400000, 11, 0.2, '{"auto":"add_to_basket","start":14,"places":["Remote"],"langs":["English"],"skills":["typescript","react-native","swift"]}'),
('biz-autofund', 'Always-on social clips',
 'A rolling queue of short social clips. The business wallet funds each ticket as it reaches the top of the queue.',
 'me', 'b3', 'pipeline', 'standard', 'active', 'unlisted', 500000, 37, 1.1, '{"auto":"from_wallet"}'),
('biz-nda', 'Acquisition data room clean-up',
 'Restructure and redact the data room ahead of diligence. The client''s own NDA has been agreed in principle and still has to be uploaded.',
 'me', 'b3', 'one_off', 'single_stage', 'active', 'invite_only', 420000, 8, 0.9, '{"nda":"custom","ip":"licensed_use","portfolio":"forbidden","places":["United Arab Emirates","United Kingdom"],"langs":["English","Arabic"]}'),
('biz-nda-doc', 'Supplier contract review',
 'Plain-language summaries of forty supplier contracts, under the mutual NDA already on file.',
 'me', 'b3', 'pipeline', 'single_stage', 'active', 'invite_only', 260000, 15, 5, '{"nda":"custom-doc","ip":"shared_ownership","portfolio":"embargoed"}'),
('biz-draft', 'Spring catalogue photography',
 'Studio and location photography for sixty products. Budget to be agreed once the shot list settles.',
 'me', 'b3', 'pipeline', 'standard', 'draft', 'unlisted', NULL, 4, 1.5, '{"auto":"add_to_basket","pub":"unlisted","ip":"projective_partner"}'),
-- Team and enterprise workspaces
('team-draft', 'Open-source starter kit', 'Publish the studio''s project starter as a public template.',
 'me', NULL, 'pipeline', 'standard', 'draft', 'unlisted', NULL, 6, 6, '{"team":"t2","pub":"public"}'),
('team-active', 'Studio website refresh', 'New case-study layout and a lighter home page for the studio.',
 'me', NULL, 'one_off', 'one_off', 'active', 'unlisted', 180000, 33, 2.5, '{"team":"t2"}'),
('team-internal', 'Pitch deck template', 'A reusable pitch deck the whole collective can present from.',
 'saoirsebyrne', NULL, 'one_off', 'single_task', 'active', 'invite_only', 90000, 21, 3.2, '{"team":"t1"}'),
('ent-rollout', 'Group-wide design tokens rollout',
 'Move four subsidiaries onto one token set, one department at a time.',
 'me', NULL, 'pipeline', 'standard', 'active', 'invite_only', 5200000, 44, 2.1, '{"ent":"e1","timeline":"simultaneous"}'),
-- The target hired on a stage
('hired-progress', 'Loyalty app checkout rebuild',
 'Rebuild checkout for the loyalty app: flows first, then the build, then a measured rollout.',
 'priyaraman', 'b1', 'pipeline', 'standard', 'active', 'public', 960000, 84, 0.15, '{"bonus":true,"start":-80,"starred":true,"skills":["ux","prototyping"]}'),
('hired-review', 'Menu engineering microsite',
 'A small microsite that explains the new menu engineering service, from brief to launch.',
 'priyaraman', 'b1', 'one_off', 'one_off', 'active', 'unlisted', 180000, 28, 0.7, '{"bonus":true}'),
('hired-revisions', 'Investor portal redesign',
 'Redesign the investor portal: information architecture, then the visual system. Tight feedback loop with the IR team.',
 'danielokafor', 'b2', 'pipeline', 'standard', 'active', 'invite_only', 500000, 52, 0.5, '{"cur":"GBP","nda":"platform","bonus":true}'),
('hired-paid-round', 'Retail kiosk UI kit',
 'A touch-first UI kit for in-store kiosks, with one free revision round per stage and extra rounds at a fixed price.',
 'danielokafor', 'b2', 'one_off', 'single_task', 'active', 'unlisted', 300000, 23, 1, '{}'),
('hired-closed', 'Field-service scheduling dashboard',
 'Dispatcher dashboard for field engineers: research, build and handover. Finished and running in production.',
 'danielokafor', 'b2', 'pipeline', 'standard', 'completed', 'public', 1000000, 196, 74, '{"starred":false,"portfolio":"allowed"}'),
('hired-removed', 'Loyalty email templates',
 'Modular email templates for the loyalty programme. The first stage was reassigned part-way through.',
 'priyaraman', 'b1', 'pipeline', 'standard', 'active', 'invite_only', 420000, 47, 9, '{}'),
('hired-chain', 'Recipe video series',
 'One master ticket carried from pre-production into the edit, each milestone funded as the last is approved.',
 'priyaraman', 'b1', 'one_off', 'one_off', 'active', 'unlisted', 250000, 39, 3, '{}'),
('hired-overdue', 'Legacy CRM data migration',
 'Move twelve years of CRM records into the new platform with a reconciled audit trail. The cut-over date has slipped well past plan.',
 'danielokafor', 'b2', 'pipeline', 'single_stage', 'active', 'invite_only', 500000, 168, 22, '{"bonus":true,"start":-160}'),
('hired-today', 'Black Friday landing pages',
 'Twelve landing pages that have to be live before the campaign starts tonight.',
 'priyaraman', 'b1', 'one_off', 'single_task', 'active', 'unlisted', 220000, 14, 0.05, '{"bonus":true,"starred":true}'),
('hired-nodue', 'Studio moodboard library',
 'An evolving moodboard library for the studio. No fixed end date; work carries on as references come in.',
 'noor', NULL, 'one_off', 'single_stage', 'active', 'invite_only', 95000, 19, 7, '{}'),
('hired-workload', 'Warehouse barcode scanner integration',
 'Wire the handheld scanners into the stock system. The scope turned out larger than the ticket claimed, and a workload report is open.',
 'priyaraman', 'b1', 'pipeline', 'standard', 'active', 'invite_only', 700000, 31, 1.3, '{}'),
('hired-claimed', 'Conference badge generator',
 'A small tool that turns the attendee export into print-ready badges.',
 'danielokafor', 'b2', 'one_off', 'single_task', 'active', 'unlisted', 60000, 6, 0.1, '{}'),
('hired-cancelled', 'Seasonal gift-card campaign',
 'Gift-card artwork and landing page. The client cancelled before work started and the escrow went back.',
 'priyaraman', 'b1', 'one_off', 'one_off', 'cancelled', 'unlisted', 140000, 90, 66, '{}'),
('hired-hold', 'Membership pricing research',
 'Pricing interviews and a recommendation for the membership tiers. Paused while the board reviews the strategy.',
 'danielokafor', 'b2', 'one_off', 'single_stage', 'on_hold', 'invite_only', 160000, 35, 12, '{"cur":"GBP"}'),
('hired-archived', 'Café loyalty card concept',
 'An early loyalty concept that never went ahead.',
 'theo', NULL, 'one_off', 'single_task', 'archived', 'unlisted', 40000, 150, 130, '{}'),
-- The target on a hired team
('seat-active', 'Logistics control tower',
 'A live operations view across carriers and depots, built by the collective stage by stage.',
 'danielokafor', 'b2', 'pipeline', 'standard', 'active', 'public', 1300000, 110, 0.4, '{"starred":true}'),
('seat-own-team', 'Brand film for the harbour festival',
 'A ninety-second brand film, from treatment to final grade, made by the studio.',
 'priyaraman', 'b1', 'pipeline', 'standard', 'active', 'unlisted', 700000, 77, 1.6, '{}'),
-- Seats that are not delivery seats
('role-admin', 'Haddad Studio print collateral',
 'Business cards, letterhead and a capabilities booklet. The target runs the roster for the studio.',
 'noor', NULL, 'pipeline', 'standard', 'active', 'invite_only', 310000, 49, 2.8, '{}'),
('role-manager', 'Almeida Coffee subscription launch',
 'Launch the coffee subscription: offer, packaging inserts and the first three shipments. The target manages tickets for the client.',
 'theo', NULL, 'pipeline', 'standard', 'active', 'invite_only', 450000, 29, 1.9, '{}'),
('role-member', 'Marram quarterly planning',
 'Quarterly planning board. The target sits in as a contributor with no seat on a stage.',
 'priyaraman', 'b1', 'pipeline', 'standard', 'active', 'invite_only', NULL, 17, 4.5, '{}'),
('role-guest', 'Lumenforge vendor review',
 'Annual review of the agency roster. The target has guest access to read along.',
 'danielokafor', 'b2', 'one_off', 'one_off', 'active', 'invite_only', NULL, 10, 8, '{}'),
-- The target as a prospect: invited or applied, not hired
('prospect-invite', 'Sustainability report design',
 'Design the first public sustainability report, from data structure to accessible PDF.',
 'priyaraman', 'b1', 'pipeline', 'standard', 'active', 'public', 620000, 7, 1, '{}'),
('prospect-placeholder', 'Almeida Coffee gift box concept',
 'A premium gift box for the holiday range. The founder is lining people up before publishing.',
 'theo', NULL, 'one_off', 'one_off', 'draft', 'unlisted', NULL, 5, 2, '{"pub":"public"}'),
('prospect-declined', 'Robotics trade-show booth',
 'Stand design and motion graphics for a robotics trade show.',
 'danielokafor', 'b2', 'pipeline', 'standard', 'active', 'public', 840000, 25, 13, '{}'),
('prospect-apps', 'Marketplace seller onboarding',
 'Rework seller onboarding for the marketplace, with open seats across research, content and design.',
 'priyaraman', 'b1', 'pipeline', 'standard', 'active', 'public', 1150000, 20, 0.8, '{}'),
-- Sessions
('sess-one', 'Portfolio critique, 1-on-1',
 'One-to-one critique sessions, booked singly or as a block.',
 'me', NULL, 'session', 'standard', 'active', 'unlisted', NULL, 98, 0.25, '{"kind":"normal","blueprint":"own:one"}'),
('sess-group', 'Design critique circle',
 'A small group that meets weekly to critique live work, in cohorts of eight.',
 'me', NULL, 'session', 'standard', 'active', 'unlisted', NULL, 92, 0.35, '{"kind":"group","blueprint":"own:group"}'),
('sess-orphan-one', 'Weekly mentoring, listing withdrawn',
 'A mentoring engagement whose listing has been removed; the booked sessions carry on.',
 'me', NULL, 'session', 'standard', 'active', 'unlisted', NULL, 36, 2.2, '{"kind":"normal"}'),
('sess-orphan-group', 'Accessibility clinic, listing withdrawn',
 'A group clinic whose listing has been removed. The next cohort has sittings on the calendar and no seats taken yet.',
 'me', NULL, 'session', 'standard', 'active', 'unlisted', NULL, 16, 3.4, '{"kind":"group"}'),
('sess-seat', 'Design systems masterclass',
 'A four-week masterclass. The target holds a seat in the current cohort.',
 'marisdelacroix', NULL, 'session', 'standard', 'active', 'unlisted', NULL, 30, 2.7, '{"kind":"group","blueprint":"own:masterclass"}'),
-- Instantiated from a service listing
('svc-bought', 'Design-system foundation',
 'Instantiated from the listing and waiting to be funded.',
 'me', NULL, 'pipeline', 'standard', 'draft', 'unlisted', 1200000, 3, 0.9, '{"blueprint":"Design-system foundation","pub":"invite_only","instantiated":true}'),
('svc-provider', 'Conversion audit and fixes',
 'A productised audit bought from the target''s own listing: audit, then a fix sprint.',
 'priyaraman', 'b1', 'pipeline', 'standard', 'active', 'unlisted', 400000, 24, 0.55, '{"blueprint":"own:audit","instantiated":true}'),
('svc-stale', 'Landing page in a week',
 'Added from the listing, never configured, and swept away after thirty idle days.',
 'me', NULL, 'one_off', 'one_off', 'archived', 'unlisted', 150000, 75, 45, '{"blueprint":"Landing page in a week","instantiated":true}');
-- #endregion

-- #region Spec: stages
-- `o`: skills · due (days from now, or `today`) · days (a relative duration) · nodue · trigger + start ·
-- dep + lag · seat_limit · capacity + seats · hire · chain · parallel · nda · upload · ext · cats ·
-- revisions + extra + used · milestone · done (completed, days ago) · mode · cap · ip · minutes · count.
INSERT INTO p01_stage (project, n, name, brief, status, price, o) VALUES
('draft-outline', 1, 'Patient journeys', 'Map the five journeys that drive most calls to reception.', 'open', 400000, '{"skills":["ux-research","user-interviews"],"days":14}'),
('draft-outline', 2, 'Design and content', 'Page templates and plain-language content for the health library.', 'open', 900000, '{"skills":["ux","ux-writing"],"trigger":"dependent_on_stage","dep":1,"lag":3}'),
('draft-outline', 3, 'Build and launch', 'Build on the clinic''s CMS and launch with redirects in place.', 'open', 1100000, '{"skills":["typescript"],"trigger":"on_hire_confirmed"}'),
('draft-longtitle', 1, 'Discovery', 'Market list, stakeholder interviews and a shared definition of done.', 'open', 2500000, '{}'),
('draft-longtitle', 2, 'Localisation', 'Eleven markets, one source of truth for strings.', 'open', 4000000, '{}'),
('draft-longtitle', 3, 'Launch support', 'Staged launch with a named contact in each region.', 'open', 3000000, '{}'),
('task-unfunded', 1, 'Delivery', 'The translated emails and the glossary.', 'assigned', 48000, '{"ext":[".docx",".md"]}'),
('oneoff-master', 1, 'Narrative outline', 'Agree the argument and the three stories that carry it.', 'open', 80000, '{"milestone":"Outline approved"}'),
('oneoff-master', 2, 'Storyboard', 'Slide-by-slide storyboard with speaker notes.', 'open', 120000, '{"milestone":"Storyboard approved"}'),
('oneoff-master', 3, 'Final deck', 'Final artwork and a rehearsal copy.', 'open', 120000, '{"milestone":"Deck delivered","due":58}'),
('oneoff-flat-hold', 1, 'Delivery', 'Print-ready menu boards and window vinyls.', 'assigned', 145000, '{"cats":["Image","Vector"]}'),
('pipeline-flat-hourly', 1, 'Editorial', 'Research, drafting and editing for each issue.', 'open', NULL, '{"nodue":true,"mode":"manual"}'),
('own-cancelled', 1, 'Concept and layout', 'Layout, materials and a costed plan.', 'cancelled', 280000, '{}'),
('own-cancelled', 2, 'Build supervision', 'On-site supervision through install.', 'cancelled', 400000, '{}'),
('own-archived', 1, 'Delivery', 'Naming routes.', 'open', NULL, '{}'),
('personal-planner', 1, 'Case studies', 'Three case studies rewritten.', 'in_progress', NULL, '{}'),
('personal-planner', 2, 'Photography', 'New working shots.', 'open', NULL, '{}'),
('personal-planner', 3, 'About page', 'A shorter about page.', 'open', NULL, '{}'),
('personal-task', 1, 'Delivery', 'Broker checklist.', 'open', NULL, '{}'),
('biz-rollout', 1, 'Key visual', 'The seasonal key visual and type lockup.', 'paid', 400000, '{"skills":["art-direction","motion-design"],"done":40}'),
('biz-rollout', 2, 'Retail toolkit', 'Shelf-talkers, wobblers and a window kit.', 'in_progress', 600000, '{"skills":["branding"],"due":9,"revisions":2}'),
('biz-rollout', 3, 'Campaign copy', 'Headlines and product copy for nine SKUs.', 'submitted', 350000, '{"skills":["copywriting","brand-voice"]}'),
('biz-rollout', 4, 'Lifecycle emails', 'A six-email seasonal sequence.', 'assigned', 450000, '{"skills":["copywriting"],"trigger":"dependent_on_stage","dep":3,"chain":false}'),
('biz-rollout', 5, 'Results readout', 'A measured readout after the first four weeks.', 'open', 350000, '{"skills":["ux-research"],"trigger":"fixed_date","start":45}'),
('biz-paused', 1, 'Automated and manual audit', 'Screen reader, keyboard and contrast testing across the portal.', 'in_progress', 320000, '{"skills":["a11y"],"days":21}'),
('biz-paused', 2, 'Fix list and retest', 'A prioritised fix list and one retest.', 'open', 380000, '{"skills":["a11y"]}'),
('biz-done', 1, 'Structure', 'Narrative and page plan.', 'paid', 250000, '{"done":190,"milestone":"Accepted and paid"}'),
('biz-done', 2, 'Chart system', 'A chart system for the data pages.', 'paid', 300000, '{"done":150,"milestone":"Accepted and paid"}'),
('biz-done', 3, 'Print artwork', 'Final artwork, proofed.', 'paid', 150000, '{"done":115,"milestone":"Accepted and paid"}'),
('biz-hiring', 1, 'Field discovery', 'Ride-alongs with six reps and a synthesis of what slows them down.', 'open', 600000, '{"skills":["ux-research"],"capacity":"limited","seats":2,"mode":"manual"}'),
('biz-hiring', 2, 'iOS and Android build', 'A shared core with native shells.', 'open', 2200000, '{"skills":["react-native","swift","kotlin"],"seat_limit":null,"parallel":true,"mode":"parallel_stream","cap":4}'),
('biz-hiring', 3, 'QA and rollout', 'Device testing and a staged rollout.', 'assigned', 600000, '{"skills":["typescript"],"seat_limit":1,"mode":"round_robin","trigger":"dependent_on_stage","dep":2,"lag":2}'),
('biz-autofund', 1, 'October batch', 'Twelve clips for October.', 'approved', 90000, '{"skills":["motion-design"]}'),
('biz-autofund', 2, 'November batch', 'Twelve clips for November.', 'in_progress', 90000, '{"skills":["motion-design"]}'),
('biz-autofund', 3, 'December batch', 'Twelve clips for December.', 'assigned', 90000, '{"skills":["motion-design"]}'),
('biz-nda', 1, 'Delivery', 'Restructured folders and a redaction log.', 'assigned', 420000, '{"nda":true,"cats":["Document","Spreadsheet"],"ip":"licensed_use"}'),
('biz-nda-doc', 1, 'Delivery', 'Summaries in the agreed template.', 'open', 260000, '{"ext":[".docx",".pdf"],"nda":true,"hire":false}'),
('biz-draft', 1, 'Shot list', 'Agree the sixty-product shot list.', 'open', NULL, '{}'),
('biz-draft', 2, 'Studio days', 'Three studio days and retouching.', 'open', NULL, '{"upload":true}'),
('team-draft', 1, 'Clean-up', 'Strip client code and write the README.', 'open', NULL, '{}'),
('team-active', 1, 'Layouts', 'Home and case-study layouts.', 'open', 80000, '{}'),
('team-active', 2, 'Build', 'Build and launch.', 'open', 100000, '{}'),
('team-internal', 1, 'Delivery', 'Master deck with six layouts.', 'open', 90000, '{}'),
('ent-rollout', 1, 'Token audit', 'Audit tokens across the four subsidiaries.', 'open', 1200000, '{"skills":["design-systems"]}'),
('ent-rollout', 2, 'Migration waves', 'Migrate one department at a time.', 'open', 4000000, '{"skills":["design-systems","typescript"],"parallel":true}'),
('hired-progress', 1, 'Flows and prototype', 'Checkout flows and a clickable prototype.', 'paid', 240000, '{"skills":["ux","prototyping"],"done":44,"milestone":"Accepted and paid"}'),
('hired-progress', 2, 'Checkout build', 'Build the new checkout behind a flag.', 'in_progress', 360000, '{"skills":["typescript","preact"],"due":6}'),
('hired-progress', 3, 'Measured rollout', 'Roll out to ten, then fifty, then all users.', 'open', 360000, '{"skills":["typescript"],"trigger":"dependent_on_stage","dep":2}'),
('hired-review', 1, 'Content and design', 'Page copy and layouts.', 'submitted', 180000, '{"due":3,"milestone":"Awaiting approval"}'),
('hired-review', 2, 'Launch', 'Publish and hand over.', 'open', NULL, '{"milestone":"Live"}'),
('hired-revisions', 1, 'Information architecture', 'Sitemap and key journeys.', 'paid', 200000, '{"done":30,"milestone":"Accepted and paid"}'),
('hired-revisions', 2, 'Visual system', 'Visual language for the portal.', 'revisions', 300000, '{"due":4,"revisions":3,"used":2}'),
('hired-paid-round', 1, 'Delivery', 'Component library for kiosk screens.', 'in_progress', 150000, '{"revisions":1,"extra":15000,"used":1}'),
('hired-closed', 1, 'Dispatcher research', 'Shadow the dispatch team and write up the findings.', 'paid', 300000, '{"done":170,"milestone":"Accepted and paid"}'),
('hired-closed', 2, 'Dashboard build', 'The live scheduling board.', 'paid', 450000, '{"done":110,"milestone":"Accepted and paid"}'),
('hired-closed', 3, 'Handover', 'Runbook and a training session.', 'paid', 250000, '{"done":76,"milestone":"Accepted and paid"}'),
('hired-removed', 1, 'Template system', 'A modular template system.', 'open', 120000, '{}'),
('hired-removed', 2, 'QA across clients', 'Render testing across mail clients.', 'assigned', 300000, '{}'),
('hired-chain', 1, 'Pre-production', 'Recipes, shot lists and casting.', 'paid', 100000, '{"done":24,"milestone":"Pre-production signed off"}'),
('hired-chain', 2, 'Shoot and edit', 'Six recipe films.', 'in_progress', 150000, '{"milestone":"Final cuts"}'),
('hired-overdue', 1, 'Delivery', 'Migration runs, reconciliation and sign-off.', 'in_progress', 500000, '{"due":-97,"revisions":0,"extra":40000}'),
('hired-today', 1, 'Delivery', 'Twelve pages, live tonight.', 'in_progress', 220000, '{"due":"today"}'),
('hired-nodue', 1, 'Delivery', 'Collected references, tagged.', 'assigned', 95000, '{"nodue":true}'),
('hired-workload', 1, 'Scanner driver', 'Handheld scanner integration.', 'in_progress', 280000, '{}'),
('hired-workload', 2, 'Stock sync', 'Sync counts back to the stock system.', 'open', 420000, '{}'),
('hired-claimed', 1, 'Delivery', 'The generator and a print test.', 'assigned', 60000, '{}'),
('hired-cancelled', 1, 'Artwork', 'Gift-card artwork.', 'cancelled', 140000, '{}'),
('hired-hold', 1, 'Delivery', 'Interviews and a recommendation.', 'in_progress', 160000, '{}'),
('hired-archived', 1, 'Delivery', 'Concept routes.', 'cancelled', 40000, '{}'),
('seat-active', 1, 'Data foundation', 'Carrier feeds and the event model.', 'paid', 600000, '{"done":50,"milestone":"Accepted and paid","skills":["postgres","realtime"]}'),
('seat-active', 2, 'Live board', 'The control-tower view.', 'in_progress', 700000, '{"skills":["typescript","realtime"]}'),
('seat-own-team', 1, 'Treatment', 'Treatment and script.', 'paid', 400000, '{"done":38,"milestone":"Accepted and paid"}'),
('seat-own-team', 2, 'Production and grade', 'Shoot, edit and grade.', 'submitted', 300000, '{}'),
('role-admin', 1, 'Identity applications', 'Cards, letterhead and templates.', 'assigned', 110000, '{}'),
('role-admin', 2, 'Capabilities booklet', 'A sixteen-page booklet.', 'open', 200000, '{}'),
('role-manager', 1, 'Offer and pricing', 'Subscription tiers and the offer page.', 'assigned', 200000, '{}'),
('role-manager', 2, 'First shipments', 'Inserts and fulfilment notes.', 'open', 250000, '{}'),
('role-member', 1, 'Planning', 'Quarterly goals and owners.', 'open', NULL, '{}'),
('role-guest', 1, 'Review', 'Scorecards for each agency.', 'open', NULL, '{}'),
('prospect-invite', 1, 'Data structure', 'Structure the disclosures.', 'open', 220000, '{"skills":["editorial-design"]}'),
('prospect-invite', 2, 'Design and PDF', 'Design and accessible PDF.', 'open', 400000, '{"skills":["editorial-design","a11y"]}'),
('prospect-placeholder', 1, 'Concept', 'Box structure and artwork routes.', 'open', NULL, '{}'),
('prospect-declined', 1, 'Stand design', 'Stand design and costings.', 'assigned', 500000, '{"skills":["art-direction"]}'),
('prospect-declined', 2, 'Motion graphics', 'Looping screens for the stand.', 'open', 340000, '{"skills":["motion-design"]}'),
('prospect-declined', 3, 'Print and signage', 'Large-format artwork.', 'open', NULL, '{}'),
('prospect-apps', 1, 'Seller research', 'Interview twenty sellers.', 'open', 350000, '{"skills":["ux-research","user-interviews"]}'),
('prospect-apps', 2, 'Content design', 'Rewrite onboarding content.', 'open', 300000, '{"skills":["ux-writing"]}'),
('prospect-apps', 3, 'Product design', 'New onboarding flows.', 'open', 500000, '{"skills":["ux","figma"]}'),
('sess-one', 1, 'Sessions', 'Booked sessions.', 'in_progress', 18000, '{"minutes":60,"count":1}'),
('sess-group', 1, 'Sessions', 'Cohort sittings.', 'in_progress', 9000, '{"minutes":90,"count":6}'),
('sess-orphan-one', 1, 'Sessions', 'Booked sessions.', 'in_progress', 15000, '{"minutes":45,"count":1}'),
('sess-orphan-group', 1, 'Sessions', 'Cohort sittings.', 'open', 6000, '{"minutes":60,"count":3}'),
('sess-seat', 1, 'Sessions', 'Cohort sittings.', 'in_progress', 30000, '{"minutes":120,"count":4}'),
('svc-bought', 1, 'Audit and tokens', 'Audit the UI and define the tokens.', 'open', 500000, '{}'),
('svc-bought', 2, 'Core components', 'The first twelve components.', 'open', 700000, '{}'),
('svc-provider', 1, 'Audit', 'Heuristic and funnel audit.', 'paid', 150000, '{"done":12,"milestone":"Accepted and paid"}'),
('svc-provider', 2, 'Fix sprint', 'Ship the top ten fixes.', 'in_progress', 250000, '{}'),
('svc-stale', 1, 'Delivery', 'One landing page.', 'open', 150000, '{}');

-- Fourteen stages on one project: the longest run a list has to draw.
INSERT INTO p01_stage (project, n, name, brief, status, price, o)
SELECT 'many-stages', m.n, m.name, 'Plan, write and schedule this stretch of the calendar.',
       'open', NULL, '{}'
  FROM unnest(ARRAY['Kickoff', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                    'September', 'October', 'November', 'December', 'Year-end wrap-up'])
       WITH ORDINALITY AS m(name, n);
-- #endregion

-- #region Spec: tickets
-- `tasks`: a leading + is done, - is open. `o.stages` is a multi-stage ticket's required run.
INSERT INTO p01_ticket (project, key, n, title, brief, status, priority, intensity, assignee, claimed, due, payment, tasks, o) VALUES
('task-unfunded', 't1', 1, 'Translate six onboarding emails', 'All six emails, in both languages, with the glossary.', 'todo', 'normal', 1, NULL, NULL, NULL, 'needs_funding', ARRAY['-Draft Arabic', '-Draft French', '-Glossary'], '{}'),
('oneoff-master', 't1', 1, 'Summit keynote', 'The master ticket for the keynote, carried through outline, storyboard and final deck.', 'backlog', 'high', 1, NULL, NULL, NULL, 'unpaid', ARRAY['-Agree the argument'], '{"stages":[1,2,3]}'),
('oneoff-flat-hold', 't1', 1, 'Menu boards and vinyls', 'Artwork for four boards and two window vinyls.', 'todo', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY['-Confirm sizes with the landlord'], '{}'),
('pipeline-flat-hourly', 't1', 1, 'Issue 41', 'The next issue, from research to send.', 'todo', 'normal', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY['-Pick the lead story'], '{}'),
('pipeline-flat-hourly', 't2', 1, 'Issue 42', 'Placeholder for the following issue.', 'backlog', 'low', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('pipeline-flat-hourly', 't3', 1, 'Sponsor spotlight', 'Dropped when the sponsor pulled out.', 'cancelled', 'low', 0.25, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('many-stages', 't1', 1, 'Editorial themes for the year', 'Twelve themes agreed with the clinical leads.', 'backlog', 'urgent', 2, NULL, NULL, NULL, 'unpaid', ARRAY['-Workshop with clinical leads'], '{}'),
('own-cancelled', 't1', 1, 'Costed layout', 'Layout and costings.', 'cancelled', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('personal-planner', 't1', 1, 'Rewrite the checkout case study', 'Lead with the outcome.', 'in_progress', 'high', 0.5, 'me', 6, NULL, 'unpaid', ARRAY['+Outline', '-First draft'], '{}'),
('personal-planner', 't2', 2, 'Book a photographer', 'Half a day is enough.', 'todo', 'normal', 0.25, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('personal-planner', 't3', 1, 'Collect old screenshots', 'From the archive drive.', 'completed', 'low', 0.25, 'me', 20, NULL, 'unpaid', ARRAY['+Find the drive', '+Sort by project'], '{}'),
('personal-task', 't1', 1, 'Send the renewal form', 'Before the policy lapses.', 'todo', 'high', 0.25, NULL, NULL, NULL, 'unpaid', ARRAY['-Fill in turnover'], '{}'),
('biz-rollout', 't1', 1, 'Seasonal key visual', 'Hero artwork with type lockup and a motion sting.', 'completed', 'high', 1, 'renkoda', 56, NULL, 'released', ARRAY['+Three routes', '+Chosen route to final'], '{}'),
('biz-rollout', 't2', 2, 'Shelf-talkers and wobblers', 'Print-ready templates for the retail partners.', 'in_progress', 'normal', 1, 'juno', 12, '9', 'escrow_funded', ARRAY['+Template master', '-Partner variants', '-Print proofs'], '{}'),
('biz-rollout', 't3', 3, 'Campaign copy for nine SKUs', 'Headlines, shelf copy and alt text.', 'in_review', 'normal', 0.5, 'lenamueller', 19, '-2', 'escrow_funded', ARRAY['+Headlines', '+Shelf copy'], '{}'),
('biz-rollout', 't4', 4, 'Six-email seasonal sequence', 'Build and test the sequence.', 'todo', 'normal', 1, NULL, NULL, NULL, 'needs_funding', ARRAY['-Draft the arc'], '{}'),
('biz-rollout', 't5', 5, 'Four-week results readout', 'A short readout with what to change next year.', 'backlog', 'low', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('biz-paused', 't1', 1, 'Audit the account area', 'Screen reader and keyboard testing.', 'in_progress', 'normal', 1, 'tomaszwojcik', 30, NULL, 'escrow_funded', ARRAY['+Test plan', '-Account area'], '{}'),
('biz-paused', 't2', 2, 'Prioritised fix list', 'Waiting for the audit.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('biz-done', 't1', 1, 'Report structure', 'The narrative and page plan.', 'completed', 'normal', 1, 'renkoda', 225, NULL, 'released', ARRAY['+Page plan'], '{}'),
('biz-done', 't2', 2, 'Chart system', 'Twelve chart templates.', 'completed', 'normal', 1, 'renkoda', 188, NULL, 'released', ARRAY['+Chart templates'], '{}'),
('biz-done', 't3', 3, 'Print artwork', 'Final proofed artwork.', 'completed', 'normal', 1, 'renkoda', 148, NULL, 'released', ARRAY['+Proofs signed off'], '{}'),
('biz-hiring', 't1', 1, 'Six ride-alongs', 'Plan and run the ride-alongs.', 'backlog', 'high', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('biz-hiring', 't2', 2, 'Shared core', 'Auth, sync and offline storage.', 'backlog', 'high', 2, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('biz-hiring', 't3', 3, 'Device test matrix', 'Agree the device list.', 'todo', 'normal', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY['-List supported devices'], '{}'),
('biz-autofund', 't1', 1, 'October clips', 'Twelve clips, captioned.', 'in_review', 'normal', 0.5, 'chloewinters', 21, NULL, 'escrow_funded', ARRAY['+Scripts', '+Edits'], '{}'),
('biz-autofund', 't2', 2, 'November clips', 'Twelve clips, captioned.', 'in_progress', 'normal', 0.5, 'chloewinters', 5, NULL, 'escrow_funded', ARRAY['+Scripts', '-Edits'], '{}'),
('biz-autofund', 't3', 3, 'December clips', 'Queued; funds when it reaches the top.', 'todo', 'normal', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('biz-nda', 't1', 1, 'Redaction pass', 'Redact personal data and log every change.', 'todo', 'urgent', 1, NULL, NULL, NULL, 'needs_funding', ARRAY['-Agree the redaction rules'], '{}'),
('biz-nda-doc', 't1', 1, 'Forty contract summaries', 'Summaries in the agreed template.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('team-active', 't1', 1, 'Case-study layout', 'The master ticket for the refresh.', 'todo', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY['-Pick three case studies'], '{"stages":[1,2]}'),
('team-internal', 't1', 1, 'Master deck', 'Six layouts and speaker notes.', 'todo', 'normal', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('ent-rollout', 't1', 1, 'Token inventory', 'Inventory tokens by subsidiary.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('hired-progress', 't1', 1, 'Checkout flows and prototype', 'Annotated flows and a clickable prototype.', 'completed', 'high', 1, 'me', 72, NULL, 'released', ARRAY['+Flows', '+Prototype', '+Usability round'], '{}'),
('hired-progress', 't2', 2, 'Checkout build behind a flag', 'Build the new checkout and wire it to the flag.', 'in_progress', 'high', 1, 'me', 16, '6', 'escrow_funded', ARRAY['+Cart summary', '+Payment step', '-Error states', '-Analytics events'], '{}'),
('hired-progress', 't3', 3, 'Rollout plan', 'Define the guardrail metrics.', 'backlog', 'normal', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('hired-review', 't1', 1, 'Microsite content and design', 'Copy and layouts for five pages.', 'in_review', 'normal', 1, 'me', 13, '3', 'escrow_funded', ARRAY['+Copy', '+Layouts'], '{"stages":[1,2]}'),
('hired-revisions', 't1', 1, 'Sitemap and journeys', 'The new sitemap.', 'completed', 'normal', 1, 'me', 46, NULL, 'released', ARRAY['+Sitemap'], '{}'),
('hired-revisions', 't2', 2, 'Visual language', 'Type, colour and data display.', 'in_progress', 'high', 1, 'me', 26, '4', 'escrow_funded', ARRAY['+Type scale', '+Colour', '-Data display'], '{}'),
('hired-paid-round', 't1', 1, 'Kiosk component library', 'Touch-first components.', 'in_review', 'normal', 0.5, 'me', 17, NULL, 'escrow_funded', ARRAY['+Buttons', '+Forms', '+Basket'], '{}'),
('hired-closed', 't1', 1, 'Dispatcher research', 'Shadowing and findings.', 'completed', 'normal', 1, 'me', 188, NULL, 'released', ARRAY['+Shadowing', '+Findings'], '{}'),
('hired-closed', 't2', 2, 'Scheduling board', 'The live scheduling board.', 'completed', 'high', 2, 'me', 165, NULL, 'released', ARRAY['+Board', '+Conflict alerts'], '{}'),
('hired-closed', 't3', 3, 'Runbook and training', 'Runbook and one session.', 'completed', 'normal', 0.5, 'me', 104, NULL, 'released', ARRAY['+Runbook', '+Training'], '{}'),
('hired-removed', 't1', 1, 'Modular template system', 'Back in the pool after the target left this stage.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'partially_released', ARRAY['+Header module', '-Footer module'], '{}'),
('hired-removed', 't2', 2, 'Render tests', 'Waiting on the template system.', 'todo', 'normal', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('hired-chain', 't1', 2, 'Recipe series', 'The master ticket, now in the shoot and edit.', 'in_progress', 'normal', 0.5, 'me', 34, NULL, 'escrow_funded', ARRAY['+Recipes', '+Shot lists', '-Six films'], '{"stages":[1,2]}'),
('hired-overdue', 't1', 1, 'Full migration and reconciliation', 'Migrate, reconcile and sign off.', 'in_progress', 'urgent', 0.5, 'me', 150, '-97', 'escrow_funded', ARRAY['+Mapping', '+Trial run', '-Reconciliation', '-Sign-off'], '{}'),
('hired-today', 't1', 1, 'Twelve landing pages', 'All twelve pages live before the campaign.', 'in_progress', 'urgent', 1, 'me', 9, 'today', 'escrow_funded', ARRAY['+Template', '+Nine pages', '-Final three'], '{}'),
('hired-nodue', 't1', 1, 'Tag the references', 'Open-ended; no due date.', 'todo', 'low', 0.5, NULL, NULL, NULL, 'needs_funding', ARRAY[]::text[], '{}'),
('hired-workload', 't1', 1, 'Scanner driver integration', 'The ticket said one model; the warehouse runs three.', 'in_progress', 'high', 1, 'me', 11, NULL, 'escrow_funded', ARRAY['+First model', '-Second model', '-Third model'], '{}'),
('hired-workload', 't2', 2, 'Stock sync', 'Depends on the scanners.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('hired-claimed', 't1', 1, 'Badge generator', 'Export to print-ready badges.', 'claimed', 'normal', 0.5, 'me', 0.1, NULL, 'escrow_funded', ARRAY['-Parse the export', '-Print test'], '{}'),
('hired-cancelled', 't1', 1, 'Gift-card artwork', 'Cancelled before work started.', 'cancelled', 'normal', 0.5, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('hired-hold', 't1', 1, 'Pricing interviews', 'Twelve interviews; paused after seven.', 'in_progress', 'normal', 0.5, 'me', 25, NULL, 'escrow_funded', ARRAY['+Recruit', '-Finish interviews'], '{}'),
('hired-archived', 't1', 1, 'Concept routes', 'Never started.', 'cancelled', 'low', 0.25, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('seat-active', 't1', 1, 'Carrier event model', 'Normalise the carrier feeds.', 'completed', 'high', 1, 'me', 96, NULL, 'released', ARRAY['+Feeds', '+Model'], '{}'),
('seat-active', 't2', 2, 'Live depot board', 'The control-tower board.', 'in_progress', 'high', 0.5, 'me', 18, NULL, 'escrow_funded', ARRAY['+Depot tiles', '-Alerts'], '{"price":400000}'),
('seat-active', 't3', 2, 'Carrier latency alerts', 'Alerting for late feeds.', 'claimed', 'normal', 1, 'aikotanaka', 0.3, NULL, 'escrow_funded', ARRAY[]::text[], '{"price":300000}'),
('seat-own-team', 't1', 1, 'Treatment and script', 'Treatment and a shooting script.', 'completed', 'normal', 1, 'juno', 62, NULL, 'released', ARRAY['+Treatment', '+Script'], '{}'),
('seat-own-team', 't2', 2, 'Edit and grade', 'Final edit and grade.', 'in_review', 'normal', 1, 'juno', 28, NULL, 'escrow_funded', ARRAY['+Edit', '+Grade'], '{}'),
('role-admin', 't1', 1, 'Business cards', 'Two card designs.', 'todo', 'normal', 1, NULL, NULL, NULL, 'needs_funding', ARRAY['-Concept'], '{}'),
('role-admin', 't2', 2, 'Booklet outline', 'Outline the sixteen pages.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('role-manager', 't1', 1, 'Subscription tiers', 'Offer page and tiers.', 'todo', 'high', 1, NULL, NULL, NULL, 'needs_funding', ARRAY[]::text[], '{}'),
('role-manager', 't2', 2, 'Packaging inserts', 'Inserts for the first shipments.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('role-member', 't1', 1, 'Draft the quarter''s goals', 'First pass at the goals.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('prospect-invite', 't1', 1, 'Disclosure structure', 'Agree the disclosure structure.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('prospect-declined', 't1', 1, 'Stand concept', 'Stand concept.', 'todo', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('prospect-apps', 't1', 1, 'Seller interviews', 'Twenty interviews.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('svc-bought', 't1', 1, 'Token audit', 'Audit and tokens.', 'backlog', 'normal', 1, NULL, NULL, NULL, 'unpaid', ARRAY[]::text[], '{}'),
('svc-provider', 't1', 1, 'Funnel audit', 'Heuristic and funnel audit.', 'completed', 'normal', 0.5, 'me', 20, NULL, 'released', ARRAY['+Heuristics', '+Funnel'], '{}'),
('svc-provider', 't2', 2, 'Top ten fixes', 'Ship the top ten fixes.', 'in_progress', 'high', 0.5, 'me', 10, NULL, 'escrow_funded', ARRAY['+First five', '-Last five'], '{}');
-- #endregion

-- #region Spec: hires, roster, invitations, applications
INSERT INTO p01_assign (project, n, kind, who, status, days) VALUES
('task-unfunded', 1, 'freelancer', 'lenamueller', 'assigned', 6),
('oneoff-flat-hold', 1, 'freelancer', 'renkoda', 'assigned', 40),
('draft-outline', 1, 'freelancer', 'juno', 'pending_funding', 2),
('svc-bought', 1, 'freelancer', 'marisdelacroix', 'pending_funding', 2.8),
('biz-rollout', 1, 'freelancer', 'renkoda', 'completed', 58),
('biz-rollout', 2, 'freelancer', 'juno', 'accepted', 14),
('biz-rollout', 3, 'freelancer', 'lenamueller', 'accepted', 21),
('biz-rollout', 4, 'freelancer', 'kwamemensah', 'assigned', 3),
('biz-paused', 1, 'freelancer', 'tomaszwojcik', 'accepted', 32),
('biz-done', 1, 'freelancer', 'renkoda', 'completed', 228),
('biz-done', 2, 'freelancer', 'renkoda', 'completed', 190),
('biz-done', 3, 'freelancer', 'renkoda', 'completed', 150),
('biz-hiring', 3, 'freelancer', 'chloewinters', 'assigned', 2),
('biz-autofund', 1, 'freelancer', 'chloewinters', 'accepted', 24),
('biz-autofund', 2, 'freelancer', 'chloewinters', 'accepted', 7),
('biz-autofund', 3, 'freelancer', 'chloewinters', 'assigned', 1.5),
('biz-nda', 1, 'freelancer', 'samuelnkemelu', 'assigned', 3),
('hired-progress', 1, 'freelancer', 'me', 'completed', 74),
('hired-progress', 2, 'freelancer', 'me', 'accepted', 18),
('hired-review', 1, 'freelancer', 'me', 'accepted', 15),
('hired-revisions', 1, 'freelancer', 'me', 'completed', 48),
('hired-revisions', 2, 'freelancer', 'me', 'accepted', 28),
('hired-paid-round', 1, 'freelancer', 'me', 'accepted', 19),
('hired-closed', 1, 'freelancer', 'me', 'completed', 190),
('hired-closed', 2, 'freelancer', 'me', 'completed', 167),
('hired-closed', 3, 'freelancer', 'me', 'completed', 106),
('hired-removed', 1, 'freelancer', 'me', 'released', 36),
('hired-removed', 2, 'freelancer', 'me', 'assigned', 10),
('hired-chain', 1, 'freelancer', 'me', 'completed', 36),
('hired-chain', 2, 'freelancer', 'me', 'accepted', 24),
('hired-overdue', 1, 'freelancer', 'me', 'accepted', 152),
('hired-today', 1, 'freelancer', 'me', 'accepted', 11),
('hired-nodue', 1, 'freelancer', 'me', 'assigned', 8),
('hired-workload', 1, 'freelancer', 'me', 'accepted', 13),
('hired-claimed', 1, 'freelancer', 'me', 'assigned', 0.5),
('hired-cancelled', 1, 'freelancer', 'me', 'cancelled', 72),
('hired-hold', 1, 'freelancer', 'me', 'accepted', 27),
('hired-archived', 1, 'freelancer', 'me', 'released', 140),
('seat-active', 1, 'team', 't1', 'completed', 98),
('seat-active', 2, 'team', 't1', 'accepted', 49),
('seat-own-team', 1, 'team', 't2', 'completed', 64),
('seat-own-team', 2, 'team', 't2', 'accepted', 36),
('role-admin', 1, 'freelancer', 'lenamueller', 'assigned', 9),
('role-manager', 1, 'freelancer', 'juno', 'assigned', 4),
('prospect-declined', 1, 'freelancer', 'marisdelacroix', 'assigned', 11),
('svc-provider', 1, 'freelancer', 'me', 'completed', 22),
('svc-provider', 2, 'freelancer', 'me', 'accepted', 11);

INSERT INTO p01_member (project, who, role, manage, days) VALUES
('role-admin', 'me', 'admin', false, 45),
('role-manager', 'me', 'manager', true, 26),
('role-member', 'me', 'member', false, 15),
('role-guest', 'me', 'guest', false, 9),
('team-internal', 'me', 'member', false, 20),
('biz-rollout', 'hannahcole', 'manager', true, 40);

INSERT INTO p01_invite (project, n, who, email, role, status, offer, message, by_who, days, placeholder, expires, dismissed) VALUES
-- From the target's side as the client
('draft-outline', 1, 'juno', NULL, 'freelancer', 'accepted', 400000, 'Juno, would you take the patient journeys once we publish?', 'me', 3, true, 11, false),
('draft-outline', 2, 'marisdelacroix', NULL, 'freelancer', 'pending', NULL, 'Maris, this is still a draft, but I would love you on design and content.', 'me', 1.2, true, 12.8, false),
('biz-hiring', 2, 'samuelnkemelu', NULL, 'freelancer', 'pending', 2200000, 'Samuel, your realtime work is close to what the sync layer needs. Interested?', 'me', 1, false, 13, false),
('biz-hiring', 1, 'tomaszwojcik', NULL, 'freelancer', 'declined', 600000, 'Tomasz, would you lead the field discovery?', 'me', 8, false, 6, false),
('biz-hiring', 2, NULL, 'casey.ward@northgate-studio.example', 'freelancer', 'pending', NULL, 'Casey, here is the app we talked about. You will need an account to accept.', 'me', 0.7, false, 13.3, false),
('oneoff-master', NULL, 'lenamueller', NULL, 'freelancer', 'revoked', 320000, 'Lena, are you free to take the whole keynote?', 'me', 19, false, -5, true),
-- To the target
('hired-closed', NULL, 'me', NULL, 'freelancer', 'accepted', 1000000, 'We liked your dispatch research. Would you take the whole dashboard?', 'danielokafor', 192, false, -178, false),
('role-admin', NULL, 'me', NULL, 'admin', 'accepted', NULL, 'Would you run the roster on this for me? I am travelling for most of it.', 'noor', 46, false, -32, false),
('role-manager', NULL, 'me', NULL, 'manager', 'accepted', NULL, 'Could you manage tickets while I focus on the roastery?', 'theo', 27, false, -13, false),
('role-member', NULL, 'me', NULL, 'member', 'accepted', NULL, 'Join the planning board so you can see what is coming.', 'priyaraman', 16, false, -2, false),
('role-guest', NULL, 'me', NULL, 'guest', 'accepted', NULL, 'Read-only access to the vendor review, as discussed.', 'danielokafor', 10, false, 4, false),
('prospect-invite', 1, 'me', NULL, 'freelancer', 'pending', 220000, 'Your data storytelling is what this report needs. Would you structure the disclosures?', 'priyaraman', 1, false, 13, false),
('prospect-invite', NULL, 'me', NULL, 'manager', 'pending', NULL, 'We could also use someone to manage the whole report.', 'priyaraman', 0.4, false, 13.6, false),
('prospect-placeholder', 1, 'me', NULL, 'freelancer', 'pending', NULL, 'Nothing is published yet, but I would like you on the gift box.', 'theo', 2, true, 12, false),
('prospect-declined', 2, 'me', NULL, 'freelancer', 'declined', 340000, 'Could you take the looping screens for the stand?', 'danielokafor', 15, false, -1, false),
('prospect-declined', 1, 'me', NULL, 'freelancer', 'expired', 500000, 'Would you design the stand?', 'danielokafor', 24, false, -10, false),
('prospect-declined', NULL, 'me', NULL, 'freelancer', 'revoked', 840000, 'Offer for the whole stand, withdrawn after we split the work.', 'danielokafor', 23, false, -9, true);

INSERT INTO p01_seat (key, project, n, need, lo, hi, proposals, status, filled_by, skills) VALUES
('hiring-researcher', 'biz-hiring', 1, 'A researcher comfortable riding along with field reps and turning it into decisions.', 400000, 650000, true, 'open', NULL, ARRAY['ux-research', 'user-interviews']),
('hiring-ios', 'biz-hiring', 2, 'A senior mobile engineer to lead the shared core.', 1200000, 1800000, true, 'open', NULL, ARRAY['react-native', 'swift']),
('hiring-qa', 'biz-hiring', 3, 'QA lead for the staged rollout.', 500000, 600000, false, 'filled', 'chloewinters', ARRAY['typescript']),
('hiring-closed', 'biz-hiring', 1, 'A second researcher, no longer needed.', NULL, NULL, true, 'closed', NULL, ARRAY[]::text[]),
('apps-content', 'prospect-apps', 2, 'A content designer for seller onboarding.', 250000, 320000, true, 'open', NULL, ARRAY['ux-writing']);

INSERT INTO p01_role (key, project, n, title, qty, btype, amount, skills, note, proposals) VALUES
('hiring-mobile', 'biz-hiring', 2, 'Mobile engineer', 2, 'fixed_price', 900000, ARRAY['react-native', 'kotlin'], 'Comfortable owning a feature from spec to store.', true),
('hiring-design', 'biz-hiring', 2, 'Product designer', 1, 'hourly_cap', NULL, ARRAY['ux', 'figma'], 'Budget to be agreed with the shortlist.', true),
('apps-design', 'prospect-apps', 3, 'Product designer', 1, 'fixed_price', 500000, ARRAY['ux', 'figma'], 'Owns the flows end to end.', true);

INSERT INTO p01_application (key, project, target_type, target, who, team, status, message, days, via_link) VALUES
-- Applications the target filed
('me-accepted', 'hired-progress', 'stage', '2', 'me', NULL, 'accepted', 'I built the flows for this checkout, so I can carry them straight into the build.', 20, NULL),
('me-pending', 'prospect-apps', 'stage', '1', 'me', NULL, 'pending', 'I have run seller interviews on two marketplaces and can start next week.', 1.5, NULL),
('me-rejected', 'prospect-apps', 'role', 'apps-design', 'me', NULL, 'rejected', 'Happy to take the product design role end to end.', 6, NULL),
('me-withdrawn', 'prospect-apps', 'seat', 'apps-content', 'me', NULL, 'withdrawn', 'Applying for the content seat, though my diary is tight.', 9, NULL),
('me-team', 'prospect-invite', 'stage', '2', 'me', 't2', 'pending', 'The studio can take the design and the accessible PDF together.', 2, NULL),
('me-link', 'prospect-declined', 'stage', '3', 'me', NULL, 'pending', 'Daniel shared the link. I can take the large-format artwork.', 0.6, 'declined-print'),
-- Applications to the target's hiring project
('juno-pending', 'biz-hiring', 'seat', 'hiring-ios', 'juno', NULL, 'pending', 'I have shipped two React Native apps and would love to lead the core.', 3, NULL),
('lena-rejected', 'biz-hiring', 'seat', 'hiring-researcher', 'lenamueller', NULL, 'rejected', 'I run interview programmes and could take the ride-alongs.', 7, NULL),
('tomasz-withdrawn', 'biz-hiring', 'role', 'hiring-mobile', 'tomaszwojcik', NULL, 'withdrawn', 'Interested in the mobile role, depending on timing.', 5, NULL),
('chloe-accepted', 'biz-hiring', 'seat', 'hiring-qa', 'chloewinters', NULL, 'accepted', 'I have led QA on two staged rollouts.', 4, NULL),
('ines-link', 'biz-hiring', 'stage', '1', 'inesduarte', NULL, 'pending', 'Saw the link on the studio channel. Atelier Nova has done field research for retail.', 1, 'hiring-discovery');
-- #endregion

-- #region Spec: submissions and revision rounds
INSERT INTO p01_submission (key, project, n, ticket, by_who, title, notes, status, num, days, reviewer, feedback, revision_of, file_from) VALUES
('rollout-key', 'biz-rollout', 1, 't1', 'renkoda', 'Key visual, final route', 'Final artwork with the type lockup and the motion sting.', 'accepted', 1, 42, 'me', 'Exactly the warmth we wanted. Approved.', NULL, 'renkoda'),
('rollout-copy', 'biz-rollout', 3, 't3', 'lenamueller', 'Campaign copy, round 1', 'All nine SKUs, with alt text in the second tab.', 'pending_review', 1, 2.5, NULL, NULL, NULL, 'marisdelacroix'),
('done-1', 'biz-done', 1, 't1', 'renkoda', 'Report structure', 'Final page plan.', 'accepted', 1, 192, 'me', NULL, NULL, 'renkoda'),
('done-2', 'biz-done', 2, 't2', 'renkoda', 'Chart system', 'All twelve chart templates.', 'accepted', 1, 152, 'me', NULL, NULL, 'renkoda'),
('done-3', 'biz-done', 3, 't3', 'renkoda', 'Print artwork', 'Press-ready artwork, proofed.', 'accepted', 1, 117, 'me', 'Proofs look perfect.', NULL, 'renkoda'),
('autofund-oct', 'biz-autofund', 1, 't1', 'chloewinters', 'October clips', 'Twelve clips, captioned and sized for each channel.', 'pending_review', 1, 1.8, NULL, NULL, NULL, 'renkoda'),
('progress-1', 'hired-progress', 1, 't1', 'me', 'Checkout flows and prototype', 'Flows and the prototype link are on the first page.', 'accepted', 1, 46, 'priyaraman', 'Clear and well argued. Approved.', NULL, 'marisdelacroix'),
('review-1', 'hired-review', 1, 't1', 'me', 'Microsite, first delivery', 'Copy and layouts for all five pages.', 'pending_review', 1, 0.7, NULL, NULL, NULL, 'marisdelacroix'),
('rev-ia', 'hired-revisions', 1, 't1', 'me', 'Sitemap and journeys', 'Final sitemap with the IR journeys.', 'accepted', 1, 32, 'danielokafor', NULL, NULL, 'marisdelacroix'),
('rev-1', 'hired-revisions', 2, 't2', 'me', 'Visual language, round 1', 'Two directions for type and colour.', 'revisions_requested', 1, 16, 'danielokafor', 'Direction B is closer, but the data tables feel cramped. Open them up.', NULL, 'marisdelacroix'),
('rev-2', 'hired-revisions', 2, 't2', 'me', 'Visual language, round 2', 'Direction B with more air in the tables.', 'revisions_requested', 2, 7, 'danielokafor', 'Better. The chart colours still fail contrast on the dark theme.', 'rev-1', 'marisdelacroix'),
('rev-3', 'hired-revisions', 2, 't2', 'me', 'Visual language, round 3', 'Contrast fixes in progress; not sent yet.', 'draft', 3, 0.5, NULL, NULL, 'rev-2', NULL),
('kiosk-1', 'hired-paid-round', 1, 't1', 'me', 'Kiosk library, round 1', 'First pass of the components.', 'revisions_requested', 1, 9, 'danielokafor', 'Touch targets need to grow for the wall-mounted units.', NULL, 'marisdelacroix'),
('kiosk-2', 'hired-paid-round', 1, 't1', 'me', 'Kiosk library, round 2', 'Touch targets resized for wall-mounted units.', 'pending_review', 2, 1.1, NULL, NULL, 'kiosk-1', 'marisdelacroix'),
('closed-1', 'hired-closed', 1, 't1', 'me', 'Research findings', 'Findings and recommendations.', 'accepted', 1, 172, 'danielokafor', NULL, NULL, 'marisdelacroix'),
('closed-2', 'hired-closed', 2, 't2', 'me', 'Scheduling board', 'The live board, deployed to staging.', 'accepted', 1, 112, 'danielokafor', 'Dispatchers love the conflict alerts.', NULL, 'marisdelacroix'),
('closed-3', 'hired-closed', 3, 't3', 'me', 'Runbook', 'Runbook and the training recording.', 'accepted', 1, 78, 'danielokafor', NULL, NULL, NULL),
('chain-1', 'hired-chain', 1, 't1', 'me', 'Pre-production pack', 'Recipes, shot lists and casting.', 'accepted', 1, 25, 'priyaraman', NULL, NULL, 'renkoda'),
('seat-1', 'seat-active', 1, 't1', 'me', 'Carrier event model', 'Model and the feed adapters.', 'accepted', 1, 52, 'danielokafor', NULL, NULL, 'kwamemensah'),
('film-1', 'seat-own-team', 1, 't1', 'juno', 'Treatment and script', 'Treatment and shooting script.', 'accepted', 1, 40, 'priyaraman', NULL, NULL, 'renkoda'),
('film-2', 'seat-own-team', 2, 't2', 'juno', 'Final edit and grade', 'Final cut, graded.', 'pending_review', 1, 2.2, NULL, NULL, NULL, 'renkoda'),
('audit-1', 'svc-provider', 1, 't1', 'me', 'Conversion audit', 'Audit findings, ranked by expected lift.', 'accepted', 1, 14, 'priyaraman', NULL, NULL, 'marisdelacroix'),
('overdue-1', 'hired-overdue', 1, 't1', 'me', 'Trial migration results', 'Trial run on twelve years of records; 400 orphaned contacts flagged.', 'revisions_requested', 1, 34, 'danielokafor', 'The orphaned contacts have to be reconciled. We have bought another round.', NULL, NULL);

INSERT INTO p01_revision (key, project, n, ticket, by_who, kind, reason, status, submission, price, days, resolved) VALUES
('rev-round-1', 'hired-revisions', 2, 't2', 'danielokafor', 'revision', 'Direction B is closer, but the data tables feel cramped. Open them up.', 'resolved', 'rev-1', NULL, 15, 7),
('rev-round-2', 'hired-revisions', 2, 't2', 'danielokafor', 'revision', 'Better. The chart colours still fail contrast on the dark theme.', 'open', 'rev-2', NULL, 6, NULL),
('kiosk-round-1', 'hired-paid-round', 1, 't1', 'danielokafor', 'revision', 'Touch targets need to grow for the wall-mounted units.', 'resolved', 'kiosk-1', NULL, 8, 1.1),
('kiosk-round-2', 'hired-paid-round', 1, 't1', 'danielokafor', 'paid_revision', 'One more round for the basket screens, please.', 'awaiting_payment', 'kiosk-2', 15000, 0.3, NULL),
('overdue-round', 'hired-overdue', 1, 't1', 'danielokafor', 'paid_revision', 'The orphaned contacts have to be reconciled. We have bought another round.', 'open', 'overdue-1', 40000, 31, NULL);
-- #endregion

-- #region Spec: session cohorts
INSERT INTO p01_cohort (key, project, n, name, seats, status) VALUES
('one-a', 'sess-one', 1, 'Portfolio critique, 1-on-1', 1, 'completed'),
('one-b', 'sess-one', 1, 'Portfolio critique, 1-on-1', 1, 'active'),
('grp-oct', 'sess-group', 1, 'September cohort', 8, 'completed'),
('grp-nov', 'sess-group', 1, 'Autumn cohort', 8, 'active'),
('grp-dec', 'sess-group', 1, 'Winter cohort', 8, 'enrolling'),
('grp-off', 'sess-group', 1, 'Summer cohort', 8, 'cancelled'),
('orphan-a', 'sess-orphan-one', 1, 'Weekly mentoring', 1, 'active'),
('orphan-b', 'sess-orphan-group', 1, 'Spring cohort', 12, 'enrolling'),
('seat-a', 'sess-seat', 1, 'Current cohort', 10, 'active');

INSERT INTO p01_seat_taken (key, cohort, who, seats, status, days, cancelled) VALUES
('one-a-priya', 'one-a', 'priyaraman', 1, 'completed', 30, NULL),
('one-b-daniel', 'one-b', 'danielokafor', 1, 'active', 12, NULL),
('oct-priya', 'grp-oct', 'priyaraman', 2, 'completed', 80, NULL),
('oct-daniel', 'grp-oct', 'danielokafor', 1, 'completed', 78, NULL),
('nov-priya', 'grp-nov', 'priyaraman', 1, 'active', 30, NULL),
('nov-daniel', 'grp-nov', 'danielokafor', 1, 'active', 28, NULL),
('dec-priya', 'grp-dec', 'priyaraman', 1, 'active', 3, NULL),
('off-daniel', 'grp-off', 'danielokafor', 1, 'cancelled', 150, 130),
('orphan-priya', 'orphan-a', 'priyaraman', 1, 'active', 20, NULL),
('seat-me', 'seat-a', 'me', 1, 'active', 22, NULL);

INSERT INTO p01_sitting (key, cohort, title, starts, minutes, status) VALUES
('a1', 'one-a', 'Portfolio critique, 1-on-1', -12.2, 60, 'completed'),
('b1', 'one-b', 'Portfolio critique, 1-on-1 — session 1 of 3', -5.2, 60, 'completed'),
('b2', 'one-b', 'Portfolio critique, 1-on-1 — session 2 of 3', 2.1, 60, 'scheduled'),
('b3', 'one-b', 'Portfolio critique, 1-on-1 — session 3 of 3', 9.1, 60, 'scheduled'),
('o1', 'grp-oct', 'Critique circle, week 1', -61, 90, 'completed'),
('o2', 'grp-oct', 'Critique circle, week 2', -54, 90, 'completed'),
('n1', 'grp-nov', 'Critique circle, week 1', -9.1, 90, 'completed'),
('n2', 'grp-nov', 'Critique circle, week 2', -2.1, 90, 'completed'),
('n3', 'grp-nov', 'Critique circle, week 3', 4.9, 90, 'scheduled'),
('d1', 'grp-dec', 'Critique circle, week 1', 19, 90, 'scheduled'),
('s1', 'grp-off', 'Critique circle, week 1', -125, 90, 'cancelled_by_freelancer'),
('m1', 'orphan-a', 'Weekly mentoring', 1.2, 45, 'scheduled'),
('g1', 'orphan-b', 'Accessibility clinic, week 1', 26, 60, 'scheduled'),
('h1', 'seat-a', 'Masterclass, week 3', -3, 120, 'completed'),
('h2', 'seat-a', 'Masterclass, week 4', 4, 120, 'scheduled');
-- #endregion

-- #region Spec: escrows and deposits
-- `payer` defaults to the project's client business. Only released money that lands in a wallet this
-- script created is ledgered here; money that pays the target waits for populate_07_wallet.sql.
INSERT INTO p01_escrow (key, project, n, ticket, ptype, payee, status, funded, released, o) VALUES
('rollout-t1', 'biz-rollout', 1, 't1', 'freelancer', 'renkoda', 'released', 56, 40, '{}'),
('rollout-t2', 'biz-rollout', 2, 't2', 'freelancer', 'juno', 'held', 12, NULL, '{}'),
('rollout-t3', 'biz-rollout', 3, 't3', 'freelancer', 'lenamueller', 'held', 19, NULL, '{}'),
('paused-t1', 'biz-paused', 1, 't1', 'freelancer', 'tomaszwojcik', 'held', 30, NULL, '{}'),
('done-t1', 'biz-done', 1, 't1', 'freelancer', 'renkoda', 'released', 225, 190, '{}'),
('done-t2', 'biz-done', 2, 't2', 'freelancer', 'renkoda', 'released', 188, 150, '{}'),
('done-t3', 'biz-done', 3, 't3', 'freelancer', 'renkoda', 'released', 148, 115, '{}'),
('autofund-t1', 'biz-autofund', 1, 't1', 'freelancer', 'chloewinters', 'held', 21, NULL, '{"auto":true}'),
('autofund-t2', 'biz-autofund', 2, 't2', 'freelancer', 'chloewinters', 'held', 5, NULL, '{"auto":true}'),
('progress-t1', 'hired-progress', 1, 't1', 'freelancer', 'me', 'released', 72, 44, '{}'),
('progress-t2', 'hired-progress', 2, 't2', 'freelancer', 'me', 'held', 16, NULL, '{}'),
('review-t1', 'hired-review', 1, 't1', 'freelancer', 'me', 'held', 13, NULL, '{}'),
('rev-t1', 'hired-revisions', 1, 't1', 'freelancer', 'me', 'released', 46, 30, '{}'),
('rev-t2', 'hired-revisions', 2, 't2', 'freelancer', 'me', 'held', 26, NULL, '{}'),
('kiosk-t1', 'hired-paid-round', 1, 't1', 'freelancer', 'me', 'held', 17, NULL, '{}'),
('closed-t1', 'hired-closed', 1, 't1', 'freelancer', 'me', 'released', 188, 170, '{}'),
('closed-t2', 'hired-closed', 2, 't2', 'freelancer', 'me', 'released', 165, 110, '{}'),
('closed-t3', 'hired-closed', 3, 't3', 'freelancer', 'me', 'released', 104, 76, '{}'),
('removed-t1', 'hired-removed', 1, 't1', 'freelancer', 'me', 'released', 34, 15, '{}'),
('chain-s1', 'hired-chain', 1, 't1', 'freelancer', 'me', 'released', 34, 24, '{}'),
('chain-s2', 'hired-chain', 2, 't1', 'freelancer', 'me', 'held', 24, NULL, '{}'),
('overdue-t1', 'hired-overdue', 1, 't1', 'freelancer', 'me', 'held', 150, NULL, '{}'),
('today-t1', 'hired-today', 1, 't1', 'freelancer', 'me', 'held', 9, NULL, '{}'),
('workload-t1', 'hired-workload', 1, 't1', 'freelancer', 'me', 'held', 11, NULL, '{}'),
('claimed-t1', 'hired-claimed', 1, 't1', 'freelancer', 'me', 'held', 0.1, NULL, '{}'),
('cancelled-t1', 'hired-cancelled', 1, 't1', 'freelancer', 'me', 'refunded', 71, NULL, '{"refunded":66}'),
('hold-t1', 'hired-hold', 1, 't1', 'freelancer', 'me', 'held', 25, NULL, '{}'),
('seat-t1', 'seat-active', 1, 't1', 'team', 't1', 'released', 96, 50, '{}'),
('seat-t2', 'seat-active', 2, 't2', 'team', 't1', 'held', 18, NULL, '{"amount":400000}'),
('seat-t3', 'seat-active', 2, 't3', 'team', 't1', 'held', 0.3, NULL, '{"amount":300000}'),
('film-t1', 'seat-own-team', 1, 't1', 'team', 't2', 'released', 62, 38, '{}'),
('film-t2', 'seat-own-team', 2, 't2', 'team', 't2', 'held', 28, NULL, '{}'),
('audit-t1', 'svc-provider', 1, 't1', 'freelancer', 'me', 'released', 20, 12, '{}'),
('audit-t2', 'svc-provider', 2, 't2', 'freelancer', 'me', 'held', 10, NULL, '{}'),
-- A paid revision round already bought: its own escrow, on the same ticket
('overdue-paid', 'hired-overdue', 1, 't1', 'freelancer', 'me', 'held', 30, NULL, '{"revision":"overdue-round","amount":40000}'),
-- Seats and sittings. A 1-1 sitting holds its own escrow; a group seat holds one for the cohort.
('sit-a1', 'sess-one', 1, NULL, 'freelancer', 'me', 'released', 30, 11, '{"seat":"one-a-priya","sitting":"a1","payer":"b1","amount":18000}'),
('sit-b1', 'sess-one', 1, NULL, 'freelancer', 'me', 'released', 12, 4, '{"seat":"one-b-daniel","sitting":"b1","payer":"b2","amount":18000}'),
('sit-b2', 'sess-one', 1, NULL, 'freelancer', 'me', 'held', 12, NULL, '{"seat":"one-b-daniel","sitting":"b2","payer":"b2","amount":18000}'),
('sit-b3', 'sess-one', 1, NULL, 'freelancer', 'me', 'held', 12, NULL, '{"seat":"one-b-daniel","sitting":"b3","payer":"b2","amount":18000}'),
('seat-oct-priya', 'sess-group', 1, NULL, 'freelancer', 'me', 'released', 80, 52, '{"seat":"oct-priya","payer":"b1","amount":18000}'),
('seat-oct-daniel', 'sess-group', 1, NULL, 'freelancer', 'me', 'released', 78, 52, '{"seat":"oct-daniel","payer":"b2","amount":9000}'),
('seat-nov-priya', 'sess-group', 1, NULL, 'freelancer', 'me', 'held', 30, NULL, '{"seat":"nov-priya","payer":"b1","amount":9000}'),
('seat-nov-daniel', 'sess-group', 1, NULL, 'freelancer', 'me', 'held', 28, NULL, '{"seat":"nov-daniel","payer":"b2","amount":9000}'),
('seat-dec-priya', 'sess-group', 1, NULL, 'freelancer', 'me', 'held', 3, NULL, '{"seat":"dec-priya","payer":"b1","amount":9000}'),
('seat-off-daniel', 'sess-group', 1, NULL, 'freelancer', 'me', 'refunded', 150, NULL, '{"seat":"off-daniel","payer":"b2","amount":9000,"refunded":130}'),
('sit-m1', 'sess-orphan-one', 1, NULL, 'freelancer', 'me', 'held', 20, NULL, '{"seat":"orphan-priya","sitting":"m1","payer":"b1","amount":15000}'),
('seat-me', 'sess-seat', 1, NULL, 'freelancer', 'marisdelacroix', 'held', 22, NULL, '{"seat":"seat-me","payer":"b3","amount":30000}');

UPDATE p01_escrow e
   SET cur = p.cur,
       payer = COALESCE(e.o ->> 'payer', p.biz),
       amount = COALESCE((e.o ->> 'amount')::bigint, s.price)
  FROM p01_project p
  JOIN p01_stage s ON s.project = p.key
 WHERE p.key = e.project AND s.n = e.n;

INSERT INTO p01_topup (key, otype, owner_key, cur, amount, days, note) VALUES
('b1-open', 'business', 'b1', 'USD', 2500000, 430, 'Opening deposit'),
('b1-q4', 'business', 'b1', 'USD', 1500000, 60, 'Q4 delivery budget'),
('b2-open', 'business', 'b2', 'USD', 3500000, 380, 'Opening deposit'),
('b2-gbp', 'business', 'b2', 'GBP', 1200000, 120, 'UK programme budget'),
('b3-open', 'business', 'b3', 'USD', 1000000, 300, 'Opening deposit'),
('b3-eur', 'business', 'b3', 'EUR', 2600000, 260, 'EU campaign budget'),
('t1-open', 'team', 't1', 'USD', 50000, 240, 'Opening float'),
('t2-open', 'team', 't2', 'USD', 25000, 200, 'Opening float');
-- #endregion

-- #region Client businesses, teams and an enterprise
-- Two persona-owned businesses pay the target; the third is the target's own, so the target can be a
-- funded client. Each team's only stake is the target's, so a release moves no seeded persona's wallet.
INSERT INTO org.business_profiles
    (id, owner_user_id, name, slug, legal_name, country, billing_email, plan, headline, bio, languages,
     timezone, default_currency, kyb_status, kyb_verified_at, status, visibility, created_at)
SELECT pg_temp.p1_biz(v.key), pg_temp.p1_who(v.owner), v.name, pg_temp.p1_handle(v.handle), v.legal, v.country,
       v.handle || '.' || substr(pg_temp.me()::text, 1, 4) || '@billing.projective.dev', 'free', v.headline,
       jsonb_build_object('text', v.headline), ARRAY['English'], v.tz, 'USD',
       'verified'::finance.kyc_status, pg_temp.p1_ago(v.days - 2), 'active', 'unlisted', pg_temp.p1_ago(v.days)
  FROM (VALUES
    ('b1', 'priyaraman', 'Marram Provisions', 'marram-provisions', 'Marram Provisions Ltd', 'GB', 'Independent food and drink, sold direct and through coastal retailers.', 'Europe/London', 432),
    ('b2', 'danielokafor', 'Lumenforge Labs', 'lumenforge-labs', 'Lumenforge Labs Inc.', 'CA', 'Operations software for field teams and logistics firms.', 'America/Toronto', 382),
    ('b3', 'me', 'Larkspur Ventures', 'larkspur-ventures', 'Larkspur Ventures FZ-LLC', 'AE', 'A small holding company for consumer brands in the Gulf.', 'Asia/Dubai', 302)
  ) AS v(key, owner, name, handle, legal, country, headline, tz, days)
ON CONFLICT (id) DO NOTHING;

SELECT org.fn_seed_preset_roles('business', b.id)
  FROM (SELECT pg_temp.p1_biz(k) AS id FROM unnest(ARRAY['b1', 'b2', 'b3']) AS k) b
 WHERE NOT EXISTS (SELECT 1 FROM org.business_roles r WHERE r.business_id = b.id);

INSERT INTO org.business_members (id, business_id, user_id, role_id, role, status, title, joined_at, created_at)
SELECT pg_temp.p1_k('business-member:' || v.key), pg_temp.p1_biz(v.key), b.owner_user_id,
       (SELECT r.id FROM org.business_roles r WHERE r.business_id = b.id AND r.preset = 'owner'),
       'owner', 'active', 'Founder', b.created_at, b.created_at
  FROM unnest(ARRAY['b1', 'b2', 'b3']) AS v(key)
  JOIN org.business_profiles b ON b.id = pg_temp.p1_biz(v.key)
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.teams
    (id, owner_user_id, name, slug, headline, bio, visibility, subscription_tier, payout_model, status,
     available_since, created_at)
SELECT pg_temp.p1_team(v.key), pg_temp.p1_who(v.owner), v.name, pg_temp.p1_handle(v.handle), v.headline,
       jsonb_build_object('text', v.headline), 'unlisted', 'free', 'split_rules', 'active',
       pg_temp.p1_ago(14), pg_temp.p1_ago(v.days)
  FROM (VALUES
    ('t1', 'saoirsebyrne', 'Breakwater Collective', 'breakwater-collective', 'A delivery collective for operations and logistics software.', 245),
    ('t2', 'me', 'Foldline Studio', 'foldline-studio', 'A small studio for film, brand and web.', 205)
  ) AS v(key, owner, name, handle, headline, days)
ON CONFLICT (id) DO NOTHING;

SELECT org.fn_seed_preset_roles('team', t.id)
  FROM (SELECT pg_temp.p1_team(k) AS id FROM unnest(ARRAY['t1', 't2']) AS k) t
 WHERE NOT EXISTS (SELECT 1 FROM org.team_roles r WHERE r.team_id = t.id);

INSERT INTO org.team_members (id, team_id, user_id, role_id, role, status, invited_by, title, joined_at, created_at)
SELECT pg_temp.p1_k('team-member:' || v.team || ':' || v.who), pg_temp.p1_team(v.team), pg_temp.p1_who(v.who),
       (SELECT r.id FROM org.team_roles r WHERE r.team_id = pg_temp.p1_team(v.team) AND r.preset = v.role),
       v.role, 'active',
       CASE WHEN v.role <> 'owner' THEN (SELECT t.owner_user_id FROM org.teams t WHERE t.id = pg_temp.p1_team(v.team)) END,
       v.title, pg_temp.p1_ago(v.days), pg_temp.p1_ago(v.days)
  FROM (VALUES
    ('t1', 'saoirsebyrne', 'owner', 'Founder', 245),
    ('t1', 'me', 'lead', 'Delivery lead', 200),
    ('t1', 'aikotanaka', 'member', 'Frontend engineer', 180),
    ('t2', 'me', 'owner', 'Founder', 205),
    ('t2', 'juno', 'member', 'Producer', 160)
  ) AS v(team, who, role, title, days)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.contribution_agreements (id, team_id, member_user_id, percent_bp, held)
SELECT pg_temp.p1_k('stake:' || k), pg_temp.p1_team(k), pg_temp.me(), 10000, false
  FROM unnest(ARRAY['t1', 't2']) AS k
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.split_rules (id, team_id, rule_type, vault_bp, active)
SELECT pg_temp.p1_k('split:' || k), pg_temp.p1_team(k), 'co_op', 1000, true
  FROM unnest(ARRAY['t1', 't2']) AS k
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.enterprises
    (id, owner_user_id, legal_name, trading_name, handle, corporate_email, employee_scale, primary_industry,
     departments, status, verification_level, default_currency, created_at)
VALUES
    (pg_temp.p1_k('enterprise:e1'), pg_temp.p1_who('priyaraman'), 'Northgate Holdings plc', 'Northgate',
     pg_temp.p1_handle('northgate-holdings'), 'procurement.' || substr(pg_temp.me()::text, 1, 4) || '@billing.projective.dev',
     '201-500', 'retail', ARRAY['Brand', 'Digital'], 'active', 'verified', 'USD', pg_temp.p1_ago(300))
ON CONFLICT (id) DO NOTHING;

INSERT INTO org.enterprise_members (id, enterprise_id, user_id, role, status, departments, invited_by, joined_at)
SELECT pg_temp.p1_k('enterprise-member:' || v.who), pg_temp.p1_k('enterprise:e1'), pg_temp.p1_who(v.who),
       v.role::org.enterprise_role, 'active', ARRAY['Digital'],
       CASE WHEN v.who = 'me' THEN pg_temp.p1_who('priyaraman') END, pg_temp.p1_ago(v.days)
  FROM (VALUES ('priyaraman', 'owner', 300), ('me', 'admin', 150)) AS v(who, role, days)
ON CONFLICT (id) DO NOTHING;

SELECT org.fn_refresh_membership_flags(pg_temp.me());
-- #endregion

-- #region Service blueprints
-- Unpublished: each engagement below needs a listing to come from, and none of them should appear in
-- anybody's catalogue. A session's engagement is found by its blueprint, so seeded listings stay clear.
INSERT INTO marketplace.service_blueprints
    (id, owner_type, freelancer_profile_id, title, slug, description, description_text, delivery_model,
     pricing_model, price_cents, session_price_cents, currency, max_seats_per_cohort, session_minutes,
     session_count, is_published, created_at)
SELECT pg_temp.p1_k('blueprint:' || v.key), 'freelancer', pg_temp.p1_who(v.owner), v.title, pg_temp.slug('svc', 'p01:' || v.key),
       jsonb_build_object('text', v.brief), v.brief, v.model::marketplace.service_delivery_model,
       'flat_fee'::marketplace.pricing_model, v.price, v.session_price, 'USD', v.seats, v.minutes, v.sittings,
       false, pg_temp.p1_ago(v.days)
  FROM (VALUES
    ('one', 'me', 'Portfolio critique, 1-on-1', 'One hour on your portfolio, with written notes afterwards.', 'session', 18000, 18000, 1, 60, 3, 100),
    ('group', 'me', 'Design critique circle', 'A weekly critique group, in cohorts of eight.', 'group_session', 9000, 9000, 8, 90, 6, 94),
    ('masterclass', 'marisdelacroix', 'Design systems masterclass', 'Four weeks on building a design system that lasts.', 'group_session', 30000, 30000, 10, 120, 4, 32),
    ('audit', 'me', 'Conversion audit and fixes', 'A ranked audit of your funnel, then a sprint to fix the top ten issues.', 'pipeline', 400000, NULL, 1, NULL, NULL, 40)
  ) AS v(key, owner, title, brief, model, price, session_price, seats, minutes, sittings, days)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Projects
-- A custom NDA already on file. A link rather than a stored file: SQL cannot upload the bytes, and
-- files.items takes one row per storage object, so a seeded object cannot be named a second time.
INSERT INTO files.items
    (id, owner_user_id, bucket_id, storage_path, display_name, original_name, mime_type, size_bytes, category,
     status, source, visibility, owner_type, owner_entity_id, link_url, link_title, purpose, created_at)
VALUES
    (pg_temp.p1_k('file:nda'), pg_temp.me(), 'personal',
     'users/' || pg_temp.me() || '/links/' || pg_temp.p1_k('file:nda') || '/mutual-nda', 'Mutual NDA, Larkspur Ventures',
     'mutual-nda', 'text/html', 0, 'Document', 'uploaded', 'link', 'private', 'user', NULL, '/legal',
     'Mutual NDA, Larkspur Ventures', 'library', pg_temp.p1_ago(16))
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.projects
    (id, owner_user_id, client_business_id, owner_team_id, owner_enterprise_id, title, slug, description,
     description_text, format, structure_variation, session_kind, status, visibility, publish_visibility,
     currency, auto_fund_override, budget_type, budget_amount_cents, timeline_preset, target_project_start_date,
     ip_ownership_mode, nda_required, nda_source, nda_document_id, portfolio_display_rights, location_restriction,
     language_requirement, allow_deadline_bonuses, is_personal, source_blueprint_id, handover_unlocked_at,
     archived_at, created_at, updated_at, last_activity_at)
SELECT pg_temp.p1_pid(p.key), pg_temp.p1_who(p.owner), pg_temp.p1_biz(p.biz),
       CASE WHEN p.o ? 'team' THEN pg_temp.p1_team(p.o ->> 'team') END,
       CASE WHEN p.o ? 'ent' THEN pg_temp.p1_k('enterprise:' || (p.o ->> 'ent')) END,
       p.title, pg_temp.slug('prj', 'p01:' || p.key),
       CASE WHEN p.brief = '' THEN '{}'::jsonb ELSE jsonb_build_object('text', p.brief) END, p.brief,
       p.format::project_format, p.structure::projects.structure_variation, COALESCE(p.o ->> 'kind', 'none'),
       p.status::project_status, p.vis::visibility,
       COALESCE(p.o ->> 'pub', p.vis)::visibility, p.cur, p.o ->> 'auto',
       COALESCE(p.o ->> 'btype', 'fixed_price')::budget_type, p.budget,
       COALESCE(p.o ->> 'timeline', 'sequential')::timeline_preset,
       CASE WHEN p.o ? 'start' THEN pg_temp.p1_ago(-(p.o ->> 'start')::numeric) END,
       COALESCE(p.o ->> 'ip', 'exclusive_transfer')::ip_option_mode,
       p.o ? 'nda',
       CASE WHEN p.o ->> 'nda' LIKE 'custom%' THEN 'custom' ELSE 'platform' END,
       CASE WHEN p.o ->> 'nda' = 'custom-doc' THEN pg_temp.p1_k('file:nda') END,
       COALESCE(p.o ->> 'portfolio', 'allowed')::portfolio_rights,
       COALESCE(pg_temp.p1_arr(p.o -> 'places'), '{}'), COALESCE(pg_temp.p1_arr(p.o -> 'langs'), '{}'),
       COALESCE((p.o ->> 'bonus')::boolean, false), COALESCE((p.o ->> 'personal')::boolean, false),
       pg_temp.p1_blueprint(p.o ->> 'blueprint'),
       CASE WHEN p.status = 'completed' THEN pg_temp.p1_ago(p.activity) END,
       CASE WHEN p.status = 'archived' THEN pg_temp.p1_ago(p.activity) END,
       pg_temp.p1_ago(p.created), pg_temp.p1_ago(p.activity), pg_temp.p1_ago(p.activity)
  FROM p01_project p
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_required_skills (project_id, skill_id)
SELECT pg_temp.p1_pid(p.key), s.id
  FROM p01_project p
  CROSS JOIN LATERAL unnest(pg_temp.p1_arr(p.o -> 'skills')) AS k(slug)
  JOIN org.skills s ON s.slug = k.slug
ON CONFLICT (project_id, skill_id) DO NOTHING;

INSERT INTO projects.project_status_history (id, project_id, actor_user_id, from_status, to_status, reason, created_at)
SELECT pg_temp.p1_k('status:' || p.key || ':' || h.seq), pg_temp.p1_pid(p.key), pg_temp.p1_who(p.owner),
       h.from_status::project_status, h.to_status::project_status, h.reason, h.at
  FROM p01_project p
  CROSS JOIN LATERAL (VALUES
      (1, NULL, 'draft', 'Created', pg_temp.p1_ago(p.created)),
      (2, 'draft', 'active', 'Published', pg_temp.p1_ago(p.created - LEAST(1, p.created / 2))),
      (3, CASE WHEN p.key IN ('own-archived', 'svc-stale') THEN 'draft' ELSE 'active' END, p.status, CASE p.status WHEN 'on_hold' THEN 'Paused by the client' WHEN 'completed' THEN 'All stages delivered'
                                  WHEN 'cancelled' THEN 'Called off by the client' ELSE 'Put away' END,
          pg_temp.p1_ago(p.activity))
  ) AS h(seq, from_status, to_status, reason, at)
 WHERE (h.seq = 1)
    OR (h.seq = 2 AND p.status <> 'draft' AND p.key NOT IN ('own-archived', 'svc-stale'))
    OR (h.seq = 3 AND p.status IN ('on_hold', 'completed', 'cancelled', 'archived'))
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Stages and everything hung on them
-- Through NOT EXISTS, not ON CONFLICT: fn_enforce_structure_variation counts before a conflict clause
-- could drop the duplicate.
INSERT INTO projects.project_stages
    (id, project_id, name, slug, description, description_text, sort_order, status, file_upload_required,
     allowed_file_extensions, allowed_file_categories, skills, seat_limit, parallel, nda_override, nda_required,
     unit_price_cents, milestone, start_trigger_type, fixed_start_date, start_dependency_stage_id,
     start_dependency_lag_days, hire_trigger_active, file_revisions_allowed, extra_revision_price_cents,
     revisions_used, file_duration_mode, file_duration_days, file_due_date, session_duration_minutes, session_count,
     ip_ownership_override, assignment_mode, max_concurrent_intensity, chain_reaction, capacity, seat_count,
     created_at, completed_at)
SELECT pg_temp.p1_stg(s.project, s.n), pg_temp.p1_pid(s.project), s.name, pg_temp.slug('stg', 'p01:' || s.project || ':' || s.n),
       jsonb_build_object('text', s.brief), s.brief, s.n, s.status::stage_status,
       COALESCE((s.o ->> 'upload')::boolean, false),
       COALESCE(pg_temp.p1_arr(s.o -> 'ext'), '{}'),
       CASE WHEN s.o ? 'cats' THEN pg_temp.p1_arr(s.o -> 'cats')::files.file_category[] END,
       COALESCE(pg_temp.p1_arr(s.o -> 'skills'), '{}'),
       CASE WHEN s.o ? 'seat_limit' THEN (s.o ->> 'seat_limit')::integer ELSE 3 END,
       COALESCE((s.o ->> 'parallel')::boolean, false),
       COALESCE((s.o ->> 'nda')::boolean, false), (s.o ->> 'nda')::boolean,
       s.price, COALESCE(s.o ->> 'milestone', ''),
       (CASE WHEN s.o ? 'trigger' THEN s.o ->> 'trigger' ELSE 'on_project_start' END)::start_trigger_type,
       CASE WHEN s.o ->> 'trigger' = 'fixed_date' THEN pg_temp.p1_ago(-(s.o ->> 'start')::numeric) END,
       CASE WHEN s.o ? 'dep' THEN pg_temp.p1_stg(s.project, (s.o ->> 'dep')::integer) END,
       COALESCE((s.o ->> 'lag')::integer, 0), COALESCE((s.o ->> 'hire')::boolean, true),
       (s.o ->> 'revisions')::integer, (s.o ->> 'extra')::bigint, COALESCE((s.o ->> 'used')::integer, 0),
       CASE WHEN s.o ? 'due' THEN 'fixed_deadline' WHEN s.o ? 'days' THEN 'relative_duration'
            WHEN s.o ? 'nodue' THEN 'no_due_date' END,
       (s.o ->> 'days')::integer, pg_temp.p1_day(s.o ->> 'due'), (s.o ->> 'minutes')::integer,
       COALESCE((s.o ->> 'count')::integer, 1), (s.o ->> 'ip')::ip_option_mode,
       COALESCE(s.o ->> 'mode', 'open_pull')::projects.assignment_routing_mode, (s.o ->> 'cap')::numeric,
       COALESCE((s.o ->> 'chain')::boolean, true), COALESCE(s.o ->> 'capacity', 'unlimited'), (s.o ->> 'seats')::integer,
       pg_temp.p1_ago(p.created), CASE WHEN s.o ? 'done' THEN pg_temp.p1_ago((s.o ->> 'done')::numeric) END
  FROM p01_stage s
  JOIN p01_project p ON p.key = s.project
 WHERE NOT EXISTS (SELECT 1 FROM projects.project_stages x WHERE x.id = pg_temp.p1_stg(s.project, s.n));

INSERT INTO projects.stage_budget_rules (id, project_stage_id, rule_type, amount_currency, amount_cents, notes)
SELECT pg_temp.p1_k('budget-rule:' || v.project || ':' || v.n), pg_temp.p1_stg(v.project, v.n), v.rule, v.cur, v.amount, v.notes
  FROM (VALUES
    ('biz-hiring', 1, 'hourly_cap', 'USD', 650000::bigint, 'Capped; billed against the ride-along diary.'),
    ('biz-hiring', 2, 'fixed_price', 'USD', 2200000::bigint, 'Fixed across both platforms.'),
    ('pipeline-flat-hourly', 1, 'hourly_cap', 'USD', 120000::bigint, 'Monthly ceiling.')
  ) AS v(project, n, rule, cur, amount, notes)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_assignments
    (id, project_stage_id, assignee_type, freelancer_profile_id, team_id, assigned_by, is_client_managed, status, created_at)
SELECT pg_temp.p1_k('assign:' || a.project || ':' || a.n || ':' || a.who), pg_temp.p1_stg(a.project, a.n),
       a.kind::assignment_type,
       CASE WHEN a.kind = 'freelancer' THEN pg_temp.p1_who(a.who) END,
       CASE WHEN a.kind = 'team' THEN pg_temp.p1_team(a.who) END,
       pg_temp.p1_who(p.owner), false, a.status, pg_temp.p1_ago(a.days)
  FROM p01_assign a
  JOIN p01_project p ON p.key = a.project
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_staffing_roles
    (id, project_stage_id, role_title, quantity, budget_type, budget_amount_cents, skills, additional_instructions, allow_proposals)
SELECT pg_temp.p1_k('role:' || r.key), pg_temp.p1_stg(r.project, r.n), r.title, r.qty, r.btype::budget_type, r.amount,
       r.skills, r.note, r.proposals
  FROM p01_role r
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_open_seats
    (id, project_stage_id, description_of_need, budget_min_cents, budget_max_cents, require_proposals, status, filled_assignment_id)
SELECT pg_temp.p1_k('seat:' || s.key), pg_temp.p1_stg(s.project, s.n), s.need, s.lo, s.hi, s.proposals, s.status,
       CASE WHEN s.filled_by IS NOT NULL THEN pg_temp.p1_k('assign:' || s.project || ':' || s.n || ':' || s.filled_by) END
  FROM p01_seat s
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_open_seat_skills (seat_id, skill_id)
SELECT pg_temp.p1_k('seat:' || s.key), k.id
  FROM p01_seat s
  CROSS JOIN LATERAL unnest(s.skills) AS x(slug)
  JOIN org.skills k ON k.slug = x.slug
ON CONFLICT (seat_id, skill_id) DO NOTHING;

INSERT INTO projects.stage_invite_links (id, project_id, project_stage_id, token, status, created_by, created_at, revoked_at, revoked_by)
SELECT pg_temp.p1_k('link:' || v.key), pg_temp.p1_pid(v.project), pg_temp.p1_stg(v.project, v.n),
       substr(md5(pg_temp.p1_k('link-token:' || v.key)::text), 1, 24), v.status, pg_temp.p1_who(v.by_who), pg_temp.p1_ago(v.days),
       CASE WHEN v.status = 'revoked' THEN pg_temp.p1_ago(v.days - 2) END,
       CASE WHEN v.status = 'revoked' THEN pg_temp.p1_who(v.by_who) END
  FROM (VALUES
    ('hiring-discovery', 'biz-hiring', 1, 'active', 'me', 5),
    ('hiring-build', 'biz-hiring', 2, 'revoked', 'me', 9),
    ('declined-print', 'prospect-declined', 3, 'active', 'danielokafor', 3)
  ) AS v(key, project, n, status, by_who, days)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.maintenance_contracts
    (id, project_id, freelancer_profile_id, business_profile_id, amount_cents, currency, billing_interval, status, created_at)
SELECT pg_temp.p1_k('maintenance:' || v.project), pg_temp.p1_pid(v.project), pg_temp.p1_who(v.who), pg_temp.p1_biz(v.biz),
       v.amount, v.cur, v.period, v.status, pg_temp.p1_ago(v.days)
  FROM (VALUES
    ('hired-closed', 'me', 'b2', 45000::bigint, 'USD', 'monthly', 'active', 72),
    ('biz-done', 'renkoda', 'b3', 30000::bigint, 'EUR', 'quarterly', 'cancelled', 110)
  ) AS v(project, who, biz, amount, cur, period, status, days)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Roster
-- The participant row is what puts a project on /projects. A client business gets the row
-- create_project writes; a hire gets `assignee`, the only word the staffing doors write; a team's hire
-- reaches every active member, as the seed does.
INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, created_at)
SELECT pg_temp.p1_k('participant:' || p.key || ':business'), pg_temp.p1_pid(p.key), 'business', pg_temp.p1_biz(p.biz), 'owner', pg_temp.p1_ago(p.created)
  FROM p01_project p
 WHERE p.biz IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, created_at, can_manage_tickets)
SELECT pg_temp.p1_k('participant:' || m.project || ':' || m.who), pg_temp.p1_pid(m.project), 'freelancer', pg_temp.p1_who(m.who),
       m.role, pg_temp.p1_ago(m.days), m.manage
  FROM p01_member m
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, created_at)
SELECT DISTINCT ON (a.project, u.user_id)
       pg_temp.p1_k('participant:' || a.project || ':' || u.user_id), pg_temp.p1_pid(a.project), 'freelancer', u.user_id,
       'assignee', pg_temp.p1_ago(a.days)
  FROM p01_assign a
  JOIN p01_project p ON p.key = a.project
  CROSS JOIN LATERAL (
      SELECT pg_temp.p1_who(a.who) AS user_id WHERE a.kind = 'freelancer'
      UNION ALL
      SELECT tm.user_id FROM org.team_members tm
       WHERE a.kind = 'team' AND tm.team_id = pg_temp.p1_team(a.who) AND tm.status = 'active'
  ) u
 WHERE u.user_id IS DISTINCT FROM pg_temp.p1_who(p.owner)
 ORDER BY a.project, u.user_id, a.days DESC
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.user_preferences (user_id, project_id, is_starred, starred_at, is_archived, last_viewed_at)
SELECT pg_temp.me(), pg_temp.p1_pid(p.key), COALESCE((p.o ->> 'starred')::boolean, false),
       CASE WHEN (p.o ->> 'starred')::boolean THEN pg_temp.p1_ago(LEAST(p.activity, 2)) END, false,
       pg_temp.p1_ago(LEAST(p.activity, 3))
  FROM p01_project p
 WHERE p.owner = 'me'
    OR EXISTS (SELECT 1 FROM projects.project_participants x
                WHERE x.project_id = pg_temp.p1_pid(p.key) AND x.profile_id = pg_temp.me())
ON CONFLICT (user_id, project_id) DO NOTHING;

INSERT INTO projects.project_invitations
    (id, project_id, project_stage_id, target_email, target_user_id, message, offer_price_cents, placeholder, role,
     inviter_user_id, token, status, created_at, expires_at, accepted_at, declined_at, dismissed_at)
SELECT pg_temp.p1_k('invite:' || i.project || ':' || COALESCE(i.n, 0) || ':' || COALESCE(i.who, i.email) || ':' || i.role),
       pg_temp.p1_pid(i.project), CASE WHEN i.n IS NOT NULL THEN pg_temp.p1_stg(i.project, i.n) END, i.email, pg_temp.p1_who(i.who),
       i.message, i.offer, i.placeholder, i.role, pg_temp.p1_who(i.by_who),
       md5(pg_temp.p1_k('invite-token:' || i.project || ':' || COALESCE(i.n, 0) || ':' || COALESCE(i.who, i.email) || ':' || i.role)::text),
       i.status, pg_temp.p1_ago(i.days), pg_temp.p1_ago(-i.expires),
       CASE WHEN i.status = 'accepted' THEN pg_temp.p1_ago(i.days - LEAST(0.5, i.days / 2)) END,
       CASE WHEN i.status = 'declined' THEN pg_temp.p1_ago(i.days - LEAST(1, i.days / 2)) END,
       CASE WHEN i.dismissed THEN pg_temp.p1_ago(i.days - LEAST(2, i.days / 2)) END
  FROM p01_invite i
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_applications
    (id, project_id, applicant_user_id, applicant_type, applicant_profile_id, message, status, invite_link_id, created_at, updated_at)
SELECT pg_temp.p1_k('application:' || a.key), pg_temp.p1_pid(a.project), pg_temp.p1_who(a.who),
       CASE WHEN a.team IS NULL THEN 'freelancer' ELSE 'team' END,
       COALESCE(pg_temp.p1_team(a.team), pg_temp.p1_who(a.who)), a.message, a.status::projects.application_status,
       CASE WHEN a.via_link IS NOT NULL THEN pg_temp.p1_k('link:' || a.via_link) END,
       pg_temp.p1_ago(a.days), pg_temp.p1_ago(CASE WHEN a.status = 'pending' THEN a.days ELSE a.days - LEAST(1, a.days / 2) END)
  FROM p01_application a
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_application_targets (id, application_id, target_type, target_id)
SELECT pg_temp.p1_k('application-target:' || a.key), pg_temp.p1_k('application:' || a.key),
       a.target_type::projects.application_target_type,
       CASE a.target_type WHEN 'stage' THEN pg_temp.p1_stg(a.project, a.target::integer)
                          WHEN 'role' THEN pg_temp.p1_k('role:' || a.target)
                          ELSE pg_temp.p1_k('seat:' || a.target) END
  FROM p01_application a
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Tickets
-- A multi-stage ticket carries no price of its own: a ticket's price would override every stage in its
-- chain. `total_amount_paid` is what its releases paid out, net of the fee, as the release door writes it.
INSERT INTO projects.tickets
    (id, project_id, current_stage_id, current_assignee_id, slug, owner_user_id, title, description, text_description,
     status, priority, required_stages, tasks, due_date, workload_intensity, payment_status, unit_price_cents,
     total_amount_paid, sort_order, claimed_at, created_at, updated_at)
SELECT pg_temp.p1_tkt(t.project, t.key), pg_temp.p1_pid(t.project), pg_temp.p1_stg(t.project, t.n), pg_temp.p1_who(t.assignee),
       pg_temp.slug('tkt', 'p01:' || t.project || ':' || t.key), pg_temp.p1_who(p.owner), t.title,
       jsonb_build_object('text', t.brief), t.brief, t.status::ticket_status, t.priority::projects.ticket_priority,
       (SELECT jsonb_agg(jsonb_build_object('stage_id', pg_temp.p1_stg(t.project, e.value::integer), 'order', e.ordinality - 1)
                         ORDER BY e.ordinality)
          FROM jsonb_array_elements_text(COALESCE(t.o -> 'stages', jsonb_build_array(t.n))) WITH ORDINALITY AS e),
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                     'id', pg_temp.p1_k('task:' || t.project || ':' || t.key || ':' || x.i),
                     'text', substr(x.task, 2),
                     'done', left(x.task, 1) = '+',
                     'completed_by', CASE WHEN left(x.task, 1) = '+' AND t.assignee IS NOT NULL
                                          THEN jsonb_build_array(pg_temp.p1_who(t.assignee)) ELSE '[]'::jsonb END)
                     ORDER BY x.i)
                   FROM unnest(t.tasks) WITH ORDINALITY AS x(task, i)), '[]'::jsonb),
       pg_temp.p1_day(t.due), t.intensity, t.payment::payment_status,
       CASE WHEN t.o ? 'stages' THEN NULL ELSE COALESCE((t.o ->> 'price')::bigint, s.price) END,
       COALESCE((SELECT sum(e.amount - (e.amount * 500) / 10000)
                   FROM p01_escrow e
                  WHERE e.project = t.project AND e.ticket = t.key AND e.status = 'released'), 0)::bigint,
       row_number() OVER (PARTITION BY t.project ORDER BY t.key)::integer,
       CASE WHEN t.claimed IS NOT NULL THEN pg_temp.p1_ago(t.claimed) END,
       pg_temp.p1_ago(LEAST(p.created, COALESCE(t.claimed, 0) + 3)), pg_temp.p1_ago(LEAST(p.activity, COALESCE(t.claimed, p.activity)))
  FROM p01_ticket t
  JOIN p01_project p ON p.key = t.project
  JOIN p01_stage s ON s.project = t.project AND s.n = t.n
 WHERE NOT EXISTS (SELECT 1 FROM projects.tickets x WHERE x.id = pg_temp.p1_tkt(t.project, t.key));

INSERT INTO projects.ticket_history
    (id, ticket_id, actor_id, action_type, previous_stage_id, new_stage_id, previous_status, new_status, changes, created_at)
SELECT pg_temp.p1_k('ticket-history:' || t.project || ':' || t.key || ':' || h.step), pg_temp.p1_tkt(t.project, t.key),
       h.actor, h.action, h.prev_stage, pg_temp.p1_stg(t.project, t.n), h.prev_status::ticket_status, h.next_status::ticket_status,
       h.changes, h.at
  FROM p01_ticket t
  JOIN p01_project p ON p.key = t.project
  CROSS JOIN LATERAL (VALUES
      ('created', pg_temp.p1_who(p.owner), 'created', NULL::uuid, NULL, 'backlog', jsonb_build_object('title', t.title),
       pg_temp.p1_ago(LEAST(p.created, COALESCE(t.claimed, 0) + 3))),
      ('claimed', COALESCE(pg_temp.p1_who(t.assignee), pg_temp.p1_who(p.owner)), 'reassigned', pg_temp.p1_stg(t.project, t.n), 'todo', 'claimed',
       jsonb_build_object('assignee', pg_temp.p1_who(t.assignee)), pg_temp.p1_ago(COALESCE(t.claimed, 0))),
      ('moved', CASE WHEN t.status IN ('completed', 'cancelled') THEN pg_temp.p1_who(p.owner) ELSE COALESCE(pg_temp.p1_who(t.assignee), pg_temp.p1_who(p.owner)) END,
       'status_changed', pg_temp.p1_stg(t.project, t.n), CASE t.status WHEN 'completed' THEN 'in_review' WHEN 'cancelled' THEN 'todo' ELSE 'claimed' END,
       t.status, '{}'::jsonb, pg_temp.p1_ago(LEAST(p.activity, COALESCE(t.claimed, p.activity))))
  ) AS h(step, actor, action, prev_stage, prev_status, next_status, changes, at)
 WHERE h.step = 'created'
    OR (h.step = 'claimed' AND t.assignee IS NOT NULL AND t.claimed IS NOT NULL)
    OR (h.step = 'moved' AND t.status IN ('in_progress', 'in_review', 'completed', 'cancelled'))
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Submissions and revision rounds
-- Inserted oldest first, so a round's `revision_of` already exists.
INSERT INTO projects.stage_submissions
    (id, project_stage_id, ticket_id, submitted_by, notes, title, status, description, checked_item_ids, number,
     reviewed_by, reviewed_at, feedback, revision_of, created_at, updated_at)
SELECT pg_temp.p1_k('submission:' || s.key), pg_temp.p1_stg(s.project, s.n), pg_temp.p1_tkt(s.project, s.ticket), pg_temp.p1_who(s.by_who),
       s.notes, s.title, s.status, jsonb_build_object('text', s.notes),
       COALESCE((SELECT jsonb_agg(pg_temp.p1_k('task:' || s.project || ':' || s.ticket || ':' || x.i) ORDER BY x.i)
                   FROM p01_ticket t
                   CROSS JOIN LATERAL unnest(t.tasks) WITH ORDINALITY AS x(task, i)
                  WHERE t.project = s.project AND t.key = s.ticket AND left(x.task, 1) = '+'), '[]'::jsonb),
       s.num, pg_temp.p1_who(s.reviewer), CASE WHEN s.reviewer IS NOT NULL THEN pg_temp.p1_ago(s.days - LEAST(1, s.days / 2)) END,
       CASE WHEN s.feedback IS NOT NULL THEN jsonb_build_object('global', s.feedback) END,
       CASE WHEN s.revision_of IS NOT NULL THEN pg_temp.p1_k('submission:' || s.revision_of) END,
       pg_temp.p1_ago(s.days), pg_temp.p1_ago(CASE WHEN s.reviewer IS NOT NULL THEN s.days - LEAST(1, s.days / 2) ELSE s.days END)
  FROM p01_submission s
 ORDER BY s.days DESC
ON CONFLICT (id) DO NOTHING;

-- A deliverable's picture: a seeded public portfolio cover, which any reader of the submission can see.
INSERT INTO projects.submission_files (id, submission_id, file_id)
SELECT pg_temp.p1_k('submission-file:' || s.key), pg_temp.p1_k('submission:' || s.key), f.id
  FROM p01_submission s
  CROSS JOIN LATERAL (
      SELECT i.id FROM files.items i
       WHERE i.bucket_id = 'public_assets' AND i.owner_user_id = pg_temp.p1_who(s.file_from)
       ORDER BY i.storage_path LIMIT 1
  ) f
 WHERE s.file_from IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.stage_revision_requests
    (id, project_stage_id, ticket_id, requested_by, request_type, reason, status, created_at, resolved_at, submission_id, price_cents)
SELECT pg_temp.p1_k('revision:' || r.key), pg_temp.p1_stg(r.project, r.n), pg_temp.p1_tkt(r.project, r.ticket), pg_temp.p1_who(r.by_who),
       r.kind, r.reason, r.status, pg_temp.p1_ago(r.days),
       CASE WHEN r.resolved IS NOT NULL THEN pg_temp.p1_ago(r.resolved) END, pg_temp.p1_k('submission:' || r.submission), r.price
  FROM p01_revision r
ON CONFLICT (id) DO NOTHING;

-- A workload report suspends the ticket through the report's own trigger, which keeps the payee and
-- the held escrow and starts the client's answer window.
INSERT INTO projects.ticket_workload_reports (id, ticket_id, reporter_user_id, claimed_intensity, reported_intensity, reason, created_at)
VALUES (pg_temp.p1_k('workload-report'), pg_temp.p1_tkt('hired-workload', 't1'), pg_temp.me(), 1.00, 2.50,
        'The ticket describes one scanner model. The warehouse runs three, each with its own driver and firmware.', pg_temp.p1_ago(1.3))
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Cohorts and sittings
INSERT INTO projects.cohorts (id, project_id, project_stage_id, name, max_seats, status, created_at)
SELECT pg_temp.p1_k('cohort:' || c.key), pg_temp.p1_pid(c.project), pg_temp.p1_stg(c.project, c.n), c.name, c.seats,
       c.status::projects.cohort_status, pg_temp.p1_ago(p.created)
  FROM p01_cohort c
  JOIN p01_project p ON p.key = c.project
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.cohort_memberships (id, cohort_id, user_id, seats, status, joined_at, cancelled_at)
SELECT pg_temp.p1_k('seat-taken:' || t.key), pg_temp.p1_k('cohort:' || t.cohort), pg_temp.p1_who(t.who), t.seats, t.status,
       pg_temp.p1_ago(t.days), CASE WHEN t.cancelled IS NOT NULL THEN pg_temp.p1_ago(t.cancelled) END
  FROM p01_seat_taken t
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.session_events (id, cohort_id, title, slug, start_time, end_time, status)
SELECT pg_temp.p1_k('sitting:' || s.key), pg_temp.p1_k('cohort:' || s.cohort), s.title, pg_temp.slug('ssn', 'p01:' || s.key),
       pg_temp.p1_ago(-s.starts), pg_temp.p1_ago(-s.starts) + make_interval(mins => s.minutes),
       s.status::projects.session_event_status
  FROM p01_sitting s
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.session_attendance (id, session_event_id, user_id, joined_at, left_at, source)
SELECT pg_temp.p1_k('attendance:' || s.key || ':' || u.user_id), pg_temp.p1_k('sitting:' || s.key), u.user_id,
       pg_temp.p1_ago(-s.starts) + interval '2 minutes',
       pg_temp.p1_ago(-s.starts) + make_interval(mins => s.minutes - 3), 'host'
  FROM p01_sitting s
  JOIN p01_cohort c ON c.key = s.cohort
  JOIN p01_project p ON p.key = c.project
  CROSS JOIN LATERAL (
      SELECT pg_temp.p1_who(p.owner) AS user_id
      UNION
      SELECT pg_temp.p1_who(t.who) FROM p01_seat_taken t WHERE t.cohort = s.cohort AND t.status <> 'cancelled'
  ) u
 WHERE s.status = 'completed'
   -- The sitting in dispute: the logs have the claimant arriving and the host never recorded.
   AND NOT (s.key = 'n2' AND u.user_id = pg_temp.p1_who(p.owner))
ON CONFLICT (id) DO NOTHING;

-- The calendar mirror of each sitting, as the booking and scheduling doors write it.
INSERT INTO scheduling.events
    (id, project_id, kind, status, title, starts_at, ends_at, attendee_count, capacity, source_session_event_id, created_by)
SELECT pg_temp.p1_k('sitting-event:' || s.key), pg_temp.p1_pid(c.project), 'session'::scheduling.event_kind,
       (CASE WHEN s.status LIKE 'cancelled%' THEN 'cancelled' ELSE 'confirmed' END)::scheduling.event_status,
       s.title, pg_temp.p1_ago(-s.starts), pg_temp.p1_ago(-s.starts) + make_interval(mins => s.minutes),
       COALESCE((SELECT sum(t.seats) FROM p01_seat_taken t WHERE t.cohort = s.cohort AND t.status <> 'cancelled'), 0)::integer,
       c.seats, pg_temp.p1_k('sitting:' || s.key), pg_temp.p1_who(p.owner)
  FROM p01_sitting s
  JOIN p01_cohort c ON c.key = s.cohort
  JOIN p01_project p ON p.key = c.project
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Wallets and escrows
-- Fees floor: integer division of the amount at 500 basis points.
INSERT INTO finance.escrows
    (id, project_stage_id, ticket_id, cohort_membership_id, session_event_id, revision_id, payer_business_id,
     payee_type, payee_id, amount_cents, platform_fee_cents, currency, status, created_at, released_at, auto_funded)
SELECT pg_temp.p1_k('escrow:' || e.key), pg_temp.p1_stg(e.project, e.n),
       CASE WHEN e.ticket IS NOT NULL THEN pg_temp.p1_tkt(e.project, e.ticket) END,
       CASE WHEN e.o ? 'seat' THEN pg_temp.p1_k('seat-taken:' || (e.o ->> 'seat')) END,
       CASE WHEN e.o ? 'sitting' THEN pg_temp.p1_k('sitting:' || (e.o ->> 'sitting')) END,
       CASE WHEN e.o ? 'revision' THEN pg_temp.p1_k('revision:' || (e.o ->> 'revision')) END,
       pg_temp.p1_biz(e.payer), e.ptype::assignment_type,
       CASE e.ptype WHEN 'team' THEN pg_temp.p1_team(e.payee) ELSE pg_temp.p1_who(e.payee) END,
       e.amount, CASE WHEN e.status = 'released' THEN (e.amount * 500) / 10000 ELSE 0 END, e.cur, e.status,
       pg_temp.p1_ago(e.funded), CASE WHEN e.status = 'released' THEN pg_temp.p1_ago(e.released) END,
       COALESCE((e.o ->> 'auto')::boolean, false)
  FROM p01_escrow e
ON CONFLICT (id) DO NOTHING;

-- A team's release: 10% of the payout to the vault, the pool to its stakes, of which the target holds all.
INSERT INTO finance.payout_splits (id, escrow_id, member_user_id, amount_cents, currency, created_at)
SELECT pg_temp.p1_k('payout-split:' || e.key), pg_temp.p1_k('escrow:' || e.key), pg_temp.me(), x.payout - (x.payout * 1000) / 10000,
       e.cur, pg_temp.p1_ago(e.released)
  FROM p01_escrow e
  CROSS JOIN LATERAL (SELECT e.amount - (e.amount * 500) / 10000 AS payout) x
 WHERE e.ptype = 'team' AND e.status = 'released'
ON CONFLICT (id) DO NOTHING;

-- One chronological pass per wallet: pg_temp.post keeps the running balance, so the order is the ledger.
-- Rows a second apart, so ORDER BY created_at reproduces the walk when two fall on the same instant.
-- Releases here are all older than the seven-day pending window, so each lands available.
DO $$
DECLARE
    v record;
BEGIN
    FOR v IN
        SELECT ev.*, row_number() OVER (ORDER BY ev.at, ev.k) AS seq FROM (
            SELECT 'topup:' || t.key AS k,
                   pg_temp.wallet(t.otype, CASE t.otype WHEN 'team' THEN pg_temp.p1_team(t.owner_key) ELSE pg_temp.p1_biz(t.owner_key) END, t.cur) AS w,
                   'credit' AS dir, t.amount, 'topup' AS reason, pg_temp.p1_ago(t.days) AS at,
                   NULL::text AS rt, NULL::uuid AS rid, 'available'::finance.fund_state AS st
              FROM p01_topup t
            UNION ALL
            SELECT 'hold:' || e.key, pg_temp.wallet('business', pg_temp.p1_biz(e.payer), e.cur), 'debit', e.amount, 'escrow_hold',
                   pg_temp.p1_ago(e.funded), 'escrows', pg_temp.p1_k('escrow:' || e.key), 'locked'::finance.fund_state
              FROM p01_escrow e
            UNION ALL
            SELECT 'refund:' || e.key, pg_temp.wallet('business', pg_temp.p1_biz(e.payer), e.cur), 'credit', e.amount, 'escrow_refund',
                   pg_temp.p1_ago((e.o ->> 'refunded')::numeric), 'escrows', pg_temp.p1_k('escrow:' || e.key), 'available'::finance.fund_state
              FROM p01_escrow e
             WHERE e.status = 'refunded'
            UNION ALL
            SELECT 'vault:' || e.key, pg_temp.wallet('team', pg_temp.p1_team(e.payee), e.cur), 'credit',
                   ((e.amount - (e.amount * 500) / 10000) * 1000) / 10000, 'escrow_release_vault_retention',
                   pg_temp.p1_ago(e.released), 'escrows', pg_temp.p1_k('escrow:' || e.key), 'available'::finance.fund_state
              FROM p01_escrow e
             WHERE e.status = 'released' AND e.ptype = 'team'
            UNION ALL
            SELECT 'release:' || e.key, pg_temp.wallet('freelancer', pg_temp.p1_who(e.payee), e.cur), 'credit',
                   e.amount - (e.amount * 500) / 10000, 'escrow_release', pg_temp.p1_ago(e.released), 'escrows',
                   pg_temp.p1_k('escrow:' || e.key), 'available'::finance.fund_state
              FROM p01_escrow e
             WHERE e.status = 'released' AND e.ptype = 'freelancer' AND e.payee <> 'me'
        ) ev
        ORDER BY ev.at, ev.k
    LOOP
        PERFORM pg_temp.post(v.k, v.w, v.dir, v.amount, v.reason, v.at + make_interval(secs => v.seq), v.rt, v.rid, v.st);
    END LOOP;
END;
$$;

UPDATE org.teams t
   SET treasury_wallet_id = pg_temp.wallet('team', t.id, 'USD')
 WHERE t.id IN (pg_temp.p1_team('t1'), pg_temp.p1_team('t2')) AND t.treasury_wallet_id IS NULL;

INSERT INTO finance.ledger_audit (id, wallet_id, actor_user_id, action, amount_cents, currency, metadata, created_at)
SELECT pg_temp.p1_k('audit:' || t.key),
       pg_temp.wallet(t.otype, CASE t.otype WHEN 'team' THEN pg_temp.p1_team(t.owner_key) ELSE pg_temp.p1_biz(t.owner_key) END, t.cur),
       COALESCE((SELECT b.owner_user_id FROM org.business_profiles b WHERE b.id = pg_temp.p1_biz(t.owner_key)),
                (SELECT x.owner_user_id FROM org.teams x WHERE x.id = pg_temp.p1_team(t.owner_key))),
       'add_funds', t.amount, t.cur, jsonb_build_object('note', t.note), pg_temp.p1_ago(t.days)
  FROM p01_topup t
ON CONFLICT (id) DO NOTHING;

-- One invoice per ticket escrow: paid once released, issued while held, void once refunded.
INSERT INTO finance.invoices
    (id, project_stage_id, issue_to_business_id, issue_from_profile, invoice_type, amount_cents, subtotal_cents,
     platform_fee_cents, tax_cents, total_cents, currency, status, due_date, paid_at, created_at)
SELECT pg_temp.p1_k('invoice:' || e.key), pg_temp.p1_stg(e.project, e.n), pg_temp.p1_biz(e.payer),
       CASE e.ptype WHEN 'team' THEN pg_temp.p1_team(e.payee) ELSE pg_temp.p1_who(e.payee) END, 'per_stage', e.amount, e.amount,
       CASE WHEN e.status = 'released' THEN (e.amount * 500) / 10000 ELSE 0 END, 0, e.amount, e.cur,
       CASE e.status WHEN 'released' THEN 'paid' WHEN 'held' THEN 'issued' ELSE 'void' END,
       pg_temp.p1_ago(e.funded - 30), CASE WHEN e.status = 'released' THEN pg_temp.p1_ago(e.released) END, pg_temp.p1_ago(e.funded)
  FROM p01_escrow e
 WHERE e.ticket IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.invoice_line_items (id, invoice_id, ref_type, ref_id, description, amount_cents, currency)
SELECT pg_temp.p1_k('invoice-line:' || e.key || ':' || l.kind), pg_temp.p1_k('invoice:' || e.key), l.kind,
       pg_temp.p1_k('escrow:' || e.key), l.label, l.amount, e.cur
  FROM p01_escrow e
  JOIN p01_ticket t ON t.project = e.project AND t.key = e.ticket
  JOIN p01_stage s ON s.project = e.project AND s.n = e.n
  CROSS JOIN LATERAL (VALUES
      ('escrow', t.title || ' — ' || s.name, e.amount),
      ('platform_fee', 'Platform fee (5%) — deducted from the payee', -((e.amount * 500) / 10000))
  ) AS l(kind, label, amount)
 WHERE l.kind = 'escrow' OR e.status = 'released'
ON CONFLICT (id) DO NOTHING;

-- A no-show claim on the Autumn cohort's second sitting: the room's logs do not settle it, so it waits
-- on the target, who hosted. The only door that opens a dispute today is a session no-show claim.
INSERT INTO finance.disputes
    (id, escrow_id, session_event_id, opened_by_profile, reason, status, audit, respond_by, created_at, updated_at)
VALUES
    (pg_temp.p1_k('dispute'), pg_temp.p1_k('escrow:seat-nov-daniel'), pg_temp.p1_k('sitting:n2'), pg_temp.p1_who('danielokafor'),
     'The host did not appear in the room for the second sitting.', 'awaiting_response',
     jsonb_build_object('verdict', 'ambiguous', 'presence_outcome', 'untracked', 'tracked', false, 'host_presence_pct', 0,
                        'claimant_presence_pct', 96, 'host_seconds', NULL, 'claimant_seconds', 120, 'reconnects', 0,
                        'threshold_pct', 80, 'audited_at', pg_temp.p1_ago(1.4), 'timeline', '[]'::jsonb),
     pg_temp.p1_ago(-0.6), pg_temp.p1_ago(1.9), pg_temp.p1_ago(1.4))
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.dispute_messages (id, dispute_id, sender_user_id, party, body, created_at)
VALUES
    (pg_temp.p1_k('dispute-message'), pg_temp.p1_k('dispute'), pg_temp.p1_who('danielokafor'), 'claimant',
     'I joined on time and waited for the whole session. Nobody else came into the room.', pg_temp.p1_ago(1.9))
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Service instantiations
INSERT INTO projects.service_instantiations
    (id, project_id, blueprint_id, owner_user_id, idempotency_key, intake_answers, currency, created_at)
SELECT pg_temp.p1_k('instantiation:' || p.key), pg_temp.p1_pid(p.key), pg_temp.p1_blueprint(p.o ->> 'blueprint'), pg_temp.p1_who(p.owner),
       'snippet-' || substr(md5(p.key), 1, 16), '{}'::jsonb, p.cur, pg_temp.p1_ago(p.created)
  FROM p01_project p
 WHERE (p.o ->> 'instantiated')::boolean
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Rooms, messages and activity
INSERT INTO comms.project_channels (id, project_id, name, stage_id, visibility, created_at)
SELECT pg_temp.p1_k('channel:' || p.key || ':0'), pg_temp.p1_pid(p.key), 'Discussion', NULL, 'project_all', pg_temp.p1_ago(p.created)
  FROM p01_project p
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.project_channels (id, project_id, name, stage_id, visibility, created_at)
SELECT pg_temp.p1_k('channel:' || s.project || ':' || s.n), pg_temp.p1_pid(s.project), s.name, pg_temp.p1_stg(s.project, s.n),
       'stage_all', pg_temp.p1_ago(p.created)
  FROM p01_stage s
  JOIN p01_project p ON p.key = s.project
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.project_channel_participants (id, channel_id, profile_type, profile_id, role)
SELECT pg_temp.p1_k('channel-participant:' || p.key || ':' || x.profile_id), pg_temp.p1_k('channel:' || p.key || ':0'),
       x.profile_type, x.profile_id, CASE WHEN x.profile_type = 'business' THEN 'owner' ELSE 'participant' END
  FROM p01_project p
  JOIN projects.project_participants x ON x.project_id = pg_temp.p1_pid(p.key)
ON CONFLICT (id) DO NOTHING;

INSERT INTO comms.project_messages (id, channel_id, sender_user_id, body, created_at)
SELECT pg_temp.p1_k('message:' || v.project || ':' || v.seq), pg_temp.p1_k('channel:' || v.project || ':' || v.n),
       pg_temp.p1_who(v.who), v.body, pg_temp.p1_ago(v.days)
  FROM (VALUES
    ('hired-progress', 1, 0, 'priyaraman', 'Welcome back for the build. Flags are set up and staging is yours.', 18),
    ('hired-progress', 2, 0, 'me', 'Thanks Priya. I will share the cart summary by Thursday.', 17.9),
    ('hired-progress', 3, 2, 'me', 'Payment step is on staging. Error states are next.', 2.1),
    ('hired-progress', 4, 2, 'priyaraman', 'Looks good on my phone. Can we keep the saved cards above the fold?', 0.15),
    ('hired-revisions', 1, 2, 'danielokafor', 'Direction B is the one. The tables need more air, though.', 15),
    ('hired-revisions', 2, 2, 'me', 'Understood. Round two will open up the row height and the gutters.', 14.8),
    ('hired-revisions', 3, 2, 'danielokafor', 'Contrast on the dark theme is the last thing before we can sign off.', 6),
    ('hired-overdue', 1, 0, 'danielokafor', 'Where are we on the reconciliation? Finance is asking.', 22),
    ('hired-overdue', 2, 0, 'me', 'The orphaned contacts are the last blocker. I will send a list you can triage.', 21.8),
    ('hired-today', 1, 1, 'priyaraman', 'Campaign goes live at midnight. Are the last three pages on track?', 0.2),
    ('hired-today', 2, 1, 'me', 'Yes. Two are in staging, the third by this evening.', 0.05),
    ('hired-workload', 1, 1, 'me', 'I have filed a workload report: the ticket covers one scanner and there are three.', 1.3),
    ('biz-rollout', 1, 0, 'me', 'Key visual is approved, thank you Ren. Juno, the toolkit is yours next.', 39),
    ('biz-rollout', 2, 0, 'juno', 'On it. Template master is done; partner variants this week.', 11),
    ('biz-rollout', 3, 3, 'lenamueller', 'All nine SKUs are in for review, with alt text in the second tab.', 2.5),
    ('seat-active', 1, 0, 'danielokafor', 'The data foundation is solid. Happy to fund the live board.', 49),
    ('seat-active', 2, 2, 'saoirsebyrne', 'I will pair with you on depot tiles this week.', 17),
    ('seat-active', 3, 2, 'me', 'Tiles are done. Aiko has picked up the latency alerts.', 0.4),
    ('role-admin', 1, 0, 'noor', 'I am away for two weeks. Please keep the roster moving.', 44),
    ('role-admin', 2, 0, 'me', 'Will do. Lena is on the identity applications.', 8),
    ('sess-group', 1, 0, 'me', 'Bring one piece of live work to each sitting.', 30),
    ('personal-planner', 1, 0, 'me', 'Notes to self: lead with outcomes, cut the process shots.', 5)
  ) AS v(project, seq, n, who, body, days)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_activity (id, project_id, actor_user_id, kind, payload, entity_table, entity_id, created_at)
SELECT pg_temp.p1_k('activity:seat:' || a.project || ':' || a.n || ':' || a.who), pg_temp.p1_pid(a.project), pg_temp.p1_who(p.owner), 'seat_assigned',
       jsonb_build_object('stage_id', pg_temp.p1_stg(a.project, a.n), 'assignee_type', a.kind),
       'projects.stage_assignments', pg_temp.p1_k('assign:' || a.project || ':' || a.n || ':' || a.who), pg_temp.p1_ago(a.days)
  FROM p01_assign a
  JOIN p01_project p ON p.key = a.project
 WHERE a.status <> 'pending_funding'
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_activity (id, project_id, actor_user_id, kind, payload, entity_table, entity_id, created_at)
SELECT pg_temp.p1_k('activity:review:' || s.key), pg_temp.p1_pid(s.project), pg_temp.p1_who(s.reviewer), 'submission_reviewed',
       jsonb_build_object('submission_id', pg_temp.p1_k('submission:' || s.key), 'decision', s.status, 'status', s.status),
       'projects.stage_submissions', pg_temp.p1_k('submission:' || s.key), pg_temp.p1_ago(s.days - LEAST(1, s.days / 2))
  FROM p01_submission s
 WHERE s.reviewer IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_activity (id, project_id, actor_user_id, kind, payload, entity_table, entity_id, created_at)
SELECT pg_temp.p1_k('activity:ticket:' || t.project || ':' || t.key), pg_temp.p1_pid(t.project), pg_temp.p1_who(p.owner), 'milestone_confirmed',
       jsonb_build_object('ticket_id', pg_temp.p1_tkt(t.project, t.key), 'stage_id', pg_temp.p1_stg(t.project, t.n)),
       'projects.tickets', pg_temp.p1_tkt(t.project, t.key), pg_temp.p1_ago(COALESCE(e.released, p.activity))
  FROM p01_ticket t
  JOIN p01_project p ON p.key = t.project
  LEFT JOIN p01_escrow e ON e.project = t.project AND e.ticket = t.key AND e.status = 'released'
 WHERE t.status = 'completed' AND NOT COALESCE((p.o ->> 'personal')::boolean, false)
ON CONFLICT (id) DO NOTHING;

-- Pending invitations reach the target here and in the DM with the inviter; /projects lists no prospects.
INSERT INTO comms.notifications
    (id, user_id, type, title, body, entity_table, entity_id, category, urgency, channels, actor_user_id,
     context_type, context_id, action_url, payload, created_at)
SELECT pg_temp.p1_k('notification:' || i.project || ':' || COALESCE(i.n, 0) || ':' || i.role), pg_temp.me(), nt.key,
       trim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) || ' invited you to ' || COALESCE(s.name, p.title),
       p.title || COALESCE(' · ' || s.name, '') || ' — ' || left(i.message, 140),
       'projects.project_invitations',
       pg_temp.p1_k('invite:' || i.project || ':' || COALESCE(i.n, 0) || ':me:' || i.role),
       nt.category, nt.urgency, nt.default_channels, u.user_id, 'project', pg_temp.p1_pid(i.project),
       '/messages/dm-' || u.username,
       jsonb_build_object('project_slug', pg_temp.slug('prj', 'p01:' || i.project), 'project_title', p.title,
                          'stage_id', CASE WHEN i.n IS NOT NULL THEN pg_temp.p1_stg(i.project, i.n) END,
                          'stage_name', s.name, 'offer_price_cents', COALESCE(i.offer, s.price), 'currency', p.cur,
                          'placeholder', i.placeholder),
       pg_temp.p1_ago(i.days)
  FROM p01_invite i
  JOIN p01_project p ON p.key = i.project
  JOIN org.users_public u ON u.user_id = pg_temp.p1_who(i.by_who)
  JOIN comms.notification_types nt ON nt.key = 'stage.invite'
  LEFT JOIN p01_stage s ON s.project = i.project AND s.n = i.n
 WHERE i.who = 'me' AND i.status = 'pending'
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Reviews
-- Each review lands on the target or on an entity this script made, so no seeded rating moves.
INSERT INTO reviews.entity_reviews
    (id, target_entity_id, target_entity_type, reviewer_user_id, project_id, rating, title, comment, reply_comment,
     replied_at, created_at, updated_at)
SELECT pg_temp.p1_k('review:' || v.project || ':' || v.reviewer),
       CASE v.kind WHEN 'freelancer' THEN pg_temp.p1_who(v.target) WHEN 'business' THEN pg_temp.p1_biz(v.target) ELSE pg_temp.p1_team(v.target) END,
       v.kind::reviews.review_target_type, pg_temp.p1_who(v.reviewer), pg_temp.p1_pid(v.project), v.rating, v.title, v.comment, v.reply,
       CASE WHEN v.reply IS NOT NULL THEN pg_temp.p1_ago(v.days - 2) END, pg_temp.p1_ago(v.days), pg_temp.p1_ago(v.days)
  FROM (VALUES
    ('hired-closed', 'danielokafor', 'freelancer', 'me', 5.00, 'Dispatchers trusted it from day one',
     'Clear research, a dashboard our dispatchers adopted within a week, and a handover that meant we never had to ring for help. We would hire again without a second thought.', NULL::text, 73),
    ('hired-closed', 'me', 'business', 'b2', 4.50, 'Decisive and quick to review',
     'Daniel kept the feedback specific and arrived on time for every review, which kept the whole build moving. Funding was prompt at each stage and the brief stayed stable throughout.', NULL, 72),
    ('hired-removed', 'priyaraman', 'freelancer', 'me', 3.00, 'Good work, but the stage overran',
     'The header modules were well made, but the template stage ran past the date we needed it and we moved it to someone else in the end. Communication was honest throughout.',
     'That is fair. The client list grew after kickoff and I should have raised the timing sooner. Happy to have stayed on for the render testing, and grateful for the straight feedback.', 12),
    ('biz-done', 'renkoda', 'business', 'b3', 5.00, 'A brief worth working from',
     'Larkspur had the content ready when they said it would be and signed off each stage in days. Every escrow was funded before work started, so the project never stalled.', NULL, 111),
    ('seat-active', 'danielokafor', 'team', 't1', 4.00, 'A strong first stage',
     'The collective delivered a clean data foundation on the first stage and communicated well between members. A few handoffs took longer than planned, but the result has held up.', NULL, 48)
  ) AS v(project, reviewer, kind, target, rating, title, comment, reply, days)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region Summary
SELECT label, total FROM (
    SELECT 1 AS ord, 'Projects around this account' AS label, count(*) AS total
      FROM projects.projects WHERE id IN (SELECT pg_temp.p1_pid(key) FROM p01_project)
    UNION ALL SELECT 2, 'Owned by this account', count(*) FROM projects.projects WHERE owner_user_id = pg_temp.me()
    UNION ALL SELECT 3, 'Listed on /projects (owner or participant, not archived)', count(*)
      FROM projects.projects x
     WHERE x.status <> 'archived'
       AND (x.owner_user_id = pg_temp.me() OR EXISTS (
            SELECT 1 FROM projects.project_participants pp WHERE pp.project_id = x.id AND pp.profile_id = pg_temp.me()))
    UNION ALL SELECT 4, 'Stages', count(*) FROM projects.project_stages WHERE project_id IN (SELECT pg_temp.p1_pid(key) FROM p01_project)
    UNION ALL SELECT 5, 'Tickets', count(*) FROM projects.tickets WHERE project_id IN (SELECT pg_temp.p1_pid(key) FROM p01_project)
    UNION ALL SELECT 6, 'Invitations to this account', count(*) FROM projects.project_invitations WHERE target_user_id = pg_temp.me()
    UNION ALL SELECT 7, 'Applications by this account', count(*) FROM projects.project_applications WHERE applicant_user_id = pg_temp.me()
    UNION ALL SELECT 8, 'Submissions', count(*) FROM projects.stage_submissions
     WHERE project_stage_id IN (SELECT id FROM projects.project_stages WHERE project_id IN (SELECT pg_temp.p1_pid(key) FROM p01_project))
    UNION ALL SELECT 9, 'Escrows held', count(*) FROM finance.escrows WHERE id IN (SELECT pg_temp.p1_k('escrow:' || key) FROM p01_escrow) AND status = 'held'
    UNION ALL SELECT 10, 'Escrows released', count(*) FROM finance.escrows WHERE id IN (SELECT pg_temp.p1_k('escrow:' || key) FROM p01_escrow) AND status = 'released'
    UNION ALL SELECT 11, 'Escrows refunded', count(*) FROM finance.escrows WHERE id IN (SELECT pg_temp.p1_k('escrow:' || key) FROM p01_escrow) AND status = 'refunded'
    UNION ALL SELECT 12, 'Reviews on this project set', count(*) FROM reviews.entity_reviews WHERE project_id IN (SELECT pg_temp.p1_pid(key) FROM p01_project)
) s
ORDER BY ord;
-- #endregion

COMMIT;
