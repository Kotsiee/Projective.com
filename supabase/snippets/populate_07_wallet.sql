-- =============================================================================================
-- populate_07_wallet.sql: fourteen months of money for one account.
--
-- WHAT IT WRITES
--   The target's personal wallet and its whole ledger (about 170 rows over 14 months, nothing
--   before the account existed), in one chronological walk. Behind the lines: three client businesses
--   owned by personas, each with its own wallet and ledger; eight projects with stages, tickets and
--   escrows (released, held, frozen by a card chargeback, one Fair Exit); product and service orders
--   from the persona pool; card top-ups and a recurring deposit; payouts in every reachable state;
--   saved cards and payout methods; a payout schedule; pots; the Income Smoother; a Pro subscription
--   with its events; stage invoices in every status; monthly statements; a lost card chargeback; and
--   earned money still inside the 7-day window, so Available, Pending, Locked and On hold all differ.
--
-- WHICH PAGES SHOW IT
--   /wallet, /wallet/transactions, /wallet/analytics, Settings → Billing (the plan).
--   /wallet/invoices lists bills and statements for a business vault only, so a personal wallet's
--   stage invoices surface as receipts on its ledger lines, and its statements as PDFs by address.
--   The clients' own vaults (`?w=business:…`, signed in as the persona) show the invoices page.
--
-- HOW TO RUN IT
--   Open this file in Studio's SQL editor (localhost:54323) and press Run, or:
--     docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/snippets/populate_07_wallet.sql
--   Run it LAST, after populate_01 to 06: the released escrows, team splits and service orders those
--   snippets left for the target are credited here, in date order, with most of each month drawn down
--   to the bank. Running it first still works, and a re-run then picks them up with today's date.
--   Running it twice is a no-op.
--
-- TO POPULATE SOMEBODY ELSE
--   Change the one username at the top of the prelude, below `BEGIN;`.
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

-- #region [The script's data]
-- Every date is days before now(), plus a stable offset of up to 13 hours so lines are not on the hour.
CREATE OR REPLACE FUNCTION pg_temp.w6_at(p_days numeric, p_key text) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT now() - make_interval(secs => (p_days * 86400 + get_byte(decode(md5(p_key), 'hex'), 0) * 180)::double precision);
$$;

/** The people and companies who pay the target. Each business is owned by a persona. */
CREATE OR REPLACE FUNCTION pg_temp.w6_clients()
RETURNS TABLE (key text, name text, legal text, owner text, country text, tz text, city text, headline text, card text)
LANGUAGE sql IMMUTABLE AS $$
    VALUES
        ('corbel', 'Corbel Logistics', 'Corbel Logistics AB', 'rosalindqvist', 'Sweden', 'Europe/Stockholm', 'Gothenburg',
         'Regional freight, planned around the people who drive it', '1881'),
        ('lumen', 'Lumen & Vale', 'Lumen & Vale Inc.', 'hannahcole', 'United States', 'America/New_York', 'Brooklyn',
         'Small-batch skincare, sold direct', '5100'),
        ('meadowbank', 'Meadowbank Health', 'Meadowbank Health Group', 'miguelsantos', 'Portugal', 'Europe/Lisbon', 'Lisbon',
         'Outpatient clinics along the Atlantic coast', '0077')
$$;

CREATE OR REPLACE FUNCTION pg_temp.w6_projects()
RETURNS TABLE (key text, client text, title text, brief text, status project_status)
LANGUAGE sql IMMUTABLE AS $$
    VALUES
        ('onboarding', 'corbel', 'Driver onboarding flow', 'Get a new driver from signed contract to first shift inside the app, without a depot visit.', 'completed'::project_status),
        ('checkout', 'lumen', 'Storefront checkout rebuild', 'Replace a five-step checkout that loses a third of its mobile traffic.', 'completed'),
        ('intake', 'meadowbank', 'Patient intake forms', 'One accessible set of intake forms across every clinic.', 'completed'),
        ('fleet', 'corbel', 'Fleet operations dashboard', 'A single view of every vehicle, route and exception for the dispatch team.', 'completed'),
        ('portal', 'lumen', 'Subscription self-service portal', 'Let subscribers change, pause and leave without writing to support.', 'completed'),
        ('scheduling', 'meadowbank', 'Clinic scheduling audit', 'Review the booking journey and prototype a replacement.', 'cancelled'),
        ('apidocs', 'corbel', 'Route planning API docs', 'Public documentation for the route planning API, from reference to developer portal.', 'active'),
        ('loyalty', 'lumen', 'Loyalty programme launch', 'A points programme and its launch campaign for existing subscribers.', 'active')
$$;

/**
 * One row per stage. `state`: released · exited (a Fair Exit at 50%) · held · disputed (the client's
 * card payment for the stage was charged back, freezing its escrow) · open (unfunded). No earnings
 * before day 322: the target's identity check is dated 330 days ago and an earner is gated on it.
 */
CREATE OR REPLACE FUNCTION pg_temp.w6_stage_rows()
RETURNS TABLE (project text, sort integer, name text, brief text, amount bigint, funded_ago integer, released_ago integer, state text, due_in integer)
LANGUAGE sql IMMUTABLE AS $$
    VALUES
        ('onboarding', 1, 'Discovery and journey map', 'Ride-alongs with six drivers and a journey map of the first thirty days.', 140000::bigint, 322, 306, 'released', NULL::integer),
        ('onboarding', 2, 'Onboarding screens', 'Document capture, vehicle checks and shift preferences, designed for one-handed use.', 260000, 305, 283, 'released', NULL),
        ('onboarding', 3, 'Build and handoff', 'React Native build of the flow with analytics events wired in.', 220000, 282, 262, 'released', NULL),
        ('checkout', 1, 'Checkout audit', 'Funnel review of the current checkout with a ranked list of fixes.', 120000, 268, 251, 'released', NULL),
        ('checkout', 2, 'Payment step redesign', 'Wallets, saved cards and address autocomplete on a single step.', 340000, 250, 226, 'released', NULL),
        ('checkout', 3, 'Implementation', 'Ship the new checkout behind a flag and run it against the old one.', 420000, 225, 199, 'released', NULL),
        ('intake', 1, 'Form inventory', 'Catalogue of every intake form across the clinics, with overlaps marked.', 90000, 232, 219, 'released', NULL),
        ('intake', 2, 'Accessible form kit', 'Reusable, screen-reader-tested form components for clinical data.', 280000, 218, 190, 'released', NULL),
        ('intake', 3, 'Clinic rollout', 'Rollout support for the first four clinics, with staff training notes.', 190000, 189, 171, 'released', NULL),
        ('fleet', 1, 'Operations research', 'Shadow two dispatch shifts and define what a good morning looks like.', 240000, 196, 178, 'released', NULL),
        ('fleet', 2, 'Data model and API', 'Vehicle, route and exception model with a read API for the dashboard.', 620000, 177, 159, 'released', NULL),
        ('fleet', 3, 'Live map view', 'Realtime vehicle map with route adherence overlays.', 580000, 165, 145, 'released', NULL),
        ('fleet', 4, 'Exceptions queue', 'Late, blocked and damaged deliveries triaged in one queue.', 540000, 144, 124, 'released', NULL),
        ('fleet', 5, 'Reporting suite', 'Weekly depot reports, exported and emailed on a schedule.', 480000, 123, 104, 'released', NULL),
        ('portal', 1, 'Portal information architecture', 'Map of everything a subscriber needs without contacting support.', 180000, 158, 143, 'released', NULL),
        ('portal', 2, 'Plan management', 'Pause, skip and swap flows with clear billing previews.', 460000, 142, 121, 'released', NULL),
        ('portal', 3, 'Billing history', 'Invoices, refunds and failed-payment recovery in one view.', 310000, 120, 100, 'released', NULL),
        ('portal', 4, 'Cancellation flow', 'An honest exit path with a pause offer and a reason capture.', 240000, 99, 83, 'released', NULL),
        ('scheduling', 1, 'Current-state review', 'Walkthrough of the booking flow at three clinics, with pain points ranked.', 130000, 95, 78, 'released', NULL),
        ('scheduling', 2, 'Scheduler prototype', 'Clickable prototype of a new booking flow, ended early when the client changed vendor.', 360000, 77, 58, 'exited', NULL),
        ('apidocs', 1, 'API inventory', 'Audit of every public endpoint with owners and gaps.', 160000, 70, 52, 'released', NULL),
        ('apidocs', 2, 'Reference docs', 'Generated reference with hand-written notes for the tricky endpoints.', 380000, 51, 26, 'released', NULL),
        ('apidocs', 3, 'SDK quickstarts', 'Quickstarts for TypeScript and Python.', 150000, 30, 5, 'released', NULL),
        ('apidocs', 4, 'Guides and examples', 'Task-based guides covering routing, tracking and webhooks.', 420000, 12, NULL, 'held', 16),
        ('apidocs', 5, 'Developer portal launch', 'Portal theming, search and a launch checklist.', 260000, NULL, NULL, 'open', 40),
        ('loyalty', 1, 'Campaign concept', 'Positioning, tiers and the launch campaign concept.', 220000, 44, 20, 'released', NULL),
        ('loyalty', 2, 'Landing pages', 'Launch landing pages in three languages.', 310000, 18, 3, 'released', NULL),
        ('loyalty', 3, 'Rewards calculator', 'Interactive points calculator for the launch page.', 240000, 17, NULL, 'disputed', NULL),
        ('loyalty', 4, 'Member area', 'Signed-in member area with tier progress.', 350000, 9, NULL, 'held', 24)
$$;

/** The stage rows with their ids, dates and money. Fees truncate at 5%, as `fn_release_ticket_escrow` and `platformFeeFor` do. */
CREATE OR REPLACE FUNCTION pg_temp.w6_stages()
RETURNS TABLE (
    key text, project text, client text, sort integer, name text, brief text, amount bigint, state text, due_in integer,
    stage_id uuid, ticket_id uuid, escrow_id uuid, biz uuid, client_owner uuid,
    funded_at timestamptz, released_at timestamptz, fee bigint, net bigint
)
LANGUAGE sql STABLE AS $$
    SELECT k.key, s.project, p.client, s.sort, s.name, s.brief, s.amount, s.state, s.due_in,
           pg_temp.sid('stage:' || k.key), pg_temp.sid('ticket:' || k.key), pg_temp.sid('escrow:' || k.key),
           pg_temp.sid('biz:' || p.client), pg_temp.persona(c.owner),
           CASE WHEN s.funded_ago IS NOT NULL THEN pg_temp.w6_at(s.funded_ago, 'funded:' || k.key) END,
           CASE WHEN s.released_ago IS NOT NULL THEN pg_temp.w6_at(s.released_ago, 'released:' || k.key) END,
           m.fee, m.earned - m.fee
      FROM pg_temp.w6_stage_rows() s
      JOIN pg_temp.w6_projects() p ON p.key = s.project
      JOIN pg_temp.w6_clients() c ON c.key = p.client
      CROSS JOIN LATERAL (SELECT s.project || ':' || s.sort AS key) k
      CROSS JOIN LATERAL (
          SELECT e.earned, e.earned * 500 / 10000 AS fee
            FROM (SELECT CASE s.state WHEN 'released' THEN s.amount WHEN 'exited' THEN s.amount * 5000 / 10000 ELSE 0 END AS earned) e
      ) m
$$;

CREATE OR REPLACE FUNCTION pg_temp.w6_products()
RETURNS TABLE (key text, title text, brief text, format catalogue.product_format, price bigint)
LANGUAGE sql IMMUTABLE AS $$
    VALUES
        ('kit', 'Dashboard UI kit for Figma', 'Forty responsive dashboard screens with auto-layout components.', 'template'::catalogue.product_format, 5900::bigint),
        ('notion', 'Notion client portal template', 'A shareable client portal with briefs, timelines and invoices.', 'template', 2900),
        ('pricing', 'SaaS pricing page pack', 'Twelve pricing page layouts with comparison tables.', 'template', 3900),
        ('webhook', 'Deno webhook starter', 'A typed webhook receiver with retries and signature checks.', 'source_code', 7900)
$$;

/**
 * Every sale of the target's work: 96 product downloads, denser as the shop grew, and nine small
 * services. A product pays the rung 1 marketplace commission (8%), a service the 5% fee, both
 * truncated, and each sale clears the 7-day window before it reaches the ledger.
 */
CREATE OR REPLACE FUNCTION pg_temp.w6_sales()
RETURNS TABLE (
    key text, title text, subtitle text, item_type finance.purchasable_item_kind, item_id uuid,
    fulfilment finance.fulfilment_kind, buyer uuid, at timestamptz, price bigint, fee_bp integer, fee bigint,
    reason text, refunded_at timestamptz
)
LANGUAGE sql STABLE AS $$
    SELECT 'sale:' || i, p.title, 'Instant download', 'digital_product'::finance.purchasable_item_kind,
           pg_temp.sid('product:' || p.key), 'download'::finance.fulfilment_kind,
           pg_temp.persona((ARRAY['noor', 'chloewinters', 'theo', 'lenamueller', 'priyaraman', 'renkoda', 'danielokafor',
                                  'inesduarte', 'miguelsantos', 'saoirsebyrne', 'hannahcole', 'tomaszwojcik'])[1 + (i * 5) % 12]),
           pg_temp.w6_at(d.days, 'sale:' || i), p.price, 800, p.price * 800 / 10000, 'product_sale',
           CASE WHEN i IN (22, 49, 78) THEN pg_temp.w6_at(d.days - 9, 'refund:' || i) END
      FROM generate_series(1, 96) i
      CROSS JOIN LATERAL (SELECT round(418 * (1 - power(i / 96.0, 0.6)))::integer + (i * 11) % 6 AS days) d
      JOIN pg_temp.w6_products() p
        ON p.key = (ARRAY['kit', 'notion', 'pricing', 'notion', 'kit', 'webhook', 'pricing'])[1 + (i * 3) % 7]
    UNION ALL
    SELECT 'service:' || v.key, v.title, v.subtitle, v.kind::finance.purchasable_item_kind,
           -- shortcut: a service line's item_id names no blueprint, upgrade if the buyer's order page must link to one
           pg_temp.sid('service:' || v.title), 'engagement'::finance.fulfilment_kind, pg_temp.persona(v.buyer),
           pg_temp.w6_at(v.days, 'service:' || v.key), v.price, 500, v.price * 500 / 10000, 'service_sale', NULL
      FROM (VALUES
          ('review-1', 'Landing page conversion review', 'Written teardown within five days', 'one_off_service', 'noor', 296, 24000::bigint),
          ('critique-1', 'Async product critique', 'Recorded walkthrough within 48 hours', 'single_service_task', 'theo', 262, 12000),
          ('review-2', 'Landing page conversion review', 'Written teardown within five days', 'one_off_service', 'priyaraman', 231, 24000),
          ('health-1', 'Design system health check', 'Scored audit with a fix list', 'one_off_service', 'danielokafor', 204, 48000),
          ('critique-2', 'Async product critique', 'Recorded walkthrough within 48 hours', 'single_service_task', 'miguelsantos', 176, 12000),
          ('health-2', 'Design system health check', 'Scored audit with a fix list', 'one_off_service', 'hannahcole', 139, 48000),
          ('critique-3', 'Async product critique', 'Recorded walkthrough within 48 hours', 'single_service_task', 'noor', 111, 12000),
          ('review-3', 'Landing page conversion review', 'Written teardown within five days', 'one_off_service', 'rosalindqvist', 62, 28000),
          ('health-3', 'Design system health check', 'Scored audit with a fix list', 'one_off_service', 'priyaraman', 33, 54000)
      ) v (key, title, subtitle, kind, buyer, days, price)
$$;

/** What the target bought with wallet money, at the seeded listing's own price. */
CREATE OR REPLACE FUNCTION pg_temp.w6_purchases()
RETURNS TABLE (key text, at timestamptz, product uuid, title text, price bigint, refunded_at timestamptz)
LANGUAGE sql STABLE AS $$
    SELECT v.key, pg_temp.w6_at(v.days, 'buy:' || v.key), p.id, p.title, p.price_cents,
           CASE WHEN v.refunded THEN pg_temp.w6_at(v.days - 2, 'unbuy:' || v.key) END
      FROM (VALUES
          ('buy-1', 412, 'Iconography set — 640', false),
          ('buy-2', 390, 'Motion primitives', false),
          ('buy-3', 365, 'Notion ops suite', true),
          ('buy-4', 340, 'Dashboard blocks', false),
          ('buy-5', 210, 'Aurora UI kit', false),
          ('buy-6', 75, 'Editorial type system', false)
      ) v (key, days, title, refunded)
      CROSS JOIN LATERAL (
          SELECT c.id, c.title, c.price_cents FROM catalogue.products c
           WHERE c.title = v.title AND c.owner_user_id <> pg_temp.me() AND c.currency = 'USD'
           ORDER BY c.created_at LIMIT 1
      ) p
$$;

/** Card top-ups: a few while the account was only buying, then a small monthly tools deposit. */
CREATE OR REPLACE FUNCTION pg_temp.w6_topups()
RETURNS TABLE (key text, at timestamptz, amount bigint, method text, rule text)
LANGUAGE sql STABLE AS $$
    SELECT v.key, pg_temp.w6_at(v.days, 'topup:' || v.key), v.amount, v.method, v.rule
      FROM (
          VALUES ('t1', 420, 25000::bigint, 'visa', NULL::text),
                 ('t2', 398, 15000, 'amex', NULL),
                 ('t3', 371, 20000, 'visa', NULL),
                 ('t4', 348, 10000, 'visa', NULL),
                 ('t5', 333, 12000, 'visa', NULL)
          UNION ALL
          SELECT 'tools-' || n, n * 30 + 10, 6000, 'visa', 'tools' FROM generate_series(0, 6) n
      ) v (key, days, amount, method, rule)
$$;

/**
 * Every withdrawal. `failed`: the transfer was refused and the money came back (`fail_payout`).
 * `reversed`: sent, then pulled back whole (`record_transfer_reversed`). `pending`: debited and in
 * flight. A `paid` row with bank 'failed' left the platform and bounced at the bank, so nothing
 * moves in the ledger. A `paid` row with no bank outcome yet is on its way to the bank.
 * `finance.payout_status` also has `cancelled`, which nothing writes, so it is left out.
 */
CREATE OR REPLACE FUNCTION pg_temp.w6_payouts()
RETURNS TABLE (key text, days integer, amount bigint, status finance.payout_status, instant boolean, method text, bank text, note text)
LANGUAGE sql IMMUTABLE AS $$
    VALUES
        ('p01', 292, 150000::bigint, 'paid'::finance.payout_status, false, 'bank', 'paid', NULL::text),
        ('p02', 268, 240000, 'paid', false, 'bank', 'paid', NULL),
        ('p03', 244, 250000, 'paid', false, 'bank', 'paid', NULL),
        ('p04', 214, 300000, 'paid', true, 'bank', 'paid', NULL),
        ('p05', 186, 600000, 'paid', false, 'bank', 'paid', NULL),
        ('p06', 171, 150000, 'failed', false, 'wise', NULL, 'The connected account cannot receive transfers yet.'),
        ('p07', 170, 150000, 'paid', false, 'bank', 'paid', NULL),
        ('p08', 150, 700000, 'paid', false, 'oldbank', 'failed', NULL),
        ('p09', 147, 250000, 'paid', true, 'wise', 'paid', NULL),
        ('p10', 130, 600000, 'paid', false, 'bank', 'paid', NULL),
        ('p11', 112, 800000, 'paid', false, 'bank', 'paid', NULL),
        ('p12', 96, 200000, 'reversed', false, 'bank', 'paid', NULL),
        ('p13', 90, 1100000, 'paid', false, 'bank', 'paid', NULL),
        ('p14', 66, 400000, 'paid', false, 'bank', 'paid', NULL),
        ('p15', 44, 180000, 'paid', true, 'wise', 'paid', NULL),
        ('p16', 15, 350000, 'paid', false, 'bank', 'paid', NULL),
        ('p17', 2, 200000, 'paid', false, 'bank', NULL, NULL),
        ('p18', 0, 120000, 'pending', false, 'bank', NULL, NULL)
$$;
-- #endregion

-- #region [Client businesses]
SELECT pg_temp.ensure_verified();

INSERT INTO org.business_profiles
    (id, owner_user_id, name, slug, legal_name, country, billing_email, plan, headline, bio, languages, timezone,
     default_currency, address_city, invoicing_mode, status, kyb_status, kyb_verified_at, kyb_provider_ref, visibility, created_at)
SELECT pg_temp.sid('biz:' || c.key), pg_temp.persona(c.owner), c.name,
       c.key || substr(pg_temp.me()::text, 1, 4), c.legal, c.country,
       'accounts+' || substr(pg_temp.me()::text, 1, 4) || '@' || c.key || '.example', 'free', c.headline,
       jsonb_build_object('text', c.headline || '.'), ARRAY['English']::text[], c.tz, 'USD', c.city,
       'per_transaction', 'active', 'verified', now() - interval '375 days',
       'acct_snippet_' || c.key || substr(pg_temp.me()::text, 1, 4), 'unlisted', now() - interval '380 days'
  FROM pg_temp.w6_clients() c
ON CONFLICT (id) DO NOTHING;

SELECT org.fn_seed_preset_roles('business', pg_temp.sid('biz:' || c.key))
  FROM pg_temp.w6_clients() c
 WHERE NOT EXISTS (SELECT 1 FROM org.business_roles r WHERE r.business_id = pg_temp.sid('biz:' || c.key));

INSERT INTO org.business_members (id, business_id, user_id, role_id, role, status, title, joined_at, created_at)
SELECT pg_temp.sid('biz-owner:' || c.key), r.business_id, pg_temp.persona(c.owner), r.id, 'owner', 'active', 'Founder',
       now() - interval '380 days', now() - interval '380 days'
  FROM pg_temp.w6_clients() c
  JOIN org.business_roles r ON r.business_id = pg_temp.sid('biz:' || c.key) AND r.preset = 'owner'
ON CONFLICT (business_id, user_id) DO NOTHING;

SELECT pg_temp.wallet('business', pg_temp.sid('biz:' || c.key)) FROM pg_temp.w6_clients() c;

INSERT INTO finance.payment_methods
    (id, owner_type, owner_id, method_role, external_ref, label, brand, last4, is_default_funding, created_at)
SELECT pg_temp.sid('biz-card:' || c.key), 'business', pg_temp.sid('biz:' || c.key), 'funding',
       'pm_snippet_' || c.key || '_' || replace(pg_temp.me()::text, '-', ''), 'Company Visa', 'visa', c.card, true,
       now() - interval '378 days'
  FROM pg_temp.w6_clients() c
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region [Projects, stages, tickets, escrows]
INSERT INTO projects.projects
    (id, client_business_id, owner_user_id, title, slug, description, description_text, format, structure_variation,
     status, visibility, publish_visibility, currency, budget_type, budget_amount_cents, timeline_preset,
     target_project_start_date, ip_ownership_mode, portfolio_display_rights, created_at, updated_at, last_activity_at)
SELECT pg_temp.sid('project:' || p.key), s.biz, s.client_owner, p.title, pg_temp.slug('prj', 'wallet:' || p.key),
       jsonb_build_object('text', p.brief), p.brief, 'pipeline', 'standard', p.status, 'unlisted', 'unlisted', 'USD',
       'fixed_price', s.budget, 'sequential', s.started, 'exclusive_transfer', 'allowed',
       s.started - interval '6 days', s.latest, s.latest
  FROM pg_temp.w6_projects() p
  JOIN LATERAL (
      SELECT max(x.biz::text)::uuid AS biz, (array_agg(x.client_owner))[1] AS client_owner, sum(x.amount)::bigint AS budget,
             min(x.funded_at) AS started, max(COALESCE(x.released_at, x.funded_at)) AS latest
        FROM pg_temp.w6_stages() x WHERE x.project = p.key
  ) s ON true
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_participants (id, project_id, profile_type, profile_id, role, created_at)
SELECT pg_temp.sid('participant:' || p.key || ':' || w.who), pg_temp.sid('project:' || p.key), w.kind::profile_type,
       CASE w.who WHEN 'client' THEN pg_temp.sid('biz:' || p.client) ELSE pg_temp.me() END, w.role,
       pr.created_at
  FROM pg_temp.w6_projects() p
  JOIN projects.projects pr ON pr.id = pg_temp.sid('project:' || p.key)
 CROSS JOIN (VALUES ('client', 'business', 'client'), ('me', 'freelancer', 'assignee')) w (who, kind, role)
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.project_stages
    (id, project_id, name, slug, description, description_text, sort_order, status, unit_price_cents, completed_at,
     file_duration_mode, file_due_date, created_at)
SELECT s.stage_id, pg_temp.sid('project:' || s.project), s.name, pg_temp.slug('stg', 'wallet:' || s.key),
       jsonb_build_object('text', s.brief), s.brief, s.sort,
       (CASE s.state WHEN 'released' THEN 'paid' WHEN 'exited' THEN 'cancelled' WHEN 'held' THEN 'in_progress'
                     WHEN 'disputed' THEN 'submitted' ELSE 'open' END)::stage_status,
       s.amount, s.released_at,
       CASE WHEN s.due_in IS NOT NULL THEN 'fixed_deadline' END,
       CASE WHEN s.due_in IS NOT NULL THEN now() + make_interval(days => s.due_in) END,
       COALESCE(s.funded_at, now() - interval '12 days') - interval '2 days'
  FROM pg_temp.w6_stages() s
 WHERE NOT EXISTS (SELECT 1 FROM projects.project_stages x WHERE x.id = s.stage_id);

INSERT INTO projects.stage_assignments
    (id, project_stage_id, assignee_type, freelancer_profile_id, assigned_by, status, created_at)
SELECT pg_temp.sid('assignment:' || s.key), s.stage_id, 'freelancer', pg_temp.me(), s.client_owner,
       CASE s.state WHEN 'released' THEN 'completed' WHEN 'exited' THEN 'cancelled' ELSE 'accepted' END,
       s.funded_at - interval '1 day'
  FROM pg_temp.w6_stages() s
 WHERE s.state <> 'open'
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects.tickets
    (id, project_id, current_stage_id, current_assignee_id, slug, owner_user_id, title, description, text_description,
     status, required_stages, payment_status, unit_price_cents, total_amount_paid, sort_order, claimed_at, created_at, updated_at)
SELECT s.ticket_id, pg_temp.sid('project:' || s.project), s.stage_id, pg_temp.me(), pg_temp.slug('tkt', 'wallet:' || s.key),
       s.client_owner, s.name, jsonb_build_object('text', s.brief), s.brief,
       (CASE s.state WHEN 'released' THEN 'completed' WHEN 'exited' THEN 'cancelled' WHEN 'held' THEN 'in_progress'
                     ELSE 'in_review' END)::ticket_status,
       jsonb_build_array(jsonb_build_object('stage_id', s.stage_id, 'order', 0)),
       (CASE s.state WHEN 'released' THEN 'released' WHEN 'exited' THEN 'partially_released' ELSE 'escrow_funded' END)::payment_status,
       s.amount, s.net, 1, s.funded_at - interval '1 day', s.funded_at - interval '2 days', COALESCE(s.released_at, s.funded_at)
  FROM pg_temp.w6_stages() s
 WHERE s.state <> 'open'
   AND NOT EXISTS (SELECT 1 FROM projects.tickets x WHERE x.id = s.ticket_id);

INSERT INTO finance.escrows
    (id, project_stage_id, ticket_id, payer_business_id, payee_type, payee_id, amount_cents, platform_fee_cents,
     currency, status, created_at, released_at)
SELECT s.escrow_id, s.stage_id, s.ticket_id, s.biz, 'freelancer', pg_temp.me(), s.amount, s.fee, 'USD',
       CASE WHEN s.state IN ('released', 'exited') THEN 'released' ELSE s.state END,
       s.funded_at, s.released_at
  FROM pg_temp.w6_stages() s
 WHERE s.state <> 'open'
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region [Products, orders and order lines]
INSERT INTO catalogue.products
    (id, owner_user_id, slug, title, description, description_text, format, category, price_cents, currency, licence, created_at)
SELECT pg_temp.sid('product:' || p.key), pg_temp.me(), pg_temp.slug('prd', 'wallet:' || p.key), p.title,
       jsonb_build_object('text', p.brief), p.brief, p.format, 'Templates', p.price, 'USD', 'commercial',
       now() - interval '425 days'
  FROM pg_temp.w6_products() p
ON CONFLICT (id) DO NOTHING;

-- A buyer's order. The target's own wallet purchases follow as the second arm: their lines record no
-- fee rate, so a seeded seller's "last 12 months" figure does not move for a sale their ledger never saw.
WITH sold AS (
    SELECT 'order:' || s.key AS key, s.key AS ref, s.title, s.subtitle, s.item_type, s.item_id, s.fulfilment, s.buyer, s.at,
           s.price, s.fee_bp, s.fee, s.refunded_at, 'Visa •••• 4242' AS method
      FROM pg_temp.w6_sales() s
    UNION ALL
    SELECT 'order:' || b.key, b.key, b.title, 'Instant download', 'digital_product', b.product, 'download', pg_temp.me(), b.at,
           b.price, NULL, 0, b.refunded_at, 'Wallet'
      FROM pg_temp.w6_purchases() b
), orders AS (
    INSERT INTO finance.orders
        (id, reference, status, placed_at, owner_type, owner_id, currency, subtotal_minor, platform_fee_minor, platform_fee_bp,
         platform_fee_mode, total_minor, charged_minor, payment_provider, payment_method_label, idempotency_key, created_at, updated_at)
    SELECT pg_temp.sid(s.key),
           'PJ-' || upper(substr(pg_temp.slug('ord', s.key), 5, 4)) || '-' || upper(substr(pg_temp.slug('ord', s.key), 9, 4)),
           (CASE WHEN s.refunded_at IS NULL THEN 'confirmed' ELSE 'refunded' END)::finance.order_status,
           s.at, 'user', s.buyer, 'USD', s.price, s.fee, 500, 'seller_deducted', s.price, s.price, 'stripe', s.method,
           'snippet:' || pg_temp.me() || ':' || s.key, s.at, COALESCE(s.refunded_at, s.at)
      FROM sold s
    ON CONFLICT (id) DO NOTHING
    RETURNING id
)
INSERT INTO finance.order_lines
    (id, order_id, item_type, item_id, title, subtitle, line_total_minor, currency, platform_fee_bp, platform_fee_minor,
     fulfilment, download_name, download_format, licence, created_at)
SELECT pg_temp.sid('line:' || s.ref), o.id, s.item_type, s.item_id, s.title, s.subtitle, s.price, 'USD', s.fee_bp, s.fee, s.fulfilment,
       CASE WHEN s.fulfilment = 'download' THEN regexp_replace(lower(s.title), '[^a-z0-9]+', '-', 'g') || '.zip' END,
       CASE WHEN s.fulfilment = 'download' THEN 'zip' END,
       CASE WHEN s.fulfilment = 'download' THEN 'commercial' END, s.at
  FROM sold s
  JOIN orders o ON o.id = pg_temp.sid(s.key)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region [Cards, payout methods and the recurring deposit]
SELECT pg_temp.wallet(finance.fn_person_wallet_type(pg_temp.me()), pg_temp.me());

CREATE OR REPLACE FUNCTION pg_temp.w6_wallet() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT w.id FROM finance.wallets w
     WHERE w.owner_id = pg_temp.me() AND w.owner_type = finance.fn_person_wallet_type(pg_temp.me()) AND w.currency = 'USD';
$$;

INSERT INTO finance.payment_methods
    (id, owner_type, owner_id, method_role, external_ref, label, brand, last4, is_default_funding, is_default_payout, status, created_at)
SELECT pg_temp.sid('method:' || v.key), v.owner_type, pg_temp.me(), v.role::finance.method_role,
       v.prefix || '_snippet_' || v.key || '_' || replace(pg_temp.me()::text, '-', ''), v.label, v.brand, v.last4,
       v.key = 'visa', v.key = 'bank', v.status, now() - make_interval(days => v.days)
  FROM (VALUES
      ('visa', 'user', 'funding', 'pm', 'Everyday Visa', 'visa', '4242', 'active', 425),
      ('amex', 'user', 'funding', 'pm', 'Old Amex', 'amex', '0005', 'expired', 402),
      ('mastercard', 'user', 'funding', 'pm', 'Business Mastercard', 'mastercard', '4444', 'active', 125),
      ('oldbank', 'freelancer', 'payout', 'ba', 'Bank account •••• 0178', 'bank_account', '0178', 'inactive', 328),
      ('bank', 'freelancer', 'payout', 'ba', 'Bank account •••• 6120', 'bank_account', '6120', 'active', 327),
      ('wise', 'freelancer', 'payout', 'ba', 'Wise USD •••• 3391', 'bank_account', '3391', 'active', 175)
  ) v (key, owner_type, role, prefix, label, brand, last4, status, days)
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.saved_cards
    (id, owner_type, owner_id, payment_method_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, cardholder_name,
     is_business_card, created_by_user_id, is_default, created_at)
SELECT pg_temp.sid('card:' || v.key), 'user', pg_temp.me(), m.id, m.external_ref, v.brand::finance.card_brand, m.last4, v.month,
       extract(year FROM now())::integer + v.years, u.name, v.business, pg_temp.me(),
       v.key = 'visa' AND NOT EXISTS (
           SELECT 1 FROM finance.saved_cards c WHERE c.owner_type = 'user' AND c.owner_id = pg_temp.me() AND c.is_default
       ),
       m.created_at
  FROM (VALUES
      ('visa', 'visa', 9, 2, false),
      ('mastercard', 'mastercard', 3, 1, true),
      ('amex', 'amex', 6, -1, false)
  ) v (key, brand, month, years, business)
  JOIN finance.payment_methods m ON m.id = pg_temp.sid('method:' || v.key)
 CROSS JOIN LATERAL (
     SELECT btrim(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS name
       FROM org.users_public p WHERE p.user_id = pg_temp.me()
 ) u
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.deposit_rules
    (id, wallet_id, source_method_id, amount_cents, currency, interval, next_run_at, active, failure_count, last_error, created_by, created_at)
SELECT pg_temp.sid('rule:' || v.key), pg_temp.w6_wallet(), pg_temp.sid('method:' || v.method), v.amount, 'USD',
       v.every::finance.deposit_interval, now() + make_interval(days => v.next_in), v.active, v.failures, v.error,
       pg_temp.me(), now() - make_interval(days => v.days)
  FROM (VALUES
      ('tools', 'visa', 6000::bigint, 'monthly', 20, true, 0, NULL::text, 192),
      ('buffer', 'mastercard', 25000, 'monthly', 11, false, 3, 'Your card was declined.', 118)
  ) v (key, method, amount, every, next_in, active, failures, error, days)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region [The ledger walk]
/**
 * What the other snippets paid the target in USD and could not post themselves: escrows, team splits,
 * and the catalogue's service orders (net of each line's fee, once the work has happened). Anything a
 * ledger line or a pending row already covers is skipped, so each source row is credited once, and
 * this is empty when those snippets have not run.
 */
CREATE OR REPLACE FUNCTION pg_temp.w6_earned()
RETURNS TABLE (
    key text, at timestamptz, amount bigint, reason text, ref_table text, ref_id uuid,
    released_at timestamptz, escrow_id uuid, order_id uuid
)
LANGUAGE sql STABLE AS $$
    SELECT 'other-esc:' || e.id, COALESCE(e.released_at, e.created_at) + interval '7 days',
           e.amount_cents + e.deadline_bonus_cents - e.platform_fee_cents, 'escrow_release', 'escrows', e.id,
           COALESCE(e.released_at, e.created_at), e.id, NULL::uuid
      FROM finance.escrows e
     WHERE e.payee_type = 'freelancer' AND e.payee_id = pg_temp.me() AND e.status = 'released' AND e.currency = 'USD'
       AND e.id NOT IN (SELECT s.escrow_id FROM pg_temp.w6_stages() s)
       AND NOT EXISTS (SELECT 1 FROM finance.transactions t WHERE t.wallet_id = pg_temp.w6_wallet() AND t.ref_table = 'escrows' AND t.ref_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM finance.pending_releases r WHERE r.wallet_id = pg_temp.w6_wallet() AND r.escrow_id = e.id)
    UNION ALL
    SELECT 'split:' || ps.id, COALESCE(e.released_at, ps.created_at) + interval '7 days', ps.amount_cents, 'team_split', 'escrows', e.id,
           COALESCE(e.released_at, ps.created_at), e.id, NULL
      FROM finance.payout_splits ps
      JOIN finance.escrows e ON e.id = ps.escrow_id AND e.status = 'released'
     WHERE ps.member_user_id = pg_temp.me() AND ps.currency = 'USD' AND ps.amount_cents > 0
       AND NOT EXISTS (SELECT 1 FROM finance.transactions t WHERE t.wallet_id = pg_temp.w6_wallet() AND t.ref_table = 'escrows' AND t.ref_id = e.id AND t.reason = 'team_split')
       AND NOT EXISTS (SELECT 1 FROM finance.pending_releases r WHERE r.wallet_id = pg_temp.w6_wallet() AND r.escrow_id = e.id AND r.reason = 'team_split')
    UNION ALL
    SELECT 'other-sale:' || ol.id, COALESCE(ol.scheduled_at, o.placed_at) + interval '7 days',
           ol.line_total_minor - ol.promo_discount_minor - ol.platform_fee_minor, 'service_sale', 'orders', o.id,
           COALESCE(ol.scheduled_at, o.placed_at), NULL, o.id
      FROM finance.order_lines ol
      JOIN finance.orders o ON o.id = ol.order_id
      JOIN marketplace.service_blueprints b ON b.id = ol.item_id
     WHERE b.owner_type = 'freelancer' AND b.freelancer_profile_id = pg_temp.me()
       AND ol.currency = 'USD' AND o.status = 'confirmed'
       AND COALESCE(ol.scheduled_at, o.placed_at) <= now()
       AND o.id NOT IN (SELECT pg_temp.sid('order:' || s.key) FROM pg_temp.w6_sales() s)
       AND NOT EXISTS (SELECT 1 FROM finance.transactions t WHERE t.wallet_id = pg_temp.w6_wallet() AND t.ref_table = 'orders' AND t.ref_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM finance.pending_releases r WHERE r.wallet_id = pg_temp.w6_wallet() AND r.order_id = o.id)
$$;

/**
 * Most of that money drawn down to the bank, a day after each month's last credit and in whole
 * hundreds, so the wallet keeps reading like a freelancer who withdraws their earnings.
 */
CREATE OR REPLACE FUNCTION pg_temp.w6_sweeps()
RETURNS TABLE (key text, days integer, amount bigint, status finance.payout_status, instant boolean, method text, bank text, note text)
LANGUAGE sql STABLE AS $$
    SELECT 'sweep-' || m.month, m.days, m.amount, 'paid'::finance.payout_status, false, 'bank', 'paid', NULL::text
      FROM (
          SELECT to_char(e.at, 'YYYY-MM') AS month,
                 floor(sum(e.amount) * 0.85 / 10000)::bigint * 10000 AS amount,
                 floor(extract(epoch FROM now() - max(e.at)) / 86400)::integer - 1 AS days
            FROM pg_temp.w6_earned() e
           WHERE e.at <= now()
           GROUP BY 1
      ) m
     WHERE m.amount > 0 AND m.days >= 1
$$;

-- Read before the walk posts the credits it is sized on: `w6_earned` is empty afterwards.
DROP TABLE IF EXISTS w6_sweep;
CREATE TEMP TABLE w6_sweep AS SELECT * FROM pg_temp.w6_sweeps();

/**
 * Every movement of the target's wallet, in no particular order. An earned line carries `released_at`
 * and lands seven days after it, as `fn_mature_pending_releases` lands it; one whose window is still
 * open is written as a `pending_releases` row and reaches the ledger through the sweep.
 */
CREATE OR REPLACE FUNCTION pg_temp.w6_events()
RETURNS TABLE (
    key text, at timestamptz, direction text, amount bigint, reason text, ref_table text, ref_id uuid,
    released_at timestamptz, escrow_id uuid, order_id uuid
)
LANGUAGE sql STABLE AS $$
    SELECT 'esc:' || s.key, s.released_at + interval '7 days', 'credit', s.net,
           CASE s.state WHEN 'exited' THEN 'fair_exit_release' ELSE 'escrow_release' END, 'escrows', s.escrow_id,
           s.released_at, s.escrow_id, NULL::uuid
      FROM pg_temp.w6_stages() s WHERE s.state IN ('released', 'exited')
    UNION ALL
    SELECT 'sold:' || s.key, s.at + interval '7 days', 'credit', s.price - s.fee, s.reason, 'orders',
           pg_temp.sid('order:' || s.key), s.at, NULL, pg_temp.sid('order:' || s.key)
      FROM pg_temp.w6_sales() s
    UNION ALL
    SELECT 'refund:' || s.key, s.refunded_at, 'debit', s.price - s.fee, 'refund', 'orders',
           pg_temp.sid('order:' || s.key), NULL, NULL, NULL
      FROM pg_temp.w6_sales() s WHERE s.refunded_at IS NOT NULL
    UNION ALL
    SELECT b.key, b.at, 'debit', b.price, 'order_payment', 'orders', pg_temp.sid('order:' || b.key), NULL, NULL, NULL
      FROM pg_temp.w6_purchases() b
    UNION ALL
    SELECT 'unbuy:' || b.key, b.refunded_at, 'credit', b.price, 'refund', 'orders', pg_temp.sid('order:' || b.key), NULL, NULL, NULL
      FROM pg_temp.w6_purchases() b WHERE b.refunded_at IS NOT NULL
    UNION ALL
    SELECT 'topup:' || t.key, t.at, 'credit', t.amount, 'topup', 'inbound_payments', pg_temp.sid('inbound:' || t.key), NULL, NULL, NULL
      FROM pg_temp.w6_topups() t
    UNION ALL
    SELECT 'chargeback:t2', t.at + interval '18 days', 'debit', t.amount, 'chargeback', 'chargebacks', pg_temp.sid('chargeback:t2'), NULL, NULL, NULL
      FROM pg_temp.w6_topups() t WHERE t.key = 't2'
    UNION ALL
    SELECT 'po:' || p.key, pg_temp.w6_at(p.days, 'payout:' || p.key), 'debit', p.amount, 'payout', 'payouts',
           pg_temp.sid('payout:' || p.key), NULL, NULL, NULL
      FROM (SELECT * FROM pg_temp.w6_payouts() UNION ALL SELECT * FROM w6_sweep) p
    UNION ALL
    SELECT 'pofee:' || p.key, pg_temp.w6_at(p.days, 'payout:' || p.key) + interval '1 second', 'debit',
           p.amount * 100 / 10000, 'instant_payout_fee', 'payouts', pg_temp.sid('payout:' || p.key), NULL, NULL, NULL
      FROM pg_temp.w6_payouts() p WHERE p.instant
    UNION ALL
    SELECT 'porev:' || p.key, pg_temp.w6_at(p.days, 'payout:' || p.key) + CASE p.status WHEN 'failed' THEN interval '20 minutes' ELSE interval '3 days' END,
           'credit', p.amount, 'payout_reversal', 'payouts', pg_temp.sid('payout:' || p.key), NULL, NULL, NULL
      FROM pg_temp.w6_payouts() p WHERE p.status IN ('failed', 'reversed')
    UNION ALL
    SELECT e.key, e.at, 'credit', e.amount, e.reason, e.ref_table, e.ref_id, e.released_at, e.escrow_id, e.order_id
      FROM pg_temp.w6_earned() e
$$;

/**
 * One chronological pass over the wallet. The first pass starts at zero; rows the wallet already held
 * rejoin in date order, moving the balance but writing nothing, so it ends at their sum plus this
 * net. A later pass only has late arrivals to post, dated after the newest line because a ledger row
 * is never rewritten. The balance CHECK is the guard that the walk never goes negative.
 * shortcut: a wallet row newer than the walk keeps its stored balance_after, never upgraded because the ledger is append-only.
 */
CREATE OR REPLACE FUNCTION pg_temp.w6_walk() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_wallet uuid := pg_temp.w6_wallet();
    v_walked boolean;
    v_cleared boolean;
    v_at timestamptz;
    v_last timestamptz;
    r record;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_temp.w6_events() e JOIN finance.transactions t ON t.id = pg_temp.sid('tx:' || e.key)
    ) INTO v_walked;
    IF NOT v_walked THEN
        UPDATE finance.wallets SET balance_cents = 0 WHERE id = v_wallet;
    END IF;

    FOR r IN
        SELECT e.* FROM pg_temp.w6_events() e
        UNION ALL
        SELECT NULL, t.created_at, t.direction, t.amount_cents, t.reason, NULL, NULL, NULL, NULL, NULL
          FROM finance.transactions t WHERE t.wallet_id = v_wallet AND NOT v_walked
        ORDER BY 2, 1
    LOOP
        IF r.key IS NULL THEN
            UPDATE finance.wallets
               SET balance_cents = balance_cents + CASE r.direction WHEN 'credit' THEN r.amount ELSE -r.amount END
             WHERE id = v_wallet;
            v_last := r.at;
            CONTINUE;
        END IF;

        v_cleared := r.at <= now();
        IF v_cleared THEN
            -- Lines landing at one instant stay in walk order under `ORDER BY created_at`.
            v_at := GREATEST(r.at, v_last + interval '1 second');
            v_last := v_at;
            IF v_walked AND NOT EXISTS (SELECT 1 FROM finance.transactions t WHERE t.id = pg_temp.sid('tx:' || r.key)) THEN
                SELECT GREATEST(r.at, max(t.created_at) + interval '1 second') INTO v_at
                  FROM finance.transactions t WHERE t.wallet_id = v_wallet;
            END IF;
            PERFORM pg_temp.post(r.key, v_wallet, r.direction, r.amount, r.reason, v_at, r.ref_table, r.ref_id);
        END IF;

        IF r.released_at IS NOT NULL THEN
            INSERT INTO finance.pending_releases
                (id, escrow_id, order_id, wallet_id, reason, amount_cents, currency, released_at, available_at,
                 state, matured_at, transaction_id, created_at)
            VALUES
                (pg_temp.sid('pending:' || r.key), r.escrow_id, r.order_id, v_wallet, r.reason, r.amount, 'USD',
                 r.released_at, r.released_at + interval '7 days',
                 CASE WHEN v_cleared THEN 'available' ELSE 'pending' END::finance.fund_state,
                 CASE WHEN v_cleared THEN v_at END,
                 CASE WHEN v_cleared THEN pg_temp.sid('tx:' || r.key) END,
                 r.released_at)
            ON CONFLICT (id) DO NOTHING;
        END IF;
    END LOOP;
END;
$$;

SELECT pg_temp.w6_walk();

/**
 * Stages priced in another currency, which release into that currency's wallet as
 * `fn_release_ticket_escrow` does. Those wallets are separate, so they keep their own short walk.
 */
CREATE OR REPLACE FUNCTION pg_temp.w6_foreign()
RETURNS TABLE (key text, escrow_id uuid, wallet uuid, amount bigint, currency text, released_at timestamptz)
LANGUAGE sql AS $$
    SELECT 'other-esc:' || e.id, e.id,
           pg_temp.wallet(finance.fn_person_wallet_type(pg_temp.me()), pg_temp.me(), e.currency),
           e.amount_cents + e.deadline_bonus_cents - e.platform_fee_cents, e.currency,
           COALESCE(e.released_at, e.created_at)
      FROM finance.escrows e
     WHERE e.payee_type = 'freelancer' AND e.payee_id = pg_temp.me() AND e.status = 'released' AND e.currency <> 'USD'
     ORDER BY 6, 2
$$;

SELECT count(pg_temp.post(f.key, f.wallet, 'credit', f.amount, 'escrow_release', f.released_at + interval '7 days', 'escrows', f.escrow_id))
  FROM pg_temp.w6_foreign() f
 WHERE f.released_at + interval '7 days' <= now();

INSERT INTO finance.pending_releases
    (id, escrow_id, wallet_id, reason, amount_cents, currency, released_at, available_at, state, matured_at, transaction_id, created_at)
SELECT pg_temp.sid('pending:' || f.key), f.escrow_id, f.wallet, 'escrow_release', f.amount, f.currency, f.released_at,
       f.released_at + interval '7 days',
       CASE WHEN c.cleared THEN 'available' ELSE 'pending' END::finance.fund_state,
       CASE WHEN c.cleared THEN f.released_at + interval '7 days' END,
       CASE WHEN c.cleared THEN pg_temp.sid('tx:' || f.key) END,
       f.released_at
  FROM pg_temp.w6_foreign() f
 CROSS JOIN LATERAL (SELECT f.released_at + interval '7 days' <= now() AS cleared) c
ON CONFLICT (id) DO NOTHING;

-- The clients' own ledgers: a deposit from each company card, a hold per escrow, the Fair Exit's refund.
-- The frozen stage was paid for by card, so its top-up names the inbound payment the chargeback contests.
SELECT count(pg_temp.post(m.key, m.wallet, m.direction, m.amount, m.reason, m.at, m.ref_table, m.ref_id, m.state))
  FROM (
      SELECT x.* FROM (
          SELECT 'biz-open:' || c.key AS key, pg_temp.wallet('business', pg_temp.sid('biz:' || c.key)) AS wallet, 'credit' AS direction,
                 (SELECT sum(s.amount)::bigint + 400000 FROM pg_temp.w6_stages() s WHERE s.client = c.key AND s.state IN ('released', 'exited', 'held')) AS amount,
                 'topup' AS reason, now() - interval '370 days' AS at, 'payment_methods' AS ref_table,
                 pg_temp.sid('biz-card:' || c.key) AS ref_id, 'available'::finance.fund_state AS state
            FROM pg_temp.w6_clients() c
          UNION ALL
          SELECT 'biz-lock:' || s.key, pg_temp.wallet('business', s.biz), 'credit', s.amount, 'topup', s.funded_at - interval '1 minute',
                 'inbound_payments', pg_temp.sid('lock:' || s.key), 'available'
            FROM pg_temp.w6_stages() s WHERE s.state = 'disputed'
          UNION ALL
          SELECT 'biz-hold:' || s.key, pg_temp.wallet('business', s.biz), 'debit', s.amount, 'escrow_hold', s.funded_at,
                 'escrows', s.escrow_id, 'locked'
            FROM pg_temp.w6_stages() s WHERE s.state <> 'open'
          UNION ALL
          SELECT 'biz-refund:' || s.key, pg_temp.wallet('business', s.biz), 'credit', s.amount - s.amount * 5000 / 10000, 'fair_exit_refund', s.released_at,
                 'escrows', s.escrow_id, 'available'
            FROM pg_temp.w6_stages() s WHERE s.state = 'exited'
      ) x
      ORDER BY x.wallet, x.at
  ) m;
-- #endregion

-- #region [Top-ups, payouts and chargebacks behind the ledger lines]
INSERT INTO finance.inbound_payments
    (id, purpose, wallet_id, amount_cents, currency, amount_received_cents, status, provider_ref, idempotency_key,
     transaction_id, livemode, created_by, deposit_rule_id, created_at, updated_at, succeeded_at)
SELECT pg_temp.sid('inbound:' || t.key), 'wallet_topup', pg_temp.w6_wallet(), t.amount, 'USD', t.amount, 'succeeded',
       'pi_snippet_' || replace(t.key, '-', '_') || '_' || replace(pg_temp.me()::text, '-', ''),
       'snippet:' || pg_temp.me() || ':' || t.key, pg_temp.sid('tx:topup:' || t.key), false, pg_temp.me(),
       CASE WHEN t.rule IS NOT NULL THEN pg_temp.sid('rule:' || t.rule) END, t.at, t.at, t.at
  FROM pg_temp.w6_topups() t
ON CONFLICT (id) DO NOTHING;

-- The buffer deposit's three declines, which are why that rule is paused. A decline moves no money.
INSERT INTO finance.inbound_payments
    (id, purpose, wallet_id, amount_cents, currency, status, provider_ref, idempotency_key, failure_reason, created_by,
     deposit_rule_id, created_at, updated_at)
SELECT pg_temp.sid('inbound:declined:' || n), 'wallet_topup', pg_temp.w6_wallet(), 25000, 'USD', 'failed',
       'pi_snippet_declined_' || n || '_' || replace(pg_temp.me()::text, '-', ''),
       'snippet:' || pg_temp.me() || ':declined:' || n, 'Your card was declined.', pg_temp.me(), pg_temp.sid('rule:buffer'),
       now() - make_interval(days => 95 - 30 * n), now() - make_interval(days => 95 - 30 * n)
  FROM generate_series(0, 2) n
ON CONFLICT (id) DO NOTHING;

-- The lock's card payment on the disputed stage, and the case that froze its escrow (`record_dispute_opened`).
INSERT INTO finance.inbound_payments
    (id, purpose, wallet_id, project_stage_id, ticket_id, amount_cents, currency, amount_received_cents, status, lock_status,
     locked_escrow_ids, provider_ref, idempotency_key, transaction_id, livemode, created_by, created_at, updated_at, succeeded_at)
SELECT pg_temp.sid('lock:' || s.key), 'escrow_lock', pg_temp.wallet('business', s.biz), s.stage_id, s.ticket_id, s.amount, 'USD', s.amount,
       'succeeded', 'locked', ARRAY[s.escrow_id], 'pi_snippet_lock_' || replace(pg_temp.me()::text, '-', ''),
       'snippet:' || pg_temp.me() || ':lock:' || s.key, pg_temp.sid('tx:biz-lock:' || s.key), false, s.client_owner,
       s.funded_at, s.funded_at, s.funded_at
  FROM pg_temp.w6_stages() s WHERE s.state = 'disputed'
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.chargebacks
    (id, wallet_id, transaction_id, escrow_id, provider_ref, amount_cents, currency, status, reason, opened_at, resolved_at, created_at)
SELECT pg_temp.sid('chargeback:lock'), pg_temp.wallet('business', s.biz), pg_temp.sid('tx:biz-lock:' || s.key), s.escrow_id,
       'du_snippet_lock_' || replace(pg_temp.me()::text, '-', ''), s.amount, 'USD', 'opened'::finance.chargeback_status, 'product_not_received',
       now() - interval '5 days', NULL, now() - interval '5 days'
  FROM pg_temp.w6_stages() s WHERE s.state = 'disputed'
UNION ALL
SELECT pg_temp.sid('chargeback:t2'), pg_temp.w6_wallet(), pg_temp.sid('tx:topup:t2'), NULL,
       'du_snippet_t2_' || replace(pg_temp.me()::text, '-', ''), t.amount, 'USD', 'lost', 'fraudulent',
       t.at + interval '6 days', t.at + interval '18 days', t.at + interval '6 days'
  FROM pg_temp.w6_topups() t WHERE t.key = 't2'
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payouts
    (id, wallet_id, destination_method_id, amount_cents, currency, status, instant, provider, provider_ref, transaction_id,
     failure_reason, initiated_at, settled_at, created_at, destination_account, reversed_cents, bank_status, bank_payout_ref,
     bank_failure_code, bank_status_at)
SELECT pg_temp.sid('payout:' || p.key), pg_temp.w6_wallet(), pg_temp.sid('method:' || p.method), p.amount, 'USD', p.status, p.instant, 'stripe',
       CASE WHEN p.status IN ('paid', 'reversed') THEN 'tr_snippet_' || p.key || '_' || replace(pg_temp.me()::text, '-', '') END,
       pg_temp.sid('tx:po:' || p.key), p.note, a.at,
       CASE WHEN p.status IN ('paid', 'reversed') THEN a.at + interval '2 minutes' END, a.at,
       (SELECT c.account_id FROM finance.payout_accounts c WHERE c.owner_id = pg_temp.me() AND c.status = 'verified' LIMIT 1),
       CASE WHEN p.status = 'reversed' THEN p.amount ELSE 0 END,
       p.bank,
       CASE WHEN p.bank IS NOT NULL THEN 'po_snippet_' || p.key || '_' || replace(pg_temp.me()::text, '-', '') END,
       CASE WHEN p.bank = 'failed' THEN 'account_closed' END,
       CASE WHEN p.bank IS NOT NULL THEN a.at + interval '2 days' END
  FROM (SELECT * FROM pg_temp.w6_payouts() UNION ALL SELECT * FROM w6_sweep) p
 CROSS JOIN LATERAL (SELECT pg_temp.w6_at(p.days, 'payout:' || p.key) AS at) a
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.payout_schedules
    (id, owner_type, owner_id, mode, destination_method_id, currency, next_run_at, active)
SELECT pg_temp.sid('payout-schedule'), 'freelancer', pg_temp.me(), 'scheduled_monthly', pg_temp.sid('method:bank'), 'USD',
       date_trunc('month', now()) + interval '1 month', true
ON CONFLICT (owner_type, owner_id, currency) DO NOTHING;
-- #endregion

-- #region [Invoices]
-- A stage invoice per funded stage, issued by the target to the client: paid once released, issued
-- or overdue while held, draft before funding, and void for the price a Fair Exit replaced with the
-- earned share. An invoice carries no amount due: the escrow paid it when it was held.
WITH bill AS (
    SELECT 'invoice:' || s.key AS key, s.key AS stage_key, s.stage_id, s.biz, s.amount,
           CASE s.state WHEN 'exited' THEN 0 ELSE s.fee END AS fee, s.escrow_id, s.state,
           CASE s.state WHEN 'released' THEN 'paid' WHEN 'held' THEN 'issued' WHEN 'disputed' THEN 'overdue'
                        WHEN 'exited' THEN 'void' ELSE 'draft' END AS status,
           COALESCE(s.funded_at, now() - interval '3 days') AS at, s.released_at,
           CASE WHEN s.state = 'held' THEN s.funded_at + interval '21 days'
                WHEN s.state <> 'open' THEN s.funded_at + interval '14 days' END AS due
      FROM pg_temp.w6_stages() s
    UNION ALL
    SELECT 'invoice:' || s.key || ':share', s.key, s.stage_id, s.biz, s.amount * 5000 / 10000, s.fee, s.escrow_id, s.state, 'paid',
           s.released_at, s.released_at, s.released_at + interval '14 days'
      FROM pg_temp.w6_stages() s WHERE s.state = 'exited'
), invoices AS (
    INSERT INTO finance.invoices
        (id, project_stage_id, issue_to_business_id, issue_from_profile, invoice_type, amount_cents, subtotal_cents,
         platform_fee_cents, tax_cents, total_cents, currency, status, due_date, paid_at, created_at)
    SELECT pg_temp.sid(b.key), b.stage_id, b.biz, pg_temp.me(), 'per_stage', b.amount, b.amount, b.fee, 0, b.amount, 'USD', b.status,
           b.due, CASE WHEN b.status = 'paid' THEN b.released_at END, b.at
      FROM bill b
    ON CONFLICT (id) DO NOTHING
    RETURNING id
)
INSERT INTO finance.invoice_line_items (id, invoice_id, ref_type, ref_id, description, amount_cents, currency)
SELECT pg_temp.sid(b.key || ':' || l.kind), pg_temp.sid(b.key), l.kind, b.escrow_id, l.description, l.amount, 'USD'
  FROM bill b
  JOIN invoices i ON i.id = pg_temp.sid(b.key)
 CROSS JOIN LATERAL (VALUES
     ('escrow', (SELECT s.name FROM pg_temp.w6_stages() s WHERE s.key = b.stage_key), b.amount),
     ('platform_fee', 'Platform fee (5%), deducted from the payee', -b.fee)
 ) l (kind, description, amount)
 WHERE b.escrow_id IS NOT NULL AND (l.kind = 'escrow' OR b.fee > 0)
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region [Pots, Income Smoother, subscription]
-- Pots earmark part of what the walk left Available, never more than it holds.
INSERT INTO finance.wallet_pots (id, wallet_id, purpose, name, balance_cents, currency, auto_allocate_bp, created_at)
SELECT pg_temp.sid('pot:' || v.key), w.id, v.purpose::finance.pot_purpose, v.name, w.balance_cents * v.share / 100, 'USD', v.bp,
       now() - make_interval(days => v.days)
  FROM (VALUES
      ('tax', 'tax', 'Tax set-aside', 35, 2000, 290),
      ('buffer', 'savings', 'Slow-month buffer', 15, 800, 160),
      ('laptop', 'goal', 'New laptop', 8, 300, 74)
  ) v (key, purpose, name, share, bp, days)
 CROSS JOIN finance.wallets w
 WHERE w.id = pg_temp.w6_wallet()
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.income_smoothing (id, user_id, enrolled, target_monthly_cents, currency, fee_bp, eligibility_met, enrolled_at, created_at)
VALUES
    (pg_temp.sid('smoother'), pg_temp.me(), true, 450000, 'USD', 50, true, now() - interval '98 days', now() - interval '98 days')
ON CONFLICT (user_id, currency) DO NOTHING;

INSERT INTO finance.subscriptions
    (id, profile_id, subject_type, subject_id, plan_id, state, billing_interval, current_period_start, current_period_end,
     price_cents, currency, provider_ref, started_at)
SELECT pg_temp.sid('subscription'), pg_temp.me(), 'user', pg_temp.me(), p.id, 'active', 'monthly',
       now() - interval '12 days', now() + interval '18 days', p.price_cents, p.currency,
       'sub_snippet_' || replace(pg_temp.me()::text, '-', ''), now() - interval '282 days'
  FROM finance.plans p
 WHERE p.code = 'individual_pro'
   AND NOT EXISTS (
       SELECT 1 FROM finance.subscriptions s
        WHERE s.subject_type IN ('user', 'freelancer') AND s.subject_id = pg_temp.me()
          AND s.state IN ('trialing', 'active', 'past_due', 'paused')
   )
ON CONFLICT (id) DO NOTHING;

INSERT INTO finance.subscription_events
    (id, subscription_id, subject_type, subject_id, event_type, from_plan_id, to_plan_id, amount_cents, currency, provider_ref, reason, created_at)
SELECT pg_temp.sid('subscription-event:' || e.days || ':' || e.kind), s.id, 'user', pg_temp.me(), e.kind,
       CASE WHEN e.kind = 'started' THEN f.id ELSE s.plan_id END, s.plan_id,
       CASE WHEN e.kind IN ('started', 'renewed') THEN s.price_cents END, s.currency,
       'in_snippet_' || e.days || '_' || replace(pg_temp.me()::text, '-', ''), e.reason,
       now() - make_interval(days => e.days)
  FROM finance.subscriptions s
  JOIN finance.plans f ON f.is_default AND f.audience = 'individual'
 CROSS JOIN LATERAL (
     SELECT 282 AS days, 'started' AS kind, NULL::text AS reason
     UNION ALL SELECT 12 + 30 * n, 'renewed', NULL FROM generate_series(0, 8) n WHERE n <> 4
     UNION ALL SELECT 132, 'payment_failed', 'Your card was declined.'
     UNION ALL SELECT 130, 'renewed', 'Retried on the updated card.'
 ) e
 WHERE s.id = pg_temp.sid('subscription')
ON CONFLICT (id) DO NOTHING;
-- #endregion

-- #region [Statements]
-- Every closed month of each wallet this script walked, through the billing run's own generator,
-- then dated as that run would have dated them. Idempotent on `uq_statement_period`.
SELECT count(finance.fn_generate_statement(w.id, m.at, m.at + interval '1 month'))
  FROM finance.wallets w
 CROSS JOIN LATERAL generate_series(
     (SELECT date_trunc('month', min(t.created_at) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' FROM finance.transactions t WHERE t.wallet_id = w.id),
     (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - interval '1 month',
     interval '1 month'
 ) m (at)
 WHERE w.id = pg_temp.w6_wallet()
    OR w.owner_id IN (SELECT pg_temp.sid('biz:' || c.key) FROM pg_temp.w6_clients() c);

UPDATE finance.statements
   SET issued_at = period_end + interval '2 hours 20 minutes', created_at = period_end + interval '2 hours 20 minutes'
 WHERE issued_at IS DISTINCT FROM period_end + interval '2 hours 20 minutes'
   AND owner_id IN (
       SELECT pg_temp.me() UNION ALL SELECT pg_temp.sid('biz:' || c.key) FROM pg_temp.w6_clients() c
   );
-- #endregion

-- #region [Self-check]
DO $$
DECLARE
    v_balance bigint;
    v_sum bigint;
    v_bad integer;
BEGIN
    SELECT w.balance_cents, COALESCE(sum(CASE t.direction WHEN 'credit' THEN t.amount_cents ELSE -t.amount_cents END), 0)
      INTO v_balance, v_sum
      FROM finance.wallets w LEFT JOIN finance.transactions t ON t.wallet_id = w.id
     WHERE w.id = pg_temp.w6_wallet()
     GROUP BY w.balance_cents;
    IF v_balance IS DISTINCT FROM v_sum THEN
        RAISE EXCEPTION 'wallet balance % drifted from its ledger sum %', v_balance, v_sum;
    END IF;
    SELECT count(*) INTO v_bad FROM finance.transactions t WHERE t.wallet_id = pg_temp.w6_wallet() AND t.balance_after_cents < 0;
    IF v_bad > 0 THEN
        RAISE EXCEPTION '% ledger rows ran negative', v_bad;
    END IF;
END;
$$;
-- #endregion

SELECT label, n FROM (
    SELECT 1 AS sort, 'Ledger rows on the personal wallet' AS label,
           (SELECT count(*) FROM finance.transactions t WHERE t.wallet_id = pg_temp.w6_wallet()) AS n
    UNION ALL SELECT 2, 'Available balance (minor units, USD)', (SELECT w.balance_cents FROM finance.wallets w WHERE w.id = pg_temp.w6_wallet())
    UNION ALL SELECT 3, 'Earned money still in the 7-day window', (SELECT count(*) FROM finance.pending_releases r WHERE r.wallet_id = pg_temp.w6_wallet() AND r.state = 'pending')
    UNION ALL SELECT 4, 'Client businesses', (SELECT count(*) FROM org.business_profiles b WHERE b.id IN (SELECT pg_temp.sid('biz:' || c.key) FROM pg_temp.w6_clients() c))
    UNION ALL SELECT 5, 'Projects', (SELECT count(*) FROM pg_temp.w6_projects())
    UNION ALL SELECT 6, 'Escrows paying the target', (SELECT count(*) FROM finance.escrows e WHERE e.payee_type = 'freelancer' AND e.payee_id = pg_temp.me())
    UNION ALL SELECT 7, 'Orders sold', (SELECT count(*) FROM pg_temp.w6_sales())
    UNION ALL SELECT 8, 'Orders bought', (SELECT count(*) FROM pg_temp.w6_purchases())
    UNION ALL SELECT 9, 'Payouts', (SELECT count(*) FROM finance.payouts p WHERE p.wallet_id = pg_temp.w6_wallet())
    UNION ALL SELECT 10, 'Invoices issued by the target', (SELECT count(*) FROM finance.invoices i WHERE i.issue_from_profile = pg_temp.me())
    UNION ALL SELECT 11, 'Statements', (SELECT count(*) FROM finance.statements s WHERE s.owner_id = pg_temp.me())
    UNION ALL SELECT 12, 'Payment methods', (SELECT count(*) FROM finance.payment_methods m WHERE m.owner_id = pg_temp.me())
    UNION ALL SELECT 13, 'Pots', (SELECT count(*) FROM finance.wallet_pots p WHERE p.wallet_id = pg_temp.w6_wallet())
    UNION ALL SELECT 14, 'Subscription events', (SELECT count(*) FROM finance.subscription_events e WHERE e.subject_id = pg_temp.me())
) summary
ORDER BY sort;

COMMIT;
